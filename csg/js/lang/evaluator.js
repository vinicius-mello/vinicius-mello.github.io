// Tree-walking evaluator. Solids are built eagerly through the kernel in ctx.
import { LangError } from './errors.js';
import { GeometryError } from '../geom/kernel.js';
import * as M from '../geom/mat4.js';
import {
  Range, Iso, Closure, Builtin, Partial, Solid, MAX_LIST,
  isFunction, isNumber, isList, typeName, format, deepEqual, functionName,
} from './values.js';

export class Env {
  constructor(parent = null) {
    this.parent = parent;
    this.vars = new Map();
  }
  hasOwn(name) { return this.vars.has(name); }
  has(name) { return this.hasOwn(name) || (this.parent?.has(name) ?? false); }
  lookup(name, node) {
    for (let e = this; e; e = e.parent) {
      if (e.hasOwn(name)) return e.resolve(name, node);
    }
    throw new LangError(`'${name}' não está definido`, node.span);
  }
  resolve(name) { return this.vars.get(name); }
  set(name, value) { this.vars.set(name, value); }
}

export const LIMITS = { steps: 20_000_000, depth: 400 };

export function makeContext(kernel, limits = LIMITS) {
  return { kernel, steps: 0, depth: 0, limits };
}

const fail = (msg, node) => { throw new LangError(msg, node?.span); };

function tick(ctx, node) {
  if (++ctx.steps > ctx.limits.steps) fail('limite de passos de avaliação excedido (laço infinito ou modelo grande demais?)', node);
}

// ---------- helpers shared with builtins ----------
export function iterate(v, node, what = 'coleção') {
  if (Array.isArray(v)) return v;
  if (v instanceof Range) {
    if (v.length > MAX_LIST) fail(`intervalo grande demais (${v.length} elementos)`, node);
    return v.toArray();
  }
  fail(`esperava ${what} (lista ou intervalo), recebi ${typeName(v)}`, node);
}

export function geometry(ctx, node, f) {
  try {
    return f(ctx.kernel);
  } catch (e) {
    if (e instanceof GeometryError || e instanceof RangeError) fail(e.message, node);
    throw e;
  }
}

function flattenSolids(items, node, op) {
  const out = [];
  const walk = (x) => {
    if (x instanceof Solid) out.push(x);
    else if (Array.isArray(x)) x.forEach(walk);
    else if (x instanceof Range) fail(`${op} espera sólidos, recebeu um intervalo de números`, node);
    else fail(`${op} espera sólidos, recebeu ${typeName(x)}`, node);
  };
  items.forEach(walk);
  return out;
}

// ---------- operators ----------
const numeric = (v) => isList(v) && v.every(isNumber);

function elementwise(op, a, b, node, f) {
  if (a.length !== b.length) fail(`'${op}' entre vetores de tamanhos diferentes (${a.length} e ${b.length})`, node);
  return a.map((x, i) => f(x, b[i]));
}

function applyIso(g, x, ctx, node) {
  if (x instanceof Solid) return geometry(ctx, node, (k) => k.transform(x, g.m));
  if (x instanceof Iso) return new Iso(M.multiply(g.m, x.m));
  if (numeric(x) && x.length === 3) return M.transformPoint(g.m, x);
  if (isList(x)) return x.map((y) => applyIso(g, y, ctx, node));
  fail(`uma ${g.kind()} se aplica a sólidos, pontos [x, y, z] ou listas deles; recebeu ${typeName(x)}`, node);
}

export function invert(g, node) {
  try {
    return new Iso(M.invertAffine(g.m));
  } catch (e) {
    fail(e.message, node);
  }
}

function isoPower(g, n, node) {
  if (!Number.isInteger(n)) fail(`potência de ${g.kind()} precisa de expoente inteiro`, node);
  const base = n < 0 ? invert(g, node).m : g.m;
  let acc = M.identity();
  for (let k = Math.abs(n); k > 0; k--) acc = M.multiply(acc, base);
  return new Iso(acc);
}

function listUnion(a, b) {
  const out = a.slice();
  for (const x of b) if (!out.some((y) => deepEqual(x, y))) out.push(x);
  return out;
}

export function binary(op, a, b, ctx, node) {
  const bad = (hint = '') =>
    fail(`'${op}' não se aplica a ${typeName(a)} e ${typeName(b)}${hint}`, node);
  switch (op) {
    case '+':
      if (isNumber(a) && isNumber(b)) return a + b;
      if (numeric(a) && numeric(b)) return elementwise(op, a, b, node, (x, y) => x + y);
      if (a instanceof Solid && b instanceof Solid) return geometry(ctx, node, (k) => k.union(a, b));
      return bad();
    case '-':
      if (isNumber(a) && isNumber(b)) return a - b;
      if (numeric(a) && numeric(b)) return elementwise(op, a, b, node, (x, y) => x - y);
      if (a instanceof Solid && b instanceof Solid) return geometry(ctx, node, (k) => k.subtract(a, b));
      return bad();
    case '·':
      if (isNumber(a) && isNumber(b)) return a * b;
      if (isNumber(a) && numeric(b)) return b.map((x) => a * x);
      if (numeric(a) && isNumber(b)) return a.map((x) => x * b);
      if (numeric(a) && numeric(b)) {
        return elementwise(op, a, b, node, (x, y) => x * y).reduce((s, x) => s + x, 0);
      }
      if (a instanceof Iso) return applyIso(a, b, ctx, node);
      if (a instanceof Solid && b instanceof Solid) return bad(' (para interseção use ∩)');
      if (b instanceof Iso) return bad(` (a ${b.kind()} vem à esquerda: g · S)`);
      return bad();
    case '×':
      if (isNumber(a) && isNumber(b)) return a * b;
      if (numeric(a) && numeric(b) && a.length === 3 && b.length === 3) {
        return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
      }
      return bad();
    case '/':
      if (isNumber(a) && isNumber(b)) {
        if (b === 0) fail('divisão por zero', node);
        return a / b;
      }
      if (numeric(a) && isNumber(b)) {
        if (b === 0) fail('divisão por zero', node);
        return a.map((x) => x / b);
      }
      return bad();
    case 'mod':
      if (isNumber(a) && isNumber(b)) {
        if (b === 0) fail('mod por zero', node);
        return ((a % b) + b) % b;
      }
      return bad();
    case '^':
      if (isNumber(a) && isNumber(b)) {
        const r = a ** b;
        if (Number.isNaN(r)) fail(`${format(a)}^${format(b)} não é um número real`, node);
        return r;
      }
      if (a instanceof Iso && isNumber(b)) return isoPower(a, b, node);
      return bad();
    case '∘':
      if (a instanceof Iso && b instanceof Iso) return new Iso(M.multiply(a.m, b.m));
      if (isFunction(a) && isFunction(b)) {
        return new Builtin(`${functionName(a)} ∘ ${functionName(b)}`, [{ name: 'x' }],
          ([x], c, n) => callValue(a, [callValue(b, [x], {}, c, n)], {}, c, n));
      }
      return bad();
    case '∪':
      if (a instanceof Solid && b instanceof Solid) return geometry(ctx, node, (k) => k.union(a, b));
      if (isList(a) && isList(b)) return listUnion(a, b);
      return bad();
    case '∩':
      if (a instanceof Solid && b instanceof Solid) return geometry(ctx, node, (k) => k.intersect(a, b));
      if (isList(a) && isList(b)) return a.filter((x) => b.some((y) => deepEqual(x, y)));
      return bad();
    case '∖':
      if (a instanceof Solid && b instanceof Solid) return geometry(ctx, node, (k) => k.subtract(a, b));
      if (isList(a) && isList(b)) return a.filter((x) => !b.some((y) => deepEqual(x, y)));
      return bad();
    case '△':
      if (a instanceof Solid && b instanceof Solid) return geometry(ctx, node, (k) => k.symdiff(a, b));
      if (isList(a) && isList(b)) {
        return [...a.filter((x) => !b.some((y) => deepEqual(x, y))), ...b.filter((x) => !a.some((y) => deepEqual(x, y)))];
      }
      return bad();
    case '⊕':
      if (a instanceof Solid && b instanceof Solid) return geometry(ctx, node, (k) => k.minkowski(a, b));
      return bad();
    case '++':
      if (isList(a) && isList(b)) return a.concat(b);
      if (a instanceof Range || b instanceof Range) {
        return iterate(a, node).concat(iterate(b, node));
      }
      return bad();
    case '|>':
      if (!isFunction(b)) fail(`à direita de '|>' deve haver uma função, recebi ${typeName(b)}`, node);
      return callValue(b, [a], {}, ctx, node);
    case '∧': case '∨':
      if (typeof a !== 'boolean' || typeof b !== 'boolean') return bad();
      return op === '∧' ? a && b : a || b;
    default:
      if (COMPARE_OPS.has(op)) return compare(op, a, b, node);
      fail(`operador desconhecido ${op}`, node);
  }
}

const COMPARE_OPS = new Set(['=', '≠', '<', '>', '≤', '≥', '∈', '∉']);

function compare(op, a, b, node) {
  switch (op) {
    case '=': return deepEqual(a, b);
    case '≠': return !deepEqual(a, b);
    case '∈': case '∉': {
      let r;
      if (b instanceof Range) r = b.includes(a);
      else if (isList(b)) r = b.some((y) => deepEqual(a, y));
      else fail(`'${op}' espera uma lista ou intervalo à direita, recebeu ${typeName(b)}`, node);
      return op === '∈' ? r : !r;
    }
  }
  if (!isNumber(a) || !isNumber(b)) fail(`'${op}' compara números, recebeu ${typeName(a)} e ${typeName(b)}`, node);
  switch (op) {
    case '<': return a < b;
    case '>': return a > b;
    case '≤': return a <= b;
    case '≥': return a >= b;
  }
}

function unary(op, v, node) {
  switch (op) {
    case '-':
      if (isNumber(v)) return -v;
      if (numeric(v)) return v.map((x) => -x);
      break;
    case '√':
      if (isNumber(v)) {
        if (v < 0) fail(`√ de número negativo (${format(v)})`, node);
        return Math.sqrt(v);
      }
      break;
    case '¬':
      if (typeof v === 'boolean') return !v;
      break;
  }
  fail(`'${op}' não se aplica a ${typeName(v)}`, node);
}

export function bigOp(op, coll, ctx, node) {
  const items = iterate(coll, node, `a coleção de ${op}`);
  switch (op) {
    case '⋃': return geometry(ctx, node, (k) => k.unionAll(flattenSolids(items, node, '⋃')));
    case '⋂': {
      const solids = flattenSolids(items, node, '⋂');
      if (!solids.length) fail('⋂ de uma família vazia não é um sólido limitado', node);
      return geometry(ctx, node, (k) => k.intersectAll(solids));
    }
    case 'Σ':
      if (!items.length) return 0;
      return items.slice(1).reduce((s, x) => binary('+', s, x, ctx, node), items[0]);
    case '∏':
      return items.reduce((p, x) => binary('·', p, x, ctx, node), 1);
  }
}

// ---------- calls ----------
export function callValue(f, positional, named, ctx, node) {
  if (f instanceof Partial) {
    return callValue(f.fn, [...f.args, ...positional], named, ctx, node);
  }
  if (f instanceof Iso) {
    if (positional.length !== 1 || Object.keys(named).length) fail(`uma ${f.kind()} recebe exatamente um argumento`, node);
    return applyIso(f, positional[0], ctx, node);
  }
  if (!(f instanceof Closure || f instanceof Builtin)) {
    fail(`${typeName(f)} não é uma função`, node);
  }
  const name = functionName(f);
  if (f instanceof Builtin && f.variadic) {
    if (Object.keys(named).length) fail(`${name} não aceita argumentos nomeados`, node);
    return f.fn(positional, ctx, node);
  }
  const params = f.params;
  const optional = (p) => p.optional || p.default;
  const required = params.filter((p) => !optional(p)).length;
  if (positional.length > params.length) {
    fail(`${name} recebe no máximo ${params.length} argumento${params.length === 1 ? '' : 's'}, recebeu ${positional.length}`, node);
  }
  const namedKeys = Object.keys(named);
  // Partial application: fewer positional arguments than required, none named.
  if (!namedKeys.length && positional.length > 0 && positional.length < required) {
    return new Partial(f, positional);
  }
  const args = new Array(params.length);
  positional.forEach((v, i) => { args[i] = v; });
  for (const key of namedKeys) {
    const idx = params.findIndex((p) => p.name === key);
    if (idx < 0) fail(`${name} não tem parâmetro '${key}' (parâmetros: ${params.map((p) => p.name).join(', ')})`, node);
    if (idx < positional.length) fail(`'${key}' foi passado duas vezes`, node);
    args[idx] = named[key];
  }
  const missing = params.filter((p, i) => args[i] === undefined && !optional(p)).map((p) => p.name);
  if (missing.length) fail(`${name}: falta${missing.length > 1 ? 'm' : ''} ${missing.join(', ')}`, node);

  if (f instanceof Builtin) return f.fn(args, ctx, node);

  if (++ctx.depth > ctx.limits.depth) fail(`recursão profunda demais em ${name}`, node);
  try {
    const env = new Env(f.env);
    params.forEach((p, i) => {
      const v = args[i] !== undefined ? args[i] : evaluate(p.default, env, ctx);
      if (p.pattern) bindPattern(p.pattern, v, env, node);
      else env.set(p.name, v);
    });
    return evaluate(f.body, env, ctx);
  } finally {
    ctx.depth--;
  }
}

// ---------- sections: (∪) (A ∪) (· S) (⋃) ----------
const UNARY_SECTION = { '√': '√', '¬': '¬' };

function section(node, env, ctx) {
  const { op } = node;
  const label = `(${op})`;
  if (op in UNARY_SECTION) return new Builtin(label, [{ name: 'x' }], ([x], c, n) => unary(op, x, n));
  if (['⋃', '⋂', 'Σ', '∏'].includes(op)) return new Builtin(label, [{ name: 'xs' }], ([xs], c, n) => bigOp(op, xs, c, n));
  if (node.left) {
    const a = evaluate(node.left, env, ctx);
    return new Builtin(label, [{ name: 'x' }], ([b], c, n) => binary(op, a, b, c, node));
  }
  if (node.right) {
    const b = evaluate(node.right, env, ctx);
    return new Builtin(label, [{ name: 'x' }], ([a], c, n) => binary(op, a, b, c, node));
  }
  return new Builtin(label, [{ name: 'a' }, { name: 'b' }], ([a, b], c) => binary(op, a, b, c, node));
}

// ---------- comprehension ----------
function comprehension(node, env, ctx, out) {
  const { clauses, body } = node;
  const step = (i, scope) => {
    tick(ctx, node);
    if (i === clauses.length) {
      if (out.length >= MAX_LIST) fail('compreensão grande demais', node);
      out.push(evaluate(body, scope, ctx));
      return;
    }
    const c = clauses[i];
    if (c.type === 'Generator') {
      const items = iterate(evaluate(c.source, scope, ctx), c.source);
      for (const item of items) {
        const inner = new Env(scope);
        bindPattern(c.pattern, item, inner, c);
        step(i + 1, inner);
      }
    } else if (c.type === 'LetClause') {
      const inner = new Env(scope);
      inner.set(c.name, evaluate(c.value, scope, ctx));
      step(i + 1, inner);
    } else {
      const v = evaluate(c.cond, scope, ctx);
      if (typeof v !== 'boolean') fail(`condição deve ser booleana, recebi ${typeName(v)}`, c);
      if (v) step(i + 1, scope);
    }
  };
  step(0, env);
  return out;
}

function bindPattern(pattern, value, env, node) {
  if (typeof pattern === 'string') { env.set(pattern, value); return; }
  if (!isList(value) || value.length !== pattern.length) {
    fail(`não é possível desestruturar ${typeName(value)} em [${pattern.join(', ')}]`, node);
  }
  pattern.forEach((name, i) => env.set(name, value[i]));
}

// ---------- main dispatch ----------
export function evaluate(node, env, ctx) {
  tick(ctx, node);
  switch (node.type) {
    case 'Num': return node.value;
    case 'Bool': return node.value;
    case 'Ident': return env.lookup(node.name, node);
    case 'List': return node.items.map((x) => evaluate(x, env, ctx));
    case 'Comprehension': return comprehension(node, env, ctx, []);
    case 'Range': {
      const lo = evaluate(node.lo, env, ctx), hi = evaluate(node.hi, env, ctx);
      if (!isNumber(lo) || !isNumber(hi)) fail(`limites de intervalo devem ser números, recebi ${typeName(lo)} e ${typeName(hi)}`, node);
      return new Range(lo, hi, 1, node.exclusive);
    }
    case 'Degrees': {
      const v = evaluate(node.expr, env, ctx);
      if (!isNumber(v)) fail(`° se aplica a números, recebi ${typeName(v)}`, node);
      return (v * Math.PI) / 180;
    }
    case 'Unary': return unary(node.op, evaluate(node.expr, env, ctx), node);
    case 'Binary': {
      if (node.op === '∧' || node.op === '∨') {
        const a = evaluate(node.left, env, ctx);
        if (typeof a !== 'boolean') fail(`'${node.op}' espera booleanos, recebeu ${typeName(a)}`, node.left);
        if (node.op === '∧' ? !a : a) return a;
        const b = evaluate(node.right, env, ctx);
        if (typeof b !== 'boolean') fail(`'${node.op}' espera booleanos, recebeu ${typeName(b)}`, node.right);
        return b;
      }
      const a = evaluate(node.left, env, ctx);
      const b = evaluate(node.right, env, ctx);
      return binary(node.op, a, b, ctx, node);
    }
    case 'Compare': {
      let left = evaluate(node.operands[0], env, ctx);
      for (let i = 0; i < node.ops.length; i++) {
        const right = evaluate(node.operands[i + 1], env, ctx);
        if (!compare(node.ops[i], left, right, node)) return false;
        left = right;
      }
      return true;
    }
    case 'Call': {
      const f = evaluate(node.fn, env, ctx);
      const positional = [], named = {};
      for (const a of node.args) {
        const v = evaluate(a.value, env, ctx);
        if (a.name) named[a.name] = v;
        else positional.push(v);
      }
      return callValue(f, positional, named, ctx, node);
    }
    case 'Index': {
      const target = evaluate(node.target, env, ctx);
      const i = evaluate(node.index, env, ctx);
      if (!Number.isInteger(i)) fail(`índice deve ser inteiro, recebi ${format(i)}`, node.index);
      if (target instanceof Range) {
        if (i < 0 || i >= target.length) fail(`índice ${i} fora do intervalo (tamanho ${target.length})`, node.index);
        return target.at(i);
      }
      if (!isList(target)) fail(`não é possível indexar ${typeName(target)}`, node);
      if (i < 0 || i >= target.length) fail(`índice ${i} fora da lista (tamanho ${target.length})`, node.index);
      return target[i];
    }
    case 'Field': {
      const target = evaluate(node.target, env, ctx);
      const idx = { x: 0, y: 1, z: 2 }[node.name];
      if (idx === undefined) fail(`componente desconhecido '.${node.name}' (use .x, .y ou .z)`, node);
      if (!isList(target) || target.length <= idx) fail(`'.${node.name}' se aplica a vetores, recebi ${typeName(target)}`, node);
      return target[idx];
    }
    case 'Lambda': return new Closure(null, node.params, node.body, env);
    case 'If': {
      const c = evaluate(node.cond, env, ctx);
      if (typeof c !== 'boolean') fail(`condição do 'if' deve ser booleana, recebi ${typeName(c)}`, node.cond);
      return evaluate(c ? node.then : node.otherwise, env, ctx);
    }
    case 'Let': {
      const scope = new Env(env);
      for (const b of node.bindings) {
        if (b.params) scope.set(b.name, new Closure(b.name, b.params, b.value, scope));
        else scope.set(b.name, evaluate(b.value, scope, ctx));
      }
      return evaluate(node.body, scope, ctx);
    }
    case 'BigOp': return bigOp(node.op, evaluate(node.coll, env, ctx), ctx, node);
    case 'Section': return section(node, env, ctx);
    default:
      fail(`nó desconhecido ${node.type}`, node);
  }
}
