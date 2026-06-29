// Tail dissolution as drifting 3D particles. Each dissolving deposit emits a 4×4
// grid of small meshes (cube/sphere geometry) that fly off — velocity derived
// from the curve's tangent (its kinetic motion) plus a random per-particle
// dispersion — tumble on two axes, shrink and vanish. Instanced over
// (tailDeposit, particle) pairs; reuses the camera uniform + ring + deposits.

const GRID = 4u;
const PER = 16u; // GRID * GRID
const PARTICLE_LIFETIME = 1.5; // seconds — fixed, so drift rate is speed-independent

struct Camera {
  viewProj: mat4x4<f32>,
  right: vec3<f32>,
  _p0: f32,
  up: vec3<f32>,
  cardAspect: f32,
  params: vec4<f32>, // x = ageRef, w = useCamera
  ribbon: vec4<f32>, // x = oldestSlot, y = capacity
  curve: vec4<f32>, // x = rotateY angle, yzw = age tint
  misc: vec4<f32>, // x = opacity, w = deposit rate (deposits/sec)
  audio0: vec4<f32>, // level, bass, mid, treble
  audio1: vec4<f32>, // centroid, beat, enabled, grow
  tint0: vec4<f32>, // tintAmt, tailStart, tailEnd, hueShift
  tint1: vec4<f32>, // hueRange, spin, palette, partTint
  tint2: vec4<f32>, // partHueShift, partGrow, _, _
};

struct Deposit {
  posBirth: vec4<f32>,
  tangentPad: vec4<f32>,
  audioSnap: vec4<f32>, // audio at birth: x = centroid, y = beat, z = bass, w = treble
};

struct ParticleParams {
  size: f32,
  drift: f32,
  spin: f32,
  start: f32, // dissolve start age
};

@group(0) @binding(0) var<uniform> cam: Camera;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var ring: texture_2d_array<f32>;
@group(0) @binding(3) var<storage, read> deposits: array<Deposit>;
@group(0) @binding(4) var<uniform> pp: ParticleParams;

fn rotY(p: vec3<f32>, a: f32) -> vec3<f32> {
  let c = cos(a);
  let s = sin(a);
  return vec3<f32>(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

fn tumble(p: vec3<f32>, a1: f32, a2: f32) -> vec3<f32> {
  let q = rotY(p, a1);
  let c = cos(a2);
  let s = sin(a2);
  return vec3<f32>(q.x, c * q.y - s * q.z, s * q.y + c * q.z);
}

fn hash33(p3in: vec3<f32>) -> vec3<f32> {
  var p3 = fract(p3in * vec3<f32>(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}

// IQ cosine gradient palette (see ribbon.wgsl) — kept in sync across shaders.
fn pal(tIn: f32, shift: f32, sel: f32) -> vec3<f32> {
  let t = fract(tIn + shift);
  var d = vec3<f32>(0.0, 0.33, 0.67);
  if (sel > 1.5) {
    d = vec3<f32>(0.0, 0.10, 0.20);
  } else if (sel > 0.5) {
    d = vec3<f32>(0.3, 0.20, 0.20);
  }
  return vec3<f32>(0.5) + vec3<f32>(0.5) * cos(6.28318 * (t + d));
}

// Beat/bass scale-pop from this deposit's FROZEN audio snapshot, so a particle's
// size is set at spawn and doesn't keep pulsing with the live music afterward.
// partGrow (a live slider) stays a live multiplier so it tunes instantly.
fn audioPop(snap: vec4<f32>) -> f32 {
  if (cam.audio1.z < 0.5) { return 0.0; }
  return cam.tint2.y * (snap.y * 0.8 + snap.z * 0.3); // partGrow * (beat + bass)
}

struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) age: f32,
  @location(3) @interpolate(flat) layer: u32,
  @location(4) aud: vec4<f32>, // this deposit's frozen audio snapshot
};

@vertex
fn vs(
  @location(0) localPos: vec3<f32>,
  @location(1) localNormal: vec3<f32>,
  @location(2) uv: vec2<f32>,
  @builtin(instance_index) s: u32,
) -> VSOut {
  let dep = s / PER;
  let pidx = s % PER;
  let capacity = u32(cam.ribbon.y);
  let slot = (u32(cam.ribbon.x) + dep) % capacity;
  let P = deposits[slot].posBirth;
  let center = rotY(P.xyz, cam.curve.x);
  let age = clamp((cam.params.x - P.w) / max(cam.ribbon.y, 1.0), 0.0, 1.0);
  let snap = deposits[slot].audioSnap;

  // Real-time-decoupled progress: real seconds since this deposit entered the
  // dissolve zone ≈ (age - start) * capacity / depositRate, over a fixed lifetime.
  // depositRate cancels in d(prog)/dt → the drift/tumble rate is independent of the
  // ribbon speed. Appears (positionally) at the start, then shrinks as it drifts.
  let depositRate = max(cam.misc.w, 0.001);
  let tSince = max(age - pp.start, 0.0) * cam.ribbon.y / depositRate;
  let prog = clamp(tSince / PARTICLE_LIFETIME, 0.0, 1.0);
  let pop = audioPop(snap); // frozen at this point's birth
  let scale = pp.size * smoothstep(pp.start, pp.start + 0.05, age) * (1.0 - prog) * (1.0 + pop);

  // Grid cell within the (billboard) card footprint → matches the broken-up frame.
  let gx = f32(pidx % GRID);
  let gy = f32(pidx / GRID);
  let cellUv = vec2<f32>((gx + 0.5) / f32(GRID), (gy + 0.5) / f32(GRID));
  let off = (cellUv - vec2<f32>(0.5)) * pp.size * 3.0;
  let basePos = center + cam.right * off.x + cam.up * off.y;

  // Velocity: curve tangent (kinetic motion) + random dispersion.
  let tan = normalize(rotY(deposits[slot].tangentPad.xyz, cam.curve.x) + vec3<f32>(1e-4));
  let h = hash33(vec3<f32>(f32(slot), f32(pidx), 1.7));
  let randDir = normalize(h * 2.0 - vec3<f32>(1.0));
  let vel = normalize(tan * 0.6 + randDir * 0.85);
  let pos = basePos + vel * prog * pp.drift * (1.0 + pop);

  // Treble (frozen at birth) adds a shimmer spin on top of the base tumble.
  let shimmer = select(0.0, cam.tint1.y * snap.w, cam.audio1.z > 0.5);
  let a1 = prog * pp.spin * 6.2831 + h.x * 6.2831 + prog * shimmer * 8.0;
  let a2 = prog * pp.spin * 4.0 + h.y * 6.2831 + prog * shimmer * 6.0;
  let world = pos + tumble(localPos, a1, a2) * scale;

  var out: VSOut;
  out.position = cam.viewProj * vec4<f32>(world, 1.0);
  out.uv = cellUv;
  out.normal = tumble(localNormal, a1, a2);
  out.age = age;
  out.layer = slot;
  out.aud = snap;
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  let aged = mix(vec3<f32>(1.0, 0.55, 0.2), vec3<f32>(0.25, 0.5, 1.0), in.age) * cam.curve.yzw;
  let tex = textureSampleLevel(ring, samp, in.uv, i32(in.layer), 0.0).rgb;
  var col = select(aged, tex, cam.params.w > 0.5);

  let l = normalize(vec3<f32>(0.4, 0.8, 0.5));
  let diff = max(dot(normalize(in.normal), l), 0.0) * 0.35 + 0.85;
  col = col * diff;

  // Dissolution-particle palette tint, with its own amount + hue offset so the
  // sparks can carry a different colour than the ribbon. Hue comes from the
  // centroid FROZEN on this point, so each spark keeps its own colour.
  if (cam.audio1.z > 0.5 && cam.tint1.w > 0.0) {
    let tcol = pal(in.aud.x * cam.tint1.x, cam.tint2.x, cam.tint1.z);
    col = col * mix(vec3<f32>(1.0), tcol * 1.8, cam.tint1.w) + tcol * (in.aud.y * cam.tint1.w * 0.6);
  }
  return vec4<f32>(col, 1.0);
}
