// Procedural "synthetic source" colorisation pass: read the live Lorenz splat
// density (see splatInk.wgsl) and turn it into the offscreen target that the ring
// + HD pool sample. Domain-warps the UV by fBm value-noise and colours the density
// with an IQ cosine palette (drifting hue + crossfade between two palettes), so the
// material is organic, deformed and evolving with no obvious repetition.

struct Synth {
  u0: vec4<f32>, // x = time, y = warpAmp, z = flow, w = noiseScale
  u1: vec4<f32>, // x = hueOffset, y = hueRange, z = paletteShift, w = paletteMix
  u2: vec4<f32>, // x = paletteA (sel), y = paletteB (sel), z = _, w = _
};

@group(0) @binding(0) var<uniform> u: Synth;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var splatTex: texture_2d<f32>;

struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
  let x = f32((vi << 1u) & 2u);
  let y = f32(vi & 2u);
  var out: VSOut;
  out.position = vec4<f32>(x * 2.0 - 1.0, y * 2.0 - 1.0, 0.0, 1.0);
  out.uv = vec2<f32>(x, y);
  return out;
}

// Hash-based value noise (self-contained, no external deps) → a few octaves of fBm.
fn hash21(p: vec2<f32>) -> f32 {
  var p3 = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);
  p3 = p3 + dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

fn vnoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let w = f * f * (3.0 - 2.0 * f);
  let a = hash21(i);
  let b = hash21(i + vec2<f32>(1.0, 0.0));
  let c = hash21(i + vec2<f32>(0.0, 1.0));
  let d = hash21(i + vec2<f32>(1.0, 1.0));
  return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
}

fn fbm(p: vec2<f32>) -> f32 {
  var s = 0.0;
  var amp = 0.5;
  var freq = 1.0;
  for (var i = 0; i < 4; i = i + 1) {
    s = s + amp * vnoise(p * freq);
    freq = freq * 2.0;
    amp = amp * 0.5;
  }
  return s;
}

// IQ cosine gradient palette: a + b*cos(2π(t + d)). `sel` swaps the phase d for a
// few distinct gradients (rainbow / sunset / warm). Copied from ribbon.wgsl so this
// pass stays self-contained.
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

@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  let t = u.u0.x;
  let warpAmp = u.u0.y;
  let flow = u.u0.z;
  let noiseScale = u.u0.w;

  // Domain-warp the sampling UV by fBm, animated by `flow` over time.
  var uv = in.uv;
  let w = vec2<f32>(
    fbm(uv * noiseScale + vec2<f32>(t * flow, 0.0)),
    fbm(uv * noiseScale + vec2<f32>(0.0, t * flow) + 5.2),
  );
  uv = uv + warpAmp * (w - vec2<f32>(0.5));

  let d = textureSampleLevel(splatTex, samp, uv, 0.0).r;

  let hueOffset = u.u1.x;
  let hueRange = u.u1.y;
  let pShift = u.u1.z;
  let pMix = u.u1.w;
  let cA = pal(d * hueRange + hueOffset, pShift, u.u2.x);
  let cB = pal(d * hueRange + hueOffset, pShift, u.u2.y);
  let col = mix(cA, cB, pMix);
  return vec4<f32>(col, 1.0);
}
