// Regras de notação compartilhadas pelo renderizador e pelos serializadores:
// quando um filho precisa de parênteses implícitos e como juntar fatores.

import { isLeaf, FUNCTION_NAMES } from './ast.js';

const OWN_NOTATION = new Set(['Sqrt', 'Root', 'Abs', 'Conjugate']);
// Funções escritas sempre com parênteses: Re(z), Im(z), arg(z).
const ALWAYS_PARENS = new Set(['Real', 'Imaginary', 'Argument']);
export const isFunctionOp = (op) => op in FUNCTION_NAMES && !OWN_NOTATION.has(op);

// Parênteses que não foram digitados mas que a estrutura exige para ser lida
// corretamente (ex.: Multiply(2, Add(x, 1)) → 2(x + 1)).
export function needsParens(child, parent, index) {
  const c = child.op;
  switch (parent.op) {
    case 'Add':
      return c === 'Add';
    case 'Negate':
      return c === 'Add' || c === 'Negate';
    case 'Multiply':
      return c === 'Add' || c === 'Multiply' || (c === 'Negate' && index > 0);
    case 'Power':
      return index === 0 && !isLeaf(child) && c !== 'Delimiter' && !OWN_NOTATION.has(c);
    default:
      if (ALWAYS_PARENS.has(parent.op)) return c !== 'Delimiter';
      if (isFunctionOp(parent.op)) return !isLeaf(child) && c !== 'Delimiter';
      return false;
  }
}

// Primeiro "caractere" visível de um nó, para decidir se um fator precisa
// de um ponto de multiplicação explícito antes dele.
function startsWithDigit(n) {
  if (n.op === 'Number') return true;
  if (n.op === 'Symbol' || n.op === 'Delimiter' || n.op === 'Divide' || OWN_NOTATION.has(n.op)) return false;
  if (n.op === 'Power' || n.op === 'Multiply') return startsWithDigit(n.args[0]);
  return false;
}

// Entre dois fatores: ponto explícito ou justaposição.
export function needsDot(prev, next, nextIndex, parent) {
  if (needsParens(next, parent, nextIndex)) return false;
  if (startsWithDigit(next)) return true;
  if (next.op === 'Negate') return true;
  return false;
}
