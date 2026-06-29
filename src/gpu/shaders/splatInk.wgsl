// Lays down the live Lorenz deposits as soft additive blobs into the square splat
// texture, using an orthographic "butterfly portrait" projection that slowly
// rotates — independent of the scene's orbital camera. Decayed every frame by
// trailFade.wgsl, so the attractor draws itself and the trail estompes. Mirrors
// ribbonInk's age weighting: newer deposits ink stronger.

struct U {
  rot: vec4<f32>,  // x = angleY, y = tiltX, z = scale, w = pointSize
  info: vec4<f32>, // x = ageRef, y = capacity, z = oldestSlot, w = inkIntensity
};

struct Deposit {
  posBirth: vec4<f32>, // xyz = world position, w = birthSeq
  tangentPad: vec4<f32>,
  audioSnap: vec4<f32>,
};

@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> deposits: array<Deposit>;

struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>, // -1..1 quad coords for the radial falloff
  @location(1) age: f32,
};

fn rotY(p: vec3<f32>, a: f32) -> vec3<f32> {
  let c = cos(a);
  let s = sin(a);
  return vec3<f32>(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

fn rotX(p: vec3<f32>, a: f32) -> vec3<f32> {
  let c = cos(a);
  let s = sin(a);
  return vec3<f32>(p.x, c * p.y - s * p.z, s * p.y + c * p.z);
}

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) s: u32) -> VSOut {
  let capacity = u32(u.info.y);
  let slot = (u32(u.info.z) + s) % capacity;
  let P = deposits[slot].posBirth;
  var w = rotY(P.xyz, u.rot.x);
  w = rotX(w, u.rot.y);

  // Screen-aligned blob quad (triangle-strip) in the splat texture's NDC. The
  // splat texture is square, so no aspect correction is needed.
  let cx = select(-1.0, 1.0, (vi & 1u) == 1u);
  let cy = select(-1.0, 1.0, vi >= 2u);
  let scale = u.rot.z;
  let ps = u.rot.w;

  var out: VSOut;
  out.position = vec4<f32>(w.x * scale + cx * ps, w.y * scale + cy * ps, 0.0, 1.0);
  out.uv = vec2<f32>(cx, cy);
  out.age = clamp((u.info.x - P.w) / max(u.info.y, 1.0), 0.0, 1.0);
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  let soft = smoothstep(1.0, 0.0, length(in.uv)); // radial falloff
  let a = soft * (1.0 - in.age) * u.info.w; // newer deposits ink stronger
  return vec4<f32>(a, a, a, a);
}
