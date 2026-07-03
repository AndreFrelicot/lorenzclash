// Screen-space background drawn before the ribbon (depth write off): a procedural
// star dome plus an optional captured camera still that dissolves in/out.
//
// The star dome is reconstructed from the view ray (camera basis + fov), so the
// stars rotate with the camera in both orbit and follow modes — no texture/asset.
// The still is a high-res captured frame shown fullscreen (cover-fit), revealed by
// a value-noise dissolve driven by `reveal` (0 = hidden, 1 = fully shown). The
// still stays in a fixed screen referential, independent of the 3D camera.

struct Bg {
  fwd: vec3<f32>,        // camera forward (view ray centre)
  tanHalfFovY: f32,
  right: vec3<f32>,      // camera right
  aspect: f32,           // canvas width / height
  up: vec3<f32>,         // camera up
  time: f32,
  resolution: vec2<f32>,
  reveal: f32,           // dissolve progress 0..1
  useStill: f32,         // 0/1 — whether a still is bound/active
  // x = still aspect (w/h), y = still layer, z = star density, w = star brightness
  params: vec4<f32>,
  // x = grain amount, y = smear strength, z = halo intensity, w = hue speed
  extra: vec4<f32>,
  // x = front-glow intensity, y = field scale, z = field layer, w = field flip bits
  extra2: vec4<f32>,
  // x = per-still hue offset, y reserved, z = star audio glow (level), w = star flash (beat)
  extra3: vec4<f32>,
};

@group(0) @binding(0) var<uniform> bg: Bg;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var stills: texture_2d_array<f32>;
@group(0) @binding(3) var trail: texture_2d<f32>; // ribbon smoke/trail (screen space)
@group(0) @binding(4) var field: texture_2d_array<f32>; // Lorenz butterfly views (dissolve masks)

// --- hashes (Dave Hoskins, MIT) ---------------------------------------------
fn hash33(p3in: vec3<f32>) -> vec3<f32> {
  var p3 = fract(p3in * vec3<f32>(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}

fn vhash2(p: vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453);
}

// Smooth value noise → organic clumps for the dissolve mask (vs white-noise speckle).
fn value_noise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = vhash2(i);
  let b = vhash2(i + vec2<f32>(1.0, 0.0));
  let c = vhash2(i + vec2<f32>(0.0, 1.0));
  let d = vhash2(i + vec2<f32>(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Per-pixel flickering film grain (white noise reseeded every frame by time).
fn film_grain(uv: vec2<f32>, t: f32) -> f32 {
  return vhash2(uv * 1000.0 + vec2<f32>(t * 123.4, t * 321.7));
}

fn background_gradient(dir: vec3<f32>) -> vec3<f32> {
  let t = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
  return mix(vec3<f32>(0.015, 0.015, 0.03), vec3<f32>(0.02, 0.025, 0.05), t);
}

// Smooth cosine palette (Iñigo Quílez): t cycles the hue through warm → magenta
// → violet → blue (green damped to avoid garish tones). Drives the smoke halo.
fn palette(t: f32) -> vec3<f32> {
  let a = vec3<f32>(0.5, 0.45, 0.5);
  let b = vec3<f32>(0.5, 0.4, 0.55);
  let c = vec3<f32>(1.0, 1.0, 1.0);
  let d = vec3<f32>(0.0, 0.18, 0.42);
  return a + b * cos(6.28318 * (c * t + d));
}

// One octave of stars: lattice cells on the direction sphere, a sparse subset
// hosts a jittered point. Nearest cell only (cheap, seam-free in 3D).
fn star_layer(dir: vec3<f32>, scale: f32, thresh: f32) -> vec3<f32> {
  let q = dir * scale;
  let id = floor(q + 0.5);
  let h = hash33(id);
  if (h.z < thresh) {
    return vec3<f32>(0.0);
  }
  let center = id + vec3<f32>((h.xy - 0.5) * 0.7, 0.0);
  let d = length(q - center);
  let core = smoothstep(0.10, 0.0, d);
  // Per-star twinkle, flashed harder on a beat (extra3.w).
  let twinkle = (0.6 + 0.4 * sin(bg.time * 1.7 + h.x * 6.2831)) * (1.0 + bg.extra3.w * 2.0);
  let tint = mix(vec3<f32>(0.7, 0.8, 1.0), vec3<f32>(1.0, 0.9, 0.75), h.y);
  return core * twinkle * tint;
}

fn star_field(dir: vec3<f32>, density: f32, brightness: f32) -> vec3<f32> {
  var c = star_layer(dir, density, 0.93);
  c += star_layer(dir, density * 2.1, 0.95) * 0.6;
  // Overall glow rises with loudness (extra3.z); the beat flash is per-star above.
  return c * brightness * (1.0 + bg.extra3.z * 1.5);
}

// Map a y-down screen uv to the square Lorenz-field uv: CONTAIN (keep the
// butterfly un-stretched, centred), with an optional per-still flip + scale.
fn field_uv(uv: vec2<f32>, res: vec2<f32>, scale: f32, flipX: f32, flipY: f32) -> vec2<f32> {
  let aspect = res.x / res.y;
  var f = uv - vec2<f32>(0.5);
  if (aspect > 1.0) {
    f.x = f.x * aspect;
  } else {
    f.y = f.y / aspect;
  }
  f = f * scale + vec2<f32>(0.5);
  if (flipX > 0.5) {
    f.x = 1.0 - f.x;
  }
  if (flipY > 0.5) {
    f.y = 1.0 - f.y;
  }
  return f;
}

// Map a 0..1 screen uv to a still uv that COVERS the screen (crop overflow).
fn cover(uv: vec2<f32>, screenAspect: f32, imgAspect: f32) -> vec2<f32> {
  let ratio = imgAspect / screenAspect;
  var u = uv;
  if (ratio > 1.0) {
    u.x = (uv.x - 0.5) / ratio + 0.5;
  } else {
    u.y = (uv.y - 0.5) * ratio + 0.5;
  }
  return u;
}

struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,  // 0..1, y up
  // Unnormalized view ray. Affine in ndc → the rasterizer's linear interpolation
  // reproduces it exactly; only the normalize stays per-fragment.
  @location(1) ray: vec3<f32>,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
  // Fullscreen triangle.
  let x = f32((vi << 1u) & 2u);
  let y = f32(vi & 2u);
  let pos = vec2<f32>(x * 2.0 - 1.0, y * 2.0 - 1.0);
  var out: VSOut;
  out.position = vec4<f32>(pos, 0.0, 1.0);
  out.uv = vec2<f32>(x, y);
  out.ray = bg.fwd + pos.x * bg.tanHalfFovY * bg.aspect * bg.right + pos.y * bg.tanHalfFovY * bg.up;
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  let dir = normalize(in.ray);

  let sky = background_gradient(dir) + star_field(dir, bg.params.z, bg.params.w);
  var col = sky;

  if (bg.useStill > 0.5 && bg.reveal > 0.001) {
    // in.uv.y is 0 at screen bottom (clip y up); the capture stores the frame so
    // texture-row 0 is its bottom, so sampling cuv.y = in.uv.y reads it upright.
    let suv = in.uv;

    // Ribbon trail (screen space): its gradient smears the image, its density
    // dirties it toward smoke → the curve "stains" the still behind it.
    let tuv = vec2<f32>(in.uv.x, 1.0 - in.uv.y);
    let e = 2.0 / bg.resolution;
    let tr = textureSample(trail, samp, tuv).r;
    let gx = textureSample(trail, samp, tuv + vec2<f32>(e.x, 0.0)).r
      - textureSample(trail, samp, tuv - vec2<f32>(e.x, 0.0)).r;
    let gy = textureSample(trail, samp, tuv + vec2<f32>(0.0, e.y)).r
      - textureSample(trail, samp, tuv - vec2<f32>(0.0, e.y)).r;

    let cuv = cover(suv, bg.resolution.x / bg.resolution.y, bg.params.x) + vec2<f32>(gx, gy) * bg.extra.y;
    var img = textureSample(stills, samp, cuv, i32(bg.params.y + 0.5)).rgb;

    // Grain: multiply the image by a flickering noise factor → vibration/texture.
    let g = film_grain(suv, bg.time);
    img *= mix(1.0, g * 1.6, bg.extra.x);

    // Per-still hue offset → each appearance gets a distinct base colour.
    let hue0 = bg.extra3.x + bg.time * bg.extra.w;

    // Coloured halo: ADD an evolving colour where the trail is dense (instead of
    // a grey wash that desaturates). extra.z = intensity, extra.w = hue speed.
    let halo = palette(hue0 + tr * 0.15);
    img += halo * tr * bg.extra.z;

    // Transfer function: SCREEN the starry sky over the image so the stars
    // sparkle through it (multiply would crush the image to black). The image
    // stays readable but alive/grainy.
    let withStars = 1.0 - (1.0 - img) * (1.0 - sky);

    // Dissolve along the Lorenz attractor: dense butterfly pixels (low thresh)
    // appear first, gaps last → the image materialises along the curve's spirals.
    // extra2.z selects the view (one of several precomputed shapes/angles).
    let flips = u32(bg.extra2.w + 0.5);
    // Animate the mask's screen scale with the dissolve: grow from a central
    // point (fade in = scale up) to overscanning the whole screen, then shrink
    // back (fade out) — so the reveal sweeps the whole area, not a fixed spot.
    let amt = bg.extra3.y;
    let zoom = mix(mix(1.0, 3.0, amt), mix(1.0, 0.65, amt), bg.reveal);
    let fuv = field_uv(
      tuv,
      bg.resolution,
      bg.extra2.y * zoom,
      f32(flips & 1u),
      f32((flips >> 1u) & 1u),
    );
    let density = textureSample(field, samp, fuv, i32(bg.extra2.z + 0.5)).r;
    let jitter = (value_noise(suv * 16.0) - 0.5) * 0.05; // soft, organic edge
    let edge = 0.1;
    // Scale by (1 - 2*edge) so the sparsest pixels still reach full reveal at 1.
    let thresh = (1.0 - density) * (1.0 - 2.0 * edge) + jitter;
    let a = smoothstep(thresh - edge, thresh + edge, bg.reveal);
    col = mix(sky, withStars, a);

    // Glowing leading edge tracing the curve as it reveals; hue spreads strongly
    // by density (multi-coloured rings) and shifts per appearance. Gated to the
    // actual attractor (skip the empty fill region).
    let front = smoothstep(edge, 0.0, abs(bg.reveal - thresh)) * step(0.02, density);
    col += palette(hue0 + density * 0.6) * front * bg.extra2.x;
  }

  return vec4<f32>(col, 1.0);
}
