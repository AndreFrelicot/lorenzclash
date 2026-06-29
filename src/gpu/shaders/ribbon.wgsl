// Frame-ribbon as a continuous cross-blended band. Each instance is one segment
// connecting two consecutive deposits along the Lorenz curve; the segment quad
// follows the 3D path (long axis) and faces the camera (width axis), and its
// fragments cross-blend the two endpoints' camera frames (frame[a] → frame[b]).
// Deposits are read from a storage buffer so the vertex shader can fetch both
// endpoints.

struct Camera {
  viewProj: mat4x4<f32>,
  right: vec3<f32>,
  _p0: f32,
  up: vec3<f32>,
  cardAspect: f32, // camera frame width / height (post-rotation)
  // x = ageRef (deposit count), y = widthMult, z = mode (0 = A wide, 1 = B upright),
  // w = useCamera (0/1)
  params: vec4<f32>,
  // x = oldestSlot, y = capacity
  ribbon: vec4<f32>,
  // x = rotateY angle (for a second, crossing curve), yzw = age-colour tint
  curve: vec4<f32>,
  // x = opacity, y = tail glow intensity, z = glow start age
  misc: vec4<f32>,
  // Audio-reactive rows (see WebGPUContext.writeAudioUniform):
  audio0: vec4<f32>, // level, bass, mid, treble
  audio1: vec4<f32>, // centroid, beat, enabled, grow
  tint0: vec4<f32>, // tintAmt, tailStart, tailEnd, hueShift
  tint1: vec4<f32>, // hueRange, spin, palette, partTint
  tint2: vec4<f32>, // partHueShift, partGrow, _, _
  // x = glow strength, y = pulse freq, z = hue (palette pos), w = tint strength
  key: vec4<f32>,
  // Traveling glow sweep: x = pulse centre (age), y = half-width, z = glow strength,
  // w = scale boost. Inactive when y <= 0 (sweepWeight → 0, zero effect).
  sweep: vec4<f32>,
};

struct Deposit {
  posBirth: vec4<f32>, // xyz = world position, w = birthSeq (deposit index)
  tangentPad: vec4<f32>, // xyz = curve tangent (reserved for miter joins)
  audioSnap: vec4<f32>, // audio at birth: x = centroid, y = beat, z = bass, w = treble
};

@group(0) @binding(0) var<uniform> cam: Camera;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var ring: texture_2d_array<f32>;
@group(0) @binding(3) var<storage, read> deposits: array<Deposit>;

// Shape-morph front (group 1): a wave that sweeps from the head (age 0) to the tail
// (age 1), shrinking the outgoing form and growing the incoming one.
struct Morph { p: vec4<f32> }; // x = front w, y = band, z = mode (0 in / 1 out), w = active
@group(1) @binding(0) var<uniform> morph: Morph;

// Per-element weight: 1 at the head, falling to 0 just past the front `w` over a
// `band` of smoothing. The incoming form uses it directly, the outgoing form its
// complement; active=0 (at rest) → 1, so the band stays full-width (zero effect).
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

struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) blendT: f32,
  @location(2) ageNorm: f32,
  @location(3) @interpolate(flat) layerA: u32,
  @location(4) @interpolate(flat) layerB: u32,
  @location(5) aud: vec4<f32>, // this vertex's frozen audio snapshot (interpolated)
  @location(6) @interpolate(flat) key: f32, // 1 if this segment is a key frame
  @location(7) @interpolate(flat) keyPhase: f32, // birthSeq → desync the pulse
};

fn rotY(p: vec3<f32>, a: f32) -> vec3<f32> {
  let c = cos(a);
  let s = sin(a);
  return vec3<f32>(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

fn hash22(p: vec2<f32>) -> vec2<f32> {
  let n = vec2<f32>(dot(p, vec2<f32>(127.1, 311.7)), dot(p, vec2<f32>(269.5, 183.3)));
  return fract(sin(n) * 43758.5453);
}

// IQ cosine gradient palette: a + b*cos(2π(t + d)). `sel` swaps the phase d for a
// few distinct gradients (rainbow / sunset / warm). t wraps; shift offsets the hue.
fn pal(tIn: f32, shift: f32, sel: f32) -> vec3<f32> {
  let t = fract(tIn + shift);
  var d = vec3<f32>(0.0, 0.33, 0.67); // rainbow
  if (sel > 1.5) {
    d = vec3<f32>(0.0, 0.10, 0.20); // warm (amber → magenta)
  } else if (sel > 0.5) {
    d = vec3<f32>(0.3, 0.20, 0.20); // sunset
  }
  return vec3<f32>(0.5) + vec3<f32>(0.5) * cos(6.28318 * (t + d));
}

// Audio width-grow factor for the band, from a deposit's FROZEN snapshot (bass
// swells, beat punches). 0 when audio is disabled. snap = (centroid, beat, bass, treble).
fn audioGrow(snap: vec4<f32>) -> f32 {
  if (cam.audio1.z < 0.5) { return 0.0; }
  return cam.audio1.w * (snap.z + snap.y * 0.7);
}

// Additive palette tint on the band's two long EDGES only (the texture/centre is
// left untouched), over an age band [tailStart, tailEnd]. Palette position tracks
// the centroid frozen on THIS point, so each point keeps the colour of the music at
// its instant. `across` (0..1 across the width) locates the edges; tint2.z = width.
fn audioTint(color: vec3<f32>, age: f32, snap: vec4<f32>, across: f32) -> vec3<f32> {
  if (cam.audio1.z < 0.5 || cam.tint0.x <= 0.0) { return color; }
  let lo = cam.tint0.y;
  let hi = max(cam.tint0.z, lo + 0.01);
  let band = smoothstep(lo, lo + 0.05, age) * (1.0 - smoothstep(hi - 0.05, hi, age));
  let amt = cam.tint0.x * band;
  if (amt <= 0.0) { return color; }
  // Edge mask: 1 near across 0/1 (the long edges), 0 in the centre (the texture).
  let ew = max(cam.tint2.z, 0.001);
  let edge = smoothstep(0.5 - ew, 0.5, abs(across - 0.5));
  let tcol = pal(snap.x * cam.tint1.x, cam.tint0.w, cam.tint1.z);
  return color + tcol * (amt * edge * (1.0 + snap.y * 1.2));
}

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) s: u32) -> VSOut {
  let capacity = u32(cam.ribbon.y);
  let a = (u32(cam.ribbon.x) + s) % capacity;
  let b = (u32(cam.ribbon.x) + s + 1u) % capacity;

  // Deposit positions, rotated about Y so a second curve crosses perpendicular.
  let Ar = deposits[a].posBirth;
  let Br = deposits[b].posBirth;
  let A = rotY(Ar.xyz, cam.curve.x);
  let B = rotY(Br.xyz, cam.curve.x);
  let snapA = deposits[a].audioSnap;
  let snapB = deposits[b].audioSnap;
  // Key-frame flag (spare _pad lane): take only the START deposit so exactly ONE
  // segment glows per key frame (a deposit is shared by two segments → a max would
  // light both, giving the pair).
  let keyA = deposits[a].tangentPad.w;

  // Quad corner (triangle-strip): along the segment (0 = A, 1 = B) and across
  // its width. select() avoids array indexing (portable on WebKit/iOS).
  let along = select(0.0, 1.0, vi >= 2u);
  let across = select(0.0, 1.0, (vi & 1u) == 1u);
  // This vertex's frozen audio snapshot (the rasterizer blends a→b across the quad).
  let vertSnap = select(snapA, snapB, along > 0.5);

  // Width axis: perpendicular to the segment's screen-space direction, so the
  // band faces the camera while the long axis follows the true 3D path.
  let seg = B - A;
  let segPlane = vec2<f32>(dot(seg, cam.right), dot(seg, cam.up));
  let segLen = length(segPlane);
  let dir = select(vec2<f32>(0.0, 1.0), segPlane / segLen, segLen > 1e-5);
  let perp = -dir.y * cam.right + dir.x * cam.up;

  // No-stretch tile: the cross size is derived from the segment's 3D length and
  // the frame aspect so the frame is never distorted. Mode B (upright) runs the
  // frame's height along the curve; Mode A runs its width along the curve.
  let segLen3D = length(seg);
  let aspect = max(cam.cardAspect, 1e-3); // frame width / height
  let modeB = cam.params.z > 0.5;
  let acrossSize = segLen3D * cam.params.y * select(1.0 / aspect, aspect, modeB) * (1.0 + audioGrow(vertSnap));
  // Shape-morph wave: this segment's age drives a per-element weight, so the band
  // width shrinks to 0 along the front and the ribbon erases head-to-tail.
  let ageSeg = clamp((cam.params.x - mix(Ar.w, Br.w, along)) / max(cam.ribbon.y, 1.0), 0.0, 1.0);
  // Traveling glow swells the band slightly as the pulse passes over this segment.
  let grow = 1.0 + cam.sweep.w * sweepWeight(ageSeg);
  let worldPos = mix(A, B, along) + perp * (across - 0.5) * acrossSize * grow * morphWeight(ageSeg);

  var out: VSOut;
  out.position = cam.viewProj * vec4<f32>(worldPos, 1.0);
  out.uv = vec2<f32>(across, along);
  out.blendT = along;
  // Age from the deposit sequence (params.x = current count, A.w/B.w = birthSeq),
  // normalized by capacity — robust to the variable deposit cadence.
  let birthSeq = mix(Ar.w, Br.w, along);
  out.ageNorm = clamp((cam.params.x - birthSeq) / max(cam.ribbon.y, 1.0), 0.0, 1.0);
  out.layerA = a;
  out.layerB = b;
  out.aud = vertSnap;
  out.key = keyA;
  out.keyPhase = Ar.w % 256.0; // birthSeq (wrapped) → per-tile desync, stays float-precise
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  let age = in.ageNorm;
  let aged = mix(vec3<f32>(1.0, 0.55, 0.2), vec3<f32>(0.25, 0.5, 1.0), age) * cam.curve.yzw;

  // Mode B (params.z>0.5) keeps the frame upright; Mode A lays it sideways.
  let baseUv = select(in.uv.yx, in.uv, cam.params.z > 0.5);

  // Tail dissolve: progressively pixelate the card (full → 4×4 blocks), then
  // shrink each block into a centred square (gaps discard) so the tail breaks
  // into shrinking particle-like blocks over the background and vanishes.
  let cells = mix(256.0, 4.0, smoothstep(0.45, 0.85, age));
  let cellId = floor(baseUv * cells);
  let blockUv = (cellId + vec2<f32>(0.5)) / cells;

  // Cross-blend the two endpoint frames (block-sampled) → seamless liaison.
  let fa = textureSampleLevel(ring, samp, blockUv, i32(in.layerA), 0.0).rgb;
  let fb = textureSampleLevel(ring, samp, blockUv, i32(in.layerB), 0.0).rgb;
  let frame = mix(fa, fb, in.blendT);
  var color = select(aged, frame, cam.params.w > 0.5);

  // Each block shrinks from full (age 0.85) to nothing (age 1.0), with a bit of
  // randomised dispersion energy: it drifts (within its cell) and spins as it
  // goes. Gaps discard → the tail breaks into shrinking, tumbling particles.
  let prog = smoothstep(0.85, 1.0, age);
  let rnd = hash22(cellId);
  let drift = (rnd - vec2<f32>(0.5)) * prog * 0.5;
  let ang = (rnd.x - 0.5) * prog * 1.8;
  let cc = cos(ang);
  let ss = sin(ang);
  var lc = fract(baseUv * cells) - vec2<f32>(0.5) - drift;
  lc = vec2<f32>(cc * lc.x - ss * lc.y, ss * lc.x + cc * lc.y);
  let half = 0.5 * (1.0 - prog);
  if (half <= 0.002 || any(abs(lc) > vec2<f32>(half))) {
    discard;
  }

  // Audio palette tint on the band edges only (in.uv.x = across), from this point's
  // frozen snapshot → each point keeps its own edge colour; the texture stays clean.
  color = audioTint(color, age, in.aud, in.uv.x);

  // Emissive glow over the tail, starting at misc.z (tunable) → marks the trail.
  let glow = smoothstep(cam.misc.z, min(cam.misc.z + 0.25, 1.0), age) * cam.misc.y;
  color = color + vec3<f32>(1.0, 0.8, 0.5) * glow;

  // Traveling glow: a soft pulse of warm light sweeping head→tail along the curve.
  color = color + vec3<f32>(1.0, 0.9, 0.7) * (cam.sweep.z * sweepWeight(age));

  // Key-frame pulse: the tile matching the HD background still glows with a fast,
  // animated coloured tint so the eye is drawn to "where do those come from?".
  if (in.key > 0.5) {
    let pulse = 0.5 + 0.5 * sin(cam.tint2.w * cam.key.y + in.keyPhase);
    let ktint = pal(cam.key.z, 0.0, 0.0);
    color = color + ktint * (cam.key.x * cam.key.w * pulse);
  }
  return vec4<f32>(color, cam.misc.x);
}
