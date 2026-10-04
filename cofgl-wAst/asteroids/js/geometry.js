// Geodesic motion and distances on the three closed surfaces, all in the
// disk model with metric ds^2 = 4|dz|^2/(1+K|z|^2)^2 (see details.html).
import { Complex } from './complex.js';

// Inversion in the circle |z - c0| = k, with its derivative D(c, v).
class Inversion {
  constructor(c0, k) {
    this.c0 = c0;
    this.k = k;
  }

  F(c) {
    const dx = c.x - this.c0.x;
    const dy = c.y - this.c0.y;
    const l = dx * dx + dy * dy;
    return new Complex(this.c0.x + this.k * this.k * dx / l, this.c0.y + this.k * this.k * dy / l);
  }

  D(c, v) {
    const dx = c.x - this.c0.x;
    const dy = c.y - this.c0.y;
    const l = dx * dx + dy * dy;
    const f = this.k * this.k / (l * l);
    const m11 = l - 2 * dx * dx;
    const m12 = -2 * dx * dy;
    return new Complex(f * (m11 * v.x + m12 * v.y), f * (m12 * v.x - m11 * v.y));
  }
}

// Reflection across the line through the origin with direction l.
class ReflectionOrigin {
  constructor(l) {
    this.l = l;
  }

  F(c) {
    const { l } = this;
    const f = 2 * (c.x * l.x + c.y * l.y) / (l.x * l.x + l.y * l.y);
    return new Complex(f * l.x - c.x, f * l.y - c.y);
  }

  D(c, v) {
    const lx2 = this.l.x * this.l.x;
    const ly2 = this.l.y * this.l.y;
    const m11 = 2 * lx2 / (lx2 + ly2) - 1;
    const m12 = 2 * this.l.x * this.l.y / (lx2 + ly2);
    return new Complex(m11 * v.x + m12 * v.y, m12 * v.x - m11 * v.y);
  }
}

// Regular octagon with angles pi/4 in the Poincare disk: side k is the arc of
// the circle of radius R centered at C e^{ik pi/4} (orthogonal to |z| = 1).
const sqr4 = Math.sqrt(Math.SQRT2);
const l = (sqr4 + 1 / sqr4) / 2;
export const C = l / Math.cos(Math.PI / 8);
export const R = C * Math.tan(Math.PI / 8);

const octagon = Array.from({ length: 8 }, (_, k) => Complex.polar(C, k * Math.PI / 4));
const octagonReflection = [
  [0, 1], [-1, 1], [1, 0], [1, 1], [0, 1], [-1, 1], [1, 0], [1, 1],
].map(([x, y]) => new ReflectionOrigin(new Complex(x, y)));
// side k is glued to side k+4
const octagonGluing = [4, 5, 6, 7, 0, 1, 2, 3];
const octagonInversion = octagonGluing.map((j) => new Inversion(octagon[j], R));

// Solves  a = b x - c (x^2 + y^2),  d = b y - f (x^2 + y^2)  for (x, y),
// the discrete Euler-Lagrange equation of the variational integrator.
function solveSystem(a, b, c, d, f) {
  const b2 = b * b;
  const g = a * f - c * d;
  const h = a * c + d * f;
  const den = 2 * b2 * (c * c + f * f);
  const sqdelta = Math.sqrt(b2 * (b2 * b2 - 4 * g * g - 4 * b2 * h));
  const p1 = b2 * b * c + 2 * b * f * g;
  const p2 = b2 * b * f - 2 * b * c * g;
  if (c !== 0) return [(p1 - c * sqdelta) / den, (p2 - f * sqdelta) / den];
  if (f === 0) return [a / b, d / b];
  return [a / b, (p2 - f * sqdelta) / den];
}

// One step of the variational integrator for curvature k = +-1. The heading
// dir is parallel transported: along a geodesic it keeps its angle with the
// velocity, and the model is conformal, so it turns with p.
function curvedStep(q, p, dir, h, k) {
  const D = 1 + k * (q.x * q.x + q.y * q.y);
  const D2h = D * D * h;
  const [dqx, dqy] = solveSystem(D * D2h * p.x, 8 * D, -16 * k * q.x, D * D2h * p.y, -16 * k * q.y);
  const p0 = new Complex(p.x, p.y);
  q.x += dqx;
  q.y += dqy;
  p.x = 8 * dqx / D2h;
  p.y = 8 * dqy / D2h;
  const turn = p.times(p0.conjugate());
  if (turn.magnitude > 0) {
    turn.normalize();
    return dir.times(turn);
  }
  return dir;
}

// Each step takes and returns [q, p, dir, inv]; inv is -1 while the object is
// mirrored (only possible on the non-orientable projective plane).

function torusStep(q, p, dir, h, inv) {
  q.x += h * p.x / 2;
  q.y += h * p.y / 2;
  if (q.x > 1) q.x -= 2;
  if (q.x < -1) q.x += 2;
  if (q.y > 1) q.y -= 2;
  if (q.y < -1) q.y += 2;
  return [q, p, dir, inv];
}

function projectiveStep(q, p, dir, h, inv) {
  dir = curvedStep(q, p, dir, h, 1);
  const n = q.x * q.x + q.y * q.y;
  if (n > 1) {
    // crossed the boundary: jump to the antipode, z -> -z/|z|^2
    const n2 = n * n;
    const a = (q.x * q.x - q.y * q.y) / n2;
    const b = 2 * q.x * q.y / n2;
    p = new Complex(p.x * a + p.y * b, p.x * b - p.y * a);
    dir = new Complex(dir.x * a + dir.y * b, dir.x * b - dir.y * a);
    q = new Complex(-q.x / n2, -q.y / n2);
    inv = -inv;
  }
  return [q, p, dir, inv];
}

function bitorusStep(q, p, dir, h, inv) {
  dir = curvedStep(q, p, dir, h, -1);
  for (let i = 0; i < 8; i++) {
    if (Math.hypot(q.x - octagon[i].x, q.y - octagon[i].y) < R) {
      // crossed side i: glue to side i+4
      const refl = octagonReflection[i];
      p = refl.D(q, p);
      dir = refl.D(q, dir);
      q = refl.F(q);
      const inversion = octagonInversion[i];
      p = inversion.D(q, p);
      dir = inversion.D(q, dir);
      q = inversion.F(q);
      break;
    }
  }
  return [q, p, dir, inv];
}

// d(z1,z2) = 2 arctan_k |(z1-z2)/(1+k z1 conj(z2))|
function diskDistance(z1, z2, k) {
  const den = new Complex(1 + k * (z1.x * z2.x + z1.y * z2.y), k * (z1.y * z2.x - z1.x * z2.y));
  const r = Math.sqrt(z1.minus(z2).divide(den).magnitude);
  if (k === -1) return 2 * Math.atanh(Math.min(r, 1 - 1e-12));
  if (k === 0) return 2 * r;
  return 2 * Math.atan(r);
}

// The points glued to z that are near the fundamental domain (z included).
// Distances and aiming use them, otherwise objects across an edge from each
// other would not see each other.
function torusCopies(z) {
  const copies = [];
  for (const ox of [-2, 0, 2]) {
    for (const oy of [-2, 0, 2]) copies.push(new Complex(z.x + ox, z.y + oy));
  }
  return copies;
}

// projective plane = sphere / antipodal map, z ~ -1/conj(z)
function projectiveCopies(z) {
  const n = z.magnitude;
  return n > 1e-12 ? [z, new Complex(-z.x / n, -z.y / n)] : [z];
}

function bitorusCopies(z) {
  return [z, ...octagonReflection.map((refl, i) => octagonInversion[i].F(refl.F(z)))];
}

function makeGeometry(name, k, step, copies, bulletSpeed, spawnRadius) {
  // the copy of `to` nearest to `from`, and its distance
  const nearest = (from, to) => {
    let best = null;
    let d = Infinity;
    for (const c of copies(to)) {
      const dc = diskDistance(from, c, k);
      if (dc < d) {
        d = dc;
        best = c;
      }
    }
    return [best, d];
  };
  return {
    name,
    k,
    step,
    bulletSpeed,
    spawnRadius,   // random spawns stay this close to the center
    distance: (z1, z2) => nearest(z1, z2)[1],
    // Unit vector at `from` along the shortest geodesic to `to`: the
    // isometry T(z) = (z - from)/(1 + k conj(from) z) takes `from` to 0, where
    // geodesics are straight, and its derivative there is a positive real.
    directionTo(from, to) {
      const [target] = nearest(from, to);
      const t = target.minus(from).divide(new Complex(1, 0).plus(from.conjugate().times(target).scale(k)));
      if (!(t.magnitude > 0)) return new Complex(1, 0);
      t.normalize();
      return t;
    },
  };
}

export const geometries = {
  euclidean: makeGeometry('euclidean', 0, torusStep, torusCopies, 4, 0.95),
  elliptic: makeGeometry('elliptic', 1, projectiveStep, projectiveCopies, 15, 0.9),
  hyperbolic: makeGeometry('hyperbolic', -1, bitorusStep, bitorusCopies, 20, 0.6),
};
