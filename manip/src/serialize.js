// Serialização da árvore para ASCII (reeditar no campo de entrada) e LaTeX.

import { FUNCTION_NAMES, GREEK, IMAGINARY } from './ast.js';
import { needsParens, needsDot, isFunctionPower, simpleBase } from './notation.js';
import { ASCII_RELATIONS, LATEX_RELATIONS, isRelation } from './relations.js';
import { parseAscii } from './parse-ascii.js';

// Escrito como um bloco só: número, símbolo, (…) ou nome(…).
const COMPOUND = new Set(['Add', 'Multiply', 'Divide', 'Power', 'Negate']);
const asciiAtomic = (n) => !COMPOUND.has(n.op) && !isRelation(n.op);
// Escrito como nome(…): sqrt(x), conj(z), sin(x)...
const callStyle = (n) => asciiAtomic(n) && n.op !== 'Number' && n.op !== 'Symbol' && n.op !== 'Delimiter';

// Igualdade estrutural ignorando parênteses digitados (Delimiter).
function looseSame(a, b) {
  while (a.op === 'Delimiter') a = a.args[0];
  while (b.op === 'Delimiter') b = b.args[0];
  if (a.op !== b.op) return false;
  if (a.op === 'Number') return a.value === b.value;
  if (a.op === 'Symbol') return a.name === b.name;
  return a.args.length === b.args.length && a.args.every((c, i) => looseSame(c, b.args[i]));
}

// Produto em ASCII: justaposição quando é seguro ("2x", "xy", "2sin(x)"),
// "*" antes de nome(…) depois de letra ("x*sin(x)"). Se a versão justaposta
// não for lida de volta igual (ex.: p·i viraria a letra π), usa "*" em tudo.
function asciiProduct(n, sub) {
  const parts = n.args.map((c, i) => (c.op === 'Divide' ? `(${toAscii(c)})` : sub(c, i)));
  const joined = parts.map((p, i) => {
    if (i === 0) return p;
    const prev = n.args[i - 1];
    const c = n.args[i];
    const star = needsDot(prev, c, i, n) || (callStyle(c) && prev.op !== 'Number' && !needsParens(c, n, i));
    return (star ? '*' : '') + p;
  }).join('');
  try {
    if (looseSame(parseAscii(joined), n)) return joined;
  } catch { /* não lê de volta: usa "*" */ }
  return parts.join('*');
}

export function toAscii(n) {
  const sub = (c, i) => {
    const s = toAscii(c);
    return needsParens(c, n, i) ? `(${s})` : s;
  };
  const group = (c) => (asciiAtomic(c) ? toAscii(c) : `(${toAscii(c)})`);
  switch (n.op) {
    case 'Number': return n.value;
    case 'Symbol': return n.name === IMAGINARY ? 'i' : n.name;
    case 'Equal': case 'NotEqual': case 'Less': case 'LessEqual': case 'Greater': case 'GreaterEqual':
      return `${toAscii(n.args[0])} ${ASCII_RELATIONS[n.op]} ${toAscii(n.args[1])}`;
    case 'Add':
      return n.args.map((c, i) => {
        if (i > 0 && c.op === 'Negate') return ' - ' + toAscii(c).slice(1);
        return (i > 0 ? ' + ' : '') + sub(c, i);
      }).join('');
    case 'Negate': return '-' + sub(n.args[0], 0);
    // Fração dentro de produto vai entre parênteses: "x*1/2" seria (x·1)/2.
    case 'Multiply': return asciiProduct(n, sub);
    case 'Divide': return `${group(n.args[0])}/${group(n.args[1])}`;
    case 'Power':
      if (isFunctionPower(n)) return `${FUNCTION_NAMES[n.args[0].op]}^${n.args[1].value}(${toAscii(n.args[0].args[0])})`;
      return `${sub(n.args[0], 0)}^${group(n.args[1])}`;
    case 'Log':
      if (n.args.length === 2 && simpleBase(n.args[1])) return `log_${toAscii(n.args[1])}(${toAscii(n.args[0])})`;
      return `log(${n.args.map(toAscii).join(', ')})`;
    case 'Delimiter': return `(${toAscii(n.args[0])})`;
    case 'System': return n.args.map(toAscii).join('; ');
    case 'Root': return `root(${toAscii(n.args[0])}, ${toAscii(n.args[1])})`;
    default: return `${FUNCTION_NAMES[n.op] ?? n.op}(${n.args.map(toAscii).join(', ')})`;
  }
}

function latexSymbol(name) {
  if (name === IMAGINARY) return '\\mathrm{i}';
  const [base, sub] = name.split('_');
  const b = GREEK.includes(base) ? `\\${base}` : base;
  return sub === undefined ? b : `${b}_{${sub}}`;
}

export function toLatex(n) {
  const sub = (c, i) => {
    const s = toLatex(c);
    return needsParens(c, n, i) ? `\\left(${s}\\right)` : s;
  };
  // Argumento de uma função f: "\sin x" ou "\sin\left(2x\right)".
  const sub2 = (f) => {
    const a = toLatex(f.args[0]);
    return needsParens(f.args[0], f, 0) ? `\\left(${a}\\right)` : ` ${a}`;
  };
  switch (n.op) {
    case 'Number': return n.value;
    case 'Symbol': return latexSymbol(n.name);
    case 'Equal': case 'NotEqual': case 'Less': case 'LessEqual': case 'Greater': case 'GreaterEqual':
      return `${toLatex(n.args[0])} ${LATEX_RELATIONS[n.op]} ${toLatex(n.args[1])}`;
    case 'Add':
      return n.args.map((c, i) => {
        if (i > 0 && c.op === 'Negate') return ' - ' + toLatex(c).slice(1);
        return (i > 0 ? ' + ' : '') + sub(c, i);
      }).join('');
    case 'Negate': return '-' + sub(n.args[0], 0);
    case 'Multiply':
      return n.args.map((c, i) => {
        const fractions = n.args[i - 1]?.op === 'Divide' && c.op === 'Divide';
        const sep = i === 0 ? '' : fractions || needsDot(n.args[i - 1], c, i, n) ? ' \\cdot ' : ' ';
        return sep + sub(c, i);
      }).join('');
    case 'Divide': return `\\frac{${toLatex(n.args[0])}}{${toLatex(n.args[1])}}`;
    case 'Power':
      if (isFunctionPower(n)) {
        const f = n.args[0];
        return `\\${FUNCTION_NAMES[f.op]}^{${n.args[1].value}}${sub2(f)}`;
      }
      return `${sub(n.args[0], 0)}^{${toLatex(n.args[1])}}`;
    case 'Sqrt': return `\\sqrt{${toLatex(n.args[0])}}`;
    case 'Root': return `\\sqrt[${toLatex(n.args[1])}]{${toLatex(n.args[0])}}`;
    case 'Abs': return `\\left|${toLatex(n.args[0])}\\right|`;
    case 'Conjugate': return `\\overline{${toLatex(n.args[0])}}`;
    case 'System': return `\\begin{cases} ${n.args.map(toLatex).join(' \\\\ ')} \\end{cases}`;
    case 'Real': return `\\operatorname{Re}\\left(${toLatex(n.args[0])}\\right)`;
    case 'Imaginary': return `\\operatorname{Im}\\left(${toLatex(n.args[0])}\\right)`;
    case 'Delimiter': return `\\left(${toLatex(n.args[0])}\\right)`;
    case 'Log':
      if (n.args.length === 2) return `\\log_{${toLatex(n.args[1])}}${sub2(n)}`;
      return `\\log${sub2(n)}`;
    default: {
      const name = FUNCTION_NAMES[n.op] ?? n.op;
      return `\\${name}${sub2(n)}`;
    }
  }
}
