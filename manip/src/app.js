// Estado da aplicação, mapa de teclas e ligação entre os módulos.
//
// O documento é uma lista de áreas de trabalho. A primeira é a equação
// principal; cada nome dado a uma subexpressão (K := ...) ganha a sua, com a
// equação "K = definição" para ser manipulada à parte. A definição atual de
// um nome é o outro lado dessa equação.

import { getAt, replaceAt, findPath, cloneFresh, reserveIds, sym, fn } from './ast.js';
import { parseInput, ParseError } from './input.js';
import { toAscii, toLatex } from './serialize.js';
import { toMathJson } from './mathjson.js';
import { render, layoutPowers } from './render.js';
import { capture, play, finishAll } from './animate.js';
import { left, right, up, down } from './cursor.js';
import { shiftSideways, shiftOut, shiftIn } from './moves.js';
import { History } from './history.js';
import { applicable } from './rules/index.js';
import { createKeyboard } from './keyboard.js';
import { isRelation, LATEX_RELATIONS } from './relations.js';
import { t, msg, fmt, LANGS, getLang, setLang, onLangChange, translateDom } from './i18n.js';

const COLORS = 6;
const STORAGE_KEY = 'manip.state.v3';
const EXAMPLE = '2x + 3 = 7';

const $ = (s) => document.querySelector(s);
const input = $('#input');
const inputError = $('#input-error');
const stage = $('#stage');
const historyList = $('#history');
const tabsEl = $('#tabs');
const namesPanel = $('#names-panel');
const namesList = $('#names');
const toastEl = $('#toast');
const speedSelect = $('#speed');
const menuEl = $('#menu');
const fileInput = $('#file');
const kbToggle = $('#kb-toggle');
const themeSelect = $('#theme');
const langSelect = $('#lang');
const KB_KEY = 'manip.keyboard';
const THEME_KEY = 'manip.theme';
const ZOOM_KEY = 'manip.zoom';
const LONG_KEY = 'manip.long';
const longSelect = $('#long');

let workspaces = [];
let active = 0;
let selected = new Set();
let anchorId = null; // início da seleção feita com Shift+setas
let presenting = false;
let zoom = 1;          // tamanho da fórmula escolhido com + / − / 0
let longMode = 'wrap'; // expressões longas: 'wrap' (quebrar linhas) ou 'scroll'

const ws = () => workspaces[active];
const history = () => ws().history;
const state = () => history().current;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const duration = () => (reducedMotion.matches ? 0 : Number(speedSelect.value));

function focusPath() {
  const { tree, focusId } = state();
  return findPath(tree, focusId) ?? [];
}

// ---------- áreas de trabalho e nomes ----------

function newWorkspace(id, title, tree, label, extra = {}) {
  const h = new History();
  h.push({ tree, focusId: (tree.args?.[0] ?? tree).id, label });
  return { id, title, history: h, ...extra };
}

const nameSpaces = () => workspaces.slice(1);
const isSymbolNamed = (n, name) => n.op === 'Symbol' && n.name === name;

// Definição atual de cada nome: o lado da equação que não é o próprio nome.
function definitions() {
  const defs = {};
  for (const w of nameSpaces()) {
    const t = w.history.current.tree;
    if (t.op === 'Equal' && isSymbolNamed(t.args[0], w.id)) defs[w.id] = t.args[1];
    else if (t.op === 'Equal' && isSymbolNamed(t.args[1], w.id)) defs[w.id] = t.args[0];
    else defs[w.id] = w.def;
  }
  return defs;
}

const chip = (name, color) => ({ ...sym(name), named: true, color });

function define({ name, def, chipId }, tree) {
  const color = nameSpaces().length % COLORS;
  const path = findPath(tree, chipId);
  const tree2 = replaceAt(tree, path, { ...getAt(tree, path), color });
  const eq = fn('Equal', chip(name, color), cloneFresh(def));
  workspaces.push(newWorkspace(name, name, eq, msg('step.definition'), { def: cloneFresh(def), color }));
  return tree2;
}

function switchTo(i) {
  if (i === active || !workspaces[i]) return;
  closeMenu();
  active = i;
  selected.clear();
  input.value = toAscii(state().tree);
  refresh(false);
}

// ---------- renderização ----------

// Reduz a fonte quando a fórmula não cabe no espaço disponível (miniaturas
// do histórico, prévias, quadro da apresentação).
function fit(root, width, height = Infinity) {
  root.style.fontSize = '';
  layoutPowers(root);
  const scale = Math.min(width / root.scrollWidth, height / root.scrollHeight);
  if (scale >= 1) return;
  const size = parseFloat(getComputedStyle(root).fontSize);
  root.style.fontSize = `${Math.max(10, size * scale)}px`;
  layoutPowers(root);
}

// Fórmula principal. Em ordem de preferência:
//   1. tamanho normal (vezes o zoom);
//   2. encolhida até um tamanho mínimo legível;
//   3. quebrada em linhas nos + e − do nível de cima de cada lado, no maior
//      tamanho (até o mínimo) que caiba na altura;
//   4. no mínimo legível, com rolagem (modo "rolar", ou termo grande demais).
const MIN_READABLE = 26;
const WRAPPABLE = ':scope > .relation > .Add, :scope > .Add';

function fitMain(root) {
  const width = stageWidth();
  const height = availableHeight();
  root.classList.remove('wrap', 'stack');
  root.style.maxWidth = '';
  root.querySelectorAll(':scope > .relation > .n').forEach((e) => { e.style.flexShrink = ''; });
  root.style.fontSize = '';
  const base = parseFloat(getComputedStyle(root).fontSize) * zoom;
  const min = Math.min(base, Math.max(MIN_READABLE, base * 0.55));
  const setSize = (px) => {
    root.style.fontSize = `${px}px`;
    layoutPowers(root);
  };
  const fits = () => root.scrollWidth <= width + 0.5 && root.scrollHeight <= height + 0.5;

  setSize(base);
  if (fits()) return;
  const scale = Math.min(width / root.scrollWidth, height / root.scrollHeight);
  if (base * scale >= min) return setSize(base * scale);

  if (longMode === 'wrap' && root.querySelector(WRAPPABLE)) {
    // Com um lado curto (até 40% da linha), ele fica numa linha só e o
    // longo quebra ao lado dele. Com os dois longos, o "= lado direito"
    // desce para baixo do lado esquerdo (.stack).
    setSize(min);
    const sides = [...root.querySelectorAll(':scope > .relation > .n')];
    const natural = sides.map((e) => e.getBoundingClientRect().width / min);
    root.classList.add('wrap');
    root.style.maxWidth = `${width}px`;
    for (let size = base; ; size *= 0.9) {
      const px = Math.max(size, min);
      const short = Math.min(...natural) * px <= width * 0.4;
      root.classList.toggle('stack', sides.length === 2 && !short);
      sides.forEach((e, i) => {
        e.style.flexShrink = short && natural[i] === Math.min(...natural) ? '0' : '';
      });
      setSize(px);
      if (fits() || size <= min) return;
    }
  }
  setSize(min);
}

// Altura útil do palco (descontado o quadro de passos na apresentação).
const availableHeight = () => {
  const cap = stage.querySelector('.caption');
  const capH = cap ? cap.offsetHeight + 16 : 0;
  if (presenting) return stageHeight() - capH;
  const cs = getComputedStyle(stage);
  return stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - capH;
};

// Esmaecimento nas bordas quando há conteúdo fora da área visível.
function updateScrollHints() {
  const x = stage.scrollLeft;
  const y = stage.scrollTop;
  stage.classList.toggle('more-left', x > 1);
  stage.classList.toggle('more-right', x + stage.clientWidth < stage.scrollWidth - 1);
  stage.classList.toggle('more-up', y > 1);
  stage.classList.toggle('more-down', y + stage.clientHeight < stage.scrollHeight - 1);
}

stage.addEventListener('scroll', updateScrollHints, { passive: true });

// (2 px de folga contra arredondamentos que criariam uma barra de rolagem)
const stageWidth = () => {
  const cs = getComputedStyle(stage);
  return stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 2;
};

// No modo apresentação a fórmula divide a altura com o quadro de passos.
const stageHeight = () => {
  if (!presenting) return Infinity;
  const cs = getComputedStyle(stage);
  const board = stage.querySelector('.board');
  const used = board ? board.offsetHeight + parseFloat(cs.rowGap || 0) : 0;
  return stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - used;
};

function staticFormula(tree, cls = 'formula mini') {
  const f = document.createElement('div');
  f.className = cls;
  f.append(render(tree));
  f.querySelectorAll('[data-key]').forEach((e) => e.removeAttribute('data-key'));
  return f;
}

// Nota do passo, logo abaixo da fórmula; na apresentação, também "passo i de n".
function drawCaption() {
  stage.querySelector('.caption')?.remove();
  const h = history();
  const note = h.current.note;
  if (!note && !presenting) return;
  const cap = document.createElement('div');
  cap.className = 'caption';
  if (note) cap.append(Object.assign(document.createElement('p'), { className: 'note', textContent: note }));
  if (presenting) {
    cap.append(Object.assign(document.createElement('p'), {
      className: 'counter',
      textContent: t('present.counter', { i: h.index + 1, n: h.steps.length }),
    }));
  }
  stage.append(cap);
}

// Modo apresentação: os passos anteriores ficam empilhados acima, como num quadro.
function drawBoard() {
  let board = stage.querySelector('.board');
  if (!presenting) {
    board?.remove();
    return;
  }
  if (!board) {
    board = document.createElement('div');
    board.className = 'board';
    stage.prepend(board);
  }
  const h = history();
  const prev = h.steps.slice(Math.max(0, h.index - 2), h.index);
  board.replaceChildren(...prev.map((s, i) => {
    const f = staticFormula(s.tree, 'formula board-step');
    f.style.opacity = String(0.3 + (0.4 * (i + 1)) / prev.length);
    return f;
  }));
  board.querySelectorAll('.formula').forEach((f) => fit(f, stageWidth(), stage.clientHeight * 0.2));
}

function drawFormula({ animate = false, arcKey = null, hints } = {}) {
  finishAll(stage);
  const oldRoot = stage.querySelector('.formula.main');
  const oldRects = oldRoot && animate ? capture(oldRoot) : null;

  const root = document.createElement('div');
  root.className = 'formula main';
  root.append(render(state().tree));
  if (oldRoot) oldRoot.classList.add('leaving');
  drawBoard();
  stage.append(root);
  drawCaption();
  fitMain(root);
  applyMarks();
  if (oldRects) play({ stage, oldRoot, oldRects, newRoot: root, arcKey, hints, duration: duration() });
  oldRoot?.remove();
}

// Foco e seleção são só classes: mudar o foco não reconstrói o DOM.
function applyMarks() {
  const root = stage.querySelector('.formula.main:not(.leaving)');
  root.querySelectorAll('.focus, .selected').forEach((e) => e.classList.remove('focus', 'selected'));
  const { focusId } = state();
  const focused = root.querySelector(`[data-key="${focusId}"]`);
  focused?.classList.add('focus');
  for (const id of selected) root.querySelector(`[data-key="${id}"]`)?.classList.add('selected');
  // Expressão maior que o palco: o foco nunca fica fora da vista.
  if (focused && (stage.scrollWidth > stage.clientWidth || stage.scrollHeight > stage.clientHeight)) {
    focused.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
  }
  updateScrollHints();
}

function drawHistory() {
  const h = history();
  historyList.replaceChildren(...h.steps.map((step, i) => {
    const li = document.createElement('li');
    li.className = i === h.index ? 'current' : i > h.index ? 'future' : '';
    const label = document.createElement('span');
    label.className = 'step-label';
    label.textContent = fmt(step.label);
    li.append(label, staticFormula(step.tree));
    if (step.note) li.append(Object.assign(document.createElement('span'), { className: 'step-note', textContent: step.note }));
    li.tabIndex = 0;
    li.addEventListener('click', () => {
      stepTo(i);
      stage.focus();
    });
    li.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); li.click(); }
    });
    return li;
  }));
  historyList.querySelectorAll('.formula.mini').forEach((f) => fit(f, f.parentElement.clientWidth - 40));
  historyList.querySelector('.current')?.scrollIntoView({ block: 'nearest' });
}

function drawTabs() {
  tabsEl.hidden = workspaces.length < 2;
  tabsEl.replaceChildren(...workspaces.map((w, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tab' + (i === active ? ' active' : '');
    if (w.color !== undefined) b.classList.add('c' + w.color);
    b.textContent = w.id === 'main' ? t('tab.main') : w.title;
    b.addEventListener('click', () => { switchTo(i); stage.focus(); });
    return b;
  }));
}

function drawNames() {
  const defs = definitions();
  namesPanel.hidden = !nameSpaces().length;
  namesList.replaceChildren(...nameSpaces().map((w) => {
    const li = document.createElement('li');
    li.append(staticFormula(fn('Equal', chip(w.id, w.color), defs[w.id])));
    li.title = t('names.open', { name: w.id });
    li.addEventListener('click', () => { switchTo(workspaces.indexOf(w)); stage.focus(); });
    return li;
  }));
  namesList.querySelectorAll('.formula.mini').forEach((f) => fit(f, f.parentElement.clientWidth - 40));
}

function refresh(animate = false, arcKey = null, hints = undefined) {
  drawFormula({ animate, arcKey, hints });
  drawHistory();
  drawTabs();
  drawNames();
  save();
}

let toastTimer;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
}

function bump() {
  stage.classList.remove('bump');
  void stage.offsetWidth;
  stage.classList.add('bump');
}

// ---------- ações ----------

// Se o nó em foco sumiu, o foco vai para o nó que ocupa o caminho antigo
// (ou o ancestral mais próximo que ainda existe).
function keepFocus(tree, focusId) {
  if (findPath(tree, focusId)) return focusId;
  let p = focusPath();
  for (;;) {
    try {
      const n = getAt(tree, p);
      if (n) return n.id;
    } catch { /* caminho não existe mais */ }
    p = p.slice(0, -1);
  }
}

// Cada passo guarda a sua animação (arco, fusões, riscos...), que é
// reproduzida igual ao avançar pelo histórico ou numa apresentação.
function commit(tree, label, focusId = state().focusId, arcKey = null, hints = undefined) {
  history().push({ tree, focusId: keepFocus(tree, focusId), label, arc: arcKey, hints });
  refresh(true, arcKey, hints);
}

// Vai para o passo i. Avançando um passo, repete a animação gravada nele.
function stepTo(i) {
  const h = history();
  if (i < 0 || i >= h.steps.length || i === h.index) return bump();
  const forward = i === h.index + 1;
  h.goto(i);
  selected.clear();
  const s = h.current;
  refresh(true, forward ? s.arc : null, forward ? s.hints : undefined);
}

function setFocus(path) {
  state().focusId = getAt(state().tree, path).id;
  applyMarks();
}

function move(f, ...args) {
  const r = f(state().tree, focusPath(), ...args);
  if (!r) return bump();
  if (r.error) {
    toast(t(r.error, r.params));
    return bump();
  }
  selected.clear();
  commit(r.tree, r.label, r.focus ?? state().focusId, r.arc, r.flipped ? { flip: r.relId } : undefined);
}

// Shift+←/→: seleção contígua entre irmãos, da âncora até o foco (como em
// um editor de texto). Voltar em direção à âncora encolhe a seleção.
function extendSelection(dir) {
  const path = focusPath();
  if (!path.length) return bump();
  const pp = path.slice(0, -1);
  const parent = getAt(state().tree, pp);
  const j = path[path.length - 1] + dir;
  if (j < 0 || j >= parent.args.length) return bump();
  let a = parent.args.findIndex((c) => c.id === anchorId);
  if (a < 0 || !selected.has(anchorId)) {
    anchorId = state().focusId;
    a = path[path.length - 1];
  }
  const [lo, hi] = a < j ? [a, j] : [j, a];
  selected = new Set(parent.args.slice(lo, hi + 1).map((c) => c.id));
  state().focusId = parent.args[j].id;
  applyMarks();
}

function toggleSelection() {
  const id = state().focusId;
  if (selected.has(id)) selected.delete(id);
  else selected.add(id);
  applyMarks();
}

function cycleColor() {
  const path = focusPath();
  const n = getAt(state().tree, path);
  const next = n.color === undefined ? 0 : n.color + 1;
  const node = { ...n };
  if (next >= COLORS) delete node.color;
  else node.color = next;
  const step = { tree: replaceAt(state().tree, path, node), focusId: n.id, label: msg('step.color'), colorOf: n.id };
  // Apertar C várias vezes no mesmo nó gera um passo só.
  if (state().colorOf === n.id && history().index > 0) history().replaceCurrent(step);
  else history().push(step);
  refresh(true);
}

async function copyText(text, what) {
  try {
    await navigator.clipboard.writeText(text);
    toast(t('toast.copied', { what: t(what) }));
  } catch {
    toast(text);
  }
}

function togglePresenting() {
  presenting = !presenting;
  document.body.classList.toggle('presenting', presenting);
  closeMenu();
  refresh(false);
  if (presenting) toast(t('toast.presenting'));
}

// Texto digitado no campo principal: na área principal começa um problema
// novo; numa área de nome, vira um novo passo daquela equação.
function load(text) {
  let tree;
  try {
    tree = parseInput(text);
  } catch (err) {
    if (!(err instanceof ParseError)) throw err;
    inputError.textContent = t(err.key, err.params);
    input.setSelectionRange(err.pos, Math.min(err.pos + 1, text.length));
    return false;
  }
  inputError.textContent = '';
  selected.clear();
  if (active === 0) {
    workspaces = [newWorkspace('main', 'Principal', tree, msg('step.input'))];
  } else {
    history().push({ tree, focusId: (tree.args?.[0] ?? tree).id, label: msg('step.input') });
  }
  refresh(false);
  return true;
}

// ---------- menu de operações ----------

let menu = null; // { all, items, index, input: bool, inputText, query }

// Busca sem acentos e sem maiúsculas: "potencia" acha "Potências".
const plain = (s) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

function filterMenu() {
  const q = plain(menu.query ?? '');
  menu.items = q
    ? menu.all.filter(({ rule }) => plain(t(`rule.${rule.id}`)).includes(q) || plain(t(`group.${rule.group}`)).includes(q))
    : menu.all;
  menu.index = Math.min(menu.index, Math.max(0, menu.items.length - 1));
}

function ruleContext(text) {
  const { tree } = state();
  const focus = focusPath();
  const targets = [...selected]
    .map((id) => findPath(tree, id))
    .filter(Boolean)
    .sort((a, b) => (a.join() < b.join() ? -1 : 1));
  return { tree, focus, targets: targets.length ? targets : [focus], input: text, definitions: definitions() };
}

// Nota do passo atual (tecla O): Enter salva, Shift+Enter quebra a linha,
// Esc cancela, texto vazio apaga a nota.
function openNote() {
  closeMenu();
  const step = state();
  const box = document.createElement('div');
  box.className = 'note-editor';
  const title = Object.assign(document.createElement('span'), { className: 'hint', textContent: t('note.title') });
  const ta = Object.assign(document.createElement('textarea'), {
    className: 'menu-input', rows: 2, value: step.note ?? '', placeholder: t('note.ph'),
  });
  ta.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey) {
      step.note = ta.value.trim() || undefined;
      closeMenu();
      refresh(false);
    } else if (ev.key === 'Escape') closeMenu();
    else return;
    ev.preventDefault();
    ev.stopPropagation();
  });
  box.append(title, ta, Object.assign(document.createElement('span'), { className: 'hint', textContent: t('note.hint') }));
  menu = { kind: 'note' };
  menuEl.replaceChildren(box);
  menuEl.hidden = false;
  positionMenu();
  ta.focus();
  ta.select();
}

// ruleId abre o menu direto na entrada de texto daquela regra (S, N).
function openMenu(ruleId) {
  const items = applicable(ruleContext());
  const direct = ruleId ? items.findIndex((x) => x.rule.id === ruleId) : 0;
  if (direct < 0) return bump();
  if (!items.length) {
    toast(t('toast.noOps'));
    return;
  }
  menu = { all: items, items, index: direct, input: !!ruleId, inputText: null, query: null };
  drawMenu();
}

// Aplica uma regra direto, sem abrir o menu (atalhos como "(").
function applyRule(id) {
  const item = applicable(ruleContext()).find((x) => x.rule.id === id);
  if (!item) return bump();
  applyResult(item.result);
}

function closeMenu() {
  if (!menu) return;
  menu = null;
  menuEl.hidden = true;
  stage.focus();
}

function hintEl(text) {
  return Object.assign(document.createElement('span'), { className: 'hint', textContent: text });
}

function drawMenu() {
  const { items, index } = menu;
  const list = document.createElement('ul');
  let lastGroup = null;
  items.forEach(({ rule }, i) => {
    if (rule.group !== lastGroup) {
      lastGroup = rule.group;
      const h = document.createElement('li');
      h.className = 'menu-group';
      h.textContent = t(`group.${rule.group}`);
      list.append(h);
    }
    const li = document.createElement('li');
    li.className = 'menu-item' + (i === index ? ' active' : '');
    const k = document.createElement('kbd');
    k.textContent = rule.key ?? '·';
    li.append(k, t(`rule.${rule.id}`));
    li.addEventListener('mousemove', () => {
      if (menu.index !== i && !menu.input) { menu.index = i; drawMenu(); }
    });
    li.addEventListener('mousedown', (ev) => { ev.preventDefault(); choose(i); });
    list.append(li);
  });

  // Busca: "/" abre um campo que filtra as operações pelo nome.
  const search = document.createElement('div');
  search.className = 'menu-search';
  if (menu.query !== null && !menu.input) {
    const q = document.createElement('input');
    q.className = 'menu-input';
    q.placeholder = t('menu.search');
    q.spellcheck = false;
    q.value = menu.query;
    q.addEventListener('input', () => { menu.query = q.value; menu.index = 0; filterMenu(); drawMenu(); });
    q.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp' || ev.key === 'Enter') return menuKey(ev);
      if (ev.key === 'Escape') {
        menu.query = menu.query ? '' : null;
        filterMenu();
        drawMenu();
        if (menu.query === null) menuEl.focus();
        ev.preventDefault();
      }
      ev.stopPropagation();
    });
    search.append(q);
  } else {
    search.append(hintEl(t('menu.searchHint')));
  }

  const box = document.createElement('div');
  box.className = 'menu-preview';
  menuEl.replaceChildren(search, list, box);
  menuEl.hidden = false;
  if (!items.length) {
    box.append(hintEl(t('toast.noOps')));
    positionMenu();
    search.querySelector('input')?.focus();
    return;
  }
  const { rule, result } = items[index];

  if (rule.input && menu.input) {
    const inp = document.createElement('input');
    inp.className = 'menu-input';
    inp.placeholder = t(`rule.${rule.id}.ph`);
    inp.spellcheck = false;
    // Primeira vez: a regra pode sugerir um valor (ex.: o que completa o quadrado).
    if (menu.inputText === null) menu.inputText = rule.suggest?.(ruleContext()) ?? '';
    inp.value = menu.inputText;
    inp.addEventListener('input', () => {
      menu.inputText = inp.value;
      updateInputPreview(box, inp.value);
    });
    inp.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        const r = rule.run(ruleContext(inp.value));
        if (r?.error) { toast(t(r.error, r.params)); bump(); }
        else if (r) { closeMenu(); applyResult(r); }
        else bump();
      } else if (ev.key === 'Escape') {
        menu.input = false;
        drawMenu();
        menuEl.focus();
      } else return;
      ev.preventDefault();
      ev.stopPropagation();
    });
    box.append(inp);
    updateInputPreview(box, inp.value);
    positionMenu();
    inp.focus();
    inp.select();
    return;
  }

  if (result?.tree) box.append(staticFormula(result.tree));
  else box.append(hintEl(rule.input ? t('menu.enterToType') : result?.label ? fmt(result.label) : ''));
  box.querySelectorAll('.formula.mini').forEach((f) => fit(f, 320));
  positionMenu();
  list.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  search.querySelector('input')?.focus();
}

function updateInputPreview(box, text) {
  box.querySelector('.formula, .hint')?.remove();
  const { rule } = menu.items[menu.index];
  const r = text.trim() ? rule.run(ruleContext(text)) : null;
  if (r?.tree) box.append(staticFormula(r.tree));
  else if (r?.error) box.append(Object.assign(hintEl(t(r.error, r.params)), { className: 'hint warn' }));
  else box.append(hintEl(t(`rule.${rule.id}.hint`)));
  box.querySelectorAll('.formula.mini').forEach((f) => fit(f, 320));
}

// O menu aparece logo abaixo do nó em foco, sem sair da tela.
function positionMenu() {
  const root = stage.querySelector('.formula.main:not(.leaving)');
  const target = root.querySelector('.focus') ?? root;
  const r = target.getBoundingClientRect();
  const m = menuEl.getBoundingClientRect();
  const left = Math.min(Math.max(8, r.left + r.width / 2 - m.width / 2), innerWidth - m.width - 8);
  // Com o teclado na tela aberto, o menu não pode cobrir as teclas.
  const kb = $('#keyboard');
  const bottom = kb.hidden ? innerHeight : kb.getBoundingClientRect().top;
  let top = r.bottom + 12;
  if (top + m.height > bottom - 8) top = Math.max(8, Math.min(r.top - m.height - 12, bottom - m.height - 8));
  menuEl.style.left = `${left}px`;
  menuEl.style.top = `${top}px`;
}

function choose(i) {
  const { rule, result } = menu.items[i];
  if (rule.input) {
    menu.index = i;
    menu.input = true;
    drawMenu();
    return;
  }
  closeMenu();
  applyResult(result);
}

function applyResult(r) {
  if (r.action?.type === 'open') {
    switchTo(workspaces.findIndex((w) => w.id === r.action.name));
    return;
  }
  let tree = r.tree;
  if (r.action?.type === 'define') tree = define(r.action, tree);
  selected.clear();
  commit(tree, r.label, r.focus ?? state().focusId, null, r.hints);
}

function menuKey(ev) {
  const k = ev.key;
  if (k === 'Escape') closeMenu();
  else if (!menu.items.length) return;
  else if (k === 'ArrowDown') { menu.index = (menu.index + 1) % menu.items.length; drawMenu(); }
  else if (k === 'ArrowUp') { menu.index = (menu.index - 1 + menu.items.length) % menu.items.length; drawMenu(); }
  else if (k === 'Enter') choose(menu.index);
  else if (k === '/') { menu.query = ''; drawMenu(); }
  else {
    const i = menu.items.findIndex(({ rule }) => rule.key === k.toLowerCase());
    if (i < 0) return;
    choose(i);
  }
  ev.preventDefault();
}

menuEl.addEventListener('keydown', (ev) => {
  if (menu && ev.target === menuEl) menuKey(ev);
});

// ---------- exportação e persistência ----------

// As árvores são salvas com os ids: assim as transições entre passos (e
// as animações gravadas) continuam valendo depois de abrir o arquivo.
function serialize() {
  return {
    format: 'manip',
    version: 4,
    active,
    workspaces: workspaces.map((w) => ({
      id: w.id,
      title: w.title,
      color: w.color,
      def: w.def,
      index: w.history.index,
      steps: w.history.steps.map((s) => ({ tree: s.tree, label: s.label, note: s.note, arc: s.arc, hints: s.hints })),
    })),
  };
}

function deserialize(data) {
  if (data?.format !== 'manip' || !data.workspaces?.length) throw new Error(t('err.invalidFile'));
  workspaces = data.workspaces.map((w) => {
    const h = new History();
    for (const s of w.steps) {
      // Arquivos antigos (versão 3) vinham sem ids.
      const tree = s.tree.id ? s.tree : cloneFresh(s.tree);
      reserveIds(tree);
      h.push({ tree, focusId: (tree.args?.[0] ?? tree).id, label: s.label, note: s.note, arc: s.arc, hints: s.hints });
    }
    h.goto(w.index);
    const def = w.def && (w.def.id ? w.def : cloneFresh(w.def));
    if (def) reserveIds(def);
    return { id: w.id, title: w.title, color: w.color, def, history: h };
  });
  active = Math.min(data.active ?? 0, workspaces.length - 1);
  selected.clear();
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serialize()));
  } catch { /* armazenamento indisponível: segue sem salvar */ }
}

function restore() {
  try {
    deserialize(JSON.parse(localStorage.getItem(STORAGE_KEY)));
    return true;
  } catch {
    return false;
  }
}

// Passos em um ambiente aligned, sem repetir linhas iguais (ex.: só cor).
function stepsLatex() {
  const lines = [];
  for (const s of history().steps.slice(0, history().index + 1)) {
    const t = s.tree;
    let line = isRelation(t.op)
      ? `${toLatex(t.args[0])} &${LATEX_RELATIONS[t.op]} ${toLatex(t.args[1])}`
      : `&${toLatex(t)}`;
    if (s.note) line += ` && \\text{${s.note.replace(/[\\{}$&#%_^~]/g, (c) => `\\${c}`)}}`;
    if (lines[lines.length - 1] !== line) lines.push(line);
  }
  return `\\begin{aligned}\n${lines.join(' \\\\\n')}\n\\end{aligned}`;
}

const EXPORTS = {
  'latex-steps': () => copyText(stepsLatex(), 'what.latexSteps'),
  mathjson: () => copyText(JSON.stringify(toMathJson(state().tree)), 'what.mathjson'),
  save: () => {
    const blob = new Blob([JSON.stringify(serialize(), null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: 'manip.json',
    });
    a.click();
    URL.revokeObjectURL(a.href);
  },
  open: () => fileInput.click(),
};

document.querySelectorAll('[data-export]').forEach((b) => b.addEventListener('click', () => {
  b.closest('details').open = false;
  EXPORTS[b.dataset.export]();
}));

fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  fileInput.value = '';
  if (!file) return;
  try {
    deserialize(JSON.parse(await file.text()));
    input.value = toAscii(state().tree);
    refresh(false);
    toast(t('toast.opened', { name: file.name }));
  } catch (err) {
    toast(t('toast.openFail', { err: err.message }));
  }
  stage.focus();
});

// ---------- idioma e tema ----------

langSelect.replaceChildren(...Object.entries(LANGS).map(([code, name]) =>
  Object.assign(document.createElement('option'), { value: code, textContent: name })));
langSelect.value = getLang();
langSelect.addEventListener('change', () => setLang(langSelect.value));

// Trocar o idioma redesenha tudo: rótulos dos passos e nomes de funções
// (sen/sin) dependem dele.
onLangChange(() => {
  translateDom();
  closeMenu();
  keyboard.redraw();
  if (workspaces.length) refresh(false);
});

// "auto" segue o sistema (claro/escuro); os demais fixam o tema.
function applyTheme(theme) {
  if (theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  themeSelect.value = theme;
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* sem armazenamento */ }
}

themeSelect.addEventListener('change', () => applyTheme(themeSelect.value));

function setLongMode(mode) {
  longMode = mode === 'scroll' ? 'scroll' : 'wrap';
  longSelect.value = longMode;
  try { localStorage.setItem(LONG_KEY, longMode); } catch { /* sem armazenamento */ }
  if (workspaces.length) relayout();
}

longSelect.addEventListener('change', () => setLongMode(longSelect.value));

function setZoom(z) {
  zoom = Math.min(3, Math.max(0.5, Math.round(z * 100) / 100));
  try { localStorage.setItem(ZOOM_KEY, String(zoom)); } catch { /* sem armazenamento */ }
  relayout();
  toast(t('toast.zoom', { pct: Math.round(zoom * 100) }));
}

// Escolher num menu suspenso fecha o menu e devolve o foco à equação.
document.querySelectorAll('.dropdown select').forEach((s) => s.addEventListener('change', () => {
  s.closest('details').open = false;
  stage.focus();
}));

// ---------- teclado na tela ----------

const keyboard = createKeyboard($('#keyboard'), { fallback: input });

function toggleKeyboard(open) {
  const isOpen = keyboard.toggle(open);
  kbToggle.setAttribute('aria-pressed', String(isOpen));
  try { localStorage.setItem(KB_KEY, isOpen ? '1' : ''); } catch { /* sem armazenamento */ }
  relayout();
}

kbToggle.addEventListener('click', () => toggleKeyboard());
$('#keys-toggle').addEventListener('click', () => {
  document.querySelector('.keys').classList.toggle('expanded');
  stage.focus();
});

// ---------- teclado ----------

stage.addEventListener('keydown', (ev) => {
  if (menu?.kind === 'note') return;
  if (menu) {
    menuKey(ev);
    return;
  }
  const k = ev.key;
  const ctrl = ev.ctrlKey || ev.metaKey;
  const nav = { ArrowLeft: left, ArrowRight: right, ArrowUp: up, ArrowDown: down };
  // Ctrl (ou Alt, já que no macOS Ctrl+setas troca de mesa) + setas movem o termo.
  const moves = {
    ArrowLeft: [shiftSideways, -1], ArrowRight: [shiftSideways, +1],
    ArrowUp: [shiftOut], ArrowDown: [shiftIn],
  };

  if ((ctrl || ev.altKey) && moves[k]) move(...moves[k]);
  else if (ctrl && (k === 'z' || k === 'Z')) stepTo(history().index + (ev.shiftKey ? 1 : -1));
  else if (ctrl && k === 'y') stepTo(history().index + 1);
  else if (ctrl) {
    return;
  } else if (k === 'Tab') {
    if (workspaces.length < 2) return;
    switchTo((active + (ev.shiftKey ? -1 : 1) + workspaces.length) % workspaces.length);
  } else if (k === 'PageUp' || k === 'PageDown') stepTo(history().index + (k === 'PageUp' ? -1 : 1));
  else if (k === 'Home') stepTo(0);
  else if (k === 'End') stepTo(history().steps.length - 1); else if (ev.shiftKey && k === 'ArrowLeft') extendSelection(-1);
  else if (ev.shiftKey && k === 'ArrowRight') extendSelection(+1);
  else if (nav[k] && !ev.shiftKey) {
    anchorId = null;
    setFocus(nav[k](state().tree, focusPath()));
  }
  else if (k === ' ') toggleSelection();
  else if (k === 'Escape') {
    if (selected.size) { selected.clear(); applyMarks(); }
    else if (presenting) togglePresenting();
  } else if (k === 'Enter') openMenu();
  else if (k === 's') openMenu('subst');
  else if (k === '(' || k === ')') applyRule('wrap');
  else if (k === 'n') openMenu('name');
  else if (k === 'c') cycleColor();
  else if (k === 'p') togglePresenting();
  else if (k === 'k') toggleKeyboard();
  else if (k === 'o') openNote();
  else if (k === '?') document.querySelector('.keys').classList.toggle('expanded');
  else if (k === '+' || k === '=') setZoom(zoom * 1.15);
  else if (k === '-') setZoom(zoom / 1.15);
  else if (k === '0') setZoom(1);
  else if (k === 'l') copyText(toLatex(state().tree), 'what.latex');
  else if (k === 'e') {
    input.value = toAscii(state().tree);
    input.focus();
    input.select();
  } else return;
  ev.preventDefault();
});

stage.addEventListener('click', (ev) => {
  closeMenu();
  const n = ev.target.closest('.formula.main .n');
  if (!n) return;
  const path = findPath(state().tree, n.dataset.key);
  if (path) setFocus(path);
});

input.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') {
    if (load(input.value)) stage.focus();
    ev.preventDefault();
  } else if (ev.key === 'Escape' && workspaces.length) {
    stage.focus();
  }
});
input.addEventListener('input', () => { inputError.textContent = ''; });

// O layout dos expoentes e o ajuste de largura dependem das fontes e do
// tamanho da janela.
const relayout = () => {
  stage.querySelectorAll('.board .formula').forEach((f) => fit(f, stageWidth(), stage.clientHeight * 0.2));
  stage.querySelectorAll('.formula.main').forEach(fitMain);
  updateScrollHints();
  document.querySelectorAll('.side .formula.mini').forEach((f) => fit(f, f.parentElement.clientWidth - 40));
};
document.fonts.ready.then(relayout);
addEventListener('resize', relayout);

translateDom();
document.documentElement.lang = getLang() === 'pt' ? 'pt-BR' : 'en';
try {
  applyTheme(localStorage.getItem(THEME_KEY) || 'auto');
  zoom = Number(localStorage.getItem(ZOOM_KEY)) || 1;
  setLongMode(localStorage.getItem(LONG_KEY) || 'wrap');
  if (localStorage.getItem(KB_KEY)) toggleKeyboard(true);
} catch { /* sem armazenamento */ }

if (restore()) {
  input.value = toAscii(state().tree);
  refresh(false);
} else {
  input.value = EXAMPLE;
  load(EXAMPLE);
}
stage.focus();
