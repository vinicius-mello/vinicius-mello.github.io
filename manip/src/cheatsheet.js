// Folha de atalhos para imprimir (cheatsheet.html), em português ou inglês
// (?lang=pt|en). Montada a partir das mesmas listas que o app usa; cada
// operação mostra um exemplo antes → depois, aplicando a regra de verdade.

import { t, setLang, getLang } from './i18n.js';
import { RULES, GROUPS } from './rules/index.js';
import { COMMANDS, NAV_KEYS } from './keymap.js';
import { EXAMPLES, exampleContext } from './examples.js';
import { parseAscii } from './parse-ascii.js';
import { render, layoutPowers } from './render.js';

const wanted = new URLSearchParams(location.search).get('lang');
if (wanted) setLang(wanted, { persist: false });
document.documentElement.lang = getLang() === 'pt' ? 'pt-BR' : 'en';
document.title = t('sheet.title');

const el = (tag, cls, ...kids) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.append(...kids);
  return e;
};
const kbd = (k) => el('kbd', null, k === 'Space' ? t('keys.space') : k);

function formula(tree) {
  const f = el('div', 'formula');
  f.append(render(tree));
  f.querySelectorAll('[data-key]').forEach((e) => e.removeAttribute('data-key'));
  return f;
}

// Antes → depois, com o texto digitado ou a seleção, quando houver.
function example(rule) {
  const ex = EXAMPLES[rule.id];
  if (!ex) return '';
  const before = parseAscii(ex.src);
  const r = rule.run(exampleContext(ex, before));
  if (!r?.tree) return '';
  const line = el('span', 'ex-line', formula(before), el('span', 'arrow', '→'), formula(r.tree));
  const notes = [];
  if (ex.input) notes.push(`${t('sheet.typed')} “${ex.input}”`);
  if (ex.sel?.length) notes.push(t('sheet.selected'));
  return notes.length ? el('span', null, line, el('span', 'ex-note', notes.join(' · '))) : line;
}

function table(rows) {
  const tb = el('table');
  for (const [keys, name, ex] of rows) {
    tb.append(el('tr', null,
      el('td', 'k', ...keys.map(kbd)),
      el('td', 'name', name),
      el('td', 'ex', ex ?? '')));
  }
  return tb;
}

const section = (title, rows) => el('section', null, el('h2', null, title), table(rows));

const sheet = document.getElementById('sheet');
sheet.append(section(t('help.nav'), NAV_KEYS.map(([keys, label]) => [keys, t(label)])));
sheet.append(section(t('help.commands'), COMMANDS.map((c) => [[c.key], t(c.label)])));
for (const g of GROUPS) {
  const rows = RULES.filter((r) => r.group === g).map((r) => [[r.key], t(`rule.${r.id}`), example(r)]);
  sheet.append(section(t(`group.${g}`), rows));
}

document.getElementById('title').textContent = t('sheet.title');
document.getElementById('subtitle').textContent = t('sheet.subtitle');
document.getElementById('foot').textContent = t('sheet.footer');
const print = document.getElementById('print');
print.textContent = t('sheet.print');
print.addEventListener('click', () => window.print());
document.querySelectorAll('[data-lang]').forEach((a) => a.classList.toggle('active', a.dataset.lang === getLang()));

// Expoentes dependem das fontes carregadas.
document.fonts.ready.then(() => document.querySelectorAll('.formula').forEach(layoutPowers));
