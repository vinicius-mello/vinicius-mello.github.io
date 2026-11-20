// Example programs (also exercised by tests/examples.test.js).
export const EXAMPLES = [
  {
    id: 'flange',
    title: 'Flange com furos',
    source: `# Flange com furos — compreensão, isometrias e operações de conjunto
n ≔ 8          # número de furos
r ≔ 30         # raio da base

furo(θ) ≔ Rz(θ) ∘ T(r - 6, 0, 0) · cylinder(r = 2, h = 10)
pilar(p) ≔ T(p) · box(4, 4, 20)

base   ≔ cylinder(r = r, h = 4)
furos  ≔ ⋃{ furo(k · 360°/n) | k ∈ 0..<n }
cantos ≔ ⋃{ pilar(⟨20sx, 20sy, 0⟩) | sx, sy ∈ {-1, 1} }

peça ≔ (base ∖ furos) ∪ cantos ∖ sphere(8)

⊢ ground(peça)
`,
  },
  {
    id: 'gear',
    title: 'Engrenagem',
    source: `# Engrenagem — dentes gerados por compreensão e reunidos com reduce
z ≔ 18           # número de dentes
R ≔ 20           # raio da coroa
e ≔ 6            # espessura

dente ≔ T(R, 0, 0) · hull(box(4, 3.4, e), T(3, 0, 0) · box(1, 1.4, e))
dentes ≔ { Rz(k · τ/z) · dente | k ∈ 0..<z }

cubo_central ≔ cylinder(r = 7, h = e + 4)
eixo ≔ prism(6, 3.2, 3e)
alívios ≔ ⋃{ Rz(k · 60°) · T(12.5, 0, 0) · cylinder(3.5, 2e) | k ∈ 0..<6 }

engrenagem ≔ reduce((∪), [cylinder(R, e)] ++ dentes)
  ∖ alívios ∪ cubo_central ∖ eixo

⊢ ground(engrenagem)
`,
  },
  {
    id: 'menger',
    title: 'Esponja de Menger (recursão)',
    source: `# Esponja de Menger — função recursiva com compreensão em 3 índices
menger(k, s) ≔
  if k = 0 then cube(s)
  else ⋃{ T((s/3) · [i, j, l]) · menger(k - 1, s/3)
        | i, j, l ∈ -1..1, abs(i) + abs(j) + abs(l) > 1 }

esponja ≔ menger(2, 54)

⊢ ground(esponja)
⊢ volume(esponja) / 54³     # fração ocupada = (20/27)²
`,
  },
  {
    id: 'vase',
    title: 'Vaso torcido',
    source: `# Vaso torcido — camadas de prismas giradas e com perfil senoidal
n ≔ 36           # camadas
h ≔ 2            # altura de cada camada
parede ≔ 2

perfil(k) ≔ 18 + 5·sin(k/6)
camada(k, recuo) ≔ Tz(k·h) · Rz(k · 3°) · prism(6, perfil(k) - recuo, h + 0.01)

externo ≔ ⋃{ camada(k, 0) | k ∈ 0..<n }
interno ≔ ⋃{ camada(k, parede) | k ∈ 1..n }

vaso ≔ externo ∖ interno

⊢ ground(vaso)
`,
  },
  {
    id: 'group',
    title: 'Simetria: grupo diedral',
    source: `# O grupo diedral D₄ agindo sobre um motivo
# Isometrias são valores: compõem com ∘ e aplicam com ·
D₄ ≔ { Rz(k · 90°) ∘ s | k ∈ 0..3, s ∈ [id, My] }

motivo ≔ T(14, 5, 0) · Rz(25°) · box(12, 3, 4)
       ∪ T(9, 9, 0) · sphere(2.5)

roseta ≔ ⋃{ g · motivo | g ∈ D₄ } ∪ cylinder(6, 4) ∖ cylinder(2, 10)

⊢ ground(roseta)
⊢ len(D₄)
`,
  },
  {
    id: 'scale',
    title: 'Escalas e transformações afins',
    source: `# Escalas — S(k) é uma semelhança; S(x, y, z) estica cada eixo.
# Compostas com isometrias por ∘, formam transformações afins.
boneco ≔ sphere(10) ∪ Tz(14) · sphere(6) ∪ Tz(22) · cone(3, 0, 6)

# matrioscas: cada uma 80% da anterior, lado a lado
x(k) ≔ Σ{ 20 · 0.8^j | j ∈ 0..<k }
família ≔ ⋃{ Tx(x(k)) · ground(S(0.8^k) · boneco) | k ∈ 0..<5 }

# elipsoide: esfera esticada em z
ovo ≔ T(0, 35, 0) · ground(S(1, 1, 1.4) · sphere(10))

# torre torcida: camadas giradas e encolhidas só em x e y
torre ≔ T(-35, 0, 0) · ground(⋃{ Tz(4k) · Rz(9°k) · S(1 - k/20, 1 - k/20, 1) · box(20, 20, 4.01)
                                | k ∈ 0..<12 })

# escala em torno de um ponto: at(g, p) = T(p) ∘ g ∘ T(-p)
selo ≔ T(0, -35, 0) · (cylinder(12, 3) ∖ at(S(0.6), [0, 0, 1.5]) · ground(cylinder(12, 3)))

⊢ família, ovo, torre, ground(selo)
⊢ isometry(Rz(9°) ∘ S(0.95, 0.95, 1))
`,
  },
  {
    id: 'box',
    title: 'Caixa com tampa',
    source: `# Caixa com tampa — let, parâmetros com valor padrão, vários objetos
caixa(l, w, h, e = 2) ≔
  let externa ≔ box(l, w, h),
      interna ≔ Tz(e) · box(l - 2e, w - 2e, h)
  in externa ∖ interna

folga ≔ 0.2
fundo ≔ ground(caixa(60, 40, 30))
tampa ≔ T(0, 50, 0) · ground(box(60, 40, 2)
        ∪ Tz(2) · box(60 - 4 - 2folga, 40 - 4 - 2folga, 4)
        ∖ Tz(2) · box(60 - 8, 40 - 8, 6))

⊢ fundo, tampa
`,
  },
  {
    id: 'tour',
    title: 'Tour da linguagem',
    source: `# Tour da linguagem — cada linha mostra um recurso
# Digite \\cup, \\cap, \\setminus, \\circ, \\mapsto… e espaço para obter os símbolos.

# números, graus e multiplicação implícita
θ ≔ 30°
a ≔ 2π · 10

# listas e vetores (⟨⟩, [] e {} formam listas)
v ≔ ⟨1, 2, 3⟩ × [0, 0, 1]

# compreensões e grandes operadores
quadrados ≔ { k² | k ∈ 1..10, k mod 2 = 1 }
soma ≔ Σ_{k=1}^{10} k²

# funções, lambdas, composição, seções e pipes
dobro ≔ x ↦ 2x
f ≔ dobro ∘ (· 3)
pares ≔ 1..10 |> filter(x ↦ x mod 2 = 0) |> map(dobro)

# isometrias formam um grupo
g ≔ Rz(90°) ∘ T(10, 0, 0)
volta ≔ g⁴ = id        # g é uma rotação de 90° em torno de outro ponto

# sólidos
anel ≔ torus(12, 3) ∖ T(0, 0, 3) · box(40, 40, 4)
contas ≔ ⋃{ Rz(k · 45°) · T(12, 0, 0) · sphere(3.6) | k ∈ 0..<8 }
colar ≔ anel ∪ contas

⊢ colar
⊢ soma, quadrados, pares, f(5), volta
`,
  },
];

export const DEFAULT_EXAMPLE = 'flange';
