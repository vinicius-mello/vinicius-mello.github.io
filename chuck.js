/*
 * chuck.js — a small educational Forth interpreter.
 *
 * Design notes (see plan for full rationale):
 * - state.dictionary[word] is either a function f(state) (primitive / compiled
 *   control combinator) or an array (a colon-definition body).
 * - Executing an array item: function -> call it; array -> recurse into it
 *   (this is what makes colon-definitions able to call each other); anything
 *   else (number, string) -> push as a literal.
 * - EXIT/LEAVE use thrown sentinels for non-local exit: EXIT is caught at the
 *   nearest enclosing word boundary (the array-branch of executeEntry), LEAVE
 *   is caught locally by the DO/LOOP combinator.
 * - Memory blocks are plain JS arrays; addresses are tagged {__addr,block,offset}
 *   objects, not integers into one global heap.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Chuck = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var EXIT_SIGNAL = { signal: 'EXIT' };
  var LEAVE_SIGNAL = { signal: 'LEAVE' };

  // ---------------------------------------------------------------------
  // Stack helpers
  // ---------------------------------------------------------------------

  function popS(state) {
    if (state.stackS.length === 0) throw new Error('stack underflow');
    return state.stackS.pop();
  }

  function popS2(state) {
    var b = popS(state);
    var a = popS(state);
    return [a, b];
  }

  function top(arr) {
    return arr.length === 0 ? undefined : arr[arr.length - 1];
  }

  // ---------------------------------------------------------------------
  // Addresses (memory model: blocks are JS arrays, addresses are tagged
  // {block, offset} pairs rather than integers into one global heap)
  // ---------------------------------------------------------------------

  function makeAddr(block, offset) {
    return { __addr: true, block: block, offset: offset };
  }

  function isAddr(x) {
    return x !== null && typeof x === 'object' && x.__addr === true;
  }

  // ---------------------------------------------------------------------
  // Reader: character-by-character, >IN-style cursor into state.source,
  // so words like : CREATE S" ." ( can consume raw input directly instead
  // of working off a pre-split token array.
  // ---------------------------------------------------------------------

  function isSpace(ch) {
    return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
  }

  function skipWhitespace(state) {
    while (state.sourcePos < state.source.length && isSpace(state.source[state.sourcePos])) {
      state.sourcePos++;
    }
  }

  function readWord(state) {
    skipWhitespace(state);
    if (state.sourcePos >= state.source.length) return null;
    var start = state.sourcePos;
    while (state.sourcePos < state.source.length && !isSpace(state.source[state.sourcePos])) {
      state.sourcePos++;
    }
    return state.source.slice(start, state.sourcePos);
  }

  function readUntilChar(state, delim) {
    if (state.source[state.sourcePos] === ' ') state.sourcePos++;
    var start = state.sourcePos;
    var idx = state.source.indexOf(delim, state.sourcePos);
    if (idx === -1) {
      var rest = state.source.slice(start);
      state.sourcePos = state.source.length;
      return rest;
    }
    var result = state.source.slice(start, idx);
    state.sourcePos = idx + 1;
    return result;
  }

  function skipToEndOfLine(state) {
    var idx = state.source.indexOf('\n', state.sourcePos);
    state.sourcePos = idx === -1 ? state.source.length : idx;
  }

  function parseNumber(word, base) {
    if (base === 10) {
      if (/^-?\d+$/.test(word)) return parseInt(word, 10);
      if (/^-?\d+\.\d+$/.test(word)) return parseFloat(word);
      return null;
    }
    var re = base === 16 ? /^-?[0-9a-fA-F]+$/
      : base === 2 ? /^-?[01]+$/
      : /^-?[0-9a-zA-Z]+$/;
    if (!re.test(word)) return null;
    var n = parseInt(word, base);
    return Number.isNaN(n) ? null : n;
  }

  // ---------------------------------------------------------------------
  // Core execution
  // ---------------------------------------------------------------------

  function executeArray(arr, state) {
    var hasStepHook = typeof state.onStep === 'function';
    for (var i = 0; i < arr.length; i++) {
      executeEntry(arr[i], state);
      // Fires for every executed item, at every nesting depth (loop bodies,
      // IF branches, nested colon-word calls) — not just top-level words —
      // so a host UI can trace loop iterations one step at a time instead of
      // seeing the whole DO..LOOP run as a single opaque step.
      if (hasStepHook) state.onStep(describeEntry(state, arr[i]), null);
    }
    return state;
  }

  // An array-typed item is, by construction, always "another compiled word
  // being invoked" (literals are never arrays; control combinators are always
  // functions). So the EXIT catch belongs exactly here, at the word boundary.
  function executeEntry(entry, state) {
    if (typeof entry === 'function') {
      entry(state);
    } else if (Array.isArray(entry)) {
      try {
        executeArray(entry, state);
      } catch (e) {
        if (e !== EXIT_SIGNAL) throw e;
      }
    } else {
      state.stackS.push(entry);
    }
    return state;
  }

  // ---------------------------------------------------------------------
  // Compile-time control stack: redirects where the next compiled item
  // gets appended while IF/BEGIN/DO frames are nested. state.currentDefinition
  // itself stays a single stable array (it becomes dictionary[name] at ;).
  // ---------------------------------------------------------------------

  function compileTarget(state) {
    if (state.controlStack.length === 0) return state.currentDefinition;
    var f = state.controlStack[state.controlStack.length - 1];
    switch (f.type) {
      case 'if': return f.active === 'true' ? f.trueBranch : f.falseBranch;
      case 'begin': return f.body;
      case 'begin-while': return f.bodyPart;
      case 'do': return f.body;
      default: throw new Error('unknown control frame: ' + f.type);
    }
  }

  function compileAppend(state, item) {
    compileTarget(state).push(item);
  }

  function requireDefine(state, word) {
    if (state.mode !== 'define' || !state.currentDefinition) {
      throw new Error(word + ' used outside a definition');
    }
  }

  // ---------------------------------------------------------------------
  // Word dispatch / top-level interpreter
  // ---------------------------------------------------------------------

  function executeWord(word, state) {
    var key = word.toLowerCase();
    var entry = state.dictionary[key];
    if (state.mode === 'execute') {
      if (entry !== undefined) {
        executeEntry(entry, state);
      } else {
        var n = parseNumber(word, state.baseBlock[0]);
        if (n !== null) state.stackS.push(n);
        else state.io.print(word + ' ?\n');
      }
    } else { // 'define'
      if (entry !== undefined) {
        if (entry.immediate) executeEntry(entry, state);
        else compileAppend(state, entry);
      } else {
        var n2 = parseNumber(word, state.baseBlock[0]);
        if (n2 !== null) {
          compileAppend(state, n2);
        } else {
          state.io.print(word + ' ?  (aborting definition)\n');
          state.mode = 'execute';
          state.currentWord = null;
          state.currentDefinition = null;
          state.currentDefinitionPrefix = null;
          state.controlStack = [];
        }
      }
    }
    return state;
  }

  function interpret(text, state) {
    state.source = text;
    state.sourcePos = 0;
    var word;
    while ((word = readWord(state)) !== null) {
      var errorMessage = null;
      try {
        executeWord(word, state);
      } catch (e) {
        if (e === EXIT_SIGNAL) {
          // harmless at top level
        } else if (e === LEAVE_SIGNAL) {
          errorMessage = 'LEAVE outside loop';
          state.io.print(errorMessage + '\n');
        } else {
          errorMessage = e && e.message ? e.message : String(e);
          state.io.print('Error: ' + errorMessage + '\n');
        }
        state.mode = 'execute';
        state.controlStack = [];
        state.currentWord = null;
        state.currentDefinition = null;
        state.currentDefinitionPrefix = null;
      }
      // Optional debugger hook: fires after every single word is processed
      // (execution or compilation alike), so a host UI can show a live,
      // step-by-step view of the stacks and the definition being compiled.
      if (typeof state.onStep === 'function') {
        state.onStep(word, errorMessage);
      }
    }
    return state;
  }

  // ---------------------------------------------------------------------
  // DO/LOOP support
  // ---------------------------------------------------------------------

  function makeLoopCombinator(body, isPlusLoop) {
    return function loopCombinator(state) {
      var start = popS(state);
      var limit = popS(state);
      var marker = { kind: 'loop', index: start, limit: limit };
      state.stackR.push(marker);
      try {
        while (true) {
          try {
            executeArray(body, state);
          } catch (e) {
            if (e === LEAVE_SIGNAL) break;
            throw e;
          }
          var step = isPlusLoop ? popS(state) : 1;
          var oldIndex = marker.index;
          marker.index += step;
          // ANS Forth boundary-crossing test: correct for ascending and
          // descending +LOOP alike.
          if (((oldIndex - marker.limit) ^ (marker.index - marker.limit)) < 0) break;
        }
      } finally {
        state.stackR.pop();
      }
    };
  }

  function findLoopMarker(state, depth) {
    var n = -1;
    for (var i = state.stackR.length - 1; i >= 0; i--) {
      var item = state.stackR[i];
      if (item && typeof item === 'object' && item.kind === 'loop') {
        n++;
        if (n === depth) return item;
      }
    }
    throw new Error('I/J used outside DO..LOOP');
  }

  // ---------------------------------------------------------------------
  // Dictionary bootstrap
  // ---------------------------------------------------------------------

  // Registers a dictionary entry AND records it in state.wordNames, the
  // "inverted table" mapping a function/array back to the word name that
  // owns it. Dictionary entries are otherwise anonymous JS values (plain
  // functions or arrays), so this is what lets a debugger show "DUP" for a
  // stack/definition item instead of dumping raw source code.
  function registerWord(state, key, entry) {
    state.dictionary[key] = entry;
    state.wordNames.set(entry, key.toUpperCase());
    return entry;
  }

  function installPrimitives(state) {
    var dict = state.dictionary;
    function def(name, fn, immediate) {
      fn.immediate = !!immediate;
      registerWord(state, name, fn);
    }

    // --- stack ---
    def('dup', function (s) {
      if (s.stackS.length === 0) throw new Error('stack underflow');
      s.stackS.push(s.stackS[s.stackS.length - 1]);
    });
    def('drop', function (s) { popS(s); });
    def('swap', function (s) {
      var p = popS2(s);
      s.stackS.push(p[1], p[0]);
    });
    def('over', function (s) {
      if (s.stackS.length < 2) throw new Error('stack underflow');
      s.stackS.push(s.stackS[s.stackS.length - 2]);
    });
    def('rot', function (s) {
      if (s.stackS.length < 3) throw new Error('stack underflow');
      var c = s.stackS.pop(), b = s.stackS.pop(), a = s.stackS.pop();
      s.stackS.push(b, c, a);
    });
    def('-rot', function (s) {
      if (s.stackS.length < 3) throw new Error('stack underflow');
      var c = s.stackS.pop(), b = s.stackS.pop(), a = s.stackS.pop();
      s.stackS.push(c, a, b);
    });
    def('2dup', function (s) {
      if (s.stackS.length < 2) throw new Error('stack underflow');
      var a = s.stackS[s.stackS.length - 2], b = s.stackS[s.stackS.length - 1];
      s.stackS.push(a, b);
    });
    def('2drop', function (s) { popS(s); popS(s); });
    def('2swap', function (s) {
      if (s.stackS.length < 4) throw new Error('stack underflow');
      var d = s.stackS.pop(), c = s.stackS.pop(), b = s.stackS.pop(), a = s.stackS.pop();
      s.stackS.push(c, d, a, b);
    });
    def('2over', function (s) {
      if (s.stackS.length < 4) throw new Error('stack underflow');
      var n = s.stackS.length;
      s.stackS.push(s.stackS[n - 4], s.stackS[n - 3]);
    });
    def('?dup', function (s) {
      if (s.stackS.length === 0) throw new Error('stack underflow');
      var t = s.stackS[s.stackS.length - 1];
      if (t !== 0) s.stackS.push(t);
    });
    def('nip', function (s) {
      var p = popS2(s);
      s.stackS.push(p[1]);
    });
    def('tuck', function (s) {
      var p = popS2(s);
      s.stackS.push(p[1], p[0], p[1]);
    });
    def('depth', function (s) { s.stackS.push(s.stackS.length); });

    // --- arithmetic ---
    def('+', function (s) {
      var p = popS2(s), a = p[0], b = p[1];
      if (isAddr(a) && typeof b === 'number') s.stackS.push(makeAddr(a.block, a.offset + b));
      else if (isAddr(b) && typeof a === 'number') s.stackS.push(makeAddr(b.block, b.offset + a));
      else s.stackS.push(a + b);
    });
    def('-', function (s) {
      var p = popS2(s), a = p[0], b = p[1];
      if (isAddr(a) && typeof b === 'number') s.stackS.push(makeAddr(a.block, a.offset - b));
      else s.stackS.push(a - b);
    });
    def('*', function (s) {
      var p = popS2(s);
      s.stackS.push(p[0] * p[1]);
    });
    def('/', function (s) {
      var p = popS2(s);
      if (p[1] === 0) throw new Error('division by zero');
      s.stackS.push(Math.trunc(p[0] / p[1]));
    });
    def('mod', function (s) {
      var p = popS2(s);
      if (p[1] === 0) throw new Error('division by zero');
      s.stackS.push(p[0] - Math.trunc(p[0] / p[1]) * p[1]);
    });
    def('/mod', function (s) {
      var p = popS2(s), a = p[0], b = p[1];
      if (b === 0) throw new Error('division by zero');
      var q = Math.trunc(a / b);
      s.stackS.push(a - q * b, q);
    });
    def('negate', function (s) { s.stackS.push(-popS(s)); });
    def('abs', function (s) { s.stackS.push(Math.abs(popS(s))); });
    def('min', function (s) { var p = popS2(s); s.stackS.push(Math.min(p[0], p[1])); });
    def('max', function (s) { var p = popS2(s); s.stackS.push(Math.max(p[0], p[1])); });
    def('1+', function (s) { s.stackS.push(popS(s) + 1); });
    def('1-', function (s) { s.stackS.push(popS(s) - 1); });
    def('2*', function (s) { s.stackS.push(popS(s) * 2); });
    def('2/', function (s) { s.stackS.push(Math.trunc(popS(s) / 2)); });

    // --- comparison (Forth flags: -1 true, 0 false) ---
    def('=', function (s) { var p = popS2(s); s.stackS.push(p[0] === p[1] ? -1 : 0); });
    def('<>', function (s) { var p = popS2(s); s.stackS.push(p[0] !== p[1] ? -1 : 0); });
    def('<', function (s) { var p = popS2(s); s.stackS.push(p[0] < p[1] ? -1 : 0); });
    def('>', function (s) { var p = popS2(s); s.stackS.push(p[0] > p[1] ? -1 : 0); });
    def('<=', function (s) { var p = popS2(s); s.stackS.push(p[0] <= p[1] ? -1 : 0); });
    def('>=', function (s) { var p = popS2(s); s.stackS.push(p[0] >= p[1] ? -1 : 0); });
    def('u<', function (s) { var p = popS2(s); s.stackS.push((p[0] >>> 0) < (p[1] >>> 0) ? -1 : 0); });
    def('0=', function (s) { s.stackS.push(popS(s) === 0 ? -1 : 0); });
    def('0<', function (s) { s.stackS.push(popS(s) < 0 ? -1 : 0); });
    def('0>', function (s) { s.stackS.push(popS(s) > 0 ? -1 : 0); });

    // --- logic / bitwise ---
    def('and', function (s) { var p = popS2(s); s.stackS.push(p[0] & p[1]); });
    def('or', function (s) { var p = popS2(s); s.stackS.push(p[0] | p[1]); });
    def('xor', function (s) { var p = popS2(s); s.stackS.push(p[0] ^ p[1]); });
    def('not', function (s) { s.stackS.push(~popS(s)); });
    def('invert', function (s) { s.stackS.push(~popS(s)); });
    def('lshift', function (s) { var p = popS2(s); s.stackS.push(p[0] << p[1]); });
    def('rshift', function (s) { var p = popS2(s); s.stackS.push(p[0] >>> p[1]); });

    // --- control flow (all compile-time / immediate) ---
    def('if', function (s) {
      requireDefine(s, 'IF');
      s.controlStack.push({ type: 'if', trueBranch: [], falseBranch: null, active: 'true' });
    }, true);
    def('else', function (s) {
      requireDefine(s, 'ELSE');
      var f = top(s.controlStack);
      if (!f || f.type !== 'if') throw new Error('ELSE without IF');
      f.falseBranch = [];
      f.active = 'false';
    }, true);
    def('then', function (s) {
      requireDefine(s, 'THEN');
      var f = s.controlStack.pop();
      if (!f || f.type !== 'if') throw new Error('THEN without IF');
      var trueBranch = f.trueBranch, falseBranch = f.falseBranch;
      compileAppend(s, function ifCombinator(st) {
        var flag = popS(st);
        if (flag !== 0) executeArray(trueBranch, st);
        else if (falseBranch) executeArray(falseBranch, st);
      });
    }, true);

    def('begin', function (s) {
      requireDefine(s, 'BEGIN');
      s.controlStack.push({ type: 'begin', body: [] });
    }, true);
    def('until', function (s) {
      requireDefine(s, 'UNTIL');
      var f = s.controlStack.pop();
      if (!f || f.type !== 'begin') throw new Error('UNTIL without BEGIN');
      var body = f.body;
      compileAppend(s, function untilCombinator(st) {
        do { executeArray(body, st); } while (popS(st) === 0);
      });
    }, true);
    def('while', function (s) {
      requireDefine(s, 'WHILE');
      var f = top(s.controlStack);
      if (!f || f.type !== 'begin') throw new Error('WHILE without BEGIN');
      f.type = 'begin-while';
      f.condPart = f.body;
      delete f.body;
      f.bodyPart = [];
    }, true);
    def('repeat', function (s) {
      requireDefine(s, 'REPEAT');
      var f = s.controlStack.pop();
      if (!f || f.type !== 'begin-while') throw new Error('REPEAT without WHILE');
      var condPart = f.condPart, bodyPart = f.bodyPart;
      compileAppend(s, function repeatCombinator(st) {
        while (true) {
          executeArray(condPart, st);
          if (popS(st) === 0) break;
          executeArray(bodyPart, st);
        }
      });
    }, true);

    def('do', function (s) {
      requireDefine(s, 'DO');
      s.controlStack.push({ type: 'do', body: [] });
    }, true);
    def('loop', function (s) {
      requireDefine(s, 'LOOP');
      var f = s.controlStack.pop();
      if (!f || f.type !== 'do') throw new Error('LOOP without DO');
      compileAppend(s, makeLoopCombinator(f.body, false));
    }, true);
    def('+loop', function (s) {
      requireDefine(s, '+LOOP');
      var f = s.controlStack.pop();
      if (!f || f.type !== 'do') throw new Error('+LOOP without DO');
      compileAppend(s, makeLoopCombinator(f.body, true));
    }, true);
    def('i', function (s) { s.stackS.push(findLoopMarker(s, 0).index); });
    def('j', function (s) { s.stackS.push(findLoopMarker(s, 1).index); });
    def('leave', function (s) { throw LEAVE_SIGNAL; });
    def('exit', function (s) { throw EXIT_SIGNAL; });
    def('recurse', function (s) {
      requireDefine(s, 'RECURSE');
      var defRef = s.currentDefinition;
      compileAppend(s, function recurseCall(st) { executeArray(defRef, st); });
    }, true);

    // --- return stack ---
    def('>r', function (s) { s.stackR.push(popS(s)); });
    def('r>', function (s) {
      if (s.stackR.length === 0) throw new Error('return stack underflow');
      s.stackS.push(s.stackR.pop());
    });
    def('r@', function (s) {
      if (s.stackR.length === 0) throw new Error('return stack underflow');
      s.stackS.push(s.stackR[s.stackR.length - 1]);
    });
    def('2>r', function (s) {
      var p = popS2(s);
      s.stackR.push(p[0], p[1]);
    });
    def('2r>', function (s) {
      if (s.stackR.length < 2) throw new Error('return stack underflow');
      var b = s.stackR.pop(), a = s.stackR.pop();
      s.stackS.push(a, b);
    });

    // --- memory ---
    def('create', function (s) {
      var name = readWord(s);
      if (!name) throw new Error('CREATE expects a name');
      var block = [];
      var key = name.toLowerCase();
      registerWord(s, key, function (st) { st.stackS.push(makeAddr(block, 0)); });
      s.lastCreatedBlock = block;
      s.lastCreatedKey = key;
      s.lastWord = key;
    });
    def('variable', function (s) {
      var name = readWord(s);
      if (!name) throw new Error('VARIABLE expects a name');
      var block = [0];
      var key = name.toLowerCase();
      registerWord(s, key, function (st) { st.stackS.push(makeAddr(block, 0)); });
      s.lastCreatedBlock = block;
      s.lastCreatedKey = key;
      s.lastWord = key;
    });
    def('constant', function (s) {
      var name = readWord(s);
      if (!name) throw new Error('CONSTANT expects a name');
      var v = popS(s);
      var key = name.toLowerCase();
      registerWord(s, key, function (st) { st.stackS.push(v); });
      s.lastWord = key;
    });
    def('allot', function (s) {
      var n = popS(s);
      if (!s.lastCreatedBlock) throw new Error('ALLOT without CREATE');
      for (var i = 0; i < n; i++) s.lastCreatedBlock.push(0);
    });
    def(',', function (s) {
      var v = popS(s);
      if (!s.lastCreatedBlock) throw new Error(', without CREATE');
      s.lastCreatedBlock.push(v);
    });
    def('@', function (s) {
      var a = popS(s);
      if (!isAddr(a)) throw new Error('@ expects an address');
      s.stackS.push(a.block[a.offset]);
    });
    def('!', function (s) {
      var a = popS(s);
      var v = popS(s);
      if (!isAddr(a)) throw new Error('! expects an address');
      a.block[a.offset] = v;
    });
    def('+!', function (s) {
      var a = popS(s);
      var v = popS(s);
      if (!isAddr(a)) throw new Error('+! expects an address');
      a.block[a.offset] += v;
    });
    def('cells', function () { /* 1 cell == 1 array slot: no-op */ });
    def('cell+', function (s) {
      var a = popS(s);
      if (isAddr(a)) s.stackS.push(makeAddr(a.block, a.offset + 1));
      else s.stackS.push(a + 1);
    });

    // DOES> — used inside a defining word (a word whose own body calls
    // CREATE to make new words), e.g.:
    //   : CONSTANT CREATE , DOES> @ ;
    //   5 CONSTANT FIVE   FIVE .   ( -> 5 )
    // Everything before DOES> (the "prefix") stays CONSTANT's own body and
    // runs each time CONSTANT is invoked. DOES> splits off everything after
    // it into a separate "does-body" array and appends one more item to the
    // prefix: an installer that, when CONSTANT runs, replaces the just-
    // CREATEd word (found via state.lastCreatedKey/lastCreatedBlock, set by
    // CREATE moments earlier in that same run) with a function that pushes
    // its own address and then runs the does-body. This mirrors classic
    // Forth's "patch the most recently CREATEd word's code field" approach.
    def('does>', function (s) {
      requireDefine(s, 'DOES>');
      if (s.controlStack.length !== 0) throw new Error('DOES> inside an unclosed control structure');
      if (s.currentDefinitionPrefix) throw new Error('DOES> already used in this definition');
      var doesBody = [];
      var prefix = s.currentDefinition;
      prefix.push(function doesInstaller(st) {
        var key = st.lastCreatedKey;
        if (!key) throw new Error('DOES> used without a preceding CREATE');
        var block = st.lastCreatedBlock;
        registerWord(st, key, function (st2) {
          st2.stackS.push(makeAddr(block, 0));
          executeArray(doesBody, st2);
        });
      });
      s.currentDefinitionPrefix = prefix;
      s.currentDefinition = doesBody;
    }, true);

    // --- I/O ---
    def('.', function (s) { s.io.print(String(popS(s)) + ' '); });
    def('emit', function (s) { s.io.print(String.fromCharCode(popS(s))); });
    def('cr', function (s) { s.io.print('\n'); });
    def('space', function (s) { s.io.print(' '); });
    def('spaces', function (s) {
      var n = popS(s);
      if (n > 0) s.io.print(new Array(n + 1).join(' '));
    });
    def('type', function (s) {
      var str = popS(s);
      if (typeof str !== 'string') throw new Error('TYPE expects a string');
      s.io.print(str);
    });
    def('."', function (s) {
      var str = readUntilChar(s, '"');
      if (s.mode === 'execute') s.io.print(str);
      else compileAppend(s, function printLiteral(st) { st.io.print(str); });
    }, true);
    def('s"', function (s) {
      var str = readUntilChar(s, '"');
      if (s.mode === 'execute') s.stackS.push(str);
      else compileAppend(s, str);
    }, true);
    def('key', function (s) {
      if (s.sourcePos >= s.source.length) s.stackS.push(-1);
      else s.stackS.push(s.source.charCodeAt(s.sourcePos++));
    });

    // --- comments ---
    def('(', function (s) { readUntilChar(s, ')'); }, true);
    def('\\', function (s) { skipToEndOfLine(s); }, true);

    // --- definition ---
    def(':', function (s) {
      var name = readWord(s);
      if (!name) throw new Error(': expects a name');
      s.currentWord = name.toLowerCase();
      s.currentDefinition = [];
      s.currentDefinitionPrefix = null;
      s.controlStack = [];
      s.mode = 'define';
    });
    def(';', function (s) {
      if (s.mode !== 'define' || !s.currentDefinition) throw new Error('; without :');
      if (s.controlStack.length !== 0) throw new Error('unbalanced control structure (IF/DO/BEGIN without matching THEN/LOOP/UNTIL)');
      // If DOES> ran, the word's real body is the prefix it split off, not
      // the does-body currently in currentDefinition (that's just its tail).
      registerWord(s, s.currentWord, s.currentDefinitionPrefix || s.currentDefinition);
      s.lastWord = s.currentWord;
      s.mode = 'execute';
      s.currentWord = null;
      s.currentDefinition = null;
      s.currentDefinitionPrefix = null;
    }, true);
    def('immediate', function (s) {
      if (!s.lastWord || !dict[s.lastWord]) throw new Error('IMMEDIATE: no word defined yet');
      dict[s.lastWord].immediate = true;
    });
    def('postpone', function (s) {
      requireDefine(s, 'POSTPONE');
      var name = readWord(s);
      if (!name) throw new Error('POSTPONE expects a name');
      var entry = dict[name.toLowerCase()];
      if (entry === undefined) throw new Error(name + ' ?');
      // Splice the word's raw entry in directly, exactly like an ordinary
      // (non-immediate) reference would be compiled — this defers an
      // immediate word's *action* to run later, when the word currently
      // being defined itself executes, instead of running it right now at
      // compile time. Works uniformly for immediate and non-immediate words.
      compileAppend(s, entry);
    }, true);
    def("'", function (s) {
      var name = readWord(s);
      var entry = dict[(name || '').toLowerCase()];
      if (entry === undefined) throw new Error((name || '') + ' ?');
      s.stackS.push(entry);
    });
    def('execute', function (s) { executeEntry(popS(s), s); });
    def('[', function (s) { s.mode = 'execute'; }, true);
    def(']', function (s) { s.mode = 'define'; });
    def('literal', function (s) {
      requireDefine(s, 'LITERAL');
      compileAppend(s, popS(s));
    }, true);

    // --- introspection ---
    def('.s', function (s) {
      s.io.print('<' + s.stackS.length + '> ' + s.stackS.map(String).join(' ') + '\n');
    });
    def('words', function (s) {
      s.io.print(Object.keys(dict).sort().join(' ') + '\n');
    });
    def('see', function (s) {
      var name = readWord(s);
      var entry = dict[(name || '').toLowerCase()];
      if (entry === undefined) { s.io.print((name || '') + ' ?\n'); return; }
      var body = typeof entry === 'function' ? '<primitive>' : '<' + entry.length + ' compiled items>';
      s.io.print(': ' + name + ' ' + body + (entry.immediate ? ' IMMEDIATE' : '') + ' ;\n');
    });

    // --- misc ---
    def('base', function (s) { s.stackS.push(makeAddr(s.baseBlock, 0)); });
    def('hex', function (s) { s.baseBlock[0] = 16; });
    def('decimal', function (s) { s.baseBlock[0] = 10; });
    def('true', function (s) { s.stackS.push(-1); });
    def('false', function (s) { s.stackS.push(0); });
  }

  // ---------------------------------------------------------------------
  // Public: createState
  // ---------------------------------------------------------------------

  function createState(ioOverrides) {
    var state = {
      // Using Object.create(null) so a lookup for e.g. "constructor" doesn't
      // silently resolve to Object.prototype.constructor instead of undefined.
      dictionary: Object.create(null),
      // Reverse lookup (function/array -> word name) kept in sync by
      // registerWord, so tooling can turn a compiled item back into a
      // readable name instead of dumping raw JS source. See describeEntry.
      wordNames: new Map(),
      stackS: [],
      stackR: [],
      mode: 'execute',
      source: '',
      sourcePos: 0,
      currentWord: null,
      currentDefinition: null,
      currentDefinitionPrefix: null,
      controlStack: [],
      lastWord: null,
      lastCreatedBlock: null,
      lastCreatedKey: null,
      baseBlock: [10],
      // Optional: (word, errorMessage) => void, called after every single
      // word interpret() processes. Used by host UIs (e.g. the browser REPL's
      // debug panel) to show step-by-step stack/definition snapshots.
      onStep: null,
      io: Object.assign({
        print: function (str) {
          if (typeof console !== 'undefined') console.log(str);
        }
      }, ioOverrides || {})
    };
    installPrimitives(state);
    return state;
  }

  // ---------------------------------------------------------------------
  // Introspection helpers for debugging/host UIs
  // ---------------------------------------------------------------------

  // Renders a dictionary entry or stack value as a short, human-readable
  // label. Named words (primitives, colon-definitions, CREATEd words) are
  // resolved via state.wordNames; anonymous compile-time combinators (IF/
  // DO/BEGIN bodies, DOES> installers, RECURSE calls) fall back to their JS
  // function name, since they're all declared as named function expressions.
  function describeEntry(state, entry) {
    if (entry === undefined) return 'undefined';
    if (entry === null) return 'null';
    if (typeof entry === 'function' || Array.isArray(entry)) {
      var name = state.wordNames.get(entry);
      if (name) return name;
      if (typeof entry === 'function') return '<' + (entry.name || 'anonymous') + '>';
      return '<compiled: ' + entry.length + ' item(s)>';
    }
    if (isAddr(entry)) return 'addr#' + entry.offset;
    if (typeof entry === 'object' && entry.kind === 'loop') {
      return 'loop(i=' + entry.index + ' limit=' + entry.limit + ')';
    }
    if (typeof entry === 'string') return JSON.stringify(entry);
    return String(entry);
  }

  // A point-in-time, display-ready snapshot of state: both stacks and the
  // definition currently being compiled (if any), all rendered through
  // describeEntry. Safe to keep around after the fact (plain strings/arrays,
  // no live references into state).
  function snapshotState(state) {
    return {
      mode: state.mode,
      stackS: state.stackS.map(function (v) { return describeEntry(state, v); }),
      stackR: state.stackR.map(function (v) { return describeEntry(state, v); }),
      currentWord: state.currentWord ? state.currentWord.toUpperCase() : null,
      currentDefinition: state.currentDefinition
        ? state.currentDefinition.map(function (v) { return describeEntry(state, v); })
        : null,
      controlDepth: state.controlStack.length
    };
  }

  return {
    createState: createState,
    interpret: interpret,
    // exposed for testing / advanced host integration
    executeArray: executeArray,
    executeEntry: executeEntry,
    executeWord: executeWord,
    readWord: readWord,
    isAddr: isAddr,
    makeAddr: makeAddr,
    describeEntry: describeEntry,
    snapshotState: snapshotState
  };
});
