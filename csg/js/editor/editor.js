// Code editor: a transparent <textarea> (source of truth: native caret, selection,
// undo, IME) over a highlighted <pre>. Adds \latex completion, ASCII → symbol
// replacement while typing, auto-indent and error markers.
import { LATEX, SYMBOLS, TYPING_REPLACEMENTS } from '../lang/symbols.js';
import { renderHighlight } from './highlight.js';

const LATEX_NAMES = [...LATEX.keys()].sort();
const symbolInfo = new Map(SYMBOLS.map((s) => [s.sym, s]));

export class Editor {
  constructor(root, { builtins, onChange, onRun, onSave }) {
    this.root = root;
    this.builtins = builtins;
    this.onChange = onChange;
    this.onRun = onRun;
    this.onSave = onSave;
    this.errors = [];
    this.autoReplace = true;
    root.classList.add('editor');
    root.innerHTML = `
      <div class="editor-gutter" aria-hidden="true"></div>
      <div class="editor-code">
        <pre class="editor-highlight" aria-hidden="true"></pre>
        <textarea class="editor-input" spellcheck="false" autocapitalize="off" autocomplete="off"
          autocorrect="off" wrap="off" aria-label="Código do modelo"></textarea>
        <ul class="editor-completion" role="listbox" hidden></ul>
      </div>`;
    this.gutter = root.querySelector('.editor-gutter');
    this.pre = root.querySelector('.editor-highlight');
    this.ta = root.querySelector('.editor-input');
    this.popup = root.querySelector('.editor-completion');
    this.completion = null;

    this.ta.addEventListener('input', (e) => this.handleInput(e));
    this.ta.addEventListener('keydown', (e) => this.handleKey(e));
    this.ta.addEventListener('scroll', () => this.syncScroll());
    this.ta.addEventListener('blur', () => setTimeout(() => this.closeCompletion(), 150));
    this.ta.addEventListener('click', () => this.closeCompletion());
    this.popup.addEventListener('mousedown', (e) => {
      const li = e.target.closest('li');
      if (!li) return;
      e.preventDefault();
      this.completion.index = Number(li.dataset.i);
      this.acceptCompletion();
    });
  }

  get value() { return this.ta.value; }
  set value(v) {
    this.ta.value = v;
    this.render();
  }

  focus() { this.ta.focus(); }

  setErrors(errors) {
    this.errors = errors;
    this.render();
  }

  // ---------- rendering ----------
  render() {
    const src = this.ta.value;
    this.pre.innerHTML = renderHighlight(src, this.builtins, this.errors);
    const lines = src.split('\n').length;
    const errLines = new Map();
    for (const e of this.errors) {
      if (e.line == null) continue;
      if (!errLines.has(e.line)) errLines.set(e.line, []);
      errLines.get(e.line).push(e.message);
    }
    let html = '';
    for (let i = 1; i <= lines; i++) {
      const msgs = errLines.get(i);
      html += msgs
        ? `<div class="gutter-line has-error" title="${msgs.join('\n').replace(/"/g, '&quot;')}">${i}</div>`
        : `<div class="gutter-line">${i}</div>`;
    }
    this.gutter.innerHTML = html;
    this.syncScroll();
  }

  syncScroll() {
    this.pre.scrollTop = this.ta.scrollTop;
    this.pre.scrollLeft = this.ta.scrollLeft;
    this.gutter.scrollTop = this.ta.scrollTop;
    if (this.completion) this.positionPopup();
  }

  // ---------- editing primitives (keep native undo when possible) ----------
  replaceRange(start, end, text, caret = start + text.length) {
    const ta = this.ta;
    ta.focus();
    ta.setSelectionRange(start, end);
    let ok = false;
    try { ok = document.execCommand('insertText', false, text); } catch { ok = false; }
    if (!ok) {
      ta.setRangeText(text, start, end, 'end');
      ta.dispatchEvent(new Event('input'));
    }
    ta.setSelectionRange(caret, caret);
  }

  insert(text) {
    const { selectionStart: s, selectionEnd: e } = this.ta;
    this.replaceRange(s, e, text);
  }

  jumpTo(offset, end = offset) {
    this.ta.focus();
    this.ta.setSelectionRange(offset, end);
    // Scroll the caret into view.
    const line = this.ta.value.slice(0, offset).split('\n').length - 1;
    const lh = parseFloat(getComputedStyle(this.ta).lineHeight) || 20;
    const top = line * lh;
    if (top < this.ta.scrollTop || top > this.ta.scrollTop + this.ta.clientHeight - 2 * lh) {
      this.ta.scrollTop = Math.max(0, top - this.ta.clientHeight / 2);
    }
  }

  // ---------- input handling ----------
  handleInput(e) {
    if (!this.applying && this.autoReplace && e.inputType === 'insertText') this.typingReplacement(e.data);
    this.updateCompletion();
    this.render();
    this.onChange?.(this.ta.value);
  }

  typingReplacement(typed) {
    const ta = this.ta;
    const pos = ta.selectionStart;
    const before = ta.value.slice(0, pos);
    // \name followed by a delimiter → symbol (the delimiter is kept)
    if (typed && /[^A-Za-z0-9_]/.test(typed)) {
      const m = /\\([A-Za-z]+|_[0-9])(.)$/.exec(before);
      if (m && LATEX.has(m[1]) && m[2] === typed) {
        const start = pos - m[0].length;
        this.applying = true;
        this.replaceRange(start, pos - 1, LATEX.get(m[1]), start + LATEX.get(m[1]).length + 1);
        this.applying = false;
        return;
      }
    }
    for (const [ascii, sym] of TYPING_REPLACEMENTS) {
      if (before.endsWith(ascii) && !this.inComment(before)) {
        this.applying = true;
        this.replaceRange(pos - ascii.length, pos, sym);
        this.applying = false;
        return;
      }
    }
  }

  inComment(before) {
    const line = before.slice(before.lastIndexOf('\n') + 1);
    return line.includes('#');
  }

  handleKey(e) {
    const ta = this.ta;
    if (this.completion) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = this.completion.items.length;
        this.completion.index = (this.completion.index + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
        this.renderCompletion();
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        this.acceptCompletion();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        this.closeCompletion();
        return;
      }
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      this.onRun?.();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      this.onSave?.();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === '/') {
      e.preventDefault();
      this.toggleComment();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) this.indentLines(-1);
      else if (ta.selectionStart !== ta.selectionEnd && ta.value.slice(ta.selectionStart, ta.selectionEnd).includes('\n')) this.indentLines(1);
      else this.insert('  ');
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      const pos = ta.selectionStart;
      const lineStart = ta.value.lastIndexOf('\n', pos - 1) + 1;
      const indent = /^[ \t]*/.exec(ta.value.slice(lineStart, pos))[0];
      this.insert('\n' + indent);
    }
  }

  selectedLines() {
    const ta = this.ta, v = ta.value;
    const start = v.lastIndexOf('\n', ta.selectionStart - 1) + 1;
    let end = v.indexOf('\n', Math.max(ta.selectionStart, ta.selectionEnd - 1));
    if (end < 0) end = v.length;
    return { start, end, text: v.slice(start, end) };
  }

  indentLines(dir) {
    const { start, end, text } = this.selectedLines();
    const out = text.split('\n').map((l) => (dir > 0 ? '  ' + l : l.replace(/^ {1,2}|^\t/, ''))).join('\n');
    this.replaceRange(start, end, out, start + out.length);
    this.ta.setSelectionRange(start, start + out.length);
  }

  toggleComment() {
    const { start, end, text } = this.selectedLines();
    const lines = text.split('\n');
    const all = lines.every((l) => /^\s*#/.test(l) || !l.trim());
    const out = lines.map((l) => (all ? l.replace(/^(\s*)# ?/, '$1') : l.trim() ? '# ' + l : l)).join('\n');
    this.replaceRange(start, end, out, start + out.length);
  }

  // ---------- \latex completion ----------
  updateCompletion() {
    const pos = this.ta.selectionStart;
    const m = /\\([A-Za-z]*)$/.exec(this.ta.value.slice(0, pos));
    if (!m || this.ta.selectionStart !== this.ta.selectionEnd) return this.closeCompletion();
    const prefix = m[1];
    const items = LATEX_NAMES.filter((n) => n.startsWith(prefix) && !n.startsWith('_')).slice(0, 12);
    if (!items.length) return this.closeCompletion();
    this.completion = { start: pos - m[0].length, prefix, items, index: 0 };
    this.renderCompletion();
  }

  renderCompletion() {
    const c = this.completion;
    this.popup.innerHTML = c.items.map((name, i) => {
      const sym = LATEX.get(name);
      const info = symbolInfo.get(sym);
      return `<li role="option" data-i="${i}" class="${i === c.index ? 'active' : ''}" aria-selected="${i === c.index}">
        <span class="completion-sym">${sym}</span><span class="completion-name">\\${name}</span>
        <span class="completion-desc">${info?.name ?? ''}</span></li>`;
    }).join('');
    this.popup.hidden = false;
    this.positionPopup();
  }

  positionPopup() {
    const ta = this.ta;
    const before = ta.value.slice(0, this.completion.start);
    const line = before.split('\n').length;
    const col = before.length - before.lastIndexOf('\n') - 1;
    const cs = getComputedStyle(ta);
    const lh = parseFloat(cs.lineHeight) || 20;
    const cw = this.charWidth ??= this.measureChar(cs);
    const x = parseFloat(cs.paddingLeft) + col * cw - ta.scrollLeft;
    const y = parseFloat(cs.paddingTop) + line * lh - ta.scrollTop + 2;
    this.popup.style.left = `${Math.max(0, Math.min(x, ta.clientWidth - 260))}px`;
    this.popup.style.top = `${y}px`;
  }

  measureChar(cs) {
    const span = document.createElement('span');
    span.style.font = cs.font;
    span.style.position = 'absolute';
    span.style.visibility = 'hidden';
    span.textContent = 'x'.repeat(50);
    document.body.appendChild(span);
    const w = span.getBoundingClientRect().width / 50;
    span.remove();
    return w || 8;
  }

  acceptCompletion() {
    const c = this.completion;
    if (!c) return;
    const sym = LATEX.get(c.items[c.index]);
    const end = this.ta.selectionStart;
    this.closeCompletion();
    this.applying = true;
    this.replaceRange(c.start, end, sym);
    this.applying = false;
  }

  closeCompletion() {
    this.completion = null;
    this.popup.hidden = true;
  }
}
