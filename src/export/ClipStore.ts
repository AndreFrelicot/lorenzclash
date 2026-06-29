// Disk-backed (IndexedDB) store for the heavy part of each recorded clip — the encoded
// H.264 chunks — so RAM only ever holds light metadata + the thumbnail. Without this the
// export list would pin the full compressed video in the JS heap (~1 MB per second of
// clip), and a long session of snapshots would OOM-crash the tab on mobile.
//
// The store is SESSION-SCOPED: clear() runs on open(), so clips never persist between app
// launches (which also keeps camera-derived video off the disk once you leave). This
// assumes a single app instance — a second tab opening would wipe the first's clips; that
// is not a supported scenario for this experience.
//
// Graceful fallback: open() returns null wherever IndexedDB is unavailable (private mode,
// blocked, etc.); the recorder then keeps chunks in RAM as before.

const DB_NAME = 'lorenz-clash-clips';
const STORE = 'clips';

// The encoded video payload of one clip — what the muxer needs to assemble the export.
export interface ClipPayload {
  chunks: EncodedVideoChunk[];
  meta: EncodedVideoChunkMetadata | undefined;
}

// One encoded chunk minus its bytes (those are concatenated into the record's Blob).
interface ChunkDesc {
  type: EncodedVideoChunkType;
  timestamp: number;
  duration: number | null;
  byteLength: number;
}

// decoderConfig flattened to storable fields (its `description` is the AVCC the muxer
// needs for the first chunk → copied into an owned Uint8Array).
interface StoredConfig {
  codec: string;
  description?: Uint8Array;
  codedWidth?: number;
  codedHeight?: number;
}

interface ClipRecord {
  id: number;
  blob: Blob; // all chunk bytes concatenated, in order (disk-backed by IndexedDB)
  descs: ChunkDesc[];
  config?: StoredConfig;
}

// Copy a BufferSource into a standalone Uint8Array (own buffer, no shared view).
function toBytes(src: ArrayBufferView | ArrayBuffer): Uint8Array {
  return ArrayBuffer.isView(src)
    ? new Uint8Array(src.buffer.slice(src.byteOffset, src.byteOffset + src.byteLength))
    : new Uint8Array(src.slice(0));
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = (): void => resolve(r.result);
    r.onerror = (): void => reject(r.error);
  });
}

export class ClipStore {
  private constructor(private readonly db: IDBDatabase) {}

  // Open (and reset) the store. Returns null if IndexedDB is unavailable so the caller can
  // fall back to keeping chunks in RAM.
  static async open(): Promise<ClipStore | null> {
    if (typeof indexedDB === 'undefined') return null;
    try {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open(DB_NAME, 1);
        open.onupgradeneeded = (): void => {
          if (!open.result.objectStoreNames.contains(STORE)) {
            open.result.createObjectStore(STORE, { keyPath: 'id' });
          }
        };
        open.onsuccess = (): void => resolve(open.result);
        open.onerror = (): void => reject(open.error);
        open.onblocked = (): void => reject(new Error('IndexedDB open blocked'));
      });
      const store = new ClipStore(db);
      await store.clear(); // session-scoped: every launch starts clean
      return store;
    } catch {
      return null; // no IndexedDB (private mode, quota, blocked) → caller keeps chunks in RAM
    }
  }

  private store(mode: IDBTransactionMode): IDBObjectStore {
    return this.db.transaction(STORE, mode).objectStore(STORE);
  }

  async clear(): Promise<void> {
    await req(this.store('readwrite').clear());
  }

  // Serialize the chunks into one disk-backed Blob (+ a side table of chunk descriptors)
  // and store it. Materializes one clip's bytes (~a few MB) transiently, never all of them.
  async put(id: number, payload: ClipPayload): Promise<void> {
    let total = 0;
    for (const c of payload.chunks) total += c.byteLength;
    const bytes = new Uint8Array(total);
    const descs: ChunkDesc[] = [];
    let off = 0;
    for (const c of payload.chunks) {
      c.copyTo(bytes.subarray(off, off + c.byteLength));
      descs.push({
        type: c.type,
        timestamp: c.timestamp,
        duration: c.duration,
        byteLength: c.byteLength,
      });
      off += c.byteLength;
    }
    const dc = payload.meta?.decoderConfig;
    const config: StoredConfig | undefined = dc
      ? {
          codec: dc.codec,
          description: dc.description
            ? toBytes(dc.description as ArrayBufferView | ArrayBuffer)
            : undefined,
          codedWidth: dc.codedWidth,
          codedHeight: dc.codedHeight,
        }
      : undefined;
    const record: ClipRecord = { id, blob: new Blob([bytes]), descs, config };
    await req(this.store('readwrite').put(record));
  }

  // Read a clip back, reconstructing the EncodedVideoChunks + metadata. Returns null if the
  // record is gone (e.g. evicted).
  async get(id: number): Promise<ClipPayload | null> {
    const record = (await req(this.store('readonly').get(id))) as ClipRecord | undefined;
    if (!record) return null;
    const bytes = new Uint8Array(await record.blob.arrayBuffer());
    const chunks: EncodedVideoChunk[] = [];
    let off = 0;
    for (const d of record.descs) {
      chunks.push(
        new EncodedVideoChunk({
          type: d.type,
          timestamp: d.timestamp,
          duration: d.duration ?? undefined,
          data: bytes.subarray(off, off + d.byteLength),
        }),
      );
      off += d.byteLength;
    }
    const meta: EncodedVideoChunkMetadata | undefined = record.config
      ? {
          decoderConfig: {
            codec: record.config.codec,
            description: record.config.description,
            codedWidth: record.config.codedWidth,
            codedHeight: record.config.codedHeight,
          },
        }
      : undefined;
    return { chunks, meta };
  }

  async delete(id: number): Promise<void> {
    await req(this.store('readwrite').delete(id));
  }

  // Fraction of the origin's storage quota currently in use (0..1), or null if the Storage
  // API is unavailable. Covers all origin storage (not just this DB) — exactly the
  // disk-pressure signal the recorder needs to throttle new clips on a near-full device.
  async usageFraction(): Promise<number | null> {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
    try {
      const { usage, quota } = await navigator.storage.estimate();
      if (!quota) return null;
      return (usage ?? 0) / quota;
    } catch {
      return null;
    }
  }

  close(): void {
    this.db.close();
  }
}
