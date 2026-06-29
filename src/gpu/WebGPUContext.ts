// Owns the WebGPU device, the canvas context and the 3D frame-ribbon renderer.
// An orbiting camera draws the Lorenz history as instanced billboards; each card
// samples its captured camera frame from a ring buffer.
import ribbonShader from './shaders/ribbon.wgsl?raw';
import backgroundShader from './shaders/background.wgsl?raw';
import gridShader from './shaders/grid.wgsl?raw';
import ribbonInkShader from './shaders/ribbonInk.wgsl?raw';
import trailFadeShader from './shaders/trailFade.wgsl?raw';
import shapeMeshShader from './shaders/shapeMesh.wgsl?raw';
import cometShader from './shaders/comet.wgsl?raw';
import particlesShader from './shaders/particles.wgsl?raw';
import headParticlesShader from './shaders/headParticles.wgsl?raw';
import bloomShader from './shaders/bloom.wgsl?raw';
import temporalFeedbackShader from './shaders/temporalFeedback.wgsl?raw';
import cameraPreviewShader from './shaders/cameraPreview.wgsl?raw';
import cameraCopyProbeShader from './shaders/cameraCopyProbe.wgsl?raw';
import blitShader from './shaders/blit.wgsl?raw';
import debugGridShader from './shaders/debugGrid.wgsl?raw';
import maskViewShader from './shaders/maskView.wgsl?raw';
import { createModule } from './shaderModule.ts';
import {
  createCube,
  createSphere,
  createGrid,
  type Mesh,
} from '../shared/geometry.ts';
import { FrameRingBuffer } from './FrameRingBuffer.ts';
import { SyntheticSource } from './SyntheticSource.ts';
import { SweepGlow } from '../effects/SweepGlow.ts';
import { Comet, COMET_MARGIN } from '../effects/Comet.ts';
import { INSTANCE_FLOATS } from '../lorenz/LorenzMapper.ts';
import { generateLorenzFields } from '../lorenz/LorenzField.ts';
import {
  type Mat4,
  type Vec3,
  perspectiveZO,
  lookAt,
  multiply,
  subtract,
  cross,
  normalize,
} from '../shared/math.ts';

// viewProj(16) + right(4) + up(4) + params(4) + ribbon(4) + curve(4) + misc(4)
// + audio0(4) + audio1(4) + tint0(4) + tint1(4) + tint2(4) + key(4) + sweep(4)
const CAMERA_FLOATS = 68;
// Comet wake reuses the tail-dissolution particle effect, so it mirrors its fixed
// lifetime (seconds). Keep in sync with src/gpu/shaders/particles.wgsl.
const PARTICLE_LIFETIME = 1.5;
// A second, independent Lorenz ribbon (generative/age-coloured, no camera) drawn
// rotated ~90° so it crosses the first at the centre. Fixed capacity.
const CURVE2_CAPACITY = 256;
// Upper bound for the ribbon length slider. The device is requested with this
// many texture-array layers (clamped to the adapter's real max); the WebGPU
// guaranteed minimum is only 256, so a default device would otherwise cap there.
const MAX_RIBBON = 1024;
// High-res still pool for the fullscreen dissolve background — a few frames kept
// at a higher layer resolution than the ribbon's ring (256px), addressed
// round-robin by StillCycle.
const HIGHRES_HEIGHT = 512;
const HIGHRES_POOL = 5;

// WebGPU exposes no VRAM query, so to see our own GPU footprint we estimate the byte size of
// every texture we allocate (wrapping device.createTexture) and keep a running live total.
const TEXEL_BYTES: Record<string, number> = {
  r8unorm: 1,
  r8uint: 1,
  rg8unorm: 2,
  r16float: 2,
  rg16float: 4,
  r32float: 4,
  rgba8unorm: 4,
  'rgba8unorm-srgb': 4,
  bgra8unorm: 4,
  'bgra8unorm-srgb': 4,
  rgb10a2unorm: 4,
  rg11b10ufloat: 4,
  rgba16float: 8,
  rgba32float: 16,
  depth16unorm: 2,
  depth24plus: 4,
  'depth24plus-stencil8': 4,
  depth32float: 4,
};
function estimateTextureBytes(desc: GPUTextureDescriptor): number {
  const s = desc.size;
  let w: number;
  let h: number;
  let layers: number;
  if (Array.isArray(s)) {
    w = s[0] ?? 1;
    h = s[1] ?? 1;
    layers = s[2] ?? 1;
  } else {
    const d = s as GPUExtent3DDict;
    w = d.width;
    h = d.height ?? 1;
    layers = d.depthOrArrayLayers ?? 1;
  }
  const bpp = TEXEL_BYTES[desc.format] ?? 4;
  const mip = desc.mipLevelCount && desc.mipLevelCount > 1 ? 4 / 3 : 1; // mip chain ≈ +1/3
  return w * h * layers * bpp * mip;
}
// Background uniform: fwd+tanHalfFovY, right+aspect, up+time, res+reveal+useStill,
// params(stillAspect, stillLayer, starDensity, starBrightness),
// extra(grain, smear, halo, hueSpeed), extra2(frontGlow, fieldScale, fieldLayer,
// flipBits), extra3(hueOffset, …). 8 vec4 rows.
const BG_FLOATS = 32;
const GRID_FLOATS = 20;
const BLOOM_FLOATS = 12;
const TEMPORAL_FLOATS = 4;
// Stack of Lorenz "butterfly" density views used as the dissolve masks, generated
// on the CPU at startup (different rho + 3D rotation per layer → shape/angle variety).
const FIELD_SIZE = 512;
const FIELD_COUNT = 10;
// Ribbon smoke/trail buffer: a persistent screen-space texture (half res — cheap
// and naturally blurry). The ribbon inks it, it decays each frame, and the still
// is smeared/dirtied by it. rgba8 holds the (single-channel) density.
const TRAIL_SCALE = 0.5;
const TRAIL_FORMAT: GPUTextureFormat = 'rgba8unorm';
// Bloom: the scene renders to an offscreen target, then a half-res bright/blur
// chain glows back over it. Half res keeps the blur cheap and naturally soft.
const BLOOM_SCALE = 0.5;
const BLOOM_FORMAT: GPUTextureFormat = 'rgba8unorm';
const DEFAULT_ASPECT = 9 / 16; // portrait default until the camera reports its ratio

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / Math.max(edge1 - edge0, 1e-6));
  return t * t * (3 - 2 * t);
}

function randomRange(center: number, radius: number): number {
  return center + (Math.random() * 2 - 1) * Math.max(0, radius);
}

// Camera-feed calibration (rotation offset + source buffer orientation), persisted so a
// device is set up once. The buffer orientation is stable per device, so this sticks.
const CALIBRATION_KEY = 'lorenz:capture-calibration';

interface CaptureCalibration {
  rotation: number;
  sourceLandscape: boolean;
}

// A calibration object whose properties persist to localStorage on every write, so the
// Rotate/Aspect buttons (and the tuning sliders) that mutate gpu.captureParams are saved
// transparently. Reads the stored value on load; falls back to defaults if absent/blocked.
function createPersistedCalibration(): CaptureCalibration {
  const state: CaptureCalibration = { rotation: 0, sourceLandscape: true };
  try {
    const raw = localStorage.getItem(CALIBRATION_KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<CaptureCalibration>;
      if (typeof v.rotation === 'number') state.rotation = v.rotation & 3;
      if (typeof v.sourceLandscape === 'boolean') state.sourceLandscape = v.sourceLandscape;
    }
  } catch {
    // No localStorage (private mode, etc.) → defaults; persistence just no-ops.
  }
  const save = (): void => {
    try {
      localStorage.setItem(CALIBRATION_KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  };
  return {
    get rotation() {
      return state.rotation;
    },
    set rotation(v: number) {
      state.rotation = v;
      save();
    },
    get sourceLandscape() {
      return state.sourceLandscape;
    },
    set sourceLandscape(v: boolean) {
      state.sourceLandscape = v;
      save();
    },
  };
}
const ORBIT_RADIUS = 3.2;
const ORBIT_HEIGHT = 1.4;
const ORBIT_SPEED = 0.2;
const FOV_Y = (50 * Math.PI) / 180;

// Follow mode: ride just behind the newest deposit, looking ahead along the curve.
const FOLLOW_BACK = 0.6;
const FOLLOW_AHEAD = 1.2;
const FOLLOW_HEIGHT = 0.12;
const FOLLOW_SMOOTH = 0.12; // exponential smoothing toward the moving target
const FOLLOW_TANGENT_SMOOTH = 0.06; // stronger low-pass on the heading (anti-jitter)

export type DeviceLostHandler = (info: GPUDeviceLostInfo) => void;

export interface WebGPUHandlers {
  onDeviceLost?: DeviceLostHandler;
  // Surfaces async GPU validation errors, which otherwise render black silently
  // (common on WebKit/iOS where WGSL is validated more strictly than Chrome).
  onError?: (error: Error) => void;
}

export interface CameraCaptureStats {
  path: CameraSourcePath;
  copyCrop: string;
  copyCropState: CameraCopyCropState;
  imports: number;
  copies: number;
  copyFallbacks: number;
  depA: number;
  depB: number;
  hd: number;
}

export type CameraSourcePath = 'external' | 'copy';
export type CameraCopyCropState = 'idle' | 'probing' | 'detected' | 'none' | 'failed';

const CAMERA_PATH_STORAGE = 'lorenz:camera-path';
const COPY_PROBE_SAMPLE_COUNT = 3;
const COPY_PROBE_MAX_ATTEMPTS = 10;
const COPY_PROBE_BLACK_MAX = 2;
const COPY_PROBE_BLACK_RATIO = 0.98;
const COPY_PROBE_SKIP_BLACK_RATIO = 0.9;
const COPY_PROBE_ADJACENT_BLACK_RATIO = 0.45;
const COPY_PROBE_MIN_BAND_PX = 8;
const COPY_PROBE_ADJACENT_MIN_PX = 8;
const COPY_PROBE_ADJACENT_MAX_PX = 48;
const COPY_PROBE_ADJACENT_FRACTION = 0.04;
const COPY_PROBE_MAX_BAND_UV = 0.55;
const ZERO_COPY_CROP = new Float32Array(4);

interface CameraCopyProbeResult {
  crop: Float32Array;
  blackRatio: number;
}

function isAppleMobileCameraDevice(): boolean {
  return (
    /\b(iPhone|iPad|iPod)\b/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

function readCameraSourcePath(): CameraSourcePath {
  try {
    const url = new URL(window.location.href);
    const q = url.searchParams.get('cameraPath');
    if (q === 'copy' || q === 'external') return q;
    const stored = localStorage.getItem(CAMERA_PATH_STORAGE);
    if (stored === 'copy' || stored === 'external') return stored;
  } catch {
    /* keep the safe default */
  }
  return isAppleMobileCameraDevice() ? 'copy' : 'external';
}

function detectEdgeBand(ratios: Float32Array, reverse: boolean): number {
  const n = ratios.length;
  let edge = 0;
  while (edge < n) {
    const idx = reverse ? n - 1 - edge : edge;
    if (ratios[idx] < COPY_PROBE_BLACK_RATIO) break;
    edge++;
  }
  if (edge < COPY_PROBE_MIN_BAND_PX || edge / n > COPY_PROBE_MAX_BAND_UV) return 0;

  const adjacentCount = Math.min(
    Math.max(COPY_PROBE_ADJACENT_MIN_PX, Math.floor(n * COPY_PROBE_ADJACENT_FRACTION)),
    COPY_PROBE_ADJACENT_MAX_PX,
    n - edge,
  );
  if (adjacentCount <= 0) return 0;
  let adjacentBlack = 0;
  for (let i = 0; i < adjacentCount; i++) {
    const idx = reverse ? n - 1 - edge - i : edge + i;
    adjacentBlack += ratios[idx];
  }
  return adjacentBlack / adjacentCount <= COPY_PROBE_ADJACENT_BLACK_RATIO ? edge : 0;
}

function analyzeCameraCopyProbe(
  counts: Uint32Array,
  outputW: number,
  outputH: number,
): CameraCopyProbeResult {
  const colRatios = new Float32Array(outputW);
  const rowRatios = new Float32Array(outputH);
  for (let x = 0; x < outputW; x++) colRatios[x] = counts[x] / outputH;
  for (let y = 0; y < outputH; y++) rowRatios[y] = counts[outputW + y] / outputW;

  const crop = new Float32Array(4);
  crop[0] = detectEdgeBand(colRatios, false) / outputW;
  crop[1] = detectEdgeBand(rowRatios, false) / outputH;
  crop[2] = detectEdgeBand(colRatios, true) / outputW;
  crop[3] = detectEdgeBand(rowRatios, true) / outputH;
  return { crop, blackRatio: counts[outputW + outputH] / (outputW * outputH) };
}

function median(values: number[]): number {
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)] ?? 0;
}

function medianCameraCopyCrop(samples: Float32Array[]): Float32Array {
  const crop = new Float32Array(4);
  for (let i = 0; i < 4; i++) {
    crop[i] = median(samples.map((sample) => sample[i]));
  }
  return crop;
}

function formatCameraCopyCrop(crop: Float32Array): string {
  const fmt = (v: number): string => v.toFixed(3).replace(/\.?0+$/, '') || '0';
  return `${fmt(crop[0])},${fmt(crop[1])},${fmt(crop[2])},${fmt(crop[3])}`;
}

export class WebGPUContext {
  private destroyed = false;
  private loggedZeroSize = false;
  private loggedImportFail = false;
  // Live GPU texture-byte total (assigned from the createTexture wrapper in create()).
  private gpuMem: { textureBytes: number; byLabel: Map<string, number> } = {
    textureBytes: 0,
    byLabel: new Map(),
  };

  // Estimated MB of GPU texture memory we currently hold — for the diagnostic line.
  get gpuTextureMB(): number {
    return Math.round(this.gpuMem.textureBytes / 1e6);
  }

  // Per-label MB breakdown (biggest first) — logged once to see where the footprint goes.
  gpuBreakdown(): string {
    return [...this.gpuMem.byLabel.entries()]
      .filter(([, b]) => b > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([label, b]) => `${label}=${Math.round(b / 1e6)}MB`)
      .join(' ');
  }

  private readonly cameraSourcePath: CameraSourcePath = readCameraSourcePath();
  private readonly cameraCopyCrop = new Float32Array(4);
  private readonly cameraStats: CameraCaptureStats = {
    path: this.cameraSourcePath,
    copyCrop: formatCameraCopyCrop(ZERO_COPY_CROP),
    copyCropState: this.cameraSourcePath === 'copy' ? 'idle' : 'none',
    imports: 0,
    copies: 0,
    copyFallbacks: 0,
    depA: 0,
    depB: 0,
    hd: 0,
  };
  private cameraCopyTexture: GPUTexture | null = null;
  private cameraCopyView: GPUTextureView | null = null;
  private cameraCopyW = 0;
  private cameraCopyH = 0;
  private loggedCopyFail = false;
  private copyProbePipeline!: GPUComputePipeline;
  private copyProbeUniform!: GPUBuffer;
  private copyProbeCountsBuffer: GPUBuffer | null = null;
  private copyProbeReadbackBuffer: GPUBuffer | null = null;
  private copyProbeBind: GPUBindGroup | null = null;
  private copyProbeBindView: GPUTextureView | null = null;
  private copyProbeBufferSize = 0;
  private copyProbeOutputW = 0;
  private copyProbeOutputH = 0;
  private copyProbeInFlight = false;
  private copyProbeResolved = false;
  private copyProbeLoggedStart = false;
  private copyProbeAttempts = 0;
  private copyProbeGeneration = 0;
  private copyProbeRotation = -1;
  private readonly copyProbeUniformData = new Float32Array(8);
  private readonly copyProbeSamples: Float32Array[] = [];

  cameraCaptureStats(): CameraCaptureStats {
    return { ...this.cameraStats };
  }

  // Depth buffer for opaque cards (nearest occludes — keeps frames readable in
  // dense regions instead of summing into a bright blob). Resized with the canvas.
  private depthTexture: GPUTexture | null = null;
  private depthView: GPUTextureView | null = null;
  private depthW = 0;
  private depthH = 0;

  // Reusable camera scratch (no per-frame allocation).
  private readonly cameraData = new Float32Array(CAMERA_FLOATS);
  private readonly view: Mat4 = new Float32Array(16);
  private readonly proj: Mat4 = new Float32Array(16);
  private readonly viewProj: Mat4 = new Float32Array(16);
  private readonly eye: Vec3 = [0, 0, 0];
  private readonly center: Vec3 = [0, 0, 0];
  // Smoothed follow-camera target (lerped toward the newest deposit each frame).
  private readonly followEye: Vec3 = [0, 0, 0];
  private readonly followCenter: Vec3 = [0, 0, 0];
  private readonly followTangent: Vec3 = [0, 0, 1];
  private followInit = false;

  // Auto-frame the global (orbit) view to the attractor's occupied space, aspect-
  // aware and heavily smoothed (a slow drift, never a pump). Off → the fixed orbit.
  readonly frameParams = { enabled: true, margin: 0.85, smooth: 0.03, height: 0.35 };
  private readonly frameCenter: Vec3 = [0, 0, 0];
  private frameRadius = ORBIT_RADIUS;
  private frameInit = false;

  // Live-tunable band display. widthMult scales the (auto, no-stretch) tile
  // thickness; mode (0 = A wide / 1 = B upright) orients the tile vs the curve.
  readonly bandParams = { widthMult: 1.0, mode: 1 };

  // Per-deposit shape: 0 = plane (the ribbon band), 1 = cube, 2 = sphere. size +
  // spin feed shapeMesh.modulation() (the future per-deposit / audio hook).
  shapeMode = 0;
  readonly shapeParams = { size: 0.05, spin: 0.9 };

  // Progressive shape transition: a wave that emanates from the head (newest deposit)
  // and sweeps to the tail, shrinking the outgoing form and growing the incoming one.
  // shapeMode (above) is the incoming/target form; morphFrom is the outgoing one.
  // The front rides a fixed-duration clock (morphParams.dur), decoupled from scroll
  // speed but mapped onto the age axis in-shader. morphFront >= 1 ⇒ at rest.
  private morphFrom = 0;
  private morphFront = 1;
  readonly morphParams = { dur: 0.8, band: 0.15 };

  // Traveling glow: a soft pulse rides each curve's age axis head→tail (slower than
  // the morph), brightening and slightly enlarging whatever it crosses, then idles a
  // random gap before the next pass. One clock per curve so A and B never sync up.
  // width = half-width in age units, glow = emissive strength, scale = size boost.
  readonly sweepParams = { width: 0.12, glow: 2.2, scale: 0.3 };
  private readonly sweepA = new SweepGlow();
  private readonly sweepB = new SweepGlow(1.7); // staggered so it leads/lags curve A

  // Comet: a sphere + cube streak from each curve's head to its tail, spiralling
  // around it (in phase opposition) and spinning. As the body passes over a point it
  // ignites that deposit's WAKE — the SAME tail-dissolution particle effect (lifetime,
  // count, dispersion, size, spin all taken from `particleParams`), just triggered by
  // the comet's passage. Periodic or manual launch. Look params shared A/B; timing per
  // curve (A and B fire independently). orbit = spiral radius, orbitSpeed = spiral rate,
  // spin = body tumble, period = auto-gap scale, duration = head→tail seconds, wake =
  // trailing particles per deposit (0 = off; their look comes from the tail's sliders).
  readonly cometParams = {
    enabled: true,
    period: 1.0,
    duration: 8.0, // seconds head→tail — slow by default (slider goes to 20)
    orbit: 0.18,
    orbitSpeed: 2.0,
    spin: 1.0,
    size: 0.08,
    wake: 6, // wake particles per deposit (density); 0 = no wake
    wakeSize: 0.03, // wake particle size (the rest of the look comes from the tail sliders)
  };
  private readonly cometA = new Comet();
  private readonly cometB = new Comet(3.1); // desynced from curve A

  // Global display: plane opacity (alpha-over, doesn't over-brighten) and the
  // emissive tail glow that marks the dissolving trail start.
  readonly displayParams = { opacity: 1.0, glow: 3.0, glowStart: 0.8 };

  // Slow-mo engagement (0..1), set by App each frame. Drives a curve-glow boost and
  // the composite ripple; 0 = normal.
  slowmoAmount = 0;

  // Live audio features (0..1), written by App each frame from the FFT engine.
  // Read by ribbon/shape/particle shaders to tint, grow and shimmer the curve.
  readonly audioState = { level: 0, bass: 0, mid: 0, treble: 0, centroid: 0, beat: 0 };
  // Audio → visuals tuning (all live-sliderable). `enabled` gates the whole audio
  // contribution in-shader. grow: bass/beat → ribbon width + shape/particle size.
  // tint/tailStart/tailEnd: palette tint over an age band (start 0 = whole curve).
  // hueShift/hueRange/palette: gradient palette driven by the spectral centroid.
  // spin: treble → extra shape/particle spin. part*: dissolution-particle tint/pop.
  readonly audioParams = {
    enabled: false,
    grow: 0.6,
    tint: 0.7,
    tailStart: 0.0,
    tailEnd: 0.2,
    hueShift: 0.0,
    hueRange: 0.6,
    spin: 0.5,
    palette: 0,
    partTint: 0.7,
    partHueShift: 0.2,
    partGrow: 0.8,
    edge: 0.08, // width of the edge-tint band on the ribbon/shape borders
  };

  // Transient view zoom (1 = origin, up to a max), driven by pinch/wheel and eased
  // back to 1 by App's ZoomControl. Applied as an FOV scale → works in every mode.
  zoom = 1;
  // Alpha-blended ribbon + shape variants (depth-write off) for opacity < 1.
  private pipelineTransparent!: GPURenderPipeline;
  private shapePipelineTransparent!: GPURenderPipeline;

  // Tail dissolution particles (drifting cubes/spheres). enabled toggles the pass;
  // size/drift/spin/start feed particles.wgsl. start = the dissolve age threshold.
  readonly particleParams = { enabled: true, size: 0.03, drift: 0.2, spin: 2.1, start: 0.8 };
  private particlePipeline!: GPURenderPipeline;
  private particleParamsBuffer!: GPUBuffer;
  private particleBindGroup!: GPUBindGroup;
  private particleBindGroup2!: GPUBindGroup;
  private readonly particleData = new Float32Array(4);

  // Leading-edge "crest": 3 lines of audio-reactive cubes at the newest deposit so
  // the texture emerges from a living front instead of out of nowhere (curve 1 only).
  readonly headParams = { enabled: true, size: 0.01, gap: 0.03, recul: 0.0, reach: 0.03 };
  private headPipeline!: GPURenderPipeline;
  private headParamsBuffer!: GPUBuffer;
  private headBindGroup!: GPUBindGroup;
  private headBindGroup2!: GPUBindGroup; // crest on the second crossing curve
  private readonly headData = new Float32Array(4);
  private shapePipeline!: GPURenderPipeline;
  private shapeParamsBuffer!: GPUBuffer;
  private cubeBuffer!: GPUBuffer;
  private sphereBuffer!: GPUBuffer;
  private cubeVertexCount = 0;
  private sphereVertexCount = 0;
  private shapeBindGroup!: GPUBindGroup;
  private shapeBindGroup2!: GPUBindGroup;
  private readonly shapeData = new Float32Array(4);
  private cometPipeline!: GPURenderPipeline;
  // One uniform buffer per simultaneous draw — 4 per curve (principal cube, principal
  // sphere, then the wake behind each of the two bodies) × 2 curves = 8. queue.writeBuffer
  // writes all land before the single submit, so each draw needs its own buffer; reusing
  // one would leave every draw reading the last payload. Index map:
  // [A-cube, A-sphere, A-wake(cube body), A-wake(sphere body), B-cube, B-sphere, B-wake0, B-wakeπ].
  private cometUniforms: GPUBuffer[] = [];
  private cometBindGroups: GPUBindGroup[] = [];
  private readonly cometData = new Float32Array(20);
  private cometScrollA = 0; // sub-deposit scroll phase per curve (smooths the ride)
  private cometScrollB = 0;

  // Group-1 morph uniforms: one buffer per side of the transition, written each
  // frame as [front w, band, mode (0 in / 1 out), active]. Bind groups are built
  // from a shared layout so they work with both the ribbon and shape pipelines.
  private morphInBuf!: GPUBuffer;
  private morphOutBuf!: GPUBuffer;
  private morphInBind!: GPUBindGroup;
  private morphOutBind!: GPUBindGroup;
  private readonly morphInData = new Float32Array(4);
  private readonly morphOutData = new Float32Array(4);

  // Camera-feed calibration. `rotation` is a 0..3 manual 90° offset. `sourceLandscape`
  // is the platform's UNKNOWABLE buffer orientation: iOS/desktop hand us a landscape
  // sensor buffer (true), Android hands an already-portrait buffer (false). The two
  // report identical videoWidth/Height, so this can't be auto-detected — the user
  // calibrates it from the WYSIWYG preview (the Aspect button). See captureGeometry.
  // Persisted to localStorage so each device is calibrated only once.
  readonly captureParams = createPersistedCalibration();

  // Camera colour grade (applied at capture in frameCapture.wgsl → bakes into the
  // ring/HD/still). The hue can "breathe": base + time drift + eased Lorenz/audio,
  // mirroring the synthetic source's hue evolution. Live-tunable via the Tune panel.
  readonly cameraColorParams = {
    enabled: false,
    hue: 0, // base hue shift (turns)
    hueDrift: 0, // hue drift speed (turns/s)
    hueLorenz: 0, // Lorenz pz → hue
    hueAudio: 0, // audio centroid → hue
    saturation: 1,
    vibrance: 0,
    contrast: 1,
    exposure: 1,
    lift: 0,
  };
  private readonly cameraGradeScratch = new Float32Array(7);
  private readonly camGradeEased = { lpz: 0, cent: 0 };

  // Start-screen camera preview: a 1-layer ring captured with the engine's exact
  // rotation, then presented to a small canvas — so the preview is WYSIWYG with the
  // ribbon/HD across platforms. Built lazily on first renderCameraPreview() call.
  private previewRing: FrameRingBuffer | null = null;
  private previewPipeline: GPURenderPipeline | null = null;
  private previewUniform: GPUBuffer | null = null;
  private previewUniformData = new Float32Array(4);
  private previewSlot = new Int32Array([0]);
  private previewCtx: GPUCanvasContext | null = null;
  private previewCanvasEl: HTMLCanvasElement | null = null;
  private previewInitStarted = false;

  // Live-tunable follow-camera parameters (exposed for the tuning panel).
  readonly followParams = {
    back: FOLLOW_BACK,
    ahead: FOLLOW_AHEAD,
    height: FOLLOW_HEIGHT,
    smooth: FOLLOW_SMOOTH,
    headingSmooth: FOLLOW_TANGENT_SMOOTH,
  };

  // Live-tunable starfield (procedural dome in background.wgsl). Maxed by default;
  // `audio` scales how much the music brightens (level) + flashes (beat) the stars.
  readonly starParams = { density: 160, brightness: 3.0, audio: 1.0 };

  // Live-tunable background still effect (grain amount of the dissolve montage).
  readonly bgParams = { grain: 0.5 };

  // Lorenz-attractor dissolve: glowing-front intensity, base butterfly scale, and
  // how much the mask scales up/down across the screen during the dissolve.
  readonly dissolveParams = { frontGlow: 0.8, fieldScale: 1.05, zoom: 0.8 };

  // CPU-generated Lorenz butterfly density, sampled as the dissolve mask.
  private fieldTexture!: GPUTexture;

  // Live-tunable ribbon smoke/trail: decay (per-frame fade), ink blob size +
  // intensity, how strongly the trail smears the still, and the coloured halo's
  // intensity + hue-drift speed.
  readonly trailParams = {
    decay: 0.92,
    inkSize: 0.05,
    inkIntensity: 0.5,
    smear: 0.02,
    halo: 0.6,
    hueSpeed: 0.08,
  };

  // Trail buffer + the two passes that maintain it (fade then ink). Only run
  // while a still is visible; trailWasActive tracks the clear-on-appear edge.
  private trailTexture: GPUTexture | null = null;
  private trailView: GPUTextureView | null = null;
  private trailW = 0;
  private trailH = 0;
  private trailWasActive = false;
  private inkPipeline!: GPURenderPipeline;
  private fadePipeline!: GPURenderPipeline;
  private inkBindGroup!: GPUBindGroup;

  // Bloom post-process. enabled toggles the offscreen+glow path; threshold/intensity
  // shape the glow; audio boosts the intensity on the beat. The scene renders to
  // sceneTexture, then bright→blur→blur (half-res ping-pong) → composite to canvas.
  readonly bloomParams = { enabled: true, threshold: 0.55, intensity: 0.85, audio: 0.6 };
  readonly pixelRippleParams = {
    enabled: true,
    amount: 0.02,
    amountVar: 0.012,
    duration: 1,
    durationVar: 0.45,
    frequency: 22,
    frequencyVar: 8,
    speed: 0.5,
    speedVar: 1.2,
    slowmo: 2.2,
  };
  // Random bloom flashes ("camera-flash pops"): a Poisson trigger fires a short pulse
  // that dips the threshold (more pixels cross into the glow) AND spikes the intensity,
  // then recovers — both over ~duration seconds. Driven by advanceFlash(dt) on RAW
  // wall-clock dt (independent of the slow-mo warp), so a peak stays ~200-300 ms even
  // when the music slows. rate = avg flashes/sec; drop = threshold dip at the peak;
  // boost = extra intensity multiplier at the peak.
  readonly bloomFlash = { enabled: true, rate: 0.6, duration: 0.25, drop: 0.4, boost: 0.9 };
  private flashEnv = 0; // current pulse envelope 0..1
  private flashElapsed = 0; // seconds into the active flash
  private flashActive = false;
  private flashCountdown = 1.5; // seconds until the next trigger (1st one ~1.5 s in)
  private pixelRippleElapsed = Infinity;
  private pixelRippleDuration = 1;
  private pixelRippleStrength = 0;
  private pixelRipplePhase = 0;
  private pixelRippleFrequency = 22;
  private pixelRippleSpeed = 0.5;
  readonly exposureTrailParams = {
    enabled: true,
    amount: 0.94,
    duration: 20,
    decay: 0.68,
    exposure: 2,
  };
  private exposureTrailElapsed = Infinity;
  private exposureTrailDuration = 3.2;
  private exposureTrailStrength = 1;
  private exposureTrailNeedsSeed = false;
  private exposureTrailManualPhase: number | null = null;
  private canvasFormat!: GPUTextureFormat;
  private brightPipeline!: GPURenderPipeline;
  private blurPipeline!: GPURenderPipeline;
  private compositePipeline!: GPURenderPipeline;
  private bloomUniform!: GPUBuffer;
  private readonly bloomData = new Float32Array(BLOOM_FLOATS); // params + slow ripple + event ripple
  private sceneTexture: GPUTexture | null = null;
  private sceneView: GPUTextureView | null = null;
  private bloomA: GPUTexture | null = null;
  private bloomB: GPUTexture | null = null;
  private bloomAView: GPUTextureView | null = null;
  private bloomBView: GPUTextureView | null = null;
  private bloomW = 0;
  private bloomH = 0;
  private brightBind!: GPUBindGroup; // scene → bloomA
  private blurBindA!: GPUBindGroup; // bloomA → bloomB
  private blurBindB!: GPUBindGroup; // bloomB → bloomA
  private compositeBind!: GPUBindGroup; // scene + bloomA → canvas
  private temporalPipeline!: GPURenderPipeline;
  private temporalUniform!: GPUBuffer;
  private readonly temporalData = new Float32Array(TEMPORAL_FLOATS);
  private temporalTextureA: GPUTexture | null = null;
  private temporalTextureB: GPUTexture | null = null;
  private temporalViewA: GPUTextureView | null = null;
  private temporalViewB: GPUTextureView | null = null;
  private temporalBindA!: GPUBindGroup; // history A → output B
  private temporalBindB!: GPUBindGroup; // history B → output A
  private temporalReadIndex = 0;
  private temporalW = 0;
  private temporalH = 0;

  // Present target: the final composite renders into this owned texture, then a blit
  // copies it to the swapchain canvas. The canvas is what the video export records from.
  private blitPipeline!: GPURenderPipeline;
  // Debug ripple-grid overlay (dev): a flat screen-space lattice the bloom composite
  // warps, to make the slow-mo ripple legible.
  private debugGridPipeline!: GPURenderPipeline;
  private maskViewPipeline!: GPURenderPipeline;
  private presentTexture: GPUTexture | null = null;
  private presentView: GPUTextureView | null = null;
  private blitBind: GPUBindGroup | null = null;
  // Offscreen capture target for the video export: the composite is blitted into THIS
  // (a canvas we own, never presented) so frames can be grabbed without ever reading the
  // live swapchain canvas — which stalls/corrupts presentation on iOS Safari.
  private captureCanvas: OffscreenCanvas | null = null;
  private captureCtx: GPUCanvasContext | null = null;
  private captureW = 0;
  private captureH = 0;

  // Fullscreen dissolve background state, written by App each frame from
  // StillCycle. reveal 0 → only stars; layer indexes the HD still pool;
  // fieldIndex picks a butterfly view and hueOffset a base colour (per appearance).
  readonly backgroundState = { reveal: 0, layer: 0, fieldIndex: 0, hueOffset: 0 };

  // Background pass resources (stars + dissolving HD still), drawn before the
  // ribbon with depth writes off. hd is a higher-res FrameRingBuffer reused as
  // the still pool. bgBindGroup is rebuilt when hd resizes (its arrayView changes).
  private hd!: FrameRingBuffer;
  // Procedural source feeding the ring + HD pool when the camera is off.
  private synth!: SyntheticSource;
  private bgPipeline!: GPURenderPipeline;
  private bgUniformBuffer!: GPUBuffer;
  private bgBindGroup!: GPUBindGroup;
  private readonly bgData = new Float32Array(BG_FLOATS);

  // Deformation grid: a line lattice (floor plane) displaced by the motion field →
  // the gesture's influence made visible. Idle ripple (audio + idle floor) keeps it
  // alive without input; gesture (fieldState) leans/swirls it. Tunable look.
  private gridPipeline!: GPURenderPipeline;
  private gridUniformBuffer!: GPUBuffer;
  private gridBindGroup!: GPUBindGroup;
  private gridVertexBuffer!: GPUBuffer;
  private gridVertexCount = 0;
  private readonly gridData = new Float32Array(GRID_FLOATS);
  readonly gridParams = {
    enabled: true,
    idle: 0.3, // baseline ripple amplitude with no audio (keeps it alive)
    height: 0.4, // fBm ripple height (× amp)
    noiseScale: 1.4,
    flow: 0.12, // ripple animation speed
    tilt: 0.15, // gesture push → sheet lean
    swirl: 0.5, // gesture twist → centre swirl (rad)
    opacity: 0.32,
    rainbow: true,
    rainbowDuration: 3.6,
    rainbowIntensity: 1.25,
    rainbowWaves: 3,
    rainbowHeight: 0.18,
    rainbowSpeed: 1,
    rainbowSharpness: 11,
    rainbowHueSpeed: 1.35,
  };
  private gridRainbowElapsed = Infinity;
  private gridRainbowDuration = 1;
  private gridRainbowStrength = 0;
  private gridRainbowSeed = 0;
  // Smoothed motion (tiltX, tiltY, twist) written by App each frame → grid gesture.
  readonly fieldState = { pushX: 0, pushY: 0, swirl: 0 };

  // Camera basis cached for the background view-ray reconstruction.
  private readonly camRight: Vec3 = [1, 0, 0];
  private readonly camUp: Vec3 = [0, 1, 0];
  private readonly camForward: Vec3 = [0, 0, 1];
  // HD pool slot to capture into next frame (-1 = none), set via captureStillInto.
  private pendingStillCapture = -1;
  // Which source feeds that pending still: the synthetic source (true) or the camera
  // (false). App picks it so the split-mode background montage shows both materials.
  private pendingStillFromSynth = false;
  private readonly hdSlotScratch = new Int32Array(1);

  // Second crossing curve (generative, age-coloured, rotated). Its own camera
  // uniform (different rotation/tint/ribbon params) + deposits buffer + bind group.
  readonly curve2Params = {
    enabled: true,
    angle: Math.PI / 2,
    tint: [0.45, 1.1, 0.75] as [number, number, number],
  };
  // Key-frame glow: the ribbon tile matching an HD background still pulses with an
  // animated coloured glow (see ribbon.wgsl). hue is a 0..1 palette position.
  readonly keyParams = { glow: 1.4, freq: 9.0, hue: 0.5, tint: 0.7 };

  // Debug / layer-decomposition mode (dev): per-layer gates + a forced ripple grid
  // for capturing pedagogical screenshots. Defaults = normal.
  curve1Enabled = true;
  debugStars = true;
  debugStill = true;
  debugRipple = false;
  debugRippleAmp = 0.02;
  // Source inspector: 0 off, 1 raw splat, 2 colorized synth (overwrites the composite).
  debugSource = 0;
  // Background dissolve scrub: -1 = auto (StillCycle drives it), else forces reveal 0..1.
  debugReveal = -1;
  // Butterfly dissolve-mask viewer: -1 off, else the Lorenz-field layer index to show.
  debugMask = -1;
  private cameraBuffer2!: GPUBuffer;
  private depositsBuffer2!: GPUBuffer;
  private cameraBindGroup2!: GPUBindGroup;
  // Curve B's OWN camera-frame ring. B's head/speed are independent of A's, so it
  // can't share A's ring coherently — it would just show A's live writes. Each of
  // B's deposits captures into ring2, so every B point freezes its own instant.
  private ring2!: FrameRingBuffer;

  // Rebuilt when the ring resizes (its arrayView changes).
  private cameraBindGroup: GPUBindGroup;

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly device: GPUDevice,
    private readonly context: GPUCanvasContext,
    private readonly pipeline: GPURenderPipeline,
    private readonly cameraBuffer: GPUBuffer,
    private readonly sampler: GPUSampler,
    private depositsBuffer: GPUBuffer,
    private readonly ring: FrameRingBuffer,
    private capacity: number,
  ) {
    this.cameraBindGroup = this.buildCameraBindGroup(cameraBuffer, depositsBuffer);
  }

  private buildCameraBindGroup(
    cameraBuffer: GPUBuffer,
    depositsBuffer: GPUBuffer,
    ring: FrameRingBuffer = this.ring,
  ): GPUBindGroup {
    return this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: cameraBuffer } },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: ring.arrayView },
        { binding: 3, resource: { buffer: depositsBuffer } },
      ],
    });
  }

  private buildShapeBindGroup(
    cameraBuffer: GPUBuffer,
    depositsBuffer: GPUBuffer,
    ring: FrameRingBuffer = this.ring,
  ): GPUBindGroup {
    return this.device.createBindGroup({
      layout: this.shapePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: cameraBuffer } },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: ring.arrayView },
        { binding: 3, resource: { buffer: depositsBuffer } },
        { binding: 4, resource: { buffer: this.shapeParamsBuffer } },
      ],
    });
  }

  // Comet bind group: same layout as the shape mesh (cam / sampler / ring /
  // deposits) with the comet uniform at binding 4. One per (curve, shape) draw.
  private buildCometBindGroup(
    cameraBuffer: GPUBuffer,
    depositsBuffer: GPUBuffer,
    cometUniform: GPUBuffer,
    ring: FrameRingBuffer = this.ring,
  ): GPUBindGroup {
    return this.device.createBindGroup({
      layout: this.cometPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: cameraBuffer } },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: ring.arrayView },
        { binding: 3, resource: { buffer: depositsBuffer } },
        { binding: 4, resource: { buffer: cometUniform } },
      ],
    });
  }

  // Particles reuse the shape pipeline's bind group layout (same bindings) but
  // bind the particle params at binding 4.
  private buildParticleBindGroup(
    cameraBuffer: GPUBuffer,
    depositsBuffer: GPUBuffer,
    ring: FrameRingBuffer = this.ring,
  ): GPUBindGroup {
    return this.device.createBindGroup({
      layout: this.particlePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: cameraBuffer } },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: ring.arrayView },
        { binding: 3, resource: { buffer: depositsBuffer } },
        { binding: 4, resource: { buffer: this.particleParamsBuffer } },
      ],
    });
  }

  // Head crest reuses the same bind-group layout, with its own params at binding 4.
  private buildHeadBindGroup(
    cameraBuffer: GPUBuffer,
    depositsBuffer: GPUBuffer,
    ring: FrameRingBuffer = this.ring,
  ): GPUBindGroup {
    return this.device.createBindGroup({
      layout: this.headPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: cameraBuffer } },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: ring.arrayView },
        { binding: 3, resource: { buffer: depositsBuffer } },
        { binding: 4, resource: { buffer: this.headParamsBuffer } },
      ],
    });
  }

  // Rebuild ribbon + shape + particle bind groups (they reference the ring's
  // arrayView, which changes on resize, and each curve's own deposits buffer).
  private rebuildCameraBindGroups(): void {
    this.cameraBindGroup = this.buildCameraBindGroup(this.cameraBuffer, this.depositsBuffer);
    this.cameraBindGroup2 = this.buildCameraBindGroup(
      this.cameraBuffer2,
      this.depositsBuffer2,
      this.ring2,
    );
    this.shapeBindGroup = this.buildShapeBindGroup(this.cameraBuffer, this.depositsBuffer);
    this.shapeBindGroup2 = this.buildShapeBindGroup(
      this.cameraBuffer2,
      this.depositsBuffer2,
      this.ring2,
    );
    this.particleBindGroup = this.buildParticleBindGroup(this.cameraBuffer, this.depositsBuffer);
    this.particleBindGroup2 = this.buildParticleBindGroup(
      this.cameraBuffer2,
      this.depositsBuffer2,
      this.ring2,
    );
    this.headBindGroup = this.buildHeadBindGroup(this.cameraBuffer, this.depositsBuffer);
    this.headBindGroup2 = this.buildHeadBindGroup(
      this.cameraBuffer2,
      this.depositsBuffer2,
      this.ring2,
    );
    // Comet: indices [0..3] = curve A's [principal cube, principal sphere, wake behind
    // cube body, wake behind sphere body] and share curve A's camera/deposits/ring;
    // [4..7] = curve B's. Each draw gets its own uniform buffer (see field).
    this.cometBindGroups = [
      this.buildCometBindGroup(this.cameraBuffer, this.depositsBuffer, this.cometUniforms[0]),
      this.buildCometBindGroup(this.cameraBuffer, this.depositsBuffer, this.cometUniforms[1]),
      this.buildCometBindGroup(this.cameraBuffer, this.depositsBuffer, this.cometUniforms[2]),
      this.buildCometBindGroup(this.cameraBuffer, this.depositsBuffer, this.cometUniforms[3]),
      this.buildCometBindGroup(
        this.cameraBuffer2,
        this.depositsBuffer2,
        this.cometUniforms[4],
        this.ring2,
      ),
      this.buildCometBindGroup(
        this.cameraBuffer2,
        this.depositsBuffer2,
        this.cometUniforms[5],
        this.ring2,
      ),
      this.buildCometBindGroup(
        this.cameraBuffer2,
        this.depositsBuffer2,
        this.cometUniforms[6],
        this.ring2,
      ),
      this.buildCometBindGroup(
        this.cameraBuffer2,
        this.depositsBuffer2,
        this.cometUniforms[7],
        this.ring2,
      ),
    ];
  }

  // Hard ceiling for the ribbon length (= the device's texture-array layer
  // limit, which we requested up to MAX_RIBBON). Drives the Length slider max.
  get maxLayers(): number {
    return this.device.limits.maxTextureArrayLayers;
  }

  // Resize the ribbon = number of frame/card slots kept along the curve. Reallocs
  // the deposits storage buffer and the frame ring, then rebuilds the bind group
  // (both resources change). The LorenzMapper must be resized to the same
  // capacity (see App). Cheap enough to call from a slider's commit.
  setCapacity(capacity: number): void {
    if (this.destroyed || capacity === this.capacity) return;
    this.capacity = capacity;
    this.depositsBuffer.destroy();
    this.depositsBuffer = this.device.createBuffer({
      size: capacity * INSTANCE_FLOATS * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.ring.setCapacity(capacity);
    this.rebuildCameraBindGroups();
    this.inkBindGroup = this.buildInkBindGroup();
  }

  static async create(
    canvas: HTMLCanvasElement,
    instanceCapacity: number,
    handlers: WebGPUHandlers = {},
  ): Promise<WebGPUContext> {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error('No WebGPU adapter available');
    }
    // Request enough texture-array layers for the longest ribbon the slider
    // allows, clamped to what the adapter actually supports (≥256 is guaranteed).
    const maxLayers = Math.min(MAX_RIBBON, adapter.limits.maxTextureArrayLayers);
    const device = await adapter.requestDevice({
      requiredLimits: { maxTextureArrayLayers: maxLayers },
    });

    device.addEventListener('uncapturederror', (event) => {
      const err = (event as GPUUncapturedErrorEvent).error;
      handlers.onError?.(new Error(`GPU ${err.constructor.name}: ${err.message}`));
    });

    // Track the live total of GPU texture bytes we allocate (no WebGPU VRAM query exists).
    // Each create adds its estimated size; the wrapped destroy() subtracts it. Surfaced in the
    // diagnostic line to reveal the baseline footprint and any slow creep over a long session.
    const gpuMem = { textureBytes: 0, byLabel: new Map<string, number>() };
    const createTexture = device.createTexture.bind(device);
    device.createTexture = (desc: GPUTextureDescriptor): GPUTexture => {
      const tex = createTexture(desc);
      const bytes = estimateTextureBytes(desc);
      const label = desc.label || 'unlabelled';
      gpuMem.textureBytes += bytes;
      gpuMem.byLabel.set(label, (gpuMem.byLabel.get(label) ?? 0) + bytes);
      const destroy = tex.destroy.bind(tex);
      tex.destroy = (): undefined => {
        gpuMem.textureBytes -= bytes;
        gpuMem.byLabel.set(label, (gpuMem.byLabel.get(label) ?? 0) - bytes);
        return destroy();
      };
      return tex;
    };

    const context = canvas.getContext('webgpu');
    if (!context) {
      throw new Error('Could not get a WebGPU canvas context');
    }

    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'premultiplied' });

    const module = await createModule(device, ribbonShader);
    // Group-1 morph uniform layout, shared by the ribbon and shape pipelines. One
    // layout object → the morph bind groups built from it work with both families.
    const morphBGL = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }],
    });
    // Explicit layout shared by the opaque + transparent ribbon pipelines, so one
    // bind group works with both (auto layouts wouldn't be cross-compatible).
    const ribbonBindGroupLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { viewDimension: '2d-array' } },
        { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      ],
    });
    const ribbonLayout = device.createPipelineLayout({
      bindGroupLayouts: [ribbonBindGroupLayout, morphBGL],
    });
    const pipeline = device.createRenderPipeline({
      layout: ribbonLayout,
      // No vertex buffers: the vertex shader reads deposits from a storage buffer
      // so each segment instance can fetch both of its endpoints.
      vertex: { module, entryPoint: 'vs' },
      fragment: {
        module,
        entryPoint: 'fs',
        // Opaque cards: no blend. Overlaps are resolved by the depth test so the
        // nearest frame stays crisp instead of summing.
        targets: [{ format }],
      },
      primitive: { topology: 'triangle-strip' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    });

    // Same ribbon, alpha-over blended with depth-write off → see through the tangle
    // of planes (used when opacity < 1). Alpha-over doesn't over-brighten.
    const pipelineTransparent = device.createRenderPipeline({
      layout: ribbonLayout,
      vertex: { module, entryPoint: 'vs' },
      fragment: {
        module,
        entryPoint: 'fs',
        targets: [
          {
            format,
            blend: {
              color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-strip' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' },
    });

    // capLongEdge: the ribbon rings hold ~256 layers each, so a landscape camera would triple
    // their GPU footprint (the iPad crash). Bound the layer area to portrait-equivalent.
    // (undefined layerHeight → the ring default; the trailing `true` enables the area cap.)
    const ring = await FrameRingBuffer.create(
      device,
      instanceCapacity,
      DEFAULT_ASPECT,
      undefined,
      true,
    );
    // Curve B's own ring (fixed capacity; B never resizes with the Length slider).
    const ring2 = await FrameRingBuffer.create(
      device,
      CURVE2_CAPACITY,
      DEFAULT_ASPECT,
      undefined,
      true,
    );
    const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

    const cameraBuffer = device.createBuffer({
      size: CAMERA_FLOATS * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const depositsBuffer = device.createBuffer({
      size: instanceCapacity * INSTANCE_FLOATS * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    // Second crossing curve: its own camera uniform + deposits buffer.
    const cameraBuffer2 = device.createBuffer({
      size: CAMERA_FLOATS * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const depositsBuffer2 = device.createBuffer({
      size: CURVE2_CAPACITY * INSTANCE_FLOATS * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    // Background pass: a fullscreen triangle drawing stars + the dissolving still,
    // before the ribbon, with depth writes off (it never occludes the ribbon).
    const bgModule = await createModule(device, backgroundShader);
    const bgPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: bgModule, entryPoint: 'vs' },
      fragment: { module: bgModule, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'always' },
    });
    const bgUniformBuffer = device.createBuffer({
      size: BG_FLOATS * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Deformation grid: additive line lattice, reads viewProj from the camera
    // uniform (binding 0) + a tiny grid uniform (binding 1). Drawn after the
    // background, before the ribbon, depth-tested but no depth write.
    const gridModule = await createModule(device, gridShader);
    const gridBGL = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
        {
          binding: 1,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
      ],
    });
    const gridPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [gridBGL] }),
      vertex: {
        module: gridModule,
        entryPoint: 'vs',
        buffers: [
          { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
        ],
      },
      fragment: {
        module: gridModule,
        entryPoint: 'fs',
        targets: [
          {
            format,
            // Additive glow: brightness scales with the uniform's opacity (alpha).
            blend: {
              color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
            },
          },
        ],
      },
      primitive: { topology: 'line-list' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' },
    });
    const grid = createGrid();
    const gridVertexBuffer = device.createBuffer({
      size: grid.data.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(gridVertexBuffer, 0, grid.data);
    const gridUniformBuffer = device.createBuffer({
      size: GRID_FLOATS * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const hd = await FrameRingBuffer.create(device, HIGHRES_POOL, DEFAULT_ASPECT, HIGHRES_HEIGHT);
    // Procedural source for the camera-off path (fed into ring + ring2 + hd).
    const synth = await SyntheticSource.create(device, DEFAULT_ASPECT);

    // Lorenz butterfly dissolve masks: generate a stack of views once and upload.
    const fields = generateLorenzFields(FIELD_COUNT, FIELD_SIZE);
    const fieldTexture = device.createTexture({
      label: 'lorenz-field',
      size: [fields.size, fields.size, fields.count],
      format: 'r8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture(
      { texture: fieldTexture },
      fields.data,
      { bytesPerRow: fields.size, rowsPerImage: fields.size },
      { width: fields.size, height: fields.size, depthOrArrayLayers: fields.count },
    );

    // Trail passes: fade (multiply by blend-constant) then ink (additive blobs).
    const inkModule = await createModule(device, ribbonInkShader);
    const inkPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: inkModule, entryPoint: 'vs' },
      fragment: {
        module: inkModule,
        entryPoint: 'fs',
        targets: [
          {
            format: TRAIL_FORMAT,
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-strip' },
    });
    const fadeModule = await createModule(device, trailFadeShader);
    const fadePipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: fadeModule, entryPoint: 'vs' },
      fragment: {
        module: fadeModule,
        entryPoint: 'fs',
        targets: [
          {
            format: TRAIL_FORMAT,
            // result = src*0 + dst*constant → multiply the trail by the decay.
            blend: {
              color: { srcFactor: 'zero', dstFactor: 'constant', operation: 'add' },
              alpha: { srcFactor: 'zero', dstFactor: 'constant', operation: 'add' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list' },
    });

    // Per-deposit shape meshes (cube / sphere) — instanced over the deposits.
    const shapeModule = await createModule(device, shapeMeshShader);
    const shapeBGL = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { viewDimension: '2d-array' } },
        { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 4, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
      ],
    });
    const shapeLayout = device.createPipelineLayout({ bindGroupLayouts: [shapeBGL] });
    // Shape meshes also read the group-1 morph uniform; particles/head reuse the
    // plain shapeLayout below and stay untouched.
    const shapeMorphLayout = device.createPipelineLayout({
      bindGroupLayouts: [shapeBGL, morphBGL],
    });
    const shapeVertexBuffers: GPUVertexBufferLayout[] = [
      {
        arrayStride: 32, // pos(12) + normal(12) + uv(8)
        attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x3' },
          { shaderLocation: 1, offset: 12, format: 'float32x3' },
          { shaderLocation: 2, offset: 24, format: 'float32x2' },
        ],
      },
    ];
    const shapePipeline = device.createRenderPipeline({
      layout: shapeMorphLayout,
      vertex: { module: shapeModule, entryPoint: 'vs', buffers: shapeVertexBuffers },
      fragment: { module: shapeModule, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });
    const shapePipelineTransparent = device.createRenderPipeline({
      layout: shapeMorphLayout,
      vertex: { module: shapeModule, entryPoint: 'vs', buffers: shapeVertexBuffers },
      fragment: {
        module: shapeModule,
        entryPoint: 'fs',
        targets: [
          {
            format,
            blend: {
              color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' },
    });
    const shapeParamsBuffer = device.createBuffer({
      size: 4 * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Comet travelers + wake: same vertex layout + depth as the shapes, group-0 only
    // (no morph) → 'auto' layout. Opaque (like the shapes and tail particles): the
    // principal occludes correctly and the wake vanishes by shrinking its scale to 0.
    const cometModule = await createModule(device, cometShader);
    const cometPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: cometModule, entryPoint: 'vs', buffers: shapeVertexBuffers },
      fragment: { module: cometModule, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });
    const cometUniforms = Array.from({ length: 8 }, () =>
      device.createBuffer({
        size: 20 * Float32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),
    );

    const morphInBuf = device.createBuffer({
      size: 4 * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const morphOutBuf = device.createBuffer({
      size: 4 * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Tail particle pipeline — same bindings/layout as shapes, drifting instances.
    const particleModule = await createModule(device, particlesShader);
    const particlePipeline = device.createRenderPipeline({
      layout: shapeLayout,
      vertex: { module: particleModule, entryPoint: 'vs', buffers: shapeVertexBuffers },
      fragment: { module: particleModule, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });
    const particleParamsBuffer = device.createBuffer({
      size: 4 * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Leading-edge crest pipeline — additive glow, depth-tested but no depth write
    // (it lights the tip without occluding the scene). Reuses the cube mesh + layout.
    const headModule = await createModule(device, headParticlesShader);
    const headPipeline = device.createRenderPipeline({
      layout: shapeLayout,
      vertex: { module: headModule, entryPoint: 'vs', buffers: shapeVertexBuffers },
      fragment: {
        module: headModule,
        entryPoint: 'fs',
        targets: [
          {
            format,
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list' },
      // depthCompare 'less-equal': the crest still shows at the leading edge (its
      // cubes straddle the band → equal/nearer depth passes) but is correctly
      // OCCLUDED by anything in front of it. No depth write (additive glow).
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: false,
        depthCompare: 'less-equal',
      },
    });
    const headParamsBuffer = device.createBuffer({
      size: 4 * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Bloom passes: fullscreen triangle, three fragment entry points. Auto layout
    // per pipeline (each derives its bindings from its entry point — composite uses
    // a 4th binding the others don't). bright/blur target the half-res bloom format.
    const bloomModule = await createModule(device, bloomShader);
    const brightPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: bloomModule, entryPoint: 'vs' },
      fragment: {
        module: bloomModule,
        entryPoint: 'bright_fs',
        targets: [{ format: BLOOM_FORMAT }],
      },
      primitive: { topology: 'triangle-list' },
    });
    const blurPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: bloomModule, entryPoint: 'vs' },
      fragment: { module: bloomModule, entryPoint: 'blur_fs', targets: [{ format: BLOOM_FORMAT }] },
      primitive: { topology: 'triangle-list' },
    });
    const compositePipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: bloomModule, entryPoint: 'vs' },
      fragment: { module: bloomModule, entryPoint: 'composite_fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    });
    const temporalModule = await createModule(device, temporalFeedbackShader);
    const temporalPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: temporalModule, entryPoint: 'vs' },
      fragment: { module: temporalModule, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    });
    // Plain present blit: copies the owned present target to the swapchain canvas.
    const blitModule = await createModule(device, blitShader);
    const blitPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: blitModule, entryPoint: 'vs' },
      fragment: { module: blitModule, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    });
    const copyProbeModule = await createModule(device, cameraCopyProbeShader);
    const copyProbePipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: copyProbeModule, entryPoint: 'main' },
    });
    const copyProbeUniform = device.createBuffer({
      size: 8 * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    // Debug ripple grid: fullscreen lattice, additive, drawn into the scene so the
    // bloom composite's ripple warp bends it. depthCompare 'always' / no depth write.
    const debugGridModule = await createModule(device, debugGridShader);
    const debugGridPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: debugGridModule, entryPoint: 'vs' },
      fragment: {
        module: debugGridModule,
        entryPoint: 'fs',
        targets: [
          {
            format,
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'always' },
    });
    // Debug mask viewer: fullscreen grayscale blit of one Lorenz-field layer.
    const maskViewModule = await createModule(device, maskViewShader);
    const maskViewPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: maskViewModule, entryPoint: 'vs' },
      fragment: { module: maskViewModule, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    });
    const bloomUniform = device.createBuffer({
      size: BLOOM_FLOATS * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const temporalUniform = device.createBuffer({
      size: TEMPORAL_FLOATS * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const uploadMesh = (mesh: Mesh): GPUBuffer => {
      const buf = device.createBuffer({
        size: mesh.data.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(buf, 0, mesh.data);
      return buf;
    };
    const cube = createCube();
    const sphere = createSphere();
    const cubeBuffer = uploadMesh(cube);
    const sphereBuffer = uploadMesh(sphere);

    const instance = new WebGPUContext(
      canvas,
      device,
      context,
      pipeline,
      cameraBuffer,
      sampler,
      depositsBuffer,
      ring,
      instanceCapacity,
    );
    instance.gpuMem = gpuMem; // share the tracked total with the createTexture wrapper
    instance.pipelineTransparent = pipelineTransparent;
    instance.hd = hd;
    instance.synth = synth;
    instance.bgPipeline = bgPipeline;
    instance.bgUniformBuffer = bgUniformBuffer;
    instance.gridPipeline = gridPipeline;
    instance.gridUniformBuffer = gridUniformBuffer;
    instance.gridVertexBuffer = gridVertexBuffer;
    instance.gridVertexCount = grid.vertexCount;
    instance.gridBindGroup = device.createBindGroup({
      layout: gridBGL,
      entries: [
        { binding: 0, resource: { buffer: cameraBuffer } },
        { binding: 1, resource: { buffer: gridUniformBuffer } },
      ],
    });
    instance.inkPipeline = inkPipeline;
    instance.fadePipeline = fadePipeline;
    instance.fieldTexture = fieldTexture;
    instance.cameraBuffer2 = cameraBuffer2;
    instance.depositsBuffer2 = depositsBuffer2;
    instance.ring2 = ring2;
    instance.shapePipeline = shapePipeline;
    instance.shapePipelineTransparent = shapePipelineTransparent;
    instance.shapeParamsBuffer = shapeParamsBuffer;
    instance.cometPipeline = cometPipeline;
    instance.cometUniforms = cometUniforms;
    instance.particlePipeline = particlePipeline;
    instance.particleParamsBuffer = particleParamsBuffer;
    instance.headPipeline = headPipeline;
    instance.headParamsBuffer = headParamsBuffer;
    instance.canvasFormat = format;
    instance.brightPipeline = brightPipeline;
    instance.blurPipeline = blurPipeline;
    instance.compositePipeline = compositePipeline;
    instance.temporalPipeline = temporalPipeline;
    instance.blitPipeline = blitPipeline;
    instance.copyProbePipeline = copyProbePipeline;
    instance.copyProbeUniform = copyProbeUniform;
    instance.debugGridPipeline = debugGridPipeline;
    instance.maskViewPipeline = maskViewPipeline;
    instance.bloomUniform = bloomUniform;
    instance.temporalUniform = temporalUniform;
    instance.cubeBuffer = cubeBuffer;
    instance.sphereBuffer = sphereBuffer;
    instance.cubeVertexCount = cube.vertexCount;
    instance.sphereVertexCount = sphere.vertexCount;
    instance.morphInBuf = morphInBuf;
    instance.morphOutBuf = morphOutBuf;
    instance.morphInBind = device.createBindGroup({
      layout: morphBGL,
      entries: [{ binding: 0, resource: { buffer: morphInBuf } }],
    });
    instance.morphOutBind = device.createBindGroup({
      layout: morphBGL,
      entries: [{ binding: 0, resource: { buffer: morphOutBuf } }],
    });
    instance.rebuildCameraBindGroups(); // now that both deposits buffers exist
    instance.inkBindGroup = instance.buildInkBindGroup();
    instance.ensureTrail(); // allocates the trail view
    instance.bgBindGroup = instance.buildBgBindGroup();
    instance.ensureBloomTargets(); // scene + half-res bloom textures + bind groups

    void device.lost.then((info) => {
      if (!instance.destroyed) handlers.onDeviceLost?.(info);
    });

    return instance;
  }

  // Begin a progressive shape transition. The current target becomes the outgoing
  // form, `next` the incoming one, and the wave front resets to the head. Safe to
  // re-trigger mid-morph — the wave restarts cleanly from whatever's on screen.
  startShapeMorph(next: number): void {
    if (next === this.shapeMode && this.morphFront >= 1) return; // already there, at rest
    this.morphFrom = this.shapeMode;
    this.shapeMode = next;
    this.morphFront = 0;
  }

  // Advance the morph clock by real dt → a fixed-duration sweep, independent of the
  // curve's scroll speed (no-op once the front has reached the tail).
  advanceMorph(dt: number): void {
    if (this.morphFront >= 1) return;
    this.morphFront = Math.min(1, this.morphFront + dt / Math.max(this.morphParams.dur, 1e-3));
  }

  // Advance the two traveling-glow clocks by real dt (each curve's pulse + idle gap
  // runs at its own random pace, independent of scroll/slow-mo speed).
  advanceSweep(dt: number): void {
    this.sweepA.update(dt);
    this.sweepB.update(dt);
  }

  // Advance both comet clocks on real dt (each curve fires at its own random pace).
  // scrollA/B = each curve's sub-deposit scroll phase (0..1) so the body rides the
  // scrolling ribbon continuously rather than hopping a segment per deposit add.
  advanceComet(dt: number, scrollA = 0, scrollB = 0): void {
    const p = this.cometParams;
    this.cometA.update(dt, p.enabled, p.period, p.duration);
    this.cometB.update(dt, p.enabled, p.period, p.duration);
    this.cometScrollA = scrollA;
    this.cometScrollB = scrollB;
  }

  // Fire a comet pass on both curves now (Tune-panel "Lancer" button).
  launchComet(): void {
    this.cometA.launch(this.cometParams.duration);
    this.cometB.launch(this.cometParams.duration);
  }

  // Advance the random bloom-flash pulse on real dt. While idle, count down to the next
  // (Poisson-scheduled) trigger; while active, ride a quick sin pulse to a sharpened
  // peak and back, then schedule the next one. Result lives in flashEnv (0..1), read by
  // renderFrame to dip the threshold + spike the intensity. See bloomFlash above.
  advanceFlash(dt: number): void {
    const f = this.bloomFlash;
    if (!f.enabled || !this.bloomParams.enabled) {
      this.flashEnv = 0;
      this.flashActive = false;
      return;
    }
    if (this.flashActive) {
      this.flashElapsed += dt;
      const t = this.flashElapsed / Math.max(f.duration, 1e-3);
      if (t >= 1) {
        this.flashActive = false;
        this.flashEnv = 0;
        // Exponential inter-arrival → a true Poisson process (no fixed cadence).
        this.flashCountdown = -Math.log(1 - Math.random()) / Math.max(f.rate, 1e-3);
      } else {
        // Quick attack, quick decay; ^0.7 sharpens the peak (faster down/up at the top).
        this.flashEnv = Math.pow(Math.sin(Math.PI * t), 0.7);
      }
    } else {
      this.flashCountdown -= dt;
      if (this.flashCountdown <= 0) {
        this.flashActive = true;
        this.flashElapsed = 0;
        this.flashEnv = 0;
      }
    }
  }

  advanceGridRainbow(dt: number): void {
    if (dt <= 0 || this.gridRainbowElapsed >= this.gridRainbowDuration) return;
    this.gridRainbowElapsed = Math.min(this.gridRainbowDuration, this.gridRainbowElapsed + dt);
  }

  launchGridRainbow(strength = 1): boolean {
    const gp = this.gridParams;
    if (!gp.enabled || !gp.rainbow) return false;
    this.gridRainbowElapsed = 0;
    this.gridRainbowDuration = Math.max(0.4, gp.rainbowDuration);
    this.gridRainbowStrength = Math.max(0, Math.min(2, strength)) * gp.rainbowIntensity;
    this.gridRainbowSeed = Math.random();
    return true;
  }

  advancePixelRipple(dt: number): void {
    if (dt <= 0 || this.pixelRippleElapsed >= this.pixelRippleDuration) return;
    this.pixelRippleElapsed = Math.min(this.pixelRippleDuration, this.pixelRippleElapsed + dt);
  }

  launchPixelRipple(strength = 1): boolean {
    const p = this.pixelRippleParams;
    if (!this.bloomParams.enabled || !p.enabled) return false;
    this.pixelRippleElapsed = 0;
    this.pixelRippleDuration = Math.max(0.3, randomRange(p.duration, p.durationVar));
    const amount = Math.max(0, randomRange(p.amount, p.amountVar));
    this.pixelRippleStrength = Math.max(0, Math.min(2, strength)) * amount;
    this.pixelRipplePhase = Math.random() * Math.PI * 2;
    this.pixelRippleFrequency = Math.max(2, randomRange(p.frequency, p.frequencyVar));
    this.pixelRippleSpeed = randomRange(p.speed, p.speedVar);
    return true;
  }

  advanceExposureTrail(dt: number): void {
    if (this.exposureTrailManualPhase !== null) {
      this.exposureTrailDuration = Math.max(0.3, this.exposureTrailParams.duration);
      this.exposureTrailElapsed = this.exposureTrailDuration * this.exposureTrailManualPhase;
      return;
    }
    if (dt <= 0 || this.exposureTrailElapsed >= this.exposureTrailDuration) return;
    this.exposureTrailElapsed = Math.min(this.exposureTrailDuration, this.exposureTrailElapsed + dt);
    if (this.exposureTrailElapsed >= this.exposureTrailDuration) this.destroyTemporalTargets();
  }

  launchExposureTrail(strength = 1, durationSec = this.exposureTrailParams.duration): boolean {
    const p = this.exposureTrailParams;
    if (!p.enabled) return false;
    this.exposureTrailManualPhase = null;
    this.exposureTrailElapsed = 0;
    this.exposureTrailDuration = Math.max(0.3, durationSec);
    this.exposureTrailStrength = Math.max(0, Math.min(2, strength));
    this.exposureTrailNeedsSeed = true;
    return true;
  }

  getExposureTrailReplayPhase(): number {
    if (this.exposureTrailManualPhase !== null) return this.exposureTrailManualPhase;
    if (this.exposureTrailElapsed >= this.exposureTrailDuration) return 1;
    return clamp01(this.exposureTrailElapsed / Math.max(this.exposureTrailDuration, 1e-3));
  }

  scrubExposureTrail(phase: number): void {
    const p = clamp01(phase);
    this.exposureTrailDuration = Math.max(0.3, this.exposureTrailParams.duration);
    this.exposureTrailElapsed = this.exposureTrailDuration * p;
    this.exposureTrailStrength = 1;
    if (p >= 0.999) {
      this.exposureTrailManualPhase = null;
      this.destroyTemporalTargets();
      return;
    }
    this.exposureTrailManualPhase = p;
    this.exposureTrailNeedsSeed = true;
  }

  // Pack one curve's sweep clock into the camera uniform's `sweep` lane (idx 64-67).
  // Idle ⇒ half-width 0 so the shader's sweepWeight returns 0 (zero cost / effect).
  private writeSweepUniform(sweep: SweepGlow): void {
    this.cameraData[64] = sweep.front;
    this.cameraData[65] = sweep.active ? this.sweepParams.width : 0;
    this.cameraData[66] = this.sweepParams.glow;
    this.cameraData[67] = this.sweepParams.scale;
  }

  // Pack one comet draw into its uniform buffer. `rotation`/`count` are per-curve;
  // `mode` (0 principal / 1 wake) + `phase` (0 / π for the cube/sphere opposition)
  // are per-draw.
  private writeCometUniform(
    idx: number,
    comet: Comet,
    rotation: number,
    count: number,
    mode: number,
    phase: number,
    time: number,
    scrollFrac: number,
  ): void {
    const p = this.cometParams;
    const pp = this.particleParams;
    const d = this.cometData;
    // The wake = the tail particle effect over the comet's fixed real lifetime. The
    // front spans (1 + 2·MARGIN) in age over `duration`s, so the lifetime maps to this
    // age-window behind the front (cull beyond it → particles vanish at the same age).
    const lifeAge = (PARTICLE_LIFETIME * (1 + 2 * COMET_MARGIN)) / Math.max(p.duration, 0.1);
    d[0] = comet.front;
    d[1] = comet.active ? 1 : 0;
    d[2] = rotation;
    d[3] = count;
    d[4] = p.orbit;
    d[5] = p.orbitSpeed;
    d[6] = p.spin;
    d[7] = p.size;
    d[8] = lifeAge;
    d[9] = p.wakeSize; // wake size is comet-specific; drift/spin come from the tail
    d[10] = pp.drift;
    d[11] = pp.spin;
    d[12] = time;
    d[13] = phase;
    d[14] = mode;
    d[15] = Math.max(1, Math.round(p.wake)); // wake particles per deposit (draw skipped if 0)
    d[16] = scrollFrac; // sub-deposit scroll → continuous ride (principal only)
    d[17] = 0;
    d[18] = 0;
    d[19] = 0;
    this.device.queue.writeBuffer(this.cometUniforms[idx], 0, d);
  }

  get hdPoolSize(): number {
    return HIGHRES_POOL;
  }

  get fieldCount(): number {
    return FIELD_COUNT;
  }

  get curve2Capacity(): number {
    return CURVE2_CAPACITY;
  }

  // Tunable base gains for the synthetic source (camera-off material). Exposed for
  // the Synth tuning group.
  get synthParams(): SyntheticSource['params'] {
    return this.synth.params;
  }

  // Request a high-res still capture into `slot` on the next rendered frame. Set by
  // App from StillCycle. `fromSynth` picks the source (camera vs synthetic) — in split
  // mode App alternates it so the background montage shows both materials.
  captureStillInto(slot: number, fromSynth = false): void {
    this.pendingStillCapture = slot;
    this.pendingStillFromSynth = fromSynth;
  }

  private buildBgBindGroup(): GPUBindGroup {
    return this.device.createBindGroup({
      layout: this.bgPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.bgUniformBuffer } },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: this.hd.arrayView },
        { binding: 3, resource: this.trailView! },
        { binding: 4, resource: this.fieldTexture.createView({ dimension: '2d-array' }) },
      ],
    });
  }

  private buildInkBindGroup(): GPUBindGroup {
    return this.device.createBindGroup({
      layout: this.inkPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.cameraBuffer } },
        { binding: 1, resource: { buffer: this.depositsBuffer } },
      ],
    });
  }

  // (Re)allocate the half-res trail buffer to the canvas size; rebuilds the
  // background bind group (it samples the trail). Returns true if reallocated.
  private ensureTrail(): boolean {
    const w = Math.max(1, Math.floor(this.canvas.width * TRAIL_SCALE));
    const h = Math.max(1, Math.floor(this.canvas.height * TRAIL_SCALE));
    if (this.trailTexture && this.trailW === w && this.trailH === h) return false;
    this.trailTexture?.destroy();
    this.trailTexture = this.device.createTexture({
      label: 'ribbon-trail',
      size: [w, h],
      format: TRAIL_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.trailView = this.trailTexture.createView();
    this.trailW = w;
    this.trailH = h;
    this.trailWasActive = false; // fresh buffer → clear on next activation
    return true;
  }

  // Draw one frame: capture the current camera frame into the freshly-deposited
  // ring slots, then draw the ribbon (cards sample their slot's frame, or an
  // age colour when the camera is off). `slots[0..slotCount)` are this frame's
  // new deposits; `video` is null when the camera is off.
  renderFrame(
    instanceData: Float32Array,
    count: number,
    head: number,
    time: number,
    ageRef: number,
    video: HTMLVideoElement | null,
    slots: Int32Array,
    slotCount: number,
    followMode: number, // 0 = orbit, 1 = follow curve 1, 2 = follow curve 2
    depositRate: number, // curve 1 deposits/sec (decouples particle time from speed)
    curve2: {
      instanceData: Float32Array;
      count: number;
      head: number;
      ageRef: number;
      depositRate: number;
      depositedSlots: Int32Array; // B's ring2 slots written this frame
      depositedCount: number;
    } | null,
    useSynthetic: boolean, // camera off → feed ring/HD from the procedural source
    splitSource = false, // camera on → curve A from the camera, curve B from the synth
  ): void {
    if (this.destroyed) return;
    if (this.canvas.width === 0 || this.canvas.height === 0) {
      if (!this.loggedZeroSize) {
        this.loggedZeroSize = true;
        console.warn('[lorenz] renderFrame skipped: canvas is 0-sized — nothing drawn');
      }
      return;
    }

    // Capture rotation + post-rotation aspect. Shared with the start-screen preview
    // (captureGeometry) so the preview is WYSIWYG with this exact capture.
    const { rotation, aspect: rawAspect } = this.captureGeometry(video);
    const aspect = this.copyCaptureAspect(video, rotation) ?? this.cropAdjustedAspect(rawAspect);
    if (video) {
      // Both curves' rings track the camera aspect; rebuild if either reallocated.
      const ringResized = this.ring.resize(aspect);
      const ring2Resized = this.ring2.resize(aspect);
      if (ringResized || ring2Resized) this.rebuildCameraBindGroups();
    }
    if (video && this.hd.resize(aspect)) {
      this.bgBindGroup = this.buildBgBindGroup();
    }
    if (this.ensureTrail()) {
      this.bgBindGroup = this.buildBgBindGroup();
    }

    // Walk deposits chronologically: segment s connects oldest+s and oldest+s+1,
    // which skips the ring's newest↔oldest gap. count-1 segments.
    const oldestSlot = (head - count + this.capacity) % this.capacity;
    const segmentCount = Math.max(count - 1, 0);

    // followMode: 0 orbit, 1/2 follow curve 1/2 head, 3/4 trail curve 1/2 (sit at
    // the tail looking up the dissolving trail). Curve 2 has its own cap + rotation.
    const wantC2 = followMode === 2 || followMode === 4;
    const useC2 = wantC2 && this.curve2Params.enabled && !!curve2 && curve2.count > 0;
    // Global (orbit) view: measure the occupied space to auto-frame it.
    if (followMode === 0 && this.frameParams.enabled) {
      this.updateFrame(instanceData, head, count, this.capacity, curve2, this.curve2Params.angle);
    }
    this.placeCamera(
      followMode >= 1,
      useC2 ? curve2!.instanceData : instanceData,
      useC2 ? curve2!.head : head,
      useC2 ? curve2!.count : count,
      time,
      useC2 ? CURVE2_CAPACITY : this.capacity,
      useC2 ? this.curve2Params.angle : 0,
      followMode === 3 || followMode === 4, // tail
    );
    this.updateCamera();
    this.cameraData[23] = aspect; // cardAspect (unused by the band; kept for layout)
    this.cameraData[24] = ageRef; // params.x
    this.cameraData[25] = this.bandParams.widthMult; // params.y = width multiplier
    this.cameraData[26] = this.bandParams.mode; // params.z = mode (0 = A, 1 = B)
    // useCamera also gates "sample the ring (vs age colour)": the synthetic source
    // fills the ring when the camera is off, so treat it the same.
    this.cameraData[27] = video || useSynthetic ? 1 : 0; // params.w = useCamera
    this.cameraData[28] = oldestSlot; // ribbon.x
    this.cameraData[29] = this.capacity; // ribbon.y
    this.cameraData[30] = this.trailParams.inkSize; // ribbon.z (ink blob size)
    this.cameraData[31] = this.trailParams.inkIntensity; // ribbon.w (ink intensity)
    this.cameraData[32] = 0; // curve.x = rotateY (primary curve unrotated)
    this.cameraData[33] = 1; // curve.yzw = tint (none)
    this.cameraData[34] = 1;
    this.cameraData[35] = 1;
    this.cameraData[36] = this.displayParams.opacity; // misc.x (shared by both curves)
    // Slow-mo brightens the tail glow and spreads it up the curve → the trace glows.
    this.cameraData[37] = this.displayParams.glow * (1 + this.slowmoAmount * 2.5); // misc.y
    this.cameraData[38] = this.displayParams.glowStart * (1 - this.slowmoAmount * 0.6); // misc.z
    this.cameraData[39] = depositRate; // misc.w = curve 1 deposit rate
    // Audio rows (40-59): global, so set once — the curve-2 override below leaves
    // them intact and they carry into cameraBuffer2 unchanged.
    this.writeAudioUniform();
    this.cameraData[59] = time; // tint2.w = time, for the head crest's shimmer
    // Key-frame glow params (shared row → carried into cameraBuffer2; curve-2
    // deposits are never keyed, so it never glows there).
    this.cameraData[60] = this.keyParams.glow; // key.x = glow strength
    this.cameraData[61] = this.keyParams.freq; // key.y = pulse frequency
    this.cameraData[62] = this.keyParams.hue; // key.z = hue (palette position)
    this.cameraData[63] = this.keyParams.tint; // key.w = tint strength
    this.writeSweepUniform(this.sweepA); // curve A's traveling glow (sweep lane)
    this.device.queue.writeBuffer(this.cameraBuffer, 0, this.cameraData);
    this.device.queue.writeBuffer(this.depositsBuffer, 0, instanceData);

    // Second crossing curve: reuse the shared camera basis, override the per-curve
    // fields (rotation, tint, age ref, ribbon slots, no camera), into its own buffer.
    const drawCurve2 = this.curve2Params.enabled && !!curve2 && curve2.count > 1;
    let segmentCount2 = 0;
    if (drawCurve2) {
      const cap2 = CURVE2_CAPACITY;
      const oldest2 = (curve2.head - curve2.count + cap2) % cap2;
      segmentCount2 = curve2.count - 1;
      this.cameraData[24] = curve2.ageRef; // params.x
      this.cameraData[27] = video || useSynthetic ? 1 : 0; // shares the ring (camera or synth)
      this.cameraData[28] = oldest2; // ribbon.x
      this.cameraData[29] = cap2; // ribbon.y
      this.cameraData[32] = this.curve2Params.angle; // curve.x = rotateY
      this.cameraData[33] = this.curve2Params.tint[0];
      this.cameraData[34] = this.curve2Params.tint[1];
      this.cameraData[35] = this.curve2Params.tint[2];
      this.cameraData[39] = curve2.depositRate; // misc.w = curve 2 deposit rate
      this.writeSweepUniform(this.sweepB); // curve B's own (desynced) traveling glow
      this.device.queue.writeBuffer(this.cameraBuffer2, 0, this.cameraData);
      this.device.queue.writeBuffer(this.depositsBuffer2, 0, curve2.instanceData);
    }

    // Background uniform: camera basis for the star view-ray + dissolve state.
    const bd = this.bgData;
    bd[0] = this.camForward[0];
    bd[1] = this.camForward[1];
    bd[2] = this.camForward[2];
    bd[3] = Math.tan(FOV_Y / this.zoom / 2); // stars zoom with the scene
    bd[4] = this.camRight[0];
    bd[5] = this.camRight[1];
    bd[6] = this.camRight[2];
    bd[7] = this.canvas.width / this.canvas.height;
    bd[8] = this.camUp[0];
    bd[9] = this.camUp[1];
    bd[10] = this.camUp[2];
    bd[11] = time;
    bd[12] = this.canvas.width;
    bd[13] = this.canvas.height;
    const effReveal = this.debugReveal >= 0 ? this.debugReveal : this.backgroundState.reveal;
    bd[14] = this.debugStill ? effReveal : 0;
    bd[15] = this.debugStill && effReveal > 0.001 ? 1 : 0; // useStill
    bd[16] = this.hd.layerAspect;
    bd[17] = this.backgroundState.layer;
    bd[18] = this.starParams.density;
    bd[19] = this.debugStars ? this.starParams.brightness : 0;
    bd[20] = this.bgParams.grain; // extra.x
    bd[21] = this.trailParams.smear; // extra.y
    bd[22] = this.trailParams.halo; // extra.z = halo intensity
    bd[23] = this.trailParams.hueSpeed; // extra.w = hue drift speed
    const fieldIndex = this.backgroundState.fieldIndex;
    bd[24] = this.dissolveParams.frontGlow; // extra2.x
    bd[25] = this.dissolveParams.fieldScale; // extra2.y
    bd[26] = fieldIndex; // extra2.z = which butterfly view
    bd[27] = fieldIndex & 3; // extra2.w = flip bits (extra orientation variety)
    bd[28] = this.backgroundState.hueOffset; // extra3.x = per-still base hue
    bd[29] = this.dissolveParams.zoom; // extra3.y = dissolve scale-travel amount
    bd[30] = this.debugStars ? this.audioState.level * this.starParams.audio : 0; // extra3.z = star glow
    bd[31] = this.debugStars ? this.audioState.beat * this.starParams.audio : 0; // extra3.w = star flash
    this.device.queue.writeBuffer(this.bgUniformBuffer, 0, this.bgData);

    this.shapeData[0] = this.shapeParams.size;
    this.shapeData[1] = this.shapeParams.spin;
    this.device.queue.writeBuffer(this.shapeParamsBuffer, 0, this.shapeData);

    // Morph fronts: the incoming form (morphIn) grows from the head, the outgoing
    // form (morphOut) shrinks. At rest (front >= 1) active = 0 → morphWeight() = 1,
    // so the lone normal draw renders full-size (identical to no-morph, zero cost).
    // Guard band > 0 so the shader's smoothstep keeps edge0 < edge1 (edge0 >= edge1 is
    // undefined in WGSL → NaN risk on WebKit/iOS), independent of any writer of band.
    const morphBand = Math.max(this.morphParams.band, 1e-3);
    const morphActive = this.morphFront < 1 ? 1 : 0;
    this.morphInData[0] = this.morphFront;
    this.morphInData[1] = morphBand;
    this.morphInData[2] = 0;
    this.morphInData[3] = morphActive;
    this.device.queue.writeBuffer(this.morphInBuf, 0, this.morphInData);
    if (morphActive) {
      // Outgoing side: only bound (and only read) while a transition is in flight.
      this.morphOutData[0] = this.morphFront;
      this.morphOutData[1] = morphBand;
      this.morphOutData[2] = 1;
      this.morphOutData[3] = 1;
      this.device.queue.writeBuffer(this.morphOutBuf, 0, this.morphOutData);
    }

    this.particleData[0] = this.particleParams.size;
    this.particleData[1] = this.particleParams.drift;
    this.particleData[2] = this.particleParams.spin;
    this.particleData[3] = this.particleParams.start;
    this.device.queue.writeBuffer(this.particleParamsBuffer, 0, this.particleData);

    this.headData[0] = this.headParams.size;
    this.headData[1] = this.headParams.gap;
    this.headData[2] = this.headParams.recul;
    this.headData[3] = this.headParams.reach;
    this.device.queue.writeBuffer(this.headParamsBuffer, 0, this.headData);

    this.ensureDepth();
    this.ensureBloomTargets();
    this.ensurePresentTarget();

    const encoder = this.device.createCommandEncoder();

    // Capture passes first (write ring layers), then the ribbon pass reads them.
    // Only import the camera frame when something will actually consume it this frame — a fresh
    // curve-A deposit, a fresh curve-B deposit (non-split), or a pending HD still. Deposits arrive
    // irregularly (not every frame), so on the in-between frames the import would be pure waste —
    // and each importExternalTexture is a transient resource iOS WebKit reclaims slowly, so
    // skipping the unused ones directly slows the GPU-memory creep behind the long-session crash.
    const needCameraCapture =
      !!video &&
      (slotCount > 0 ||
        (!splitSource && !!curve2 && curve2.depositedCount > 0) ||
        (this.pendingStillCapture >= 0 && !this.pendingStillFromSynth));
    if (video && needCameraCapture) {
      // Camera colour grade, baked at capture (so ring/ring2/HD all match). The hue
      // breathes off the live Lorenz z + audio centroid.
      let lpz = 0;
      if (count > 0) {
        const li = ((head - 1 + this.capacity) % this.capacity) * INSTANCE_FLOATS;
        lpz = Math.max(-1, Math.min(1, instanceData[li + 2] / 1.6));
      }
      const grade = this.computeCameraGrade(
        time,
        lpz,
        this.audioState.centroid,
        this.audioParams.enabled,
      );
      const copiedView = this.cameraSourcePath === 'copy' ? this.copyCameraFrame(video) : null;
      if (copiedView) {
        this.maybeProbeCameraCopyCrop(copiedView, rotation, video);
        this.ring.captureFrom(
          encoder,
          copiedView,
          slots,
          slotCount,
          rotation,
          grade,
          this.cameraCopyCrop,
        );
        this.cameraStats.depA += slotCount;
        if (!splitSource && curve2 && curve2.depositedCount > 0) {
          this.ring2.captureFrom(
            encoder,
            copiedView,
            curve2.depositedSlots,
            curve2.depositedCount,
            rotation,
            grade,
            this.cameraCopyCrop,
          );
          this.cameraStats.depB += curve2.depositedCount;
        }
        if (this.pendingStillCapture >= 0 && !this.pendingStillFromSynth) {
          this.hdSlotScratch[0] = this.pendingStillCapture;
          this.hd.captureFrom(
            encoder,
            copiedView,
            this.hdSlotScratch,
            1,
            rotation,
            grade,
            this.cameraCopyCrop,
          );
          this.cameraStats.hd++;
        }
      } else {
        try {
          const externalTexture = this.device.importExternalTexture({ source: video });
          this.cameraStats.imports++;
          this.ring.capture(encoder, externalTexture, slots, slotCount, rotation, grade);
          this.cameraStats.depA += slotCount;
          // Curve B has its own ring: capture the same frame into ITS freshly-deposited
          // slots so each of B's points freezes its own instant (its head/speed are
          // independent of A's, so it can't share A's ring coherently). In split mode B
          // is fed from the synthetic source below instead, so skip the camera blit.
          if (!splitSource && curve2 && curve2.depositedCount > 0) {
            this.ring2.capture(
              encoder,
              externalTexture,
              curve2.depositedSlots,
              curve2.depositedCount,
              rotation,
              grade,
            );
            this.cameraStats.depB += curve2.depositedCount;
          }
          // Same frame → also fill the requested HD still pool slot, if any — unless
          // this still was assigned to the synthetic source (split mode alternation).
          if (this.pendingStillCapture >= 0 && !this.pendingStillFromSynth) {
            this.hdSlotScratch[0] = this.pendingStillCapture;
            this.hd.capture(encoder, externalTexture, this.hdSlotScratch, 1, rotation, grade);
            this.cameraStats.hd++;
          }
        } catch (err) {
          if (!this.loggedImportFail) {
            this.loggedImportFail = true;
            console.warn('[lorenz] frame capture failed; ribbon stays uncoloured', err);
          }
        }
      }
    }
    // The procedural source runs when the camera is off (it feeds BOTH rings + HD),
    // or in split mode while the camera is on (it feeds only curve B). It's rendered
    // upright, so rotation stays 0.
    if (useSynthetic || (video && splitSource)) {
      // Camera off: feed the same rings + HD pool from the procedural source, so
      // the ribbon/shapes/curve B, the HD dissolve and the key-frame glow all live
      // without a camera.
      this.synth.resize(this.ring.layerAspect);
      // Modulators: the live Lorenz point (newest deposit, normalized) + gated
      // audio drive the warp/hue/rotation (LFOs are added inside SyntheticSource).
      let px = 0;
      let py = 0;
      let pz = 0;
      if (count > 0) {
        const li = ((head - 1 + this.capacity) % this.capacity) * INSTANCE_FLOATS;
        const inv = 1 / 1.6; // world extent (~±1.5) → ~[-1, 1]
        px = Math.max(-1, Math.min(1, instanceData[li] * inv));
        py = Math.max(-1, Math.min(1, instanceData[li + 1] * inv));
        pz = Math.max(-1, Math.min(1, instanceData[li + 2] * inv));
      }
      const as = this.audioState;
      const mods = {
        px,
        py,
        pz,
        audio: this.audioParams.enabled,
        bass: as.bass,
        treble: as.treble,
        centroid: as.centroid,
        beat: as.beat,
        level: as.level,
      };
      // Advance the live Lorenz splat trail every frame (else it freezes between
      // deposits); the colorise + blit below stays on-demand.
      this.synth.updateSplat(
        encoder,
        time,
        mods,
        this.depositsBuffer,
        count,
        head,
        this.capacity,
        ageRef,
      );
      // Routing: with no camera the synth feeds A too; in split mode the camera owns A.
      // The HD still follows the per-capture source flag (camera-off ⇒ always synth);
      // in split mode App alternates it so the background flash shows both materials.
      const synthA = !video;
      const synthHD = this.pendingStillCapture >= 0 && this.pendingStillFromSynth;
      const synthB = !!curve2 && curve2.depositedCount > 0;
      const wantCapture = (synthA && slotCount > 0) || synthB || synthHD;
      if (wantCapture) {
        this.synth.render(encoder, time);
        const view = this.synth.view;
        if (synthA) this.ring.captureFrom(encoder, view, slots, slotCount, rotation);
        if (synthB) {
          this.ring2.captureFrom(
            encoder,
            view,
            curve2!.depositedSlots,
            curve2!.depositedCount,
            rotation,
          );
        }
        if (synthHD) {
          this.hdSlotScratch[0] = this.pendingStillCapture;
          this.hd.captureFrom(encoder, view, this.hdSlotScratch, 1, rotation);
        }
      }
    }
    this.pendingStillCapture = -1; // consumed (or dropped when camera is off)

    // Ribbon smoke/trail: only maintained while a still is visible (it builds up
    // during the appearance and resets between). Fade the buffer, then ink the
    // ribbon's deposits additively on top.
    const showStill = this.debugStill && effReveal > 0.001;
    if (showStill) {
      const decay = this.trailParams.decay;
      const trailPass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: this.trailView!,
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: this.trailWasActive ? 'load' : 'clear',
            storeOp: 'store',
          },
        ],
      });
      trailPass.setBlendConstant({ r: decay, g: decay, b: decay, a: decay });
      trailPass.setPipeline(this.fadePipeline);
      trailPass.draw(3); // fullscreen fade (multiply by decay)
      if (count > 0) {
        trailPass.setPipeline(this.inkPipeline);
        trailPass.setBindGroup(0, this.inkBindGroup);
        trailPass.draw(4, count); // one soft blob per deposit
      }
      trailPass.end();
    }
    this.trailWasActive = showStill;

    const canvasView = this.context.getCurrentTexture().createView();
    // With bloom on, the scene renders to an offscreen target and the bloom chain
    // composites it (glowing) to the canvas; off, it renders straight to the canvas.
    const bloomOn = this.bloomParams.enabled && !!this.sceneView;
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: bloomOn ? this.sceneView! : this.presentView!,
          clearValue: { r: 0.02, g: 0.02, b: 0.05, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
      depthStencilAttachment: {
        view: this.depthView!,
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });
    // Background first (stars + dissolving still), then the ribbon over it.
    pass.setPipeline(this.bgPipeline);
    pass.setBindGroup(0, this.bgBindGroup);
    pass.draw(3); // fullscreen triangle

    // Deformation grid: the motion field made visible (between background and curve).
    if (this.gridParams.enabled) {
      const gp = this.gridParams;
      const f = this.fieldState;
      const gd = this.gridData;
      gd[0] = f.pushX * gp.tilt;
      gd[1] = f.pushY * gp.tilt;
      gd[2] = f.swirl * gp.swirl;
      gd[3] = gp.idle + this.audioState.level; // amp = idle floor + live audio
      gd[4] = time;
      gd[5] = gp.noiseScale;
      gd[6] = gp.height;
      gd[7] = gp.flow;
      gd[8] = 0.45; // color r
      gd[9] = 0.6; // color g
      gd[10] = 1.0; // color b
      const rainbowActive = gp.rainbow && this.gridRainbowElapsed < this.gridRainbowDuration;
      const rainbowPhase = rainbowActive
        ? this.gridRainbowElapsed / Math.max(this.gridRainbowDuration, 1e-3)
        : 1;
      const rainbowOpacity = rainbowActive
        ? smoothstep(0.05, 0.72, rainbowPhase) * (1 - smoothstep(0.86, 1, rainbowPhase))
        : 0;
      gd[11] = gp.opacity + (1 - gp.opacity) * rainbowOpacity;
      gd[12] = rainbowPhase;
      gd[13] = rainbowActive ? this.gridRainbowStrength : 0;
      gd[14] = this.gridRainbowSeed;
      gd[15] = gp.rainbowWaves;
      gd[16] = gp.rainbowHeight;
      gd[17] = gp.rainbowSpeed;
      gd[18] = gp.rainbowSharpness;
      gd[19] = gp.rainbowHueSpeed;
      this.device.queue.writeBuffer(this.gridUniformBuffer, 0, gd);
      pass.setPipeline(this.gridPipeline);
      pass.setBindGroup(0, this.gridBindGroup);
      pass.setVertexBuffer(0, this.gridVertexBuffer);
      pass.draw(this.gridVertexCount);
    }
    // During a transition we draw two layers: the outgoing form (shrinking, bound to
    // morphOut) then the incoming form (growing, morphIn). At rest just the one form
    // with morphIn (active = 0). Group 1 is now declared by both pipeline families.
    const sides: { shape: number; morphBind: GPUBindGroup }[] =
      this.morphFront < 1
        ? [
            { shape: this.morphFrom, morphBind: this.morphOutBind },
            { shape: this.shapeMode, morphBind: this.morphInBind },
          ]
        : [{ shape: this.shapeMode, morphBind: this.morphInBind }];
    for (const side of sides) {
      if (side.shape === 0) {
        // Plane: the continuous ribbon band (one quad per segment). Alpha-blended
        // variant when the user dials opacity below 1 (to see through the tangle).
        const ribbonPipe =
          this.displayParams.opacity < 0.999 ? this.pipelineTransparent : this.pipeline;
        if (this.curve1Enabled && segmentCount > 0) {
          pass.setPipeline(ribbonPipe);
          pass.setBindGroup(0, this.cameraBindGroup);
          pass.setBindGroup(1, side.morphBind);
          pass.draw(4, segmentCount);
        }
        if (segmentCount2 > 0) {
          pass.setPipeline(ribbonPipe);
          pass.setBindGroup(0, this.cameraBindGroup2);
          pass.setBindGroup(1, side.morphBind);
          pass.draw(4, segmentCount2);
        }
      } else {
        // Cube / sphere: one instanced mesh per deposit.
        const shapeBuf = side.shape === 1 ? this.cubeBuffer : this.sphereBuffer;
        const shapeVerts = side.shape === 1 ? this.cubeVertexCount : this.sphereVertexCount;
        const shapePipe =
          this.displayParams.opacity < 0.999 ? this.shapePipelineTransparent : this.shapePipeline;
        pass.setPipeline(shapePipe);
        pass.setVertexBuffer(0, shapeBuf);
        pass.setBindGroup(1, side.morphBind);
        if (this.curve1Enabled && count > 0) {
          pass.setBindGroup(0, this.shapeBindGroup);
          pass.draw(shapeVerts, count);
        }
        if (segmentCount2 > 0) {
          pass.setBindGroup(0, this.shapeBindGroup2);
          pass.draw(shapeVerts, curve2!.count);
        }
      }
    }

    // Comet: the principal sphere + cube streak head→tail (phase opposition); as they
    // pass, each deposit ignites a tail-style wake (cubes that spawn/disperse/fade in
    // place). Depth-tested with the shapes. Per curve: principal cube + sphere (1
    // instance each, mode 0) then the wake (cubes, deposits×particles, mode 1). Each
    // draw reads its own uniform (written just above) so payloads don't clobber each
    // other before the single submit.
    if (this.cometParams.enabled) {
      const wp = Math.max(0, Math.round(this.cometParams.wake)); // wake particles / deposit
      const sA = this.cometScrollA;
      const sB = this.cometScrollB;
      pass.setPipeline(this.cometPipeline);
      if (count > 1) {
        this.writeCometUniform(0, this.cometA, 0, count, 0, 0, time, sA);
        pass.setVertexBuffer(0, this.cubeBuffer);
        pass.setBindGroup(0, this.cometBindGroups[0]);
        pass.draw(this.cubeVertexCount, 1);
        this.writeCometUniform(1, this.cometA, 0, count, 0, Math.PI, time, sA);
        pass.setVertexBuffer(0, this.sphereBuffer);
        pass.setBindGroup(0, this.cometBindGroups[1]);
        pass.draw(this.sphereVertexCount, 1);
        if (wp > 0) {
          // Wake behind each body: cube body (phase 0) and sphere body (phase π).
          pass.setVertexBuffer(0, this.cubeBuffer);
          this.writeCometUniform(2, this.cometA, 0, count, 1, 0, time, sA);
          pass.setBindGroup(0, this.cometBindGroups[2]);
          pass.draw(this.cubeVertexCount, count * wp);
          this.writeCometUniform(3, this.cometA, 0, count, 1, Math.PI, time, sA);
          pass.setBindGroup(0, this.cometBindGroups[3]);
          pass.draw(this.cubeVertexCount, count * wp);
        }
      }
      if (segmentCount2 > 0) {
        const rot = this.curve2Params.angle;
        const c2 = curve2!.count;
        this.writeCometUniform(4, this.cometB, rot, c2, 0, 0, time, sB);
        pass.setVertexBuffer(0, this.cubeBuffer);
        pass.setBindGroup(0, this.cometBindGroups[4]);
        pass.draw(this.cubeVertexCount, 1);
        this.writeCometUniform(5, this.cometB, rot, c2, 0, Math.PI, time, sB);
        pass.setVertexBuffer(0, this.sphereBuffer);
        pass.setBindGroup(0, this.cometBindGroups[5]);
        pass.draw(this.sphereVertexCount, 1);
        if (wp > 0) {
          pass.setVertexBuffer(0, this.cubeBuffer);
          this.writeCometUniform(6, this.cometB, rot, c2, 1, 0, time, sB);
          pass.setBindGroup(0, this.cometBindGroups[6]);
          pass.draw(this.cubeVertexCount, c2 * wp);
          this.writeCometUniform(7, this.cometB, rot, c2, 1, Math.PI, time, sB);
          pass.setBindGroup(0, this.cometBindGroups[7]);
          pass.draw(this.cubeVertexCount, c2 * wp);
        }
      }
    }

    // Tail dissolution particles: the oldest ~20% of deposits emit 16 drifting
    // cubes each (the shader culls those not yet dissolving). Cubes are cheap (36
    // verts); a low-poly sphere variant could be added later.
    if (this.particleParams.enabled && count > 0) {
      const pVerts = this.cubeVertexCount;
      pass.setPipeline(this.particlePipeline);
      pass.setVertexBuffer(0, this.cubeBuffer);
      const tail1 = Math.min(count, Math.ceil(this.capacity * 0.2));
      pass.setBindGroup(0, this.particleBindGroup);
      pass.draw(pVerts, tail1 * 16);
      if (segmentCount2 > 0) {
        const tail2 = Math.min(curve2!.count, Math.ceil(CURVE2_CAPACITY * 0.2));
        pass.setBindGroup(0, this.particleBindGroup2);
        pass.draw(pVerts, tail2 * 16);
      }
    }

    // Leading-edge crest: 3 lines of 12 cubes at the newest deposit (needs ≥ 2 to
    // derive a tangent/width). Additive glow — the texture emerges from it. Drawn on
    // both curves (same params), each via its own camera/deposits bind group.
    if (this.headParams.enabled) {
      pass.setPipeline(this.headPipeline);
      pass.setVertexBuffer(0, this.cubeBuffer);
      if (count >= 2) {
        pass.setBindGroup(0, this.headBindGroup);
        pass.draw(this.cubeVertexCount, 36); // 3 lines × 12 samples
      }
      if (drawCurve2) {
        pass.setBindGroup(0, this.headBindGroup2);
        pass.draw(this.cubeVertexCount, 36);
      }
    }

    // Debug ripple grid: drawn last into the scene so the bloom composite's radial
    // warp bends it (visualises the slow-mo ripple). Only when bloom is on — the warp
    // lives in the composite, so without bloom the grid would sit flat and mislead.
    if (this.debugRipple && bloomOn) {
      pass.setPipeline(this.debugGridPipeline);
      pass.draw(3);
    }
    pass.end();

    if (bloomOn) {
      // Beat boosts the glow intensity; texel size feeds the half-res blur. The random
      // flash pulse (flashEnv) momentarily dips the threshold AND spikes the intensity.
      const flash = this.bloomFlash.enabled ? this.flashEnv : 0;
      this.bloomData[0] = Math.max(0, this.bloomParams.threshold - this.bloomFlash.drop * flash);
      this.bloomData[1] =
        this.bloomParams.intensity *
        (1 + this.audioState.beat * this.bloomParams.audio + this.bloomFlash.boost * flash);
      this.bloomData[2] = 1 / Math.max(this.bloomW, 1);
      this.bloomData[3] = 1 / Math.max(this.bloomH, 1);
      // Slow-mo ripple (composite): amplitude fades in with slow-mo (+ a beat kick);
      // phase = the warp-scaled scene time, so it slows with the music and recovers.
      const rippleBase = this.slowmoAmount * (0.012 + this.audioState.beat * 0.01) * this.pixelRippleParams.slowmo;
      this.bloomData[4] = this.debugRipple ? Math.max(rippleBase, this.debugRippleAmp) : rippleBase;
      this.bloomData[5] = time;
      this.bloomData[6] = 16;
      this.bloomData[7] = 0;
      const eventActive = this.pixelRippleElapsed < this.pixelRippleDuration;
      const eventPhase = eventActive
        ? this.pixelRippleElapsed / Math.max(this.pixelRippleDuration, 1e-3)
        : 1;
      const eventEnv = eventActive
        ? smoothstep(0, 0.2, eventPhase) * (1 - smoothstep(0.72, 1, eventPhase))
        : 0;
      this.bloomData[8] = eventEnv * this.pixelRippleStrength;
      this.bloomData[9] =
        time * this.pixelRippleSpeed + this.pixelRipplePhase + eventPhase * Math.PI * 4;
      this.bloomData[10] = this.pixelRippleFrequency;
      this.bloomData[11] = 0;
      this.device.queue.writeBuffer(this.bloomUniform, 0, this.bloomData);
      this.runBloom(encoder, this.presentView!);
    }

    // Debug inspectors: overwrite the composite with an isolated stage so it can be
    // captured on its own. The mask viewer takes precedence over the synth inspector.
    if (this.debugMask >= 0) {
      // One Lorenz-field "butterfly" layer (the dissolve mask), grayscale.
      const layer = Math.min(this.debugMask, this.fieldCount - 1);
      const maskView = this.fieldTexture.createView({
        dimension: '2d',
        baseArrayLayer: layer,
        arrayLayerCount: 1,
      });
      this.blitTextureToPresent(encoder, this.maskViewPipeline, maskView);
    } else if (this.debugSource !== 0) {
      // Synthetic source: raw splat density (1) or colorized synth (2). Camera off.
      const srcView = this.debugSource === 1 ? this.synth.splatTextureView : this.synth.view;
      this.blitTextureToPresent(encoder, this.blitPipeline, srcView);
    }

    this.applyExposureTrail(encoder);

    // The composited image lives in presentTexture; blit it to the swapchain canvas to
    // present this frame (and so the video export can record from the canvas).
    const blit = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: canvasView,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    blit.setPipeline(this.blitPipeline);
    blit.setBindGroup(0, this.blitBind!);
    blit.draw(3);
    blit.end();

    this.device.queue.submit([encoder.finish()]);
  }

  // Measure the attractor's occupied space (AABB of both curves' live deposits,
  // curve B rotated by its angle as the shader draws it) and ease the centre +
  // bounding radius toward it. Used by the orbit branch to auto-frame the global
  // view. Heavy smoothing → a slow drift, never a per-frame pump.
  private updateFrame(
    instanceData: Float32Array,
    head: number,
    count: number,
    cap: number,
    curve2: { instanceData: Float32Array; count: number; head: number } | null,
    angle2: number,
  ): void {
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    let n = 0;
    for (let i = 0; i < count; i++) {
      const o = (((head - count + i) % cap) + cap) % cap;
      const b = o * INSTANCE_FLOATS;
      const x = instanceData[b];
      const y = instanceData[b + 1];
      const z = instanceData[b + 2];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
      n++;
    }
    if (curve2 && this.curve2Params.enabled && curve2.count > 0) {
      const ca = Math.cos(angle2);
      const sa = Math.sin(angle2);
      for (let i = 0; i < curve2.count; i++) {
        const o =
          (((curve2.head - curve2.count + i) % CURVE2_CAPACITY) + CURVE2_CAPACITY) %
          CURVE2_CAPACITY;
        const b = o * INSTANCE_FLOATS;
        const rx = curve2.instanceData[b];
        const ry = curve2.instanceData[b + 1];
        const rz = curve2.instanceData[b + 2];
        const x = ca * rx + sa * rz;
        const z = -sa * rx + ca * rz;
        if (x < minX) minX = x;
        if (ry < minY) minY = ry;
        if (z < minZ) minZ = z;
        if (x > maxX) maxX = x;
        if (ry > maxY) maxY = ry;
        if (z > maxZ) maxZ = z;
        n++;
      }
    }
    if (n < 2) return;

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const cz = (minZ + maxZ) / 2;
    const radius = 0.5 * Math.hypot(maxX - minX, maxY - minY, maxZ - minZ);
    if (!this.frameInit) {
      // Snap the centre, but let the radius ease from its default (ORBIT_RADIUS) so
      // the first few deposits don't start as an extreme close-up.
      this.frameCenter[0] = cx;
      this.frameCenter[1] = cy;
      this.frameCenter[2] = cz;
      this.frameInit = true;
    }
    const k = this.frameParams.smooth;
    this.frameCenter[0] += (cx - this.frameCenter[0]) * k;
    this.frameCenter[1] += (cy - this.frameCenter[1]) * k;
    this.frameCenter[2] += (cz - this.frameCenter[2]) * k;
    this.frameRadius += (radius - this.frameRadius) * k;
  }

  // Place the camera: orbit the attractor, or follow a curve — riding behind the
  // newest deposit looking ahead, or (tail) sitting at the oldest deposit looking
  // backward at the dissolving trail. Fills this.eye / this.center.
  private placeCamera(
    follow: boolean,
    instanceData: Float32Array,
    head: number,
    count: number,
    time: number,
    cap: number,
    angle: number,
    tail: boolean,
  ): void {
    if (follow && count > 0) {
      // Anchor: tail mode sits at the oldest deposit (the dissolving end); head
      // mode rides just behind the newest. Apply the same rotateY the shader uses.
      const idx = tail ? (head - count + cap) % cap : (head - 1 + cap) % cap;
      const o = idx * INSTANCE_FLOATS;
      const ca = Math.cos(angle);
      const sa = Math.sin(angle);
      const px = ca * instanceData[o] + sa * instanceData[o + 2];
      const py = instanceData[o + 1];
      const pz = -sa * instanceData[o] + ca * instanceData[o + 2];

      // Forward (view) direction + look-at target.
      // Head: forward = the local curve tangent (look ahead along the path).
      // Tail: the curve coils, so the local tangent spins 360° inside a loop and
      // makes the eye orbit the anchor ("backward loop", losing the trail). Instead
      // aim at an ACTUAL deposit well up the trail and use the chord toward it as
      // the forward dir — a stable bearing that tracks where the trail actually is.
      let fx: number, fy: number, fz: number;
      let tcx = 0;
      let tcy = 0;
      let tcz = 0;
      if (tail) {
        const li = (head - count + Math.min(count - 1, Math.round(count * 0.45)) + cap) % cap;
        const lo = li * INSTANCE_FLOATS;
        tcx = ca * instanceData[lo] + sa * instanceData[lo + 2];
        tcy = instanceData[lo + 1];
        tcz = -sa * instanceData[lo] + ca * instanceData[lo + 2];
        fx = tcx - px;
        fy = tcy - py;
        fz = tcz - pz;
      } else {
        fx = ca * instanceData[o + 4] + sa * instanceData[o + 6];
        fy = instanceData[o + 5];
        fz = -sa * instanceData[o + 4] + ca * instanceData[o + 6];
      }
      const fl0 = Math.hypot(fx, fy, fz) || 1;
      fx /= fl0;
      fy /= fl0;
      fz /= fl0;

      // Low-pass the forward dir (anti-jitter; snap on entering follow), renormalize.
      const p = this.followParams;
      if (this.followInit) {
        this.followTangent[0] += (fx - this.followTangent[0]) * p.headingSmooth;
        this.followTangent[1] += (fy - this.followTangent[1]) * p.headingSmooth;
        this.followTangent[2] += (fz - this.followTangent[2]) * p.headingSmooth;
      } else {
        this.followTangent[0] = fx;
        this.followTangent[1] = fy;
        this.followTangent[2] = fz;
      }
      const fl =
        Math.hypot(this.followTangent[0], this.followTangent[1], this.followTangent[2]) || 1;
      const dx = this.followTangent[0] / fl;
      const dy = this.followTangent[1] / fl;
      const dz = this.followTangent[2] / fl;

      // Eye trails `back` behind the anchor along the (smoothed) forward dir, lifted.
      // In tail mode forward points INTO the trail, so the eye backs away from it and
      // looks toward it → the dissolving end stays framed even through a loop.
      const k = this.followInit ? p.smooth : 1;
      // In cube/sphere mode the eye, sitting on the curve path, lands inside the
      // per-deposit geometry. Push it further back + lift it, scaled by the shape
      // size, so it clears the meshes (plane mode is thin → no clearance needed).
      const clear = this.shapeMode !== 0 ? this.shapeParams.size * 4 : 0;
      const back = p.back + clear * 0.5;
      const height = (tail ? 0.35 : p.height) + clear;
      this.followEye[0] += (px - dx * back - this.followEye[0]) * k;
      this.followEye[1] += (py - dy * back + height - this.followEye[1]) * k;
      this.followEye[2] += (pz - dz * back - this.followEye[2]) * k;

      // Look-at: tail aims at the upstream deposit; head looks ahead along the tangent.
      const cx = tail ? tcx : px + dx * p.ahead;
      const cy = tail ? tcy : py + dy * p.ahead;
      const cz = tail ? tcz : pz + dz * p.ahead;
      this.followCenter[0] += (cx - this.followCenter[0]) * k;
      this.followCenter[1] += (cy - this.followCenter[1]) * k;
      this.followCenter[2] += (cz - this.followCenter[2]) * k;
      for (let i = 0; i < 3; i++) {
        this.eye[i] = this.followEye[i];
        this.center[i] = this.followCenter[i];
      }
      this.followInit = true;
    } else {
      this.followInit = false;
      const orbitAngle = time * ORBIT_SPEED;
      const f = this.frameParams;
      if (f.enabled && this.frameInit) {
        // Auto-frame: orbit the occupied centre at a distance that fits the bounding
        // sphere into the TIGHTER of the two FOV axes (so portrait pulls back, wide
        // desktop comes in to fill), with a margin. Eye lifted by a fraction of dist.
        // Fit using the BASE FOV (no zoom) so the user's pinch/wheel zoom still
        // applies on top as a telephoto; folding zoom in here would cancel it out.
        const aspect = this.canvas.width / Math.max(this.canvas.height, 1);
        const halfV = FOV_Y / 2;
        const halfH = Math.atan(Math.tan(halfV) * aspect);
        const dist =
          (this.frameRadius * f.margin) / Math.max(Math.sin(Math.min(halfV, halfH)), 1e-3);
        const cx = this.frameCenter[0];
        const cy = this.frameCenter[1];
        const cz = this.frameCenter[2];
        this.eye[0] = cx + Math.sin(orbitAngle) * dist;
        this.eye[1] = cy + dist * f.height;
        this.eye[2] = cz + Math.cos(orbitAngle) * dist;
        this.center[0] = cx;
        this.center[1] = cy;
        this.center[2] = cz;
      } else {
        this.eye[0] = Math.sin(orbitAngle) * ORBIT_RADIUS;
        this.eye[1] = ORBIT_HEIGHT;
        this.eye[2] = Math.cos(orbitAngle) * ORBIT_RADIUS;
        this.center[0] = 0;
        this.center[1] = 0;
        this.center[2] = 0;
      }
    }
  }

  // Pack the live audio features + tuning into the camera uniform's audio rows
  // (40-59). Layout mirrors the shaders' Camera struct tail (audio0/audio1/tint0/
  // tint1/tint2). enabled (audio1.z) gates the whole contribution in-shader.
  private writeAudioUniform(): void {
    const d = this.cameraData;
    const a = this.audioState;
    const p = this.audioParams;
    d[40] = a.level;
    d[41] = a.bass;
    d[42] = a.mid;
    d[43] = a.treble;
    d[44] = a.centroid;
    d[45] = a.beat;
    d[46] = p.enabled ? 1 : 0;
    d[47] = p.grow;
    d[48] = p.tint;
    d[49] = p.tailStart;
    d[50] = p.tailEnd;
    d[51] = p.hueShift;
    d[52] = p.hueRange;
    d[53] = p.spin;
    d[54] = p.palette;
    d[55] = p.partTint;
    d[56] = p.partHueShift;
    d[57] = p.partGrow;
    d[58] = p.edge; // tint2.z = edge-tint width
    d[59] = 0;
  }

  private updateCamera(): void {
    const aspect = this.canvas.width / this.canvas.height;
    const eye = this.eye;
    const center = this.center;
    const worldUp: Vec3 = [0, 1, 0];

    lookAt(this.view, eye, center, worldUp);
    // Small near plane so cards close to the camera in follow mode aren't clipped.
    // FOV_Y / zoom narrows the field of view to zoom in (telephoto).
    perspectiveZO(this.proj, FOV_Y / this.zoom, aspect, 0.02, 100);
    multiply(this.viewProj, this.proj, this.view);

    // Camera basis in world space, for billboarding.
    const forward = normalize(subtract(center, eye));
    const right = normalize(cross(forward, worldUp));
    // right ⊥ forward and both unit, so up is already unit; normalize anyway as
    // cheap insurance against accumulated FP error.
    const up = normalize(cross(right, forward));

    const d = this.cameraData;
    d.set(this.viewProj, 0);
    d[16] = right[0];
    d[17] = right[1];
    d[18] = right[2];
    d[20] = up[0];
    d[21] = up[1];
    d[22] = up[2];
    // params (24-26) + ribbon (28-29) are written by renderFrame.

    // Cache the basis for the background's star view-ray reconstruction.
    this.camForward[0] = forward[0];
    this.camForward[1] = forward[1];
    this.camForward[2] = forward[2];
    this.camRight[0] = right[0];
    this.camRight[1] = right[1];
    this.camRight[2] = right[2];
    this.camUp[0] = up[0];
    this.camUp[1] = up[1];
    this.camUp[2] = up[2];
  }

  // (Re)create the depth texture to match the current canvas size.
  private ensureDepth(): void {
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (this.depthTexture && this.depthW === w && this.depthH === h) return;
    this.depthTexture?.destroy();
    this.depthTexture = this.device.createTexture({
      size: [w, h],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.depthView = this.depthTexture.createView();
    this.depthW = w;
    this.depthH = h;
  }

  // (Re)allocate the scene target (canvas-sized, canvas format) + the half-res bloom
  // ping-pong textures, then rebuild the bloom bind groups (they hold the views).
  private ensureBloomTargets(): void {
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (this.sceneTexture && this.sceneTexture.width === w && this.sceneTexture.height === h)
      return;
    this.sceneTexture?.destroy();
    this.bloomA?.destroy();
    this.bloomB?.destroy();
    const bw = Math.max(1, Math.floor(w * BLOOM_SCALE));
    const bh = Math.max(1, Math.floor(h * BLOOM_SCALE));
    const use = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
    this.sceneTexture = this.device.createTexture({
      label: 'bloom-scene',
      size: [w, h],
      format: this.canvasFormat,
      usage: use,
    });
    this.sceneView = this.sceneTexture.createView();
    this.bloomA = this.device.createTexture({
      label: 'bloom-a',
      size: [bw, bh],
      format: BLOOM_FORMAT,
      usage: use,
    });
    this.bloomB = this.device.createTexture({
      label: 'bloom-b',
      size: [bw, bh],
      format: BLOOM_FORMAT,
      usage: use,
    });
    this.bloomAView = this.bloomA.createView();
    this.bloomBView = this.bloomB.createView();
    this.bloomW = bw;
    this.bloomH = bh;
    this.buildBloomBindGroups();
  }

  private buildBloomBindGroups(): void {
    const samp = this.sampler;
    this.brightBind = this.device.createBindGroup({
      layout: this.brightPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: samp },
        { binding: 1, resource: this.sceneView! },
        { binding: 2, resource: { buffer: this.bloomUniform } },
      ],
    });
    this.blurBindA = this.device.createBindGroup({
      layout: this.blurPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: samp },
        { binding: 1, resource: this.bloomAView! },
        { binding: 2, resource: { buffer: this.bloomUniform } },
      ],
    });
    this.blurBindB = this.device.createBindGroup({
      layout: this.blurPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: samp },
        { binding: 1, resource: this.bloomBView! },
        { binding: 2, resource: { buffer: this.bloomUniform } },
      ],
    });
    this.compositeBind = this.device.createBindGroup({
      layout: this.compositePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: samp },
        { binding: 1, resource: this.sceneView! },
        { binding: 2, resource: { buffer: this.bloomUniform } },
        { binding: 3, resource: this.bloomAView! },
      ],
    });
  }

  // Bright → blur → blur (half-res ping-pong) → composite the glow over the scene
  // onto the canvas. Each step is one fullscreen-triangle pass.
  private runBloom(encoder: GPUCommandEncoder, canvasView: GPUTextureView): void {
    const pass = (view: GPUTextureView, pipeline: GPURenderPipeline, bind: GPUBindGroup): void => {
      const p = encoder.beginRenderPass({
        colorAttachments: [
          { view, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' },
        ],
      });
      p.setPipeline(pipeline);
      p.setBindGroup(0, bind);
      p.draw(3);
      p.end();
    };
    pass(this.bloomAView!, this.brightPipeline, this.brightBind); // scene → A (bright pass)
    pass(this.bloomBView!, this.blurPipeline, this.blurBindA); // A → B (blur)
    pass(this.bloomAView!, this.blurPipeline, this.blurBindB); // B → A (blur, wider)
    pass(canvasView, this.compositePipeline, this.compositeBind); // scene + A → canvas
  }

  // (Re)allocate the present target to match the canvas. The final composite renders
  // here (COPY_SRC so it can be read back); a blit pass copies it to the swapchain.
  private ensurePresentTarget(): void {
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (this.presentTexture && this.presentTexture.width === w && this.presentTexture.height === h)
      return;
    this.presentTexture?.destroy();
    this.presentTexture = this.device.createTexture({
      label: 'present',
      size: [w, h],
      format: this.canvasFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.presentView = this.presentTexture.createView();
    this.blitBind = this.device.createBindGroup({
      layout: this.blitPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: this.presentView },
      ],
    });
  }

  private ensureTemporalTargets(): void {
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (this.temporalTextureA && this.temporalW === w && this.temporalH === h) return;

    this.temporalTextureA?.destroy();
    this.temporalTextureB?.destroy();
    const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
    this.temporalTextureA = this.device.createTexture({
      label: 'temporal-feedback-a',
      size: [w, h],
      format: this.canvasFormat,
      usage,
    });
    this.temporalTextureB = this.device.createTexture({
      label: 'temporal-feedback-b',
      size: [w, h],
      format: this.canvasFormat,
      usage,
    });
    this.temporalViewA = this.temporalTextureA.createView();
    this.temporalViewB = this.temporalTextureB.createView();
    this.temporalW = w;
    this.temporalH = h;
    this.temporalReadIndex = 0;
    this.exposureTrailNeedsSeed = true;
    this.buildTemporalBindGroups();
  }

  private destroyTemporalTargets(): void {
    this.temporalTextureA?.destroy();
    this.temporalTextureB?.destroy();
    this.temporalTextureA = null;
    this.temporalTextureB = null;
    this.temporalViewA = null;
    this.temporalViewB = null;
    this.temporalW = 0;
    this.temporalH = 0;
    this.temporalReadIndex = 0;
    this.exposureTrailNeedsSeed = true;
    this.exposureTrailManualPhase = null;
  }

  private buildTemporalBindGroups(): void {
    if (!this.presentView || !this.temporalViewA || !this.temporalViewB) return;
    const layout = this.temporalPipeline.getBindGroupLayout(0);
    this.temporalBindA = this.device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: this.presentView },
        { binding: 2, resource: this.temporalViewA },
        { binding: 3, resource: { buffer: this.temporalUniform } },
      ],
    });
    this.temporalBindB = this.device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: this.presentView },
        { binding: 2, resource: this.temporalViewB },
        { binding: 3, resource: { buffer: this.temporalUniform } },
      ],
    });
  }

  private applyExposureTrail(encoder: GPUCommandEncoder): void {
    if (!this.exposureTrailParams.enabled || this.exposureTrailElapsed >= this.exposureTrailDuration)
      return;

    const phase = this.getExposureTrailReplayPhase();
    const envelope = smoothstep(0, 0.22, phase) * (1 - smoothstep(0.72, 1, phase));
    const amount =
      envelope * this.exposureTrailStrength * Math.max(0, this.exposureTrailParams.amount);
    if (amount <= 0.0001) return;

    this.ensureTemporalTargets();
    if (!this.temporalViewA || !this.temporalViewB) return;

    const readView = this.temporalReadIndex === 0 ? this.temporalViewA : this.temporalViewB;
    const writeView = this.temporalReadIndex === 0 ? this.temporalViewB : this.temporalViewA;
    const bind = this.temporalReadIndex === 0 ? this.temporalBindA : this.temporalBindB;

    if (this.exposureTrailNeedsSeed) {
      this.blitToView(encoder, readView, this.blitBind!);
      this.exposureTrailNeedsSeed = false;
    }

    this.temporalData[0] = amount;
    this.temporalData[1] = Math.max(0, Math.min(0.995, this.exposureTrailParams.decay));
    this.temporalData[2] = Math.max(0, this.exposureTrailParams.exposure);
    this.temporalData[3] = 0;
    this.device.queue.writeBuffer(this.temporalUniform, 0, this.temporalData);

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        { view: writeView, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' },
      ],
    });
    pass.setPipeline(this.temporalPipeline);
    pass.setBindGroup(0, bind);
    pass.draw(3);
    pass.end();

    this.blitToView(
      encoder,
      this.presentView!,
      this.buildBlitBindGroup(this.temporalReadIndex === 0 ? this.temporalViewB : this.temporalViewA),
    );
    this.temporalReadIndex = this.temporalReadIndex === 0 ? 1 : 0;
  }

  // Live canvas backing size — the recorder derives its (capped) output dims from this.
  get captureWidth(): number {
    return this.canvas.width;
  }
  get captureHeight(): number {
    return this.canvas.height;
  }

  // Release the offscreen capture surface (a 2nd WebGPU swapchain) — call when recording is
  // idle (e.g. the export dialog is open) to free its memory on GPU-tight devices. It's lazily
  // recreated on the next grabCompositeFrame, so this is safe to call any time.
  releaseCaptureSurface(): void {
    if (!this.captureCanvas) return;
    try {
      this.captureCtx?.unconfigure();
    } catch {
      /* context may already be gone */
    }
    this.captureCtx = null;
    this.captureCanvas = null;
    this.captureW = 0;
    this.captureH = 0;
  }

  // Grab the current composite as a VideoFrame at w×h, for the export recorder. Blits our
  // owned presentTexture into an offscreen capture canvas (NOT the live swapchain — that's
  // what glitches iOS) and snapshots it. Same aspect as the canvas → no stretch.
  grabCompositeFrame(
    w: number,
    h: number,
    timestampUs: number,
    durationUs: number,
  ): VideoFrame | null {
    if (typeof VideoFrame === 'undefined' || !this.presentView || !this.blitBind) return null;
    if (!this.captureCanvas || this.captureW !== w || this.captureH !== h) {
      this.captureCanvas = new OffscreenCanvas(w, h);
      this.captureCtx = this.captureCanvas.getContext('webgpu');
      if (!this.captureCtx) {
        this.captureCanvas = null;
        return null;
      }
      this.captureCtx.configure({
        device: this.device,
        format: this.canvasFormat,
        alphaMode: 'opaque',
      });
      this.captureW = w;
      this.captureH = h;
    }
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.captureCtx!.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    pass.setPipeline(this.blitPipeline);
    pass.setBindGroup(0, this.blitBind);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
    return new VideoFrame(this.captureCanvas, { timestamp: timestampUs, duration: durationUs });
  }

  // Capture the current composite as a PNG Blob (debug screenshots). Same owned-
  // OffscreenCanvas path as grabCompositeFrame (never reads the live swapchain →
  // iOS-safe), but encodes to PNG so it needs no WebCodecs. The PNG comes from the
  // GPU present texture, so it never includes the DOM UI.
  async capturePng(): Promise<Blob | null> {
    if (!this.presentView || !this.blitBind) return null;
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (!this.captureCanvas || this.captureW !== w || this.captureH !== h) {
      this.captureCanvas = new OffscreenCanvas(w, h);
      this.captureCtx = this.captureCanvas.getContext('webgpu');
      if (!this.captureCtx) {
        this.captureCanvas = null;
        return null;
      }
      this.captureCtx.configure({
        device: this.device,
        format: this.canvasFormat,
        alphaMode: 'opaque',
      });
      this.captureW = w;
      this.captureH = h;
    }
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.captureCtx!.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    pass.setPipeline(this.blitPipeline);
    pass.setBindGroup(0, this.blitBind);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
    return await this.captureCanvas.convertToBlob({ type: 'image/png' });
  }

  private buildBlitBindGroup(view: GPUTextureView): GPUBindGroup {
    return this.device.createBindGroup({
      layout: this.blitPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: view },
      ],
    });
  }

  private blitToView(
    encoder: GPUCommandEncoder,
    target: GPUTextureView,
    bindGroup: GPUBindGroup,
  ): void {
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: target,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    pass.setPipeline(this.blitPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
  }

  // Fullscreen blit of a texture into the present target (debug inspectors). Builds a
  // bind group per call (cheap, debug-only) for the given pipeline + texture view.
  private blitTextureToPresent(
    encoder: GPUCommandEncoder,
    pipeline: GPURenderPipeline,
    view: GPUTextureView,
  ): void {
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.presentView!,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(
      0,
      this.device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this.sampler },
          { binding: 1, resource: view },
        ],
      }),
    );
    pass.draw(3);
    pass.end();
  }

  // Capture rotation (0..3 → ×90°) + the post-rotation layer aspect. Both derive from
  // the frame's REAL dimensions, not a landscape assumption — this is what keeps the
  // image un-stretched across platforms. captureParams.rotation calibrates the offset.
  // Shared by renderFrame and the start-screen preview so the two always agree.
  private captureGeometry(video: HTMLVideoElement | null): { rotation: number; aspect: number } {
    const vw = video?.videoWidth ?? 0;
    const vh = video?.videoHeight ?? 0;
    if (!vw || !vh) return { rotation: 0, aspect: DEFAULT_ASPECT };
    // The magnitude (e.g. 16:9 → 1.78) is reliable; only the buffer's ORIENTATION is
    // unknowable from the dims (iOS reports portrait dims for a landscape buffer), so it
    // comes from the user-calibrated captureParams.sourceLandscape.
    const mag = Math.max(vw, vh) / Math.min(vw, vh);
    const bufferLandscape = this.captureParams.sourceLandscape;
    // Auto rotation brings the buffer into the screen's orientation (buffer & screen
    // disagree → +90°). With sourceLandscape correct, this is right on every platform.
    const screenLandscape = window.innerWidth >= window.innerHeight;
    const auto = bufferLandscape === screenLandscape ? 0 : 1;
    const rotation = (auto + Math.round(this.captureParams.rotation)) & 3;
    // Layer aspect = the buffer aspect, inverted on a quarter turn — so it always matches
    // the rotated content and never stretches.
    const odd = rotation === 1 || rotation === 3;
    const bufferAspect = bufferLandscape ? mag : 1 / mag;
    const aspect = odd ? 1 / bufferAspect : bufferAspect;
    return { rotation, aspect };
  }

  // Pack the camera colour grade for frameCapture.wgsl: [enabled, hue, saturation,
  // vibrance, contrast, exposure, lift]. The hue breathes (base + drift + eased Lorenz
  // pz + eased audio centroid). `lpz`/`centroid` are 0 for the static start-screen
  // preview (no scene running); the running renderFrame feeds the live values.
  private computeCameraGrade(
    time: number,
    lpz: number,
    centroid: number,
    audioOn: boolean,
  ): Float32Array {
    const p = this.cameraColorParams;
    const g = this.cameraGradeScratch;
    if (!p.enabled) {
      g[0] = 0;
      return g;
    }
    const e = this.camGradeEased;
    e.lpz += (lpz - e.lpz) * 0.08;
    e.cent += ((audioOn ? centroid : 0) - e.cent) * 0.1;
    g[0] = 1;
    g[1] = p.hue + time * p.hueDrift + p.hueLorenz * e.lpz + p.hueAudio * e.cent;
    g[2] = p.saturation;
    g[3] = p.vibrance;
    g[4] = p.contrast;
    g[5] = p.exposure;
    g[6] = p.lift;
    return g;
  }

  private setCameraCopyCrop(crop: Float32Array, state: CameraCopyCropState): void {
    this.cameraCopyCrop.set(crop);
    this.cameraStats.copyCrop = formatCameraCopyCrop(this.cameraCopyCrop);
    this.cameraStats.copyCropState = state;
  }

  private cropAdjustedAspect(aspect: number): number {
    const c = this.cameraCopyCrop;
    const remainingX = Math.max(0.05, 1 - c[0] - c[2]);
    const remainingY = Math.max(0.05, 1 - c[1] - c[3]);
    return aspect * (remainingX / remainingY);
  }

  private copyCaptureAspect(video: HTMLVideoElement | null, rotation: number): number | null {
    if (this.cameraSourcePath !== 'copy') return null;
    const sourceW = video?.videoWidth ?? 0;
    const sourceH = video?.videoHeight ?? 0;
    if (!sourceW || !sourceH) return null;

    // The copy path samples a real texture_2d with the video's reported dimensions.
    // Unlike importExternalTexture(), it does not apply the browser's presentation
    // transform for us, so its target aspect must come from the copied texture's
    // post-rotation output space, then from the detected black-edge crop.
    const odd = rotation === 1 || rotation === 3;
    const outputW = odd ? sourceH : sourceW;
    const outputH = odd ? sourceW : sourceH;
    const c = this.cameraCopyCrop;
    const remainingX = Math.max(0.05, 1 - c[0] - c[2]);
    const remainingY = Math.max(0.05, 1 - c[1] - c[3]);
    return (outputW * remainingX) / Math.max(1, outputH * remainingY);
  }

  private resetCameraCopyCropProbe(): void {
    this.copyProbeGeneration++;
    this.copyProbeSamples.length = 0;
    this.copyProbeAttempts = 0;
    this.copyProbeResolved = false;
    this.copyProbeLoggedStart = false;
    this.copyProbeBind = null;
    this.copyProbeBindView = null;
    this.copyProbeRotation = -1;
    this.setCameraCopyCrop(ZERO_COPY_CROP, this.cameraSourcePath === 'copy' ? 'idle' : 'none');
  }

  private ensureCameraCopyProbe(outputW: number, outputH: number): void {
    const count = outputW + outputH + 1;
    const size = count * Uint32Array.BYTES_PER_ELEMENT;
    if (
      this.copyProbeCountsBuffer &&
      this.copyProbeReadbackBuffer &&
      this.copyProbeBufferSize === size
    ) {
      this.copyProbeOutputW = outputW;
      this.copyProbeOutputH = outputH;
      return;
    }

    this.copyProbeCountsBuffer?.destroy();
    this.copyProbeReadbackBuffer?.destroy();
    this.copyProbeCountsBuffer = this.device.createBuffer({
      label: 'camera-copy-probe-counts',
      size,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    this.copyProbeReadbackBuffer = this.device.createBuffer({
      label: 'camera-copy-probe-readback',
      size,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    this.copyProbeBind = null;
    this.copyProbeBindView = null;
    this.copyProbeBufferSize = size;
    this.copyProbeOutputW = outputW;
    this.copyProbeOutputH = outputH;
  }

  private maybeProbeCameraCopyCrop(
    sourceView: GPUTextureView,
    rotation: number,
    video: HTMLVideoElement,
  ): void {
    if (
      this.cameraSourcePath === 'copy' &&
      this.copyProbeRotation >= 0 &&
      this.copyProbeRotation !== rotation
    ) {
      this.resetCameraCopyCropProbe();
    }
    if (
      this.destroyed ||
      this.cameraSourcePath !== 'copy' ||
      this.copyProbeResolved ||
      this.copyProbeInFlight
    ) {
      return;
    }
    if (this.copyProbeAttempts >= COPY_PROBE_MAX_ATTEMPTS) {
      this.copyProbeResolved = true;
      this.setCameraCopyCrop(ZERO_COPY_CROP, 'failed');
      console.warn('[camera-copy] crop probe gave up; using no crop');
      return;
    }
    const sourceW = video.videoWidth;
    const sourceH = video.videoHeight;
    const odd = rotation === 1 || rotation === 3;
    const outputW = odd ? sourceH : sourceW;
    const outputH = odd ? sourceW : sourceH;
    this.ensureCameraCopyProbe(outputW, outputH);
    if (!this.copyProbeCountsBuffer || !this.copyProbeReadbackBuffer) return;

    if (!this.copyProbeLoggedStart) {
      this.copyProbeLoggedStart = true;
      this.cameraStats.copyCropState = 'probing';
      console.info(
        `[camera-copy] crop probe start video=${sourceW}x${sourceH} output=${outputW}x${outputH} rotation=${rotation}`,
      );
    }
    this.copyProbeRotation = rotation;

    this.copyProbeUniformData[0] = sourceW;
    this.copyProbeUniformData[1] = sourceH;
    this.copyProbeUniformData[2] = outputW;
    this.copyProbeUniformData[3] = outputH;
    this.copyProbeUniformData[4] = rotation;
    this.copyProbeUniformData[5] = COPY_PROBE_BLACK_MAX / 255;
    this.device.queue.writeBuffer(this.copyProbeUniform, 0, this.copyProbeUniformData);
    if (this.copyProbeBindView !== sourceView || !this.copyProbeBind) {
      this.copyProbeBind = this.device.createBindGroup({
        layout: this.copyProbePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.copyProbeUniform } },
          { binding: 1, resource: sourceView },
          { binding: 2, resource: { buffer: this.copyProbeCountsBuffer } },
        ],
      });
      this.copyProbeBindView = sourceView;
    }

    const encoder = this.device.createCommandEncoder();
    encoder.clearBuffer(this.copyProbeCountsBuffer, 0, this.copyProbeBufferSize);
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.copyProbePipeline);
    pass.setBindGroup(0, this.copyProbeBind);
    pass.dispatchWorkgroups(Math.ceil(outputW / 16), Math.ceil(outputH / 16));
    pass.end();
    encoder.copyBufferToBuffer(
      this.copyProbeCountsBuffer,
      0,
      this.copyProbeReadbackBuffer,
      0,
      this.copyProbeBufferSize,
    );
    this.device.queue.submit([encoder.finish()]);

    this.copyProbeInFlight = true;
    this.copyProbeAttempts++;
    const generation = this.copyProbeGeneration;
    const attempt = this.copyProbeAttempts;
    const buffer = this.copyProbeReadbackBuffer;
    const probeOutputW = this.copyProbeOutputW;
    const probeOutputH = this.copyProbeOutputH;
    void buffer
      .mapAsync(GPUMapMode.READ)
      .then(() => {
        const counts = new Uint32Array(buffer.getMappedRange());
        const result = analyzeCameraCopyProbe(counts, probeOutputW, probeOutputH);
        buffer.unmap();
        if (this.destroyed || generation !== this.copyProbeGeneration) {
          this.copyProbeInFlight = false;
          return;
        }

        this.copyProbeInFlight = false;
        if (result.blackRatio >= COPY_PROBE_SKIP_BLACK_RATIO) {
          console.info(
            `[camera-copy] crop probe ${attempt}/${COPY_PROBE_MAX_ATTEMPTS} skipped blackRatio=${result.blackRatio.toFixed(2)}`,
          );
          return;
        }

        this.copyProbeSamples.push(result.crop);
        console.info(
          `[camera-copy] crop probe sample ${this.copyProbeSamples.length}/${COPY_PROBE_SAMPLE_COUNT} crop=${formatCameraCopyCrop(result.crop)} blackRatio=${result.blackRatio.toFixed(2)}`,
        );
        if (this.copyProbeSamples.length < COPY_PROBE_SAMPLE_COUNT) return;

        const crop = medianCameraCopyCrop(this.copyProbeSamples);
        const hasCrop = crop.some((v) => v > 0);
        this.copyProbeResolved = true;
        this.setCameraCopyCrop(crop, hasCrop ? 'detected' : 'none');
        console.info(
          `[camera-copy] crop probe ${hasCrop ? 'detected' : 'none'} crop=${formatCameraCopyCrop(crop)}`,
        );
      })
      .catch((err: unknown) => {
        if (this.destroyed || generation !== this.copyProbeGeneration) return;
        this.copyProbeInFlight = false;
        this.copyProbeResolved = true;
        this.setCameraCopyCrop(ZERO_COPY_CROP, 'failed');
        console.warn('[camera-copy] crop probe failed; using no crop', err);
      });
  }

  private copyCameraFrame(video: HTMLVideoElement): GPUTextureView | null {
    if (typeof this.device.queue.copyExternalImageToTexture !== 'function') {
      this.cameraStats.copyFallbacks++;
      return null;
    }
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (w <= 0 || h <= 0) {
      this.cameraStats.copyFallbacks++;
      return null;
    }
    if (!this.cameraCopyTexture || this.cameraCopyW !== w || this.cameraCopyH !== h) {
      this.cameraCopyTexture?.destroy();
      this.cameraCopyTexture = this.device.createTexture({
        label: 'camera-copy',
        size: [w, h],
        format: 'rgba8unorm',
        usage:
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.RENDER_ATTACHMENT,
      });
      this.cameraCopyView = this.cameraCopyTexture.createView();
      this.cameraCopyW = w;
      this.cameraCopyH = h;
      this.resetCameraCopyCropProbe();
    }
    const texture = this.cameraCopyTexture;
    const view = this.cameraCopyView;
    if (!texture || !view) {
      this.cameraStats.copyFallbacks++;
      return null;
    }
    try {
      this.device.queue.copyExternalImageToTexture(
        { source: video },
        {
          texture,
          mipLevel: 0,
          origin: { x: 0, y: 0, z: 0 },
          aspect: 'all',
        },
        { width: w, height: h },
      );
      this.cameraStats.copies++;
      return view;
    } catch (err) {
      this.cameraStats.copyFallbacks++;
      if (!this.loggedCopyFail) {
        this.loggedCopyFail = true;
        console.warn('[lorenz] camera copy failed; falling back to external texture', err);
      }
      return null;
    }
  }

  // Render one start-screen preview frame: capture `video` into a 1-layer ring with
  // the engine's EXACT rotation (frameCapture.wgsl), then present it cover-fit to
  // `canvas` with background.wgsl's still convention. So the preview is byte-for-byte
  // the orientation the ribbon/curve-B/HD will store — WYSIWYG on iOS and Android.
  // The first call kicks off async pipeline build and returns false until ready.
  renderCameraPreview(video: HTMLVideoElement, canvas: HTMLCanvasElement): boolean {
    if (this.destroyed) return false;
    if (!this.previewPipeline || !this.previewRing || !this.previewUniform) {
      if (!this.previewInitStarted) {
        this.previewInitStarted = true;
        void this.initPreview();
      }
      return false;
    }

    const format = navigator.gpu.getPreferredCanvasFormat();
    if (this.previewCanvasEl !== canvas) {
      const ctx = canvas.getContext('webgpu');
      if (!ctx) return false;
      ctx.configure({ device: this.device, format, alphaMode: 'premultiplied' });
      this.previewCtx = ctx;
      this.previewCanvasEl = canvas;
    }
    const ctx = this.previewCtx;
    if (!ctx) return false;

    const { rotation, aspect: rawAspect } = this.captureGeometry(video);
    const aspect = this.copyCaptureAspect(video, rotation) ?? this.cropAdjustedAspect(rawAspect);
    this.previewRing.resize(aspect); // present bind group is rebuilt each frame below

    const encoder = this.device.createCommandEncoder();
    // Pass 1: capture the frame into layer 0 with the engine's rotation + colour grade
    // (static here — no live Lorenz/audio on the start screen, so the hue doesn't drift).
    const grade = this.computeCameraGrade(0, 0, 0, false);
    const copiedView = this.cameraSourcePath === 'copy' ? this.copyCameraFrame(video) : null;
    if (copiedView) {
      this.maybeProbeCameraCopyCrop(copiedView, rotation, video);
      this.previewRing.captureFrom(
        encoder,
        copiedView,
        this.previewSlot,
        1,
        rotation,
        grade,
        this.cameraCopyCrop,
      );
    } else {
      let externalTexture: GPUExternalTexture;
      try {
        externalTexture = this.device.importExternalTexture({ source: video });
        this.cameraStats.imports++;
      } catch {
        return false;
      }
      this.previewRing.capture(encoder, externalTexture, this.previewSlot, 1, rotation, grade);
    }

    // Pass 2: present layer 0 cover-fit to the preview canvas.
    this.previewUniformData[0] = aspect; // imgAspect
    this.previewUniformData[1] = canvas.width / Math.max(1, canvas.height); // canvasAspect
    this.device.queue.writeBuffer(this.previewUniform, 0, this.previewUniformData);
    const bind = this.device.createBindGroup({
      layout: this.previewPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.previewUniform } },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: this.previewRing.arrayView },
      ],
    });
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: ctx.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    pass.setPipeline(this.previewPipeline);
    pass.setBindGroup(0, bind);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
    return true;
  }

  private async initPreview(): Promise<void> {
    if (this.destroyed) return;
    const module = await createModule(this.device, cameraPreviewShader);
    if (this.destroyed) return;
    const format = navigator.gpu.getPreferredCanvasFormat();
    const pipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    });
    const uniform = this.device.createBuffer({
      size: 4 * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const ring = await FrameRingBuffer.create(this.device, 1, DEFAULT_ASPECT);
    if (this.destroyed) {
      ring.destroy();
      uniform.destroy();
      return;
    }
    this.previewPipeline = pipeline;
    this.previewUniform = uniform;
    this.previewRing = ring;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.depthTexture?.destroy();
    this.ring.destroy();
    this.ring2.destroy();
    this.hd.destroy();
    this.previewRing?.destroy();
    this.previewUniform?.destroy();
    this.synth.destroy();
    this.trailTexture?.destroy();
    this.fieldTexture.destroy();
    this.bgUniformBuffer.destroy();
    this.gridUniformBuffer.destroy();
    this.gridVertexBuffer.destroy();
    this.cameraBuffer2.destroy();
    this.depositsBuffer2.destroy();
    this.shapeParamsBuffer.destroy();
    this.morphInBuf.destroy();
    this.morphOutBuf.destroy();
    this.particleParamsBuffer.destroy();
    this.headParamsBuffer.destroy();
    this.cubeBuffer.destroy();
    this.sphereBuffer.destroy();
    this.sceneTexture?.destroy();
    this.bloomA?.destroy();
    this.bloomB?.destroy();
    this.bloomUniform.destroy();
    this.temporalTextureA?.destroy();
    this.temporalTextureB?.destroy();
    this.temporalUniform.destroy();
    this.presentTexture?.destroy();
    this.cameraCopyTexture?.destroy();
    this.copyProbeCountsBuffer?.destroy();
    this.copyProbeReadbackBuffer?.destroy();
    this.copyProbeUniform.destroy();
    this.device.destroy();
  }
}
