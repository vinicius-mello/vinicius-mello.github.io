// Entrada do usuário: detecta se o texto é LaTeX ou ASCII e chama o parser
// certo. Qualquer forma de entrada (campo de texto, teclado virtual) passa
// por aqui.

import { parseAscii } from './parse-ascii.js';
import { parseLatex } from './parse-latex.js';

export { ParseError } from './parser.js';

export const isLatex = (text) => /[\\{}]/.test(text);

export function parseInput(text) {
  return isLatex(text) ? parseLatex(text) : parseAscii(text);
}
