// Parser de um subconjunto de LaTeX: \frac, \sqrt, \sqrt[n], ^{}, _{},
// \cdot, \times, \div, \left( \right), letras gregas e funções (\sin, \ln…).
// Só divide em tokens; a gramática é a mesma do ASCII (parser.js).

import { FUNCTIONS, GREEK, IMAGINARY } from './ast.js';
import { parseTokens, ParseError } from './parser.js';
import { RELATION_INPUT } from './relations.js';

const COMMANDS = {
  frac: 'frac', dfrac: 'frac', tfrac: 'frac', sqrt: 'sqrt',
  cdot: '*', times: '*', div: '/',
  lvert: '|', rvert: '|', vert: '|',
};
// Comandos que viram funções: conjugado com barra, Re e Im.
const FUNCTION_COMMANDS = { overline: 'Conjugate', bar: 'Conjugate', Re: 'Real', Im: 'Imaginary' };
const RELATION_COMMANDS = {
  le: 'LessEqual', leq: 'LessEqual', leqslant: 'LessEqual',
  ge: 'GreaterEqual', geq: 'GreaterEqual', geqslant: 'GreaterEqual',
  lt: 'Less', gt: 'Greater', ne: 'NotEqual', neq: 'NotEqual',
};
const SPACING = new Set(['quad', 'qquad', 'left', 'right', 'displaystyle', 'mathrm', 'mathit']);
const CHARS = { '·': '*', '×': '*', '÷': '/', '−': '-' };

function tokenize(src) {
  const toks = [];
  const brackets = []; // '[' de \sqrt[n] fecha com ']'; os demais viram parênteses
  const push = (t, pos, v) => toks.push(v === undefined ? { t, pos } : { t, v, pos });
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const prev = toks[toks.length - 1]?.t;
    let m;
    if (/\s|&/.test(c)) { i++; continue; }

    if (c === '\\') {
      const name = /^[A-Za-z]+/.exec(src.slice(i + 1))?.[0];
      if (!name) {
        const ch = src[i + 1];
        if (ch === '{') push('(', i);
        else if (ch === '}') push(')', i);
        else if (ch === '\\') push(';', i); // quebra de linha: próxima equação do sistema
        else if (',;:! '.includes(ch)) { /* espaçamento */ }
        else throw new ParseError('err.unknownCmd', i, { name: ch ?? '' });
        i += 2;
        continue;
      }
      if (COMMANDS[name]) push(COMMANDS[name], i);
      else if (RELATION_COMMANDS[name]) push('rel', i, RELATION_COMMANDS[name]);
      else if (FUNCTION_COMMANDS[name]) push('fn', i, FUNCTION_COMMANDS[name]);
      else if (name === 'imaginaryI') push('id', i, IMAGINARY);
      else if (GREEK.includes(name)) push('id', i, name);
      else if (FUNCTIONS[name]) push('fn', i, FUNCTIONS[name]);
      else if (name === 'operatorname') {
        const op = /^\{([A-Za-z]+)\}/.exec(src.slice(i + 13));
        if (!op || !FUNCTIONS[op[1]]) throw new ParseError('err.unknownFn', i);
        push('fn', i, FUNCTIONS[op[1]]);
        i += 13 + op[0].length;
        continue;
      } else if (name === 'begin' || name === 'end') {
        // \begin{cases} ... \end{cases} (e aligned, array...): só o conteúdo importa
        const env = /^\{[A-Za-z*]+\}/.exec(src.slice(i + 1 + name.length));
        i += 1 + name.length + (env ? env[0].length : 0);
        continue;
      } else if (!SPACING.has(name)) throw new ParseError('err.unknownCmd', i, { name });
      if (name === 'left' || name === 'right') {
        // \left. e \right. são delimitadores vazios
        if (src[i + 1 + name.length] === '.') i++;
      }
      i += 1 + name.length;
      continue;
    }

    if (prev === '^' && /\d/.test(c)) {
      push('num', i, c); // x^23 é x²·3 em LaTeX
      i++;
    } else if ((m = /^(\d+(\.\d+)?|\.\d+)/.exec(src.slice(i)))) {
      push('num', i, m[0]);
      i += m[0].length;
    } else if (/[A-Za-z]/.test(c)) {
      push('id', i, c === 'i' ? IMAGINARY : c);
      i++;
    } else if (c === '_') {
      const last = toks[toks.length - 1];
      if (last?.t !== 'id') throw new ParseError('err.subNoVar', i);
      if (last.v === IMAGINARY) last.v = 'i';
      m = /^_(\{([^{}]*)\}|([A-Za-z0-9]))/.exec(src.slice(i));
      if (!m) throw new ParseError('err.badSub', i);
      last.v += '_' + (m[2] ?? m[3]).replace(/\s+/g, '');
      i += m[0].length;
    } else if (c === '[') {
      brackets.push(prev === 'sqrt');
      push(prev === 'sqrt' ? '[' : '(', i);
      i++;
    } else if (c === ']') {
      push(brackets.pop() ? ']' : ')', i);
      i++;
    } else if ((m = /^(<=|>=|[<>=≤≥≠])/.exec(src.slice(i)))) {
      push('rel', i, RELATION_INPUT[m[0]]);
      i += m[0].length;
    } else if ('+-*/^(),{}|'.includes(c) || CHARS[c]) {
      push(CHARS[c] ?? c, i);
      i++;
    } else {
      throw new ParseError('err.unexpectedChar', i, { c });
    }
  }
  push('end', src.length);
  return toks;
}

export function parseLatex(src) {
  return parseTokens(tokenize(src));
}
