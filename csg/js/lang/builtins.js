// The prelude: primitives, isometries, math and list functions.
import { LangError } from './errors.js';
import * as M from '../geom/mat4.js';
import { Builtin, Iso, Solid, Profile, Range, isNumber, isList, isVector, isPoint2, typeName, format, deepEqual } from './values.js';
import { callValue, iterate, geometry, binary, bigOp, invert } from './evaluator.js';

const fail = (msg, node) => { throw new LangError(msg, node?.span); };

// ---------- argument checks ----------
const num = (v, what, node) => (isNumber(v) && Number.isFinite(v) ? v : fail(`${what}: esperava número, recebi ${typeName(v)}`, node));
const positive = (v, what, node) => (num(v, what, node) > 0 ? v : fail(`${what} deve ser positivo (recebi ${format(v)})`, node));
const nonNegative = (v, what, node) => (num(v, what, node) >= 0 ? v : fail(`${what} não pode ser negativo (recebi ${format(v)})`, node));
const int = (v, what, node) => (Number.isInteger(v) ? v : fail(`${what}: esperava inteiro, recebi ${format(v)}`, node));
const segments = (v, node) => {
  if (v === undefined) return undefined;
  int(v, 'n (segmentos)', node);
  if (v < 3) fail('n (segmentos) deve ser pelo menos 3', node);
  return v;
};
const vec3 = (v, what, node) => (isVector(v) ? v : fail(`${what}: esperava vetor [x, y, z], recebi ${typeName(v)}`, node));
const solid = (v, what, node) => (v instanceof Solid ? v : fail(`${what}: esperava sólido, recebi ${typeName(v)}`, node));
const profile = (v, what, node) => {
  if (v instanceof Profile) return v;
  fail(`${what}: esperava perfil, recebi ${typeName(v)}${v instanceof Solid ? ' (perfis são regiões do plano: circle, square, polygon…)' : ''}`, node);
};
// A point of the plane: ⟨x, y⟩ (a 3D point is accepted when z = 0).
const point2 = (v, what, node) => {
  if (isPoint2(v)) return v;
  if (isVector(v) && v[2] === 0) return [v[0], v[1]];
  return fail(`${what}: esperava ponto do plano ⟨x, y⟩, recebi ${isVector(v) ? `o ponto ${format(v)} fora do plano z = 0` : typeName(v)}`, node);
};
const bool = (v, what, node) => (typeof v === 'boolean' ? v : fail(`${what}: esperava booleano, recebi ${typeName(v)}`, node));

// Vectors may be given as one list or as separate numbers: T([1,2,3]) or T(1,2,3).
function vectorArgs(x, y, z, what, node) {
  if (isList(x)) {
    if (y !== undefined || z !== undefined) fail(`${what}: passe um vetor ou três números, não ambos`, node);
    return vec3(x, what, node);
  }
  return [num(x, what, node), num(y ?? 0, what, node), num(z ?? 0, what, node)];
}

// ---------- definition helper ----------
// spec: "name(a, b?, c?)" or "name(xs...)"
function define(table, spec, impl, doc = '') {
  const m = /^(\S+?)\((.*)\)$/.exec(spec);
  const name = m[1];
  const raw = m[2].trim();
  if (raw.endsWith('...')) {
    table[name] = new Builtin(name, [{ name: raw.slice(0, -3) }], impl, { variadic: true, doc: doc || spec });
    return;
  }
  const params = raw ? raw.split(',').map((s) => s.trim()).map((s) => ({ name: s.replace('?', ''), optional: s.endsWith('?') })) : [];
  table[name] = new Builtin(name, params, impl, { doc: doc || spec });
}

function iso(m, label) { return new Iso(m, label); }

export function createPrelude() {
  const P = {};
  const def = (spec, impl, doc) => define(P, spec, impl, doc);

  // ----- constants -----
  P['π'] = P.pi = Math.PI;
  P['τ'] = P.tau = 2 * Math.PI;
  P.e = Math.E;
  P['∞'] = P.inf = Infinity;
  P.id = iso(M.identity(), 'id');
  P.Mx = iso(M.reflection([1, 0, 0]), 'Mx');
  P.My = iso(M.reflection([0, 1, 0]), 'My');
  P.Mz = iso(M.reflection([0, 0, 1]), 'Mz');

  // ----- primitives (centred at the origin) -----
  def('cube(size?)', ([s = 1], ctx, n) => {
    if (isList(s)) { const [x, y, z] = vec3(s, 'cube', n); return geometry(ctx, n, (k) => k.box(positive(x, 'cube x', n), positive(y, 'cube y', n), positive(z, 'cube z', n))); }
    positive(s, 'cube: aresta', n);
    return geometry(ctx, n, (k) => k.box(s, s, s));
  }, 'cube(a) — cubo de aresta a');
  def('box(x, y?, z?)', ([x, y, z], ctx, n) => {
    const [a, b, c] = isList(x) ? vec3(x, 'box', n) : [x, y ?? x, z ?? y ?? x];
    return geometry(ctx, n, (k) => k.box(positive(a, 'box x', n), positive(b, 'box y', n), positive(c, 'box z', n)));
  }, 'box(x, y, z) — paralelepípedo');
  def('sphere(r, n?)', ([r, s], ctx, n) =>
    geometry(ctx, n, (k) => k.sphere(positive(r, 'sphere: raio', n), segments(s, n))), 'sphere(r) — esfera');
  def('cylinder(r, h, n?)', ([r, h, s], ctx, n) =>
    geometry(ctx, n, (k) => k.cone(positive(r, 'cylinder: raio', n), r, positive(h, 'cylinder: altura', n), segments(s, n))),
  'cylinder(r, h) — cilindro ao longo de z');
  def('cone(r1, r2, h, n?)', ([r1, r2, h, s], ctx, n) => {
    nonNegative(r1, 'cone: r1', n); nonNegative(r2, 'cone: r2', n);
    if (r1 === 0 && r2 === 0) fail('cone: os dois raios não podem ser zero', n);
    return geometry(ctx, n, (k) => k.cone(r1, r2, positive(h, 'cone: altura', n), segments(s, n)));
  }, 'cone(r1, r2, h) — tronco de cone (r2 = 0 para cone)');
  def('torus(R, r, n?, m?)', ([R, r, s, t], ctx, n) => {
    positive(R, 'torus: R', n); positive(r, 'torus: r', n);
    if (r >= R) fail('torus: r deve ser menor que R', n);
    return geometry(ctx, n, (k) => k.torus(R, r, segments(s, n), segments(t, n)));
  }, 'torus(R, r) — toro em torno de z');
  def('prism(n, r, h)', ([s, r, h], ctx, n) => {
    int(s, 'prism: n', n);
    if (s < 3) fail('prism: n deve ser pelo menos 3', n);
    return geometry(ctx, n, (k) => k.cone(positive(r, 'prism: raio', n), r, positive(h, 'prism: altura', n), s));
  }, 'prism(n, r, h) — prisma regular de n lados');
  def('polyhedron(points, faces)', ([pts, faces], ctx, n) => {
    const points = iterate(pts, n, 'lista de pontos').map((p) => vec3(p, 'polyhedron: ponto', n));
    const fs = iterate(faces, n, 'lista de faces').map((f) => {
      const idx = iterate(f, n, 'face');
      if (idx.length < 3) fail('polyhedron: cada face precisa de 3 vértices ou mais', n);
      idx.forEach((i) => { if (!Number.isInteger(i) || i < 0 || i >= points.length) fail(`polyhedron: índice ${format(i)} inválido`, n); });
      return idx;
    });
    return geometry(ctx, n, (k) => k.polyhedron(points, fs));
  }, 'polyhedron(pontos, faces) — faces anti-horárias vistas de fora');
  def('hull(items...)', (items, ctx, n) => {
    const solids = [], points = [], profiles = [], points2 = [];
    const walk = (x) => {
      if (x instanceof Solid) solids.push(x);
      else if (x instanceof Profile) profiles.push(x);
      else if (isVector(x)) points.push(x);
      else if (isPoint2(x)) points2.push(x);
      else if (isList(x) || x instanceof Range) iterate(x, n).forEach(walk);
      else fail(`hull: esperava sólidos, perfis ou pontos, recebi ${typeName(x)}`, n);
    };
    items.forEach(walk);
    const flat = profiles.length + points2.length, solid3 = solids.length + points.length;
    if (flat && solid3) fail('hull: não misture perfis e pontos ⟨x, y⟩ com sólidos e pontos [x, y, z]', n);
    if (flat) {
      if (!profiles.length && points2.length < 3) fail('hull: precisa de perfis ou pelo menos 3 pontos do plano', n);
      return geometry(ctx, n, (k) => k.hull2(profiles, points2));
    }
    if (!solids.length && points.length < 4) fail('hull: precisa de sólidos ou pelo menos 4 pontos', n);
    return geometry(ctx, n, (k) => k.hull(solids, points));
  }, 'hull(A, B, …) — fecho convexo (de sólidos ou de perfis)');
  def('minkowski(a, b)', ([a, b], ctx, n) => binary('⊕', solid(a, 'minkowski', n), solid(b, 'minkowski', n), ctx, n));

  // ----- profiles: regions of the plane z = 0 -----
  def('circle(r, n?)', ([r, s], ctx, n) =>
    geometry(ctx, n, (k) => k.circle(positive(r, 'circle: raio', n), segments(s, n))), 'circle(r) — disco de raio r');
  def('square(x, y?)', ([x, y], ctx, n) => {
    const [a, b] = isList(x) ? point2(x, 'square', n) : [x, y ?? x];
    return geometry(ctx, n, (k) => k.square(positive(a, 'square x', n), positive(b, 'square y', n)));
  }, 'square(a) ou square(x, y) — retângulo centrado na origem');
  def('polygon(points)', ([pts], ctx, n) => {
    const items = iterate(pts, n, 'lista de pontos');
    // one contour [⟨x, y⟩…] or several [[⟨x, y⟩…], …] (holes by even–odd)
    const nested = items.length > 0 && isList(items[0]) && !items[0].every(isNumber);
    const contours = (nested ? items : [items]).map((c) => {
      const ps = iterate(c, n, 'contorno').map((p) => point2(p, 'polygon', n));
      if (ps.length < 3) fail('polygon: cada contorno precisa de pelo menos 3 pontos', n);
      return ps;
    });
    return geometry(ctx, n, (k) => k.polygon(contours));
  }, 'polygon(pontos) — região limitada pela poligonal ⟨x, y⟩ fechada');
  def('region(f, a, b, n?)', ([f, a, b, s], ctx, n) => {
    num(a, 'region: a', n); num(b, 'region: b', n);
    if (!(a < b)) fail('region: é preciso a < b', n);
    const m = s === undefined ? 128 : segments(s, n);
    const pts = [[a, 0]];
    for (let i = 0; i <= m; i++) {
      const x = a + ((b - a) * i) / m;
      pts.push([x, num(callValue(f, [x], {}, ctx, n), 'region: f(x)', n)]);
    }
    pts.push([b, 0]);
    return geometry(ctx, n, (k) => k.polygon([pts]));
  }, 'region(f, a, b) — região entre o gráfico de f e o eixo x, para a ≤ x ≤ b');
  def('offset(P, d, n?)', ([p, d, s], ctx, n) =>
    geometry(ctx, n, (k) => k.offset(profile(p, 'offset', n), num(d, 'offset: d', n), segments(s, n))),
  'offset(P, d) — engorda o perfil de d (afina se d < 0), arredondando os cantos');
  def('extrude(P, h, θ?, k?)', ([p, h, t = 0, sc = 1], ctx, n) => {
    profile(p, 'extrude', n);
    positive(h, 'extrude: altura', n);
    const top = isList(sc) ? point2(sc, 'extrude: escala', n) : nonNegative(sc, 'extrude: escala do topo', n);
    if (isList(top)) top.forEach((c) => nonNegative(c, 'extrude: escala do topo', n));
    return geometry(ctx, n, (k) => k.extrude(p, h, (num(t, 'extrude: torção', n) * 180) / Math.PI, top));
  }, 'extrude(P, h, θ?, k?) — prisma de z = 0 a z = h; θ torce o topo, k o escala');
  def('revolve(P, θ?, n?)', ([p, t = 2 * Math.PI, s], ctx, n) => {
    profile(p, 'revolve', n);
    const deg = (positive(t, 'revolve: ângulo', n) * 180) / Math.PI;
    const b = geometry(ctx, n, (k) => k.bbox2(p));
    if (!(b.max[0] > 0)) fail('revolve: o perfil precisa ter pontos com x > 0 (gira em torno do eixo y)', n);
    return geometry(ctx, n, (k) => k.revolve(p, Math.min(deg, 360), segments(s, n)));
  }, 'revolve(P, θ?) — gira o perfil (x ≥ 0) em torno do eixo y, que vira o eixo z');

  // ----- isometries -----
  def('T(x, y?, z?)', ([x, y, z], ctx, n) => iso(M.translation(...vectorArgs(x, y, z, 'T', n))), 'T(x, y, z) ou T(v) — translação');
  def('Tx(d)', ([d], ctx, n) => iso(M.translation(num(d, 'Tx', n), 0, 0)));
  def('Ty(d)', ([d], ctx, n) => iso(M.translation(0, num(d, 'Ty', n), 0)));
  def('Tz(d)', ([d], ctx, n) => iso(M.translation(0, 0, num(d, 'Tz', n))));
  def('Rx(θ)', ([t], ctx, n) => iso(M.rotationX(num(t, 'Rx', n))), 'Rx(θ) — rotação em torno de x');
  def('Ry(θ)', ([t], ctx, n) => iso(M.rotationY(num(t, 'Ry', n))), 'Ry(θ) — rotação em torno de y');
  def('Rz(θ)', ([t], ctx, n) => iso(M.rotationZ(num(t, 'Rz', n))), 'Rz(θ) — rotação em torno de z');
  def('R(axis, θ, p?)', ([axis, t, p], ctx, n) => {
    const a = vec3(axis, 'R: eixo', n);
    if (a.every((c) => c === 0)) fail('R: eixo nulo', n);
    const m = M.rotationAxis(a, num(t, 'R: ângulo', n));
    return iso(p === undefined ? m : M.about(m, vec3(p, 'R: ponto', n)));
  }, 'R(eixo, θ, ponto?) — rotação em torno de um eixo');
  def('M(normal, p?)', ([normal, p], ctx, n) => {
    const v = vec3(normal, 'M: normal', n);
    if (v.every((c) => c === 0)) fail('M: normal nula', n);
    const m = M.reflection(v);
    return iso(p === undefined ? m : M.about(m, vec3(p, 'M: ponto', n)));
  }, 'M(normal, ponto?) — reflexão num plano');
  def('inverse(g)', ([g], ctx, n) => (g instanceof Iso ? invert(g, n) : fail(`inverse: esperava transformação, recebi ${typeName(g)}`, n)));

  // ----- scalings (not isometries: they compose with them into affine maps) -----
  const factor = (v, what, n) => (num(v, what, n) !== 0 ? v : fail(`${what}: fator de escala zero achataria o sólido`, n));
  const scale = (name) => ([x, y, z], ctx, n) => {
    let f;
    if (isList(x)) {
      if (y !== undefined || z !== undefined) fail(`${name}: passe um vetor ou até três números, não ambos`, n);
      f = vec3(x, name, n);
    } else if (y === undefined && z === undefined) {
      f = [x, x, x]; // uniform: a similarity
    } else {
      f = [x, y ?? 1, z ?? 1];
    }
    return iso(M.scaling(...f.map((k) => factor(k, name, n))));
  };
  def('S(x, y?, z?)', scale('S'), 'S(k) uniforme · S(x, y, z) ou S(v) por eixo — escala a partir da origem');
  def('scale(x, y?, z?)', scale('scale'), 'scale(…) — o mesmo que S(…)');
  def('Sx(k)', ([k], ctx, n) => iso(M.scaling(factor(k, 'Sx', n), 1, 1)));
  def('Sy(k)', ([k], ctx, n) => iso(M.scaling(1, factor(k, 'Sy', n), 1)));
  def('Sz(k)', ([k], ctx, n) => iso(M.scaling(1, 1, factor(k, 'Sz', n))));
  def('at(g, p)', ([g, p], ctx, n) => {
    if (!(g instanceof Iso)) fail(`at: esperava transformação, recebi ${typeName(g)}`, n);
    return iso(M.about(g.m, vec3(p, 'at: ponto', n)));
  }, 'at(g, p) — a transformação g centrada no ponto p: T(p) ∘ g ∘ T(-p)');
  def('isometry(g)', ([g], ctx, n) => (g instanceof Iso ? g.rigid : fail(`isometry: esperava transformação, recebi ${typeName(g)}`, n)),
    'isometry(g) — g preserva distâncias?');

  // ----- solid and profile queries, placement -----
  const shape = (v, what, n) => (v instanceof Solid || v instanceof Profile ? v : fail(`${what}: esperava sólido ou perfil, recebi ${typeName(v)}`, n));
  const bounds = (s, ctx, n, what = 'bounds') => {
    shape(s, what, n);
    return geometry(ctx, n, (k) => (s instanceof Profile ? k.bbox2(s) : k.bbox(s)));
  };
  def('bounds(S)', ([s], ctx, n) => { const b = bounds(s, ctx, n); return [b.min, b.max]; }, 'bounds(S) — [[min], [max]]');
  def('size(S)', ([s], ctx, n) => { const b = bounds(s, ctx, n, 'size'); return b.max.map((v, i) => v - b.min[i]); });
  def('volume(S)', ([s], ctx, n) => {
    if (s instanceof Profile) fail('volume: um perfil é plano e não tem volume (use area)', n);
    return geometry(ctx, n, (k) => k.volume(solid(s, 'volume', n)));
  });
  def('area(S)', ([s], ctx, n) => geometry(ctx, n, (k) => (shape(s, 'area', n) instanceof Profile ? k.area2(s) : k.area(s))),
    'area(S) — área da superfície do sólido, ou área do perfil');
  def('isempty(S)', ([s], ctx, n) => geometry(ctx, n, (k) => (shape(s, 'isempty', n) instanceof Profile ? k.isEmpty2(s) : k.isEmpty(s))));
  def('center(S)', ([s], ctx, n) => {
    const b = bounds(s, ctx, n, 'center');
    if (!b.min.every(Number.isFinite)) return s;
    const c = b.min.map((v, i) => -(v + b.max[i]) / 2);
    if (s instanceof Profile) return geometry(ctx, n, (k) => k.transform2(s, [1, 0, 0, 0, 1, 0, c[0], c[1], 1]));
    return geometry(ctx, n, (k) => k.transform(s, M.translation(...c)));
  }, 'center(S) — centraliza a caixa envolvente na origem');
  def('ground(S)', ([s], ctx, n) => {
    if (s instanceof Profile) fail('ground: um perfil já está no plano z = 0', n);
    const b = bounds(s, ctx, n, 'ground');
    if (!Number.isFinite(b.min[2])) return s;
    return geometry(ctx, n, (k) => k.transform(s, M.translation(0, 0, -b.min[2])));
  }, 'ground(S) — apoia o sólido em z = 0 (mesa de impressão)');

  // ----- math -----
  const math1 = (name, f, doc) => def(`${name}(x)`, ([x], ctx, n) => {
    const r = f(num(x, name, n));
    if (Number.isNaN(r)) fail(`${name}(${format(x)}) não está definido`, n);
    return r;
  }, doc);
  math1('sin', Math.sin); math1('cos', Math.cos); math1('tan', Math.tan);
  math1('asin', Math.asin); math1('acos', Math.acos); math1('atan', Math.atan);
  math1('sqrt', Math.sqrt); math1('abs', Math.abs); math1('floor', Math.floor); math1('ceil', Math.ceil);
  math1('round', Math.round); math1('sign', Math.sign); math1('exp', Math.exp); math1('ln', Math.log);
  def('atan2(y, x)', ([y, x], ctx, n) => Math.atan2(num(y, 'atan2', n), num(x, 'atan2', n)));
  def('log(x, base?)', ([x, b = 10], ctx, n) => {
    if (num(x, 'log', n) <= 0) fail('log de número não positivo', n);
    return Math.log(x) / Math.log(num(b, 'log: base', n));
  });
  def('clamp(x, lo, hi)', ([x, lo, hi], ctx, n) => Math.min(num(hi, 'clamp', n), Math.max(num(lo, 'clamp', n), num(x, 'clamp', n))));
  def('lerp(a, b, t)', ([a, b, t], ctx, n) => binary('+', a, binary('·', num(t, 'lerp: t', n), binary('-', b, a, ctx, n), ctx, n), ctx, n));
  const numbersOf = (items, name, n) => {
    const xs = items.length === 1 && (isList(items[0]) || items[0] instanceof Range) ? iterate(items[0], n) : items;
    if (!xs.length) fail(`${name} de uma coleção vazia`, n);
    return xs.map((x) => num(x, name, n));
  };
  def('min(xs...)', (items, ctx, n) => Math.min(...numbersOf(items, 'min', n)), 'min(a, b, …) ou min(xs)');
  def('max(xs...)', (items, ctx, n) => Math.max(...numbersOf(items, 'max', n)), 'max(a, b, …) ou max(xs)');
  def('norm(v)', ([v], ctx, n) => {
    if (!isList(v) || !v.every(isNumber)) fail(`norm: esperava vetor, recebi ${typeName(v)}`, n);
    return Math.hypot(...v);
  });
  def('unit(v)', ([v], ctx, n) => {
    const l = P.norm.fn([v], ctx, n);
    if (l === 0) fail('unit: vetor nulo', n);
    return v.map((x) => x / l);
  });
  def('dot(a, b)', ([a, b], ctx, n) => binary('·', a, b, ctx, n));
  def('cross(a, b)', ([a, b], ctx, n) => binary('×', a, b, ctx, n));
  def('dist(a, b)', ([a, b], ctx, n) => P.norm.fn([binary('-', a, b, ctx, n)], ctx, n));

  // ----- lists (data-last, so they work with |> and partial application) -----
  def('len(xs)', ([xs], ctx, n) => (xs instanceof Range ? xs.length : iterate(xs, n).length));
  def('range(a, b, step?)', ([a, b, s = 1], ctx, n) => {
    num(a, 'range', n); num(b, 'range', n); num(s, 'range: passo', n);
    if (s === 0) fail('range: passo zero', n);
    return new Range(a, b, s);
  }, 'range(a, b, passo) — de a até b (inclusive)');
  def('map(f, xs)', ([f, xs], ctx, n) => iterate(xs, n).map((x) => callValue(f, [x], {}, ctx, n)), 'map(f, xs)');
  def('filter(p, xs)', ([p, xs], ctx, n) => iterate(xs, n).filter((x) => bool(callValue(p, [x], {}, ctx, n), 'filter', n)));
  def('fold(f, init, xs)', ([f, init, xs], ctx, n) => iterate(xs, n).reduce((acc, x) => callValue(f, [acc, x], {}, ctx, n), init),
    'fold(f, inicial, xs) — redução pela esquerda');
  def('reduce(f, xs)', ([f, xs], ctx, n) => {
    const items = iterate(xs, n);
    if (!items.length) fail('reduce de uma coleção vazia (use fold com um valor inicial)', n);
    return items.slice(1).reduce((acc, x) => callValue(f, [acc, x], {}, ctx, n), items[0]);
  }, 'reduce(f, xs) — fold sem valor inicial');
  def('zip(xs, ys)', ([xs, ys], ctx, n) => {
    const a = iterate(xs, n), b = iterate(ys, n);
    return a.slice(0, Math.min(a.length, b.length)).map((x, i) => [x, b[i]]);
  });
  def('enumerate(xs)', ([xs], ctx, n) => iterate(xs, n).map((x, i) => [i, x]));
  def('reverse(xs)', ([xs], ctx, n) => iterate(xs, n).slice().reverse());
  def('sort(xs)', ([xs], ctx, n) => iterate(xs, n).map((x) => num(x, 'sort', n)).sort((a, b) => a - b));
  def('flatten(xs)', ([xs], ctx, n) => iterate(xs, n).flatMap((x) => (isList(x) || x instanceof Range ? iterate(x, n) : [x])));
  def('take(k, xs)', ([k, xs], ctx, n) => iterate(xs, n).slice(0, Math.max(0, int(k, 'take', n))));
  def('drop(k, xs)', ([k, xs], ctx, n) => iterate(xs, n).slice(Math.max(0, int(k, 'drop', n))));
  def('first(xs)', ([xs], ctx, n) => { const a = iterate(xs, n); return a.length ? a[0] : fail('first de lista vazia', n); });
  def('last(xs)', ([xs], ctx, n) => { const a = iterate(xs, n); return a.length ? a[a.length - 1] : fail('last de lista vazia', n); });
  def('sum(xs)', ([xs], ctx, n) => { const a = iterate(xs, n); return a.length ? a.slice(1).reduce((s, x) => binary('+', s, x, ctx, n), a[0]) : 0; });
  def('prod(xs)', ([xs], ctx, n) => iterate(xs, n).reduce((p, x) => binary('·', p, x, ctx, n), 1));
  def('any(xs)', ([xs], ctx, n) => iterate(xs, n).some((x) => bool(x, 'any', n)));
  def('all(xs)', ([xs], ctx, n) => iterate(xs, n).every((x) => bool(x, 'all', n)));
  def('count(p, xs)', ([p, xs], ctx, n) => iterate(xs, n).filter((x) => bool(callValue(p, [x], {}, ctx, n), 'count', n)).length);
  def('indexof(x, xs)', ([x, xs], ctx, n) => iterate(xs, n).findIndex((y) => deepEqual(x, y)));
  def('repeat(x, k)', ([x, k], ctx, n) => Array.from({ length: Math.max(0, int(k, 'repeat', n)) }, () => x));
  def('iterate(f, k, x)', ([f, k, x], ctx, n) => {
    const out = [x];
    for (let i = 0; i < int(k, 'iterate', n); i++) out.push(callValue(f, [out[out.length - 1]], {}, ctx, n));
    return out;
  }, 'iterate(f, k, x) — [x, f(x), …, fᵏ(x)]');

  // ⋃ / ⋂ by name, for pipelines: xs |> union
  def('union(xs)', ([xs], ctx, n) => bigOp('⋃', xs, ctx, n), 'union(xs) — o mesmo que ⋃ xs');
  def('intersection(xs)', ([xs], ctx, n) => bigOp('⋂', xs, ctx, n), 'intersection(xs) — o mesmo que ⋂ xs');
  return P;
}

// Empty solid needs a kernel, so it is bound per evaluation.
export function bindKernelConstants(prelude, kernel) {
  const empty = kernel.empty();
  prelude['∅'] = prelude.empty = empty;
  return prelude;
}
