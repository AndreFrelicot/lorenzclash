// Debug overlay: a flat screen-space reference lattice drawn at the very end of
// the main scene pass. Because it lives in the scene texture, the bloom
// composite's radial slow-mo ripple warps it — making the distortion legible
// (a straight grid bends with the wave). Additive, faint, no depth interaction.

struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
  // Fullscreen triangle (same trick as bloom.wgsl).
  let x = f32((vi << 1u) & 2u);
  let y = f32(vi & 2u);
  var out: VSOut;
  out.position = vec4<f32>(x * 2.0 - 1.0, y * 2.0 - 1.0, 0.0, 1.0);
  out.uv = vec2<f32>(x, 1.0 - y);
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  let cells = 24.0;
  // Distance from each cell centre: 0 at centre, 0.5 at the lattice lines.
  let g = abs(fract(in.uv * cells) - vec2<f32>(0.5));
  let line = smoothstep(0.46, 0.5, max(g.x, g.y)); // thin lines on the boundaries
  let col = vec3<f32>(0.55, 0.62, 0.78) * line;     // faint cool grey
  return vec4<f32>(col, line);
}
