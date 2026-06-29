// Integrates a single Lorenz point on the CPU (RK4) and records a rolling
// history of its positions as a ring buffer. The history is the geometry of the
// 3D frame-ribbon: each deposit becomes one segment.
//
// Deposits are emitted by ARC LENGTH (every `spacing` world units travelled),
// not by time — so segment length (and therefore each frame's size on the band)
// is independent of the generation speed.
//
// Stability: RK4 with a clamped step + respawn on NaN / escape.
import { type LorenzParams, DEFAULT_LORENZ_PARAMS } from './LorenzParams.ts';

type Vec3 = [number, number, number];

const MAX_RADIUS = 200;
// We integrate the NORMALIZED Lorenz field (unit speed), so the point traces the
// same attractor shape but at constant speed → steady generation regardless of
// where the raw velocity is high or low. Substep is in raw-space arc length.
const RAW_SUBSTEP = 0.2;
const FIELD_EPS = 1e-3;

// Map raw Lorenz coordinates into a roughly unit-sized, centred world space:
// the attractor sits around z≈25, so we lift it to the vertical axis and scale.
const WORLD_SCALE = 0.06;
const Z_CENTER = 25;

// Debug "straight" mode: a non-chaotic steering beam to calibrate the motion
// influence. The audio/pointer/pad-driven params steer it around their neutral values:
// sigma → yaw, rho → pitch (the two pad axes), beta → curvature (the beam arcs).
// Neutral params ⇒ a perfectly straight beam. Tunable feel here; the input gains
// stay in App's Motion group (TiltGain / TwistGain).
const STRAIGHT_SIGMA0 = 10;
const STRAIGHT_RHO0 = 28;
const STRAIGHT_BETA0 = 8 / 3;
const STRAIGHT_YAW = 0.2; // aim lean per unit of sigma offset
const STRAIGHT_PITCH = 0.1; // aim lean per unit of rho offset
const STRAIGHT_CURV = 0.05; // heading turn (rad / raw unit) per unit of beta offset

// Floats per instance: [worldX, worldY, worldZ, birthSeq, tangentX, tangentY,
// tangentZ, _pad, centroid, beat, bass, treble]. Three vec4 storage rows on the
// GPU side. The last row is a snapshot of the audio features at the moment the
// deposit is laid down — frozen per-point so the curve records the music over
// time (tint/grow/size read it instead of the live audio), rather than the whole
// curve pulsing globally. All zero when audio is off.
export const INSTANCE_FLOATS = 12;

const MAX_DEPOSITS_PER_FRAME = 8; // matches depositedSlots length (caps runaway)

export class LorenzMapper {
  // Per-instance data consumed by the renderer (INSTANCE_FLOATS per card).
  // Reused in place (no per-frame allocation).
  instanceData: Float32Array;
  capacity: number;
  count = 0;
  time = 0;
  speed: number; // curve-generation speed (live-tunable)
  spacing: number; // world-space arc length between deposits = segment length

  // Slots written this frame, so the renderer can capture a camera frame into
  // exactly those ring layers. Reused in place (no per-frame allocation).
  readonly depositedSlots = new Int32Array(MAX_DEPOSITS_PER_FRAME);
  depositedCount = 0;

  // Current audio snapshot (centroid, beat, bass, treble), set by App each frame
  // before update(). Baked into every deposit at birth → frozen per-point.
  readonly audioSnap = new Float32Array(4);

  // Live world-space position of the integrator head, updated every frame even
  // between deposits.
  readonly worldPoint = new Float32Array(3);

  private head = 0;
  private depositSeq = 0; // monotonic deposit counter (drives age)
  private sinceDist = 0; // arc length accumulated toward the next deposit

  private readonly params: LorenzParams;
  private p: Vec3 = [0.1, 0.0, 0.0];
  private readonly prevWorld: Vec3 = [0, 0, 0];
  private hasPrev = false;

  // Debug straight-beam mode (see setStraight): swaps the chaotic field for a
  // motion-steered beam to calibrate the pointer/pad influence. straightAngle
  // accumulates the beta-driven curvature along the path.
  straight = false;
  private straightAngle = 0;

  // Index just past the newest deposit. The oldest valid slot is
  // (head - count + capacity) % capacity — used to walk deposits chronologically.
  get headIndex(): number {
    return this.head;
  }

  // Age reference: ageNorm in the shader = (ageRef - birthSeq) / capacity.
  get ageRef(): number {
    return this.depositSeq;
  }

  // Fractional arc-length progress toward the next deposit (0..1). Lets the comet
  // ride the scrolling ribbon continuously instead of hopping one segment each time
  // a deposit is added (deposits arrive irregularly, not once per frame).
  get scrollPhase(): number {
    return Math.min(this.sinceDist / Math.max(this.spacing, 1e-3), 1);
  }

  constructor(
    capacity = 128,
    spacing = 0.05,
    params: LorenzParams = DEFAULT_LORENZ_PARAMS,
    start: Vec3 = [0.1, 0.0, 0.0],
  ) {
    this.capacity = capacity;
    this.spacing = spacing;
    this.instanceData = new Float32Array(capacity * INSTANCE_FLOATS);
    this.params = { ...params };
    this.speed = params.speed;
    this.p = [start[0], start[1], start[2]];
  }

  // Resize the deposit history = ribbon length (number of frame-cards kept along
  // the curve). Reallocates the instance store and restarts the ring from the
  // current integrator position (no jump deposit) — the band regrows over the
  // next deposits. The GPU ring + deposits buffer must be resized to match (see
  // WebGPUContext.setCapacity).
  setCapacity(capacity: number): void {
    const cap = Math.max(2, Math.round(capacity));
    if (cap === this.capacity) return;
    this.capacity = cap;
    this.instanceData = new Float32Array(cap * INSTANCE_FLOATS);
    this.count = 0;
    this.head = 0;
    this.depositSeq = 0;
    this.sinceDist = 0;
    this.hasPrev = false; // re-seed prevWorld from the current point next update
  }

  // Live-update the attractor parameters (e.g. audio-driven — see App). Only new
  // deposits reflect the change, so the curve records the parameter history. The
  // caller is responsible for keeping values in stable ranges.
  setParams(sigma: number, rho: number, beta: number): void {
    this.params.sigma = sigma;
    this.params.rho = rho;
    this.params.beta = beta;
  }

  // Toggle the debug straight-beam mode. Re-seeds the arc-length chain so the
  // switch doesn't emit one giant bridging segment between the two trajectories.
  setStraight(on: boolean): void {
    if (on === this.straight) return;
    this.straight = on;
    this.straightAngle = 0;
    this.hasPrev = false;
    this.sinceDist = 0;
  }

  // Flag the most-recently deposited card as a "key frame" — the camera frame
  // that was just captured as an HD background still. Reuses the spare _pad lane
  // (instanceData index 7 = tangentPad.w); depositAt() zeroes it on every new
  // deposit, so the mark rides this tile down the ribbon and recycles out with it.
  markKeyFrame(): void {
    if (this.count === 0) return;
    const idx = (this.head - 1 + this.capacity) % this.capacity;
    this.instanceData[idx * INSTANCE_FLOATS + 7] = 1;
  }

  update(dt: number): void {
    // NaN/Infinity dt → remaining is NaN → loops below are skipped (state stays
    // finite). Negative dt is clamped to 0.
    const step = Math.min(Math.max(dt, 0), 0.05);
    this.time += step;
    this.depositedCount = 0;

    // Advance at constant world speed: `speed` world units/sec → raw arc length
    // = speed/WORLD_SCALE per second (the field is unit-magnitude).
    let remaining = (step * this.speed) / WORLD_SCALE;
    while (remaining > 1e-9) {
      const h = Math.min(remaining, RAW_SUBSTEP);
      if (this.straight) this.straightStep(h);
      else this.p = rk4(this.p, h, this.params);
      remaining -= h;
    }

    if (!isFinite(this.p[0]) || !isFinite(this.p[1]) || !isFinite(this.p[2])) {
      this.respawn();
    } else if (!this.straight && Math.hypot(this.p[0], this.p[1], this.p[2]) > MAX_RADIUS) {
      // The straight beam travels indefinitely (the ring + auto-frame keep it in
      // view); only respawn it on non-finite values, not on distance.
      this.respawn();
    }

    const cx = this.p[0] * WORLD_SCALE;
    const cy = (this.p[2] - Z_CENTER) * WORLD_SCALE;
    const cz = this.p[1] * WORLD_SCALE;
    this.worldPoint[0] = cx;
    this.worldPoint[1] = cy;
    this.worldPoint[2] = cz;

    if (!this.hasPrev) {
      this.prevWorld[0] = cx;
      this.prevWorld[1] = cy;
      this.prevWorld[2] = cz;
      this.hasPrev = true;
      return;
    }

    // Walk from the previous position toward the current one, emitting a deposit
    // every `spacing` of arc length (interpolated). Constant segment length ⇒
    // frame size independent of speed; speed only changes the deposit cadence.
    const spacing = Math.max(this.spacing, 1e-3);
    let fx = this.prevWorld[0];
    let fy = this.prevWorld[1];
    let fz = this.prevWorld[2];
    let dx = cx - fx;
    let dy = cy - fy;
    let dz = cz - fz;
    let segDist = Math.hypot(dx, dy, dz);
    let need = spacing - this.sinceDist;

    while (segDist >= need && segDist > 1e-9 && this.depositedCount < MAX_DEPOSITS_PER_FRAME) {
      const t = need / segDist;
      fx += dx * t;
      fy += dy * t;
      fz += dz * t;
      const inv = 1 / segDist;
      this.depositAt(fx, fy, fz, dx * inv, dy * inv, dz * inv);
      this.sinceDist = 0;
      dx = cx - fx;
      dy = cy - fy;
      dz = cz - fz;
      segDist = Math.hypot(dx, dy, dz);
      need = spacing;
    }
    this.sinceDist += segDist;

    this.prevWorld[0] = cx;
    this.prevWorld[1] = cy;
    this.prevWorld[2] = cz;
  }

  private depositAt(wx: number, wy: number, wz: number, tx: number, ty: number, tz: number): void {
    const i = this.head * INSTANCE_FLOATS;
    this.instanceData[i] = wx;
    this.instanceData[i + 1] = wy;
    this.instanceData[i + 2] = wz;
    this.instanceData[i + 3] = this.depositSeq; // birthSeq (for age)
    this.instanceData[i + 4] = tx;
    this.instanceData[i + 5] = ty;
    this.instanceData[i + 6] = tz;
    this.instanceData[i + 7] = 0;
    // Freeze the current audio snapshot onto this point (centroid, beat, bass, treble).
    this.instanceData[i + 8] = this.audioSnap[0];
    this.instanceData[i + 9] = this.audioSnap[1];
    this.instanceData[i + 10] = this.audioSnap[2];
    this.instanceData[i + 11] = this.audioSnap[3];

    if (this.depositedCount < this.depositedSlots.length) {
      this.depositedSlots[this.depositedCount++] = this.head;
    }
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
    this.depositSeq++;
  }

  // One substep of the debug straight beam (arc length h, raw space). The heading
  // is aimed by sigma (yaw, toward +Y/depth) and rho (pitch, toward +Z/up) off a
  // base +X axis, then rotated about world-up by the accumulated beta-curvature.
  // All three are the live audio/pointer/pad-driven params → calibrates the real chain;
  // at the neutral params the beam is perfectly straight.
  private straightStep(h: number): void {
    const yaw = (this.params.sigma - STRAIGHT_SIGMA0) * STRAIGHT_YAW;
    const pitch = (this.params.rho - STRAIGHT_RHO0) * STRAIGHT_PITCH;
    const kappa = (this.params.beta - STRAIGHT_BETA0) * STRAIGHT_CURV;
    this.straightAngle += kappa * h;
    const c = Math.cos(this.straightAngle);
    const s = Math.sin(this.straightAngle);
    let hx = c - yaw * s;
    let hy = s + yaw * c;
    let hz = pitch;
    const inv = 1 / Math.max(Math.hypot(hx, hy, hz), 1e-6);
    hx *= inv;
    hy *= inv;
    hz *= inv;
    this.p[0] += hx * h;
    this.p[1] += hy * h;
    this.p[2] += hz * h;
  }

  private respawn(): void {
    this.p = [0.1, 0.0, 0.0];
    this.hasPrev = false; // restart the arc-length chain after a jump
    this.sinceDist = 0;
    this.straightAngle = 0;
  }
}

function lorenz(p: Vec3, params: LorenzParams): Vec3 {
  const [x, y, z] = p;
  return [params.sigma * (y - x), x * (params.rho - z) - y, x * y - params.beta * z];
}

// Unit-magnitude Lorenz direction, so RK4 advances by arc length (constant
// speed). Near-stationary points keep their tiny velocity to avoid blow-up.
function field(p: Vec3, params: LorenzParams): Vec3 {
  const v = lorenz(p, params);
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len < FIELD_EPS) return v;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function rk4(p: Vec3, h: number, params: LorenzParams): Vec3 {
  const k1 = field(p, params);
  const k2 = field(add(p, scale(k1, h / 2)), params);
  const k3 = field(add(p, scale(k2, h / 2)), params);
  const k4 = field(add(p, scale(k3, h)), params);
  return [
    p[0] + (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]),
    p[1] + (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]),
    p[2] + (h / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]),
  ];
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}
