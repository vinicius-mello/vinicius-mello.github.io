// Lexer: source text → tokens. Normalises ASCII and \latex spellings to the
// canonical Unicode operators, so the parser only sees one form of each.
//
// Token: { type, value, start, end, space, lineStart, indented }
//   type: 'num' | 'ident' | 'kw' | 'sup' | 'nl' | 'eof' | <operator string>
//   space: whitespace precedes the token;  indented: first on a line that starts with whitespace
import { LangError } from './errors.js';
import { LATEX, SUPERSCRIPT_DIGITS, SUBSCRIPT_DIGITS } from './symbols.js';

export const KEYWORDS = new Set(['let', 'in', 'if', 'then', 'else', 'mod', 'true', 'false']);

const WORD_OPERATORS = { and: '∧', or: '∨', not: '¬', show: '⊢' };

// Longest match first.
const ASCII_OPERATORS = [
  ['..<', '..<'], [':=', '≔'], ['->', '↦'], ['!=', '≠'], ['/=', '≠'], ['<=', '≤'], ['>=', '≥'],
  ['&&', '∧'], ['||', '∨'], ['|>', '|>'], ['++', '++'], ['..', '..'], ['\\/', '∪'], ['/\\', '∩'],
];

const SINGLE = {
  '+': '+', '-': '-', '−': '-', '*': '·', '·': '·', '⋅': '·', '∙': '·', '∗': '·', '/': '/', '^': '^',
  '(': '(', ')': ')', '[': '[', ']': ']', '{': '{', '}': '}', ',': ',', '|': '|', '∣': '|',
  '=': '=', '<': '<', '>': '>', '.': '.', '@': '∘', '!': '¬', '_': '_',
  '≔': '≔', '⊢': '⊢', '↦': '↦', '∪': '∪', '∩': '∩', '∖': '∖', '⧵': '∖', '△': '△', '⊕': '⊕',
  '⋃': '⋃', '⋂': '⋂', '∈': '∈', '∉': '∉', '∘': '∘', '×': '×', '⟨': '⟨', '⟩': '⟩',
  'Σ': 'Σ', '∑': 'Σ', '∏': '∏', '√': '√', '°': '°', '⌊': '⌊', '⌋': '⌋', '⌈': '⌈', '⌉': '⌉',
  '≠': '≠', '≤': '≤', '≥': '≥', '∧': '∧', '∨': '∨', '¬': '¬', '\\': '∖',
};

// Characters that are values (bound as identifiers in the prelude).
const SYMBOL_IDENTS = new Set(['∅', '∞']);

const OPENERS = new Set(['(', '[', '{', '⟨', '⌊', '⌈']);
const CLOSERS = new Set([')', ']', '}', '⟩', '⌋', '⌉']);

const isIdentStart = (c) => c !== 'Σ' && /[\p{L}_]/u.test(c);
const isIdentPart = (c) =>
  c !== 'Σ' && (/[\p{L}0-9_'′]/u.test(c) || SUBSCRIPT_DIGITS.includes(c));
const isSuper = (c) => SUPERSCRIPT_DIGITS.includes(c) || c === '⁻' || c === '⁺';

// Tokens after which a line break never ends a statement…
const CONTINUE_AFTER = new Set([
  '≔', '↦', '⊢', ',', '|', '_', '∪', '∩', '∖', '△', '⊕', '⋃', '⋂', '∈', '∉', '∘', '·', '×',
  'Σ', '∏', '√', '≠', '≤', '≥', '∧', '∨', '¬', '+', '-', '/', '^', '=', '<', '>', '..', '..<',
  '|>', '++', '.',
]);
const CONTINUE_AFTER_KW = new Set(['let', 'in', 'if', 'then', 'else', 'mod']);
// …and tokens that, starting a line, continue the previous one.
const CONTINUE_BEFORE = new Set([
  '∪', '∩', '∖', '△', '⊕', '∘', '·', '×', '+', '-', '/', '^', '=', '≠', '<', '>', '≤', '≥', '∈',
  '∉', '∧', '∨', '↦', '|>', '++', '..', '..<', '.', '|', '≔', ',',
]);
const CONTINUE_BEFORE_KW = new Set(['then', 'else', 'in', 'mod']);

function superscriptValue(text, span) {
  let sign = 1, digits = '';
  for (const c of text) {
    if (c === '⁻') sign = -sign;
    else if (c === '⁺') continue;
    else digits += SUPERSCRIPT_DIGITS.indexOf(c);
  }
  if (!digits) throw new LangError('expoente sobrescrito sem dígitos', span, 'syntax');
  return sign * Number(digits);
}

export function lex(src) {
  const raw = [];
  let i = 0;
  let space = false;
  let lineStart = true, indented = false;
  let depth = 0;

  const push = (type, value, start, end) => {
    raw.push({ type, value, start, end, space, lineStart, indented, depth });
    space = false;
    lineStart = false;
  };

  const readIdentTail = (j) => {
    while (j < src.length && isIdentPart(src[j])) j++;
    return j;
  };

  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\r') {
      if (lineStart) indented = true;
      space = true;
      i++;
      continue;
    }
    if (c === '#') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '\n' || c === ';') {
      push('nl', c, i, i + 1);
      i++;
      if (c === '\n') { lineStart = true; indented = false; }
      continue;
    }
    const start = i;

    // \latex names, \/ and a lone backslash (set difference)
    if (c === '\\') {
      const m = /^\\([A-Za-z]+|_[0-9])/.exec(src.slice(i));
      if (m) {
        const ch = LATEX.get(m[1]);
        if (!ch) throw new LangError(`comando desconhecido \\${m[1]}`, { start, end: i + m[0].length }, 'syntax');
        i += m[0].length;
        if (isIdentStart(ch) || SYMBOL_IDENTS.has(ch)) {
          const end = isIdentStart(ch) ? readIdentTail(i) : i;
          push('ident', ch + src.slice(i, end), start, end);
          i = end;
        } else if (isSuper(ch[0])) {
          push('sup', superscriptValue(ch, { start, end: i }), start, i);
        } else {
          push(SINGLE[ch] ?? ch, ch, start, i);
        }
        continue;
      }
      if (src[i + 1] === '/') { push('∪', '∪', start, i + 2); i += 2; continue; }
      push('∖', '∖', start, i + 1);
      i++;
      continue;
    }

    if (/[0-9]/.test(c)) {
      const m = /^[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?/.exec(src.slice(i));
      push('num', Number(m[0]), start, i + m[0].length);
      i += m[0].length;
      // 45deg → 45 °
      if (src.startsWith('deg', i) && !isIdentPart(src[i + 3] ?? ' ')) {
        push('°', '°', i, i + 3);
        i += 3;
      }
      continue;
    }

    if (isSuper(c)) {
      let j = i;
      while (j < src.length && isSuper(src[j])) j++;
      push('sup', superscriptValue(src.slice(i, j), { start, end: j }), start, j);
      i = j;
      continue;
    }

    if (isIdentStart(c) && !(c === '_' && !isIdentPart(src[i + 1] ?? ' '))) {
      const j = readIdentTail(i + 1);
      const word = src.slice(i, j);
      if (KEYWORDS.has(word)) push('kw', word, start, j);
      else if (WORD_OPERATORS[word]) push(WORD_OPERATORS[word], WORD_OPERATORS[word], start, j);
      else push('ident', word, start, j);
      i = j;
      continue;
    }

    if (SYMBOL_IDENTS.has(c)) {
      push('ident', c, start, i + 1);
      i++;
      continue;
    }

    const multi = ASCII_OPERATORS.find(([s]) => src.startsWith(s, i));
    if (multi) {
      push(multi[1], multi[1], start, i + multi[0].length);
      i += multi[0].length;
      continue;
    }

    const single = SINGLE[c];
    if (single) {
      if (OPENERS.has(single)) depth++;
      if (CLOSERS.has(single)) depth = Math.max(0, depth - 1);
      push(single, single, start, i + 1);
      i++;
      continue;
    }

    throw new LangError(`caractere inesperado '${c}'`, { start, end: i + 1 }, 'syntax');
  }
  push('eof', null, src.length, src.length);
  return joinLines(raw);
}

// Decide which line breaks end statements.
function joinLines(raw) {
  const out = [];
  for (let k = 0; k < raw.length; k++) {
    const t = raw[k];
    if (t.type !== 'nl') { out.push(t); continue; }
    let n = k + 1;
    while (raw[n].type === 'nl') n++;
    const next = raw[n];
    // An unindented `name ≔` always starts a new definition, even after an
    // unclosed bracket — keeps one syntax error from swallowing the file.
    const startsDefinition = !next.indented && next.type === 'ident' && raw[n + 1]?.type === '≔';
    if (t.depth > 0 && !startsDefinition) continue; // inside brackets
    const prev = out[out.length - 1];
    if (!prev || prev.type === 'nl') continue; // leading / repeated breaks
    if (next.type === 'eof') continue;
    if (startsDefinition) { out.push(t); continue; }
    if (next.indented) continue;
    if (CONTINUE_AFTER.has(prev.type) || (prev.type === 'kw' && CONTINUE_AFTER_KW.has(prev.value))) continue;
    if (CONTINUE_BEFORE.has(next.type) || (next.type === 'kw' && CONTINUE_BEFORE_KW.has(next.value))) continue;
    out.push(t);
  }
  return out;
}
