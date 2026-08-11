
const tokenizer = (text) => {
  const tokens = [];
  const specs = [
    { regex: /^([\r\n]|⋄)+/u, type: 'SEPARATOR' },
    { regex: /^⍝[^\n]*/u, type: 'COMMENT' },
    { regex: /^(⍺{1,2}|⍵{1,2}|∇{1,2}|[⍶⍹⍙])/u, type: 'SPECIAL_VAR' },
    { regex: /^\s+/, type: 'WHITESPACE' },
    { regex: /^[¯]?\d+(\.\d+)?/u, type: 'NUMBER' },
    { regex: /^'[^'\\]*(?:\\.[^'\\]*)*'/, type: 'STRING' },
    { regex: /^#[0-9\p{L}\-]+/u, type: 'STRING' },
    { regex: /^\(/, type: 'PAREN_OPEN' },
    { regex: /^\)/, type: 'PAREN_CLOSE' },
    { regex: /^\{/, type: 'BRACE_OPEN' },
    { regex: /^\}/, type: 'BRACE_CLOSE' },
    { regex: /^←/u, type: 'ASSIGN' },
    { regex: /^:/, type: 'GUARD' },
    { regex: /^⎕[a-z]+/u, type: 'IDENTIFIER' },
    { regex: /^∘\./u, type: 'SYMBOL' },
    { regex: /^[@\\!\?\*¨,-\/\p{Math}\p{Sm}\p{So}]/u, type: 'SYMBOL' },
    { regex: /^[\p{L}_][\p{L}0-9_]*/u, type: 'IDENTIFIER' }
  ];
    
  let cursor = 0;

  while (cursor < text.length) {
    let matched = false;
    for (const spec of specs) {
      const match = text.slice(cursor).match(spec.regex);
      if (match) {
        if (spec.type !== 'WHITESPACE' && spec.type !== 'COMMENT') {
          if(spec.type === 'SYMBOL' && match[0] === '∘.') {
            tokens.push({ type: 'SYMBOL', value: '→' });
            tokens.push({ type: 'SYMBOL', value: '.' });
          } else if(spec.type === 'STRING' && match[0].startsWith('#')) {
            //console.log('String with # prefix detected:', match[0]);
            const strContent = "'"+match[0].slice(1)+"'";
            tokens.push({ type: spec.type, value: strContent });
          } else {
            tokens.push({ type: spec.type, value: match[0] });
          }
        }
        cursor += match[0].length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      throw new Error(`Unexpected character: "${text[cursor]}"`);
    }
  }
  return tokens;
};

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
  '/': { category:'F', name: 'compress' },
  '⌿': { category:'M', name: 'reduce' },
  '⍀': { category:'M', name: 'scan' },
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
  '⍣': { category:'D', name: 'power' },
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
  '⎕typeof': { category:'F', name: 'typeOf' },
  // Print precision: how many significant digits formatNum/⎕←/⍕ show for a
  // number. A plain read/write variable (category V, not a function), same
  // as ⎕ itself - ⎕pp←4 compiles to a normal assignment (G.pp = 4).
  '⎕pp': { category:'V', name: 'pp' },
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
      throw new Error('Unsupported type for negation');
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
      throw new Error('Arrays must be of the same length for element-wise subtraction.');
    }
    return a.map((x, i) => mdfunc(m,d,w[i],x));
  } else {
    throw new Error('Unsupported types for subtraction');
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

const factorial = (n) => {
  if (n < 0) {
    throw new Error('Factorial is not defined for negative numbers');
  } 
  if (n === 0) {
    return 1;
  }
  let result = 1;
  for (let i = 1; i <= n; i++) {
    result *= i;
  }
  return result;
};

const binomial = (n, k) => {
  if (k < 0 || k > n) {
    return 0;
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
  if (typeof w === 'number' && typeof a === 'number') {
    return f(w, a) ? 1 : 0;
  }
  if(typeof w === 'string' && typeof a === 'string') {
    if(a.length===1) {
      return w.split('').map(x => f(x, a) ? 1 : 0);
    }
    if(w.length===1) {
      return a.split('').map(x => f(w, x) ? 1 : 0);
    }
    if(w.length===a.length) {
      return a.split('').map((x,i) => f(w[i], x) ? 1 : 0);
    }
  }
  if(!Array.isArray(a) && Array.isArray(w)) {
    return w.map(x => drel(f, x, a));
  }
  if(Array.isArray(a) && !Array.isArray(w)) {
    return a.map(x => drel(f, w, x));
  }
  if(Array.isArray(a) && Array.isArray(w)) {
    if (a.length !== w.length) {
      throw new Error('Arrays must be of the same length for element-wise comparison.');
    }
    return a.map((x, i) => drel(f, w[i], x));
  }
  throw new Error('Unsupported types for comparison');
}

const shapeRec = (arr) => {
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
  const shape = shapeRec(arr[0]);
  for(let i=1; i<arr.length; i++) {
    if(!equalShape(shape, shapeRec(arr[i]))) {
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

const assignRec = (arr, idx, value) => {
  if(typeof idx === 'number') {
    arr[idx] = value;
  }
  let result = arr;
  for (let i = 0; i < idx.length - 1; i++) {
    result = result[idx[i]];
  }
  result[idx[idx.length - 1]] = value;
};

const getRec = (arr, idx) => {
  if (typeof idx === 'number') {
    return arr[idx];
  }
  if (!Array.isArray(idx)) {
    console.log(arr, idx);
    throw new Error('Unsupported index type');
  }
  if (idx.length === 0) {
    return arr;
  }
  const t = idx[0];
  const rest = idx.slice(1);
  if (typeof t === 'number') {
    return getRec(arr[t], rest);
  }
  const result = [];
  for (let i = 0; i < t.length; i++) {
    result.push(getRec(arr[t[i]], rest));
  }
  return result;
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
    throw new Error('Permutation must be an array');
  }
  const shape = shapeRec(a);
  if (p.length !== shape.length) {
    throw new Error('Permutation length must match the array rank');
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
      throw new Error('Matrix is singular and has no inverse');
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
const normalizeCommandList = (w) => {
  if (!Array.isArray(w)) {
    return [[w]];
  }
  if (w.length === 0) {
    return [];
  }
  if (typeof w[0] === 'string') {
    return [w];
  }
  return w.map(cmd => {
    const item = isBoxed(cmd) ? cmd[0] : cmd;
    return Array.isArray(item) ? item : [item];
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

const partitionEnclose = (a, w) => {
  if (typeof w === 'string') {
    w = w.split('');
  }
  if (!Array.isArray(w) || !Array.isArray(a)) {
    throw new Error('Partitioned enclose requires arrays');
  }
  const result = [];
  let current = null;
  let currentKey = null;
  for (let i = 0; i < w.length; i++) {
    const key = a[i];
    if (!key) {
      current = null;
      currentKey = null;
      continue;
    }
    if (current !== null && key === currentKey) {
      current.push(w[i]);
    } else {
      current = [w[i]];
      result.push(current);
      currentKey = key;
    }
  }
  return result;
};

const flattenDeep = (w) => {
  if (!Array.isArray(w)) {
    return [w];
  }
  return w.reduce((acc, x) => acc.concat(flattenDeep(x)), []);
};

const isMember = (item, list) => list.some(x => matchRec(item, x) === 1);

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
  const magnitude = Math.pow(10, digits - Math.ceil(Math.log10(Math.abs(x))));
  return Math.round(x * magnitude) / magnitude;
};

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
  return String(v).replace('-', '¯');
};

const formatCell = (x, digits) => (typeof x === 'string' ? x : formatNum(x, digits));

const padColumns = (rows) => {
  const cols = rows[0].length;
  const widths = Array.from({ length: cols }, (_, j) =>
    Math.max(...rows.map(r => r[j].length)));
  return rows.map(r => r.map((c, j) => c.padStart(widths[j])).join(' ')).join('\n');
};

const formatArray = (w, digits) => {
  if (typeof w === 'string') {
    return w;
  }
  if (!Array.isArray(w)) {
    return formatCell(w, digits);
  }
  if (w.length === 0 || !Array.isArray(w[0])) {
    return w.map((c) => formatCell(c, digits)).join(' ');
  }
  return padColumns(w.map(row => row.map((c) => formatCell(c, digits))));
};

const formatFixed = (x, decimals) => {
  if (typeof x !== 'number') {
    return String(x);
  }
  return x.toFixed(decimals).replace('-', '¯');
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

  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

// Rank operator (⍤) helper: given the requested rank `k` and an operand's
// actual rank `n`, returns the cell rank per Dyalog's clamping rule -
// non-negative k clamps at n, negative k counts back from n and clamps at 0.
const cellRankFor = (k, n) => (k >= 0 ? Math.min(k, n) : Math.max(n + k, 0));

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
  null: null,
  undefined: undefined,
  set quad(value) {
    console.log('⎕:', roundValue(value, this.pp));
  },
  right: (w) => w,
  left: (w,a) => (a===undefined?w:a),
  each: (f)=>(w, a) => {
    if (typeof f !== 'function') {
      throw new Error('Each requires a function');
    }
    if (Array.isArray(w)&&Array.isArray(a)) {
      return w.map((x,i) => f(x, a[i]));
    } else if(Array.isArray(w)) {
      return w.map(x => f(x, a));
    } else if(Array.isArray(a)) {
      return a.map(x => f(w, x));
    } else {
      return f(w, a);
    }
  },
  power: (f, g)=>(w, a) => {
    if (typeof f !== 'function') {
      throw new Error('Power requires a function');
    }
    if (typeof g === 'number') {
      let result = w;
      for (let i = 0; i < g; i++) {
        result = f(result, a);
      }
      return result;
    }
    if (typeof g === 'function') {
      let result = w;
      let newResult;
      let iterations = 100000; // Prevent infinite loops
      while (g(result, newResult=f(result, a)) === 0 && iterations > 0) {
        result = newResult;
        iterations--;
      }
      return result;
    }
    throw new Error('Power requires a function or a number');
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
    if (!Array.isArray(w)) {
      w = [w];
    }
    if (!Array.isArray(a)) {
      a = [a];
    }
    const m = w.length;
    const result = fillShapeRec(a, (prefix, index) => w[index % m]);
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
      // throw new Error(`Unsupported type for tally ${typeof w}`);
    }
  }, 
  compress: (w, a) => {
    if (typeof w === 'string' && Array.isArray(a)) {
      w = w.split('');
      let result = '';
      for (let i = 0; i < w.length; i++) {
        for(let j = 0; j < a[i]; j++) {
          result = result + w[i];
        }
      }
      return result;
    }
    if(!Array.isArray(w) || !Array.isArray(a)) {
      throw new Error('Unsupported types for compress');
    }
    const result = [];
    for (let i = 0; i < w.length; i++) {
      for(let j = 0; j < a[i]; j++) {
        result.push(w[i]);
      }
    }
    return result;
  },
  deal: (w, a) => {
    if(a===undefined) {
      return mdfunc(x => Math.floor(Math.random() * x), undefined, w);
    }
    if (typeof w === 'number' && typeof a === 'number') {
      if (a > w) {
        throw new Error('Deal requires the left argument to not exceed the right argument');
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
    throw new Error('Unsupported types for deal');
  },
  circle: (w, a) => {
    if(a===undefined) {
      if (typeof w === 'number') {
        return Math.PI * w;
      }
      if (Array.isArray(w)) {
        const result = fillShapeRec(shapeRec(w), (prefix, index) => {
          const v = at(w, prefix);
          return Math.PI * v;
        });
        return result;
      }
    }
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
    if (typeof w === 'number' && typeof a === 'number') {
      return a>=0?circFunc[a](w):circInvFunc[-a](w);
    }
    if(Array.isArray(w) && typeof a === 'number') {
      const func = a>=0?circFunc[a]:circInvFunc[-a];
      const result = fillShapeRec(shapeRec(w), (prefix, index) => {
        const v = at(w, prefix);
        return func(v);
      });
      return result;
    }
    throw new Error('Unsupported types for circle');
  },
  encode: (w, a) => {
    if (typeof a === 'number')
      a = [a];
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
          throw new Error('Arrays must be of the same length for decode');
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
      throw new Error('Incompatible shapes for decode');
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
      throw new Error('Outer requires a function');
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
      throw new Error('Dot requires two functions');
    }
    const sw = shapeRec(w);
    const sa = shapeRec(a);
    if(sa.at(-1) !== sw.at(0)) {
      throw new Error('Incompatible shapes for dot product');
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
  // pseudo-inverse for a non-square ⍵); dyadic ⍺⌹⍵ solves ⍵·X≡⍺ for X, i.e.
  // (⌹⍵)+.×⍺ - ⍺ may be a plain vector (a single right-hand side) or a
  // matrix (one right-hand side per column), and the result matches ⍺'s
  // shape (vector in, vector out).
  domino: (w, a) => {
    if (!Array.isArray(w) || !Array.isArray(w[0])) {
      throw new Error('Domino requires a matrix');
    }
    if (a === undefined) {
      return matPseudoInverse(w);
    }
    const aIsVector = !Array.isArray(a[0]);
    const aMat = aIsVector ? a.map((x) => [x]) : a;
    const result = matMul(matPseudoInverse(w), aMat);
    return aIsVector ? result.map((row) => row[0]) : result;
  },
  rank: (f, g) => (w, a) => {
    if (typeof f !== 'function') {
      throw new Error('Rank requires a function');
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
      throw new Error('Rank requires a number or an array of 2 or 3 numbers');
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
    throw new Error('Rank operator: frames of the two arguments must match, or one must reduce to a single cell');
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
    return mdfunc(x => 1/x, (x,y) => y/x, w, a);
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
      if (Array.isArray(w)) {
        return fillShapeRec(w, (idx, index) => idx);
      }
      if (typeof w === 'number') {
        return Array.from({ length: w }, (_, i) => i);
      } 
      throw new Error('Unsupported type for iota');
    }
    if (typeof a === 'string') {
      a = a.split('');
    }
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
      throw new Error('Incompatible shapes for iota');
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
    return result;
  },
  iota_index: (w, a) => {
    if (a === undefined) {
      if(typeof w === 'number')
        w = [w];
      if(!Array.isArray(w)) {
        throw new Error('Unsupported type for iota_index');
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
        for(let i=0; i<v; i++) {
          result.push(prefix);
        }
      });
      return result;
    }
    if (typeof a === 'string') {
      a = a.split('');
    }
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
      throw new Error('Incompatible shapes for iota_index');
    }
    const resultShape = shapew.slice(0, r);
    const result = fillShapeRec(resultShape, (prefix, index) => {
      const v = at(w, prefix);
      const len = a.length;
      for (let i = 0; i < len; i++) {
        if (v < at(a, [i]))
          return i;
      }
      return len;
    });
    return result;
  },            
  jot: (f, g) => (w, a) => {
    if(typeof f !== 'function') {
      return g(f, w);
    }
    if(typeof g !== 'function') {
      return f(w, g);
    }
    return f(g(w),a);      
  },
  reduce: ((f) => (a) => {
    if (!Array.isArray(a)) {
      throw new Error('Reduce requires an array');
    }
    if (a.length === 0) {
      throw new Error('Reduce cannot be applied to an empty array');
    }
    return a.reduceRight(f);
  }),
  scan: ((f) => (a) => {
    if (!Array.isArray(a)) {
      throw new Error('Scan requires an array');
    }
    if (a.length === 0) {
      throw new Error('Scan cannot be applied to an empty array');
    }
    const result = [];
    let acc = a[0];
    result.push(acc);
    for (let i = 1; i < a.length; i++) {
      acc = f(acc, a[i]);
      result.push(acc);
    }
    return result;
  }),
  // Key (⌸, monadic operator): f⌸w groups w's own items by value - for each
  // unique value (in first-occurrence order), f is called with (indices, key)
  // i.e. ⍵=indices into w, ⍺=the key itself. a f⌸w classifies by a instead -
  // f is called with (matching items of w, key), grouping w's actual values
  // rather than their positions. Both forms collect one f-result per unique
  // key, in first-occurrence order.
  key: (f) => (w, a) => {
    if (typeof f !== 'function') {
      throw new Error('Key requires a function');
    }
    const findKeyIndex = (keys, k) => keys.findIndex((existing) => matchRec(existing, k) === 1);

    if (a === undefined) {
      const items = typeof w === 'string' ? w.split('') : w;
      if (!Array.isArray(items)) {
        throw new Error('Key requires an array');
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
      throw new Error('Key requires the classifier and data to have the same length');
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
      if (isBoxed(w)) {
        return [w];
      }
      if (Array.isArray(w)) {
        return w.flatMap(asCatenationTerms);
      }
      return [w];
    }
    return [...asCatenationTerms(a), ...asCatenationTerms(w)];
  },
  transpose: (w, a) => {
    if (a === undefined) {
      return transpose(w);
    }
    return permute(w, a);
  },
  squad: (w, a) => {
    if(typeof w === 'string')
      w = w.split('');
    // if(Array.isArray(a) && 
    //   a.length === 1 && 
    //   Array.isArray(a[0])) {
    //   a = a[0];
    //   const sw = shapeRec(w);
    //   const sa = shapeRec(a);
    //   const rw = sw.length;
    //   if(rw===1) {
    //     return fillShapeRec(sa, (prefix, index) => {
    //       const v = at(a, prefix);
    //       return w[v];
    //     });
    //   }
    //   if(rw===sa[sa.length-1]) {
    //     const resultShape = sa.slice(0, -1);
    //     return fillShapeRec(resultShape, (prefix, index) => {
    //       const v = at(a, prefix);
    //       return at(w, v);
    //     });
    //   }
    //   throw new Error('Unsupported shapes for squad');
    // }
    return getRec(w, a);
  },
  at: (f,g) => (w, a) => {
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
          throw new Error('Array lengths must match');
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
    if(Array.isArray(g)) {
      if(Array.isArray(f)) {
        if(f.length !== g.length)
          throw new Error('Array lengths must match');
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
    throw new Error('Unsupported usage of at');
  },
  grade_up: (w) => {
    if (!Array.isArray(w)) {
      throw new Error('Grade up requires an array');
    }
    return w.map((v, i) => {return {i, v}})
          .sort((a, b) => totalCompare(a.v, b.v))
          .map((obj) => obj.i);
  },
  grade_down: (w) => {
    if (!Array.isArray(w)) {
      throw new Error('Grade down requires an array');
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
    return partitionEnclose(a, w);
  },
  partition: (w, a) => {
    if (a === undefined) {
      return [w];
    }
    return partitionEnclose(a, w);
  },
  pick: (w, a) => {
    if (a===undefined) {
      if (Array.isArray(w))
        return w.length===0? 0 : w[0];
      if (typeof w==='string') 
        return w.length===0? ' ' : w[0];
      return w;
    }
    if (typeof a === 'number') {
      return w[a];
    }
    if (Array.isArray(a)) {
      return a.map(x => at(w, typeof x === 'number' ? [x] : x));
    }
    throw new Error('Unsupported type for pick');
  },
  take: (w, a) => {
    if (!Array.isArray(w)) {
      throw new Error('Take requires an array');
    }
    if (typeof a === 'number') {
      a = [a];
    }
    const shape = shapeRec(w);
    const resultShape = shape.slice();
    if (a.length > resultShape.length) {
      throw new Error('Take shape has more dimensions than the array');
    }
    for (let i = 0; i < a.length; i++) {
      resultShape[i] = Math.abs(a[i]);
    }
    const result = fillShapeRec(resultShape, (prefix, index) => {
      const idx = prefix.slice();
      for (let i = 0; i < a.length; i++) {
        idx[i] = a[i] < 0 ? prefix[i] + shape[i]+a[i] : prefix[i];
        if (idx[i] >= shape[i] || idx[i] < 0) {
          return 0;
        }
      }
      return at(w, idx);
    });
    return result;
  },
  drop: (w, a) => {
    if (!Array.isArray(w)) {
      throw new Error('Drop requires an array');
    }
    if (typeof a === 'number') {
      a = [a];
    }
    const shape = shapeRec(w);
    const resultShape = shape.slice();
    if (a.length > resultShape.length) {
      throw new Error('Drop shape has more dimensions than the array');
    }
    for (let i = 0; i < a.length; i++) {
      resultShape[i] = Math.max(0, shape[i] - Math.abs(a[i]));
    }
    const result = fillShapeRec(resultShape, (prefix, index) => {
      const idx = prefix.slice();
      for (let i = 0; i < a.length; i++) {
        idx[i] = a[i] < 0 ? prefix[i] : prefix[i] + a[i];
        if (idx[i] >= shape[i] || idx[i] < 0) {
          return 0;
        }
      }
      return at(w, idx);
    });
    return result;
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
      throw new Error('Execute requires a string');
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
      throw new Error('Find requires an array right argument');
    }
    const parr = Array.isArray(a) ? a : [a];
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
      throw new Error('Unique/union requires an array');
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
      throw new Error('Intersection requires arrays');
    }
    const result = uniqueItems(aitems).filter(x => isMember(x, witems));
    return wasStringA ? result.join('') : result;
  },
  not: (w, a) => {
    if (a === undefined) {
      return mdfunc((x) => {
        if (x !== 0 && x !== 1) {
          throw new Error('Domain error: ~ requires 0 or 1');
        }
        return 1 - x;
      }, undefined, w);
    }
    // Dyadic ~ is "without": elements of `a` that do not occur in `w`.
    const wasStringA = typeof a === 'string';
    const aitems = wasStringA ? a.split('') : a;
    const witems = typeof w === 'string' ? w.split('') : (Array.isArray(w) ? w : [w]);
    if (!Array.isArray(aitems)) {
      throw new Error('Without requires an array left argument');
    }
    const result = aitems.filter(x => !isMember(x, witems));
    return wasStringA ? result.join('') : result;
  }
};

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
         (token.value === '⍹')) {
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
const CAT_V_F_D_M = ['V', 'F', 'D', 'M'];
// 'Q' (⍞) is included below so it acts as a left boundary too - e.g.
// ⍞1⌷⊢ can build the whole train 1⌷⊢ before ⍞ quotes it, without needing
// ⍞(1⌷⊢). Left out of CAT_BOUNDARY_MF_NOCOLON on purpose: that one's for
// what precedes an assignment target, unrelated to what ⍞ quotes.
const CAT_BOUNDARY_F = ['F', '(', '←', 'Edge', ':', 'Q'];
const CAT_BOUNDARY_MVF = ['M', 'V', 'F', '(', '←', 'Edge', ':', 'Q'];
const CAT_BOUNDARY_MF = ['M', 'F', '(', '←', 'Edge', ':', 'Q'];
const CAT_F_V = ['F', 'V'];
const CAT_BOUNDARY = ['(', '←', 'Edge', ':', 'Q'];
const CAT_BOUNDARY_MF_NOCOLON = ['(', '←', 'M', 'F', 'Edge'];
const CAT_V_CLOSEPAREN = ['V', ')'];

// Renders a statement list the same way at both the dfn-body level (via
// Block, which additionally hoists `let` declarations) and the top-level
// Program: every statement but the last is followed by `; `, the last is
// wrapped in `return ... ;` - a dfn's/program's value is its last expression.
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
        return `((${_w_}, ${_a_})=> ${emitJs(node.mid)}(${emitJs(node.right)}(${_w_}), ${emitJs(node.left)}))`;
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
        const decls = node.declarations.map((d) => (d[0] === '[' ? `${d} = []` : d)).join(', ');
        prefix = `let ${decls}; `;
      }
      return prefix + emitStatements(node.statements);
    }
    case 'Program':
      return emitStatements(node.statements);
    default:
      throw new Error(`Unknown AST node type: ${node.type}`);
  }
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
        belong(A.category, CAT_BOUNDARY_F) &&
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
        belong(A.category, CAT_BOUNDARY_MVF) &&
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
        belong(A.category, CAT_BOUNDARY_MF) &&
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
        (B.category === 'F')) ))
        &&
        C.category === 'D' &&
        belong(D.category, CAT_F_V)
      ) {
        //console.log('Found dyadic operator:', B.node, C.node, D.node);
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
        belong(B.category, CAT_F_V) &&
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
        // The scope key has to be a string, and the assignment target may
        // be a strand (e.g. `a b c←⍵`, whose Strand node renders as
        // "[a, b, c]" - valid on both sides, array literal or destructuring
        // pattern) rather than a plain Identifier, so it's rendered here via
        // emitJs the same way the old text-based version always had it
        // pre-rendered. See find_category for what "global" means here.
        const Btext = emitJs(B.node, true);
        const [categoryEntry, global] = find_category(Btext, scope);
        const strippedBtext = global ? Btext.slice(2) : Btext;
        const firstAlphaAssign = strippedBtext === '_a_' && categoryEntry && categoryEntry.name === ''; // First assignment of ⍺ in a DFN
        const node = { type: 'Assign', target: B.node, targetText: Btext, value: D.node, firstAlphaAssign };
        scope[scope.length - 1][strippedBtext] =
          { category: D.category, name: strippedBtext };
        stack.splice(size - 4, 4,
          { category: D.category, node }, A);
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
  const tokens = expression.reverse();
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
      reg.category = cat_name ? cat_name.category : 'V';
      const name = cat_name && cat_name.name ? cat_name.name : token.value;
      reg.node = { type: 'Identifier', name, global };
    } else {
      reg.category =
        token.type === 'NUMBER' ? 'V' :
        token.type === 'STRING' ? 'V' : token.value;
      const text = token.type === 'NUMBER' ? token.value.replace('¯', '-') : token.value;
      reg.node = { type: 'Raw', text };
    }
    stack.push(reg);
    // Apply reduction rules greedily onto the stack frame
    /*if(reg.category !=='V')*/ reduceStack();
  }
  // Post-parsing structural check
  if (stack.length > 2) {
    console.log("❌ SYNTAX ERROR: The stack ended with orphaned elements!:", stack.slice(1).map(e => emitJs(e.node)).join(', '));
  }
  return stack[0].node;
}

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
  roundValue
};