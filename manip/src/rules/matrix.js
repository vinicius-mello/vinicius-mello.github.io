// Matrizes e determinantes. Como no resto do engine, cada regra é um passo
// explícito: desenvolver o determinante por uma linha ou coluna (Laplace),
// Sarrus, pôr um fator de uma linha em evidência, somar a uma linha um
// múltiplo de outra, transpor. As contas nas entradas ficam para o usuário.

import { getAt, replaceAt, withArgs, fn, num, sym, isGrid, gridSize, grid, row, walk, IMAGINARY, INFINITY } from '../ast.js';
import { msg } from '../i18n.js';
import { toAscii } from '../serialize.js';
import { parseInput } from '../input.js';
import { isRelation } from '../relations.js';
import { evaluate, evaluateComplex, complexToNode } from './arith.js';
import { matches } from './normal.js';
import { isScalar as isScalarish } from '../types.js';
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

// ------------------------------------------------------ cadeia A ∼ A′
//
// Uma operação de linha muda a matriz: o resultado não é igual, é
// equivalente por linhas. Ela vale numa matriz sozinha (ou na última de uma
// cadeia A ∼ A′), e o passo mostra A ∼ A′: a anterior fica, como cópia, e a
// nova entra à direita.
export const EQUIV = 'RowEquivalent';

export function chainable(tree, gp) {
  if (!gp.length) return true;
  const parent = getAt(tree, gp.slice(0, -1));
  return gp.length === 1 && parent.op === EQUIV && lastIndex(gp) === parent.args.length - 1;
}

function chained(tree, gp, node) {
  const clones = {};
  return { tree: fn(EQUIV, cloneFrom(getAt(tree, gp), clones), node), clones };
}

// Troca a grade em gp pela nova: num determinante (ou numa conta que não
// muda a matriz), no lugar; numa matriz, na cadeia A ∼ A′.
function rowResult(tree, g, gp, node) {
  if (g.op !== 'Matrix') return { tree: replaceAt(tree, gp, node), clones: {} };
  return chainable(tree, gp) ? chained(tree, gp, node) : null;
}

// As duas linhas selecionadas de um mesmo determinante, ou de uma matriz
// que pode mudar. Muda a linha com o foco (a última selecionada); sem o foco
// numa delas, a de baixo.
export function twoRows(ctx) {
  const { tree, targets } = ctx;
  if (targets.length !== 2) return null;
  const f = targets.map((p) => gridFrom(tree, p));
  if (f.some((x) => !x || x.rest.length !== 1) || f[0].gp.join() !== f[1].gp.join()) return null;
  if (f[0].g.op === 'Matrix' && !chainable(tree, f[0].gp)) return null;
  let [i, j] = f.map((x) => x.rest[0]).sort((a, b) => a - b);
  if (i === j) return null;
  const fg = gridFrom(tree, ctx.focus);
  if (fg && fg.gp.join() === f[0].gp.join() && fg.rest.length >= 1 && fg.rest[0] === i) [i, j] = [j, i];
  return { ...f[0], i, j };
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
    const out = rowResult(ctx.tree, r.g, r.gp, withArgs(r.g, rows));
    const params = { j: subscript(r.j + 1), i: subscript(r.i + 1), s: sign > 0 ? '+' : '−', k: ks };
    return {
      tree: out.tree,
      label: msg(r.g.op === 'Matrix' ? 'step.rowAddM' : 'step.rowAdd', params),
      focus: newRow.id,
      hints: { clones: { ...clones, ...out.clones } },
    };
  };
}

// --------------------------------------------- trocar linhas e transpor

// Ctrl+↑↓ numa linha (ou Ctrl+←→ numa entrada, para colunas) de um
// determinante: troca com a vizinha e o determinante troca de sinal. Numa
// matriz, trocar linhas é uma operação elementar (A ∼ A′); colunas, não.
export function swapLines(tree, path, dir, axis) {
  const f = gridFrom(tree, path);
  if (!f) return null;
  const { g, gp, rest } = f;
  if (axis === 'row' ? rest.length !== 1 : rest.length !== 2) return null;
  if (g.op === 'Matrix' && (axis !== 'row' || !chainable(tree, gp))) return { error: 'err.matrixSwap' };
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
  const [a, b] = [i, j].sort((x, y) => x - y).map((x) => subscript(x + 1));
  if (g.op === 'Matrix') {
    return { tree: chained(tree, gp, node).tree, label: msg('step.rowSwapM', { i: a, j: b }), arc: null, focus: getAt(tree, path).id };
  }
  const parent = parentOf(tree, gp);
  const t = parent?.op === 'Negate' ? replaceAt(tree, parentPath(gp), node) : replaceAt(tree, gp, fn('Negate', node));
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

// Lᵢ ← k·Lᵢ (k ≠ 0) numa matriz: A ∼ A′. Sugere 1/pivô.
export function rowOfMatrix(ctx) {
  const f = gridFrom(ctx.tree, ctx.focus, 'Matrix');
  if (!f || f.rest.length !== 1 || ctx.targets.length > 1 || !chainable(ctx.tree, f.gp)) return null;
  return { ...f, i: f.rest[0] };
}

export function scaleSuggestion(ctx) {
  const r = rowOfMatrix(ctx);
  if (!r) return '';
  for (const e of r.g.args[r.i].args) {
    const v = evaluate(e);
    if (v && v.n !== 0n) {
      let [nn, dd] = [v.d, v.n];
      if (dd < 0n) { nn = -nn; dd = -dd; }
      return dd === 1n ? String(nn) : `${nn}/${dd}`;
    }
  }
  return '';
}

export function scaleRow(ctx) {
  const r = rowOfMatrix(ctx);
  if (!r) return null;
  let k;
  try {
    k = parseInput(ctx.input ?? '');
  } catch {
    return null;
  }
  if (isRelation(k.op) || !scalarish(k, ctx.definitions)) return null;
  const v = evaluate(k);
  if (v && v.n === 0n) return { error: 'err.rowZero' };
  const target = r.g.args[r.i];
  const kf = (x) => (x.op === 'Negate' || x.op === 'Add' ? [fn('Delimiter', x)] : factors(x));
  const newRow = withArgs(target, target.args.map((e) => product([...kf(cloneFrom(k, {})), ...asFactors(e, {})])));
  const rows = r.g.args.slice();
  rows[r.i] = newRow;
  const out = chained(ctx.tree, r.gp, withArgs(r.g, rows));
  return {
    tree: out.tree,
    label: msg('step.rowScale', { i: subscript(r.i + 1), k: toAscii(product(kf(k))) }),
    focus: newRow.id,
    hints: { clones: out.clones },
  };
}

// ------------------------------------------------ c: contas nas entradas

// Calcula as entradas numéricas de uma linha ou da matriz inteira.
function calcEntries(ctx) {
  const l = lineOf(ctx);
  if (!l || l.col !== undefined) return null;
  const { g, gp } = l;
  let changed = false;
  const from = [];
  const rows = g.args.map((r, i) => (l.row !== undefined && i !== l.row ? r : withArgs(r, r.args.map((e) => {
    if (e.op === 'Number' || e.op === 'Symbol' || (e.op === 'Negate' && e.args[0].op === 'Number')) return e;
    const v = evaluateComplex(e);
    if (!v) return e;
    const node = complexToNode(v);
    changed = true;
    from.push(e.id);
    return node;
  }))));
  if (!changed) return null;
  const node = withArgs(g, rows);
  return {
    tree: replaceAt(ctx.tree, gp, node),
    label: msg(l.row !== undefined ? 'step.mcalcRow' : 'step.mcalc', { i: (l.row ?? 0) + 1 }),
    focus: (l.row !== undefined ? rows[l.row] : node).id,
  };
}

export const MATRIX_CALC = [calcEntries];

// ------------------------------------------------- j: soma de matrizes

const asGrid = (t) => {
  if (t.op === 'Matrix' && isGrid(t)) return { g: t, neg: false };
  if (t.op === 'Negate' && t.args[0].op === 'Matrix' && isGrid(t.args[0])) return { g: t.args[0], neg: true };
  return null;
};

// A + B (e A − B): entrada a entrada, sem fazer as contas.
function sumMatrices(ctx) {
  const { tree, focus } = ctx;
  for (const p of [focus, parentPath(focus), parentPath(parentPath(focus))]) {
    if (!p) continue;
    const S = getAt(tree, p);
    if (S.op !== 'Add') continue;
    const items = S.args.map((t, i) => ({ i, ...asGrid(t) })).filter((x) => x.g);
    if (items.length < 2) continue;
    const [n, m] = gridSize(items[0].g);
    if (items.some(({ g }) => gridSize(g)[0] !== n || gridSize(g)[1] !== m)) return { error: 'err.dims' };
    const first = items[0].g;
    const rows = first.args.map((r, i) => withArgs(r, r.args.map((_, j) => fn('Add', ...items.flatMap(({ g, neg }) => {
      const e = entry(g, i, j);
      return neg ? [fn('Negate', e)] : terms(e);
    })))));
    const node = withArgs(first, rows);
    // A soma toma o lugar da primeira matriz; as outras saem.
    const args = [];
    S.args.forEach((t, i) => {
      if (i === items[0].i) args.push(node);
      else if (!items.some((x) => x.i === i)) args.push(t);
    });
    return { tree: replaceAt(tree, p, rebuild('Add', args, S)), label: msg('step.msum'), focus: node.id };
  }
  return null;
}

// [a + c, b + d] → [a, b] + [c, d]: todas as entradas com o mesmo número de termos.
function splitMatrix(ctx) {
  const f = gridFrom(ctx.tree, ctx.focus, 'Matrix');
  if (!f || f.rest.length) return null;
  const { g, gp } = f;
  const all = g.args.flatMap((r) => r.args);
  const k = all[0].op === 'Add' ? all[0].args.length : 0;
  if (k < 2 || all.some((e) => e.op !== 'Add' || e.args.length !== k)) return null;
  const parts = Array.from({ length: k }, (_, t) => {
    const rows = g.args.map((r) => r.args.map((e) => e.args[t]));
    return t === 0 ? withArgs(g, g.args.map((r, i) => withArgs(r, rows[i]))) : grid('Matrix', rows);
  });
  const node = fn('Add', ...parts);
  return { tree: place(ctx.tree, gp, node), label: msg('step.msplit'), focus: node.id };
}

export const MATRIX_SUM = [sumMatrices, splitMatrix];

// --------------------------------------- #: produto, transposta, sistemas

// A·B linha × coluna: cada entrada é a soma dos produtos, sem as contas.
function multiplyMatrices(ctx) {
  const { tree, focus } = ctx;
  for (const p of [focus, parentPath(focus), parentPath(parentPath(focus))]) {
    if (!p) continue;
    const P = getAt(tree, p);
    if (P.op !== 'Multiply') continue;
    const isM = (x) => x?.op === 'Matrix' && isGrid(x);
    const fi = focus.length > p.length ? focus[p.length] : -1;
    const pairs = P.args.map((_, i) => i).filter((i) => isM(P.args[i]) && isM(P.args[i + 1]));
    if (!pairs.length) continue;
    const i = pairs.find((x) => x === fi || x + 1 === fi) ?? pairs[0];
    const A = P.args[i];
    const B = P.args[i + 1];
    const [r, n] = gridSize(A);
    const [n2, c] = gridSize(B);
    if (n !== n2) return { error: 'err.dims' };
    const clones = {};
    const rows = Array.from({ length: r }, (_, a) => Array.from({ length: c }, (_, b) => {
      const ts = Array.from({ length: n }, (_, k) => product([...asFactors(entry(A, a, k), clones), ...asFactors(entry(B, k, b), clones)]));
      return ts.length === 1 ? ts[0] : fn('Add', ...ts);
    }));
    const node = grid('Matrix', rows);
    const args = P.args.slice();
    args.splice(i, 2, node);
    return {
      tree: replaceAt(tree, p, rebuild('Multiply', args, P)),
      label: msg('step.mproduct'),
      focus: node.id,
      hints: { clones },
    };
  }
  return null;
}

// [a, b; c, d]^T → [a, c; b, d]
function transposeMatrix(ctx) {
  for (const p of [ctx.focus, parentPath(ctx.focus)]) {
    if (!p) continue;
    const n = getAt(ctx.tree, p);
    if (n.op !== 'Power' || n.args[0].op !== 'Matrix' || !isGrid(n.args[0]) || n.args[1].op !== 'Symbol' || n.args[1].name !== 'T') continue;
    const M = n.args[0];
    const node = withArgs(M, M.args[0].args.map((_, j) => row(...M.args.map((r) => r.args[j]))));
    return { tree: replaceAt(ctx.tree, p, node), label: msg('step.mtranspose'), focus: node.id };
  }
  return null;
}

const CONSTANTS = new Set(['e', 'pi', IMAGINARY, INFINITY]);
const isVar = (x) => x.op === 'Symbol' && !x.named && !CONSTANTS.has(x.name);
const hasVar = (n, vars) => {
  let found = false;
  walk(n, (x) => { if (isVar(x) && vars.includes(x.name)) found = true; });
  return found;
};

// Um termo de uma equação linear: { v, coef } (v nulo para constante), ou
// null se não é linear.
function linearTerm(t, vars) {
  let neg = false;
  while (t.op === 'Negate') { neg = !neg; t = t.args[0]; }
  let out = null;
  if (!hasVar(t, vars)) out = { v: null, coef: t };
  else if (isVar(t)) out = { v: t.name, coef: num(1) };
  else if (t.op === 'Multiply') {
    const vs = t.args.filter((x) => hasVar(x, vars));
    if (vs.length === 1 && isVar(vs[0])) out = { v: vs[0].name, coef: rebuild('Multiply', t.args.filter((x) => x !== vs[0])) };
  }
  return out && { ...out, neg };
}

const negated = (c) => (c.op === 'Negate' ? c.args[0] : fn('Negate', c));
const sumOrZero = (cs) => (cs.length === 0 ? num(0) : cs.length === 1 ? cs[0] : fn('Add', ...cs));

// Sistema linear → matriz aumentada [A | b] (as incógnitas ficam guardadas).
function systemToMatrix(ctx) {
  const { tree } = ctx;
  if (tree.op !== 'System' || !tree.args.every((e) => e.op === 'Equal')) return null;
  const vars = [];
  walk(tree, (x) => { if (isVar(x) && !vars.includes(x.name)) vars.push(x.name); });
  if (!vars.length) return null;
  // Incógnitas em ordem alfabética (x, y, z; x₁, x₂…), como no quadro.
  vars.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  const clones = {};
  const rows = [];
  for (const eq of tree.args) {
    const cols = vars.map(() => []);
    const b = [];
    for (const [side, sign] of [[0, 1], [1, -1]]) {
      for (const t of terms(eq.args[side])) {
        const lt = linearTerm(t, vars);
        if (!lt) return null;
        const c = cloneFrom(lt.coef, clones);
        const positive = (sign > 0) !== lt.neg;
        if (lt.v) cols[vars.indexOf(lt.v)].push(positive ? c : negated(c));
        else if (!(c.op === 'Number' && Number(c.value) === 0)) b.push(positive ? negated(c) : c);
      }
    }
    rows.push([...cols.map(sumOrZero), sumOrZero(b)]);
  }
  const node = { ...grid('Matrix', rows), aug: 1, vars };
  return { tree: node, label: msg('step.toMatrix'), focus: node.id, hints: { clones } };
}

// Matriz aumentada → sistema (com as incógnitas de antes).
function matrixToSystem(ctx) {
  const f = gridFrom(ctx.tree, ctx.focus, 'Matrix');
  if (!f || f.rest.length || augCols(f.g) !== 1 || !f.g.vars || !chainable(ctx.tree, f.gp)) return null;
  const { g } = f;
  const vars = g.vars;
  if (gridSize(g)[1] !== vars.length + 1) return null;
  const eqs = g.args.map((r) => {
    const ts = [];
    vars.forEach((v, j) => {
      const c = r.args[j];
      const x = sym(v);
      if (c.op === 'Number' && Number(c.value) === 0) return;
      if (c.op === 'Number' && c.value === '1') ts.push(x);
      else if (c.op === 'Negate' && c.args[0].op === 'Number' && c.args[0].value === '1') ts.push(fn('Negate', x));
      else if (c.op === 'Negate') ts.push(fn('Negate', product([...factors(c.args[0]), x])));
      else if (c.op === 'Add') ts.push(product([fn('Delimiter', c), x]));
      else ts.push(product([...factors(c), x]));
    });
    const lhs = ts.length === 0 ? num(0) : ts.length === 1 ? ts[0] : fn('Add', ...ts);
    return fn('Equal', lhs, r.args[vars.length]);
  });
  const node = eqs.length === 1 ? eqs[0] : fn('System', ...eqs);
  return { tree: node, label: msg('step.toSystem'), focus: node.id };
}

export const MATRIX_PRODUCT = [multiplyMatrices, transposeMatrix];
export const AUGMENTED = [systemToMatrix, matrixToSystem];

// ------------------------------------------------------------- inversa

export const IDENTITY = 'IdentityMatrix';
const isMinusOne = (e) => (e.op === 'Negate' && e.args[0].op === 'Number' && e.args[0].value === '1') || (e.op === 'Number' && e.value === '-1');
const isInverse = (n) => n.op === 'Power' && isMinusOne(n.args[1]);
const gridInverse = (n) => isInverse(n) && n.args[0].op === 'Matrix' && isGrid(n.args[0]) && gridSize(n.args[0])[0] === gridSize(n.args[0])[1];
// Colunas à direita do traço de uma matriz aumentada (true: uma).
export const augCols = (g) => (g.aug === true ? 1 : g.aug || 0);

// [a, b; c, d]^(-1) → (1/|a, b; c, d|)·[d, −b; −c, a]
function inverse2(ctx) {
  for (const p of [ctx.focus, parentPath(ctx.focus)]) {
    if (!p) continue;
    const n = getAt(ctx.tree, p);
    if (!gridInverse(n) || gridSize(n.args[0])[0] !== 2) continue;
    const M = n.args[0];
    const det = evaluate(fn('Determinant', ...M.args));
    if (det && det.n === 0n) return { error: 'err.singular' };
    const clones = {};
    const c = (i, j) => cloneFrom(entry(M, i, j), clones);
    const node = fn('Multiply',
      fn('Divide', num(1), grid('Determinant', [[c(0, 0), c(0, 1)], [c(1, 0), c(1, 1)]])),
      grid('Matrix', [[c(1, 1), negated(c(0, 1))], [negated(c(1, 0)), c(0, 0)]]));
    return { tree: replaceAt(ctx.tree, p, node), label: msg('step.inverse2'), focus: node.id, hints: { clones } };
  }
  return null;
}

// A^(-1) sozinha → [A | I], para escalonar (Gauss-Jordan).
function gaussJordan(ctx) {
  const { tree } = ctx;
  if (!gridInverse(tree)) return null;
  const M = tree.args[0];
  const n = gridSize(M)[0];
  const clones = {};
  const rows = M.args.map((r, i) => [...r.args.map((e) => cloneFrom(e, clones)), ...Array.from({ length: n }, (_, j) => num(i === j ? 1 : 0))]);
  const node = { ...grid('Matrix', rows), aug: n };
  return { tree: node, label: msg('step.gaussJordan'), focus: node.id, hints: { clones }, unchecked: true };
}

// [I | B] (a última da cadeia) → B: a inversa é o bloco da direita.
function extractInverse(ctx) {
  const f = gridFrom(ctx.tree, ctx.focus, 'Matrix');
  if (!f || f.rest.length || !chainable(ctx.tree, f.gp)) return null;
  const { g } = f;
  const [n, m] = gridSize(g);
  if (augCols(g) !== n || m !== 2 * n) return null;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const v = evaluate(entry(g, i, j));
      if (!v || v.d !== 1n || v.n !== (i === j ? 1n : 0n)) return null;
    }
  }
  const node = withArgs(g, g.args.map((r) => withArgs(r, r.args.slice(n))));
  delete node.aug;
  return { tree: node, label: msg('step.inverseFound'), focus: node.id };
}

export const INVERSE = [inverse2, gaussJordan, extractInverse];

// x: A·A⁻¹ e A⁻¹·A → I (A matriz).
function cancelInverse(ctx) {
  const { tree, focus } = ctx;
  for (const p of [focus, parentPath(focus), parentPath(parentPath(focus))]) {
    if (!p) continue;
    const P = getAt(tree, p);
    if (P.op !== 'Multiply') continue;
    for (let i = 0; i + 1 < P.args.length; i++) {
      const [x, y] = [P.args[i], P.args[i + 1]];
      const pair = (isInverse(y) && matches(y.args[0], x) && x) || (isInverse(x) && matches(x.args[0], y) && y);
      if (!pair || isScalarish(pair)) continue;
      const I = sym(IDENTITY);
      const args = P.args.slice();
      args.splice(i, 2, I);
      return {
        tree: replaceAt(tree, p, rebuild('Multiply', args, P)),
        label: msg('step.inverseCancel'),
        focus: I.id,
        hints: { merge: { to: I.id, from: [x.id, y.id] } },
      };
    }
  }
  return null;
}

// 0: I·X → X (com X matriz ou vetor).
function identityNeutral(ctx) {
  const { tree, focus } = ctx;
  for (const p of [focus, parentPath(focus)]) {
    if (!p) continue;
    const P = getAt(tree, p);
    if (P.op !== 'Multiply') continue;
    const i = P.args.findIndex((x) => x.op === 'Symbol' && x.name === IDENTITY);
    if (i < 0) continue;
    const rest = P.args.filter((_, k) => k !== i);
    if (!rest.some((x) => !isScalarish(x))) continue;
    const node = rebuild('Multiply', rest, P);
    return { tree: replaceAt(tree, p, node), label: msg('step.identityNeutral'), focus: node.id, hints: { strike: [P.args[i].id] } };
  }
  return null;
}

export const INVERSE_CANCEL = [cancelInverse];
export const IDENTITY_NEUTRAL = [identityNeutral];

// ------------------------------------------------------------- vetores

const BASIS = ['i', 'j', 'k'];
const isBasis = (x) => x.op === 'Symbol' && x.vec && BASIS.includes(x.name);
const isTuple = (x) => x?.op === 'Tuple';

// (a, b)·(c, d) → ac + bd
function dotProduct(ctx) {
  const { tree, focus } = ctx;
  for (const p of [focus, parentPath(focus), parentPath(parentPath(focus))]) {
    if (!p) continue;
    const P = getAt(tree, p);
    if (P.op !== 'Multiply') continue;
    const i = P.args.findIndex((x, k) => isTuple(x) && isTuple(P.args[k + 1]));
    if (i < 0) continue;
    const [u, v] = [P.args[i], P.args[i + 1]];
    if (u.args.length !== v.args.length) return { error: 'err.dims' };
    const clones = {};
    const ts = u.args.map((a, k) => product([...asFactors(a, clones), ...asFactors(v.args[k], clones)]));
    const node = ts.length === 1 ? ts[0] : fn('Add', ...ts);
    const args = P.args.slice();
    args.splice(i, 2, node);
    return { tree: replaceAt(tree, p, rebuild('Multiply', args, P)), label: msg('step.dot'), focus: node.id, hints: { clones } };
  }
  return null;
}

// (a, b, c) × (d, e, f) → |i⃗, j⃗, k⃗; a, b, c; d, e, f|
function crossDeterminant(ctx) {
  for (const p of [ctx.focus, parentPath(ctx.focus)]) {
    if (!p) continue;
    const n = getAt(ctx.tree, p);
    if (n.op !== 'Cross' || !n.args.every((x) => isTuple(x) && x.args.length === 3)) continue;
    const node = fn('Determinant', row(...BASIS.map((b) => ({ ...sym(b), vec: true }))), row(...n.args[0].args), row(...n.args[1].args));
    return { tree: replaceAt(ctx.tree, p, node), label: msg('step.crossDet'), focus: node.id };
  }
  return null;
}

// |(a, b)| → √(a² + b²)
function norm(ctx) {
  for (const p of [ctx.focus, parentPath(ctx.focus)]) {
    if (!p) continue;
    const n = getAt(ctx.tree, p);
    if (n.op !== 'Abs' || !isTuple(n.args[0])) continue;
    const ts = n.args[0].args.map((e) => fn('Power', e.op === 'Negate' ? fn('Delimiter', e) : e, num(2)));
    const node = fn('Sqrt', ts.length === 1 ? ts[0] : fn('Add', ...ts));
    return { tree: replaceAt(ctx.tree, p, node), label: msg('step.norm'), focus: node.id };
  }
  return null;
}

// a·i⃗ + b·j⃗ + c·k⃗ → (a, b, c)
function basisToTuple(ctx) {
  const { tree, focus } = ctx;
  for (const p of [focus, parentPath(focus), parentPath(parentPath(focus))]) {
    if (!p) continue;
    const S = getAt(tree, p);
    const ts = S.op === 'Add' ? S.args : [S];
    if (S.op !== 'Add' && S.op !== 'Multiply' && !isBasis(S)) continue;
    const cols = BASIS.map(() => []);
    let ok = true;
    for (let t of ts) {
      let neg = false;
      while (t.op === 'Negate') { neg = !neg; t = t.args[0]; }
      const fs = factors(t);
      const bs = fs.filter((x) => isBasis(x));
      const rest = fs.filter((x) => !isBasis(x));
      let basisInside = false;
      rest.forEach((x) => walk(x, (y) => { if (y.op === 'Symbol' && y.vec) basisInside = true; }));
      if (bs.length !== 1 || basisInside) { ok = false; break; }
      const c = rebuild('Multiply', rest);
      cols[BASIS.indexOf(bs[0].name)].push(neg ? negated(c) : c);
    }
    if (!ok) continue;
    const used = cols.filter((c) => c.length).length;
    const dim = cols[2].length ? 3 : 2;
    if (!used) continue;
    const node = fn('Tuple', ...cols.slice(0, dim).map(sumOrZero));
    return { tree: replaceAt(tree, p, node), label: msg('step.toTuple'), focus: node.id };
  }
  return null;
}

// (a, b, c) → a·i⃗ + b·j⃗ + c·k⃗
function tupleToBasis(ctx) {
  for (const p of [ctx.focus, parentPath(ctx.focus)]) {
    if (!p) continue;
    const n = getAt(ctx.tree, p);
    if (!isTuple(n) || n.args.length < 2 || n.args.length > 3) continue;
    const ts = [];
    n.args.forEach((c, j) => {
      const b = { ...sym(BASIS[j]), vec: true };
      if (c.op === 'Number' && Number(c.value) === 0) return;
      if (c.op === 'Number' && c.value === '1') ts.push(b);
      else if (c.op === 'Negate' && c.args[0].op === 'Number' && c.args[0].value === '1') ts.push(fn('Negate', b));
      else if (c.op === 'Negate') ts.push(fn('Negate', product([...factors(c.args[0]), b])));
      else if (c.op === 'Add') ts.push(product([fn('Delimiter', c), b]));
      else ts.push(product([...factors(c), b]));
    });
    if (!ts.length) continue;
    const node = ts.length === 1 ? ts[0] : fn('Add', ...ts);
    return { tree: place(ctx.tree, p, node), label: msg('step.toBasis'), focus: node.id };
  }
  return null;
}

export const VECTOR_FORMS = [dotProduct, crossDeterminant, norm, basisToTuple, tupleToBasis];

// d: k·(a, b) → (ka, kb)
function scalarIntoTuple(ctx) {
  const { tree, focus } = ctx;
  for (const p of [focus, parentPath(focus)]) {
    if (!p) continue;
    const P = getAt(tree, p);
    if (P.op !== 'Multiply') continue;
    const ti = P.args.findIndex(isTuple);
    const others = P.args.filter((_, i) => i !== ti);
    if (ti < 0 || !others.every((x) => scalarish(x, ctx.definitions))) continue;
    const clones = {};
    const k = others.flatMap((x) => (x.op === 'Negate' ? [fn('Delimiter', x)] : factors(x)));
    const T = P.args[ti];
    const node = withArgs(T, T.args.map((e) => product([...k.map((x) => cloneFrom(x, clones)), ...(e.op === 'Negate' ? [fn('Delimiter', e)] : factors(e))])));
    return { tree: replaceAt(tree, p, node), label: msg('step.mscalar', { k: toAscii(product(others)) }), focus: node.id, hints: { clones } };
  }
  return null;
}

// j: (a, b) + (c, d) → (a + c, b + d)
function sumTuples(ctx) {
  const { tree, focus } = ctx;
  for (const p of [focus, parentPath(focus), parentPath(parentPath(focus))]) {
    if (!p) continue;
    const S = getAt(tree, p);
    if (S.op !== 'Add') continue;
    const items = S.args.map((t, i) => ({ i, t: isTuple(t) ? t : t.op === 'Negate' && isTuple(t.args[0]) ? t.args[0] : null, neg: t.op === 'Negate' })).filter((x) => x.t);
    if (items.length < 2) continue;
    const len = items[0].t.args.length;
    if (items.some((x) => x.t.args.length !== len)) return { error: 'err.dims' };
    const node = withArgs(items[0].t, items[0].t.args.map((_, k) => fn('Add', ...items.flatMap(({ t, neg }) => (neg ? [fn('Negate', t.args[k])] : terms(t.args[k]))))));
    const args = [];
    S.args.forEach((t, i) => {
      if (i === items[0].i) args.push(node);
      else if (!items.some((x) => x.i === i)) args.push(t);
    });
    return { tree: replaceAt(tree, p, rebuild('Add', args, S)), label: msg('step.vsum'), focus: node.id };
  }
  return null;
}

MATRIX_DIST.push(scalarIntoTuple);
MATRIX_SUM.push(sumTuples);
