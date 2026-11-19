// Identidades com nome: Q := (a + b)^2 = a^2 + 2ab + b^2 (ou a tecla n com o
// foco numa equação inteira). A tecla k aplica as identidades na expressão
// em foco, nos dois sentidos, e o passo diz qual foi usada.
//
// - Identidade (os dois lados têm o mesmo valor em todo ponto testado): as
//   letras são variáveis do molde; a casa com qualquer subexpressão
//   (a = x, b = 3 em (x + 3)²). Soma e produto casam em qualquer ordem, e uma
//   soma maior pode conter o molde em parte dos termos.
// - Equação que não é identidade (x + y = 3): as letras ficam fixas; aplicá-la
//   é trocar um lado pelo outro onde ele aparece.

import { getAt, replaceAt, walk, newId, sameTag, IMAGINARY, INFINITY, DOTS } from '../ast.js';
import { msg } from '../i18n.js';
import { isRelation } from '../relations.js';
import { flatten, literal, matches, show } from './normal.js';
import { sameValue } from './rewrite.js';
import { cloneFrom, parentPath, siblingsOf, rebuild, place } from './util.js';

const CONSTANTS = new Set([IMAGINARY, INFINITY, DOTS, 'e', 'pi']);

const isolated = (side, other) => {
  side = unparen(side);
  if (side.op !== 'Symbol' || side.named || CONSTANTS.has(side.name)) return false;
  let found = false;
  walk(other, (n) => { if (n.op === 'Symbol' && n.name === side.name) found = true; });
  return !found;
};

// Letras do molde: as da identidade, menos constantes e nomes definidos.
function patternVars(eq, defs = {}) {
  // u = g(v), com u fora de g: nunca é identidade, mesmo quando a conta
  // numérica não decide (√, f(x), ∫, x!); as letras ficam fixas, senão o u
  // casaria com qualquer letra.
  if (eq.args.some((side, i) => isolated(side, eq.args[1 - i]))) return new Set();
  if (sameValue(eq.args[0], eq.args[1])?.error) return new Set();
  const vars = new Set();
  walk(eq, (n) => {
    if (n.op === 'Symbol' && !n.named && !CONSTANTS.has(n.name) && !defs[n.name]) vars.add(n.name);
  });
  return vars;
}

const unparen = (n) => { while (n.op === 'Delimiter') n = n.args[0]; return n; };

// Todas as formas de casar o molde p com o nó n (gerador de ligações).
function* match(p, n, vars, b) {
  p = unparen(p);
  n = unparen(n);
  if (p.op === 'Symbol' && vars.has(p.name)) {
    if (p.name in b) { if (literal(b[p.name], n)) yield b; }
    else yield { ...b, [p.name]: n };
    return;
  }
  if (p.op !== n.op) return;
  if (p.op === 'Number') { if (Number(p.value) === Number(n.value)) yield b; return; }
  if (p.op === 'Symbol') { if (p.name === n.name) yield b; return; }
  if (!sameTag(p, n) || p.args.length !== n.args.length) return;
  if (p.op === 'Add' || p.op === 'Multiply') yield* anyOrder(p.args, n.args, vars, b);
  else yield* inOrder(p.args, n.args, 0, vars, b);
}

function* inOrder(ps, ns, i, vars, b) {
  if (i === ps.length) { yield b; return; }
  for (const b2 of match(ps[i], ns[i], vars, b)) yield* inOrder(ps, ns, i + 1, vars, b2);
}

// Soma e produto: cada termo do molde com um termo diferente do nó. Termos
// sem letras do molde primeiro, para cortar caminhos cedo.
function* anyOrder(ps, ns, vars, b, used = new Set()) {
  if (!ps.length) { yield b; return; }
  const [p, ...rest] = ps;
  for (let j = 0; j < ns.length; j++) {
    if (used.has(j)) continue;
    for (const b2 of match(p, ns[j], vars, b)) yield* anyOrder(rest, ns, vars, b2, new Set([...used, j]));
  }
}

// Subconjuntos de k índices de 0..n-1, em ordem.
function* subsets(n, k, start = 0, acc = []) {
  if (acc.length === k) { yield acc; return; }
  for (let i = start; i <= n - (k - acc.length); i++) yield* subsets(n, k, i + 1, [...acc, i]);
}

// O outro lado, com as letras trocadas pelo que casaram (cópias: a animação
// faz cada uma sair do original).
function instantiate(side, b, clones) {
  const go = (n) => {
    if (n.op === 'Symbol' && n.name in b) return cloneFrom(b[n.name], clones);
    return n.args ? { ...n, id: newId(), args: n.args.map(go) } : { ...n, id: newId() };
  };
  return go(side);
}

const bindingText = (b) => Object.entries(b).map(([k, v]) => `${k} = ${show(v)}`).join(', ');

// Variável que prende a letra: dentro dela, a letra é outra (∑, ∫, d/dx, lim).
const BINDERS = new Set(['Sum', 'Product', 'Integrate', 'D', 'Limit', 'EvalAt']);

// Equação "u = g(v)" (a letra sozinha num lado, sem ser identidade): troca
// todo u da expressão em foco (ou da equação inteira) por g(v), como numa
// substituição. Fora das variáveis presas por ∑, ∫, d/dx e lim.
function substituteAll(ctx, name, v, to, eq) {
  const { tree, targets } = ctx;
  if (targets.length !== 1) return null;
  const p = targets[0];
  const expr = getAt(tree, p);
  if (expr.op === 'Symbol' || literal(expr, eq)) return null;
  const paths = [];
  const find = (n, path) => {
    if (n.op === 'Symbol' && n.name === v && !n.named) { paths.push(path); return; }
    if (BINDERS.has(n.op) && n.args[0]?.op === 'Symbol' && n.args[0].name === v) return;
    n.args?.forEach((a, i) => find(a, [...path, i]));
  };
  find(expr, p);
  if (!paths.length) return null;
  // Do último para o primeiro: achatar uma soma não muda os caminhos anteriores.
  let t2 = tree;
  for (const q of paths.reverse()) t2 = place(t2, q, instantiate(to, {}, {}));
  return { tree: t2, label: msg('step.identityAll', { name, v }), focus: getAt(t2, p).id };
}

// Uma aplicação: molde `from`, resultado `to`, no lugar dado por targets.
function applyOne(ctx, name, from, to, vars, dir, eq) {
  const { tree, targets } = ctx;
  if (!vars.size && from.op === 'Symbol' && !from.named && !CONSTANTS.has(from.name)) {
    const r = substituteAll(ctx, name, from.name, to, eq);
    if (r) return r;
  }
  let expr, put;
  if (targets.length === 1) {
    const p = targets[0];
    expr = getAt(tree, p);
    put = (node) => place(tree, p, node);
  } else {
    const idx = siblingsOf(targets);
    const sp = idx && parentPath(targets[0]);
    const S = idx && getAt(tree, sp);
    if (!S || (S.op !== 'Add' && S.op !== 'Multiply')) return null;
    expr = rebuild(S.op, idx.map((i) => S.args[i]));
    put = (node) => {
      const args = S.args.filter((_, i) => !idx.includes(i) || i === idx[0]).map((a) => (a === S.args[idx[0]] ? node : a));
      return replaceAt(tree, sp, rebuild(S.op, args, S));
    };
  }
  if (isRelation(expr.op) || expr.op === 'System') return null;
  const label = (b) => {
    const step = msg(dir > 0 ? 'step.identity' : 'step.identityBack', { name });
    return Object.keys(b).length ? msg('step.identityWith', { step, with: bindingText(b) }) : step;
  };
  const done = (b, build) => {
    const clones = {};
    const node = instantiate(to, b, clones);
    return { tree: build(node), label: label(b), focus: node.id, hints: { clones } };
  };

  // Sem letras do molde (equação): o lado aparece aqui, a menos da forma normal?
  if (!vars.size) {
    if (!matches(expr, from)) return null;
    return done({}, put);
  }
  const P = flatten(from);
  const E = flatten(expr);
  for (const b of match(P, E, vars, {})) return done(b, put);
  // Parte dos termos de uma soma (ou fatores de um produto) casa com o molde.
  if (targets.length === 1 && P.op === E.op && (P.op === 'Add' || P.op === 'Multiply') && E.args.length > P.args.length) {
    const p = targets[0];
    for (const idx of subsets(E.args.length, P.args.length)) {
      for (const b of match(P, rebuild(E.op, idx.map((i) => E.args[i])), vars, {})) {
        return done(b, (node) => {
          const args = E.args.filter((_, i) => !idx.includes(i) || i === idx[0]).map((a) => (a === E.args[idx[0]] ? node : a));
          return place(tree, p, rebuild(E.op, args.flatMap((a) => (a.op === E.op ? a.args : [a]))));
        });
      }
    }
  }
  return null;
}

// Todas as aplicações das identidades no foco (ou na seleção): cada
// identidade nos dois sentidos, na ordem em que foram definidas.
export function applyIdentities(ctx) {
  const ids = ctx.identities ?? {};
  const out = [];
  for (const [name, eq] of Object.entries(ids)) {
    if (eq?.op !== 'Equal') continue;
    const vars = patternVars(eq, ctx.definitions);
    const [L, R] = eq.args;
    for (const [from, to, dir] of [[L, R, 1], [R, L, -1]]) {
      const r = applyOne(ctx, name, from, to, vars, dir, eq);
      if (r && !literal(r.tree, ctx.tree)) out.push(r);
    }
  }
  return out;
}
