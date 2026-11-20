// Movimentos com Shift+setas. Cada função recebe a árvore e o caminho do nó
// em foco e devolve { tree, label, arc, focus } ou null se o movimento não se
// aplica, ou { error, params } quando ele não é válido (ex.: dividir uma
// inequação por algo de sinal desconhecido). `arc` é o id do nó que atravessou o sinal de igual (para a
// animação) e `focus`, quando presente, é o id que deve receber o foco.
// Nenhum movimento calcula nada: só reorganiza e insere operações.

import { getAt, replaceAt, withArgs, fn, num } from './ast.js';
import { msg } from './i18n.js';
import { toAscii, toPretty } from './serialize.js';
import { evaluate } from './rules/arith.js';
import { keepsEnds } from './rules/dots.js';
import { isRelation, isInequality, FLIP, relationAt } from './relations.js';
import { swapLines } from './rules/matrix.js';
import { signOf, isScalar, commute, checkStep } from './types.js';
import { note, noted, attempt } from './rules/normal.js';

const terms = (n) => (n.op === 'Add' ? n.args : [n]);
const factors = (n) => (n.op === 'Multiply' ? n.args : [n]);

// Monta uma soma/produto reaproveitando o id do nó original quando existe.
function rebuild(op, args, original) {
  if (args.length === 0) return op === 'Add' ? num(0) : num(1);
  if (args.length === 1) return args[0];
  return original?.op === op ? withArgs(original, args) : fn(op, ...args);
}

const negate = (t) => (t.op === 'Negate' ? t.args[0] : fn('Negate', t));
// O pedaço que sobrevive à troca de sinal (e que deve fazer o arco).
const core = (t) => (t.op === 'Negate' ? t.args[0] : t);

function swap(tree, path, dir) {
  if (!path.length) return null;
  const pp = path.slice(0, -1);
  const parent = getAt(tree, pp);
  // Termos de soma, fatores de produto ou equações de um sistema.
  if (!parent || (parent.op !== 'Add' && parent.op !== 'Multiply' && parent.op !== 'System')) return null;
  const i = path[path.length - 1];
  const j = i + dir;
  if (j < 0 || j >= parent.args.length) return null;
  // AB ≠ BA: duas matrizes não trocam de lugar.
  if (parent.op === 'Multiply' && !commute(parent.args[i], parent.args[j])) return { error: 'err.noncommute' };
  const args = parent.args.slice();
  [args[i], args[j]] = [args[j], args[i]];
  return { tree: replaceAt(tree, pp, withArgs(parent, args)), label: msg('step.reorder'), arc: null };
}

// Numa inequação, multiplicar ou dividir os dois lados por q só é válido
// se q for um número diferente de zero; se for negativo, o sentido inverte.
// Devolve a relação resultante, ou { error } explicando por que não pode.
export function scaledRelation(op, q) {
  if (!isInequality(op)) return { op };
  // O sinal vem do número ou das hipóteses (x > 0), anotadas no rótulo.
  const used = [];
  const v = evaluate(q);
  const s = v ? (v.n > 0n ? 1 : v.n < 0n ? -1 : 0) : signOf(q, used);
  if (s === null) return { error: 'err.signUnknown', params: { e: toPretty(q) } };
  if (s === 0) return { error: 'err.zero' };
  used.forEach(note);
  return { op: s < 0 ? FLIP[op] : op, flipped: s < 0 };
}

// Passa um termo, fator ou denominador para o outro lado da equação (num
// sistema, dentro da equação em que ele está).
function transpose(tree, path, dir) {
  const r = relationAt(tree, path);
  if (!r) return null;
  const res = transposeIn(r.rel, path.slice(r.rp.length), dir);
  if (!res?.tree) return res;
  return { ...res, tree: replaceAt(tree, r.rp, res.tree), relId: res.tree.id };
}

function transposeIn(tree, path, dir) {
  if (!isRelation(tree.op) || path.length === 0 || path.length > 2) return null;
  attempt();
  const s = path[0];
  const o = 1 - s;
  if (dir !== (s === 0 ? +1 : -1)) return null;
  const side = tree.args[s];
  const other = tree.args[o];
  // Lado esquerdo vai para o início do direito e vice-versa: o termo
  // "pula" o sinal de igual e fica junto dele.
  const insertTerm = (t) => {
    const ts = terms(other);
    return rebuild('Add', s === 0 ? [t, ...ts] : [...ts, t], other);
  };
  const build = (newSide, newOther, label, arc, focus = arc, rel = tree.op) => {
    const args = [];
    args[s] = newSide;
    args[o] = newOther;
    return { tree: { ...tree, op: rel, args }, label: noted(label), arc, focus, flipped: rel !== tree.op };
  };

  if (path.length === 1) {
    const moved = negate(side);
    return build(num(0), insertTerm(moved), msg('step.transposeSide'), core(side).id, moved.id);
  }

  const i = path[1];
  const node = side.args[i];
  switch (side.op) {
    case 'Add': {
      const rest = side.args.filter((_, k) => k !== i);
      const moved = negate(node);
      return build(rebuild('Add', rest, side), insertTerm(moved), msg('step.transposeTerm'), core(node).id, moved.id);
    }
    case 'Multiply': {
      // Não se divide por matriz: multiplica-se pela inversa, de um lado só.
      if (!isScalar(node)) return { error: 'err.matrixMove' };
      // y = 0·x → y/0 = x não existe; ax = b → x = b/a supõe a ≠ 0.
      const s0 = signOf(node, []);
      if (s0 === 0) return { error: 'err.zero' };
      const rel = scaledRelation(tree.op, node);
      if (rel.error) return rel;
      const rest = side.args.filter((_, k) => k !== i);
      const label = s0 === null ? msg('step.transposeFactorNZ', { e: toPretty(node) }) : msg('step.transposeFactor');
      return build(rebuild('Multiply', rest, side), fn('Divide', other, node), label, node.id, node.id, rel.op);
    }
    case 'Divide': {
      if (i !== 1) return null;
      const rel = scaledRelation(tree.op, node);
      if (rel.error) return rel;
      const newOther = rebuild('Multiply', [...factors(other), node], other);
      return build(side.args[0], newOther, msg('step.transposeDen'), node.id, node.id, rel.op);
    }
    default:
      return null;
  }
}

// Um movimento não pode separar as reticências do termo ao lado delas.
const guarded = (tree, r) => (r?.tree && !keepsEnds(tree, r.tree) ? { error: 'err.dotsEnds' } : r);

export function shiftSideways(tree, path, dir) {
  const g = swapLines(tree, path, dir, 'col');
  if (g) return g;
  // (−1) no início de um produto: vira o sinal (antes de passar para o outro lado)
  const m = minusOne(tree, path, dir);
  if (m) return typed(tree, guarded(tree, m));
  // Coeficiente numérico de um lado que é produto (2x = 4): passa direto
  // dividindo, sem o passo intermediário "x·2 = 4".
  const direct = numericCoefficient(tree, path, dir) && transpose(tree, path, dir);
  if (direct) return typed(tree, guarded(tree, direct));
  return typed(tree, guarded(tree, swap(tree, path, dir) ?? outOfNumerator(tree, path, dir) ?? transpose(tree, path, dir)));
}

// Ctrl+← num fator (−1) no início de um produto: o sinal vai para a frente
// de tudo. (−1)a → −a; no numerador ou no denominador de uma fração, nega a
// fração: (−1)a/b → −a/b, a/((−1)b) → −a/b, (−1)/b → −1/b. Se já havia um −
// na frente, os dois se cancelam.
const unwrap = (n) => (n.op === 'Delimiter' ? unwrap(n.args[0]) : n);
const isMinusOne = (n) => {
  const u = unwrap(n);
  return (u.op === 'Negate' && unwrap(u.args[0]).op === 'Number' && unwrap(u.args[0]).value === '1')
    || (u.op === 'Number' && u.value === '-1');
};

function minusOne(tree, path, dir) {
  if (dir !== -1 || !path.length || !isMinusOne(getAt(tree, path))) return null;
  const pp = path.slice(0, -1);
  const parent = getAt(tree, pp);
  const i = path[path.length - 1];
  let tp, body;
  if (parent.op === 'Multiply' && i === 0) {
    const rest = rebuild('Multiply', parent.args.slice(1), parent);
    const gp = pp.slice(0, -1);
    const G = pp.length ? getAt(tree, gp) : null;
    if (G?.op === 'Divide') {
      const args = G.args.slice();
      args[pp[pp.length - 1]] = rest;
      tp = gp; body = withArgs(G, args);
    } else { tp = pp; body = rest; }
  } else if (parent.op === 'Divide' && i === 0) {
    tp = pp; body = withArgs(parent, [num(1), parent.args[1]]);
  } else return null;
  // −((−1)a) → a: o − que já estava na frente cancela
  let tpp = tp.slice(0, -1);
  while (tpp.length && getAt(tree, tpp).op === 'Delimiter') tpp = tpp.slice(0, -1);
  if (tp.length && getAt(tree, tpp).op === 'Negate') {
    return { tree: replaceAt(tree, tpp, body), label: msg('step.minusOneOut'), arc: null, focus: body.id };
  }
  const node = fn('Negate', body);
  return { tree: replaceAt(tree, tp, node), label: msg('step.minusOneOut'), arc: null, focus: node.id };
}

// Ctrl+← no primeiro fator do numerador: ele sai da fração, para a frente
// dela. ab/c → a·(b/c) e a/c → a·(1/c); se a fração já é fator de um produto,
// o fator entra no produto (x·ab/c → x·a·(b/c)).
function outOfNumerator(tree, path, dir) {
  if (dir !== -1 || !path.length) return null;
  let fp, node, rest;
  const parent = getAt(tree, path.slice(0, -1));
  const i = path[path.length - 1];
  if (parent?.op === 'Multiply' && i === 0 && path.length >= 2) {
    fp = path.slice(0, -2);
    const D = getAt(tree, fp);
    if (D?.op !== 'Divide' || path[path.length - 2] !== 0) return null;
    node = parent.args[0];
    rest = rebuild('Multiply', parent.args.slice(1), parent);
  } else if (parent?.op === 'Divide' && i === 0) {
    node = parent.args[0];
    if (node.op === 'Number' && node.value === '1') return null;
    if (node.op === 'Negate') return null;
    if (node.op === 'Add') node = fn('Delimiter', node);
    fp = path.slice(0, -1);
    rest = num(1);
  } else return null;
  const D = getAt(tree, fp);
  const frac = withArgs(D, [rest, D.args[1]]);
  // k·(ab/c): os parênteses em volta da fração também saem do caminho.
  let gp = fp;
  if (gp.length >= 2 && getAt(tree, gp.slice(0, -1)).op === 'Delimiter' && getAt(tree, gp.slice(0, -2)).op === 'Multiply') gp = gp.slice(0, -1);
  const outer = gp.length ? getAt(tree, gp.slice(0, -1)) : null;
  let t;
  if (outer?.op === 'Multiply') {
    const args = outer.args.slice();
    args.splice(gp[gp.length - 1], 1, node, frac);
    t = replaceAt(tree, gp.slice(0, -1), withArgs(outer, args));
  } else t = replaceAt(tree, fp, fn('Multiply', node, frac));
  return { tree: t, label: msg('step.outOfNumerator'), arc: null, focus: node.id };
}

function numericCoefficient(tree, path, dir) {
  const r = relationAt(tree, path);
  if (!r) return false;
  const rel = path.slice(r.rp.length);
  if (rel.length !== 2 || dir !== (rel[0] === 0 ? +1 : -1)) return false;
  const side = r.rel.args[rel[0]];
  return side.op === 'Multiply' && !!evaluate(side.args[rel[1]]);
}

// Com matrizes, o passo é conferido numericamente (a ordem dos fatores).
function typed(tree, r) {
  if (!r?.tree) return r;
  const e = checkStep(tree, r.tree);
  return e ? { error: e } : r;
}

// Um grupo do mesmo tipo do pai: Add dentro de Add, ou (Add) entre parênteses.
function groupOf(node, op) {
  if (node.op === op) return { inner: node, delim: null };
  if (node.op === 'Delimiter' && node.args[0].op === op) return { inner: node.args[0], delim: node };
  return null;
}

// Shift+↑: tira o nó de dentro do grupo e o coloca logo depois dele.
// Numa linha de um determinante, Ctrl+↑↓ trocam a linha com a vizinha.
export const shiftOut = (tree, path) => swapLines(tree, path, -1, 'row') ?? typed(tree, guarded(tree, shiftOutRaw(tree, path)));

function shiftOutRaw(tree, path) {
  if (path.length < 2) return null;
  const pp = path.slice(0, -1);
  const parent = getAt(tree, pp);
  if (parent.op !== 'Add' && parent.op !== 'Multiply') return null;
  let gp = pp;
  if (pp.length && getAt(tree, pp.slice(0, -1)).op === 'Delimiter') gp = pp.slice(0, -1);
  if (gp.length === 0) return null;
  const outerPath = gp.slice(0, -1);
  const outer = getAt(tree, outerPath);
  if (outer.op !== parent.op) return null;

  const i = path[path.length - 1];
  const node = parent.args[i];
  const remaining = rebuild(parent.op, parent.args.filter((_, k) => k !== i), parent);
  let t = replaceAt(tree, pp, remaining);
  const g = gp[gp.length - 1];
  const outerNow = getAt(t, outerPath);
  const args = outerNow.args.slice();
  args.splice(g + 1, 0, node);
  t = replaceAt(t, outerPath, withArgs(outerNow, args));
  return { tree: t, label: msg('step.ungroup'), arc: null };
}

// Shift+↓: coloca o nó dentro do grupo vizinho (preferindo o da direita).
export const shiftIn = (tree, path) => swapLines(tree, path, +1, 'row') ?? typed(tree, guarded(tree, shiftInRaw(tree, path)));

function shiftInRaw(tree, path) {
  if (path.length === 0) return null;
  const pp = path.slice(0, -1);
  const parent = getAt(tree, pp);
  if (parent.op !== 'Add' && parent.op !== 'Multiply') return null;
  const i = path[path.length - 1];
  const node = parent.args[i];
  for (const dir of [+1, -1]) {
    const j = i + dir;
    if (j < 0 || j >= parent.args.length) continue;
    const g = groupOf(parent.args[j], parent.op);
    if (!g) continue;
    const innerArgs = dir > 0 ? [node, ...g.inner.args] : [...g.inner.args, node];
    const inner = withArgs(g.inner, innerArgs);
    const grouped = g.delim ? withArgs(g.delim, [inner]) : inner;
    const args = parent.args.slice();
    args[j] = grouped;
    args.splice(i, 1);
    const newParent = rebuild(parent.op, args, parent);
    return { tree: replaceAt(tree, pp, newParent), label: msg('step.intoGroup'), arc: null };
  }
  return null;
}
