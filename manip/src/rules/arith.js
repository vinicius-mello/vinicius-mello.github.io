// Aritmética exata com racionais e complexos de coordenadas racionais
// (BigInt), usada só quando o usuário pede para calcular uma subexpressão.

import { num, fn, sym } from '../ast.js';

const gcd = (a, b) => {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
};

function rat(n, d = 1n) {
  if (d === 0n) return null;
  if (d < 0n) { n = -n; d = -d; }
  const g = gcd(n, d) || 1n;
  return { n: n / g, d: d / g };
}

function parseNumber(s) {
  const [int, frac = ''] = s.split('.');
  return rat(BigInt(int + frac || '0'), 10n ** BigInt(frac.length));
}

const add = (a, b) => rat(a.n * b.d + b.n * a.d, a.d * b.d);
const mul = (a, b) => rat(a.n * b.n, a.d * b.d);
const div = (a, b) => (b.n === 0n ? null : rat(a.n * b.d, a.d * b.n));

const DECIMAL = Symbol('decimal');

// ---------- complexos com coordenadas racionais: { re, im } ----------

const ZERO = () => rat(0n);
const cx = (re, im = ZERO()) => (re && im ? { re, im } : null);
const isZero = (r) => r.n === 0n;

const cadd = (a, b) => cx(add(a.re, b.re), add(a.im, b.im));
const cneg = (a) => cx(rat(-a.re.n, a.re.d), rat(-a.im.n, a.im.d));
const cconj = (a) => cx(a.re, rat(-a.im.n, a.im.d));
const cmul = (a, b) => cx(
  add(mul(a.re, b.re), mul(rat(-1n), mul(a.im, b.im))),
  add(mul(a.re, b.im), mul(a.im, b.re)),
);
const norm2 = (a) => add(mul(a.re, a.re), mul(a.im, a.im));
function cdiv(a, b) {
  const d = norm2(b);
  if (isZero(d)) return null;
  const p = cmul(a, cconj(b));
  return cx(div(p.re, d), div(p.im, d));
}
function cpow(a, e) {
  if (!isZero(e.im) || e.re.d !== 1n) return null;
  let k = e.re.n < 0n ? -e.re.n : e.re.n;
  if (k > 1000n) return null;
  let r = cx(rat(1n));
  for (; k > 0n; k--) r = cmul(r, a);
  return e.re.n < 0n ? cdiv(cx(rat(1n)), r) : r;
}

// Raiz quadrada exata de um racional não negativo, ou null.
function bigSqrt(n) {
  if (n < 0n) return null;
  if (n < 2n) return n;
  let x = BigInt(Math.floor(Math.sqrt(Number(n))));
  while (x * x > n) x--;
  while ((x + 1n) * (x + 1n) <= n) x++;
  return x * x === n ? x : null;
}
function ratSqrt(r) {
  const a = bigSqrt(r.n);
  const b = bigSqrt(r.d);
  return a === null || b === null ? null : rat(a, b);
}

// Valor de uma subárvore puramente numérica (pode conter i), ou null.
export function evaluateComplex(n) {
  const dec = (v, ...from) => {
    if (v && from.some((x) => x?.[DECIMAL])) v[DECIMAL] = true;
    return v;
  };
  switch (n.op) {
    case 'Number': {
      const v = cx(parseNumber(n.value));
      if (n.value.includes('.')) v[DECIMAL] = true;
      return v;
    }
    case 'Symbol': return n.name === 'ImaginaryUnit' ? cx(ZERO(), rat(1n)) : null;
    case 'Delimiter': return evaluateComplex(n.args[0]);
    case 'Negate': {
      const a = evaluateComplex(n.args[0]);
      return a && dec(cneg(a), a);
    }
    case 'Add': case 'Multiply': {
      let acc = null;
      for (const c of n.args) {
        const v = evaluateComplex(c);
        if (!v) return null;
        acc = acc ? dec(n.op === 'Add' ? cadd(acc, v) : cmul(acc, v), acc, v) : v;
      }
      return acc;
    }
    case 'Divide': {
      const a = evaluateComplex(n.args[0]);
      const b = evaluateComplex(n.args[1]);
      return a && b && dec(cdiv(a, b), a, b);
    }
    case 'Power': {
      const a = evaluateComplex(n.args[0]);
      const b = evaluateComplex(n.args[1]);
      return a && b && dec(cpow(a, b), a, b);
    }
    case 'Conjugate': {
      const a = evaluateComplex(n.args[0]);
      return a && dec(cconj(a), a);
    }
    case 'Real': case 'Imaginary': {
      const a = evaluateComplex(n.args[0]);
      return a && dec(cx(n.op === 'Real' ? a.re : a.im), a);
    }
    case 'Abs': {
      const a = evaluateComplex(n.args[0]);
      const r = a && ratSqrt(norm2(a));
      return r && dec(cx(r), a);
    }
    default: return null;
  }
}

// Valor racional (real) de uma subárvore numérica, ou null.
export function evaluate(n) {
  const v = evaluateComplex(n);
  if (!v || !isZero(v.im)) return null;
  if (v[DECIMAL]) v.re[DECIMAL] = true;
  return v.re;
}

// Nó para um complexo: 3, 2i, −i, 3 − 2i, 1/2 + (1/2)i...
export function complexToNode(v) {
  const flagged = (r) => {
    if (v[DECIMAL]) r[DECIMAL] = true;
    return r;
  };
  if (isZero(v.im)) return ratToNode(flagged(v.re));
  const neg = v.im.n < 0n;
  const abs = flagged(rat(neg ? -v.im.n : v.im.n, v.im.d));
  const unit = sym('ImaginaryUnit');
  const coef = ratToNode(abs);
  const imag = coef.op === 'Number' && coef.value === '1' ? unit : fn('Multiply', coef, unit);
  if (isZero(v.re)) return neg ? fn('Negate', imag) : imag;
  return fn('Add', ratToNode(flagged(v.re)), neg ? fn('Negate', imag) : imag);
}

function terminatingDecimal({ n, d }) {
  let k = d;
  let twos = 0, fives = 0;
  while (k % 2n === 0n) { k /= 2n; twos++; }
  while (k % 5n === 0n) { k /= 5n; fives++; }
  if (k !== 1n) return null;
  const places = Math.max(twos, fives);
  const scaled = (n < 0n ? -n : n) * 10n ** BigInt(places) / d;
  const s = scaled.toString().padStart(places + 1, '0');
  return places ? `${s.slice(0, -places)}.${s.slice(-places)}` : s;
}

// Nó que representa o racional: 4, −4, 3/4, −3/4 ou 0.75 (se veio de decimais).
export function ratToNode(r) {
  const neg = r.n < 0n;
  const abs = { n: neg ? -r.n : r.n, d: r.d };
  let node;
  if (abs.d === 1n) node = num(abs.n.toString());
  else if (r[DECIMAL] && terminatingDecimal(abs)) node = num(terminatingDecimal(abs));
  else node = fn('Divide', num(abs.n.toString()), num(abs.d.toString()));
  return neg ? fn('Negate', node) : node;
}
