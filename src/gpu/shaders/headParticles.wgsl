// Leading-edge "crest": 3 lines of small, audio-reactive cubes at the newest
// deposit (the growing tip of the ribbon), so the camera texture EMERGES from a
// living, shimmering front instead of popping out of nowhere. The lines span the
// band's width (aligned with the quad): one on the band plane, one lifted + set
// back above, one below. Reacts to the LIVE audio — this is the present moment.
//
// Instanced over (line, widthSample); reuses the shared Camera uniform + deposits
// buffer + the cube mesh. Additive (glow), depth-tested but no depth write.

const LINES = 3u;
const SAMPLES = 12u;
const PER = 36u; // LINES * SAMPLES

struct Camera {
  viewProj: mat4x4<f32>,
  right: vec3<f32>,
  _p0: f32,
  up: vec3<f32>,
  cardAspect: f32,
  params: vec4<f32>, // x = ageRef, y = widthMult, z = mode, w = useCamera
  ribbon: vec4<f32>, // x = oldestSlot, y = capacity
  curve: vec4<f32>, // x = rotateY angle, yzw = age tint
  misc: vec4<f32>,
  audio0: vec4<f32>, // level, bass, mid, treble (LIVE)
  audio1: vec4<f32>, // centroid, beat, enabled, grow (LIVE)
  tint0: vec4<f32>, // tintAmt, tailStart, tailEnd, hueShift
  tint1: vec4<f32>, // hueRange, spin, palette, partTint
  tint2: vec4<f32>, // partHueShift, partGrow, edge, time
};

struct Deposit {
  posBirth: vec4<f32>,
  tangentPad: vec4<f32>,
  audioSnap: vec4<f32>,
};

struct HeadParams {
  size: f32, // cube base size
  gap: f32, // vertical offset of the top/bottom lines
  recul: f32, // how far the top/bottom lines sit behind the centre line
  reach: f32, // shimmer/jitter amplitude
};

@group(0) @binding(0) var<uniform> cam: Camera;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var ring: texture_2d_array<f32>;
@group(0) @binding(3) var<storage, read> deposits: array<Deposit>;
@group(0) @binding(4) var<uniform> hp: HeadParams;

fn rotY(p: vec3<f32>, a: f32) -> vec3<f32> {
  let c = cos(a);
  let s = sin(a);
  return vec3<f32>(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

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

struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) col: vec3<f32>,
};

@vertex
fn vs(@location(0) localPos: vec3<f32>, @builtin(instance_index) s: u32) -> VSOut {
  let capacity = u32(cam.ribbon.y);
  let ageRef = u32(cam.params.x);
  // Newest + previous deposit (slot = birthSeq % capacity). Caller guarantees ≥ 2.
  let nSlot = (ageRef - 1u) % capacity;
  let pSlot = (ageRef - 2u) % capacity;
  let Pn = rotY(deposits[nSlot].posBirth.xyz, cam.curve.x);
  let Pp = rotY(deposits[pSlot].posBirth.xyz, cam.curve.x);
  let T = normalize(rotY(deposits[nSlot].tangentPad.xyz, cam.curve.x) + vec3<f32>(1e-4));
  let segLen = max(length(Pn - Pp), 1e-4);

  // Local band frame: R across (horizontal), U up (band normal-ish), T forward.
  var R = cross(T, vec3<f32>(0.0, 1.0, 0.0));
  if (length(R) < 1e-3) {
    R = vec3<f32>(1.0, 0.0, 0.0);
  }
  R = normalize(R);
  let U = normalize(cross(R, T));

  // Half-width matches the ribbon's no-stretch tile so the line aligns with the quad.
  let aspect = max(cam.cardAspect, 1e-3);
  let aspFac = select(1.0 / aspect, aspect, cam.params.z > 0.5);
  let halfW = 0.5 * segLen * cam.params.y * aspFac;

  let line = s / SAMPLES;
  let si = s % SAMPLES;
  let acrossT = (f32(si) / f32(SAMPLES - 1u) - 0.5) * 2.0; // -1..1 across the width

  // Line placement: centre on the band; top lifted+recessed, bottom dropped+recessed.
  var off = vec3<f32>(0.0);
  if (line == 1u) {
    off = U * hp.gap - T * hp.recul;
  } else if (line == 2u) {
    off = -U * hp.gap - T * hp.recul;
  }

  // Live audio (the head is the present moment).
  let on = cam.audio1.z > 0.5;
  let level = cam.audio0.x;
  let beat = cam.audio1.y;
  let centroid = cam.audio1.x;
  let time = cam.tint2.w;

  // Shimmer: a travelling wave along the line, amplitude lifted by the music. A
  // small idle term keeps the crest alive even in silence.
  let phase = time * 5.0 + f32(si) * 0.7 + f32(line) * 2.1;
  let amp = hp.reach * (0.15 + select(0.0, level * 1.4 + beat * 1.0, on));
  let base = Pn + R * acrossT * halfW + off + U * sin(phase) * amp;
  // A beat nudges the whole crest forward (alive).
  let pos = base + T * select(0.0, beat * hp.reach * 0.6, on);

  let scale = hp.size * (1.0 + select(0.0, level * 0.9 + beat * 0.8, on));
  let world = pos + localPos * scale;

  var out: VSOut;
  out.position = cam.viewProj * vec4<f32>(world, 1.0);
  let tcol = select(vec3<f32>(1.0, 0.7, 0.4), pal(centroid, cam.tint0.w, cam.tint1.z), on);
  out.col = tcol * (0.5 + select(0.0, level + beat, on));
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  return vec4<f32>(in.col, 1.0); // additive glow (blend set on the pipeline)
}
