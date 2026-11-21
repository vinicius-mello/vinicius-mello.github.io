// Program-level evaluation.
//
// Top-level definitions are order-independent and may refer to each other
// (functions may be mutually recursive). Constants are evaluated lazily, once,
// with cycle detection. Every top-level constant whose value is a solid is a
// *named object*: listed in the UI and exportable as STL. Profiles (regions of the
// plane) are shown with ⊢ as thin plates, but are not objects: they print only once
// extruded or revolved.
import { LangError } from './errors.js';
import { parse } from './parser.js';
import { Env, evaluate, makeContext } from './evaluator.js';
import { createPrelude, bindKernelConstants } from './builtins.js';
import { Closure, Solid, Profile, format } from './values.js';

// Raised when a definition depends on one that already failed (reported once).
class DependencyError extends LangError {}

class GlobalEnv extends Env {
  constructor(parent, ctx) {
    super(parent);
    this.ctx = ctx;
    this.thunks = new Map();
  }
  hasOwn(name) { return this.thunks.has(name) || this.vars.has(name); }
  resolve(name, node) {
    return this.thunks.has(name) ? this.force(name, node) : this.vars.get(name);
  }
  force(name, node) {
    const t = this.thunks.get(name);
    switch (t.state) {
      case 'done': return t.value;
      case 'error': throw new DependencyError(`'${name}' contém erro`, node?.span);
      case 'running': throw new LangError(`definição circular envolvendo '${name}'`, node?.span ?? t.def.nameSpan);
    }
    t.state = 'running';
    try {
      t.value = evaluate(t.def.body, this, this.ctx);
      t.state = 'done';
      return t.value;
    } catch (e) {
      t.state = 'error';
      t.error = e;
      throw e;
    }
  }
}

function asLangError(e) {
  if (e instanceof LangError) return e;
  if (e instanceof RangeError && /call stack/i.test(e.message)) {
    return new LangError('recursão profunda demais (pilha esgotada)');
  }
  throw e;
}

function sourceText(src, span) {
  const text = src.slice(span.start, span.end).replace(/\s+/g, ' ').trim();
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}

// Returns { objects: [{ name, solid }], shows: [{ label, solid?, profile?, text? }], values, errors }.
// Solids stay owned by `kernel` until kernel.dispose().
export function run(src, kernel, options = {}) {
  const { program, errors } = parse(src);
  const result = { objects: [], shows: [], values: [], errors: [...errors] };
  if (errors.length) return result;

  const ctx = makeContext(kernel, options.limits);
  const prelude = new Env(null);
  for (const [k, v] of Object.entries(bindKernelConstants(createPrelude(), kernel))) prelude.set(k, v);
  const globals = new GlobalEnv(prelude, ctx);

  const defs = [];
  for (const stmt of program.body) {
    if (stmt.type !== 'Def') continue;
    if (globals.thunks.has(stmt.name) || globals.vars.has(stmt.name)) {
      result.errors.push(new LangError(`'${stmt.name}' já foi definido`, stmt.nameSpan));
      continue;
    }
    if (stmt.params) {
      globals.set(stmt.name, new Closure(stmt.name, stmt.params, stmt.body, globals));
    } else {
      globals.thunks.set(stmt.name, { def: stmt, state: 'pending' });
      defs.push(stmt);
    }
  }

  const report = (e) => {
    const err = asLangError(e);
    if (!(err instanceof DependencyError)) result.errors.push(err);
  };

  let lastProfile = null;
  for (const def of defs) {
    try {
      const value = globals.force(def.name, null);
      if (value instanceof Solid) result.objects.push({ name: def.name, solid: value, span: def.span });
      else result.values.push({ name: def.name, text: format(value) });
      if (value instanceof Profile) lastProfile = { name: def.name, profile: value };
    } catch (e) {
      report(e);
    }
  }

  let anyShow = false;
  for (const stmt of program.body) {
    if (stmt.type !== 'Show') continue;
    anyShow = true;
    for (const expr of stmt.exprs) {
      const label = expr.type === 'Ident' ? expr.name : sourceText(src, expr.span);
      try {
        const value = evaluate(expr, globals, ctx);
        if (value instanceof Solid) result.shows.push({ label, solid: value, name: expr.type === 'Ident' ? expr.name : null });
        else if (value instanceof Profile) result.shows.push({ label, profile: value });
        else result.shows.push({ label, text: format(value) });
      } catch (e) {
        report(e);
      }
    }
  }
  if (!anyShow && result.objects.length) {
    const last = result.objects[result.objects.length - 1];
    result.shows.push({ label: last.name, solid: last.solid, name: last.name });
  } else if (!anyShow && lastProfile) {
    result.shows.push({ label: lastProfile.name, profile: lastProfile.profile });
  }
  return result;
}
