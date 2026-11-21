// Evaluation worker: owns the manifold-3d kernel. Keeps the solids of the last run
// alive so the UI can request meshes of other named objects on demand.
import { loadManifold, Kernel } from './geom/kernel.js';
import { run } from './lang/interpreter.js';
import { parse } from './lang/parser.js';
import { describe } from './lang/errors.js';

let kernel = null;
let last = null; // { objects: Map(name → solid) } of the last evaluated run

// A profile is drawn as a thin plate lying on z = 0; its stats give the area instead.
function meshPayload(solid, profile = null) {
  const mesh = kernel.toMesh(profile ? kernel.plate(profile) : solid);
  const box = mesh.triangleCount ? mesh.bbox() : null;
  if (box && profile) box.min[2] = box.max[2] = 0;
  return {
    mesh: { positions: mesh.positions, indices: mesh.indices },
    stats: profile ? { triangles: mesh.triangleCount, area: kernel.area2(profile), bbox: box, profile: true } : {
      triangles: mesh.triangleCount,
      volume: kernel.volume(solid),
      bbox: box,
      genus: kernel.genus(solid),
    },
    transfer: [mesh.positions.buffer, mesh.indices.buffer],
  };
}

async function handleRun({ id, source, quality }) {
  const wasm = await loadManifold();
  kernel ??= new Kernel(wasm);
  // Syntax errors: report them but keep the previous run's solids alive, so the
  // UI can keep showing (and exporting) the last good model.
  const parsed = parse(source);
  if (parsed.errors.length) {
    self.postMessage({ type: 'result', id, kept: true, errors: parsed.errors.map((e) => describe(source, e)) });
    return;
  }
  kernel.dispose(); // free the previous run's solids
  kernel.setQuality(quality);
  const t0 = performance.now();
  const result = run(source, kernel);
  const tEval = performance.now() - t0;
  const errors = result.errors.map((e) => describe(source, e));
  const transfer = [];
  const shows = [];
  for (const s of result.shows) {
    if (!s.solid && !s.profile) { shows.push({ label: s.label, text: s.text }); continue; }
    try {
      const p = meshPayload(s.solid, s.profile);
      transfer.push(...p.transfer);
      shows.push({ label: s.label, name: s.name, mesh: p.mesh, stats: p.stats });
    } catch (e) {
      errors.push({ message: `${s.label}: ${e.message}`, kind: 'error', start: null, line: null });
    }
  }
  last = { objects: new Map(result.objects.map((o) => [o.name, o.solid])) };
  self.postMessage({
    type: 'result',
    id,
    objects: result.objects.map((o) => o.name),
    values: result.values,
    shows,
    errors,
    time: { eval: tEval, total: performance.now() - t0 },
  }, transfer);
}

function handleMesh({ id, name }) {
  const solid = last?.objects.get(name);
  if (!solid) {
    self.postMessage({ type: 'mesh', id, name, error: `objeto '${name}' não encontrado` });
    return;
  }
  const p = meshPayload(solid);
  self.postMessage({ type: 'mesh', id, name, mesh: p.mesh, stats: p.stats }, p.transfer);
}

self.onmessage = async (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'run') await handleRun(msg);
    else if (msg.type === 'mesh') handleMesh(msg);
  } catch (err) {
    self.postMessage({
      type: msg.type === 'run' ? 'result' : 'mesh',
      id: msg.id,
      name: msg.name,
      fatal: true,
      errors: [{ message: `erro interno: ${err?.message ?? err}`, kind: 'error', start: null, line: null }],
      error: String(err?.message ?? err),
    });
  }
};

// Warm up the WASM module as soon as the worker starts.
loadManifold().then(() => self.postMessage({ type: 'ready' }), (err) => {
  self.postMessage({ type: 'ready', error: String(err?.message ?? err) });
});
