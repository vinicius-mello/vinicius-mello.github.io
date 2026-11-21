// Runtime values of the language.
//   number · boolean · Array (lists, also used as vectors) · Range · Solid · Profile · Iso · functions
import { Solid, Profile } from '../geom/kernel.js';
import * as M from '../geom/mat4.js';

export const MAX_LIST = 1_000_000;

export class Range {
  constructor(lo, hi, step = 1, exclusive = false) {
    this.lo = lo;
    this.hi = hi;
    this.step = step;
    this.exclusive = exclusive;
  }
  get length() {
    const n = Math.floor((this.hi - this.lo) / this.step + 1e-9) + 1;
    let len = Math.max(0, n);
    if (this.exclusive && len > 0 && Math.abs(this.lo + (len - 1) * this.step - this.hi) < 1e-9 * Math.max(1, Math.abs(this.hi))) len--;
    return len;
  }
  at(i) { return this.lo + i * this.step; }
  *[Symbol.iterator]() {
    const n = this.length;
    for (let i = 0; i < n; i++) yield this.at(i);
  }
  includes(x) {
    if (typeof x !== 'number') return false;
    const k = (x - this.lo) / this.step;
    const i = Math.round(k);
    return Math.abs(k - i) < 1e-9 && i >= 0 && i < this.length;
  }
  toArray() { return [...this]; }
}

// Affine transformation (isometry, scaling or a composition), row-major 4x4 matrix.
// Named Iso because isometries are the common case; `kind()` tells them apart.
export class Iso {
  constructor(m, label = null) {
    this.m = m;
    this.label = label;
  }
  get rigid() { return (this._rigid ??= M.isRigid(this.m)); }
  kind() { return this.rigid ? 'isometria' : 'transformação afim'; }
}

export class Closure {
  constructor(name, params, body, env) {
    this.name = name;
    this.params = params; // [{ name, default: AST|null }]
    this.body = body;
    this.env = env;
  }
}

// params: [{ name, optional }]; fn(args, ctx, node) with args in parameter order.
// variadic builtins receive the positional argument list as-is.
export class Builtin {
  constructor(name, params, fn, { variadic = false, doc = '' } = {}) {
    this.name = name;
    this.params = params;
    this.fn = fn;
    this.variadic = variadic;
    this.doc = doc;
  }
}

export class Partial {
  constructor(fn, args) {
    this.fn = fn;
    this.args = args;
  }
}

export { Solid, Profile };

export const isFunction = (v) => v instanceof Closure || v instanceof Builtin || v instanceof Partial || v instanceof Iso;
export const isNumber = (v) => typeof v === 'number';
export const isList = Array.isArray;
export const isVector = (v) => Array.isArray(v) && v.length === 3 && v.every(isNumber);
export const isPoint2 = (v) => Array.isArray(v) && v.length === 2 && v.every(isNumber);

export function functionName(f) {
  if (f instanceof Partial) return functionName(f.fn);
  return f?.name ?? 'função anônima';
}

export function typeName(v) {
  if (typeof v === 'number') return 'número';
  if (typeof v === 'boolean') return 'booleano';
  if (Array.isArray(v)) return isVector(v) ? 'vetor' : 'lista';
  if (v instanceof Range) return 'intervalo';
  if (v instanceof Solid) return 'sólido';
  if (v instanceof Profile) return 'perfil';
  if (v instanceof Iso) return v.kind();
  if (v instanceof Partial) {
    const missing = v.fn.params?.slice(v.args.length).filter((p) => !p.optional && !p.default).map((p) => p.name) ?? [];
    return `função (aplicação parcial de ${functionName(v.fn)}${missing.length ? `, faltando ${missing.join(', ')}` : ''})`;
  }
  if (isFunction(v)) return 'função';
  return typeof v;
}

export function formatNumber(x) {
  if (Number.isInteger(x)) return String(x);
  if (!Number.isFinite(x)) return x > 0 ? '∞' : x < 0 ? '-∞' : 'NaN';
  return String(Number(x.toPrecision(6)));
}

export function format(v, depth = 0) {
  if (typeof v === 'number') return formatNumber(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) {
    if (depth > 2) return '[…]';
    const items = v.slice(0, 20).map((x) => format(x, depth + 1));
    if (v.length > 20) items.push(`… (${v.length} itens)`);
    return `[${items.join(', ')}]`;
  }
  if (v instanceof Range) return `${formatNumber(v.lo)}..${v.exclusive ? '<' : ''}${formatNumber(v.hi)}`;
  if (v instanceof Solid) return 'sólido';
  if (v instanceof Profile) return `perfil (área ${formatNumber(v.cs.area())} mm²)`;
  if (v instanceof Iso) return v.label ?? v.kind();
  if (isFunction(v)) return `função ${functionName(v)}`;
  return String(v);
}

export function deepEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  if (a instanceof Range && b instanceof Range) return deepEqual(a.toArray(), b.toArray());
  if (a instanceof Iso && b instanceof Iso) return a.m.every((x, i) => Math.abs(x - b.m[i]) < 1e-12);
  return false;
}
