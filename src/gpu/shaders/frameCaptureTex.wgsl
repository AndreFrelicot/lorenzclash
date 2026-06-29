// Sibling of frameCapture.wgsl that blits from a regular texture_2d into a ring-buffer layer
// with the same 0/90/180/270° rotation AND optional colour grade. Two sources use it:
//   • the procedural synthetic source (camera off) — passed with grade disabled (enabled=0);
//   • the live camera, copied once per frame into a persistent texture via
//     copyExternalImageToTexture (avoids per-frame importExternalTexture, which iOS WebKit
//     fails to reclaim → a slow GPU leak). The camera grade is applied here, per capture.

struct Uniforms {
  rotation: f32, // 0..3 → ×90° clockwise
  enabled: f32, // 0/1 — apply the colour grade
  hue: f32, // hue shift in turns (already modulated CPU-side; shader fracts it)
  saturation: f32, // saturation multiplier (1 = neutral)
  vibrance: f32, // mid-saturation boost (0 = neutral)
  contrast: f32, // contrast around 0.5 (1 = neutral)
  exposure: f32, // gain (1 = neutral)
  lift: f32, // shadow lift / offset (0 = neutral)
  crop: vec4<f32>, // left, top, right, bottom in output UV space
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var srcTex: texture_2d<f32>;

struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) vertexIndex: u32) -> VSOut {
  let x = f32((vertexIndex << 1u) & 2u);
  let y = f32(vertexIndex & 2u);
  var out: VSOut;
  out.position = vec4<f32>(x * 2.0 - 1.0, y * 2.0 - 1.0, 0.0, 1.0);
  out.uv = vec2<f32>(x, y);
  return out;
}

fn rgb2hsv(c: vec3<f32>) -> vec3<f32> {
  let K = vec4<f32>(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  let p = mix(vec4<f32>(c.b, c.g, K.w, K.z), vec4<f32>(c.g, c.b, K.x, K.y), step(c.b, c.g));
  let q = mix(vec4<f32>(p.x, p.y, p.w, c.r), vec4<f32>(c.r, p.y, p.z, p.x), step(p.x, c.r));
  let d = q.x - min(q.w, q.y);
  let e = 1.0e-10;
  return vec3<f32>(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

fn hsv2rgb(c: vec3<f32>) -> vec3<f32> {
  let K = vec4<f32>(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  let p = abs(fract(vec3<f32>(c.x) + K.xyz) * 6.0 - vec3<f32>(K.w));
  return c.z * mix(vec3<f32>(K.x), clamp(p - vec3<f32>(K.x), vec3<f32>(0.0), vec3<f32>(1.0)), c.y);
}

fn grade(rgbIn: vec3<f32>) -> vec3<f32> {
  if (u.enabled < 0.5) {
    return rgbIn;
  }
  var rgb = rgbIn * u.exposure + vec3<f32>(u.lift); // gain + lift
  rgb = (rgb - vec3<f32>(0.5)) * u.contrast + vec3<f32>(0.5); // contrast
  rgb = clamp(rgb, vec3<f32>(0.0), vec3<f32>(1.0));
  var hsv = rgb2hsv(rgb);
  hsv.x = fract(hsv.x + u.hue); // hue rotate
  hsv.y = clamp(hsv.y * u.saturation, 0.0, 1.0); // saturation
  hsv.y = clamp(hsv.y + u.vibrance * (1.0 - hsv.y) * hsv.y, 0.0, 1.0); // vibrance (mids)
  return hsv2rgb(hsv);
}

fn crop_uv(uv: vec2<f32>) -> vec2<f32> {
  let lo = vec2<f32>(u.crop.x, u.crop.y);
  let hi = vec2<f32>(1.0 - u.crop.z, 1.0 - u.crop.w);
  return lo + uv * max(hi - lo, vec2<f32>(0.001));
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  var uv = crop_uv(in.uv);
  let r = u32(u.rotation + 0.5);
  if (r == 1u) {
    uv = vec2<f32>(uv.y, 1.0 - uv.x);
  } else if (r == 2u) {
    uv = vec2<f32>(1.0 - uv.x, 1.0 - uv.y);
  } else if (r == 3u) {
    uv = vec2<f32>(1.0 - uv.y, uv.x);
  }
  let src = textureSampleLevel(srcTex, samp, uv, 0.0);
  return vec4<f32>(grade(src.rgb), src.a);
}
