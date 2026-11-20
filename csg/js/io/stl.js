// STL writers for Mesh objects (see geom/mesh.js).

function faceNormal(p, a, b, c) {
  const ux = p[3 * b] - p[3 * a], uy = p[3 * b + 1] - p[3 * a + 1], uz = p[3 * b + 2] - p[3 * a + 2];
  const vx = p[3 * c] - p[3 * a], vy = p[3 * c + 1] - p[3 * a + 1], vz = p[3 * c + 2] - p[3 * a + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

export function toBinarySTL(mesh, header = 'csg-dsl') {
  const T = mesh.triangleCount;
  const buf = new ArrayBuffer(84 + 50 * T);
  const dv = new DataView(buf);
  const head = new TextEncoder().encode(header.slice(0, 80));
  new Uint8Array(buf, 0, 80).set(head);
  dv.setUint32(80, T, true);
  const P = mesh.positions, I = mesh.indices;
  let o = 84;
  for (let t = 0; t < T; t++) {
    const a = I[3 * t], b = I[3 * t + 1], c = I[3 * t + 2];
    for (const v of faceNormal(P, a, b, c)) { dv.setFloat32(o, v, true); o += 4; }
    for (const i of [a, b, c]) {
      for (let k = 0; k < 3; k++) { dv.setFloat32(o, P[3 * i + k], true); o += 4; }
    }
    dv.setUint16(o, 0, true);
    o += 2;
  }
  return buf;
}

export function toAsciiSTL(mesh, name = 'solid') {
  const safe = name.replace(/\s+/g, '_') || 'solid';
  const P = mesh.positions, I = mesh.indices;
  const f = (x) => x.toPrecision(9);
  const lines = [`solid ${safe}`];
  for (let t = 0; t < mesh.triangleCount; t++) {
    const a = I[3 * t], b = I[3 * t + 1], c = I[3 * t + 2];
    lines.push(`  facet normal ${faceNormal(P, a, b, c).map(f).join(' ')}`, '    outer loop');
    for (const i of [a, b, c]) lines.push(`      vertex ${f(P[3 * i])} ${f(P[3 * i + 1])} ${f(P[3 * i + 2])}`);
    lines.push('    endloop', '  endfacet');
  }
  lines.push(`endsolid ${safe}`);
  return lines.join('\n') + '\n';
}

// Minimal binary STL reader (used by tests and for future import).
export function parseBinarySTL(buf) {
  const dv = new DataView(buf);
  const T = dv.getUint32(80, true);
  const tris = [];
  for (let t = 0; t < T; t++) {
    const o = 84 + 50 * t + 12;
    const v = [];
    for (let k = 0; k < 9; k++) v.push(dv.getFloat32(o + 4 * k, true));
    tris.push(v);
  }
  return tris;
}
