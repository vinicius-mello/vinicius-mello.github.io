// Indexed triangle mesh: the kernel's output, consumed by the viewer and STL export.
// Plain typed arrays so it can cross the worker boundary as transferables.

export class Mesh {
  constructor(positions, indices) {
    this.positions = positions; // Float32Array, xyz per vertex
    this.indices = indices;     // Uint32Array, 3 per triangle
  }

  static from({ positions, indices }) { return new Mesh(positions, indices); }

  get vertexCount() { return this.positions.length / 3; }
  get triangleCount() { return this.indices.length / 3; }

  bbox() {
    const p = this.positions;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        if (p[i + k] < min[k]) min[k] = p[i + k];
        if (p[i + k] > max[k]) max[k] = p[i + k];
      }
    }
    return { min, max };
  }

  volume() {
    const p = this.positions, I = this.indices;
    let v = 0;
    for (let t = 0; t < I.length; t += 3) {
      const a = 3 * I[t], b = 3 * I[t + 1], c = 3 * I[t + 2];
      v += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1])
         - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c])
         + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
    }
    return v / 6;
  }

  // Closed 2-manifold check: every directed edge has exactly one opposite twin.
  topology() {
    const n = this.vertexCount, I = this.indices;
    const count = new Map();
    for (let t = 0; t < I.length; t += 3) {
      for (let k = 0; k < 3; k++) {
        const key = I[t + k] * n + I[t + ((k + 1) % 3)];
        count.set(key, (count.get(key) ?? 0) + 1);
      }
    }
    let boundary = 0, nonManifold = 0;
    for (const [key, c] of count) {
      const a = Math.floor(key / n), b = key % n;
      const twin = count.get(b * n + a) ?? 0;
      if (c > 1 || twin > 1) nonManifold++;
      else if (twin === 0) boundary++;
    }
    return { boundaryEdges: boundary, nonManifoldEdges: nonManifold, closed: boundary === 0 && nonManifold === 0 };
  }

  // Unindexed triangle soup with per-face normals (flat shading).
  toFlatArrays() {
    const P = this.positions, I = this.indices, T = this.triangleCount;
    const pos = new Float32Array(T * 9), nor = new Float32Array(T * 9);
    for (let t = 0; t < T; t++) {
      const a = 3 * I[3 * t], b = 3 * I[3 * t + 1], c = 3 * I[3 * t + 2];
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      const vs = [a, b, c];
      for (let k = 0; k < 3; k++) {
        const o = t * 9 + k * 3, v = vs[k];
        pos[o] = P[v]; pos[o + 1] = P[v + 1]; pos[o + 2] = P[v + 2];
        nor[o] = nx; nor[o + 1] = ny; nor[o + 2] = nz;
      }
    }
    return { positions: pos, normals: nor };
  }
}
