// Reticências (…) nas regras. O … é um átomo opaco dentro de uma soma ou
// produto (a + … + c, a·…·c) e absorve as operações termo a termo:
//
// - Sentido direto (a(b + … + c) = ab + … + ac): a regra roda normalmente e
//   o que ela aplicou ao … (a·…, ln(…), …ⁿ, d/dx …) volta a ser só ….
// - Sentido inverso (ab + … + ac = a(b + … + c)): a regra precisa ver no …
//   um termo com a mesma forma dos outros. O … vira a cópia de um termo
//   vizinho, a regra roda e a cópia volta a ser …. Para não aceitar uma
//   forma que só vale para aquele vizinho, a conta é feita com dois
//   vizinhos diferentes e fica só o que sai igual nas duas.

import { walk, withArgs, cloneFresh, isDots } from '../ast.js';
import { toAscii } from '../serialize.js';
import { isRelation } from '../relations.js';

const CONTAINERS = new Set(['Add', 'Multiply']);
// Nós que não "operam" sobre o …: só o carregam.
const CARRIERS = new Set(['Add', 'Multiply', 'Negate', 'Delimiter', 'System']);
const carrier = (op) => CARRIERS.has(op) || isRelation(op);

export function treeHasDots(tree) {
  let found = false;
  walk(tree, (n) => { if (isDots(n)) found = true; });
  return found;
}

// O … ou −… direto como filho.
const dotsIn = (c) => (isDots(c) ? c : c.op === 'Negate' && isDots(c.args[0]) ? c.args[0] : null);

// Onde cada … mora (soma ou produto) e quais pares pai → … já existiam.
function survey(tree) {
  const home = new Map();
  const pairs = new Set();
  const go = (n, ctxOp) => {
    if (!n.args) return;
    const mine = CONTAINERS.has(n.op) ? n.op : n.op === 'Negate' || n.op === 'Delimiter' ? ctxOp : null;
    for (const c of n.args) {
      if (isDots(c)) {
        pairs.add(n.id + '>' + c.id);
        if (mine) home.set(c.id, mine);
      }
      go(c, mine);
    }
  };
  go(tree, null);
  return { home, pairs };
}

// Desfaz o que a regra aplicou ao …: um nó novo que opera diretamente
// sobre ele (a·… numa soma, ln(…), …/d, …ⁿ) vira o próprio …; dois …
// seguidos (com o mesmo sinal) viram um.
export function absorb(oldTree, result) {
  const { home, pairs } = survey(oldTree);
  const homes = new Set(home.values());
  const fallback = homes.size === 1 ? [...homes][0] : null;
  const homeOf = (d) => home.get(d.id) ?? fallback;
  const renamed = new Map();

  const go = (n, ctxOp) => {
    if (!n.args) return n;
    const mine = CONTAINERS.has(n.op) ? n.op : n.op === 'Negate' || n.op === 'Delimiter' ? ctxOp : null;
    const args = n.args.map((c) => go(c, mine));
    let out = args.some((a, i) => a !== n.args[i]) ? withArgs(n, args) : n;
    if (CONTAINERS.has(out.op)) out = mergeRuns(out);
    // um filho … (ou −…) que o nó não tinha antes
    const hit = out.args.find((c) => dotsIn(c) && !pairs.has(out.id + '>' + dotsIn(c).id));
    if (!hit) return out;
    const d = dotsIn(hit);
    const unary = !carrier(out.op);
    const crossed = CONTAINERS.has(out.op) && homeOf(d) && out.op !== homeOf(d) && ctxOp === homeOf(d);
    const wrapped = out.op === 'Delimiter';
    if (!unary && !crossed && !wrapped) return out;
    // a·(−…) numa soma: o sinal fica
    const node = crossed && hit.op === 'Negate' && out.op === 'Multiply' && homeOf(d) === 'Add' ? hit : d;
    renamed.set(out.id, node.id);
    return node;
  };
  const tree = go(result.tree, null);
  if (tree === result.tree) return result;
  const focus = renamed.get(result.focus) ?? result.focus;
  return { ...result, tree, focus };
}

function mergeRuns(n) {
  const args = [];
  for (const c of n.args) {
    const prev = args[args.length - 1];
    if (prev && dotsIn(c) && dotsIn(prev) && (c.op === 'Negate') === (prev.op === 'Negate')) continue;
    args.push(c);
  }
  return args.length === n.args.length ? n : withArgs(n, args);
}

// Vizinhos explícitos de cada …: o mais próximo de cada lado, ou os dois
// mais próximos do único lado que existe (série: 1 + r + r² + …).
function neighbours(C, i) {
  const explicit = (j) => j >= 0 && j < C.args.length && !dotsIn(C.args[j]);
  const before = [], after = [];
  for (let j = i - 1; j >= 0; j--) if (explicit(j)) before.push(j);
  for (let j = i + 1; j < C.args.length; j++) if (explicit(j)) after.push(j);
  if (before.length && after.length) return [after[0], before[0]];
  return (after.length ? after : before).slice(0, 2);
}

// A árvore com cada … trocado pela cópia do vizinho `choice` (0 ou 1).
function withCopies(tree, choice, marked, roots) {
  let ok = true;
  const go = (n) => {
    if (!n.args) return n;
    let args = n.args.map(go);
    if (CONTAINERS.has(n.op)) {
      args = args.map((c, i) => {
        const d = dotsIn(c);
        if (!d) return c;
        const ns = neighbours(n, i);
        const j = ns[Math.min(choice, ns.length - 1)];
        if (j === undefined) { ok = false; return c; }
        // −… na soma recebe o termo sem sinal
        let src = n.args[j];
        if (c.op === 'Negate' && src.op === 'Negate') src = src.args[0];
        const copy = cloneFresh(src);
        walk(copy, (x) => marked.add(x.id));
        roots.set(copy.id, d.id);
        return c.op === 'Negate' ? withArgs(c, [copy]) : copy;
      });
    }
    return args.some((a, i) => a !== n.args[i]) ? withArgs(n, args) : n;
  };
  const out = go(tree);
  return ok ? out : null;
}

// Cópias inteiras (nada novo dentro) voltam a ser …; sobra de cópia
// misturada com coisa nova invalida a forma.
function restore(tree, marked, roots, count) {
  let bad = false;
  let found = 0;
  const full = (n) => marked.has(n.id) && (n.args ?? []).every(full);
  const go = (n, parent) => {
    if (full(n)) {
      found++;
      const okHome = parent && (CONTAINERS.has(parent.op) || parent.op === 'Negate');
      if (!okHome) bad = true;
      return { id: roots.get(n.id) ?? n.id + 'd', op: 'Symbol', name: 'ContinuationPlaceholder' };
    }
    if (marked.has(n.id)) bad = true;
    if (!n.args) return n;
    const args = n.args.map((c) => go(c, n));
    return args.some((a, i) => a !== n.args[i]) ? withArgs(n, args) : n;
  };
  const out = go(tree, null);
  return bad || found !== count ? null : out;
}

function countDots(tree) {
  let k = 0;
  walk(tree, (n) => { if (isDots(n)) k++; });
  return k;
}

// Formas da regra com o … no papel de um termo genérico.
export function viaCopies(ctx, forms) {
  const count = countDots(ctx.tree);
  const runs = [0, 1].map((choice) => {
    const marked = new Set(), roots = new Map();
    const tree = withCopies(ctx.tree, choice, marked, roots);
    if (!tree) return [];
    let rs = [];
    try { rs = forms({ ...ctx, tree }); } catch { rs = []; }
    return rs.filter((r) => r?.tree).map((r) => {
      const t = restore(r.tree, marked, roots, count);
      return t && { ...r, tree: t, focus: roots.get(r.focus) ?? r.focus };
    }).filter(Boolean);
  });
  const original = toAscii(ctx.tree);
  const second = new Set(runs[1].map((r) => toAscii(r.tree)));
  return runs[0].filter((r) => {
    const key = toAscii(r.tree);
    return key !== original && second.has(key) && keepsEnds(ctx.tree, r.tree);
  });
}

// Lados em que cada … tem um termo explícito ao lado: { id: [esq, dir] }.
function flanks(tree) {
  const out = new Map();
  walk(tree, (n) => {
    if (!CONTAINERS.has(n.op)) return;
    n.args.forEach((c, i) => {
      const d = dotsIn(c);
      if (!d) return;
      const side = (j) => j >= 0 && j < n.args.length && !dotsIn(n.args[j]);
      out.set(d.id, [side(i - 1), side(i + 1)]);
    });
  });
  return out;
}

// Um … que tinha termo explícito de um lado precisa continuar tendo: tirar
// o c de a + … + c (ou juntá-lo com o a) mudaria o que o … quer dizer.
export function keepsEnds(oldTree, newTree) {
  const before = flanks(oldTree);
  const after = flanks(newTree);
  const present = new Set();
  walk(newTree, (n) => { if (isDots(n)) present.add(n.id); });
  for (const [id, [l, r]] of before) {
    if (!present.has(id)) continue; // o … saiu (virou Σ, por exemplo)
    const now = after.get(id) ?? [false, false];
    if ((l && !now[0]) || (r && !now[1])) return false;
  }
  return true;
}

// Liga o tratamento do … numa regra. `inverse`: também tenta com cópias.
export function wrapDots(rule, inverse) {
  const fix = (ctx, r) => {
    if (!r?.tree || !treeHasDots(ctx.tree)) return r;
    const out = absorb(ctx.tree, r);
    return keepsEnds(ctx.tree, out.tree) ? out : { error: 'err.dotsEnds' };
  };
  if (rule.all) {
    const all = rule.all;
    rule.all = (ctx) => {
      const fixed = all(ctx).map((r) => fix(ctx, r));
      const good = fixed.filter((r) => r?.tree);
      const out = good.length ? good : fixed.slice(0, 1);
      if (!inverse || !treeHasDots(ctx.tree)) return out;
      const keys = new Set(out.filter((r) => r.tree).map((r) => toAscii(r.tree)));
      const extra = viaCopies(ctx, all).filter((r) => !keys.has(toAscii(r.tree)));
      if (!extra.length) return out;
      return [...out.filter((r) => r.tree), ...extra];
    };
    rule.run = (ctx) => rule.all(ctx)[0] ?? null;
  } else {
    const run = rule.run;
    rule.run = (ctx) => {
      const r = fix(ctx, run(ctx));
      if (r?.tree || !inverse || !treeHasDots(ctx.tree)) return r;
      return viaCopies(ctx, (c) => [run(c)])[0] ?? r;
    };
  }
}
