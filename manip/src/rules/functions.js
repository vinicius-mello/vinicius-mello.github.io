// Regras de funções: logaritmos e exponenciais, trigonometria e radicais.
// Como as demais, cada uma é um passo explícito; as equivalências valem nos
// dois sentidos e são reunidas por tecla com either() (rules/index.js).

import { getAt, replaceAt, withArgs, fn, num, sym } from '../ast.js';
import { matches as same } from './normal.js';
import { msg } from '../i18n.js';
import { evaluate } from './arith.js';
import {
  factors, unparen, signed, parentPath, parentOf, siblingsOf, cloneFrom,
  rebuild, place, atFocusOrParent, isNum,
} from './util.js';

const copy = (n) => cloneFrom(n, {});
const isE = (n) => n.op === 'Symbol' && n.name === 'e';

// Termos de uma soma: os selecionados ou todos os da soma em foco (o foco
// pode estar num termo, ou dentro de um termo com sinal).
function sumSelection(ctx) {
  const { tree, targets, focus } = ctx;
  const sib = siblingsOf(targets);
  if (sib && parentOf(tree, targets[0])?.op === 'Add') return { sp: parentPath(targets[0]), idx: sib };
  let sp = focus;
  for (let k = 0; k < 3 && sp.length && getAt(tree, sp).op !== 'Add'; k++) sp = parentPath(sp);
  const S = getAt(tree, sp);
  if (S.op !== 'Add') return null;
  return { sp, idx: S.args.map((_, i) => i) };
}

// Troca os termos idx da soma por `node` (no lugar do primeiro).
function replaceTerms(tree, sp, idx, node) {
  const S = getAt(tree, sp);
  if (idx.length === S.args.length) return place(tree, sp, node);
  const args = S.args.filter((_, i) => !idx.includes(i) || i === idx[0]);
  args[args.indexOf(S.args[idx[0]])] = node;
  return replaceAt(tree, sp, withArgs(S, args));
}

// ------------------------------------------------------------ logaritmos

const isLog = (n) => n.op === 'Ln' || n.op === 'Log';
// Base: ln → e, log → 10, log_b → b.
const baseOfLog = (L) => (L.op === 'Ln' ? sym('e') : L.args[1] ?? num(10));
const sameLog = (a, b) => isLog(a) && isLog(b) && a.op === b.op && (a.op === 'Ln' || same(baseOfLog(a), baseOfLog(b)));
// Logaritmo de x na mesma base de L (keep: reaproveita o nó L).
function logLike(L, x, keep = false) {
  const base = L.op === 'Log' && L.args[1] ? [keep ? L.args[1] : copy(L.args[1])] : [];
  return keep ? withArgs(L, [x, ...base]) : fn(L.op, x, ...base);
}

// log(ab) → log a + log b · log(a/b) → log a − log b · log(aⁿ) → n·log a
function logExpand(ctx) {
  return atFocusOrParent(ctx, (p) => {
    const { tree } = ctx;
    const L = getAt(tree, p);
    if (!isLog(L)) return null;
    const a = unparen(L.args[0]);
    let node;
    let label;
    if (a.op === 'Multiply') {
      node = fn('Add', ...a.args.map((f, i) => logLike(L, f, i === 0)));
      label = 'step.logProduct';
    } else if (a.op === 'Divide') {
      node = fn('Add', logLike(L, a.args[0], true), fn('Negate', logLike(L, a.args[1])));
      label = 'step.logQuotient';
    } else if (a.op === 'Power') {
      node = fn('Multiply', a.args[1], logLike(L, a.args[0], true));
      label = 'step.logPower';
    } else if (a.op === 'Sqrt') {
      node = fn('Multiply', fn('Divide', num(1), num(2)), logLike(L, a.args[0], true));
      label = 'step.logPower';
    } else return null;
    return { tree: place(tree, p, node), label: msg(label), focus: node.id };
  });
}

// log a + log b − log c → log(ab/c): termos que são logaritmos na mesma base.
function logCollect(ctx) {
  const { tree } = ctx;
  const where = sumSelection(ctx);
  if (!where || where.idx.length < 2) return null;
  const S = getAt(tree, where.sp);
  const parts = where.idx.map((i) => signed(S.args[i]));
  const first = parts[0].body;
  if (!parts.every((x) => sameLog(x.body, first))) return null;
  const top = parts.filter((x) => !x.neg).map((x) => x.body.args[0]);
  const bottom = parts.filter((x) => x.neg).map((x) => x.body.args[0]);
  const prod = (xs) => (xs.length ? rebuild('Multiply', xs) : num(1));
  const arg = bottom.length ? fn('Divide', prod(top), prod(bottom)) : prod(top);
  const node = logLike(first, arg, true);
  return { tree: replaceTerms(tree, where.sp, where.idx, node), label: msg('step.logCollect'), focus: node.id };
}

// n·log a → log(aⁿ)
function logCoefficient(ctx) {
  return atFocusOrParent(ctx, (p) => {
    const { tree } = ctx;
    const M = getAt(tree, p);
    if (M.op !== 'Multiply') return null;
    const k = M.args.findIndex(isLog);
    if (k < 0 || M.args.filter(isLog).length > 1) return null;
    const L = M.args[k];
    const n = rebuild('Multiply', M.args.filter((_, i) => i !== k));
    const node = logLike(L, fn('Power', L.args[0], n), true);
    return { tree: replaceAt(tree, p, node), label: msg('step.logPowerInv'), focus: node.id };
  });
}

// log 1 → 0 · logₐ a → 1 · ln(eˣ) → x · ln(exp x) → x
function logEvaluate(ctx) {
  return atFocusOrParent(ctx, (p) => {
    const { tree } = ctx;
    const L = getAt(tree, p);
    if (!isLog(L)) return null;
    const a = unparen(L.args[0]);
    const b = baseOfLog(L);
    let node = null;
    if (isNum(a, 1)) node = num(0);
    else if (same(a, b)) node = num(1);
    else if (a.op === 'Power' && same(a.args[0], b)) node = a.args[1];
    else if (a.op === 'Exp' && L.op === 'Ln') node = a.args[0];
    if (!node) return null;
    return { tree: replaceAt(tree, p, node), label: msg('step.logEval'), focus: node.id };
  });
}

// e^(ln x) → x · b^(log_b x) → x · exp(ln x) → x · exp(x) ↔ eˣ
function expRules(ctx) {
  return atFocusOrParent(ctx, (p) => {
    const { tree } = ctx;
    const n = getAt(tree, p);
    const out = [];
    const inverse = (base, L) => isLog(L) && same(base, baseOfLog(L));
    if (n.op === 'Power' && inverse(n.args[0], unparen(n.args[1]))) {
      const x = unparen(n.args[1]).args[0];
      out.push({ tree: replaceAt(tree, p, x), label: msg('step.expLog'), focus: x.id });
    }
    if (n.op === 'Exp' && unparen(n.args[0]).op === 'Ln') {
      const x = unparen(n.args[0]).args[0];
      out.push({ tree: replaceAt(tree, p, x), label: msg('step.expLog'), focus: x.id });
    }
    if (n.op === 'Exp') {
      const node = fn('Power', sym('e'), n.args[0]);
      out.push({ tree: replaceAt(tree, p, node), label: msg('step.expForm'), focus: node.id });
    }
    if (n.op === 'Power' && isE(n.args[0])) {
      const node = fn('Exp', n.args[1]);
      out.push({ tree: replaceAt(tree, p, node), label: msg('step.expForm'), focus: node.id });
    }
    return out.length ? out : null;
  });
}

// log_b a ↔ ln a / ln b  (mudança de base)
function changeOfBase(ctx) {
  return atFocusOrParent(ctx, (p) => {
    const { tree } = ctx;
    const n = getAt(tree, p);
    if (n.op === 'Log') {
      const node = fn('Divide', fn('Ln', n.args[0]), fn('Ln', n.args[1] ?? num(10)));
      return { tree: replaceAt(tree, p, node), label: msg('step.changeBase'), focus: node.id };
    }
    if (n.op === 'Divide' && n.args.every((x) => x.op === 'Ln')) {
      const [a, b] = n.args.map((x) => x.args[0]);
      const node = isNum(b, 10) ? fn('Log', a) : fn('Log', a, b);
      return { tree: replaceAt(tree, p, node), label: msg('step.changeBase'), focus: node.id };
    }
    return null;
  });
}

export const LOG_RULES = [logEvaluate, expRules, logExpand, logCollect, logCoefficient, changeOfBase];

// --------------------------------------------------------- trigonometria

const sq = (op, a) => fn('Power', fn(op, a), num(2));
const isSq = (n, op) => n.op === 'Power' && n.args[0].op === op && isNum(n.args[1], 2);

// tg x ↔ sen x / cos x · cotg x ↔ cos x / sen x · sec x ↔ 1/cos x · cossec x ↔ 1/sen x
const QUOTIENTS = { Tan: ['Sin', 'Cos'], Cot: ['Cos', 'Sin'], Sec: [null, 'Cos'], Csc: [null, 'Sin'] };
function trigQuotient(ctx) {
  return atFocusOrParent(ctx, (p) => {
    const { tree } = ctx;
    const n = getAt(tree, p);
    let node = null;
    if (QUOTIENTS[n.op]) {
      const [top, bottom] = QUOTIENTS[n.op];
      const a = n.args[0];
      node = fn('Divide', top ? fn(top, a) : num(1), fn(bottom, top ? copy(a) : a));
    } else if (n.op === 'Divide') {
      const [t, b] = n.args;
      for (const [op, [top, bottom]] of Object.entries(QUOTIENTS)) {
        if (b.op !== bottom) continue;
        if (top ? t.op === top && same(t.args[0], b.args[0]) : isNum(t, 1)) node = fn(op, b.args[0]);
      }
    }
    if (!node) return null;
    return { tree: replaceAt(tree, p, node), label: msg('step.trigQuotient'), focus: node.id };
  });
}

// sen(−x) ↔ −sen x · cos(−x) → cos x
const ODD = new Set(['Sin', 'Tan', 'Cot', 'Csc']);
const EVEN = new Set(['Cos', 'Sec']);
function trigParity(ctx) {
  return atFocusOrParent(ctx, (p) => {
    const { tree } = ctx;
    const n = getAt(tree, p);
    let node = null;
    if ((ODD.has(n.op) || EVEN.has(n.op)) && unparen(n.args[0]).op === 'Negate') {
      const inner = withArgs(n, [unparen(n.args[0]).args[0]]);
      node = ODD.has(n.op) ? fn('Negate', inner) : inner;
    } else if (n.op === 'Negate' && ODD.has(n.args[0].op)) {
      const f = n.args[0];
      node = withArgs(f, [fn('Negate', f.args[0])]);
    }
    if (!node) return null;
    return { tree: place(tree, p, node), label: msg('step.trigParity'), focus: node.id };
  });
}

// sen²x + cos²x → 1 · 1 − cos²x → sen²x · 1 − sen²x → cos²x
function pythagorasSum(ctx) {
  const { tree } = ctx;
  const where = sumSelection(ctx);
  if (!where) return null;
  const S = getAt(tree, where.sp);
  const ts = where.idx.map((i) => ({ i, ...signed(S.args[i]) }));
  const out = [];
  for (const a of ts) {
    for (const b of ts) {
      if (a.i >= b.i) continue;
      let node = null;
      const pair = (x, y) => !x.neg && !y.neg && isSq(x.body, 'Sin') && isSq(y.body, 'Cos')
        && same(x.body.args[0].args[0], y.body.args[0].args[0]);
      if (pair(a, b) || pair(b, a)) node = num(1);
      const one = (x, y) => !x.neg && isNum(x.body, 1) && y.neg && (isSq(y.body, 'Sin') || isSq(y.body, 'Cos'));
      for (const [x, y] of [[a, b], [b, a]]) {
        if (!node && one(x, y)) {
          const f = y.body.args[0];
          node = sq(f.op === 'Sin' ? 'Cos' : 'Sin', f.args[0]);
        }
      }
      if (!node) continue;
      out.push({
        tree: replaceTerms(tree, where.sp, [a.i, b.i], node),
        label: msg('step.pythagoras'),
        focus: node.id,
        hints: { strike: [S.args[a.i].id, S.args[b.i].id] },
      });
    }
  }
  return out.length ? out : null;
}

// sen²x → 1 − cos²x · cos²x → 1 − sen²x
function pythagorasTerm(ctx) {
  const { tree, focus } = ctx;
  const n = getAt(tree, focus);
  if (!isSq(n, 'Sin') && !isSq(n, 'Cos')) return null;
  const f = n.args[0];
  const node = fn('Add', num(1), fn('Negate', sq(f.op === 'Sin' ? 'Cos' : 'Sin', f.args[0])));
  return { tree: replaceAt(tree, focus, node), label: msg('step.pythagoras'), focus: node.id };
}

// Argumento 2a: { a } (2 explícito como primeiro fator).
function doubleOf(x) {
  const m = unparen(x);
  if (m.op !== 'Multiply' || !isNum(m.args[0], 2)) return null;
  return rebuild('Multiply', m.args.slice(1));
}

// sen(2a) → 2 sen a cos a · cos(2a) → cos²a − sen²a | 2cos²a − 1 | 1 − 2sen²a
function doubleAngle(ctx) {
  return atFocusOrParent(ctx, (p) => {
    const { tree } = ctx;
    const n = getAt(tree, p);
    if (n.op !== 'Sin' && n.op !== 'Cos') return null;
    const a = doubleOf(n.args[0]);
    if (!a) return null;
    const two = unparen(n.args[0]).args[0];
    const forms = n.op === 'Sin'
      ? [fn('Multiply', two, fn('Sin', a), fn('Cos', copy(a)))]
      : [
        fn('Add', sq('Cos', a), fn('Negate', sq('Sin', copy(a)))),
        fn('Add', fn('Multiply', two, sq('Cos', copy(a))), fn('Negate', num(1))),
        fn('Add', num(1), fn('Negate', fn('Multiply', copy(two), sq('Sin', copy(a))))),
      ];
    return forms.map((node) => ({ tree: place(tree, p, node), label: msg('step.doubleAngle'), focus: node.id }));
  });
}

// 2 sen a cos a → sen(2a)
function doubleAngleInvProduct(ctx) {
  return atFocusOrParent(ctx, (p) => {
    const { tree } = ctx;
    const M = getAt(tree, p);
    if (M.op !== 'Multiply' || M.args.length !== 3) return null;
    const two = M.args.find((x) => isNum(x, 2));
    const s = M.args.find((x) => x.op === 'Sin');
    const c = M.args.find((x) => x.op === 'Cos');
    if (!two || !s || !c || !same(s.args[0], c.args[0])) return null;
    const node = withArgs(s, [fn('Multiply', two, s.args[0])]);
    return { tree: replaceAt(tree, p, node), label: msg('step.doubleAngleInv'), focus: node.id };
  });
}

// cos²a − sen²a, 2cos²a − 1, 1 − 2sen²a → cos(2a)
function doubleAngleInvSum(ctx) {
  const { tree } = ctx;
  const where = sumSelection(ctx);
  if (!where || where.idx.length !== 2) return null;
  const S = getAt(tree, where.sp);
  const [x, y] = where.idx.map((i) => signed(S.args[i]));
  if (x.neg) return null;
  const twice = (t, op) => t.op === 'Multiply' && t.args.length === 2 && isNum(t.args[0], 2) && isSq(t.args[1], op);
  let a = null;
  if (isSq(x.body, 'Cos') && y.neg && isSq(y.body, 'Sin') && same(x.body.args[0].args[0], y.body.args[0].args[0])) a = x.body.args[0].args[0];
  else if (twice(x.body, 'Cos') && y.neg && isNum(y.body, 1)) a = x.body.args[1].args[0].args[0];
  else if (isNum(x.body, 1) && y.neg && twice(y.body, 'Sin')) a = y.body.args[1].args[0].args[0];
  if (!a) return null;
  const node = fn('Cos', fn('Multiply', num(2), a));
  return { tree: replaceTerms(tree, where.sp, where.idx, node), label: msg('step.doubleAngleInv'), focus: node.id };
}

// sen(a ± b) → sen a cos b ± cos a sen b · cos(a ± b) → cos a cos b ∓ sen a sen b
function angleSum(ctx) {
  return atFocusOrParent(ctx, (p) => {
    const { tree } = ctx;
    const n = getAt(tree, p);
    if (n.op !== 'Sin' && n.op !== 'Cos') return null;
    const s = unparen(n.args[0]);
    if (s.op !== 'Add' || s.args.length !== 2) return null;
    const a = s.args[0];
    const { neg, body: b } = signed(s.args[1]);
    const t = (f1, f2) => fn('Multiply', f1, f2);
    let node;
    if (n.op === 'Sin') {
      const second = t(fn('Cos', copy(a)), fn('Sin', copy(b)));
      node = fn('Add', t(withArgs(n, [a]), fn('Cos', b)), neg ? fn('Negate', second) : second);
    } else {
      const second = t(fn('Sin', copy(a)), fn('Sin', copy(b)));
      node = fn('Add', t(withArgs(n, [a]), fn('Cos', b)), neg ? second : fn('Negate', second));
    }
    return { tree: place(tree, p, node), label: msg('step.angleSum'), focus: node.id };
  });
}

// sen a cos b ± cos a sen b → sen(a ± b) · cos a cos b ∓ sen a sen b → cos(a ± b)
function angleSumInv(ctx) {
  const { tree } = ctx;
  const where = sumSelection(ctx);
  if (!where || where.idx.length !== 2) return null;
  const S = getAt(tree, where.sp);
  const [x, y] = where.idx.map((i) => signed(S.args[i]));
  if (x.neg) return null;
  const pick = (m, op, skip) => (m.op === 'Multiply' && m.args.length === 2 ? m.args.find((f) => f.op === op && f !== skip) : null);
  const angle = (a, b, minus) => fn('Add', a, minus ? fn('Negate', b) : b);
  let node = null;
  // seno: sen a cos b ± cos a sen b
  const sa = pick(x.body, 'Sin');
  const cb = pick(x.body, 'Cos');
  const ca = pick(y.body, 'Cos');
  const sb = pick(y.body, 'Sin');
  if (sa && cb && ca && sb && same(sa.args[0], ca.args[0]) && same(cb.args[0], sb.args[0])) {
    node = fn('Sin', angle(sa.args[0], cb.args[0], y.neg));
  }
  // cosseno: cos a cos b ∓ sen a sen b
  const c1 = pick(x.body, 'Cos');
  const c2 = c1 && pick(x.body, 'Cos', c1);
  const s1 = pick(y.body, 'Sin');
  const s2 = s1 && pick(y.body, 'Sin', s1);
  if (!node && c1 && c2 && s1 && s2 && same(c1.args[0], s1.args[0]) && same(c2.args[0], s2.args[0])) {
    node = fn('Cos', angle(c1.args[0], c2.args[0], !y.neg));
  }
  if (!node) return null;
  return { tree: replaceTerms(tree, where.sp, where.idx, node), label: msg('step.angleSumInv'), focus: node.id };
}

export const TRIG_RULES = [
  pythagorasSum, doubleAngleInvSum, angleSumInv, doubleAngleInvProduct,
  trigQuotient, trigParity, doubleAngle, angleSum, pythagorasTerm,
];

// --------------------------------------------------------------- radicais

// √a·√b → √(ab): os radicais selecionados, ou todos os do produto em foco.
function sqrtCombine(ctx) {
  const { tree, targets, focus } = ctx;
  let mp;
  let idx;
  const sib = siblingsOf(targets);
  if (sib && parentOf(tree, targets[0])?.op === 'Multiply') {
    mp = parentPath(targets[0]);
    idx = sib;
  } else {
    mp = getAt(tree, focus).op === 'Multiply' ? focus : parentPath(focus);
    const M = getAt(tree, mp);
    if (M?.op !== 'Multiply') return null;
    idx = M.args.map((x, i) => (x.op === 'Sqrt' ? i : -1)).filter((i) => i >= 0);
  }
  const M = getAt(tree, mp);
  if (idx.length < 2 || idx.some((i) => M.args[i].op !== 'Sqrt')) return null;
  const rs = idx.map((i) => M.args[i]);
  const node = withArgs(rs[0], [fn('Multiply', ...rs.map((r) => r.args[0]))]);
  const args = M.args.filter((_, i) => !idx.includes(i) || i === idx[0]);
  args[args.indexOf(rs[0])] = node;
  return { tree: replaceAt(tree, mp, rebuild('Multiply', args, M)), label: msg('step.sqrtProduct'), focus: node.id };
}

// √(ab) → √a·√b · √(a/b) ↔ √a/√b
function sqrtSplit(ctx) {
  return atFocusOrParent(ctx, (p) => {
    const { tree } = ctx;
    const n = getAt(tree, p);
    let node = null;
    if (n.op === 'Sqrt') {
      const a = unparen(n.args[0]);
      if (a.op === 'Multiply') node = fn('Multiply', ...a.args.map((f, i) => (i === 0 ? withArgs(n, [f]) : fn('Sqrt', f))));
      else if (a.op === 'Divide') node = fn('Divide', withArgs(n, [a.args[0]]), fn('Sqrt', a.args[1]));
    } else if (n.op === 'Divide' && n.args.every((x) => x.op === 'Sqrt')) {
      node = withArgs(n.args[0], [fn('Divide', n.args[0].args[0], n.args[1].args[0])]);
    }
    if (!node) return null;
    return { tree: replaceAt(tree, p, node), label: msg('step.sqrtSplit'), focus: node.id };
  });
}

// (√a)² → a · √(a²) → |a| (a se for um número positivo) · √9 → 3
function sqrtSquare(ctx) {
  return atFocusOrParent(ctx, (p) => {
    const { tree } = ctx;
    const n = getAt(tree, p);
    let node = null;
    if (n.op === 'Power' && unparen(n.args[0]).op === 'Sqrt' && isNum(n.args[1], 2)) node = unparen(n.args[0]).args[0];
    else if (n.op === 'Sqrt') {
      const a = unparen(n.args[0]);
      if (a.op === 'Power' && isNum(a.args[1], 2)) {
        const b = a.args[0];
        node = b.op === 'Number' ? b : fn('Abs', unparen(b));
      } else if (a.op === 'Number') {
        const r = evaluate(a);
        const root = r && r.d === 1n && r.n >= 0n ? isqrt(r.n) : null;
        if (root !== null && root * root === r.n) node = num(root.toString());
      }
    }
    if (!node) return null;
    return { tree: replaceAt(tree, p, node), label: msg('step.sqrtSquare'), focus: node.id };
  });
}

function isqrt(n) {
  if (n < 2n) return n;
  let x = BigInt(Math.floor(Math.sqrt(Number(n))));
  while (x * x > n) x--;
  while ((x + 1n) * (x + 1n) <= n) x++;
  return x;
}

// √x ↔ x^(1/2) · ⁿ√x ↔ x^(1/n)
function sqrtAsPower(ctx) {
  return atFocusOrParent(ctx, (p) => {
    const { tree } = ctx;
    const n = getAt(tree, p);
    let node = null;
    if (n.op === 'Sqrt') node = fn('Power', n.args[0], fn('Divide', num(1), num(2)));
    else if (n.op === 'Root') node = fn('Power', n.args[0], fn('Divide', num(1), n.args[1]));
    else if (n.op === 'Power' && n.args[1].op === 'Divide' && isNum(n.args[1].args[0], 1)) {
      const k = n.args[1].args[1];
      node = isNum(k, 2) ? fn('Sqrt', n.args[0]) : fn('Root', n.args[0], k);
    }
    if (!node) return null;
    return { tree: replaceAt(tree, p, node), label: msg('step.sqrtPower'), focus: node.id };
  });
}

export const RADICAL_RULES = [sqrtSquare, sqrtCombine, sqrtSplit, sqrtAsPower];

// Sugestão para racionalizar (tecla *): o radical do denominador, ou o
// conjugado de a ± √b.
export function rationalizeSuggestion(D) {
  const den = unparen(D.args[1]);
  const hasRoot = (x) => x.op === 'Sqrt' || x.op === 'Root' || (x.op === 'Multiply' && x.args.some(hasRoot))
    || (x.op === 'Negate' && hasRoot(x.args[0]));
  const r = factors(den).find((f) => f.op === 'Sqrt');
  if (r) return r;
  if (den.op === 'Add' && den.args.length === 2 && den.args.some(hasRoot)) {
    const [a, b] = den.args;
    return fn('Add', a, b.op === 'Negate' ? b.args[0] : fn('Negate', b));
  }
  return null;
}

