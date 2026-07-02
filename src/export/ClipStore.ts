// Disk-backed (IndexedDB) store for the heavy part of each recorded clip — the encoded
// H.264 chunks — so RAM only ever holds light metadata + the thumbnail. Without this the
// export list would pin the full compressed video in the JS heap (~1 MB per second of
// clip), and a long session of snapshots would OOM-crash the tab on mobile.
//
// The store is TAB-SESSION-SCOPED: every app instance gets a unique namespace inside the
// shared origin IndexedDB database. That matters because two browser tabs share IndexedDB;
// a global clear() on open would wipe another tab's export clips, and same numeric clip ids
// would overwrite each other. Stale namespaces are cleaned opportunistically on the next open.
//
// Graceful fallback: open() returns null wherever IndexedDB is unavailable (private mode,
// blocked, etc.); the recorder then keeps chunks in RAM as before.

const DB_NAME = 'lorenz-clash-clips';
const STORE = 'clips';
const ACTIVE_SESSIONS_KEY = 'lorenz-clash-clip-store-sessions';
const HEARTBEAT_MS = 15_000;
const SESSION_TTL_MS = 30 * 60_000;

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
  id: number | string;
  blob: Blob; // all chunk bytes concatenated, in order (disk-backed by IndexedDB)
  descs: ChunkDesc[];
  config?: StoredConfig;
}

type SessionRegistry = Record<string, number>;

function makeSessionId(): string {
  if (typeof crypto !== 'undefined') {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    if (typeof crypto.getRandomValues === 'function') {
      const bytes = crypto.getRandomValues(new Uint8Array(12));
      return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    }
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function readSessions(): SessionRegistry | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(ACTIVE_SESSIONS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: SessionRegistry = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof key === 'string' && typeof value === 'number' && Number.isFinite(value)) {
        out[key] = value;
      }
    }
    return out;
  } catch {
    return null;
  }
}

function writeSessions(sessions: SessionRegistry): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(ACTIVE_SESSIONS_KEY, JSON.stringify(sessions));
  } catch {
    /* persistence is best-effort; clips still work, stale cleanup just waits */
  }
}

function pruneSessions(sessions: SessionRegistry, now: number): void {
  for (const [id, lastSeen] of Object.entries(sessions)) {
    if (now - lastSeen > SESSION_TTL_MS) delete sessions[id];
  }
}

function recordSessionId(recordId: unknown): string | null {
  if (typeof recordId !== 'string') return null;
  const sep = recordId.indexOf(':');
  return sep > 0 ? recordId.slice(0, sep) : null;
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
  private readonly sessionId = makeSessionId();
  private heartbeatTimer: number | null = null;

  private constructor(private readonly db: IDBDatabase) {}

  // Open a tab-scoped store. Returns null if IndexedDB is unavailable so the caller can fall
  // back to keeping chunks in RAM.
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
      await store.cleanupStaleSessions();
      store.startSessionHeartbeat();
      return store;
    } catch {
      return null; // no IndexedDB (private mode, quota, blocked) → caller keeps chunks in RAM
    }
  }

  private store(mode: IDBTransactionMode): IDBObjectStore {
    return this.db.transaction(STORE, mode).objectStore(STORE);
  }

  async clearSession(): Promise<void> {
    await this.deleteWhere((id) => recordSessionId(id) === this.sessionId);
  }

  private key(id: number): string {
    return `${this.sessionId}:${id}`;
  }

  private touchSession(): Set<string> | null {
    const sessions = readSessions();
    if (!sessions) return null;
    const now = Date.now();
    pruneSessions(sessions, now);
    sessions[this.sessionId] = now;
    writeSessions(sessions);
    return new Set(Object.keys(sessions));
  }

  private unregisterSession(): void {
    const sessions = readSessions();
    if (!sessions) return;
    delete sessions[this.sessionId];
    writeSessions(sessions);
  }

  private startSessionHeartbeat(): void {
    this.touchSession();
    if (typeof window === 'undefined') return;
    this.heartbeatTimer = window.setInterval(() => this.touchSession(), HEARTBEAT_MS);
    window.addEventListener('pagehide', this.handlePageHide);
  }

  private readonly handlePageHide = (event: PageTransitionEvent): void => {
    if (event.persisted) return;
    this.unregisterSession();
    void this.clearSession().catch(() => {});
  };

  private async cleanupStaleSessions(): Promise<void> {
    const active = this.touchSession();
    if (!active) return; // without localStorage coordination, never risk deleting another tab
    await this.deleteWhere((id) => {
      const sessionId = recordSessionId(id);
      return !sessionId || !active.has(sessionId); // old numeric keys or expired tab sessions
    });
  }

  private async deleteWhere(shouldDelete: (recordId: unknown) => boolean): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const tx = this.db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      tx.oncomplete = (): void => resolve();
      tx.onerror = (): void => reject(tx.error);
      tx.onabort = (): void => reject(tx.error);
      const cursorReq = store.openCursor();
      cursorReq.onerror = (): void => reject(cursorReq.error);
      cursorReq.onsuccess = (): void => {
        const cursor = cursorReq.result;
        if (!cursor) return;
        const record = cursor.value as { id?: unknown };
        if (shouldDelete(record.id)) cursor.delete();
        cursor.continue();
      };
    });
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
    const record: ClipRecord = { id: this.key(id), blob: new Blob([bytes]), descs, config };
    await req(this.store('readwrite').put(record));
  }

  // Read a clip back, reconstructing the EncodedVideoChunks + metadata. Returns null if the
  // record is gone (e.g. evicted).
  async get(id: number): Promise<ClipPayload | null> {
    const record = (await req(this.store('readonly').get(this.key(id)))) as ClipRecord | undefined;
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
    await req(this.store('readwrite').delete(this.key(id)));
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
    if (typeof window !== 'undefined' && this.heartbeatTimer !== null) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', this.handlePageHide);
    }
    this.unregisterSession();
    this.db.close();
  }
}
