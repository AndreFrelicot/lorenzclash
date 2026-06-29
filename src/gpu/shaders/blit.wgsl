// Trivial fullscreen-triangle blit: copies an owned 2D texture straight to the
// swapchain canvas. The scene now composites into a texture we own (present
// target, COPY_SRC) so it can be read back for video export; this pass simply
// presents that texture 1:1 to the canvas. No grading, no fit — same size.

@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var tex: texture_2d<f32>;

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
  // Flip Y: clip-space y-up vs texture v-down, so the present is upright.
  out.uv = vec2<f32>(x, 1.0 - y);
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  return textureSample(tex, samp, in.uv);
}
