// Transições entre dois estados da fórmula (técnica FLIP).
// 1. capture(): antes de trocar o DOM, guarda o retângulo de cada data-key.
// 2. Depois de renderizar o novo estado, play() anima cada pedaço que
//    sobreviveu da posição antiga para a nova; pedaços novos aparecem com
//    fade e pedaços removidos somem como "fantasmas" na posição antiga.
// oldRoot precisa continuar no documento (invisível) durante play(), para
// que os fantasmas copiem fonte e cor.
// Translações de ancestrais se compõem com as dos descendentes, então cada
// elemento anima só o deslocamento relativo ao ancestral animado mais próximo.

const EASE = 'cubic-bezier(.45,.05,.25,1)';

export function capture(root) {
  const rects = new Map();
  for (const e of root.querySelectorAll('[data-key]')) {
    rects.set(e.dataset.key, e.getBoundingClientRect());
  }
  return rects;
}

export function finishAll(root) {
  for (const a of root.getAnimations({ subtree: true })) a.finish();
  root.querySelectorAll('.ghost-layer').forEach((g) => g.remove());
}

const keyedParent = (e, stop) => {
  for (let p = e.parentElement; p && p !== stop; p = p.parentElement) {
    if (p.dataset.key) return p;
  }
  return null;
};

const hasKeyedDescendantIn = (e, keys) =>
  [...e.querySelectorAll('[data-key]')].some((d) => keys.has(d.dataset.key));

// hints (opcional), produzidas pelas regras:
//   merge:  { to, from: [ids] }  removidos voam até o nó `to` antes de sumir
//   strike: [ids]                removidos são riscados antes de sumir
//   clones: { idNovo: idOrigem } cópias partem da posição do original
export function play({ stage, oldRoot, oldRects, newRoot, arcKey, duration, hints = {} }) {
  if (!oldRoot || duration <= 0) return;
  const clones = hints.clones ?? {};
  const oldRectOf = (key) => oldRects.get(key) ?? oldRects.get(clones[key]);
  const known = { has: (key) => !!oldRectOf(key) };
  const newKeys = new Set([...newRoot.querySelectorAll('[data-key]')].map((e) => e.dataset.key));
  const timing = { duration, easing: EASE, fill: 'backwards' };

  // Deslocamento absoluto de cada sobrevivente (ou cópia de um).
  const delta = new Map();
  for (const e of newRoot.querySelectorAll('[data-key]')) {
    const old = oldRectOf(e.dataset.key);
    if (!old) continue;
    const now = e.getBoundingClientRect();
    delta.set(e, { dx: old.left - now.left, dy: old.top - now.top, old, now });
  }

  for (const [e, d] of delta) {
    const anc = keyedParent(e, newRoot.parentElement);
    const a = (anc && delta.get(anc)) || { dx: 0, dy: 0 };
    const dx = d.dx - a.dx;
    const dy = d.dy - a.dy;
    const leaf = !e.querySelector('[data-key]');
    const sx = leaf && d.now.width > 0 ? d.old.width / d.now.width : 1;
    const sy = leaf && d.now.height > 0 ? d.old.height / d.now.height : 1;
    const scaled = Math.abs(sx - 1) > 0.02 || Math.abs(sy - 1) > 0.02;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && !scaled) continue;

    const from = `translate(${dx}px, ${dy}px)` + (scaled ? ` scale(${sx}, ${sy})` : '');
    const frames = [{ transform: from }];
    if (e.dataset.key === arcKey) {
      const lift = Math.max(d.now.height, 24) * 1.4;
      frames.push({ offset: 0.5, transform: `translate(${dx / 2}px, ${dy / 2 - lift}px)` });
    }
    frames.push({ transform: 'none' });
    e.style.transformOrigin = '0 0';
    e.animate(frames, timing);
  }

  // Pedaços novos: os mais externos que não contêm nada que sobreviveu.
  for (const e of newRoot.querySelectorAll('[data-key]')) {
    if (known.has(e.dataset.key) || hasKeyedDescendantIn(e, known)) continue;
    const anc = keyedParent(e, newRoot.parentElement);
    if (anc && !known.has(anc.dataset.key) && !hasKeyedDescendantIn(anc, known)) continue;
    e.animate(
      [{ opacity: 0, transform: 'scale(.85)' }, { opacity: 0, transform: 'scale(.85)', offset: 0.3 }, { opacity: 1, transform: 'none' }],
      { ...timing, easing: 'ease-out' },
    );
  }

  // Pedaços removidos: clones na posição antiga, sumindo.
  const layer = document.createElement('div');
  layer.className = 'ghost-layer';
  const base = stage.getBoundingClientRect();
  const mergeFrom = new Set(hints.merge?.from ?? []);
  const mergeTo = hints.merge && newRoot.querySelector(`[data-key="${hints.merge.to}"]`)?.getBoundingClientRect();
  const strike = new Set(hints.strike ?? []);
  // O próprio elemento ou algum ancestral está no conjunto?
  const within = (e, set) => {
    for (let x = e; x && x !== oldRoot; x = keyedParent(x, oldRoot)) {
      if (set.has(x.dataset.key)) return true;
    }
    return false;
  };

  for (const e of oldRoot.querySelectorAll('[data-key]')) {
    if (newKeys.has(e.dataset.key) || hasKeyedDescendantIn(e, newKeys)) continue;
    const anc = keyedParent(e, oldRoot.parentElement);
    if (anc && !newKeys.has(anc.dataset.key) && !hasKeyedDescendantIn(anc, newKeys)) continue;
    const r = oldRects.get(e.dataset.key);
    const g = e.cloneNode(true);
    g.removeAttribute('data-key');
    g.querySelectorAll('[data-key]').forEach((x) => x.removeAttribute('data-key'));
    g.classList.add('ghost');
    g.style.margin = '0';
    Object.assign(g.style, {
      left: `${r.left - base.left + stage.scrollLeft}px`,
      top: `${r.top - base.top + stage.scrollTop}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    });
    const cs = getComputedStyle(e);
    g.style.font = cs.font;
    g.style.color = cs.color;
    layer.append(g);

    if (mergeTo && within(e, mergeFrom)) {
      const dx = mergeTo.left + mergeTo.width / 2 - (r.left + r.width / 2);
      const dy = mergeTo.top + mergeTo.height / 2 - (r.top + r.height / 2);
      g.animate(
        [{ transform: 'none', opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) scale(.5)`, opacity: 0 }],
        { duration: duration * 0.8, easing: EASE, fill: 'forwards' },
      );
    } else if (within(e, strike)) {
      const line = document.createElement('span');
      line.className = 'strike';
      g.append(line);
      line.animate([{ transform: 'rotate(-12deg) scaleX(0)' }, { transform: 'rotate(-12deg) scaleX(1)' }], { duration: duration * 0.35, easing: 'ease-out', fill: 'forwards' });
      g.animate(
        [{ opacity: 1 }, { opacity: 1, offset: 0.5 }, { opacity: 0, transform: 'translateY(.3em)' }],
        { duration, easing: 'ease-in', fill: 'forwards' },
      );
    } else {
      g.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(.6)' }], { duration: duration * 0.5, easing: 'ease-in', fill: 'forwards' });
    }
  }
  // A desigualdade inverteu (multiplicou por negativo, trocou os lados): o
  // símbolo gira e pisca na cor de destaque.
  if (hints.flip) {
    // flip: id da relação (num sistema, qual das equações); true em arquivos antigos
    const sel = hints.flip === true ? '.relation > .op.rel' : `[data-key="${hints.flip}="]`;
    newRoot.querySelector(sel)?.animate(
      [
        { transform: 'rotateY(180deg) scale(1.3)', color: 'var(--accent)' },
        { transform: 'rotateY(90deg) scale(1.3)', color: 'var(--accent)', offset: 0.5 },
        { transform: 'none' },
      ],
      { duration: duration * 1.2, easing: EASE },
    );
  }

  if (layer.childElementCount) {
    stage.append(layer);
    setTimeout(() => layer.remove(), duration);
  }
}
