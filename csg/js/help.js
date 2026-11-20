// Language reference, generated from the symbol table and the prelude docs.
import { SYMBOLS } from './lang/symbols.js';
import { createPrelude } from './lang/builtins.js';
import { Builtin } from './lang/values.js';

const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

const CATEGORIES = [
  ['Primitivas (centradas na origem)', ['cube', 'box', 'sphere', 'cylinder', 'cone', 'torus', 'prism', 'polyhedron', 'hull', 'minkowski']],
  ['Isometrias', ['T', 'Tx', 'Ty', 'Tz', 'Rx', 'Ry', 'Rz', 'R', 'M']],
  ['Escalas e transformações afins', ['S', 'scale', 'Sx', 'Sy', 'Sz', 'at', 'inverse', 'isometry']],
  ['Sólidos: consultas e posicionamento', ['union', 'intersection', 'bounds', 'size', 'volume', 'area', 'isempty', 'center', 'ground']],
  ['Listas (dado por último: funcionam com |> e aplicação parcial)', ['len', 'range', 'map', 'filter', 'fold', 'reduce', 'zip', 'enumerate', 'reverse', 'sort', 'flatten', 'take', 'drop', 'first', 'last', 'sum', 'prod', 'any', 'all', 'count', 'indexof', 'repeat', 'iterate']],
  ['Matemática', ['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'sqrt', 'abs', 'floor', 'ceil', 'round', 'sign', 'exp', 'ln', 'log', 'min', 'max', 'clamp', 'lerp', 'norm', 'unit', 'dot', 'cross', 'dist']],
];

function signature(b) {
  if (b.doc && b.doc.includes('—')) return b.doc;
  if (b.variadic) return `${b.name}(${b.params[0].name}…)`;
  return `${b.name}(${b.params.map((p) => (p.optional ? `${p.name}?` : p.name)).join(', ')})`;
}

export function helpHTML() {
  const prelude = createPrelude();
  const groups = new Map();
  for (const s of SYMBOLS) {
    if (!groups.has(s.group)) groups.set(s.group, []);
    groups.get(s.group).push(s);
  }
  const symbolTables = [...groups].map(([group, list]) => `
    <h4>${esc(group)}</h4>
    <table class="symbols">
      <thead><tr><th>Símbolo</th><th>Significado</th><th>Atalho</th><th>ASCII</th></tr></thead>
      <tbody>${list.map((s) => `<tr><td class="sym">${s.sym}</td><td>${esc(s.name)}</td>
        <td><code>${s.latex.map((l) => `\\${l}`).join(' ')}</code></td>
        <td><code>${esc(s.ascii.join('  '))}</code></td></tr>`).join('')}</tbody>
    </table>`).join('');

  const functions = CATEGORIES.map(([title, names]) => `
    <h4>${esc(title)}</h4>
    <ul class="fnlist">${names.filter((n) => prelude[n] instanceof Builtin).map((n) => {
      const sig = signature(prelude[n]);
      const [head, desc] = sig.split(' — ');
      return `<li><code>${esc(head)}</code>${desc ? ` — ${esc(desc)}` : ''}</li>`;
    }).join('')}</ul>`).join('');

  return `
  <h2>Referência da linguagem</h2>
  <p><a class="manual-link" href="docs/csg-manual.pdf" target="_blank" rel="noopener">📄 Manual completo (PDF)</a>
  Inclui tutorial, exemplos comentados, dicas de impressão 3D e a referência completa.</p>
  <section>
    <h3>Programas</h3>
    <p>Um programa é uma sequência de definições. A ordem não importa: uma definição pode usar outra que aparece depois.</p>
    <pre><code>r ≔ 10                       # constante
furo(θ, d = 2) ≔ Rz(θ) · T(r, 0, 0) · cylinder(d, 20)   # função com parâmetro padrão
peça ≔ cylinder(r + 5, 4) ∖ ⋃{ furo(k·60°) | k ∈ 0..&lt;6 }
⊢ peça                       # o que aparece na visualização</code></pre>
    <p>Toda constante cujo valor é um sólido é um <b>objeto nomeado</b>: aparece no painel de objetos e pode ser exportada como STL.
    <code>⊢ e₁, e₂</code> escolhe o que exibir. Também mostra números e listas na saída. Sem <code>⊢</code>, aparece o último objeto nomeado.</p>
    <p>Uma linha continua a anterior quando está indentada, quando a anterior termina em operador ou vírgula, ou quando começa com um operador.
    Separe instruções na mesma linha com <code>;</code>. Comentários começam com <code>#</code>.</p>
  </section>
  <section>
    <h3>Valores</h3>
    <p>Números, booleanos (<code>true</code>, <code>false</code>), listas, intervalos, sólidos, isometrias e funções.
    <code>[1, 2, 3]</code>, <code>⟨1, 2, 3⟩</code> e <code>{1, 2, 3}</code> são todas listas. Uma lista de três números é um vetor (<code>v.x</code>, <code>v[0]</code>).
    Intervalos: <code>0..10</code> (fechado), <code>0..&lt;10</code> (semiaberto), <code>range(0, 1, 0.1)</code>.</p>
    <p>Ângulos estão em radianos. <code>45°</code> é o mesmo que <code>45·π/180</code>. Um número colado a um nome ou parêntese multiplica:
    <code>2π</code>, <code>3x²</code>, <code>30°k</code>, <code>2(x + 1)</code>.</p>
  </section>
  <section>
    <h3>Operadores (do mais forte ao mais fraco)</h3>
    <table class="ops"><tbody>
      <tr><td><code>f(x)  xs[i]  v.x  x°  x²  g⁻¹</code></td><td>chamada, índice, componente, graus, potência sobrescrita</td></tr>
      <tr><td><code>^</code></td><td>potência (também de transformações: <code>g^3</code>)</td></tr>
      <tr><td><code>∘</code></td><td>composição de transformações ou de funções</td></tr>
      <tr><td><code>-x  √x</code></td><td>prefixos</td></tr>
      <tr><td><code>·  ×  /  mod</code></td><td>produto, aplicação de transformação (<code>g · A</code>), produto escalar e vetorial</td></tr>
      <tr><td><code>⋃  ⋂  Σ  ∏</code></td><td>grandes operadores sobre uma coleção</td></tr>
      <tr><td><code>+  -  ++</code></td><td>soma (para sólidos: ∪ e ∖), concatenação de listas</td></tr>
      <tr><td><code>..  ..&lt;</code></td><td>intervalos</td></tr>
      <tr><td><code>⊕</code></td><td>soma de Minkowski</td></tr>
      <tr><td><code>∩</code></td><td>interseção</td></tr>
      <tr><td><code>∪  ∖  △</code></td><td>união, diferença, diferença simétrica (associam à esquerda)</td></tr>
      <tr><td><code>=  ≠  &lt;  ≤  &gt;  ≥  ∈  ∉</code></td><td>comparações encadeáveis: <code>0 ≤ i &lt; n</code></td></tr>
      <tr><td><code>¬  ∧  ∨</code></td><td>lógica</td></tr>
      <tr><td><code>|&gt;</code></td><td>pipe: <code>xs |&gt; map(f)</code> é <code>map(f, xs)</code></td></tr>
      <tr><td><code>↦  if … then … else  let … in</code></td><td>lambdas e expressões que vão até o fim</td></tr>
    </tbody></table>
  </section>
  <section>
    <h3>Transformações</h3>
    <p>Isometrias (<code>T</code>, <code>R…</code>, <code>M…</code>) e escalas (<code>S</code>, <code>Sx</code>, <code>Sy</code>, <code>Sz</code>) são valores.
    Compõem com <code>∘</code>, se aplicam com <code>·</code> a sólidos, pontos e listas, e se invertem com <code>⁻¹</code>.
    A composição de isometrias é uma isometria. Com uma escala no meio, o resultado é uma transformação afim.</p>
    <pre><code>S(2) · cube(5)                    # semelhança: cubo de aresta 10
S(1, 1, 0.5) · sphere(10)         # elipsoide
at(S(2), [10, 0, 0]) · peça       # escala em torno do ponto (10, 0, 0)
Sx(-1) = Mx                       # escala negativa é reflexão
isometry(Rz(30°) ∘ T(1, 2, 3))    # true</code></pre>
  </section>
  <section>
    <h3>Construções funcionais</h3>
    <pre><code>{ T(10i, 10j, 0) · cube(5) | i, j ∈ 0..4, i + j ≤ 4 }    # compreensão
⋃{ … }   ⋂ xs   Σ_{k=1}^{10} k²   ⋃_{i ∈ 0..&lt;6} Rz(60°i) · peça
x ↦ x²   (x, y) ↦ x + y   [a, b] ↦ a·b                     # lambdas
reduce((∪), peças)   map((Rz(90°) ·), peças)   (· 2)       # seções de operador
cylinder(5)        # aplicação parcial: uma função que espera h
0..&lt;12 |&gt; map(k ↦ Rz(30°k) · dente) |&gt; union
let a ≔ 2, f(x) ≔ x + a in f(3)
fractal(k) ≔ if k = 0 then cube(9) else …                  # recursão</code></pre>
  </section>
  <section>
    <h3>Funções embutidas</h3>
    <p>Constantes: <code>π τ e ∞ ∅ id Mx My Mz</code>. Argumentos podem ser nomeados: <code>cylinder(r = 2, h = 10)</code>.
    O parâmetro opcional <code>n</code> fixa o número de segmentos dos círculos.</p>
    ${functions}
  </section>
  <section>
    <h3>Símbolos</h3>
    <p>No editor, digite <code>\\nome</code>. Um menu de sugestões aparece; confirme com Tab ou Enter, ou digite espaço.
    <code>:=</code>, <code>-&gt;</code>, <code>&lt;=</code>, <code>&gt;=</code> e <code>!=</code> viram símbolos automaticamente.
    A linguagem também aceita a grafia ASCII diretamente.</p>
    ${symbolTables}
  </section>
  <section>
    <h3>Atalhos</h3>
    <table class="ops"><tbody>
      <tr><td><kbd>Ctrl</kbd>+<kbd>Enter</kbd></td><td>avaliar</td></tr>
      <tr><td><kbd>Ctrl</kbd>+<kbd>S</kbd></td><td>salvar o programa (.csg)</td></tr>
      <tr><td><kbd>Ctrl</kbd>+<kbd>/</kbd></td><td>comentar linhas</td></tr>
      <tr><td><kbd>Tab</kbd> / <kbd>Shift</kbd>+<kbd>Tab</kbd></td><td>indentar / remover indentação</td></tr>
      <tr><td>arrastar · botão direito ou Shift+arrastar · roda</td><td>girar · deslocar · aproximar</td></tr>
      <tr><td>duplo clique na visualização</td><td>enquadrar</td></tr>
    </tbody></table>
  </section>`;
}
