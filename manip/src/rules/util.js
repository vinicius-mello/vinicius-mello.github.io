// Utilitários compartilhados pelas regras.

import { getAt, newId, children } from '../ast.js';

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
