// Full-resolution black-border probe for copied camera frames. The compute pass
// scans the copied camera texture in frameCaptureTex's output/crop coordinate
// space and writes black-pixel counts per output column and row. JS reads those
// counters only, not the full RGBA frame.

struct Uniforms {
  // sourceW, sourceH, outputW, outputH
  dims: vec4<f32>,
  // rotation, blackMaxLinear, unused, unused
  params: vec4<f32>,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var srcTex: texture_2d<f32>;
// Layout: columns[0..outputW), rows[outputW..outputW+outputH), total at outputW+outputH.
@group(0) @binding(2) var<storage, read_write> counts: array<atomic<u32>>;

fn rotated_uv(outputCoord: vec2<u32>, outputSize: vec2<u32>) -> vec2<f32> {
  var uv = (vec2<f32>(outputCoord) + vec2<f32>(0.5)) / vec2<f32>(outputSize);
  let r = u32(u.params.x + 0.5);
  if (r == 1u) {
    uv = vec2<f32>(uv.y, 1.0 - uv.x);
  } else if (r == 2u) {
    uv = vec2<f32>(1.0 - uv.x, 1.0 - uv.y);
  } else if (r == 3u) {
    uv = vec2<f32>(1.0 - uv.y, uv.x);
  }
  return clamp(uv, vec2<f32>(0.0), vec2<f32>(0.999999));
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let sourceSize = vec2<u32>(u32(u.dims.x + 0.5), u32(u.dims.y + 0.5));
  let outputSize = vec2<u32>(u32(u.dims.z + 0.5), u32(u.dims.w + 0.5));
  if (gid.x >= outputSize.x || gid.y >= outputSize.y || sourceSize.x == 0u || sourceSize.y == 0u) {
    return;
  }

  let uv = rotated_uv(gid.xy, outputSize);
  let srcFloat = uv * vec2<f32>(sourceSize);
  let srcCoord = vec2<u32>(
    min(u32(srcFloat.x), sourceSize.x - 1u),
    min(u32(srcFloat.y), sourceSize.y - 1u),
  );
  let src = textureLoad(srcTex, vec2<i32>(i32(srcCoord.x), i32(srcCoord.y)), 0);
  if (
    src.a < 0.01 ||
    (src.r <= u.params.y && src.g <= u.params.y && src.b <= u.params.y)
  ) {
    let rowOffset = outputSize.x;
    let totalOffset = outputSize.x + outputSize.y;
    atomicAdd(&counts[gid.x], 1u);
    atomicAdd(&counts[rowOffset + gid.y], 1u);
    atomicAdd(&counts[totalOffset], 1u);
  }
}
