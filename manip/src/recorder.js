// Gravação da apresentação em vídeo, com a voz do professor.
//
// O navegador captura a própria aba (getDisplayMedia), recortada na área da
// fórmula quando possível (Element Capture / Region Capture), e o microfone
// opcional entra como trilha de áudio. O roteiro toca sozinho (automático)
// ou avança com PgDn / Espaço / → (manual); Esc termina. O resultado é um
// MP4 onde o MediaRecorder suporta, ou WebM.
//
// O app entrega as funções de que o gravador precisa (api), para que este
// módulo não dependa dos detalhes de app.js.

import { t } from './i18n.js';

// Preferência: MP4 com áudio AAC (abre em qualquer editor), MP4 com Opus
// (o que o Chrome grava), qualquer MP4, e por fim WebM.
const MIME_TYPES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1.42E01E,opus',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function pickMimeType() {
  return MIME_TYPES.find((m) => globalThis.MediaRecorder?.isTypeSupported?.(m)) ?? '';
}

// Tempo para ler a nota de um passo: ~70 ms por caractere, entre 1,5 e 6 s.
export const readingTime = (note) => (note ? Math.min(6000, Math.max(1500, note.length * 70)) : 0);

export function createRecorder(api) {
  const { stage, toast } = api;
  let session = null;

  // ---------- painel de opções ----------

  function openDialog() {
    if (session) return;
    const steps = api.stepCount();
    const box = document.createElement('div');
    box.className = 'menu rec-dialog';
    box.setAttribute('role', 'dialog');
    box.innerHTML = `
      <h2>${t('rec.title')}</h2>
      <div class="rec-grid">
        <label>${t('rec.from')} <input type="number" name="from" min="1" max="${steps}" value="1"></label>
        <label>${t('rec.to')} <input type="number" name="to" min="1" max="${steps}" value="${steps}"></label>
        <label>${t('rec.advance')}
          <select name="advance">
            <option value="manual">${t('rec.manual')}</option>
            <option value="auto">${t('rec.auto')}</option>
          </select>
        </label>
        <label>${t('rec.pause')} <input type="number" name="pause" min="0" max="20" step="0.5" value="2"></label>
        <label>${t('rec.speed')}
          <select name="speed">
            <option value="1000">${t('ui.speed.slow')}</option>
            <option value="480">${t('ui.speed.normal')}</option>
          </select>
        </label>
        <label class="wide">${t('rec.titleCard')} <input type="text" name="title" placeholder="${t('rec.titlePh')}"></label>
      </div>
      <div class="rec-checks">
        <label><input type="checkbox" name="mic" checked> ${t('rec.mic')}</label>
        <label><input type="checkbox" name="notes" checked> ${t('rec.notes')}</label>
        <label><input type="checkbox" name="counter"> ${t('rec.counter')}</label>
        <label><input type="checkbox" name="board" checked> ${t('rec.board')}</label>
      </div>
      <p class="hint">${t('rec.hint')}</p>
      <div class="rec-actions">
        <button type="button" class="tool" data-act="cancel">${t('rec.cancel')}</button>
        <button type="button" class="tool primary" data-act="start">● ${t('rec.start')}</button>
      </div>`;
    const field = (n) => box.querySelector(`[name="${n}"]`);
    const sync = () => { field('pause').disabled = field('advance').value !== 'auto'; };
    field('advance').addEventListener('change', sync);
    sync();
    const close = () => { box.remove(); stage.focus(); };
    const start = () => {
      const opts = {
        from: clamp(Number(field('from').value) - 1, 0, steps - 1),
        to: clamp(Number(field('to').value) - 1, 0, steps - 1),
        advance: field('advance').value,
        pause: Number(field('pause').value) * 1000,
        speed: Number(field('speed').value),
        title: field('title').value.trim(),
        mic: field('mic').checked,
        notes: field('notes').checked,
        counter: field('counter').checked,
        board: field('board').checked,
      };
      if (opts.to < opts.from) [opts.from, opts.to] = [opts.to, opts.from];
      box.remove();
      record(opts);
    };
    box.addEventListener('click', (ev) => {
      const act = ev.target.closest('[data-act]')?.dataset.act;
      if (act === 'cancel') close();
      if (act === 'start') start();
    });
    box.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') { close(); ev.preventDefault(); }
      if (ev.key === 'Enter' && ev.target.tagName !== 'BUTTON') { start(); ev.preventDefault(); }
      ev.stopPropagation();
    });
    document.body.append(box);
    box.querySelector('[data-act="start"]').focus();
  }

  const clamp = (v, a, b) => Math.min(b, Math.max(a, Number.isFinite(v) ? v : a));

  // ---------- captura ----------

  async function captureStream(opts) {
    const display = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'browser', frameRate: 60 },
      audio: false,
      preferCurrentTab: true,
      selfBrowserSurface: 'include',
    });
    const [video] = display.getVideoTracks();
    // Só a área da fórmula: Element Capture (exclui o que estiver por cima)
    // ou, na falta dele, Region Capture (recorte retangular).
    try {
      if (globalThis.RestrictionTarget && video.restrictTo) {
        await video.restrictTo(await globalThis.RestrictionTarget.fromElement(stage));
      } else if (globalThis.CropTarget && video.cropTo) {
        await video.cropTo(await globalThis.CropTarget.fromElement(stage));
      }
    } catch { /* sem recorte: grava a aba inteira */ }
    const tracks = [video];
    let mic = null;
    if (opts.mic) {
      try {
        mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        tracks.push(...mic.getAudioTracks());
      } catch {
        toast(t('rec.noMic'));
      }
    }
    return { stream: new MediaStream(tracks), stop: () => [display, mic].forEach((s) => s?.getTracks().forEach((k) => k.stop())) };
  }

  // ---------- gravação ----------

  async function record(opts) {
    let capture;
    try {
      capture = await captureStream(opts);
    } catch {
      toast(t('rec.denied'));
      stage.focus();
      return;
    }
    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(capture.stream, mimeType ? { mimeType, videoBitsPerSecond: 8_000_000 } : {});
    const chunks = [];
    recorder.ondataavailable = (ev) => { if (ev.data.size) chunks.push(ev.data); };

    const restore = api.beginRecording(opts);
    const title = document.title;
    document.title = `● ${t('rec.recording')} — Manip`;
    document.body.classList.add('recording');
    document.body.classList.toggle('rec-no-notes', !opts.notes);
    document.body.classList.toggle('rec-no-counter', !opts.counter);
    document.body.classList.toggle('rec-no-board', !opts.board);
    api.goTo(opts.from, false);

    let stopRequested = false;
    let advance = null; // resolve do "próximo passo" no modo manual
    const finished = new Promise((resolve) => {
      session = {
        stop() { stopRequested = true; advance?.(); resolve(); },
        next() { advance?.(); },
      };
    });
    capture.stream.getVideoTracks()[0].addEventListener('ended', () => session?.stop());

    const done = new Promise((resolve) => { recorder.onstop = resolve; });
    // Um respiro para a página se acomodar depois da janela de permissão.
    await sleep(600);
    recorder.start(1000);

    if (opts.title) await showTitleCard(opts.title);
    await play(opts, () => stopRequested, (f) => { advance = f; });
    if (!stopRequested) await sleep(Math.max(1200, opts.pause));
    session?.stop();
    await finished;

    recorder.stop();
    await done;
    capture.stop();
    session = null;
    document.title = title;
    document.body.classList.remove('recording', 'rec-no-notes', 'rec-no-counter', 'rec-no-board');
    restore();

    const type = recorder.mimeType || mimeType || 'video/webm';
    const blob = new Blob(chunks, { type });
    const ext = type.includes('mp4') ? 'mp4' : 'webm';
    api.saveBlob(blob, `manip-${new Date().toISOString().slice(0, 10)}.${ext}`);
    toast(t('rec.saved', { ext: ext.toUpperCase(), s: Math.round(blob.size / 1e5) / 10 }));
  }

  // Toca o roteiro: no modo automático, pausa → animação → leitura da nota;
  // no manual, espera o professor avançar.
  async function play(opts, stopped, setAdvance) {
    const note = () => api.currentNote();
    if (opts.advance === 'auto') await sleep(opts.pause + (opts.notes ? readingTime(note()) : 0));
    for (let i = opts.from + 1; i <= opts.to && !stopped(); i++) {
      if (opts.advance === 'manual') {
        await new Promise((r) => setAdvance(r));
        if (stopped()) break;
      }
      api.goTo(i, true);
      if (opts.advance === 'auto') {
        await sleep(opts.speed * 1.3 + opts.pause + (opts.notes ? readingTime(note()) : 0));
      }
    }
    if (opts.advance === 'manual' && !stopped()) {
      // último passo na tela: espera o professor encerrar (Esc ou avançar)
      await new Promise((r) => setAdvance(r));
    }
  }

  async function showTitleCard(text) {
    const card = document.createElement('div');
    card.className = 'title-card';
    card.textContent = text;
    stage.append(card);
    await sleep(2800);
    card.classList.add('out');
    await sleep(500);
    card.remove();
  }

  // Teclas durante a gravação: avançar ou encerrar.
  document.addEventListener('keydown', (ev) => {
    if (!session) return;
    if (ev.key === 'Escape') session.stop();
    else if (['PageDown', ' ', 'ArrowRight', 'Enter'].includes(ev.key)) session.next();
    else return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
  }, true);

  return { openDialog, isRecording: () => !!session };
}
