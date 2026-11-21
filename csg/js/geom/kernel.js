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

// A profile: a region of the plane z = 0 (manifold CrossSection), also owned by a kernel.
export class Profile {
  constructor(cs) { this.cs = cs; }
}

// Row-major 4x4 affine matrix → column-major 3x3 for the plane, or null when the map
// takes the plane z = 0 out of itself.
export function planarMatrix(m, eps = 1e-9) {
  if (Math.abs(m[8]) > eps || Math.abs(m[9]) > eps || Math.abs(m[11]) > eps) return null;
  return [m[0], m[4], 0, m[1], m[5], 0, m[3], m[7], 1];
}

export const PLATE = 0.4; // thickness (mm) of the plate that shows a profile in the viewer

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

  wrap2(cs) {
    this.arena.push(cs);
    return new Profile(cs);
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

  // ---------- profiles (regions of the plane z = 0) ----------
  // contours: [[[x, y]…]…]; one contour ignores orientation, several use even–odd (holes).
  polygon(contours) {
    return this.guard('polygon', () => this.wrap2(new this.w.CrossSection(contours, contours.length > 1 ? 'EvenOdd' : 'NonZero')));
  }
  circle(r, n) { return this.wrap2(this.w.CrossSection.circle(r, n ?? 0)); }
  square(x, y) { return this.wrap2(this.w.CrossSection.square([x, y], true)); }
  transform2(p, m3) { return this.wrap2(p.cs.transform(m3)); }
  union2(a, b) { return this.guard('∪', () => this.wrap2(a.cs.add(b.cs))); }
  subtract2(a, b) { return this.guard('∖', () => this.wrap2(a.cs.subtract(b.cs))); }
  intersect2(a, b) { return this.guard('∩', () => this.wrap2(a.cs.intersect(b.cs))); }
  symdiff2(a, b) { return this.union2(this.subtract2(a, b), this.subtract2(b, a)); }
  unionAll2(list) {
    if (list.length === 1) return list[0];
    return this.guard('⋃', () => this.wrap2(this.w.CrossSection.union(list.map((p) => p.cs))));
  }
  intersectAll2(list) {
    if (list.length === 1) return list[0];
    return this.guard('⋂', () => this.wrap2(this.w.CrossSection.intersection(list.map((p) => p.cs))));
  }
  hull2(profiles, points = []) {
    const parts = profiles.map((p) => p.cs);
    if (points.length) parts.push([points]);
    return this.guard('hull', () => this.wrap2(this.w.CrossSection.hull(parts)));
  }
  offset(p, d, n) { return this.guard('offset', () => this.wrap2(p.cs.offset(d, 'Round', 2, n ?? 0))); }
  // Prism from z = 0 to z = h; twist in degrees; scaleTop a number or [sx, sy].
  // A twist turns straight edges into curves: they are first subdivided (≤ 1 mm) so the
  // twisted sides follow the true surface instead of long flat triangles.
  extrude(p, h, twist = 0, scaleTop = 1) {
    // the JS binding misreads a numeric scaleTop (as [k, 0]): always pass a vector
    if (typeof scaleTop === 'number') scaleTop = [scaleTop, scaleTop];
    if (!twist) return this.guard('extrude', () => this.wrap(p.cs.extrude(h, 0, 0, scaleTop, false)));
    const divisions = Math.max(1, Math.ceil(Math.abs(twist) / 2));
    return this.guard('extrude', () => {
      const fine = this.refine(p.cs, 1);
      this.arena.push(fine);
      return this.wrap(fine.extrude(h, divisions, twist, scaleTop, false));
    });
  }
  refine(cs, maxEdge) {
    const contours = cs.toPolygons().map((c) => c.flatMap((a, i) => {
      const b = c[(i + 1) % c.length];
      const m = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / maxEdge));
      return Array.from({ length: m }, (_, j) => [a[0] + ((b[0] - a[0]) * j) / m, a[1] + ((b[1] - a[1]) * j) / m]);
    }));
    return new this.w.CrossSection(contours, 'Positive');
  }
  // Around the profile's y axis, which becomes z; the part with x < 0 is dropped.
  revolve(p, degrees = 360, n) { return this.guard('revolve', () => this.wrap(p.cs.revolve(n ?? 0, degrees))); }
  plate(p) { return this.wrap(p.cs.extrude(PLATE, 0, 0, [1, 1], false)); }
  area2(p) { return p.cs.area(); }
  isEmpty2(p) { return p.cs.isEmpty(); }
  bbox2(p) {
    const b = p.cs.bounds();
    return { min: [...b.min], max: [...b.max] };
  }

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
