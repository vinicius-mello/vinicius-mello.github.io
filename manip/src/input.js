// Entrada do usuário: detecta se o texto é LaTeX ou ASCII e chama o parser
// certo. Qualquer forma de entrada (campo de texto, teclado virtual) passa
// por aqui.

import { parseAscii } from './parse-ascii.js';
import { parseLatex } from './parse-latex.js';

import { ParseError } from './parser.js';

export { ParseError };

export const isLatex = (text) => /[\\{}]/.test(text);

export function parseInput(text) {
  return isLatex(text) ? parseLatex(text) : parseAscii(text);
}

// Nomes: uma letra, com subscrito opcional (K, A_1, b_n).
export const NAME_RE = /^[A-Za-z](_[A-Za-z0-9]+)?$/;

// Definição auxiliar "K := expressão" (LaTeX: K \coloneqq ..., ou :=).
// Devolve { name, def } ou null se o texto não é uma definição. O lado
// esquerdo tem de ser um nome; senão é erro, e não uma equação.
const DEFINE_RE = /^(.*?)(?::=|\\coloneqq\b)(.*)$/s;

export function parseDefinition(text) {
  const m = DEFINE_RE.exec(text);
  if (!m) return null;
  const lhs = m[1].trim();
  let name;
  try {
    const n = parseInput(lhs);
    if (n.op === 'Symbol') name = n.name;
  } catch { /* tratado abaixo */ }
  if (!name || !NAME_RE.test(name)) throw new ParseError('err.defName', 0, { t: lhs });
  if (!m[2].trim()) throw new ParseError('err.incomplete', text.length);
  try {
    return { name, def: parseInput(m[2]) };
  } catch (err) {
    if (err instanceof ParseError) err.pos += m[0].length - m[2].length;
    throw err;
  }
}
