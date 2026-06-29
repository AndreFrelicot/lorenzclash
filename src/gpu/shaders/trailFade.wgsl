// Fades the trail buffer in place: a fullscreen draw whose blend multiplies the
// existing contents by the pass blend-constant (the decay factor). Outputs zero
// source colour, so result = dst * constant. Run before ribbonInk each frame.

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
  let x = f32((vi << 1u) & 2u);
  let y = f32(vi & 2u);
  return vec4<f32>(x * 2.0 - 1.0, y * 2.0 - 1.0, 0.0, 1.0);
}

@fragment
fn fs() -> @location(0) vec4<f32> {
  return vec4<f32>(0.0);
}
