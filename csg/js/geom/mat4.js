// 4x4 affine matrices, row-major: m[r*4 + c]. Points/vectors are [x, y, z].
// Used to represent isometries and scalings exactly before handing them to the kernel.

export const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function multiply(a, b) {
  const out = new Array(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[r * 4 + k] * b[k * 4 + c];
      out[r * 4 + c] = s;
    }
  }
  return out;
}

export const translation = (x, y, z) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1];

export const scaling = (x, y, z) => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];

// Exact values for multiples of 90° keep axis-aligned geometry exact.
export function cosSin(theta) {
  const q = theta / (Math.PI / 2);
  if (Math.abs(q - Math.round(q)) < 1e-12) {
    return [[1, 0], [0, 1], [-1, 0], [0, -1]][((Math.round(q) % 4) + 4) % 4];
  }
  return [Math.cos(theta), Math.sin(theta)];
}

export function rotationX(t) {
  const [c, s] = cosSin(t);
  return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1];
}
export function rotationY(t) {
  const [c, s] = cosSin(t);
  return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1];
}
export function rotationZ(t) {
  const [c, s] = cosSin(t);
  return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

const unit = ([x, y, z]) => {
  const l = Math.hypot(x, y, z);
  if (!(l > 0)) throw new RangeError('zero-length axis');
  return [x / l, y / l, z / l];
};

// Rodrigues rotation about an axis through the origin.
export function rotationAxis(axis, t) {
  const [x, y, z] = unit(axis);
  const [c, s] = cosSin(t);
  const k = 1 - c;
  return [
    c + x * x * k, x * y * k - z * s, x * z * k + y * s, 0,
    y * x * k + z * s, c + y * y * k, y * z * k - x * s, 0,
    z * x * k - y * s, z * y * k + x * s, c + z * z * k, 0,
    0, 0, 0, 1,
  ];
}

// Reflection across the plane through the origin with the given normal.
export function reflection(normal) {
  const [x, y, z] = unit(normal);
  return [
    1 - 2 * x * x, -2 * x * y, -2 * x * z, 0,
    -2 * y * x, 1 - 2 * y * y, -2 * y * z, 0,
    -2 * z * x, -2 * z * y, 1 - 2 * z * z, 0,
    0, 0, 0, 1,
  ];
}

// Conjugate m by a translation: the same motion about point p instead of the origin.
export function about(m, [px, py, pz]) {
  return multiply(translation(px, py, pz), multiply(m, translation(-px, -py, -pz)));
}

// Inverse of an affine map [A t]: [A⁻¹, -A⁻¹t]. Throws if A is singular.
export function invertAffine(m) {
  const d = determinant3(m);
  if (Math.abs(d) < 1e-14) throw new RangeError('transformação não invertível (determinante zero)');
  const [a, b, c, , e, f, g, , h, i, j] = m;
  const inv = [
    (f * j - g * i) / d, (c * i - b * j) / d, (b * g - c * f) / d,
    (g * h - e * j) / d, (a * j - c * h) / d, (c * e - a * g) / d,
    (e * i - f * h) / d, (b * h - a * i) / d, (a * f - b * e) / d,
  ];
  const t = [m[3], m[7], m[11]];
  const row = (r) => -(inv[3 * r] * t[0] + inv[3 * r + 1] * t[1] + inv[3 * r + 2] * t[2]);
  return [
    inv[0], inv[1], inv[2], row(0),
    inv[3], inv[4], inv[5], row(1),
    inv[6], inv[7], inv[8], row(2),
    0, 0, 0, 1,
  ];
}

// Is the linear part orthonormal (rotation or reflection), i.e. an isometry?
export function isRigid(m, eps = 1e-9) {
  for (let r = 0; r < 3; r++) {
    for (let s = 0; s < 3; s++) {
      const dot = m[r] * m[s] + m[4 + r] * m[4 + s] + m[8 + r] * m[8 + s];
      if (Math.abs(dot - (r === s ? 1 : 0)) > eps) return false;
    }
  }
  return true;
}

export function determinant3(m) {
  return (
    m[0] * (m[5] * m[10] - m[6] * m[9]) -
    m[1] * (m[4] * m[10] - m[6] * m[8]) +
    m[2] * (m[4] * m[9] - m[5] * m[8])
  );
}

export function transformPoint(m, [x, y, z]) {
  return [
    m[0] * x + m[1] * y + m[2] * z + m[3],
    m[4] * x + m[5] * y + m[6] * z + m[7],
    m[8] * x + m[9] * y + m[10] * z + m[11],
  ];
}

// Column-major 4x4, as expected by manifold-3d and WebGL.
export function toColumnMajor(m) {
  const out = new Array(16);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) out[c * 4 + r] = m[r * 4 + c];
  return out;
}
