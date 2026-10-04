// =============================================================================
// APL.js - an APL-to-JavaScript transpiler and runtime.
//
// PIPELINE
//   tokenizer          text -> flat token list
//   parseExpression     tokens -> AST, via a right-to-left shift-reduce loop
//                        (reduceStack) driven by global_category's glyph ->
//                        {category, name} grammar
//   emitJs               AST -> a JS source string
//   evaluateApl/AplJS    new Function('G', jsCode) executes that string with
//                        the primitive table below (G) as its only argument
//
// Read parseToAst/aplToJavaScript/evaluateApl/AplJS at the bottom of this
// file first if you want the 30-second tour before diving into how any of
// the stages above actually work.
//
// THE GRAMMAR: categories
//   Every glyph in global_category (below) is tagged with a single-letter
//   category that reduceStack's grammar rules pattern-match on:
//     V  value               (a literal, a variable, ⍺/⍵, the result of
//                             applying a function)
//     F  function             (+ - × ⌷ ⊂ ... - monadic and/or dyadic)
//     M  monadic operator     (¨ ⌸ ⍨ ... - takes one function/value operand)
//     D  dyadic operator      (∘ . ⍣ ... - takes two operands)
//     Q  quote marker          (⍞ - see its own comment below; a parse-time-
//                             only relabelling, never a real runtime value)
//   User-defined names (variables, dfns, dfn operands ⍺⍺/⍵⍵) get looked up
//   in a per-scope table built as parsing goes (see find_category) and are
//   assigned the same category letters.
//
// THE ARRAY MODEL
//   There's no dedicated array class. An APL scalar is a bare JS number or
//   string; an APL array is a plain (possibly nested) JS array. Shape is
//   normally *inferred* structurally: shapeRec walks Array.isArray/.length
//   recursively rather than reading it off stored metadata - so a real
//   Dyalog-style "nested array" (which tracks shape as metadata per array,
//   completely independent of what's inside) is only approximated here.
//
//   That structural inference has one fundamental blind spot: a plain JS
//   array can't distinguish "a boxed rank-0 scalar" from "an ordinary
//   length-1 vector", and can't always tell "these two sibling elements
//   just happen to have the same shape" from "this is actually one more
//   real dimension". Both are patched the same way - by stamping an
//   explicit `.shape` array property on specific results, which shapeRec
//   always checks before falling back to structural inference:
//     isBoxed(x)            true iff x is an array tagged .shape = []  -
//                            i.e. a genuine rank-0 "box", the result of
//                            monadic enclose (⊂), never a plain array
//     boxOf(x)               wraps x as a fresh box: [x] tagged .shape=[]
//     encloseIfNeeded(x)     monadic ⊂'s own rule, reusable elsewhere:
//                            box x if it's an array, leave it untouched
//                            otherwise (idempotent on simple scalars - so
//                            ⊂5 ≡ 5, but ⊂1 2 3 is a real box, confirmed
//                            against real Dyalog; see G.enclose)
//     G.strand                a juxtaposed-value literal like (1 2)(3 4)
//                            (see emitJs's 'Strand' case) applies
//                            encloseIfNeeded to *every* item, unconditionally
//                            - confirmed against Dyalog that this is what
//                            real stranding does, not just a display nicety
//   Primitives that are pervasive (dig through boxes to their content,
//   operate, then re-enclose the result so the enclosure survives) share
//   one helper, pervadeBoxed, used by both arithmetic (mdfunc) and
//   relational (drel) dispatch. G.outer (outer product) has the same
//   see-through-and-reenclose rule built directly into its cell loop,
//   applied unconditionally to every cell regardless of which side of the
//   product it came from - chasing down exactly when Dyalog does and
//   doesn't disclose a cell (it does, always, including array elements -
//   not just squeezed scalar arguments) is the whole story behind the
//   apljs-array-model / outer-product commits in git log, worth reading if
//   this rule ever looks wrong again.
//
//   A second, narrower failure mode: several structural (non-pervasive)
//   functions - reverseAxis/rotateAxis (⊖/⌽), transposeRec/permute (⍉),
//   used by dot below too - used to guard their recursion with a raw
//   `Array.isArray(x[0])`check. A box is *always* a one-element array, so
//   that check can't tell "a real sub-row to recurse into" from "an opaque
//   rank-0 cell to leave alone" - it would silently dig into a box's
//   content and corrupt the result. All of them now check
//   `shapeRec(x).length` (the *true*, tag-aware rank) instead.
//
//   Bottom line when adding a new primitive: if it's pervasive, route it
//   through mdfunc/drel/pervadeBoxed rather than hand-rolling Array.isArray
//   checks. If it's structural and needs to know an argument's rank or
//   walk its axes, use shapeRec (not raw Array.isArray/.length) and build
//   the result with fillShapeRec/at so a boxed argument is never mistaken
//   for "one more dimension of real structure".
//
// FILE MAP (top to bottom)
//   tokenizer, global_category           lexer + grammar vocabulary
//   isBoxed .. shapeRec/fillShapeRec/at   array model + shape helpers (above)
//   transposeRec/permute, matMul/matInverse, encode/decode, set/format
//   helpers                              more runtime support, used by G
//   G = { ... }                          every APL primitive's JS
//                                         implementation - one property per
//                                         glyph name from global_category
//   find_category, breakExpressions, CAT_* lists
//                                         parser support (scoping, grammar
//                                         boundary sets used by reduceStack)
//   emitStatements, emitJs, isTrain/trainGlyph/trainEntry, emitGraph
//                                         AST -> JS source string (emitJs),
//                                         plus a second, parallel AST walk
//                                         (emitGraph) that draws trains/
//                                         forks as a graph for the REPL's
//                                         "Train" output instead
//   parseExpression                      the shift-reduce parser itself
//   parseToAst, parser, aplToJavaScript, evaluateApl, AplJS
//                                         public API - start here
// =============================================================================

const tokenizer = (text) => {
  const tokens = [];
  const specs = [
    { regex: /^([\r\n]|⋄)+/u, type: 'SEPARATOR' },
    // Line continuation: an em dash right before a line break (spaces/tabs
    // in between are fine) fuses the next line onto this one, both
    // vanishing entirely - same treatment as WHITESPACE/COMMENT below. Em
    // dash was picked over a plain backslash specifically because \ is
    // already a real glyph (expand/scan) that legitimately ends a line on
    // its own (e.g. `g←+\`), so a backslash-newline rule would silently
    // swallow that. Em dash has no meaning elsewhere in APL, so this can't
    // collide with anything - see the editor's "\dash" input escape.
    { regex: /^—[^\S\r\n]*\r?\n/u, type: 'LINE_CONTINUATION' },
    { regex: /^⍝[^\n]*/u, type: 'COMMENT' },
    { regex: /^(⍺{1,2}|⍵{1,2}|∇{1,2}|[⍶⍹])/u, type: 'SPECIAL_VAR' },
    // Names may use ∆ and ⍙ like letters (Dyalog's own naming rule). Checked
    // ahead of SYMBOL below, which would otherwise grab ∆ (a math symbol).
    { regex: /^[\p{L}_∆⍙][\p{L}0-9_∆⍙]*/u, type: 'IDENTIFIER' },
    // Excludes \r\n on purpose - \s alone would greedily swallow a trailing
    // line's newline together with any spaces/tabs before it (e.g. "1   \n"),
    // silently dropping the SEPARATOR token and fusing two lines into one
    // expression. Bare \r\n is left for the SEPARATOR spec above to match.
    { regex: /^[^\S\r\n]+/, type: 'WHITESPACE' },
    // Scientific notation too (1E3, 2.5e¯4) - the exponent needs at least
    // one digit, so a name glued to a number (2e) can't be mistaken for one.
    { regex: /^¯?\d+(\.\d+)?([eE]¯?\d+)?/u, type: 'NUMBER' },
    // A quote inside a string is doubled, as in APL ('it''s'); backslash
    // escapes (\n, \t...) are also kept, as plain JS escapes.
    { regex: /^'(?:[^'\\]|\\.|'')*'/, type: 'STRING' },
    { regex: /^#[0-9\p{L}\-]+/u, type: 'STRING' },
    { regex: /^\(/, type: 'PAREN_OPEN' },
    { regex: /^\)/, type: 'PAREN_CLOSE' },
    { regex: /^\{/, type: 'BRACE_OPEN' },
    { regex: /^\}/, type: 'BRACE_CLOSE' },
    { regex: /^←/u, type: 'ASSIGN' },
    { regex: /^:/, type: 'GUARD' },
    // System names are case-insensitive (⎕PP is ⎕pp), see the tokenizer loop.
    { regex: /^⎕[a-zA-Z]+/u, type: 'IDENTIFIER' },
    { regex: /^∘\./u, type: 'SYMBOL' },
    { regex: /^[@\\!\?\*¨,-\/\p{Math}\p{Sm}\p{So}]/u, type: 'SYMBOL' },
  ];
    
  let cursor = 0;

  while (cursor < text.length) {
    let matched = false;
    for (const spec of specs) {
      const match = text.slice(cursor).match(spec.regex);
      if (match) {
        const firstNew = tokens.length;
        if (spec.type !== 'WHITESPACE' && spec.type !== 'COMMENT' && spec.type !== 'LINE_CONTINUATION') {
          if(spec.type === 'SYMBOL' && match[0] === '∘.') {
            tokens.push({ type: 'SYMBOL', value: '→' });
            tokens.push({ type: 'SYMBOL', value: '.' });
          } else if(spec.type === 'STRING' && match[0].startsWith('#')) {
            //console.log('String with # prefix detected:', match[0]);
            const strContent = "'"+match[0].slice(1)+"'";
            tokens.push({ type: spec.type, value: strContent });
          } else if (spec.type === 'IDENTIFIER' && match[0].startsWith('⎕')) {
            tokens.push({ type: spec.type, value: match[0].toLowerCase() });
          } else if (spec.type === 'STRING' && match[0].startsWith("'")) {
            // Re-spelled as a valid JS single-quoted literal: a doubled ''
            // becomes \', and a raw line break (a string spanning lines)
            // becomes \n, since emitJs splices the token text in as-is.
            const inner = match[0].slice(1, -1).replace(/''/g, "\\'").replace(/\r?\n/g, '\\n');
            tokens.push({ type: spec.type, value: `'${inner}'` });
          } else if (spec.type === 'IDENTIFIER' && /[∆⍙]/u.test(match[0])) {
            // ∆/⍙ aren't legal in a JS identifier, and every APL name ends
            // up as one in the generated code - spell them with $, which no
            // APL name can contain, so nothing can collide.
            tokens.push({ type: spec.type, value: match[0].replaceAll('∆', '$D').replaceAll('⍙', '$U') });
          } else {
            tokens.push({ type: spec.type, value: match[0] });
          }
        }
        // Source offset of every token, for error messages.
        for (let j = firstNew; j < tokens.length; j++) {
          tokens[j].pos = cursor;
        }
        cursor += match[0].length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      throw new Error(`SYNTAX ERROR: unexpected character "${text[cursor]}" at position ${cursor}`);
    }
  }
  return tokens;
};

// --- Grammar vocabulary: glyph -> {category, name} (see preamble above) ---
const global_category = {
  '+': { category:'F', name: 'plus' },
  '-': { category:'F', name: 'minus' },
  '×': { category:'F', name: 'times' },
  '÷': { category:'F', name: 'divide' },
  '⌈': { category:'F', name: 'ceiling' },
  '⌊': { category:'F', name: 'floor' },
  '=': { category:'F', name: 'equals' },
  '≠': { category:'F', name: 'not_equals' },
  '<': { category:'F', name: 'less_than' },
  '>': { category:'F', name: 'greater_than' },
  '≤': { category:'F', name: 'less_than_or_equal' },
  '≥': { category:'F', name: 'greater_than_or_equal' },
  '|': { category:'F', name: 'residue' },
  '⍴': { category:'F', name: 'rho' },
  // /, \, ⌿ and ⍀ are all genuinely dual-purpose in real APL - ⍺/⍵
  // compress and f/ reduce-last-axis are as different in arity (dyadic vs
  // monadic) as compress and reduce ever were, but share one glyph (same
  // for \: ⍺\⍵ expand, f\ scan-last-axis; and their first-axis
  // counterparts, ⌿: ⍺⌿⍵ compress, f⌿ reduce; ⍀: ⍺⍀⍵ expand, f⍀ scan).
  // Category 'R' (see reduceStack's two R-keyed rules, and CAT_* lists
  // above) keeps all four out of the ordinary 'F'/'M' grammar rules
  // entirely, rather than trying to special-case a shared category -
  // seeded off a real bug: reusing plain 'M' let the generic
  // monadic-operator rule (which permissively accepts a bare VALUE as its
  // operand) grab a partial multi-element ⍺ strand (e.g. "0" out of "1 0")
  // before the strand had even finished forming. ⌿/⍀'s monadic form still
  // gets first-axis semantics "for free" since a pervasive f like +
  // combines whole top-level items elementwise on its own; their dyadic
  // form (compress/expand-FIRST) shares its actual vector-level algorithm
  // with /'s and \'s own dyadic form (compress/expand-LAST) via the
  // compressAxis/expandAxis helpers, but each applies it at a different
  // axis - ⌿/⍀ call it directly on ⍵'s top-level items, while /'s and \'s
  // own G.compress/G.expand recurse down to rank<=1 first.
  '/': { category:'R', name: 'compress' },
  '⌿': { category:'R', name: 'reduce' },
  '⍀': { category:'R', name: 'scan' },
  '\\': { category:'R', name: 'expand' },
  '⍨': { category:'M', name: 'selfie' },
  ',': { category:'F', name: 'comma' },
  '⍳': { category:'F', name: 'iota' },
  '⍸': { category:'F', name: 'iota_index' },
  '⍋': { category:'F', name: 'grade_up' },
  '⍒': { category:'F', name: 'grade_down' },
  '⍣': { category:'D', name: 'power' },
  '∇': { category:'F', name: '_del_' },
  '∇∇': { category:'D', name: '_ddel_' },
  '⍺': { category:'V', name: '_a_' },
  '⍵': { category:'V', name: '_w_' },
  '⍺⍺': { category:'F', name: '_aa_' },
  '⍵⍵': { category:'F', name: '_ww_' },
  '⍶': { category:'V', name: '_aa_' },
  '⍹': { category:'V', name: '_ww_' },
  '≢': { category:'F', name: 'tally' },
  '⎕': { category:'V', name: 'quad' },
  '⊢': { category:'F', name: 'right' },
  '⊣': { category:'F', name: 'left' },
  '.': { category:'D', name: 'dot' },
  '∘': { category:'D', name: 'jot' },
  '⍬': { category:'V', name: 'zilde' },
  '⌽': { category:'F', name: 'reverse' },
  '¨': { category:'M', name: 'each' },
  '*': { category:'F', name: 'exp' },
  '⍟': { category:'F', name: 'log' },
  '√': { category:'F', name: 'sqrt' },
  '?' : { category:'F', name: 'deal' },
  '≡': { category:'F', name: 'match' },
  '!': { category:'F', name: 'factorial' },
  '∨': { category:'F', name: 'or' },
  '∧': { category:'F', name: 'and' },
  '~': { category:'F', name: 'not' },
  '⍲': { category:'F', name: 'nand' },
  '⍱': { category:'F', name: 'nor' },
  '⍉': { category:'F', name: 'transpose' },
  '⌷': { category:'F', name: 'squad' },
  '⊂': { category:'F', name: 'enclose' },
  '⊃': { category:'F', name: 'pick' },
  '@': { category:'D', name: 'at' },
  '↑': { category:'F', name: 'take' },
  '↓': { category:'F', name: 'drop' },
  '⍥': { category:'D', name: 'over' },
  '⍠': { category:'F', name: 'buildObject' },
  // Purely a parse-time marker (see reduceStack): ⍞ relabels the F/M/D
  // token to its right as a plain V, so it compiles to a bare reference to
  // the underlying JS function/HOF instead of being applied. No G.quote
  // function actually exists - this name is never emitted.
  '⍞': { category:'Q', name: 'quote' },
  // The inverse of ⍞: a genuine monadic operator (unlike ⍞'s special-cased
  // Q marker) that relabels its V operand as F, so it can be applied like
  // any other function. ⍠'s dyadic form already binds an extracted
  // function to its receiver (see buildObject below), so (obj⍠'method')⍔
  // is what obj⍔'method' used to be - a properly-bound, callable reference.
  '⍔': { category:'M', name: 'asFunction' },
  '→': { category:'F', name: 'emptyFunc' },
  '○': { category:'F', name: 'circle' },
  '⊤': { category:'F', name: 'encode' },
  '⊥': { category:'F', name: 'decode' },
  '⊖': { category:'F', name: 'reverse_first' },
  '⍕': { category:'F', name: 'format' },
  '⍎': { category:'F', name: 'execute' },
  '⊆': { category:'F', name: 'partition' },
  '∊': { category:'F', name: 'member' },
  '⍷': { category:'F', name: 'find' },
  '∪': { category:'F', name: 'unique' },
  '∩': { category:'F', name: 'intersect'},
  '⍤': { category:'D', name: 'rank' },
  '⌸': { category:'M', name: 'key' },
  '⌹': { category:'F', name: 'domino' },
  '⍪': { category:'F', name: 'table' },
  '⊇': { category:'F', name: 'select' },
  '⌺': { category:'D', name: 'stencil' },
  '⎕typeof': { category:'F', name: 'typeOf' },
  // Print precision: how many significant digits formatNum/⎕←/⍕ show for a
  // number. A plain read/write variable (category V, not a function), same
  // as ⎕ itself - ⎕pp←4 compiles to a normal assignment (G.pp = 4).
  '⎕pp': { category:'V', name: 'pp' },
  // Index origin: fixed at 0 in this implementation. Readable like any
  // system variable; assigning anything but 0 is an error (see G.io).
  '⎕io': { category:'V', name: 'io' },
  // Constant JS values, same read/write-variable shape as ⎕pp - ⎕null and
  // ⎕undefined are two genuinely different "nothing" values in JS/JSON,
  // neither of which any APL primitive here otherwise produces.
  '⎕null': { category:'V', name: 'null' },
  '⎕undefined': { category:'V', name: 'undefined' },
  // Curated JS globals, exposed by name so ⍔/⍠ have real objects to reach
  // into without needing a raw eval escape hatch.
  Math: { category:'V', name: 'Math' },
  Date: { category:'V', name: 'Date' },
  JSON: { category:'V', name: 'JSON' },
  console: { category:'V', name: 'console' },
  // Loaded via <script> tags in the host page (not npm deps of this
  // module) - d3/Plot are simply undefined if that page doesn't load them.
  d3: { category:'V', name: 'd3' },
  Plot: { category:'V', name: 'Plot' },
}

// Reverse lookup used only by emitGraph's node labels, so a graph shows the
// glyph/keyword a user actually typed (e.g. "⍵") instead of the internal JS
// name it resolves to (e.g. "_w_"). First writer wins on name collisions
// (e.g. the repeated '⍣' entry above) - harmless, since duplicates always
// share the same name anyway.
const NAME_TO_GLYPH = {};
for (const [glyph, entry] of Object.entries(global_category)) {
  if (!(entry.name in NAME_TO_GLYPH)) {
    NAME_TO_GLYPH[entry.name] = glyph;
  }
}

const _a_ = global_category['⍺'].name;
const _w_ = global_category['⍵'].name;
const _aa_ = global_category['⍺⍺'].name;
const _ww_ = global_category['⍵⍵'].name;

// A "boxed" value is a rank-0 container produced by monadic enclose (⊂w):
// a one-element JS array carrying an explicit .shape=[] tag (see shapeRec
// below), distinguishing it from an ordinary length-1 vector. Pervasive
// scalar functions must see through the box to reach its content, then
// rewrap the result so the enclosure survives the operation - e.g.
// 2×⊂1 2 3 stays enclosed (⊂3 4 6), matching real APL pervasion.
const isBoxed = (x) => Array.isArray(x) && Array.isArray(x.shape) && x.shape.length === 0;
const isScalarLike = (x) => typeof x === 'number' || typeof x === 'string' || isBoxed(x);
const boxOf = (x) => {
  const b = [x];
  b.shape = []; 
  return b;
};

// Monadic enclose's own rule (see G.enclose below), reusable outside of it:
// arrays get boxed, an already-simple (non-array) value is untouched -
// idempotent for simple scalars, but adds a real layer to anything else,
// including an already-boxed value. Two other places apply this same rule
// unconditionally, confirmed against real Dyalog: a strand literal like
// (1 2)(3 4) encloses each item (≡((1 2)(3 4))[1] is 2, not the 1 a bare
// 1 2 would have - and (⊂¯1⌽c)(⊂0⌽c)(⊂1⌽c)'s items each pick up one MORE
// layer this way, since they were already boxed going in); and outer
// product re-encloses every cell's result the same way, unconditionally
// (see G.outer's applyCell).
const encloseIfNeeded = (x) => (Array.isArray(x) ? boxOf(x) : x);

// Catenate (,) splices a plain array's own elements in but must treat a
// boxed value as one atomic term - otherwise `1,(⊂2 3),4` would spill the
// box's content into the result instead of keeping it as a single enclosed
// element, same idea as mdfunc/drel's box see-through-and-rewrap rule.
const asCatenationTerms = (x) => (Array.isArray(x) && !isBoxed(x)) ? x : [x];

// Shared by mdfunc/drel: one (or both) of w/a is boxed. If the OTHER side
// is a genuine (non-boxed) array, the box's disclosed content broadcasts
// as a whole across every element of that array - it is not zipped
// index-for-index against it, even when the lengths happen to coincide.
// Verified against real Dyalog: 3 4=⊂1 2 3 4 compares 3, then 4, each
// against the *entire* disclosed 1 2 3 4, giving a 2-element result of
// individually re-enclosed 4-element sub-results - not a length-mismatch
// error from trying to zip a 2-vector with a 4-vector. When neither side
// is a genuine array (both scalar-like/boxed), recurse directly on the
// disclosed content instead - a shape mismatch there is a real LENGTH
// ERROR in APL too (confirmed: (⊂1 2 3 4)=⊂1 2 also errors in Dyalog).
const pervadeBoxed = (recurse, w, a) => {
  const box = (x) => (isScalarLike(x) ? x : boxOf(x));
  const wIsArray = Array.isArray(w) && !isBoxed(w);
  const aIsArray = Array.isArray(a) && !isBoxed(a);
  if (wIsArray && !aIsArray) {
    const aInner = isBoxed(a) ? a[0] : a;
    return w.map((x) => box(recurse(x, aInner)));
  }
  if (aIsArray && !wIsArray) {
    const wInner = isBoxed(w) ? w[0] : w;
    return a.map((x) => box(recurse(wInner, x)));
  }
  const wInner = isBoxed(w) ? w[0] : w;
  const aInner = isBoxed(a) ? a[0] : a;
  return box(recurse(wInner, aInner));
};

const mdfunc = (m,d,w,a) => {
  if(a === undefined) {
    if (isBoxed(w)) {
      return boxOf(mdfunc(m,d,w[0]));
    }
    if (typeof w === 'number') {
      return m(w);
    } else if (Array.isArray(w)) {
      return w.map(x => mdfunc(m,d,x));
    } else {
      throw new Error('DOMAIN ERROR: Unsupported type for monadic function');
    }
  }
  if (isBoxed(w) || isBoxed(a)) {
    return pervadeBoxed((w2, a2) => mdfunc(m, d, w2, a2), w, a);
  }
  if (typeof w === 'number' && typeof a === 'number') {
    return d(w, a);
  }
  if (Array.isArray(w) && typeof a === 'number') {
    return w.map(x => mdfunc(m,d,x,a));
  }
  if (typeof w === 'number' && Array.isArray(a)) {
    return a.map(x => mdfunc(m,d,w,x));
  }
  if (Array.isArray(w) && Array.isArray(a)) {
    if (w.length !== a.length) {
      throw new Error('LENGTH ERROR: Arrays must be of the same length for element-wise operation.');
    }
    return a.map((x, i) => mdfunc(m,d,w[i],x));
  } else {
    throw new Error('DOMAIN ERROR: Unsupported types for dyadic function');
  }
}

const matchRec = (w, a) => {
  if (typeof w === 'number' && typeof a === 'number') {
    return w === a ? 1 : 0;
  }
  if (typeof w === 'string' && typeof a === 'string') {
    return w === a ? 1 : 0;
  }
  if (Array.isArray(w) && Array.isArray(a)) { 
    if (w.length !== a.length) 
      return 0;
    for (let i = 0; i < w.length; i++) {
      if (matchRec(w[i], a[i]) === 0) {
        return 0;
      }
    }
    return 1;
  }
  return 0;
};

const mod = (w,a) => w-a*Math.floor(w/(a+((0===a)?1:0)));

// Gamma: Stirling's series for ln Γ, after shifting x up to ≥ 10 with
// Γ(x) = Γ(x+n) / (x(x+1)...(x+n-1)), where the series is accurate to
// double precision; the reflection formula covers x < 0.5.
const gamma = (x) => {
  if (x < 0.5) {
    return Math.PI / (Math.sin(Math.PI * x) * gamma(1 - x));
  }
  let shift = 1;
  while (x < 10) {
    shift *= x;
    x += 1;
  }
  const x2 = x * x;
  const series = 1 / 12 - (1 / 360 - (1 / 1260 - (1 / 1680 - (1 / 1188 - (691 / 360360 - 1 / (156 * x2)) / x2) / x2) / x2) / x2) / x2;
  const lnGamma = (x - 0.5) * Math.log(x) - x + 0.5 * Math.log(2 * Math.PI) + series / x;
  return Math.exp(lnGamma) / shift;
};

// !⍵ is Γ(⍵+1): exact product for a non-negative integer, gamma otherwise.
// A negative integer is a pole - DOMAIN ERROR, as in Dyalog (!2.5 is
// 3.323350970, !¯0.5 is 1.772453851).
const factorial = (n) => {
  if (Number.isInteger(n)) {
    if (n < 0) {
      throw new Error('DOMAIN ERROR: ! of a negative integer');
    }
    let result = 1;
    for (let i = 2; i <= n; i++) {
      result *= i;
    }
    return result;
  }
  return gamma(n + 1);
};

// ⍺!⍵ (k!n): the binomial coefficient, and its gamma generalization
// (!n)÷(!k)×!n-k for non-integers.
const binomial = (n, k) => {
  if (Number.isInteger(n) && Number.isInteger(k) && n >= 0) {
    if (k < 0 || k > n) {
      return 0;
    }
    let result = 1;
    for (let i = 1; i <= Math.min(k, n - k); i++) {
      result = result * (n - Math.min(k, n - k) + i) / i;
    }
    return Math.round(result);
  }
  return factorial(n) / (factorial(k) * factorial(n - k));
};

const gcd = (a, b) => {
  const gcdRec = (a, b) => {
    if (b === 0) {
      return a;
    }
    return gcdRec(b, a % b);
  };
  return Math.abs(gcdRec(a, b));
};

const lcm = (a, b) => {
  if (a === 0 || b === 0) {
    return 0;
  }
  return a * b / gcd(a, b);
};

const encode = (w, a) => {
  const result = a.slice();
  for (let i = a.length-1; i >= 0; i--) {
    const ai = a[i];
    result[i] = mod(w, ai);
    w = ai === 0 ? 0 : Math.floor(w / ai);
  }
  return result;
};

const decode = (w, a) => {
  if(typeof a === 'number') {
    a = Array.from({ length: w.length }, () => a);
  } else if (Array.isArray(a) && a.length === 1) {
    a = Array.from({ length: w.length }, () => a[0]);
  }
  let result = w[w.length-1];
  let multiplier = a[a.length-1];
  for (let i = a.length-2; i >= 0; i--) {
    result += multiplier * w[i];
    multiplier *= a[i];
  }
  return result;
};

const drel = (f, w, a) => {
  // Relational functions (< ≤ = ≥ > ≠) are pervasive too - same box
  // see-through/broadcast/rewrap rule as mdfunc (apl.js:203, pervadeBoxed
  // above). E.g. (⊂1 2)<⊂1 3 stays enclosed (⊂0 1), and 3 4=⊂1 2 3 4
  // broadcasts the disclosed 1 2 3 4 across 3 and 4 rather than erroring
  // on length (note: ⊂ on an already-simple scalar is a no-op - see
  // enclose below - so a plain (⊂3)<⊂5 never even reaches this branch).
  if (isBoxed(w) || isBoxed(a)) {
    return pervadeBoxed((w2, a2) => drel(f, w2, a2), w, a);
  }
  // A multi-character string is a character vector, compared item by item;
  // two scalars (numbers or single characters, mixed freely) compare
  // directly. Verified against real Dyalog: 'a'='a' is the scalar 1, and
  // 1='a' is 0 rather than an error.
  w = charItems(w);
  a = charItems(a);
  if (!Array.isArray(w) && !Array.isArray(a)) {
    return f(w, a) ? 1 : 0;
  }
  if(!Array.isArray(a) && Array.isArray(w)) {
    return w.map(x => drel(f, x, a));
  }
  if(Array.isArray(a) && !Array.isArray(w)) {
    return a.map(x => drel(f, w, x));
  }
  if(Array.isArray(a) && Array.isArray(w)) {
    if (a.length !== w.length) {
      throw new Error('LENGTH ERROR: Arrays must be of the same length for element-wise comparison.');
    }
    return a.map((x, i) => drel(f, w[i], x));
  }
  throw new Error('DOMAIN ERROR: Unsupported types for comparison');
}

// Strings: this file keeps text as plain JS strings (so they reach d3/Plot
// and other JS untouched), read two ways. A string ARGUMENT - the whole
// value a primitive gets - is a character vector (a 1-character one a
// character scalar), so ⍴'abc' is ,3. A string sitting as an ITEM of an
// array is opaque, like a box - 'ab' 'cd' is a 2-vector of enclosed
// strings, never misread as a 2×2 character matrix. Structural primitives
// split a string argument with charItems and, when the result is again a
// plain run of characters, turn it back into a string with joinChars.
const isChar = (x) => typeof x === 'string' && x.length === 1;
const charItems = (x) => (typeof x === 'string' && x.length !== 1 ? x.split('') : x);
const joinChars = (x) => (Array.isArray(x) && !isBoxed(x) && x.every(isChar) ? x.join('') : x);
// Fill element (Dyalog's prototype, simplified): ' ' for character data,
// 0 for anything else - judged by the first simple scalar found.
const fillFor = (x) => {
  let first = x;
  while (Array.isArray(first) && first.length > 0) {
    first = first[0];
  }
  return typeof first === 'string' ? ' ' : 0;
};

const shapeRec = (arr) => {
  if (typeof arr === 'string') {
    return arr.length === 1 ? [] : [arr.length];
  }
  return itemShapeRec(arr);
};

// shapeRec's structural walk, where a string is an opaque item (see above).
const itemShapeRec = (arr) => {
  const equalShape = (a, b) => {
    if(a.length !== b.length) 
      return false;
    for(let i=0; i<a.length; i++) {
      if(a[i] !== b[i]) 
        return false;
    }
    return true;
  }
  if(!Array.isArray(arr)) {
    return [];
  }
  if (Array.isArray(arr.shape)) {
    return arr.shape.slice();
  }
  const shape = itemShapeRec(arr[0]);
  for(let i=1; i<arr.length; i++) {
    if(!equalShape(shape, itemShapeRec(arr[i]))) {
      return [arr.length];
    }
  }
  shape.splice(0,0,arr.length);
  return shape;      
}

const fillShapeRec = (shape0, fillFunc) => {
  let index = 0;
  const fshape = (prefix, cellshape) => {
    if (cellshape.length === 0)
      return fillFunc(prefix, index++);  
    let sl = cellshape.slice(1);
    let result = [];
    for (let i = 0; i < cellshape[0]; i++) {
      const subArray = fshape(prefix.concat(i), sl);
      result.push(subArray);
    }
    return result;
  };
  return fshape([], shape0);
};

const traverseShapeRec = (shape0, fillFunc) => {
  let index = 0;
  const fshape = (prefix, cellshape) => {
    if (cellshape.length === 0)
      return fillFunc(prefix, index++);  
    let sl = cellshape.slice(1);
    for (let i = 0; i < cellshape[0]; i++) {
      fshape(prefix.concat(i), sl);
    }
  };
  return fshape([], shape0);
};

const at = (arr, idx) => {
  let result = arr;
  for (let i = 0; i < idx.length; i++) {
    result = result[idx[i]];
  }
  return result;
};

// Depth (monadic ≡): 0 for a simple scalar, otherwise 1 + the deepest
// depth among the CONTENTS of its scalar cells (a box's content is what it
// wraps, any other cell is its own content) - negated when those depths
// differ, as in Dyalog. Cells are found via shapeRec, so a plain matrix
// (rows are axes, not items) stays depth 1, and a box (rank 0, one cell)
// adds exactly one level. A multi-character string counts as a simple
// vector, a 1-character one as a scalar. Verified against real Dyalog:
// ≡5 is 0, ≡1 2 is 1, ≡(1 2)(3 4) is 2, ≡1(2 3) is ¯2, ≡⍬ is 1.
const depth = (w) => {
  if (typeof w === 'string') {
    return w.length === 1 ? 0 : 1;
  }
  if (!Array.isArray(w)) {
    return 0;
  }
  const contents = [];
  if (isBoxed(w)) {
    contents.push(w[0]);
  } else {
    traverseShapeRec(shapeRec(w), (prefix) => {
      const cell = at(w, prefix);
      contents.push(isBoxed(cell) ? cell[0] : cell);
    });
  }
  const depths = contents.map(depth);
  const max = Math.max(0, ...depths.map(Math.abs));
  return depths.every((d) => d === max) ? 1 + max : -(1 + max);
};

const assignRec = (arr, idx, value) => {
  if(typeof idx === 'number') {
    arr[idx] = value;
    return;
  }
  let result = arr;
  for (let i = 0; i < idx.length - 1; i++) {
    result = result[idx[i]];
  }
  result[idx[idx.length - 1]] = value;
};

// Squad's (⌷) indexing engine. idx is consumed one axis per recursion
// level - a bare number is normalized to a 1-element axis list so both
// entry points (a plain scalar index, or a real per-axis index array) go
// through the same rank/bounds checks below.
const getRec = (arr, idx) => {
  if (typeof idx === 'number') {
    idx = [idx];
  }
  if (!Array.isArray(idx)) {
    throw new Error('DOMAIN ERROR: Unsupported index type for squad');
  }
  if (idx.length === 0) {
    return arr;
  }
  // Still an axis left to consume, but arr has no axis to offer: a plain
  // scalar or a box (rank 0, always a 1-element JS array) used to let
  // arr[i] silently return JS undefined here instead of erroring.
  // Verified against real Dyalog: 2⌷⊂1 2 3 4 5 is a LENGTH ERROR.
  if (!Array.isArray(arr) || isBoxed(arr)) {
    throw new Error('LENGTH ERROR: too many indices for squad');
  }
  // A per-axis selector is a box when it's meant to select several indices
  // along this axis (e.g. (0 1)(2)⌷M picks rows 0 and 1, column 2) - it
  // arrives boxed because G.strand encloses every non-simple strand item,
  // so (0 1) in that strand is really ⊂0 1, not a raw [0,1]. Verified
  // against real Dyalog (⎕IO←0): (0 1)(2)⌷2 3⍴⍳6 is 2 5.
  const t0 = idx[0];
  const t = isBoxed(t0) ? t0[0] : t0;
  const rest = idx.slice(1);
  const checkBounds = (i) => {
    if (typeof i !== 'number' || i < 0 || i >= arr.length) {
      throw new Error('INDEX ERROR: index out of bounds for squad');
    }
  };
  if (typeof t === 'number') {
    checkBounds(t);
    return getRec(arr[t], rest);
  }
  if (!Array.isArray(t)) {
    throw new Error('DOMAIN ERROR: Unsupported index type for squad');
  }
  const result = [];
  for (let i = 0; i < t.length; i++) {
    checkBounds(t[i]);
    result.push(getRec(arr[t[i]], rest));
  }
  return result;
};

// Pick's (⊃) path-walking engine: unlike squad, which indexes across an
// array's own axes, pick walks successive levels of *enclosure* - each
// step must disclose a box before it can be indexed into. Verified
// against real Dyalog: 1 1⊃(1 2)(3(4 5)) is 4 5 (step into item 1, which
// is a box; disclose it; step into ITS item 1, another box; disclose
// that too), not two independent picks.
const pickPath = (w, path) => {
  let current = w;
  for (const idx of path) {
    if (isBoxed(current)) current = current[0];
    if (!Array.isArray(current) || typeof idx !== 'number' || idx < 0 || idx >= current.length) {
      throw new Error('INDEX ERROR: pick path out of bounds');
    }
    current = current[idx];
  }
  if (isBoxed(current)) current = current[0];
  return current;
};

// All four functions below used to guard entry with a raw
// `!Array.isArray(a[0])` check - which misreads a boxed cell (⊂x, always
// a 1-element array `[x]`) as "a row of width 1" and recurses INTO it
// instead of treating it as an opaque rank-0 value, corrupting the result
// (this is what broke dot product/inner product - apl.js:1258 - on a
// strand like `1 (2 2⍴...)`, whose non-scalar item is now a real box per
// G.strand). shapeRec(a).length checks the array's *true* rank (trusting
// a .shape tag before falling back to structural inference) rather than
// just peeking at a[0]'s literal JS shape, so a boxed element correctly
// reads as contributing no further axis to recurse into.
const transposeRec = (a) => {
  if (!Array.isArray(a) || shapeRec(a).length <= 1) {
    return a;
  }
  const result = [];
  for(let i=0; i<a[0].length; i++) {
    const newRow = transposeRec(a.map(row => row[i]));
    result.push(newRow);
  }
  return result;
};

const itransposeRec = (a) => {
  if (!Array.isArray(a) || shapeRec(a).length <= 1) {
    return a;
  }
  a = a.map(row => itransposeRec(row));
  const result = [];
  for(let i=0; i<a[0].length; i++) {
    const newRow = a.map(row => row[i]);
    result.push(newRow);
  }
  return result;
};

const transpose = (a) => {
  if (!Array.isArray(a) || shapeRec(a).length <= 1) {
    return a;
  }
  const shape = shapeRec(a).reverse();
  return fillShapeRec(shape,
    (prefix) => at(a, prefix.reverse()));
}

const invertPermutation = (perm) => {
  const inverse = new Array(perm.length);  
  for (let i = 0; i < perm.length; i++) {
    inverse[perm[i]] = i;
  }
  return inverse;
}

const permute = (a, p) => {
  if (!Array.isArray(a) || shapeRec(a).length <= 1) {
    return a;
  }
  if (!Array.isArray(p)) {
    throw new Error('DOMAIN ERROR: Permutation must be an array');
  }
  const shape = shapeRec(a);
  if (p.length !== shape.length) {
    throw new Error('LENGTH ERROR: Permutation length must match the array rank');
  }
  const newShape = p.map(i => shape[i]);
  const ip = invertPermutation(p);
  return fillShapeRec(newShape, 
    (prefix) => {
      return at(a, ip.map(i => prefix[i]));
    });
}

// Matrix multiply: A is m×k, B is k×n, result is m×n. Both plain row-major
// nested arrays, same convention as everything else in this file.
const matMul = (A, B) => {
  const m = A.length, k = B.length, n = B[0].length;
  const result = [];
  for (let i = 0; i < m; i++) {
    const row = new Array(n).fill(0);
    for (let t = 0; t < k; t++) {
      const a_it = A[i][t];
      for (let j = 0; j < n; j++) {
        row[j] += a_it * B[t][j];
      }
    }
    result.push(row);
  }
  return result;
};

// Square-matrix inverse via Gauss-Jordan elimination with partial pivoting.
const matInverse = (A) => {
  const n = A.length;
  const M = A.map((row, i) => row.concat(Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))));
  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let pivotAbs = Math.abs(M[col][col]);
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > pivotAbs) {
        pivotAbs = Math.abs(M[r][col]);
        pivotRow = r;
      }
    }
    if (pivotAbs < 1e-10) {
      throw new Error('DOMAIN ERROR: Matrix is singular and has no inverse');
    }
    if (pivotRow !== col) {
      [M[col], M[pivotRow]] = [M[pivotRow], M[col]];
    }
    const pivot = M[col][col];
    for (let j = 0; j < 2 * n; j++) {
      M[col][j] /= pivot;
    }
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      if (factor !== 0) {
        for (let j = 0; j < 2 * n; j++) {
          M[r][j] -= factor * M[col][j];
        }
      }
    }
  }
  return M.map((row) => row.slice(n));
};

// Domino (⌹): square matrices invert directly; a non-square, full-rank A
// gets the least-squares pseudo-inverse instead, via the normal equations
// (Aᵀ·A)⁻¹·Aᵀ when A is tall, or Aᵀ·(A·Aᵀ)⁻¹ when A is wide - same
// generalization Dyalog's monadic ⌹ makes.
const matPseudoInverse = (A) => {
  if (A.length === A[0].length) {
    return matInverse(A);
  }
  const At = transposeRec(A);
  return A.length > A[0].length
    ? matMul(matInverse(matMul(At, A)), At)
    : matMul(At, matInverse(matMul(A, At)));
};

// A "command" for ⍠ (buildObject) is [key, value(s)]. APL strand-flattening
// collapses a single-pair list (e.g. ('x' 5)) into a bare pair, and a
// one-command list into that command's own flat array (e.g. (('x' 5)) ===
// ('x' 5)). Both cases are disambiguated here: a command list's first
// element is only ever an array once there is more than one command, so a
// leading string means "this whole thing is one command".
// Each command is disclosed if boxed - a multi-command strand like
// (#create #svg)(#attr #width 500) now really encloses each inner
// (#create #svg)-style pair (a strand item that isn't a simple scalar -
// see G.strand), the same as any other non-trivial strand item would be.
//
// A command's own ARGUMENTS get the same treatment for the same reason:
// (#data pts) is itself a strand, so a real-array pts (e.g. an n×2 point
// matrix) arrives boxed too - G.strand encloses every item, not just
// whole commands. d3/Plot are plain JS with no notion of an APL box, so
// handing them the box (a 1-element array wrapping pts) instead of pts
// itself silently binds ONE datum (the whole matrix) rather than n rows.
// Verified against the live bug: (#data pts) was reaching d3's .data()
// as [pts], not pts, producing one garbled <circle> instead of n real
// ones. Only argument slots are disclosed here, never the command name.
const discloseCommandArgs = (cmd) => [cmd[0], ...cmd.slice(1).map((x) => (isBoxed(x) ? x[0] : x))];

const normalizeCommandList = (w) => {
  if (!Array.isArray(w)) {
    return [[w]];
  }
  if (w.length === 0) {
    return [];
  }
  if (typeof w[0] === 'string') {
    return [discloseCommandArgs(w)];
  }
  return w.map(cmd => {
    const item = isBoxed(cmd) ? cmd[0] : cmd;
    return discloseCommandArgs(Array.isArray(item) ? item : [item]);
  });
};

const reverseAxis = (w, firstAxis) => {
  if (typeof w === 'string') {
    return reverseAxis(w.split(''), firstAxis).join('');
  }
  if (!Array.isArray(w)) {
    return w;
  }
  const shape = shapeRec(w);
  // A rank-0 array (a box, .shape=[]) has no axis to reverse along -
  // verified against real Dyalog, 1⊖⊂1 2 3 is a no-op. Without this guard
  // axis fell back to -1/undefined and at(w, [NaN]) silently returned
  // undefined instead of w.
  if (shape.length === 0) {
    return w;
  }
  const axis = firstAxis ? 0 : shape.length - 1;
  const n = shape[axis];
  return fillShapeRec(shape, (prefix) => {
    const idx = prefix.slice();
    idx[axis] = n - 1 - prefix[axis];
    return at(w, idx);
  });
};

const rotateAxis = (w, a, firstAxis) => {
  if (typeof w === 'string') {
    return rotateAxis(w.split(''), a, firstAxis).join('');
  }
  if (!Array.isArray(w)) {
    return w;
  }
  const shape = shapeRec(w);
  // Same rank-0 no-op as reverseAxis above - 1⊖⊂1 2 3 leaves the box
  // untouched in real Dyalog rather than erroring or rotating nothing.
  if (shape.length === 0) {
    return w;
  }
  const axis = firstAxis ? 0 : shape.length - 1;
  const n = shape[axis];
  return fillShapeRec(shape, (prefix) => {
    const amount = typeof a === 'number' ? a : at(a, prefix.filter((_, i) => i !== axis));
    const shift = ((amount % n) + n) % n;
    const idx = prefix.slice();
    idx[axis] = (prefix[axis] + shift) % n;
    return at(w, idx);
  });
};

// Shared by dyadic ⊂ and ⊆: ⍺ (a scalar extends) is split against ⍵'s
// items, and every resulting partition comes back enclosed. A string ⍵ is
// split into characters and each partition joined back into a string, in
// keeping with this file's "a string is one JS string" model.
const partitionArgs = (a, w, name) => {
  const wasString = typeof w === 'string';
  const items = wasString ? w.split('') : w;
  if (!Array.isArray(items)) {
    throw new Error(`DOMAIN ERROR: ${name} requires an array right argument`);
  }
  const keys = Array.isArray(a) ? a.map((k) => (isBoxed(k) ? k[0] : k)) : items.map(() => a);
  if (keys.length !== items.length) {
    throw new Error(`LENGTH ERROR: ${name} requires ⍺ and ⍵ of the same length`);
  }
  const finish = (parts) => parts.map((p) => (wasString ? p.join('') : boxOf(p)));
  return { items, keys, finish };
};

// Partitioned enclose (⍺⊂⍵): ⍺[i] is how many NEW partitions start right
// before ⍵[i] (0 just continues the current one; more than 1 inserts
// empties), and items before the first partition start are dropped.
// Verified against real Dyalog: 1 0 1 0⊂1 2 3 4 is (1 2)(3 4), and
// 0 1 0 2⊂1 2 3 4 is (2 3)⍬(,4).
const partitionedEnclose = (a, w) => {
  const { items, keys, finish } = partitionArgs(a, w, 'Partitioned enclose');
  const parts = [];
  items.forEach((x, i) => {
    for (let k = 0; k < keys[i]; k++) {
      parts.push([]);
    }
    if (parts.length > 0) {
      parts[parts.length - 1].push(x);
    }
  });
  return finish(parts);
};

// Partition (⍺⊆⍵): a new partition starts wherever ⍺ grows over its left
// neighbour, and a 0 drops its item (and ends the current partition).
// Verified against real Dyalog: 1 1 2 2⊆1 2 3 4 is (1 2)(3 4), while
// 2 2 1⊆1 2 3 is one partition (1 2 3) - 1 doesn't exceed 2.
const partition = (a, w) => {
  const { items, keys, finish } = partitionArgs(a, w, 'Partition');
  const parts = [];
  let previous = 0;
  items.forEach((x, i) => {
    const key = keys[i];
    if (key !== 0) {
      if (key > previous) {
        parts.push([]);
      }
      parts[parts.length - 1].push(x);
    }
    previous = key;
  });
  return finish(parts);
};

const flattenDeep = (w) => {
  if (!Array.isArray(w)) {
    return [w];
  }
  return w.reduce((acc, x) => acc.concat(flattenDeep(x)), []);
};

const isMember = (item, list) => list.some(x => matchRec(item, x) === 1);

// Provisional implementation: O(n²) (a matchRec-based .some() scan of the
// result-so-far per item), fine for the REPL's typical small arrays but
// not something to rely on for large inputs. Used by G.unique (∪) and
// G.intersect (∩). A real fix would need a hashable key per item (cheap
// for simple scalars, harder for nested/boxed items, which still need
// matchRec's structural comparison) to get this down to roughly O(n).
const uniqueItems = (items) => {
  const result = [];
  for (const item of items) {
    if (!result.some(x => matchRec(x, item) === 1)) {
      result.push(item);
    }
  }
  return result;
};

// Rounds x to `digits` significant figures (⎕pp's unit - unlike ⍕'s dyadic
// form, which rounds to a fixed number of *decimal places* instead).
// digits===undefined means "no rounding", so every caller below stays a
// no-op unless a ⎕pp value is actually threaded through.
const roundSignificant = (x, digits) => {
  if (digits === undefined || !Number.isFinite(x) || x === 0) {
    return x;
  }
  // toPrecision rather than scaling by a power of 10, which overflows to
  // Infinity (and then NaN) for very small or very large x.
  return Number(x.toPrecision(Math.min(Math.max(Math.round(digits), 1), 100)));
};

// JS number text -> APL spelling: ¯ for every minus sign (mantissa and
// exponent alike) and Dyalog's E notation, e.g. -1e-7 -> ¯1E¯7.
const aplNumberText = (text) => text.replace(/e\+?/, 'E').replace(/-/g, '¯').replace('Infinity', '∞');

// Same, recursively applied through (possibly nested) arrays - used to
// round a whole result/⎕← value for display without touching non-numbers
// (strings, scene-graph objects, ...) or the original arrays/value itself.
const roundValue = (value, digits) => {
  if (digits === undefined) {
    return value;
  }
  if (typeof value === 'number') {
    return roundSignificant(value, digits);
  }
  if (Array.isArray(value)) {
    const mapped = value.map((v) => roundValue(v, digits));
    if (Array.isArray(value.shape)) {
      mapped.shape = value.shape;
    }
    return mapped;
  }
  return value;
};

const formatNum = (x, digits) => {
  if (typeof x !== 'number') {
    return String(x);
  }
  const v = Object.is(roundSignificant(x, digits), -0) ? 0 : roundSignificant(x, digits);
  return aplNumberText(String(v));
};

const formatCell = (x, digits) => (typeof x === 'string' ? x : formatNum(x, digits));

// Right-aligned columns, for ⍕'s dyadic (fixed-decimals) form.
const padColumns = (rows) => {
  const cols = rows[0].length;
  const widths = Array.from({ length: cols }, (_, j) =>
    Math.max(...rows.map(r => r[j].length)));
  return rows.map(r => r.map((c, j) => c.padStart(widths[j])).join(' ')).join('\n');
};

// Monadic ⍕'s layout, close to Dyalog's: a simple vector is space-separated,
// a character vector/matrix is printed as plain text, nested items sit side
// by side two spaces apart (each item its own top-aligned block of lines,
// so a matrix inside a vector keeps its rows), columns of a matrix are
// right-aligned, and a rank ≥ 3 array prints its major cells one after
// another separated by a blank line.
const formatBlocks = (blocks, sep) => {
  const height = Math.max(...blocks.map((b) => b.length));
  const widths = blocks.map((b) => Math.max(0, ...b.map((line) => line.length)));
  return Array.from({ length: height }, (_, i) =>
    blocks.map((b, j) => (b[i] ?? '').padEnd(widths[j])).join(sep).trimEnd()).join('\n');
};

const isSimpleScalar = (x) => typeof x === 'number' || isChar(x) || x === null || typeof x === 'boolean';

const formatArray = (w, digits) => {
  if (typeof w === 'string') {
    return w;
  }
  if (!Array.isArray(w)) {
    return formatCell(w, digits);
  }
  if (isBoxed(w)) {
    return formatArray(w[0], digits);
  }
  const shape = shapeRec(w);
  if (shape.includes(0)) {
    return '';
  }
  const block = (x) => formatArray(x, digits).split('\n');
  if (shape.length === 1) {
    if (w.every(isChar)) {
      return w.join('');
    }
    if (w.every(isSimpleScalar)) {
      return w.map((c) => formatCell(c, digits)).join(' ');
    }
    return formatBlocks(w.map(block), '  ');
  }
  if (shape.length === 2) {
    if (w.every((row) => row.every(isChar))) {
      return w.map((row) => row.join('')).join('\n');
    }
    const nested = !w.every((row) => row.every(isSimpleScalar));
    const cells = w.map((row) => row.map(block));
    const widths = cells[0].map((_, j) => Math.max(...cells.map((row) => Math.max(...row[j].map((l) => l.length)))));
    return cells.map((row) => {
      const height = Math.max(...row.map((b) => b.length));
      return Array.from({ length: height }, (_, k) => row.map((b, j) => {
        const line = b[k] ?? '';
        return typeof w[0][j] === 'number' && !nested ? line.padStart(widths[j]) : line.padEnd(widths[j]);
      }).join(nested ? '  ' : ' ').trimEnd()).join('\n');
    }).join('\n');
  }
  return w.map((cell) => formatArray(cell, digits)).join('\n\n');
};

const formatFixed = (x, decimals) => {
  if (typeof x !== 'number') {
    return String(x);
  }
  return aplNumberText(x.toFixed(decimals));
};

const formatArrayFixed = (w, decimals, width) => {
  const fmtOne = (x) => {
    const s = formatFixed(x, decimals);
    return width ? s.padStart(width) : s;
  };
  if (typeof w === 'string') {
    return w;
  }
  if (!Array.isArray(w)) {
    return fmtOne(w);
  }
  if (w.length === 0 || !Array.isArray(w[0])) {
    return w.map(fmtOne).join(' ');
  }
  return padColumns(w.map(row => row.map(fmtOne)));
};

const totalCompare = (a, b) => {
  const aIsArray = Array.isArray(a);
  const bIsArray = Array.isArray(b);

  if (aIsArray && bIsArray) {
    const minLength = Math.min(a.length, b.length);
    
    for (let i = 0; i < minLength; i++) {
      const result = totalCompare(a[i], b[i]);
      if (result !== 0) return result;
    }
    
    return a.length - b.length;
  }

  if (aIsArray) return -1;
  if (bIsArray) return 1;
  // Mixed simple scalars: numbers sort before characters, as in Dyalog,
  // instead of whatever JS's own number/string coercion would make of it.
  if (typeof a !== typeof b) return typeof a === 'number' ? -1 : 1;

  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

// Mix (monadic ↑): ⍵'s items - each disclosed, a string read as its
// characters - become the trailing axes of one simple array, every item
// padded with the fill element up to the largest item's shape (a lower-rank
// item gets leading unit axes). Verified against real Dyalog: ↑(1 2)(3 4 5)
// is 2 3⍴1 2 0 3 4 5, and ↑1(2 3) is 2 2⍴1 0 2 3.
const mix = (w) => {
  if (typeof w === 'string' || !Array.isArray(w)) {
    return w;
  }
  if (isBoxed(w)) {
    return w[0];
  }
  const frame = shapeRec(w);
  const items = [];
  traverseShapeRec(frame, (p) => {
    const cell = at(w, p);
    items.push(charItems(isBoxed(cell) ? cell[0] : cell));
  });
  if (items.length === 0) {
    return w;
  }
  const shapes = items.map(shapeRec);
  const r = Math.max(...shapes.map((sh) => sh.length));
  const padded = shapes.map((sh) => Array(r - sh.length).fill(1).concat(sh));
  const inner = Array.from({ length: r }, (_, i) => Math.max(...padded.map((sh) => sh[i])));
  const fill = fillFor(items[0]);
  let k = 0;
  const cellsByFrame = new Map();
  traverseShapeRec(frame, (p) => { cellsByFrame.set(p.join(','), k++); });
  return fillShapeRec(frame.concat(inner), (p) => {
    const j = cellsByFrame.get(p.slice(0, frame.length).join(','));
    const item = items[j];
    const sh = padded[j];
    const q = p.slice(frame.length);
    if (q.some((x, i) => x >= sh[i])) {
      return fill;
    }
    const realRank = shapes[j].length;
    return realRank === 0 ? item : at(item, q.slice(r - realRank));
  });
};

// Split (monadic ↓): each vector along ⍵'s last axis becomes one enclosed
// item - a run of characters a string - so ↓ of a character matrix is a
// vector of strings. Verified against real Dyalog: ↓2 3⍴⍳6 is (0 1 2)(3 4 5).
const split = (w) => {
  const shape = shapeRec(w);
  if (shape.length === 0 || typeof w === 'string') {
    return w;
  }
  const n = shape[shape.length - 1];
  const result = fillShapeRec(shape.slice(0, -1), (p) => {
    const vec = Array.from({ length: n }, (_, j) => at(w, p.concat(j)));
    return n > 0 && vec.every(isChar) ? vec.join('') : boxOf(vec);
  });
  return result;
};

// Shared by G.take/G.drop (see there). For take, |⍺[i]| is the new length
// of axis i, counted from the end when negative; for drop it's how many
// items come off that axis (from the end when negative).
const takeDrop = (w, a, isDrop) => {
  const name = isDrop ? 'Drop' : 'Take';
  const wasString = typeof w === 'string';
  w = charItems(w);
  if (!Array.isArray(w) || isBoxed(w)) {
    w = [w];
  }
  if (typeof a === 'number') {
    a = [a];
  }
  if (!Array.isArray(a)) {
    throw new Error(`DOMAIN ERROR: ${name} requires a numeric left argument`);
  }
  const shape = shapeRec(w);
  if (a.length > shape.length) {
    throw new Error(`LENGTH ERROR: ${name} shape has more dimensions than the array`);
  }
  const fill = fillFor(w);
  const resultShape = shape.slice();
  for (let i = 0; i < a.length; i++) {
    resultShape[i] = isDrop ? Math.max(0, shape[i] - Math.abs(a[i])) : Math.abs(a[i]);
  }
  const result = fillShapeRec(resultShape, (prefix) => {
    const idx = prefix.slice();
    for (let i = 0; i < a.length; i++) {
      if (isDrop) {
        idx[i] = a[i] < 0 ? prefix[i] : prefix[i] + a[i];
      } else {
        idx[i] = a[i] < 0 ? prefix[i] + shape[i] + a[i] : prefix[i];
      }
      if (idx[i] >= shape[i] || idx[i] < 0) {
        return fill;
      }
    }
    return at(w, idx);
  });
  if (resultShape.includes(0)) {
    result.shape = resultShape;
  }
  return wasString && resultShape.length === 1 ? joinChars(result) : result;
};

// Catenation along any axis of two arrays of rank ≥ 2 (for rank ≤ 1 the
// plain vector splice in G.comma applies). Dyalog's rules: equal ranks
// must agree on every other axis; an argument one rank short gets a unit
// axis inserted at the catenation axis (so a vector becomes one more
// column/row); a scalar is extended to a full unit-thick slice. Verified
// against real Dyalog: (2 2⍴1),2 2⍴0 is 2 4, (2 2⍴1),9 8 is 2 3, and
// (2 2⍴1)⍪0 is 3 2.
const catenateAxis = (a, w, firstAxis) => {
  a = charItems(a);
  w = charItems(w);
  let sa = shapeRec(a);
  let sw = shapeRec(w);
  const r = Math.max(sa.length, sw.length);
  const axis = firstAxis ? 0 : r - 1;
  const raise = (x, sx, other) => {
    if (sx.length === r) {
      return [x, sx];
    }
    if (sx.length === 0) {
      const s = other.slice();
      s[axis] = 1;
      return [fillShapeRec(s, () => x), s];
    }
    if (sx.length === r - 1) {
      const s = sx.slice();
      s.splice(axis, 0, 1);
      return [fillShapeRec(s, (p) => at(x, p.filter((_, i) => i !== axis))), s];
    }
    throw new Error('RANK ERROR: catenation arguments differ in rank by more than 1');
  };
  // Raise the non-scalar side first, so a scalar side can copy its shape.
  if (sa.length !== 0) [a, sa] = raise(a, sa, sw);
  if (sw.length !== 0) [w, sw] = raise(w, sw, sa);
  if (sa.length === 0) [a, sa] = raise(a, sa, sw);
  if (sw.length === 0) [w, sw] = raise(w, sw, sa);
  if (sa.some((d, i) => i !== axis && d !== sw[i])) {
    throw new Error('LENGTH ERROR: catenation arguments disagree on the other axes');
  }
  const na = sa[axis];
  const shape = sa.slice();
  shape[axis] = na + sw[axis];
  const result = fillShapeRec(shape, (p) => {
    if (p[axis] < na) {
      return at(a, p);
    }
    const q = p.slice();
    q[axis] -= na;
    return at(w, q);
  });
  if (shape.includes(0)) {
    result.shape = shape;
  }
  return result;
};

// Rank operator (⍤) helper: given the requested rank `k` and an operand's
// actual rank `n`, returns the cell rank per Dyalog's clamping rule -
// non-negative k clamps at n, negative k counts back from n and clamps at 0.
const cellRankFor = (k, n) => (k >= 0 ? Math.min(k, n) : Math.max(n + k, 0));

// Dyadic compress/expand's actual vector-level algorithm, shared by both
// axis forms: ⍺⌿⍵/⍺⍀⍵ (first axis) call these directly on ⍵'s top-level
// items, while ⍺/⍵/⍺\⍵ (last axis, see G.compress/G.expand below) recurse
// down to rank<=1 first and call these at every leaf instead.
const compressAxis = (w, a) => {
  // Either side broadcasts if it's scalar-like (a plain number/string, or -
  // the box-safety fix - a boxed value) to match the other side's length.
  // Verified against real Dyalog: 3/1 2 3 repeats the count 3 for every
  // element (previously unsupported here - a bare a.length check required a
  // to already be an array), and 1 0 1/⊂1 2 3 broadcasts the boxed scalar to
  // 3 positions before dropping the middle one. Compress never discloses a
  // boxed item on the w side - it's structural, not pervasive, so a
  // kept/dropped/repeated item passes through exactly as it was, box or not.
  const wasString = typeof w === 'string';
  const witems = wasString ? w.split('') : w;
  const wIsScalar = isScalarLike(witems);
  const aIsScalar = isScalarLike(a);
  if (!wIsScalar && !Array.isArray(witems)) {
    throw new Error('DOMAIN ERROR: Unsupported types for compress');
  }
  if (!aIsScalar && !Array.isArray(a)) {
    throw new Error('DOMAIN ERROR: Unsupported types for compress');
  }
  if (!wIsScalar && !aIsScalar && witems.length !== a.length) {
    throw new Error('LENGTH ERROR: Length mismatch for compress');
  }
  const length = wIsScalar ? (aIsScalar ? 1 : a.length) : witems.length;
  const result = [];
  for (let i = 0; i < length; i++) {
    const item = wIsScalar ? witems : witems[i];
    const countCell = aIsScalar ? a : a[i];
    const count = isBoxed(countCell) ? countCell[0] : countCell;
    for (let j = 0; j < count; j++) {
      result.push(item);
    }
  }
  return (wasString && !wIsScalar) ? result.join('') : result;
};
const expandAxis = (w, a) => {
  if (!Array.isArray(a)) {
    throw new Error('DOMAIN ERROR: Expand requires a 0/1 mask vector for ⍺');
  }
  const wasString = typeof w === 'string';
  const witems = Array.isArray(w) ? w : (wasString ? w.split('') : [w]);
  const fill = fillFor(witems);
  let wi = 0;
  const result = [];
  for (const cell of a) {
    const bit = isBoxed(cell) ? cell[0] : cell;
    if (bit) {
      if (wi >= witems.length) {
        throw new Error('LENGTH ERROR: not enough elements for expand');
      }
      result.push(witems[wi++]);
    } else {
      result.push(fill);
    }
  }
  if (wi !== witems.length) {
    throw new Error('LENGTH ERROR: too many elements for expand');
  }
  return wasString ? joinChars(result) : result;
};

// The jot (∘) derived function itself - see G.jot, which wraps it to
// attach an inverse.
const jotApply = (f, g) => (w, a) => {
  // f is a bound value, g a function: (f∘g)⍵ ≡ f g ⍵ - f is g's LEFT
  // argument (⍺), the jot's own ⍵ is g's right. Every primitive here
  // takes (w,a) positionally, so that's g(w, f), not g(f, w) - the
  // latter swaps ⍺ and ⍵, which non-commutative functions expose.
  // Verified against real Dyalog: (2∘|)5 is 1 (2|5), not 2.
  if(typeof f !== 'function') {
    return g(w, f);
  }
  // g is a bound value, f a function: (f∘g)⍵ ≡ ⍵ f g - the jot's own
  // ⍵ is f's LEFT argument, g is f's right. Same swap for the same
  // reason. Verified against real Dyalog: (|∘2)5 is 2 (5|2), not 1.
  if(typeof g !== 'function') {
    return f(g, w);
  }
  return f(g(w),a);
};

// --- Runtime: one property per primitive glyph's `name` in global_category
// above. Generated JS (see emitJs) calls into these directly, e.g. `2×3`
// compiles to `G.times(3, 2)`. Monadic-only call sites simply omit `a`. ---
const G = {
  buildObject: (w, a) => {
    if (a === undefined) {
      const result = {};
      const commands = normalizeCommandList(w);
      for (let i = 0; i < commands.length; i++) {
        const cmd = commands[i];
        if (cmd.length === 2) {
          result[cmd[0]] = cmd[1];
        } else {
          result[cmd[0]] = cmd.slice(1);
        }
      }
      return result;
    }
    // obj⍠('x' a b)('y' c d)('z') chains: obj.x(a,b) first, then .y(c,d)
    // on *that* result, then a bare get of .z off of that (no args = get,
    // not call - same command-list shape buildObject's monadic form above
    // already accepts). Every step's get rebinds a function property to
    // its own immediate receiver, the same rule the plain obj⍠'key' case
    // below uses (bind-on-get is what survives storing/passing the result
    // around - binding inside ⍔ instead would only work if ⍔ sits right
    // next to this exact ⍠ call). A command whose one and only argument is
    // ⎕null - ('name' ⎕null) - calls with zero real arguments instead,
    // distinct from a bare ('name') get-not-call. ⎕null (not ⍬) is the
    // sentinel specifically so ⍬ stays free to mean an actual empty-array
    // argument (e.g. .domain(⍬) to really pass []), which a same-shape ⍬
    // sentinel would have made impossible to express here.
    const isZeroArgMarker = (args) => args.length === 1 && args[0] === null;
    if (Array.isArray(w)) {
      let current = a;
      for (const cmd of normalizeCommandList(w)) {
        const [name, ...args] = cmd;
        const prop = current[name];
        const bound = typeof prop === 'function' ? prop.bind(current) : prop;
        current = args.length === 0 ? bound : isZeroArgMarker(args) ? bound() : bound(...args);
      }
      return current;
    }
    const v = a[w];
    if (typeof v !== 'function') {
      return v;
    }
    // FFI-friendly like the old bindMethod was: an array argument spreads
    // as positional JS params, a bare scalar/string becomes the sole
    // argument, so (obj⍠'toFixed')⍔2 works without forcing ,2.
    return (args) => v.apply(a, Array.isArray(args) ? args : [args]);
  },
  // The inverse of ⍞ - see global_category above. Purely a category
  // relabel (V to F); nothing to do at runtime, the value was already
  // whatever it was (buildObject's dyadic form above is what actually
  // binds an extracted function to its receiver).
  asFunction: (f) => f,
  // Codegen-only helper, not a real APL primitive - juxtaposed-value strand
  // literals like (1 2)(3 4) compile to G.strand([...]) (see emitJs's
  // Strand case), which encloses each item exactly like monadic ⊂ would
  // (encloseIfNeeded above) - a no-op for a simple scalar, but a real box
  // around anything else. This isn't just a display nicety: verified
  // against real Dyalog with bracket indexing (which - unlike ¨ - does NOT
  // auto-disclose), ⍴((1 2)(3 4))[1] is ⍬ and ≡((1 2)(3 4))[1] is 2 - the
  // element really is boxed, one more level than a bare 1 2 (depth 1)
  // would be. (An earlier version of this comment claimed elements were
  // left untouched, based on probing with ⍴¨ - but ¨ itself discloses each
  // item before applying ⍴, which was silently hiding the box.) Once every
  // element is properly boxed, the array's own top-level shape - [length]
  // - falls out of ordinary structural inference (shapeRec stops at each
  // element's .shape=[] tag), so nothing needs to be stamped explicitly
  // here the way G.outer stamps its result's shape.
  strand: (arr) => arr.map(encloseIfNeeded),
  Math,
  Date,
  JSON,
  console,
  // Getters (not bare identifiers, not a one-time snapshot) so this module
  // still loads cleanly under Node or in a page that never loaded d3/Plot -
  // they just read as undefined - and so it doesn't matter whether the
  // host page's <script> tags for them run before or after this import.
  get d3() { return globalThis.d3; },
  get Plot() { return globalThis.Plot; },
  zilde: [],
  emptyFunc: (w, a) => [],
  // ⎕pp: significant digits shown for numeric output (formatNum/⍕/⎕←) -
  // Dyalog's own default. A plain data property, not an accessor: each
  // session's Object.create(G) context gets its own value the moment it's
  // assigned (⎕pp←4 compiles to a normal G.pp = 4), same as any other
  // reassignable global.
  pp: 10,
  get io() { return 0; },
  set io(value) {
    if (value !== 0) {
      throw new Error('DOMAIN ERROR: ⎕IO is fixed at 0 in APL.js');
    }
  },
  null: null,
  undefined: undefined,
  set quad(value) {
    console.log('⎕:', roundValue(value, this.pp));
  },
  right: (w) => w,
  left: (w,a) => (a===undefined?w:a),
  each: (f)=>(w, a) => {
    if (typeof f !== 'function') {
      throw new Error('DOMAIN ERROR: Each requires a function');
    }
    // A box is one rank-0 cell for each too, not an array to iterate -
    // same disclose/apply/re-enclose rule as pervadeBoxed/G.outer.
    // Verified against real Dyalog: ⊢¨⊂1 2 3 discloses to 1 2 3, applies
    // ⊢ (identity), and re-encloses - it displays as a single box, and ⍴
    // of it is ⍬ (rank 0), not [1,3] (which is what a raw
    // Array.isArray(w)-driven .map over the box's own single JS slot
    // used to produce).
    const applyCell = (wCell, aCell) => {
      const wArg = isBoxed(wCell) ? wCell[0] : wCell;
      const aArg = isBoxed(aCell) ? aCell[0] : aCell;
      return encloseIfNeeded(f(wArg, aArg));
    };
    // A string argument is its characters, one cell each - and if every
    // result is again a single character, they form a string back.
    // Verified against real Dyalog: ≢¨'abc' is 1 1 1.
    const fromString = typeof w === 'string' && w.length !== 1;
    w = charItems(w);
    a = charItems(a);
    const wIsArray = Array.isArray(w) && !isBoxed(w);
    const aIsArray = Array.isArray(a) && !isBoxed(a);
    let result;
    if (wIsArray && aIsArray) {
      if (w.length !== a.length) {
        throw new Error('LENGTH ERROR: each requires arguments of the same length');
      }
      result = w.map((x,i) => applyCell(x, a[i]));
    } else if (wIsArray) {
      result = w.map(x => applyCell(x, a));
    } else if (aIsArray) {
      result = a.map(x => applyCell(w, x));
    } else {
      return applyCell(w, a);
    }
    return fromString && result.length > 0 ? joinChars(result) : result;
  },
  power: (f, g)=>(w, a) => {
    if (typeof f !== 'function') {
      throw new Error('DOMAIN ERROR: Power requires a function');
    }
    if (typeof g === 'number') {
      // A negative count applies the inverse that many times instead -
      // verified against real Dyalog: 2(+⍣¯1)5 is 3, and 2(⊥⍣¯1)5 is
      // 1 0 1 (⊤ as ⊥'s inverse - see INVERSE).
      const step = g < 0 ? inverseOf(f) : f;
      let result = w;
      for (let i = 0; i < Math.abs(g); i++) {
        result = step(result, a);
      }
      return result;
    }
    if (typeof g === 'function') {
      let result = w;
      let newResult;
      let iterations = 100000; // Prevent infinite loops
      // Dyalog returns the first NEW value for which (new g old) holds, not
      // the old one - verified: {⍵×2}⍣{⍺>100}1 is 128, not 64. (For the
      // usual ⍣= fixpoint the two coincide, which hid this.)
      while (g(result, newResult=f(result, a)) === 0 && iterations > 0) {
        result = newResult;
        iterations--;
      }
      return newResult;
    }
    throw new Error('DOMAIN ERROR: Power requires a function or a number');
  },
  reverse: (w, a) => {
    if (a === undefined) {
      return reverseAxis(w, false);
    }
    return rotateAxis(w, a, false);
  },
  reverse_first: (w, a) => {
    if (a === undefined) {
      return reverseAxis(w, true);
    }
    return rotateAxis(w, a, true);
  },
  selfie: (f)=>(w, a) => {
    if(typeof f !== 'function')
      return f;
    if (a===undefined) {
      return f(w, w);
    }
    return f(a, w);
  },
  over: (f,g)=>(w, a) => {
    return f(g(w), a!==undefined ? g(a) : a);
  },
  rho: (w, a) => {
    if (a===undefined) {
      return shapeRec(w);
    }
    const wasString = typeof w === 'string';
    w = charItems(w);
    if (!Array.isArray(w)) {
      w = [w];
    }
    if (!Array.isArray(a)) {
      a = [a];
    }
    const m = w.length;
    // An empty ⍵ has nothing to cycle through, so every position gets the
    // fill element instead - verified against real Dyalog: 5⍴⍬ is 0 0 0 0 0.
    const result = fillShapeRec(a, (prefix, index) => (m === 0 ? 0 : w[index % m]));
    if (wasString && a.length === 1) {
      // 5⍴'abc' is the string 'abcab', not a list of characters.
      return joinChars(result);
    }
    if (a.includes(0)) {
      // Any zero dimension collapses everything nested inside it to a
      // bare [] - e.g. 0 3⍴w has nothing left to structurally reveal the
      // "3" (fillShapeRec never recurses into a 0-length level), so the
      // requested shape has to be stamped explicitly for shapeRec to
      // recover it instead of guessing [0].
      result.shape = a.slice();
    }
    return result;
  },
  match: (w, a) => {
    if (a === undefined) {
      return depth(w);
    }
    return matchRec(w, a);
  },
  tally: (w, a) => {
    if (a !== undefined) {
      return matchRec(w, a)===1 ? 0 : 1; 
    }
    if (Array.isArray(w)||typeof w === 'string') {
      return w.length;
    } else {
      return 1; 
      // console.log('tally:', w, typeof w);
      // throw new Error(`DOMAIN ERROR: Unsupported type for tally ${typeof w}`);
    }
  }, 
  compress: (w, a) => {
    if (a === undefined) {
      // Monadic / is "reduce along the LAST axis" (see the / and \
      // comment on global_category, and reduceStack's two R-keyed
      // rules). ⌿ already reduces along the FIRST axis for free - a
      // pervasive f like + combines whole top-level items elementwise on
      // its own, so +⌿(2 3⍴⍳6) is [3,5,7] (rows added elementwise) with
      // no special axis handling in G.reduce at all. Last axis has no
      // such shortcut: it means "reduce each innermost vector on its
      // own", so this recurses down to rank<=1 - reusing G.reduce's own
      // identity rule there for a rank-0 leaf - before reducing each
      // leaf independently. w here is ⍺⍺ (the operand function), not a
      // value - same a===undefined dispatch idiom pick/squad/domino use
      // to tell a monadic call from a dyadic one.
      const f = w;
      const reduceLastAxis = (arr) => (shapeRec(arr).length <= 1 ? G.reduce(f)(arr) : arr.map(reduceLastAxis));
      return reduceLastAxis;
    }
    // Dyadic ⍺/⍵ compresses along the LAST axis (unlike ⍺⌿⍵, which stays on
    // the first - see G.reduce's own dyadic branch, which calls compressAxis
    // directly instead of this): recurse down to rank<=1, exactly like
    // reduceLastAxis above, then compress each innermost vector on its own
    // using the shared ⍺ mask/counts. Verified against real Dyalog: 1 0
    // 1/2 3⍴⍳6 is [[0,2],[3,5]] (each ROW loses its middle element), while
    // 1 0⌿2 3⍴⍳6 is [[0,1,2]] (the matrix loses its second ROW entirely).
    const compressLastAxis = (arr) => (shapeRec(arr).length <= 1 ? compressAxis(arr, a) : arr.map(compressLastAxis));
    return compressLastAxis(w);
  },
  // Expand (\, dyadic): compress's structural inverse. ⍺ is a 0/1 mask as
  // long as the result; ⍵ supplies one item per 1 in ⍺, in order, and
  // every 0 gets a fill. Ad hoc for now, like reduce's empty-vector
  // identity elements above: fill is always plain 0 (not yet Dyalog's
  // real rule of taking it from ⍵'s own prototype), and ⍺ must be a
  // literal 0/1 mask (not yet the generalized form where a positive
  // integer repeats and a negative one inserts that many fills). Verified
  // against real Dyalog: 1 0 1 0 1\1 2 3 is 1 0 2 0 3.
  expand: (w, a) => {
    if (a === undefined) {
      // Monadic \ is "scan along the LAST axis" - the scan/expand
      // counterpart of compress's reduceLast above, for the same reason
      // (⍀ already scans the FIRST axis for free via a pervasive f). w
      // here is ⍺⍺, not a value.
      const f = w;
      const scanLastAxis = (arr) => (shapeRec(arr).length <= 1 ? G.scan(f)(arr) : arr.map(scanLastAxis));
      return scanLastAxis;
    }
    // Dyadic ⍺\⍵ expands along the LAST axis (unlike ⍺⍀⍵, which stays on the
    // first - see G.scan's own dyadic branch, which calls expandAxis
    // directly instead of this): recurse down to rank<=1, exactly like
    // scanLastAxis above, then expand each innermost vector on its own using
    // the shared ⍺ mask.
    const expandLastAxis = (arr) => (shapeRec(arr).length <= 1 ? expandAxis(arr, a) : arr.map(expandLastAxis));
    return expandLastAxis(w);
  },
  deal: (w, a) => {
    if(a===undefined) {
      // ?0 is a random float in (0,1), as in Dyalog.
      return mdfunc(x => (x === 0 ? Math.random() : Math.floor(Math.random() * x)), undefined, w);
    }
    if (typeof w === 'number' && typeof a === 'number') {
      if (a > w) {
        throw new Error('DOMAIN ERROR: Deal requires the left argument to not exceed the right argument');
      }
      const pool = Array.from({ length: w }, (_, i) => i);
      const result = [];
      for (let i = 0; i < a; i++) {
        const j = i + Math.floor(Math.random() * (w - i));
        [pool[i], pool[j]] = [pool[j], pool[i]];
        result.push(pool[i]);
      }
      return result;
    }
    throw new Error('DOMAIN ERROR: Unsupported types for deal');
  },
  // Pervasive like any scalar function (mdfunc), so ⍺ can be a vector too:
  // 1 2○x is sin x, cos x - previously only a scalar ⍺ was accepted.
  circle: (w, a) => {
    const circFunc = [
      (x) =>Math.sqrt(1.0-x*x),
      (x) =>Math.sin(x),
      (x) =>Math.cos(x),
      (x) =>Math.tan(x),
      (x) =>Math.sqrt(1.0+x*x),
      (x) =>Math.sinh(x),
      (x) =>Math.cosh(x),
      (x) =>Math.tanh(x),
      (x) =>Math.sqrt(-1.0+x*x),
    ];
    const circInvFunc = [
      (x) =>Math.sqrt(1.0-x*x),
      (x) =>Math.asin(x),
      (x) =>Math.acos(x),
      (x) =>Math.atan(x),
      (x) =>(x+1)*Math.sqrt((x-1)/(x+1)),
      (x) =>Math.asinh(x),
      (x) =>Math.acosh(x),
      (x) =>Math.atanh(x),
      (x) =>-Math.sqrt(-1.0+x*x),
    ];
    const apply = (x, k) => {
      const func = k >= 0 ? circFunc[k] : circInvFunc[-k];
      if (!func) {
        throw new Error(`DOMAIN ERROR: ${k}○ is not supported`);
      }
      return func(x);
    };
    return mdfunc(x => Math.PI * x, apply, w, a);
  },
  encode: (w, a) => {
    // A scalar radix gives one digit per item of ⍵, the result shaped like
    // ⍵ - verified against real Dyalog: 10⊤123 is 3, 10⊤12 34 is 2 4.
    if (typeof a === 'number') {
      return mdfunc(undefined, (x) => encode(x, [a])[0], w, 0);
    }
    const shapea = shapeRec(a);
    if (typeof w === 'number' && shapea.length === 1) {
      return encode(w, a);
    }
    if (typeof w === 'number')
      w = [w];
    const shapew = shapeRec(w);
    const ta = transposeRec(a);
    const shapeta = shapea.slice(1);
    const resultShape = shapeta.concat(shapew);
    const result = fillShapeRec(resultShape, (prefix, index) => {
      const aidx = prefix.slice(0, shapeta.length);
      const widx = prefix.slice(shapeta.length);
      return encode(at(w, widx), at(ta, aidx));
    });
    return itransposeRec(result);
  },
  decode: (w, a) => {
    const shapew = shapeRec(w);
    if (shapew.length === 1) {
      if (Array.isArray(a) && w.length !== a.length) {
        if(a.length !== 1) {
          throw new Error('LENGTH ERROR: Arrays must be of the same length for decode');
        }
      }
      return decode(w, a);
    }
    if (typeof a === 'number')
      a = Array.from({ length: shapew[0] }, () => a);
    else if (Array.isArray(a) && a.length === 1) {
      a = Array.from({ length: shapew[0] }, () => a[0]);
    }
    const shapea = shapeRec(a);
    if(shapea[shapea.length-1] !== shapew[0]) {
      throw new Error('LENGTH ERROR: Incompatible shapes for decode');
    }
    const tw = transposeRec(w);
    const resultShape = shapea.slice(0, -1).concat(shapew.slice(1));
    const result = fillShapeRec(resultShape, (prefix, index) => {
      const aidx = prefix.slice(0, shapea.length-1);
      const widx = prefix.slice(shapea.length-1);
      return decode(at(tw, widx), at(a, aidx));
    });
    return result;
  },
  outer: (f) => (w, a) => {
    if (typeof f !== 'function') {
      throw new Error('DOMAIN ERROR: Outer requires a function');
    }
    // A plain scalar or boxed value (⊂x) has shape ⍬ - it contributes one
    // atomic cell to the outer product, not a dimension of its own, same
    // "scalar-like" rule pervasive functions use (isScalarLike, above).
    // A bare array-index like a.length would otherwise be undefined for a
    // plain scalar (silently emptying the loop) or would decompose a box
    // by reading its wrapped content instead of the box itself.
    const aIsScalar = isScalarLike(a);
    const wIsScalar = isScalarLike(w);
    const aCells = aIsScalar ? [a] : a;
    const wCells = wIsScalar ? [w] : w;
    // Verified against real Dyalog (TryAPL, comparing a strand-of-boxes
    // against the actual result of a prior outer product via ≡ and ⍴ on
    // bracket-indexed - never ⊃-disclosed, which would have masked this -
    // elements): EVERY cell is disclosed before f runs, and f's result is
    // ALWAYS re-enclosed afterwards via plain ⊂ (encloseIfNeeded above,
    // idempotent for a simple scalar) - unconditionally, regardless of
    // whether the cell came from squeezing a bare scalar/box argument or
    // from iterating a genuine array's elements, and regardless of whether
    // the result was already boxed. This resolved an apparent contradiction:
    // ¯1 0 1∘.⊖(¯1 0 1∘.⌽⊂c) visibly rotates c's rows (each cell of the
    // inner result is disclosed down to the real matrix, ⊖ actually runs
    // on it, then re-enclosed), while ¯1 0 1∘.⊖(⊂c)(⊂c)(⊂c) does not
    // (a strand's items are enclosed one MORE time than a fresh ⊂ would -
    // see G.strand - so disclosing once still leaves a box, and ⊖ on a
    // rank-0 box is a no-op per reverseAxis/rotateAxis's guard).
    const applyCell = (wCell, aCell) => {
      const wArg = isBoxed(wCell) ? wCell[0] : wCell;
      const aArg = isBoxed(aCell) ? aCell[0] : aCell;
      return encloseIfNeeded(f(wArg, aArg));
    };
    const result = [];
    for (let i = 0; i < aCells.length; i++) {
      const row = [];
      for (let j = 0; j < wCells.length; j++) {
        row.push(applyCell(wCells[j], aCells[i]));
      }
      result.push(row);
    }
    // The result's shape is (⍴a),(⍴w) - a scalar/boxed side contributes
    // nothing, so its dimension is squeezed back out instead of leaving a
    // spurious length-1 axis. outer already knows this shape for certain -
    // shapeRec can't be trusted to rediscover it structurally, because if
    // f's own output is itself an array (e.g. f is , or another outer
    // product), a cell that happens to look uniform reads as one more real
    // dimension instead of an opaque nested value (true regardless of
    // boxing - 1 2∘.,3 4 5 has the same issue). So the shape outer built
    // is stamped explicitly rather than left for shapeRec to guess.
    if (aIsScalar && wIsScalar) {
      return result[0][0];
    }
    if (aIsScalar) {
      const squeezed = result[0];
      squeezed.shape = [wCells.length];
      return squeezed;
    }
    if (wIsScalar) {
      const squeezed = result.map((row) => row[0]);
      squeezed.shape = [aCells.length];
      return squeezed;
    }
    result.shape = [aCells.length, wCells.length];
    return result;
  },
  dot: (aa,ww) => (w, a) => {
    if (typeof aa !== 'function' || typeof ww !== 'function') {
      throw new Error('DOMAIN ERROR: Dot requires two functions');
    }
    // A scalar side extends to match the other side's inner axis -
    // verified against real Dyalog: 2+.×3 4 is 14.
    if (isScalarLike(a) && !isScalarLike(w)) {
      a = Array.from({ length: shapeRec(w)[0] }, () => a);
    } else if (isScalarLike(w) && !isScalarLike(a)) {
      w = Array.from({ length: shapeRec(a).at(-1) }, () => w);
    } else if (isScalarLike(w) && isScalarLike(a)) {
      return ww(w, a);
    }
    const sw = shapeRec(w);
    const sa = shapeRec(a);
    if(sa.at(-1) !== sw.at(0)) {
      throw new Error('LENGTH ERROR: Incompatible shapes for dot product');
    }
    const resultShape = sa.slice(0, -1).concat(sw.slice(1));
    w = transposeRec(w);
    return fillShapeRec(resultShape, (prefix, index) => {
      const lidx = prefix.slice(0, sa.length - 1);
      const ridx = prefix.slice(sa.length - 1);
      const left = at(a, lidx);
      const right = at(w, ridx);
      const result = ww(right, left);
      return result.reduceRight(aa);      
    });
  },
  // Domino (⌹): monadic ⌹⍵ is the matrix inverse (or least-squares
  // pseudo-inverse for a non-square ⍵); dyadic ⍺⌹⍵ generalizes division -
  // the matrix on the RIGHT (⍵) is always the one that gets pseudo-inverted,
  // and ⍺ is matrix-multiplied on the LEFT of that inverse: ⍺⌹⍵ ≡ ⍺+.×⌹⍵.
  // Verified against real Dyalog with the matrix on either side:
  // (2 2⍴1 0 0 2)⌹1 2 is 0.2 0.8 (matches ⍺+.×⌹⍵: (2 2⍴1 0 0 2)+.×(⌹1 2)),
  // and 1 2⌹2 2⍴1 0 0 2 is 1 1 (matches (1 2)+.×⌹(2 2⍴1 0 0 2)). Either ⍺
  // or ⍵ may be a plain vector instead of a matrix - a vector is treated as
  // a single row for pseudo-inversion purposes (also verified monadically:
  // ⌹1 2 3 is (1 2 3)÷14, the pseudo-inverse of a 1×3 row).
  domino: (w, a) => {
    // A box is rank 0, never valid input here - w[0] being an array (the
    // box's disclosed content, if that content happens to itself be
    // array-shaped) used to slip past a bare !Array.isArray(w[0]) check
    // and get treated as a real (garbage) matrix. Verified against real
    // Dyalog: ⌹⊂2 2⍴1 2 3 4 is a DOMAIN ERROR, not a disclose-and-proceed.
    if (!Array.isArray(w) || isBoxed(w)) {
      throw new Error('DOMAIN ERROR: Domino requires a matrix or vector');
    }
    const wIsVector = !Array.isArray(w[0]);
    const wMat = wIsVector ? [w] : w;
    if (a === undefined) {
      const inv = matPseudoInverse(wMat);
      return wIsVector ? inv.map((row) => row[0]) : inv;
    }
    const aIsVector = !Array.isArray(a[0]);
    const aMat = aIsVector ? [a] : a;
    const result = matMul(aMat, matPseudoInverse(wMat));
    if (aIsVector && wIsVector) return result[0][0];
    if (aIsVector) return result[0];
    if (wIsVector) return result.map((row) => row[0]);
    return result;
  },
  rank: (f, g) => (w, a) => {
    if (typeof f !== 'function') {
      throw new Error('DOMAIN ERROR: Rank requires a function');
    }
    // g: scalar k applies everywhere; [k1,k2] is [dyadic-alpha, both-omega];
    // [k1,k2,k3] is [dyadic-alpha, dyadic-omega, monadic-omega] (Dyalog order).
    let alphaK, omegaKDyadic, omegaKMonadic;
    if (typeof g === 'number') {
      alphaK = g;
      omegaKDyadic = g;
      omegaKMonadic = g;
    } else if (Array.isArray(g) && g.length === 2) {
      alphaK = g[0];
      omegaKDyadic = g[1];
      omegaKMonadic = g[1];
    } else if (Array.isArray(g) && g.length === 3) {
      alphaK = g[0];
      omegaKDyadic = g[1];
      omegaKMonadic = g[2];
    } else {
      throw new Error('DOMAIN ERROR: Rank requires a number or an array of 2 or 3 numbers');
    }

    if (a === undefined) {
      const shape = shapeRec(w);
      const cellRank = cellRankFor(omegaKMonadic, shape.length);
      const frameRank = shape.length - cellRank;
      if (frameRank === 0) {
        return f(w);
      }
      const frameShape = shape.slice(0, frameRank);
      return fillShapeRec(frameShape, (prefix) => f(at(w, prefix)));
    }

    const shapeW = shapeRec(w);
    const shapeA = shapeRec(a);
    const cellRankW = cellRankFor(omegaKDyadic, shapeW.length);
    const cellRankA = cellRankFor(alphaK, shapeA.length);
    const frameW = shapeW.slice(0, shapeW.length - cellRankW);
    const frameA = shapeA.slice(0, shapeA.length - cellRankA);
    const sameFrame = frameA.length === frameW.length && frameA.every((v, i) => v === frameW[i]);

    // Frames must match, or one side must reduce to a single cell (frame []),
    // which then broadcasts across every position of the other side's frame -
    // standard APL scalar-extension applied to the two operands' frames.
    if (sameFrame) {
      return fillShapeRec(frameW, (prefix) => f(at(w, prefix), at(a, prefix)));
    }
    if (frameA.length === 0) {
      return fillShapeRec(frameW, (prefix) => f(at(w, prefix), a));
    }
    if (frameW.length === 0) {
      return fillShapeRec(frameA, (prefix) => f(w, at(a, prefix)));
    }
    throw new Error('LENGTH ERROR: Rank operator: frames of the two arguments must match, or one must reduce to a single cell');
  },
  equals: (w,a) => {
    return drel((x,y) => y===x, w, a);
  },
  not_equals: (w, a) => {
    return drel((x,y) => y!==x, w, a); 
  },
  less_than: (w, a) => {
    return drel((x,y) => y<x, w, a);
  },
  less_than_or_equal: (w, a) => {
    return drel((x,y) => y<=x, w, a); 
  },
  greater_than: (w, a) => {
    return drel((x,y) => y>x, w, a);
  },
  greater_than_or_equal: (w, a) => {
    return drel((x,y) => y>=x, w, a);
  },
  residue: (w, a) => {
    return mdfunc(x => Math.abs(x), mod, w, a);
  },
  divide: (w, a) => {
    // Verified against real Dyalog: 0÷0 is 1, any other x÷0 (and ÷0) is a
    // DOMAIN ERROR rather than JS's Infinity/NaN.
    const div = (x, y) => {
      if (x === 0) {
        if (y === 0) return 1;
        throw new Error('DOMAIN ERROR: division by zero');
      }
      return y / x;
    };
    return mdfunc(x => div(x, 1), div, w, a);
  },
  plus: (w, a) => {
    return mdfunc(x => x, (x,y) => y+x, w, a);
  },
  minus: (w, a) => {
    return mdfunc(x => -x, (x,y) => y-x, w, a);
  },
  times: (w, a) => {
    return mdfunc(x => x>0?1:x<0?-1:0, (x,y) => y*x, w, a);  
  },
  ceiling: (w, a) => {
    return mdfunc(x => Math.ceil(x), (x,y) => Math.max(x, y), w, a);
  },
  floor: (w, a) => {
    return mdfunc(x => Math.floor(x), (x,y) => Math.min(x, y), w, a);
  },
  exp: (w, a) => {
    return mdfunc(x => Math.exp(x), (x,y) => Math.pow(y, x), w, a);
  },
  log: (w, a) => {
    return mdfunc(x => Math.log(x), (x,y) => Math.log(x) / Math.log(y), w, a);
  },
  sqrt: (w, a) => {
    // Monadic: square root of ⍵. Dyadic: ⍺√⍵ is the ⍺-th root of ⍵.
    return mdfunc(x => Math.sqrt(x), (x,y) => Math.pow(x, 1 / y), w, a);
  },
  factorial: (w, a) => {
    return mdfunc(x => factorial(x), (x,y) => binomial(x, y), w, a);
  },
  or: (w, a) => {
    if (a===undefined) {
      return [...w].sort((a, b)=>-totalCompare(a, b))
    }
    return mdfunc(x => x, (x,y) => gcd(x, y), w, a);
  },
  and: (w, a) => {
    if (a===undefined) {
      return [...w].sort(totalCompare);
    }
    return mdfunc(x => x, (x,y) => lcm(x, y), w, a);
  },
  nand: (w, a) => {
    return mdfunc(x => x, (x,y) => x===0||y===0?1:0, w, a);  
  },
  nor: (w, a) => {
    return mdfunc(x => x, (x,y) => x===0&&y===0?1:0, w, a);  
  },
  iota: (w, a) => {
    if (a === undefined) {
      // ⍳ of a vector argument (an index generator, e.g. ⍳2 2) yields an
      // array shaped like ⍵ whose elements are themselves index vectors -
      // in real Dyalog those elements are nested/boxed (⎕←⍳2 2 shows boxed
      // pairs), never plain sub-arrays. Each idx here MUST be enclosed:
      // left raw, a multi-element idx is structurally indistinguishable
      // from a real extra axis, so shapeRec would misread e.g. ⍳3 3 as a
      // genuine 3×3×2 array instead of a 3×3 array of boxed 2-vectors -
      // exactly what broke dyadic compress/expand (which dispatch on
      // shapeRec) once ,⍳⍴⍵-style index vectors got compressed/expanded
      // against a same-length mask.
      if (Array.isArray(w)) {
        return fillShapeRec(w, (idx, index) => encloseIfNeeded(idx));
      }
      if (typeof w === 'number') {
        return Array.from({ length: w }, (_, i) => i);
      } 
      throw new Error('DOMAIN ERROR: Unsupported type for iota');
    }
    if (typeof a === 'string') {
      a = a.split('');
    }
    // A scalar ⍵ (a number, a box, a single character) looks up ONE item
    // and gives a scalar back - verified against real Dyalog: 2 3 4⍳3 is
    // 1, not ,1.
    const wIsScalar = isScalarLike(w) && !(typeof w === 'string' && w.length !== 1);
    if (typeof w === 'string') {
      w = w.split('');
    }
    if (!Array.isArray(w) || isBoxed(w)) {
      w = [w];
    }
    const shapea = shapeRec(a);
    const shapew = shapeRec(w);
    const r = shapew.length-(shapea.length-1);
    if(r<1) {
      throw new Error('LENGTH ERROR: Incompatible shapes for iota');
    }
    const resultShape = shapew.slice(0, r);
    const result = fillShapeRec(resultShape, (prefix, index) => {
      const v = at(w, prefix);
      const len = a.length;
      for (let i = 0; i < len; i++) {
        if (matchRec(at(a, [i]), v)===1)
          return i;
      }
      return len;
    });
    return wIsScalar ? result[0] : result;
  },
  iota_index: (w, a) => {
    if (a === undefined) {
      if(typeof w === 'number')
        w = [w];
      if(!Array.isArray(w)) {
        throw new Error('DOMAIN ERROR: Unsupported type for iota_index');
      }
      const shapew = shapeRec(w);
      const result = [];
      if(shapew.length === 1) {
        for(let j=0; j<w.length; j++) {
          const v = w[j];
          for(let i=0; i<v; i++) {
            result.push(j);
          }
        }
        return result;
      }
      traverseShapeRec(shapew, (prefix) => {
        const v = at(w, prefix);
        // Each multi-axis index is enclosed, exactly like ⍳'s own index
        // vectors (see G.iota) - left raw, shapeRec would misread the
        // result as one extra real axis. Verified against real Dyalog:
        // ⍴⍸2 2⍴1 0 0 1 is ,2.
        for(let i=0; i<v; i++) {
          result.push(boxOf(prefix));
        }
      });
      return result;
    }
    if (typeof a === 'string') {
      a = a.split('');
    }
    const wIsScalar = typeof w === 'number' || isChar(w);
    if (typeof w === 'string') {
      w = w.split('');
    }
    if (!Array.isArray(w)) {
      w = [w];
    }
    const shapea = shapeRec(a);
    const shapew = shapeRec(w);
    const r = shapew.length-(shapea.length-1);
    if(r<1) {
      throw new Error('LENGTH ERROR: Incompatible shapes for iota_index');
    }
    const resultShape = shapew.slice(0, r);
    const result = fillShapeRec(resultShape, (prefix, index) => {
      const v = at(w, prefix);
      const len = a.length;
      for (let i = 0; i < len; i++) {
        // Index of the last boundary ≤ v (¯1 below the first one) -
        // verified against real Dyalog (⎕IO←0): 10 20 30⍸5 15 30 is ¯1 0 2.
        if (v < at(a, [i]))
          return i - 1;
      }
      return len - 1;
    });
    return wIsScalar ? result[0] : result;
  },            
  jot: (f, g) => {
    const derived = jotApply(f, g);
    // Inverses for ⍣¯1, when every part has one: a bound left argument
    // (k∘f) inverts f in its right argument, a bound right argument (f∘k)
    // inverts f in its LEFT argument (see LEFT_INVERSE), and a plain
    // composition (f∘g) inverts as g⁻¹∘f⁻¹.
    if (typeof f !== 'function' && typeof g === 'function') {
      derived.inverse = (w) => inverseOf(g)(w, f);
    } else if (typeof g !== 'function' && typeof f === 'function') {
      derived.inverse = (w) => {
        const inv = LEFT_INVERSE.get(f);
        if (!inv) {
          throw new Error('DOMAIN ERROR: no inverse known for this function');
        }
        return inv(w, g);
      };
    } else if (typeof f === 'function' && typeof g === 'function') {
      derived.inverse = (w) => inverseOf(g)(inverseOf(f)(w));
    }
    return derived;
  },
  reduce: (w, a) => {
    if (a === undefined) {
      // Monadic f⌿ (w here is ⍺⍺, the operand function - same
      // a===undefined dispatch idiom pick/squad/domino/compress use to
      // tell a monadic call from a dyadic one) reduces along the FIRST
      // axis "for free": a pervasive f like + combines whole top-level
      // items elementwise on its own, so +⌿(2 3⍴⍳6) is [3,5,7] (rows
      // added elementwise) - no axis-recursion needed here at all, unlike
      // compress's own monadic (reduce-LAST-axis) branch.
      const f = w;
      return (arr) => {
        // Rank 0 (a plain scalar, or a box - a box is a 1-element JS
        // array, which would otherwise slip through as "an array to
        // reduce" and get silently disclosed by reduceRight's own
        // single-element shortcut). Verified against real Dyalog: +⌿5 is
        // 5, and (+⌿⊂1 2 3)≡⊂1 2 3 - a rank-0 argument has no axis to
        // reduce along, so reduce is identity.
        if (!Array.isArray(arr) || isBoxed(arr)) {
          return arr;
        }
        if (arr.length === 0) {
          // Ad hoc identity elements, for now: a proper fix needs every
          // primitive to expose its own identity element (+⌿⍬ is 0, ×⌿⍬
          // is 1, ∧⌿⍬ is 1, etc. in real Dyalog), which nothing here
          // currently does. Only the two most common cases are covered.
          const identity = REDUCE_IDENTITY.get(f);
          if (identity !== undefined) return identity;
          throw new Error('DOMAIN ERROR: no identity element to reduce an empty array with');
        }
        return arr.reduceRight(f);
      };
    }
    // Dyadic ⍺⌿⍵: compress along the FIRST axis - selects/repeats whole
    // top-level items of ⍵ by the counts in ⍺. Calls compressAxis directly
    // (the same vector-level algorithm G.compress's own dyadic branch uses
    // at its leaves) rather than going through G.compress itself, since
    // G.compress now recurses into the LAST axis for higher-rank ⍵ - ⌿
    // stays first-axis-only and must never do that recursion.
    return compressAxis(w, a);
  },
  scan: (w, a) => {
    if (a === undefined) {
      // Monadic f⍀ scans along the FIRST axis, the ⍀/⌿ counterpart of
      // reduce's monadic branch above - w here is ⍺⍺, not a value.
      const f = w;
      return (arr) => {
        // Same rank-0 identity rule as reduce, above - verified against
        // real Dyalog: +⍀5 is 5 (not ,5), and (+⍀⊂1 2 3)≡⊂1 2 3.
        if (!Array.isArray(arr) || isBoxed(arr)) {
          return arr;
        }
        if (arr.length === 0) {
          return arr;
        }
        // Item i is f⌿ of the first i+1 items, reduced right-to-left like
        // any other APL reduction - a running left-to-right accumulator
        // only agrees with that for an associative AND commutative f.
        // Verified against real Dyalog: -⍀1 2 3 is 1 ¯1 2, ,⍀1 2 3 is
        // 1 (1 2) (1 2 3). O(n²), the price of being correct for any f.
        return arr.map((_, i) => arr.slice(0, i + 1).reduceRight((acc, x) => f(acc, x)));
      };
    }
    // Dyadic ⍺⍀⍵: expand along the FIRST axis - same reasoning as reduce's
    // own dyadic branch above: calls expandAxis directly rather than
    // G.expand, since G.expand now recurses into the LAST axis for
    // higher-rank ⍵.
    return expandAxis(w, a);
  },
  // Key (⌸, monadic operator): f⌸w groups w's own items by value - for each
  // unique value (in first-occurrence order), f is called with (indices, key)
  // i.e. ⍵=indices into w, ⍺=the key itself. a f⌸w classifies by a instead -
  // f is called with (matching items of w, key), grouping w's actual values
  // rather than their positions. Both forms collect one f-result per unique
  // key, in first-occurrence order.
  key: (f) => (w, a) => {
    if (typeof f !== 'function') {
      throw new Error('DOMAIN ERROR: Key requires a function');
    }
    const findKeyIndex = (keys, k) => keys.findIndex((existing) => matchRec(existing, k) === 1);

    if (a === undefined) {
      const items = typeof w === 'string' ? w.split('') : w;
      if (!Array.isArray(items)) {
        throw new Error('DOMAIN ERROR: Key requires an array');
      }
      const keys = [];
      const indexGroups = [];
      for (let i = 0; i < items.length; i++) {
        const k = items[i];
        const idx = findKeyIndex(keys, k);
        if (idx === -1) {
          keys.push(k);
          indexGroups.push([i]);
        } else {
          indexGroups[idx].push(i);
        }
      }
      return keys.map((k, i) => f(indexGroups[i], k));
    }

    const classifier = typeof a === 'string' ? a.split('') : (Array.isArray(a) ? a : [a]);
    const items = typeof w === 'string' ? w.split('') : (Array.isArray(w) ? w : [w]);
    if (classifier.length !== items.length) {
      throw new Error('LENGTH ERROR: Key requires the classifier and data to have the same length');
    }
    const keys = [];
    const valueGroups = [];
    for (let i = 0; i < classifier.length; i++) {
      const k = classifier[i];
      const idx = findKeyIndex(keys, k);
      if (idx === -1) {
        keys.push(k);
        valueGroups.push([items[i]]);
      } else {
        valueGroups[idx].push(items[i]);
      }
    }
    return keys.map((k, i) => f(valueGroups[i], k));
  },
  comma: (w, a) => {
    if (a === undefined) {
      if (typeof w === 'string') {
        return w;
      }
      if (isBoxed(w)) {
        return [w];
      }
      if (Array.isArray(w)) {
        // Every scalar cell in ravel order, found through shapeRec - so a
        // rank-3 array flattens all the way (⍴,2 2 2⍴⍳8 is 8) while boxes
        // and string items stay whole.
        const cells = [];
        traverseShapeRec(shapeRec(w), (p) => { cells.push(at(w, p)); });
        return cells;
      }
      return [w];
    }
    if (Math.max(shapeRec(w).length, shapeRec(a).length) >= 2) {
      return catenateAxis(a, w, false);
    }
    // A string side contributes its characters, and an all-character
    // result is a string again - 'ab','cd' is 'abcd' and 'ab','c' is 'abc',
    // as in Dyalog, while 'ab',1 stays a mixed 3-item vector.
    const result = [...asCatenationTerms(charItems(a)), ...asCatenationTerms(charItems(w))];
    return (typeof w === 'string' || typeof a === 'string') ? joinChars(result) : result;
  },
  // ⍪: monadic "table" reshapes ⍵ into a matrix, one row per major cell
  // (a scalar or vector becomes a column); dyadic catenates along the FIRST
  // axis - for vectors that's the same as ,. Verified against real Dyalog:
  // ⍴⍪1 2 3 is 3 1, ⍴⍪2 3 4⍴0 is 2 12, and 1 2⍪3 4 is 1 2 3 4.
  table: (w, a) => {
    if (a === undefined) {
      const items = charItems(w);
      const shape = shapeRec(items);
      if (shape.length === 0) {
        return [[items]];
      }
      const cols = shape.slice(1).reduce((x, y) => x * y, 1);
      const flat = shape.length === 1 ? items : G.comma(items);
      const result = fillShapeRec([shape[0], cols], (p) => flat[p[0] * cols + p[1]]);
      if (shape[0] === 0 || cols === 0) {
        result.shape = [shape[0], cols];
      }
      return result;
    }
    if (Math.max(shapeRec(w).length, shapeRec(a).length) >= 2) {
      return catenateAxis(a, w, true);
    }
    return G.comma(w, a);
  },
  transpose: (w, a) => {
    if (a === undefined) {
      return transpose(w);
    }
    return permute(w, a);
  },
  squad: (w, a) => {
    // Monadic ⌷ is identity in real Dyalog ("materialise") - verified:
    // (⌷⊂1 2 3)≡⊂1 2 3 is 1.
    if (a === undefined) {
      return w;
    }
    if (typeof w === 'string') {
      return joinChars(getRec(w.split(''), a));
    }
    return getRec(w, a);
  },
  at: (f,g) => (w, a) => {
    if (typeof w === 'string') {
      return joinChars(G.at(f, g)(w.split(''), a));
    }
    if(typeof g === 'function') {
      const listPrefixes = [];
      const listValues = [];
      const condition = g(w);
      const result = fillShapeRec(shapeRec(w), (prefix, index) => {
        const v = at(w, prefix);
        const gv = at(condition, prefix);
        if(gv==1) {
          listPrefixes.push(prefix);
          listValues.push(v);
        }
        return v;
      });
      let newValues;
      if(Array.isArray(f)) {
        if(f.length !== listValues.length)
          throw new Error('LENGTH ERROR: Array lengths must match');
        newValues = f;
      } else if (typeof f === 'function') {
        newValues = f(listValues);
      } else {
        newValues = Array.apply(null, {length: listValues.length}).map(() => f);
      }
      listPrefixes.forEach((prefix, i) => {
        assignRec(result, prefix, newValues[i]);
      });
      return result;
    }
    // A bare index (0@2⊢1 2 3 4 5, replacing a single position) is just
    // the 1-element-list case - verified against real Dyalog: 0@2⊢1 2 3 4
    // 5 is 1 2 0 4 5.
    if (typeof g === 'number') {
      g = [g];
    }
    if(Array.isArray(g)) {
      if(Array.isArray(f)) {
        if(f.length !== g.length)
          throw new Error('LENGTH ERROR: Array lengths must match');
      } else
        f = Array.apply(null, {length: g.length}).map(() => f);
      const result = fillShapeRec(shapeRec(w), (prefix, index) => {
        return at(w, prefix);
      });
      for(let i=0; i<g.length; i++) {
        const idx = g[i];
        assignRec(result, idx, f[i]);
      }
      return result;
    }
    throw new Error('DOMAIN ERROR: Unsupported usage of at');
  },
  grade_up: (w) => {
    w = charItems(w);
    if (!Array.isArray(w)) {
      throw new Error('DOMAIN ERROR: Grade up requires an array');
    }
    return w.map((v, i) => {return {i, v}})
          .sort((a, b) => totalCompare(a.v, b.v))
          .map((obj) => obj.i);
  },
  grade_down: (w) => {
    w = charItems(w);
    if (!Array.isArray(w)) {
      throw new Error('DOMAIN ERROR: Grade down requires an array');
    }
    return w.map((v, i) => {return {i, v}})
          .sort((a, b) => -totalCompare(a.v, b.v))
          .map((obj) => obj.i);
  },
  enclose: (w, a) => {
    if (a === undefined) {
      // Enclosing an already-simple scalar (not itself an array, whether a
      // plain number or an existing box) is a no-op in real APL - verified
      // against Dyalog: (⊂5)≡5 is 1, and ≡⊂⊂5 stays 0 (repeated enclose of
      // a simple scalar never adds depth). Only a genuine array (a plain
      // vector, or a value that's already boxed) gets wrapped/re-wrapped.
      return Array.isArray(w) ? boxOf(w) : w;
    }
    return partitionedEnclose(a, w);
  },
  partition: (w, a) => {
    if (a === undefined) {
      // Monadic ⊆ (nest) encloses only a SIMPLE array - one with no
      // nested items - and leaves anything already nested, or a scalar,
      // alone. Verified against real Dyalog: ≡⊆1 2 3 is 2, and
      // (⊆(1 2)(3 4))≡(1 2)(3 4) is 1.
      const isSimple = Array.isArray(w) && !isBoxed(w) && w.every((x) => !Array.isArray(x));
      return isSimple ? boxOf(w) : w;
    }
    return partition(a, w);
  },
  pick: (w, a) => {
    if (a===undefined) {
      // Monadic ⊃ is "First": the first item (ravel order), disclosed if
      // it's a box, the prototype element for an empty w, or w itself for
      // a true scalar. Verified against real Dyalog:
      // (⊃(⊂1 2),⊂3 4)≡1 2 is 1 - the first item comes out disclosed, not
      // still boxed.
      if (Array.isArray(w)) {
        if (w.length === 0) return 0;
        return isBoxed(w[0]) ? w[0][0] : w[0];
      }
      if (typeof w==='string')
        return w.length===0? ' ' : w[0];
      return w;
    }
    // A simple (flat, unboxed-numbers-only) ⍺ is ONE path through w's
    // nesting levels - see pickPath. Verified against real Dyalog:
    // 1⊃(⊂1 2),⊂3 4 is 3 4 (disclosed), matching pickPath's final
    // disclose step.
    if (typeof a === 'number') {
      return pickPath(w, [a]);
    }
    if (Array.isArray(a) && a.every((x) => typeof x === 'number')) {
      return pickPath(w, a);
    }
    throw new Error('DOMAIN ERROR: Unsupported type for pick: ⍺ must be a simple (unboxed) numeric path');
  },
  // ↑/↓: a scalar ⍵ extends to a 1-item vector, a string ⍵ is its
  // characters (and the result a string again), and overtake pads with
  // the fill element - ' ' for characters. Verified against real Dyalog:
  // 3↑5 is 5 0 0, 4↑'ab' is 'ab  ', ¯4↑'ab' is '  ab'.
  // Monadic ↑ (mix) and ↓ (split) - see mix/split below.
  take: (w, a) => (a === undefined ? mix(w) : takeDrop(w, a, false)),
  drop: (w, a) => (a === undefined ? split(w) : takeDrop(w, a, true)),
  // ⍺⊇⍵ (select): one item of ⍵ per item of ⍺, the result shaped like ⍺ -
  // a number indexes ⍵'s first axis, a box holds one index per axis.
  // Verified against real Dyalog (⎕IO←0): 2 0⊇'abc' is 'ca', and
  // (0 1)(1 0)⊇2 2⍴⍳4 is 1 2.
  select: (w, a) => {
    if (a === undefined) {
      throw new Error('SYNTAX ERROR: ⊇ has no monadic form');
    }
    const wasString = typeof w === 'string';
    const items = charItems(w);
    const pick = (cell) => {
      const idx = isBoxed(cell) ? cell[0] : cell;
      return getRec(items, typeof idx === 'number' ? [idx] : idx);
    };
    if (isScalarLike(a)) {
      return pick(a);
    }
    const result = fillShapeRec(shapeRec(a), (p) => pick(at(a, p)));
    return wasString ? joinChars(result) : result;
  },
  // f⌺g (stencil): for each item of ⍵, f gets the g-sized neighbourhood
  // centred on it as ⍵ (fill 0 past the edges) and, as ⍺, how much
  // padding that neighbourhood needed per axis (positive: before the
  // start, negative: past the end). Only odd window sizes with step 1 are
  // supported. Verified against real Dyalog: {+/⍵}⌺3⊢1 2 3 is 3 6 5, and
  // {⍺}⌺3⊢1 2 3 is the 3 1 matrix of paddings 1 0 ¯1.
  stencil: (f, g) => (w) => {
    if (typeof f !== 'function') {
      throw new Error('DOMAIN ERROR: Stencil requires a function');
    }
    const shape = shapeRec(w);
    const sizes = typeof g === 'number' ? [g] : g;
    if (!Array.isArray(sizes) || sizes.length !== shape.length) {
      throw new Error('LENGTH ERROR: ⌺ needs one window size per axis of ⍵');
    }
    if (sizes.some((k) => k % 2 !== 1)) {
      throw new Error('DOMAIN ERROR: ⌺ supports only odd window sizes');
    }
    const fill = fillFor(w);
    return fillShapeRec(shape, (p) => {
      const starts = p.map((x, i) => x - (sizes[i] - 1) / 2);
      const padding = starts.map((st, i) => (st < 0 ? -st : Math.min(0, shape[i] - (st + sizes[i]))));
      const window = fillShapeRec(sizes, (q) => {
        const idx = q.map((x, i) => x + starts[i]);
        return idx.every((x, i) => x >= 0 && x < shape[i]) ? at(w, idx) : fill;
      });
      return f(window, padding);
    });
  },
  // Not an arrow function on purpose - needs `this` bound to the calling
  // context (see `execute` below for the same trick) to read the caller's
  // own ⎕pp for the monadic form. The dyadic form (fixed decimal places)
  // is a separate, explicitly-requested precision and ignores ⎕pp.
  format: function (w, a) {
    if (a === undefined) {
      return formatArray(w, this.pp);
    }
    let width;
    let decimals;
    if (Array.isArray(a)) {
      [width, decimals] = a;
    } else {
      decimals = a;
    }
    return formatArrayFixed(w, decimals, width);
  },
  execute: function (w) {
    if (typeof w !== 'string') {
      throw new Error('DOMAIN ERROR: Execute requires a string');
    }
    // Reuses the caller's own runtime object (`this`) so assignments and
    // lookups inside the executed string see/affect the same session state.
    // Parses with fresh default categories, so it only knows about names
    // already present as plain values on `this` - it can't tell that a
    // previously-defined dfn is a function, so `f 5` inside the string
    // won't apply it (falls back to strand-forming an array instead).
    const generatedCode = aplToJavaScript(w);
    const fn = new Function('G', generatedCode);
    return fn(this);
  },
  typeOf: (w) => {
    if (w === null) {
      return 'null';
    }
    if (Array.isArray(w)) {
      return 'array';
    }
    return typeof w;
  },
  member: (w, a) => {
    if (a === undefined) {
      if (typeof w === 'string') {
        return w;
      }
      if (!Array.isArray(w)) {
        return [w];
      }
      return flattenDeep(w);
    }
    const list = typeof w === 'string' ? w.split('') : (Array.isArray(w) ? w : [w]);
    if (typeof a === 'string') {
      return a.split('').map(x => (isMember(x, list) ? 1 : 0));
    }
    if (!Array.isArray(a)) {
      return isMember(a, list) ? 1 : 0;
    }
    return fillShapeRec(shapeRec(a), (prefix) => (isMember(at(a, prefix), list) ? 1 : 0));
  },
  // Rank-1 only (like compress/partition elsewhere in this file): `a` is
  // treated as a flat pattern searched for as a contiguous run in `w`.
  find: (w, a) => {
    const warr = typeof w === 'string' ? w.split('') : w;
    if (!Array.isArray(warr)) {
      throw new Error('DOMAIN ERROR: Find requires an array right argument');
    }
    // A string pattern is a run of characters to search for, same as ⍵.
    const parr = typeof a === 'string' ? a.split('') : (Array.isArray(a) ? a : [a]);
    const n = warr.length;
    const m = parr.length;
    const result = new Array(n).fill(0);
    if (m === 0 || m > n) {
      return result;
    }
    for (let i = 0; i <= n - m; i++) {
      let ok = true;
      for (let j = 0; j < m; j++) {
        if (matchRec(warr[i + j], parr[j]) === 0) {
          ok = false;
          break;
        }
      }
      if (ok) {
        result[i] = 1;
      }
    }
    return result;
  },
  unique: (w, a) => {
    const wasString = typeof w === 'string';
    const witems = wasString ? w.split('') : w;
    if (!Array.isArray(witems)) {
      throw new Error('DOMAIN ERROR: Unique/union requires an array');
    }
    if (a === undefined) {
      const result = uniqueItems(witems);
      return wasString ? result.join('') : result;
    }
    const wasStringA = typeof a === 'string';
    const aitems = wasStringA ? a.split('') : a;
    const merged = uniqueItems(aitems.concat(witems));
    return (wasString && wasStringA) ? merged.join('') : merged;
  },
  intersect: (w, a) => {
    const wasStringA = typeof a === 'string';
    const aitems = wasStringA ? a.split('') : a;
    const witems = typeof w === 'string' ? w.split('') : w;
    if (!Array.isArray(aitems) || !Array.isArray(witems)) {
      throw new Error('DOMAIN ERROR: Intersection requires arrays');
    }
    const result = uniqueItems(aitems).filter(x => isMember(x, witems));
    return wasStringA ? result.join('') : result;
  },
  not: (w, a) => {
    if (a === undefined) {
      return mdfunc((x) => {
        if (x !== 0 && x !== 1) {
          throw new Error('DOMAIN ERROR: ~ requires 0 or 1');
        }
        return 1 - x;
      }, undefined, w);
    }
    // Dyadic ~ is "without": elements of `a` that do not occur in `w`.
    const wasStringA = typeof a === 'string';
    const aitems = wasStringA ? a.split('') : a;
    const witems = typeof w === 'string' ? w.split('') : (Array.isArray(w) ? w : [w]);
    if (!Array.isArray(aitems)) {
      throw new Error('DOMAIN ERROR: Without requires an array left argument');
    }
    const result = aitems.filter(x => !isMember(x, witems));
    return wasStringA ? result.join('') : result;
  }
};

// Inverses for f⍣¯1, keyed by primitive: each takes (w, a) like the
// primitive itself, and solves ⍺ f x ≡ ⍵ (or f x ≡ ⍵) for x. A derived
// function can carry its own `.inverse` instead (see G.jot).
const noInverse = () => {
  throw new Error('DOMAIN ERROR: no inverse known for this function');
};
const monadicOnly = (inv) => (w, a) => (a === undefined ? inv(w) : noInverse());
const INVERSE = new Map([
  [G.plus, (w, a) => (a === undefined ? w : G.minus(a, w))],
  [G.minus, (w, a) => (a === undefined ? G.minus(w) : G.minus(w, a))],
  [G.times, (w, a) => (a === undefined ? noInverse() : G.divide(a, w))],
  [G.divide, (w, a) => (a === undefined ? G.divide(w) : G.divide(w, a))],
  [G.exp, (w, a) => (a === undefined ? G.log(w) : G.log(w, a))],
  [G.log, (w, a) => (a === undefined ? G.exp(w) : G.exp(w, a))],
  [G.sqrt, (w, a) => (a === undefined ? G.exp(2, w) : G.exp(a, w))],
  [G.circle, (w, a) => (a === undefined ? G.divide(Math.PI, w) : G.circle(w, G.minus(a)))],
  [G.encode, (w, a) => (a === undefined ? noInverse() : G.decode(w, a))],
  [G.decode, (w, a) => {
    if (a === undefined) {
      return noInverse();
    }
    if (typeof a !== 'number') {
      return G.encode(w, a);
    }
    // A scalar base gets just enough digits for the largest |⍵| - verified
    // against real Dyalog: 10⊥⍣¯1⊢123 is 1 2 3.
    let largest = Math.max(...flattenDeep(w).map(Math.abs));
    let digits = 1;
    while (largest >= a) {
      largest = Math.floor(largest / a);
      digits++;
    }
    return G.encode(w, Array(digits).fill(a));
  }],
  [G.reverse, (w, a) => (a === undefined ? G.reverse(w) : G.reverse(w, G.minus(a)))],
  [G.reverse_first, (w, a) => (a === undefined ? G.reverse_first(w) : G.reverse_first(w, G.minus(a)))],
  [G.transpose, monadicOnly((w) => G.transpose(w))],
  [G.not, monadicOnly((w) => G.not(w))],
  [G.right, (w) => w],
]);
const inverseOf = (f) => {
  if (typeof f.inverse === 'function') {
    return f.inverse;
  }
  const inv = INVERSE.get(f);
  if (!inv) {
    return noInverse;
  }
  return inv;
};
// Solves x f k ≡ ⍵ for x (the bound right argument k of f∘k).
const LEFT_INVERSE = new Map([
  [G.plus, (w, k) => G.minus(k, w)],
  [G.minus, (w, k) => G.plus(k, w)],
  [G.times, (w, k) => G.divide(k, w)],
  [G.divide, (w, k) => G.times(k, w)],
  [G.exp, (w, k) => G.exp(G.divide(k), w)],
]);

// Identity elements for reducing an empty array (f⌿⍬), per Dyalog: the
// value e with e f x ≡ x - e.g. ⌈⌿⍬ is ¯∞ (the most negative number).
const REDUCE_IDENTITY = new Map([
  [G.plus, 0], [G.minus, 0], [G.times, 1], [G.divide, 1], [G.residue, 0],
  [G.ceiling, -Infinity], [G.floor, Infinity], [G.exp, 1], [G.factorial, 1],
  [G.and, 1], [G.or, 0], [G.equals, 1], [G.not_equals, 0],
  [G.less_than, 0], [G.greater_than, 0], [G.less_than_or_equal, 1], [G.greater_than_or_equal, 1],
]);

// --- Parser support: per-scope name lookup and the boundary/category sets
// reduceStack's grammar rules (below) pattern-match against. ---
const find_category = (name, scope) => {
  for (let i = scope.length - 1; i >= 0; i--) {
    if (scope[i].hasOwnProperty(name)) {
      return [scope[i][name], i==0];
    }
  }
  return [null, scope.length === 1];
}

const dfn_or_dop = (subExpressions) => {
  let countAlpha = 0;
  let countOmega = 0;
  for (const subExpression of subExpressions) {
    for (const token of subExpression) {
      if (token.type === 'SPECIAL_VAR' && 
         (token.value === '⍺⍺'||token.value === '⍶')) {
        countAlpha++;
      } else if (token.type === 'SPECIAL_VAR' && 
         (token.value === '⍵⍵' || token.value === '⍹')) {
        countOmega++;
      }
    }
  }
  if (countAlpha>0) {
    if (countOmega>0)
      return 'DOPD';
    return 'DOPM';
  }
  return 'DFN';
}

const breakExpressions = (tokens, from) => {
  const expressions = [];
  let i = from;
  let currentExpression = [];
  while (i < tokens.length) {
    const token = tokens[i];
    if (token.type === 'SEPARATOR') {
      if (currentExpression.length > 0) {
        expressions.push(currentExpression);
        currentExpression = [];
      }
    } else if (token.type === 'BRACE_OPEN') {
      const [subExpressions, newIndex] = breakExpressions(tokens, i + 1);
      const type = dfn_or_dop(subExpressions);
      currentExpression.push({ type, value: subExpressions });
      i = newIndex;
    } else if (token.type === 'BRACE_CLOSE') {
      break;
    } else {
      currentExpression.push(token);
    }
    i++;
  }
  if (currentExpression.length > 0) {
    expressions.push(currentExpression);
  } 

  return [expressions, i];
}

// Category lists checked by reduceStack's belong() calls below, hoisted to
// module scope so they're allocated once instead of on every token shift
// (reduceStack runs once per token, potentially several times per token).
// 'R' (/ and \, see their global_category comment) rides along in every
// list below that already carries 'F' and/or 'M' - at parse time it
// hasn't been decided yet whether a given R token is acting as a monadic
// operator or a dyadic function, so it needs to be accepted everywhere
// either one already is: as a boundary to either side of some OTHER
// reduction (CAT_BOUNDARY_F/MVF/MF/MF_NOCOLON), as a train/strand
// component (CAT_V_F_D_M), and as another operator's own operand
// (CAT_F_V, so ⍨/¨/⍣ etc. can bind to / or \ the same way they bind to
// any other function - e.g. quicksort's ⍵/⍨0>s in test.apl). Confirmed
// the hard way, one omission at a time: leaving R out of CAT_BOUNDARY_F
// orphaned ⊂'s own argument whenever / or \ sat immediately to its left
// (1 0 1/⊂1 2 3), and leaving it out of CAT_F_V broke /⍨ outright (a
// SYNTAX ERROR on test.apl's quicksort). Left out of plain CAT_BOUNDARY
// on purpose: that one's for the train/Atop rule, which already excludes
// plain F and M too, so R (F-or-M) belongs out as well.
const CAT_V_F_D_M = ['V', 'F', 'D', 'M', 'R'];
// 'Q' (⍞) is included below so it acts as a left boundary too - e.g.
// ⍞1⌷⊢ can build the whole train 1⌷⊢ before ⍞ quotes it, without needing
// ⍞(1⌷⊢). Left out of CAT_BOUNDARY_MF_NOCOLON on purpose: that one's for
// what precedes an assignment target, unrelated to what ⍞ quotes.
const CAT_BOUNDARY_F = ['F', 'R', '(', '←', 'Edge', ':', 'Q'];
const CAT_BOUNDARY_MVF = ['M', 'V', 'F', 'R', '(', '←', 'Edge', ':', 'Q'];
const CAT_BOUNDARY_MF = ['M', 'F', 'R', '(', '←', 'Edge', ':', 'Q'];
// _CALL variants of the three lists above, used only by the four rules
// that immediately EXECUTE a function against a real argument (Apply,
// its monadic-operator-combo cousin, DyadicApply, and R's dyadic
// compress/expand) - everywhere else 'Q' stays, since those other rules
// only ever compose a bigger, still-uncalled F (Atop/Fork/OperatorApply/
// DyadicOperatorApply), which is exactly what ⍞ wants to widen across
// (⍞0⌷⊢ should quote the whole train, not just 0). But letting 'Q' act
// as boundary for an actual call is a trap: ⍞ f v would apply f to v
// first (since Apply fires before ⍞'s own rule, checked last), and
// quoting the resulting plain value is a silent no-op (there's no
// G.quote - see ⍞'s own comment). Worse, it eats v as f's argument when
// v was meant to sit beside the quoted f instead, e.g.
// (#interval ⍞update 125) applying update to 125 instead of leaving
// 125 as the interval's own delay argument next to the quoted callback
// - forcing (⍞update) 125 to get the intended 2-element strand. Since
// quoting a call's result is never useful, dropping 'Q' from just these
// four rules is a strict improvement: it makes ⍞ bind to the bare
// function/operator immediately to its right, before any call can
// consume what follows.
const CAT_BOUNDARY_F_CALL = ['F', 'R', '(', '←', 'Edge', ':'];
const CAT_BOUNDARY_MVF_CALL = ['M', 'V', 'F', 'R', '(', '←', 'Edge', ':'];
const CAT_BOUNDARY_MF_CALL = ['M', 'F', 'R', '(', '←', 'Edge', ':'];
const CAT_F_V = ['F', 'V', 'R'];
// Fork's own left tine (below) is the one CAT_F_V spot that must NOT
// admit a bare R: unlike ⍨/¨/⍣ binding to an uncombined / or \ as their
// operand (that's the case CAT_F_V exists for), a fork's leftmost tine
// is read as a *complete* function - and / or \ alone is never complete,
// it always still needs a function or value to its own left (F/ reduce,
// ⍺/ compress). Since CAT_BOUNDARY_MVF also lets a plain F sit in the
// fork's A slot, an uncombined R sitting in B would otherwise let e.g.
// "+/÷≢" close the fork over "/÷≢" (R standing in for the left tine on
// its own) one shift before "+" arrives to claim "/" as its reduce
// operator - silently splitting +/ apart into a bogus (+)(/÷≢) atop
// instead of the intended (+/)(÷)(≢) fork. Confirmed against
// (+/÷≢)⍳10 (broken before this fix) vs (+⌿÷≢)⍳10 (fine even before this
// fix, back when ⌿ was still plain 'M' rather than 'R' like / - now that
// ⌿/⍀ share R too, both spellings go through this same exclusion).
const CAT_TINE_F_V = ['F', 'V'];
const CAT_BOUNDARY = ['(', '←', 'Edge', ':', 'Q'];
const CAT_BOUNDARY_MF_NOCOLON = ['(', '←', 'M', 'F', 'R', 'Edge'];
const CAT_V_CLOSEPAREN = ['V', ')'];

// Renders a statement list the same way at both the dfn-body level (via
// Block, which additionally hoists `let` declarations) and the top-level
// Program: every statement but the last is followed by `; `, the last is
// wrapped in `return ... ;` - a dfn's/program's value is its last expression.
// --- Code generation: AST -> JS source string. emitGraph (further below)
// is a second, parallel walker over these same node shapes that builds a
// {label, entries} tree for drawing a train/fork as a graph instead. ---
const emitStatements = (statements) => {
  let result = '';
  statements.forEach((node, i) => {
    if (i === statements.length - 1) {
      result += `return ${emitJs(node)};`;
    } else {
      result += `${emitJs(node)}; `;
    }
  });
  return result;
};

// Turns an AST node (built by parseExpression/reduceStack below) into APL's
// one and only backend today: a JS source string, executed via `new
// Function('G', code)`. A second emitter (e.g. toMermaid/toDot) can walk the
// same node shapes to draw a train/fork as a graph instead.
// asTarget: true only while rendering an assignment target (e.g. `a b c`
// in `a b c←⍵`) - there a Strand must stay a bare `[a, b, c]` destructuring
// pattern, since it's spliced directly to the left of `=` in the generated
// JS (see the Assign-forming reduction below); wrapping it in a function
// call there would be a syntax error. Every other Strand is a value being
// built, so it goes through G.strand instead (see G.strand for why).
const emitJs = (node, asTarget = false) => {
  switch (node.type) {
    case 'Raw':
      return node.text;
    case 'Identifier':
      return (node.global ? 'G.' : '') + node.name;
    case 'Strand': {
      const items = node.elements.map((el) => emitJs(el, asTarget)).join(', ');
      return asTarget ? `[${items}]` : `G.strand([${items}])`;
    }
    case 'Apply':
      return `${emitJs(node.fn)}(${emitJs(node.arg)})`;
    case 'DyadicApply':
      return `${emitJs(node.fn)}(${emitJs(node.w)}, ${emitJs(node.a)})`;
    case 'OperatorApply':
      return `${emitJs(node.operator)}(${emitJs(node.operand)})`;
    case 'DyadicOperatorApply':
      if (node.isOuterIdiom) {
        return `G.outer(${emitJs(node.right)})`;
      }
      return `${emitJs(node.operator)}(${emitJs(node.left)}, ${emitJs(node.right)})`;
    case 'Fork':
      if (node.leftIsValue) {
        // A g h: the value A is g's left argument, and h still sees both of
        // the fork's own arguments - ⍺ (A g h) ⍵ ≡ A g (⍺ h ⍵). Verified
        // against real Dyalog: 2 (1+-) 5 is ¯2.
        return `((${_w_}, ${_a_})=> ${emitJs(node.mid)}(${emitJs(node.right)}(${_w_}, ${_a_}), ${emitJs(node.left)}))`;
      }
      return `((${_w_}, ${_a_})=> ${emitJs(node.mid)}(${emitJs(node.right)}(${_w_}, ${_a_}), ${emitJs(node.left)}(${_w_}, ${_a_})))`;
    case 'Atop':
      return `((${_w_}, ${_a_})=> ${emitJs(node.f)}(${emitJs(node.g)}(${_w_}, ${_a_})))`;
    case 'Assign':
      if (node.firstAlphaAssign) {
        return `${node.targetText} = _a_===undefined ? ${emitJs(node.value)} : _a_`;
      }
      return `${node.targetText} = ${emitJs(node.value)}`;
    case 'Guard':
      return `if(${emitJs(node.cond)}===1) return ${emitJs(node.body)}`;
    case 'Dfn':
      return `(function _del_(${_w_}, ${_a_}) {${emitJs(node.body)}})`;
    case 'Dop':
      if (node.kind === 'dyadic') {
        return `(function _ddel_(${_aa_}, ${_ww_}) { return (function _del_(${_w_}, ${_a_}) {${emitJs(node.body)}})})`;
      }
      return `(function _ddel_(${_aa_}) { return (function _del_(${_w_}, ${_a_}) {${emitJs(node.body)}})})`;
    case 'Block': {
      let prefix = '';
      if (node.declarations.length > 0) {
        prefix = `let ${node.declarations.join(', ')}; `;
      }
      return prefix + emitStatements(node.statements);
    }
    case 'Program':
      return emitStatements(node.statements);
    default:
      throw new Error(`Unknown AST node type: ${node.type}`);
  }
};

// An assignment target is always an Identifier or a Strand of them (e.g.
// `a b c` in `a b c←⍵`) - these two walk that same shape to get, respectively,
// the bare names being bound (for scope bookkeeping/declarations, always
// unprefixed - a `let` binding can never be a dotted property) and the target
// rendered as plain local JS bindings, ignoring whatever `.global` each
// Identifier carries. Used by the two assignment-forming reductions below:
// plain `←` always binds locally inside a dfn (see assignedNames/
// localTargetText's callers), while `⊢←` forces every name in the target
// through to G instead (see globalTargetText).
const assignedNames = (node) => {
  if (node.type === 'Identifier') return [node.name];
  if (node.type === 'Strand') return node.elements.flatMap(assignedNames);
  throw new Error(`SYNTAX ERROR: Invalid assignment target: ${node.type}`);
};
const localTargetText = (node) => {
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'Strand') return `[${node.elements.map(localTargetText).join(', ')}]`;
  throw new Error(`SYNTAX ERROR: Invalid assignment target: ${node.type}`);
};
const globalTargetText = (node) => {
  if (node.type === 'Identifier') return `G.${node.name}`;
  if (node.type === 'Strand') return `[${node.elements.map(globalTargetText).join(', ')}]`;
  throw new Error(`SYNTAX ERROR: Invalid assignment target: ${node.type}`);
};

// A "train" is an implicit composition of functions formed by bare
// juxtaposition - a 2-tine atop (`f g`) or a 3-tine fork (`f g h`) - as
// opposed to a function derived via an explicit operator glyph
// (OperatorApply/DyadicOperatorApply: f¨, f⍣3, f.g, f∘g...). Only reduceStack's
// train/fork rules (apl.js's "Found train"/"Found train with functions")
// ever produce these two node types, so the check is just the node's type.
const isTrain = (node) => node.type === 'Fork' || node.type === 'Atop';

// Glyph for a leaf node, or null if `n` isn't a leaf (Identifier/Raw) - used
// below to decide whether a compose-like node (Fork, Atop, an operator
// application...) can use its own glue/operator's glyph as its label
// instead of a generic word like "fork"/"operator".
const trainGlyph = (n) => {
  if (n.type === 'Identifier') return NAME_TO_GLYPH[n.name] || n.name;
  if (n.type === 'Raw') return n.text;
  return null;
};

// {label, entries: [[tag|null, childNode], ...]} for every AST node type -
// the shape emitGraph's indented-tree printer below walks. A composition's
// own operator/glue glyph becomes the label directly (a Fork's label is its
// glue function's glyph, e.g. "," for `+,-`; an OperatorApply's label is the
// operator itself, e.g. "⌿") instead of a generic node-type name, and its
// tines/operands need no tag - position already says which is which. Kept
// separate from emitJs's switch since the two walk the tree for entirely
// different purposes (source text vs. a picture).
const trainEntry = (node) => {
  switch (node.type) {
    case 'Fork': {
      const glyph = trainGlyph(node.mid);
      // "⋅" (not a real APL primitive here, so it can't collide with one)
      // stands in for a glue/outer function that isn't a bare glyph itself
      // (e.g. it's a derived function) - still two/three real children,
      // just no word or tag to name the node they hang off.
      return glyph !== null
        ? { label: glyph, entries: [[null, node.left], [null, node.right]] }
        : { label: '⋅', entries: [[null, node.left], [null, node.mid], [null, node.right]] };
    }
    case 'Atop': {
      const glyph = trainGlyph(node.f);
      return glyph !== null
        ? { label: glyph, entries: [[null, node.g]] }
        : { label: '⋅', entries: [[null, node.f], [null, node.g]] };
    }
    case 'OperatorApply':
      return { label: trainGlyph(node.operator) ?? 'operator', entries: [[null, node.operand]] };
    case 'DyadicOperatorApply':
      return { label: trainGlyph(node.operator) ?? 'operator', entries: [[null, node.left], [null, node.right]] };
    case 'Apply': {
      const glyph = trainGlyph(node.fn);
      return glyph !== null
        ? { label: glyph, entries: [[null, node.arg]] }
        : { label: 'apply', entries: [['fn', node.fn], ['arg', node.arg]] };
    }
    case 'DyadicApply': {
      const glyph = trainGlyph(node.fn);
      return glyph !== null
        ? { label: glyph, entries: [['⍺', node.a], ['⍵', node.w]] }
        : { label: 'apply', entries: [['fn', node.fn], ['⍺', node.a], ['⍵', node.w]] };
    }
    case 'Strand':
      return { label: 'strand', entries: node.elements.map((el, i) => [String(i), el]) };
    case 'Assign':
      return { label: '←', entries: [['target', node.target], ['value', node.value]] };
    case 'Guard':
      return { label: ':', entries: [['cond', node.cond], ['then', node.body]] };
    case 'Dfn':
      return { label: 'dfn', entries: [['body', node.body]] };
    case 'Dop':
      return { label: `dop (${node.kind})`, entries: [['body', node.body]] };
    case 'Block':
    case 'Program':
      return { label: node.type.toLowerCase(), entries: node.statements.map((s, i) => [String(i), s]) };
    default: // Identifier, Raw
      return { label: trainGlyph(node) ?? node.type, entries: [] };
  }
};

// Renders an AST node as an indented tree - straight box-drawing guides
// (├─/└─/│), no diagonal lines, no layout math - each line is one node's
// own glyph (see trainEntry above), which is what a train actually is: an
// implicit composition of primitives. `(+,-)` prints as:
//   ,
//   ├─ +
//   └─ -
// i.e. the classic fork diagram (glue function on top, its two tines below)
// falls out for free, since a Fork's label already is its glue's glyph.
const emitGraph = (node) => {
  // Auto-unwrap a single-statement Program, the common case for a one-liner
  // like emitGraph(parseToAst('(+,-)3 4')).
  const root = (node.type === 'Program' && node.statements.length === 1)
    ? node.statements[0] : node;

  const lines = [];
  const walk = (n, prefix, isLast, isRoot, tag) => {
    const { label, entries } = trainEntry(n);
    const text = tag ? `${tag}: ${label}` : label;
    lines.push(isRoot ? text : prefix + (isLast ? '└─ ' : '├─ ') + text);
    const childPrefix = isRoot ? '' : prefix + (isLast ? '   ' : '│  ');
    entries.forEach(([childTag, child], i) => {
      walk(child, childPrefix, i === entries.length - 1, false, childTag);
    });
  };
  walk(root, '', true, true, null);
  return lines.join('\n');
};

// --- The parser itself: a right-to-left shift-reduce loop. Tokens are
// consumed right-to-left onto a single stack of {category, node} pairs;
// after every shift, reduceStack pattern-matches a small window (the top 2
// to 4 stack slots) against a fixed list of grammar rules (parentheses,
// strand formation, monadic/dyadic application, trains, operator binding
// ...), collapsing a match into one node, and keeps retrying until nothing
// matches before the next token shifts on. No bracket-indexing production
// exists - A[I] never enters the grammar; indexing is just an ordinary
// application of ⌷ (squad) like any other primitive. ---
const parseExpression = (expression, scope) => {
  const stack = [];

  const belong = (category, list) => {
    return list.includes(category);
  }

  const reduceStack = () => {
    let foundReduction = true;
    while (foundReduction) {
      foundReduction = false;
      const size = stack.length;
      if (size === 0) break;
      // Mapping the 4-element viewport from the top of the stack (D, C, B, A)
      // The most recently added element (top) is at the end of the JavaScript array
      const A = size >= 1 ? stack[size - 1] : null;
      const B = size >= 2 ? stack[size - 2] : null;
      const C = size >= 3 ? stack[size - 3] : null;
      const D = size >= 4 ? stack[size - 4] : null;
      const AB = A && B;
      const ABC = AB && C;
      const ABCD = ABC && D;
      // if (AB && !ABC && !ABCD) {
      //   console.log('Stack top 2:', A, B); 
      // }
      // if(ABC && !ABCD) {
      //   console.log('Stack top 3:', A, B, C); 
      // }
      // if(ABCD) {
      //   console.log('Stack top 4:', A, B, C, D); 
      // }
      if (ABC &&
        A.category === '(' &&
        belong(B.category, CAT_V_F_D_M) &&
        C.category === ')'
      ) {
        //console.log('Found parentheses:', B.node);
        stack.splice(size - 3, 3, { category: B.category, node: B.node });
        foundReduction = true;
        continue;
      }
      if (ABC &&
        !belong(A.category, CAT_V_CLOSEPAREN) &&
        B.category === 'V' &&
        C.category === 'V'
      ) {
        //console.log('Found strand:',A,B,C);
        const savedA = stack.pop();
        const elements = [];
        while (stack.length > 0 && stack[stack.length - 1].category === 'V') {
          elements.push(stack.pop().node);
        }
        stack.push({ category: 'V', node: { type: 'Strand', elements } });
        stack.push(savedA);
        foundReduction = true;
        continue;
      }
      if(ABC &&
        belong(A.category, CAT_BOUNDARY_F_CALL) &&
        B.category === 'F' &&
        C.category === 'V'
      ) {
        //console.log('Found function application:', B.node, C.node);
        const node = { type: 'Apply', fn: B.node, arg: C.node };
        stack.splice(size - 3, 3,
          { category: 'V', node }, A);
        foundReduction = true;
        continue;
      }
      if(ABCD &&
        belong(A.category, CAT_BOUNDARY_MVF_CALL) &&
        B.category === 'F' &&
        C.category === 'F' &&
        D.category === 'V'
      ) {
        //console.log('Found function application:', B.node, C.node, D.node);
        const node = { type: 'Apply', fn: C.node, arg: D.node };
        stack.splice(size - 4, 4,
          { category: 'V', node }, B, A);
        foundReduction = true;
        continue;
      }
      if(ABCD &&
        belong(A.category, CAT_BOUNDARY_MF_CALL) &&
        B.category === 'V' &&
        C.category === 'F' &&
        D.category === 'V'
      ) {
        //console.log('Found function application:', C.node, D.node, B.node);
        const node = { type: 'DyadicApply', fn: C.node, w: D.node, a: B.node };
        stack.splice(size - 4, 4,
          { category: 'V', node }, A);
        foundReduction = true;
        continue;
      }
      // The two R-only rules below resolve / and \'s dual meaning (see
      // their global_category comment) by pattern shape alone, checked
      // ahead of the generic monadic-operator rule that follows: ⍺ R ⍵
      // (both sides real values) is dyadic compress/expand, F R (an
      // actual function to R's left) is the monadic reduce-last/scan-last
      // operator. Unlike the generic rule just below, the monadic case
      // here requires B to be strictly 'F' - never 'V' - precisely so it
      // can never compete with the dyadic case over a bare value sitting
      // to R's left; the generic rule's own permissive V-or-F operand
      // check is what let it steal a fragment of an unfinished ⍺ strand
      // before this file gave / and \ their own category.
      if(ABCD &&
        belong(A.category, CAT_BOUNDARY_MF_CALL) &&
        B.category === 'V' &&
        C.category === 'R' &&
        D.category === 'V'
      ) {
        const node = { type: 'DyadicApply', fn: C.node, w: D.node, a: B.node };
        stack.splice(size - 4, 4,
          { category: 'V', node }, A);
        foundReduction = true;
        continue;
      }
      if(ABC &&
        belong(A.category, CAT_BOUNDARY_MVF) &&
        B.category === 'F' &&
        C.category === 'R'
      ) {
        const node = { type: 'OperatorApply', operator: C.node, operand: B.node };
        stack.splice(size - 3, 3,
          { category: 'F', node }, A);
        foundReduction = true;
        continue;
      }
      if(ABC &&
        belong(A.category, CAT_BOUNDARY_MVF) &&
        belong(B.category, CAT_F_V) &&
        C.category === 'M'
      ) {
        //console.log('Found monadic operator:', B.node, C.node);
        const node = { type: 'OperatorApply', operator: C.node, operand: B.node };
        stack.splice(size - 3, 3,
          { category: 'F', node }, A);
        foundReduction = true;
        continue;
      }
      if(ABCD &&
        (((belong(A.category, CAT_BOUNDARY_MF) &&
        (B.category ===  'V')) )||
        ((belong(A.category, CAT_BOUNDARY_MVF) &&
        belong(B.category, ['F', 'R'])) ))
        &&
        C.category === 'D' &&
        belong(D.category, CAT_F_V)
      ) {
        //console.log('Found dyadic operator:', B.node, C.node, D.node);
        // A D-operator's left operand (B) can be 'R' too (⌿/⍀//\\, e.g.
        // ⌿⍤1 1), not just a plain 'F' - R is function-like here exactly
        // like it already is on the right side (D's own CAT_F_V check
        // already includes 'R'). Grouped with the 'F' branch, not given
        // its own, since R behaves identically to F for this rule (both
        // need the same CAT_BOUNDARY_MVF boundary on A).
        // f∘.g (outer product) tokenizes as emptyFunc . g - the jot's left
        // operand being literally the bare, unglobal-prefixed emptyFunc/dot
        // pair is what distinguishes this idiom from an ordinary a D w.
        const isOuterIdiom = B.node.type === 'Identifier' && B.node.global && B.node.name === 'emptyFunc'
          && C.node.type === 'Identifier' && C.node.global && C.node.name === 'dot';
        const node = { type: 'DyadicOperatorApply', operator: C.node, left: B.node, right: D.node, isOuterIdiom };
        stack.splice(size - 4, 4,
          { category: 'F', node }, A);
        foundReduction = true;
        continue;
      }
      if(ABCD &&
        belong(A.category, CAT_BOUNDARY_MVF) &&
        belong(B.category, CAT_TINE_F_V) &&
        C.category === 'F' &&
        D.category === 'F'
      ) {
        //console.log('Found train with functions:', B.node, C.node, D.node);
        const node = { type: 'Fork', left: B.node, leftIsValue: B.category === 'V', mid: C.node, right: D.node };
        stack.splice(size - 4, 4,
          { category: 'F', node }, A);
        foundReduction = true;
        continue;
      }
      if(ABC &&
        belong(A.category, CAT_BOUNDARY) &&
        B.category === 'F' &&
        C.category === 'F'
      ) {
        //console.log('Found train:', B.node, C.node);
        const node = { type: 'Atop', f: B.node, g: C.node };
        stack.splice(size - 3, 3,
          { category: 'F', node }, A);
        foundReduction = true;
        continue;
      }
      if (AB &&
        A.category === 'Q' &&
        belong(B.category, CAT_V_F_D_M)
      ) {
        // ⍞ quotes whatever sits to its right into a plain value - same
        // generated code, just relabeled so it can be stored, put in an
        // array, or handed to a JS callback instead of being applied.
        // Checked only after every wider rule above (function application,
        // operators, trains...) has had its chance, so e.g. ⍞1⌷⊢ builds the
        // whole train 1⌷⊢ (via the CAT_BOUNDARY* lists above now including
        // 'Q') before this narrower 2-element match would otherwise fire on
        // just ⍞ and the very next token.
        stack.splice(size - 2, 2, { category: 'V', node: B.node });
        foundReduction = true;
        continue;
      }
      if(ABCD &&
        belong(A.category, CAT_BOUNDARY_MF_NOCOLON) &&
        belong(B.category, CAT_V_F_D_M) &&
        C.category === '←' &&
        belong(D.category, CAT_V_F_D_M)
      ) {
        // Real dfn scoping rule: every name plain ← assigns to becomes
        // local, even if a same-named global already exists - it shadows
        // rather than writes through (only the explicit `name⊢←` form
        // below reaches an outer global from inside a dfn). At the top
        // level (scope.length===1) there's no local scope to bind into at
        // all, so the target still goes straight to G as it always did.
        const isDfnScope = scope.length > 1;
        const targetText = isDfnScope ? localTargetText(B.node) : emitJs(B.node, true);
        const strippedBtext = isDfnScope ? targetText : targetText.slice(2);
        const [categoryEntry] = find_category(strippedBtext, scope);
        const firstAlphaAssign = strippedBtext === '_a_' && categoryEntry && categoryEntry.name === ''; // First assignment of ⍺ in a DFN
        const node = { type: 'Assign', target: B.node, targetText, value: D.node, firstAlphaAssign };
        if (isDfnScope) {
          for (const name of assignedNames(B.node)) {
            scope[scope.length - 1][name] = { category: D.category, name };
          }
        } else {
          scope[scope.length - 1][strippedBtext] = { category: D.category, name: strippedBtext };
        }
        stack.splice(size - 4, 4,
          { category: D.category, node }, A);
        foundReduction = true;
        continue;
      }
      if(ABCD &&
        belong(A.category, CAT_V_F_D_M) &&
        B.category === 'F' && B.node.type === 'Identifier' && B.node.name === 'right' &&
        C.category === '←' &&
        belong(D.category, CAT_V_F_D_M)
      ) {
        // name⊢← - Dyalog's explicit-global-assignment escape hatch: the
        // only way to write straight through to an outer/global name from
        // inside a dfn, since plain ← just above always binds a local
        // instead. Forces every name in the target to G, and - unlike
        // plain ← - never adds anything to the current scope: a global
        // write declares nothing local.
        const node = { type: 'Assign', target: A.node, targetText: globalTargetText(A.node), value: D.node, firstAlphaAssign: false };
        stack.splice(size - 4, 4,
          { category: D.category, node });
        foundReduction = true;
        continue;
      }
      if(ABCD &&
        A.category === 'Edge' &&
        B.category === 'V' &&
        C.category === ':' &&
        D.category === 'V'
      ) {
        //console.log('Found conditional:', B.node, D.node);
        const node = { type: 'Guard', cond: B.node, body: D.node };
        stack.splice(size - 4, 4,
          { category: 'V', node }, A);
        foundReduction = true;
        continue;
      }
    }
  }
  const processDFN = (subExpressions, scope) => {
    const subScope = {
      '_del_': { category: 'F', name: '_del_' },
      '_ddel_': { category: 'D', name: '_ddel_' },
      '_a_': { category: 'V', name: '' }, // name is empty to deal with first assignment of ⍺ in a DFN
    };  
    scope.push(subScope);
    const statements = [];
    for (let i = 0; i < subExpressions.length; i++) {
      statements.push(parseExpression(subExpressions[i], scope));
    }
    delete scope[scope.length - 1]['_del_'];
    delete scope[scope.length - 1]['_ddel_'];
    delete scope[scope.length - 1]['_a_'];
    const declarations = Object.keys(subScope);
    scope.pop();
    return { type: 'Block', declarations, statements };
  }
  // A reversed copy: the caller's token list is left untouched.
  const tokens = expression.slice().reverse();
  tokens.push({ type: 'Edge', value: 'Edge' });
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const reg = {};
    if (token.type === 'DFN') {
      reg.category = 'F';
      reg.node = { type: 'Dfn', body: processDFN(token.value, scope) };
    } else if (token.type === 'DOPD') {
      reg.category = 'D';
      reg.node = { type: 'Dop', kind: 'dyadic', body: processDFN(token.value, scope) };
    } else if (token.type === 'DOPM') {
      reg.category = 'M';
      reg.node = { type: 'Dop', kind: 'monadic', body: processDFN(token.value, scope) };
    } else if (token.type === 'SPECIAL_VAR') {
      reg.category = global_category[token.value].category;
      reg.node = { type: 'Identifier', name: global_category[token.value].name, global: false };
    } else if (
        token.type === 'IDENTIFIER' ||
        token.type === 'SYMBOL'
      ) {
      const [cat_name, global] = find_category(token.value, scope);
      if (!cat_name && token.type === 'SYMBOL') {
        // A glyph with no entry would otherwise compile to G.<glyph> - a
        // baffling JS syntax error rather than an APL one.
        throw new Error(`SYNTAX ERROR: unknown primitive ${token.value} at position ${token.pos}`);
      }
      reg.category = cat_name ? cat_name.category : 'V';
      const name = cat_name && cat_name.name ? cat_name.name : token.value;
      reg.node = { type: 'Identifier', name, global };
    } else {
      reg.category =
        token.type === 'NUMBER' ? 'V' :
        token.type === 'STRING' ? 'V' : token.value;
      const text = token.type === 'NUMBER' ? token.value.replaceAll('¯', '-') : token.value;
      reg.node = { type: 'Raw', text };
    }
    stack.push(reg);
    // Apply reduction rules greedily onto the stack frame
    /*if(reg.category !=='V')*/ reduceStack();
  }
  // Post-parsing structural check
  if (stack.length > 2) {
    throw new Error(`SYNTAX ERROR: could not combine ${stack.slice(0, -1).map(e => emitJs(e.node)).join(', ')}`);
  }
  return stack[0].node;
}

// --- Public API ---
const parseToAst = (text, categories = { ...global_category }) => {
  const tokens = tokenizer(text);
  const [expressions, _] = breakExpressions(tokens, 0);
  const scope = [categories];
  const statements = expressions.map((expression) => parseExpression(expression, scope));
  return { type: 'Program', statements };
};

const parser = (text, categories = { ...global_category }) => {
  return emitJs(parseToAst(text, categories));
}

const aplToJavaScript = (text, categories = { ...global_category }) => {
  return parser(text, categories);
};

const evaluateApl = (text, runtime = G, categories = { ...global_category }) => {
  const generatedCode = aplToJavaScript(text, categories);
  const executor = new Function('G', generatedCode);
  return executor(Object.create(runtime));
};

const AplJS = () => {
  const context = Object.create(G);
  const categories = { ...global_category };
  return (text) => {
    const generatedCode = aplToJavaScript(text, categories);
    const executor = new Function('G', generatedCode);
    return executor(context);
  };
}

export {
  tokenizer,
  breakExpressions,
  parseExpression,
  parseToAst,
  emitJs,
  emitGraph,
  isTrain,
  parser,
  aplToJavaScript,
  evaluateApl,
  G,
  global_category,
  AplJS,
  roundValue,
  formatNum
};