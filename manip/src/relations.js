// Relações entre os dois lados: igualdade, diferença e desigualdades.
// Nomes do MathJSON; símbolos para exibir, digitar (ASCII) e exportar (LaTeX).

export const RELATIONS = {
  Equal: '=', NotEqual: '≠', Less: '<', LessEqual: '≤', Greater: '>', GreaterEqual: '≥',
};

export const ASCII_RELATIONS = {
  Equal: '=', NotEqual: '!=', Less: '<', LessEqual: '<=', Greater: '>', GreaterEqual: '>=',
};

export const LATEX_RELATIONS = {
  Equal: '=', NotEqual: '\\ne', Less: '<', LessEqual: '\\le', Greater: '>', GreaterEqual: '\\ge',
};

// Texto digitado → relação (ASCII e Unicode).
export const RELATION_INPUT = {
  '=': 'Equal', '!=': 'NotEqual', '≠': 'NotEqual',
  '<': 'Less', '<=': 'LessEqual', '≤': 'LessEqual',
  '>': 'Greater', '>=': 'GreaterEqual', '≥': 'GreaterEqual',
};

export const isRelation = (op) => op in RELATIONS;
export const isInequality = (op) => op === 'Less' || op === 'LessEqual' || op === 'Greater' || op === 'GreaterEqual';

// Sentido: −1 para < e ≤, +1 para > e ≥, 0 para = e ≠.
export const direction = (op) => (op.startsWith('Less') ? -1 : op.startsWith('Greater') ? 1 : 0);

// A relação "da vez": a própria raiz ou, num sistema, a equação que contém
// o caminho. Devolve { rp: caminho da relação, rel } ou null.
export function relationAt(tree, path) {
  if (isRelation(tree.op)) return { rp: [], rel: tree };
  if (tree.op === 'System' && path.length >= 1 && isRelation(tree.args[path[0]]?.op)) {
    return { rp: [path[0]], rel: tree.args[path[0]] };
  }
  return null;
}

// Trocar os lados ou multiplicar por negativo inverte o sentido.
export const FLIP = {
  Less: 'Greater', Greater: 'Less', LessEqual: 'GreaterEqual', GreaterEqual: 'LessEqual',
  Equal: 'Equal', NotEqual: 'NotEqual',
};
