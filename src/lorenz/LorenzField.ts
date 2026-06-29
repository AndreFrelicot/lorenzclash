// Generates a stack of 2D "butterfly" density textures of the Lorenz attractor on
// the CPU, once at startup. Each layer is a different VIEW of the attractor — a
// different rho (shape) and a different 3D rotation before projection (angle) —
// so the dissolve mask varies from one still to the next.
//
// Each layer: integrate the system, centre + rotate the trajectory, project to 2D,
// splat into a square single-channel image (dense spiral bands bright, gaps dark).
// Used as the dissolve mask: revealing by 1 - density makes the image appear ALONG
// the attractor's curves first. Procedural, no asset. Cheap (~tens of ms once).

const SIGMA = 10;
const BETA = 8 / 3;
const STEPS = 45000;
const WARMUP = 2000;
const DT = 0.005;

export function generateLorenzFields(
  count = 10,
  size = 512,
): { data: Uint8Array; size: number; count: number } {
  const data = new Uint8Array(count * size * size);
  for (let layer = 0; layer < count; layer++) {
    const f = count > 1 ? layer / (count - 1) : 0;
    const rho = 25 + f * 17; // 25..42 → varied butterfly shapes
    const ax = Math.sin(layer) * 0.4; // gentle tilt
    const ay = layer * ((2 * Math.PI) / count); // even azimuth spin
    renderLayer(data, layer * size * size, size, rho, ax, ay);
  }
  return { data, size, count };
}

function renderLayer(
  out: Uint8Array,
  offset: number,
  size: number,
  rho: number,
  ax: number,
  ay: number,
): void {
  let x = 0.1;
  let y = 0;
  let z = 0;
  for (let i = 0; i < WARMUP; i++) {
    const dx = SIGMA * (y - x);
    const dy = x * (rho - z) - y;
    const dz = x * y - BETA * z;
    x += dx * DT;
    y += dy * DT;
    z += dz * DT;
  }

  // Collect the trajectory and its centroid.
  const xs = new Float32Array(STEPS);
  const ys = new Float32Array(STEPS);
  const zs = new Float32Array(STEPS);
  let mx = 0;
  let my = 0;
  let mz = 0;
  for (let i = 0; i < STEPS; i++) {
    const dx = SIGMA * (y - x);
    const dy = x * (rho - z) - y;
    const dz = x * y - BETA * z;
    x += dx * DT;
    y += dy * DT;
    z += dz * DT;
    xs[i] = x;
    ys[i] = y;
    zs[i] = z;
    mx += x;
    my += y;
    mz += z;
  }
  mx /= STEPS;
  my /= STEPS;
  mz /= STEPS;

  const cax = Math.cos(ax);
  const sax = Math.sin(ax);
  const cay = Math.cos(ay);
  const say = Math.sin(ay);

  // Centre, rotate (Rx then Ry), project to 2D, track bounds.
  const px = new Float32Array(STEPS);
  const pz = new Float32Array(STEPS);
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (let i = 0; i < STEPS; i++) {
    const x0 = xs[i] - mx;
    const y0 = ys[i] - my;
    const z0 = zs[i] - mz;
    const z1 = y0 * sax + z0 * cax; // rotated z (Rx); rotated y is the discarded depth
    const u = x0 * cay + z1 * say; // rotated x
    const v = z1 * cay - x0 * say; // rotated z (the "vertical")
    px[i] = u;
    pz[i] = v;
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }

  const margin = 0.1;
  const cu = (minU + maxU) / 2;
  const cv = (minV + maxV) / 2;
  const span = Math.max(maxU - minU, maxV - minV) || 1;
  const fit = (1 - 2 * margin) / span;

  const accum = new Float32Array(size * size);
  for (let i = 0; i < STEPS; i++) {
    const nx = (px[i] - cu) * fit + 0.5;
    const nv = (pz[i] - cv) * fit + 0.5;
    const ix = Math.round(nx * (size - 1));
    const iy = Math.round((1 - nv) * (size - 1)); // v up → row 0 is the top
    for (let oy = -1; oy <= 1; oy++) {
      const yy = iy + oy;
      if (yy < 0 || yy >= size) continue;
      for (let ox = -1; ox <= 1; ox++) {
        const xx = ix + ox;
        if (xx < 0 || xx >= size) continue;
        accum[yy * size + xx] += ox === 0 && oy === 0 ? 1 : 0.5;
      }
    }
  }

  // Normalize with gamma compression so sparse outer rings stay visible.
  let peak = 0;
  for (let i = 0; i < accum.length; i++) if (accum[i] > peak) peak = accum[i];
  const inv = peak > 0 ? 1 / peak : 0;
  for (let i = 0; i < accum.length; i++) {
    out[offset + i] = Math.min(255, Math.round(Math.pow(accum[i] * inv, 0.4) * 255));
  }
}
