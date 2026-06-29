// Exports recorded sequences as a single local .mp4.
//
// Video is already encoded live by SequenceRecorder, so here we only MUX the chunks:
// the clips are concatenated by re-basing each clip's timestamps so they play back-to-
// back. Audio is the REAL music that played during each clip — we re-decode the local
// track, slice each clip's window [startSec, +clipDuration], lay them end-to-end with
// short boundary fades (no clicks), encode AAC, and mux into the same file.
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { aacSupported } from './codec.ts';
import type { Sequence } from './SequenceRecorder.ts';
import type { ClipPayload } from './ClipStore.ts';

export interface ExportOptions {
  includeAudio: boolean;
  // 'per-clip': each clip carries the music that played during it (synced, with join
  // fades). 'continuous': one unbroken segment from the FIRST clip's track — no cuts.
  audioMode: 'per-clip' | 'continuous';
  // Consumed by App.generate (it appends a live-recorded QR end-card clip before the mux),
  // NOT by encodeSequences itself — by the time clips reach here the outro is just another
  // Sequence in the list. Kept on this shared options object so the type flows cleanly
  // ExportMenu → App → encodeSequences.
  endCard: boolean;
}

export interface ExportResult {
  blob: Blob;
  ext: 'mp4';
}

interface AudioSegment {
  data: Float32Array; // interleaved f32
  sampleRate: number;
  channels: number;
  frames: number;
}

const FADE_SEC = 0.01; // ~10 ms fade at each clip boundary → no join clicks

// 2-byte AAC-LC AudioSpecificConfig (object type 2 + sample-rate index + channel config).
// Some browsers don't expose this via the encoder metadata; the muxer needs it for esds.
function aacLcAsc(sampleRate: number, channels: number): Uint8Array {
  const rates = [
    96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350,
  ];
  const idx = rates.indexOf(sampleRate) < 0 ? 4 : rates.indexOf(sampleRate); // 44100 fallback
  const objectType = 2;
  return new Uint8Array([(objectType << 3) | (idx >> 1), ((idx & 1) << 7) | (channels << 3)]);
}

export async function encodeSequences(
  sequences: Sequence[],
  opts: ExportOptions,
  onProgress?: (p: number) => void,
  // Loads a clip's encoded chunks on demand (they live in IndexedDB, not on the Sequence).
  // Required for stored clips; clips that still carry their own chunks — the live outro, or
  // the no-IndexedDB fallback — are used directly without it.
  loadChunks?: (seq: Sequence) => Promise<ClipPayload>,
): Promise<ExportResult> {
  if (!sequences.length) throw new Error('No sequences to export');
  const width = sequences[0].width;
  const height = sequences[0].height;

  const audio =
    opts.includeAudio && (await aacSupported())
      ? await buildAudio(sequences, opts.audioMode)
      : null;

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width, height, frameRate: 30 },
    audio: audio
      ? { codec: 'aac', numberOfChannels: audio.channels, sampleRate: audio.sampleRate }
      : undefined,
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });

  // Video: mux pre-encoded chunks, re-basing timestamps so the clips play in sequence.
  let tOffsetUs = 0;
  let metaWritten = false;
  for (const seq of sequences) {
    // One clip's chunks in RAM at a time (loaded from disk unless still carried in RAM).
    let payload: ClipPayload;
    if (seq.chunks) payload = { chunks: seq.chunks, meta: seq.meta };
    else if (loadChunks) payload = await loadChunks(seq);
    else throw new Error('clip chunks unavailable (no loader provided)');
    for (const chunk of payload.chunks) {
      muxer.addVideoChunk(
        chunk,
        metaWritten ? undefined : payload.meta,
        chunk.timestamp + tOffsetUs,
      );
      metaWritten = true;
    }
    tOffsetUs += seq.durationUs;
  }
  onProgress?.(audio ? 0.5 : 1);

  if (audio) {
    let failed: unknown = null;
    // Always feed mp4-muxer a valid AAC AudioSpecificConfig. Mobile AudioEncoders often
    // omit decoderConfig.description, and mp4-muxer then writes a bogus esds (object type
    // 0 / 0 channels → undecodable, no sound). Synthesizing it ourselves is reliable.
    const audioMeta: EncodedAudioChunkMetadata = {
      decoderConfig: {
        codec: 'mp4a.40.2',
        sampleRate: audio.sampleRate,
        numberOfChannels: audio.channels,
        description: aacLcAsc(audio.sampleRate, audio.channels),
      },
    };
    const encoder = new AudioEncoder({
      output: (chunk) => muxer.addAudioChunk(chunk, audioMeta),
      error: (e) => {
        failed = e;
      },
    });
    encoder.configure({
      codec: 'mp4a.40.2',
      sampleRate: audio.sampleRate,
      numberOfChannels: audio.channels,
      bitrate: 192_000,
    });
    const block = Math.floor(audio.sampleRate * 0.1); // ~100 ms per AudioData
    let off = 0;
    while (off < audio.frames && !failed) {
      const n = Math.min(block, audio.frames - off);
      const data = audio.data.slice(off * audio.channels, (off + n) * audio.channels);
      const ad = new AudioData({
        format: 'f32',
        sampleRate: audio.sampleRate,
        numberOfFrames: n,
        numberOfChannels: audio.channels,
        timestamp: Math.round((off / audio.sampleRate) * 1_000_000),
        data,
      });
      encoder.encode(ad);
      ad.close();
      off += n;
      onProgress?.(0.5 + (off / audio.frames) * 0.5);
    }
    await encoder.flush();
    encoder.close();
    if (failed) throw failed;
  }

  muxer.finalize();
  onProgress?.(1);
  return { blob: new Blob([muxer.target.buffer], { type: 'video/mp4' }), ext: 'mp4' };
}

// Decoded-track cache (single entry). Every preview tap AND the final generate decode the
// SAME local .m4a, and decoding a full track — these run up to ~8 min — is by far the
// heaviest step here. Keep the most-recently-decoded track so repeated previews/exports of
// the same music reuse it instead of re-fetching + re-decoding it from scratch. Only ONE
// entry on purpose: a decoded 8-min stereo track at 48 kHz f32 is ~180 MB, so holding
// several would OOM mobile Safari. The old buffer is dropped BEFORE decoding a different
// track (peak ≈ one track). A multi-track reel re-decodes at each track change — same cost
// as before, never worse. All decodes use the fixed 48 kHz below, so cached buffers stay
// rate-consistent across calls (and an AudioBuffer is readable independent of its context).
let cachedTrackSrc: string | null = null;
let cachedTrackBuf: AudioBuffer | null = null;

async function buildAudio(
  sequences: Sequence[],
  mode: 'per-clip' | 'continuous',
): Promise<AudioSegment | null> {
  // Decode-only context. Use an OfflineAudioContext, NOT a real-time AudioContext: we only
  // need decodeAudioData + a sample rate, never audio output. A real AudioContext grabs the
  // hardware audio session, and on iOS creating/closing one here — per preview tap AND per
  // export — suspends the LIVE music's AudioContext, killing all sound until a reload. An
  // OfflineAudioContext renders to a buffer and owns no output session, so it's inert.
  const ac = new OfflineAudioContext(2, 1, 48000);
  try {
    // Reuse the most-recently-decoded track across calls (see cache note above); drop the
    // old buffer before decoding a different one so we never hold two ~180 MB tracks.
    const decode = async (src: string): Promise<AudioBuffer | null> => {
      if (cachedTrackSrc === src && cachedTrackBuf) return cachedTrackBuf;
      cachedTrackSrc = null;
      cachedTrackBuf = null;
      try {
        const buf = await ac.decodeAudioData(await (await fetch(src)).arrayBuffer());
        cachedTrackSrc = src;
        cachedTrackBuf = buf;
        return buf;
      } catch {
        return null; // transient failure — not cached, so a later attempt retries
      }
    };
    const sr = ac.sampleRate;
    const channels = 2;
    const segFrames = sequences.map((s) => Math.round((s.durationUs / 1_000_000) * sr));
    const total = segFrames.reduce((a, b) => a + b, 0);
    if (total <= 0) return null;
    const out = new Float32Array(total * channels);

    // Write `n` output samples from `buf` starting at `startSamp`, advancing the read
    // position by the slow-mo warp at each step (warp < 1 → read slower = tape-stop, in
    // sync with the slowed video). `warps` is per-recorded-frame; mapped across `n` by
    // position. Linear interpolation of the (now fractional) read position. Fades at ends.
    const copy = (
      buf: AudioBuffer,
      startSamp: number,
      cursor: number,
      n: number,
      fadeIn: number,
      fadeOut: number,
      warps: Float32Array,
    ): void => {
      const nch = buf.numberOfChannels;
      const W = warps.length;
      for (let ch = 0; ch < channels; ch++) {
        const cd = buf.getChannelData(Math.min(ch, nch - 1));
        let pos = startSamp;
        for (let i = 0; i < n; i++) {
          const j = Math.floor(pos);
          let v = 0;
          if (j >= 0 && j < cd.length) {
            const a = cd[j];
            v = a + ((j + 1 < cd.length ? cd[j + 1] : a) - a) * (pos - j);
          }
          if (fadeIn > 0 && i < fadeIn) v *= i / fadeIn;
          const tail = n - i;
          if (fadeOut > 0 && tail < fadeOut) v *= tail / fadeOut;
          out[(cursor + i) * channels + ch] = v;
          pos += W > 0 ? warps[Math.min(W - 1, Math.floor((i * W) / n))] : 1;
        }
      }
    };

    if (mode === 'continuous') {
      // One unbroken segment from the first clip that has a track — no cuts. The whole
      // reel's warp timeline (clips concatenated) drives the resample.
      const anchorSeq = sequences.find((s) => s.audio?.trackSrc);
      if (!anchorSeq?.audio) return null;
      const buf = await decode(anchorSeq.audio.trackSrc);
      if (!buf) return null;
      const allLen = sequences.reduce((a, s) => a + s.warps.length, 0);
      const allWarps = new Float32Array(allLen);
      let o = 0;
      for (const s of sequences) {
        allWarps.set(s.warps, o);
        o += s.warps.length;
      }
      const start = Math.max(0, Math.floor(anchorSeq.audio.startSec * buf.sampleRate));
      copy(buf, start, 0, total, Math.floor(0.02 * sr), Math.floor(0.4 * sr), allWarps);
      return { data: out, sampleRate: sr, channels, frames: total };
    }

    // per-clip: each clip's real window laid end-to-end with short join fades.
    const join = Math.max(1, Math.floor(FADE_SEC * sr));
    let cursor = 0;
    let anyAudio = false;
    for (let si = 0; si < sequences.length; si++) {
      const n = segFrames[si];
      const anchor = sequences[si].audio;
      if (anchor?.trackSrc) {
        const buf = await decode(anchor.trackSrc);
        if (buf) {
          anyAudio = true;
          copy(
            buf,
            Math.max(0, Math.floor(anchor.startSec * buf.sampleRate)),
            cursor,
            n,
            join,
            join,
            sequences[si].warps,
          );
        }
      }
      cursor += n;
    }
    return anyAudio ? { data: out, sampleRate: sr, channels, frames: total } : null;
  } finally {
    // An OfflineAudioContext owns no hardware audio session to release (unlike a real
    // AudioContext, which is exactly why we use it here) — nothing to close; GC reclaims it.
  }
}
