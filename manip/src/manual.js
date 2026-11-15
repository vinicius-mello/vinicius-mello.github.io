// Manual do Manip (manual.html), em português ou inglês (?lang=pt|en). O
// texto e os exemplos estão em manual-content.js; as tabelas de operações,
// de sintaxe e de teclas saem das mesmas listas que o app usa, e as
// fórmulas são desenhadas pelo próprio app.

import { setLang, getLang, fmt, t } from './i18n.js';
import { render, layoutPowers } from './render.js';
import { getAt } from './ast.js';
import { MANUAL, TITLE, SUBTITLE, runExample, readWith } from './manual-content.js';
import { RULES, GROUPS } from './rules/index.js';
import { EXAMPLES, exampleContext } from './examples.js';
import { SYNTAX } from './syntax.js';
import { COMMANDS, NAV_KEYS } from './keymap.js';
import { parseAscii } from './parse-ascii.js';
import { parseInput, parseDefinition } from './input.js';
import { parseHypotheses, hypothesisTree } from './hypotheses.js';
import { fn, sym } from './ast.js';

const wanted = new URLSearchParams(location.search).get('lang');
if (wanted) setLang(wanted, { persist: false });
const lang = getLang() === 'en' ? 'en' : 'pt';
document.documentElement.lang = lang === 'pt' ? 'pt-BR' : 'en';
const tr = (x) => (typeof x === 'string' ? x : x[lang]);
document.title = tr(TITLE);

const el = (tag, cls, ...kids) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.append(...kids);
  return e;
};

// Texto com `código`, **negrito** e <https://links>.
function rich(text, tag = 'p') {
  const e = el(tag);
  for (const part of tr(text).split(/(\*\*[^*]+\*\*|`[^`]+`|<https?:[^>]+>)/)) {
    if (part.startsWith('`')) e.append(el('code', null, part.slice(1, -1)));
    else if (part.startsWith('**')) e.append(el('strong', null, ...rich(part.slice(2, -2), 'span').childNodes));
    else if (part.startsWith('<http')) e.append(Object.assign(el('a', null, part.slice(1, -1)), { href: part.slice(1, -1) }));
    else if (part) e.append(part);
  }
  return e;
}

// Chips coloridos na ordem das definições, como nas abas do app.
function colored(tree, defs = {}) {
  const names = Object.keys(defs);
  return JSON.parse(JSON.stringify(tree), (k, v) => (v?.op === 'Symbol' && v.named && names.includes(v.name) ? { ...v, color: names.indexOf(v.name) } : v));
}

function formula(tree, defs, marks = {}) {
  const f = el('div', 'formula');
  f.append(render(colored(tree, defs)));
  const mark = (path, cls) => {
    try { f.querySelector(`[data-key="${getAt(tree, path).id}"]`)?.classList.add(cls); } catch { /* caminho inválido */ }
  };
  for (const p of marks.sel ?? []) mark(p, 'selected');
  if (marks.focus && !(marks.sel?.length > 1)) mark(marks.focus, 'focus');
  f.querySelectorAll('[data-key]').forEach((e) => e.removeAttribute('data-key'));
  return f;
}

const arrow = () => el('span', 'arrow', '→');

function example(ex) {
  const { before, result } = runExample(ex);
  const box = el('div', 'example');
  box.append(el('div', 'ex-line', formula(before, ex.defs, ex), arrow(), formula(result.tree, ex.defs)));
  const meta = [fmt(result.label)];
  if (ex.note) meta.unshift(tr(ex.note));
  box.append(el('div', 'ex-note', meta.join(' · ')));
  return box;
}

function steps({ src, defs, steps: list }) {
  let tree = readWith(src, defs);
  const ol = el('ol', 'steps');
  ol.append(el('li', null, el('div', 'ex-line', formula(tree, defs)), el('div', 'ex-note', lang === 'pt' ? 'entrada' : 'input')));
  for (const s of list) {
    const { result } = runExample({ ...s, defs }, tree);
    tree = result.tree;
    ol.append(el('li', null, el('div', 'ex-line', formula(tree, defs)), el('div', 'ex-note', `${tr(s.note)} · ${fmt(result.label)}`)));
  }
  const defLine = Object.entries(defs).map(([k, v]) => `${k} := ${v}`).join(', ');
  return el('div', 'example', el('div', 'ex-note', defLine), ol);
}

function define({ input, latex, name, def }) {
  const eq = readWith(`${name} = ${def}`, { [name]: def });
  return el('div', 'example',
    el('div', 'ex-line', el('code', 'typed', input), el('span', 'or', lang === 'pt' ? 'ou' : 'or'), el('code', 'typed', latex), arrow(),
      el('span', 'tabchip c0', lang === 'pt' ? `aba ${name}` : `tab ${name}`), formula(eq, { [name]: def })));
}

function table(head, rows) {
  const tb = el('table');
  tb.append(el('thead', null, el('tr', null, ...head.map((h) => el('th', null, tr(h))))));
  const body = el('tbody');
  for (const row of rows) {
    body.append(el('tr', null, ...row.map((c, i) => {
      if (c.formula) return el('td', null, formula(readWith(c.formula, c.defs), c.defs));
      if (typeof c === 'string') return el('td', null, el('code', null, c));
      if (i === 0) return el('td', null, el('strong', null, tr(c)));
      return el('td', null, ...rich(c, 'span').childNodes);
    })));
  }
  tb.append(body);
  return tb;
}

const kbd = (k) => el('kbd', null, k === 'Space' ? t('keys.space') : k);

// Operações de um grupo: tecla, nome e exemplo (aplicado pela regra).
function ops(group, intro) {
  const box = el('section', 'ops');
  box.append(el('h4', null, t(`group.${group}`)), rich(intro));
  const tb = el('table', 'optable');
  for (const rule of RULES.filter((r) => r.group === group)) {
    const ex = EXAMPLES[rule.id];
    let cell = '';
    if (ex) {
      const before = parseAscii(ex.src);
      const r = rule.run(exampleContext(ex, before));
      if (r?.tree) {
        const notes = [];
        if (ex.input) notes.push(`${t('sheet.typed')} “${ex.input}”`);
        if (ex.sel?.length) notes.push(t('sheet.selected'));
        cell = el('div', null,
          el('div', 'ex-line', formula(before, {}, { focus: ex.focus, sel: ex.sel }), arrow(), formula(r.tree, {})),
          ...(notes.length ? [el('div', 'ex-note', notes.join(' · '))] : []));
      }
    }
    tb.append(el('tr', null, el('td', 'k', kbd(rule.key)), el('td', 'name', t(`rule.${rule.id}`)), el('td', null, cell)));
  }
  box.append(tb);
  return box;
}

// Sintaxe: o quê · ASCII · LaTeX · como aparece (lido pelo parser).
function syntax() {
  const box = el('div');
  for (const [group, rows] of SYNTAX) {
    box.append(el('h4', null, t(group)));
    const tb = el('table', 'syntax');
    tb.append(el('thead', null, el('tr', null, ...['syntax.what', 'syntax.ascii', 'syntax.latex', 'syntax.shows'].map((k) => el('th', null, t(k))))));
    const body = el('tbody');
    for (const [key, ascii, latex] of rows) {
      const h = parseHypotheses(ascii);
      const d = !h && parseDefinition(ascii);
      const tree = h ? hypothesisTree(h[0]) : d ? fn('Equal', { ...sym(d.name), named: true, color: 0 }, d.def) : parseInput(ascii);
      body.append(el('tr', null, el('td', null, t(key)), el('td', null, el('code', null, ascii)), el('td', null, el('code', null, latex)), el('td', null, formula(tree))));
    }
    tb.append(body);
    box.append(tb);
  }
  return box;
}

// Referência rápida: navegação, comandos e todas as operações.
function keys() {
  const box = el('div');
  const table = (title, rows) => {
    box.append(el('h4', null, title));
    const tb = el('table', 'keytable');
    for (const [ks, label] of rows) tb.append(el('tr', null, el('td', 'k', ...ks.map(kbd)), el('td', null, label)));
    box.append(tb);
  };
  table(t('help.nav'), NAV_KEYS.map(([ks, label]) => [ks, t(label)]));
  table(t('help.commands'), COMMANDS.map((c) => [[c.key], t(c.label)]));
  table(lang === 'pt' ? 'Operações' : 'Operations', GROUPS.flatMap((g) => RULES.filter((r) => r.group === g)).map((r) => [[r.key], `${t(`rule.${r.id}`)} (${t(`group.${r.group}`)})`]));
  return box;
}

// Sumário a partir dos títulos de capítulo.
function toc() {
  const ol = el('ol', 'toc');
  MANUAL.filter(([type]) => type === 'h2').forEach(([, title], i) => {
    ol.append(el('li', null, Object.assign(el('a', null, tr(title).replace(/^\d+\.\s*/, '')), { href: `#c${i + 1}` })));
  });
  return el('nav', 'toc-box', el('h2', null, lang === 'pt' ? 'Sumário' : 'Contents'), ol);
}

const doc = document.getElementById('doc');
let chapter = 0;
for (const [type, data, rows] of MANUAL) {
  if (type === 'h2') doc.append(Object.assign(el('h2', null, tr(data)), { id: `c${++chapter}` }));
  else if (type === 'h3') doc.append(el('h3', null, tr(data)));
  else if (type === 'h4') doc.append(el('h4', null, tr(data)));
  else if (type === 'toc') doc.append(toc());
  else if (type === 'syntax') doc.append(syntax());
  else if (type === 'keys') doc.append(keys());
  else if (type === 'ops') doc.append(ops(data, rows));
  else if (type === 'p') doc.append(rich(data));
  else if (type === 'ul') doc.append(el('ul', null, ...data.map((x) => rich(x, 'li'))));
  else if (type === 'note') doc.append(el('aside', 'callout', rich(data)));
  else if (type === 'table') doc.append(table(data, rows));
  else if (type === 'ex') doc.append(example(data));
  else if (type === 'steps') doc.append(steps(data));
  else if (type === 'define') doc.append(define(data));
}

document.getElementById('title').textContent = tr(TITLE);
document.getElementById('subtitle').textContent = tr(SUBTITLE);
const print = document.getElementById('print');
print.textContent = t('sheet.print');
print.addEventListener('click', () => window.print());
document.querySelectorAll('[data-lang]').forEach((a) => a.classList.toggle('active', a.dataset.lang === lang));
document.getElementById('foot').textContent = `Manip · vinicius-mello.github.io/manip · ${new Date().toISOString().slice(0, 10)}`;

document.fonts.ready.then(() => document.querySelectorAll('.formula').forEach(layoutPowers));
