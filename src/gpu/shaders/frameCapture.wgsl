// Blit one camera frame (external texture) into a ring-buffer layer, applying a
// 0/90/180/270° rotation so a phone-portrait capture (landscape sensor frame) is
// stored upright, then an optional colour GRADE (hue/sat/vibrance/contrast/exposure/
// lift). Grading at capture bakes it into the ring/HD/still uniformly — and, since
// each deposit freezes its instant, a drifting hue "breathes" along the trail's
// history. The layer is sized to the post-rotation aspect, with no cropping.

struct Uniforms {
  rotation: f32, // 0..3 → ×90° clockwise
  enabled: f32, // 0/1 — apply the colour grade
  hue: f32, // hue shift in turns (already modulated CPU-side; shader fracts it)
  saturation: f32, // saturation multiplier (1 = neutral)
  vibrance: f32, // mid-saturation boost (0 = neutral)
  contrast: f32, // contrast around 0.5 (1 = neutral)
  exposure: f32, // gain (1 = neutral)
  lift: f32, // shadow lift / offset (0 = neutral)
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var cameraTex: texture_external;

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

// Classic branchless RGB↔HSV (Sam Hocevar).
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

@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  var uv = in.uv;
  let r = u32(u.rotation + 0.5);
  if (r == 1u) {
    uv = vec2<f32>(in.uv.y, 1.0 - in.uv.x);
  } else if (r == 2u) {
    uv = vec2<f32>(1.0 - in.uv.x, 1.0 - in.uv.y);
  } else if (r == 3u) {
    uv = vec2<f32>(1.0 - in.uv.y, in.uv.x);
  }
  let src = textureSampleBaseClampToEdge(cameraTex, samp, uv);
  return vec4<f32>(grade(src.rgb), src.a);
}
