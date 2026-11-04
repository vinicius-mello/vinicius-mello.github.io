// Um exemplo para cada operação, usado na folha de atalhos: a operação é
// aplicada de verdade, e a folha mostra antes → depois. Um teste confere
// que todos continuam funcionando.
//   src: equação em ASCII · focus: caminho do foco · sel: seleção (opcional)
//   input: texto digitado (operações que pedem texto)

export const EXAMPLES = {
  calc: { src: 'x = 7 - 3', focus: [1] },
  like: { src: 'x = 2a + 3a', focus: [1, 0] },
  cancel: { src: 'x + 3 - 3 = 5', focus: [0, 1] },
  neutral: { src: 'x + 0 = y', focus: [0, 1] },
  signs: { src: 'x = a - (-b)', focus: [1, 1] },
  flipsigns: { src: '2(x - 1) = 4', focus: [0] },
  dist: { src: '2(x + 1) = 4', focus: [0] },
  factor: { src: '1 - a - b + a*b = 0', focus: [0, 0], sel: [[0, 2], [0, 3, 1]] },
  wrap: { src: 'a + b + c = 0', focus: [0, 1], sel: [[0, 1], [0, 2]] },
  parens: { src: 'a + (b + c) = 0', focus: [0, 1] },
  group: { src: 'a + b + c = 0', focus: [0, 1], sel: [[0, 1], [0, 2]] },
  addsub: { src: 'x^2 + 6x = 7', focus: [0], input: '9' },
  subst: { src: 'x + y = 10', focus: [0, 1], input: '2x' },
  join: { src: 'x/2 + y/2 = 1', focus: [0] },
  expandfrac: { src: 'x = 1/2', focus: [1], input: '3' },
  powers: { src: 'x^2 x^3 = 1', focus: [0] },
  binomial: { src: '(a + b)^3 = 0', focus: [0] },
  conj: { src: 'w = conj(a b)', focus: [1] },
  dconj: { src: 'w = conj(conj(z))', focus: [1] },
  conjprod: { src: 'w = z conj(z)', focus: [1] },
  conjsum: { src: 'w = z + conj(z)', focus: [1] },
  timesconj: { src: 'w = 1/(3 + 4i)', focus: [1] },
  sides: { src: '2x = 4', focus: [], input: '/ 2' },
  swap: { src: 'x < 4', focus: [] },
  estimate: { src: 'y = x^2 + 1', focus: [], input: '>= 1' },
  addeq: { src: 'x + y = 3; x - y = 1', focus: [1], sel: [[0], [1]] },
  subeq: { src: 'x + y = 3; x - y = 1', focus: [1], sel: [[0], [1]] },
  substsys: { src: 'y = 2x + 1; x + y = 7', focus: [0] },
  name: { src: '2(x + 1) = y', focus: [0, 1], input: 'K' },
  // expand e open dependem de um nome já definido: sem exemplo.
};

// Monta o contexto de uma regra a partir do exemplo.
export function exampleContext(ex, tree) {
  return {
    tree,
    focus: ex.focus,
    targets: ex.sel?.length ? ex.sel : [ex.focus],
    input: ex.input,
    definitions: {},
  };
}
