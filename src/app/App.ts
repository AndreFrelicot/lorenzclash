// Top-level application orchestrator. Owns the phase machine, the start/
// unsupported/error screens, the canvas sizing and the requestAnimationFrame
// loop, and drives the WebGPU renderer.
//
// Frame-ribbon Phase 2: on Start, create the WebGPU context and render the
// Lorenz history as an orbiting 3D ribbon of billboards, each textured with a
// captured camera frame from the ring buffer (age colour when the camera is
// off). Depth/opaque crispness is Phase 3; motion/audio arrive later.
import { type AppPhase, type StartOptions } from './AppState.ts';
import { detectFeatures } from './FeatureDetection.ts';
import { type CameraCaptureStats, WebGPUContext } from '../gpu/WebGPUContext.ts';
import { CameraInput } from '../camera/CameraInput.ts';
import { LorenzMapper } from '../lorenz/LorenzMapper.ts';
import { StillCycle } from '../effects/StillCycle.ts';
import { AudioEngine, SILENT_FEATURES } from '../audio/AudioEngine.ts';
import { ZoomControl } from '../input/ZoomControl.ts';
import { TouchInput } from '../input/TouchInput.ts';
import { SlowMo } from '../input/SlowMo.ts';
import { MarginFader } from '../ui/MarginFader.ts';
import { XYPad } from '../ui/XYPad.ts';
import { DebugDecomposer, type DebugLayer } from './DebugDecomposer.ts';
import {
  AutoDirector,
  TrackStructureDirector,
  type DirectedRenderPreset,
  type RenderPreset,
  type RhythmCue,
  type TrackDirectorUpdate,
  type TrackStructureAnalysis,
} from './AutoDirector.ts';
import { haptics } from '../haptics.ts';
import { mountStartScreen } from '../ui/StartScreen.ts';
import { mountLegend, type LegendHandle, type LegendPageId } from '../ui/LegendOverlay.ts';
import { mountUnsupportedScreen } from '../ui/UnsupportedScreen.ts';
import { mountErrorScreen } from '../ui/ErrorScreen.ts';
import { mountMinimalControls, type ControlsHandle } from '../ui/MinimalControls.ts';
import { mountUiShell, type UiShell } from '../ui/UiShell.ts';
import { mountSummon, type Summon } from '../ui/Summon.ts';
import { mountTuningPanel, type SliderSpec, type TuningHandle } from '../ui/TuningPanel.ts';
import { mountExportMenu, type ExportMenuHandle } from '../ui/ExportMenu.ts';
import { SequenceRecorder, type Sequence } from '../export/SequenceRecorder.ts';
import type { ClipPayload } from '../export/ClipStore.ts';
import { encodeSequences } from '../export/Mp4Encoder.ts';
import { buildQr, drawOutroOverlay } from '../export/OutroCard.ts';

// Curve-speed range driven by the XY pad — matches the Speed tuning sliders.
const SPEED_MIN = 0.1;
const SPEED_MAX = 4;

// Video export QR end card: where the QR points, and how long the outro clip runs.
const SHARE_URL = 'https://lorenzclash.andrefrelicot.dev/';
const OUTRO_SEC = 3.0;

// Total-pixel budget for the render canvas (~1920×1200). Phones fall under it (untouched);
// large tablets/desktops are scaled down to it so the GPU + the export encoder aren't asked
// to push 5 MP/frame. See resizeCanvas() — this is the device-adaptive cap that fixes the
// iPad framerate + memory-loss crash.
const MAX_RENDER_PIXELS = 2_304_000;

// Render frame-rate cap. 120 Hz displays (iPad Pro) otherwise run the camera-import + ring
// capture path ~90×/s, and WebKit doesn't reclaim those per-frame GPUExternalTexture/bindgroup
// resources fast enough → the GPU process creeps to OOM after a few minutes. 60 Hz phones
// already sat here (and don't crash). 60 fps is plenty smooth; the −1 absorbs rAF jitter.
const MIN_FRAME_MS = 1000 / 60 - 1;
const RHYTHM_ZOOM_START_SEC = 20;
const EXPOSURE_LIMIT_REFERENCE_SEC = 240;
const EXPOSURE_SHORT_PER_REFERENCE = 20;
const EXPOSURE_LONG_PER_REFERENCE = 3;

const trackStructureDirectorPromise = import('../audio/track-analysis.json').then(
  (module) => new TrackStructureDirector(module.default as unknown as TrackStructureAnalysis),
);

function hasTuneUrlFlag(): boolean {
  const query = new URLSearchParams(window.location.search);
  if (query.has('tune')) return true;
  const hash = window.location.hash.replace(/^#\??/, '');
  if (hash === 'tune') return true;
  return new URLSearchParams(hash).has('tune');
}

export class App {
  private phase: AppPhase = 'boot';

  private rafId: number | null = null;
  // Stars-only loop shown behind the Start screen (before the running loop).
  private bootRafId: number | null = null;
  private bootStart = 0;
  private lastTime = 0;
  private unmountScreen: (() => void) | null = null;
  private legend: LegendHandle | null = null;

  private gpu: WebGPUContext | null = null;
  private deviceLostRetried = false; // re-entrancy guard: a loss during an in-flight recovery
  private lastRecoverMs = 0; // performance.now() of the last successful GPU recovery (storm guard)

  private camera: CameraInput | null = null;
  private cameraOn = false;
  private cameraBusy = false;
  // Procedural synthetic source: feeds the ring/HD pool when the camera is off (so the
  // scene is never dead). It's camera XOR synthetic — useSynthetic = !cameraOn,
  // recomputed each frame; no separate toggle.
  private useSynthetic = false;
  // Split source mode: curve A keeps the live camera, curve B is fed by the synthetic
  // source. Only takes effect while the camera is on (camera-off, both are synthetic).
  private splitOn = false;
  // In split mode, alternate each background still between the camera and the synth so
  // the flash montage shows both materials. Flipped per captured still.
  private splitStillToggle = false;

  private zoom: ZoomControl | null = null;
  private readonly slowmo = new SlowMo();
  private slowmoBuzzed = false; // edge guard: one haptic tap per slow-mo engagement
  private marginFader: MarginFader | null = null;
  // XY pad (desktop/touch): X → curve A speed, Y (up = fast) → curve B speed.
  private xypad: XYPad | null = null;
  // Slow-mo warp (1 = normal, down to ~0.35): scales the animation scroll + the
  // particle deposit rate so the visuals slow in phase with the pitched-down music.
  private warp = 1;

  private audio: AudioEngine | null = null;
  private audioBusy = false;

  // Auto director: switches camera/shape on musical section changes. On by
  // default so the app opens already navigating (inert until the audio engine is
  // running — gated by autoOn && this.audio?.isEnabled in update()).
  private autoOn = true;
  private autoStructureOn = true;
  private readonly autoDirector = new AutoDirector();
  private trackStructureDirector: TrackStructureDirector | null = null;
  // Structure-mode micro direction: offline beat/snare/roll cues trigger optional
  // zoom pulses, rapid view jumps, and small accent effects. Disabled by switching
  // Structure off, or individually in Tune > Auto.
  private readonly rhythmAuto = {
    zoom: true,
    jumpCam: true,
    beatCuts: true,
    rollCuts: true,
    effects: true,
    gridWaves: true,
    zoomAmount: 0.18,
    beatCutChance: 0.18,
    rollCutChance: 0.82,
    gridWaveChance: 0.32,
  };
  private rhythmZoom = 1;
  private rhythmCutCooldown = 0;
  private rhythmRollUntil = 0;
  private gridWaveCooldown = 0;
  private readonly pixelRippleAuto = { enabled: true, chance: 0.32, rate: 0.04 };
  private pixelRippleCooldown = 0;
  private pixelRippleCountdown = 6;
  private readonly exposureAuto = { shortDuration: 1.5, longDuration: 20 };
  private exposureTrackKey = '';
  private exposureTrackPosition = 0;
  private exposureShortMax = EXPOSURE_SHORT_PER_REFERENCE;
  private exposureLongMax = EXPOSURE_LONG_PER_REFERENCE;
  private exposureShortCount = 0;
  private exposureLongCount = 0;
  private exposureShortCooldown = 0;
  private exposureLongCooldown = 0;
  // CPU-side audio mappings (the shader-side ones live on gpu.audioParams).
  // sensitivity scales the raw features; speed = how much overall energy speeds up
  // the ribbon's scroll. audioSpeedMul is the resulting per-frame multiplier.
  private readonly audioMix = { sensitivity: 1.4, speed: 0.4 };
  private audioSpeedMul = 1;

  // Audio → Lorenz parameter modulation: the chaos breathes/intensifies with the
  // music. Amounts are tunable; the smoothed contributions ease toward the audio
  // targets and back to 0 in silence, clamped to stable ranges. This is
  // the central Lorenz-influence hook; pointer gestures add their contributions here.
  private readonly lorenzAudio = { rho: 8, sigma: 2, beta: 0.2, smooth: 0.06 };
  private readonly lorenzMod = { rho: 0, sigma: 0, beta: 0 };

  // Motion input → the same Lorenz hub. A deliberate pointer-drag (desktop/touch)
  // yields a normalized tilt; it is SMOOTHED into motionState (never raw → no jitter
  // to the params, per AGENTS.md) and added to the Lorenz parameters in applyInputs().
  // Optional — the artwork is fine without gestures. Amounts are tunable (Motion
  // group): tilt/twist gain, smoothing, and drag gain.
  private touch: TouchInput | null = null;
  private readonly motionState = { tiltX: 0, tiltY: 0, twist: 0 };
  private readonly motionMix = { tilt: 1, twist: 1, smooth: 0.08, drag: 0.0015 };

  private followMode = 0; // 0 = orbit, 1 = follow curve 1, 2 = follow curve 2
  // Follow mode to restore once the Frame fader is released (null = not previewing).
  // While previewing we force the free-orbit view so the margin change is visible.
  private marginPreviewFollow: number | null = null;
  private controls: ControlsHandle | null = null;
  private uiShell: UiShell | null = null;
  // Summon popovers (above the bar): transport = slow-mo + margin, pad = speed pad.
  private transportSummon: Summon | null = null;
  private padSummon: Summon | null = null;
  private transportPop: HTMLElement | null = null;
  private padPop: HTMLElement | null = null;
  private tuning: TuningHandle | null = null;

  // Debug / layer-decomposition mode (dev): pause + per-layer slideshow + ripple grid.
  private paused = false;
  private stepRequested = false;
  private debugSolo = false;
  private decomposer: DebugDecomposer | null = null;
  private debugLayers: DebugLayer[] = [];
  private debugCaptionEl: HTMLElement | null = null;

  private readonly lorenz = new LorenzMapper(256);
  private lorenz2: LorenzMapper | null = null; // second crossing curve
  private stills: StillCycle | null = null;
  // Local video export: live sequence recorder + the export menu.
  private recorder: SequenceRecorder | null = null;
  private exportMenu: ExportMenuHandle | null = null;
  private exporting = false; // pause recording while a clip encodes
  private exportDialogOpen = false; // pause auto-capture while the export dialog is open
  private pendingExportOpen = false; // user tapped Export mid-capture → open once it finishes
  private mutedForDialog = false; // we muted the (playing) music for the dialog
  private manualEndAt = 0; // performance.now() when the 5 s snapshot should stop (0 = none)

  // Lightweight field diagnostics (see startDiagnostics) — a remote console can't be polled,
  // so we print a periodic line and stamp it onto crash logs to reveal slow growth over time.
  private frameCount = 0;
  private diagPrevFrames = 0;
  private diagPrevMs = 0;
  private diagFps = 0;
  private diagTimer: number | null = null;
  private loggedGpuBreakdown = false;
  private diagPrevCameraStats: CameraCaptureStats | null = null;
  private diagCameraRates = ' imp/s=0 copy/s=0 depA/s=0 depB/s=0';

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly uiRoot: HTMLElement,
  ) {
    void trackStructureDirectorPromise
      .then((director) => {
        this.trackStructureDirector = director;
      })
      .catch((err) => {
        console.warn('[lorenz] track structure analysis unavailable; using classic Auto Director', err);
      });
  }

  async start(): Promise<void> {
    // start() is the single entry point and must run once.
    if (this.phase !== 'boot') return;

    window.addEventListener('resize', this.handleResize);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    // iOS suspends the AudioContext when backgrounded and only allows resume() INSIDE a user
    // gesture — so the resume() on visibilitychange (no gesture) is silently ignored and the
    // sound stays dead (toggling mute just changes gain on a suspended context). Resume on the
    // next tap instead; AudioEngine.resume() is a no-op unless actually suspended.
    window.addEventListener('pointerdown', this.resumeAudioOnGesture, true);
    this.resizeCanvas();
    this.startDiagnostics();

    const features = await detectFeatures();
    if (!features.webgpu) {
      this.setPhase('unsupported');
      this.unmountScreen = mountUnsupportedScreen(this.uiRoot);
      return;
    }

    // WebGPU needs no user gesture, so create the context now and run a
    // stars-only loop UNDER the Start screen (camera/audio still wait for the
    // Start tap). On Start, handleStart reuses this same context — no re-init.
    try {
      this.gpu = await WebGPUContext.create(this.canvas, this.lorenz.capacity, {
        onDeviceLost: (info) => void this.handleDeviceLost(info),
        onError: (e) => this.fail(`GPU error: ${e.message}`),
      });
    } catch (err) {
      console.error('WebGPU init failed:', err);
      this.fail(`Could not initialize WebGPU: ${describeError(err)}`);
      return;
    }

    this.setPhase('start-screen');
    // The in-app legend is mounted once on the UI root and shared by the start screen's
    // Help button and the in-experience Help button (so it survives into the running app).
    this.legend ??= mountLegend(this.uiRoot, { onUnlock: () => this.tuning?.reveal() });
    this.unmountScreen = mountStartScreen(
      this.uiRoot,
      this.gpu,
      (options, camera) => void this.handleStart(options, camera),
      (page) => this.legend?.open(page),
    );
    this.startBootLoop();
  }

  private async handleStart(
    options: StartOptions,
    preacquiredCamera: CameraInput | null = null,
  ): Promise<void> {
    this.unmountScreen?.();
    this.unmountScreen = null;
    // Re-measure now that the start screen is gone and layout is settled.
    this.resizeCanvas();

    // Music + FFT engine. iOS expires the Start tap's user-activation across the
    // GPU/camera awaits below, so kick off the AudioContext (resume + first play)
    // synchronously HERE, inside the gesture window, and await the result later.
    // Failure (e.g. blocked autoplay) stays silent.
    // Audio ALWAYS starts (load + play + analyse) so the visuals are always reactive;
    // options.audio only picks the initial output — sound (true) or muted (false). Both
    // states analyse. Kicked off in the gesture window (iOS needs it); failure stays silent.
    this.audio = new AudioEngine(undefined, { initialTrackSrc: options.initialTrackSrc });
    this.audio.onTrackChange = (name) => {
      this.controls?.setTrack(name);
      haptics.select(); // light tick when the track auto-advances
    };
    this.audio.setMuted(!options.audio); // muted start = analysed but silent
    // Resolve to a success flag with the catch attached synchronously, so a
    // rejected enable() (e.g. iOS blocking autoplay) can't surface as an
    // unhandled rejection during the GPU/camera awaits before we read it.
    const audioEnable: Promise<boolean> = this.audio
      .enable()
      .then(() => true)
      .catch((err) => {
        console.warn('[lorenz] audio could not start; continuing silently', err);
        return false;
      });

    // The context was already created at boot (for the Start-screen starfield);
    // reuse it so there's no re-init flash. Only create here as a fallback.
    if (!this.gpu) {
      try {
        this.gpu = await WebGPUContext.create(this.canvas, this.lorenz.capacity, {
          onDeviceLost: (info) => void this.handleDeviceLost(info),
          onError: (e) => this.fail(`GPU error: ${e.message}`),
        });
      } catch (err) {
        console.error('WebGPU init failed:', err);
        this.fail(`Could not initialize WebGPU: ${describeError(err)}`);
        return;
      }
    }

    // Camera is the primary visual material; fall back to synthetic if the user
    // declined it on the start screen or permission is refused. The start screen may
    // have already acquired it for the preview, so reuse that stream to avoid a
    // second getUserMedia prompt or visual flash.
    if (options.camera) {
      if (preacquiredCamera) {
        this.camera = preacquiredCamera;
        this.cameraOn = true;
      } else {
        try {
          this.camera = await CameraInput.create();
          this.cameraOn = true;
        } catch (err) {
          console.warn('[lorenz] camera unavailable; using synthetic texture', err);
          this.cameraOn = false;
        }
      }
    } else {
      // Camera disabled at Start: release any preview stream the start screen left open.
      preacquiredCamera?.destroy();
    }

    // Split on by default when the camera is live: curve A keeps the camera, curve B
    // shows the synthetic material → more variety / a richer opening style. (Split is
    // meaningless with the camera off, so it tracks cameraOn here.)
    this.splitOn = this.cameraOn;

    // Resolve the audio kickoff started at the top of this gesture (above), now
    // that the GPU exists. The AudioContext was already resumed in the gesture
    // window; here we only reflect whether analysis became live (it stays off on
    // failure — the app continues silently).
    if (await audioEnable) {
      this.gpu.audioParams.enabled = true;
    }

    // Pinch / wheel zoom (springs back to origin), also locks browser page zoom.
    this.zoom = new ZoomControl(this.canvas);

    // Vertical slow-mo fader (springs back): pull down to tape-stop the music +
    // animation together.
    // Summon popovers above the bar: transport (slow-mo + margin) and the speed pad.
    // Hidden by default; the bar's Slow-mo & margin / Speed-pad buttons pop them, and
    // they fade out after the interaction ends (ui/Summon.ts).
    const transportPop = document.createElement('div');
    transportPop.className = 'summon-pop summon-transport';
    const padPop = document.createElement('div');
    padPop.className = 'summon-pop summon-pad';
    this.uiRoot.append(transportPop, padPop);
    this.transportPop = transportPop;
    this.padPop = padPop;

    // Pointer-drag on the canvas → tilt contribution to the Lorenz hub; this is the
    // always-available motion control on desktop and touch devices.
    this.touch = new TouchInput(this.canvas);

    this.stopBootLoop();
    this.setPhase('running');
    this.startLoop();

    this.controls = mountMinimalControls(
      this.uiRoot,
      {
        camera: this.cameraOn,
        split: this.splitOn,
        follow: this.followMode,
        shape: 0,
        audioMode: this.audioUiMode(),
        trackName: this.audio?.trackName ?? '',
        auto: this.autoOn,
      },
      {
        onToggleCamera: (on) => void this.setCamera(on),
        onToggleSplit: (on) => {
          this.splitOn = on;
          this.controls?.setSplit(on); // keep the button's on/off state in sync
        },
        onCycleFollow: () => this.cycleFollow(),
        onCycleTrail: () => this.cycleTrail(),
        onCycleShape: () => this.cycleShape(),
        onCycleAudio: () => void this.toggleAudio(),
        onCycleTrack: () => void this.cycleTrack(),
        onToggleAuto: (on) => this.setAuto(on),
        onToggleTransport: () => {
          this.padSummon?.close();
          this.transportSummon?.toggle();
        },
        onTogglePad: () => {
          this.transportSummon?.close();
          this.padSummon?.toggle();
        },
        onSnapshot: () => this.startManualSnapshot(),
        onOpenExport: () => this.requestExportOpen(),
        onHelp: () => this.openHelp(),
      },
    );

    // Local video export: live-record each background "still sequence" as a clip, then
    // assemble selected clips into one mp4. Requires WebCodecs H.264 (probed in init);
    // if absent the Snapshot/Export buttons are no-ops.
    const recorder = new SequenceRecorder();
    if (this.gpu && (await recorder.init(this.gpu))) {
      this.recorder = recorder;
      this.exportMenu = mountExportMenu(this.uiRoot, {
        recorder,
        generate: async (sequences, opts, onProgress) => {
          this.exporting = true; // pause recording while encoding
          try {
            // QR end card: live-record a short outro and append it before the mux. The
            // outro records in real time (~0→0.25 of progress), then encoding takes 0.25→1.
            // Stored clips carry no chunks in RAM — the muxer loads each from disk on demand.
            const load = (s: Sequence): Promise<ClipPayload> => recorder.loadPayload(s.id);
            if (opts.endCard) {
              const outro = await this.buildOutro(sequences, (p) => onProgress(p * 0.25));
              const seqs = outro ? [...sequences, outro] : sequences;
              return await encodeSequences(seqs, opts, (p) => onProgress(0.25 + p * 0.75), load);
            }
            return await encodeSequences(sequences, opts, onProgress, load);
          } finally {
            this.exporting = false;
          }
        },
        // While the dialog is open: pause auto-capture and mute the live music (so the
        // card previews are audible on their own).
        onOpen: () => {
          this.exportDialogOpen = true;
          this.manualEndAt = 0;
          this.controls?.setSnapshotProgress(-1);
          // PAUSE the live WebGPU render while the dialog is open. On a GPU-tight device (iPad
          // Pro 2018) the render's per-frame allocations running UNDER the full-screen dialog —
          // while it composites + builds its rows — exhaust the GPU process and crash the loop
          // (beginRenderPass/createCommandEncoder fail). Pausing gives the dialog the whole GPU.
          // The dialog opens only AFTER any capture finishes (App.requestExportOpen), so nothing
          // is mid-record; video generation still works (its outro records via its own rAF).
          this.stopLoop();
          // Finalize any clip still recording so the list is complete + stable.
          if (this.recorder?.isRecording) {
            void this.recorder.endSequence().then(() => this.exportMenu?.refresh());
          }
          // Capture is paused while the dialog is up → free the 2nd WebGPU surface it used, so
          // the dialog's compositing has more GPU headroom (recreated on the next capture).
          this.gpu?.releaseCaptureSurface();
          if (this.audio && this.audio.isEnabled && !this.audio.isMuted) {
            this.audio.setMuted(true);
            this.mutedForDialog = true;
          }
        },
        onClose: () => {
          this.exportDialogOpen = false;
          // Resume the live render paused on open (unless the device was lost meanwhile).
          if (this.phase === 'running') this.startLoop();
          if (this.mutedForDialog) {
            this.audio?.setMuted(false);
            this.mutedForDialog = false;
          }
          // Preview playback / encoding may have suspended the live AudioContext on iOS —
          // setMuted only restores gain, so explicitly resume the context too.
          void this.audio?.resume();
        },
      });
    } else {
      // Snapshot + Export stay no-ops without the recorder. Most common cause: a
      // non-secure context (plain http over a LAN IP) where WebCodecs is unavailable —
      // load over https (the caddy proxy) or localhost. Also Firefox (no H.264 encode).
      console.warn(
        '[export] SequenceRecorder unavailable — Snapshot/Export disabled.',
        `secureContext=${window.isSecureContext}`,
        `VideoEncoder=${typeof VideoEncoder !== 'undefined'}`,
      );
    }

    // Dev tuning panel: curve speed/spacing + band width + follow-camera params.
    const gpu = this.gpu;
    // Auto-frame margin default (desktop + mobile). The Frame fader/slider tunes it.
    gpu.frameParams.margin = 0.55;
    // On-screen margin fader (left edge): tune the auto-frame tightness without the
    // Tune menu. Persistent; down = tighter. Mirrors the slow-mo fader on the right.
    this.marginFader = new MarginFader(
      transportPop,
      gpu.frameParams.margin,
      0.2,
      1.2,
      (v) => {
        gpu.frameParams.margin = v;
      },
      () => this.beginMarginPreview(),
      () => this.endMarginPreview(),
    );
    const fp = gpu.followParams;
    const lorenz = this.lorenz;
    const maxLen = Math.min(1024, gpu.maxLayers);
    this.stills = new StillCycle(gpu.hdPoolSize, gpu.fieldCount);
    // Second curve: same attractor, a different start phase → independent path.
    this.lorenz2 = new LorenzMapper(gpu.curve2Capacity, 0.05, undefined, [6, -4, 22]);

    // XY pad: drag to set curve speeds — X → A (this.lorenz), Y (up = fast) → B
    // (lorenz2). Persistent (knob stays where dropped); initialized from the
    // current speeds so the first touch doesn't jump.
    this.xypad = new XYPad(padPop, (x, y) => {
      this.lorenz.speed = SPEED_MIN + x * (SPEED_MAX - SPEED_MIN);
      if (this.lorenz2) this.lorenz2.speed = SPEED_MIN + (1 - y) * (SPEED_MAX - SPEED_MIN);
    });
    this.xypad.setNormalized(
      (this.lorenz.speed - SPEED_MIN) / (SPEED_MAX - SPEED_MIN),
      1 - ((this.lorenz2?.speed ?? 1) - SPEED_MIN) / (SPEED_MAX - SPEED_MIN),
    );

    // The summon controllers: the bar buttons open these; pointer activity inside
    // keeps them up, then they fade ~2s after the interaction ends.
    this.transportSummon = mountSummon(transportPop);
    this.padSummon = mountSummon(padPop);

    // Debug decomposition: the ordered layers (drawing order) the Décompose buttons
    // step through. Each just flips a gpu gate. Caption shows the current step.
    this.debugLayers = [
      { key: 'stars', label: 'Stars', set: (on) => (gpu.debugStars = on) },
      { key: 'still', label: 'HD still', set: (on) => (gpu.debugStill = on) },
      { key: 'grid', label: 'Grid', set: (on) => (gpu.gridParams.enabled = on) },
      { key: 'ribbonA', label: 'Ribbon A', set: (on) => (gpu.curve1Enabled = on) },
      { key: 'ribbonB', label: 'Ribbon B', set: (on) => (gpu.curve2Params.enabled = on) },
      { key: 'comet', label: 'Comets', set: (on) => (gpu.cometParams.enabled = on) },
      { key: 'particles', label: 'Tail particles', set: (on) => (gpu.particleParams.enabled = on) },
      { key: 'head', label: 'Head crest', set: (on) => (gpu.headParams.enabled = on) },
      { key: 'bloom', label: 'Bloom', set: (on) => (gpu.bloomParams.enabled = on) },
      { key: 'ripple', label: 'Ripple grid', set: (on) => this.setDebugRipple(on) },
    ];
    this.decomposer = new DebugDecomposer(this.debugLayers, (text) => this.setDebugCaption(text));
    // A 0/1 step-1 spec → the panel renders a checkbox.
    const bool = (label: string, get: () => boolean, set: (v: boolean) => void): SliderSpec => ({
      label,
      min: 0,
      max: 1,
      step: 1,
      get: () => (get() ? 1 : 0),
      set: (v) => set(v >= 0.5),
    });

    this.tuning = mountTuningPanel(this.uiRoot, [
      {
        // Dev: pause + per-layer decomposition + ripple grid, for article captures.
        title: 'Debug',
        collapsed: false,
        sliders: [
          {
            label: 'Black bg (UI only)',
            min: 0,
            max: 1,
            step: 1,
            get: () => (document.body.classList.contains('is-debug-blackout') ? 1 : 0),
            set: (v) => document.body.classList.toggle('is-debug-blackout', v >= 0.5),
          },
          bool(
            'Pause',
            () => this.paused,
            (v) => (this.paused = v),
          ),
          bool(
            'Solo layers',
            () => this.debugSolo,
            (v) => (this.debugSolo = v),
          ),
          bool(
            'Stars',
            () => gpu.debugStars,
            (v) => (gpu.debugStars = v),
          ),
          bool(
            'HD still',
            () => gpu.debugStill,
            (v) => (gpu.debugStill = v),
          ),
          bool(
            'Grid',
            () => gpu.gridParams.enabled,
            (v) => (gpu.gridParams.enabled = v),
          ),
          bool(
            'Ribbon A',
            () => gpu.curve1Enabled,
            (v) => (gpu.curve1Enabled = v),
          ),
          bool(
            'Ribbon B',
            () => gpu.curve2Params.enabled,
            (v) => (gpu.curve2Params.enabled = v),
          ),
          bool(
            'Comets',
            () => gpu.cometParams.enabled,
            (v) => (gpu.cometParams.enabled = v),
          ),
          bool(
            'Tail particles',
            () => gpu.particleParams.enabled,
            (v) => (gpu.particleParams.enabled = v),
          ),
          bool(
            'Head crest',
            () => gpu.headParams.enabled,
            (v) => (gpu.headParams.enabled = v),
          ),
          bool(
            'Bloom',
            () => gpu.bloomParams.enabled,
            (v) => (gpu.bloomParams.enabled = v),
          ),
          bool(
            'Ripple grid',
            () => gpu.debugRipple,
            (v) => this.setDebugRipple(v),
          ),
          bool(
            'Camera grade',
            () => gpu.cameraColorParams.enabled,
            (v) => (gpu.cameraColorParams.enabled = v),
          ),
          bool(
            'Reveal scrub',
            () => gpu.debugReveal >= 0,
            (v) => (gpu.debugReveal = v ? 0.5 : -1),
          ),
          {
            label: 'Reveal',
            min: 0,
            max: 1,
            step: 0.02,
            get: () => (gpu.debugReveal >= 0 ? gpu.debugReveal : 0),
            set: (v) => {
              if (gpu.debugReveal >= 0) gpu.debugReveal = v;
            },
          },
        ],
        buttons: [
          { label: 'Step', onClick: () => this.stepOnce() },
          { label: '◀ Back', onClick: () => this.decomposer?.prev(this.debugSolo) },
          { label: 'Décompose ▶', onClick: () => this.decomposer?.next(this.debugSolo) },
          { label: 'PNG', onClick: () => void this.captureDebugPng() },
          { label: 'Reset', onClick: () => this.debugReset() },
          { label: 'Source ▸', onClick: () => this.cycleDebugSource() },
          { label: 'Mask ▸', onClick: () => this.cycleDebugMask() },
          { label: 'Plane', onClick: () => gpu.startShapeMorph(0) },
          { label: 'Cube', onClick: () => gpu.startShapeMorph(1) },
          { label: 'Sphere', onClick: () => gpu.startShapeMorph(2) },
        ],
      },
      {
        title: 'Ribbon',
        sliders: [
          {
            label: 'Speed',
            min: 0.1,
            max: 4,
            step: 0.1,
            get: () => lorenz.speed,
            set: (v) => (lorenz.speed = v),
          },
          {
            label: 'Spacing',
            min: 0.01,
            max: 0.4,
            step: 0.005,
            get: () => lorenz.spacing,
            set: (v) => (lorenz.spacing = v),
          },
          {
            // Ribbon length: number of frame-cards kept along the curve.
            // Reallocates GPU buffers, so it commits on release (not mid-drag).
            // Capped at the device's texture-array layer limit (up to 1024).
            label: 'Length',
            min: 32,
            max: maxLen,
            step: 8,
            continuous: false,
            get: () => lorenz.capacity,
            set: (v) => {
              const cap = Math.min(maxLen, Math.max(32, Math.round(v)));
              lorenz.setCapacity(cap);
              gpu.setCapacity(cap);
            },
          },
          {
            label: 'Width',
            min: 0.2,
            max: 3,
            step: 0.05,
            get: () => gpu.bandParams.widthMult,
            set: (v) => (gpu.bandParams.widthMult = v),
          },
          {
            label: 'Mode',
            min: 0,
            max: 1,
            step: 1,
            get: () => gpu.bandParams.mode,
            set: (v) => (gpu.bandParams.mode = v),
          },
          {
            label: 'Rotation',
            min: 0,
            max: 3,
            step: 1,
            get: () => gpu.captureParams.rotation,
            set: (v) => (gpu.captureParams.rotation = v),
          },
          {
            // Source buffer orientation (1 = landscape, iOS/desktop; 0 = portrait,
            // Android). Unknowable from the API → calibrated here / on the start screen.
            label: 'Source',
            min: 0,
            max: 1,
            step: 1,
            get: () => (gpu.captureParams.sourceLandscape ? 1 : 0),
            set: (v) => (gpu.captureParams.sourceLandscape = v >= 0.5),
          },
        ],
      },
      {
        // Colour grade for the live camera (off by default). Baked at capture, so it
        // grades the ribbon, the HD still and the start-screen preview alike. The hue
        // can breathe off time + the Lorenz point + the audio centroid.
        title: 'Camera color',
        sliders: [
          {
            label: 'Enabled',
            min: 0,
            max: 1,
            step: 1,
            get: () => (gpu.cameraColorParams.enabled ? 1 : 0),
            set: (v) => (gpu.cameraColorParams.enabled = v >= 0.5),
          },
          {
            label: 'Hue', // base hue shift (turns)
            min: -0.5,
            max: 0.5,
            step: 0.01,
            get: () => gpu.cameraColorParams.hue,
            set: (v) => (gpu.cameraColorParams.hue = v),
          },
          {
            label: 'Drift', // hue breathing speed (turns/s)
            min: 0,
            max: 0.2,
            step: 0.005,
            get: () => gpu.cameraColorParams.hueDrift,
            set: (v) => (gpu.cameraColorParams.hueDrift = v),
          },
          {
            label: 'Hue Lrz', // Lorenz z → hue
            min: 0,
            max: 0.5,
            step: 0.02,
            get: () => gpu.cameraColorParams.hueLorenz,
            set: (v) => (gpu.cameraColorParams.hueLorenz = v),
          },
          {
            label: 'Hue Aud', // audio centroid → hue
            min: 0,
            max: 1,
            step: 0.05,
            get: () => gpu.cameraColorParams.hueAudio,
            set: (v) => (gpu.cameraColorParams.hueAudio = v),
          },
          {
            label: 'Saturation',
            min: 0,
            max: 2,
            step: 0.05,
            get: () => gpu.cameraColorParams.saturation,
            set: (v) => (gpu.cameraColorParams.saturation = v),
          },
          {
            label: 'Vibrance',
            min: 0,
            max: 1,
            step: 0.05,
            get: () => gpu.cameraColorParams.vibrance,
            set: (v) => (gpu.cameraColorParams.vibrance = v),
          },
          {
            label: 'Contrast',
            min: 0.5,
            max: 1.5,
            step: 0.02,
            get: () => gpu.cameraColorParams.contrast,
            set: (v) => (gpu.cameraColorParams.contrast = v),
          },
          {
            label: 'Exposure',
            min: 0.5,
            max: 1.5,
            step: 0.02,
            get: () => gpu.cameraColorParams.exposure,
            set: (v) => (gpu.cameraColorParams.exposure = v),
          },
          {
            label: 'Lift',
            min: -0.2,
            max: 0.2,
            step: 0.01,
            get: () => gpu.cameraColorParams.lift,
            set: (v) => (gpu.cameraColorParams.lift = v),
          },
        ],
      },
      {
        title: 'Shape',
        sliders: [
          {
            label: 'Size',
            min: 0.02,
            max: 0.5,
            step: 0.01,
            get: () => gpu.shapeParams.size,
            set: (v) => (gpu.shapeParams.size = v),
          },
          {
            label: 'Spin',
            min: 0,
            max: 3,
            step: 0.05,
            get: () => gpu.shapeParams.spin,
            set: (v) => (gpu.shapeParams.spin = v),
          },
        ],
      },
      {
        title: 'Morph',
        sliders: [
          {
            label: 'Durée',
            min: 0.2,
            max: 2.5,
            step: 0.1,
            get: () => gpu.morphParams.dur,
            set: (v) => (gpu.morphParams.dur = v),
          },
          {
            label: 'Bande',
            min: 0.02,
            max: 0.5,
            step: 0.01,
            get: () => gpu.morphParams.band,
            set: (v) => (gpu.morphParams.band = v),
          },
        ],
      },
      {
        // Traveling glow: a pulse that rides each curve head→tail, lighting + swelling
        // whatever it crosses. Timing (speed/gap) is random in-engine; these are looks.
        title: 'Sweep',
        sliders: [
          {
            label: 'Largeur',
            min: 0.02,
            max: 0.4,
            step: 0.01,
            get: () => gpu.sweepParams.width,
            set: (v) => (gpu.sweepParams.width = v),
          },
          {
            label: 'Glow',
            min: 0,
            max: 5,
            step: 0.1,
            get: () => gpu.sweepParams.glow,
            set: (v) => (gpu.sweepParams.glow = v),
          },
          {
            label: 'Scale',
            min: 0,
            max: 1,
            step: 0.05,
            get: () => gpu.sweepParams.scale,
            set: (v) => (gpu.sweepParams.scale = v),
          },
        ],
      },
      {
        // Comet: a sphere + cube streak head→tail along each curve, spiralling and
        // shedding a fading wake — periodic (random gap) or fired via "Lancer".
        title: 'Comète',
        sliders: [
          {
            label: 'On',
            min: 0,
            max: 1,
            step: 1,
            get: () => (gpu.cometParams.enabled ? 1 : 0),
            set: (v) => (gpu.cometParams.enabled = v >= 0.5),
          },
          {
            label: 'Period',
            min: 0.2,
            max: 3,
            step: 0.1,
            get: () => gpu.cometParams.period,
            set: (v) => (gpu.cometParams.period = v),
          },
          {
            label: 'Durée',
            min: 1,
            max: 20,
            step: 0.5,
            get: () => gpu.cometParams.duration,
            set: (v) => (gpu.cometParams.duration = v),
          },
          {
            label: 'Orbit',
            min: 0,
            max: 0.6,
            step: 0.01,
            get: () => gpu.cometParams.orbit,
            set: (v) => (gpu.cometParams.orbit = v),
          },
          {
            label: 'OrbitSpin',
            min: 0,
            max: 16,
            step: 0.5,
            get: () => gpu.cometParams.orbitSpeed,
            set: (v) => (gpu.cometParams.orbitSpeed = v),
          },
          {
            label: 'Spin',
            min: 0,
            max: 12,
            step: 0.5,
            get: () => gpu.cometParams.spin,
            set: (v) => (gpu.cometParams.spin = v),
          },
          {
            label: 'Size',
            min: 0.02,
            max: 0.4,
            step: 0.01,
            get: () => gpu.cometParams.size,
            set: (v) => (gpu.cometParams.size = v),
          },
          {
            // Wake = trailing tail-dissolution particles per deposit (0 = off). Their
            // life/dispersion/size/spin come from the Particules group's sliders.
            label: 'Wake',
            min: 0,
            max: 16,
            step: 1,
            get: () => gpu.cometParams.wake,
            set: (v) => (gpu.cometParams.wake = v),
          },
          {
            label: 'WakeSize',
            min: 0.005,
            max: 0.12,
            step: 0.005,
            get: () => gpu.cometParams.wakeSize,
            set: (v) => (gpu.cometParams.wakeSize = v),
          },
        ],
        buttons: [{ label: 'Lancer', haptic: 'medium', onClick: () => gpu.launchComet() }],
      },
      {
        // Deformation grid: the motion field made visible (gesture leans/swirls it).
        title: 'Grid',
        sliders: [
          {
            label: 'Show',
            min: 0,
            max: 1,
            step: 1,
            get: () => (gpu.gridParams.enabled ? 1 : 0),
            set: (v) => (gpu.gridParams.enabled = v >= 0.5),
          },
          {
            label: 'Opacity',
            min: 0,
            max: 1,
            step: 0.02,
            get: () => gpu.gridParams.opacity,
            set: (v) => (gpu.gridParams.opacity = v),
          },
          {
            label: 'Idle', // baseline ripple with no audio
            min: 0,
            max: 1,
            step: 0.02,
            get: () => gpu.gridParams.idle,
            set: (v) => (gpu.gridParams.idle = v),
          },
          {
            label: 'Height', // ripple amplitude
            min: 0,
            max: 1.2,
            step: 0.02,
            get: () => gpu.gridParams.height,
            set: (v) => (gpu.gridParams.height = v),
          },
          {
            label: 'Flow', // ripple animation speed
            min: 0,
            max: 0.6,
            step: 0.01,
            get: () => gpu.gridParams.flow,
            set: (v) => (gpu.gridParams.flow = v),
          },
          {
            label: 'Tilt', // gesture push → sheet lean
            min: 0,
            max: 0.6,
            step: 0.01,
            get: () => gpu.gridParams.tilt,
            set: (v) => (gpu.gridParams.tilt = v),
          },
          {
            label: 'Swirl', // gesture twist → centre swirl
            min: 0,
            max: 2,
            step: 0.05,
            get: () => gpu.gridParams.swirl,
            set: (v) => (gpu.gridParams.swirl = v),
          },
          {
            label: 'Rainbow',
            min: 0,
            max: 1,
            step: 1,
            get: () => (gpu.gridParams.rainbow ? 1 : 0),
            set: (v) => (gpu.gridParams.rainbow = v >= 0.5),
          },
          {
            label: 'RainDur',
            min: 0.8,
            max: 8,
            step: 0.2,
            get: () => gpu.gridParams.rainbowDuration,
            set: (v) => (gpu.gridParams.rainbowDuration = v),
          },
          {
            label: 'RainGlow',
            min: 0,
            max: 3,
            step: 0.05,
            get: () => gpu.gridParams.rainbowIntensity,
            set: (v) => (gpu.gridParams.rainbowIntensity = v),
          },
          {
            label: 'RainWaves',
            min: 1,
            max: 8,
            step: 1,
            get: () => gpu.gridParams.rainbowWaves,
            set: (v) => (gpu.gridParams.rainbowWaves = v),
          },
          {
            label: 'RainHeight',
            min: 0,
            max: 1,
            step: 0.02,
            get: () => gpu.gridParams.rainbowHeight,
            set: (v) => (gpu.gridParams.rainbowHeight = v),
          },
          {
            label: 'RainSpeed',
            min: 0.1,
            max: 3,
            step: 0.05,
            get: () => gpu.gridParams.rainbowSpeed,
            set: (v) => (gpu.gridParams.rainbowSpeed = v),
          },
          {
            label: 'RainSharp',
            min: 1,
            max: 28,
            step: 1,
            get: () => gpu.gridParams.rainbowSharpness,
            set: (v) => (gpu.gridParams.rainbowSharpness = v),
          },
          {
            label: 'RainHue',
            min: -3,
            max: 3,
            step: 0.05,
            get: () => gpu.gridParams.rainbowHueSpeed,
            set: (v) => (gpu.gridParams.rainbowHueSpeed = v),
          },
        ],
        buttons: [
          { label: 'Trigger rainbow', haptic: 'medium', onClick: () => this.triggerGridRainbow(1.2) },
        ],
      },
      {
        title: 'Particles',
        sliders: [
          {
            label: 'On',
            min: 0,
            max: 1,
            step: 1,
            get: () => (gpu.particleParams.enabled ? 1 : 0),
            set: (v) => (gpu.particleParams.enabled = v > 0.5),
          },
          {
            label: 'Drift',
            min: 0,
            max: 4,
            step: 0.1,
            get: () => gpu.particleParams.drift,
            set: (v) => (gpu.particleParams.drift = v),
          },
          {
            label: 'PSize',
            min: 0.01,
            max: 0.15,
            step: 0.005,
            get: () => gpu.particleParams.size,
            set: (v) => (gpu.particleParams.size = v),
          },
          {
            label: 'PSpin',
            min: 0,
            max: 4,
            step: 0.1,
            get: () => gpu.particleParams.spin,
            set: (v) => (gpu.particleParams.spin = v),
          },
          {
            label: 'PStart',
            min: 0.3,
            max: 0.95,
            step: 0.05,
            get: () => gpu.particleParams.start,
            set: (v) => (gpu.particleParams.start = v),
          },
        ],
      },
      {
        // Leading-edge crest: the 3 audio-reactive lines at the growing tip.
        title: 'Head',
        sliders: [
          {
            label: 'On',
            min: 0,
            max: 1,
            step: 1,
            get: () => (gpu.headParams.enabled ? 1 : 0),
            set: (v) => (gpu.headParams.enabled = v > 0.5),
          },
          {
            label: 'Size',
            min: 0.005,
            max: 0.06,
            step: 0.005,
            get: () => gpu.headParams.size,
            set: (v) => (gpu.headParams.size = v),
          },
          {
            label: 'Gap', // vertical spread of the top/bottom lines
            min: 0,
            max: 0.2,
            step: 0.01,
            get: () => gpu.headParams.gap,
            set: (v) => (gpu.headParams.gap = v),
          },
          {
            label: 'Recul', // how far the top/bottom lines sit behind the centre
            min: 0,
            max: 0.2,
            step: 0.01,
            get: () => gpu.headParams.recul,
            set: (v) => (gpu.headParams.recul = v),
          },
          {
            label: 'Reach', // shimmer/jitter amplitude (lifted by the music)
            min: 0,
            max: 0.2,
            step: 0.01,
            get: () => gpu.headParams.reach,
            set: (v) => (gpu.headParams.reach = v),
          },
        ],
      },
      {
        title: 'Display',
        sliders: [
          {
            label: 'Opacity',
            min: 0.1,
            max: 1,
            step: 0.05,
            get: () => gpu.displayParams.opacity,
            set: (v) => (gpu.displayParams.opacity = v),
          },
          {
            label: 'Glow',
            min: 0,
            max: 3,
            step: 0.05,
            get: () => gpu.displayParams.glow,
            set: (v) => (gpu.displayParams.glow = v),
          },
          {
            label: 'GlowStart',
            min: 0,
            max: 0.95,
            step: 0.05,
            get: () => gpu.displayParams.glowStart,
            set: (v) => (gpu.displayParams.glowStart = v),
          },
        ],
      },
      {
        // Screen-space bloom; Audio boosts the glow on the beat.
        title: 'Bloom',
        sliders: [
          {
            label: 'On',
            min: 0,
            max: 1,
            step: 1,
            get: () => (gpu.bloomParams.enabled ? 1 : 0),
            set: (v) => (gpu.bloomParams.enabled = v > 0.5),
          },
          {
            label: 'Threshold', // luminance above which pixels glow
            min: 0,
            max: 1,
            step: 0.05,
            get: () => gpu.bloomParams.threshold,
            set: (v) => (gpu.bloomParams.threshold = v),
          },
          {
            label: 'Intensity',
            min: 0,
            max: 2.5,
            step: 0.05,
            get: () => gpu.bloomParams.intensity,
            set: (v) => (gpu.bloomParams.intensity = v),
          },
          {
            label: 'Audio', // beat → extra glow
            min: 0,
            max: 2,
            step: 0.05,
            get: () => gpu.bloomParams.audio,
            set: (v) => (gpu.bloomParams.audio = v),
          },
          {
            label: 'ExpTrail',
            min: 0,
            max: 1,
            step: 1,
            get: () => (gpu.exposureTrailParams.enabled ? 1 : 0),
            set: (v) => (gpu.exposureTrailParams.enabled = v >= 0.5),
          },
          {
            label: 'ExpAmt',
            min: 0,
            max: 1,
            step: 0.02,
            get: () => gpu.exposureTrailParams.amount,
            set: (v) => (gpu.exposureTrailParams.amount = v),
          },
          {
            label: 'ExpDur',
            min: 0.5,
            max: 10,
            step: 0.1,
            get: () => gpu.exposureTrailParams.duration,
            set: (v) => (gpu.exposureTrailParams.duration = v),
          },
          {
            label: 'ExpDecay',
            min: 0.5,
            max: 0.99,
            step: 0.01,
            get: () => gpu.exposureTrailParams.decay,
            set: (v) => (gpu.exposureTrailParams.decay = v),
          },
          {
            label: 'ExpReplay',
            min: 0,
            max: 1,
            step: 0.01,
            get: () => gpu.getExposureTrailReplayPhase(),
            set: (v) => gpu.scrubExposureTrail(v),
          },
          {
            label: 'ExpLift',
            min: 0,
            max: 2,
            step: 0.05,
            get: () => gpu.exposureTrailParams.exposure,
            set: (v) => (gpu.exposureTrailParams.exposure = v),
          },
          {
            label: 'PixRipple',
            min: 0,
            max: 1,
            step: 1,
            get: () => (gpu.pixelRippleParams.enabled ? 1 : 0),
            set: (v) => (gpu.pixelRippleParams.enabled = v >= 0.5),
          },
          {
            label: 'PixAmt',
            min: 0,
            max: 0.12,
            step: 0.002,
            get: () => gpu.pixelRippleParams.amount,
            set: (v) => (gpu.pixelRippleParams.amount = v),
          },
          {
            label: 'PixAmtVar',
            min: 0,
            max: 0.08,
            step: 0.002,
            get: () => gpu.pixelRippleParams.amountVar,
            set: (v) => (gpu.pixelRippleParams.amountVar = v),
          },
          {
            label: 'PixDur',
            min: 0.5,
            max: 8,
            step: 0.1,
            get: () => gpu.pixelRippleParams.duration,
            set: (v) => (gpu.pixelRippleParams.duration = v),
          },
          {
            label: 'PixDurVar',
            min: 0,
            max: 4,
            step: 0.1,
            get: () => gpu.pixelRippleParams.durationVar,
            set: (v) => (gpu.pixelRippleParams.durationVar = v),
          },
          {
            label: 'PixFreq',
            min: 6,
            max: 48,
            step: 1,
            get: () => gpu.pixelRippleParams.frequency,
            set: (v) => (gpu.pixelRippleParams.frequency = v),
          },
          {
            label: 'PixFreqVar',
            min: 0,
            max: 30,
            step: 1,
            get: () => gpu.pixelRippleParams.frequencyVar,
            set: (v) => (gpu.pixelRippleParams.frequencyVar = v),
          },
          {
            label: 'PixSpeed',
            min: 0,
            max: 16,
            step: 0.5,
            get: () => gpu.pixelRippleParams.speed,
            set: (v) => (gpu.pixelRippleParams.speed = v),
          },
          {
            label: 'PixSpeedVar',
            min: 0,
            max: 8,
            step: 0.25,
            get: () => gpu.pixelRippleParams.speedVar,
            set: (v) => (gpu.pixelRippleParams.speedVar = v),
          },
          {
            label: 'SlowRipple',
            min: 0,
            max: 4,
            step: 0.05,
            get: () => gpu.pixelRippleParams.slowmo,
            set: (v) => (gpu.pixelRippleParams.slowmo = v),
          },
          {
            label: 'PixAuto',
            min: 0,
            max: 1,
            step: 1,
            get: () => (this.pixelRippleAuto.enabled ? 1 : 0),
            set: (v) => (this.pixelRippleAuto.enabled = v >= 0.5),
          },
          {
            label: 'PixChance',
            min: 0,
            max: 1,
            step: 0.05,
            get: () => this.pixelRippleAuto.chance,
            set: (v) => (this.pixelRippleAuto.chance = v),
          },
          {
            label: 'PixRate',
            min: 0,
            max: 0.2,
            step: 0.005,
            get: () => this.pixelRippleAuto.rate,
            set: (v) => {
              this.pixelRippleAuto.rate = v;
              this.resetPixelRippleCountdown();
            },
          },
          {
            label: 'FlashOn', // random camera-flash pops (threshold dip + intensity spike)
            min: 0,
            max: 1,
            step: 1,
            get: () => (gpu.bloomFlash.enabled ? 1 : 0),
            set: (v) => (gpu.bloomFlash.enabled = v > 0.5),
          },
          {
            label: 'FlashRate', // average flashes per second (Poisson)
            min: 0,
            max: 3,
            step: 0.1,
            get: () => gpu.bloomFlash.rate,
            set: (v) => (gpu.bloomFlash.rate = v),
          },
          {
            label: 'FlashDur', // peak width in seconds (~0.2-0.3 s)
            min: 0.05,
            max: 1,
            step: 0.05,
            get: () => gpu.bloomFlash.duration,
            set: (v) => (gpu.bloomFlash.duration = v),
          },
          {
            label: 'FlashDrop', // threshold dip at the peak
            min: 0,
            max: 0.55,
            step: 0.05,
            get: () => gpu.bloomFlash.drop,
            set: (v) => (gpu.bloomFlash.drop = v),
          },
          {
            label: 'FlashBoost', // extra intensity multiplier at the peak
            min: 0,
            max: 2.5,
            step: 0.05,
            get: () => gpu.bloomFlash.boost,
            set: (v) => (gpu.bloomFlash.boost = v),
          },
        ],
        buttons: [
          {
            label: 'Trigger exp short',
            haptic: 'medium',
            onClick: () => gpu.launchExposureTrail(1, this.exposureAuto.shortDuration),
          },
          {
            label: 'Trigger exp long',
            haptic: 'medium',
            onClick: () => gpu.launchExposureTrail(1, this.exposureAuto.longDuration),
          },
          { label: 'Trigger ripple', haptic: 'medium', onClick: () => gpu.launchPixelRipple(1.15) },
        ],
      },
      {
        // Audio reactivity: how strongly the music drives motion/size/speed.
        title: 'Audio',
        sliders: [
          {
            label: 'Sensitivity',
            min: 0.2,
            max: 4,
            step: 0.1,
            get: () => this.audioMix.sensitivity,
            set: (v) => (this.audioMix.sensitivity = v),
          },
          {
            label: 'Speed', // overall energy → ribbon scroll speed
            min: 0,
            max: 2,
            step: 0.05,
            get: () => this.audioMix.speed,
            set: (v) => (this.audioMix.speed = v),
          },
          {
            label: 'Grow', // bass/beat → ribbon width + shape/particle size
            min: 0,
            max: 2.5,
            step: 0.05,
            get: () => gpu.audioParams.grow,
            set: (v) => (gpu.audioParams.grow = v),
          },
          {
            label: 'Tint', // palette tint strength over the curve
            min: 0,
            max: 1,
            step: 0.05,
            get: () => gpu.audioParams.tint,
            set: (v) => (gpu.audioParams.tint = v),
          },
          {
            label: 'TailStart', // age where the tint band begins (0 = whole curve)
            min: 0,
            max: 1,
            step: 0.05,
            get: () => gpu.audioParams.tailStart,
            set: (v) => (gpu.audioParams.tailStart = v),
          },
          {
            label: 'TailEnd',
            min: 0,
            max: 1,
            step: 0.05,
            get: () => gpu.audioParams.tailEnd,
            set: (v) => (gpu.audioParams.tailEnd = v),
          },
        ],
      },
      {
        // Audio colour: the gradient palette + per-band colour/motion knobs.
        title: 'Audio Color',
        sliders: [
          {
            label: 'Palette',
            min: 0,
            max: 2,
            step: 1,
            get: () => gpu.audioParams.palette,
            set: (v) => (gpu.audioParams.palette = v),
          },
          {
            label: 'HueShift', // base hue offset of the palette
            min: 0,
            max: 1,
            step: 0.02,
            get: () => gpu.audioParams.hueShift,
            set: (v) => (gpu.audioParams.hueShift = v),
          },
          {
            label: 'HueRange', // how far the centroid travels the palette
            min: 0,
            max: 1.5,
            step: 0.05,
            get: () => gpu.audioParams.hueRange,
            set: (v) => (gpu.audioParams.hueRange = v),
          },
          {
            label: 'Edge', // width of the edge tint on ribbon/shape borders
            min: 0.02,
            max: 0.5,
            step: 0.02,
            get: () => gpu.audioParams.edge,
            set: (v) => (gpu.audioParams.edge = v),
          },
          {
            label: 'Spin', // treble → shape/particle shimmer spin
            min: 0,
            max: 2,
            step: 0.05,
            get: () => gpu.audioParams.spin,
            set: (v) => (gpu.audioParams.spin = v),
          },
          {
            label: 'PartTint', // dissolution-particle tint strength
            min: 0,
            max: 1,
            step: 0.05,
            get: () => gpu.audioParams.partTint,
            set: (v) => (gpu.audioParams.partTint = v),
          },
          {
            label: 'PartHue', // dissolution-particle hue offset
            min: 0,
            max: 1,
            step: 0.02,
            get: () => gpu.audioParams.partHueShift,
            set: (v) => (gpu.audioParams.partHueShift = v),
          },
          {
            label: 'PartGrow', // beat/bass → particle scale pop + drift
            min: 0,
            max: 2.5,
            step: 0.05,
            get: () => gpu.audioParams.partGrow,
            set: (v) => (gpu.audioParams.partGrow = v),
          },
        ],
      },
      {
        // Audio → Lorenz parameter modulation (the chaos breathes with the music).
        title: 'Lorenz',
        sliders: [
          {
            label: 'Rho', // energy/beat → rho (chaos intensity, the headline effect)
            min: 0,
            max: 14,
            step: 0.5,
            get: () => this.lorenzAudio.rho,
            set: (v) => (this.lorenzAudio.rho = v),
          },
          {
            label: 'Sigma', // treble → sigma
            min: 0,
            max: 6,
            step: 0.5,
            get: () => this.lorenzAudio.sigma,
            set: (v) => (this.lorenzAudio.sigma = v),
          },
          {
            label: 'Beta', // beat → beta
            min: 0,
            max: 0.7,
            step: 0.05,
            get: () => this.lorenzAudio.beta,
            set: (v) => (this.lorenzAudio.beta = v),
          },
          {
            label: 'Smooth', // how slowly the params follow the audio
            min: 0.01,
            max: 0.3,
            step: 0.01,
            get: () => this.lorenzAudio.smooth,
            set: (v) => (this.lorenzAudio.smooth = v),
          },
        ],
      },
      {
        // Motion input → Lorenz hub: pointer-drag (desktop/touch).
        title: 'Motion',
        sliders: [
          {
            label: 'TiltGain', // tiltX/tiltY → sigma/rho influence
            min: 0,
            max: 3,
            step: 0.1,
            get: () => this.motionMix.tilt,
            set: (v) => (this.motionMix.tilt = v),
          },
          {
            label: 'TwistGain', // twist → beta influence
            min: 0,
            max: 3,
            step: 0.1,
            get: () => this.motionMix.twist,
            set: (v) => (this.motionMix.twist = v),
          },
          {
            label: 'Smooth', // how slowly motionState follows the raw input
            min: 0.01,
            max: 0.3,
            step: 0.01,
            get: () => this.motionMix.smooth,
            set: (v) => (this.motionMix.smooth = v),
          },
          {
            label: 'DragGain', // desktop/touch pixels → tilt
            min: 0,
            max: 0.006,
            step: 0.0002,
            get: () => this.motionMix.drag,
            set: (v) => (this.motionMix.drag = v),
          },
          {
            // Debug: replace the chaotic curve with a straight beam steered by the
            // live audio/pointer/pad params (sigma→yaw, rho→pitch, beta→curvature).
            label: 'Straight',
            min: 0,
            max: 1,
            step: 1,
            get: () => (this.lorenz.straight ? 1 : 0),
            set: (v) => {
              const on = v >= 0.5;
              this.lorenz.setStraight(on);
              this.lorenz2?.setStraight(on);
            },
          },
        ],
      },
      {
        // Auto director: switches camera/shape on musical section changes.
        title: 'Auto',
        sliders: [
          bool(
            'Structure',
            () => this.autoStructureOn,
            (v) => {
              this.autoStructureOn = v;
              this.autoDirector.reset();
              this.trackStructureDirector?.reset();
            },
          ),
          bool(
            'Beat zoom',
            () => this.rhythmAuto.zoom,
            (v) => (this.rhythmAuto.zoom = v),
          ),
          bool(
            'Jump cam',
            () => this.rhythmAuto.jumpCam,
            (v) => (this.rhythmAuto.jumpCam = v),
          ),
          bool(
            'Beat cuts',
            () => this.rhythmAuto.beatCuts,
            (v) => (this.rhythmAuto.beatCuts = v),
          ),
          bool(
            'Roll cuts',
            () => this.rhythmAuto.rollCuts,
            (v) => (this.rhythmAuto.rollCuts = v),
          ),
          bool(
            'Rhythm FX',
            () => this.rhythmAuto.effects,
            (v) => (this.rhythmAuto.effects = v),
          ),
          bool(
            'Grid waves',
            () => this.rhythmAuto.gridWaves,
            (v) => (this.rhythmAuto.gridWaves = v),
          ),
          {
            label: 'ZoomAmt',
            min: 0,
            max: 0.6,
            step: 0.02,
            get: () => this.rhythmAuto.zoomAmount,
            set: (v) => (this.rhythmAuto.zoomAmount = v),
          },
          {
            label: 'CutChance',
            min: 0,
            max: 1,
            step: 0.05,
            get: () => this.rhythmAuto.beatCutChance,
            set: (v) => (this.rhythmAuto.beatCutChance = v),
          },
          {
            label: 'WaveChance',
            min: 0,
            max: 1,
            step: 0.05,
            get: () => this.rhythmAuto.gridWaveChance,
            set: (v) => (this.rhythmAuto.gridWaveChance = v),
          },
          {
            label: 'Sensitivity', // higher = more switches
            min: 0,
            max: 1,
            step: 0.05,
            get: () => this.autoDirector.params.sensitivity,
            set: (v) => (this.autoDirector.params.sensitivity = v),
          },
          {
            label: 'Cooldown', // min seconds between switches
            min: 2,
            max: 30,
            step: 1,
            get: () => this.autoDirector.params.cooldown,
            set: (v) => (this.autoDirector.params.cooldown = v),
          },
          {
            label: 'MaxGap', // force a switch after this many seconds
            min: 10,
            max: 120,
            step: 5,
            get: () => this.autoDirector.params.maxGap,
            set: (v) => (this.autoDirector.params.maxGap = v),
          },
        ],
      },
      {
        title: 'Curve 2',
        sliders: [
          {
            label: 'On',
            min: 0,
            max: 1,
            step: 1,
            get: () => (gpu.curve2Params.enabled ? 1 : 0),
            set: (v) => (gpu.curve2Params.enabled = v > 0.5),
          },
          {
            label: 'Cross',
            min: 0,
            max: 3.14,
            step: 0.05,
            get: () => gpu.curve2Params.angle,
            set: (v) => (gpu.curve2Params.angle = v),
          },
          {
            label: 'Speed',
            min: 0.1,
            max: 4,
            step: 0.1,
            get: () => this.lorenz2?.speed ?? 1,
            set: (v) => {
              if (this.lorenz2) this.lorenz2.speed = v;
            },
          },
        ],
      },
      {
        title: 'KeyFrame',
        sliders: [
          {
            label: 'Glow',
            min: 0,
            max: 4,
            step: 0.1,
            get: () => gpu.keyParams.glow,
            set: (v) => (gpu.keyParams.glow = v),
          },
          {
            label: 'Freq',
            min: 0,
            max: 30,
            step: 0.5,
            get: () => gpu.keyParams.freq,
            set: (v) => (gpu.keyParams.freq = v),
          },
          {
            label: 'Hue',
            min: 0,
            max: 1,
            step: 0.01,
            get: () => gpu.keyParams.hue,
            set: (v) => (gpu.keyParams.hue = v),
          },
          {
            label: 'Tint',
            min: 0,
            max: 2,
            step: 0.05,
            get: () => gpu.keyParams.tint,
            set: (v) => (gpu.keyParams.tint = v),
          },
        ],
      },
      {
        title: 'Stars',
        sliders: [
          {
            label: 'Stars',
            min: 0,
            max: 160,
            step: 5,
            get: () => gpu.starParams.density,
            set: (v) => (gpu.starParams.density = v),
          },
          {
            label: 'StarGlow',
            min: 0,
            max: 3,
            step: 0.05,
            get: () => gpu.starParams.brightness,
            set: (v) => (gpu.starParams.brightness = v),
          },
          {
            label: 'StarAudio', // music glow (level) + beat flash on the stars
            min: 0,
            max: 3,
            step: 0.05,
            get: () => gpu.starParams.audio,
            set: (v) => (gpu.starParams.audio = v),
          },
        ],
      },
      {
        title: 'Still',
        sliders: [
          {
            label: 'Grain',
            min: 0,
            max: 1,
            step: 0.05,
            get: () => gpu.bgParams.grain,
            set: (v) => (gpu.bgParams.grain = v),
          },
          {
            label: 'Front',
            min: 0,
            max: 2,
            step: 0.05,
            get: () => gpu.dissolveParams.frontGlow,
            set: (v) => (gpu.dissolveParams.frontGlow = v),
          },
          {
            label: 'Butterfly',
            min: 0.6,
            max: 2,
            step: 0.05,
            get: () => gpu.dissolveParams.fieldScale,
            set: (v) => (gpu.dissolveParams.fieldScale = v),
          },
          {
            label: 'Zoom',
            min: 0,
            max: 1,
            step: 0.05,
            get: () => gpu.dissolveParams.zoom,
            set: (v) => (gpu.dissolveParams.zoom = v),
          },
        ],
      },
      {
        title: 'Trail',
        sliders: [
          {
            label: 'Smear',
            min: 0,
            max: 0.15,
            step: 0.005,
            get: () => gpu.trailParams.smear,
            set: (v) => (gpu.trailParams.smear = v),
          },
          {
            label: 'Halo',
            min: 0,
            max: 1.5,
            step: 0.05,
            get: () => gpu.trailParams.halo,
            set: (v) => (gpu.trailParams.halo = v),
          },
          {
            label: 'Hue',
            min: 0,
            max: 0.4,
            step: 0.01,
            get: () => gpu.trailParams.hueSpeed,
            set: (v) => (gpu.trailParams.hueSpeed = v),
          },
          {
            label: 'Decay',
            min: 0.7,
            max: 0.99,
            step: 0.01,
            get: () => gpu.trailParams.decay,
            set: (v) => (gpu.trailParams.decay = v),
          },
        ],
      },
      {
        // Synthetic source (camera-off material): splat trail + domain-warp + palette.
        title: 'Synth',
        sliders: [
          {
            label: 'Decay', // splat trail length
            min: 0.8,
            max: 0.995,
            step: 0.005,
            get: () => gpu.synthParams.decay,
            set: (v) => (gpu.synthParams.decay = v),
          },
          {
            label: 'WarpAmp',
            min: 0,
            max: 0.5,
            step: 0.01,
            get: () => gpu.synthParams.warpAmp,
            set: (v) => (gpu.synthParams.warpAmp = v),
          },
          {
            label: 'Flow',
            min: 0,
            max: 0.3,
            step: 0.005,
            get: () => gpu.synthParams.flow,
            set: (v) => (gpu.synthParams.flow = v),
          },
          {
            label: 'Scale', // fBm frequency
            min: 0.5,
            max: 8,
            step: 0.1,
            get: () => gpu.synthParams.scale,
            set: (v) => (gpu.synthParams.scale = v),
          },
          {
            label: 'Hue', // hue drift speed
            min: 0,
            max: 0.2,
            step: 0.005,
            get: () => gpu.synthParams.hue,
            set: (v) => (gpu.synthParams.hue = v),
          },
          {
            label: 'HueRange',
            min: 0,
            max: 2,
            step: 0.05,
            get: () => gpu.synthParams.hueRange,
            set: (v) => (gpu.synthParams.hueRange = v),
          },
          {
            label: 'Palette', // 0 rainbow / 1 sunset / 2 warm
            min: 0,
            max: 2,
            step: 1,
            get: () => gpu.synthParams.palette,
            set: (v) => (gpu.synthParams.palette = v),
          },
          {
            label: 'Rotate', // view spin speed
            min: 0,
            max: 1,
            step: 0.02,
            get: () => gpu.synthParams.rotate,
            set: (v) => (gpu.synthParams.rotate = v),
          },
          {
            label: 'Audio', // reactivity gain
            min: 0,
            max: 2,
            step: 0.1,
            get: () => gpu.synthParams.audio,
            set: (v) => (gpu.synthParams.audio = v),
          },
        ],
      },
      {
        // Auto-frame the global (orbit) view to the attractor's occupied space.
        title: 'Frame',
        sliders: [
          {
            label: 'Enabled', // 0 = fixed orbit, 1 = auto-frame
            min: 0,
            max: 1,
            step: 1,
            get: () => (gpu.frameParams.enabled ? 1 : 0),
            set: (v) => (gpu.frameParams.enabled = v > 0.5),
          },
          {
            label: 'Margin', // fill tightness (the bounding sphere overestimates, so < 1 fills more)
            min: 0.2,
            max: 2,
            step: 0.05,
            get: () => gpu.frameParams.margin,
            set: (v) => (gpu.frameParams.margin = v),
          },
          {
            label: 'Smooth', // higher = snappier reframing
            min: 0.005,
            max: 0.15,
            step: 0.005,
            get: () => gpu.frameParams.smooth,
            set: (v) => (gpu.frameParams.smooth = v),
          },
          {
            label: 'Height', // eye lift as a fraction of the framing distance
            min: 0,
            max: 1,
            step: 0.05,
            get: () => gpu.frameParams.height,
            set: (v) => (gpu.frameParams.height = v),
          },
        ],
      },
      {
        title: 'Follow',
        sliders: [
          {
            label: 'Back',
            min: 0,
            max: 3,
            step: 0.05,
            get: () => fp.back,
            set: (v) => (fp.back = v),
          },
          {
            label: 'Ahead',
            min: 0,
            max: 4,
            step: 0.05,
            get: () => fp.ahead,
            set: (v) => (fp.ahead = v),
          },
          {
            label: 'Height',
            min: -1,
            max: 1,
            step: 0.02,
            get: () => fp.height,
            set: (v) => (fp.height = v),
          },
          {
            label: 'Smooth',
            min: 0.01,
            max: 1,
            step: 0.01,
            get: () => fp.smooth,
            set: (v) => (fp.smooth = v),
          },
          {
            label: 'Heading',
            min: 0.01,
            max: 1,
            step: 0.01,
            get: () => fp.headingSmooth,
            set: (v) => (fp.headingSmooth = v),
          },
        ],
      },
    ]);
    if (hasTuneUrlFlag()) this.tuning.reveal(true);

    // Keep the controls hidden until the user touches the artwork; auto-hide on idle.
    this.uiShell = mountUiShell(this.uiRoot);
  }

  private cycleFollow(): void {
    // Free → Follow 1 → Follow 2 → Free (also exits a Trail mode).
    this.followMode = this.followMode === 1 ? 2 : this.followMode === 2 ? 0 : 1;
    this.controls?.setFollow(this.followMode);
  }

  private cycleTrail(): void {
    // Trail off → Trail A (curve 1) → Trail B (curve 2) → off.
    this.followMode = this.followMode === 3 ? 4 : this.followMode === 4 ? 0 : 3;
    this.controls?.setFollow(this.followMode);
  }

  private cycleShape(): void {
    if (!this.gpu) return;
    const next = (this.gpu.shapeMode + 1) % 3; // plane → cube → sphere
    this.gpu.startShapeMorph(next); // progressive wave from the head, not an instant swap
    this.controls?.setShape(this.gpu.shapeMode);
  }

  // Frame fader grabbed: take over the view so the framing change is visible.
  // Remember the current view, pause the auto-director (kept ON, just held), and
  // switch to the free-orbit view — the only one the margin reframes.
  private beginMarginPreview(): void {
    if (this.marginPreviewFollow !== null) return; // already previewing
    this.marginPreviewFollow = this.followMode;
    this.followMode = 0;
    this.controls?.setFollow(0, true); // silent: not a user action caption
  }

  // Frame fader released: restore the saved view and let Auto resume (reset so it
  // doesn't fire instantly). If Auto was off it simply stays off.
  private endMarginPreview(): void {
    if (this.marginPreviewFollow === null) return;
    this.followMode = this.marginPreviewFollow;
    this.marginPreviewFollow = null;
    this.controls?.setFollow(this.followMode, true);
    if (this.autoOn) this.resetAutoDirectors();
  }

  // Toggle the auto director (resets it so it doesn't fire on the first frame).
  private setAuto(on: boolean): void {
    this.autoOn = on;
    if (on) this.resetAutoDirectors();
    this.controls?.setAuto(on);
  }

  private resetAutoDirectors(): void {
    this.autoDirector.reset();
    this.trackStructureDirector?.reset();
    this.rhythmZoom = 1;
    this.rhythmCutCooldown = 0;
    this.rhythmRollUntil = 0;
    this.gridWaveCooldown = 0;
  }

  private resolveAutoFollowMode(next: number): number {
    const movingNow = this.followMode !== 0;
    const movingNext = next !== 0;
    if (movingNow && movingNext && next !== this.followMode) return 0;
    return next;
  }

  private setAutoFollowMode(next: number): boolean {
    const resolved = this.resolveAutoFollowMode(next);
    if (resolved === this.followMode) return false;
    this.followMode = resolved;
    this.controls?.setFollow(this.followMode, true);
    return true;
  }

  // Apply an auto-chosen render preset (camera mode + shape) and sync the controls.
  private applyRenderPreset(p: RenderPreset): void {
    const shapeChanged = this.gpu ? this.gpu.shapeMode !== p.shape : false;
    const followChanged = this.setAutoFollowMode(p.follow);
    if (this.gpu) {
      this.gpu.startShapeMorph(p.shape); // auto-director shape changes morph too
      this.controls?.setShape(p.shape, true);
    }
    // Whisper-light tick on an automatic switch.
    if (followChanged || shapeChanged) haptics.select();
  }

  private applyStructuredRenderPreset(p: DirectedRenderPreset): boolean {
    const shapeChanged = this.gpu ? this.gpu.shapeMode !== p.shape : false;
    const followChanged = this.setAutoFollowMode(p.follow);
    if (followChanged || shapeChanged) haptics.select();
    if (shapeChanged && this.gpu) {
      this.gpu.startShapeMorph(p.shape);
      this.controls?.setShape(p.shape, true);
    }
    if (p.comet) this.gpu?.launchComet();
    return followChanged;
  }

  private updateRhythmZoom(dt: number): void {
    this.rhythmCutCooldown = Math.max(0, this.rhythmCutCooldown - dt);
    this.gridWaveCooldown = Math.max(0, this.gridWaveCooldown - dt);
    this.exposureShortCooldown = Math.max(0, this.exposureShortCooldown - dt);
    this.exposureLongCooldown = Math.max(0, this.exposureLongCooldown - dt);
    this.rhythmZoom += (1 - this.rhythmZoom) * Math.min(1, dt * 7);
  }

  private resetPixelRippleCountdown(): void {
    const rate = this.pixelRippleAuto.rate;
    this.pixelRippleCountdown = rate > 0 ? 3 + -Math.log(1 - Math.random()) / rate : Infinity;
  }

  private syncExposureAutoTrack(audio: AudioEngine | null): void {
    if (!audio?.isEnabled) return;
    const key = `${audio.trackName}|${audio.currentTrackSrc}`;
    if (key !== this.exposureTrackKey || audio.positionSec + 0.25 < this.exposureTrackPosition) {
      this.exposureTrackKey = key;
      this.exposureTrackPosition = audio.positionSec;
      this.setExposureLimitsForTrack(audio);
      this.exposureShortCount = 0;
      this.exposureLongCount = 0;
      this.exposureShortCooldown = 0;
      this.exposureLongCooldown = 0;
      return;
    }
    this.setExposureLimitsForTrack(audio);
    this.exposureTrackPosition = audio.positionSec;
  }

  private setExposureLimitsForTrack(audio: AudioEngine): void {
    const duration =
      this.trackStructureDirector?.durationForTrack(audio.trackName, audio.currentTrackSrc) ??
      EXPOSURE_LIMIT_REFERENCE_SEC;
    const scale = Math.max(0.25, duration / EXPOSURE_LIMIT_REFERENCE_SEC);
    this.exposureShortMax = Math.max(1, Math.round(scale * EXPOSURE_SHORT_PER_REFERENCE));
    this.exposureLongMax = Math.max(1, Math.round(scale * EXPOSURE_LONG_PER_REFERENCE));
  }

  private maybeExposureShort(strength = 1, chance = 1): boolean {
    if (!this.gpu) return false;
    if (this.exposureShortCount >= this.exposureShortMax || this.exposureShortCooldown > 0)
      return false;
    if (Math.random() > chance) return false;
    if (!this.gpu.launchExposureTrail(strength, this.exposureAuto.shortDuration)) return false;
    this.exposureShortCount++;
    this.exposureShortCooldown = 7 + Math.random() * 5;
    return true;
  }

  private maybeExposureLong(role: string | null, positionSec: number): boolean {
    if (!this.gpu) return false;
    if (this.exposureLongCount >= this.exposureLongMax || this.exposureLongCooldown > 0)
      return false;
    if (positionSec < 12) return false;
    if (role !== 'float' && role !== 'bridge' && role !== 'break') return false;
    if (!this.gpu.launchExposureTrail(1, this.exposureAuto.longDuration)) return false;
    this.exposureLongCount++;
    this.exposureLongCooldown = this.exposureAuto.longDuration + 35 + Math.random() * 20;
    this.exposureShortCooldown = Math.max(this.exposureShortCooldown, 4);
    return true;
  }

  private updateExposureAuto(director: TrackDirectorUpdate | null, positionSec: number): void {
    if (!director) return;

    // Section boundaries are the preferred musical anchor. With Auto enabled, this
    // often lands on the same frame as a camera change; with Auto disabled, the
    // exposure effect still plays from the offline structure.
    if (director.preset) {
      const playedLong = this.maybeExposureLong(director.role, positionSec);
      if (!playedLong) this.maybeExposureShort(0.9, 0.85);
      return;
    }

    // Between section cuts, allow a few short accents on strong rhythmic events.
    for (const cue of director.cues) {
      if (cue.kind === 'roll') {
        if (this.maybeExposureShort(0.8 + cue.strength * 0.2, 0.3)) return;
      } else if (cue.kind === 'kick' && cue.strength > 0.86) {
        if (this.maybeExposureShort(0.75 + cue.strength * 0.2, 0.12)) return;
      }
    }
  }

  private applyEffectiveZoom(): void {
    if (!this.gpu) return;
    const userZoom = this.zoom?.value ?? 1;
    this.gpu.zoom = clamp(userZoom * this.rhythmZoom, 1, 3);
  }

  private triggerRhythmZoom(strength: number, mult = 1): void {
    if (!this.rhythmAuto.zoom) return;
    if (this.audio?.isEnabled && this.audio.positionSec < RHYTHM_ZOOM_START_SEC) return;
    const amount = this.rhythmAuto.zoomAmount * clamp(strength, 0, 1) * mult;
    this.rhythmZoom = Math.max(this.rhythmZoom, clamp(1 + amount, 1, 3));
  }

  private handleRhythmCues(cues: RhythmCue[], positionSec: number, role: string | null): void {
    if (!cues.length) return;
    const roleMul = role === 'drive' ? 1.2 : role === 'groove' ? 1 : role === 'intro' ? 0.25 : 0.75;
    for (const cue of cues) {
      if (cue.kind === 'roll') {
        this.rhythmRollUntil = Math.max(this.rhythmRollUntil, positionSec + (cue.duration ?? 0.8));
        this.triggerRhythmZoom(cue.strength, 1.5);
        if (this.rhythmAuto.effects) this.gpu?.launchComet();
        this.maybeGridRainbow(cue, this.rhythmAuto.gridWaveChance * 1.4 * roleMul, 1.15);
        this.maybeRhythmJump(cue, this.rhythmAuto.rollCutChance * roleMul, 0.14);
        continue;
      }

      const inRoll = positionSec <= this.rhythmRollUntil;
      if (cue.kind === 'kick') {
        this.triggerRhythmZoom(cue.strength, 1.15);
        if (cue.strength > 0.78) {
          this.maybeGridRainbow(cue, this.rhythmAuto.gridWaveChance * 0.34 * roleMul, 0.9);
        }
        this.maybeRhythmJump(cue, this.rhythmAuto.beatCutChance * 0.45 * roleMul, 0.75);
      } else if (cue.kind === 'snare') {
        this.triggerRhythmZoom(cue.strength, inRoll ? 1.35 : 0.85);
        this.maybeGridRainbow(
          cue,
          this.rhythmAuto.gridWaveChance * (inRoll ? 0.55 : 0.18) * roleMul,
          inRoll ? 1 : 0.7,
        );
        this.maybeRhythmJump(
          cue,
          (inRoll && this.rhythmAuto.rollCuts
            ? this.rhythmAuto.rollCutChance
            : this.rhythmAuto.beatCutChance) * roleMul,
          inRoll ? 0.14 : 0.55,
        );
      } else if (cue.kind === 'tom') {
        this.triggerRhythmZoom(cue.strength, 0.75);
        if (inRoll) {
          this.maybeGridRainbow(cue, this.rhythmAuto.gridWaveChance * 0.28 * roleMul, 0.75);
        }
        this.maybeRhythmJump(cue, this.rhythmAuto.beatCutChance * 0.35 * roleMul, 0.65);
      } else {
        this.triggerRhythmZoom(cue.strength, 0.55);
        this.maybeRhythmJump(cue, this.rhythmAuto.beatCutChance * 0.25 * roleMul, 0.9);
      }
    }
  }

  private maybeRhythmJump(cue: RhythmCue, chance: number, cooldown: number): void {
    if (!this.rhythmAuto.jumpCam) return;
    const rollLike = cue.kind === 'roll' || cooldown < 0.2;
    if (rollLike && !this.rhythmAuto.rollCuts) return;
    if (!rollLike && !this.rhythmAuto.beatCuts) return;
    if (cue.kind !== 'roll' && this.rhythmCutCooldown > 0) return;
    const effectiveChance = clamp(chance * (0.45 + cue.strength * 0.75), 0, 1);
    if (Math.random() > effectiveChance) return;
    this.jumpRhythmCamera(cue.kind === 'roll' || cooldown < 0.2, cue.strength);
    this.rhythmCutCooldown = cooldown;
  }

  private maybeGridRainbow(cue: RhythmCue, chance: number, strengthMul = 1): void {
    if (!this.rhythmAuto.effects || !this.rhythmAuto.gridWaves || !this.gpu) return;
    if (this.gridWaveCooldown > 0) return;
    const effectiveChance = clamp(chance * (0.35 + cue.strength * 0.9), 0, 1);
    if (Math.random() > effectiveChance) return;
    if (!this.triggerGridRainbow(cue.strength * strengthMul)) return;
    this.gridWaveCooldown = 4.5 + Math.random() * 4;
  }

  private triggerGridRainbow(strength = 1): boolean {
    if (!this.gpu?.launchGridRainbow(strength)) return false;
    this.setAutoFollowMode(0);
    return true;
  }

  private updatePixelRippleAuto(dt: number, cues: RhythmCue[], role: string | null): void {
    if (!this.pixelRippleAuto.enabled) return;
    this.pixelRippleCooldown = Math.max(0, this.pixelRippleCooldown - dt);
    this.pixelRippleCountdown -= dt;

    const roleMul = role === 'drive' ? 1.15 : role === 'groove' ? 1 : role === 'intro' ? 0.35 : 0.75;
    for (const cue of cues) {
      if (cue.kind === 'roll') {
        if (this.maybePixelRipple(cue, this.pixelRippleAuto.chance * 1.4 * roleMul, 1.2)) return;
      } else if (cue.kind === 'snare') {
        if (this.maybePixelRipple(cue, this.pixelRippleAuto.chance * 0.55 * roleMul, 0.95)) return;
      } else if (cue.kind === 'kick' && cue.strength > 0.76) {
        if (this.maybePixelRipple(cue, this.pixelRippleAuto.chance * 0.45 * roleMul, 0.85)) return;
      }
    }

    if (this.pixelRippleCooldown <= 0 && this.pixelRippleCountdown <= 0) {
      if (this.gpu?.launchPixelRipple(0.8 + Math.random() * 0.35)) {
        this.pixelRippleCooldown = this.gpu.pixelRippleParams.duration + 5 + Math.random() * 6;
      }
      this.resetPixelRippleCountdown();
    }
  }

  private maybePixelRipple(cue: RhythmCue, chance: number, strengthMul = 1): boolean {
    if (!this.gpu || this.pixelRippleCooldown > 0) return false;
    const effectiveChance = clamp(chance * (0.35 + cue.strength * 0.9), 0, 1);
    if (Math.random() > effectiveChance) return false;
    if (!this.gpu.launchPixelRipple(cue.strength * strengthMul)) return false;
    this.pixelRippleCooldown = this.gpu.pixelRippleParams.duration + 4 + Math.random() * 5;
    this.resetPixelRippleCountdown();
    return true;
  }

  private jumpRhythmCamera(rapid: boolean, strength: number): void {
    const pool = rapid ? [1, 2, 3, 4, 0] : [0, 1, 3, 0, 2, 4];
    let next = this.followMode;
    for (let i = 0; i < 6 && next === this.followMode; i++) {
      next = pool[Math.floor(Math.random() * pool.length)] ?? 0;
    }
    const followChanged = this.setAutoFollowMode(next);
    this.triggerRhythmZoom(strength, rapid ? 1.4 + Math.random() * 0.5 : 0.8 + Math.random() * 0.5);
    if (!this.rhythmAuto.effects || !this.gpu) return;
    if (followChanged) this.maybeExposureShort(0.75 + strength * 0.25, rapid ? 0.35 : 0.5);
    if (rapid && Math.random() < 0.22) this.gpu.startShapeMorph(Math.floor(Math.random() * 3));
    if (rapid && Math.random() < 0.18) this.gpu.launchComet();
  }

  private async setCamera(on: boolean): Promise<void> {
    // Serialize toggles: a second tap during in-flight getUserMedia would
    // otherwise acquire a second stream and leak the first one's tracks.
    if (this.cameraBusy) return;
    this.cameraBusy = true;
    try {
      if (on) {
        if (this.camera) await this.camera.start();
        else this.camera = await CameraInput.create();
        this.cameraOn = true;
      } else {
        // Releases the camera hardware.
        this.camera?.stop();
        this.cameraOn = false;
      }
    } catch (err) {
      console.warn('[lorenz] camera toggle failed', err);
      this.cameraOn = false;
    } finally {
      this.cameraBusy = false;
    }
    this.controls?.setCamera(this.cameraOn);
    // Split only applies with the camera on → reveal/collapse its button to match.
    this.controls?.setSplitAvailable(this.cameraOn);
  }

  // UI state for the 2-state Music button: 1 = sound, 0 = muted (or not yet running).
  // The engine always analyses once enabled; the two states differ only in output gain.
  private audioUiMode(): number {
    const audio = this.audio;
    return audio && audio.isEnabled && !audio.isMuted ? 1 : 0;
  }

  // Toggle Music: sound ↔ muted. Both keep the track playing + the FFT driving the
  // visuals; only the output gain differs. If the engine never started (autoplay blocked
  // at launch), this tap is a fresh user gesture that enables it (unmuted).
  private async toggleAudio(): Promise<void> {
    // Serialize so a double-tap during the async enable() can't desync.
    if (this.audioBusy) return;
    this.audioBusy = true;
    try {
      if (!this.audio) {
        this.audio = new AudioEngine();
        this.audio.onTrackChange = (name) => {
          this.controls?.setTrack(name);
          haptics.select(); // light tick when the track auto-advances
        };
      }
      const audio = this.audio;
      if (!audio.isEnabled) {
        audio.setMuted(false);
        await audio.enable();
      } else {
        audio.setMuted(!audio.isMuted);
      }
    } catch (err) {
      console.warn('[lorenz] audio toggle failed', err);
    } finally {
      this.audioBusy = false;
    }
    if (this.gpu) this.gpu.audioParams.enabled = this.audio?.isEnabled ?? false;
    this.controls?.setAudio(this.audioUiMode());
  }

  private async cycleTrack(): Promise<void> {
    if (!this.audio) return;
    await this.audio.cycleTrack();
    this.controls?.setTrack(this.audio.trackName);
  }

  private startLoop(): void {
    if (this.rafId !== null) return;
    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.frame);
  }

  private stopLoop(): void {
    if (this.rafId === null) return;
    cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  // Stars-only loop shown behind the Start screen. Renders just the background
  // pass (count = 0 → no ribbon/particles/head); a private clock animates the
  // twinkle + slow orbit. Folded into the full loop when handleStart runs.
  private startBootLoop(): void {
    if (this.bootRafId !== null) return;
    this.bootStart = performance.now();
    this.bootRafId = requestAnimationFrame(this.bootFrame);
  }

  private stopBootLoop(): void {
    if (this.bootRafId === null) return;
    cancelAnimationFrame(this.bootRafId);
    this.bootRafId = null;
  }

  private readonly bootFrame = (now: number): void => {
    const time = (now - this.bootStart) / 1000;
    try {
      this.gpu?.renderFrame(
        this.lorenz.instanceData,
        0, // count = 0 → background/stars only
        this.lorenz.headIndex,
        time,
        this.lorenz.ageRef,
        null, // no camera
        this.lorenz.depositedSlots,
        0,
        0, // orbit
        0,
        null, // no second curve
        false, // stars-only boot screen → no synthetic source
      );
    } catch (err) {
      this.stopBootLoop();
      console.error('Boot render error:', err);
      this.fail(`Render error: ${describeError(err)}`);
      return;
    }
    this.bootRafId = requestAnimationFrame(this.bootFrame);
  };

  private readonly frame = (now: number): void => {
    // Cap to ~60 fps. On a 120 Hz iPad this halves the per-frame camera-import + ring-capture
    // GPU churn that WebKit fails to reclaim (→ OOM after minutes). rAF is always re-armed.
    if (now - this.lastTime < MIN_FRAME_MS) {
      this.rafId = requestAnimationFrame(this.frame);
      return;
    }
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    this.frameCount++; // for the diagnostic fps readout
    // Debug pause: freeze the whole simulation (dt = 0 → no integration, all clocks
    // hold, the master time uniform holds → a static frame). Step runs one fixed dt.
    if (this.paused) {
      dt = this.stepRequested ? 1 / 60 : 0;
      this.stepRequested = false;
    }

    try {
      // update() before render(): render() captures camera frames into exactly
      // the ring slots update() just deposited this frame.
      this.update(dt);
      this.render();
      // Feed the just-rendered canvas to the export recorder (30 fps-gated internally).
      if (!this.exporting && !this.exportDialogOpen && this.recorder?.isRecording) {
        this.recorder.captureFrame(now, this.warp);
      }
      // Manual snapshot: red progress ring on the Snapshot button + stop at 5 s.
      if (this.recorder?.recordingKind === 'manual' && this.manualEndAt > 0) {
        if (now >= this.manualEndAt) {
          this.manualEndAt = 0;
          this.controls?.setSnapshotProgress(-1);
          void this.recorder.endSequence().then(() => this.exportMenu?.refresh());
        } else {
          this.controls?.setSnapshotProgress(1 - (this.manualEndAt - now) / 5000);
        }
      }
      // Deferred export-open: the user tapped Export mid-capture; open now that it has finished.
      if (this.pendingExportOpen && !this.recorder?.isRecording) {
        this.pendingExportOpen = false;
        this.exportMenu?.open();
      }
      // Auto-director halo breathes with the live audio level (no-op while Auto is off).
      if (this.autoOn) this.controls?.setAutoEnergy(this.gpu?.audioState.level ?? 0);
    } catch (err) {
      // A throw here would otherwise silently kill the loop (black screen).
      this.stopLoop();
      // Stamp the exact error + diagnostic context INTO the message (not a separate console
      // arg, which a remote console may not expand) so a crash log is always self-contained.
      const diag = this.diagLine();
      console.error(`Render loop error: ${describeError(err)} [${diag}]`);
      // A GPU error in the loop (e.g. iOS WebKit's slow external-texture leak finally hitting
      // the GPU budget) — recover IN PLACE by rebuilding the context instead of dying on the
      // error screen. handleDeviceLost frees the old device, re-points everything, resumes the
      // loop, and falls back to the error screen if recovery keeps failing (storm guard).
      void this.handleDeviceLost({
        reason: 'unknown',
        message: describeError(err),
      } as GPUDeviceLostInfo);
      return;
    }

    // Re-arm the loop — UNLESS it was intentionally stopped during this frame (stopLoop() nulls
    // rafId, e.g. the export dialog opened after a deferred capture finished). Re-arming
    // unconditionally would immediately undo that pause.
    if (this.rafId !== null) this.rafId = requestAnimationFrame(this.frame);
  };

  private stepOnce(): void {
    this.stepRequested = true;
  }

  // The slow-mo ripple lives in the bloom composite, so the debug grid needs bloom on.
  private setDebugRipple(on: boolean): void {
    if (!this.gpu) return;
    if (on) this.gpu.bloomParams.enabled = true;
    this.gpu.debugRipple = on;
  }

  // Cycle the synthetic-source inspector: off → raw splat → colorized synth. Only
  // meaningful with the camera off (that's when the synthetic source is generated).
  private cycleDebugSource(): void {
    if (!this.gpu) return;
    this.gpu.debugSource = (this.gpu.debugSource + 1) % 3;
    this.gpu.debugMask = -1; // mutually exclusive with the mask viewer
    const labels = ['', 'Source: raw splat (camera off)', 'Source: colorized synth (camera off)'];
    this.setDebugCaption(labels[this.gpu.debugSource]);
  }

  // Cycle the butterfly dissolve-mask viewer through the Lorenz-field layers
  // (off → 0 → … → fieldCount-1 → off).
  private cycleDebugMask(): void {
    if (!this.gpu) return;
    const n = this.gpu.fieldCount;
    this.gpu.debugMask = this.gpu.debugMask + 1 >= n ? -1 : this.gpu.debugMask + 1;
    this.gpu.debugSource = 0; // mutually exclusive with the source inspector
    this.setDebugCaption(
      this.gpu.debugMask >= 0 ? `Mask: butterfly ${this.gpu.debugMask + 1}/${n}` : '',
    );
  }

  // Download the current composite as a PNG (grabbed from the GPU present texture, so
  // it never includes the DOM UI). Pause first for a clean still.
  private async captureDebugPng(): Promise<void> {
    const blob = await this.gpu?.capturePng();
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lorenz-${Date.now()}.png`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Restore all base layers (and unpause); leaves the ripple grid off.
  private debugReset(): void {
    this.paused = false;
    this.setDebugCaption('');
    // Single source of truth = debugLayers (the same list the decomposer steps): every
    // base layer back on, ripple off. Adding a layer here can't drift from the slideshow.
    this.debugLayers.forEach((layer) => layer.set(layer.key !== 'ripple'));
  }

  // A small caption overlay (current decomposition step). Created lazily; never part
  // of a PNG (which is grabbed from the GPU texture, not the DOM).
  private setDebugCaption(text: string): void {
    if (!this.debugCaptionEl) {
      if (!text) return;
      const el = document.createElement('div');
      el.style.cssText =
        'position:fixed;left:50%;bottom:max(1.2rem,env(safe-area-inset-bottom));' +
        'transform:translateX(-50%);z-index:30;pointer-events:none;color:#fff;' +
        'font:600 0.78rem/1.4 system-ui,sans-serif;letter-spacing:0.02em;' +
        'background:rgba(0,0,0,0.55);padding:0.35rem 0.7rem;border-radius:0.5rem;';
      this.uiRoot.appendChild(el);
      this.debugCaptionEl = el;
    }
    this.debugCaptionEl.textContent = text;
    this.debugCaptionEl.style.display = text ? 'block' : 'none';
  }

  private update(dt: number): void {
    // Transient pinch/wheel zoom, eased + sprung back to the origin framing.
    this.zoom?.update();
    this.updateRhythmZoom(dt);

    // Advance the shape-morph wave on its own fixed-duration clock (raw dt, so the
    // transition lasts ~morphParams.dur regardless of scroll/slow-mo speed).
    this.gpu?.advanceMorph(dt);

    // Advance the two traveling-glow clocks (curve A/B pulses on their own random pace).
    this.gpu?.advanceSweep(dt);

    // Advance the random bloom-flash pulse on raw dt (peaks stay ~250 ms in slow-mo too).
    this.gpu?.advanceFlash(dt);

    // Advance the transient rainbow wave on the deformation grid.
    this.gpu?.advanceGridRainbow(dt);

    // Advance the autonomous pixel-ripple post effect.
    this.gpu?.advancePixelRipple(dt);

    // Advance the final-composite temporal feedback effect.
    this.gpu?.advanceExposureTrail(dt);

    // Slow-mo: a drag anywhere on the artwork (not the menu) engages it, scaled by how
    // far it pulls; releasing springs the warp back to 1. The eased warp (1 → ~0.35)
    // tape-stops the music (decoded-buffer playbackRate) and scales the animation.
    if (this.touch?.isDragging) this.slowmo.engage(this.touch.slowPull);
    else this.slowmo.release();
    this.slowmo.update();
    this.warp = this.slowmo.value;
    if (this.gpu) this.gpu.slowmoAmount = this.slowmo.amount;
    // One tap as a drag pulls slow-mo on; re-armed once it springs back to normal.
    if (!this.slowmoBuzzed && this.slowmo.amount > 0.25) {
      haptics.tap();
      this.slowmoBuzzed = true;
    } else if (this.slowmoBuzzed && this.slowmo.amount < 0.05) {
      this.slowmoBuzzed = false;
    }
    this.audio?.setWarp(this.warp);

    // Audio: read the FFT, push smoothed features to the GPU, and derive the
    // energy → scroll-speed multiplier. sensitivity scales magnitudes; the
    // centroid is positional so it's passed through unscaled.
    // Paused → don't re-read the FFT or overwrite audioState, so the frozen frame
    // stays fully static (audio-driven tint/size/flash hold their last values).
    const features =
      !this.paused && this.audio && this.audio.isEnabled ? this.audio.analyse() : SILENT_FEATURES;
    if (this.gpu && !this.paused) {
      const s = this.audioMix.sensitivity;
      const a = this.gpu.audioState;
      a.level = Math.min(1, features.level * s);
      a.bass = Math.min(1, features.bass * s);
      a.mid = Math.min(1, features.mid * s);
      a.treble = Math.min(1, features.treble * s);
      a.centroid = features.centroid;
      a.beat = Math.min(1, features.beat * s);
      // Freeze this instant's audio onto the deposits laid down this frame, so each
      // point keeps the colour/size of the music at its birth (a record along the
      // curve) rather than the whole curve pulsing with the live audio.
      this.lorenz.audioSnap[0] = a.centroid;
      this.lorenz.audioSnap[1] = a.beat;
      this.lorenz.audioSnap[2] = a.bass;
      this.lorenz.audioSnap[3] = a.treble;
      this.lorenz2?.audioSnap.set(this.lorenz.audioSnap);
    }
    // Louder music scrolls the ribbon faster. Applied as a dt multiplier so the
    // tuned base Speed (the slider) is left untouched (no two-way conflict).
    const energy = Math.min(1, features.level * this.audioMix.sensitivity);
    this.audioSpeedMul = 1 + (this.audio?.isEnabled ? energy * this.audioMix.speed : 0);
    const adt = dt * this.audioSpeedMul * this.warp;

    // Motion input → smoothed control state. The decaying pointer-drag eases into
    // motionState — raw drag values never reach the hub directly.
    // No drag active → motionState eases back to 0 → params return to base.
    const mm = this.motionMix;
    const drag = this.touch?.read(mm.drag) ?? null;
    const targetX = drag?.tiltX ?? 0;
    const targetY = drag?.tiltY ?? 0;
    const targetTwist = drag?.twist ?? 0;
    const ms = this.motionState;
    ms.tiltX += (targetX - ms.tiltX) * mm.smooth;
    ms.tiltY += (targetY - ms.tiltY) * mm.smooth;
    ms.twist += (targetTwist - ms.twist) * mm.smooth;

    // Feed the smoothed motion to the deformation grid (gesture leans/swirls it).
    if (this.gpu) {
      const f = this.gpu.fieldState;
      f.pushX = ms.tiltX;
      f.pushY = ms.tiltY;
      f.swirl = ms.twist;
    }

    // Audio + motion → Lorenz parameters (before integrating, so new deposits use them).
    this.applyInputs();

    const audio = this.audio;
    const structureDirector = this.trackStructureDirector;
    this.syncExposureAutoTrack(audio);
    let director: TrackDirectorUpdate | null = null;
    if (audio?.isEnabled && structureDirector?.hasTrack(audio.trackName, audio.currentTrackSrc)) {
      director = structureDirector.update(audio.trackName, audio.currentTrackSrc, audio.positionSec);
    }
    this.updatePixelRippleAuto(dt, director?.cues ?? [], director?.role ?? null);
    this.updateExposureAuto(director, audio?.positionSec ?? 0);

    // Auto director: switch camera/shape on detected musical section changes.
    // Held while the Frame fader previews the free-orbit view (marginPreviewFollow).
    if (this.autoOn && this.marginPreviewFollow === null && audio?.isEnabled) {
      if (this.autoStructureOn && director) {
        if (director.preset) this.applyStructuredRenderPreset(director.preset);
        this.handleRhythmCues(director.cues, audio.positionSec, director.role);
      } else {
        const preset = this.autoDirector.update(dt * this.warp, features);
        if (preset) this.applyRenderPreset(preset);
      }
    }
    this.applyEffectiveZoom();

    this.lorenz.update(adt);
    this.lorenz2?.update(adt);

    // Comet AFTER the deposits are laid down this frame, so the scroll phase it reads is
    // consistent with the oldestSlot/deposits renderFrame uploads (capturing it before
    // lorenz.update double-counted the scroll on deposit frames → a 1-segment flicker).
    // Front rides dt scaled by the slow-mo warp, easing off in phase with curve/orbit/spin.
    this.gpu?.advanceComet(dt * this.warp, this.lorenz.scrollPhase, this.lorenz2?.scrollPhase ?? 0);

    // Synthetic source drives the ring/HD pool while the camera is off (auto-on so
    // the scene is never dead). Computed here so render() and the still cycle agree.
    this.useSynthetic = !this.cameraOn;

    // Background still cycle: feed the dissolve state and request HD captures.
    if (this.stills && this.gpu) {
      // Drive the HD dissolve/glow from the camera OR the synthetic source, so the
      // fullscreen dissolve and the key-frame glow also run camera-off.
      const slot = this.stills.update(dt, this.cameraOn || this.useSynthetic);
      if (slot >= 0) {
        const split = this.cameraOn && this.splitOn;
        // Pick the still's source: camera-off ⇒ synth; split ⇒ alternate camera/synth
        // so the background montage shows both materials; otherwise the camera.
        let fromSynth = this.useSynthetic;
        if (split) {
          this.splitStillToggle = !this.splitStillToggle;
          fromSynth = this.splitStillToggle;
        }
        this.gpu.captureStillInto(slot, fromSynth);
        // Key-frame glow: mark the newest tile of the curve whose material this still
        // matches, so it glows as "this is where the background came from". Split ⇒ the
        // still belongs to exactly one curve (camera→A, synth→B); else both share it.
        if (split) {
          if (fromSynth) this.lorenz2?.markKeyFrame();
          else this.lorenz.markKeyFrame();
        } else {
          this.lorenz.markKeyFrame();
          this.lorenz2?.markKeyFrame();
        }
      }
      // Export recorder: a background "sequence" (one still appearance) is recorded as a
      // clip from dissolve-in to dissolve-out. Begin/end here; frames are fed in frame().
      if (this.recorder) {
        // Don't start new auto clips while exporting, while the export dialog is open, or while
        // we're waiting for an in-flight capture to finish so the export dialog can open.
        if (
          this.stills.sequenceStart &&
          !this.exporting &&
          !this.exportDialogOpen &&
          !this.pendingExportOpen
        ) {
          const src = this.audio?.currentTrackSrc ?? '';
          this.recorder.beginSequence(
            src ? { trackSrc: src, startSec: this.audio?.positionSec ?? 0 } : undefined,
            'auto',
          );
        }
        // Only an AUTO sequence ends with the still; a manual snapshot ends on its timer.
        if (this.stills.sequenceEnd && this.recorder.recordingKind === 'auto') {
          void this.recorder.endSequence().then(() => this.exportMenu?.refresh());
        }
      }
      this.gpu.backgroundState.reveal = this.stills.reveal;
      this.gpu.backgroundState.layer = this.stills.layer;
      this.gpu.backgroundState.fieldIndex = this.stills.fieldIndex;
      this.gpu.backgroundState.hueOffset = this.stills.hueOffset;
    }
  }

  // Open the export dialog — but if a capture is mid-flight, let it FINISH first (don't cut it),
  // then open. Serialising capture → dialog also keeps the dialog's compositing off the capture's
  // GPU work (the iPad crash peak). The frame loop opens it the instant recording stops.
  private requestExportOpen(): void {
    if (this.recorder?.isRecording) {
      this.pendingExportOpen = true;
      this.controls?.announce('Finishing capture…');
    } else {
      this.exportMenu?.open();
    }
  }

  // Record a 5 s clip of the live view into the export list (manual snapshot). Ignored
  // if recording is unavailable/busy; ends on a timer in the frame loop.
  private startManualSnapshot(): void {
    if (!this.recorder || this.exporting || this.exportDialogOpen) return;
    // Storage near full: warn instead of silently dropping the user's intentional save.
    if (this.recorder.storageFull) {
      this.controls?.announce('Storage full — delete some clips');
      return;
    }
    this.recorder.abortSequence(); // manual snapshot has priority — drop any background clip
    const src = this.audio?.currentTrackSrc ?? '';
    this.recorder.beginSequence(
      src ? { trackSrc: src, startSec: this.audio?.positionSec ?? 0 } : undefined,
      'manual',
    );
    this.manualEndAt = performance.now() + 5000;
    haptics.impact('light'); // confirm the snapshot started
  }

  // Live-record the QR end-card outro and return it as a standalone clip to append to the
  // export. Audio continues the music: anchored to the last included clip's track (so it
  // flows on seamlessly), falling back to the live track if that clip had none. Continuous
  // mode ignores per-clip anchors (it lays one segment over the whole reel, outro included),
  // so this anchor only matters in Synced mode. Returns null on failure → export proceeds
  // without the card.
  private async buildOutro(
    included: Sequence[],
    onProgress?: (p: number) => void,
  ): Promise<Sequence | null> {
    if (!this.recorder) return null;
    let audio: { trackSrc: string; startSec: number } | undefined;
    const last = included[included.length - 1];
    if (last?.audio) {
      audio = {
        trackSrc: last.audio.trackSrc,
        startSec: last.audio.startSec + last.durationUs / 1_000_000,
      };
    } else if (this.audio?.currentTrackSrc) {
      audio = { trackSrc: this.audio.currentTrackSrc, startSec: this.audio.positionSec };
    }
    const qr = buildQr(SHARE_URL);
    return this.recorder.recordOutro({
      durationSec: OUTRO_SEC,
      audio,
      onProgress,
      draw: (ctx, frame, t) => drawOutroOverlay(ctx, frame, qr, t),
    });
  }

  // Open the shared in-app legend (same overlay the start screen uses).
  private openHelp(page?: LegendPageId): void {
    this.legend?.open(page);
  }

  // The central Lorenz HUB: fold the live audio modulation (energy/beat/treble) AND
  // the pointer motion input (already smoothed into motionState) into the
  // Lorenz parameters, eased and clamped to stable ranges. Audio targets fall to 0
  // in silence and motionState eases to 0 with no input → params return to base.
  // Applied to both curves; new deposits record the morphing chaos.
  private applyInputs(): void {
    if (!this.gpu) return;
    const a = this.gpu.audioState; // 0 when audio is off/muted-but-silent analysis
    const la = this.lorenzAudio;
    const m = this.lorenzMod;
    // Drives: loudness (+ a beat transient) → rho; treble → sigma; beat → beta.
    const rhoTarget = (a.level + a.beat * 0.6) * la.rho;
    const sigmaTarget = a.treble * la.sigma;
    const betaTarget = a.beat * la.beta;
    m.rho += (rhoTarget - m.rho) * la.smooth;
    m.sigma += (sigmaTarget - m.sigma) * la.smooth;
    m.beta += (betaTarget - m.beta) * la.smooth;
    // Motion offsets: tilt → sigma/rho, twist → beta, added on top of the audio
    // modulation before the clamp. motionState is already smoothed and gain-scaled.
    const ms = this.motionState;
    const mm = this.motionMix;
    // Base ± audio modulation ± motion, clamped to stable visual ranges.
    const sigma = clamp(10 + m.sigma + ms.tiltX * 3.5 * mm.tilt, 6, 16);
    const rho = clamp(28 + m.rho + ms.tiltY * 8.0 * mm.tilt, 18, 42);
    const beta = clamp(8 / 3 + m.beta + ms.twist * 0.35 * mm.twist, 1.8, 3.4);
    this.lorenz.setParams(sigma, rho, beta);
    this.lorenz2?.setParams(sigma, rho, beta);
  }

  private render(): void {
    // While the export dialog is up, render WITHOUT the live camera: importExternalTexture
    // allocates a transient GPU texture every frame, and stacking that on the dialog's
    // (screen-sized) compositing + a finalizing capture is exactly what tips the GPU-tight iPad
    // over (importExternalTexture fails → then beginRenderPass can't allocate). The scene keeps
    // animating via the synthetic source (the well-worn camera-off path — NOT a freeze), and the
    // camera isn't visible behind the dialog anyway. Resumes the instant the dialog closes.
    const useCamera = this.cameraOn && !this.exportDialogOpen;
    const useSynthetic = this.useSynthetic || this.exportDialogOpen;
    const video = useCamera ? (this.camera?.source ?? null) : null;
    const curve2 = this.lorenz2
      ? {
          instanceData: this.lorenz2.instanceData,
          count: this.lorenz2.count,
          head: this.lorenz2.headIndex,
          ageRef: this.lorenz2.ageRef,
          depositedSlots: this.lorenz2.depositedSlots,
          depositedCount: this.lorenz2.depositedCount,
          // BASE deposit rate (no audioSpeedMul): the particle dissolve timing must
          // not be rescaled by the live audio, or every in-flight particle's prog
          // jumps each frame as the level moves → jerky. Energy→speed still drives
          // the scroll via the dt multiplier above. The slow-mo warp IS folded in —
          // it's eased (smooth, not jittery), so the dissolution slows in phase.
          depositRate: (this.lorenz2.speed * this.warp) / Math.max(this.lorenz2.spacing, 1e-3),
        }
      : null;
    this.gpu?.renderFrame(
      this.lorenz.instanceData,
      this.lorenz.count,
      this.lorenz.headIndex,
      this.lorenz.time,
      this.lorenz.ageRef,
      video,
      this.lorenz.depositedSlots,
      this.lorenz.depositedCount,
      this.followMode,
      // Base deposit rate (see curve2 above): off the live audio, but folds in the
      // eased slow-mo warp so the dissolution slows in phase with the music.
      (this.lorenz.speed * this.warp) / Math.max(this.lorenz.spacing, 1e-3),
      curve2,
      useSynthetic,
      useCamera && this.splitOn, // split: A camera / B synthetic
    );
  }

  // Basic device-loss recovery: retry once, otherwise surface a reload prompt.
  private async handleDeviceLost(info: GPUDeviceLostInfo): Promise<void> {
    // A 'destroyed' reason means we tore the device down on purpose.
    if (info.reason === 'destroyed') return;
    // Surface WHY the device was lost — WebKit often puts "out of memory" here, which is the
    // single most useful clue when debugging the iPad crash on a remote console.
    const lostDetail = `lost="${info.reason || 'unknown'}:${info.message}" | ${this.diagLine()}`;
    console.error(`[gpu] DEVICE LOST — ${lostDetail}`);

    // The context may have been lost while the Start-screen starfield was running
    // (it's created at boot now), not just mid-scene — cancel either loop.
    const wasBooting = this.phase === 'start-screen';
    this.stopBootLoop();
    this.stopLoop();
    if (this.deviceLostRetried) {
      this.fail('The graphics device was lost.', lostDetail);
      return;
    }
    // Storm guard: lost again < 30s after recovering → a persistent fault, not the slow
    // camera-import leak (which takes minutes). Stop retrying to avoid a recovery loop.
    if (this.lastRecoverMs > 0 && performance.now() - this.lastRecoverMs < 30_000) {
      this.fail('The graphics device keeps failing.', lostDetail);
      return;
    }
    this.deviceLostRetried = true;
    // Free the old device's memory before rebuilding — reclaims the exhausted/leaked GPU
    // memory immediately instead of waiting for GC (which may not run before the rebuild).
    this.gpu?.destroy();

    try {
      this.gpu = await WebGPUContext.create(this.canvas, this.lorenz.capacity, {
        onDeviceLost: (next) => void this.handleDeviceLost(next),
        onError: (e) => this.fail(`GPU error: ${e.message}`),
      });
      this.recorder?.setSource(this.gpu); // re-point export capture at the fresh context
      // Fresh HD still pool → reset the cycle so it doesn't show empty layers.
      this.stills = new StillCycle(this.gpu.hdPoolSize, this.gpu.fieldCount);
      // Recovered: allow a future unrelated loss to retry again, and respect
      // visibility (don't resume the loop into a hidden tab).
      this.deviceLostRetried = false;
      this.lastRecoverMs = performance.now();
      if (wasBooting) {
        // Recovered while still on the Start screen — resume the stars-only loop
        // and wait for the Start tap rather than jumping into the full scene.
        this.startBootLoop();
      } else if (document.hidden) {
        this.setPhase('paused');
      } else {
        this.setPhase('running');
        this.startLoop();
      }
    } catch (err) {
      console.error('WebGPU re-init failed after device loss:', err);
      this.fail('The graphics device was lost.', lostDetail);
    }
  }

  private fail(message: string, detail?: string): void {
    this.stopBootLoop();
    this.gpu = null;
    this.camera?.destroy();
    this.camera = null;
    this.cameraOn = false;
    this.audio?.destroy();
    this.audio = null;
    this.zoom?.destroy();
    this.zoom = null;
    this.marginFader?.destroy();
    this.marginFader = null;
    this.touch?.destroy();
    this.touch = null;
    this.xypad?.destroy();
    this.xypad = null;
    this.controls?.destroy();
    this.controls = null;
    this.uiShell?.destroy();
    this.uiShell = null;
    this.transportSummon?.destroy();
    this.transportSummon = null;
    this.padSummon?.destroy();
    this.padSummon = null;
    this.transportPop?.remove();
    this.transportPop = null;
    this.padPop?.remove();
    this.padPop = null;
    this.tuning?.destroy();
    this.tuning = null;
    this.legend?.destroy();
    this.legend = null;
    this.stills = null;
    this.setPhase('error');
    this.unmountScreen?.();
    this.unmountScreen = mountErrorScreen(this.uiRoot, message, detail);
  }

  private setPhase(phase: AppPhase): void {
    this.phase = phase;
  }

  private readonly handleResize = (): void => {
    this.resizeCanvas();
  };

  // Backing-store resolution = CSS size × dpr, but capped by a total-pixel budget. Phones
  // (~1–1.3 MP) sit under the budget and are untouched; a large tablet/desktop (a 12.9"
  // iPad is ~5 MP) is scaled DOWN proportionally so the GPU never renders — and the export
  // never continuously encodes — 5 MP/frame. That was the root of the low iPad framerate and
  // the after-a-few-minutes device-loss crash. CSS still stretches the canvas to fill the
  // screen, so the only cost is mild softening on very large displays (mobile is the priority
  // platform per AGENTS.md). Aspect is preserved → no distortion.
  private resizeCanvas(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth * dpr;
    const h = window.innerHeight * dpr;
    const px = w * h;
    const scale = px > MAX_RENDER_PIXELS ? Math.sqrt(MAX_RENDER_PIXELS / px) : 1;
    this.canvas.width = Math.max(2, Math.floor(w * scale));
    this.canvas.height = Math.max(2, Math.floor(h * scale));
  }

  // Print a compact diagnostic line every 10 s. The iPad crash is invisible to a JS-heap
  // profiler (the leak is GPU-side: textures / the video encode queue), so we log the drivers
  // that DO grow — fps, canvas size, and the export queue/clip counts — to a remote console.
  private startDiagnostics(): void {
    if (this.diagTimer !== null) return;
    this.diagPrevMs = performance.now();
    this.diagPrevFrames = this.frameCount;
    this.diagTimer = window.setInterval(() => {
      const now = performance.now();
      const dtSec = (now - this.diagPrevMs) / 1000;
      this.diagFps = dtSec > 0 ? (this.frameCount - this.diagPrevFrames) / dtSec : 0;
      this.diagPrevMs = now;
      this.diagPrevFrames = this.frameCount;
      if (this.gpu) {
        const cam = this.gpu.cameraCaptureStats();
        const prev = this.diagPrevCameraStats;
        if (prev && dtSec > 0) {
          const rate = (n: number): string => (n / dtSec).toFixed(1);
          this.diagCameraRates =
            ` imp/s=${rate(cam.imports - prev.imports)}` +
            ` copy/s=${rate(cam.copies - prev.copies)}` +
            ` depA/s=${rate(cam.depA - prev.depA)}` +
            ` depB/s=${rate(cam.depB - prev.depB)}`;
        }
        this.diagPrevCameraStats = cam;
      } else {
        this.diagPrevCameraStats = null;
        this.diagCameraRates = ' imp/s=0 copy/s=0 depA/s=0 depB/s=0';
      }
      console.info(`[diag] ${this.diagLine()}`);
      // One-time GPU texture breakdown (after the render targets are allocated) — shows where
      // the ~288 MB baseline goes so we know what to trim.
      if (!this.loggedGpuBreakdown && this.gpu && this.phase === 'running') {
        this.loggedGpuBreakdown = true;
        console.info(`[gpu] textures: ${this.gpu.gpuBreakdown()}`);
      }
    }, 10_000);
  }

  private diagLine(): string {
    const up = Math.round(performance.now() / 1000);
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const mp = ((cw * ch) / 1e6).toFixed(1);
    const d = this.recorder?.diagnostics;
    const rec = d
      ? `cap=${d.kind} q=${d.queue} clips=${d.clips} store=${d.usage}% idb=${d.idb} ram=${d.ramMB}MB enc=${d.enc} ${d.disabled ? 'DISABLED ' : ''}dims=${d.dims}`
      : 'cap=n/a';
    const gpu = this.gpu ? ` gpu=${this.gpu.gpuTextureMB}MB` : '';
    const camStats = this.gpu?.cameraCaptureStats();
    const cropDiag =
      camStats && (camStats.copyCropState !== 'none' || camStats.copyCrop !== '0,0,0,0')
        ? ` copyCrop=${camStats.copyCropState}:${camStats.copyCrop}`
        : '';
    const camDiag = camStats
      ? ` camPath=${camStats.path} camImp=${camStats.imports} camCopy=${camStats.copies}${this.diagCameraRates}${cropDiag} copyFallback=${camStats.copyFallbacks} hd=${camStats.hd}`
      : '';
    return `t=${up}s phase=${this.phase} fps=${this.diagFps.toFixed(0)} cam=${this.cameraOn} synth=${this.useSynthetic} canvas=${cw}×${ch}(${mp}MP)${gpu}${camDiag} ${rec}`;
  }

  private readonly handleVisibilityChange = (): void => {
    if (this.phase !== 'running' && this.phase !== 'paused') return;
    if (document.hidden) {
      this.setPhase('paused');
      this.stopLoop();
    } else {
      this.setPhase('running');
      this.startLoop();
      // iOS suspends the AudioContext when backgrounded — bring the music back on return.
      // (Often a no-op on iOS: resume() needs a user gesture, which resumeAudioOnGesture covers.)
      void this.audio?.resume();
    }
  };

  // Resume the AudioContext on any tap — the gesture iOS requires after it suspends audio in the
  // background (e.g. switching apps to view an exported video). Cheap: no-op unless suspended.
  private readonly resumeAudioOnGesture = (): void => {
    void this.audio?.resume();
  };
}

function describeError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
