// Regras de Cálculo: derivadas (tecla '), integrais (u) e limites (a).
// Como as demais, cada regra tira uma camada por vez: a regra da cadeia
// deixa d/dx(u) por fazer, e nada é calculado sozinho.
//
// Nós (ast.js): D(x, f) com order · Integrate(x, f) e Integrate(x, a, b, f)
// · Limit(x, a, f) com dir · EvalAt(x, a, b, F) · Call (f(x), f'(x)).

import { getAt, replaceAt, fn, num, sym, call, walk, INFINITY } from '../ast.js';
import { msg } from '../i18n.js';
import { isRelation } from '../relations.js';
import { parseInput } from '../input.js';
import { toAscii } from '../serialize.js';
import { evaluate } from './arith.js';
import { literal, matches, noted } from './normal.js';
import { unparen, parentPath, cloneFrom, rebuild, place } from './util.js';
import { freeOf, offset, instantiate, freshIndex } from './combinatorics.js';

const copy = (n) => cloneFrom(n, {});
const label = (key, params) => noted(msg(key, params));
const done = (tree, p, node, key, params) => ({ tree: place(tree, p, node), label: label(key, params), focus: node.id });

const isVar = (n, x) => unparen(n).op === 'Symbol' && unparen(n).name === x;
const deriv = (x, f) => fn('D', sym(x), f);
const mul = (...fs) => rebuild('Multiply', fs.filter(Boolean));
const neg = (n) => fn('Negate', n);
const pow = (b, e) => fn('Power', b, typeof e === 'number' ? num(e) : e);

// Nó de cálculo do tipo `op` no foco ou acima dele (sem passar da relação).
function calcAt(ctx, op) {
  let p = ctx.focus;
  for (;;) {
    const n = getAt(ctx.tree, p);
    if (n.op === op) return p;
    if (!p.length || isRelation(n.op)) return null;
    p = parentPath(p);
  }
}

// --------------------------------------------------------------- derivadas

// Derivada das funções da tabela, com a regra da cadeia: f(u) → f′(u)·du.
// du é null quando u é a própria variável (o fator dx/dx = 1 é omitido).
const DERIVATIVES = {
  Sin: (u, du) => mul(fn('Cos', u), du),
  Cos: (u, du) => neg(mul(fn('Sin', u), du)),
  Tan: (u, du) => mul(pow(fn('Sec', u), 2), du),
  Sec: (u, du) => mul(fn('Sec', u), fn('Tan', copy(u)), du),
  Csc: (u, du) => neg(mul(fn('Csc', u), fn('Cot', copy(u)), du)),
  Cot: (u, du) => neg(mul(pow(fn('Csc', u), 2), du)),
  Sinh: (u, du) => mul(fn('Cosh', u), du),
  Cosh: (u, du) => mul(fn('Sinh', u), du),
  Tanh: (u, du) => fn('Divide', du ?? num(1), pow(fn('Cosh', u), 2)),
  Exp: (u, du) => mul(fn('Exp', u), du),
  Ln: (u, du) => fn('Divide', du ?? num(1), u),
  Log: (u, du, b) => fn('Divide', du ?? num(1), mul(u, fn('Ln', b))),
  Sqrt: (u, du) => fn('Divide', du ?? num(1), mul(num(2), fn('Sqrt', u))),
  Arcsin: (u, du) => fn('Divide', du ?? num(1), fn('Sqrt', fn('Add', num(1), neg(pow(u, 2))))),
  Arccos: (u, du) => neg(fn('Divide', du ?? num(1), fn('Sqrt', fn('Add', num(1), neg(pow(u, 2)))))),
  Arctan: (u, du) => fn('Divide', du ?? num(1), fn('Add', num(1), pow(u, 2))),
  Abs: (u, du) => mul(fn('Divide', u, fn('Abs', copy(u))), du),
};

// d/dx de uma subexpressão, por fazer (ou null se ela é o próprio x).
const inner = (x, u) => (isVar(u, x) ? null : deriv(x, copy(u)));

// Formas de d/dx f, conforme a forma de f (a primeira é a mais natural).
function derivForms(ctx) {
  const p = calcAt(ctx, 'D');
  if (!p) return [];
  const { tree } = ctx;
  const D = getAt(tree, p);
  const [xs, body] = D.args;
  const x = xs.name;
  const f = unparen(body);
  const out = [];
  const add = (node, key, params) => out.push(done(tree, p, node, key, params));

  // dⁿ/dxⁿ f = d/dx(dⁿ⁻¹/dxⁿ⁻¹ f) · f″(x)
  if ((D.order ?? 1) > 1) {
    const lower = { ...deriv(x, body), order: D.order - 1 };
    if (D.order === 2) delete lower.order;
    add(deriv(x, lower), 'step.dOrder');
    if (f.op === 'Call' && f.args.length === 1 && isVar(f.args[0], x)) add(call(f.name, [copy(f.args[0])], (f.primes ?? 0) + D.order), 'step.dPrime');
    return out;
  }

  if (freeOf(f, x)) add(num(0), 'step.dConst');
  else if (f.op === 'Symbol') add(num(1), 'step.dVar');
  else if (f.op === 'Add') {
    // linearidade: (f + g)′ = f′ + g′, (−g)′ = −g′
    add(fn('Add', ...f.args.map((t) => (t.op === 'Negate' ? neg(deriv(x, t.args[0])) : deriv(x, t)))), 'step.dSum');
  } else if (f.op === 'Negate') {
    add(neg(deriv(x, f.args[0])), 'step.dPull');
  } else if (f.op === 'Multiply') {
    const consts = f.args.filter((a) => freeOf(a, x));
    const rest = f.args.filter((a) => !freeOf(a, x));
    if (consts.length) add(mul(...consts, deriv(x, rebuild('Multiply', rest))), 'step.dPull');
    // regra do produto: (fg)′ = f′g + fg′ (com mais fatores, um termo por fator)
    if (rest.length > 1 || !consts.length) {
      // os nós originais ficam no primeiro termo (animação); os outros são cópias
      const first = f.args.findIndex((a) => !freeOf(a, x));
      const terms = f.args.map((a, i) => (freeOf(a, x) ? null : mul(...f.args.map((b, j) => {
        const c = i === first ? b : copy(b);
        return j === i ? deriv(x, c) : c;
      }))));
      add(fn('Add', ...terms.filter(Boolean)), 'step.dProduct');
    }
  } else if (f.op === 'Divide') {
    const [u, v] = f.args;
    if (freeOf(v, x)) add(fn('Divide', deriv(x, u), v), 'step.dPull');
    else {
      // regra do quociente: (u/v)′ = (u′v − uv′)/v²
      const top = fn('Add', mul(deriv(x, u), v), neg(mul(copy(u), deriv(x, copy(v)))));
      add(fn('Divide', top, pow(copy(v), 2)), 'step.dQuotient');
    }
  } else if (f.op === 'Power') {
    const [b, e] = f.args;
    if (freeOf(e, x)) {
      // regra da potência: (uⁿ)′ = n·uⁿ⁻¹·u′
      // x² → 2x: o expoente 1 não é escrito
      const e1 = offset(e, -1);
      const power = e1.op === 'Number' && e1.value === '1' ? b : pow(b, e1);
      add(mul(e, power, inner(x, b)), isVar(b, x) ? 'step.dPower' : 'step.dChain');
    } else if (freeOf(b, x)) {
      // exponencial: (aᵘ)′ = aᵘ·ln a·u′ · (eᵘ)′ = eᵘ·u′
      const isE = b.op === 'Symbol' && b.name === 'e';
      add(mul(pow(b, e), isE ? null : fn('Ln', copy(b)), inner(x, e)), 'step.dExp');
    }
  } else if (f.op === 'Integrate' && f.args.length === 4 && f.args[0].name !== x) {
    // teorema fundamental: d/dx ∫ₐ^(b(x)) f(t) dt = f(b)·b′ − f(a)·a′
    const [t, lo, hi, g] = f.args;
    const at = (e) => (freeOf(e, x) ? null : mul(instantiate(g, t.name, e), inner(x, e)));
    const parts = [at(hi), at(lo) && neg(at(lo))].filter(Boolean);
    add(parts.length === 1 ? parts[0] : fn('Add', ...parts), 'step.iFTC');
  } else if (f.op === 'Call' && f.args.length === 1) {
    // f(x) → f′(x) · f(u) → f′(u)·u′
    const u = f.args[0];
    add(mul(call(f.name, [u], (f.primes ?? 0) + 1), inner(x, u)), isVar(u, x) ? 'step.dPrime' : 'step.dChain');
  } else if (DERIVATIVES[f.op] && (f.args.length === 1 || f.op === 'Log')) {
    // log sem base é o decimal
    const [u, b] = f.args;
    add(DERIVATIVES[f.op](u, inner(x, u), b ? copy(b) : num(10)), isVar(u, x) ? 'step.dTable' : 'step.dChain');
  }

  // definição: f′(x) = lim_(h→0) (f(x + h) − f(x))/h
  if (!freeOf(f, x)) {
    const h = freshIndex(tree, ['h', 'k', 't']);
    const moved = instantiate(f, x, fn('Add', sym(x), sym(h)));
    const quotient = fn('Divide', fn('Add', moved, neg(copy(f))), sym(h));
    add(fn('Limit', sym(h), num(0), quotient), 'step.dDef');
  }
  return out;
}

// f′(x) → d/dx f(x) (notação de Leibniz)
function leibniz(ctx) {
  const { tree, focus } = ctx;
  for (const p of [focus, focus.length ? parentPath(focus) : null]) {
    if (!p) continue;
    const f = getAt(tree, p);
    if (f.op !== 'Call' || !f.primes || f.args.length !== 1 || unparen(f.args[0]).op !== 'Symbol') continue;
    const x = unparen(f.args[0]).name;
    const node = deriv(x, call(f.name, [f.args[0]]));
    return done(tree, p, f.primes > 1 ? { ...node, order: f.primes } : node, 'step.dLeibniz');
  }
  return null;
}

// d/dx f + d/dx g → d/dx(f + g) · c·d/dx f → d/dx(c·f): os sentidos inversos
// da linearidade, com o foco na soma, no produto ou num dos termos.
function derivJoin(ctx) {
  const { tree, focus } = ctx;
  const isD = (t) => t.op === 'D' && !t.order;
  for (const p of [focus, focus.length ? parentPath(focus) : null]) {
    if (!p) continue;
    const n = getAt(tree, p);
    if (n.op === 'Add' && n.args.length > 1) {
      const ds = n.args.map((t) => (isD(t) ? t : t.op === 'Negate' && isD(t.args[0]) ? t.args[0] : null));
      const x = ds[0]?.args[0].name;
      if (ds.every((d) => d && d.args[0].name === x)) {
        const body = fn('Add', ...n.args.map((t, i) => (t.op === 'Negate' ? neg(ds[i].args[1]) : ds[i].args[1])));
        return done(tree, p, deriv(x, body), 'step.dSumInv');
      }
    }
    if (n.op === 'Multiply') {
      const k = n.args.findIndex(isD);
      const x = n.args[k]?.args[0].name;
      if (k >= 0 && n.args.every((a, i) => i === k || freeOf(a, x))) {
        const body = mul(...n.args.filter((_, i) => i !== k), n.args[k].args[1]);
        return done(tree, p, deriv(x, body), 'step.dPullInv');
      }
    }
  }
  return null;
}

export const DERIVATIVE_RULES = [derivForms, leibniz, derivJoin];

// ------------------------------------------------- avaliação aproximada
//
// Só para conferir passos (substituição): f(x) em ponto flutuante.

const FLOAT = {
  Sin: Math.sin, Cos: Math.cos, Tan: Math.tan, Sec: (v) => 1 / Math.cos(v), Csc: (v) => 1 / Math.sin(v),
  Cot: (v) => 1 / Math.tan(v), Arcsin: Math.asin, Arccos: Math.acos, Arctan: Math.atan,
  Sinh: Math.sinh, Cosh: Math.cosh, Tanh: Math.tanh, Exp: Math.exp, Ln: Math.log,
  Sqrt: Math.sqrt, Abs: Math.abs,
};

export function numeric(n, env) {
  const ev = (x) => numeric(x, env);
  switch (n.op) {
    case 'Number': return Number(n.value);
    case 'Symbol':
      if (n.name in env) return env[n.name];
      return n.name === 'e' ? Math.E : n.name === 'pi' ? Math.PI : n.name === INFINITY ? Infinity : NaN;
    case 'Delimiter': return ev(n.args[0]);
    case 'Negate': return -ev(n.args[0]);
    case 'Add': return n.args.reduce((acc, c) => acc + ev(c), 0);
    case 'Multiply': return n.args.reduce((acc, c) => acc * ev(c), 1);
    case 'Divide': return ev(n.args[0]) / ev(n.args[1]);
    case 'Power': return ev(n.args[0]) ** ev(n.args[1]);
    case 'Root': return ev(n.args[0]) ** (1 / ev(n.args[1]));
    case 'Log': return Math.log(ev(n.args[0])) / Math.log(n.args[1] ? ev(n.args[1]) : 10);
    default: return FLOAT[n.op] && n.args.length === 1 ? FLOAT[n.op](ev(n.args[0])) : NaN;
  }
}

// Pontos de teste (evitam 0, 1 e inteiros, onde coincidências são comuns).
const SAMPLES = [0.3711, 0.6173, 0.8429, 1.2917, 1.7303];
const close = (a, b) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));

// Fração simples (denominador até 100) próxima de v, ou null.
function simpleRatio(v) {
  for (let d = 1; d <= 100; d++) {
    const n = Math.round(v * d);
    if (Math.abs(v - n / d) < 1e-7) return { n, d };
  }
  return null;
}
const ratioNode = ({ n, d }) => {
  const a = d === 1 ? num(Math.abs(n)) : fn('Divide', num(Math.abs(n)), num(d));
  return n < 0 ? neg(a) : a;
};

// ---------------------------------------------------------------- integrais

const integral = (I, body) => (I.args.length === 4
  ? fn('Integrate', sym(I.args[0].name), copy(I.args[1]), copy(I.args[2]), body)
  : fn('Integrate', sym(I.args[0].name), body));
const isIndefinite = (n) => n.op === 'Integrate' && n.args.length === 2;
const bodyOf = (I) => I.args[I.args.length - 1];

// Tabela de primitivas, na variável x (instanciada na variável da integral).
const TABLE = [
  ['x', 'x^2/2'], ['1/x', 'ln(abs(x))'], ['x^(-1)', 'ln(abs(x))'],
  ['e^x', 'e^x'], ['exp(x)', 'exp(x)'],
  ['sin(x)', '-cos(x)'], ['cos(x)', 'sin(x)'], ['tan(x)', '-ln(abs(cos(x)))'],
  ['sec(x)^2', 'tan(x)'], ['1/cos(x)^2', 'tan(x)'], ['csc(x)^2', '-cot(x)'], ['1/sin(x)^2', '-cot(x)'],
  ['sec(x)tan(x)', 'sec(x)'], ['csc(x)cot(x)', '-csc(x)'],
  ['sinh(x)', 'cosh(x)'], ['cosh(x)', 'sinh(x)'],
  ['1/(1 + x^2)', 'arctan(x)'], ['1/sqrt(1 - x^2)', 'arcsin(x)'],
];
let table = null;
const tableIn = (x) => {
  table ??= TABLE.map(([f, F]) => [parseInput(f), parseInput(F)]);
  return table.map(([f, F]) => [instantiate(f, 'x', sym(x)), instantiate(F, 'x', sym(x))]);
};

// Primitiva imediata de f em x (sem a constante), ou null.
export function antiderivative(body, x) {
  const f = unparen(body);
  if (freeOf(f, x)) return isNumOne(f) ? sym(x) : mul(copy(f), sym(x));
  if (f.op === 'Power' && isVar(f.args[0], x) && freeOf(f.args[1], x)) {
    const v = evaluate(f.args[1]);
    if (v && v.n === -v.d) return fn('Ln', fn('Abs', sym(x)));
    const e1 = offset(f.args[1], 1);
    return fn('Divide', pow(sym(x), e1), copy(e1));
  }
  if (f.op === 'Power' && freeOf(f.args[0], x) && isVar(f.args[1], x)) {
    const b = f.args[0];
    if (b.op === 'Symbol' && b.name === 'e') return pow(sym('e'), sym(x));
    return fn('Divide', pow(copy(b), sym(x)), fn('Ln', copy(b)));
  }
  // ∫ f′(x) dx = f(x) · ∫ d/dx g dx = g
  if (f.op === 'Call' && f.primes && f.args.length === 1 && isVar(f.args[0], x)) return call(f.name, [sym(x)], f.primes - 1);
  if (f.op === 'D' && !f.order && f.args[0].name === x) return copy(f.args[1]);
  for (const [g, G] of tableIn(x)) if (matches(f, g)) return G;
  return null;
}
const isNumOne = (n) => n.op === 'Number' && n.value === '1';

// Põe a constante de integração no lado da relação, se ali não sobrou
// nenhuma integral indefinida (a integral foi resolvida).
function withConstant(tree, p) {
  const sideP = isRelation(tree.op) ? p.slice(0, 1) : [];
  const side = getAt(tree, sideP);
  let open = false;
  walk(side, (n) => { if (isIndefinite(n)) open = true; });
  if (open) return tree;
  const used = new Set();
  walk(tree, (n) => { if (n.op === 'Symbol') used.add(n.name); });
  const name = ['C', 'C_1', 'C_2', 'C_3', 'K'].find((c) => !used.has(c)) ?? 'C';
  const node = side.op === 'Add' ? { ...side, args: [...side.args, sym(name)] } : fn('Add', side, sym(name));
  return replaceAt(tree, sideP, node);
}

// Integral no foco ou acima dele. As formas "extras" (inverter os limites,
// soma de Riemann) ficam numa operação à parte, depois da substituição.
function integralForms(ctx, extra = false) {
  const p = calcAt(ctx, 'Integrate');
  if (!p) return [];
  const { tree } = ctx;
  const I = getAt(tree, p);
  const x = I.args[0].name;
  const definite = I.args.length === 4;
  const body = bodyOf(I);
  const f = unparen(body);
  const out = [];
  const add = (node, key) => out.push(done(tree, p, node, key));

  if (extra) {
    if (!definite) return [];
    const [, a, b] = I.args;
    add(neg(fn('Integrate', sym(x), b, a, body)), 'step.iSwap');
    // soma de Riemann: lim_(n→∞) Σ_(k=1)^n f(a + kΔx)Δx, Δx = (b − a)/n
    const n = freshIndex(tree, ['n', 'N', 'm']);
    const k = freshIndex(tree, ['k', 'j', 'i_1']);
    const zero = evaluate(a)?.n === 0n;
    const width = () => fn('Divide', zero ? copy(b) : fn('Add', copy(b), neg(copy(a))), sym(n));
    const point = zero ? mul(sym(k), width()) : fn('Add', copy(a), mul(sym(k), width()));
    const term = mul(instantiate(f, x, point), width());
    add(fn('Limit', sym(n), sym(INFINITY), fn('Sum', sym(k), num(1), sym(n), term)), 'step.iRiemann');
    return out;
  }

  // tabela: ∫ f dx = F + C · ∫ₐᵇ f dx = [F]ₐᵇ
  const F = antiderivative(f, x);
  if (F && definite) add(fn('EvalAt', sym(x), copy(I.args[1]), copy(I.args[2]), F), 'step.iFTC');
  else if (F) {
    const t2 = place(tree, p, F);
    out.push({ tree: withConstant(t2, p), label: label('step.iTable'), focus: F.id });
  }

  // linearidade: ∫(f + g) = ∫f + ∫g · ∫ c·f = c∫f · ∫ −f = −∫f · ∫ f/c = (∫f)/c
  if (f.op === 'Add') {
    add(fn('Add', ...f.args.map((t) => (t.op === 'Negate' ? neg(integral(I, t.args[0])) : integral(I, t)))), 'step.iSum');
  } else if (f.op === 'Negate') add(neg(integral(I, f.args[0])), 'step.iPull');
  else if (f.op === 'Multiply') {
    const consts = f.args.filter((a) => freeOf(a, x));
    const rest = f.args.filter((a) => !freeOf(a, x));
    if (consts.length && rest.length) add(mul(...consts, integral(I, rebuild('Multiply', rest))), 'step.iPull');
  } else if (f.op === 'Divide' && freeOf(f.args[1], x) && !freeOf(f.args[0], x)) {
    add(fn('Divide', integral(I, f.args[0]), f.args[1]), 'step.iPull');
  }

  // ∫ₐᵃ f = 0
  if (definite && literal(I.args[1], I.args[2])) add(num(0), 'step.iZero');
  return out;
}

// [F]ₐᵇ = F(b) − F(a)
function evalAtForms(ctx) {
  const p = calcAt(ctx, 'EvalAt');
  if (!p) return null;
  const { tree } = ctx;
  const [xs, a, b, F] = getAt(tree, p).args;
  const clones = {};
  const node = fn('Add', instantiate(F, xs.name, b, clones), neg(instantiate(F, xs.name, a, clones)));
  return { ...done(tree, p, node, 'step.iEval'), hints: { clones } };
}

// ∫f + ∫g → ∫(f + g) · c∫f → ∫cf · ∫ₐᵇ f + ∫ᵦᶜ f → ∫ₐᶜ f
function integralJoin(ctx) {
  const { tree, focus } = ctx;
  const out = [];
  const sameRange = (I, J) => I.args.length === J.args.length && I.args[0].name === J.args[0].name
    && (I.args.length === 2 || (literal(I.args[1], J.args[1]) && literal(I.args[2], J.args[2])));
  for (const p of [focus, focus.length ? parentPath(focus) : null]) {
    if (!p) continue;
    const n = getAt(tree, p);
    if (n.op === 'Add' && n.args.length > 1) {
      const is = n.args.map((t) => (t.op === 'Integrate' ? t : t.op === 'Negate' && t.args[0].op === 'Integrate' ? t.args[0] : null));
      if (is.every((I) => I && sameRange(I, is[0]))) {
        const body = fn('Add', ...n.args.map((t, i) => (t.op === 'Negate' ? neg(bodyOf(is[i])) : bodyOf(is[i]))));
        out.push(done(tree, p, integral(is[0], body), 'step.iSumInv'));
      }
      // intervalos vizinhos, com o mesmo integrando
      if (n.args.length === 2 && is.every((I) => I?.args.length === 4) && n.args.every((t) => t.op === 'Integrate')) {
        const [I, J] = is;
        if (I.args[0].name === J.args[0].name && literal(bodyOf(I), bodyOf(J)) && literal(I.args[2], J.args[1])) {
          out.push(done(tree, p, fn('Integrate', sym(I.args[0].name), copy(I.args[1]), copy(J.args[2]), copy(bodyOf(I))), 'step.iRanges'));
        }
      }
    }
    if (n.op === 'Multiply') {
      const k = n.args.findIndex((a) => a.op === 'Integrate');
      const x = n.args[k]?.args[0].name;
      if (k >= 0 && n.args.every((a, i) => i === k || freeOf(a, x))) {
        out.push(done(tree, p, integral(n.args[k], mul(...n.args.filter((_, i) => i !== k), bodyOf(n.args[k]))), 'step.iPullInv'));
      }
    }
    if (out.length) break;
  }
  return out;
}

export const INTEGRAL_RULES = [(ctx) => integralForms(ctx), evalAtForms, integralJoin];
export const definiteForms = (ctx) => integralForms(ctx, true);

// Integral (no foco ou acima) disponível para as operações que pedem texto.
export const integralAt = (ctx) => calcAt(ctx, 'Integrate');

// "u = g(x)" ou só "g(x)": nome e expressão.
function parseAssignment(text, fallback) {
  let e;
  try { e = parseInput(text ?? ''); } catch { return null; }
  if (e.op === 'Equal' && unparen(e.args[0]).op === 'Symbol') return { name: unparen(e.args[0]).name, expr: e.args[1] };
  return isRelation(e.op) ? null : { name: fallback, expr: e };
}

// Fatores de f com expoente ±1: a/b·c → [a +1, c +1, b −1].
function factorList(f) {
  f = unparen(f);
  if (f.op === 'Divide') return [...factorList(f.args[0]), ...factorList(f.args[1]).map(([g, s]) => [g, -s])];
  if (f.op === 'Multiply') return f.args.flatMap(factorList);
  return isNumOne(f) ? [] : [[f, 1]];
}
const fromFactors = (list) => {
  const top = list.filter(([, s]) => s > 0).map(([g]) => g);
  const bottom = list.filter(([, s]) => s < 0).map(([g]) => g);
  const a = rebuild('Multiply', top);
  return bottom.length ? fn('Divide', a, rebuild('Multiply', bottom)) : a;
};
const valueOf = (list, env) => list.reduce((acc, [g, s]) => acc * numeric(g, env) ** s, 1);

// Troca, em f, as ocorrências de g pelo símbolo u.
function replaceExpr(f, g, u) {
  let count = 0;
  const go = (n) => {
    if (!n.args && !(n.op === 'Symbol' && literal(n, g))) return n;
    if (literal(n, g)) { count++; return sym(u); }
    return n.args ? { ...n, args: n.args.map(go) } : n;
  };
  const out = go(f);
  return count ? out : null;
}

// Substituição: ∫ h(g(x))·g′(x) dx = ∫ h(u) du (com os limites trocados
// por g(a) e g(b) na integral definida). Os fatores que formam g′(x) (a
// menos de uma constante) são conferidos numericamente.
export function substitution(ctx) {
  const p = calcAt(ctx, 'Integrate');
  if (!p) return null;
  const { tree } = ctx;
  const I = getAt(tree, p);
  const x = I.args[0].name;
  const a = parseAssignment(ctx.input, 'u');
  if (!a || freeOf(a.expr, x) || isVar(a.expr, x)) return { error: 'err.substU' };
  const { name: u, expr: g } = a;
  const f1 = replaceExpr(bodyOf(I), g, u);
  if (!f1) return { error: 'err.substAbsent', params: { g: toAscii(g) } };
  // g′(x) numérico (diferença central)
  const dg = (t) => {
    const h = 1e-5 * Math.max(1, Math.abs(t));
    return (numeric(g, { [x]: t + h }) - numeric(g, { [x]: t - h })) / (2 * h);
  };
  const list = factorList(f1);
  const free = list.map(([h]) => freeOf(h, u));
  const idx = list.map((_, i) => i).filter((i) => free[i]);
  // subconjuntos dos fatores sem u (os maiores primeiro): Π / g′(x) constante?
  let best = null;
  for (let mask = (1 << idx.length) - 1; mask >= 0 && idx.length <= 8; mask--) {
    const chosen = idx.filter((_, j) => mask & (1 << j));
    const rest = list.filter((_, i) => !chosen.includes(i));
    if (rest.some(([h]) => !freeOf(h, x))) continue;
    const ratios = SAMPLES.map((t) => valueOf(chosen.map((i) => list[i]), { [x]: t }) / dg(t));
    if (!ratios.every((r) => Number.isFinite(r) && close(r, ratios[0]))) continue;
    const r = simpleRatio(ratios[0]);
    if (!r || r.n === 0) continue;
    best = { rest, r };
    if (r.n === r.d) break;
  }
  if (!best) return { error: 'err.substLeft', params: { u, g: toAscii(g) } };
  const h = mul(best.r.n === best.r.d ? null : ratioNode(best.r), fromFactors(best.rest));
  const node = I.args.length === 4
    ? fn('Integrate', sym(u), instantiate(g, x, I.args[1]), instantiate(g, x, I.args[2]), h)
    : fn('Integrate', sym(u), h);
  return { tree: place(tree, p, node), label: msg('step.iSubst', { u, g: toAscii(g) }), focus: node.id };
}

// Por partes: ∫ u dv = uv − ∫ v du, com v tirado da tabela e du = u′ dx
// deixado por fazer (d/dx u).
export function byParts(ctx) {
  const p = calcAt(ctx, 'Integrate');
  if (!p) return null;
  const { tree } = ctx;
  const I = getAt(tree, p);
  const x = I.args[0].name;
  const a = parseAssignment(ctx.input, 'u');
  if (!a) return { error: 'err.partsU' };
  const list = factorList(bodyOf(I));
  const k = list.findIndex(([g, s]) => s > 0 && literal(g, a.expr));
  if (k < 0) return { error: 'err.partsU' };
  const dv = fromFactors(list.filter((_, i) => i !== k));
  const v = antiderivative(dv, x);
  if (!v) return { error: 'err.partsV', params: { dv: toAscii(dv) } };
  const u = copy(list[k][0]);
  const rest = integral(I, mul(copy(v), deriv(x, copy(u))));
  const uv = mul(u, v);
  const node = I.args.length === 4
    ? fn('Add', fn('EvalAt', sym(x), copy(I.args[1]), copy(I.args[2]), uv), neg(rest))
    : fn('Add', uv, neg(rest));
  return { tree: place(tree, p, node), label: msg('step.iParts', { u: toAscii(u), v: toAscii(v) }), focus: node.id };
}

// ----------------------------------------------------------------- limites

// Valores de teste para as outras letras (constantes do problema).
function envFor(n, x, value) {
  const env = { [x]: value };
  let k = 0;
  walk(n, (s) => {
    if (s.op === 'Symbol' && !(s.name in env) && !['e', 'pi', INFINITY].includes(s.name)) env[s.name] = SAMPLES[k++ % SAMPLES.length] + 1;
  });
  return env;
}

// Como g se comporta quando x → a: 'zero', 'inf', 'finite' ou null.
function behaviour(g, x, a, dir) {
  const at = (t) => numeric(g, envFor(g, x, t));
  const A = numeric(a, envFor(a, x, 0));
  if (Math.abs(A) === Infinity || unparen(a).op === 'Negate' && Math.abs(numeric(unparen(a).args[0], {})) === Infinity) {
    const s = Math.sign(A) || -1;
    const [v1, v2] = [at(s * 1e4), at(s * 1e8)].map(Math.abs);
    if (!Number.isFinite(v2) || (v2 > 1e3 && v2 > v1)) return 'inf';
    if (v2 < 1e-3 && v2 < v1) return 'zero';
    return Number.isFinite(v2) ? 'finite' : null;
  }
  if (!Number.isFinite(A)) return null;
  const v = at(A);
  if (Number.isFinite(v)) return Math.abs(v) < 1e-9 ? 'zero' : 'finite';
  const s = dir === '-' ? -1 : 1;
  const [v1, v2] = [at(A + s * 1e-4), at(A + s * 1e-8)].map(Math.abs);
  return v2 > v1 && v2 > 1e3 ? 'inf' : null;
}

// Pode substituir x por a: o ponto é finito e nenhuma conta explode.
// Devolve null (pode) ou o erro.
function substitutable(f, x, a) {
  const A = numeric(a, envFor(a, x, 0));
  if (!Number.isFinite(A)) return { error: 'err.limInf' };
  let bad = null;
  walk(f, (n) => {
    if (bad || n.op !== 'Divide') return;
    const [u, v] = n.args.map((g) => numeric(g, envFor(f, x, A)));
    if (Math.abs(v) < 1e-12) bad = Math.abs(u) < 1e-12 ? { error: 'err.lim00' } : { error: 'err.limDiv0' };
  });
  if (bad) return bad;
  return Number.isFinite(numeric(f, envFor(f, x, A))) ? null : { error: 'err.limSubst' };
}

// Limites notáveis com u → 0 (ou u → ∞), na variável u da própria expressão.
const NOTABLE = [
  ['sin(u)/u', '1'], ['u/sin(u)', '1'], ['tan(u)/u', '1'], ['(1 - cos(u))/u', '0'],
  ['(e^u - 1)/u', '1'], ['(exp(u) - 1)/u', '1'], ['ln(1 + u)/u', '1'], ['(1 + u)^(1/u)', 'e'],
];
let notable = null;

// Casa f com o modelo, achando quem faz o papel de u; devolve u ou null.
function bindU(f, model) {
  let u = null;
  const go = (a, m) => {
    a = unparen(a); m = unparen(m);
    if (m.op === 'Symbol' && m.name === 'u') {
      if (u) return literal(a, u);
      u = a;
      return true;
    }
    if (m.op !== a.op) return false;
    if (m.op === 'Number') return a.value === m.value;
    if (m.op === 'Symbol') return a.name === m.name;
    return a.args.length === m.args.length && a.args.every((c, i) => go(c, m.args[i]));
  };
  return go(f, model) ? u : null;
}

function limitForms(ctx) {
  const p = calcAt(ctx, 'Limit');
  if (!p) return [];
  const { tree } = ctx;
  const L = getAt(tree, p);
  const [xs, a, body] = L.args;
  const x = xs.name;
  const f = unparen(body);
  const out = [];
  const add = (node, key, params) => out.push(done(tree, p, node, key, params));
  const lim = (g) => (L.dir ? { ...fn('Limit', sym(x), copy(a), g), dir: L.dir } : fn('Limit', sym(x), copy(a), g));

  // constante · substituição direta (recusada nas formas indeterminadas)
  if (freeOf(f, x)) add(copy(f), 'step.lConst');
  else {
    const why = substitutable(f, x, a);
    if (!why) {
      const clones = {};
      const node = instantiate(f, x, a, clones);
      out.push({ ...done(tree, p, node, 'step.lSubst'), hints: { clones } });
    } else if (why.error !== 'err.limInf') out.push(why);
  }

  // limites notáveis
  notable ??= NOTABLE.map(([m, v]) => [parseInput(m), parseInput(v)]);
  for (const [model, value] of notable) {
    const u = bindU(f, model);
    if (u && !freeOf(u, x) && behaviour(u, x, a, L.dir) === 'zero') {
      add(copy(value), 'step.lNotable', { f: toAscii(model).replace(/u/g, 'u') });
      break;
    }
  }
  // (1 + 1/u)^u → e, (1 + k/u)^u → eᵏ, com u → ∞
  if (f.op === 'Power') {
    const [b, e] = f.args.map(unparen);
    const t = b.op === 'Add' && b.args.length === 2 && unparen(b.args[0]).op === 'Number' && unparen(b.args[0]).value === '1' ? unparen(b.args[1]) : null;
    if (t?.op === 'Divide' && literal(t.args[1], e) && freeOf(t.args[0], x) && behaviour(e, x, a, L.dir) === 'inf') {
      const k = t.args[0];
      add(isNumOne(unparen(k)) ? sym('e') : pow(sym('e'), copy(k)), 'step.lNotable', { f: '(1 + k/u)^u' });
    }
  }
  // lim_(h→0) (f(x + h) − f(x))/h = f′(x): a definição de derivada ao contrário
  if (f.op === 'Divide' && isVar(f.args[1], x) && unparen(a).op === 'Number' && unparen(a).value === '0') {
    const top = unparen(f.args[0]);
    if (top.op === 'Add' && top.args.length === 2 && top.args[1].op === 'Negate') {
      const [A, B] = [top.args[0], top.args[1].args[0]];
      const names = new Set();
      walk(B, (s) => { if (s.op === 'Symbol' && s.name !== x) names.add(s.name); });
      for (const v of names) {
        if (literal(A, instantiate(B, v, fn('Add', sym(v), sym(x))))) { add(deriv(v, copy(B)), 'step.lDeriv'); break; }
      }
    }
  }
  // c/xⁿ → 0 com x → ±∞
  if (f.op === 'Divide' && freeOf(f.args[0], x) && behaviour(f.args[1], x, a, L.dir) === 'inf') add(num(0), 'step.lInfZero');

  // propriedades: soma, constante, produto, quociente (denominador ≠ 0), potência
  if (f.op === 'Add') add(fn('Add', ...f.args.map((t) => (t.op === 'Negate' ? neg(lim(t.args[0])) : lim(t)))), 'step.lSum');
  else if (f.op === 'Negate') add(neg(lim(f.args[0])), 'step.lPull');
  else if (f.op === 'Multiply') {
    const consts = f.args.filter((g) => freeOf(g, x));
    const rest = f.args.filter((g) => !freeOf(g, x));
    if (consts.length && rest.length) add(mul(...consts, lim(rebuild('Multiply', rest))), 'step.lPull');
    if (rest.length > 1) add(mul(...consts.map(copy), ...rest.map((g) => lim(copy(g)))), 'step.lProduct');
  } else if (f.op === 'Divide') {
    const [u, v] = f.args;
    const bu = behaviour(u, x, a, L.dir);
    const bv = behaviour(v, x, a, L.dir);
    if (freeOf(v, x) && !freeOf(u, x)) add(fn('Divide', lim(u), v), 'step.lPull');
    else if (bv === 'finite') add(fn('Divide', lim(u), lim(v)), 'step.lQuotient');
    // L'Hôpital nas formas 0/0 e ∞/∞
    if ((bu === 'zero' && bv === 'zero') || (bu === 'inf' && bv === 'inf')) {
      add(lim(fn('Divide', deriv(x, copy(u)), deriv(x, copy(v)))), 'step.lHopital', { form: bu === 'zero' ? '0/0' : '∞/∞' });
    }
  } else if (f.op === 'Power' && freeOf(f.args[1], x)) add(pow(lim(f.args[0]), f.args[1]), 'step.lPower');
  else if (f.op === 'Sqrt') add(fn('Sqrt', lim(f.args[0])), 'step.lPower');

  return out;
}

// Trocar a variável: x → a vira h → 0 (x = a + h); x → ∞ vira t → 0⁺ (x = 1/t).
function limitChange(ctx) {
  const p = calcAt(ctx, 'Limit');
  if (!p) return null;
  const { tree } = ctx;
  const L = getAt(tree, p);
  const [xs, a, body] = L.args;
  const x = xs.name;
  const infinite = behaviour(sym(x), x, a, L.dir) === 'inf';
  const zero = unparen(a).op === 'Number' && unparen(a).value === '0';
  if (zero || freeOf(body, x)) return null;
  const h = freshIndex(tree, infinite ? ['t', 's', 'h'] : ['h', 't', 's']);
  const value = infinite ? fn('Divide', num(1), sym(h)) : fn('Add', copy(a), sym(h));
  const node = { ...fn('Limit', sym(h), num(0), instantiate(body, x, value)) };
  if (infinite) node.dir = numeric(a, {}) > 0 ? '+' : '-';
  else if (L.dir) node.dir = L.dir;
  return done(tree, p, node, 'step.lChange', { v: `${x} = ${toAscii(value)}` });
}

export const LIMIT_RULES = [limitForms, limitChange];
