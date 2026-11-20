// Geometry kernel on top of manifold-3d (WASM).
//
// Every Manifold handle lives in WASM memory and must be freed explicitly. The kernel
// tracks all handles it creates in an arena; `dispose()` frees them all at once, after
// the meshes the UI needs have been extracted.
import { toColumnMajor } from './mat4.js';
import { Mesh } from './mesh.js';

let wasmPromise = null;

export function loadManifold() {
  wasmPromise ??= (async () => {
    const url = new URL('../../vendor/manifold/manifold.js', import.meta.url);
    const { default: Module } = await import(url.href);
    const wasm = await Module();
    wasm.setup();
    return wasm;
  })();
  return wasmPromise;
}

export class GeometryError extends Error {}

// A solid value of the language: an opaque handle owned by a kernel.
export class Solid {
  constructor(m) { this.m = m; }
}

export const DEFAULT_QUALITY = { minAngle: 6, minEdge: 0.5 };

export class Kernel {
  constructor(wasm, quality = DEFAULT_QUALITY) {
    this.w = wasm;
    this.arena = [];
    this.setQuality(quality);
  }

  setQuality({ minAngle = DEFAULT_QUALITY.minAngle, minEdge = DEFAULT_QUALITY.minEdge } = {}) {
    this.w.setMinCircularAngle(minAngle);
    this.w.setMinCircularEdgeLength(minEdge);
  }

  wrap(m) {
    this.arena.push(m);
    return new Solid(m);
  }

  guard(label, f) {
    try {
      return f();
    } catch (e) {
      if (e instanceof GeometryError) throw e;
      const code = e?.code ? ` (${e.code})` : '';
      throw new GeometryError(`${label}: falha no kernel geométrico${code}`);
    }
  }

  dispose() {
    for (const m of this.arena) {
      try { m.delete(); } catch { /* already freed */ }
    }
    this.arena = [];
  }

  // ---------- primitives (centred at the origin) ----------
  empty() { return this.wrap(this.w.Manifold.union([])); }

  box(x, y, z) { return this.wrap(this.w.Manifold.cube([x, y, z], true)); }

  sphere(r, n) { return this.wrap(this.w.Manifold.sphere(r, n ?? 0)); }

  // Frustum along z with bottom radius r1 and top radius r2 (either may be 0).
  cone(r1, r2, h, n) {
    const { Manifold } = this.w;
    if (r1 > 0) return this.wrap(Manifold.cylinder(h, r1, r2, n ?? 0, true));
    // manifold requires a positive bottom radius: build upside down and flip.
    const m = Manifold.cylinder(h, r2, 0, n ?? 0, true);
    this.arena.push(m);
    return this.wrap(m.rotate([180, 0, 0]));
  }

  torus(R, r, n, m) {
    const cs = this.w.CrossSection.circle(r, m ?? 0);
    const moved = cs.translate([R, 0]);
    const result = moved.revolve(n ?? 0);
    cs.delete();
    moved.delete();
    return this.wrap(result);
  }

  // points: [[x,y,z]…]; faces: index lists, counter-clockwise seen from outside.
  polyhedron(points, faces) {
    const vert = new Float32Array(points.length * 3);
    points.forEach((p, i) => vert.set(p, 3 * i));
    const tris = [];
    for (const f of faces) for (let k = 1; k + 1 < f.length; k++) tris.push(f[0], f[k], f[k + 1]);
    const mesh = new this.w.Mesh({ numProp: 3, vertProperties: vert, triVerts: new Uint32Array(tris) });
    mesh.merge();
    try {
      return this.wrap(new this.w.Manifold(mesh));
    } catch (e) {
      throw new GeometryError(`polyhedron: a malha não é um sólido fechado e orientado${e?.code ? ` (${e.code})` : ''}`);
    }
  }

  hull(solids, points = []) {
    return this.wrap(this.w.Manifold.hull([...solids.map((s) => s.m), ...points]));
  }

  // ---------- operations ----------
  transform(s, m) {
    return this.wrap(s.m.transform(toColumnMajor(m)));
  }
  union(a, b) { return this.guard('∪', () => this.wrap(a.m.add(b.m))); }
  subtract(a, b) { return this.guard('∖', () => this.wrap(a.m.subtract(b.m))); }
  intersect(a, b) { return this.guard('∩', () => this.wrap(a.m.intersect(b.m))); }
  symdiff(a, b) {
    return this.union(this.subtract(a, b), this.subtract(b, a));
  }
  unionAll(list) {
    if (!list.length) return this.empty();
    if (list.length === 1) return list[0];
    return this.guard('⋃', () => this.wrap(this.w.Manifold.union(list.map((s) => s.m))));
  }
  intersectAll(list) {
    if (list.length === 1) return list[0];
    return this.guard('⋂', () => this.wrap(this.w.Manifold.intersection(list.map((s) => s.m))));
  }
  minkowski(a, b) { return this.guard('⊕', () => this.wrap(a.m.minkowskiSum(b.m))); }

  // ---------- queries ----------
  isEmpty(s) { return s.m.isEmpty(); }
  volume(s) { return s.m.volume(); }
  area(s) { return s.m.surfaceArea(); }
  genus(s) { return s.m.genus(); }
  bbox(s) {
    const b = s.m.boundingBox();
    return { min: [...b.min], max: [...b.max] };
  }
  toMesh(s) {
    const g = s.m.getMesh();
    const np = g.numProp;
    let positions = g.vertProperties;
    if (np !== 3) {
      const n = positions.length / np;
      const out = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) out.set(positions.subarray(i * np, i * np + 3), 3 * i);
      positions = out;
    } else {
      positions = new Float32Array(positions);
    }
    return new Mesh(positions, new Uint32Array(g.triVerts));
  }
}
