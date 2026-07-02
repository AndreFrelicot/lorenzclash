// Live recorder for the local video export. A "sequence" is one background
// appearance: from when an HD still starts dissolving in to when it has
// dissolved out. While a sequence is on screen we feed the composite to a WebCodecs
// VideoEncoder at 30 fps and CLOSE each frame immediately — so RAM only ever holds the
// compressed chunks (~a few MB per clip), never raw frames.
//
// Frames come from the GPU CompositeSource (an owned offscreen target), NOT the live
// swapchain canvas — reading the presented canvas per frame glitches iOS Safari.
// Encoding is streaming, so a Web Worker isn't needed for memory; the hardware encoder
// already runs off-thread. Keeps a rolling buffer of the last N sequences (+ pinned).
import { pickAvcCodec } from './codec.ts';
import { ClipStore, type ClipPayload } from './ClipStore.ts';

const FPS = 30;
const FRAME_DUR_US = Math.round(1_000_000 / FPS);
// Final safety ceiling on the export long edge (≈1080p class). The render canvas is now
// pixel-budget-capped upstream (App.resizeCanvas), so a large tablet/desktop no longer
// produces 5 MP frames — this rarely bites, but it keeps the export from ever exceeding
// what mobile H.264 encoders comfortably handle. (Earlier this was 2560, which wrongly
// inflated big-iPad exports — those canvases exceed 1920; the upstream cap is the real fix.)
const MAX_EDGE = 1920;

// Skip a capture frame when the hardware encoder is already this many frames behind. Without
// it, a device that can't drain 30 fps lets the encode queue — and the frames it retains —
// grow unbounded → memory climbs until the GPU process is killed (device lost: the
// "beginRenderPass: Unable to begin render pass" / "VideoEncoder is not configured" crashes).
// Dropping frames degrades the clip gracefully instead of taking down the whole app.
const MAX_ENCODE_QUEUE = 2;

// After this many encoder faults in a session, stop recording entirely rather than keep
// spinning up encoders that immediately die. The animation always keeps running — on a
// device that can't sustain encoding, losing the export is the acceptable trade.
const MAX_ENCODER_FAILURES = 2;

// Adaptive export resolution ("progressive mode"). There is no memory API on iOS to size the
// export to the device, so instead we react to the encoder STRUGGLING: every fault drops the
// export scale a notch until the encode is sustainable. A capable device (desktop) never faults
// → stays at full resolution; a GPU-tight one (iPad) ratchets down until stable. Touch devices
// start a notch lower so they don't have to fail first.
const MIN_EXPORT_SCALE = 0.5;
const EXPORT_SCALE_STEP = 0.75; // multiplier applied on each encoder fault

// Resolution-aware bitrate, ~0.19 bits/pixel/frame — tuned for this high-motion, bloom-
// heavy content. Lands ≈12 Mbps at 1080p30 (a real lift over the old flat 8) and scales
// down with the frame, so a portrait phone clip stays proportionate instead of bloating
// IndexedDB. Floor/ceiling keep both extremes sane.
const BITRATE_BPP = 0.19;
const BITRATE_MIN = 9_000_000;
const BITRATE_MAX = 16_000_000;
function bitrateFor(w: number, h: number, fps: number): number {
  const raw = Math.round(w * h * fps * BITRATE_BPP);
  return Math.min(BITRATE_MAX, Math.max(BITRATE_MIN, raw));
}
// Auto-capture PAUSES once this many non-pinned clips exist — it does NOT recycle (evict + re-encode
// behind), because continuous re-encoding is what slowly tips a GPU-tight device over on a long
// session. The user frees slots (trash / "remove unused" / un-keep) and auto-capture resumes.
const MAX_AUTO = 10;
const MAX_KEPT = 200; // hard backstop on total clips → bounds thumbnail RAM (≈18 MB)
const AUTO_QUOTA = 0.6; // storage usage (0..1) above which new AUTO clips stop accumulating
const SAVE_QUOTA = 0.85; // …above which manual snapshots are blocked too (near full)
const THUMB_W = 200;

// Supplies composite frames without touching the live canvas (implemented by WebGPUContext).
export interface CompositeSource {
  grabCompositeFrame(
    w: number,
    h: number,
    timestampUs: number,
    durationUs: number,
  ): VideoFrame | null;
  readonly captureWidth: number;
  readonly captureHeight: number;
}

export type SequenceKind = 'auto' | 'manual';

export interface Sequence {
  id: number;
  // The encoded video. Offloaded to ClipStore (IndexedDB) when available, so these are
  // absent on stored clips (fetched on demand via loadPayload) and present only on in-RAM
  // clips: the no-IndexedDB fallback and the live-built outro.
  chunks?: EncodedVideoChunk[];
  meta?: EncodedVideoChunkMetadata;
  durationUs: number;
  width: number;
  height: number;
  thumb: ImageBitmap;
  pinned: boolean;
  included: boolean; // whether this clip is part of the export
  audio?: { trackSrc: string; startSec: number };
  // Slow-mo warp per captured frame (1 = normal, down to ~0.35). The export resamples
  // the audio along this envelope so the sound slows in sync with the recorded video.
  warps: Float32Array;
}

interface Session {
  chunks: EncodedVideoChunk[];
  meta: EncodedVideoChunkMetadata | undefined;
  kind: SequenceKind;
  frameIndex: number;
  lastCaptureMs: number;
  startMs: number; // wall-clock of the first captured frame → real-time frame timestamps
  lastTsUs: number; // timestamp (µs) of the last captured frame → the clip's true duration
  thumbPromise: Promise<ImageBitmap> | null;
  audio?: { trackSrc: string; startSec: number };
  warps: number[];
}

function evenDims(cw: number, ch: number): { w: number; h: number } {
  const scale = Math.min(1, MAX_EDGE / Math.max(cw, ch));
  let w = Math.round(cw * scale);
  let h = Math.round(ch * scale);
  w -= w % 2;
  h -= h % 2;
  return { w: Math.max(2, w), h: Math.max(2, h) };
}

export class SequenceRecorder {
  readonly fps = FPS;
  private codec: string | null = null;
  private outW = 0;
  private outH = 0;
  private bitrate = 0; // resolution-derived, locked alongside the dims in init()
  private exportScale = 1; // adaptive: scales the canvas dims for the export (see MIN_EXPORT_SCALE)
  private encoderFailures = 0;
  private recordingDisabled = false; // latched true after repeated encoder faults
  private encodersCreated = 0; // diagnostic: count of VideoEncoders spun up this session
  // ONE persistent encoder reused across every clip. Creating a fresh VideoEncoder per clip
  // exhausts iOS/VideoToolbox encoder sessions (they aren't released promptly) → GPU OOM after
  // ~15–20 clips. We flush (not close) between clips and keep this alive for the whole session.
  private encoder: VideoEncoder | null = null;
  private sharedMeta: EncodedVideoChunkMetadata | undefined; // decoderConfig, emitted once by the shared encoder
  private activeTarget: Session | null = null; // session currently receiving encoder output
  private flushing = false; // a clip's flush is in flight → block a new clip until it drains
  private src: CompositeSource | null = null;
  private session: Session | null = null;
  private nextId = 1;
  private readonly sequences: Sequence[] = []; // chronological (oldest first)
  // Disk-backed store for the encoded chunks (keeps them out of the JS heap). null when
  // IndexedDB is unavailable → chunks are kept on the Sequence in RAM instead.
  private store: ClipStore | null = null;
  // Cached fraction (0..1) of the storage quota in use, refreshed after writes. Drives the
  // quota-aware throttling: AUTO clips stop past AUTO_QUOTA, manual blocked past SAVE_QUOTA.
  private usage = 0;

  get supported(): boolean {
    return this.codec !== null;
  }

  get isRecording(): boolean {
    return this.session !== null;
  }

  get recordingKind(): SequenceKind | null {
    return this.session?.kind ?? null;
  }

  // Compact snapshot for the periodic diagnostic log — surfaces the export subsystem's
  // memory drivers (encode-queue depth, retained clip count, storage pressure) so a crash
  // history shows what was growing.
  get diagnostics(): {
    rec: boolean;
    queue: number;
    clips: number;
    usage: number;
    disabled: boolean;
    dims: string;
    enc: number;
    ramMB: number;
    idb: boolean;
    kind: SequenceKind | 'none';
  } {
    let ramBytes = 0;
    for (const s of this.sequences) {
      if (s.chunks) for (const c of s.chunks) ramBytes += c.byteLength;
    }
    if (this.session) for (const c of this.session.chunks) ramBytes += c.byteLength;
    return {
      rec: this.session !== null,
      queue: this.encoder?.encodeQueueSize ?? 0,
      clips: this.sequences.length,
      usage: Math.round(this.usage * 100),
      disabled: this.recordingDisabled,
      dims: `${this.outW}×${this.outH}`,
      enc: this.encodersCreated, // total VideoEncoders created — churn suspect (iOS session limit)
      ramMB: Math.round(ramBytes / 1e6), // encoded chunks held in JS RAM (high → IndexedDB not offloading)
      idb: this.store !== null, // whether the IndexedDB offload store is active
      kind: this.session?.kind ?? 'none', // current capture: auto (background) / manual (snapshot)
    };
  }

  // True when storage is too full to keep new MANUAL snapshots, or the hard backstop on
  // total clips is hit. The app checks this before a manual snapshot to warn the user
  // instead of silently dropping it. (AUTO clips self-throttle inside beginSequence.)
  get storageFull(): boolean {
    return this.usage >= SAVE_QUOTA || this.sequences.length >= MAX_KEPT;
  }

  // Re-read storage pressure into the cache (soft threshold, so slight staleness is fine).
  private async refreshUsage(): Promise<void> {
    this.usage = (await this.store?.usageFraction()) ?? 0;
  }

  // Probe codec support and lock the output dimensions from the source. Returns false
  // if WebCodecs H.264 encoding is unavailable (the export feature is then disabled).
  // Re-point at a freshly rebuilt composite source (same canvas/dims) after a GPU recovery —
  // the old `src` belongs to a destroyed device. Drops any in-flight clip (its encoder is gone).
  setSource(source: CompositeSource): void {
    this.session = null;
    this.activeTarget = null;
    this.encoder = null; // belonged to the dead device; ensureEncoder builds a fresh one
    this.src = source;
  }

  async init(source: CompositeSource): Promise<boolean> {
    if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return false;
    // Touch devices (phones/tablets — the GPU-tight ones) start a notch below full so they don't
    // have to fail a clip first; desktop (fine pointer) starts at full and stays there.
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    this.exportScale = coarse ? EXPORT_SCALE_STEP : 1;
    const { w, h } = evenDims(
      (source.captureWidth || 1280) * this.exportScale,
      (source.captureHeight || 720) * this.exportScale,
    );
    this.outW = w;
    this.outH = h;
    this.bitrate = bitrateFor(w, h, FPS);
    this.codec = await pickAvcCodec(w, h, this.bitrate, FPS);
    if (!this.codec) return false;
    console.info(
      `[export] ${w}×${h} @ ${FPS}fps, ${Math.round(this.bitrate / 1000)} kbps, ${this.codec}`,
    );
    this.src = source;
    // Offload encoded chunks to disk so the export list can grow without OOM. Namespaced per
    // tab session so another open tab cannot wipe/overwrite this tab's clips.
    // null → IndexedDB unavailable, chunks stay in RAM.
    this.store = await ClipStore.open();
    await this.refreshUsage();
    return true;
  }

  // Start recording a new sequence. Ignored if unsupported, already recording, or a
  // previous sequence is still flushing.
  // Lazily build (or reconfigure) the ONE shared encoder. Its output routes to whichever
  // session currently owns it (this.activeTarget). Returns false if encoding is unavailable.
  private ensureEncoder(): boolean {
    if (!this.codec) return false;
    if (this.encoder && this.encoder.state === 'configured') return true;
    // After a reset() (abort) the encoder is 'unconfigured' — reuse it, just reconfigure (no
    // new VideoToolbox session). Only a null/closed encoder (first use or a fault) makes a new one.
    if (this.encoder && this.encoder.state === 'unconfigured') {
      this.encoder.configure(this.encoderConfig());
      return true;
    }
    const encoder = new VideoEncoder({
      output: (chunk, meta) => {
        // The shared encoder emits decoderConfig only ONCE (with the first clip's first chunk),
        // so later clips' `meta` stays undefined → the muxer crashes reading colorSpace. Stash
        // it here and reuse it for every clip (same encoder config → same decoderConfig).
        if (meta?.decoderConfig) this.sharedMeta = meta;
        const t = this.activeTarget;
        if (!t) return; // between clips — nothing to attribute the chunk to
        if (meta?.decoderConfig && !t.meta) t.meta = meta;
        t.chunks.push(chunk);
      },
      error: (e) => {
        console.error('VideoEncoder error', e);
        // Drop the dead encoder + clip so captureFrame stops feeding it (the next encode()
        // would throw and kill the render loop). A fresh one is built for the next clip.
        this.failSession('encoder-error');
      },
    });
    encoder.configure(this.encoderConfig());
    this.encoder = encoder;
    this.encodersCreated++;
    return true;
  }

  private encoderConfig(): VideoEncoderConfig {
    return {
      codec: this.codec as string,
      width: this.outW,
      height: this.outH,
      bitrate: this.bitrate,
      framerate: FPS,
    };
  }

  // Re-derive the output dims from the current source — the canvas may have been resized since
  // init(), and the export must match the live framing. Called at each clip start; if the dims
  // changed, the shared encoder is reset so ensureEncoder reconfigures to the new size.
  private refreshDims(): void {
    if (!this.src) return;
    const { w, h } = evenDims(
      (this.src.captureWidth || 1280) * this.exportScale,
      (this.src.captureHeight || 720) * this.exportScale,
    );
    if (w === this.outW && h === this.outH) return;
    this.outW = w;
    this.outH = h;
    this.bitrate = bitrateFor(w, h, FPS);
    if (this.encoder && this.encoder.state === 'configured') {
      try {
        this.encoder.reset();
      } catch {
        this.encoder = null; // couldn't reset → rebuild fresh at the new size
      }
    }
  }

  beginSequence(audio?: { trackSrc: string; startSec: number }, kind: SequenceKind = 'auto'): void {
    // Block while a previous clip is still flushing the shared encoder (drains in <~100 ms),
    // so its tail chunks aren't misattributed to this new clip. `session` blocks true overlap.
    if (!this.codec || this.session || this.flushing || this.recordingDisabled) return;
    // Quota guard: stop accumulating AUTO clips once storage fills (they're optional, and
    // capped anyway). Manual snapshots are gated by the app via `storageFull` instead.
    if (
      kind === 'auto' &&
      (this.countNonPinned() >= MAX_AUTO ||
        this.usage >= AUTO_QUOTA ||
        this.sequences.length >= MAX_KEPT)
    )
      return; // auto-capture paused: buffer full (curate to resume), or storage tight

    this.refreshDims(); // pick up any window resize since init so the clip exports at the right size
    if (!this.ensureEncoder()) return;
    const session: Session = {
      chunks: [],
      meta: undefined,
      kind,
      frameIndex: 0,
      lastCaptureMs: Number.NEGATIVE_INFINITY,
      startMs: 0,
      lastTsUs: 0,
      thumbPromise: null,
      audio,
      warps: [],
    };
    this.session = session;
    this.activeTarget = session; // route the shared encoder's output to this clip
  }

  // Grab + encode one composite frame, throttled to ~30 fps. Call once per rAF after
  // render. `warp` (1 = normal, < 1 = slow-mo) is recorded per frame for the audio
  // resample. The frame comes from the GPU source (owned offscreen target), never the
  // live canvas → iOS-safe.
  captureFrame(nowMs: number, warp = 1): void {
    const s = this.session;
    const encoder = this.encoder;
    if (!s || !this.src || !encoder) return;
    if (nowMs - s.lastCaptureMs < 1000 / FPS - 1) return;

    // The encoder died mid-clip (resource pressure on a weak device fires its error callback
    // and flips state away from 'configured'). Encoding into it would throw and kill the
    // render loop — in extreme cases we'd rather drop the recording than stop the animation.
    if (encoder.state !== 'configured') {
      this.failSession('encoder-not-configured');
      return;
    }
    // Backpressure: if the hardware encoder is already behind, skip this frame instead of
    // queueing more — that's what stops the unbounded memory growth → device-loss crash.
    if (encoder.encodeQueueSize > MAX_ENCODE_QUEUE) {
      s.lastCaptureMs = nowMs;
      return;
    }

    // Timestamp by REAL elapsed time so a GPU-tight device that drops frames yields a clip of
    // the right DURATION at its true (lower) frame rate — NOT a shorter, sped-up clip. Safe now
    // that the shared encoder is reset() per clip (each clip is a fresh, independent encode, so
    // the per-clip restart to 0 is not a backward time jump on a continuous stream).
    if (s.frameIndex === 0) s.startMs = nowMs;
    const tsUs = s.frameIndex === 0 ? 0 : Math.max(0, Math.round((nowMs - s.startMs) * 1000));
    const frame = this.src.grabCompositeFrame(this.outW, this.outH, tsUs, FRAME_DUR_US);
    if (!frame) return; // grab unavailable this frame — try again next tick
    s.lastCaptureMs = nowMs;
    s.lastTsUs = tsUs;
    try {
      encoder.encode(frame, { keyFrame: s.frameIndex === 0 });
    } catch (err) {
      console.error('[export] encode failed — dropping clip', err);
      frame.close();
      this.failSession('encode-threw');
      return;
    }
    if (s.frameIndex === 0) {
      const th = Math.max(1, Math.round((THUMB_W * this.outH) / this.outW));
      const clone = frame.clone(); // keep a copy alive past frame.close() for the thumb
      s.thumbPromise = createImageBitmap(clone, {
        resizeWidth: THUMB_W,
        resizeHeight: th,
        resizeQuality: 'low',
      }).finally(() => clone.close());
    }
    frame.close();
    s.warps.push(warp);
    s.frameIndex++;
  }

  // Finish the current sequence: flush the SHARED encoder (keeping it alive for the next clip)
  // and store the clip (rolling buffer). The encoder is never closed here — that's the whole
  // point: one encoder for the session, not one per clip.
  async endSequence(): Promise<void> {
    const s = this.session;
    this.session = null; // stop accepting new frames; output still routes to s via activeTarget
    if (!s) return;
    if (s.frameIndex === 0 || !s.thumbPromise) {
      this.activeTarget = null;
      return; // nothing visible captured (e.g. tab was hidden) — keep the encoder
    }
    this.flushing = true; // block a new clip until this flush drains
    try {
      await this.encoder?.flush(); // drains s's remaining chunks via the output callback
      this.activeTarget = null;
      // Reset the shared encoder so the NEXT clip is a fresh, independent encode (reconfigured
      // by ensureEncoder). Without this, reusing one encoder across clips with each clip's
      // timestamps reset to 0 feeds it backward time jumps → corrupted/frozen frames, and only
      // the first clip carries a decoderConfig. reset() reuses the encoder object (no new
      // VideoEncoder → no VideoToolbox session churn, the reason we share one in the first place).
      if (this.encoder && this.encoder.state === 'configured') {
        try {
          this.encoder.reset();
        } catch {
          this.encoder = null; // couldn't reset → rebuild fresh next clip
        }
      }
      const thumb = await s.thumbPromise;
      const id = this.nextId++;
      // The shared encoder emits decoderConfig only once → clips 2+ have no own meta; fall back
      // to the stashed one (same config) so the muxer always has it (else it crashes on export).
      const clipMeta = s.meta ?? this.sharedMeta;
      // Offload the encoded chunks to disk so RAM holds only light metadata + the thumbnail.
      // On failure (or no IndexedDB) keep them on the Sequence in RAM as a fallback.
      let stored = false;
      if (this.store) {
        try {
          await this.store.put(id, { chunks: s.chunks, meta: clipMeta });
          stored = true;
        } catch (err) {
          console.warn('[lorenz] clip offload failed; keeping in RAM', err);
        }
      }
      this.sequences.push({
        id,
        chunks: stored ? undefined : s.chunks,
        meta: stored ? undefined : clipMeta,
        durationUs: s.lastTsUs + FRAME_DUR_US, // real elapsed time → correct duration even if frames dropped
        width: this.outW,
        height: this.outH,
        thumb,
        pinned: s.kind === 'manual', // manual snapshots are kept (never auto-evicted)
        included: true,
        audio: s.audio,
        warps: new Float32Array(s.warps),
      });
      // No rolling eviction: the begin-guard caps non-pinned clips, so we never recycle.
      // Refresh on any store attempt: a QuotaExceededError (put threw, stored=false) means
      // we're near full, so storageFull must flip to block the next manual snapshot too.
      if (this.store) void this.refreshUsage();
    } catch (e) {
      console.error('endSequence failed', e);
      this.activeTarget = null;
    } finally {
      this.flushing = false;
    }
  }

  // Live-record a short "outro" clip at export time: each frame grabs the running composite
  // and lets `draw` paint an overlay (the QR end card) on top, then encodes it. Returns a
  // standalone Sequence WITHOUT storing it in the rolling list — it's injected only into the
  // export. Real-time paced (one frame per rAF) so the scene keeps moving behind the card.
  // Returns null if recording is unsupported/busy or nothing could be grabbed.
  async recordOutro(opts: {
    durationSec: number;
    draw: (ctx: OffscreenCanvasRenderingContext2D, frame: VideoFrame, t: number) => void;
    audio?: { trackSrc: string; startSec: number };
    onProgress?: (p: number) => void;
  }): Promise<Sequence | null> {
    if (!this.codec || !this.src || this.session) return null;
    const canvas = new OffscreenCanvas(this.outW, this.outH);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const chunks: EncodedVideoChunk[] = [];
    let meta: EncodedVideoChunkMetadata | undefined;
    this.encodersCreated++;
    const encoder = new VideoEncoder({
      output: (chunk, m) => {
        if (m?.decoderConfig && !meta) meta = m;
        chunks.push(chunk);
      },
      error: (e) => console.error('recordOutro encoder error', e),
    });
    encoder.configure({
      codec: this.codec,
      width: this.outW,
      height: this.outH,
      bitrate: this.bitrate,
      framerate: FPS,
    });

    const frameCount = Math.max(1, Math.round(opts.durationSec * FPS));
    // Wait for the next painted frame, but with a timeout fallback: rAF is paused while the
    // tab is hidden/suspended, and without the fallback the outro loop would stall forever
    // (the miss-cap never runs because the loop body never executes).
    const nextRaf = (): Promise<void> =>
      new Promise((resolve) => {
        let done = false;
        const finish = (): void => {
          if (done) return;
          done = true;
          resolve();
        };
        requestAnimationFrame(finish);
        setTimeout(finish, 500);
      });

    let thumbPromise: Promise<ImageBitmap> | null = null;
    let i = 0;
    try {
      let misses = 0;
      while (i < frameCount) {
        await nextRaf();
        const frame = this.src.grabCompositeFrame(
          this.outW,
          this.outH,
          i * FRAME_DUR_US,
          FRAME_DUR_US,
        );
        if (!frame) {
          if (++misses > 120) break; // source unavailable too long — bail
          continue;
        }
        misses = 0;
        ctx.drawImage(frame, 0, 0, this.outW, this.outH);
        opts.draw(ctx, frame, frameCount > 1 ? i / (frameCount - 1) : 1);
        frame.close();

        const vf = new VideoFrame(canvas, { timestamp: i * FRAME_DUR_US, duration: FRAME_DUR_US });
        try {
          encoder.encode(vf, { keyFrame: i === 0 });
        } finally {
          vf.close();
        }

        if (i === 0) {
          const th = Math.max(1, Math.round((THUMB_W * this.outH) / this.outW));
          thumbPromise = createImageBitmap(canvas, {
            resizeWidth: THUMB_W,
            resizeHeight: th,
            resizeQuality: 'low',
          });
        }
        opts.onProgress?.((i + 1) / frameCount);
        i++;
      }

      if (i === 0 || !thumbPromise) {
        encoder.close();
        return null;
      }
      await encoder.flush();
      encoder.close();
      return {
        id: this.nextId++,
        chunks,
        meta,
        durationUs: i * FRAME_DUR_US,
        width: this.outW,
        height: this.outH,
        thumb: await thumbPromise,
        pinned: false,
        included: true,
        audio: opts.audio,
        warps: new Float32Array(i).fill(1),
      };
    } catch (e) {
      console.error('recordOutro failed', e);
      try {
        encoder.close();
      } catch {
        /* already closed */
      }
      void thumbPromise?.then((b) => b.close()).catch(() => {});
      return null;
    }
  }

  // Discard the current clip WITHOUT storing it — used when a manual snapshot preempts an
  // in-progress background clip. The shared encoder is kept: reset() clears its in-flight
  // frames (→ 'unconfigured'); the next beginSequence reconfigures it (no new session).
  abortSequence(): void {
    const s = this.session;
    if (!s) return; // nothing active — must NOT clear activeTarget (a prior clip may be flushing)
    this.session = null;
    this.activeTarget = null;
    if (this.encoder && this.encoder.state === 'configured') {
      try {
        this.encoder.reset();
      } catch {
        /* fall back to a fresh encoder next clip */
      }
    }
    void s.thumbPromise?.then((b) => b.close()).catch(() => {});
  }

  // An encoder fault: drop the current clip (never store a broken one) AND the shared encoder
  // itself (it's dead) so the next clip builds a fresh one. If faults keep happening, latch
  // recording off for the session. The render loop is never affected — only export capture stops.
  private failSession(reason: string): void {
    const enc = this.encoder;
    if (this.session === null && this.activeTarget === null && enc === null) return;
    this.session = null;
    this.activeTarget = null;
    this.flushing = false;
    this.encoder = null;
    if (enc) {
      try {
        if (enc.state !== 'closed') enc.close();
      } catch {
        /* already closing */
      }
    }
    console.warn(`[export] recording aborted (${reason})`);
    // Progressive mode: rather than give up, drop the export resolution a notch and try again —
    // the encode that overwhelmed this device may be sustainable at a smaller size. Only once
    // we're already at the floor and STILL failing do we latch recording off for the session.
    if (this.exportScale > MIN_EXPORT_SCALE) {
      this.exportScale = Math.max(MIN_EXPORT_SCALE, this.exportScale * EXPORT_SCALE_STEP);
      this.refreshDims(); // recompute outW/outH at the smaller scale (encoder rebuilds next clip)
      console.warn(
        `[export] quality reduced to ${Math.round(this.exportScale * 100)}% (${this.outW}×${this.outH})`,
      );
      return; // give the lower resolution a chance before counting toward the disable threshold
    }
    if (++this.encoderFailures >= MAX_ENCODER_FAILURES) {
      this.recordingDisabled = true;
      console.warn('[export] encoder unstable on this device — recording disabled this session');
    }
  }

  setPinned(id: number, pinned: boolean): void {
    const seq = this.sequences.find((x) => x.id === id);
    if (!seq || seq.pinned === pinned) return;
    seq.pinned = pinned;
    // Un-keeping makes a clip disposable again — it doesn't delete it (the user must do that), but
    // it lets auto-capture resume if it had paused at the cap.
  }

  setIncluded(id: number, included: boolean): void {
    const seq = this.sequences.find((x) => x.id === id);
    if (seq) seq.included = included;
  }

  // Chronological (oldest first) — the order clips play in the exported reel.
  list(): Sequence[] {
    return [...this.sequences];
  }

  // Fetch a clip's encoded video — from RAM when present (the no-IndexedDB fallback or the
  // live outro), else from the disk store. The export/preview muxer holds the payload only
  // for the one clip it's writing, so the heap never refills with every clip at once.
  async loadPayload(id: number): Promise<ClipPayload> {
    const seq = this.sequences.find((s) => s.id === id);
    if (seq?.chunks) return { chunks: seq.chunks, meta: seq.meta };
    const payload = await this.store?.get(id);
    if (payload) return payload;
    throw new Error(`clip ${id} payload unavailable`);
  }

  dispose(): void {
    this.session = null;
    this.activeTarget = null;
    if (this.encoder) {
      try {
        if (this.encoder.state !== 'closed') this.encoder.close();
      } catch {
        /* already closed */
      }
      this.encoder = null;
    }
    for (const seq of this.sequences) seq.thumb.close();
    this.sequences.length = 0;
    const store = this.store;
    this.store = null;
    void store
      ?.clearSession()
      .catch(() => {})
      .finally(() => store.close());
  }

  private countNonPinned(): number {
    return this.sequences.reduce((n, s) => n + (s.pinned ? 0 : 1), 0);
  }

  // Disposable = not kept (not starred). The star is the only protection; "clear" wipes the rest
  // (included or not). Same set the auto-capture cap counts.
  disposableCount(): number {
    return this.countNonPinned();
  }

  private drop(seq: Sequence): void {
    seq.thumb.close();
    void this.store?.delete(seq.id).catch(() => {}); // drop its disk record too
  }

  // Delete one clip outright (the per-clip trash). Frees a slot → auto-capture can resume.
  remove(id: number): void {
    const idx = this.sequences.findIndex((s) => s.id === id);
    if (idx < 0) return;
    this.drop(this.sequences[idx]);
    this.sequences.splice(idx, 1);
    void this.refreshUsage();
  }

  // Delete every clip that isn't kept (starred). Returns how many were removed.
  removeDisposable(): number {
    let removed = 0;
    for (let i = this.sequences.length - 1; i >= 0; i--) {
      const seq = this.sequences[i];
      if (!seq.pinned) {
        this.drop(seq);
        this.sequences.splice(i, 1); // reverse walk → splice doesn't skip the next element
        removed++;
      }
    }
    if (removed) void this.refreshUsage();
    return removed;
  }
}
