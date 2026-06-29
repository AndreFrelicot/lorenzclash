// WebCodecs capability probes shared by the recorder (video) and the muxer (audio).

// A supported H.264 codec string for the given size, or null if the browser has
// WebCodecs but no H.264 encoder (e.g. some Linux Chromium) → the feature is disabled.
export async function pickAvcCodec(
  w: number,
  h: number,
  bitrate: number,
  fps: number,
): Promise<string | null> {
  if (typeof VideoEncoder === 'undefined') return null;
  // Level 4.0 (…0028) caps at 8192 macroblocks (~1920×1080). A large desktop/Retina
  // canvas clamped to a 1920 long edge can still exceed that (e.g. 1920×1200 = 9000 MB),
  // so fall through to higher levels (5.0/5.1/5.2) — desktop encoders support them. Small
  // frames (mobile) still pick level 4.0 first.
  const candidates = [
    'avc1.640028', // High 4.0
    'avc1.4d0028', // Main 4.0
    'avc1.42e01f', // Baseline 3.1
    'avc1.42001f',
    'avc1.640032', // High 5.0
    'avc1.640033', // High 5.1
    'avc1.640034', // High 5.2
  ];
  for (const codec of candidates) {
    try {
      const r = await VideoEncoder.isConfigSupported({
        codec,
        width: w,
        height: h,
        bitrate,
        framerate: fps,
      });
      if (r.supported) return codec;
    } catch {
      /* try next */
    }
  }
  return null;
}

// AAC encoding exists on Chrome/Safari but not Firefox — probe before muxing audio.
export async function aacSupported(): Promise<boolean> {
  if (typeof AudioEncoder === 'undefined') return false;
  try {
    const r = await AudioEncoder.isConfigSupported({
      codec: 'mp4a.40.2',
      sampleRate: 48_000,
      numberOfChannels: 2,
      bitrate: 192_000,
    });
    return !!r.supported;
  } catch {
    return false;
  }
}
