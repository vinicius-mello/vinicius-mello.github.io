// Regras de combinatória e de somatórios: fatorial, número binomial,
// somatório (Σ) e produtório (Π). Como as demais, cada uma é um passo
// explícito; as equivalências valem nos dois sentidos e são reunidas por
// tecla com either() (rules/index.js).
//
// Sum/Product(índice, inferior, superior, termo): o índice é um Symbol.

import { getAt, withArgs, fn, num, sym, walk, isBigOp, newId } from '../ast.js';
import { looseSame as sameLoose, toAscii } from '../serialize.js';
import { msg } from '../i18n.js';
import { isRelation } from '../relations.js';
import { evaluate } from './arith.js';
import { equivalent } from './normal.js';
import { unparen, signed, parentPath, lastIndex, cloneFrom, rebuild, place, atFocusOrParent } from './util.js';

const copy = (n) => cloneFrom(n, {});
const done = (tree, p, node, key, hints) => ({ tree: place(tree, p, node), label: label(key), focus: node.id, hints });

// ------------------------------------------------------------ utilitários

// Valor inteiro de uma subexpressão numérica, ou null.
function intOf(n) {
  const v = evaluate(n);
  return v && v.d === 1n ? Number(v.n) : null;
}
const intNode = (v) => (v < 0 ? fn('Negate', num(-v)) : num(v));

// A expressão não contém o símbolo `name`.
function freeOf(n, name) {
  let free = true;
  walk(n, (x) => { if (x.op === 'Symbol' && x.name === name) free = false; });
  return free;
}

// Achata somas dentro de somas e produtos dentro de produtos, sem parênteses:
// ((n + 1) − (k + 1)) − 1 e (n + 1) − (k + 1) − 1 são a mesma expressão.
function flatten(n) {
  while (n.op === 'Delimiter') n = n.args[0];
  if (!n.args) return n;
  const args = n.args.map(flatten);
  const assoc = n.op === 'Add' || n.op === 'Multiply';
  return { ...n, args: assoc ? args.flatMap((a) => (a.op === n.op ? a.args : [a])) : args };
}

// Igualdade estrutural a menos de parênteses e de associatividade.
const literal = (a, b) => sameLoose(flatten(a), flatten(b));

// Para reconhecer um padrão, vale também a igualdade como polinômios
// (normal.js): n − k − 1 serve onde se espera ((n + 1) − (k + 1)) − 1.
// Nesse caso a igualdade usada fica anotada e aparece no rótulo do passo,
// para o professor decidir se mostra a reorganização antes.
let notes = [];
function same(a, b) {
  if (literal(a, b)) return true;
  if (!equivalent(a, b)) return false;
  const show = (x) => toAscii(x).replace(/-/g, '−').replace(/\*/g, '·');
  const note = `${show(a)} = ${show(b)}`;
  if (!notes.includes(note)) notes.push(note);
  return true;
}
// Começa uma tentativa: esquece anotações de tentativas que não deram certo.
const attempt = () => { notes = []; };
// Rótulo do passo, com as igualdades usadas (e já consumidas).
function label(key) {
  const m = notes.length ? msg('step.using', { step: msg(key), eq: notes.join('; ') }) : msg(key);
  notes = [];
  return m;
}

// e + d, calculado quando dá: 5 → 6, n − 1 → n, n → n + 1.
function offset(e, d) {
  if (d === 0) return copy(e);
  const v = intOf(e);
  if (v !== null) return intNode(v + d);
  const u = unparen(e);
  if (u.op === 'Add') {
    const last = u.args[u.args.length - 1];
    const c = intOf(last);
    const rest = u.args.slice(0, -1).map(copy);
    if (c !== null && unparen(signed(last).body).op === 'Number') {
      return rebuild('Add', c + d === 0 ? rest : [...rest, intNode(c + d)]);
    }
    return fn('Add', ...u.args.map(copy), intNode(d));
  }
  return fn('Add', copy(e), intNode(d));
}

// n − k, calculado quando dá; n − (n − j) volta a ser j.
function minus(n, k) {
  const a = intOf(n);
  const b = intOf(k);
  if (a !== null && b !== null) return intNode(a - b);
  const u = unparen(k);
  if (u.op === 'Add' && u.args.length === 2 && literal(u.args[0], n) && u.args[1].op === 'Negate') {
    return copy(u.args[1].args[0]);
  }
  if (b !== null) return offset(n, -b);
  return fn('Add', copy(n), fn('Negate', copy(k)));
}

// Cópia de `body` com o índice trocado por `value` (cópias novas de tudo,
// que na animação saem do original). Somatórios internos com o mesmo
// índice não são tocados.
function instantiate(body, name, value, clones = {}) {
  const go = (n) => {
    if (n.op === 'Symbol' && n.name === name) return cloneFrom(value, {});
    if (isBigOp(n) && n.args[0].name === name) return cloneFrom(n, clones);
    const c = { ...n, id: newId() };
    clones[c.id] = n.id;
    if (n.args) c.args = n.args.map(go);
    return c;
  };
  return go(body);
}

// Nome livre para um índice novo.
function freshIndex(tree) {
  const used = new Set();
  walk(tree, (x) => { if (x.op === 'Symbol') used.add(x.name); });
  return ['k', 'j', 'm', 'r', 's', 't', 'u', 'v'].find((c) => !used.has(c)) ?? 'k';
}

// Somatório/produtório com os mesmos índice e termo, outros limites.
const bigLike = (S, a, b, body = copy(S.args[3])) => fn(S.op, copy(S.args[0]), a, b, body);
const sameBounds = (S, T) => S.op === T.op && S.args[0].name === T.args[0].name
  && same(S.args[1], T.args[1]) && same(S.args[2], T.args[2]);

// Somatório/produtório no foco ou acima dele.
function bigAt(ctx) {
  let p = ctx.focus;
  for (;;) {
    const n = getAt(ctx.tree, p);
    if (isBigOp(n)) return p;
    if (!p.length || isRelation(n.op)) return null;
    p = parentPath(p);
  }
}

// Soma (ou produto) que contém o foco: o próprio nó ou o pai de um termo.
function containerAt(ctx, op) {
  const { tree, focus } = ctx;
  let p = focus;
  for (let k = 0; k < 3; k++) {
    if (getAt(tree, p).op === op) return { p, at: k === 0 ? -1 : lastIndex(focus.slice(0, p.length + 1)) };
    if (!p.length) return null;
    p = parentPath(p);
  }
  return null;
}

// Troca os termos i e j do nó em p por `node` (no lugar de i).
function mergePair(tree, p, i, j, node) {
  const C = getAt(tree, p);
  const args = C.args.map((x, k) => (k === i ? node : x)).filter((_, k) => k !== j);
  return place(tree, p, rebuild(C.op, args, C));
}

// Pares (i, j) de termos do container; com o foco num termo, só os dele.
function pairs(C, at) {
  const out = [];
  for (let i = 0; i < C.args.length; i++) {
    for (let j = 0; j < C.args.length; j++) {
      if (i !== j && (at < 0 || i === at || j === at)) out.push([i, j]);
    }
  }
  return out;
}

// --------------------------------------------------------------- fatorial

// n! → n·(n − 1)!  ·  5! → 5·4·3·2·1  ·  n! → Π k
function factorialForms(ctx) {
  return atFocusOrParent(ctx, (p) => {
    const { tree } = ctx;
    const F = getAt(tree, p);
    if (F.op !== 'Factorial') return null;
    const x = F.args[0];
    const v = intOf(x);
    if (v !== null && v < 1) return null;
    const out = [];
    if (v !== null && v >= 2 && v <= 12) {
      const prod = fn('Multiply', ...Array.from({ length: v }, (_, i) => num(v - i)));
      out.push(done(tree, p, prod, 'step.factFull'));
    }
    if (v === null || v >= 2) {
      const node = fn('Multiply', x, withArgs(F, [offset(x, -1)]));
      out.push(done(tree, p, node, 'step.factStep'));
    }
    if (v === null) {
      const k = sym(freshIndex(tree));
      out.push(done(tree, p, fn('Product', k, num(1), copy(x), sym(k.name)), 'step.factProduct'));
    }
    return out;
  });
}

// n·(n − 1)! → n!  ·  5·4·3·2·1 → 5!
function factorialCollect(ctx) {
  return atFocusOrParent(ctx, (p) => {
    const { tree } = ctx;
    const M = getAt(tree, p);
    if (M.op !== 'Multiply') return null;
    const vs = M.args.map((a) => (a.op === 'Number' ? intOf(a) : null));
    const top = vs[0];
    const run = top !== null && top >= 2 && vs.every((v, i) => v === top - i) && vs[vs.length - 1] <= 2;
    if (run) return done(tree, p, fn('Factorial', num(top)), 'step.factCollect');
    for (let i = 0; i + 1 < M.args.length; i++) {
      for (const [x, f] of [[M.args[i], M.args[i + 1]], [M.args[i + 1], M.args[i]]]) {
        attempt();
        if (f.op !== 'Factorial' || !same(f.args[0], offset(x, -1))) continue;
        const node = withArgs(f, [unparen(x)]);
        const args = M.args.slice();
        args.splice(i, 2, node);
        return { tree: place(tree, p, rebuild('Multiply', args, M)), label: label('step.factCollect'), focus: node.id };
      }
    }
    return null;
  });
}

// ------------------------------------------------------- número binomial

// C(n, 0) = C(n, n) = 1 · C(n, 1) = C(n, n − 1) = n · definição · simetria · Stifel
function binomialForms(ctx) {
  return atFocusOrParent(ctx, (p) => {
    const { tree } = ctx;
    const B = getAt(tree, p);
    if (B.op !== 'Binomial') return null;
    const [n, k] = B.args;
    const out = [];
    const kv = intOf(k);
    if (kv === 0 || same(k, n)) out.push(done(tree, p, num(1), 'step.binomEdge'));
    else if (kv === 1 || same(k, offset(n, -1))) out.push(done(tree, p, copy(n), 'step.binomEdge'));
    const def = fn('Divide', fn('Factorial', copy(n)), fn('Multiply', fn('Factorial', copy(k)), fn('Factorial', minus(n, k))));
    out.push(done(tree, p, def, 'step.binomDef'));
    out.push(done(tree, p, withArgs(B, [n, minus(n, k)]), 'step.binomSym'));
    if ((kv === null || kv >= 1) && !literal(k, n)) {
      const stifel = fn('Add', fn('Binomial', offset(n, -1), offset(k, -1)), fn('Binomial', offset(n, -1), copy(k)));
      out.push(done(tree, p, stifel, 'step.stifel'));
    }
    return out;
  });
}

// n!/(k!(n − k)!) → C(n, k)
function binomialFromFactorials(ctx) {
  return atFocusOrParent(ctx, (p) => {
    const { tree } = ctx;
    const D = getAt(tree, p);
    if (D.op !== 'Divide' || D.args[0].op !== 'Factorial') return null;
    const den = unparen(D.args[1]);
    if (den.op !== 'Multiply' || den.args.length !== 2 || !den.args.every((f) => f.op === 'Factorial')) return null;
    const n = D.args[0].args[0];
    const [a, b] = den.args.map((f) => f.args[0]);
    // k é o fator mais simples (n!/((n − k)! k!) também dá C(n, k)); a
    // igualdade literal vale antes da polinomial.
    const size = (x) => { let c = 0; walk(x, () => c++); return c; };
    const order = size(b) < size(a) ? [[b, a], [a, b]] : [[a, b], [b, a]];
    const numeric = (x, y) => intOf(x) !== null && intOf(y) !== null && intOf(x) + intOf(y) === intOf(n);
    const k = order.find(([x, y]) => literal(y, minus(n, x)) || numeric(x, y))?.[0]
      ?? order.find(([x, y]) => same(y, minus(n, x)))?.[0];
    if (!k) return null;
    return done(tree, p, fn('Binomial', n, k), 'step.binomDefInv');
  });
}

// C(n, k) + C(n, k + 1) → C(n + 1, k + 1)
function stifelInverse(ctx) {
  const c = containerAt(ctx, 'Add');
  if (!c) return null;
  const { tree } = ctx;
  const S = getAt(tree, c.p);
  for (const [i, j] of pairs(S, c.at)) {
    attempt();
    const [x, y] = [S.args[i], S.args[j]];
    if (x.op !== 'Binomial' || y.op !== 'Binomial' || !same(x.args[0], y.args[0])) continue;
    if (!same(y.args[1], offset(x.args[1], 1))) continue;
    const node = fn('Binomial', offset(x.args[0], 1), y.args[1]);
    return { tree: mergePair(tree, c.p, Math.min(i, j), Math.max(i, j), node), label: label('step.stifelInv'), focus: node.id };
  }
  return null;
}

// ------------------------------------------------- somatório e produtório

// Fórmulas fechadas: Σk, Σk², Σk³, Σrᵏ, ΣC(n, k) e Πk = n!.
function closedForm(S) {
  const [k, a, n, f] = S.args;
  const lo = intOf(a);
  const isK = (x) => x.op === 'Symbol' && x.name === k.name;
  const n1 = () => offset(n, 1);
  if (S.op === 'Product') return lo === 1 && isK(f) ? [fn('Factorial', copy(n)), 'step.prodFactorial'] : null;
  const pw = f.op === 'Power' && isK(f.args[0]) ? intOf(f.args[1]) : isK(f) ? 1 : null;
  if ((lo === 0 || lo === 1) && pw === 1) {
    return [fn('Divide', fn('Multiply', copy(n), n1()), num(2)), 'step.sumClosed'];
  }
  if ((lo === 0 || lo === 1) && pw === 2) {
    const v = intOf(n);
    const twoN1 = v !== null ? num(2 * v + 1) : fn('Add', fn('Multiply', num(2), copy(n)), num(1));
    return [fn('Divide', fn('Multiply', copy(n), n1(), twoN1), num(6)), 'step.sumClosed'];
  }
  if ((lo === 0 || lo === 1) && pw === 3) {
    return [fn('Power', fn('Divide', fn('Multiply', copy(n), n1()), num(2)), num(2)), 'step.sumClosed'];
  }
  // progressão geométrica
  if (f.op === 'Power' && isK(f.args[1]) && freeOf(f.args[0], k.name) && (lo === 0 || lo === 1)) {
    const r = f.args[0];
    const rm1 = () => fn('Add', copy(r), fn('Negate', num(1)));
    const node = lo === 0
      ? fn('Divide', fn('Add', fn('Power', copy(r), n1()), fn('Negate', num(1))), rm1())
      : fn('Divide', fn('Multiply', copy(r), fn('Add', fn('Power', copy(r), copy(n)), fn('Negate', num(1)))), rm1());
    return [node, 'step.sumGeometric'];
  }
  if (lo === 0 && f.op === 'Binomial' && isK(f.args[1]) && same(f.args[0], n)) {
    return [fn('Power', num(2), copy(n)), 'step.sumClosed'];
  }
  return null;
}

// Número de termos: b − a + 1.
const countOf = (a, b) => (intOf(a) === 1 ? copy(b) : offset(minus(b, a), 1));

// Formas de um somatório/produtório, das mais diretas às mais gerais.
function bigForms(ctx) {
  const p = bigAt(ctx);
  if (!p) return [];
  const { tree } = ctx;
  const S = getAt(tree, p);
  const [k, a, b, f] = S.args;
  const isSum = S.op === 'Sum';
  const name = k.name;
  const out = [];
  const lo = intOf(a);
  const hi = intOf(b);

  // escrever os termos: 1² + 2² + 3²
  let writeOut = null;
  if (lo !== null && hi !== null && hi - lo + 1 >= 0 && hi - lo + 1 <= 12) {
    const clones = {};
    const items = [];
    for (let j = lo; j <= hi; j++) items.push(instantiate(f, name, intNode(j), clones));
    writeOut = done(tree, p, rebuild(isSum ? 'Add' : 'Multiply', items), 'step.bigWrite', { clones });
    out.push(writeOut);
  }

  const closed = closedForm(S);
  if (closed) out.push(done(tree, p, closed[0], closed[1]));

  // termo constante: Σ c = (b − a + 1)·c · Π c = c^(b − a + 1)
  if (freeOf(f, name)) {
    const node = isSum ? fn('Multiply', countOf(a, b), f) : fn('Power', f, countOf(a, b));
    out.push(done(tree, p, node, 'step.bigConst'));
  }

  // constante para fora: Σ c·f = c·Σ f · Σ(−f) = −Σ f · Σ f/c = (Σ f)/c · Π c·f = cⁿ·Π f
  const body = unparen(f);
  if (body.op === 'Multiply') {
    const consts = body.args.filter((x) => freeOf(x, name));
    const rest = body.args.filter((x) => !freeOf(x, name));
    if (consts.length && rest.length) {
      const inner = withArgs(S, [k, a, b, rebuild('Multiply', rest)]);
      const c = rebuild('Multiply', consts);
      const node = isSum ? fn('Multiply', ...consts, inner) : fn('Multiply', fn('Power', c, countOf(a, b)), inner);
      out.push(done(tree, p, node, 'step.bigPull'));
    }
  } else if (isSum && body.op === 'Negate') {
    out.push(done(tree, p, fn('Negate', withArgs(S, [k, a, b, body.args[0]])), 'step.bigPull'));
  } else if (isSum && body.op === 'Divide' && freeOf(body.args[1], name) && !freeOf(body.args[0], name)) {
    out.push(done(tree, p, fn('Divide', withArgs(S, [k, a, b, body.args[0]]), body.args[1]), 'step.bigPull'));
  }

  // soma telescópica: Σ (u(k + 1) − u(k)) = u(b + 1) − u(a)
  if (isSum && body.op === 'Add' && body.args.length === 2 && body.args[1].op === 'Negate' && body.args[0].op !== 'Negate') {
    const u = body.args[0];
    const v = body.args[1].args[0];
    const next = (x) => instantiate(x, name, fn('Add', sym(name), num(1)));
    let node = null;
    if (same(u, next(v))) node = fn('Add', instantiate(v, name, offset(b, 1)), fn('Negate', instantiate(v, name, a)));
    else if (same(v, next(u))) node = fn('Add', instantiate(u, name, a), fn('Negate', instantiate(u, name, offset(b, 1))));
    if (node) out.push(done(tree, p, node, 'step.telescope'));
  }

  // separar: Σ(f + g) = Σ f + Σ g · Π(f·g) = Π f · Π g
  if (body.op === (isSum ? 'Add' : 'Multiply')) {
    const parts = body.args.map((t, i) => {
      const make = (x) => (i === 0 ? withArgs(S, [k, a, b, x]) : bigLike(S, copy(a), copy(b), x));
      if (isSum && t.op === 'Negate') return withArgs(t, [make(t.args[0])]);
      return make(t);
    });
    out.push(done(tree, p, fn(isSum ? 'Add' : 'Multiply', ...parts), 'step.bigSplit'));
  }

  // separar o último e o primeiro termos (não com limites numéricos vazios)
  if (!(lo !== null && hi !== null && hi < lo)) {
    const op = isSum ? 'Add' : 'Multiply';
    const last = fn(op, withArgs(S, [k, a, offset(b, -1), f]), instantiate(f, name, b));
    out.push(done(tree, p, last, 'step.bigPeelLast'));
    const first = fn(op, instantiate(f, name, a), withArgs(S, [k, offset(a, 1), b, f]));
    out.push(done(tree, p, first, 'step.bigPeelFirst'));
  }

  // deslocar o índice: k → k + 1 e k → k − 1
  for (const d of [-1, 1]) {
    const shifted = instantiate(f, name, fn('Add', sym(name), intNode(-d)));
    out.push(done(tree, p, withArgs(S, [k, offset(a, d), offset(b, d), shifted]), 'step.bigShift'));
  }
  return out;
}

// Formas inversas, num nível acima: juntar dois somatórios, juntar
// intervalos, incluir um termo no somatório, constante para dentro.
function bigJoinForms(ctx) {
  const { tree } = ctx;
  const out = [];
  for (const [op, cop] of [['Sum', 'Add'], ['Product', 'Multiply']]) {
    const c = containerAt(ctx, cop);
    if (!c) continue;
    const C = getAt(tree, c.p);
    const isSum = op === 'Sum';
    const parts = C.args.map((t) => (isSum ? signed(t) : { neg: false, body: t }));
    for (const [i, j] of pairs(C, c.at)) {
      attempt();
      const [x, y] = [parts[i], parts[j]];
      const add = (node, key) => out.push({
        tree: mergePair(tree, c.p, Math.min(i, j), Math.max(i, j), node), label: label(key), focus: node.id,
      });
      if (x.body.op !== op || x.neg) continue;
      const S = x.body;
      const [k, a, b, f] = S.args;
      const T = y.body;
      // Σ f + Σ g = Σ(f + g) (só na ordem em que aparecem)
      if (i < j && T.op === op && sameBounds(S, T)) {
        const g = T.args[3];
        const inner = isSum ? fn('Add', f, y.neg ? fn('Negate', g) : g) : fn('Multiply', f, g);
        add(withArgs(S, [k, a, b, inner]), 'step.bigJoin');
      }
      // Σ_a^m f + Σ_(m+1)^b f = Σ_a^b f
      attempt();
      if (!y.neg && T.op === op && T.args[0].name === k.name && same(T.args[3], f)
        && same(T.args[1], offset(b, 1))) {
        add(withArgs(S, [k, a, T.args[2], f]), 'step.bigRanges');
      }
      attempt();
      // Σ_a^b f + f(b + 1) = Σ_a^(b+1) f  ·  f(a − 1) + Σ_a^b f = Σ_(a−1)^b f
      const t = C.args[j];
      if (same(t, instantiate(f, k.name, offset(b, 1)))) add(withArgs(S, [k, a, offset(b, 1), f]), 'step.bigAbsorb');
      else if (same(t, instantiate(f, k.name, offset(a, -1)))) add(withArgs(S, [k, offset(a, -1), b, f]), 'step.bigAbsorb');
    }
  }

  // c·Σ f = Σ c·f  ·  −Σ f = Σ(−f)
  attempt();
  const pull = atFocusOrParent(ctx, (p) => {
    const M = getAt(tree, p);
    if (M.op === 'Negate' && M.args[0].op === 'Sum') {
      const S = M.args[0];
      const node = withArgs(S, [...S.args.slice(0, 3), fn('Negate', S.args[3])]);
      return done(tree, p, node, 'step.bigPullIn');
    }
    if (M.op !== 'Multiply') return null;
    const sums = M.args.filter((x) => x.op === 'Sum');
    if (sums.length !== 1) return null;
    const S = sums[0];
    const others = M.args.filter((x) => x !== S);
    if (!others.every((x) => freeOf(x, S.args[0].name))) return null;
    const f = S.args[3];
    const node = withArgs(S, [...S.args.slice(0, 3), fn('Multiply', ...others, ...(f.op === 'Multiply' ? f.args : [f]))]);
    return done(tree, p, node, 'step.bigPullIn');
  });
  if (pull) out.push(pull);
  return out;
}

// O nível da soma (juntar) vem antes quando o foco está nela.
export function sumForms(ctx) {
  attempt();
  const n = getAt(ctx.tree, ctx.focus);
  const inner = bigForms(ctx);
  const outer = bigJoinForms(ctx);
  return n.op === 'Add' || n.op === 'Multiply' ? [...outer, ...inner] : [...inner, ...outer];
}

// Cada regra começa sem anotações pendentes.
const fresh = (f) => (ctx) => {
  attempt();
  return f(ctx);
};

export const COMBINATORICS_RULES = [binomialFromFactorials, factorialCollect, stifelInverse, binomialForms, factorialForms].map(fresh);

// ------------------------------------------------------- binômio de Newton

// (a + b)ⁿ = Σ_(k=0)^n C(n, k) a^(n−k) bᵏ
export function binomialTheorem(ctx) {
  attempt();
  return atFocusOrParent(ctx, (p) => {
    const { tree } = ctx;
    const P = getAt(tree, p);
    if (P.op !== 'Power') return null;
    const s = unparen(P.args[0]);
    if (s.op !== 'Add' || s.args.length !== 2) return null;
    const n = P.args[1];
    const k = freshIndex(tree);
    const body = fn('Multiply',
      fn('Binomial', copy(n), sym(k)),
      fn('Power', s.args[0], minus(n, sym(k))),
      fn('Power', s.args[1], sym(k)));
    return done(tree, p, fn('Sum', sym(k), num(0), copy(n), body), 'step.binomial');
  });
}

// Σ_(k=0)^n C(n, k) a^(n−k) bᵏ = (a + b)ⁿ
export function binomialTheoremInverse(ctx) {
  attempt();
  const p = bigAt(ctx);
  if (!p) return null;
  const { tree } = ctx;
  const S = getAt(tree, p);
  const [k, a, n, f] = S.args;
  if (S.op !== 'Sum' || intOf(a) !== 0 || f.op !== 'Multiply' || f.args.length !== 3) return null;
  const isK = (x) => x.op === 'Symbol' && x.name === k.name;
  const C = f.args.find((x) => x.op === 'Binomial' && same(x.args[0], n) && isK(x.args[1]));
  const B = f.args.find((x) => x.op === 'Power' && isK(x.args[1]));
  const A = f.args.find((x) => x.op === 'Power' && same(x.args[1], minus(n, k)));
  if (!C || !A || !B || A === B || !freeOf(A.args[0], k.name) || !freeOf(B.args[0], k.name)) return null;
  const node = fn('Power', fn('Add', A.args[0], B.args[0]), n);
  return done(tree, p, node, 'step.binomialInv');
}
