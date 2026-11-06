// Termo geral das reticências: em 1 + 2 + … + n, a₁ + a₂ + … + aₙ ou
// x + x² + … + xⁿ, o app deduz f(k) e os limites comparando os termos
// escritos. Com o padrão, o … vira Σ (e vice-versa), mostra mais termos,
// inverte a ordem e soma duas sequências termo a termo (Gauss).
//
// Dedução: o último termo é comparado com um dos primeiros. Onde diferem,
// o primeiro tem um número (o índice) e o último a expressão do limite
// (n, n + 1...). A forma normal ajuda: x = x¹ e 2 = 2·1. Depois, todos os
// termos escritos são conferidos numericamente contra f(k).

import { getAt, fn, num, sym, walk, withArgs, isDots, DOTS, INFINITY, isInfinity, sameTag } from '../ast.js';
import { msg } from '../i18n.js';
import { parseAscii } from '../parse-ascii.js';
import { toAscii, looseSame } from '../serialize.js';
import { offset, intOf, freshIndex, instantiate } from './combinatorics.js';
import { numeric } from './calculus.js';
import { cloneFrom, unparen, signed, place, parentPath } from './util.js';
import { noted } from './normal.js';

const copy = (n) => cloneFrom(n, {});
const label = (key) => noted(msg(key));
const CONTAINERS = new Set(['Add', 'Multiply']);
const dotsIn = (c) => isDots(c) || (c.op === 'Negate' && isDots(c.args[0]));

// ------------------------------------------------- comparação numérica

const VALUES = [0.7312, -1.3841, 2.1197, -0.4423, 1.6629];
const CONSTANTS = new Set(['e', 'pi', 'ImaginaryUnit', DOTS, INFINITY]);
function equalish(x, y) {
  const names = new Set();
  for (const t of [x, y]) walk(t, (n) => { if (n.op === 'Symbol' && !CONSTANTS.has(n.name)) names.add(n.name); });
  const vars = [...names];
  let valid = 0;
  for (let j = 0; j < VALUES.length; j++) {
    const env = Object.fromEntries(vars.map((v, i) => [v, VALUES[(j + 2 * i) % VALUES.length]]));
    const [a, b] = [numeric(x, env), numeric(y, env)];
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    valid++;
    if (Math.abs(a - b) > 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))) return false;
  }
  return valid > 0;
}

// --------------------------------------------------------- anti-unificação

const subOf = (n) => (n.op === 'Symbol' && n.name.includes('_') ? n.name.slice(n.name.indexOf('_') + 1) : null);
const baseOf = (n) => n.name.slice(0, n.name.indexOf('_'));
const isInt = (n) => (n.op === 'Number' || (n.op === 'Negate' && n.args[0].op === 'Number')) && intOf(n) !== null;

// Compara p (termo do começo) com q (termo posterior). Devolve o molde de q
// com buracos onde está o índice; `pairs` recebe { u: inteiro em p, v: nó em q }.
function antiUnify(p, q, pairs) {
  if (looseSame(p, q)) return copy(q);
  // x ↔ xⁿ: x = x¹ · 2 ↔ 2n: 2 = 2·1
  if (q.op === 'Power' && looseSame(p, q.args[0])) p = fn('Power', p, num(1));
  else if (q.op === 'Multiply' && q.args.length === 2 && isInt(p) && looseSame(p, q.args[0])) p = fn('Multiply', p, num(1));
  // a₁ ↔ aₙ
  const [sp, sq] = [subOf(p), subOf(q)];
  if (sp !== null && sq !== null && baseOf(p) === baseOf(q) && /^\d+$/.test(sp)) {
    let v;
    try { v = parseAscii(sq); } catch { return null; }
    pairs.push({ u: Number(sp), v });
    return { op: 'Hole', i: pairs.length - 1, base: baseOf(q) };
  }
  if (isInt(p)) {
    pairs.push({ u: intOf(p), v: q });
    return { op: 'Hole', i: pairs.length - 1 };
  }
  if (p.op !== q.op || !p.args || !q.args || p.args.length !== q.args.length || !sameTag(p, q)) return null;
  const args = [];
  for (let j = 0; j < p.args.length; j++) {
    const a = antiUnify(p.args[j], q.args[j], pairs);
    if (!a) return null;
    args.push(a);
  }
  return { ...copy(q), args };
}

// v = base + c, com c inteiro: n + 1 → (n, 1); 7 → (7, 0).
function splitOffset(v) {
  const u = unparen(v);
  if (u.op === 'Add' && u.args.length >= 2) {
    const last = u.args[u.args.length - 1];
    const c = isInt(signed(last).body) ? intOf(last) : null;
    if (c !== null) {
      const rest = u.args.slice(0, -1);
      return { base: rest.length === 1 ? rest[0] : fn('Add', ...rest), off: c };
    }
  }
  return { base: v, off: 0 };
}

const kPlus = (k, c) => (c === 0 ? sym(k) : c > 0 ? fn('Add', sym(k), num(c)) : fn('Add', sym(k), fn('Negate', num(-c))));

function fill(t, k, offs) {
  if (t.op === 'Hole') {
    if (t.base === undefined) return kPlus(k, offs[t.i]);
    const c = offs[t.i];
    return sym(`${t.base}_${c === 0 ? k : toAscii(kPlus(k, c)).replace(/\s+/g, '')}`);
  }
  return t.args ? { ...t, args: t.args.map((a) => fill(a, k, offs)) } : t;
}

// O termo para um valor do índice: k + c já calculado (n − 1 + 1 → n).
function fillValue(t, v, offs) {
  if (t.op === 'Hole') {
    const e = offset(v, offs[t.i]);
    if (t.base === undefined) return e;
    const n = intOf(e);
    return sym(`${t.base}_${n !== null ? n : toAscii(e).replace(/\s+/g, '')}`);
  }
  return t.args ? { ...copy(t), args: t.args.map((a) => fillValue(a, v, offs)) } : copy(t);
}

// f(k) e índice de p a partir de um par de termos.
// finito: q é o último termo, que vale f(b); infinito: q = termo seguinte a p.
function deduce(p, q, k, infinite) {
  const pairs = [];
  const tpl = antiUnify(p, q, pairs);
  if (!tpl || !pairs.length) return null;
  let offs, ip, b = null;
  if (infinite) {
    if (!pairs.every(({ u, v }) => isInt(v) && intOf(v) === u + 1)) return null;
    ip = pairs[0].u;
    offs = pairs.map(({ u }) => u - ip);
  } else if (pairs.every(({ v }) => isInt(v))) {
    const v0 = intOf(pairs[0].v);
    offs = pairs.map(({ v }) => intOf(v) - v0);
    b = num(v0);
    ip = pairs[0].u - offs[0];
    if (pairs.some(({ u }, i) => u - offs[i] !== ip)) return null;
  } else {
    const parts = pairs.map(({ v }) => splitOffset(v));
    if (parts.some((x) => isInt(x.base) || !looseSame(x.base, parts[0].base))) return null;
    offs = parts.map((x) => x.off);
    b = parts[0].base;
    ip = pairs[0].u - offs[0];
    if (pairs.some(({ u }, i) => u - offs[i] !== ip)) return null;
  }
  return { f: fill(tpl, k, offs), tpl, offs, ip, b };
}

const at = (P, v) => {
  const value = typeof v === 'number' ? (v < 0 ? fn('Negate', num(-v)) : num(v)) : v;
  return P.tpl ? fillValue(P.tpl, value, P.offs) : instantiate(P.f, P.k, value);
};
// Os termos escritos batem com P (crescente a partir de a; o fim em b).
const fits = (P, head, tail) => head.every((t, m) => equalish(t, at(P, offset(P.a, m))))
  && tail.every((t, i) => equalish(t, at(P, offset(P.b, -(tail.length - 1 - i)))));
const shifted = (e, d) => (isInfinity(e) ? e : offset(e, d));

// Padrão de uma sequência dada como (head, …, tail), em ordem crescente.
function infer(head, tail, k) {
  const infinite = tail.length === 0;
  const tries = infinite
    ? head.slice(0, -1).map((p, j) => [p, head[j + 1], j])
    : head.map((p, j) => [p, tail[tail.length - 1], j]);
  for (const [p, q, j] of tries) {
    const d = deduce(p, q, k, infinite);
    if (!d) continue;
    const P = { f: d.f, tpl: d.tpl, offs: d.offs, k, a: num(d.ip - j), b: infinite ? sym(INFINITY) : d.b };
    if (d.ip - j < 0) P.a = fn('Negate', num(j - d.ip));
    if (fits(P, head, tail)) return P;
  }
  return null;
}

// Padrão de um trecho de soma/produto com um único …: tenta a sequência
// crescente e a decrescente, e o trecho mais longo que termina no termo
// depois do … (ou no próprio …, numa série).
export function patternAt(C, k) {
  const ds = C.args.map((c, i) => (dotsIn(c) ? i : -1)).filter((i) => i >= 0);
  if (ds.length !== 1) return null;
  const i = ds[0];
  const end = i + 1 < C.args.length ? i + 1 : i;
  // termo geral guardado no … (soma termo a termo), se ainda bate
  const meta = (isDots(C.args[i]) ? C.args[i] : C.args[i].args[0]).term;
  for (let s = 0; s < i; s++) {
    const head = C.args.slice(s, i);
    const tail = end > i ? [C.args[end]] : [];
    if (meta && fits(meta, head, tail)) return { ...meta, f: bodyFor(meta, head, tail), start: s, end, dots: i, down: false };
    let P = infer(head, tail, k);
    if (P) return { ...P, start: s, end, dots: i, down: false };
    if (tail.length && head.length) {
      P = infer([...tail].reverse(), [...head].reverse(), k);
      if (P) return { ...P, start: s, end, dots: i, down: true };
    }
  }
  return null;
}

// Corpo do Σ: o termo escrito, quando ele é o próprio f(k) (sequência
// constante: (n + 1) + … + (n + 1)); senão, f(k).
function bodyFor(P, head, tail) {
  const t = [...head, ...tail].find((x) => !walkHas(x, P.k));
  if (t && [...head, ...tail].every((x) => looseSame(x, t)) && equalish(P.f, t)) return t;
  return P.f;
}
const walkHas = (n, name) => {
  let found = false;
  walk(n, (x) => { if (x.op === 'Symbol' && x.name === name) found = true; });
  return found;
};

// --------------------------------------------------------------- formas

// O container com … mais próximo do foco.
function dottedAt(ctx) {
  const { tree } = ctx;
  for (let p = ctx.focus; ; p = parentPath(p)) {
    const n = getAt(tree, p);
    if (CONTAINERS.has(n.op) && n.args.some(dotsIn)) return p;
    if (!p.length) return null;
  }
}

// Termo de soma que é uma soma: entre parênteses (n + (n − 1) + …).
const asTerm = (C, t) => (C.op === 'Add' && (t.op === 'Add' || t.op === 'Negate') ? fn('Delimiter', t) : C.op === 'Multiply' && t.op === 'Add' ? fn('Delimiter', t) : t);

// j-ésimo termo na ordem da tela, contando do começo ou do fim.
const fromStart = (P, j) => (P.down ? at(P, offset(P.b, -j)) : at(P, offset(P.a, j)));
const fromEnd = (P, j) => (P.down ? at(P, offset(P.a, j)) : at(P, offset(P.b, -j)));

function replaceRun(C, P, items) {
  return withArgs(C, [...C.args.slice(0, P.start), ...items, ...C.args.slice(P.end + 1)]);
}

export function dotsForms(ctx) {
  const p = dottedAt(ctx);
  if (!p) return [];
  const { tree } = ctx;
  const C = getAt(tree, p);
  const out = [];
  const add = (node, key) => out.push({ tree: place(tree, p, node.args?.length === 1 ? node.args[0] : node), label: label(key), focus: node.id });

  // … + aₖ + … → … (esconder o termo geral)
  for (let i = 0; i + 2 < C.args.length; i++) {
    if (dotsIn(C.args[i]) && !dotsIn(C.args[i + 1]) && dotsIn(C.args[i + 2])) {
      add(withArgs(C, [...C.args.slice(0, i + 1), ...C.args.slice(i + 3)]), 'step.dotsHide');
    }
  }

  const P = patternAt(C, freshIndex(tree));
  if (!P) return out;
  const constant = C.args.filter((c) => !dotsIn(c)).every((c, _, all) => looseSame(c, all[0]));
  const head = C.args.slice(P.start, P.dots);
  const tail = C.args.slice(P.dots + 1, P.end + 1);
  const dots = C.args[P.dots];
  const finite = !isInfinity(P.b);

  // Σ / Π
  const big = fn(C.op === 'Add' ? 'Sum' : 'Product', sym(P.k), copy(P.a), copy(P.b), copy(P.f));
  add(replaceRun(C, P, [big]), C.op === 'Add' ? 'step.dotsToSum' : 'step.dotsToProd');

  // mais um termo no começo; o penúltimo
  add(replaceRun(C, P, [...head, asTerm(C, fromStart(P, head.length)), dots, ...tail]), 'step.dotsNext');
  if (finite) add(replaceRun(C, P, [...head, dots, asTerm(C, fromEnd(P, tail.length)), ...tail]), 'step.dotsPrev');

  // termo geral no meio
  if (!constant) add(replaceRun(C, P, [...head, dots, asTerm(C, copy(P.f)), sym(DOTS), ...tail]), 'step.dotsGeneral');

  // ordem inversa: n + (n − 1) + … + 1
  if (finite && !constant) {
    // o j-ésimo do começo passa a ser o j-ésimo do fim (o já escrito, se houver)
    const fromStartRev = (j) => (j < tail.length ? copy(tail[tail.length - 1 - j]) : asTerm(C, fromEnd(P, j)));
    const fromEndRev = (j) => (j < head.length ? copy(head[j]) : asTerm(C, fromStart(P, j)));
    const items = [
      ...head.map((_, j) => fromStartRev(j)),
      dots,
      ...tail.map((_, j) => fromEndRev(tail.length - 1 - j)),
    ];
    add(replaceRun(C, P, items), 'step.dotsReverse');
  }
  return out;
}

// --------------------------------------------- soma termo a termo (Gauss)

// (a₁ + … + aₙ) + (b₁ + … + bₙ) = (a₁ + b₁) + … + (aₙ + bₙ)
export function dotsZip(ctx) {
  const { tree } = ctx;
  for (let p = ctx.focus; ; p = parentPath(p)) {
    const S = getAt(tree, p);
    if (S.op === 'Add') {
      const r = zipIn(tree, p, S);
      if (r) return r;
    }
    if (!p.length) return null;
  }
}

function zipIn(tree, p, S) {
  const seqs = S.args.map((t, i) => {
    const { neg, body } = signed(t);
    const C = unparen(body);
    if (C.op !== 'Add' || !C.args.some(dotsIn)) return null;
    const P = patternAt(C, freshIndex(tree));
    if (!P || P.start !== 0 || P.end !== C.args.length - 1 || isInfinity(P.b)) return null;
    return { i, neg, C, P };
  }).filter(Boolean);
  for (let x = 0; x < seqs.length; x++) {
    for (let y = x + 1; y < seqs.length; y++) {
      const [A, B] = [seqs[x], seqs[y]];
      if (A.neg) continue;
      const span = (P) => fn('Add', copy(P.b), fn('Negate', copy(P.a)));
      if (!equalish(span(A.P), span(B.P))) continue;
      const H = Math.max(A.P.dots, B.P.dots);
      const T = Math.max(A.C.args.length - 1 - A.P.dots, B.C.args.length - 1 - B.P.dots);
      const termAt = (Q, j, fromTheEnd) => {
        const i = fromTheEnd ? Q.C.args.length - 1 - j : j;
        const written = fromTheEnd ? j < Q.C.args.length - 1 - Q.P.dots : j < Q.P.dots;
        return written ? copy(Q.C.args[i]) : (fromTheEnd ? fromEnd : fromStart)(Q.P, j);
      };
      const pair = (a, b) => fn('Delimiter', fn('Add', a, B.neg ? fn('Negate', asTerm({ op: 'Add' }, b)) : b));
      const items = [];
      for (let j = 0; j < H; j++) items.push(pair(termAt(A, j, false), termAt(B, j, false)));
      items.push(zipDots(A, B, tree));
      for (let j = T - 1; j >= 0; j--) items.push(pair(termAt(A, j, true), termAt(B, j, true)));
      const zipped = fn('Add', ...items);
      const rest = S.args.filter((_, i) => i !== A.i && i !== B.i);
      const node = rest.length
        ? withArgs(S, S.args.map((t, i) => (i === A.i ? fn('Delimiter', zipped) : t)).filter((_, i) => i !== B.i))
        : zipped;
      return { tree: place(tree, p, node), label: label('step.dotsZip'), focus: zipped.id };
    }
  }
  return null;
}

// O … da soma termo a termo guarda o termo geral: k-ésimo de A ± k-ésimo
// de B, k = 1…(número de termos). É o que permite dizer quantos termos tem
// (n + 1) + … + (n + 1) depois de calcular cada parêntese.
function zipDots(A, B, tree) {
  const d = A.C.args[A.P.dots];
  const k = freshIndex(tree);
  const nth = (Q) => {
    const P = Q.P;
    const lo = intOf(P.a);
    const value = P.down
      ? fn('Add', copy(P.b), fn('Negate', sym(k)), num(1))
      : lo !== null ? offset(sym(k), lo - 1) : fn('Add', copy(P.a), sym(k), fn('Negate', num(1)));
    return at(P, value);
  };
  const b = offset(fn('Add', copy(A.P.b), fn('Negate', copy(A.P.a))), 1);
  const f = fn('Add', asTerm({ op: 'Add' }, nth(A)), B.neg ? fn('Negate', asTerm({ op: 'Add' }, nth(B))) : asTerm({ op: 'Add' }, nth(B)));
  const term = { k, a: num(1), b, f };
  return d.op === 'Negate' ? withArgs(d, [{ ...d.args[0], term }]) : { ...d, term };
}

// Para a conferência numérica: cada trecho com … vira Σ/Π (ou null).
export function dotsAsSums(tree) {
  let failed = false;
  const k = freshIndex(tree);
  const go = (n) => {
    if (!n.args) return n;
    let m = { ...n, args: n.args.map(go) };
    if (CONTAINERS.has(m.op) && m.args.some(dotsIn)) {
      const P = patternAt(m, k);
      if (!P) { failed = true; return m; }
      const big = fn(m.op === 'Add' ? 'Sum' : 'Product', sym(k), P.a, P.b, P.f);
      const args = [...m.args.slice(0, P.start), big, ...m.args.slice(P.end + 1)];
      m = args.length === 1 ? args[0] : { ...m, args };
    }
    return m;
  };
  const out = go(tree);
  return failed ? null : out;
}
