// Movimentos com Shift+setas. Cada função recebe a árvore e o caminho do nó
// em foco e devolve { tree, label, arc, focus } ou null se o movimento não se
// aplica, ou { error, params } quando ele não é válido (ex.: dividir uma
// inequação por algo de sinal desconhecido). `arc` é o id do nó que atravessou o sinal de igual (para a
// animação) e `focus`, quando presente, é o id que deve receber o foco.
// Nenhum movimento calcula nada: só reorganiza e insere operações.

import { getAt, replaceAt, withArgs, fn, num } from './ast.js';
import { msg } from './i18n.js';
import { toAscii } from './serialize.js';
import { evaluate } from './rules/arith.js';
import { keepsEnds } from './rules/dots.js';
import { isRelation, isInequality, FLIP, relationAt } from './relations.js';

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
  const pp = path.slice(0, -1);
  const parent = getAt(tree, pp);
  // Termos de soma, fatores de produto ou equações de um sistema.
  if (!parent || (parent.op !== 'Add' && parent.op !== 'Multiply' && parent.op !== 'System')) return null;
  const i = path[path.length - 1];
  const j = i + dir;
  if (j < 0 || j >= parent.args.length) return null;
  const args = parent.args.slice();
  [args[i], args[j]] = [args[j], args[i]];
  return { tree: replaceAt(tree, pp, withArgs(parent, args)), label: msg('step.reorder'), arc: null };
}

// Numa inequação, multiplicar ou dividir os dois lados por q só é válido
// se q for um número diferente de zero; se for negativo, o sentido inverte.
// Devolve a relação resultante, ou { error } explicando por que não pode.
export function scaledRelation(op, q) {
  if (!isInequality(op)) return { op };
  const v = evaluate(q);
  if (!v) return { error: 'err.signUnknown', params: { e: toAscii(q) } };
  if (v.n === 0n) return { error: 'err.zero' };
  return { op: v.n < 0n ? FLIP[op] : op, flipped: v.n < 0n };
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
    return { tree: { ...tree, op: rel, args }, label, arc, focus, flipped: rel !== tree.op };
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
      const rel = scaledRelation(tree.op, node);
      if (rel.error) return rel;
      const rest = side.args.filter((_, k) => k !== i);
      return build(rebuild('Multiply', rest, side), fn('Divide', other, node), msg('step.transposeFactor'), node.id, node.id, rel.op);
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
  return guarded(tree, swap(tree, path, dir) ?? transpose(tree, path, dir));
}

// Um grupo do mesmo tipo do pai: Add dentro de Add, ou (Add) entre parênteses.
function groupOf(node, op) {
  if (node.op === op) return { inner: node, delim: null };
  if (node.op === 'Delimiter' && node.args[0].op === op) return { inner: node.args[0], delim: node };
  return null;
}

// Shift+↑: tira o nó de dentro do grupo e o coloca logo depois dele.
export const shiftOut = (tree, path) => guarded(tree, shiftOutRaw(tree, path));

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
export const shiftIn = (tree, path) => guarded(tree, shiftInRaw(tree, path));

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
