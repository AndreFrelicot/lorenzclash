// Lays down soft "ink" blobs at each Lorenz deposit, into the screen-space trail
// buffer (additive). Decayed every frame by trailFade.wgsl, this becomes the
// smoke/trail the ribbon leaves behind, which the background then uses to smear
// and dirty the still. One billboarded quad per deposit; newer deposits ink more.
//
// Reuses the ribbon's camera uniform + deposits storage buffer (same layout).

struct Camera {
  viewProj: mat4x4<f32>,
  right: vec3<f32>,
  _p0: f32,
  up: vec3<f32>,
  cardAspect: f32,
  params: vec4<f32>, // x = ageRef (deposit count)
  ribbon: vec4<f32>, // x = oldestSlot, y = capacity, z = inkSize, w = inkIntensity
};

struct Deposit {
  posBirth: vec4<f32>, // xyz = world position, w = birthSeq
  tangentPad: vec4<f32>,
  audioSnap: vec4<f32>, // unused here, but keeps the storage stride matching
};

@group(0) @binding(0) var<uniform> cam: Camera;
@group(0) @binding(1) var<storage, read> deposits: array<Deposit>;

struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>, // -1..1 quad coords for the radial falloff
  @location(1) age: f32,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) s: u32) -> VSOut {
  let capacity = u32(cam.ribbon.y);
  let slot = (u32(cam.ribbon.x) + s) % capacity;
  let P = deposits[slot].posBirth;

  // Camera-facing quad corner (triangle-strip).
  let cx = select(-1.0, 1.0, (vi & 1u) == 1u);
  let cy = select(-1.0, 1.0, vi >= 2u);
  let world = P.xyz + (cam.right * cx + cam.up * cy) * cam.ribbon.z;

  var out: VSOut;
  out.position = cam.viewProj * vec4<f32>(world, 1.0);
  out.uv = vec2<f32>(cx, cy);
  out.age = clamp((cam.params.x - P.w) / max(cam.ribbon.y, 1.0), 0.0, 1.0);
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  let soft = smoothstep(1.0, 0.0, length(in.uv)); // radial falloff
  let a = soft * (1.0 - in.age) * cam.ribbon.w; // newer deposits ink stronger
  return vec4<f32>(a, a, a, a);
}
