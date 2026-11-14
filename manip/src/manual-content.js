// Manual do Manip (manual.html), em português e inglês. Só dados: texto e exemplos. Cada exemplo é aplicado
// pela regra de verdade (runExample), e um teste confere que todos valem;
// assim o manual não mostra nada que o app não faça.

import { parseAscii } from './parse-ascii.js';
import { RULES } from './rules/index.js';

const L = (pt, en) => ({ pt, en });

// Nomes como o app os vê: símbolos com o nome de uma definição são chips.
function chips(tree, names) {
  return JSON.parse(JSON.stringify(tree), (k, v) => (v?.op === 'Symbol' && names.includes(v.name) ? { ...v, named: true } : v));
}

export function definitionsOf(defs = {}) {
  const names = Object.keys(defs);
  return Object.fromEntries(names.map((n) => [n, chips(parseAscii(defs[n]), names)]));
}

export const readWith = (src, defs = {}) => chips(parseAscii(src), Object.keys(defs));

// Aplica a regra do exemplo a `tree` (ou ao src). Devolve antes, depois e o rótulo do passo.
export function runExample(ex, tree = readWith(ex.src, ex.defs)) {
  const rule = RULES.find((r) => r.id === ex.rule);
  const ctx = {
    tree,
    focus: ex.focus ?? [],
    targets: ex.sel ?? [ex.focus ?? []],
    input: ex.input,
    definitions: definitionsOf(ex.defs),
  };
  const r = rule.all ? rule.all(ctx)[ex.form ?? 0] : rule.run(ctx);
  return { before: tree, result: r };
}

const K = { K: 'x^2 + 1' };
const KM = { K: 'x^2 + 1', M: 'x^2 y + sin(x)' };

export const TITLE = L('Manip — manual', 'Manip — user manual');
export const SUBTITLE = L(
  'Manipulação algébrica visual de equações, pelo teclado, pensada para professores. Este manual descreve toda a aplicação; os exemplos foram calculados pelo próprio Manip.',
  'Visual, keyboard-driven algebraic manipulation of equations, designed for teachers. This manual covers the whole application; the examples were computed by Manip itself.',
);

// Blocos: [tipo, conteúdo, (linhas)]. Texto entre `crases` vira código e
// entre **asteriscos** fica em negrito.
export const MANUAL = [
  ['toc'],

  ['h2', L('1. Introdução', '1. Introduction')],
  ['p', L(
    'O Manip é uma ferramenta para mostrar, passo a passo e com animação, como uma equação se transforma. O professor digita uma equação (ou inequação, sistema, ou expressão solta) e a manipula pelo teclado: move termos de um lado para o outro, distribui, põe em evidência, junta frações, completa quadrados, deriva, integra…',
    'Manip is a tool to show, step by step and with animation, how an equation is transformed. The teacher types an equation (or an inequality, a system, or a bare expression) and manipulates it from the keyboard: moving terms from one side to the other, distributing, factoring out, joining fractions, completing squares, differentiating, integrating…',
  )],
  ['ul', [
    L('**Nada é simplificado automaticamente.** Cada passo é uma escolha explícita, com a sua justificativa (“distribuiu”, “regra da cadeia”…), e fica registrado no histórico.', '**Nothing is simplified automatically.** Each step is an explicit choice, with its justification (“distributed”, “chain rule”…), and is recorded in the history.'),
    L('**Cada passo é animado:** um termo que muda de lado “pula” o sinal de igual, termos que se juntam se fundem, o que se cancela é riscado. As animações ficam gravadas e se repetem ao percorrer os passos ou na apresentação.', '**Every step is animated:** a term that changes sides “jumps” over the equals sign, terms that combine merge, cancelled things are struck out. The animations are stored and replayed when going through the steps or in the presentation.'),
    L('**Tudo pelo teclado:** letras minúsculas, dígitos e símbolos aplicam operações; maiúsculas (com Shift) são comandos da interface.', '**Everything from the keyboard:** lowercase letters, digits and symbols apply operations; uppercase letters (with Shift) are interface commands.'),
  ]],
  ['p', L(
    'O Manip roda no navegador, sem instalação: <https://vinicius-mello.github.io/manip/>. O trabalho é salvo sozinho no navegador e reaparece ao reabrir a página; para guardar ou levar para outro computador, use um arquivo .json (capítulo 14).',
    'Manip runs in the browser, with nothing to install: <https://vinicius-mello.github.io/manip/>. Your work is saved automatically in the browser and comes back when the page is reopened; to keep it or move it to another computer, use a .json file (chapter 14).',
  )],

  ['h2', L('2. A tela', '2. The screen')],
  ['table', [L('Parte', 'Part'), L('Para que serve', 'What it is for')], [
    [L('Campo de entrada', 'Input field'), L('no alto: digite a equação e tecle Enter (capítulo 3)', 'at the top: type the equation and press Enter (chapter 3)')],
    [L('Teclado', 'Keyboard'), L('mostra o teclado matemático na tela (também a tecla K)', 'shows the on-screen math keyboard (also the K key)')],
    [L('Ajustes', 'Settings'), L('velocidade da animação, tema, expressões longas e idioma (capítulo 15)', 'animation speed, theme, long expressions and language (chapter 15)')],
    [L('Exportar', 'Export'), L('copiar texto, LaTeX ou MathJSON, salvar e abrir arquivos, gravar vídeo (capítulos 13 e 14)', 'copy text, LaTeX or MathJSON, save and open files, record video (chapters 13 and 14)')],
    [L('Ajuda', 'Help'), L('atalhos e sintaxe completa da entrada (também a tecla ?)', 'shortcuts and full input syntax (also the ? key)')],
    [L('Palco', 'Stage'), L('a fórmula, com o foco (contorno) e a seleção (fundo amarelo)', 'the formula, with the focus (outline) and the selection (yellow background)')],
    [L('Abas', 'Tabs'), L('acima do palco, quando há nomes: a Principal e uma por nome (capítulo 10)', 'above the stage, when there are names: Main and one per name (chapter 10)')],
    [L('Nomes', 'Names'), L('ao lado: cada nome com a sua definição atual', 'on the side: each name with its current definition')],
    [L('Passos', 'Steps'), L('ao lado: o histórico, com a justificativa e a nota de cada passo (capítulo 11)', 'on the side: the history, with the justification and note of each step (chapter 11)')],
    [L('Rodapé', 'Footer'), L('lembrete das teclas principais', 'reminder of the main keys')],
  ]],
  ['p', L(
    'As teclas valem quando o palco tem o foco do teclado (clique na fórmula, ou tecle Enter no campo de entrada). Esc no campo de entrada volta para o palco.',
    'Keys work when the stage has keyboard focus (click the formula, or press Enter in the input field). Esc in the input field goes back to the stage.',
  )],

  ['h2', L('3. Digitar uma expressão', '3. Typing an expression')],
  ['p', L(
    'Digite no campo de entrada e tecle Enter. O formato é detectado sozinho: ASCII (`2x + 3 = 7`) ou LaTeX (`\\frac{1}{2}`). O que pode ser digitado:',
    'Type in the input field and press Enter. The format is detected automatically: ASCII (`2x + 3 = 7`) or LaTeX (`\\frac{1}{2}`). What you can type:',
  )],
  ['ul', [
    L('uma **equação** (`2x + 3 = 7`) ou **inequação** (`x^2 - 1 < 0`, também `<=`, `>`, `>=`, `!=`);', 'an **equation** (`2x + 3 = 7`) or **inequality** (`x^2 - 1 < 0`, also `<=`, `>`, `>=`, `!=`);'),
    L('um **sistema**, com as equações separadas por `;` (`x + y = 3; x - y = 1`);', 'a **system**, with the equations separated by `;` (`x + y = 3; x - y = 1`);'),
    L('uma **expressão solta** (`(a + b)^2`), para simplificar ou fatorar;', 'a **bare expression** (`(a + b)^2`), to simplify or factor;'),
    L('uma **definição auxiliar** (`K := x^2 + 1`), que abre uma aba para o nome (capítulo 10).', 'an **auxiliary definition** (`K := x^2 + 1`), which opens a tab for the name (chapter 10).'),
  ]],
  ['p', L(
    'Na aba Principal, o texto digitado começa um problema novo; na aba de um nome, vira um novo passo daquela equação. Se houver erro, a mensagem aparece ao lado do campo e o trecho com problema fica selecionado. A fórmula fica exatamente como foi digitada: até os parênteses são preservados.',
    'In the Main tab, the typed text starts a new problem; in a name’s tab, it becomes a new step of that equation. If there is an error, the message appears next to the field and the offending part is selected. The formula stays exactly as typed: even parentheses are kept.',
  )],
  ['p', L(
    'A tecla **E** copia a fórmula atual para o campo de entrada, para editá-la; **K** (ou o botão Teclado) mostra um teclado matemático na tela, útil em telas de toque e lousas digitais.',
    'The **E** key copies the current formula to the input field so you can edit it; **K** (or the Keyboard button) shows an on-screen math keyboard, handy on touch screens and interactive whiteboards.',
  )],
  ['h3', L('Sintaxe', 'Syntax')],
  ['syntax'],

  ['h2', L('4. Navegar e selecionar', '4. Navigating and selecting')],
  ['p', L(
    'A fórmula é uma árvore: a equação contém os dois lados, uma soma contém os termos, um produto os fatores, e assim por diante. O **foco** (o contorno) marca o nó sobre o qual as operações agem.',
    'The formula is a tree: the equation contains the two sides, a sum contains its terms, a product its factors, and so on. The **focus** (the outline) marks the node the operations act on.',
  )],
  ['table', [L('Tecla', 'Key'), L('Ação', 'Action')], [
    ['← →', L('irmão anterior / seguinte (sem irmão, passa ao vizinho mais próximo na mesma profundidade)', 'previous / next sibling (with no sibling, moves to the nearest neighbor at the same depth)')],
    ['↑ ↓', L('sobe para o nó que contém o foco / desce para dentro dele', 'goes up to the node containing the focus / down into it')],
    [L('clique', 'click'), L('põe o foco no que foi clicado', 'puts the focus on what was clicked')],
    ['Shift + ← →', L('estende a seleção aos vizinhos (como num editor de texto)', 'extends the selection to the neighbors (as in a text editor)')],
    [L('Espaço', 'Space'), L('marca ou desmarca o foco na seleção (seleção salteada)', 'adds the focus to or removes it from the selection (non-contiguous selection)')],
    ['Esc', L('limpa a seleção (na apresentação, sai dela)', 'clears the selection (in presentation mode, leaves it)')],
  ]],
  ['p', L(
    'A seleção serve às operações que agem sobre várias partes: agrupar termos, cancelar fatores em cima e embaixo, somar duas equações, dar nome a vários termos de uma soma… Sem seleção, as operações agem sobre o foco.',
    'The selection is used by operations that act on several parts: grouping terms, cancelling factors above and below, adding two equations, naming several terms of a sum… Without a selection, operations act on the focus.',
  )],

  ['h2', L('5. Mover termos', '5. Moving terms')],
  ['p', L(
    'Com **Ctrl + ← →** (ou Alt + ← →, já que no macOS Ctrl + setas troca de mesa), o termo em foco troca de lugar com o vizinho. Na borda do seu lado, ele **passa para o outro lado** da relação, como o professor faria no quadro:',
    'With **Ctrl + ← →** (or Alt + ← →, since on macOS Ctrl + arrows switches desktops), the focused term swaps places with its neighbor. At the edge of its side, it **moves to the other side** of the relation, as a teacher would do on the board:',
  )],
  ['ul', [
    L('um **termo** de uma soma passa com o sinal trocado (2x + 3 = 7 → 2x = 7 − 3);', 'a **term** of a sum goes across with the opposite sign (2x + 3 = 7 → 2x = 7 − 3);'),
    L('um **fator** de um produto passa dividindo (2x = 4 → x = 4/2);', 'a **factor** of a product goes across dividing (2x = 4 → x = 4/2);'),
    L('um **denominador** passa multiplicando (x/3 = 2 → x = 2·3);', 'a **denominator** goes across multiplying (x/3 = 2 → x = 2·3);'),
    L('um **lado inteiro** passa e deixa 0 no lugar.', 'a **whole side** goes across and leaves 0 behind.'),
  ]],
  ['p', L(
    'Numa inequação, multiplicar ou dividir só é aceito por número diferente de zero; por um número negativo, o sentido da desigualdade inverte; por uma letra (de sinal desconhecido), o movimento é recusado com uma explicação. **Ctrl + ↑** tira o termo de dentro do grupo (parênteses) e o põe logo depois dele; **Ctrl + ↓** o coloca dentro do grupo vizinho.',
    'In an inequality, multiplying or dividing is only accepted by a nonzero number; by a negative number, the inequality flips; by a letter (of unknown sign), the move is refused with an explanation. **Ctrl + ↑** takes the term out of its group (parentheses) and places it right after it; **Ctrl + ↓** puts it into the neighboring group.',
  )],

  ['h2', L('6. Operações', '6. Operations')],
  ['p', L('Há duas maneiras de aplicar uma operação ao foco (ou à seleção):', 'There are two ways to apply an operation to the focus (or the selection):')],
  ['ul', [
    L('**tecla direta:** cada operação tem uma tecla (minúscula, dígito ou símbolo), que vale direto na fórmula;', '**direct key:** each operation has a key (lowercase letter, digit or symbol), which works directly on the formula;'),
    L('**menu (Enter):** lista só as operações que se aplicam ali, agrupadas por assunto, com a prévia do resultado. Setas escolhem, Enter aplica, a tecla da operação também vale, e `/` abre uma busca pelo nome (sem acentos: “potencia” acha “Potências”).', '**menu (Enter):** lists only the operations that apply there, grouped by subject, with a preview of the result. Arrows choose, Enter applies, the operation’s key also works, and `/` opens a search by name.'),
  ]],
  ['p', L(
    'Algumas operações pedem um texto (os nomes terminam em “…”): um campo se abre, já com uma sugestão quando há uma; Enter aplica e Esc cancela. Se a operação não se aplica, um aviso explica por quê.',
    'Some operations ask for text (their names end in “…”): a field opens, with a suggestion when there is one; Enter applies and Esc cancels. If the operation does not apply, a message explains why.',
  )],
  ['h4', L('Equivalências nos dois sentidos', 'Equivalences in both directions')],
  ['p', L(
    'Muitas teclas valem nos dois sentidos (`j` junta ou separa frações, `^` junta ou separa potências…): o app escolhe pela forma do que está em foco. Quando há mais de uma forma possível, a tecla aplica a primeira e, repetida logo em seguida, troca o passo pela próxima. No menu, cada forma aparece como um item.',
    'Many keys work in both directions (`j` joins or splits fractions, `^` joins or splits powers…): the app picks by the shape of what is focused. When several forms are possible, the key applies the first one and, pressed again right away, replaces the step with the next. In the menu, each form shows up as an item.',
  )],
  ['h4', L('“usando A = B”', '“using A = B”')],
  ['p', L(
    'As operações reconhecem o padrão também quando ele está escrito de outro jeito equivalente como polinômio (`ab + ba` → `2ab`). Nesse caso o passo mostra a igualdade usada (“usando ba = ab”), e o professor decide se reorganiza antes.',
    'Operations also recognize a pattern when it is written in another polynomially equivalent way (`ab + ba` → `2ab`). In that case the step shows the equality used (“using ba = ab”), and the teacher decides whether to reorder first.',
  )],
  ['h4', L('Passo livre e substituir', 'Free step and substitute')],
  ['p', L(
    '**`o` passo livre:** digite a nova forma do foco, como no quadro; o app confere numericamente. Numa expressão, confere que o valor é o mesmo em vários pontos (e mostra um contraexemplo se não for); numa equação, que a nova é proporcional à original (vale mover termos, trocar os lados e multiplicar por número); numa inequação, que o sentido está certo. Quando não dá para calcular, o passo fica marcado “não conferida”.',
    '**`o` free step:** type the new form of the focus, as on the board; the app checks it numerically. For an expression, it checks that the value is the same at several points (and shows a counterexample otherwise); for an equation, that the new one is proportional to the original (moving terms, swapping sides and multiplying by a number are fine); for an inequality, that the direction is right. When it cannot compute, the step is marked “not checked”.',
  )],
  ['p', L(
    '**`s` substituir:** troca a seleção pelo que for digitado, sem conferir. É o passo “pela definição” ou “pelo dado do problema”: a equivalência é responsabilidade de quem usa.',
    '**`s` substitute:** replaces the selection with what you type, without checking. It is the step “by definition” or “by the given data”: equivalence is the user’s responsibility.',
  )],
  ['h3', L('Todas as operações', 'All operations')],
  ['p', L(
    'A seguir, cada grupo com as suas operações, a tecla e um exemplo (antes → depois). Os exemplos foram aplicados pela própria operação.',
    'Below, each group with its operations, the key and an example (before → after). The examples were applied by the operation itself.',
  )],
  ['ops', 'arith', L('Contas com números (`c` também decompõe um número em fatores primos), termos semelhantes, cancelamentos, elementos neutros e sinais.', 'Arithmetic (`c` also breaks a number into prime factors), like terms, cancellations, neutral elements and signs.')],
  ['ops', 'structure', L('A forma da expressão: distribuir, pôr em evidência, parênteses, agrupar, completar quadrados (`q` soma e subtrai a mesma quantidade, e sugere a que completa o quadrado), passo livre e substituição.', 'The shape of the expression: distributing, factoring out, parentheses, grouping, completing squares (`q` adds and subtracts the same amount, and suggests the one that completes the square), free step and substitution.')],
  ['ops', 'fractions', L('Juntar e separar frações e multiplicar em cima e embaixo (o campo sugere o fator que racionaliza, como √2 ou 1 − √2).', 'Joining and splitting fractions and multiplying above and below (the field suggests the rationalizing factor, such as √2 or 1 − √2).')],
  ['ops', 'powers', L('Propriedades de potências e raízes, produtos notáveis e o binômio de Newton.', 'Properties of powers and roots, special products and the binomial theorem.')],
  ['ops', 'functions', L('Logaritmos e exponenciais; valores notáveis e identidades trigonométricas (nos dois sentidos).', 'Logarithms and exponentials; special values and trigonometric identities (in both directions).')],
  ['ops', 'sums', L('Fatorial, número binomial, somatórios e produtórios, reticências (capítulo 9).', 'Factorial, binomial coefficient, sums and products, ellipses (chapter 9).')],
  ['ops', 'calculus', L('Derivadas, derivada parcial, limites e integrais (capítulo 8).', 'Derivatives, partial derivative, limits and integrals (chapter 8).')],
  ['ops', 'complex', L('Números complexos: a aritmética com i é exata, e há operações para o conjugado e o módulo.', 'Complex numbers: arithmetic with i is exact, and there are operations for the conjugate and the modulus.')],
  ['ops', 'relation', L('Operações sobre a equação ou inequação inteira (capítulo 7).', 'Operations on the whole equation or inequality (chapter 7).')],
  ['ops', 'system', L('Sistemas de equações (capítulo 7).', 'Systems of equations (chapter 7).')],
  ['ops', 'names', L('Nomes e áreas de trabalho (capítulo 10). Expandir e a busca reversa dependem de um nome já definido.', 'Names and workspaces (chapter 10). Expanding and reverse lookup need a name that is already defined.')],

  ['h2', L('7. Equações, inequações e sistemas', '7. Equations, inequalities and systems')],
  ['p', L(
    '**`=` operar nos dois lados:** digite um operador seguido de uma expressão: `+ 3`, `- x`, `* 2` (ou `· 2`), `/ (x + 1)`, `^ 2`. A operação é escrita nos dois lados, sem fazer as contas. Numa inequação, multiplicar ou dividir segue as regras do capítulo 5.',
    '**`=` operate on both sides:** type an operator followed by an expression: `+ 3`, `- x`, `* 2` (or `· 2`), `/ (x + 1)`, `^ 2`. The operation is written on both sides, without doing the arithmetic. In an inequality, multiplying or dividing follows the rules of chapter 5.',
  )],
  ['p', L(
    '**`t` trocar os lados:** A = B → B = A; numa inequação, o sentido acompanha (x < 4 → 4 > x).',
    '**`t` swap sides:** A = B → B = A; in an inequality, the direction follows (x < 4 → 4 > x).',
  )],
  ['p', L(
    '**`i` estimar:** troca um dos lados por uma estimativa: “<= C” troca o lado direito (A = B → A ≤ C), “C <=” troca o esquerdo. É o passo das demonstrações com desigualdades; a estimativa é responsabilidade do professor.',
    '**`i` estimate:** replaces one side with an estimate: “<= C” replaces the right side (A = B → A ≤ C), “C <=” the left one. It is the step of proofs with inequalities; the estimate is the teacher’s responsibility.',
  )],
  ['p', L(
    '**Sistemas:** digite as equações separadas por `;`. Os movimentos e operações agem dentro da equação em foco. Para combinar equações, selecione duas (Espaço) e use `+` (somar) ou `-` (subtrair): o resultado substitui a segunda. Com o foco numa equação da forma “variável = expressão”, `>` substitui a variável nas outras equações.',
    '**Systems:** type the equations separated by `;`. Moves and operations act inside the focused equation. To combine equations, select two (Space) and use `+` (add) or `-` (subtract): the result replaces the second one. With the focus on an equation of the form “variable = expression”, `>` substitutes the variable into the other equations.',
  )],

  ['h2', L('8. Cálculo', '8. Calculus')],
  ['p', L(
    'As regras de cálculo seguem o mesmo princípio: uma camada por vez, nada calculado sozinho. A regra da cadeia, por exemplo, deixa d/dx u por fazer.',
    'The calculus rules follow the same principle: one layer at a time, nothing computed by itself. The chain rule, for instance, leaves d/dx u to be done.',
  )],
  ['h4', L('Derivadas (tecla \')', 'Derivatives (key \')')],
  ['p', L(
    'Linearidade (nos dois sentidos), constante para fora ↔ para dentro, potência, produto, quociente, cadeia, exponencial, tabela (sen, cos, tg, ln, log, √, arcos, hiperbólicas…), f(x) → f′(x) ↔ d/dx f(x), ordem superior e a definição pelo limite. Fora de uma derivada, a mesma tecla deriva parcialmente em relação a uma variável (capítulo 10).',
    'Linearity (both directions), constant out ↔ in, power, product, quotient, chain, exponential, table (sin, cos, tan, ln, log, √, inverse and hyperbolic functions…), f(x) → f′(x) ↔ d/dx f(x), higher order and the limit definition. Outside a derivative, the same key takes a partial derivative with respect to a variable (chapter 10).',
  )],
  ['h4', L('Limites (tecla a)', 'Limits (key a)')],
  ['p', L(
    'Substituição direta (recusada em 0/0, divisão por zero e pontos infinitos), limite de constante, propriedades (soma, constante, produto, quociente com denominador ≠ 0, potência), limites notáveis (sen u/u, (eᵘ − 1)/u, (1 + k/x)ˣ → eᵏ…), c/xⁿ → 0 no infinito, L’Hôpital em 0/0 e ∞/∞ (deixa as derivadas por fazer), troca de variável (x = a + h, x = 1/t) e lim (f(x + h) − f(x))/h → d/dx f.',
    'Direct substitution (refused for 0/0, division by zero and infinite points), limit of a constant, properties (sum, constant, product, quotient with nonzero denominator, power), special limits (sin u/u, (eᵘ − 1)/u, (1 + k/x)ˣ → eᵏ…), c/xⁿ → 0 at infinity, L’Hôpital for 0/0 and ∞/∞ (leaving the derivatives to be done), change of variable (x = a + h, x = 1/t) and lim (f(x + h) − f(x))/h → d/dx f.',
  )],
  ['h4', L('Integrais (tecla u)', 'Integrals (key u)')],
  ['p', L(
    'Tabela de primitivas, linearidade nos dois sentidos, ∫ₐᵇ f → [F]ₐᵇ → F(b) − F(a), ∫ₐᵃ = 0 e juntar intervalos. O `+ C` só aparece quando não sobra nenhuma integral indefinida naquele lado. Sem nenhuma dessas formas, `u` pede a substituição `u = g(x)` (conferida numericamente; na integral definida, os limites viram g(a) e g(b)). No menu há ainda a integração por partes (`u = …`, ∫ u dv = uv − ∫ v du), inverter os limites e a soma de Riemann. A derivada de ∫ₐ^g(x) f(t) dt sai pelo teorema fundamental (tecla \').',
    'Table of antiderivatives, linearity in both directions, ∫ₐᵇ f → [F]ₐᵇ → F(b) − F(a), ∫ₐᵃ = 0 and joining intervals. The `+ C` only appears once no indefinite integral is left on that side. With none of these forms, `u` asks for the substitution `u = g(x)` (checked numerically; in a definite integral, the limits become g(a) and g(b)). The menu also has integration by parts (`u = …`, ∫ u dv = uv − ∫ v du), swapping the limits and the Riemann sum. The derivative of ∫ₐ^g(x) f(t) dt comes from the fundamental theorem (key \').',
  )],

  ['h2', L('9. Somatórios e reticências', '9. Sums and ellipses')],
  ['p', L(
    'Somatórios (`sum_(k=1)^n k^2`) e produtórios (`prod_(k=1)^n k`) têm as suas regras na tecla `m`: escrever os termos, fórmulas (Σk, Σk², Σk³, PG, ΣC(n, k) = 2ⁿ, Πk = n!), termo constante, constante para fora ↔ para dentro, Σ(f + g) ↔ Σf + Σg, telescópica, separar o último ou o primeiro termo ↔ incluir, juntar intervalos e deslocar o índice. Com limites numéricos, `c` calcula.',
    'Sums (`sum_(k=1)^n k^2`) and products (`prod_(k=1)^n k`) have their rules on the `m` key: writing out the terms, formulas (Σk, Σk², Σk³, geometric, ΣC(n, k) = 2ⁿ, Πk = n!), constant term, constant out ↔ in, Σ(f + g) ↔ Σf + Σg, telescoping, splitting off the last or first term ↔ including it, joining ranges and shifting the index. With numeric limits, `c` computes.',
  )],
  ['p', L(
    'Reticências em somas e produtos (`a + ... + c`, LaTeX `\\cdots`) também são aceitas. As operações termo a termo passam pelo `…` (a(b + … + c) = ab + … + ac, ln(a·…·c) = ln a + … + ln c, derivada, integral e limite de f + … + g), e nenhum movimento separa o `…` do termo ao lado dele. Com `m`, o app deduz o termo geral (1 + 2 + … + n, a₁ + a₂ + … + aₙ, 1 + r + … + rⁿ, 1 + 1/2 + 1/3 + …) e passa para Σ e de volta, escreve mais um termo ou o penúltimo, mostra o termo geral, inverte a ordem e soma duas sequências termo a termo — a soma de Gauss: 2S = (n + 1) + … + (n + 1) = n(n + 1).',
    'Ellipses in sums and products (`a + ... + c`, LaTeX `\\cdots`) are accepted too. Term-by-term operations pass through the `…` (a(b + … + c) = ab + … + ac, ln(a·…·c) = ln a + … + ln c, derivative, integral and limit of f + … + g), and no move separates the `…` from the term next to it. With `m`, the app deduces the general term (1 + 2 + … + n, a₁ + a₂ + … + aₙ, 1 + r + … + rⁿ, 1 + 1/2 + 1/3 + …) and goes to Σ and back, writes one more term or the second-to-last, shows the general term, reverses the order and adds two sequences term by term — Gauss’s sum: 2S = (n + 1) + … + (n + 1) = n(n + 1).',
  )],

  ['h2', L('10. Nomes, definições e derivadas parciais', '10. Names, definitions and partial derivatives')],
  ['p', L(
    'Um nome (K, A_1, b_n…) representa uma expressão. Ele aparece na fórmula como um chip colorido e tem a sua própria aba (área de trabalho), onde fica a equação “nome = definição”. A definição atual de um nome é sempre o outro lado dessa equação: se você manipular a equação na aba do nome, a definição muda junto.',
    'A name (K, A_1, b_n…) stands for an expression. It shows up in the formula as a colored chip and has its own tab (workspace) holding the equation “name = definition”. The current definition of a name is always the other side of that equation: if you manipulate the equation in the name’s tab, the definition changes with it.',
  )],
  ['h3', L('Nomes e abas', 'Names and tabs')],
  ['p', L(
    'Com o foco numa subexpressão, a tecla `n` pede um nome: uma letra, com subscrito opcional (K, A_1, b_n), que ainda não esteja definido. A subexpressão vira o chip e o nome ganha a sua aba.',
    'With the focus on a subexpression, the `n` key asks for a name: one letter with an optional subscript (K, A_1, b_n) that is not defined yet. The subexpression becomes the chip and the name gets its own tab.',
  )],
  ['ex', { rule: 'name', src: '2(x + 1) = y', focus: [0, 1], input: 'K',
    note: L('foco em x + 1, digitado “K”; a aba K recebe a equação K = x + 1', 'focus on x + 1, typed “K”; tab K gets the equation K = x + 1') }],
  ['table', [L('Tecla', 'Key'), L('Num chip K', 'On a chip K')], [
    ['n', L('expande: troca K pela definição atual', 'expands: replaces K with its current definition')],
    ['w', L('abre a aba de K', 'opens the tab of K')],
    ['Tab / Shift+Tab', L('passa para a próxima aba / a anterior', 'moves to the next / previous tab')],
  ]],
  ['ex', { rule: 'expand', src: '2K = y', focus: [0, 1], defs: { K: 'x + 1' },
    note: L('foco no chip K, com K = x + 1', 'focus on the chip K, with K = x + 1') }],
  ['p', L(
    'O painel **Nomes**, ao lado, lista cada nome com a sua definição atual; um clique abre a aba. Na aba de um nome, o texto digitado no campo de entrada vira um novo passo daquela equação.',
    'The **Names** panel on the side lists each name with its current definition; a click opens the tab. In a name’s tab, text typed in the input field becomes a new step of that equation.',
  )],

  ['h3', L('Definições auxiliares: K := expressão', 'Auxiliary definitions: K := expression')],
  ['p', L(
    'Para definir um nome sem tirá-lo de uma equação, digite no campo de entrada, em qualquer aba:',
    'To define a name without taking it out of an equation, type in the input field, from any tab:',
  )],
  ['define', { input: 'K := x^2 + 1', latex: 'K \\coloneqq x^2 + 1', name: 'K', def: 'x^2 + 1' }],
  ['ul', [
    L('Uma aba nova é aberta com a equação K = x² + 1, pronta para ser manipulada, e o nome entra no painel Nomes.', 'A new tab opens with the equation K = x² + 1, ready to be manipulated, and the name joins the Names panel.'),
    L('Em LaTeX, use `\\coloneqq` (ou `:=`). O lado esquerdo tem de ser um nome: uma letra, com subscrito opcional.', 'In LaTeX, use `\\coloneqq` (or `:=`). The left side must be a name: one letter with an optional subscript.'),
    L('A partir daí, **um K digitado em qualquer equação vale como o nome**: aparece como chip, a tecla `n` o expande e as regras o tratam como uma expressão que depende das variáveis da definição.', 'From then on, **a K typed in any equation counts as the name**: it shows as a chip, `n` expands it, and the rules treat it as an expression depending on the variables of its definition.'),
    L('Definições podem usar outros nomes: `M := K x` é válido. Uma definição que use o próprio nome (direta ou indiretamente, como `M := M + 1`) é recusada.', 'Definitions may use other names: `M := K x` is valid. A definition that uses the name itself (directly or indirectly, such as `M := M + 1`) is refused.'),
    L('Um nome já definido não pode ser redefinido com `:=`; para mudar a definição, edite a equação na aba dele.', 'A name that is already defined cannot be redefined with `:=`; to change the definition, edit the equation in its tab.'),
    L('Um problema novo digitado na aba Principal apaga as outras abas, mas **mantém as definições que ele usa** (direta ou indiretamente). Assim, dá para definir primeiro e escrever a equação depois.', 'A new problem typed in the Main tab discards the other tabs but **keeps the definitions it uses** (directly or indirectly). So you can define first and write the equation afterwards.'),
    L('Definir uma letra que já aparece como variável (por exemplo `x := 2`) também vale: todo x passa a ser o nome, e expandi-lo substitui x por 2.', 'Defining a letter that already appears as a variable (for instance `x := 2`) also works: every x becomes the name, and expanding it substitutes 2 for x.'),
  ]],
  ['table', [L('Mensagem', 'Message'), L('Quando aparece', 'When it appears')], [
    [L('Antes de := vem um nome…', 'A name must come before :=…'), L('o lado esquerdo não é uma letra (com subscrito opcional), ex.: `2x := 3`, `alpha := 1`', 'the left side is not one letter (optional subscript), e.g. `2x := 3`, `alpha := 1`')],
    [L('K já está definido', 'K is already defined'), L('o nome já tem uma aba', 'the name already has a tab')],
    [L('A definição de M não pode usar M', 'The definition of M cannot use M'), L('definição circular', 'circular definition')],
  ]],

  ['h3', L('Derivada parcial', 'Partial derivative')],
  ['h4', L('Notação', 'Notation')],
  ['p', L(
    'A derivada parcial em relação a x é escrita ∂/∂x f. Quando o que se deriva é um nome (ou uma letra sozinha), a notação é compacta: ∂ₓK, com a variável no índice.',
    'The partial derivative with respect to x is written ∂/∂x f. When what is differentiated is a name (or a single letter), the notation is compact: ∂ₓK, with the variable as a subscript.',
  )],
  ['table', [L('Digitar (ASCII)', 'Type (ASCII)'), 'LaTeX', L('Aparece como', 'Shows as')], [
    ['partial_x (x^2 y)', '\\frac{\\partial}{\\partial x} x^2 y', { formula: 'partial_x (x^2 y)' }],
    ['∂_x f   ∂/∂x f', '\\partial_x f', { formula: 'partial_x f' }],
    ['partial_x K', '\\partial_{x} K', { formula: 'partial_x K', defs: K }],
    ['partial_(x_1) f', '\\partial_{x_1} f', { formula: 'partial_(x_1) f' }],
  ]],
  ['p', L(
    'Na exportação, o LaTeX sai como `\\partial_{x} K` (letra ou nome) ou `\\frac{\\partial}{\\partial x} …`, e o MathJSON como `["PartialDerivative", f, x]`.',
    'On export, LaTeX is written as `\\partial_{x} K` (letter or name) or `\\frac{\\partial}{\\partial x} …`, and MathJSON as `["PartialDerivative", f, x]`.',
  )],
  ['h4', L('Derivar em relação a uma variável', 'Differentiating with respect to a variable')],
  ['p', L(
    'Fora de uma derivada, a tecla `\'` (ou, no menu, “Derivar parcialmente em relação a…”) pede a variável; o campo já vem com uma sugestão (x, se aparecer na expressão). Então:',
    'Outside a derivative, the `\'` key (or, in the menu, “Partial derivative with respect to…”) asks for the variable; the field comes with a suggestion (x, if it appears in the expression). Then:',
  )],
  ['ul', [
    L('numa **igualdade**, os dois membros são derivados: A = B → ∂ₓA = ∂ₓB, com o foco em qualquer ponto da equação;', 'in an **equality**, both sides are differentiated: A = B → ∂ₓA = ∂ₓB, with the focus anywhere in the equation;'),
    L('numa **expressão sem relação**, ela toda é derivada;', 'in an **expression without a relation**, the whole of it is differentiated;'),
    L('num **sistema**, vale para a equação em foco;', 'in a **system**, it applies to the focused equation;'),
    L('**desigualdades** são recusadas (derivar não preserva uma desigualdade).', '**inequalities** are refused (differentiating does not preserve an inequality).'),
  ]],
  ['ex', { rule: 'diff', src: 'K = x^2 y + sin(x)', focus: [], input: 'x', defs: { K: 'x^2 y + sin(x)' },
    note: L('na aba de K, digitado “x”', 'in the tab of K, typed “x”') }],
  ['ex', { rule: 'diff', src: 'x^2 + y', focus: [], input: 'y', note: L('expressão sem relação, digitado “y”', 'expression without a relation, typed “y”') }],
  ['h4', L('Passo a passo', 'Step by step')],
  ['p', L(
    'Dentro de uma ∂/∂x, a tecla `\'` aplica as mesmas regras das derivadas comuns (linearidade, constante para fora, potência, produto, quociente, cadeia, tabela, definição pelo limite), uma camada por vez. As outras letras são constantes, e as derivadas que a regra cria continuam parciais.',
    'Inside a ∂/∂x, the `\'` key applies the same rules as ordinary derivatives (linearity, constant out, power, product, quotient, chain, table, limit definition), one layer at a time. Other letters are constants, and the derivatives a rule creates stay partial.',
  )],
  ['ex', { rule: 'derivs', src: 'z = partial_x (x^2 y)', focus: [1], note: L('y é constante em relação a x', 'y is constant with respect to x') }],
  ['ex', { rule: 'derivs', src: 'z = partial_x (3 x^2 + K)', focus: [1], defs: K, note: L('linearidade; K depende de x pela definição', 'linearity; K depends on x through its definition') }],
  ['p', L(
    'Um nome que depende da variável (diretamente ou pelos nomes que usa) não se resolve sozinho: fica como ∂ₓK. Se o nome não depende da variável, a derivada é 0.',
    'A name that depends on the variable (directly or through the names it uses) is not resolved by itself: it stays as ∂ₓK. If the name does not depend on the variable, the derivative is 0.',
  )],
  ['ex', { rule: 'derivs', src: 'w = partial_z K', focus: [1], defs: K, note: L('K = x² + 1 não depende de z', 'K = x² + 1 does not depend on z') }],
  ['h4', L('Expandir ∂ₓK', 'Expanding ∂ₓK')],
  ['p', L('A tecla `n` tem dois comportamentos, conforme o foco:', 'The `n` key behaves in two ways, depending on the focus:')],
  ['ul', [
    L('com o foco em **∂ₓK** (a derivada inteira), calcula de uma vez a derivada da definição de K. Nesse cálculo o Manip arruma o resultado: retira os 0 e 1 neutros, desfaz produtos dentro de produtos e põe os números na frente e as letras em ordem alfabética. Nomes que aparecem na definição ficam como ∂ₓN;', 'with the focus on **∂ₓK** (the whole derivative), it computes the derivative of K’s definition in one step. In this computation Manip tidies the result: it removes neutral 0s and 1s, flattens products inside products, and puts numbers first and letters in alphabetical order. Names that appear in the definition stay as ∂ₓN;'),
    L('com o foco no **K** dentro de ∂ₓK, só troca K pela definição, ∂/∂x(definição), para derivar passo a passo.', 'with the focus on the **K** inside ∂ₓK, it only replaces K with its definition, ∂/∂x(definition), so you can differentiate step by step.'),
  ]],
  ['ex', { rule: 'expand', src: 'z = partial_x M', focus: [1], defs: KM, note: L('M = x²y + sen x; foco em ∂ₓM', 'M = x²y + sin x; focus on ∂ₓM') }],
  ['ex', { rule: 'expand', src: 'z = partial_x N', focus: [1], defs: { K: 'x^2 + 1', N: 'K x' }, note: L('N = Kx: a regra do produto deixa ∂ₓK', 'N = Kx: the product rule leaves ∂ₓK') }],
  ['ex', { rule: 'expand', src: 'z = partial_x M', focus: [1, 1], defs: KM, note: L('foco no chip M', 'focus on the chip M') }],

  ['h3', L('Busca reversa', 'Reverse lookup')],
  ['p', L(
    'É o caminho inverso da expansão. Selecione uma expressão (ou só ponha o foco nela) e aperte `n`: se ela for a definição de algum nome, vira o nome. No menu, a operação se chama “Trocar pelo nome (busca reversa)”, e o passo fica registrado como “reconheceu K”.',
    'It is the reverse of expansion. Select an expression (or just put the focus on it) and press `n`: if it is the definition of some name, it turns into the name. In the menu the operation is called “Replace with the name (reverse lookup)”, and the step is recorded as “recognized K”.',
  )],
  ['ex', { rule: 'fold', src: 'y = (x^2 + 1)^2 + 3x', focus: [1, 0, 0], defs: K, note: L('K = x² + 1; foco em x² + 1', 'K = x² + 1; focus on x² + 1') }],
  ['ul', [
    L('**Ordem diferente:** a comparação é a mesma das outras regras (módulo a forma normal polinomial); quando só a forma normal confere, o passo diz qual igualdade foi usada.', '**Different order:** the comparison is the same as in other rules (up to polynomial normal form); when only the normal form agrees, the step says which equality was used.'),
  ]],
  ['ex', { rule: 'fold', src: 'y = 1 + x^2', focus: [1], defs: K, note: L('1 + x² na ordem inversa', '1 + x² in reverse order') }],
  ['ul', [
    L('**Vários termos:** termos selecionados com Espaço numa soma (ou fatores de um produto) viram um nome só, no lugar do primeiro.', '**Several terms:** terms selected with Space in a sum (or factors of a product) become a single name, in place of the first one.'),
  ]],
  ['ex', { rule: 'fold', src: 'y = x^2 + 3x + 1', focus: [1, 0], sel: [[1, 0], [1, 2]], defs: K, note: L('selecionados x² e 1', 'x² and 1 selected') }],
  ['ul', [L('**Sinal trocado:** a expressão oposta à definição vira −K.', '**Opposite sign:** the opposite of the definition becomes −K.')]],
  ['ex', { rule: 'fold', src: 'y = -x^2 - 1', focus: [1], defs: K }],
  ['ul', [L('**Derivadas de nomes:** a derivada calculada de uma definição vira ∂ᵥK, para cada variável v da definição.', '**Derivatives of names:** the computed derivative of a definition becomes ∂ᵥK, for each variable v of the definition.')]],
  ['ex', { rule: 'fold', src: 'y = 2x y + cos(x)', focus: [1], defs: KM, note: L('M = x²y + sen x', 'M = x²y + sin x') }],
  ['ul', [
    L('**Mais de uma possibilidade:** se a seleção confere com mais de um nome, apertar `n` de novo alterna entre eles.', '**More than one match:** if the selection matches several names, pressing `n` again cycles through them.'),
    L('**Não reconhece múltiplos:** 3x² + 3 não vira 3K; ponha o 3 em evidência antes.', '**Multiples are not recognized:** 3x² + 3 does not become 3K; factor out the 3 first.'),
  ]],
  ['note', L(
    'A tecla `n` segue esta ordem: num nome, expande; numa expressão que é a definição de um nome, troca pelo nome; nos demais casos, pede um nome novo. Para dar um nome novo a uma expressão que já é a definição de outro, use o menu (Enter, “Dar nome…”).',
    'The `n` key follows this order: on a name, it expands; on an expression that is the definition of a name, it replaces it with the name; otherwise, it asks for a new name. To give a new name to an expression that is already the definition of another one, use the menu (Enter, “Name it…”).',
  )],

  ['h3', L('Exemplo completo', 'Worked example')],
  ['p', L(
    'Derivar y = K³ com K := x² + 1, e depois reconhecer K e ∂ₓK numa expressão já expandida.',
    'Differentiate y = K³ with K := x² + 1, and then recognize K and ∂ₓK in an already expanded expression.',
  )],
  ['steps', { src: 'y = K^3', defs: K, steps: [
    { rule: 'diff', focus: [], input: 'x', note: L('tecla \', digitado “x”', 'key \', typed “x”') },
    { rule: 'derivs', focus: [1], note: L('tecla \' no lado direito', 'key \' on the right side') },
    { rule: 'expand', focus: [1, 2], note: L('tecla n em ∂ₓK', 'key n on ∂ₓK') },
  ] }],
  ['steps', { src: 'y = 2x(x^2 + 1)^2', defs: K, steps: [
    { rule: 'fold', focus: [1, 2, 0], note: L('tecla n em x² + 1', 'key n on x² + 1') },
    { rule: 'fold', focus: [1, 0], sel: [[1, 0], [1, 1]], note: L('2 e x selecionados, tecla n', '2 and x selected, key n') },
  ] }],

  ['h2', L('11. Passos e histórico', '11. Steps and history')],
  ['p', L(
    'O painel **Passos** lista cada passo da aba atual com a sua justificativa e a fórmula em miniatura. Clique num passo (ou use as teclas abaixo) para voltar a ele; avançando um passo, a animação gravada nele se repete.',
    'The **Steps** panel lists every step of the current tab with its justification and a thumbnail of the formula. Click a step (or use the keys below) to go back to it; moving forward one step replays the animation stored in it.',
  )],
  ['table', [L('Tecla', 'Key'), L('Ação', 'Action')], [
    ['PgUp PgDn', L('passo anterior / seguinte', 'previous / next step')],
    ['Home End', L('primeiro / último passo', 'first / last step')],
    ['Ctrl+Z  Ctrl+Shift+Z', L('desfazer / refazer (Ctrl+Y também refaz)', 'undo / redo (Ctrl+Y also redoes)')],
    ['O', L('nota do passo atual', 'note for the current step')],
    ['C', L('colorir o foco (seis cores; repetir no mesmo nó gera um passo só, e depois da última a cor sai)', 'color the focus (six colors; repeating on the same node makes a single step, and after the last one the color is removed)')],
  ]],
  ['p', L(
    'Ao aplicar uma operação depois de voltar no histórico, os passos que vinham depois são descartados (como num editor de texto). As **notas** (tecla O) são textos livres de cada passo: Enter salva, Shift+Enter quebra a linha, Esc cancela e um texto vazio apaga a nota. Elas aparecem abaixo da fórmula, no histórico, na apresentação e no LaTeX dos passos — com elas, uma sequência de passos vira um roteiro de aula.',
    'If you apply an operation after going back in the history, the steps that came after are discarded (as in a text editor). **Notes** (key O) are free text attached to each step: Enter saves, Shift+Enter breaks the line, Esc cancels, and empty text removes the note. They appear below the formula, in the history, in the presentation and in the LaTeX of the steps — with them, a sequence of steps becomes a lesson script.',
  )],

  ['h2', L('12. Modo apresentação', '12. Presentation mode')],
  ['p', L(
    'A tecla **P** liga o modo apresentação: a fórmula ocupa a tela e os dois passos anteriores ficam empilhados acima dela, como num quadro, cada um esmaecido e com a justificativa entre eles (“↓ regra da cadeia”). Embaixo aparecem a nota do passo e o contador “passo i de n”. PgUp e PgDn percorrem os passos, repetindo as animações; P ou Esc saem.',
    'The **P** key turns presentation mode on: the formula fills the screen and the two previous steps are stacked above it, as on a board, each one faded and with the justification between them (“↓ chain rule”). Below are the step note and the counter “step i of n”. PgUp and PgDn go through the steps, replaying the animations; P or Esc leave.',
  )],
  ['p', L(
    'Para aulas, a opção “aula (lenta)” em Ajustes deixa as animações mais lentas; o tema “quadro verde” ou “alto contraste” ajuda em projetores; [ e ] aumentam e diminuem a fórmula.',
    'For lessons, the “lesson (slow)” option in Settings makes the animations slower; the “chalkboard” or “high contrast” themes help on projectors; [ and ] make the formula larger and smaller.',
  )],

  ['h2', L('13. Gravar vídeo', '13. Recording video')],
  ['p', L(
    'A tecla **R** (ou Exportar › Gravar apresentação) grava a apresentação em vídeo, com a voz do professor. Na janela de gravação você escolhe:',
    'The **R** key (or Export › Record presentation) records the presentation as a video, with the teacher’s voice. In the recording dialog you choose:',
  )],
  ['ul', [
    L('o intervalo de passos (do passo… ao passo…);', 'the range of steps (from step… to step…);'),
    L('o avanço: manual (PgDn, Espaço ou →) ou automático, com a pausa entre passos em segundos;', 'the advance: manual (PgDn, Space or →) or automatic, with the pause between steps in seconds;'),
    L('a velocidade da animação e um título de abertura opcional;', 'the animation speed and an optional opening title;'),
    L('gravar a voz pelo microfone; mostrar as notas, o contador “passo i de n” e os passos anteriores.', 'recording your voice through the microphone; showing the notes, the “step i of n” counter and the previous steps.'),
  ]],
  ['p', L(
    'O navegador pede para compartilhar a aba: escolha a do Manip. Esc termina a gravação, e o vídeo é salvo em MP4 ou WebM, conforme o navegador. Para um vídeo maior, deixe a janela em tela cheia (F11) antes. Durante a gravação, a fórmula não pode ser editada.',
    'The browser asks to share the tab: pick Manip’s. Esc ends the recording, and the video is saved as MP4 or WebM, depending on the browser. For a larger video, make the window full screen (F11) first. While recording, the formula cannot be edited.',
  )],

  ['h2', L('14. Exportar, salvar e abrir', '14. Export, save and open')],
  ['table', [L('Comando', 'Command'), L('O que faz', 'What it does')], [
    [L('Y · Copiar a expressão (texto)', 'Y · Copy the expression (text)'), L('a fórmula atual em ASCII, pronta para colar de volta no campo de entrada', 'the current formula in ASCII, ready to paste back into the input field')],
    [L('L · Copiar a expressão (LaTeX)', 'L · Copy the expression (LaTeX)'), L('a fórmula atual em LaTeX', 'the current formula in LaTeX')],
    [L('Copiar LaTeX dos passos', 'Copy LaTeX of the steps'), L('todos os passos até o atual num ambiente `aligned`, alinhados pelo sinal da relação, com as notas como `\\text{…}` e sem repetir linhas iguais (como as de só mudar a cor)', 'all steps up to the current one in an `aligned` environment, aligned at the relation sign, with notes as `\\text{…}` and without repeating identical lines (such as color-only steps)')],
    [L('Copiar MathJSON', 'Copy MathJSON'), L('a fórmula no formato de troca MathJSON', 'the formula in the MathJSON exchange format')],
    [L('Salvar arquivo .json', 'Save .json file'), L('o documento inteiro: todas as abas, os passos, as notas e as animações gravadas', 'the whole document: all tabs, steps, notes and stored animations')],
    [L('Abrir arquivo .json', 'Open .json file'), L('reabre um arquivo salvo, com as animações intactas', 'reopens a saved file, with the animations intact')],
  ]],
  ['p', L(
    'Além disso, o estado atual é salvo sozinho no navegador a cada passo e volta ao reabrir a página.',
    'In addition, the current state is saved automatically in the browser at every step and comes back when the page is reopened.',
  )],

  ['h2', L('15. Ajustes', '15. Settings')],
  ['table', [L('Ajuste', 'Setting'), L('Opções', 'Options')], [
    [L('Animação', 'Animation'), L('normal, aula (lenta) ou desligada; com “reduzir movimento” ligado no sistema, as animações são desligadas', 'normal, lesson (slow) or off; with the system’s “reduce motion” on, animations are turned off')],
    [L('Tema', 'Theme'), L('automático (segue o sistema), claro, escuro, quadro verde, papel e alto contraste', 'automatic (follows the system), light, dark, chalkboard, paper and high contrast')],
    [L('Expressões longas', 'Long expressions'), L('quebrar linhas (nos + e − do nível de cima) ou rolar', 'wrap lines (at top-level + and −) or scroll')],
    [L('Idioma', 'Language'), L('português ou inglês; troca também os nomes das funções (sen/sin, tg/tan)', 'Portuguese or English; also switches function names (sen/sin, tg/tan)')],
    ['[  ]  \\', L('aumentar, diminuir e voltar ao tamanho normal da fórmula', 'enlarge, shrink and reset the formula size')],
  ]],
  ['p', L(
    'Uma fórmula grande demais é primeiro reduzida até um tamanho mínimo legível; depois disso, quebra em linhas ou rola, conforme o ajuste, sem nunca perder o foco de vista.',
    'A formula that is too large is first shrunk down to a minimum readable size; beyond that, it wraps or scrolls, depending on the setting, never losing sight of the focus.',
  )],

  ['h2', L('16. Referência rápida', '16. Quick reference')],
  ['keys'],
  ['p', L(
    'A ajuda do app (tecla ?) e a folha de atalhos para imprimir (cheatsheet.html) trazem as mesmas listas, com um exemplo de cada operação.',
    'The in-app help (? key) and the printable cheat sheet (cheatsheet.html) carry the same lists, with an example of each operation.',
  )],
];

// Todos os exemplos (para o teste).
export function allExamples() {
  const out = [];
  for (const [type, data] of MANUAL) {
    if (type === 'ex') out.push(data);
    if (type === 'steps') out.push(data);
  }
  return out;
}
