// Deformation grid: a flat line lattice (floor plane) whose vertices are displaced
// by an invisible "field" → the field made visible. The field has two parts:
//   • idle ripple  — animated fBm height, scaled by `amp` (audio level + idle floor)
//     so the grid breathes on its own with no camera/audio/gesture needed.
//   • gesture bias — tilt pushes/leans the sheet (field.xy), twist swirls it about
//     the centre (field.z). At rest the gesture terms are 0 → only the gentle idle
//     ripple remains.
// Reads viewProj from the shared Camera uniform (binding 0); a tiny Grid uniform
// (binding 1) carries the field + look. Drawn as additive lines so it glows softly
// and the bloom pass catches it. See docs (motion → direct visual feedback).

// Truncated view of the 64-float Camera uniform — we only need viewProj. Binding a
// larger buffer to a smaller uniform struct is valid (the extra floats are unused).
struct Cam {
  viewProj: mat4x4<f32>,
};
@group(0) @binding(0) var<uniform> cam: Cam;

struct Grid {
  field: vec4<f32>,  // x = pushX, y = pushY, z = swirl, w = amp
  params: vec4<f32>, // x = time, y = noiseScale, z = noiseAmp, w = flow
  color: vec4<f32>,  // rgb tint, w = opacity (additive brightness)
  rainbow: vec4<f32>, // x = phase 0..1, y = intensity, z = seed, w = wave count
  rainbow2: vec4<f32>, // x = height, y = speed, z = sharpness, w = hue speed
};
@group(0) @binding(1) var<uniform> g: Grid;

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

fn hue_rgb(h: f32) -> vec3<f32> {
  let k = fract(vec3<f32>(h, h + 0.6666667, h + 0.3333333)) * 6.0 - vec3<f32>(3.0);
  return clamp(abs(k) - vec3<f32>(1.0), vec3<f32>(0.0), vec3<f32>(1.0));
}

struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) glow: f32,
  @location(1) color: vec3<f32>,
};

@vertex
fn vs(@location(0) p: vec3<f32>) -> VSOut {
  let amp = g.field.w;
  let t = g.params.x;
  let noiseScale = g.params.y;
  let noiseAmp = g.params.z;
  let flow = g.params.w;
  let phase = clamp(g.rainbow.x, 0.0, 1.0);
  let rainbowAmount = max(0.0, g.rainbow.y);
  let seed = g.rainbow.z;
  let waves = max(1.0, g.rainbow.w);
  let rainbowHeight = max(0.0, g.rainbow2.x);
  let rainbowSpeed = max(0.05, g.rainbow2.y);
  let sharpness = clamp(g.rainbow2.z, 1.0, 32.0);
  let hueSpeed = g.rainbow2.w;

  var world = p;
  // Idle/audio ripple: animated fBm height (centred around 0) scaled by amp.
  let n = fbm(p.xz * noiseScale + vec2<f32>(t * flow, t * flow * 0.7)) - 0.5;
  world.y = world.y + n * noiseAmp * amp;

  // Optional rainbow burst: several accelerating radial wave fronts that rise in
  // emission, then fall back to the normal blue grid. Idle (amount 0 or phase
  // done) every term below is multiplied to 0 anyway — skip the pow/sin work.
  let radial = length(p.xz) / 2.4;
  var crest = 0.0;
  var envelope = 0.0;
  var rainbowWave = 0.0;
  if (rainbowAmount > 0.0 && phase < 1.0) {
    let accel = phase * phase * (1.0 + phase * 2.2) * rainbowSpeed;
    let crestPhase = radial * waves - accel * (waves + 1.5) + seed;
    crest = pow(0.5 + 0.5 * sin(crestPhase * 6.2831853), sharpness);
    let rise = smoothstep(0.0, 0.82, phase);
    let fall = 1.0 - smoothstep(0.82, 1.0, phase);
    envelope = rise * fall * rainbowAmount;
    rainbowWave = crest * envelope;
    world.y = world.y + rainbowWave * rainbowHeight * (0.45 + phase * 0.55);
  }

  // Gesture: lean the sheet like a tray (push), strongest at the edges.
  world.y = world.y + (g.field.x * p.x + g.field.y * p.z);
  // Gesture: swirl about the centre (twist), with a radial falloff so it stays local.
  let ang = g.field.z * exp(-dot(p.xz, p.xz) * 0.25);
  let c = cos(ang);
  let s = sin(ang);
  let xz = vec2<f32>(c * world.x - s * world.z, s * world.x + c * world.z);
  world.x = xz.x;
  world.z = xz.y;

  var out: VSOut;
  out.position = cam.viewProj * vec4<f32>(world, 1.0);
  // Brighter where the field is doing something (deformed or gesture-active).
  let baseGlow = abs(n) * amp + abs(g.field.x) + abs(g.field.y) + abs(g.field.z);
  out.glow = baseGlow + rainbowWave * (2.2 + phase * 4.5);
  // envelope = 0 ⇒ the mix weight is 0 and the base colour wins — skip hue_rgb.
  out.color = g.color.rgb;
  if (envelope > 0.0) {
    let rainbowColor = hue_rgb(radial * 0.55 - phase * hueSpeed + seed + crest * 0.08);
    out.color = mix(g.color.rgb, rainbowColor, clamp(envelope * 0.85 + crest * envelope, 0.0, 1.0));
  }
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  let glow = clamp(in.glow, 0.0, 5.5);
  return vec4<f32>(in.color * (0.5 + glow), g.color.w);
}
