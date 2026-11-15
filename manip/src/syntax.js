// Sintaxe da entrada, para a aba "Sintaxe" da ajuda. Cada linha:
// [chave do texto em i18n.js, exemplo em ASCII, o mesmo em LaTeX]. O painel
// mostra também o exemplo desenhado, lido com o parser de verdade (um teste
// confere que todos os exemplos são aceitos). Uma definição (K := ...)
// aparece como a equação da aba que ela abre; uma hipótese, como ela mesma.

export const SYNTAX = [
  ['syntax.basic', [
    ['syntax.numbers', '2 + 3.5', '2 + 3.5'],
    ['syntax.ops', 'a - b*c/d', 'a - \\frac{b \\cdot c}{d}'],
    ['syntax.implicit', '2x y', '2xy'],
    ['syntax.power', 'x^2 + x^(n+1)', 'x^2 + x^{n+1}'],
    ['syntax.parens', '2(x + 1)', '2\\left(x + 1\\right)'],
    ['syntax.sub', 'x_1 + a_n + a_(n-1)', 'x_1 + a_{n} + a_{n-1}'],
    ['syntax.greek', 'alpha + pi', '\\alpha + \\pi'],
    ['syntax.relations', 'x <= 3', 'x \\le 3'],
    ['syntax.system', 'x + y = 3; x - y = 1', '\\begin{cases} x + y = 3 \\\\ x - y = 1 \\end{cases}'],
    ['syntax.define', 'K := x^2 + 1', 'K \\coloneqq x^2 + 1'],
  ]],
  ['syntax.functions', [
    ['syntax.sqrt', 'sqrt(x) + root(x, 3)', '\\sqrt{x} + \\sqrt[3]{x}'],
    ['syntax.abs', '|x - 1|', '\\left|x - 1\\right|'],
    ['syntax.trig', 'sen x + cos(2x) + tg x', '\\sin x + \\cos\\left(2x\\right) + \\tan x'],
    ['syntax.trigpow', 'sin^2 x', '\\sin^2 x'],
    ['syntax.arc', 'arcsin x + arctan x', '\\arcsin x + \\arctan x'],
    ['syntax.hyp', 'sinh x + cosh x', '\\sinh x + \\cosh x'],
    ['syntax.logs', 'ln x + log x + log_2 x', '\\ln x + \\log x + \\log_2 x'],
    ['syntax.exp', 'e^x + exp(x)', 'e^x + \\exp x'],
    ['syntax.complex', 'conj(z) + re(z) + im(z) + 3i', '\\overline{z} + \\operatorname{Re}\\left(z\\right) + \\operatorname{Im}\\left(z\\right) + 3\\mathrm{i}'],
    ['syntax.userfn', "f(x) + g(x + 1) + f'(x)", "f(x) + g(x + 1) + f'(x)"],
  ]],
  ['syntax.sums', [
    ['syntax.factorial', 'n! + binom(n, k)', 'n! + \\binom{n}{k}'],
    ['syntax.sum', 'sum_(k=1)^n k^2', '\\sum_{k=1}^{n} k^2'],
    ['syntax.prod', 'prod_(k=1)^n k', '\\prod_{k=1}^{n} k'],
    ['syntax.dots', 'a(b_1 + ... + b_n)', 'a\\left(b_{1} + \\cdots + b_{n}\\right)'],
  ]],
  ['syntax.matrices', [
    ['syntax.matrix', '[1, 2; 3, 4]', '\\begin{bmatrix} 1 & 2 \\\\ 3 & 4 \\end{bmatrix}'],
    ['syntax.inverse', '[1, 2; 3, 4]^(-1) + Id', '\\begin{bmatrix} 1 & 2 \\\\ 3 & 4 \\end{bmatrix}^{-1} + \\mathrm{I}'],
    ['syntax.vector', '(1, 2, 3) + vec v', '\\left(1, 2, 3\\right) + \\vec{v}'],
    ['syntax.cross', '(1, 0)*(2, 3) + vec u × vec v + |vec v|', '\\left(1, 0\\right) \\cdot \\left(2, 3\\right) + \\vec{u} \\times \\vec{v} + \\left|\\vec{v}\\right|'],
    ['syntax.det', '|a, b; c, d| + det A', '\\begin{vmatrix} a & b \\\\ c & d \\end{vmatrix} + \\det A'],
  ]],
  ['syntax.hyps', [
    ['syntax.hypMatrix', 'A, B in M(2, 3)', 'A, B \\in M_{2\\times 3}'],
    ['syntax.hypVector', 'v in R^3', 'v \\in \\mathbb{R}^3'],
    ['syntax.hypSet', 'n in N', 'n \\in \\mathbb{N}'],
    ['syntax.hypSign', 'seja x > 0', 'seja x > 0'],
  ]],
  ['syntax.calculus', [
    ['syntax.limit', 'lim_(x->0) sin(x)/x', '\\lim_{x \\to 0} \\frac{\\sin x}{x}'],
    ['syntax.side', 'lim_(x->0^+) 1/x', '\\lim_{x \\to 0^{+}} \\frac{1}{x}'],
    ['syntax.infinity', 'lim_(x->oo) 1/x', '\\lim_{x \\to \\infty} \\frac{1}{x}'],
    ['syntax.deriv', 'd/dx (x^2 + 1)', '\\frac{d}{dx}\\left(x^2 + 1\\right)'],
    ['syntax.deriv2', "d^2/dx^2 y + y''", "\\frac{d^2y}{dx^2} + y''"],
    ['syntax.int', 'int x^2 dx', '\\int x^2 \\, dx'],
    ['syntax.intdef', 'int_0^1 x^2 dx', '\\int_0^1 x^2 \\, dx'],
    ['syntax.evalat', '[x^3/3]_0^1', '\\left. \\frac{x^3}{3} \\right|_0^1'],
  ]],
];
