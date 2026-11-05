// Forma normal polinomial, só para reconhecer padrões (nunca é mostrada):
// expande produtos e potências pequenas, junta termos semelhantes, calcula
// os números e ordena tudo. Assim n − k − 1, −1 − k + n e
// ((n + 1) − (k + 1)) − 1 têm a mesma forma normal.
//
// Polinômio: Map(chave do monômio → { coef: racional, mono }), com
// mono: Map(chave do átomo → expoente). Átomos são os símbolos e os nós que
// não são polinomiais (n!, sen x, a/b...), com os argumentos já em forma
// normal: (n − k)! e (−k + n)! são o mesmo átomo.

import { toAscii, looseSame } from '../serialize.js';
import { msg } from '../i18n.js';
import { tagOf } from '../ast.js';
import { evaluate } from './arith.js';

const MAX_TERMS = 200;
const MAX_POWER = 12;

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
const addR = (a, b) => rat(a.n * b.d + b.n * a.d, a.d * b.d);
const mulR = (a, b) => rat(a.n * b.n, a.d * b.d);

const monoKey = (mono) => [...mono].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  .map(([k, e]) => (e === 1 ? k : `${k}^${e}`)).join('*');

const constant = (c) => new Map(c.n === 0n ? [] : [['', { coef: c, mono: new Map() }]]);
const atom = (key) => {
  const mono = new Map([[key, 1]]);
  return new Map([[monoKey(mono), { coef: rat(1n), mono }]]);
};

function addInto(out, { coef, mono }) {
  const k = monoKey(mono);
  const prev = out.get(k);
  const c = prev ? addR(prev.coef, coef) : coef;
  if (c.n === 0n) out.delete(k);
  else out.set(k, { coef: c, mono });
}

function sum(ps) {
  const out = new Map();
  for (const p of ps) for (const t of p.values()) addInto(out, t);
  return out;
}

function product(a, b) {
  const out = new Map();
  for (const x of a.values()) {
    for (const y of b.values()) {
      const mono = new Map(x.mono);
      for (const [k, e] of y.mono) mono.set(k, (mono.get(k) ?? 0) + e);
      addInto(out, { coef: mulR(x.coef, y.coef), mono });
    }
  }
  if (out.size > MAX_TERMS) throw new RangeError('grande demais');
  return out;
}

const scale = (p, c) => product(p, constant(c));

function polyOf(n) {
  const v = evaluate(n);
  if (v) return constant(rat(v.n, v.d));
  switch (n.op) {
    case 'Symbol': return atom(n.name);
    case 'Delimiter': return polyOf(n.args[0]);
    case 'Negate': return scale(polyOf(n.args[0]), rat(-1n));
    case 'Add': return sum(n.args.map(polyOf));
    case 'Multiply': return n.args.map(polyOf).reduce(product);
    case 'Power': {
      const e = evaluate(n.args[1]);
      if (e && e.d === 1n && e.n >= 0n && e.n <= BigInt(MAX_POWER)) {
        const base = polyOf(n.args[0]);
        let acc = constant(rat(1n));
        for (let i = 0n; i < e.n; i++) acc = product(acc, base);
        return acc;
      }
      break;
    }
    case 'Divide': {
      const d = evaluate(n.args[1]);
      if (d && d.n !== 0n) return scale(polyOf(n.args[0]), rat(d.d, d.n));
      break;
    }
    default:
  }
  // Átomo: operador e argumentos em forma normal (o índice de Σ entra como nome).
  return atom(`${n.op}${tagOf(n)}(${(n.args ?? []).map(keyOf).join(',')})`);
}

const polyKey = (p) => [...p.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  .map(([k, { coef }]) => `${coef.n}/${coef.d}${k && '·' + k}`).join(' + ') || '0';

// Chave da forma normal; se a expansão crescer demais, a própria escrita.
// A árvore é imutável, então a chave de cada nó é guardada.
const keys = new WeakMap();
export function keyOf(n) {
  if (keys.has(n)) return keys.get(n);
  let k;
  try {
    k = polyKey(polyOf(n));
  } catch (e) {
    if (!(e instanceof RangeError)) throw e;
    k = 'raw:' + toAscii(n);
  }
  keys.set(n, k);
  return k;
}

// Mesma forma normal: iguais como polinômios.
export const equivalent = (a, b) => keyOf(a) === keyOf(b);

// ------------------------------------------------ comparação nas regras
//
// As regras comparam subexpressões com matches(a, b): vale a igualdade
// literal (a menos de parênteses e de associatividade) e, se ela falhar, a
// igualdade como polinômios. No segundo caso a igualdade usada é anotada
// e aparece no rótulo do passo ("…, usando −1 − k + n = n − k − 1"), para
// o professor decidir se mostra a reorganização antes.

// Achata somas dentro de somas e produtos dentro de produtos, sem parênteses:
// ((n + 1) − (k + 1)) − 1 e (n + 1) − (k + 1) − 1 são a mesma expressão.
function flatten(n) {
  while (n.op === 'Delimiter') n = n.args[0];
  if (!n.args) return n;
  const args = n.args.map(flatten);
  const assoc = n.op === 'Add' || n.op === 'Multiply';
  return { ...n, args: assoc ? args.flatMap((a) => (a.op === n.op ? a.args : [a])) : args };
}

// Igualdade a menos de parênteses e de associatividade (sem anotação).
export const literal = (a, b) => looseSame(flatten(a), flatten(b));

let notes = [];
const show = (x) => {
  while (x.op === 'Delimiter') x = x.args[0];
  return toAscii(x).replace(/-/g, '−').replace(/\*/g, '·');
};

export function matches(a, b) {
  if (literal(a, b)) return true;
  if (!equivalent(a, b)) return false;
  const [x, y] = [show(a), show(b)];
  if (!notes.includes(`${x} = ${y}`) && !notes.includes(`${y} = ${x}`)) notes.push(`${x} = ${y}`);
  return true;
}

// Começa uma tentativa: esquece anotações de tentativas que não deram certo.
export const attempt = () => { notes = []; };

// Rótulo com as igualdades anotadas (que são consumidas).
export function noted(label) {
  const m = notes.length ? msg('step.using', { step: label, eq: notes.join('; ') }) : label;
  notes = [];
  return m;
}

// Envolve uma regra: começa sem anotações e põe as que sobrarem no rótulo
// de cada resultado (uma regra pode devolver uma lista de formas).
export function withNotes(f) {
  return (ctx) => {
    attempt();
    const r = f(ctx);
    if (!notes.length) return r;
    const add = (x) => (x?.tree && x.label?.key !== 'step.using' ? { ...x, label: noted(x.label) } : x);
    const pending = notes;
    const out = Array.isArray(r) ? r.map((x) => { notes = pending; return add(x); }) : add(r);
    notes = [];
    return out;
  };
}
