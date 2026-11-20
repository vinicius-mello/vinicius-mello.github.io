// Pratt parser: tokens → AST. Every node has { type, span: { start, end } }.
//
// Binding powers (higher binds tighter):
//   |> 10 · ∨ 20 · ∧ 30 · ¬ (prefix) 35 · comparisons 40 (chainable)
//   ∪ ∖ △ 50 · ∩ 60 · ⊕ 70 · .. ..< 80 · + - ++ 90 · big operators (prefix) 90
//   · × / mod 100 · unary - 100 · √ 110 · ∘ 110 · ^ 120 (right)
//   implicit multiplication after a numeric literal 125 · postfix () [] . ° ⁿ 130
import { LangError } from './errors.js';
import { lex } from './lexer.js';

const BINARY = {
  '|>': [10, 'left'], '∨': [20, 'left'], '∧': [30, 'left'],
  '∪': [50, 'left'], '∖': [50, 'left'], '△': [50, 'left'], '∩': [60, 'left'], '⊕': [70, 'left'],
  '..': [80, 'none'], '..<': [80, 'none'],
  '+': [90, 'left'], '-': [90, 'left'], '++': [90, 'left'],
  '·': [100, 'left'], '×': [100, 'left'], '/': [100, 'left'], mod: [100, 'left'],
  '∘': [110, 'left'], '^': [120, 'right'],
};
const COMPARISON = new Set(['=', '≠', '<', '>', '≤', '≥', '∈', '∉']);
const COMPARISON_BP = 40;
const POSTFIX_BP = 130;
const IMPLICIT_BP = 125;
const BIG_OPS = new Set(['⋃', '⋂', 'Σ', '∏']);
const PREFIX_SECTIONS = new Set(['⋃', '⋂', 'Σ', '∏', '√', '¬']);
const CLOSING = { '(': ')', '[': ']', '{': '}', '⟨': '⟩' };

const tokenOp = (t) => (t.type === 'kw' && t.value === 'mod' ? 'mod' : t.type);
const isBinaryToken = (t) => tokenOp(t) in BINARY || COMPARISON.has(t.type);
const span = (a, b) => ({ start: a.span ? a.span.start : a.start, end: b.span ? b.span.end : b.end });

export function parse(src) {
  let tokens;
  try {
    tokens = lex(src);
  } catch (e) {
    if (e instanceof LangError) return { program: null, errors: [e] };
    throw e;
  }
  return new Parser(tokens).program();
}

export function parseExpression(src) {
  const p = new Parser(lex(src));
  const e = p.expr(0);
  p.expect('eof', 'fim da expressão');
  return e;
}

class Parser {
  constructor(tokens) {
    this.t = tokens;
    this.i = 0;
  }

  // ---------- token helpers ----------
  peek(k = 0) { return this.t[Math.min(this.i + k, this.t.length - 1)]; }
  next() { return this.t[this.i < this.t.length - 1 ? this.i++ : this.i]; }
  at(type, value) {
    const t = this.peek();
    return t.type === type && (value === undefined || t.value === value);
  }
  atKw(value) { return this.at('kw', value); }
  accept(type, value) { return this.at(type, value) ? this.next() : null; }
  error(msg, tok = this.peek()) {
    return new LangError(msg, { start: tok.start, end: Math.max(tok.end, tok.start + 1) }, 'syntax');
  }
  expect(type, what, value) {
    if (this.at(type, value)) return this.next();
    const t = this.peek();
    const found = t.type === 'eof' ? 'fim do texto' : t.type === 'nl' ? 'fim da linha' : `'${src(t)}'`;
    throw this.error(`esperava ${what}, encontrei ${found}`);
  }

  // ---------- statements ----------
  program() {
    const body = [], errors = [];
    while (!this.at('eof')) {
      if (this.accept('nl')) continue;
      try {
        body.push(this.statement());
        if (!this.at('eof')) this.expect('nl', 'fim da linha');
      } catch (e) {
        if (!(e instanceof LangError)) throw e;
        errors.push(e);
        while (!this.at('nl') && !this.at('eof')) this.next();
      }
    }
    return { program: { type: 'Program', body }, errors };
  }

  statement() {
    const first = this.peek();
    if (this.at('⊢')) {
      this.next();
      const exprs = [this.expr(0)];
      while (this.accept(',')) exprs.push(this.expr(0));
      return { type: 'Show', exprs, span: span(first, exprs[exprs.length - 1]) };
    }
    if (first.type === 'ident') {
      const def = this.tryDefinition();
      if (def) return def;
    }
    const e = this.expr(0);
    return { type: 'Show', exprs: [e], span: e.span, implicit: true };
  }

  // name ≔ e   |   name(params) ≔ e      ('=' is accepted in place of '≔')
  tryDefinition() {
    const nameTok = this.peek();
    const after = this.peek(1);
    if (after.type === '≔' || after.type === '=') {
      this.next(); this.next();
      const body = this.expr(0);
      return { type: 'Def', name: nameTok.value, params: null, body, nameSpan: span(nameTok, nameTok), span: span(nameTok, body) };
    }
    if (after.type !== '(') return null;
    // Look past the balanced parentheses for '≔' / '='.
    let k = 1, depth = 0;
    for (;; k++) {
      const t = this.peek(k);
      if (t.type === 'eof' || t.type === 'nl') return null;
      if (t.type === '(') depth++;
      else if (t.type === ')' && --depth === 0) break;
    }
    const op = this.peek(k + 1).type;
    if (op !== '≔' && op !== '=') return null;
    this.next(); this.next();
    const params = this.params(')');
    this.next();
    const body = this.expr(0);
    return { type: 'Def', name: nameTok.value, params, body, nameSpan: span(nameTok, nameTok), span: span(nameTok, body) };
  }

  // x, y = default, …   (closing token consumed)
  params(closer) {
    const params = [];
    const seen = new Set();
    if (!this.accept(closer)) {
      do {
        const p = this.expect('ident', 'nome de parâmetro');
        if (seen.has(p.value)) throw this.error(`parâmetro '${p.value}' repetido`, p);
        seen.add(p.value);
        let def = null;
        if (this.accept('=') || this.accept('≔')) def = this.expr(0);
        else if (params.some((q) => q.default)) throw this.error('parâmetros sem valor padrão devem vir antes dos opcionais', p);
        params.push({ name: p.value, default: def, span: span(p, p) });
      } while (this.accept(','));
      this.expect(closer, `'${closer}'`);
    }
    return params;
  }

  // ---------- expressions ----------
  expr(minBP) {
    let left = this.prefix();
    for (;;) {
      const t = this.peek();
      // Operator immediately before ')' belongs to a section: (A ∪)
      if (isBinaryToken(t) && this.peek(1).type === ')') break;

      if (left.coef && !t.space && (t.type === 'ident' || t.type === '(' || t.type === '√') && IMPLICIT_BP > minBP) {
        const right = this.expr(119);
        left = { type: 'Binary', op: '·', left, right, span: span(left, right), implicit: true };
        continue;
      }
      if (POSTFIX_BP > minBP && this.isPostfix(t, left)) {
        left = this.postfix(left);
        continue;
      }
      if (COMPARISON.has(t.type) && COMPARISON_BP > minBP) {
        left = this.comparison(left);
        continue;
      }
      const op = tokenOp(t);
      const info = BINARY[op];
      if (!info || info[0] <= minBP) break;
      this.next();
      const [bp, assoc] = info;
      const right = this.expr(assoc === 'right' ? bp - 1 : bp);
      if (op === '..' || op === '..<') {
        left = { type: 'Range', lo: left, hi: right, exclusive: op === '..<', span: span(left, right) };
        if (this.at('..') || this.at('..<')) throw this.error('intervalos não podem ser encadeados; use range(a, b, passo)');
      } else {
        left = { type: 'Binary', op, left, right, span: span(left, right) };
      }
    }
    return left;
  }

  isPostfix(t, left) {
    switch (t.type) {
      case '(': case '°': case 'sup': return true;
      case '[': case '.': return !t.space;
      case '{': return !t.space && left.type === 'Ident';
      default: return false;
    }
  }

  postfix(left) {
    const t = this.next();
    switch (t.type) {
      case '(': {
        const args = this.args();
        return { type: 'Call', fn: left, args, span: span(left, this.t[this.i - 1]) };
      }
      case '{': {
        const list = this.listOrComprehension(t);
        return { type: 'Call', fn: left, args: [{ name: null, value: list }], span: span(left, list) };
      }
      case '[': {
        const index = this.expr(0);
        const close = this.expect(']', "']'");
        return { type: 'Index', target: left, index, span: span(left, close) };
      }
      case '.': {
        const name = this.expect('ident', 'nome de componente (x, y, z)');
        return { type: 'Field', target: left, name: name.value, span: span(left, name) };
      }
      case '°':
        return { type: 'Degrees', expr: left, span: span(left, t), coef: left.type === 'Num' };
      case 'sup':
        return { type: 'Binary', op: '^', left, right: { type: 'Num', value: t.value, span: span(t, t) }, span: span(left, t), coef: left.coef };
    }
    throw this.error('operador posfixo inesperado', t);
  }

  args() {
    const args = [];
    if (this.accept(')')) return args;
    do {
      if (this.at(')')) break; // trailing comma
      const t = this.peek();
      if (t.type === 'ident' && (this.peek(1).type === '=' || this.peek(1).type === '≔')) {
        this.next(); this.next();
        if (args.some((a) => a.name === t.value)) throw this.error(`argumento '${t.value}' repetido`, t);
        args.push({ name: t.value, value: this.expr(0), span: span(t, t) });
      } else {
        if (args.some((a) => a.name)) throw this.error('argumentos posicionais devem vir antes dos nomeados', t);
        args.push({ name: null, value: this.expr(0) });
      }
    } while (this.accept(','));
    this.expect(')', "')' ou ','");
    return args;
  }

  comparison(first) {
    const ops = [], operands = [first];
    while (COMPARISON.has(this.peek().type)) {
      ops.push(this.next().type);
      operands.push(this.expr(COMPARISON_BP));
    }
    return { type: 'Compare', ops, operands, span: span(first, operands[operands.length - 1]) };
  }

  prefix() {
    const t = this.peek();
    switch (t.type) {
      case 'num':
        this.next();
        return { type: 'Num', value: t.value, span: span(t, t), coef: true };
      case 'ident':
        this.next();
        if (this.at('↦')) return this.lambda([{ name: t.value, default: null, span: span(t, t) }], t);
        return { type: 'Ident', name: t.value, span: span(t, t) };
      case 'kw':
        return this.keyword(t);
      case '(':
        return this.paren();
      case '[': case '{': case '⟨': {
        this.next();
        const list = this.listOrComprehension(t);
        // [a, b] ↦ e — lambda with a destructured argument
        if (this.at('↦') && list.type === 'List' && list.items.length && list.items.every((x) => x.type === 'Ident')) {
          const pattern = list.items.map((x) => x.name);
          return this.lambda([{ name: `[${pattern.join(', ')}]`, pattern, default: null, span: list.span }], t);
        }
        return list;
      }
      case '⌊': case '⌈': {
        this.next();
        const e = this.expr(0);
        const close = this.expect(t.type === '⌊' ? '⌋' : '⌉', t.type === '⌊' ? "'⌋'" : "'⌉'");
        return { type: 'Call', fn: { type: 'Ident', name: t.type === '⌊' ? 'floor' : 'ceil', span: span(t, t) }, args: [{ name: null, value: e }], span: span(t, close) };
      }
      case '-': {
        this.next();
        const e = this.expr(100);
        return { type: 'Unary', op: '-', expr: e, span: span(t, e) };
      }
      case '√': {
        this.next();
        const e = this.expr(110);
        return { type: 'Unary', op: '√', expr: e, span: span(t, e) };
      }
      case '¬': {
        this.next();
        const e = this.expr(35);
        return { type: 'Unary', op: '¬', expr: e, span: span(t, e) };
      }
      case '⋃': case '⋂': case 'Σ': case '∏':
        return this.bigOp();
      case 'eof':
        throw this.error('expressão incompleta');
      case 'nl':
        throw this.error('expressão incompleta no fim da linha');
      default:
        throw this.error(`'${src(t)}' inesperado aqui`);
    }
  }

  keyword(t) {
    switch (t.value) {
      case 'true': case 'false':
        this.next();
        return { type: 'Bool', value: t.value === 'true', span: span(t, t) };
      case 'if': {
        this.next();
        const cond = this.expr(0);
        this.expect('kw', "'then'", 'then');
        const then = this.expr(0);
        this.expect('kw', "'else' (todo 'if' precisa de 'else')", 'else');
        const otherwise = this.expr(0);
        return { type: 'If', cond, then, otherwise, span: span(t, otherwise) };
      }
      case 'let': {
        this.next();
        const bindings = [];
        do {
          const name = this.expect('ident', 'nome');
          let params = null;
          if (this.accept('(')) params = this.params(')');
          if (!this.accept('≔') && !this.accept('=')) this.expect('≔', "'≔'");
          const value = this.expr(0);
          bindings.push({ name: name.value, params, value, span: span(name, value) });
        } while (this.accept(','));
        this.expect('kw', "'in'", 'in');
        const body = this.expr(0);
        return { type: 'Let', bindings, body, span: span(t, body) };
      }
      default:
        throw this.error(`'${t.value}' inesperado aqui`);
    }
  }

  lambda(params, startTok) {
    this.expect('↦', "'↦'");
    const body = this.expr(0);
    return { type: 'Lambda', params, body, span: span(startTok, body) };
  }

  // ( e ) · sections (∪) (A ∪) (∪ B) · lambdas (x, y) ↦ e
  paren() {
    const open = this.next();
    const t = this.peek();
    // () ↦ e
    if (t.type === ')' && this.peek(1).type === '↦') {
      this.next();
      return this.lambda([], open);
    }
    // (op)
    if ((isBinaryToken(t) || PREFIX_SECTIONS.has(t.type)) && this.peek(1).type === ')') {
      this.next();
      const close = this.next();
      return { type: 'Section', op: tokenOp(t), left: null, right: null, span: span(open, close) };
    }
    // (op e) — right section; '-' here means negation
    if (isBinaryToken(t) && t.type !== '-') {
      this.next();
      const right = this.expr(0);
      const close = this.expect(')', "')'");
      return { type: 'Section', op: tokenOp(t), left: null, right, span: span(open, close) };
    }
    // (x, y) ↦ e
    if (t.type === 'ident' && this.peek(1).type === ',') {
      let k = 0;
      while (this.peek(k).type === 'ident' && this.peek(k + 1).type === ',') k += 2;
      if (this.peek(k).type === 'ident' && this.peek(k + 1).type === ')' && this.peek(k + 2).type === '↦') {
        const params = this.params(')');
        return this.lambda(params, open);
      }
    }
    const e = this.expr(0);
    // (e op) — left section
    if (isBinaryToken(this.peek()) && this.peek(1).type === ')') {
      const op = tokenOp(this.next());
      const close = this.next();
      return { type: 'Section', op, left: e, right: null, span: span(open, close) };
    }
    if (this.at(',')) throw this.error('tuplas não existem: use [a, b, c] ou ⟨a, b, c⟩ para listas/vetores');
    const close = this.expect(')', "')'");
    return { ...e, span: span(open, close), coef: false, paren: true };
  }

  // [a, b] {a, b} ⟨a, b⟩ · [e | clauses] {e | clauses}
  listOrComprehension(open) {
    const closer = CLOSING[open.type];
    if (this.at(closer)) {
      const close = this.next();
      return { type: 'List', items: [], span: span(open, close) };
    }
    const first = this.expr(0);
    if (this.accept('|')) {
      const clauses = this.clauses(closer);
      const close = this.expect(closer, `'${closer}'`);
      return { type: 'Comprehension', body: first, clauses, span: span(open, close) };
    }
    const items = [first];
    while (this.accept(',')) {
      if (this.at(closer)) break;
      items.push(this.expr(0));
    }
    const close = this.expect(closer, `'${closer}' ou ','`);
    return { type: 'List', items, span: span(open, close) };
  }

  // Clauses of a comprehension / big operator subscript:
  //   x ∈ A    x, y ∈ A    [x, y] ∈ A    x ≔ e    condition
  clauses(closer) {
    const clauses = [];
    const bound = new Set();
    do {
      if (this.at(closer)) break;
      const gen = this.tryGenerator(bound);
      if (gen) {
        clauses.push(...gen);
        continue;
      }
      const t = this.peek();
      if (t.type === 'ident' && this.peek(1).type === '≔') {
        this.next(); this.next();
        const value = this.expr(0);
        bound.add(t.value);
        clauses.push({ type: 'LetClause', name: t.value, value, span: span(t, value) });
        continue;
      }
      const cond = this.expr(0);
      clauses.push({ type: 'Filter', cond, span: cond.span });
    } while (this.accept(','));
    return clauses;
  }

  tryGenerator(bound) {
    const isIn = (t) => t.type === '∈' || (t.type === 'kw' && t.value === 'in');
    const t = this.peek();
    // destructuring: [a, b] ∈ pts
    if (t.type === '[' || t.type === '⟨') {
      const closer = CLOSING[t.type];
      let k = 1;
      const names = [];
      while (this.peek(k).type === 'ident') {
        names.push(this.peek(k));
        if (this.peek(k + 1).type === ',') k += 2;
        else { k += 1; break; }
      }
      if (!names.length || this.peek(k).type !== closer || !isIn(this.peek(k + 1))) return null;
      for (let j = 0; j <= k + 1; j++) this.next();
      const source = this.expr(0);
      names.forEach((n) => bound.add(n.value));
      return [{ type: 'Generator', pattern: names.map((n) => n.value), source, span: span(t, source) }];
    }
    if (t.type !== 'ident') return null;
    // x ∈ A  or  x, y, z ∈ A
    let k = 0;
    const names = [];
    for (;;) {
      if (this.peek(k).type !== 'ident') return null;
      names.push(this.peek(k));
      const sep = this.peek(k + 1);
      if (isIn(sep)) break;
      if (sep.type !== ',') return null;
      k += 2;
    }
    // A name already bound by this comprehension makes `x ∈ B` a membership filter.
    if (names.some((n) => bound.has(n.value))) return null;
    for (let j = 0; j < 2 * names.length; j++) this.next();
    const source = this.expr(0);
    names.forEach((n) => bound.add(n.value));
    return names.map((n) => ({ type: 'Generator', pattern: n.value, source, span: span(n, source) }));
  }

  // ⋃ xs   ⋃{…}   ⋃_{i ∈ A} body   Σ_{k=1}^{n} body
  bigOp() {
    const opTok = this.next();
    const op = opTok.type;
    if (this.accept('_')) {
      const open = this.peek();
      if (open.type !== '{' && open.type !== '(') throw this.error("esperava '{' ou '(' depois de '_'");
      this.next();
      const closer = CLOSING[open.type];
      let clauses;
      // Σ_{k=1}^{n}
      if (this.at('ident') && this.peek(1).type === '=') {
        const name = this.next();
        this.next();
        const lo = this.expr(0);
        this.expect(closer, `'${closer}'`);
        this.expect('^', "'^' com o limite superior");
        let hi;
        if (this.at('{') || this.at('(')) {
          const o = this.next();
          hi = this.expr(0);
          this.expect(CLOSING[o.type], `'${CLOSING[o.type]}'`);
        } else {
          hi = this.expr(POSTFIX_BP - 1);
        }
        const source = { type: 'Range', lo, hi, exclusive: false, span: span(lo, hi) };
        clauses = [{ type: 'Generator', pattern: name.value, source, span: span(name, hi) }];
      } else {
        clauses = this.clauses(closer);
        this.expect(closer, `'${closer}'`);
      }
      const body = this.expr(90);
      const coll = { type: 'Comprehension', body, clauses, span: span(opTok, body) };
      return { type: 'BigOp', op, coll, span: span(opTok, body) };
    }
    const coll = this.expr(90);
    return { type: 'BigOp', op, coll, span: span(opTok, coll) };
  }
}

function src(t) {
  return t.type === 'num' || t.type === 'ident' || t.type === 'kw' ? String(t.value) : t.type === 'sup' ? 'expoente' : t.type;
}
