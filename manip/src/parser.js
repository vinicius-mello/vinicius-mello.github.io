// Gramática comum aos parsers ASCII e LaTeX. Recebe uma lista de tokens
// e devolve a árvore, sem simplificar nada:
//   num, id, fn            números, símbolos, funções (v = operador MathJSON)
//   + - * / ^ ( ) ,        operadores e pontuação
//   rel                    relação entre os lados (v = Equal, Less, ...)
//   ;                      separa as equações de um sistema
//   frac, sqrt, { } [ ]    construções do LaTeX
//   big (v = Sum/Product)  somatório/produtório, seguido de _(k=a)^b e do termo
//   binom, !               \binom{n}{k} e fatorial (pós-fixo)
//   lim, to                lim_(x→a) termo (e a^+ / a^- nos laterais)
//   deriv (v, order)       d/dx termo, d²/dx² termo
//   int                    ∫ termo dx, ∫_a^b termo dx (o termo vai até o d<x>)
//   evopen, evclose        [F]_a^b (ou \left. F \right|_a^b)
//   id com primes          f'(x), y'
// Parênteses digitados viram Delimiter, exceto onde a notação já mostra o
// agrupamento (numerador/denominador, expoente, argumento de função).

import { num, sym, fn, call, walk, FUNCTION_LETTERS, INFINITY, IMAGINARY } from './ast.js';

// A mensagem é uma chave de i18n.js (com parâmetros), traduzida na hora de
// mostrar.
export class ParseError extends Error {
  constructor(key, pos, params = {}) {
    super(key);
    this.key = key;
    this.params = params;
    this.pos = pos;
  }
}

const unwrap = (n) => (n.op === 'Delimiter' ? n.args[0] : n);
const ARITY = { Root: 2, Binomial: 2 };
const ATOM_START = new Set(['num', 'id', 'fn', '(', 'frac', 'sqrt', '{', '|', 'big', 'binom', 'lim', 'deriv', 'int', 'evopen']);

// d/dx escrito como fração: \frac{d}{dx}, \frac{d^2}{dx^2}. Devolve a variável e a ordem.
function derivFrac(a, b) {
  const isD = (x) => x.op === 'Symbol' && x.name === 'd';
  // dy/dx, d²y/dx²: a função vem no numerador.
  let body = null;
  if (a.op === 'Multiply' && a.args.length >= 2 && (isD(a.args[0]) || (a.args[0].op === 'Power' && isD(a.args[0].args[0])))) {
    const rest = a.args.slice(1);
    body = rest.length === 1 ? rest[0] : fn('Multiply', ...rest);
    a = a.args[0];
  }
  const order = (x) => (x.op === 'Power' && x.args[1].op === 'Number' ? Number(x.args[1].value) : x.op === 'Symbol' ? 1 : 0);
  const top = isD(a) ? 1 : a.op === 'Power' && isD(a.args[0]) ? order(a) : 0;
  if (!top || b.op !== 'Multiply' || b.args.length !== 2 || !isD(b.args[0])) return null;
  const v = b.args[1].op === 'Power' ? b.args[1].args[0] : b.args[1];
  if (v.op !== 'Symbol' || order(b.args[1]) !== top) return null;
  return { v: v.name, order: top, body };
}

// Variável de [F]_a^b quando não foi escrita: a única letra de F (ou x).
function guessVariable(F) {
  const names = new Set();
  walk(F, (n) => { if (n.op === 'Symbol' && ![INFINITY, IMAGINARY, 'e', 'pi', 'C'].includes(n.name)) names.add(n.name); });
  return names.size === 1 ? [...names][0] : 'x';
}

export function parseTokens(toks) {
  let k = 0;
  // Dentro de |...|, uma barra fecha o módulo em vez de abrir outro.
  let absDepth = 0;
  // Dentro de ∫, "d" seguido de uma letra é o dx que fecha o integrando.
  let intDepth = 0;
  const isDifferential = (i) => toks[i].t === 'id' && toks[i].v === 'd' && toks[i + 1]?.t === 'id';
  // Lado do limite (x → 0⁺), lido em power() enquanto se lê o ponto.
  let side = null;
  const startsAtom = (tok) => ATOM_START.has(tok.t) && !(tok.t === '|' && absDepth > 0)
    && !(intDepth > 0 && tok === toks[k] && isDifferential(k));
  const peek = () => toks[k];
  const next = () => toks[k++];
  const expect = (t) => {
    const tok = next();
    if (tok.t !== t) {
      throw new ParseError(tok.t === 'end' ? 'err.missing' : 'err.expected', tok.pos, { t });
    }
    return tok;
  };

  function expr() {
    const terms = [];
    let tok = peek();
    if (tok.t === '-') { next(); terms.push(fn('Negate', term())); }
    else { if (tok.t === '+') next(); terms.push(term()); }
    while ((tok = peek()).t === '+' || tok.t === '-') {
      next();
      terms.push(tok.t === '-' ? fn('Negate', term()) : term());
    }
    return terms.length === 1 ? terms[0] : fn('Add', ...terms);
  }

  function term() {
    let factors = [signedFactor()];
    const product = () => (factors.length === 1 ? factors[0] : fn('Multiply', ...factors));
    for (;;) {
      const tok = peek();
      if (tok.t === '*') { next(); factors.push(signedFactor()); }
      else if (tok.t === '/') {
        next();
        factors = [fn('Divide', unwrap(product()), unwrap(signedFactor()))];
      } else if (startsAtom(tok)) factors.push(power());
      else return product();
    }
  }

  function signedFactor() {
    if (peek().t === '-') { next(); return fn('Negate', signedFactor()); }
    return power();
  }

  // n! (e (n + 1)!): o fatorial se liga ao átomo, antes da potência.
  function postfix() {
    let a = atom();
    while (peek().t === '!') { next(); a = fn('Factorial', unwrap(a)); }
    return a;
  }

  function power() {
    const base = postfix();
    if (peek().t !== '^') return base;
    // 0^+ e 0^{+} no ponto de um limite.
    if (side) {
      const t1 = toks[k + 1]?.t, t2 = toks[k + 2]?.t, t3 = toks[k + 3]?.t;
      if ((t1 === '+' || t1 === '-') && (t2 === ')' || t2 === '}')) { side.dir = t1; k += 2; return base; }
      if (t1 === '{' && (t2 === '+' || t2 === '-') && t3 === '}') { side.dir = t2; k += 4; return base; }
    }
    next();
    return fn('Power', base, unwrap(signedFactor()));
  }

  // { ... } do LaTeX: agrupamento invisível.
  function braced() {
    expect('{');
    const e = expr();
    expect('}');
    return e;
  }

  // _(k=a)^b · _{k=a}^{b} · _a^b: limites; a variável pode faltar (index nulo).
  function bounds(needIndex) {
    if (peek().t !== '_') throw new ParseError('err.bounds', peek().pos);
    next();
    let index = null, lower;
    const open = peek();
    const named = (open.t === '(' || open.t === '{') && toks[k + 1]?.t === 'id' && toks[k + 2]?.t === 'rel' && toks[k + 2].v === 'Equal';
    if (named) {
      next();
      index = next().v;
      next();
      lower = expr();
      expect(open.t === '(' ? ')' : '}');
    } else if (needIndex) throw new ParseError('err.bounds', open.pos);
    else lower = unwrap(postfix());
    if (peek().t !== '^') throw new ParseError('err.bounds', peek().pos);
    next();
    return { index, lower, upper: unwrap(postfix()) };
  }

  function atom() {
    const tok = next();
    switch (tok.t) {
      case 'num': return num(tok.v);
      case 'id': {
        // f(x), g(x + 1) e f'(x), y': funções do usuário.
        const glued = peek().t === '(' && tok.end !== undefined && peek().pos === tok.end;
        if (!tok.primes && !(glued && FUNCTION_LETTERS.has(tok.v))) return sym(tok.v);
        const args = [];
        if (peek().t === '(') {
          next();
          args.push(expr());
          while (peek().t === ',') { next(); args.push(expr()); }
          expect(')');
        }
        return call(tok.v, args, tok.primes ?? 0);
      }
      case 'lim': {
        // lim_(x->a) termo · \lim_{x \to a} termo
        if (peek().t !== '_') throw new ParseError('err.limit', peek().pos);
        next();
        const open = next();
        if (open.t !== '(' && open.t !== '{') throw new ParseError('err.limit', open.pos);
        const v = next();
        if (v.t !== 'id' || peek().t !== 'to') throw new ParseError('err.limit', v.pos);
        next();
        side = {};
        const point = expr();
        const { dir } = side;
        side = null;
        expect(open.t === '(' ? ')' : '}');
        const node = fn('Limit', sym(v.v), unwrap(point), unwrap(term()));
        return dir ? { ...node, dir } : node;
      }
      case 'deriv': {
        const node = fn('D', sym(tok.v), unwrap(term()));
        return tok.order > 1 ? { ...node, order: tok.order } : node;
      }
      case 'int': {
        // ∫ termo dx · ∫_a^b termo dx
        const b = peek().t === '_' ? bounds(false) : null;
        intDepth++;
        const body = isDifferential(k) ? num(1) : expr(); // ∫ dx = ∫ 1 dx
        intDepth--;
        if (!isDifferential(k)) throw new ParseError('err.differential', peek().pos);
        next();
        const x = sym(next().v);
        return b ? fn('Integrate', x, b.lower, b.upper, unwrap(body)) : fn('Integrate', x, unwrap(body));
      }
      case 'evopen': {
        // [F]_(x=a)^b · [F]_a^b
        const F = expr();
        expect('evclose');
        const b = bounds(false);
        return fn('EvalAt', sym(b.index ?? guessVariable(F)), b.lower, b.upper, F);
      }
      case 'fn': {
        const arity = ARITY[tok.v] ?? 1;
        // sen^2 x: expoente entre o nome e o argumento.
        let exp = null;
        if (peek().t === '^' && arity === 1) { next(); exp = unwrap(atom()); }
        // log_2 x: a base vem do subscrito.
        const base = tok.base === undefined ? [] : [/^\d/.test(tok.base) ? num(tok.base) : sym(tok.base)];
        let f;
        if (peek().t !== '(') {
          if (arity !== 1) throw new ParseError('err.missing', peek().pos, { t: '(' });
          f = fn(tok.v, peek().t === '{' ? braced() : power(), ...base);
        } else {
          next();
          const args = [expr()];
          while (peek().t === ',') { next(); args.push(expr()); }
          const close = expect(')');
          // log(x, b): base como segundo argumento (MathJSON).
          const ok = args.length === arity || (tok.v === 'Log' && args.length === 2 && !base.length);
          if (!ok) throw new ParseError('err.arity', close.pos, { n: arity });
          f = fn(tok.v, ...args, ...base);
        }
        return exp ? fn('Power', f, exp) : f;
      }
      case '(': {
        const e = expr();
        expect(')');
        return fn('Delimiter', e);
      }
      case '{': {
        k--;
        return braced();
      }
      case '|': {
        absDepth++;
        const e = expr();
        absDepth--;
        expect('|');
        return fn('Abs', e);
      }
      case 'big': {
        // sum_(k=1)^n termo  ·  \\sum_{k=1}^{n} termo
        const { index, lower, upper } = bounds(true);
        // O termo vai até o próximo + ou −, como no LaTeX.
        return fn(tok.v, sym(index), lower, upper, unwrap(term()));
      }
      case 'binom': {
        const a = braced();
        return fn('Binomial', a, braced());
      }
      case 'frac': {
        const a = braced();
        const b = braced();
        const d = derivFrac(a, b);
        if (d) {
          const node = fn('D', sym(d.v), d.body ?? unwrap(term()));
          return d.order > 1 ? { ...node, order: d.order } : node;
        }
        return fn('Divide', a, b);
      }
      case 'sqrt': {
        if (peek().t === '[') {
          next();
          const n = expr();
          expect(']');
          return fn('Root', braced(), n);
        }
        return fn('Sqrt', peek().t === '{' ? braced() : atom());
      }
      case 'end': throw new ParseError('err.incomplete', tok.pos);
      default: throw new ParseError('err.unexpected', tok.pos, { t: tok.t });
    }
  }

  function relation() {
    const lhs = expr();
    if (peek().t !== 'rel') return lhs;
    const rel = next().v;
    return fn(rel, lhs, expr());
  }

  // Várias relações separadas por ";" formam um sistema.
  const rows = [relation()];
  while (peek().t === ';') {
    next();
    if (peek().t === 'end') break; // ";" no fim é tolerado
    rows.push(relation());
  }
  if (peek().t !== 'end') throw new ParseError('err.unexpected', peek().pos, { t: peek().t });
  return rows.length === 1 ? rows[0] : fn('System', ...rows);
}
