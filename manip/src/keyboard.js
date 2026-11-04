// Teclado matemático na tela. Insere texto no último campo de entrada que
// teve foco (o principal ou o do menu), em ASCII ou LaTeX conforme o que
// já está escrito nele, e mostra uma prévia da fórmula.
//
// Cada tecla tem um modelo com "|" marcando onde o cursor fica. Se havia
// texto selecionado no campo, ele entra no lugar do "|" (ex.: selecionar
// "x+1" e apertar √ dá "sqrt(x+1)").

import { parseInput, isLatex } from './input.js';
import { render, layoutPowers } from './render.js';
import { FUNCTIONS } from './ast.js';
import { t, functionLabel, getLang } from './i18n.js';

const k = (label, ascii, latex = ascii, cls = '') => ({ label, ascii, latex, cls });
// Rótulo calculado na hora de desenhar: "sen" em português, "sin" em inglês.
const fnKey = (name) => k(() => functionLabel(FUNCTIONS[name], name), `${name}(|)`, `\\${name}\\left(|\\right)`, 'fn');
const greek = (name, char) => k(char, name, `\\${name} `, 'math');

// Rótulos com HTML simples para ficarem parecidos com a notação.
const FRAC = '<span class="kb-frac"><span>a</span><span>b</span></span>';
const SQRT = '√<span class="kb-box"></span>';
const ROOT = '<sup>n</sup>√<span class="kb-box"></span>';
const POW2 = '<i>x</i><sup>2</sup>';
const POWN = '<i>x</i><sup><span class="kb-box sm"></span></sup>';
const BINOM = '<span class="kb-binom"><span class="kb-paren">(</span><span class="kb-frac"><span>n</span><span>k</span></span><span class="kb-paren">)</span></span>';
const SUB = '<i>x</i><sub><span class="kb-box sm"></span></sub>';

const PAGES = {
  '123': [
    [k('7', '7'), k('8', '8'), k('9', '9'), k('+', '+', '+', 'op'), k('−', '-', '-', 'op'), k(FRAC, '(|)/()', '\\frac{|}{}', 'op')],
    [k('4', '4'), k('5', '5'), k('6', '6'), k('·', '*', ' \\cdot ', 'op'), k('÷', '/', ' \\div ', 'op'), k(POW2, '^2', '^{2}', 'op')],
    [k('1', '1'), k('2', '2'), k('3', '3'), k('(', '(', '\\left(', 'op'), k(')', ')', '\\right)', 'op'), k(POWN, '^(|)', '^{|}', 'op')],
    [k('0', '0'), k(() => (getLang() === 'pt' ? ',' : '.'), '.', '.'), k('=', ' = ', ' = ', 'op'), k('<i>x</i>', 'x', 'x', 'math'), k('<i>y</i>', 'y', 'y', 'math'), k(SQRT, 'sqrt(|)', '\\sqrt{|}', 'op')],
    [k('&lt;', ' < ', ' < ', 'op'), k('≤', ' <= ', ' \\le ', 'op'), k('&gt;', ' > ', ' > ', 'op'), k('≥', ' >= ', ' \\ge ', 'op'), k('≠', ' != ', ' \\ne ', 'op'), k('<i>z</i>', 'z', 'z', 'math')],
  ],
  abc: [
    ['a', 'b', 'c', 'd', 'k', 'm', 'n'].map((c) => k(`<i>${c}</i>`, c, c, 'math')),
    ['p', 'q', 'r', 's', 't', 'u', 'v'].map((c) => k(`<i>${c}</i>`, c, c, 'math')),
    [...['w', 'x', 'y', 'z'].map((c) => k(`<i>${c}</i>`, c, c, 'math')), k(SUB, '_|', '_{|}', 'op'), k(POWN, '^(|)', '^{|}', 'op'), k(ROOT, 'root(|, )', '\\sqrt[|]{}', 'op')],
  ],
  'αβγ': [
    [greek('alpha', 'α'), greek('beta', 'β'), greek('gamma', 'γ'), greek('delta', 'δ'), greek('epsilon', 'ε'), greek('theta', 'θ'), greek('lambda', 'λ')],
    [greek('mu', 'μ'), greek('pi', 'π'), greek('rho', 'ρ'), greek('sigma', 'σ'), greek('tau', 'τ'), greek('phi', 'φ'), greek('omega', 'ω')],
    [greek('Delta', 'Δ'), greek('Gamma', 'Γ'), greek('Theta', 'Θ'), greek('Lambda', 'Λ'), greek('Sigma', 'Σ'), greek('Phi', 'Φ'), greek('Omega', 'Ω')],
  ],
  'f(x)': [
    ['sin', 'cos', 'tan', 'arcsin', 'arccos', 'arctan'].map(fnKey),
    [...['ln', 'log', 'exp'].map(fnKey), k('|<i>x</i>|', 'abs(|)', '\\operatorname{abs}\\left(|\\right)', 'fn'), k(SQRT, 'sqrt(|)', '\\sqrt{|}', 'op'), k(ROOT, 'root(|, )', '\\sqrt[|]{}', 'op')],
    [
      k('<span class="kb-imag">i</span>', 'i', '\\mathrm{i}', 'math'),
      k('<span class="kb-conj"><i>z</i></span>', 'conj(|)', '\\overline{|}', 'op'),
      k('Re', 're(|)', '\\operatorname{Re}\\left(|\\right)', 'fn'),
      k('Im', 'im(|)', '\\operatorname{Im}\\left(|\\right)', 'fn'),
      k('arg', 'arg(|)', '\\arg\\left(|\\right)', 'fn'),
      k('|<i>z</i>|²', 'abs(|)^2', '\\operatorname{abs}\\left(|\\right)^{2}', 'op'),
    ],
    [
      k('<i>n</i>!', '!', '!', 'op'),
      k(BINOM, 'binom(|, )', '\\binom{|}{}', 'op'),
      k('∑', 'sum_(k=|)^n ', '\\sum_{k=|}^{n} ', 'op'),
      k('∏', 'prod_(k=|)^n ', '\\prod_{k=|}^{n} ', 'op'),
    ],
  ],
};

export function createKeyboard(panel, { fallback }) {
  let page = '123';
  let target = null;

  // Último campo de texto com foco; se ele saiu da página (menu fechado),
  // volta para o campo principal.
  document.addEventListener('focusin', (ev) => {
    if (ev.target.matches?.('input[type="text"], .menu-input')) target = ev.target;
  });
  const field = () => (target?.isConnected ? target : fallback);

  const preview = document.createElement('div');
  preview.className = 'kb-preview';
  const tabs = document.createElement('div');
  tabs.className = 'kb-tabs';
  const grid = document.createElement('div');
  grid.className = 'kb-grid';
  const side = document.createElement('div');
  side.className = 'kb-side';
  const body = document.createElement('div');
  body.className = 'kb-body';
  body.append(grid, side);
  panel.append(preview, tabs, body);

  // Botões nunca tiram o foco do campo.
  panel.addEventListener('pointerdown', (ev) => {
    if (ev.target.closest('button')) ev.preventDefault();
  });

  function button(html, cls, onPress, title) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'kb-key ' + cls;
    b.innerHTML = html;
    if (title) b.title = title;
    b.addEventListener('click', onPress);
    return b;
  }

  function insert(key) {
    const f = field();
    const tpl = isLatex(f.value) ? key.latex : key.ascii;
    const start = f.selectionStart ?? f.value.length;
    const end = f.selectionEnd ?? start;
    const chosen = f.value.slice(start, end);
    const at = tpl.indexOf('|');
    const text = at < 0 ? tpl : tpl.slice(0, at) + chosen + tpl.slice(at + 1);
    const caret = at < 0 ? start + text.length : start + at + chosen.length;
    f.focus();
    f.setRangeText(text, start, end, 'end');
    f.setSelectionRange(caret, caret);
    f.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Próximo campo vazio à frente do cursor: (), {}, [] ou ", )" de root(x, n).
  // Sem campo vazio, vai para depois do próximo fechamento.
  function nextSlot(f) {
    const from = f.selectionEnd ?? 0;
    const rest = f.value.slice(from);
    const m = /\(\)|\{\}|\[\]|, (?=\))/.exec(rest);
    if (m) return from + m.index + (m[0] === ', ' ? 2 : 1);
    const c = /[)\]}]/.exec(rest);
    return c ? from + c.index + 1 : null;
  }

  // Tab físico nos campos de texto também pula para o próximo campo.
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Tab' || ev.shiftKey || !ev.target.matches?.('input[type="text"], .menu-input')) return;
    const pos = nextSlot(ev.target);
    if (pos === null) return;
    ev.preventDefault();
    ev.target.setSelectionRange(pos, pos);
  }, true);

  function edit(action) {
    const f = field();
    f.focus();
    const s = f.selectionStart ?? f.value.length;
    const e = f.selectionEnd ?? s;
    if (action === 'left') f.setSelectionRange(Math.max(0, s - 1), Math.max(0, s - 1));
    else if (action === 'right') f.setSelectionRange(Math.min(f.value.length, e + 1), Math.min(f.value.length, e + 1));
    else if (action === 'next') {
      const pos = nextSlot(f) ?? f.value.length;
      f.setSelectionRange(pos, pos);
    } else if (action === 'back') {
      if (s === e && s > 0) f.setRangeText('', s - 1, s, 'end');
      else f.setRangeText('', s, e, 'end');
      f.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (action === 'enter') {
      f.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }
    updatePreview();
  }

  function draw() {
    tabs.replaceChildren(...Object.keys(PAGES).map((name) =>
      button(name, name === page ? 'tab active' : 'tab', () => { page = name; draw(); })));
    grid.style.setProperty('--cols', Math.max(...PAGES[page].map((r) => r.length)));
    const label = (key) => (typeof key.label === 'function' ? key.label() : key.label);
    grid.replaceChildren(...PAGES[page].flat().map((key) => button(label(key), key.cls, () => insert(key))));
    side.replaceChildren(
      button('←', 'nav', () => edit('left'), t('kb.left')),
      button('→', 'nav', () => edit('right'), t('kb.right')),
      button('⌫', 'nav', () => edit('back'), t('kb.back')),
      button('⇥', 'nav', () => edit('next'), t('kb.next')),
      button('⏎', 'nav enter', () => edit('enter'), t('kb.enter')),
    );
  }

  // Prévia do que está no campo: a fórmula, ou o erro de leitura.
  function updatePreview() {
    const text = field().value.trim();
    if (!text) {
      preview.replaceChildren(Object.assign(document.createElement('span'), { className: 'hint', textContent: t('kb.preview') }));
      return;
    }
    try {
      const f = document.createElement('div');
      f.className = 'formula';
      f.append(render(parseInput(text)));
      preview.replaceChildren(f);
      layoutPowers(f);
    } catch (err) {
      preview.replaceChildren(Object.assign(document.createElement('span'), { className: 'hint', textContent: err.key ? t(err.key, err.params) : err.message }));
    }
  }

  document.addEventListener('input', (ev) => {
    if (!panel.hidden && ev.target === field()) updatePreview();
  });
  document.addEventListener('focusin', () => { if (!panel.hidden) updatePreview(); });

  draw();
  return {
    redraw() {
      draw();
      if (!panel.hidden) updatePreview();
    },
    toggle(open = panel.hidden) {
      panel.hidden = !open;
      document.body.classList.toggle('kb-open', open);
      // O aviso (toast) sobe para não cobrir as teclas.
      if (open) document.body.style.setProperty('--kb-h', `${panel.offsetHeight}px`);
      if (open) updatePreview();
      return open;
    },
  };
}
