// Comet travelers + wake. A sphere + cube (the "principal") streak along a curve
// from head (age 0) to tail (age 1), spiralling and spinning. As the comet passes
// over a point on the curve it IGNITES that deposit's wake: small cubes that spawn,
// disperse, tumble, fade and vanish IN PLACE — exactly the tail-dissolution style
// (drift off the tangent + random dir, audio-reactive palette tint), just spinning.
//
// 100% GPU, no CPU particle state: the principal rides the travel `front` (see
// effects/Comet.ts); each wake particle is anchored to a FIXED deposit and lives off
// `front - depositAge` (how long ago the comet swept past). Two draw modes share
// this shader (v3.z): 0 = principal (1 instance), 1 = wake (deposits × particles).

struct Camera {
  viewProj: mat4x4<f32>,
  right: vec3<f32>,
  _p0: f32,
  up: vec3<f32>,
  cardAspect: f32,
  params: vec4<f32>, // x = ageRef, w = useCamera
  ribbon: vec4<f32>, // x = oldestSlot, y = capacity
  curve: vec4<f32>, // x = rotateY angle, yzw = age tint
  misc: vec4<f32>, // x = opacity, y = tail glow intensity, z = glow start age
  audio0: vec4<f32>,
  audio1: vec4<f32>, // z = audio enabled
  tint0: vec4<f32>,
  tint1: vec4<f32>, // y = spin, z = palette, w = partTint
  tint2: vec4<f32>, // x = partHueShift, y = partGrow
  key: vec4<f32>,
  sweep: vec4<f32>,
};

struct Deposit {
  posBirth: vec4<f32>,
  tangentPad: vec4<f32>,
  audioSnap: vec4<f32>, // audio at birth: x = centroid, y = beat, z = bass, w = treble
};

// front, active(0/1), rotation, count | orbitRadius, orbitSpeed, spin, size
// wakeLifeAge, partSize, partDrift, partSpin | time, phase, mode(0 principal/1 wake), wakeParticles
// scrollPhase, _, _, _ | (wake life/size/drift/spin = the TAIL's params, kept in sync)
struct CometParams {
  v0: vec4<f32>,
  v1: vec4<f32>,
  v2: vec4<f32>,
  v3: vec4<f32>,
  v4: vec4<f32>,
};

@group(0) @binding(0) var<uniform> cam: Camera;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var ring: texture_2d_array<f32>;
@group(0) @binding(3) var<storage, read> deposits: array<Deposit>;
@group(0) @binding(4) var<uniform> comet: CometParams;

const GRID = 4u; // particle grid over a deposit's card footprint (like the tail); the
                 // live wake-particles-per-deposit count (≤ GRID²=16) picks a subset
const PARTICLE_LIFETIME = 1.5; // seconds — wake life (kept in sync with particles.wgsl)

fn rotY(p: vec3<f32>, a: f32) -> vec3<f32> {
  let c = cos(a);
  let s = sin(a);
  return vec3<f32>(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

// Curve point at chronological index `s` (clamped to [0, count-1]), rotated per curve.
fn curveAt(s: f32, count: u32, oldestSlot: u32, capacity: u32, rotation: f32) -> vec3<f32> {
  let si = u32(clamp(s, 0.0, f32(count - 1u)));
  let slot = (oldestSlot + si) % capacity;
  return rotY(deposits[slot].posBirth.xyz, rotation);
}

// Catmull-Rom spline through p1→p2 (p0,p3 are neighbours) — smooth motion along the
// curve instead of faceted linear hops between adjacent deposits.
fn catmull(p0: vec3<f32>, p1: vec3<f32>, p2: vec3<f32>, p3: vec3<f32>, t: f32) -> vec3<f32> {
  let t2 = t * t;
  let t3 = t2 * t;
  return 0.5 * (2.0 * p1 + (-p0 + p2) * t
    + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2
    + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3);
}

// Derivative of catmull (the smooth tangent), for orienting the orbit frame.
fn catmullTangent(p0: vec3<f32>, p1: vec3<f32>, p2: vec3<f32>, p3: vec3<f32>, t: f32) -> vec3<f32> {
  let t2 = t * t;
  return 0.5 * ((-p0 + p2)
    + 2.0 * (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t
    + 3.0 * (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t2);
}

// Orbit frame in the plane PERPENDICULAR to the tangent t, for a corkscrew that has no
// component along the travel direction (so the body can never appear to swim backward).
// cross(t, up) flips where t nears vertical; rather than teleport to the antipode there,
// `radial` shrinks the orbit to 0 through the degeneracy (a smooth dip onto the centre-
// line) then re-expands — continuous, no jump. n, b are ⊥ t; radial is the radius scale.
struct OrbitFrame { n: vec3<f32>, b: vec3<f32>, radial: f32 };
fn orbitFrame(t: vec3<f32>) -> OrbitFrame {
  let cr = cross(t, vec3<f32>(0.0, 1.0, 0.0));
  let m = length(cr);
  var o: OrbitFrame;
  o.n = select(vec3<f32>(1.0, 0.0, 0.0), cr / max(m, 1e-5), m > 1e-4);
  o.b = cross(t, o.n);
  o.radial = smoothstep(0.0, 0.25, m);
  return o;
}

fn tumble(p: vec3<f32>, a1: f32, a2: f32) -> vec3<f32> {
  let q = rotY(p, a1);
  let c = cos(a2);
  let s = sin(a2);
  return vec3<f32>(q.x, c * q.y - s * q.z, s * q.y + c * q.z);
}

fn hash33(p3in: vec3<f32>) -> vec3<f32> {
  var p3 = fract(p3in * vec3<f32>(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}

// IQ cosine gradient palette (kept in sync with particles.wgsl) — wake audio tint.
fn pal(tIn: f32, shift: f32, sel: f32) -> vec3<f32> {
  let t = fract(tIn + shift);
  var d = vec3<f32>(0.0, 0.33, 0.67);
  if (sel > 1.5) {
    d = vec3<f32>(0.0, 0.10, 0.20);
  } else if (sel > 0.5) {
    d = vec3<f32>(0.3, 0.20, 0.20);
  }
  return vec3<f32>(0.5) + vec3<f32>(0.5) * cos(6.28318 * (t + d));
}

// Beat/bass scale-pop from a deposit's FROZEN audio (kept in sync with particles.wgsl).
fn audioPop(snap: vec4<f32>) -> f32 {
  if (cam.audio1.z < 0.5) { return 0.0; }
  return cam.tint2.y * (snap.y * 0.8 + snap.z * 0.3); // partGrow * (beat + bass)
}

// Scale envelope along the front: ramps up over the first ~300ms after launch and
// down over the last ~300ms before the tail. 300ms ≈ 0.2·lifeAge (lifeAge = 1.5s in
// front-units), so the fade is a constant real duration regardless of `duration`.
fn endEnv(front: f32, lifeAge: f32) -> f32 {
  let edge = max(0.2 * lifeAge, 1e-4);
  return smoothstep(0.0, edge, front) * (1.0 - smoothstep(1.0 - edge, 1.0, front));
}

struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) age: f32,
  @location(3) @interpolate(flat) layer: u32,
  @location(4) fade: f32,
  @location(5) aud: vec4<f32>, // deposit's frozen audio snapshot (for the wake tint)
};

@vertex
fn vs(
  @location(0) localPos: vec3<f32>,
  @location(1) localNormal: vec3<f32>,
  @location(2) uv: vec2<f32>,
  @builtin(instance_index) inst: u32,
) -> VSOut {
  var out: VSOut;
  out.uv = uv;
  out.normal = localNormal;
  out.layer = 0u;
  out.age = 0.0;
  out.fade = 0.0;
  out.aud = vec4<f32>(0.0);

  let front = comet.v0.x;
  let isActive = comet.v0.y > 0.5;
  let rotation = comet.v0.z;
  let count = u32(comet.v0.w);
  let mode = comet.v3.z;

  // Idle or too few deposits to interpolate → push past the far plane (z > w) so the
  // whole primitive is clipped and costs nothing downstream.
  if (!isActive || count < 2u) {
    out.position = vec4<f32>(0.0, 0.0, 2.0, 1.0);
    return out;
  }

  let oldestSlot = u32(cam.ribbon.x);
  let capacity = u32(cam.ribbon.y);
  let spin = comet.v1.z;
  let phase = comet.v3.y;
  let time = comet.v3.x;

  if (mode < 0.5) {
    // ---- PRINCIPAL: one body riding the front head→tail, gentle orbit + slow tumble.
    // Culled outside [0,1] so it never pins/eases at the ends (no "stuck following the
    // head" at launch, no "drifts past the tail then jumps back" at the end). ----
    if (front < 0.0 || front > 1.0) {
      out.position = vec4<f32>(0.0, 0.0, 2.0, 1.0);
      return out;
    }
    let orbitRadius = comet.v1.x;
    let orbitSpeed = comet.v1.y;
    let size = comet.v1.w;

    let a = front;
    // Add the sub-deposit scroll phase so the body rides the scrolling ribbon
    // continuously (otherwise it hops a whole segment each time a deposit is added).
    let sf = (1.0 - a) * f32(count - 1u) + comet.v4.x;
    let s1f = floor(sf);
    let f = sf - s1f;
    // Catmull-Rom through the 4 surrounding deposits → smooth motion along the curve
    // (no faceted linear hops between adjacent points).
    let cp0 = curveAt(s1f - 1.0, count, oldestSlot, capacity, rotation);
    let cp1 = curveAt(s1f, count, oldestSlot, capacity, rotation);
    let cp2 = curveAt(s1f + 1.0, count, oldestSlot, capacity, rotation);
    let cp3 = curveAt(s1f + 2.0, count, oldestSlot, capacity, rotation);
    let P = catmull(cp0, cp1, cp2, cp3, f);
    let slot0 = (oldestSlot + u32(clamp(s1f, 0.0, f32(count - 1u)))) % capacity;

    // Corkscrew orbit in the plane perpendicular to the curve tangent — its velocity is
    // ⊥ the travel direction, so the body never appears to swim backward (a camera-plane
    // orbit did, looping fore/aft). orbitFrame collapses the radius near vertical tangents
    // instead of flipping sides. cube/sphere ride in phase opposition (0 / π).
    let T = normalize(catmullTangent(cp0, cp1, cp2, cp3, f) + vec3<f32>(1e-4));
    let fr = orbitFrame(T);
    let theta = time * orbitSpeed + phase;
    let center = P + (cos(theta) * fr.n + sin(theta) * fr.b) * (orbitRadius * fr.radial);
    // Tumble keyed to time + phase only — a per-deposit hash jumped at each slot crossing.
    let sp1 = time * spin + phase;
    let sp2 = time * spin * 0.7 + phase * 0.7;

    // Scale up on launch, down ~300ms before the tail.
    let env = endEnv(front, comet.v2.x);
    let world = center + tumble(localPos, sp1, sp2) * (size * env);
    out.position = cam.viewProj * vec4<f32>(world, 1.0);
    out.normal = tumble(localNormal, sp1, sp2);
    out.uv = uv;
    out.age = a;
    out.layer = slot0;
    out.fade = 1.0;
    out.aud = deposits[slot0].audioSnap;
    return out;
  }

  // ---- WAKE: the tail-dissolution particle effect, triggered by the comet passing.
  // Anchored to a FIXED deposit; spawns when the front sweeps over it, then disperses,
  // shrinks, tumbles and vanishes IN PLACE. Same math + params as particles.wgsl, only
  // the trigger differs (front passage instead of the tail zone). ----
  let lifeAge = comet.v2.x; // age-window equal to the tail's fixed real lifetime
  let pSize = comet.v2.y; // tail particleParams.size
  let pDrift = comet.v2.z; // tail particleParams.drift
  let pSpin = comet.v2.w; // tail particleParams.spin

  let wakeParticles = max(u32(comet.v3.w), 1u); // particles per deposit (density)
  let dep = inst / wakeParticles; // absolute deposit index 0..count-1
  let pidx = inst % wakeParticles;
  let slot = (oldestSlot + dep) % capacity;
  let P0 = deposits[slot].posBirth;
  let age = clamp((cam.params.x - P0.w) / max(cam.ribbon.y, 1.0), 0.0, 1.0);

  // The front sweeps head(0)→tail(1) and ignites a deposit as it passes. `passed` =
  // how far (in age) the front moved beyond it; `lifeAge` maps that to the tail's fixed
  // real lifetime → prog 0 = just spawned, 1 = gone. Outside [0, lifeAge) → cull.
  let passed = front - age;
  if (passed < 0.0 || passed >= lifeAge) {
    out.position = vec4<f32>(0.0, 0.0, 2.0, 1.0);
    return out;
  }
  let prog = clamp(passed / max(lifeAge, 1e-4), 0.0, 1.0);

  // The wake must emerge from BEHIND the orbiting body (so the trail is circular), not
  // from the curve centreline. Reconstruct where the body was when it swept this deposit:
  // tSince seconds ago (= prog·lifetime) at orbit angle θ = (time-tSince)·orbitSpeed+phase
  // around the deposit's curve frame. `phase` (0 / π) selects the cube vs sphere body.
  let orbitRadius = comet.v1.x;
  let orbitSpeed = comet.v1.y;
  let center = rotY(P0.xyz, rotation); // deposit point = body's curve position when passed
  // Reconstruct where the body was when it swept this deposit (tSince = prog·lifetime ago),
  // in the SAME perpendicular corkscrew the principal uses, so the trail emerges from the
  // body and reads as a helix. Tangent at the deposit matches the principal's frame there.
  let sfd = f32(dep);
  let T = normalize(curveAt(sfd + 1.0, count, oldestSlot, capacity, rotation)
    - curveAt(sfd - 1.0, count, oldestSlot, capacity, rotation) + vec3<f32>(1e-4));
  let fr = orbitFrame(T);
  let tSince = prog * PARTICLE_LIFETIME;
  let thetaPass = (time - tSince) * orbitSpeed + phase;
  let bodyPos = center + (cos(thetaPass) * fr.n + sin(thetaPass) * fr.b) * (orbitRadius * fr.radial);

  let snap = deposits[slot].audioSnap;
  let pop = audioPop(snap); // beat/bass swell, frozen at this point
  // (1-prog) = the particle's own dissolve; endEnv scales the whole wake up on launch
  // and down ~300ms before the comet reaches the tail.
  let scale = pSize * (1.0 - prog) * (1.0 + pop) * endEnv(front, lifeAge);

  // Grid cell within the card footprint → matches the broken-up frame (like the tail).
  let gx = f32(pidx % GRID);
  let gy = f32(pidx / GRID);
  let cellUv = vec2<f32>((gx + 0.5) / f32(GRID), (gy + 0.5) / f32(GRID));
  let off = (cellUv - vec2<f32>(0.5)) * pSize * 3.0;
  let basePos = bodyPos + cam.right * off.x + cam.up * off.y;

  // Velocity: curve tangent (kinetic motion) + random dispersion — same as particles.wgsl.
  let tan = T;
  let h = hash33(vec3<f32>(f32(slot), f32(pidx) + phase, 1.7));
  let randDir = normalize(h * 2.0 - vec3<f32>(1.0));
  let vel = normalize(tan * 0.6 + randDir * 0.85);
  let pos = basePos + vel * prog * pDrift * (1.0 + pop);

  // Treble (frozen) adds a shimmer spin on top of the base tumble (same as particles.wgsl).
  let shimmer = select(0.0, cam.tint1.y * snap.w, cam.audio1.z > 0.5);
  let a1 = prog * pSpin * 6.2831 + h.x * 6.2831 + prog * shimmer * 8.0;
  let a2 = prog * pSpin * 4.0 + h.y * 6.2831 + prog * shimmer * 6.0;
  let world = pos + tumble(localPos, a1, a2) * scale;

  out.position = cam.viewProj * vec4<f32>(world, 1.0);
  out.normal = tumble(localNormal, a1, a2);
  out.uv = cellUv;
  out.age = age;
  out.layer = slot;
  out.fade = 1.0;
  out.aud = snap;
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  let mode = comet.v3.z;

  // Textured by the ribbon frame of the slot it's crossing (or an age colour when the
  // camera/synthetic source is off) — matches shapeMesh / particles. Branch on the
  // uniform (not select()) so the aged mode skips the ring fetch entirely.
  var col = mix(vec3<f32>(1.0, 0.55, 0.2), vec3<f32>(0.25, 0.5, 1.0), in.age) * cam.curve.yzw;
  if (cam.params.w > 0.5) {
    col = textureSampleLevel(ring, samp, in.uv, i32(in.layer), 0.0).rgb;
  }

  let l = normalize(vec3<f32>(0.4, 0.8, 0.5));
  let diff = max(dot(normalize(in.normal), l), 0.0) * 0.35 + 0.85;
  col = col * diff;

  if (mode < 0.5) {
    // Principal: a little warm glow so the travelers read as bright bodies.
    col = col + vec3<f32>(1.0, 0.85, 0.6) * 0.25;
  } else {
    // Wake: same audio-reactive palette tint as the tail-dissolution particles —
    // hue from this point's frozen centroid, lift from its frozen beat.
    if (cam.audio1.z > 0.5 && cam.tint1.w > 0.0) {
      let tcol = pal(in.aud.x * cam.tint1.x, cam.tint2.x, cam.tint1.z);
      col = col * mix(vec3<f32>(1.0), tcol * 1.8, cam.tint1.w) + tcol * (in.aud.y * cam.tint1.w * 0.6);
    }
  }

  // Principal is opaque (fade = 1); wake fades out as it dissolves.
  return vec4<f32>(col, in.fade);
}
