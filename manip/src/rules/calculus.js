// Regras de Cálculo: derivadas (tecla '), integrais (u) e limites (a).
// Como as demais, cada regra tira uma camada por vez: a regra da cadeia
// deixa d/dx(u) por fazer, e nada é calculado sozinho.
//
// Nós (ast.js): D(x, f) com order · Integrate(x, f) e Integrate(x, a, b, f)
// · Limit(x, a, f) com dir · EvalAt(x, a, b, F) · Call (f(x), f'(x)).

import { getAt, fn, num, sym, call } from '../ast.js';
import { msg } from '../i18n.js';
import { isRelation } from '../relations.js';
import { noted } from './normal.js';
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
