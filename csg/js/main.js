// Application controller: wires editor, evaluation worker, viewer and menus.
import { Editor } from './editor/editor.js';
import { Viewer } from './view/viewer.js';
import { Mesh } from './geom/mesh.js';
import { toBinarySTL, toAsciiSTL } from './io/stl.js';
import { SYMBOLS } from './lang/symbols.js';
import { createPrelude } from './lang/builtins.js';
import { EXAMPLES, DEFAULT_EXAMPLE } from './examples.js';
import { helpHTML } from './help.js';

const QUALITY = {
  draft: { minAngle: 12, minEdge: 2 },
  normal: { minAngle: 6, minEdge: 0.5 },
  fine: { minAngle: 3, minEdge: 0.2 },
};
const COLORS = ['#5b8def', '#ef8a5b', '#56b97f', '#c47ade', '#e3c04f', '#4fc3c9', '#e8728f'];
const NEW_PROGRAM = '# novo modelo\n\nA ≔ cube(10)\n\n⊢ A\n';

const $ = (sel) => document.querySelector(sel);
const fmt = (x, d = 1) => x.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

// ---------- persistence (best effort) ----------
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(`csg.${key}`); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(`csg.${key}`, JSON.stringify(value)); } catch { /* storage unavailable */ }
  },
};

const settings = {
  autoRun: true, autoReplace: true, palette: true,
  grid: true, axes: true, wireframe: false, ortho: false,
  theme: 'system', quality: 'normal',
  ...store.get('settings', {}),
};
const saveSettings = () => { if (!window.app?.demo) store.set('settings', settings); }; // tutorials never change the user's preferences

// ---------- worker ----------
class Runner {
  constructor(onMessage) {
    this.onMessage = onMessage;
    this.nextId = 1;
    this.pendingMeshes = new Map();
    this.spawn();
  }
  spawn() {
    this.worker?.terminate();
    for (const { reject } of this.pendingMeshes.values()) reject(new Error('avaliação reiniciada'));
    this.pendingMeshes.clear();
    this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => this.receive(e.data);
    this.worker.onerror = (e) => {
      e.preventDefault();
      this.busy = null;
      this.onMessage({ type: 'crash', message: e.message || 'falha ao iniciar o worker' });
    };
    this.busy = null;
  }
  run(source, quality) {
    if (this.busy) {
      // Short runs are queued; long ones are cancelled by restarting the worker.
      if (performance.now() - this.busy.since > 1000) this.spawn();
      else { this.queued = { source, quality }; return; }
    }
    const id = this.nextId++;
    this.busy = { id, since: performance.now() };
    this.worker.postMessage({ type: 'run', id, source, quality });
    this.onMessage({ type: 'started', id });
  }
  mesh(name) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pendingMeshes.set(id, { resolve, reject });
      this.worker.postMessage({ type: 'mesh', id, name });
    });
  }
  receive(msg) {
    if (msg.type === 'mesh') {
      const p = this.pendingMeshes.get(msg.id);
      this.pendingMeshes.delete(msg.id);
      if (!p) return;
      if (msg.error) p.reject(new Error(msg.error));
      else p.resolve(msg);
      return;
    }
    if (msg.type === 'result') {
      if (!this.busy || msg.id !== this.busy.id) return;
      this.busy = null;
      this.onMessage(msg);
      if (this.queued) {
        const q = this.queued;
        this.queued = null;
        this.run(q.source, q.quality);
      }
      return;
    }
    this.onMessage(msg);
  }
}

// ---------- application ----------
class App {
  constructor() {
    this.state = { objects: [], shows: [], values: [], errors: [], time: null };
    this.meshes = new Map(); // key → { mesh: Mesh, flat, stats }
    this.userShown = new Set();
    this.userHidden = new Set();
    this.selected = null;
    this.lastVisibleSignature = null;
    this.fileName = store.get('fileName', 'modelo');

    const prelude = createPrelude();
    this.editor = new Editor($('#editor'), {
      builtins: new Set(Object.keys(prelude)),
      onChange: (src) => this.changed(src),
      onRun: () => this.run(),
      onSave: () => this.saveProgram(),
    });
    this.editor.autoReplace = settings.autoReplace;
    const example = EXAMPLES.find((e) => e.id === DEFAULT_EXAMPLE);
    this.editor.value = store.get('source', example.source);

    try {
      this.viewer = new Viewer($('#view'));
    } catch (e) {
      this.viewer = null;
      this.viewMessage(`Visualização indisponível: ${e.message}`);
    }
    this.applyTheme();
    this.viewer?.setOptions({ grid: settings.grid, axes: settings.axes, wireframe: settings.wireframe, ortho: settings.ortho });

    this.runner = new Runner((msg) => this.workerMessage(msg));
    this.buildPalette();
    this.buildExamplesMenu();
    this.bindMenus();
    this.bindSplitter();
    this.bindKeys();
    this.syncMenuChecks();
    this.updateCursor();
    this.run();
  }

  // ---------- evaluation ----------
  changed(src) {
    if (this.demo) { this.updateCursor(); return; } // a tutorial script drives evaluation; never overwrite the user's program
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => store.set('source', src), 400);
    this.updateCursor();
    if (settings.autoRun) {
      clearTimeout(this.runTimer);
      this.runTimer = setTimeout(() => this.run(), 450);
    }
  }

  run() {
    clearTimeout(this.runTimer);
    this.runner.run(this.editor.value, QUALITY[settings.quality] ?? QUALITY.normal);
  }

  // Evaluate and resolve once the result is on screen (used by the tutorial player).
  runAndWait() {
    return new Promise((resolve) => {
      (this.resultWaiters ??= []).push(resolve);
      this.run();
    });
  }

  flushWaiters() {
    if (this.runner.queued) return; // a newer run (the one being waited for) is still to come
    const ws = this.resultWaiters ?? [];
    this.resultWaiters = [];
    for (const w of ws) w();
  }

  workerMessage(msg) {
    switch (msg.type) {
      case 'ready':
        if (msg.error) this.setStatus(`kernel geométrico indisponível: ${msg.error}`, 'error');
        break;
      case 'started':
        clearTimeout(this.busyTimer);
        this.busyTimer = setTimeout(() => { $('#busy').hidden = false; }, 200);
        this.setStatus('avaliando…');
        break;
      case 'crash':
        clearTimeout(this.busyTimer);
        $('#busy').hidden = true;
        this.setStatus(`erro no worker: ${msg.message}`, 'error');
        this.viewMessage('Não foi possível carregar o kernel geométrico. Sirva a pasta por HTTP (por exemplo, python3 -m http.server) e recarregue.');
        break;
      case 'result':
        clearTimeout(this.busyTimer);
        $('#busy').hidden = true;
        this.applyResult(msg);
        break;
    }
  }

  applyResult(msg) {
    this.state.errors = msg.errors ?? [];
    this.editor.setErrors(this.state.errors);
    if (msg.kept) {
      // Syntax errors: the worker kept the last good model; keep showing it.
      this.renderOutput();
      this.setStatus(this.errorSummary(), 'error');
      this.flushWaiters();
      return;
    }
    this.state.objects = msg.objects ?? [];
    this.state.values = msg.values ?? [];
    this.state.shows = msg.shows ?? [];
    this.state.time = msg.time;
    this.meshes.clear();
    for (const s of this.state.shows) {
      if (!s.mesh) continue;
      this.cacheMesh(this.showKey(s), s.mesh, s.stats);
    }
    const keys = this.allKeys();
    if (!keys.includes(this.selected)) this.selected = this.visibleKeys()[0] ?? keys[0] ?? null;
    this.ensureVisibleMeshes();
    this.renderAll();
    if (this.state.errors.length) this.setStatus(this.errorSummary(), 'error');
    else this.setStatus(`✓ avaliado em ${fmt(msg.time?.total ?? 0, 0)} ms`, 'ok');
    this.flushWaiters();
  }

  errorSummary() {
    const n = this.state.errors.length;
    return `✗ ${n} erro${n > 1 ? 's' : ''}`;
  }

  cacheMesh(key, mesh, stats) {
    const m = Mesh.from(mesh);
    this.meshes.set(key, { mesh: m, flat: m.toFlatArrays(), stats });
  }

  showKey(s) { return s.name ?? `⊢ ${s.label}`; }

  // Named objects first, then unnamed ⊢ expressions.
  allKeys() {
    const keys = [...this.state.objects];
    for (const s of this.state.shows) if (s.mesh && !keys.includes(this.showKey(s))) keys.push(this.showKey(s));
    return keys;
  }

  visibleKeys() {
    const all = this.allKeys();
    const shown = this.state.shows.filter((s) => s.mesh).map((s) => this.showKey(s));
    return all.filter((k) => (shown.includes(k) && !this.userHidden.has(k)) || this.userShown.has(k));
  }

  async ensureVisibleMeshes() {
    const missing = this.visibleKeys().filter((k) => !this.meshes.has(k) && this.state.objects.includes(k));
    if (!missing.length) return;
    await Promise.all(missing.map((k) => this.fetchMesh(k).catch(() => null)));
    this.renderAll();
  }

  async fetchMesh(key) {
    if (this.meshes.has(key)) return this.meshes.get(key);
    const msg = await this.runner.mesh(key);
    this.cacheMesh(key, msg.mesh, msg.stats);
    return this.meshes.get(key);
  }

  // ---------- rendering ----------
  renderAll() {
    this.renderObjects();
    this.renderOutput();
    this.renderView();
    this.renderStats();
  }

  colorOf(key) {
    const i = this.allKeys().indexOf(key);
    return COLORS[(i < 0 ? 0 : i) % COLORS.length];
  }

  renderView() {
    if (!this.viewer) return;
    const visible = this.visibleKeys().filter((k) => this.meshes.has(k));
    this.viewer.setMeshes(visible.map((k) => {
      const m = this.meshes.get(k);
      return { ...m.flat, color: this.colorOf(k), bbox: m.stats?.bbox ?? m.mesh.bbox() };
    }));
    const signature = visible.join('\u0000');
    if (signature !== this.lastVisibleSignature) {
      this.lastVisibleSignature = signature;
      this.viewer.fit();
    }
    const empty = !visible.length;
    if (empty) {
      const msg = this.state.errors.length ? 'Corrija os erros para ver o modelo.' : 'Nada para exibir. Defina um sólido, por exemplo  A ≔ cube(10).';
      this.viewMessage(msg);
    } else if (visible.every((k) => this.meshes.get(k).stats?.triangles === 0)) {
      this.viewMessage('O resultado é o conjunto vazio ∅.');
    } else {
      this.viewMessage(null);
    }
  }

  renderObjects() {
    const panel = $('#objects');
    const keys = this.allKeys();
    const visible = new Set(this.visibleKeys());
    if (!keys.length && !this.state.values.length) { panel.innerHTML = ''; return; }
    const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    let html = '';
    if (keys.length) {
      html += '<h3>Objetos</h3>';
      for (const k of keys) {
        const vis = visible.has(k);
        html += `<div class="obj${k === this.selected ? ' selected' : ''}${vis ? '' : ' hidden-obj'}" data-key="${esc(k)}" title="Clique para selecionar">
          <span class="swatch" style="background:${vis ? this.colorOf(k) : 'transparent'};border:1px solid ${this.colorOf(k)}"></span>
          <span class="name">${esc(k)}</span>
          <button data-obj-action="toggle" aria-pressed="${vis}" title="${vis ? 'Ocultar' : 'Exibir'}">${vis ? '◉' : '○'}</button>
          ${this.meshes.get(k)?.stats?.profile
            ? '<span class="obj-kind" title="Perfil plano: use extrude ou revolve para imprimir">perfil</span>'
            : `<button data-obj-action="stl" title="Exportar ${esc(k)} como STL">STL</button>`}
        </div>`;
      }
    }
    if (this.state.values.length) {
      html += '<h3>Valores</h3><div class="values">';
      for (const v of this.state.values) html += `<div title="${esc(`${v.name} = ${v.text}`)}">${esc(v.name)} = ${esc(v.text)}</div>`;
      html += '</div>';
    }
    panel.innerHTML = html;
  }

  renderOutput() {
    const out = $('#output');
    const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
    let html = '';
    for (const [i, e] of this.state.errors.entries()) {
      const where = e.line != null ? `${e.line}:${e.col}` : '';
      html += `<div class="row err" data-error="${i}"><span class="where">${where}</span><span class="value">${esc(e.message)}</span></div>`;
    }
    for (const s of this.state.shows) {
      if (s.text == null) continue;
      html += `<div class="row"><span class="label">⊢ ${esc(s.label)} =</span><span class="value">${esc(s.text)}</span></div>`;
    }
    out.innerHTML = html;
  }

  renderStats() {
    const el = $('#stats');
    const m = this.selected && this.meshes.get(this.selected);
    if (!m?.stats) { el.textContent = this.selected ? `${this.selected}` : ''; return; }
    const { triangles, volume, bbox } = m.stats;
    const dims = bbox ? bbox.max.map((v, k) => v - bbox.min[k]) : [0, 0, 0];
    if (m.stats.profile) {
      el.textContent = `${this.selected} · perfil · ${dims.slice(0, 2).map((d) => fmt(d)).join(' × ')} mm · área ${fmt(m.stats.area / 100, 2)} cm²`;
      return;
    }
    el.textContent = `${this.selected} · ${triangles.toLocaleString('pt-BR')} triângulos · ${dims.map((d) => fmt(d)).join(' × ')} mm · ${fmt(volume / 1000, 2)} cm³`;
  }

  setStatus(text, kind = '') {
    const el = $('#status');
    el.textContent = text;
    el.className = `status ${kind}`;
  }

  viewMessage(text) {
    const el = $('#view-message');
    el.hidden = !text;
    el.textContent = text ?? '';
  }

  updateCursor() {
    const ta = this.editor.ta;
    const before = ta.value.slice(0, ta.selectionStart);
    const line = before.split('\n').length;
    const col = before.length - before.lastIndexOf('\n');
    $('#cursor').textContent = `Ln ${line}, Col ${col}`;
  }

  // ---------- objects panel actions ----------
  async toggleVisible(key) {
    const visible = this.visibleKeys().includes(key);
    if (visible) { this.userShown.delete(key); this.userHidden.add(key); }
    else { this.userHidden.delete(key); this.userShown.add(key); }
    this.renderAll();
    if (!visible) await this.ensureVisibleMeshes();
  }

  async select(key) {
    this.selected = key;
    this.renderObjects();
    this.renderStats();
    if (!this.meshes.has(key) && this.state.objects.includes(key)) {
      try { await this.fetchMesh(key); } catch { /* reported on export */ }
      this.renderStats();
    }
  }

  // ---------- files ----------
  download(name, data, type) {
    const blob = new Blob([data], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  fileSafe(key) {
    return key.startsWith('⊢') ? 'modelo' : key.replace(/[^\p{L}\p{N}_-]+/gu, '_') || 'modelo';
  }

  async exportSTL(key = this.selected, ascii = false) {
    if (!key) { this.setStatus('nenhum objeto selecionado para exportar', 'error'); return; }
    try {
      const { mesh, stats } = await this.fetchMesh(key);
      if (stats?.profile) { this.setStatus(`'${key}' é um perfil (plano): para imprimir, use extrude ou revolve`, 'error'); return; }
      if (!mesh.triangleCount) { this.setStatus(`'${key}' é vazio; nada a exportar`, 'error'); return; }
      const name = `${this.fileSafe(key)}.stl`;
      if (ascii) this.download(name, toAsciiSTL(mesh, this.fileSafe(key)), 'model/stl');
      else this.download(name, toBinarySTL(mesh, `csg-dsl ${key}`), 'model/stl');
      this.setStatus(`exportado ${name} (${mesh.triangleCount.toLocaleString('pt-BR')} triângulos)`, 'ok');
    } catch (e) {
      this.setStatus(`falha ao exportar '${key}': ${e.message}`, 'error');
    }
  }

  async exportAll() {
    for (const k of this.visibleKeys()) await this.exportSTL(k);
  }

  saveProgram() {
    this.download(`${this.fileName}.csg`, this.editor.value, 'text/plain;charset=utf-8');
    this.setStatus(`programa salvo como ${this.fileName}.csg`, 'ok');
  }

  openProgram() {
    const input = $('#file-input');
    input.value = '';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      const text = await file.text();
      this.fileName = file.name.replace(/\.[^.]+$/, '') || 'modelo';
      store.set('fileName', this.fileName);
      this.replaceProgram(text);
    };
    input.click();
  }

  replaceProgram(text) {
    this.userShown.clear();
    this.userHidden.clear();
    this.lastVisibleSignature = null;
    this.editor.replaceRange(0, this.editor.value.length, text, 0);
    this.editor.ta.scrollTop = 0;
    this.run();
  }

  // ---------- UI construction ----------
  buildPalette() {
    const el = $('#palette');
    const groups = new Map();
    const skip = new Set(['⟩', '⌋', '⌉']);
    for (const s of SYMBOLS) {
      if (skip.has(s.sym)) continue;
      if (!groups.has(s.group)) groups.set(s.group, []);
      groups.get(s.group).push(s);
    }
    const pairs = { '⟨': '⟩', '⌊': '⌋', '⌈': '⌉' };
    el.innerHTML = [...groups].map(([g, list]) => `<div class="palette-group" role="group" aria-label="${g}">${list.map((s) => {
      const label = pairs[s.sym] ? s.sym + pairs[s.sym] : s.sym;
      const tip = `${s.name} — \\${s.latex[0]}${s.ascii.length ? `  ·  ${s.ascii[0]}` : ''}`;
      return `<button data-sym="${s.sym}" title="${tip}" aria-label="${s.name}">${label}</button>`;
    }).join('')}</div>`).join('');
    el.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-sym]');
      if (!b) return;
      const sym = b.dataset.sym;
      if (pairs[sym]) {
        const ta = this.editor.ta;
        const { selectionStart: s, selectionEnd: t } = ta;
        const inner = ta.value.slice(s, t);
        this.editor.replaceRange(s, t, sym + inner + pairs[sym], s + 1 + inner.length);
      } else {
        const spaced = '∪∩∖△⊕∈∉∘·×≔↦≠≤≥∧∨'.includes(sym);
        const ta = this.editor.ta;
        const prev = ta.value[ta.selectionStart - 1];
        this.editor.insert(spaced ? `${prev && prev !== ' ' && prev !== '\n' ? ' ' : ''}${sym} ` : sym);
      }
      this.editor.focus();
    });
    el.hidden = !settings.palette;
  }

  buildExamplesMenu() {
    $('#examples-menu').innerHTML = EXAMPLES.map((e) => `<button role="menuitem" data-example="${e.id}">${e.title}</button>`).join('');
  }

  bindMenus() {
    const roots = [...document.querySelectorAll('.menu-root')];
    const closeAll = () => roots.forEach((r) => {
      r.querySelector('.menu').hidden = true;
      r.querySelector('.menu-button').setAttribute('aria-expanded', 'false');
    });
    const open = (r) => {
      closeAll();
      r.querySelector('.menu').hidden = false;
      r.querySelector('.menu-button').setAttribute('aria-expanded', 'true');
    };
    for (const r of roots) {
      const btn = r.querySelector('.menu-button');
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (r.querySelector('.menu').hidden) open(r); else closeAll();
      });
      btn.addEventListener('mouseenter', () => {
        if (roots.some((x) => !x.querySelector('.menu').hidden)) open(r);
      });
    }
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.menu-root') || e.target.closest('.menu a')) closeAll();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });

    document.body.addEventListener('click', (e) => {
      const t = e.target.closest('[data-action],[data-setting],[data-view],[data-quality],[data-theme-choice],[data-example],[data-obj-action],.obj,.output .err');
      if (!t) return;
      if (t.closest('.menu')) closeAll();
      if (t.dataset.action) return this.action(t.dataset.action);
      if (t.dataset.setting) return this.toggleSetting(t.dataset.setting);
      if (t.dataset.view) return this.viewer?.setView(t.dataset.view);
      if (t.dataset.quality) { settings.quality = t.dataset.quality; saveSettings(); this.syncMenuChecks(); return this.run(); }
      if (t.dataset.themeChoice) { settings.theme = t.dataset.themeChoice; saveSettings(); this.syncMenuChecks(); return this.applyTheme(); }
      if (t.dataset.example) {
        const ex = EXAMPLES.find((x) => x.id === t.dataset.example);
        this.fileName = ex.id;
        return this.replaceProgram(ex.source);
      }
      if (t.dataset.objAction) {
        const key = t.closest('.obj').dataset.key;
        e.stopPropagation();
        return t.dataset.objAction === 'toggle' ? this.toggleVisible(key) : this.exportSTL(key);
      }
      if (t.classList.contains('obj')) return this.select(t.dataset.key);
      if (t.dataset.error != null) {
        const err = this.state.errors[Number(t.dataset.error)];
        if (err?.start != null) this.editor.jumpTo(err.start, err.end ?? err.start);
      }
    });
  }

  action(name) {
    switch (name) {
      case 'run': return this.run();
      case 'new': this.fileName = 'modelo'; return this.replaceProgram(NEW_PROGRAM);
      case 'open': return this.openProgram();
      case 'save': return this.saveProgram();
      case 'export-stl': return this.exportSTL(this.selected, false);
      case 'export-stl-ascii': return this.exportSTL(this.selected, true);
      case 'export-all': return this.exportAll();
      case 'undo': this.editor.focus(); return document.execCommand('undo');
      case 'redo': this.editor.focus(); return document.execCommand('redo');
      case 'comment': return this.editor.toggleComment();
      case 'fit': return this.viewer?.fit();
      case 'help': return this.openHelp();
    }
  }

  toggleSetting(key) {
    settings[key] = !settings[key];
    saveSettings();
    this.syncMenuChecks();
    if (key === 'autoReplace') this.editor.autoReplace = settings.autoReplace;
    if (key === 'palette') $('#palette').hidden = !settings.palette;
    if (['grid', 'axes', 'wireframe', 'ortho'].includes(key)) this.viewer?.setOptions({ [key]: settings[key] });
    if (key === 'autoRun' && settings.autoRun) this.run();
  }

  syncMenuChecks() {
    document.querySelectorAll('[data-setting]').forEach((b) => b.setAttribute('aria-checked', String(!!settings[b.dataset.setting])));
    document.querySelectorAll('[data-quality]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.quality === settings.quality)));
    document.querySelectorAll('[data-theme-choice]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.themeChoice === settings.theme)));
  }

  applyTheme() {
    const root = document.documentElement;
    if (settings.theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = settings.theme;
    const cs = getComputedStyle(root);
    this.viewer?.setTheme({
      background: cs.getPropertyValue('--view-bg').trim(),
      grid: cs.getPropertyValue('--view-grid').trim(),
      wire: cs.getPropertyValue('--view-wire').trim(),
    });
  }

  openHelp() {
    const dlg = $('#help');
    const content = $('#help-content');
    if (!content.innerHTML) content.innerHTML = helpHTML();
    if (!dlg.open) dlg.showModal();
  }

  bindSplitter() {
    const sp = $('#splitter');
    const ws = $('#workspace');
    const saved = store.get('split', null);
    const vertical = () => window.matchMedia('(max-width: 800px)').matches;
    if (saved) ws.style.setProperty(vertical() ? '--editor-height' : '--editor-width', `${saved}%`);
    sp.addEventListener('pointerdown', (e) => {
      sp.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const r = ws.getBoundingClientRect();
        const pct = vertical() ? ((ev.clientY - r.top) / r.height) * 100 : ((ev.clientX - r.left) / r.width) * 100;
        const v = Math.max(15, Math.min(85, pct));
        ws.style.setProperty(vertical() ? '--editor-height' : '--editor-width', `${v}%`);
        store.set('split', v);
        this.viewer?.requestRender();
      };
      const up = () => { sp.removeEventListener('pointermove', move); sp.removeEventListener('pointerup', up); };
      sp.addEventListener('pointermove', move);
      sp.addEventListener('pointerup', up);
    });
    sp.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const cur = parseFloat(getComputedStyle(ws).getPropertyValue('--editor-width')) || 44;
      const v = Math.max(15, Math.min(85, cur + (e.key === 'ArrowLeft' ? -3 : 3)));
      ws.style.setProperty('--editor-width', `${v}%`);
      store.set('split', v);
    });
  }

  bindKeys() {
    const ta = this.editor.ta;
    ['keyup', 'click', 'select'].forEach((ev) => ta.addEventListener(ev, () => this.updateCursor()));
    document.addEventListener('keydown', (e) => {
      if (e.defaultPrevented) return; // already handled by the editor
      if (e.key === 'F1') { e.preventDefault(); this.openHelp(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); this.run(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); this.saveProgram(); return; }
      const typing = e.target.closest?.('textarea, input');
      if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'f') this.viewer?.fit();
    });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.applyTheme());
  }
}

window.app = new App();

// Tutorial player: index.html?demo=<roteiro>[&record=1] (see js/demo.js).
const demoParams = new URLSearchParams(location.search);
if (demoParams.has('demo')) {
  import('./demo.js')
    .then((m) => m.startDemo(window.app, demoParams.get('demo'), { record: demoParams.has('record') }))
    .catch((e) => { window.demoError = e.message; window.app.setStatus(`demo: ${e.message}`, 'error'); });
}
