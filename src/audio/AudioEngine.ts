// Music playback + real-time analysis. One prerecorded track streams through an
// <audio> element into the Web Audio graph; an AnalyserNode runs the FFT, and
// analyse() distils the spectrum into a few smoothed, artist-friendly features
// (overall level, bass/mid/treble, spectral centroid, and an onset "beat" pulse)
// that drive the visuals.
//
// Graph: <audio> → MediaElementSource → Analyser → Compressor (limiter) →
// masterGain → destination. The limiter + a modest master gain keep it from ever
// being harsh.
import { TRACKS, type Track } from './tracks.ts';

export interface AudioFeatures {
  level: number; // 0..1 overall loudness (time-domain RMS, smoothed)
  bass: number; // 0..1 low-band energy
  mid: number; // 0..1 mid-band energy
  treble: number; // 0..1 high-band energy
  centroid: number; // 0..1 spectral centroid (where the energy sits → "brightness")
  beat: number; // 0..1 onset pulse: fast attack on a bass transient, slow decay
}

export interface AudioEngineOptions {
  initialTrackSrc?: string;
}

export const SILENT_FEATURES: AudioFeatures = {
  level: 0,
  bass: 0,
  mid: 0,
  treble: 0,
  centroid: 0,
  beat: 0,
};

// Dev: log the live feature ranges to the console (~1 line/sec) for calibration.
// Flip to true to re-log when retuning the colour/audio mapping.
const LOG_FEATURES = false;

const FFT_SIZE = 2048;
const MASTER_GAIN = 0.85;
const FADE = 0.25; // seconds — gain fade in/out, avoids clicks
// Slow-mo: the fader's warp is applied as a decoded-buffer playbackRate (resampling
// → pitch drops = tape-stop), NOT the <audio> element's rate — iOS breaks the audio
// pipeline when a routed media element's playbackRate changes. Engage the buffer
// source once the warp dips below SLOW_ENGAGE; above it, normal streaming plays.
const SLOW_ENGAGE = 0.99;
const SLOW_RATE_MIN = 0.1; // safety floor for the source rate
const SLOW_FADE = 0.03; // seconds — crossfade between the stream and the slow source

// Band edges in Hz (resolved to bin indices once the sample rate is known).
const BASS_HZ = [20, 200];
const MID_HZ = [200, 2000];
const TREBLE_HZ = [2000, 8000];
// Spectral-centroid range, mapped log → 0..1.
const CENTROID_LO_HZ = 100;
const CENTROID_HI_HZ = 6000;
// Offline calibration showed the centroid mostly lives in a narrow, high-biased
// slice of that mapped range, so the raw value barely moves the palette. Stretch
// the working band to the full 0..1 so hue follows the music's brightness.
const CENTROID_NORM_LO = 0.55;
const CENTROID_NORM_HI = 0.92;
// Per-band divisors that map LINEAR band energy to ~0..1. The byte/dB bands
// saturate; linear energy is dynamic but tiny, so divide by the library's
// offline-calibrated high range to recover a lively 0..1.
const BAND_NORM_BASS = 0.04;
const BAND_NORM_MID = 0.006;
const BAND_NORM_TREBLE = 0.0025;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private el: HTMLAudioElement | null = null;
  private analyser: AnalyserNode | null = null;
  private master: GainNode | null = null;
  private elementGain: GainNode | null = null; // streamed <audio> level (crossfade)
  private slowGain: GainNode | null = null; // slow-mo buffer-source level (crossfade)

  private timeBuf = new Uint8Array(0);
  private floatBuf = new Float32Array(0); // dB spectrum (linear-converted for the bands + centroid)

  // Resolved bin ranges (set when the graph is built and the sample rate is known).
  private bass: [number, number] = [1, 8];
  private mid: [number, number] = [8, 90];
  private treble: [number, number] = [90, 370];
  private binHz = 21.5;

  // Smoothed feature state (carried between analyse() calls).
  private readonly f: AudioFeatures = { ...SILENT_FEATURES };
  private bassAvg = 0; // slow running average of bass, for onset detection

  private index = 0;
  private enabled = false;
  private muted = false;

  // Slow-mo via a decoded AudioBufferSource (works on iOS, unlike the element rate).
  // Once engaged, the buffer source takes over playback for the REST of the track:
  // returning to normal speed is just rate → 1, never a seek + resume of the <audio>
  // element (which re-buffers / cuts the sound on iOS). The element resumes only on
  // the next track load. The track is decoded ahead (on load) so the fader is instant.
  private slowBuffer: AudioBuffer | null = null; // current track decoded (stereo)
  private slowBufferIndex = -1; // which track index slowBuffer holds
  private slowSource: AudioBufferSourceNode | null = null;
  private slowEngaged = false; // buffer source active for this track
  private slowDecoding = false;
  private lastWarp = 1; // latest warp (so a source starts at the right rate)
  private slowPositionSec = 0; // virtual track time while the buffer source owns playback
  private slowLastCtxTime = 0; // AudioContext clock used to integrate slowPositionSec

  // Shuffle bag: a randomised order played in full before reshuffling, so every
  // track plays once per cycle and the same one never repeats back-to-back.
  private order: number[] = [];
  private pos = 0;
  // Called when a track ENDS and auto-advances (so the UI can update its label).
  onTrackChange: ((name: string) => void) | null = null;

  // Running feature stats for the calibration log (see LOG_FEATURES).
  private readonly dbg = { n: 0, cMin: 1, cMax: 0, cSum: 0, lMax: 0, bMax: 0, tMax: 0, beatMax: 0 };

  constructor(
    private readonly tracks: Track[] = TRACKS,
    opts: AudioEngineOptions = {},
  ) {
    this.reshuffle(-1); // initial random order → random startup track
    const initialIndex = opts.initialTrackSrc
      ? this.tracks.findIndex((track) => track.src === opts.initialTrackSrc)
      : -1;
    if (initialIndex >= 0) {
      const orderIndex = this.order.indexOf(initialIndex);
      if (orderIndex > 0)
        [this.order[0], this.order[orderIndex]] = [this.order[orderIndex], this.order[0]];
    }
    this.index = this.order[0] ?? 0;
  }

  get trackName(): string {
    return this.tracks[this.index]?.name ?? '';
  }

  // File URL of the track currently playing — for the video export, which re-fetches
  // and decodes the same local .m4a to lay a continuous audio segment under the clip.
  get currentTrackSrc(): string {
    return this.tracks[this.index]?.src ?? '';
  }

  // Playback position (seconds) of the current track. Normally this is the media
  // element's currentTime; after slow-mo engages, the decoded buffer source owns
  // playback for the rest of the track, so we integrate its playbackRate manually.
  // The offline director and export audio anchors both rely on this staying
  // monotonic even while the element itself is paused.
  get positionSec(): number {
    this.updateSlowPosition();
    return this.slowSource ? this.slowPositionSec : (this.el?.currentTime ?? 0);
  }

  // Build a fresh shuffled order (Fisher-Yates), keeping `avoid` out of the first
  // slot so the just-played track doesn't repeat across the cycle boundary.
  private reshuffle(avoid: number): void {
    const n = this.tracks.length;
    const order = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    if (n > 1 && order[0] === avoid) [order[0], order[1]] = [order[1], order[0]];
    this.order = order;
    this.pos = 0;
  }

  // Move to the next track in the bag; reshuffle (avoiding an immediate repeat)
  // once the whole bag has played.
  private advance(): void {
    this.pos++;
    if (this.pos >= this.order.length) this.reshuffle(this.index);
    this.index = this.order[this.pos] ?? 0;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  // Build the audio graph on first use (must run from a user gesture so the
  // AudioContext is allowed to start), then load + play the current track. The
  // track keeps playing + analysing even when muted (gain 0) — that's the point of
  // the mute mode: the FFT drives the visuals while no sound is emitted.
  async enable(): Promise<void> {
    this.ensureGraph();
    const ctx = this.ctx!;
    if (ctx.state === 'suspended') await ctx.resume();
    this.enabled = true;
    await this.load(this.tracks[this.index]?.src);
    this.fadeTo(this.muted ? 0 : MASTER_GAIN);
  }

  // Mute = keep playing/analysing, only drop the output gain. The AnalyserNode taps
  // the graph BEFORE the gain, so analysis (and the visuals) are unaffected.
  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.enabled) this.fadeTo(muted ? 0 : MASTER_GAIN);
  }

  // Bring the AudioContext back if it was suspended out from under us. iOS suspends the
  // WebAudio context whenever a <video>/<audio> element plays (the export previews) or
  // another AudioContext is created — and setMuted only changes gain, so it can't undo a
  // suspend. Callers invoke this whenever playback should be live again (export dialog
  // close, tab re-focus). No-op unless enabled and actually suspended.
  async resume(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        // iOS can reject resume() when backgrounded / outside a gesture — ignore.
      }
    }
    // iOS doesn't just suspend the context in the background — it also PAUSES the <audio>
    // element, and resuming the context alone leaves it paused (so the music stays silent and
    // setMuted, which only changes gain, can't revive it). Restart element playback too — unless
    // slow-mo's decoded buffer source currently owns playback (it resumes with the context).
    if (!this.slowEngaged && this.el && this.el.src && this.el.paused) {
      try {
        await this.el.play();
      } catch {
        // play() is gesture-gated on iOS too — the next tap (resumeAudioOnGesture) retries.
      }
    }
  }

  // Slow-mo, called every frame with the eased warp (1 = normal, down to ~0.35).
  // The first time the warp dips below SLOW_ENGAGE we switch playback to a decoded
  // AudioBufferSource at that rate (resampling → pitch drops = tape-stop) instead of
  // the <audio> element, whose playbackRate iOS breaks when routed through Web Audio.
  // The source then OWNS playback for the rest of the track: when the warp returns to
  // 1 we just set the rate back to 1 — we never seek + resume the element (that cuts
  // the sound on iOS). The element resumes only on the next track load. The AnalyserNode
  // taps the slow source too, so the audio-reactive visuals follow. No-op if audio off.
  setWarp(warp: number): void {
    if (!this.ctx || !this.enabled) return;
    this.updateSlowPosition();
    this.lastWarp = warp;
    if (warp < SLOW_ENGAGE && !this.slowEngaged) this.engageSlow();
    if (this.slowSource) this.slowSource.playbackRate.value = clamp(warp, SLOW_RATE_MIN, 1);
  }

  private engageSlow(): void {
    this.slowEngaged = true;
    // Start now if the buffer is ready; otherwise decode and start on completion
    // (ensureSlowBuffer starts the source itself when it finishes, so a rapid
    // toggle during an in-flight decode still recovers).
    if (this.slowBuffer && this.slowBufferIndex === this.index) this.startSlowSource();
    else void this.ensureSlowBuffer();
  }

  // Decode the current track to an AudioBuffer if not already cached (stereo ≈
  // 20 MB/min; one track at a time). Failure leaves the buffer null → the animation
  // still slows, just without the audio tape-stop. Starts the slow source on
  // completion if we engaged while it was decoding.
  private async ensureSlowBuffer(): Promise<void> {
    if (!this.ctx || this.slowDecoding) return;
    if (this.slowBuffer && this.slowBufferIndex === this.index) return;
    const wantIndex = this.index;
    const src = this.tracks[wantIndex]?.src;
    if (!src) return;
    this.slowDecoding = true;
    try {
      const data = await (await fetch(src)).arrayBuffer();
      this.slowBuffer = await this.ctx.decodeAudioData(data);
      this.slowBufferIndex = wantIndex;
      if (this.slowEngaged && !this.slowSource && this.index === wantIndex) this.startSlowSource();
    } catch (err) {
      console.warn('[lorenz] slow-mo decode failed', err);
    } finally {
      this.slowDecoding = false;
    }
  }

  private startSlowSource(): void {
    if (!this.ctx || !this.el || !this.slowBuffer || !this.slowGain || !this.elementGain) return;
    if (this.slowSource) return;
    const offset = this.el.currentTime;
    this.el.pause(); // the buffer source now owns playback until the track ends
    const node = this.ctx.createBufferSource();
    node.buffer = this.slowBuffer;
    node.connect(this.slowGain);
    node.onended = this.onSlowSourceEnded;
    // Start at the current warp, not 1 — the fader may already be pulled when an
    // async decode finishes, so starting at 1 would blip to full pitch for a frame.
    node.playbackRate.value = clamp(this.lastWarp, SLOW_RATE_MIN, 1);
    this.slowPositionSec = offset;
    this.slowLastCtxTime = this.ctx.currentTime;
    node.start(0, offset);
    this.slowSource = node;
    // Crossfade element → slow source (element is paused, so just drop its gain).
    this.elementGain.gain.value = 0;
    this.rampGain(this.slowGain, 1);
  }

  // Hard teardown of the slow source (track change / disable / destroy) — no fade,
  // we're cutting. Restores normal routing.
  private stopSlowSource(): void {
    this.slowEngaged = false;
    const node = this.slowSource;
    this.slowSource = null;
    if (node) {
      node.onended = null;
      try {
        node.stop();
      } catch {
        /* already stopped */
      }
      node.disconnect();
    }
    if (this.elementGain) this.elementGain.gain.value = 1;
    if (this.slowGain) this.slowGain.gain.value = 0;
    this.slowPositionSec = 0;
    this.slowLastCtxTime = 0;
  }

  private updateSlowPosition(): void {
    if (!this.ctx || !this.slowSource || !this.slowBuffer) return;
    const now = this.ctx.currentTime;
    if (this.slowLastCtxTime <= 0) {
      this.slowLastCtxTime = now;
      return;
    }
    const dt = Math.max(0, now - this.slowLastCtxTime);
    this.slowLastCtxTime = now;
    const rate = clamp(this.slowSource.playbackRate.value, SLOW_RATE_MIN, 1);
    this.slowPositionSec = Math.min(this.slowBuffer.duration, this.slowPositionSec + dt * rate);
  }

  // The slow source reached the end of the track while slowed → behave like the
  // element's own onEnded: restore routing, advance the bag, stream the next track.
  private readonly onSlowSourceEnded = (): void => {
    if (!this.slowSource) return; // a manual stop() nulls slowSource first
    this.slowSource = null;
    this.slowEngaged = false;
    if (this.elementGain) this.elementGain.gain.value = 1;
    if (this.slowGain) this.slowGain.gain.value = 0;
    this.slowPositionSec = 0;
    this.slowLastCtxTime = 0;
    if (!this.enabled) return;
    this.advance();
    this.loadCurrentAfterAutoAdvance('slow-source-ended');
    this.onTrackChange?.(this.trackName);
  };

  private rampGain(node: GainNode, to: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const g = node.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(to, t + SLOW_FADE);
  }

  // Fade out and pause, keeping the graph + decoded element for a quick re-enable.
  disable(): void {
    this.enabled = false;
    this.stopSlowSource();
    this.slowBuffer = null; // reclaim the decoded buffer; re-decoded on next slow-mo
    this.slowBufferIndex = -1;
    this.fadeTo(0);
    this.el?.pause();
    // Beat/level shouldn't linger once muted.
    this.bassAvg = 0;
    this.f.beat = 0;
  }

  // Skip to the next track in the shuffle bag; plays immediately if enabled.
  async cycleTrack(): Promise<void> {
    this.advance();
    if (!this.enabled) return;
    try {
      await this.load(this.tracks[this.index]?.src);
    } catch (err) {
      console.warn('[lorenz] audio track change failed; continuing silently', err);
    }
  }

  // Read the current FFT and update the smoothed features. Returns silent
  // features when not running. Called once per rendered frame.
  analyse(): AudioFeatures {
    const analyser = this.analyser;
    if (!analyser || !this.enabled) return SILENT_FEATURES;

    analyser.getByteTimeDomainData(this.timeBuf);
    analyser.getFloatFrequencyData(this.floatBuf); // dB spectrum for the bands + centroid

    // Overall loudness from the time-domain RMS (a truer "volume" than summed bins).
    let sumSq = 0;
    for (let i = 0; i < this.timeBuf.length; i++) {
      const v = (this.timeBuf[i] - 128) / 128;
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / this.timeBuf.length);
    const level = clamp01(rms * 3.2); // typical music RMS ~0.1-0.3 → lift into range

    const bass = this.band(this.bass, BAND_NORM_BASS);
    const mid = this.band(this.mid, BAND_NORM_MID);
    const treble = this.band(this.treble, BAND_NORM_TREBLE);
    const centroid = this.spectralCentroid();

    // Onset/beat: a bass transient above its slow running average, with a fast
    // attack and a slow decay so a single kick reads as a clear pulse. The bass is
    // now linear (much more dynamic) so the flux gain is lower than before.
    this.bassAvg = this.bassAvg * 0.92 + bass * 0.08;
    const flux = Math.max(0, bass - this.bassAvg);
    const beatTarget = clamp01(flux * 3);
    this.f.beat = Math.max(this.f.beat * 0.86, beatTarget);

    // Smooth the magnitude features (centroid is positional → lighter smoothing).
    this.f.level = lerp(this.f.level, level, 0.25);
    this.f.bass = lerp(this.f.bass, bass, 0.25);
    this.f.mid = lerp(this.f.mid, mid, 0.25);
    this.f.treble = lerp(this.f.treble, treble, 0.25);
    this.f.centroid = lerp(this.f.centroid, centroid, 0.15);
    if (LOG_FEATURES) this.logFeatures();
    return this.f;
  }

  // Accumulate running min/max + average and print a compact line ~once a second.
  // The cumulative ranges let us calibrate the centroid→hue mapping + the amounts.
  private logFeatures(): void {
    const d = this.dbg;
    const f = this.f;
    d.n++;
    d.cMin = Math.min(d.cMin, f.centroid);
    d.cMax = Math.max(d.cMax, f.centroid);
    d.cSum += f.centroid;
    d.lMax = Math.max(d.lMax, f.level);
    d.bMax = Math.max(d.bMax, f.bass);
    d.tMax = Math.max(d.tMax, f.treble);
    d.beatMax = Math.max(d.beatMax, f.beat);
    if (d.n % 60 !== 0) return;
    const avg = d.cSum / d.n;
    console.log(
      `[audio:${this.trackName}] centroid=${f.centroid.toFixed(2)} [${d.cMin.toFixed(2)}..${d.cMax.toFixed(2)}] avg=${avg.toFixed(2)} | ` +
        `level=${f.level.toFixed(2)}(max ${d.lMax.toFixed(2)}) bass=${f.bass.toFixed(2)}(max ${d.bMax.toFixed(2)}) ` +
        `mid=${f.mid.toFixed(2)} treble=${f.treble.toFixed(2)}(max ${d.tMax.toFixed(2)}) beat=${f.beat.toFixed(2)}(max ${d.beatMax.toFixed(2)})`,
    );
  }

  // Track ended → advance the bag and play the next one (also in muted mode, since
  // it's still playing). Notify so the UI label follows.
  private readonly onEnded = (): void => {
    if (!this.enabled) return;
    this.advance();
    this.loadCurrentAfterAutoAdvance('element-ended');
    this.onTrackChange?.(this.trackName);
  };

  private loadCurrentAfterAutoAdvance(reason: string): void {
    void this.load(this.tracks[this.index]?.src).catch((err) => {
      console.warn(`[lorenz] audio auto-advance failed (${reason}); continuing silently`, err);
    });
  }

  destroy(): void {
    this.enabled = false;
    this.stopSlowSource();
    this.slowBuffer = null;
    this.el?.removeEventListener('ended', this.onEnded);
    this.el?.pause();
    if (this.el) this.el.src = '';
    void this.ctx?.close();
    this.ctx = null;
    this.analyser = null;
    this.master = null;
    this.elementGain = null;
    this.slowGain = null;
    this.el = null;
  }

  private ensureGraph(): void {
    if (this.ctx) return;
    const ctx = new AudioContext();
    const el = new Audio();
    el.crossOrigin = 'anonymous';
    el.preload = 'auto';
    // No loop: let it end so we auto-advance to the next track in the shuffle bag.
    el.addEventListener('ended', this.onEnded);

    const src = ctx.createMediaElementSource(el);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0.8;
    const compressor = ctx.createDynamicsCompressor(); // master limiter
    compressor.threshold.value = -10;
    compressor.knee.value = 6;
    compressor.ratio.value = 12;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;
    const master = ctx.createGain();
    master.gain.value = 0;
    // Two inputs sum into the analyser: the streamed element and the slow-mo buffer
    // source. Crossfading their gains hands playback between them without a click.
    const elementGain = ctx.createGain();
    const slowGain = ctx.createGain();
    slowGain.gain.value = 0;

    src.connect(elementGain);
    elementGain.connect(analyser);
    slowGain.connect(analyser);
    analyser.connect(compressor);
    compressor.connect(master);
    master.connect(ctx.destination);

    this.timeBuf = new Uint8Array(analyser.fftSize);
    this.floatBuf = new Float32Array(analyser.frequencyBinCount);
    this.binHz = ctx.sampleRate / FFT_SIZE;
    this.bass = this.binRange(BASS_HZ);
    this.mid = this.binRange(MID_HZ);
    this.treble = this.binRange(TREBLE_HZ);

    this.ctx = ctx;
    this.el = el;
    this.analyser = analyser;
    this.master = master;
    this.elementGain = elementGain;
    this.slowGain = slowGain;
  }

  private async load(src: string | undefined): Promise<void> {
    if (!this.el || !src) return;
    // Track changing: tear down any active slow-mo source and drop the stale buffer.
    this.stopSlowSource();
    if (this.slowBufferIndex !== this.index) {
      this.slowBuffer = null;
      this.slowBufferIndex = -1;
    }
    this.el.src = src;
    try {
      await this.el.play();
    } catch (err) {
      // Autoplay can still be blocked if enable() wasn't called from a gesture;
      // surface it to the caller's catch rather than throwing into the loop.
      throw err instanceof Error ? err : new Error(String(err));
    }
    // Decode the track ahead (one buffer at a time, freed above on change) so the
    // slow-mo fader is instant — no decode latency the first time it's pulled.
    void this.ensureSlowBuffer();
  }

  private fadeTo(value: number): void {
    if (!this.ctx || !this.master) return;
    this.master.gain.setTargetAtTime(value, this.ctx.currentTime, FADE);
  }

  // Mean LINEAR amplitude over a bin range, normalized by `div` → ~0..1. Linear
  // (dB → 10^(dB/20)), NOT the byte/dB spectrum — the byte bands compress dynamics
  // so a kick and silence both read ~0.9 and the grow never moves.
  private band(range: [number, number], div: number): number {
    let sum = 0;
    const [a, b] = range;
    for (let i = a; i < b; i++) {
      const db = this.floatBuf[i];
      if (db > -120) sum += Math.pow(10, db / 20);
    }
    return clamp01(sum / Math.max(1, b - a) / div);
  }

  // Spectral centroid (magnitude-weighted mean frequency), mapped log(100Hz..6kHz)
  // → 0..1. Computed from LINEAR amplitudes (dB → 10^(dB/20)), NOT the byte/dB
  // spectrum — the byte data compresses dynamics so the high-frequency noise floor
  // pulls the centroid to ~1.0 and it never moves. A noise gate drops quiet bins so
  // only prominent content counts → the centroid tracks the music's brightness.
  private spectralCentroid(): number {
    let weighted = 0;
    let total = 0;
    for (let i = 1; i < this.floatBuf.length; i++) {
      const db = this.floatBuf[i];
      if (db < -75) continue; // ignore the noise floor
      const amp = Math.pow(10, db / 20); // dB → linear amplitude
      weighted += i * this.binHz * amp;
      total += amp;
    }
    if (total < 1e-9) return 0;
    const hz = weighted / total;
    const t =
      (Math.log2(hz) - Math.log2(CENTROID_LO_HZ)) /
      (Math.log2(CENTROID_HI_HZ) - Math.log2(CENTROID_LO_HZ));
    // Stretch the music's working band to the full 0..1 so the hue actually moves.
    return clamp01((t - CENTROID_NORM_LO) / (CENTROID_NORM_HI - CENTROID_NORM_LO));
  }

  private binRange([lo, hi]: number[]): [number, number] {
    const a = Math.max(1, Math.floor(lo / this.binHz));
    const b = Math.min(this.floatBuf.length, Math.ceil(hi / this.binHz));
    return [a, Math.max(a + 1, b)];
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
