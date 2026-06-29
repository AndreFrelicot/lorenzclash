// Owns the camera MediaStream and a hidden <video> element that decodes frames
// for WebGPU to import or copy into persistent textures.
//
// Privacy: the stream stays on-device — no upload, no recording. Tracks are
// stopped whenever the camera is turned off.

function isAppleMobileCameraDevice(): boolean {
  return (
    /\b(iPhone|iPad|iPod)\b/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

function cameraConstraints(): MediaStreamConstraints {
  if (isAppleMobileCameraDevice()) {
    return {
      video: {
        // iOS WebKit's WebGPU copy path exposes a padded raw frame for wide/portrait
        // constraints. The app uses the camera as square material, so ask WebKit for
        // a centered square stream up front instead of fixing the framing after copy.
        facingMode: 'user',
        width: { ideal: 720 },
        height: { ideal: 720 },
        aspectRatio: { ideal: 1 },
      },
      audio: false,
    };
  }

  return {
    video: {
      // Front camera by default on mobile (the performer/face becomes the material);
      // 'user' is shorthand for { ideal: 'user' } so it falls back to the only webcam
      // on desktop. A front/back flip control can be added later.
      facingMode: 'user',
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio: false,
  };
}

export class CameraInput {
  private stream: MediaStream | null = null;
  private styledW = 0;
  private styledH = 0;

  private constructor(private readonly video: HTMLVideoElement) {}

  static async create(): Promise<CameraInput> {
    // A detached <video> may not decode on iOS, so keep it in the DOM but
    // visually hidden (display:none would stop decoding).
    const video = document.createElement('video');
    video.className = 'hidden-video';
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    document.body.appendChild(video);

    const camera = new CameraInput(video);
    await camera.start();
    return camera;
  }

  // (Re)acquire the stream and begin playback. Must be called from a user
  // gesture the first time (browser autoplay/permission policy).
  async start(): Promise<void> {
    if (this.stream) return;
    this.stream = await navigator.mediaDevices.getUserMedia(cameraConstraints());
    this.video.srcObject = this.stream;
    await this.video.play();
    this.logTrackSettings();
    this.syncElementSize();
  }

  // Stop the camera: release the hardware (tracks) and detach the stream.
  stop(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  // The video element once it has decodable frames, else null (caller renders
  // the synthetic fallback until the first frame is ready).
  get source(): HTMLVideoElement | null {
    if (!this.stream) return null;
    if (this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null;
    if (this.video.videoWidth === 0 || this.video.videoHeight === 0) return null;
    this.syncElementSize();
    return this.video;
  }

  private syncElementSize(): void {
    const w = this.video.videoWidth;
    const h = this.video.videoHeight;
    if (w <= 0 || h <= 0) return;
    if (w === this.styledW && h === this.styledH) return;
    this.styledW = w;
    this.styledH = h;
    this.video.style.width = `${w}px`;
    this.video.style.height = `${h}px`;
  }

  private logTrackSettings(): void {
    const track = this.stream?.getVideoTracks()[0];
    const settings = track?.getSettings();
    if (!settings) return;
    const parts = [
      settings.width && settings.height ? `${settings.width}x${settings.height}` : null,
      typeof settings.aspectRatio === 'number' ? `aspect=${settings.aspectRatio.toFixed(3)}` : null,
      settings.facingMode ? `facing=${settings.facingMode}` : null,
    ].filter(Boolean);
    if (parts.length > 0) console.info(`[camera] track ${parts.join(' ')}`);
  }

  destroy(): void {
    this.stop();
    this.video.remove();
  }
}
