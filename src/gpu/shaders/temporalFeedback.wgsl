// Temporal feedback post-process. It simulates a short "open shutter" moment by
// mixing the current final composite with the previous feedback frame.

struct Temporal {
  // x = amount, y = history decay, z = exposure lift, w = _
  params: vec4<f32>,
};

@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var currentTex: texture_2d<f32>;
@group(0) @binding(2) var historyTex: texture_2d<f32>;
@group(0) @binding(3) var<uniform> temporal: Temporal;

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
  out.uv = vec2<f32>(x, 1.0 - y);
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  let amount = clamp(temporal.params.x, 0.0, 1.0);
  let decay = clamp(temporal.params.y, 0.0, 0.995);
  let exposure = max(temporal.params.z, 0.0);

  let current = textureSampleLevel(currentTex, samp, in.uv, 0.0).rgb;
  let history = textureSampleLevel(historyTex, samp, in.uv, 0.0).rgb * decay;

  let retained = max(current, history);
  let additive = min(current + history * amount * exposure, vec3<f32>(1.0));
  let openShutter = mix(retained, additive, 0.45);
  return vec4<f32>(mix(current, openShutter, amount), 1.0);
}
