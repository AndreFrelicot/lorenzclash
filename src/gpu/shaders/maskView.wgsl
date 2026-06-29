// Debug mask viewer: blit one layer of the Lorenz "butterfly" field — the r8
// density the HD-still dissolve reveals ALONG (see LorenzField.ts) — as grayscale,
// fullscreen, so the dissolve mask can be inspected/captured on its own.

struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var tex: texture_2d<f32>;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
  let x = f32((vi << 1u) & 2u);
  let y = f32(vi & 2u);
  var out: VSOut;
  out.position = vec4<f32>(x * 2.0 - 1.0, y * 2.0 - 1.0, 0.0, 1.0);
  out.uv = vec2<f32>(x, 1.0 - y);
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  let m = textureSample(tex, samp, in.uv).r; // single-channel butterfly density
  return vec4<f32>(m, m, m, 1.0);
}
