// Matrizes e determinantes. Como no resto do engine, cada regra é um passo
// explícito: desenvolver o determinante por uma linha ou coluna (Laplace),
// Sarrus, pôr um fator de uma linha em evidência, somar a uma linha um
// múltiplo de outra, transpor. As contas nas entradas ficam para o usuário.

import { getAt, replaceAt, withArgs, fn, num, isGrid, gridSize, grid, row, walk } from '../ast.js';
import { msg } from '../i18n.js';
import { toAscii } from '../serialize.js';
import { parseInput } from '../input.js';
import { isRelation } from '../relations.js';
import { evaluate } from './arith.js';
import { matches } from './normal.js';
import { factors, terms, cloneFrom, parentOf, parentPath, lastIndex, place, rebuild } from './util.js';

// ------------------------------------------------------------ onde estamos

// O determinante escrito em p, ou a grade que contém p (até dois níveis
// acima: a linha e a entrada).
function gridFrom(tree, p, op) {
  for (let up = 0; up <= 2 && up <= p.length; up++) {
    const gp = p.slice(0, p.length - up);
    const g = getAt(tree, gp);
    if (isGrid(g)) return !op || g.op === op ? { gp, g, rest: p.slice(gp.length) } : null;
  }
  return null;
}

// A linha (foco numa linha) ou a coluna (duas ou mais entradas da mesma
// coluna selecionadas, com Shift+↑↓) que o usuário escolheu.
export function lineOf(ctx, op) {
  const { tree, targets, focus } = ctx;
  if (targets.length >= 2) {
    const found = targets.map((p) => gridFrom(tree, p, op));
    if (found.some((f) => !f || f.rest.length !== 2 || f.gp.join() !== found[0].gp.join())) return null;
    const j = found[0].rest[1];
    if (found.some((f) => f.rest[1] !== j) || new Set(found.map((f) => f.rest[0])).size !== found.length) return null;
    return { ...found[0], col: j };
  }
  const f = gridFrom(tree, focus, op);
  if (!f) return null;
  if (f.rest.length === 1) return { ...f, row: f.rest[0] };
  if (f.rest.length === 0) return f;
  return null;
}

const entry = (g, i, j) => g.args[i].args[j];

// Uma entrada copiada para virar fator de um produto: −2 vai entre
// parênteses ((−2)·|…|) e um produto se abre (2x·|…|).
function asFactors(e, clones) {
  const c = cloneFrom(e, clones);
  return c.op === 'Negate' ? [fn('Delimiter', c)] : factors(c);
}

const product = (parts) => (parts.length === 1 ? parts[0] : fn('Multiply', ...parts));

// Subscritos para os rótulos: L₂, C₁.
const SUB = '₀₁₂₃₄₅₆₇₈₉';
export const subscript = (k) => String(k).replace(/\d/g, (d) => SUB[d]);

// ---------------------------------------------------------- desenvolver

// Menor complementar (i, j): o determinante sem a linha i e a coluna j,
// com cópias das entradas.
function minor(g, i, j, clones) {
  const rows = g.args.filter((_, r) => r !== i).map((r) => r.args.filter((_, c) => c !== j).map((x) => cloneFrom(x, clones)));
  return grid('Determinant', rows);
}

// Laplace pela linha `row` ou pela coluna `col`: Σ (−1)^(i+j) aᵢⱼ·Mᵢⱼ. Num
// 2×2 o menor é uma entrada só, e o resultado é ad − bc.
function laplace(g, along) {
  const [n, m] = gridSize(g);
  if (n !== m || n < 2) return null;
  const clones = {};
  const out = [];
  for (let k = 0; k < n; k++) {
    const [i, j] = along.col === undefined ? [along.row, k] : [k, along.col];
    const rest = n === 2 ? asFactors(entry(g, 1 - i, 1 - j), clones) : [minor(g, i, j, clones)];
    const t = product([...asFactors(entry(g, i, j), clones), ...rest]);
    out.push((i + j) % 2 ? fn('Negate', t) : t);
  }
  return { node: fn('Add', ...out), clones };
}

// Sarrus (3×3): as três diagonais descendo menos as três subindo.
function sarrus(g) {
  const clones = {};
  const diag = (cols, neg) => {
    const t = product(cols.flatMap((c, r) => asFactors(entry(g, r, c), clones)));
    return neg ? fn('Negate', t) : t;
  };
  const node = fn('Add',
    diag([0, 1, 2]), diag([1, 2, 0]), diag([2, 0, 1]),
    diag([2, 1, 0], true), diag([0, 2, 1], true), diag([1, 0, 2], true));
  return { node, clones };
}

function expanded(ctx, l, r, label) {
  const tree = place(ctx.tree, l.gp, r.node);
  return { tree, label, focus: r.node.id, hints: { clones: r.clones } };
}

// d: desenvolve o determinante (pela linha ou coluna escolhida; com o foco
// no determinante, pela primeira linha).
function laplaceForm(ctx) {
  const l = lineOf(ctx, 'Determinant');
  if (!l) return null;
  const [n] = gridSize(l.g);
  const along = l.col !== undefined ? { col: l.col } : { row: l.row ?? 0 };
  const r = laplace(l.g, along);
  if (!r) return null;
  const label = n === 2 && l.row === undefined && l.col === undefined
    ? msg('step.det2')
    : along.col !== undefined ? msg('step.laplaceCol', { j: along.col + 1 }) : msg('step.laplaceRow', { i: along.row + 1 });
  return expanded(ctx, l, r, label);
}

function sarrusForm(ctx) {
  const l = lineOf(ctx, 'Determinant');
  if (!l || l.row !== undefined || l.col !== undefined) return null;
  const [n, m] = gridSize(l.g);
  if (n !== 3 || m !== 3) return null;
  return expanded(ctx, l, sarrus(l.g), msg('step.sarrus'));
}

export const LAPLACE_FORMS = [laplaceForm, sarrusForm];

// ------------------------------------------------------ escalar e matriz

// Um fator que certamente não é uma matriz: sem grade dentro e sem nome
// definido como matriz.
function scalarish(n, defs = {}) {
  let ok = true;
  walk(n, (x) => {
    if (isGrid(x) || x.op === 'Row') ok = false;
    if (x.op === 'Symbol' && defs[x.name] && isGrid(defs[x.name])) ok = false;
  });
  return ok;
}

// d: k·[a, b; c, d] → [k·a, k·b; k·c, k·d].
function scalarIntoMatrix(ctx) {
  const { tree, focus } = ctx;
  for (const p of [focus, parentPath(focus)]) {
    if (!p) continue;
    const prod = getAt(tree, p);
    if (prod.op !== 'Multiply') continue;
    const mi = prod.args.findIndex((x) => x.op === 'Matrix' && isGrid(x));
    const others = prod.args.filter((_, i) => i !== mi);
    if (mi < 0 || !others.every((x) => scalarish(x, ctx.definitions))) continue;
    const M = prod.args[mi];
    const clones = {};
    const k = others.flatMap((x) => (x.op === 'Negate' ? [fn('Delimiter', x)] : factors(x)));
    const rows = M.args.map((r) => withArgs(r, r.args.map((e) => {
      const ks = k.map((x) => cloneFrom(x, clones));
      return product([...ks, ...(e.op === 'Negate' ? [fn('Delimiter', e)] : factors(e))]);
    })));
    const node = withArgs(M, rows);
    return {
      tree: replaceAt(tree, p, node),
      label: msg('step.mscalar', { k: toAscii(product(others)) }),
      focus: node.id,
      hints: { clones },
    };
  }
  return null;
}

export const MATRIX_DIST = [scalarIntoMatrix];

// ----------------------------------------------------------- fator comum

const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const isZero = (e) => e.op === 'Number' && Number(e.value) === 0;

// Coeficiente inteiro de uma entrada: 6, −6, 6x → 6; sem número → null.
function intCoef(e) {
  if (e.op === 'Negate') return intCoef(e.args[0]);
  const head = e.op === 'Multiply' ? e.args[0] : e;
  return head.op === 'Number' && /^\d+$/.test(head.value) ? BigInt(head.value) : null;
}

function divideCoef(e, g) {
  if (e.op === 'Negate') return withArgs(e, [divideCoef(e.args[0], g)]);
  if (e.op === 'Number') return num(BigInt(e.value) / g);
  const head = num(BigInt(e.args[0].value) / g);
  const rest = e.args.slice(1);
  return head.value === '1' ? rebuild('Multiply', rest) : withArgs(e, [head, ...rest]);
}

// Tira o fator f de uma entrada (que tem f entre os fatores).
function removeFactor(e, f) {
  if (e.op === 'Negate') return withArgs(e, [removeFactor(e.args[0], f)]);
  if (matches(e, f)) return num(1);
  const fs = factors(e);
  const i = fs.findIndex((x) => matches(x, f));
  return rebuild('Multiply', fs.filter((_, k) => k !== i), e);
}

const hasFactor = (e, f) => (e.op === 'Negate' ? hasFactor(e.args[0], f) : factors(e).some((x) => matches(x, f)));

// Fatores comuns às entradas (zeros não contam: 0 = k·0). Devolve uma lista
// de { f, divide }: o mdc dos coeficientes e cada fator literal comum.
function commonFactors(entries) {
  const live = entries.filter((e) => !isZero(e));
  if (!live.length) return [];
  const out = [];
  const coefs = live.map(intCoef);
  if (coefs.every((c) => c !== null)) {
    const g = coefs.reduce(gcd);
    if (g > 1n) out.push({ f: num(g), divide: (e) => (isZero(e) ? e : divideCoef(e, g)) });
  }
  const first = live[0].op === 'Negate' ? live[0].args[0] : live[0];
  for (const f of factors(first)) {
    if (f.op === 'Number' || out.some((o) => matches(o.f, f))) continue;
    if (live.every((e) => hasFactor(e, f))) out.push({ f, divide: (e) => (isZero(e) ? e : removeFactor(e, f)) });
  }
  return out;
}

// Coloca k na frente da grade: dentro do produto em que ela está, ou num
// produto novo.
function inFront(tree, gp, k, node) {
  const parent = parentOf(tree, gp);
  if (parent?.op === 'Multiply') {
    const args = parent.args.slice();
    args.splice(lastIndex(gp), 1, k, node);
    return replaceAt(tree, parentPath(gp), withArgs(parent, args));
  }
  return replaceAt(tree, gp, fn('Multiply', k, node));
}

// e: fator comum de todas as entradas (matriz), ou de uma linha ou coluna
// (determinante: o det fica multiplicado por ele).
function factorForms(ctx) {
  const l = lineOf(ctx);
  if (!l) return null;
  const { g, gp } = l;
  const [n, m] = gridSize(g);
  let cells;
  if (l.row !== undefined) cells = g.args[l.row].args.map((_, j) => [l.row, j]);
  else if (l.col !== undefined) cells = g.args.map((_, i) => [i, l.col]);
  else cells = g.args.flatMap((r, i) => r.args.map((_, j) => [i, j]));
  // Na matriz, só com todas as entradas; no determinante, uma linha ou coluna.
  const whole = cells.length === n * m;
  if (g.op === 'Matrix' && !whole) return null;
  if (g.op === 'Determinant' && whole && n > 1) return null;
  if (l.col !== undefined && cells.length !== n) return null;
  const entries = cells.map(([i, j]) => entry(g, i, j));
  return commonFactors(entries).map(({ f, divide }) => {
    const rows = g.args.map((r, i) => withArgs(r, r.args.map((e, j) => (cells.some(([a, b]) => a === i && b === j) ? divide(e) : e))));
    const node = withArgs(g, rows);
    const k = cloneFrom(f, {});
    const label = g.op === 'Matrix' ? msg('step.mfactor', { k: toAscii(f) })
      : l.col !== undefined ? msg('step.colFactor', { k: toAscii(f), j: l.col + 1 })
        : msg('step.rowFactor', { k: toAscii(f), i: l.row + 1 });
    return { tree: inFront(ctx.tree, gp, k, node), label, focus: k.id, hints: { merge: { to: k.id, from: entries.map((e) => e.id) } } };
  });
}

export const MATRIX_FACTOR = [factorForms];

// ------------------------------------------------- operações com linhas

// As duas linhas selecionadas de um mesmo determinante (a de baixo muda).
export function twoRows(ctx) {
  const { tree, targets } = ctx;
  if (targets.length !== 2) return null;
  const f = targets.map((p) => gridFrom(tree, p, 'Determinant'));
  if (f.some((x) => !x || x.rest.length !== 1) || f[0].gp.join() !== f[1].gp.join()) return null;
  const [i, j] = f.map((x) => x.rest[0]).sort((a, b) => a - b);
  return i === j ? null : { ...f[0], i, j };
}

// Sugestão de k: o valor que zera a primeira entrada numérica da linha que
// muda (Lⱼ ← Lⱼ + k·Lᵢ com k = −aⱼ/aᵢ).
export function rowSuggestion(sign) {
  return (ctx) => {
    const r = twoRows(ctx);
    if (!r) return '';
    for (let c = 0; c < r.g.args[0].args.length; c++) {
      const a = evaluate(entry(r.g, r.i, c));
      const b = evaluate(entry(r.g, r.j, c));
      if (!a || !b || a.n === 0n || b.n === 0n) continue;
      // k = −b/a (para +) ou b/a (para −)
      let nn = b.n * a.d * (sign > 0 ? -1n : 1n);
      let dd = b.d * a.n;
      if (dd < 0n) { nn = -nn; dd = -dd; }
      const g = gcd(nn < 0n ? -nn : nn, dd);
      nn /= g; dd /= g;
      return dd === 1n ? String(nn) : `${nn}/${dd}`;
    }
    return '';
  };
}

// Lⱼ ← Lⱼ ± k·Lᵢ: o determinante não muda. Cada entrada nova é bⱼ ± k·aᵢ,
// sem fazer a conta.
export function combineRows(sign) {
  return (ctx) => {
    const r = twoRows(ctx);
    if (!r) return null;
    let k;
    try {
      k = parseInput(ctx.input ?? '');
    } catch {
      return null;
    }
    if (isRelation(k.op) || !scalarish(k, ctx.definitions)) return null;
    const one = k.op === 'Number' && k.value === '1';
    const clones = {};
    const target = r.g.args[r.j];
    const newRow = withArgs(target, target.args.map((b, c) => {
      const a = entry(r.g, r.i, c);
      const ks = one ? [] : [cloneFrom(k, {})].map((x) => (x.op === 'Negate' || x.op === 'Add' ? fn('Delimiter', x) : x));
      const t = product([...ks.flatMap((x) => factors(x)), ...asFactors(a, clones)]);
      return fn('Add', ...terms(b), sign > 0 ? t : fn('Negate', t));
    }));
    const rows = r.g.args.slice();
    rows[r.j] = newRow;
    const ks = one ? '' : toAscii(k.op === 'Add' || k.op === 'Negate' ? fn('Delimiter', k) : k);
    return {
      tree: replaceAt(ctx.tree, r.gp, withArgs(r.g, rows)),
      label: msg('step.rowAdd', { j: subscript(r.j + 1), i: subscript(r.i + 1), s: sign > 0 ? '+' : '−', k: ks }),
      focus: newRow.id,
      hints: { clones },
    };
  };
}

// --------------------------------------------- trocar linhas e transpor

// Ctrl+↑↓ numa linha (ou Ctrl+←→ numa entrada, para colunas) de um
// determinante: troca com a vizinha e o determinante troca de sinal. Numa
// matriz não vale: daria outra matriz.
export function swapLines(tree, path, dir, axis) {
  const f = gridFrom(tree, path);
  if (!f) return null;
  const { g, gp, rest } = f;
  if (axis === 'row' ? rest.length !== 1 : rest.length !== 2) return null;
  if (g.op === 'Matrix') return { error: 'err.matrixSwap' };
  const [n, m] = gridSize(g);
  const i = axis === 'row' ? rest[0] : rest[1];
  const j = i + dir;
  if (j < 0 || j >= (axis === 'row' ? n : m)) return null;
  let rows;
  if (axis === 'row') {
    rows = g.args.slice();
    [rows[i], rows[j]] = [rows[j], rows[i]];
  } else {
    rows = g.args.map((r) => {
      const es = r.args.slice();
      [es[i], es[j]] = [es[j], es[i]];
      return withArgs(r, es);
    });
  }
  const node = withArgs(g, rows);
  const parent = parentOf(tree, gp);
  const t = parent?.op === 'Negate' ? replaceAt(tree, parentPath(gp), node) : replaceAt(tree, gp, fn('Negate', node));
  const [a, b] = [i, j].sort((x, y) => x - y).map((x) => subscript(x + 1));
  return {
    tree: t,
    label: msg(axis === 'row' ? 'step.rowSwap' : 'step.colSwap', { i: a, j: b }),
    arc: null,
    focus: getAt(tree, path).id,
  };
}

// #: det A = det Aᵀ (as linhas viram colunas; as entradas se movem).
function transposeDet(ctx) {
  const l = lineOf(ctx, 'Determinant');
  if (!l || l.row !== undefined || l.col !== undefined) return null;
  const [n, m] = gridSize(l.g);
  if (n !== m || n < 2) return null;
  const rows = l.g.args[0].args.map((_, j) => row(...l.g.args.map((r) => r.args[j])));
  const node = withArgs(l.g, rows);
  return { tree: replaceAt(ctx.tree, l.gp, node), label: msg('step.detTranspose'), focus: node.id };
}

export const MATRIX_FORMS = [transposeDet];
