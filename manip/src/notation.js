// Regras de notação compartilhadas pelo renderizador e pelos serializadores:
// quando um filho precisa de parênteses implícitos e como juntar fatores.

import { isLeaf, FUNCTION_NAMES, isBigOp } from './ast.js';

// lim, d/dx e Σ engolem os fatores à direita: no meio de um produto vão entre parênteses.
const greedy = (n) => isBigOp(n) || n.op === 'Limit' || n.op === 'D';

const OWN_NOTATION = new Set(['Sqrt', 'Root', 'Abs', 'Conjugate', 'Binomial']);
// Funções escritas sempre com parênteses: Re(z), Im(z), arg(z).
const ALWAYS_PARENS = new Set(['Real', 'Imaginary', 'Argument']);
export const isFunctionOp = (op) => op in FUNCTION_NAMES && !OWN_NOTATION.has(op);

// sen²x: potência de função trigonométrica com expoente numérico, escrita
// com o expoente junto do nome.
const POWER_NAMED = new Set(['Sin', 'Cos', 'Tan', 'Sec', 'Csc', 'Cot', 'Sinh', 'Cosh', 'Tanh']);
export const isFunctionPower = (n) => n.op === 'Power' && POWER_NAMED.has(n.args[0].op)
  && n.args[0].args.length === 1 && n.args[1].op === 'Number';

// log com base: Log(x, b) é escrito log_b x (base simples) ou log(x, b).
export const simpleBase = (b) => b.op === 'Number' || (b.op === 'Symbol' && !b.name.includes('_'));

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
      // Σ no meio de um produto engoliria os fatores seguintes: (Σ k)·x.
      if (greedy(child) && index < parent.args.length - 1) return true;
      return c === 'Add' || c === 'Multiply' || (c === 'Negate' && index > 0);
    case 'Factorial':
      return !isLeaf(child) && c !== 'Delimiter' && c !== 'Binomial';
    case 'Sum': case 'Product':
      return index === 3 && c === 'Add';
    case 'Limit':
      return index === 2 && c === 'Add';
    case 'D':
      return index === 1 && (c === 'Add' || c === 'Multiply' || c === 'Negate' || greedy(child));
    case 'Power':
      return index === 0 && !isLeaf(child) && c !== 'Delimiter' && c !== 'Call' && !OWN_NOTATION.has(c);
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
  if (n.op === 'Power' || n.op === 'Multiply' || n.op === 'Factorial') return startsWithDigit(n.args[0]);
  return false;
}

// Entre dois fatores: ponto explícito ou justaposição.
export function needsDot(prev, next, nextIndex, parent) {
  if (needsParens(next, parent, nextIndex)) return false;
  if (startsWithDigit(next)) return true;
  if (next.op === 'Negate') return true;
  return false;
}
