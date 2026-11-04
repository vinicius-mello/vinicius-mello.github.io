// Gramática comum aos parsers ASCII e LaTeX. Recebe uma lista de tokens
// e devolve a árvore, sem simplificar nada:
//   num, id, fn            números, símbolos, funções (v = operador MathJSON)
//   + - * / ^ ( ) ,        operadores e pontuação
//   rel                    relação entre os lados (v = Equal, Less, ...)
//   ;                      separa as equações de um sistema
//   frac, sqrt, { } [ ]    construções do LaTeX
// Parênteses digitados viram Delimiter, exceto onde a notação já mostra o
// agrupamento (numerador/denominador, expoente, argumento de função).

import { num, sym, fn } from './ast.js';

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
const ARITY = { Root: 2 };
const ATOM_START = new Set(['num', 'id', 'fn', '(', 'frac', 'sqrt', '{', '|']);

export function parseTokens(toks) {
  let k = 0;
  // Dentro de |...|, uma barra fecha o módulo em vez de abrir outro.
  let absDepth = 0;
  const startsAtom = (tok) => ATOM_START.has(tok.t) && !(tok.t === '|' && absDepth > 0);
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

  function power() {
    const base = atom();
    if (peek().t !== '^') return base;
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

  function atom() {
    const tok = next();
    switch (tok.t) {
      case 'num': return num(tok.v);
      case 'id': return sym(tok.v);
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
      case 'frac': {
        const a = braced();
        return fn('Divide', a, braced());
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
