// Navegação pela árvore. Funções puras: recebem a árvore e o caminho do foco
// e devolvem o novo caminho (ou o mesmo, se não houver para onde ir).

import { getAt, children } from './ast.js';

export function down(tree, path) {
  const n = getAt(tree, path);
  return children(n).length ? [...path, 0] : path;
}

export function up(tree, path) {
  return path.length ? path.slice(0, -1) : path;
}

// Irmão seguinte (dir = +1) ou anterior (dir = -1). Sem irmão nessa
// direção, sobe até um ancestral que tenha e desce de volta à mesma
// profundidade pelo lado mais próximo.
export function sideways(tree, path, dir) {
  let depth = 0;
  let p = path;
  while (p.length) {
    const parent = getAt(tree, p.slice(0, -1));
    const i = p[p.length - 1] + dir;
    if (i >= 0 && i < parent.args.length) {
      let q = [...p.slice(0, -1), i];
      for (let d = 0; d < depth; d++) {
        const cs = children(getAt(tree, q));
        if (!cs.length) break;
        q = [...q, dir > 0 ? 0 : cs.length - 1];
      }
      return q;
    }
    p = p.slice(0, -1);
    depth++;
  }
  return path;
}

export const right = (tree, path) => sideways(tree, path, +1);
export const left = (tree, path) => sideways(tree, path, -1);
