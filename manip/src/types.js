// Tipos dos objetos e o ambiente das hipóteses.
//
// Uma letra é escalar, a menos que uma hipótese (A ∈ M(2, 3), v ∈ ℝ³) ou a
// definição (A := [1, 2; 3, 4]) diga outra coisa. kindOf dá o tipo de uma
// expressão: { t: 'scalar' }, { t: 'matrix', r, c }, { t: 'vector', n } ou
// { t: 'error', key } (dimensões incompatíveis, divisão por matriz…).
//
// O ambiente é global (setEnvironment), porque a forma normal e os
// movimentos não recebem o contexto das regras; o app o atualiza a cada
// passo e os testes usam withEnvironment.

import { isGrid, gridSize, walk, children } from './ast.js';
import { evaluate } from './rules/arith.js';
import { isRelation } from './relations.js';
import { hypothesisText } from './hypotheses.js';
import { parseInput } from './input.js';

let env = { hyps: [], defs: {} };
let signature = '';
const listeners = [];
export const onEnvironmentChange = (f) => listeners.push(f);

export function setEnvironment({ hyps = [], defs = {} } = {}) {
  const sig = JSON.stringify(hyps) + JSON.stringify(Object.keys(defs).map((k) => [k, defs[k]?.id]));
  env = { hyps, defs };
  if (sig !== signature) {
    signature = sig;
    listeners.forEach((f) => f());
  }
}

export function withEnvironment(e, f) {
  const old = env;
  setEnvironment(e);
  try {
    return f();
  } finally {
    setEnvironment(old);
  }
}

const hypsOf = (name) => env.hyps.filter((h) => h.name === name);

// ------------------------------------------------------------------ tipos

const SCALAR = { t: 'scalar' };
const err = (key) => ({ t: 'error', key });
const isNumeric = (d) => /^\d+$/.test(d);
// Dimensões compatíveis: iguais, ou uma delas é uma letra (n pode ser 3).
const sameDim = (a, b) => a === b || !isNumeric(a) || !isNumeric(b);
const pick = (a, b) => (isNumeric(a) ? a : b);

export const isError = (k) => k.t === 'error';
const sameKind = (a, b) => a.t === b.t && (a.t === 'scalar'
  || (a.t === 'matrix' && sameDim(a.r, b.r) && sameDim(a.c, b.c))
  || (a.t === 'vector' && sameDim(a.n, b.n)));

function mulKind(a, b) {
  if (isError(a)) return a;
  if (isError(b)) return b;
  if (a.t === 'scalar') return b;
  if (b.t === 'scalar') return a;
  if (a.id) return b;
  if (b.id) return a;
  // vetor · vetor: produto escalar
  if (a.t === 'vector' && b.t === 'vector') return sameDim(a.n, b.n) ? SCALAR : err('err.dims');
  // o vetor é uma coluna n×1
  const A = a.t === 'vector' ? { r: a.n, c: '1' } : a;
  const B = b.t === 'vector' ? { r: b.n, c: '1' } : b;
  if (!sameDim(A.c, B.r)) return err('err.dims');
  if (b.t === 'vector' && a.t === 'matrix') return { t: 'vector', n: A.r };
  return { t: 'matrix', r: A.r, c: B.c };
}

const visiting = new Set();

export function kindOf(n) {
  switch (n.op) {
    case 'Number': return SCALAR;
    case 'Symbol': {
      // I (a identidade, vinda de A·A⁻¹): quadrada, do tamanho que precisar.
      if (n.name === 'IdentityMatrix') return { t: 'matrix', r: 'n', c: 'n', id: true };
      const h = hypsOf(n.name).find((x) => x.kind === 'matrix' || x.kind === 'vector');
      if (h) return h.kind === 'matrix' ? { t: 'matrix', r: h.rows, c: h.cols } : { t: 'vector', n: h.dim };
      // v⃗ sem hipótese: vetor (i⃗, j⃗, k⃗ são do ℝ³)
      if (n.vec) return { t: 'vector', n: ['i', 'j', 'k'].includes(n.name) ? '3' : 'n' };
      const d = env.defs[n.name];
      if (d && !visiting.has(n.name)) {
        visiting.add(n.name);
        try {
          return kindOf(d);
        } finally {
          visiting.delete(n.name);
        }
      }
      return SCALAR;
    }
    case 'Matrix': case 'Determinant': {
      if (!isGrid(n)) {
        // det A: A quadrada (ou um número)
        const k = kindOf(n.args[0]);
        if (isError(k)) return k;
        if (k.t === 'matrix' && !sameDim(k.r, k.c)) return err('err.detSquare');
        return k.t === 'vector' ? err('err.detSquare') : SCALAR;
      }
      // O determinante formal |i⃗, j⃗, k⃗; u; v| tem vetores na primeira linha.
      let formal = false;
      for (const [ri, r] of n.args.entries()) {
        for (const e of r.args) {
          const k = kindOf(e);
          if (isError(k)) return k;
          if (k.t === 'vector' && ri === 0 && n.op === 'Determinant') formal = true;
          else if (k.t !== 'scalar') return err('err.entryScalar');
        }
      }
      const [rows, cols] = gridSize(n);
      if (n.op === 'Determinant') return rows !== cols ? err('err.detSquare') : formal ? { t: 'vector', n: '3' } : SCALAR;
      return { t: 'matrix', r: String(rows), c: String(cols) };
    }
    case 'Delimiter': case 'Negate': case 'PlusMinus': return kindOf(n.args[0]);
    case 'Tuple': {
      for (const e of n.args) {
        const k = kindOf(e);
        if (isError(k)) return k;
        if (k.t !== 'scalar') return err('err.entryScalar');
      }
      return { t: 'vector', n: String(n.args.length) };
    }
    case 'Cross': {
      const [a, b] = n.args.map(kindOf);
      if (isError(a)) return a;
      if (isError(b)) return b;
      const ok = (k) => k.t === 'vector' && sameDim(k.n, '3');
      return ok(a) && ok(b) ? { t: 'vector', n: '3' } : err('err.cross');
    }
    case 'Add': {
      const ks = n.args.map(kindOf);
      const bad = ks.find(isError);
      if (bad) return bad;
      return ks.every((k) => sameKind(k, ks[0])) ? ks[0] : err('err.dims');
    }
    case 'Multiply': return n.args.map(kindOf).reduce(mulKind);
    case 'Divide': {
      const [a, b] = n.args.map(kindOf);
      if (isError(a)) return a;
      if (isError(b)) return b;
      return b.t === 'scalar' ? a : err('err.matrixDivide');
    }
    case 'Power': {
      // Aᵀ (escrito A^T)
      if (n.args[1].op === 'Symbol' && n.args[1].name === 'T') {
        const a = kindOf(n.args[0]);
        if (a.t === 'matrix') return { t: 'matrix', r: a.c, c: a.r };
        if (a.t === 'vector') return { t: 'matrix', r: '1', c: a.n };
        if (a.t !== 'scalar') return a;
      }
      const [a, b] = n.args.map(kindOf);
      if (isError(a)) return a;
      if (isError(b)) return b;
      if (b.t !== 'scalar') return err('err.dims');
      if (a.t === 'scalar') return a;
      if (a.t === 'matrix' && sameDim(a.r, a.c)) return a;
      return err('err.dims');
    }
    default: {
      // Relações e sistemas: os dois lados do mesmo tipo.
      if (isRelation(n.op)) {
        const [a, b] = n.args.map(kindOf);
        if (isError(a)) return a;
        if (isError(b)) return b;
        const zero = (x) => x.op === 'Number' && x.value === '0';
        if (!sameKind(a, b) && !zero(n.args[0]) && !zero(n.args[1])) return err('err.dims');
        return SCALAR;
      }
      // Funções e o resto: só olham se há erro dentro.
      for (const c of children(n)) {
        const k = kindOf(c);
        if (isError(k)) return k;
      }
      return SCALAR;
    }
  }
}

export const isScalar = (n) => kindOf(n).t === 'scalar';
// Dois fatores comutam se um deles é escalar (ou se são dois vetores: u·v = v·u).
export function commute(a, b) {
  const [x, y] = [kindOf(a), kindOf(b)];
  return x.t === 'scalar' || y.t === 'scalar' || (x.t === 'vector' && y.t === 'vector');
}

// Algum objeto não escalar na árvore (letra tipada ou matriz escrita)?
export function hasNonScalar(tree) {
  let found = false;
  walk(tree, (n) => {
    if (found) return;
    if (n.op === 'Matrix' && isGrid(n)) found = true;
    else if (n.op === 'Symbol' && kindOf(n).t !== 'scalar') found = true;
  });
  return found;
}

// --------------------------------------------------------------- sinais

const signOfRat = (v) => (v.n > 0n ? 1 : v.n < 0n ? -1 : 0);

// Sinal de x pelas hipóteses: x > 0 → +1, x < 0 → −1. `used` recebe o
// texto da hipótese usada (para o rótulo do passo).
function symbolSign(name, used) {
  for (const h of hypsOf(name)) {
    if (h.kind !== 'rel') continue;
    const b = evaluateText(h.bound);
    if (!b) continue;
    const s = signOfRat(b);
    let r = null;
    if (h.rel === 'Greater' && s >= 0) r = 1;
    else if (h.rel === 'GreaterEqual' && s > 0) r = 1;
    else if (h.rel === 'Less' && s <= 0) r = -1;
    else if (h.rel === 'LessEqual' && s < 0) r = -1;
    if (r !== null) {
      used?.push(hypothesisText(h));
      return r;
    }
  }
  return null;
}

function evaluateText(t) {
  try {
    return evaluate(parseInput(t));
  } catch {
    return null;
  }
}

// Sinal de uma expressão escalar: 1, −1, 0 ou null (desconhecido).
export function signOf(n, used = []) {
  const v = evaluate(n);
  if (v) return signOfRat(v);
  switch (n.op) {
    case 'Symbol': return symbolSign(n.name, used);
    case 'Delimiter': return signOf(n.args[0], used);
    case 'Negate': {
      const s = signOf(n.args[0], used);
      return s === null ? null : -s;
    }
    case 'Multiply': case 'Divide': {
      let acc = 1;
      for (const c of n.args) {
        const s = signOf(c, used);
        if (s === null) return null;
        acc *= s;
      }
      return n.op === 'Divide' && signOf(n.args[1], []) === 0 ? null : acc;
    }
    case 'Add': {
      const ss = n.args.map((c) => signOf(c, used));
      if (ss.every((s) => s === 1 || s === 0) && ss.includes(1)) return 1;
      if (ss.every((s) => s === -1 || s === 0) && ss.includes(-1)) return -1;
      return null;
    }
    case 'Power': {
      const [b, e] = n.args;
      if (b.op === 'Symbol' && b.name === 'e') return 1;
      const ev = evaluate(e);
      const sb = signOf(b, used);
      if (sb === 1) return 1;
      if (ev && ev.d === 1n && ev.n % 2n === 0n && sb === -1) return 1;
      if (ev && ev.d === 1n && sb === -1) return -1;
      return null;
    }
    case 'Sqrt': return signOf(n.args[0], used) === 1 ? 1 : null;
    case 'Exp': return 1;
    default: return null;
  }
}

// x ≥ 0 pelas hipóteses (x > 0, x ≥ 0, x ∈ ℕ) ou pelo sinal.
export function nonNegative(n, used = []) {
  if (n.op === 'Symbol') {
    for (const h of hypsOf(n.name)) {
      const b = h.kind === 'rel' ? evaluateText(h.bound) : null;
      if ((h.kind === 'set' && h.set === 'N') || (b && (h.rel === 'Greater' || h.rel === 'GreaterEqual') && signOfRat(b) >= 0)) {
        used.push(hypothesisText(h));
        return true;
      }
    }
  }
  const s = signOf(n, used);
  return s === 1 || s === 0;
}

// --------------------------------------- conferência numérica (AB ≠ BA)
//
// Uma regra que só conhece números pode trocar a ordem de matrizes. Antes
// de aceitar um passo que envolve matrizes, o trecho que mudou é calculado
// com matrizes sorteadas, antes e depois; se der diferente, o passo é
// recusado.

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

// v⃗ e v são letras diferentes.
const symKey = (n) => (n.vec ? '→' : '') + n.name;
const dimValue = (d) => (isNumeric(d) ? Number(d) : 3);

function sample(tree, seed) {
  const rand = rng(seed);
  const vals = {};
  walk(tree, (n) => {
    if (n.op !== 'Symbol' || symKey(n) in vals || n.name === 'IdentityMatrix') return;
    // i⃗, j⃗, k⃗: a base canônica
    const basis = n.vec && !hypsOf(n.name).length ? ['i', 'j', 'k'].indexOf(n.name) : -1;
    if (basis >= 0) {
      vals[symKey(n)] = { m: [0, 1, 2].map((r) => [r === basis ? 1 : 0]), vec: true };
      return;
    }
    const k = kindOf(n);
    const r = () => Math.round((rand() * 4 - 2) * 100) / 100 + 0.37;
    if (k.t === 'matrix') vals[symKey(n)] = { m: Array.from({ length: dimValue(k.r) }, () => Array.from({ length: dimValue(k.c) }, r)) };
    else if (k.t === 'vector') vals[symKey(n)] = { m: Array.from({ length: dimValue(k.n) }, () => [r()]), vec: true };
    else {
      const s = signOf(n);
      vals[symKey(n)] = s === -1 ? -(0.5 + rand()) : 0.5 + rand();
    }
  });
  return vals;
}

const isM = (x) => typeof x === 'object' && x !== null;
const shape = (x) => [x.m.length, x.m[0].length];
const mapM = (x, f) => ({ m: x.m.map((r) => r.map(f)) });

function addV(a, b) {
  if (!isM(a) && !isM(b)) return a + b;
  if (!isM(a) || !isM(b)) return null;
  const [p, q] = shape(a);
  const [r, s] = shape(b);
  if (p !== r || q !== s) return null;
  return { m: a.m.map((row, i) => row.map((v, j) => v + b.m[i][j])), vec: a.vec };
}

function mulV(a, b) {
  if (!isM(a) && !isM(b)) return a * b;
  if (!isM(a)) return { ...mapM(b, (v) => a * v), vec: b.vec };
  if (!isM(b)) return { ...mapM(a, (v) => v * b), vec: a.vec };
  if (a.vec && b.vec) return a.m.reduce((acc, [v], i) => acc + v * b.m[i][0], 0);
  const [p, q] = shape(a);
  const [r, s] = shape(b);
  if (q !== r) return null;
  const m = Array.from({ length: p }, (_, i) => Array.from({ length: s }, (_, j) => a.m[i].reduce((acc, v, k) => acc + v * b.m[k][j], 0)));
  return { m, vec: b.vec && s === 1 };
}

function detV(m) {
  const n = m.length;
  if (m.some((r) => r.length !== n)) return null;
  const a = m.map((r) => r.slice());
  let d = 1;
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(a[k][i]) > Math.abs(a[p][i])) p = k;
    if (Math.abs(a[p][i]) < 1e-12) return 0;
    if (p !== i) { [a[p], a[i]] = [a[i], a[p]]; d = -d; }
    d *= a[i][i];
    for (let k = i + 1; k < n; k++) {
      const f = a[k][i] / a[i][i];
      for (let j = i; j < n; j++) a[k][j] -= f * a[i][j];
    }
  }
  return d;
}

function inverseV(x) {
  const n = x.m.length;
  const a = x.m.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(a[k][i]) > Math.abs(a[p][i])) p = k;
    if (Math.abs(a[p][i]) < 1e-12) return null;
    [a[p], a[i]] = [a[i], a[p]];
    const f = a[i][i];
    for (let j = 0; j < 2 * n; j++) a[i][j] /= f;
    for (let k = 0; k < n; k++) {
      if (k === i) continue;
      const g = a[k][i];
      for (let j = 0; j < 2 * n; j++) a[k][j] -= g * a[i][j];
    }
  }
  return { m: a.map((r) => r.slice(n)) };
}

const SCALAR_FUNCS = { Sqrt: Math.sqrt, Sin: Math.sin, Cos: Math.cos, Tan: Math.tan, Exp: Math.exp, Ln: Math.log, Abs: Math.abs };

// Valor numérico (número ou { m }), ou null quando não dá para calcular.
export function numericValue(n, vals) {
  const ev = (x) => numericValue(x, vals);
  switch (n.op) {
    case 'Number': return Number(n.value);
    case 'Symbol':
      if (symKey(n) in vals) return vals[symKey(n)];
      if (n.name === 'pi') return Math.PI;
      if (n.name === 'e') return Math.E;
      return null;
    case 'Delimiter': return ev(n.args[0]);
    case 'Negate': {
      const a = ev(n.args[0]);
      return a === null ? null : mulV(-1, a);
    }
    case 'Tuple': {
      const xs = n.args.map(ev);
      return xs.some((x) => x === null || isM(x)) ? null : { m: xs.map((x) => [x]), vec: true };
    }
    case 'Cross': {
      const [a, b] = n.args.map(ev);
      if (!isM(a) || !isM(b) || a.m.length !== 3 || b.m.length !== 3) return null;
      const [[u1], [u2], [u3]] = a.m;
      const [[v1], [v2], [v3]] = b.m;
      return { m: [[u2 * v3 - u3 * v2], [u3 * v1 - u1 * v3], [u1 * v2 - u2 * v1]], vec: true };
    }
    case 'Abs': {
      const a = ev(n.args[0]);
      if (a === null) return null;
      return isM(a) ? Math.sqrt(a.m.flat().reduce((s, x) => s + x * x, 0)) : Math.abs(a);
    }
    case 'Add': case 'Multiply': {
      let acc = ev(n.args[0]);
      for (const c of n.args.slice(1)) {
        const v = ev(c);
        if (acc === null || v === null) return null;
        acc = n.op === 'Add' ? addV(acc, v) : mulV(acc, v);
      }
      return acc;
    }
    case 'Divide': {
      const a = ev(n.args[0]);
      const b = ev(n.args[1]);
      return a === null || b === null || isM(b) || b === 0 ? null : mulV(a, 1 / b);
    }
    case 'Power': {
      if (n.args[1].op === 'Symbol' && n.args[1].name === 'T') {
        const a = ev(n.args[0]);
        return isM(a) ? { m: a.m[0].map((_, j) => a.m.map((r) => r[j])) } : a;
      }
      const a = ev(n.args[0]);
      const b = ev(n.args[1]);
      if (a === null || b === null || isM(b)) return null;
      if (!isM(a)) return a ** b;
      if (!Number.isInteger(b) || Math.abs(b) > 20) return null;
      let base = b < 0 ? inverseV(a) : a;
      if (!base) return null;
      let acc = { m: base.m.map((r, i) => r.map((_, j) => (i === j ? 1 : 0))) };
      for (let k = 0; k < Math.abs(b); k++) acc = mulV(acc, base);
      return acc;
    }
    case 'Matrix': case 'Determinant': {
      if (!isGrid(n)) {
        const a = ev(n.args[0]);
        if (a === null) return null;
        return isM(a) ? detV(a.m) : a;
      }
      const m = n.args.map((r) => r.args.map(ev));
      if (m.some((r) => r.some((v) => v === null || isM(v)))) return null;
      return n.op === 'Matrix' ? { m } : detV(m);
    }
    default: {
      const f = SCALAR_FUNCS[n.op];
      if (!f || n.args.length !== 1) return null;
      const a = ev(n.args[0]);
      return a === null || isM(a) ? null : f(a);
    }
  }
}

function close(a, b) {
  if (isM(a) !== isM(b)) return false;
  const near = (x, y) => Math.abs(x - y) <= 1e-6 * Math.max(1, Math.abs(x), Math.abs(y));
  if (!isM(a)) return near(a, b);
  const [p, q] = shape(a);
  const [r, s] = shape(b);
  return p === r && q === s && a.m.every((row, i) => row.every((v, j) => near(v, b.m[i][j])));
}

// O trecho que mudou entre duas árvores: desce enquanto só um filho difere.
function changed(a, b) {
  for (;;) {
    if (a.op !== b.op || (a.args?.length ?? 0) !== (b.args?.length ?? 0) || !a.args) return [a, b];
    const diff = a.args.map((c, i) => i).filter((i) => !sameTree(a.args[i], b.args[i]));
    if (diff.length !== 1) return diff.length ? [a, b] : null;
    [a, b] = [a.args[diff[0]], b.args[diff[0]]];
  }
}

function sameTree(a, b) {
  if (a === b) return true;
  if (a.op !== b.op || a.name !== b.name || a.value !== b.value) return false;
  const x = a.args ?? [], y = b.args ?? [];
  return x.length === y.length && x.every((c, i) => sameTree(c, y[i]));
}

// Erro (chave de i18n) se o passo antes → depois troca a ordem de matrizes
// ou cria dimensões incompatíveis; null se está tudo bem.
export function checkStep(before, after) {
  if (!hasNonScalar(before) && !hasNonScalar(after)) return null;
  const kb = kindOf(before);
  const ka = kindOf(after);
  if (isError(ka) && !isError(kb)) return ka.key;
  const region = changed(before, after);
  if (!region) return null;
  const [x, y] = region;
  if (isRelation(x.op) || isRelation(y.op) || x.op === 'System' || x.op === 'Row' || y.op === 'Row') return null;
  if (!hasNonScalar(x) && !hasNonScalar(y)) return null;
  for (const seed of [7, 31]) {
    // Os mesmos valores dos dois lados; letras novas também recebem um.
    const vals = { ...sample(after, seed + 1), ...sample(before, seed) };
    const u = numericValue(x, vals);
    const v = numericValue(y, vals);
    if (u === null || v === null) return null;
    if (!close(u, v)) return 'err.noncommute';
  }
  return null;
}
