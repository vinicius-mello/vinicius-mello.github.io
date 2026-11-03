// Conversão entre a árvore interna e MathJSON (formato de troca).
// Números viram números JSON quando representáveis sem perda; símbolos viram
// strings; funções viram arrays [operador, ...args].

import { num, sym, fn } from './ast.js';

export function toMathJson(n) {
  switch (n.op) {
    case 'Number': {
      const v = Number(n.value);
      return String(v) === n.value ? v : { num: n.value };
    }
    case 'Symbol': return n.name;
    // Sistema de equações: conjunção das equações.
    case 'System': return ['And', ...n.args.map(toMathJson)];
    default: return [n.op, ...n.args.map(toMathJson)];
  }
}

export function fromMathJson(j) {
  if (typeof j === 'number') return num(j);
  if (typeof j === 'string') return sym(j);
  if (Array.isArray(j)) {
    const [op, ...args] = j;
    return fn(op === 'And' ? 'System' : op, ...args.map(fromMathJson));
  }
  if (j && typeof j === 'object') {
    if ('num' in j) return num(j.num);
    if ('sym' in j) return sym(j.sym);
    if ('fn' in j) return fromMathJson(j.fn);
  }
  throw new Error('MathJSON inválido: ' + JSON.stringify(j));
}
