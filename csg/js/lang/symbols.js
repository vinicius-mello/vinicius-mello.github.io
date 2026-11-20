// Single source of truth for the language's symbols.
// Used by the lexer (ASCII and \latex aliases), the editor (auto-replacement,
// palette) and the help page.
//
// sym:   canonical character
// ascii: plain-text spellings accepted by the lexer
// latex: names usable as \name (in source and as editor shortcuts)
// group: palette section; name: description shown in tooltips/help

export const SYMBOLS = [
  // definition / display
  { sym: '≔', ascii: [':='], latex: ['coloneq', 'def'], group: 'definição', name: 'definição' },
  { sym: '⊢', ascii: ['show'], latex: ['vdash', 'show'], group: 'definição', name: 'exibir' },
  { sym: '↦', ascii: ['->'], latex: ['mapsto', 'to'], group: 'definição', name: 'função anônima (x ↦ …)' },
  // sets
  { sym: '∪', ascii: ['\\/'], latex: ['cup', 'union'], group: 'conjuntos', name: 'união' },
  { sym: '∩', ascii: ['/\\'], latex: ['cap', 'inter'], group: 'conjuntos', name: 'interseção' },
  { sym: '∖', ascii: ['\\'], latex: ['setminus', 'diff'], group: 'conjuntos', name: 'diferença' },
  { sym: '△', ascii: [], latex: ['triangle', 'symdiff'], group: 'conjuntos', name: 'diferença simétrica' },
  { sym: '⊕', ascii: [], latex: ['oplus', 'minkowski'], group: 'conjuntos', name: 'soma de Minkowski' },
  { sym: '⋃', ascii: [], latex: ['bigcup'], group: 'conjuntos', name: 'união de uma família' },
  { sym: '⋂', ascii: [], latex: ['bigcap'], group: 'conjuntos', name: 'interseção de uma família' },
  { sym: '∅', ascii: ['empty'], latex: ['emptyset', 'empty', 'varnothing'], group: 'conjuntos', name: 'sólido vazio' },
  { sym: '∈', ascii: ['in'], latex: ['in'], group: 'conjuntos', name: 'pertence / percorre' },
  { sym: '∉', ascii: [], latex: ['notin'], group: 'conjuntos', name: 'não pertence' },
  // isometries / algebra
  { sym: '∘', ascii: ['@'], latex: ['circ', 'compose'], group: 'isometrias', name: 'composição' },
  { sym: '·', ascii: ['*'], latex: ['cdot'], group: 'isometrias', name: 'aplicação / produto' },
  { sym: '×', ascii: [], latex: ['times', 'cross'], group: 'isometrias', name: 'produto vetorial' },
  { sym: '⁻¹', ascii: ['^-1'], latex: ['inv'], group: 'isometrias', name: 'inversa' },
  { sym: '⟨', ascii: [], latex: ['langle'], group: 'isometrias', name: 'abre vetor' },
  { sym: '⟩', ascii: [], latex: ['rangle'], group: 'isometrias', name: 'fecha vetor' },
  // numbers
  { sym: 'Σ', ascii: [], latex: ['sum', 'Sigma'], group: 'números', name: 'somatório' },
  { sym: '∏', ascii: [], latex: ['prod'], group: 'números', name: 'produtório' },
  { sym: '√', ascii: [], latex: ['sqrt'], group: 'números', name: 'raiz quadrada' },
  { sym: '°', ascii: ['deg'], latex: ['deg', 'degree'], group: 'números', name: 'graus' },
  { sym: 'π', ascii: ['pi'], latex: ['pi'], group: 'números', name: 'pi' },
  { sym: 'τ', ascii: ['tau'], latex: ['tau'], group: 'números', name: 'tau = 2π' },
  { sym: '∞', ascii: ['inf'], latex: ['infty', 'inf'], group: 'números', name: 'infinito' },
  { sym: '²', ascii: ['^2'], latex: ['sq'], group: 'números', name: 'ao quadrado' },
  { sym: '⌊', ascii: [], latex: ['lfloor'], group: 'números', name: 'piso' },
  { sym: '⌋', ascii: [], latex: ['rfloor'], group: 'números', name: 'piso' },
  { sym: '⌈', ascii: [], latex: ['lceil'], group: 'números', name: 'teto' },
  { sym: '⌉', ascii: [], latex: ['rceil'], group: 'números', name: 'teto' },
  // logic / comparison
  { sym: '≠', ascii: ['!=', '/='], latex: ['ne', 'neq'], group: 'lógica', name: 'diferente' },
  { sym: '≤', ascii: ['<='], latex: ['le', 'leq'], group: 'lógica', name: 'menor ou igual' },
  { sym: '≥', ascii: ['>='], latex: ['ge', 'geq'], group: 'lógica', name: 'maior ou igual' },
  { sym: '∧', ascii: ['and', '&&'], latex: ['land', 'wedge', 'and'], group: 'lógica', name: 'e' },
  { sym: '∨', ascii: ['or', '||'], latex: ['lor', 'vee', 'or'], group: 'lógica', name: 'ou' },
  { sym: '¬', ascii: ['not', '!'], latex: ['neg', 'lnot', 'not'], group: 'lógica', name: 'não' },
];

// Greek letters usable in identifiers (\alpha → α). π and τ are listed above.
const GREEK = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ',
  eta: 'η', theta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ',
  rho: 'ρ', sigma: 'σ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
};

// \name → character, for both the lexer and the editor.
export const LATEX = new Map();
for (const s of SYMBOLS) for (const name of s.latex) LATEX.set(name, s.sym);
for (const [name, ch] of Object.entries(GREEK)) LATEX.set(name, ch);
// Subscripts, typed as \_0 … \_9.
'₀₁₂₃₄₅₆₇₈₉'.split('').forEach((ch, i) => LATEX.set(`_${i}`, ch));

export const SUPERSCRIPT_DIGITS = '⁰¹²³⁴⁵⁶⁷⁸⁹';
export const SUBSCRIPT_DIGITS = '₀₁₂₃₄₅₆₇₈₉';

// Editor auto-replacements of plain-text operators (applied while typing).
export const TYPING_REPLACEMENTS = [
  [':=', '≔'], ['->', '↦'], ['<=', '≤'], ['>=', '≥'], ['!=', '≠'], ['/=', '≠'],
];
