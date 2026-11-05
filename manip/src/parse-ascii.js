// Parser de expressões em ASCII: "2x + 3 = (y - 1)/4", "x^2", "sqrt(x)", "sin x".
// Não simplifica nada: a árvore reflete exatamente o que foi digitado.
// A gramática está em parser.js; aqui fica só a divisão em tokens.

import { FUNCTIONS, GREEK, IMAGINARY, BIG_OPERATORS, INFINITY } from './ast.js';
import { parseTokens, ParseError } from './parser.js';
import { RELATION_INPUT } from './relations.js';

export { ParseError };

function tokenize(src) {
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    let m;
    const rest = src.slice(i);
    if ((m = /^d(?:\^(\d+))?\/d([A-Za-z])(?:\^(\d+))?(?![A-Za-z])/.exec(rest)) && m[1] === m[3]) {
      // d/dx, d^2/dx^2
      toks.push({ t: 'deriv', v: m[2], order: Number(m[1] ?? 1), pos: i });
    } else if ((m = /^(->|→)/.exec(rest))) {
      toks.push({ t: 'to', pos: i });
    } else if (c === "'" || c === '′') {
      const last = toks[toks.length - 1];
      if (last?.t !== 'id') throw new ParseError('err.unexpectedChar', i, { c });
      last.primes = (last.primes ?? 0) + 1;
      last.end = i + 1;
      m = [c];
    } else if (c === '∞' || c === '∫' || c === '[' || c === ']') {
      toks.push(c === '∞' ? { t: 'id', v: INFINITY, pos: i, end: i + 1 } : { t: { '∫': 'int', '[': 'evopen', ']': 'evclose' }[c], pos: i });
      m = [c];
    } else if ((m = /^(\d+(\.\d+)?|\.\d+)/.exec(rest))) {
      toks.push({ t: 'num', v: m[0], pos: i });
    } else if ((m = /^[A-Za-z]+(_(\d+|[A-Za-z]))?/.exec(rest))) {
      splitWord(m[0], i, toks);
    } else if ((m = /^(<=|>=|!=|[<>=≤≥≠])/.exec(rest))) {
      toks.push({ t: 'rel', v: RELATION_INPUT[m[0]], pos: i });
    } else if ('+-*/^(),|;·×÷−!_'.includes(c)) {
      const v = { '·': '*', '×': '*', '÷': '/', '−': '-' }[c] ?? c;
      toks.push({ t: v, pos: i });
      m = [c];
    } else {
      throw new ParseError('err.unexpectedChar', i, { c });
    }
    i += m[0].length;
  }
  toks.push({ t: 'end', pos: src.length });
  return toks;
}

// Ordem importa: "infinity" antes de "inf".
const CALCULUS = ['lim', 'int', 'infinity', 'inf', 'oo'];

// "xy" vira x·y; nomes de funções e letras gregas são reconhecidos;
// um subscrito final (x_1) fica preso à última letra.
function splitWord(word, pos, toks) {
  let [base, sub] = word.split('_');
  let i = 0;
  while (i < base.length) {
    const rest = base.slice(i);
    const big = Object.keys(BIG_OPERATORS).find((k) => rest.startsWith(k));
    if (big) {
      toks.push({ t: 'big', v: BIG_OPERATORS[big], pos: pos + i });
      i += big.length;
      continue;
    }
    const calc = CALCULUS.find((k) => rest.startsWith(k));
    if (calc) {
      toks.push(calc === 'lim' || calc === 'int' ? { t: calc, pos: pos + i } : { t: 'id', v: INFINITY, pos: pos + i, end: pos + i + calc.length });
      i += calc.length;
      continue;
    }
    const f = Object.keys(FUNCTIONS)
      .filter((k) => rest.startsWith(k))
      .sort((a, b) => b.length - a.length)[0];
    const g = GREEK.filter((k) => rest.startsWith(k)).sort((a, b) => b.length - a.length)[0];
    if (f && (!g || f.length >= g.length)) {
      toks.push({ t: 'fn', v: FUNCTIONS[f], pos: pos + i });
      i += f.length;
    } else if (g) {
      toks.push({ t: 'id', v: g, pos: pos + i });
      i += g.length;
    } else {
      toks.push({ t: 'id', v: base[i] === 'i' ? IMAGINARY : base[i], pos: pos + i, end: pos + i + 1 });
      i += 1;
    }
  }
  if (sub !== undefined) {
    const last = toks[toks.length - 1];
    // int_0^1: o subscrito é o limite inferior.
    if (last.t === 'int' || last.t === 'lim') {
      toks.push({ t: '_', pos: pos + base.length }, /^\d/.test(sub) ? { t: 'num', v: sub, pos } : { t: 'id', v: sub, pos, end: pos + word.length });
      return;
    }
    if (last.t === 'fn' && last.v === 'Log' && sub) { last.base = sub; return; }
    if (last.v === IMAGINARY) last.v = 'i';
    if (last.t !== 'id') throw new ParseError('err.subNoVar', pos);
    last.v += '_' + sub;
  }
}

export function parseAscii(src) {
  return parseTokens(tokenize(src));
}
