// Per-deposit instanced 3D shapes (cube / sphere), an alternative to the flat
// ribbon band. One mesh instance per Lorenz deposit, placed along the curve,
// textured with that deposit's camera frame (or an age colour), lit by face
// normal. Shares the ribbon's camera uniform (viewProj, rotation, capacity, …).
//
// EXTENSIBILITY: `modulation()` is the single place that derives per-deposit
// scale/spin. Wire future parameter- or audio-FFT-driven variation there (e.g.
// add an `audioSpectrum` storage buffer and sample it by slot/age).

struct Camera {
  viewProj: mat4x4<f32>,
  right: vec3<f32>,
  _p0: f32,
  up: vec3<f32>,
  cardAspect: f32,
  params: vec4<f32>, // x = ageRef, w = useCamera
  ribbon: vec4<f32>, // x = oldestSlot, y = capacity
  curve: vec4<f32>, // x = rotateY angle, yzw = age tint
  misc: vec4<f32>, // x = opacity, y = tail glow intensity, z = glow start age
  audio0: vec4<f32>, // level, bass, mid, treble
  audio1: vec4<f32>, // centroid, beat, enabled, grow
  tint0: vec4<f32>, // tintAmt, tailStart, tailEnd, hueShift
  tint1: vec4<f32>, // hueRange, spin, palette, partTint
  tint2: vec4<f32>, // partHueShift, partGrow, _, time (w)
  // x = glow strength, y = pulse freq, z = hue (palette pos), w = tint strength
  key: vec4<f32>,
  // Traveling glow sweep: x = pulse centre (age), y = half-width, z = glow strength,
  // w = scale boost. Inactive when y <= 0 (sweepWeight → 0, zero effect).
  sweep: vec4<f32>,
};

struct Deposit {
  posBirth: vec4<f32>,
  tangentPad: vec4<f32>,
  audioSnap: vec4<f32>, // audio at birth: x = centroid, y = beat, z = bass, w = treble
};

struct ShapeParams {
  size: f32,
  spin: f32,
  _a: f32,
  _b: f32,
};

@group(0) @binding(0) var<uniform> cam: Camera;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var ring: texture_2d_array<f32>;
@group(0) @binding(3) var<storage, read> deposits: array<Deposit>;
@group(0) @binding(4) var<uniform> shape: ShapeParams;

// Shape-morph front (group 1): a wave that sweeps from the head (age 0) to the tail
// (age 1), shrinking the outgoing form and growing the incoming one.
struct Morph { p: vec4<f32> }; // x = front w, y = band, z = mode (0 in / 1 out), w = active
@group(1) @binding(0) var<uniform> morph: Morph;

// Per-element weight: 1 at the head, falling to 0 just past the front `w` over a
// `band` of smoothing. The incoming form uses it directly, the outgoing form its
// complement; active=0 (at rest) → 1, so the shape stays full-size (zero effect).
// Edges are kept increasing (w-band < w+band) — smoothstep with edge0 >= edge1 is
// undefined in WGSL, which can bite on WebKit/iOS.
fn morphWeight(a: f32) -> f32 {
  let revealIn = 1.0 - smoothstep(morph.p.x - morph.p.y, morph.p.x + morph.p.y, a);
  let wgt = select(revealIn, 1.0 - revealIn, morph.p.z > 0.5);
  return select(1.0, wgt, morph.p.w > 0.5);
}

// Soft gaussian bump centred on the sweep front (cam.sweep.x), ~0 beyond ±half-width
// (cam.sweep.y). Returns 0 when the sweep is idle (half-width <= 0).
fn sweepWeight(a: f32) -> f32 {
  if (cam.sweep.y <= 0.0) { return 0.0; }
  let d = (a - cam.sweep.x) / cam.sweep.y;
  return exp(-d * d * 4.0);
}

fn rotY(p: vec3<f32>, a: f32) -> vec3<f32> {
  let c = cos(a);
  let s = sin(a);
  return vec3<f32>(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
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

// snap = this deposit's FROZEN audio (centroid, beat, bass, treble).
fn audioGrow(snap: vec4<f32>) -> f32 {
  if (cam.audio1.z < 0.5) { return 0.0; }
  return cam.audio1.w * (snap.z + snap.y * 0.7);
}

// Additive palette tint on the face EDGES only (UV borders), leaving the texture
// centre clean — matches the ribbon's edge tint. tint2.z = edge width.
fn audioTint(color: vec3<f32>, age: f32, snap: vec4<f32>, uv: vec2<f32>) -> vec3<f32> {
  if (cam.audio1.z < 0.5 || cam.tint0.x <= 0.0) { return color; }
  let lo = cam.tint0.y;
  let hi = max(cam.tint0.z, lo + 0.01);
  let band = smoothstep(lo, lo + 0.05, age) * (1.0 - smoothstep(hi - 0.05, hi, age));
  let amt = cam.tint0.x * band;
  if (amt <= 0.0) { return color; }
  let ew = max(cam.tint2.z, 0.001);
  let d = max(abs(uv.x - 0.5), abs(uv.y - 0.5)); // distance to the nearest face edge
  let edge = smoothstep(0.5 - ew, 0.5, d);
  let tcol = pal(snap.x * cam.tint1.x, cam.tint0.w, cam.tint1.z);
  return color + tcol * (amt * edge * (1.0 + snap.y * 1.2));
}

struct ModOut {
  scale: f32,
  spin: f32,
};

// Central per-deposit modulation hook: global size + a tail shrink + a per-deposit
// varied spin, driven by this point's FROZEN audio — bass/beat swell the size,
// treble adds a shimmer spin (gated to zero when audio is disabled).
fn modulation(age: f32, slot: u32, snap: vec4<f32>) -> ModOut {
  var m: ModOut;
  let env = 1.0 - smoothstep(0.85, 1.0, age); // shrink into the tail
  // Traveling glow swells the mesh as the pulse passes over this deposit — 3D shapes
  // read the boost more weakly than the flat band, so amplify it (1.8×) for parity.
  let grow = 1.0 + cam.sweep.w * 1.8 * sweepWeight(age);
  m.scale = shape.size * env * (1.0 + audioGrow(snap)) * morphWeight(age) * grow;
  var shimmer = 0.0;
  if (cam.audio1.z > 0.5) {
    shimmer = cam.tint1.y * snap.w * 18.0; // treble → spin
  }
  m.spin = age * 6.2831 * shape.spin + f32(slot) * 0.7 + age * shimmer;
  return m;
}

struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) age: f32,
  @location(3) @interpolate(flat) layer: u32,
  @location(4) aud: vec4<f32>, // this deposit's frozen audio snapshot
  @location(5) @interpolate(flat) key: f32, // 1 if this deposit is a key frame
  @location(6) @interpolate(flat) keyPhase: f32, // birthSeq (wrapped) → pulse desync
};

@vertex
fn vs(
  @location(0) localPos: vec3<f32>,
  @location(1) localNormal: vec3<f32>,
  @location(2) uv: vec2<f32>,
  @builtin(instance_index) s: u32,
) -> VSOut {
  let capacity = u32(cam.ribbon.y);
  let slot = (u32(cam.ribbon.x) + s) % capacity;
  let P = deposits[slot].posBirth;
  let center = rotY(P.xyz, cam.curve.x);
  let age = clamp((cam.params.x - P.w) / max(cam.ribbon.y, 1.0), 0.0, 1.0);
  let snap = deposits[slot].audioSnap;

  let m = modulation(age, slot, snap);
  let rp = rotY(localPos, m.spin) * m.scale;
  let world = center + rp;

  var out: VSOut;
  out.position = cam.viewProj * vec4<f32>(world, 1.0);
  out.uv = uv;
  out.normal = rotY(localNormal, m.spin);
  out.age = age;
  out.layer = slot;
  out.aud = snap;
  out.key = deposits[slot].tangentPad.w;
  out.keyPhase = P.w % 256.0; // birthSeq, wrapped for float precision
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  // Branch on the uniform (not select()) so the aged/no-source mode skips the
  // ring fetch entirely — select() evaluates both sides.
  var col = mix(vec3<f32>(1.0, 0.55, 0.2), vec3<f32>(0.25, 0.5, 1.0), in.age) * cam.curve.yzw;
  if (cam.params.w > 0.5) {
    col = textureSampleLevel(ring, samp, in.uv, i32(in.layer), 0.0).rgb;
  }

  // Directional shading kept bright (high ambient) so shapes aren't dull vs the
  // unlit plane — they should still catch the camera texture's full luminosity.
  let l = normalize(vec3<f32>(0.4, 0.8, 0.5));
  let diff = max(dot(normalize(in.normal), l), 0.0) * 0.35 + 0.85;
  col = col * diff;

  // Audio palette tint on the face edges only, from this point's frozen snapshot.
  col = audioTint(col, in.age, in.aud, in.uv);

  // Emissive glow over the tail, starting at misc.z (tunable) → marks the trail.
  let glow = smoothstep(cam.misc.z, min(cam.misc.z + 0.25, 1.0), in.age) * cam.misc.y;
  col = col + vec3<f32>(1.0, 0.8, 0.5) * glow;

  // Traveling glow: a soft pulse of warm light sweeping head→tail along the curve.
  col = col + vec3<f32>(1.0, 0.9, 0.7) * (cam.sweep.z * sweepWeight(in.age));

  // Key-frame pulse: the shape matching the HD background still glows (matches ribbon.wgsl).
  if (in.key > 0.5) {
    let pulse = 0.5 + 0.5 * sin(cam.tint2.w * cam.key.y + in.keyPhase);
    let ktint = pal(cam.key.z, 0.0, 0.0);
    col = col + ktint * (cam.key.x * cam.key.w * pulse);
  }
  return vec4<f32>(col, cam.misc.x);
}
