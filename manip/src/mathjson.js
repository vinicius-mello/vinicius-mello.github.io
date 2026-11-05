// Conversão entre a árvore interna e MathJSON (formato de troca).
// Números viram números JSON quando representáveis sem perda; símbolos viram
// strings; funções viram arrays [operador, ...args].

import { num, sym, fn, call } from './ast.js';

export function toMathJson(n) {
  switch (n.op) {
    case 'Number': {
      const v = Number(n.value);
      return String(v) === n.value ? v : { num: n.value };
    }
    case 'Symbol': return n.name;
    // Sistema de equações: conjunção das equações.
    case 'System': return ['And', ...n.args.map(toMathJson)];
    case 'Sum': case 'Product': {
      const [k, a, b, body] = n.args.map(toMathJson);
      return [n.op, body, ['Limits', k, a, b]];
    }
    // Cálculo: lim, d/dx e ∫ com a função como primeiro argumento.
    case 'Limit': {
      const [x, a, f] = n.args.map(toMathJson);
      return ['Limit', ['Function', f, x], a, ...(n.dir ? [n.dir === '+' ? 'Right' : 'Left'] : [])];
    }
    case 'D': {
      const [x, f] = n.args.map(toMathJson);
      return ['D', f, ...Array(n.order ?? 1).fill(x)];
    }
    case 'Integrate': {
      const [x, ...rest] = n.args.map(toMathJson);
      const f = rest.pop();
      return ['Integrate', f, rest.length ? ['Limits', x, ...rest] : x];
    }
    case 'EvalAt': {
      const [x, a, b, F] = n.args.map(toMathJson);
      return ['EvaluateAt', F, x, a, b];
    }
    case 'Call': {
      const head = n.primes ? ['Derivative', n.name, n.primes] : n.name;
      return n.primes ? ['Apply', head, ...n.args.map(toMathJson)] : [n.name, ...n.args.map(toMathJson)];
    }
    default: return [n.op, ...n.args.map(toMathJson)];
  }
}

export function fromMathJson(j) {
  if (typeof j === 'number') return num(j);
  if (typeof j === 'string') return sym(j);
  if (Array.isArray(j)) {
    const [op, ...args] = j;
    const limits = ['Limits', 'Tuple', 'Triple', 'Hold'];
    if ((op === 'Sum' || op === 'Product') && Array.isArray(args[1]) && limits.includes(args[1][0])) {
      const [, k, a, b] = args[1].map(fromMathJson);
      return fn(op, k, a, b, fromMathJson(args[0]));
    }
    if (op === 'Limit') {
      const [f, a, dir] = args;
      const [body, x] = Array.isArray(f) && f[0] === 'Function' ? [f[1], f[2]] : [f, 'x'];
      const node = fn('Limit', fromMathJson(x), fromMathJson(a), fromMathJson(body));
      return dir === 'Right' || dir === 'Left' ? { ...node, dir: dir === 'Right' ? '+' : '-' } : node;
    }
    if (op === 'D') {
      const [f, x, ...more] = args;
      const node = fn('D', fromMathJson(x), fromMathJson(f));
      return more.length ? { ...node, order: more.length + 1 } : node;
    }
    if (op === 'Integrate') {
      const [f, lim] = args;
      if (Array.isArray(lim) && limits.includes(lim[0])) {
        const [, x, a, b] = lim.map(fromMathJson);
        return fn('Integrate', x, a, b, fromMathJson(f));
      }
      return fn('Integrate', fromMathJson(lim ?? 'x'), fromMathJson(f));
    }
    if (op === 'EvaluateAt') {
      const [F, x, a, b] = args.map(fromMathJson);
      return fn('EvalAt', x, a, b, F);
    }
    if (op === 'Apply' && Array.isArray(args[0]) && args[0][0] === 'Derivative') {
      const [, name, k = 1] = args[0];
      return call(name, args.slice(1).map(fromMathJson), k);
    }
    // Funções do usuário: ["f", "x"].
    if (typeof op === 'string' && /^[a-z]$/.test(op)) return call(op, args.map(fromMathJson));
    return fn(op === 'And' ? 'System' : op, ...args.map(fromMathJson));
  }
  if (j && typeof j === 'object') {
    if ('num' in j) return num(j.num);
    if ('sym' in j) return sym(j.sym);
    if ('fn' in j) return fromMathJson(j.fn);
  }
  throw new Error('MathJSON inválido: ' + JSON.stringify(j));
}
