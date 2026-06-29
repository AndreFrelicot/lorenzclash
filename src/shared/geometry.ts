// Static mesh geometry for the per-deposit shapes (cube, sphere), generated once
// on the CPU. Interleaved vertex layout: position(3), normal(3), uv(2) = 8 floats
// per vertex (stride 32 bytes). Non-indexed (plain triangle lists) to keep the
// pipeline simple. Unit size, centred on the origin; the shader scales/places it
// at each deposit. See gpu/shaders/shapeMesh.wgsl.

export const VERTEX_STRIDE_FLOATS = 8;

export interface Mesh {
  data: Float32Array;
  vertexCount: number;
}

// Unit cube (half-extent 0.5), each face UV-mapped 0..1 so it shows the full frame.
export function createCube(): Mesh {
  const faces: { o: number[]; du: number[]; dv: number[]; n: number[] }[] = [
    { o: [-0.5, -0.5, 0.5], du: [1, 0, 0], dv: [0, 1, 0], n: [0, 0, 1] }, // +Z
    { o: [0.5, -0.5, -0.5], du: [-1, 0, 0], dv: [0, 1, 0], n: [0, 0, -1] }, // -Z
    { o: [0.5, -0.5, 0.5], du: [0, 0, -1], dv: [0, 1, 0], n: [1, 0, 0] }, // +X
    { o: [-0.5, -0.5, -0.5], du: [0, 0, 1], dv: [0, 1, 0], n: [-1, 0, 0] }, // -X
    { o: [-0.5, 0.5, 0.5], du: [1, 0, 0], dv: [0, 0, -1], n: [0, 1, 0] }, // +Y
    { o: [-0.5, -0.5, -0.5], du: [1, 0, 0], dv: [0, 0, 1], n: [0, -1, 0] }, // -Y
  ];
  const out: number[] = [];
  const corner = (f: (typeof faces)[0], su: number, sv: number, u: number, v: number): void => {
    out.push(
      f.o[0] + f.du[0] * su + f.dv[0] * sv,
      f.o[1] + f.du[1] * su + f.dv[1] * sv,
      f.o[2] + f.du[2] * su + f.dv[2] * sv,
      f.n[0],
      f.n[1],
      f.n[2],
      u,
      v,
    );
  };
  for (const f of faces) {
    // Two triangles per face: (0,0)-(1,0)-(1,1) and (0,0)-(1,1)-(0,1).
    corner(f, 0, 0, 0, 0);
    corner(f, 1, 0, 1, 0);
    corner(f, 1, 1, 1, 1);
    corner(f, 0, 0, 0, 0);
    corner(f, 1, 1, 1, 1);
    corner(f, 0, 1, 0, 1);
  }
  return { data: new Float32Array(out), vertexCount: out.length / VERTEX_STRIDE_FLOATS };
}

// Unit sphere (radius 0.5), lat/long mapped; UV wraps the frame around it.
export function createSphere(latBands = 14, longBands = 20): Mesh {
  const out: number[] = [];
  const vert = (i: number, j: number): void => {
    const theta = (i / latBands) * Math.PI; // 0..π
    const phi = (j / longBands) * 2 * Math.PI; // 0..2π
    const x = Math.sin(theta) * Math.cos(phi);
    const y = Math.cos(theta);
    const z = Math.sin(theta) * Math.sin(phi);
    out.push(x * 0.5, y * 0.5, z * 0.5, x, y, z, j / longBands, i / latBands);
  };
  for (let i = 0; i < latBands; i++) {
    for (let j = 0; j < longBands; j++) {
      vert(i, j);
      vert(i + 1, j);
      vert(i + 1, j + 1);
      vert(i, j);
      vert(i + 1, j + 1);
      vert(i, j + 1);
    }
  }
  return { data: new Float32Array(out), vertexCount: out.length / VERTEX_STRIDE_FLOATS };
}

// A flat square line lattice in the XZ plane at y = `baseY`, centred on the origin,
// spanning [-half, half] on each axis with `n` nodes per side. Returned as a plain
// line list (2 positions per segment, position-only, stride 12 bytes) for the
// deformation-grid pass — the vertex shader displaces it by the motion field.
export interface LineMesh {
  data: Float32Array;
  vertexCount: number;
}

export function createGrid(n = 24, half = 2.4, baseY = -1.1): LineMesh {
  const out: number[] = [];
  const at = (k: number): number => -half + (2 * half * k) / (n - 1);
  for (let i = 0; i < n; i++) {
    const c = at(i);
    for (let j = 0; j < n - 1; j++) {
      const a = at(j);
      const b = at(j + 1);
      // Line segment along X (z = c), then the segment along Z (x = c).
      out.push(a, baseY, c, b, baseY, c);
      out.push(c, baseY, a, c, baseY, b);
    }
  }
  return { data: new Float32Array(out), vertexCount: out.length / 3 };
}
