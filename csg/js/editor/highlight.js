// Tolerant tokenizer for syntax highlighting (never throws, keeps every char).
import { KEYWORDS } from '../lang/lexer.js';

const SET_OPS = '∪∩∖△⊕⋃⋂∅';
const ISO_OPS = '∘·×⁻¹';
const LOGIC = '∧∨¬≠≤≥∈∉=<>';
const DEF = '≔⊢↦';
const BRACKETS = '()[]{}⟨⟩⌊⌋⌈⌉';
const WORD_OPS = new Set(['and', 'or', 'not', 'show']);

const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function tokenize(src, builtins) {
  const out = [];
  let i = 0;
  const push = (end, cls) => { out.push([i, end, cls]); i = end; };
  let lineStart = true;
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') { push(i + 1, null); lineStart = true; continue; }
    if (c === ' ' || c === '\t') { let j = i; while (src[j] === ' ' || src[j] === '\t') j++; push(j, null); continue; }
    const atLineStart = lineStart;
    lineStart = false;
    if (c === '#') { let j = i; while (j < src.length && src[j] !== '\n') j++; push(j, 'tk-comment'); continue; }
    if (c === '\\' && /[A-Za-z]/.test(src[i + 1] ?? '')) {
      let j = i + 1; while (/[A-Za-z]/.test(src[j] ?? '')) j++;
      push(j, 'tk-latex');
      continue;
    }
    if (/[0-9]/.test(c)) {
      const m = /^[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?(deg)?/.exec(src.slice(i));
      push(i + m[0].length, 'tk-number');
      continue;
    }
    if (/[\p{L}_]/u.test(c) && c !== 'Σ') {
      let j = i + 1;
      while (j < src.length && /[\p{L}0-9_'′₀-₉]/u.test(src[j]) && src[j] !== 'Σ') j++;
      const word = src.slice(i, j);
      let cls = 'tk-ident';
      if (KEYWORDS.has(word) || WORD_OPS.has(word)) cls = 'tk-keyword';
      else if (atLineStart && /^\s*(\([^)]*\))?\s*(≔|:=|=)/.test(src.slice(j, j + 80).split('\n')[0])) cls = 'tk-def';
      else if (builtins.has(word)) cls = 'tk-builtin';
      push(j, cls);
      continue;
    }
    const two = src.slice(i, i + 2);
    if ([':=', '->', '<=', '>=', '!=', '|>', '++', '..', '\\/', '/\\'].includes(two)) {
      push(i + 2, two === ':=' || two === '->' ? 'tk-def' : two === '\\/' || two === '/\\' ? 'tk-set' : 'tk-op');
      continue;
    }
    let cls = 'tk-op';
    if (SET_OPS.includes(c)) cls = 'tk-set';
    else if (ISO_OPS.includes(c)) cls = 'tk-iso';
    else if (LOGIC.includes(c)) cls = 'tk-logic';
    else if (DEF.includes(c)) cls = 'tk-def';
    else if (BRACKETS.includes(c)) cls = 'tk-bracket';
    else if ('ΣΠ∏√°²³⁰¹⁴⁵⁶⁷⁸⁹⁻π'.includes(c)) cls = 'tk-math';
    push(i + 1, cls);
  }
  return out;
}

// Render tokens to HTML, overlaying error ranges as <mark>.
export function renderHighlight(src, builtins, errors = []) {
  const tokens = tokenize(src, builtins);
  const cuts = new Set([0, src.length]);
  for (const [s, e] of tokens) { cuts.add(s); cuts.add(e); }
  const ranges = errors
    .filter((e) => e.start != null)
    .map((e) => [e.start, Math.max(e.end ?? e.start + 1, e.start + 1)]);
  for (const [s, e] of ranges) { cuts.add(Math.min(s, src.length)); cuts.add(Math.min(e, src.length)); }
  const points = [...cuts].sort((a, b) => a - b);
  let html = '';
  let ti = 0;
  for (let k = 0; k + 1 < points.length; k++) {
    const s = points[k], e = points[k + 1];
    while (ti < tokens.length && tokens[ti][1] <= s) ti++;
    const cls = tokens[ti] && tokens[ti][0] <= s ? tokens[ti][2] : null;
    const err = ranges.some(([a, b]) => s >= a && e <= b);
    const text = escapeHtml(src.slice(s, e));
    const classes = [cls, err ? 'tk-error' : null].filter(Boolean).join(' ');
    html += classes ? `<span class="${classes}">${text}</span>` : text;
  }
  // Error at end of text: show a visible marker.
  if (ranges.some(([a]) => a >= src.length)) html += '<span class="tk-error"> </span>';
  return html + '\n';
}
