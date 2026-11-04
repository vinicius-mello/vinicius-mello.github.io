// Utilitários compartilhados pelas regras.

import { getAt, newId, children, replaceAt, withArgs, fn, num } from '../ast.js';
import { toAscii } from '../serialize.js';
import { withNotes } from './normal.js';

export const terms = (n) => (n.op === 'Add' ? n.args : [n]);
export const factors = (n) => (n.op === 'Multiply' ? n.args : [n]);
export const unparen = (n) => (n.op === 'Delimiter' ? n.args[0] : n);

// Separa um termo em sinal e conteúdo: Negate(x) → { neg: true, body: x }.
export function signed(t) {
  return t.op === 'Negate' ? { neg: true, body: t.args[0] } : { neg: false, body: t };
}

export const parentPath = (p) => p.slice(0, -1);
export const lastIndex = (p) => p[p.length - 1];
export const parentOf = (tree, p) => (p.length ? getAt(tree, parentPath(p)) : null);

// Caminhos irmãos: todos têm o mesmo pai.
export function siblingsOf(paths) {
  if (paths.length < 2) return null;
  const pp = parentPath(paths[0]).join();
  if (paths.some((p) => p.length !== paths[0].length || parentPath(p).join() !== pp)) return null;
  return paths.map(lastIndex).sort((a, b) => a - b);
}

// Copia um nó com ids novos e registra de onde veio cada cópia, para a
// animação fazer a cópia "sair" do original.
export function cloneFrom(n, clones) {
  const c = { ...n, id: newId() };
  clones[c.id] = n.id;
  if (n.args) c.args = n.args.map((a) => cloneFrom(a, clones));
  return c;
}

// Todos os ids de uma subárvore (para dicas de animação).
export function ids(n, out = []) {
  out.push(n.id);
  children(n).forEach((c) => ids(c, out));
  return out;
}

// Insere `items` no lugar do filho `i` de um Add/Multiply, achatando quando
// o item tem o mesmo operador do pai (associatividade, não simplificação).
export function spliceFlat(parent, i, items) {
  const flat = items.flatMap((x) => (x.op === parent.op ? x.args : [x]));
  const args = parent.args.slice();
  args.splice(i, 1, ...flat);
  return args;
}

// Soma/produto com 0 ou 1 argumentos vira o elemento neutro ou o próprio item.
export function rebuild(op, args, original) {
  if (args.length === 0) return num(op === 'Add' ? 0 : 1);
  if (args.length === 1) return args[0];
  return original?.op === op ? withArgs(original, args) : fn(op, ...args);
}

// Substitui o nó em `path` por `node`; se o nó resultante for uma soma
// dentro de outra soma, os termos entram direto no pai.
export function place(tree, path, node) {
  const parent = parentOf(tree, path);
  if (parent?.op === 'Add' && node.op === 'Add') {
    return replaceAt(tree, parentPath(path), withArgs(parent, spliceFlat(parent, lastIndex(path), [node])));
  }
  return replaceAt(tree, path, node);
}

// Tenta f no foco e, se não se aplicar, no pai do foco.
export function atFocusOrParent(ctx, f) {
  return f(ctx.focus) ?? (ctx.focus.length ? f(parentPath(ctx.focus)) : null);
}

export const sumOf = (x) => {
  const u = unparen(x);
  return u.op === 'Add' ? u : null;
};

export const isNum = (n, v) => n.op === 'Number' && Number(n.value) === v;

// Uma tecla, uma equivalência: as funções são as formas (os dois sentidos)
// que ela pode produzir. `all` lista as que se aplicam, em ordem e sem
// repetir; `run` aplica a primeira. Repetir a tecla alterna entre elas.
export function either(...fns) {
  fns = fns.map(withNotes);
  const all = (ctx) => {
    const out = [];
    let error = null;
    for (const f of fns) {
      // Uma função pode devolver várias formas (lista).
      for (const r of [].concat(f(ctx) ?? [])) {
        if (r?.tree) {
          const key = toAscii(r.tree);
          if (!out.some((o) => toAscii(o.tree) === key)) out.push(r);
        } else if (r?.error) error ??= r;
      }
    }
    return out.length ? out : error ? [error] : [];
  };
  return { all, run: (ctx) => all(ctx)[0] ?? null };
}

