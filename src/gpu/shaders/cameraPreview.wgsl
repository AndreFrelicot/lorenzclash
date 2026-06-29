// Present pass for the start-screen camera preview. It samples a single layer that
// was filled by frameCapture.wgsl with the SAME rotation the engine uses, then
// cover-fits it to the preview canvas replicating background.wgsl's still
// orientation convention exactly. So the preview shows precisely what the ribbon,
// curve B and the HD still will store — WYSIWYG calibration across iOS/Android.

struct U {
  imgAspect: f32, // post-rotation aspect (w/h) of the captured layer
  canvasAspect: f32, // preview canvas aspect (w/h)
  _p0: f32,
  _p1: f32,
};

@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var tex: texture_2d_array<f32>;

struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>, // 0..1, y up (matches background.wgsl)
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

// COVER-fit (crop overflow) — identical to background.wgsl's cover().
fn cover(uv: vec2<f32>, screenAspect: f32, imgAspect: f32) -> vec2<f32> {
  let ratio = imgAspect / screenAspect;
  var c = uv;
  if (ratio > 1.0) {
    c.x = (uv.x - 0.5) / ratio + 0.5;
  } else {
    c.y = (uv.y - 0.5) * ratio + 0.5;
  }
  return c;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  let cuv = cover(in.uv, u.canvasAspect, u.imgAspect);
  return textureSample(tex, samp, cuv, 0);
}
