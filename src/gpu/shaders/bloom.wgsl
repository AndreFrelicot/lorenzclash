// Screen-space bloom post-process. The scene is rendered to an offscreen texture,
// then: bright_fs extracts pixels above a threshold (soft knee) into a half-res
// target, blur_fs blurs it (run twice, ping-pong, for a wider glow), and
// composite_fs adds the blurred glow back over the scene → the canvas. The bright,
// additive elements (head crest, tail glow, edge tint) bloom; the camera texture
// (mid-brightness) stays clean → the glow reads as "localized" on the luminous bits.
//
// Bindings: 0 sampler, 1 input texture, 2 params, 3 bloom texture (composite only).

struct Bloom {
  // x = threshold, y = intensity, z = texelX, w = texelY (of the bloom target)
  params: vec4<f32>,
  // Slow-mo ripple: x = amplitude, y = phase (warp-scaled time), z = frequency, w = _
  fx: vec4<f32>,
  // Timed pixel-ripple event: x = amplitude, y = phase, z = frequency, w = _
  eventFx: vec4<f32>,
};

@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var tex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> bloom: Bloom;
@group(0) @binding(3) var bloomTex: texture_2d<f32>;

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
  // Flip y so uv (0,0) maps to the framebuffer's top-left texel (WebGPU convention).
  out.uv = vec2<f32>(x, 1.0 - y);
  return out;
}

fn luma(c: vec3<f32>) -> f32 {
  return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
}

// Bright pass: keep only the energy above the threshold (soft knee preserves hue).
@fragment
fn bright_fs(in: VSOut) -> @location(0) vec4<f32> {
  let c = textureSampleLevel(tex, samp, in.uv, 0.0).rgb;
  let lum = luma(c);
  let k = max(lum - bloom.params.x, 0.0) / max(lum, 1e-4);
  return vec4<f32>(c * k, 1.0);
}

// 5×5 box blur at the (half-res) bloom resolution; two passes ≈ a soft gaussian.
@fragment
fn blur_fs(in: VSOut) -> @location(0) vec4<f32> {
  let texel = bloom.params.zw;
  var sum = vec3<f32>(0.0);
  for (var i = -2; i <= 2; i++) {
    for (var j = -2; j <= 2; j++) {
      sum += textureSampleLevel(tex, samp, in.uv + vec2<f32>(f32(i), f32(j)) * texel, 0.0).rgb;
    }
  }
  return vec4<f32>(sum / 25.0, 1.0);
}

// Composite: scene + blurred glow × intensity.
@fragment
fn composite_fs(in: VSOut) -> @location(0) vec4<f32> {
  // Slow-mo ripple: a radial wave from the centre warps the whole image. Amplitude
  // fades in with slow-mo; the phase is the warp-scaled scene time → it slows with
  // the music and eases back to normal on release.
  var uv = in.uv;
  let amp = bloom.fx.x;
  if (amp > 0.0001) {
    let c = uv - vec2<f32>(0.5);
    let d = length(c) + 1e-5;
    let w = (
      sin(d * bloom.fx.z - bloom.fx.y * 2.0) +
      sin(d * bloom.fx.z * 0.53 + bloom.fx.y * 1.35) * 0.35
    ) * amp;
    uv = uv + (c / d) * w;
  }
  let eventAmp = bloom.eventFx.x;
  if (eventAmp > 0.0001) {
    let c = uv - vec2<f32>(0.5);
    let d = length(c) + 1e-5;
    let w = (
      sin(d * bloom.eventFx.z - bloom.eventFx.y) +
      sin(d * bloom.eventFx.z * 0.62 - bloom.eventFx.y * 1.7) * 0.42
    ) * eventAmp;
    uv = uv + (c / d) * w;
  }
  let scene = textureSampleLevel(tex, samp, uv, 0.0).rgb;
  let glow = textureSampleLevel(bloomTex, samp, uv, 0.0).rgb;
  return vec4<f32>(scene + glow * bloom.params.y, 1.0);
}
