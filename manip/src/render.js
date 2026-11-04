// Renderização da árvore em HTML/CSS.
// Cada nó vira um <span class="n" data-key="<id>">. Os demais elementos
// visíveis (operadores, barras de fração, parênteses, radicais) também
// recebem data-key derivada do nó dono, para que animate.js consiga
// acompanhar cada pedaço entre dois estados.

import { GREEK, FUNCTION_NAMES, IMAGINARY } from './ast.js';
import { needsParens, needsDot, isFunctionPower, simpleBase } from './notation.js';
import { functionLabel } from './i18n.js';
import { RELATIONS } from './relations.js';

const GREEK_CHARS = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', zeta: 'ζ', eta: 'η',
  theta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π',
  rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ',
  Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
};

const SVG_NS = 'http://www.w3.org/2000/svg';

function el(tag, cls, key, ...kids) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (key) e.dataset.key = key;
  for (const k of kids) e.append(k);
  return e;
}

function svgShape(cls, key, d) {
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('class', cls);
  s.setAttribute('viewBox', '0 0 10 100');
  s.setAttribute('preserveAspectRatio', 'none');
  s.dataset.key = key;
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', d);
  s.append(p);
  return s;
}

// Formas preenchidas: esticadas na vertical, a espessura horizontal se mantém.
const LPAREN = 'M9.5 0 C 0 22, 0 78, 9.5 100 L 10 98.5 C 3.2 76, 3.2 24, 10 1.5 Z';
const RPAREN = 'M0.5 0 C 10 22, 10 78, 0.5 100 L 0 98.5 C 6.8 76, 6.8 24, 0 1.5 Z';
// O radical é um traço (stroke) de espessura fixa, por mais alto que fique.
// Chave de sistema: duas curvas com a ponta no meio.
const BRACE = 'M9 0 C 4 0, 5 4, 5 12 L 5 40 C 5 46, 3 49, 0 50 C 3 51, 5 54, 5 60 L 5 88 C 5 96, 4 100, 9 100 '
  + 'L 9.6 99 C 6.4 99, 6.6 95, 6.6 88 L 6.6 60 C 6.6 53.5, 5 51, 2.6 50 C 5 49, 6.6 46.5, 6.6 40 L 6.6 12 C 6.6 5, 6.4 1, 9.6 1 Z';
const RADICAL = 'M0.4 60 L2.2 55 L5.2 96 L9.6 1 L10.4 1';

function wrapParens(content, key) {
  return el('span', 'delim', null,
    svgShape('paren l', key + '(', LPAREN),
    el('span', 'delim-body', null, content),
    svgShape('paren r', key + ')', RPAREN));
}

const op = (text, key, cls = 'bin') => el('span', 'op ' + cls, key, text);

function symbolContent(name) {
  if (name === IMAGINARY) return [el('span', 'imag', null, 'i')];
  const [base, sub] = name.split('_');
  const greek = GREEK.includes(base);
  const b = el('span', greek ? 'greek' : 'var', null, greek ? GREEK_CHARS[base] : base);
  if (sub === undefined) return [b];
  return [b, el('span', 'subscript', null, sub)];
}

export function render(n, parent = null, index = 0) {
  const e = el('span', `n ${n.op}`, n.id);
  if (n.color !== undefined) e.classList.add('c' + n.color);
  const kid = (c, i) => render(c, n, i);

  switch (n.op) {
    case 'Number':
      e.append(n.value);
      break;
    case 'Symbol':
      e.append(...symbolContent(n.name));
      if (n.named) e.classList.add('chip');
      break;
    case 'Equal': case 'NotEqual': case 'Less': case 'LessEqual': case 'Greater': case 'GreaterEqual':
      // A chave do símbolo não depende da relação: trocar < por > anima.
      e.classList.add('relation');
      e.append(kid(n.args[0], 0), op(RELATIONS[n.op], n.id + '=', 'rel'), kid(n.args[1], 1));
      break;
    case 'Add':
      // Cada termo fica junto do seu sinal num "chunk": é por eles que uma
      // expressão longa quebra de linha (o sinal começa a linha seguinte).
      n.args.forEach((c, i) => {
        const chunk = el('span', 'chunk');
        if (i > 0 && c.op !== 'Negate') chunk.append(op('+', `${n.id}+${c.id}`));
        chunk.append(kid(c, i));
        e.append(chunk);
      });
      break;
    case 'Negate': {
      const binary = parent?.op === 'Add' && index > 0;
      e.append(op('−', n.id + '-', binary ? 'bin' : 'unary'), kid(n.args[0], 0));
      break;
    }
    case 'Multiply':
      n.args.forEach((c, i) => {
        // Duas frações empilhadas coladas pareceriam uma só: a/c · b/d.
        const fractions = n.args[i - 1]?.op === 'Divide' && c.op === 'Divide';
        if (i > 0 && (fractions || needsDot(n.args[i - 1], c, i, n))) e.append(op('·', `${n.id}·${c.id}`));
        e.append(kid(c, i));
      });
      break;
    case 'Divide':
      e.append(el('span', 'fracbox', null,
        el('span', 'num', null, kid(n.args[0], 0)),
        el('span', 'bar', n.id + '/'),
        el('span', 'den', null, kid(n.args[1], 1))));
      break;
    case 'Power':
      // sen²x: o expoente fica junto do nome da função.
      if (isFunctionPower(n)) {
        const f = n.args[0];
        const fe = el('span', `n ${f.op} func`, f.id);
        if (f.color !== undefined) fe.classList.add('c' + f.color);
        fe.append(
          el('span', 'fname', f.id + 'f', functionLabel(f.op, FUNCTION_NAMES[f.op])),
          el('span', 'fexp', null, kid(n.args[1], 1)),
          render(f.args[0], f, 0));
        e.classList.add('fpow');
        e.append(fe);
        break;
      }
      e.append(
        el('span', 'base', null, kid(n.args[0], 0)),
        el('span', 'exp', null, kid(n.args[1], 1)),
      );
      break;
    case 'Sqrt':
      e.append(el('span', 'sqrtbox', null,
        svgShape('radical', n.id + '√', RADICAL),
        el('span', 'radicand', n.id + '‾', kid(n.args[0], 0))));
      break;
    case 'Root':
      e.append(el('span', 'sqrtbox rootbox', null,
        el('span', 'rootindex', null, kid(n.args[1], 1)),
        svgShape('radical', n.id + '√', RADICAL),
        el('span', 'radicand', n.id + '‾', kid(n.args[0], 0))));
      break;
    case 'System':
      // Equações em grade: lado esquerdo | relação | lado direito, alinhadas.
      e.append(svgShape('brace', n.id + '{', BRACE), el('span', 'rows', null, ...n.args.map(kid)));
      break;
    case 'Conjugate':
      // z̄: barra sobre o argumento (que pode ser uma expressão inteira)
      e.append(el('span', 'conjbody', n.id + '‾', kid(n.args[0], 0)));
      break;
    case 'Abs':
      e.append(el('span', 'bars', null, kid(n.args[0], 0)));
      break;
    case 'Delimiter':
      e.append(wrapParens(kid(n.args[0], 0), n.id));
      break;
    default: {
      const name = functionLabel(n.op, FUNCTION_NAMES[n.op] ?? n.op);
      e.classList.add('func');
      const fname = el('span', 'fname', n.id + 'f', name);
      // log com base: log₂ x
      if (n.op === 'Log' && n.args.length === 2 && simpleBase(n.args[1])) {
        e.append(fname, el('span', 'fbase', null, kid(n.args[1], 1)), kid(n.args[0], 0));
      } else e.append(fname, ...n.args.map(kid));
    }
  }

  if (parent && needsParens(n, parent, index)) {
    const inner = el('span', 'auto', null, ...e.childNodes);
    e.append(wrapParens(inner, n.id));
  }
  return e;
}

// Ajusta a altura dos expoentes conforme a altura da base (frações e
// parênteses altos empurram o expoente para cima). Roda depois do layout.
export function layoutPowers(root) {
  const pows = [...root.querySelectorAll('.Power')].reverse();
  for (const p of pows) {
    const base = p.querySelector(':scope > .base');
    const exp = p.querySelector(':scope > .exp');
    if (!base) continue; // sen²x: expoente junto do nome
    exp.style.verticalAlign = '0px';
    const b = base.getBoundingClientRect();
    const x = exp.getBoundingClientRect();
    const raise = x.top - b.top + 0.18 * x.height;
    exp.style.verticalAlign = `${Math.max(raise, 0.3 * x.height)}px`;
  }
}
