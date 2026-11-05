// Passo livre (tecla o): o professor digita a nova forma do que está em foco,
// como faria no quadro, e o app confere numericamente que ela é equivalente.
//
// - Expressão: os dois lados têm o mesmo valor em vários pontos.
// - Equação: (A − B) e (C − D) são proporcionais (constante não nula), o que
//   cobre mover termos, trocar os lados e multiplicar tudo por um número.
//   Multiplicar os dois lados por uma expressão é com a tecla = (fica explícito).
// - Inequação: o mesmo, com constante positiva; negativa se o sentido inverteu.
// Onde a conta não dá (somatórios, integrais, f(x)...), o passo entra marcado
// como não conferido.

import { getAt, replaceAt, walk, children, IMAGINARY } from '../ast.js';
import { msg, getLang } from '../i18n.js';
import { isRelation } from '../relations.js';
import { parseInput } from '../input.js';
import { toAscii, looseSame } from '../serialize.js';
import { numeric } from './calculus.js';

// Valores de teste (positivos e negativos, longe de 0 e de inteiros); cada
// variável percorre a lista com um deslocamento diferente.
const VALUES = [0.7312, -1.3841, 2.1197, -0.4423, 1.6629, -2.5378, 0.2911, 3.0417];
const POINTS = 8;
const CONSTANTS = new Set(['e', 'pi', IMAGINARY]);

function variables(...trees) {
  const names = new Set();
  for (const t of trees) walk(t, (n) => { if (n.op === 'Symbol' && !CONSTANTS.has(n.name)) names.add(n.name); });
  return [...names].sort();
}
const pointsFor = (names) => Array.from({ length: POINTS }, (_, j) => Object.fromEntries(names.map((v, i) => [v, VALUES[(j + 3 * i) % VALUES.length]])));

const close = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
const fmtNum = (v) => {
  const s = String(Number(v.toPrecision(4)));
  return getLang() === 'pt' ? s.replace('.', ',') : s;
};
const fmtPoint = (env) => Object.entries(env).map(([k, v]) => `${k === IMAGINARY ? 'i' : k} = ${fmtNum(v)}`).join(', ') || '—';

// 'ok', 'unchecked' ou { error, params }.
function sameValue(a, b) {
  const pts = pointsFor(variables(a, b));
  let valid = 0;
  for (const env of pts) {
    const [x, y] = [numeric(a, env), numeric(b, env)];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue; // fora do domínio de um dos dois
    valid++;
    if (!close(x, y)) return { error: 'err.rewriteExpr', params: { at: fmtPoint(env), a: fmtNum(x), b: fmtNum(y) } };
  }
  return valid >= 2 ? 'ok' : 'unchecked';
}

const FLIP = { Less: 'Greater', Greater: 'Less', LessEqual: 'GreaterEqual', GreaterEqual: 'LessEqual' };

function sameRelation(R, S) {
  const flipped = FLIP[R.op] === S.op;
  if (R.op !== S.op && !flipped) return { error: 'err.rewriteRel' };
  const pts = pointsFor(variables(R, S));
  const diff = (E, env) => numeric(E.args[0], env) - numeric(E.args[1], env);
  let ratio = null;
  let valid = 0;
  for (const env of pts) {
    const [p, q] = [diff(R, env), diff(S, env)];
    if (!Number.isFinite(p) || !Number.isFinite(q)) continue;
    const zp = Math.abs(p) < 1e-12, zq = Math.abs(q) < 1e-12;
    if (zp && zq) continue;
    // solução de uma e não da outra
    if (zp !== zq) return { error: 'err.rewriteEq' };
    valid++;
    const r = p / q;
    if (ratio === null) ratio = r;
    else if (!close(r, ratio)) return { error: 'err.rewriteEq' };
  }
  if (valid < 2) return 'unchecked';
  // inequação: mesmo sentido com razão positiva, sentido invertido com negativa
  if (FLIP[R.op] && (ratio > 0) === flipped) return { error: 'err.rewriteSense' };
  return 'ok';
}

// Reaproveita os ids dos pedaços que continuam iguais (animação: o termo
// que não mudou fica parado ou se move, em vez de sumir e reaparecer).
function keepIds(old, fresh) {
  const pool = [];
  walk(old, (n) => pool.push(n));
  const used = new Set();
  const mark = (n) => walk(n, (m) => used.add(m.id));
  const go = (n) => {
    const hit = pool.find((o) => !used.has(o.id) && o.op === n.op && looseSame(o, n) && (o.op !== 'Delimiter' || n.op === 'Delimiter'));
    if (hit) { mark(hit); return hit; }
    return children(n).length ? { ...n, args: n.args.map(go) } : n;
  };
  return go(fresh);
}

export function rewrite(ctx) {
  const { tree } = ctx;
  const p = ctx.targets[0];
  const old = getAt(tree, p);
  if (old.op === 'System') return { error: 'err.rewriteSystem' };
  let fresh;
  try { fresh = parseInput(ctx.input ?? ''); } catch { return { error: 'err.rewriteParse' }; }
  if (fresh.op === 'System') return { error: 'err.rewriteSystem' };
  if (isRelation(old.op) !== isRelation(fresh.op)) return { error: isRelation(old.op) ? 'err.rewriteNeedRel' : 'err.rewriteNoRel' };
  if (looseSame(old, fresh)) return { error: 'err.rewriteSame' };
  const check = isRelation(old.op) ? sameRelation(old, fresh) : sameValue(old, fresh);
  if (check.error) return check;
  const node = keepIds(old, fresh);
  return {
    tree: replaceAt(tree, p, node),
    label: msg(check === 'ok' ? 'step.rewrite' : 'step.rewriteUnchecked'),
    focus: node.id,
  };
}

// O campo começa com o que está em foco, para ser editado.
export const rewriteSuggestion = (ctx) => toAscii(getAt(ctx.tree, ctx.targets[0]));
