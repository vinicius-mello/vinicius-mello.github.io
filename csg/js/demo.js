// Demo mode: plays a tutorial script (demo/<id>.txt) inside the real app — typing in the
// editor, evaluating, moving the camera, highlighting parts of the screen and showing captions.
//
//   index.html?demo=01-primeiro-solido            plays in real time (preview)
//   index.html?demo=01-primeiro-solido&record=1   waits for tools/record-demo.mjs, which calls
//                                                 demo.next() and films one discrete step at a time
//
// Script syntax: one directive per line, "nome: argumento". Blank lines and lines starting
// with "//" are ignored.
//   título: Lição 1 | O primeiro sólido    title card (title | subtitle)
//   tópico: A tela                          topic shown above the captions; becomes a chapter
//   legenda: texto                          caption; holds long enough to be read ("-" hides it)
//   digitar: texto                          types the text (then evaluates, like "Avaliar ao digitar");
//                                           ␣ stands for a space at the start or end of the text, ↵ for a new line
//   cursor: início|fim|texto                puts the caret at the start, the end, or right after texto
//   enter                                   new line
//   apagar: n                               n backspaces
//   direita: n                              moves the caret n characters to the right
//   selecionar: texto                       selects the first occurrence of texto in the editor
//   destacar: editor|view|palette|objects|output|status|menu   spotlight ("-" removes it)
//   vista: iso|top|front|right|...          animates the camera to a standard view
//   girar: graus [segundos]                 orbits the camera around the vertical axis
//   pausa: segundos
//   velocidade: 2                           typing speed factor (1 = normal)
//   limpar                                  empties the editor
//   avaliar                                 evaluates now
//   trilha: a.mid b.mid …                   soundtrack, used only by tools/record-demo.mjs
//   paleta: ⟨                               "clicks" that symbol in the palette
//   clicar: Arquivo                         clicks the button with that text (or a CSS selector)

const TARGETS = {
  editor: '#editor', view: '.view-pane', palette: '#palette', objects: '#objects',
  output: '#output', status: '.statusbar', menu: '.menubar',
};

const FRAME = 1000 / 30;

// Caption text → HTML: `code` in the editor's font; math symbols too, so that ∖ never looks like \.
const SYMS = /([≔⊢↦∪∩∖△⊕⋃⋂∅∈∉∘·×⁻¹⟨⟩Σ∏√°πτ∞≠≤≥∧∨¬θαφ]+)/g;
const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
function captionHTML(text) {
  return text.split('`').map((part, i) => (i % 2
    ? `<code>${escapeHtml(part)}</code>`
    : escapeHtml(part).replace(SYMS, '<span class="demo-sym">$1</span>'))).join('');
}

export function parseScript(text) {
  const steps = [];
  text.split('\n').forEach((raw, i) => {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim() || line.trim().startsWith('//')) return;
    const m = /^\s*([\p{L}-]+)\s*(?::\s?(.*))?$/u.exec(line);
    if (!m) throw new Error(`roteiro, linha ${i + 1}: não entendi "${line}"`);
    steps.push({ op: m[1].normalize('NFC').toLowerCase(), arg: m[2] ?? '', line: i + 1 });
  });
  return steps;
}

// Deterministic pseudo-random typing rhythm (same video every time).
function rng(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
const settle = async () => { await nextFrame(); await nextFrame(); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);

export class Demo {
  constructor(app, steps, { record = false } = {}) {
    this.app = app;
    this.steps = steps;
    this.record = record;
    this.t = 0;             // virtual time (ms) of the current frame
    this.cues = [];         // captions: { start, end, text }
    this.chapters = [];     // topics:   { start, text }
    this.random = rng(7);
    this.speed = 1;         // typing speed factor (velocidade: 2 types twice as fast)
    this.topic = '';
    this.buildOverlay();
    if (app.viewer) app.viewer.fitMargin = 1.8; // room around the model on a narrow pane
    document.querySelector('#workspace')?.style.setProperty('--editor-width', '50%');
    this.log = [];          // evaluations that ended with errors: { line, errors }
    this.gen = this.run();
    this.ready = true;
  }

  buildOverlay() {
    document.body.classList.add('demo-mode');
    if (this.record) document.body.classList.add('demo-record');
    const o = document.createElement('div');
    o.className = 'demo-overlay';
    o.innerHTML = `
      <div class="demo-spot" hidden></div>
      <div class="demo-caption" hidden><div class="demo-topic"></div><div class="demo-text"></div></div>
      <div class="demo-title" hidden><div class="demo-brand">∪ ∩ ∖ &nbsp;CSG</div><h1></h1><p></p></div>`;
    document.body.append(o);
    this.el = {
      spot: o.querySelector('.demo-spot'),
      caption: o.querySelector('.demo-caption'),
      topic: o.querySelector('.demo-topic'),
      text: o.querySelector('.demo-text'),
      title: o.querySelector('.demo-title'),
    };
  }

  // One discrete step: mutate the page, wait until it is drawn, return how long (ms) the
  // resulting frame stays on screen. null when the script is over.
  async next() {
    const r = await this.gen.next();
    if (r.done) {
      this.endCue();
      return null;
    }
    await settle();
    this.t += r.value;
    return r.value;
  }

  async play() {
    for (let ms = await this.next(); ms != null; ms = await this.next()) await sleep(ms);
  }

  async *run() {
    this.app.editor.value = '';
    await this.app.runAndWait();
    yield 400;
    for (const [i, s] of this.steps.entries()) {
      this.current = s;
      this.following = this.steps[i + 1];
      const fn = this[`op_${s.op.normalize('NFD').replace(/\p{M}/gu, '')}`];
      if (!fn) throw new Error(`roteiro, linha ${s.line}: comando desconhecido "${s.op}"`);
      yield* fn.call(this, s.arg.trim(), s);
    }
    this.hideSpot();
    yield 1500;
  }

  // ---------- captions and cards ----------
  endCue() {
    if (this.cue) {
      this.cue.end = this.t;
      this.cues.push(this.cue);
      this.cue = null;
    }
  }

  *op_titulo(arg) {
    const [title, subtitle = ''] = arg.split('|').map((s) => s.trim());
    this.el.title.querySelector('h1').textContent = title;
    this.el.title.querySelector('p').textContent = subtitle;
    this.el.title.hidden = false;
    yield 3500;
    this.el.title.hidden = true;
    yield 300;
  }

  *op_topico(arg) {
    this.topic = arg;
    this.chapters.push({ start: this.t, text: arg });
    this.el.topic.textContent = arg;
  }

  *op_legenda(arg) {
    this.endCue();
    if (arg === '-' || !arg) {
      this.el.caption.hidden = true;
      return;
    }
    this.el.text.innerHTML = captionHTML(arg);
    this.el.topic.textContent = this.topic;
    this.el.caption.hidden = false;
    this.placeCaption();
    this.cue = { start: this.t, text: arg.replaceAll('`', '') };
    // reading time: ~15 characters per second, between 2 and 6 s
    yield Math.min(6000, Math.max(2000, arg.length * 65));
  }

  *op_trilha() { /* the recorder renders and mixes the soundtrack */ }

  *op_velocidade(arg) {
    this.speed = Math.max(0.25, Number(arg.replace(',', '.')) || 1);
  }

  *op_pausa(arg) {
    yield Math.max(0, Number(arg.replace(',', '.')) || 1) * 1000;
  }

  // ---------- spotlight ----------
  *op_destacar(arg) {
    if (arg === '-' || !arg) {
      this.hideSpot();
      yield FRAME;
      return;
    }
    const target = document.querySelector(TARGETS[arg] ?? arg);
    if (!target) throw new Error(`destacar: não encontrei "${arg}"`);
    const r = target.getBoundingClientRect();
    const pad = 6;
    Object.assign(this.el.spot.style, {
      left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + 2 * pad}px`, height: `${r.height + 2 * pad}px`,
    });
    this.el.spot.hidden = false;
    this.placeCaption();
    yield 600;
  }

  hideSpot() {
    this.el.spot.hidden = true;
    this.placeCaption();
  }

  // Captions sit at the bottom; if that covers the highlighted region, at the top; if that
  // covers it too (a tall region, like the whole editor), beside it, on the other half of the screen.
  placeCaption() {
    const cap = this.el.caption;
    cap.classList.remove('demo-caption-top', 'demo-caption-left', 'demo-caption-right');
    if (cap.hidden || this.el.spot.hidden) return;
    const spot = this.el.spot.getBoundingClientRect();
    const covers = () => {
      const a = cap.getBoundingClientRect();
      return a.left < spot.right && spot.left < a.right && a.top < spot.bottom && spot.top < a.bottom;
    };
    if (!covers()) return;
    cap.classList.add('demo-caption-top');
    if (!covers()) return;
    cap.classList.remove('demo-caption-top');
    cap.classList.add((spot.left + spot.right) / 2 < innerWidth / 2 ? 'demo-caption-right' : 'demo-caption-left');
  }


  // ---------- editor ----------
  *op_cursor(arg) {
    arg = arg.replaceAll('↵', '\n').replaceAll('␣', ' ');
    const ed = this.app.editor;
    const v = ed.value;
    let pos;
    if (arg === 'início' || arg === 'inicio') pos = 0;
    else if (arg === 'fim') pos = v.length;
    else {
      const i = v.indexOf(arg);
      if (i < 0) throw new Error(`cursor: "${arg}" não está no editor: ${JSON.stringify(v)}`);
      pos = i + arg.length;
    }
    ed.jumpTo(pos);
    yield 300;
  }

  async *op_digitar(arg) {
    const ed = this.app.editor;
    for (const ch of arg.replaceAll('␣', ' ').replaceAll('↵', '\n')) {
      // Like a real key press: insert at the caret and let the editor's own handlers
      // (automatic replacements, \latex completion) move it.
      ed.ta.focus();
      if (!document.execCommand('insertText', false, ch)) ed.insert(ch);
      yield (ch === ' ' ? 90 + 60 * this.random() : 55 + 45 * this.random()) / this.speed;
    }
    if (!this.continuesTyping()) yield* this.evaluate(450);
  }

  *op_enter() {
    this.app.editor.ta.focus();
    if (!document.execCommand('insertText', false, '\n')) this.app.editor.insert('\n');
    yield 250;
  }

  async *op_apagar(arg) {
    const ed = this.app.editor;
    for (let i = 0; i < (Number(arg) || 1); i++) {
      const { selectionStart: s, selectionEnd: e } = ed.ta;
      ed.replaceRange(s === e ? Math.max(0, s - 1) : s, e, '');
      yield 70;
    }
  }

  *op_direita(arg) {
    const ed = this.app.editor;
    const p = Math.min(ed.value.length, ed.ta.selectionEnd + (Number(arg) || 1));
    ed.jumpTo(p);
    yield 150;
  }

  *op_selecionar(arg) {
    arg = arg.replaceAll('↵', '\n').replaceAll('␣', ' ');
    const ed = this.app.editor;
    const i = ed.value.indexOf(arg);
    if (i < 0) throw new Error(`selecionar: "${arg}" não está no editor`);
    ed.jumpTo(i, i + arg.length);
    yield 900;
  }

  async *op_limpar() {
    this.app.editor.value = '';
    await this.app.runAndWait();
    yield 400;
  }

  async *op_avaliar() {
    yield* this.evaluate(0);
  }

  async *evaluate(delay) {
    if (delay) yield delay; // the editor's "evaluate while typing" pause
    await this.app.runAndWait();
    const errors = this.app.state.errors;
    if (errors.length) this.log.push({ line: this.current?.line, errors: errors.map((e) => e.message) });
    yield 300;
  }

  // The next step goes on writing the same thing: don't evaluate a half-written line.
  continuesTyping() {
    return ['digitar', 'paleta', 'direita'].includes(this.following?.op);
  }

  // ---------- palette and buttons ----------
  *press(button) {
    button.classList.add('demo-press');
    yield 350;
    button.click();
    button.classList.remove('demo-press');
    yield 300;
  }

  async *op_paleta(arg) {
    const b = document.querySelector(`#palette button[data-sym="${arg}"]`);
    if (!b) throw new Error(`paleta: não há o símbolo "${arg}"`);
    yield* this.press(b);
    if (!this.continuesTyping()) yield* this.evaluate(450);
  }

  async *op_clicar(arg) {
    const b = [...document.querySelectorAll('button, a')].find((x) => x.textContent.trim() === arg)
      ?? document.querySelector(arg);
    if (!b) throw new Error(`clicar: não encontrei "${arg}"`);
    yield* this.press(b);
  }

  // ---------- camera ----------
  *animateCamera(theta1, phi1, ms) {
    const cam = this.app.viewer?.cam;
    if (!cam) return;
    const theta0 = cam.theta, phi0 = cam.phi;
    const n = Math.max(1, Math.round(ms / FRAME));
    for (let k = 1; k <= n; k++) {
      const u = ease(k / n);
      cam.theta = theta0 + (theta1 - theta0) * u;
      cam.phi = phi0 + (phi1 - phi0) * u;
      this.app.viewer.requestRender();
      yield FRAME;
    }
  }

  *op_vista(arg) {
    const views = {
      iso: [-Math.PI / 3, Math.PI / 5], front: [-Math.PI / 2, 0.05], right: [0, 0.05],
      top: [-Math.PI / 2, Math.PI / 2 - 1e-3], low: [-Math.PI / 3, 0.05],
    };
    const v = views[arg] ?? views.iso;
    yield* this.animateCamera(v[0], v[1], 1200);
  }

  *op_girar(arg) {
    const [deg, secs = '3'] = arg.split(/\s+/);
    const cam = this.app.viewer?.cam;
    if (!cam) return;
    yield* this.animateCamera(cam.theta + (Number(deg) * Math.PI) / 180, cam.phi, Number(secs) * 1000);
  }
}

export async function startDemo(app, id, { record = false } = {}) {
  const res = await fetch(`demo/${encodeURIComponent(id)}.txt`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`roteiro demo/${id}.txt não encontrado`);
  app.demo = true;
  const demo = new Demo(app, parseScript(await res.text()), { record });
  window.demo = demo;
  if (!record) demo.play().catch((e) => console.error(e));
  return demo;
}
