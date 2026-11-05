// Engine simbólico próprio: cada regra é uma transformação pequena e
// explícita, escolhida pelo usuário no menu contextual.
//
// Regra: { id, key, run(ctx) → resultado | null }  (nome no menu: i18n "rule.<id>")
//   ctx = { tree, focus: caminho, targets: caminhos (seleção ou [foco]),
//           input?, definitions?: { nome: árvore } }
//   resultado = { tree?, label, focus?: id, hints?, action? }
// Uma regra se aplica quando run() devolve algo; o menu usa o próprio
// resultado como prévia. Regras com `input` pedem um texto ao usuário (com
// textos de ajuda em i18n "rule.<id>.ph" e "rule.<id>.hint") e
// aparecem no menu quando available(ctx) é verdadeiro. `action` pede ao app
// algo além de trocar a árvore (definir um nome, abrir uma área de trabalho).
//
// Dicas de animação (hints):
//   merge:  { to: id, from: [ids] }  pedaços removidos "voam" até `to`
//   strike: [ids]                    pedaços removidos são riscados
//   clones: { idNovo: idOrigem }     cópias saem da posição do original

import { getAt, replaceAt, withArgs, fn, num, sym, same as identical, isLeaf, IMAGINARY, isImaginaryUnit, walk, findPath } from '../ast.js';
import { needsParens } from '../notation.js';
import { parseInput } from '../input.js';
import { toAscii } from '../serialize.js';
import { matches as same, withNotes } from './normal.js';
import { msg } from '../i18n.js';
import { DERIVATIVE_RULES, LIMIT_RULES, INTEGRAL_RULES, definiteForms, integralAt, substitution, byParts } from './calculus.js';
import { isRelation, FLIP, direction, RELATIONS, RELATION_INPUT, relationAt } from '../relations.js';
import { scaledRelation } from '../moves.js';
import { evaluate, evaluateComplex, ratToNode, complexToNode } from './arith.js';
import { LOG_RULES, TRIG_RULES, RADICAL_RULES, rationalizeSuggestion } from './functions.js';
import { COMBINATORICS_RULES, sumForms, binomialTheorem, binomialTheoremInverse } from './combinatorics.js';
import { monomial as normalMonomial, sameMonomial, negateMonomial, squareRoot } from './monomial.js';
import {
  terms, factors, unparen, signed, parentPath, lastIndex, parentOf,
  siblingsOf, cloneFrom, spliceFlat, rebuild, place, atFocusOrParent, sumOf, isNum, either,
} from './util.js';


// ---------------------------------------------------------------- calcular

function calculate(ctx) {
  const { tree, targets } = ctx;
  if (targets.length === 1) {
    const p = targets[0];
    const n = getAt(tree, p);
    if (isLeaf(n) || (n.op === 'Negate' && isLeaf(n.args[0]))) return null;
    const v = evaluateComplex(n);
    if (!v) return null;
    const node = complexToNode(v);
    if (identical(node, n)) return null;
    return {
      tree: place(tree, p, node),
      label: msg('step.calc'),
      focus: node.id,
      hints: { merge: { to: node.id, from: [n.id] } },
    };
  }
  const idx = siblingsOf(targets);
  if (!idx) return null;
  const pp = parentPath(targets[0]);
  const parent = getAt(tree, pp);
  if (parent.op !== 'Add' && parent.op !== 'Multiply') return null;
  const items = idx.map((i) => parent.args[i]);
  const v = evaluateComplex(fn(parent.op, ...items));
  if (!v) return null;
  const node = complexToNode(v);
  const args = parent.args.filter((_, i) => !idx.includes(i) || i === idx[0]);
  args[args.indexOf(parent.args[idx[0]])] = node;
  return {
    tree: replaceAt(tree, pp, rebuild(parent.op, args, parent)),
    label: msg('step.calc'),
    focus: node.id,
    hints: { merge: { to: node.id, from: items.map((x) => x.id) } },
  };
}

// -------------------------------------------------------------- distribuir

function distribute(ctx) {
  return atFocusOrParent(ctx, (p) => {
    const { tree } = ctx;
    const n = getAt(tree, p);
    const clones = {};

    // −(a + b) → −a − b  (cada termo ganha o seu sinal; nada é cancelado)
    if (n.op === 'Negate' && sumOf(n.args[0])) {
      const s = sumOf(n.args[0]);
      const result = withArgs(s, s.args.map((t) => fn('Negate', t)));
      return { tree: place(tree, p, result), label: msg('step.distSign'), focus: result.id };
    }

    // a(b + c) → ab + ac
    if (n.op !== 'Multiply') return null;
    let k = n.args.findIndex((f) => sumOf(f));
    const focusIdx = ctx.focus.length === p.length + 1 ? lastIndex(ctx.focus) : -1;
    if (focusIdx >= 0 && sumOf(n.args[focusIdx])) k = focusIdx;
    if (k < 0) return null;
    const s = sumOf(n.args[k]);
    const before = n.args.slice(0, k);
    const after = n.args.slice(k + 1);
    const newTerms = s.args.map((t, i) => {
      const { neg, body } = signed(t);
      const copy = (x) => (i === 0 ? x : cloneFrom(x, clones));
      const fs = [...before.map(copy), ...factors(body), ...after.map(copy)];
      const prod = fs.length === 1 ? fs[0] : fn('Multiply', ...fs);
      return neg ? withArgs(t, [prod]) : prod;
    });
    const result = withArgs(s, newTerms);
    return { tree: place(tree, p, result), label: msg('step.dist'), focus: result.id, hints: { clones } };
  });
}

// -------------------------------------------------------- pôr em evidência

// Caminho da parcela que contém p: sobe por um produto e por um sinal.
function termPathOf(tree, p) {
  let tp = p;
  if (parentOf(tree, tp)?.op === 'Multiply') tp = parentPath(tp);
  if (parentOf(tree, tp)?.op === 'Negate') tp = parentPath(tp);
  return tp;
}

// Pôr em evidência pela seleção: o usuário marca o fator comum em cada
// parcela (Espaço) e aperta "e". As parcelas envolvidas são as que têm uma
// seleção; o fator é o que foi selecionado na primeira delas (com sinal, se
// a parcela −b inteira foi selecionada). Parcelas inteiras vizinhas
// selecionadas juntas formam uma ocorrência só: em 1 − a − b(1 − a),
// selecionar 1, −a e o (1 − a) de dentro põe 1 − a em evidência.
// Sem seleção, ou só com parcelas inteiras, vale o fator em foco.
function factorOut(ctx) {
  const { tree, targets } = ctx;
  if (targets.length < 2) return factorAt(ctx);
  const info = targets.map((p) => ({ p, tp: termPathOf(tree, p) }));
  const sp = parentPath(info[0].tp).join();
  if (info.some((x) => parentPath(x.tp).join() !== sp) || parentOf(tree, info[0].tp)?.op !== 'Add') return factorAt(ctx);
  info.forEach((x) => { x.whole = x.p.length === x.tp.length; x.i = lastIndex(x.tp); });
  if (info.every((x) => x.whole)) return factorAt(ctx);
  if (new Set(info.map((x) => x.i)).size !== info.length) return null; // duas seleções na mesma parcela
  info.sort((a, b) => a.i - b.i);

  // Ocorrências: parcelas inteiras vizinhas (2 ou mais) viram um grupo.
  const occ = [];
  for (const x of info) {
    const last = occ[occ.length - 1];
    if (x.whole && last?.run && last.items[last.items.length - 1].i === x.i - 1) last.items.push(x);
    else occ.push(x.whole ? { run: true, items: [x] } : { run: false, items: [x] });
  }
  occ.forEach((o) => { if (o.run && o.items.length === 1) o.run = false; });

  // O fator: a seleção da primeira ocorrência; se ela é um grupo de
  // parcelas, uma seleção de dentro de outra parcela que seja igual a ele.
  let focus = occ[0].items[0].p;
  if (occ[0].run) {
    const S = parentOf(tree, info[0].tp);
    const group = fn('Add', ...occ[0].items.map((x) => S.args[x.i]));
    const match = info.find((x) => !x.whole && same(unparen(getAt(tree, x.p)), group));
    if (!match) return null;
    focus = match.p;
  }
  return factorAt({ ...ctx, focus, targets: info.map((x) => x.tp) });
}

// Mesmo fator, ignorando parênteses digitados: (1 − a) e 1 − a.
const sameFactor = (a, b) => same(unparen(a), unparen(b));

// Põe em evidência o fator em foco nos termos da soma (os selecionados, com
// o do foco, ou todos):
//   foco em b dentro de ab:       −b + ab → (−1 + a)b
//   foco no termo −b (inteiro):   −b + ab → −b(1 − a)      (fator com sinal)
//   foco em (1 − a) dentro de −b(1 − a): os termos soltos 1 − a do começo
//   da soma contam como uma ocorrência:  1 − a − b(1 − a) → (1 − a)(1 − b)
function factorAt(ctx) {
  const { tree, focus, targets } = ctx;
  if (!focus.length) return null;
  const F = getAt(tree, focus);
  let tp = focus;
  if (parentOf(tree, tp)?.op === 'Multiply') tp = parentPath(tp);
  if (parentOf(tree, tp)?.op === 'Negate') tp = parentPath(tp);
  const sp = parentPath(tp);
  let S = parentOf(tree, tp);
  if (S?.op !== 'Add') return null;

  // Foco no termo −b inteiro: o fator é −b.
  const negF = F.op === 'Negate' && tp === focus;
  const base = negF ? F.args[0] : F;
  let ti = lastIndex(tp);
  let chosen = new Set(targets.filter((t) => parentPath(t).join() === sp.join()).map(lastIndex));

  // Fator que é uma soma: procura os seus termos, em sequência, soltos na
  // soma, e os trata como uma ocorrência só (um grupo).
  const fb = unparen(base);
  if (fb.op === 'Add') {
    const m = fb.args.length;
    for (let i = 0; i + m <= S.args.length; i++) {
      if (i <= ti && ti < i + m) continue;
      if (!fb.args.every((x, k) => same(S.args[i + k], x))) continue;
      const remap = (j) => (j < i ? j : j < i + m ? i : j - m + 1);
      S = withArgs(S, [...S.args.slice(0, i), fn('Delimiter', fn('Add', ...S.args.slice(i, i + m))), ...S.args.slice(i + m)]);
      ti = remap(ti);
      chosen = new Set([...chosen].map(remap));
      break;
    }
  }

  // Termos envolvidos: os selecionados dessa soma (com o do foco) ou todos.
  chosen.add(ti);
  const idx = chosen.size >= 2 ? [...chosen].sort((a, b) => a - b) : S.args.map((_, i) => i);
  if (idx.length < 2) return null;

  // O fator fica do lado em que aparece no primeiro termo da soma:
  // ax + bx → (a + b)x;  2x + 2y → 2(x + y);  1 − a − b(1 − a) → (1 − a)(1 − b).
  // Se o que sobra são só números, eles vão para a esquerda (abaixo).
  const removed = [];
  let atEnd = false;
  const rems = [];
  for (const i of idx) {
    const t = S.args[i];
    const { neg, body } = signed(t);
    let rem;
    if (body.id === base.id || sameFactor(body, base)) {
      rem = num(1);
      if (body.id !== base.id) removed.push(body.id);
    } else if (body.op === 'Multiply') {
      let j = body.args.findIndex((a) => a.id === base.id);
      if (j < 0) j = body.args.findIndex((a) => sameFactor(a, base));
      if (j < 0) return null;
      if (i === idx[0]) atEnd = j === body.args.length - 1;
      if (body.args[j].id !== base.id) removed.push(body.args[j].id);
      rem = rebuild('Multiply', body.args.filter((_, q) => q !== j), body);
    } else return null;
    // Com o fator −b, o sinal de cada resto inverte.
    rems.push(neg !== negF ? (neg ? withArgs(t, [rem]) : fn('Negate', rem)) : rem);
  }

  // Coeficientes todos numéricos: ficam à esquerda, em foco, prontos para
  // calcular:  x·2 + x·3 → (2 + 3)x.
  const numeric = rems.every((r) => evaluate(r));
  if (numeric) atEnd = true;
  const all = idx.length === S.args.length;
  const inner = all ? withArgs(S, rems) : fn('Add', ...rems);
  let product = atEnd ? fn('Multiply', inner, base) : fn('Multiply', base, inner);
  if (negF) product = withArgs(F, [product]);
  let t2;
  if (all) t2 = replaceAt(tree, sp, product);
  else {
    const args = S.args.filter((_, i) => !idx.includes(i) || i === idx[0]);
    args[args.indexOf(S.args[idx[0]])] = product;
    t2 = replaceAt(tree, sp, withArgs(S, args));
  }
  return {
    tree: t2,
    label: msg('step.factor'),
    focus: numeric ? inner.id : product.id,
    hints: { merge: { to: base.id, from: removed } },
  };
}

// 12 → 2²·3: decompõe o número em foco em fatores primos (o inverso de
// calcular). Só números inteiros compostos.
function primeFactors(ctx) {
  const { tree, focus } = ctx;
  const n = getAt(tree, focus);
  if (n.op !== 'Number' || !/^\d+$/.test(n.value)) return null;
  let m = BigInt(n.value);
  if (m < 4n || m > 10n ** 12n) return null;
  const ps = [];
  for (let d = 2n; d * d <= m; d++) {
    let k = 0;
    while (m % d === 0n) { m /= d; k++; }
    if (k) ps.push([d, k]);
  }
  if (m > 1n) ps.push([m, 1]);
  if (ps.length === 1 && ps[0][1] === 1) return null; // primo
  const fs = ps.map(([d, k]) => (k === 1 ? num(d.toString()) : fn('Power', num(d.toString()), num(k))));
  const node = rebuild('Multiply', fs);
  const parent = parentOf(tree, focus);
  const t2 = parent?.op === 'Multiply'
    ? replaceAt(tree, parentPath(focus), withArgs(parent, spliceFlat(parent, lastIndex(focus), [node])))
    : replaceAt(tree, focus, node);
  return { tree: t2, label: msg('step.primeFactors'), focus: fs[0].id };
}

// ------------------------------------------------------------------ cancelar

// Termos opostos numa soma: x e −x somem juntos.
function cancelTerms(ctx) {
  const { tree, targets, focus } = ctx;
  let sp, i, j;
  const idx = siblingsOf(targets);
  if (idx && idx.length === 2) {
    sp = parentPath(targets[0]);
    [i, j] = idx;
  } else if (targets.length === 1) {
    let tp = focus;
    if (parentOf(tree, tp)?.op === 'Negate') tp = parentPath(tp);
    if (parentOf(tree, tp)?.op !== 'Add') return null;
    sp = parentPath(tp);
    i = lastIndex(tp);
    const S = getAt(tree, sp);
    const a = signed(S.args[i]);
    j = S.args.findIndex((t, k) => k !== i && signed(t).neg !== a.neg && same(signed(t).body, a.body));
    if (j < 0) return null;
  } else return null;

  const S = getAt(tree, sp);
  if (S.op !== 'Add') return null;
  const a = signed(S.args[i]);
  const b = signed(S.args[j]);
  if (a.neg === b.neg || !same(a.body, b.body)) return null;
  const rest = S.args.filter((_, k) => k !== i && k !== j);
  return {
    tree: replaceAt(tree, sp, rebuild('Add', rest, S)),
    label: msg('step.cancelTerms'),
    hints: { strike: [S.args[i].id, S.args[j].id] },
  };
}

// Onde um nó está dentro de uma fração: { dp, side, k } com k = índice do
// fator (ou -1 se o nó é o numerador/denominador inteiro).
function fractionSlot(tree, p) {
  const parent = parentOf(tree, p);
  if (parent?.op === 'Divide') return { dp: parentPath(p), side: lastIndex(p), k: -1 };
  if (parent?.op === 'Multiply' && parentOf(tree, parentPath(p))?.op === 'Divide') {
    const mp = parentPath(p);
    return { dp: parentPath(mp), side: lastIndex(mp), k: lastIndex(p) };
  }
  return null;
}

// Fatores iguais no numerador e no denominador.
function cancelFactors(ctx) {
  const { tree, targets, focus } = ctx;
  let A, B;
  if (targets.length === 2) return cancelSelected(tree, targets);
  if (targets.length === 1) {
    A = fractionSlot(tree, focus);
    if (!A) return null;
    const D = getAt(tree, A.dp);
    const mine = getAt(tree, focus);
    const other = D.args[1 - A.side];
    const k = factors(other).findIndex((f) => same(f, mine));
    if (k < 0) return null;
    B = { dp: A.dp, side: 1 - A.side, k: other.op === 'Multiply' ? k : -1 };
  } else return null;

  const D = getAt(tree, A.dp);
  const pick = (s) => (s.k < 0 ? D.args[s.side] : D.args[s.side].args[s.k]);
  const x = pick(A);
  const y = pick(B);
  if (!same(x, y)) return null;
  const strip = (s) => {
    const part = D.args[s.side];
    return s.k < 0 ? num(1) : rebuild('Multiply', part.args.filter((_, q) => q !== s.k), part);
  };
  const args = [];
  args[A.side] = strip(A);
  args[B.side] = strip(B);
  return {
    tree: replaceAt(tree, A.dp, withArgs(D, args)),
    label: msg('step.cancelFactors'),
    hints: { strike: [x.id, y.id] },
  };
}

// Onde fica um fator selecionado: no numerador ou no denominador, e em que
// "escopos" (a fração e, se ela for fator de um produto, esse produto). Um
// fator solto num produto conta como numerador: em 2·(x/2) o 2 cancela.
function cancelSlot(tree, p) {
  let q = p;
  let mul = null;
  if (parentOf(tree, q)?.op === 'Multiply') { q = parentPath(q); mul = q; }
  if (parentOf(tree, q)?.op === 'Negate') q = parentPath(q);
  if (parentOf(tree, q)?.op === 'Divide') {
    const f = parentPath(q);
    const scopes = [f];
    let r = f;
    if (parentOf(tree, r)?.op === 'Delimiter') r = parentPath(r);
    if (parentOf(tree, r)?.op === 'Multiply') scopes.push(parentPath(r));
    return { den: lastIndex(q) === 1, scopes };
  }
  return mul && { den: false, scopes: [mul] };
}

// Tira o fator em p: sai do produto ou vira 1.
function removeFactor(tree, p) {
  const parent = parentOf(tree, p);
  if (parent?.op === 'Multiply') {
    return replaceAt(tree, parentPath(p), rebuild('Multiply', parent.args.filter((_, i) => i !== lastIndex(p)), parent));
  }
  return replaceAt(tree, p, num(1));
}

// Dois fatores iguais selecionados, um em cima e outro embaixo, na mesma
// fração ou em frações (e fatores) de um mesmo produto: (a/b)(b/c) → (a/1)(1/c).
function cancelSelected(tree, targets) {
  const [A, B] = targets.map((p) => cancelSlot(tree, p));
  if (!A || !B || A.den === B.den) return null;
  if (!A.scopes.some((x) => B.scopes.some((y) => x.join() === y.join()))) return null;
  const [x, y] = targets.map((p) => getAt(tree, p));
  if (!same(unparen(x), unparen(y))) return null;
  // Pelo id: tirar o primeiro pode mudar o caminho do segundo.
  const t1 = removeFactor(tree, targets[0]);
  return {
    tree: removeFactor(t1, findPath(t1, y.id)),
    label: msg('step.cancelFactors'),
    hints: { strike: [x.id, y.id] },
  };
}

const cancel = (ctx) => cancelTerms(ctx) ?? cancelFactors(ctx);

// ----------------------------------------------------- elemento neutro

function neutral(ctx) {
  return atFocusOrParent(ctx, (p) => {
    const { tree } = ctx;
    const n = getAt(tree, p);
    let node = null;
    let gone = [];
    let label = 'step.neutral';
    // Zero absorve: 0·x → 0 · 0/x → 0 · x⁰ → 1 (x ≠ 0) · e 1ᵏ → 1
    const zero = n.op === 'Multiply' && n.args.find((a) => isNum(a, 0));
    if (zero) {
      node = zero;
      gone = n.args.filter((a) => a !== zero).map((a) => a.id);
      label = 'step.zero';
    } else if (n.op === 'Divide' && isNum(n.args[0], 0) && !isNum(n.args[1], 0)) {
      node = n.args[0];
      gone = [n.args[1].id];
      label = 'step.zero';
    } else if (n.op === 'Power' && isNum(n.args[1], 0) && !isNum(n.args[0], 0)) {
      node = num(1);
      gone = [n.args[0].id, n.args[1].id];
      label = 'step.powZero';
    } else if (n.op === 'Power' && isNum(n.args[0], 1)) {
      // 1ᵏ → 1, para qualquer expoente
      node = n.args[0];
      gone = [n.args[1].id];
      label = 'step.powOne';
    } else if (n.op === 'Divide' && isNum(n.args[1], 1)) { node = n.args[0]; gone = [n.args[1].id]; }
    else if (n.op === 'Power' && isNum(n.args[1], 1)) { node = n.args[0]; gone = [n.args[1].id]; }
    else if (n.op === 'Negate' && isNum(n.args[0], 0)) { node = n.args[0]; }
    else if (n.op === 'Add' || n.op === 'Multiply') {
      const unit = n.op === 'Add' ? 0 : 1;
      const keep = n.args.filter((a) => !isNum(a, unit));
      if (keep.length === n.args.length || keep.length === 0) return null;
      gone = n.args.filter((a) => isNum(a, unit)).map((a) => a.id);
      node = rebuild(n.op, keep, n);
    } else return null;
    return { tree: replaceAt(tree, p, node), label: msg(label), focus: node.id, hints: { strike: gone } };
  });
}

// --------------------------------------------------------- parênteses

function removeParens(ctx) {
  return atFocusOrParent(ctx, (p) => {
    const { tree } = ctx;
    const n = getAt(tree, p);
    const parent = parentOf(tree, p);
    const content = n.op === 'Delimiter' ? n.args[0] : n;
    // Grupo implícito (soma dentro de soma, produto dentro de produto).
    const flattens = parent && (parent.op === 'Add' || parent.op === 'Multiply') && content.op === parent.op;
    if (n.op !== 'Delimiter' && !flattens) return null;
    let t2;
    if (flattens) {
      t2 = replaceAt(tree, parentPath(p), withArgs(parent, spliceFlat(parent, lastIndex(p), [content])));
    } else {
      if (parent && needsParens(content, parent, lastIndex(p))) return null;
      t2 = replaceAt(tree, p, content);
    }
    return { tree: t2, label: msg('step.parens'), focus: content.id };
  });
}

// ------------------------------------------------------- trocar os sinais

// Inverte o sinal de um termo sem acumular: x → −x, −x → x.
const flip = (t) => (t.op === 'Negate' ? t.args[0] : fn('Negate', t));

// A(B + C + …) → −A(−B − C − …)  e  B + C → −(−B − C): multiplica por
// (−1)(−1), mostrando os dois sinais trocados.
function flipSigns(ctx) {
  const { tree } = ctx;
  let p = ctx.targets[0];
  let n = getAt(tree, p);
  let parent = parentOf(tree, p);

  // Com o foco na soma (ou nos parênteses) de −(B + C), o sinal é o de fora.
  if (n.op === 'Add' && parent?.op === 'Delimiter') { p = parentPath(p); n = parent; parent = parentOf(tree, p); }
  if (sumOf(n) && parent?.op === 'Negate') { p = parentPath(p); n = parent; parent = parentOf(tree, p); }

  // Integral e somatório: como nos parênteses, o sinal entra no termo e sai dele.
  const hasTerm = (x) => x.op === 'Integrate' || x.op === 'Sum';
  const which = (x) => (x.op === 'Sum' ? 'Sum' : 'Int');
  if (hasTerm(n) && parent?.op === 'Negate') { p = parentPath(p); n = parent; parent = parentOf(tree, p); }
  const integrand = (I, body) => withArgs(I, [...I.args.slice(0, -1), body]);
  // −f, ou −b − c (vira b + c); sem sinal para tirar, null.
  const minusOf = (b) => {
    const u = unparen(b);
    if (u.op === 'Negate') return u.args[0];
    return u.op === 'Add' && u.args.every((t) => t.op === 'Negate') ? withArgs(u, u.args.map(flip)) : null;
  };
  const flipBody = (b) => (sumOf(b) ? withArgs(sumOf(b), sumOf(b).args.map(flip)) : flip(b));
  // −∫ f dx → ∫ −f dx (a − ∫ f dx → a + ∫ −f dx) · −Σ f → Σ −f
  if (n.op === 'Negate' && hasTerm(n.args[0])) {
    const I = n.args[0];
    const node = integrand(I, flipBody(I.args[I.args.length - 1]));
    return { tree: replaceAt(tree, p, node), label: msg(`step.signsIn${which(I)}`), focus: node.id };
  }
  if (hasTerm(n)) {
    const body = n.args[n.args.length - 1];
    const out = minusOf(body);
    // ∫ −f dx → −∫ f dx · ∫ f dx → −∫ −f dx (e o mesmo com Σ)
    const node = fn('Negate', integrand(n, out ?? flipBody(body)));
    return { tree: replaceAt(tree, p, node), label: msg(out ? `step.signsOut${which(n)}` : 'step.flipSigns'), focus: node.id };
  }

  // −(B + C) → (−B − C): o sinal entra nos parênteses (a − (b + c) → a + (−b − c)).
  if (n.op === 'Negate' && sumOf(n.args[0])) {
    const s = sumOf(n.args[0]);
    const inner = withArgs(s, s.args.map(flip));
    const node = parent?.op === 'Add' || parent?.op === 'Negate' ? fn('Delimiter', inner) : inner;
    return { tree: replaceAt(tree, p, node), label: msg('step.signsIn'), focus: node.id };
  }
  // −(A(B + C)): o sinal de fora já é o que troca.
  if (n.op === 'Negate' && n.args[0].op === 'Multiply') {
    p = [...p, 0];
    n = getAt(tree, p);
    parent = parentOf(tree, p);
  }
  // (−B − C) numa soma → −(B + C): o sinal sai dos parênteses.
  if (n.op === 'Delimiter' && sumOf(n) && parent?.op === 'Add') {
    const s = sumOf(n);
    const node = fn('Negate', fn('Delimiter', withArgs(s, s.args.map(flip))));
    return { tree: replaceAt(tree, p, node), label: msg('step.signsOut'), focus: node.id };
  }

  if (n.op === 'Add') {
    if (parent?.op === 'Multiply') return null; // é o fator de um produto: use o produto
    const inner = withArgs(n, n.args.map(flip));
    const node = fn('Negate', inner);
    return { tree: place(tree, p, node), label: msg('step.flipSigns'), focus: node.id };
  }
  if (n.op !== 'Multiply') return null;
  const k = n.args.findIndex((f) => sumOf(f));
  if (k < 0 || n.args.length < 2) return null;
  const s = sumOf(n.args[k]);
  const args = n.args.slice();
  args[k] = withArgs(s, s.args.map(flip));

  // O sinal de fora: some se o produto já era negativo (−A·… ou −(A·…)).
  const first = k === 0 ? 1 : 0;
  if (unparen(args[first]).op === 'Negate') {
    args[first] = unparen(args[first]).args[0];
    return { tree: replaceAt(tree, p, withArgs(n, args)), label: msg('step.flipSigns'), focus: n.id };
  }
  if (parent?.op === 'Negate') {
    const prod = withArgs(n, args);
    return { tree: replaceAt(tree, parentPath(p), prod), label: msg('step.flipSigns'), focus: prod.id };
  }
  const node = fn('Negate', withArgs(n, args));
  return { tree: replaceAt(tree, p, node), label: msg('step.flipSigns'), focus: node.id };
}

// ------------------------------------------------------------- agrupar

function group(ctx) {
  const { tree, targets } = ctx;
  const idx = siblingsOf(targets);
  if (!idx) return null;
  const pp = parentPath(targets[0]);
  const parent = getAt(tree, pp);
  if ((parent.op !== 'Add' && parent.op !== 'Multiply') || idx.length === parent.args.length) return null;
  const g = fn('Delimiter', fn(parent.op, ...idx.map((i) => parent.args[i])));
  const args = parent.args.filter((_, i) => !idx.includes(i) || i === idx[0]);
  args[args.indexOf(parent.args[idx[0]])] = g;
  return { tree: replaceAt(tree, pp, withArgs(parent, args)), label: msg('step.group'), focus: g.id };
}

// ------------------------------------------------- pôr entre parênteses

// Acrescenta um nível de parênteses (Delimiter) em volta da seleção. Vários
// irmãos vizinhos de uma soma/produto viram um grupo só; seleções soltas
// ganham parênteses cada uma.
function wrapParens(ctx) {
  const { tree, targets } = ctx;
  const idx = siblingsOf(targets);
  if (idx) {
    const pp = parentPath(targets[0]);
    const parent = getAt(tree, pp);
    const contiguous = idx.every((v, i) => i === 0 || v === idx[i - 1] + 1);
    if ((parent.op === 'Add' || parent.op === 'Multiply') && contiguous) {
      // A soma inteira selecionada: os parênteses vão em volta dela.
      if (idx.length === parent.args.length) return wrapParens({ ...ctx, targets: [pp] });
      const g = fn('Delimiter', fn(parent.op, ...idx.map((i) => parent.args[i])));
      const args = parent.args.slice();
      args.splice(idx[0], idx.length, g);
      return { tree: replaceAt(tree, pp, withArgs(parent, args)), label: msg('step.wrapParens'), focus: g.id };
    }
  }
  // De trás para a frente: envolver um nó interno não muda o caminho de um
  // nó que vem antes dele.
  let t2 = tree;
  let focus = null;
  for (const p of [...targets].reverse()) {
    const n = getAt(t2, p);
    if (isRelation(n.op) || n.op === 'System') return null;
    const d = fn('Delimiter', n);
    focus = d.id;
    t2 = replaceAt(t2, p, d);
  }
  return { tree: t2, label: msg('step.wrapParens'), focus };
}

// --------------------------------------------------------------- frações

function joinFractions(ctx) {
  const { tree, targets, focus } = ctx;
  let sp, idx;
  const sib = siblingsOf(targets);
  if (sib) {
    sp = parentPath(targets[0]);
    idx = sib;
  } else {
    // A soma de frações mais próxima, subindo a partir do foco (que pode
    // estar dentro de um numerador).
    // Uma seleção que não são parcelas vizinhas é para outra operação
    // (separar a fração, por exemplo).
    if (targets.length > 1) return null;
    const fractions = (q) => getAt(tree, q).op === 'Add'
      && getAt(tree, q).args.filter((t) => signed(t).body.op === 'Divide').length >= 2;
    sp = focus;
    while (sp.length && !fractions(sp)) sp = parentPath(sp);
    if (!fractions(sp)) return null;
    idx = getAt(tree, sp).args.map((_, i) => i);
  }
  const S = getAt(tree, sp);
  if (S.op !== 'Add' || idx.length < 2) return null;
  const parts = idx.map((i) => ({ t: S.args[i], ...signed(S.args[i]) }));
  if (parts.some((x) => x.body.op !== 'Divide')) return null;
  // Denominadores iguais: a menos de parênteses e, como polinômios, de
  // ordem (o rótulo anota a igualdade usada).
  const den = parts[0].body.args[1];
  if (parts.some((x) => !same(x.body.args[1], den))) return { error: 'err.denoms', sp };
  const nums = parts.map((x) => (x.neg ? withArgs(x.t, [x.body.args[0]]) : x.body.args[0]));
  const frac = withArgs(parts[0].body, [fn('Add', ...nums), den]);
  let t2;
  if (idx.length === S.args.length) t2 = replaceAt(tree, sp, frac);
  else {
    const args = S.args.filter((_, i) => !idx.includes(i) || i === idx[0]);
    args[args.indexOf(S.args[idx[0]])] = frac;
    t2 = replaceAt(tree, sp, withArgs(S, args));
  }
  return {
    tree: t2,
    label: msg('step.join'),
    focus: frac.id,
    hints: { merge: { to: den.id, from: parts.slice(1).map((x) => x.body.args[1].id) } },
  };
}

// (a/b)(c/d) → (ac)/(bd); um fator solto vai para o numerador: 2(x/3) → (2x)/3.
// Vale para o produto em foco ou para os fatores selecionados dele.
function multiplyFractions(ctx) {
  const { tree, targets, focus } = ctx;
  let mp, idx;
  const sib = siblingsOf(targets);
  if (sib && parentOf(tree, targets[0])?.op === 'Multiply') {
    mp = parentPath(targets[0]);
    idx = sib;
  } else {
    mp = getAt(tree, focus).op === 'Multiply' ? focus : parentPath(focus);
    if (!mp || getAt(tree, mp)?.op !== 'Multiply') return null;
    idx = getAt(tree, mp).args.map((_, i) => i);
  }
  const M = getAt(tree, mp);
  if (idx.length < 2) return null;
  const parts = idx.map((i) => unparen(M.args[i]));
  const fracs = parts.filter((x) => x.op === 'Divide');
  if (!fracs.length) return null;
  const nums = parts.flatMap((x) => factors(x.op === 'Divide' ? x.args[0] : x));
  const dens = fracs.flatMap((x) => factors(x.args[1]));
  const frac = withArgs(fracs[0], [rebuild('Multiply', nums), rebuild('Multiply', dens)]);
  let t2;
  if (idx.length === M.args.length) t2 = place(tree, mp, frac);
  else {
    const args = M.args.filter((_, i) => !idx.includes(i) || i === idx[0]);
    args[args.indexOf(M.args[idx[0]])] = frac;
    t2 = replaceAt(tree, mp, withArgs(M, args));
  }
  return { tree: t2, label: msg('step.multFrac'), focus: frac.id };
}

// (ab)/(cd) → (a/c)(b/d), o inverso do produto de frações. Com fatores
// selecionados (em cima e/ou embaixo), eles formam a primeira fração e o
// resto a segunda; sem seleção, os fatores se pareiam pela posição.
function splitProduct(ctx) {
  const { tree, targets, focus } = ctx;
  const slotOf = (p) => {
    const parent = parentOf(tree, p);
    if (parent?.op === 'Divide') return { dp: parentPath(p), side: lastIndex(p), k: -1 };
    if (parent?.op === 'Multiply' && parentOf(tree, parentPath(p))?.op === 'Divide') {
      const mp = parentPath(p);
      return { dp: parentPath(mp), side: lastIndex(mp), k: lastIndex(p) };
    }
    return null;
  };
  const slots = targets.map(slotOf);
  let dp;
  let picked = null;
  if (slots.every((x) => x && x.dp.join() === slots[0].dp.join())) {
    dp = slots[0].dp;
    picked = [new Set(), new Set()];
    for (const x of slots) {
      const part = getAt(tree, dp).args[x.side];
      if (x.k < 0) factors(part).forEach((_, i) => picked[x.side].add(i));
      else picked[x.side].add(x.k);
    }
  } else if (targets.length === 1 && getAt(tree, focus).op === 'Divide') dp = focus;
  else return null;

  const D = getAt(tree, dp);
  const N = factors(D.args[0]);
  const Dn = factors(D.args[1]);
  const frac = (ns, ds, keep) => {
    const top = ns.length ? rebuild('Multiply', ns) : num(1);
    if (!ds.length) return ns;
    const bottom = rebuild('Multiply', ds);
    return [keep ? withArgs(D, [top, bottom]) : fn('Divide', top, bottom)];
  };
  let parts;
  if (picked) {
    const a = [N.filter((_, i) => picked[0].has(i)), Dn.filter((_, i) => picked[1].has(i))];
    const r = [N.filter((_, i) => !picked[0].has(i)), Dn.filter((_, i) => !picked[1].has(i))];
    if (!r[0].length && !r[1].length) return null;
    parts = [...frac(a[0], a[1], true), ...frac(r[0], r[1], false)];
  } else {
    if (N.length < 2 && Dn.length < 2) return null;
    const k = Math.min(N.length, Dn.length);
    parts = [];
    for (let i = 0; i < k; i++) parts.push(...frac([N[i]], [Dn[i]], i === 0));
    parts.push(...N.slice(k));
    for (const d of Dn.slice(k)) parts.push(fn('Divide', num(1), d));
  }
  const prod = fn('Multiply', ...parts);
  const parent = parentOf(tree, dp);
  const t2 = parent?.op === 'Multiply'
    ? replaceAt(tree, parentPath(dp), withArgs(parent, spliceFlat(parent, lastIndex(dp), [prod])))
    : replaceAt(tree, dp, prod);
  return { tree: t2, label: msg('step.splitProduct'), focus: (parent?.op === 'Multiply' ? parts[0] : prod).id };
}

// Formas da tecla j. Com o foco na soma de frações ou numa parcela dela, a
// intenção é juntar: se não dá (denominadores diferentes), explica em vez
// de separar a fração. Separar vale com o foco dentro dela.
function fractionForms(ctx) {
  const join = joinFractions(ctx);
  if (join?.error) {
    const { tree, focus } = ctx;
    let tp = focus;
    if (parentOf(tree, tp)?.op === 'Negate') tp = parentPath(tp);
    if (focus.join() === join.sp.join() || parentPath(tp).join() === join.sp.join()) return join;
  }
  return [join, splitProduct(ctx), splitFraction(ctx), multiplyFractions(ctx)];
}

// A fração em foco (ou a mais próxima acima dele).
function fractionAround(tree, p) {
  for (let q = p; q; q = q.length ? parentPath(q) : null) if (getAt(tree, q).op === 'Divide') return q;
  return null;
}

// a/b → (a·k)/(b·k): multiplica numerador e denominador pela expressão
// digitada. O inverso é cancelar (x).
function expandFraction(ctx) {
  const { tree, focus } = ctx;
  const k = parseExpr(ctx.input);
  const dp = fractionAround(tree, focus);
  if (!k || !dp) return null;
  const D = getAt(tree, dp);
  const times = (x, f) => (x.op === 'Multiply' ? withArgs(x, [...x.args, f]) : fn('Multiply', x, f));
  const k2 = cloneFrom(k, {});
  const result = withArgs(D, [times(D.args[0], k), times(D.args[1], k2)]);
  return { tree: replaceAt(tree, dp, result), label: msg('step.expandFrac', { q: toAscii(k) }), focus: result.id };
}

function splitFraction(ctx) {
  if (ctx.targets.length > 1) return null;
  return atFocusOrParent(ctx, (p) => {
    const { tree } = ctx;
    const D = getAt(tree, p);
    if (D.op !== 'Divide' || !sumOf(D.args[0])) return null;
    const s = sumOf(D.args[0]);
    const clones = {};
    const newTerms = s.args.map((t, i) => {
      const { neg, body } = signed(t);
      const den = i === 0 ? D.args[1] : cloneFrom(D.args[1], clones);
      const f = i === 0 ? withArgs(D, [body, den]) : fn('Divide', body, den);
      return neg ? withArgs(t, [f]) : f;
    });
    const result = withArgs(s, newTerms);
    return { tree: place(tree, p, result), label: msg('step.split'), focus: result.id, hints: { clones } };
  });
}

// --------------------------------------------------------- regra de sinais

function signs(ctx) {
  return atFocusOrParent(ctx, (p) => {
    const { tree } = ctx;
    const n = getAt(tree, p);
    const isNeg = (x) => unparen(x).op === 'Negate';
    if (n.op === 'Negate' && isNeg(n.args[0])) {
      const inner = unparen(n.args[0]).args[0];
      return { tree: replaceAt(tree, p, inner), label: msg('step.doubleNeg'), focus: inner.id };
    }
    if (n.op !== 'Multiply' && n.op !== 'Divide') return null;
    const count = n.args.filter(isNeg).length;
    if (!count) return null;
    const stripped = withArgs(n, n.args.map((x) => (isNeg(x) ? unparen(x).args[0] : x)));
    const node = count % 2 ? fn('Negate', stripped) : stripped;
    return { tree: place(tree, p, node), label: msg('step.signs'), focus: node.id };
  });
}

// −ab → (−a)b | a(−b) · −(a/b) → (−a)/b | a/(−b): o sinal entra num fator
// (o inverso da regra de sinais); cada fator é uma forma.
function signsInverse(ctx) {
  return atFocusOrParent(ctx, (p) => {
    const { tree } = ctx;
    const n = getAt(tree, p);
    if (n.op !== 'Negate') return null;
    const inner = unparen(n.args[0]);
    if (inner.op !== 'Multiply' && inner.op !== 'Divide') return null;
    const out = inner.args.map((f, i) => {
      if (unparen(f).op === 'Negate') return null;
      const neg = fn('Negate', f);
      const args = inner.args.slice();
      args[i] = inner.op === 'Multiply' ? fn('Delimiter', neg) : neg;
      const node = withArgs(inner, args);
      return { tree: place(tree, p, node), label: msg('step.signsInv'), focus: node.id };
    }).filter(Boolean);
    return out.length ? out : null;
  });
}

// ------------------------------------------------------------- potências

const baseOf = (x) => (x.op === 'Power' ? x.args[0] : x);
const expOf = (x) => (x.op === 'Power' ? x.args[1] : num(1));

// Expoente já calculado quando é numérico (2 + 3 → 5); simbólico fica
// indicado (n + 2). Expoente 1 devolve a própria base.
function powerWith(p, base, e) {
  const r = evaluate(e);
  if (r && r.n === r.d) return base;
  const exp = r ? ratToNode(r) : e;
  return p ? withArgs(p, [base, exp]) : fn('Power', base, exp);
}

function powers(ctx) {
  const { tree, targets, focus } = ctx;

  // x^a · x^b → x^(a + b)
  const sameBaseProduct = (pp, i, j) => {
    const M = getAt(tree, pp);
    const a = M.args[i];
    const b = M.args[j];
    // a·a (sem expoentes) é a definição de potência: feito por asPower.
    if (!same(baseOf(a), baseOf(b)) || (a.op !== 'Power' && b.op !== 'Power')) return null;
    const pw = a.op === 'Power'
      ? powerWith(a, a.args[0], fn('Add', a.args[1], expOf(b)))
      : powerWith(null, a, fn('Add', num(1), expOf(b)));
    const args = M.args.filter((_, k) => k !== j);
    args[args.indexOf(a)] = pw;
    return {
      tree: replaceAt(tree, pp, rebuild('Multiply', args, M)),
      label: msg('step.expAdd'),
      focus: pw.id,
      hints: { merge: { to: baseOf(a).id, from: [baseOf(b).id] } },
    };
  };

  const sib = siblingsOf(targets);
  if (sib?.length === 2 && parentOf(tree, targets[0])?.op === 'Multiply') {
    return sameBaseProduct(parentPath(targets[0]), sib[0], sib[1]);
  }

  return atFocusOrParent(ctx, (p) => {
    const n = getAt(tree, p);
    // foco no produto: primeiro par de fatores com a mesma base
    if (n.op === 'Multiply') {
      for (let i = 0; i < n.args.length; i++) {
        for (let j = i + 1; j < n.args.length; j++) {
          const r = sameBaseProduct(p, i, j);
          if (r) return r;
        }
      }
    }
    // foco num fator: procura outro fator com a mesma base
    if (parentOf(tree, p)?.op === 'Multiply' && p.length === focus.length) {
      const M = parentOf(tree, p);
      const i = lastIndex(p);
      const j = M.args.findIndex((x, k) => k !== i && same(baseOf(x), baseOf(n)));
      if (j >= 0) return sameBaseProduct(parentPath(p), Math.min(i, j), Math.max(i, j));
    }
    // x^a / x^b → x^(a − b)
    if (n.op === 'Divide' && same(baseOf(n.args[0]), baseOf(n.args[1]))) {
      const [a, b] = n.args;
      const e = fn('Add', expOf(a), fn('Negate', expOf(b)));
      const pw = a.op === 'Power' ? powerWith(a, a.args[0], e) : powerWith(null, a, e);
      return {
        tree: replaceAt(tree, p, pw),
        label: msg('step.expSub'),
        focus: pw.id,
        hints: { merge: { to: baseOf(a).id, from: [baseOf(b).id] } },
      };
    }
    // (x^a)^b → x^(a·b)
    if (n.op === 'Power' && unparen(n.args[0]).op === 'Power') {
      const inner = unparen(n.args[0]);
      const pw = powerWith(n, inner.args[0], fn('Multiply', inner.args[1], n.args[1]));
      return { tree: replaceAt(tree, p, pw), label: msg('step.powPow'), focus: pw.id };
    }
    return null;
  });
}

// aⁿbⁿ → (ab)ⁿ: fatores com o mesmo expoente (os selecionados, os que têm o
// expoente do fator em foco ou o do primeiro) viram a potência do produto.
// a^n/b^n → (a/b)^n.
function productOfPowers(ctx) {
  const { tree, targets, focus } = ctx;
  const quotient = atFocusOrParent(ctx, (p) => {
    const D = getAt(tree, p);
    if (D.op !== 'Divide' || D.args.some((x) => x.op !== 'Power') || !same(D.args[0].args[1], D.args[1].args[1])) return null;
    const [a, b] = D.args;
    const pw = withArgs(a, [withArgs(D, [a.args[0], b.args[0]]), a.args[1]]);
    return { tree: replaceAt(tree, p, pw), label: msg('step.prodPower'), focus: pw.id, hints: { merge: { to: a.args[1].id, from: [b.args[1].id] } } };
  });
  if (quotient) return quotient;

  let mp;
  let idx;
  const sib = siblingsOf(targets);
  if (sib && parentOf(tree, targets[0])?.op === 'Multiply') {
    mp = parentPath(targets[0]);
    idx = sib;
  } else {
    const n = getAt(tree, focus);
    mp = n.op === 'Multiply' ? focus : parentPath(focus);
    const M = mp && getAt(tree, mp);
    if (M?.op !== 'Multiply') return null;
    const ref = n.op === 'Power' && mp !== focus ? n : M.args.find((x) => x.op === 'Power');
    if (!ref) return null;
    idx = M.args.map((x, i) => (x.op === 'Power' && same(x.args[1], ref.args[1]) ? i : -1)).filter((i) => i >= 0);
  }
  const M = getAt(tree, mp);
  if (M?.op !== 'Multiply' || idx.length < 2) return null;
  const ps = idx.map((i) => M.args[i]);
  if (ps.some((x) => x.op !== 'Power' || !same(x.args[1], ps[0].args[1]))) return null;
  const pw = withArgs(ps[0], [fn('Multiply', ...ps.map((x) => x.args[0])), ps[0].args[1]]);
  const args = M.args.filter((_, i) => !idx.includes(i) || i === idx[0]);
  args[args.indexOf(ps[0])] = pw;
  return {
    tree: replaceAt(tree, mp, rebuild('Multiply', args, M)),
    label: msg('step.prodPower'),
    focus: pw.id,
    hints: { merge: { to: ps[0].args[1].id, from: ps.slice(1).map((x) => x.args[1].id) } },
  };
}

// (ab)ⁿ → aⁿbⁿ  e  (a/b)ⁿ → aⁿ/bⁿ: o expoente vai para cada fator.
function powerOfProduct(ctx) {
  return atFocusOrParent(ctx, (p) => {
    const { tree } = ctx;
    const P = getAt(tree, p);
    if (P.op !== 'Power') return null;
    const b = unparen(P.args[0]);
    if (b.op !== 'Multiply' && b.op !== 'Divide') return null;
    const clones = {};
    const e = P.args[1];
    const args = b.args.map((f, i) => (i === 0 ? withArgs(P, [f, e]) : fn('Power', f, cloneFrom(e, clones))));
    const node = withArgs(b, args);
    return { tree: replaceAt(tree, p, node), label: msg('step.powProduct'), focus: node.id, hints: { clones } };
  });
}

// x^(a + b) → xᵃ·xᵇ  e  x^(ab) → (xᵃ)ᵇ: os inversos de somar e de
// multiplicar os expoentes.
function splitExponent(ctx) {
  return atFocusOrParent(ctx, (p) => {
    const { tree } = ctx;
    const P = getAt(tree, p);
    if (P.op !== 'Power') return null;
    const e = unparen(P.args[1]);
    if (e.op === 'Add') {
      const clones = {};
      const ps = e.args.map((t, i) => (i === 0 ? withArgs(P, [P.args[0], t]) : fn('Power', cloneFrom(P.args[0], clones), t)));
      const prod = fn('Multiply', ...ps);
      return { tree: replaceAt(tree, p, prod), label: msg('step.expSplit'), focus: prod.id, hints: { clones } };
    }
    if (e.op === 'Multiply') {
      const inner = fn('Power', P.args[0], e.args[0]);
      const pw = withArgs(P, [inner, rebuild('Multiply', e.args.slice(1), e)]);
      return { tree: replaceAt(tree, p, pw), label: msg('step.powPowInv'), focus: pw.id };
    }
    return null;
  });
}

// ------------------------------------------------ escrever como potência

// a·a·b·a → a³·b: fatores iguais (sem expoente) viram uma potência, pela
// definição. O primeiro fator fica no lugar; os outros "voam" até ele.
function asPower(ctx) {
  const { tree, targets, focus } = ctx;
  const group = (pp, idx) => {
    const M = getAt(tree, pp);
    if (M.op !== 'Multiply' || idx.length < 2) return null;
    const first = M.args[idx[0]];
    if (first.op === 'Power' || idx.some((i) => M.args[i].op === 'Power' || !same(M.args[i], first))) return null;
    const pw = fn('Power', first, num(idx.length));
    const args = M.args.filter((_, k) => !idx.includes(k) || k === idx[0]);
    args[args.indexOf(first)] = pw;
    return {
      tree: replaceAt(tree, pp, rebuild('Multiply', args, M)),
      label: msg('step.asPower'),
      focus: pw.id,
      hints: { merge: { to: first.id, from: idx.slice(1).map((i) => M.args[i].id) } },
    };
  };
  // Todas as ocorrências (sem expoente) de um fator no produto.
  const copiesOf = (M, x) => M.args.map((c, k) => (c.op !== 'Power' && same(c, x) ? k : -1)).filter((k) => k >= 0);

  const sib = siblingsOf(targets);
  if (sib) return group(parentPath(targets[0]), sib);
  const n = getAt(tree, focus);
  if (n.op === 'Multiply') {
    for (const c of n.args) {
      const idx = copiesOf(n, c);
      if (idx.length >= 2) return group(focus, idx);
    }
    return null;
  }
  const parent = parentOf(tree, focus);
  if (parent?.op !== 'Multiply') return null;
  return group(parentPath(focus), copiesOf(parent, n));
}

// ------------------------------------------- juntar termos semelhantes

// Coeficiente numérico e "parte literal" de um termo: −3ab → (−3, ab).
function monomial(t) {
  const { neg, body } = signed(t);
  let coef = rat1();
  let rest = body;
  if (body.op === 'Multiply' && evaluate(body.args[0])) {
    coef = evaluate(body.args[0]);
    rest = rebuild('Multiply', body.args.slice(1), body);
  } else if (evaluate(body)) return null; // constante: use "calcular"
  return { coef: neg ? { n: -coef.n, d: coef.d } : coef, rest };
}
const rat1 = () => ({ n: 1n, d: 1n });

// ab + ab → 2ab; 3x − x → 2x. Só junta termos escritos igualmente (ba e ab
// precisam ser reordenados antes: a comutatividade fica visível).
function likeTerms(ctx) {
  const { tree, targets, focus } = ctx;
  let sp, idx;
  const sib = siblingsOf(targets);
  if (sib && getAt(tree, parentPath(targets[0])).op === 'Add') {
    sp = parentPath(targets[0]);
    idx = sib;
  } else {
    let tp = focus;
    if (parentOf(tree, tp)?.op === 'Multiply') tp = parentPath(tp);
    if (parentOf(tree, tp)?.op === 'Negate') tp = parentPath(tp);
    if (parentOf(tree, tp)?.op !== 'Add') return null;
    sp = parentPath(tp);
    const S = getAt(tree, sp);
    const me = monomial(S.args[lastIndex(tp)]);
    if (!me) return null;
    idx = S.args.map((t, k) => (same(monomial(t)?.rest ?? num(0), me.rest) && monomial(t) ? k : -1)).filter((k) => k >= 0);
  }
  const S = getAt(tree, sp);
  if (idx.length < 2) return null;
  const ms = idx.map((i) => monomial(S.args[i]));
  if (ms.some((m) => !m || !same(m.rest, ms[0].rest))) return null;

  let sum = { n: 0n, d: 1n };
  for (const { coef } of ms) sum = { n: sum.n * coef.d + coef.n * sum.d, d: sum.d * coef.d };
  const rest = ms[0].rest;
  let term;
  if (sum.n === 0n) term = num(0);
  else {
    const c = ratToNode({ n: sum.n < 0n ? -sum.n : sum.n, d: sum.d });
    const isOne = c.op === 'Number' && c.value === '1';
    const body = isOne ? rest : fn('Multiply', c, ...(rest.op === 'Multiply' ? rest.args : [rest]));
    term = sum.n < 0n ? fn('Negate', body) : body;
  }
  const args = S.args.filter((_, k) => !idx.includes(k) || k === idx[0]);
  args[args.indexOf(S.args[idx[0]])] = term;
  return {
    tree: replaceAt(tree, sp, rebuild('Add', args, S)),
    label: msg('step.like'),
    focus: term.id,
    hints: { merge: { to: term.id, from: idx.map((i) => S.args[i].id) } },
  };
}

// ------------------------------------------------------------- complexos

const conj = (x) => fn('Conjugate', x);
const isConjOf = (c, z) => c.op === 'Conjugate' && same(c.args[0], z);

// Conjugado "empurrado" um nível para dentro: (a + b)‾ → ā + b̄, (ab)‾ → ā·b̄,
// (a/b)‾ → ā/b̄, (zⁿ)‾ → z̄ⁿ (n real), ī → −i, número → conjugado.
// (z̄̄ ↔ z é a regra "dconj", nos dois sentidos.)
function conjugateProps(ctx) {
  return atFocusOrParent(ctx, (p) => {
    const { tree } = ctx;
    const C = getAt(tree, p);
    if (C.op !== 'Conjugate') return null;
    const x = unparen(C.args[0]);
    let node = null;
    const v = evaluateComplex(x);
    if (x.op === 'Conjugate') return null;
    if (isImaginaryUnit(x)) node = fn('Negate', x);
    else if (v) node = complexToNode({ re: v.re, im: { n: -v.im.n, d: v.im.d } });
    else if (x.op === 'Add') node = withArgs(x, x.args.map((t) => (t.op === 'Negate' ? withArgs(t, [conj(t.args[0])]) : conj(t))));
    else if (x.op === 'Multiply') node = withArgs(x, x.args.map(conj));
    else if (x.op === 'Divide') node = withArgs(x, x.args.map(conj));
    else if (x.op === 'Negate') node = withArgs(x, [conj(x.args[0])]);
    else if (x.op === 'Power' && evaluate(x.args[1])) node = withArgs(x, [conj(x.args[0]), x.args[1]]);
    if (!node) return null;
    return { tree: place(tree, p, node), label: msg('step.conjProps'), focus: node.id };
  });
}

// Há algo de complexo na expressão? (i, conjugado, Re, Im, arg, módulo)
const COMPLEX_OPS = new Set(['Conjugate', 'Real', 'Imaginary', 'Argument', 'Abs']);
function hasComplex(tree) {
  let found = false;
  walk(tree, (x) => { if (isImaginaryUnit(x) || COMPLEX_OPS.has(x.op)) found = true; });
  return found;
}

// z̄̄ → z (foco no conjugado duplo ou dentro dele) e z → z̄̄ (qualquer outra
// subexpressão, quando a expressão já envolve complexos).
function doubleConjugate(ctx) {
  const { tree, focus } = ctx;
  for (let k = 0; k <= 2 && k <= focus.length; k++) {
    const p = focus.slice(0, focus.length - k);
    const n = getAt(tree, p);
    const inner = n.op === 'Conjugate' && unparen(n.args[0]);
    if (inner && inner.op === 'Conjugate') {
      const z = inner.args[0];
      return { tree: place(tree, p, z), label: msg('step.doubleConj'), focus: z.id };
    }
  }
  const n = getAt(tree, focus);
  if (isRelation(n.op) || n.op === 'System' || !hasComplex(tree)) return null;
  const node = conj(conj(n));
  return { tree: replaceAt(tree, focus, node), label: msg('step.doubleConj'), focus: node.id };
}

// z·z̄ ↔ |z|²
function conjProduct(ctx) {
  return atFocusOrParent(ctx, (p) => {
    const { tree } = ctx;
    const n = getAt(tree, p);
    // |z|² → z·z̄
    if (n.op === 'Power' && n.args[0].op === 'Abs' && isNum(n.args[1], 2)) {
      const z = n.args[0].args[0];
      const prod = fn('Multiply', z, conj(cloneFrom(z, {})));
      return { tree: replaceAt(tree, p, prod), label: msg('step.conjProduct'), focus: prod.id };
    }
    // z·z̄ (em qualquer posição do produto) → |z|²
    if (n.op !== 'Multiply') return null;
    for (let i = 0; i < n.args.length; i++) {
      for (let j = 0; j < n.args.length; j++) {
        if (i === j) continue;
        const z = n.args[i];
        if (!isConjOf(n.args[j], z)) continue;
        const pw = fn('Power', fn('Abs', z), num(2));
        const args = n.args.filter((_, k) => k !== j);
        args[args.indexOf(z)] = pw;
        return {
          tree: replaceAt(tree, p, rebuild('Multiply', args, n)),
          label: msg('step.conjProduct'),
          focus: pw.id,
          hints: { merge: { to: z.id, from: [n.args[j].id] } },
        };
      }
    }
    return null;
  });
}

const twoRe = (z) => fn('Multiply', num(2), fn('Real', z));
const twoIIm = (z) => fn('Multiply', num(2), sym(IMAGINARY), fn('Imaginary', z));
const isTwoRe = (n) => n.op === 'Multiply' && n.args.length === 2 && isNum(n.args[0], 2) && n.args[1].op === 'Real';
const isTwoIIm = (n) => n.op === 'Multiply' && n.args.length === 3 && isNum(n.args[0], 2)
  && isImaginaryUnit(n.args[1]) && n.args[2].op === 'Imaginary';

// z + z̄ ↔ 2Re(z) e z − z̄ ↔ 2i·Im(z); Re(z) → (z + z̄)/2, Im(z) → (z − z̄)/(2i).
function conjSum(ctx) {
  return atFocusOrParent(ctx, (p) => {
    const { tree } = ctx;
    const n = getAt(tree, p);
    const parent = parentOf(tree, p);
    if (isTwoRe(n)) {
      const z = n.args[1].args[0];
      const sum = fn('Add', z, conj(cloneFrom(z, {})));
      return { tree: replaceAt(tree, p, sum), label: msg('step.conjSum'), focus: sum.id };
    }
    if (isTwoIIm(n)) {
      const z = n.args[2].args[0];
      const diff = fn('Add', z, fn('Negate', conj(cloneFrom(z, {}))));
      return { tree: replaceAt(tree, p, diff), label: msg('step.conjSum'), focus: diff.id };
    }
    if ((n.op === 'Real' || n.op === 'Imaginary') && !(parent && (isTwoRe(parent) || isTwoIIm(parent)))) {
      const z = n.args[0];
      const top = n.op === 'Real'
        ? fn('Add', z, conj(cloneFrom(z, {})))
        : fn('Add', z, fn('Negate', conj(cloneFrom(z, {}))));
      const den = n.op === 'Real' ? num(2) : fn('Multiply', num(2), sym(IMAGINARY));
      const frac = fn('Divide', top, den);
      return { tree: replaceAt(tree, p, frac), label: msg('step.conjSum'), focus: frac.id };
    }
    if (n.op !== 'Add') return null;
    for (let i = 0; i < n.args.length; i++) {
      for (let j = 0; j < n.args.length; j++) {
        if (i === j) continue;
        const a = signed(n.args[i]);
        const b = signed(n.args[j]);
        if (!isConjOf(b.body, a.body) || a.body.op === 'Conjugate') continue;
        // ±z ± z̄
        let term;
        if (a.neg === b.neg) term = twoRe(a.body);
        else term = twoIIm(a.body);
        if (a.neg) term = fn('Negate', term);
        const first = Math.min(i, j);
        const args = n.args.filter((_, k) => k !== i && k !== j);
        args.splice(first, 0, term);
        return {
          tree: replaceAt(tree, p, rebuild('Add', args, n)),
          label: msg('step.conjSum'),
          focus: term.id,
          hints: { merge: { to: term.id, from: [n.args[i].id, n.args[j].id] } },
        };
      }
    }
    return null;
  });
}

const hasImaginary = (n) => {
  let found = false;
  walk(n, (x) => { if (isImaginaryUnit(x)) found = true; });
  return found;
};

// a/(c + di) → a(c − di) / ((c + di)(c − di))
function timesConjugate(ctx) {
  return atFocusOrParent(ctx, (p) => {
    const { tree } = ctx;
    const D = getAt(tree, p);
    if (D.op !== 'Divide' || !hasImaginary(D.args[1])) return null;
    const den = D.args[1];
    const v = evaluateComplex(den);
    const conjOf = () => (v ? complexToNode({ re: v.re, im: { n: -v.im.n, d: v.im.d } }) : conj(cloneFrom(den, {})));
    const frac = withArgs(D, [fn('Multiply', D.args[0], conjOf()), fn('Multiply', den, conjOf())]);
    return { tree: replaceAt(tree, p, frac), label: msg('step.timesConj'), focus: frac.id };
  });
}

// ------------------------------------- produtos notáveis (sentido inverso)

// Termos envolvidos: os selecionados de uma soma, ou a soma em foco (ou a
// soma da qual o foco é termo).
function sumTerms(ctx) {
  const { tree, targets, focus } = ctx;
  const sib = siblingsOf(targets);
  if (sib && parentOf(tree, targets[0])?.op === 'Add') return { sp: parentPath(targets[0]), idx: sib };
  let sp = focus;
  if (getAt(tree, sp).op !== 'Add') sp = parentPath(focus);
  if (!focus.length || getAt(tree, sp)?.op !== 'Add') return null;
  return { sp, idx: getAt(tree, sp).args.map((_, i) => i) };
}

// a² ± 2ab + b² → (a ± b)²  e  a² − b² → (a + b)(a − b)
function notableProducts(ctx) {
  const { tree } = ctx;
  const where = sumTerms(ctx);
  if (!where) return null;
  const S = getAt(tree, where.sp);
  const ts = where.idx.map((i) => S.args[i]);
  let result = null;

  if (ts.length === 2) {
    const [a, b] = ts.map(signed);
    // um quadrado positivo e um negativo, em qualquer ordem
    const [p, q] = a.neg ? [b, a] : [a, b];
    if (!p.neg && q.neg) {
      const r1 = squareRoot(p.body);
      const r2 = squareRoot(q.body);
      if (r1 && r2) {
        const c = {};
        result = fn('Multiply', fn('Add', r1, r2), fn('Add', cloneFrom(r1, c), fn('Negate', cloneFrom(r2, c))));
      }
    }
  } else if (ts.length === 3) {
    // dois quadrados positivos e o termo do meio igual a ±2·r1·r2
    for (let m = 0; m < 3 && !result; m++) {
      const [i, j] = [0, 1, 2].filter((k) => k !== m);
      const A = signed(ts[i]);
      const B = signed(ts[j]);
      if (A.neg || B.neg) continue;
      const r1 = squareRoot(A.body);
      const r2 = squareRoot(B.body);
      if (!r1 || !r2) continue;
      const twice = normalMonomial(fn('Multiply', num(2), r1, r2));
      const mid = normalMonomial(ts[m]);
      if (sameMonomial(mid, twice)) result = fn('Power', fn('Add', r1, r2), num(2));
      else if (sameMonomial(mid, negateMonomial(twice))) result = fn('Power', fn('Add', r1, fn('Negate', r2)), num(2));
    }
  }
  if (!result) return null;

  const t2 = where.idx.length === S.args.length
    ? place(tree, where.sp, result)
    : replaceAt(tree, where.sp, withArgs(S, (() => {
      const args = S.args.filter((_, k) => !where.idx.includes(k) || k === where.idx[0]);
      args[args.indexOf(S.args[where.idx[0]])] = result;
      return args;
    })()));
  return { tree: t2, label: msg('step.notable'), focus: result.id };
}

// Sugestão para "somar e subtrair": em x² + bx, o (b/2)² que completa o quadrado.
function completeSquareSuggestion(ctx) {
  const where = sumTerms(ctx);
  if (!where) return null;
  const S = getAt(ctx.tree, where.sp);
  const ts = where.idx.map((i) => S.args[i]);
  for (const sq of ts) {
    if (sq.op !== 'Power' || !isNum(sq.args[1], 2)) continue;
    const key = toAscii(sq.args[0]);
    for (const lin of ts) {
      const m = normalMonomial(lin);
      if (!m || lin === sq || m.factors.size !== 1 || m.factors.get(key) !== 1) continue;
      // (b/2)² = b²/4
      const r = { n: m.coef.n * m.coef.n, d: m.coef.d * m.coef.d * 4n };
      return toAscii(ratToNode(reduce(r)));
    }
  }
  return null;
}

const reduce = ({ n, d }) => {
  let a = n < 0n ? -n : n;
  let b = d;
  while (b) [a, b] = [b, a % b];
  return { n: n / a, d: d / a };
};

// --------------------------------------------- expansão de potências

const MAX_TERMS = 60;

// Expoente inteiro pequeno (≥ 2) de um nó Number, ou null.
function smallExponent(e, max) {
  if (e.op !== 'Number' || !/^\d+$/.test(e.value)) return null;
  const n = Number(e.value);
  return n >= 2 && n <= max ? n : null;
}

// Todas as formas de escrever n como soma ordenada de m inteiros ≥ 0, na
// ordem usual (a^n primeiro): [n,0,0], [n-1,1,0], [n-1,0,1], ...
function compositions(n, m) {
  if (m === 1) return [[n]];
  const out = [];
  for (let k = n; k >= 0; k--) {
    for (const rest of compositions(n - k, m - 1)) out.push([k, ...rest]);
  }
  return out;
}

// n! / (k1! k2! ... km!) com BigInt.
function multinomial(n, ks) {
  const fact = (k) => { let r = 1n; for (let i = 2n; i <= BigInt(k); i++) r *= i; return r; };
  return ks.reduce((acc, k) => acc / fact(k), fact(n));
}

// (a + b)^n → Σ C(n; k1..km) a^k1 b^k2 ...  (binômio de Newton / multinomial)
function expandPower(ctx) {
  return atFocusOrParent(ctx, (p) => {
    const { tree } = ctx;
    const P = getAt(tree, p);
    if (P.op !== 'Power') return null;
    const s = sumOf(P.args[0]);
    const n = s && smallExponent(P.args[1], 20);
    if (!n) return null;
    const ks = compositions(n, s.args.length);
    if (ks.length > MAX_TERMS) return null;

    const clones = {};
    const used = new Set();
    // A primeira ocorrência de cada termo fica com o nó original; as demais
    // são cópias que, na animação, saem dele.
    const copyOf = (i) => {
      if (used.has(i)) return cloneFrom(s.args[i], clones);
      used.add(i);
      return s.args[i];
    };
    const terms = ks.map((k) => {
      const coef = multinomial(n, k);
      const fs = coef === 1n ? [] : [num(coef.toString())];
      k.forEach((ki, i) => {
        if (ki === 0) return;
        const base = copyOf(i);
        fs.push(ki === 1 ? base : fn('Power', base, num(ki)));
      });
      return fs.length === 1 ? fs[0] : fn('Multiply', ...fs);
    });
    const result = withArgs(s, terms);
    const label = s.args.length === 2 ? msg('step.binomial') : msg('step.multinomial');
    return { tree: place(tree, p, result), label, focus: result.id, hints: { clones } };
  });
}

// (a + b)^3 → (a + b)(a + b)(a + b)
function powerAsProduct(ctx) {
  return atFocusOrParent(ctx, (p) => {
    const { tree } = ctx;
    const P = getAt(tree, p);
    if (P.op !== 'Power') return null;
    const n = smallExponent(P.args[1], 12);
    if (!n) return null;
    const clones = {};
    const base = unparen(P.args[0]);
    const copies = [base, ...Array.from({ length: n - 1 }, () => cloneFrom(base, clones))];
    const prod = fn('Multiply', ...copies);
    return { tree: replaceAt(tree, p, prod), label: msg('step.asProduct'), focus: prod.id, hints: { clones } };
  });
}

// ------------------------------------------------- operações na equação

const BOTH_SIDES = {
  '+': (side, e) => (side.op === 'Add' ? withArgs(side, [...side.args, e]) : fn('Add', side, e)),
  '-': (side, e) => (side.op === 'Add' ? withArgs(side, [...side.args, fn('Negate', e)]) : fn('Add', side, fn('Negate', e))),
  '*': (side, e) => (side.op === 'Multiply' ? withArgs(side, [...side.args, e]) : fn('Multiply', side, e)),
  '/': (side, e) => fn('Divide', side, e),
  '^': (side, e) => fn('Power', side, e),
};

// Expressão digitada (ASCII ou LaTeX), sem relação (=, <, ≤...).
function parseExpr(text) {
  try {
    const e = parseInput(text ?? '');
    return isRelation(e.op) ? null : e;
  } catch {
    return null;
  }
}

// Entrada no formato "<op> <expressão>", ex.: "+ 3", "* 2", "/ (x+1)", "^2".
export function parseSidesInput(text) {
  const m = /^\s*([-+*/^·×÷−])\s*(.+)$/.exec(text ?? '');
  if (!m) return null;
  const op = { '·': '*', '×': '*', '÷': '/', '−': '-' }[m[1]] ?? m[1];
  const e = parseExpr(m[2]);
  return e && { op, e };
}

// Aplica uma regra "de equação" à relação em foco: a raiz ou, num sistema,
// a equação que contém o foco. O resto do sistema fica igual.
function onRelation(f) {
  return (ctx) => {
    const r = relationAt(ctx.tree, ctx.focus);
    if (!r) return null;
    const inside = (p) => r.rp.every((v, i) => p[i] === v);
    const res = f({
      ...ctx,
      tree: r.rel,
      focus: ctx.focus.slice(r.rp.length),
      targets: ctx.targets.filter(inside).map((p) => p.slice(r.rp.length)),
    });
    if (!res?.tree) return res;
    return { ...res, tree: replaceAt(ctx.tree, r.rp, res.tree) };
  };
}
const hasRelation = (ctx) => !!relationAt(ctx.tree, ctx.focus);

// Numa inequação: somar e subtrair mantêm o sentido; multiplicar e dividir
// exigem um número (negativo inverte); potência não é permitida.
function bothSides(ctx) {
  const { tree } = ctx;
  if (!isRelation(tree.op)) return null;
  const parsed = parseSidesInput(ctx.input);
  if (!parsed) return null;
  const { op, e } = parsed;
  let rel = { op: tree.op };
  if (op === '*' || op === '/') rel = scaledRelation(tree.op, e);
  else if (op === '^' && tree.op !== 'Equal') rel = { error: 'err.powerIneq' };
  if (rel.error) return rel;
  const clones = {};
  const e2 = cloneFrom(e, clones);
  const sides = [BOTH_SIDES[op](tree.args[0], e), BOTH_SIDES[op](tree.args[1], e2)];
  const sym = { '*': '·', '/': '÷', '-': '−' }[op] ?? op;
  return {
    tree: { ...tree, op: rel.op, args: sides },
    label: msg('step.sides', { op: sym, e: toAscii(e) }),
    hints: rel.flipped ? { flip: tree.id } : undefined,
  };
}

// Trocar os lados de uma inequação inverte o símbolo: a < b ⇔ b > a.
function swapSides(ctx) {
  const { tree } = ctx;
  if (!isRelation(tree.op)) return null;
  return {
    tree: { ...tree, op: FLIP[tree.op], args: [tree.args[1], tree.args[0]] },
    label: msg('step.swap'),
    hints: tree.op !== FLIP[tree.op] ? { flip: tree.id } : undefined,
  };
}

// ---------------------------------------------------------------- estimar

// A = B → A ≤ C (o usuário garante B ≤ C), escrito "<= C"; ou C ≤ B
// (garante C ≤ A), escrito "C <=". De uma igualdade sai qualquer sentido;
// de uma desigualdade, só o mesmo sentido (transitividade).
const REL_RE = '(<=|>=|[<>≤≥])';

export function parseEstimateInput(text) {
  const t = text ?? '';
  let m = new RegExp(`^\\s*${REL_RE}\\s*(.+)$`).exec(t);
  if (m) return { side: 1, op: RELATION_INPUT[m[1]], e: parseExpr(m[2]) };
  m = new RegExp(`^(.+?)\\s*${REL_RE}\\s*$`).exec(t);
  if (m) return { side: 0, op: RELATION_INPUT[m[2]], e: parseExpr(m[1]) };
  return null;
}

function estimate(ctx) {
  const { tree } = ctx;
  if (!isRelation(tree.op) || tree.op === 'NotEqual') return null;
  const parsed = parseEstimateInput(ctx.input);
  if (!parsed?.e) return null;
  const { side, op, e } = parsed;
  if (tree.op !== 'Equal' && direction(tree.op) !== direction(op)) return { error: 'err.direction' };
  const args = tree.args.slice();
  args[side] = e;
  return {
    tree: { ...tree, op, args },
    label: msg('step.estimate', { rel: RELATIONS[op], e: toAscii(e) }),
    focus: e.id,
  };
}

// ---------------------------------------------------------------- sistemas

// As duas equações selecionadas (Espaço) de um sistema, na ordem do texto.
function twoEquations(ctx) {
  const { tree, targets } = ctx;
  if (tree.op !== 'System' || targets.length !== 2 || targets.some((p) => p.length !== 1)) return null;
  const [i, j] = targets.map((p) => p[0]).sort((a, b) => a - b);
  const A = tree.args[i];
  const B = tree.args[j];
  if (A.op !== 'Equal' || B.op !== 'Equal') return null;
  return { i, j, A, B };
}

// E₂ ← E₂ ± E₁: a segunda equação selecionada vira a soma (ou a diferença)
// das duas. Os lados da primeira entram como cópias.
function combineEquations(sign) {
  return (ctx) => {
    const eq = twoEquations(ctx);
    if (!eq) return null;
    const { j, A, B } = eq;
    const clones = {};
    const side = (k) => {
      const mine = B.args[k];
      const other = cloneFrom(A.args[k], clones);
      const extra = sign > 0 ? terms(other) : [fn('Negate', other)];
      return fn('Add', ...terms(mine), ...extra);
    };
    const eqNew = withArgs(B, [side(0), side(1)]);
    const args = ctx.tree.args.slice();
    args[j] = eqNew;
    return {
      tree: withArgs(ctx.tree, args),
      label: msg(sign > 0 ? 'step.addEq' : 'step.subEq'),
      focus: eqNew.id,
      hints: { clones },
    };
  };
}

// Com o foco numa equação "v = expressão" (ou "expressão = v") de um
// sistema, troca v pela expressão nas outras equações.
function substituteInSystem(ctx) {
  const { tree, focus } = ctx;
  if (tree.op !== 'System' || !focus.length) return null;
  const k = focus[0];
  const E = tree.args[k];
  if (E.op !== 'Equal') return null;
  const [l, r] = E.args;
  const pick = l.op === 'Symbol' && !isImaginaryUnit(l) ? [l, r] : r.op === 'Symbol' && !isImaginaryUnit(r) ? [r, l] : null;
  if (!pick) return null;
  const [v, expr] = pick;
  const clones = {};
  let count = 0;
  const replace = (n) => {
    if (n.op === 'Symbol' && n.name === v.name) {
      count++;
      return expr.op === 'Add' || expr.op === 'Negate' ? fn('Delimiter', cloneFrom(expr, clones)) : cloneFrom(expr, clones);
    }
    return n.args ? withArgs(n, n.args.map(replace)) : n;
  };
  const args = tree.args.map((eq, idx) => (idx === k ? eq : replace(eq)));
  if (!count) return { error: 'err.varAbsent', params: { v: v.name } };
  return {
    tree: withArgs(tree, args),
    label: msg('step.substSystem', { v: v.name }),
    hints: { clones },
  };
}

// ------------------------------------------------------------ substituir

// Troca a seleção (ou o foco) pelo que o usuário digitar. A equivalência é
// responsabilidade de quem usa: é o passo "pela definição", "pelo dado".
function substitute(ctx) {
  const { tree, targets } = ctx;
  const e = parseExpr(ctx.input);
  if (!e) return null;
  const clones = {};
  let t2 = tree;
  let focus = null;
  for (const [i, p] of targets.entries()) {
    const node = i === 0 ? e : cloneFrom(e, clones);
    focus ??= node.id;
    t2 = replaceAt(t2, p, node);
  }
  return { tree: t2, label: msg('step.subst', { e: toAscii(e) }), focus };
}

// ------------------------------------------------------ somar e subtrair

// Acrescenta + q − q à subexpressão selecionada (ou em foco). O valor não
// muda; é o primeiro passo de completar quadrados. Se a seleção é uma soma,
// o par entra no fim dela; se é um ou mais termos de uma soma, logo depois
// do último; senão a subexpressão vira a soma (s + q − q).
function addSubtract(ctx) {
  const { tree, targets } = ctx;
  const q = parseExpr(ctx.input);
  if (!q) return null;
  const pair = [q, fn('Negate', cloneFrom(q, {}))];
  const label = msg('step.addsub', { q: toAscii(q) });

  if (targets.length > 1) {
    const idx = siblingsOf(targets);
    const sp = parentPath(targets[0]);
    const S = idx && getAt(tree, sp);
    if (S?.op !== 'Add') return null;
    const args = S.args.slice();
    args.splice(idx[idx.length - 1] + 1, 0, ...pair);
    return { tree: replaceAt(tree, sp, withArgs(S, args)), label, focus: q.id };
  }

  const p = targets[0];
  const n = getAt(tree, p);
  if (isRelation(n.op) || n.op === 'System') return null;
  const parent = parentOf(tree, p);
  let t2;
  if (n.op === 'Add') {
    t2 = replaceAt(tree, p, withArgs(n, [...n.args, ...pair]));
  } else if (parent?.op === 'Add') {
    const args = parent.args.slice();
    args.splice(lastIndex(p) + 1, 0, ...pair);
    t2 = replaceAt(tree, parentPath(p), withArgs(parent, args));
  } else {
    t2 = replaceAt(tree, p, fn('Add', n, ...pair));
  }
  return { tree: t2, label, focus: q.id };
}

// ------------------------------------------------------------------ nomes

const NAME_RE = /^[A-Za-z](_[A-Za-z0-9]+)?$/;
const isNamed = (n) => n.op === 'Symbol' && n.named;

function nameIt(ctx) {
  const { tree, targets } = ctx;
  if (targets.length !== 1) return null;
  const name = (ctx.input ?? '').trim();
  if (!NAME_RE.test(name) || ctx.definitions?.[name]) return null;
  const n = getAt(tree, targets[0]);
  if (isRelation(n.op) || n.op === 'System' || isNamed(n)) return null;
  const chip = { ...sym(name), named: true };
  return {
    tree: replaceAt(tree, targets[0], chip),
    label: msg('step.name', { name }),
    focus: chip.id,
    action: { type: 'define', name, def: n, chipId: chip.id },
  };
}

function expandName(ctx) {
  const { tree, focus } = ctx;
  const n = getAt(tree, focus);
  const def = isNamed(n) && ctx.definitions?.[n.name];
  if (!def) return null;
  const node = cloneFrom(def, {});
  return { tree: replaceAt(tree, focus, node), label: msg('step.expand', { name: n.name }), focus: node.id };
}

function openName(ctx) {
  const n = getAt(ctx.tree, ctx.focus);
  if (!isNamed(n) || !ctx.definitions?.[n.name]) return null;
  return { label: msg('step.open', { name: n.name }), action: { type: 'open', name: n.name } };
}

// Ordem do menu: por assunto (o cabeçalho de cada grupo vem de i18n
// "group.<nome>"). Cada operação tem uma tecla (minúscula, dígito ou
// símbolo) que vale tanto direto na fórmula quanto com o menu aberto; as
// maiúsculas ficam para os comandos da interface (app.js).
export const GROUPS = ['arith', 'structure', 'fractions', 'powers', 'functions', 'sums', 'calculus', 'complex', 'relation', 'system', 'names'];

export const RULES = [
  // aritmética
  { id: 'calc', key: 'c', group: 'arith', ...either(calculate, primeFactors) },
  { id: 'like', key: 'l', group: 'arith', run: likeTerms },
  { id: 'cancel', key: 'x', group: 'arith', run: cancel },
  { id: 'neutral', key: '0', group: 'arith', run: neutral },
  { id: 'signs', key: 'r', group: 'arith', ...either(signs, signsInverse) },
  // "-" é compartilhada com "subtrair equações": nunca valem juntas.
  { id: 'flipsigns', key: '-', group: 'arith', run: flipSigns },
  // estrutura
  { id: 'dist', key: 'd', group: 'structure', run: distribute },
  { id: 'factor', key: 'e', group: 'structure', run: factorOut },
  { id: 'wrap', key: '(', group: 'structure', run: wrapParens },
  { id: 'parens', key: 'p', group: 'structure', run: removeParens },
  { id: 'group', key: 'g', group: 'structure', run: group },
  {
    id: 'addsub', key: 'q', group: 'structure', run: addSubtract,
    input: true,
    suggest: completeSquareSuggestion,
    available: (ctx) => ctx.targets.every((p) => !isRelation(getAt(ctx.tree, p).op) && getAt(ctx.tree, p).op !== 'System'),
  },
  {
    id: 'subst', key: 's', group: 'structure', run: substitute,
    input: true,
    available: (ctx) => ctx.targets.length > 0,
  },
  // frações
  { id: 'join', key: 'j', group: 'fractions', ...either(fractionForms) },
  {
    id: 'expandfrac', key: '*', group: 'fractions', run: expandFraction,
    input: true,
    suggest: (ctx) => {
      const dp = fractionAround(ctx.tree, ctx.focus);
      const r = dp && rationalizeSuggestion(getAt(ctx.tree, dp));
      return r ? toAscii(r) : '';
    },
    available: (ctx) => !!fractionAround(ctx.tree, ctx.focus),
  },
  // potências
  { id: 'powers', key: '^', group: 'powers', ...either(asPower, powers, productOfPowers, powerOfProduct, splitExponent, ...RADICAL_RULES, powerAsProduct) },
  { id: 'binomial', key: 'b', group: 'powers', ...either(expandPower, notableProducts, binomialTheorem, binomialTheoremInverse) },
  // complexos
  { id: 'conj', key: 'z', group: 'complex', run: conjugateProps },
  { id: 'dconj', key: '~', group: 'complex', run: doubleConjugate },
  { id: 'conjprod', key: 'h', group: 'complex', run: conjProduct },
  { id: 'conjsum', key: 'v', group: 'complex', run: conjSum },
  { id: 'timesconj', key: 'y', group: 'complex', run: timesConjugate },
  // funções: logaritmos/exponenciais e trigonometria dividem a tecla f
  { id: 'logs', key: 'f', group: 'functions', ...either(...LOG_RULES) },
  { id: 'trig', key: 'f', group: 'functions', ...either(...TRIG_RULES) },

  { id: 'factorial', key: '!', group: 'sums', ...either(...COMBINATORICS_RULES) },
  { id: 'sums', key: 'm', group: 'sums', ...either(sumForms) },
  { id: 'derivs', key: "'", group: 'calculus', ...either(...DERIVATIVE_RULES) },
  { id: 'limits', key: 'a', group: 'calculus', ...either(...LIMIT_RULES) },
  // u: as formas da integral; sem nenhuma, pede a substituição (por partes
  // e as formas da integral definida ficam depois, no menu ou repetindo u).
  { id: 'integrals', key: 'u', group: 'calculus', ...either(...INTEGRAL_RULES) },
  { id: 'intsubst', key: 'u', group: 'calculus', run: substitution, input: true, available: (ctx) => !!integralAt(ctx) },
  { id: 'intparts', key: 'u', group: 'calculus', run: byParts, input: true, available: (ctx) => !!integralAt(ctx) },
  { id: 'intdef', key: 'u', group: 'calculus', ...either(definiteForms) },
  // equação e inequação
  {
    id: 'sides', key: '=', group: 'relation', run: onRelation(bothSides),
    input: true,
    available: hasRelation,
  },
  { id: 'swap', key: 't', group: 'relation', run: onRelation(swapSides) },
  {
    id: 'estimate', key: 'i', group: 'relation', run: onRelation(estimate),
    input: true,
    available: (ctx) => hasRelation(ctx) && relationAt(ctx.tree, ctx.focus).rel.op !== 'NotEqual',
  },
  // sistemas
  { id: 'addeq', key: '+', group: 'system', run: combineEquations(+1) },
  { id: 'subeq', key: '-', group: 'system', run: combineEquations(-1) },
  { id: 'substsys', key: '>', group: 'system', run: substituteInSystem },
  // nomes
  // n: num nome, expande; fora dele, dá nome (nome ↔ expressão)
  { id: 'expand', key: 'n', group: 'names', run: expandName },
  {
    id: 'name', key: 'n', group: 'names', run: nameIt,
    input: true,
    available: (ctx) => ctx.targets.length === 1 && !isRelation(getAt(ctx.tree, ctx.targets[0]).op)
      && getAt(ctx.tree, ctx.targets[0]).op !== 'System',
  },
  { id: 'open', key: 'w', group: 'names', run: openName },
];

// Regras aplicáveis ao contexto, já com o resultado (prévia).
// Regras simples também anotam as igualdades usadas (as de either() já anotam).
for (const r of RULES) if (!r.all) r.run = withNotes(r.run);

export function applicable(ctx) {
  const out = [];
  for (const rule of RULES) {
    if (rule.input) {
      if (rule.available(ctx)) out.push({ rule, result: null });
      continue;
    }
    let results = [];
    try {
      results = rule.all ? rule.all(ctx) : [rule.run(ctx)];
    } catch (err) {
      console.error(`[Manip] regra ${rule.id}`, err);
    }
    // Erros explicam por que a regra não vale aqui; não entram no menu.
    // Uma equivalência que se aplica nos dois sentidos aparece duas vezes.
    for (const result of results) if (result && !result.error) out.push({ rule, result, alt: results.length > 1 });
  }
  return out;
}
