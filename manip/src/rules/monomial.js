// Monômios normalizados, para reconhecer padrões sem depender da ordem em
// que os fatores foram escritos: 6x, x·6 e 2·x·3 são o mesmo monômio.
// Um monômio é { coef: racional, factors: Map(chave → expoente) }; a chave
// de um fator não numérico é o seu texto ASCII.

import { num, fn } from '../ast.js';
import { toAscii } from '../serialize.js';
import { evaluate } from './arith.js';

const gcd = (a, b) => {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
};
const rat = (n, d = 1n) => {
  if (d < 0n) { n = -n; d = -d; }
  const g = gcd(n, d) || 1n;
  return { n: n / g, d: d / g };
};
const mulR = (a, b) => rat(a.n * b.n, a.d * b.d);

export function monomial(node) {
  const v = evaluate(node);
  if (v) return { coef: rat(v.n, v.d), factors: new Map() };
  switch (node.op) {
    case 'Delimiter': return monomial(node.args[0]);
    case 'Negate': {
      const m = monomial(node.args[0]);
      return m && { coef: rat(-m.coef.n, m.coef.d), factors: m.factors };
    }
    case 'Multiply': {
      let acc = { coef: rat(1n), factors: new Map() };
      for (const c of node.args) {
        const m = monomial(c);
        if (!m) return null;
        const factors = new Map(acc.factors);
        for (const [k, e] of m.factors) factors.set(k, (factors.get(k) ?? 0) + e);
        acc = { coef: mulR(acc.coef, m.coef), factors };
      }
      return acc;
    }
    case 'Power': {
      const e = evaluate(node.args[1]);
      if (e && e.d === 1n && e.n > 0n && e.n <= 64n) {
        const m = monomial(node.args[0]);
        if (!m) return null;
        let coef = rat(1n);
        for (let i = 0n; i < e.n; i++) coef = mulR(coef, m.coef);
        return { coef, factors: new Map([...m.factors].map(([k, x]) => [k, x * Number(e.n)])) };
      }
      return { coef: rat(1n), factors: new Map([[toAscii(node), 1]]) };
    }
    default:
      return { coef: rat(1n), factors: new Map([[toAscii(node), 1]]) };
  }
}

export function sameMonomial(a, b) {
  if (!a || !b || a.coef.n !== b.coef.n || a.coef.d !== b.coef.d) return false;
  const keys = new Set([...a.factors.keys(), ...b.factors.keys()]);
  return [...keys].every((k) => (a.factors.get(k) ?? 0) === (b.factors.get(k) ?? 0));
}

export const negateMonomial = (m) => m && { coef: rat(-m.coef.n, m.coef.d), factors: m.factors };

// Raiz quadrada exata de um inteiro não negativo (BigInt), ou null.
function isqrt(n) {
  if (n < 0n) return null;
  if (n < 2n) return n;
  let x = BigInt(Math.floor(Math.sqrt(Number(n))));
  while (x * x > n) x--;
  while ((x + 1n) * (x + 1n) <= n) x++;
  return x * x === n ? x : null;
}

// A "raiz" de um termo que é um quadrado, escrita a partir do próprio termo:
// x² → x, 9 → 3, 4x² → 2x, x⁴ → x², (a+b)² → a+b. Devolve null se o termo
// não for um quadrado perfeito visível (ou se for negativo).
export function squareRoot(t) {
  switch (t.op) {
    case 'Number': {
      const v = evaluate(t);
      const a = v && isqrt(v.n);
      const b = v && isqrt(v.d);
      if (a === null || b === null || !v) return null;
      return b === 1n ? num(a.toString()) : fn('Divide', num(a.toString()), num(b.toString()));
    }
    case 'Power': {
      const e = evaluate(t.args[1]);
      if (!e || e.d !== 1n || e.n < 2n || e.n % 2n) return null;
      return e.n === 2n ? t.args[0] : fn('Power', t.args[0], num((e.n / 2n).toString()));
    }
    case 'Multiply': {
      const roots = t.args.map(squareRoot);
      if (roots.some((r) => !r)) return null;
      return fn('Multiply', ...roots);
    }
    case 'Divide': {
      const a = squareRoot(t.args[0]);
      const b = squareRoot(t.args[1]);
      return a && b ? fn('Divide', a, b) : null;
    }
    case 'Delimiter': return squareRoot(t.args[0]);
    default: return null;
  }
}
