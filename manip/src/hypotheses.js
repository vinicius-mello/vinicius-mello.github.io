// Hipóteses do professor ("Seja …"), digitadas no campo de entrada:
//   A ∈ M(2, 3)   A, B in M(n)   v in R^3   n in N   (LaTeX: A \in M_{2\times 3}, v \in \mathbb{R}^3)
//   seja x > 0    let x >= 1     seja n in N; x > 0
// Pertinência (∈, in, \in) basta sozinha; uma desigualdade precisa da
// palavra "seja" (ou "let"), senão é um problema novo.
//
// Cada hipótese é um objeto simples (vai para o arquivo salvo):
//   { name, kind: 'matrix', rows, cols }   dimensões em texto ('2', 'n')
//   { name, kind: 'vector', dim }
//   { name, kind: 'set', set }             'N', 'Z', 'Q', 'R' ou 'C'
//   { name, kind: 'rel', rel, bound }      x > 0: rel 'Greater', bound '0'

import { fn, sym } from './ast.js';
import { parseInput, ParseError } from './input.js';
import { toAscii } from './serialize.js';
import { evaluate } from './rules/arith.js';
import { isRelation, FLIP } from './relations.js';

const KEYWORD = /^\s*(seja|sejam|let)\s+/i;
const MEMBER = /^(.+?)\s*(?:∈|\\in(?![A-Za-z])|(?<![A-Za-z])in(?![A-Za-z]))\s*(.+)$/;
const SETS = { N: 'N', Z: 'Z', Q: 'Q', R: 'R', C: 'C', 'ℕ': 'N', 'ℤ': 'Z', 'ℚ': 'Q', 'ℝ': 'R', 'ℂ': 'C' };

// \mathbb{R} → R; espaços e chaves de LaTeX fora.
const cleanSet = (s) => s.replace(/\\(mathbb|mathcal|mathrm|operatorname)\s*\{\s*([A-Za-z])\s*\}/g, '$2')
  .replace(/\\([NZQRC])(?![A-Za-z])/g, '$1').replace(/\s+/g, '');

// Uma dimensão: inteiro positivo ou uma letra.
function dimension(text, pos) {
  let d;
  try {
    d = parseInput(text.replace(/^\{|\}$/g, ''));
  } catch {
    throw new ParseError('err.hypothesis', pos);
  }
  if (d.op === 'Number' && /^[1-9]\d*$/.test(d.value)) return d.value;
  if (d.op === 'Symbol' && /^[a-z](_\w+)?$/.test(d.name)) return d.name;
  throw new ParseError('err.hypothesis', pos);
}

function parseSet(raw, pos) {
  const s = cleanSet(raw);
  if (SETS[s]) return { kind: 'set', set: SETS[s] };
  // R^3, ℝ^n, R^{3}
  let m = /^[Rℝ]\^\{?(.+?)\}?$/.exec(s);
  if (m) return { kind: 'vector', dim: dimension(m[1], pos) };
  // M(2, 3), M(n)
  m = /^M\((.+?)(?:,(.+?))?\)$/.exec(s);
  // M_{2\times 3}(\mathbb{R}), M_{2x3}, M_n, M_2
  m ??= /^M_\{?([^{}]+?)(?:(?:\\times|×|x|,)([^{}]+?))?\}?(?:\([A-Za-zℝℂ]\))?$/.exec(s);
  if (m) {
    const rows = dimension(m[1], pos);
    return { kind: 'matrix', rows, cols: m[2] ? dimension(m[2], pos) : rows };
  }
  throw new ParseError('err.hypothesis', pos);
}

// Os nomes antes do ∈: "A", "A, B", "A_1".
function names(text, pos) {
  return text.split(',').map((part) => {
    let n;
    try {
      n = parseInput(part.trim());
    } catch {
      throw new ParseError('err.hypName', pos, { t: part.trim() });
    }
    if (n.op !== 'Symbol' || !/^[A-Za-z]/.test(n.name)) throw new ParseError('err.hypName', pos, { t: part.trim() });
    return n.name;
  });
}

// x > 0, 0 < x, x >= -1 (uma letra e um número).
function relation(text, pos) {
  let r;
  try {
    r = parseInput(text);
  } catch {
    return null;
  }
  if (!isRelation(r.op) || r.op === 'Equal') return null;
  let [a, b] = r.args;
  let rel = r.op;
  if (a.op !== 'Symbol') { [a, b] = [b, a]; rel = FLIP[rel]; }
  if (a.op !== 'Symbol' || !evaluate(b)) throw new ParseError('err.hypothesis', pos);
  return { name: a.name, kind: 'rel', rel, bound: toAscii(b) };
}

// Devolve a lista de hipóteses, ou null se o texto não é uma hipótese.
export function parseHypotheses(text) {
  const kw = KEYWORD.exec(text);
  const body = kw ? text.slice(kw[0].length) : text;
  const parts = body.split(';').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  if (!kw && !parts.every((p) => MEMBER.test(p))) return null;
  let pos = kw ? kw[0].length : 0;
  const out = [];
  for (const p of parts) {
    const m = MEMBER.exec(p);
    if (m) {
      const set = parseSet(m[2], pos);
      for (const name of names(m[1], pos)) out.push({ name, ...set });
    } else {
      const r = relation(p, pos);
      if (!r) throw new ParseError('err.hypothesis', pos);
      out.push(r);
    }
    pos += p.length + 1;
  }
  return out;
}

// Junta hipóteses novas às antigas: o tipo novo (matriz, vetor, conjunto)
// de um nome substitui o anterior; uma desigualdade nova sobre o mesmo nome
// também substitui a anterior.
export function mergeHypotheses(old, added) {
  const group = (h) => (h.kind === 'rel' ? 'rel' : 'type');
  const out = old.filter((h) => !added.some((a) => a.name === h.name && group(a) === group(h)));
  return [...out, ...added];
}

// ---------------------------------------------------------- para mostrar

const setNode = (name, sub, sup) => ({ ...fn('SetName'), name, sub, sup });

// Árvore para desenhar a hipótese: A ∈ M₂ₓ₃, v ∈ ℝ³, n ∈ ℕ, x > 0.
export function hypothesisTree(h) {
  const x = sym(h.name);
  switch (h.kind) {
    case 'rel': return fn(h.rel, x, parseInput(h.bound));
    case 'matrix': return fn('Element', x, setNode('M', h.rows === h.cols && !/^\d+$/.test(h.rows) ? h.rows : `${h.rows}×${h.cols}`));
    case 'vector': return fn('Element', x, setNode('R', undefined, h.dim));
    default: return fn('Element', x, setNode(h.set));
  }
}

// Texto curto (rótulos dos passos): "x > 0", "A ∈ M(2, 3)".
const REL_TEXT = { Greater: '>', GreaterEqual: '≥', Less: '<', LessEqual: '≤', NotEqual: '≠' };
const SET_TEXT = { N: 'ℕ', Z: 'ℤ', Q: 'ℚ', R: 'ℝ', C: 'ℂ' };
export function hypothesisText(h) {
  switch (h.kind) {
    case 'rel': return `${h.name} ${REL_TEXT[h.rel]} ${h.bound.replace(/-/g, '−')}`;
    case 'matrix': return `${h.name} ∈ M(${h.rows}, ${h.cols})`;
    case 'vector': return `${h.name} ∈ ℝ^${h.dim}`;
    default: return `${h.name} ∈ ${SET_TEXT[h.set]}`;
  }
}

// Texto para reeditar no campo de entrada.
export function hypothesisAscii(h) {
  switch (h.kind) {
    case 'rel': return `seja ${toAscii(fn(h.rel, sym(h.name), parseInput(h.bound)))}`;
    case 'matrix': return `${h.name} in M(${h.rows}, ${h.cols})`;
    case 'vector': return `${h.name} in R^${h.dim}`;
    default: return `${h.name} in ${h.set}`;
  }
}

export const SET_CHARS = SET_TEXT;
