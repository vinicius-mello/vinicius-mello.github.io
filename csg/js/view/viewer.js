// Minimal WebGL2 viewer: orbit camera (Z up), flat shading, optional wireframe,
// print-bed grid and axes. Renders on demand.

const VS = `#version 300 es
in vec3 aPos;
in vec3 aNormal;
in vec3 aBary;
uniform mat4 uView, uProj;
out vec3 vNormal;
out vec3 vBary;
out vec3 vViewPos;
void main() {
  vec4 p = uView * vec4(aPos, 1.0);
  vViewPos = p.xyz;
  vNormal = mat3(uView) * aNormal;
  vBary = aBary;
  gl_Position = uProj * p;
}`;

const FS = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vBary;
in vec3 vViewPos;
uniform vec3 uColor;
uniform float uWire;
uniform vec3 uWireColor;
out vec4 outColor;
void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(-vViewPos);
  vec3 l1 = normalize(vec3(0.4, 0.6, 1.0));
  vec3 l2 = normalize(vec3(-0.6, -0.2, 0.3));
  float d = 0.55 * max(dot(n, l1), 0.0) + 0.25 * max(dot(n, l2), 0.0);
  float hemi = 0.5 + 0.5 * n.y;
  vec3 h = normalize(l1 + v);
  float spec = pow(max(dot(n, h), 0.0), 48.0) * 0.18;
  vec3 c = uColor * (0.28 + 0.12 * hemi + d) + vec3(spec);
  if (uWire > 0.5) {
    vec3 w = fwidth(vBary);
    vec3 a = smoothstep(vec3(0.0), w * 1.2, vBary);
    float edge = 1.0 - min(min(a.x, a.y), a.z);
    c = mix(c, uWireColor, edge * 0.85);
  }
  outColor = vec4(c, 1.0);
}`;

const LINE_VS = `#version 300 es
in vec3 aPos;
in vec4 aColor;
uniform mat4 uView, uProj;
out vec4 vColor;
void main() { vColor = aColor; gl_Position = uProj * uView * vec4(aPos, 1.0); }`;

const LINE_FS = `#version 300 es
precision highp float;
in vec4 vColor;
out vec4 outColor;
void main() { outColor = vColor; }`;

// ---------- small column-major matrix helpers ----------
function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
}
function ortho(halfW, halfH, near, far) {
  const nf = 1 / (near - far);
  return [1 / halfW, 0, 0, 0, 0, 1 / halfH, 0, 0, 0, 0, 2 * nf, 0, 0, 0, (far + near) * nf, 1];
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((x) => x / l); };
function lookAt(eye, target, up) {
  const z = norm(sub(eye, target));
  const x = norm(cross(up, z));
  const y = cross(z, x);
  return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1];
}

function hexToRgb(hex) {
  const v = parseInt(hex.replace('#', ''), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

function niceStep(x) {
  const p = 10 ** Math.floor(Math.log10(x));
  const m = x / p;
  return (m < 2 ? 1 : m < 5 ? 2 : 5) * p;
}

export class Viewer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: true });
    if (!gl) throw new Error('WebGL2 não está disponível neste navegador');
    this.gl = gl;
    this.meshProg = this.program(VS, FS);
    this.lineProg = this.program(LINE_VS, LINE_FS);
    this.items = []; // { vao, buffers, count, color, bbox }
    this.options = { wireframe: false, grid: true, axes: true, ortho: false };
    this.colors = { background: [0.95, 0.95, 0.96], grid: [0.5, 0.5, 0.55], wire: [0.1, 0.1, 0.12] };
    // Camera: spherical coordinates around target (Z up).
    this.cam = { target: [0, 0, 0], dist: 120, theta: -Math.PI / 3, phi: Math.PI / 5 };
    this.sceneRadius = 50;
    this.dirty = true;
    this.gridSize = 100;
    this.buildGrid();
    this.attachControls();
    new ResizeObserver(() => this.requestRender()).observe(canvas);
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  program(vsSrc, fsSrc) {
    const gl = this.gl;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const loc = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const name = gl.getActiveUniform(p, i).name;
      loc[name] = gl.getUniformLocation(p, name);
    }
    return { p, loc, attr: (name) => gl.getAttribLocation(p, name) };
  }

  setTheme({ background, grid, wire }) {
    if (background) this.colors.background = hexToRgb(background);
    if (grid) this.colors.grid = hexToRgb(grid);
    if (wire) this.colors.wire = hexToRgb(wire);
    this.buildGrid();
    this.requestRender();
  }

  setOptions(opts) {
    Object.assign(this.options, opts);
    this.requestRender();
  }

  // meshes: [{ positions: Float32Array (flat soup), normals, color: '#rrggbb', bbox }]
  setMeshes(meshes) {
    const gl = this.gl;
    for (const it of this.items) {
      gl.deleteVertexArray(it.vao);
      it.buffers.forEach((b) => gl.deleteBuffer(b));
    }
    this.items = meshes.map((m) => {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const count = m.positions.length / 3;
      const bary = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) bary[3 * i + (i % 3)] = 1;
      const buffers = [[m.positions, 'aPos'], [m.normals, 'aNormal'], [bary, 'aBary']].map(([data, name]) => {
        const b = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        const loc = this.meshProg.attr(name);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
        return b;
      });
      gl.bindVertexArray(null);
      return { vao, buffers, count, color: hexToRgb(m.color), bbox: m.bbox };
    });
    this.updateSceneBounds();
    this.requestRender();
  }

  sceneBox() {
    const boxes = this.items.map((i) => i.bbox).filter((b) => b && b.min.every(Number.isFinite));
    if (!boxes.length) return null;
    const min = [0, 1, 2].map((k) => Math.min(...boxes.map((b) => b.min[k])));
    const max = [0, 1, 2].map((k) => Math.max(...boxes.map((b) => b.max[k])));
    return { min, max };
  }

  updateSceneBounds() {
    const box = this.sceneBox();
    const extent = box ? Math.max(...box.max.map((v, k) => Math.max(Math.abs(v), Math.abs(box.min[k])))) : 50;
    const size = Math.max(100, niceStep(extent * 2.5) * 2);
    if (size !== this.gridSize) {
      this.gridSize = size;
      this.buildGrid();
    }
  }

  fit() {
    const box = this.sceneBox();
    if (!box) return;
    this.cam.target = box.min.map((v, k) => (v + box.max[k]) / 2);
    const r = Math.max(1, Math.hypot(...box.max.map((v, k) => v - box.min[k])) / 2);
    this.sceneRadius = r;
    this.cam.dist = r / Math.sin((40 * Math.PI) / 180 / 2) * (this.fitMargin ?? 1.1);
    this.requestRender();
  }

  setView(name) {
    const views = {
      iso: [-Math.PI / 3, Math.PI / 5],
      front: [-Math.PI / 2, 0],
      back: [Math.PI / 2, 0],
      right: [0, 0],
      left: [Math.PI, 0],
      top: [-Math.PI / 2, Math.PI / 2 - 1e-4],
      bottom: [-Math.PI / 2, -Math.PI / 2 + 1e-4],
    };
    [this.cam.theta, this.cam.phi] = views[name] ?? views.iso;
    this.fit();
  }

  buildGrid() {
    const gl = this.gl;
    const S = this.gridSize;
    const major = niceStep(S / 10), minor = major / 5;
    const g = this.colors.grid;
    const v = [];
    const line = (a, b, c) => v.push(...a, ...c, ...b, ...c);
    for (let x = -S; x <= S + 1e-9; x += minor) {
      const isMajor = Math.abs(x / major - Math.round(x / major)) < 1e-6;
      const c = [...g, isMajor ? 0.45 : 0.15];
      if (Math.abs(x) < 1e-9) continue; // axes drawn separately
      line([x, -S, 0], [x, S, 0], c);
      line([-S, x, 0], [S, x, 0], c);
    }
    this.gridData = new Float32Array(v);
    const L = S / 2;
    this.axesData = new Float32Array([
      0, 0, 0, 0.9, 0.2, 0.2, 1, L, 0, 0, 0.9, 0.2, 0.2, 1,
      0, 0, 0, 0.2, 0.7, 0.2, 1, 0, L, 0, 0.2, 0.7, 0.2, 1,
      0, 0, 0, 0.2, 0.4, 0.95, 1, 0, 0, L, 0.2, 0.4, 0.95, 1,
      -S, 0, 0, ...g, 0.45, 0, 0, 0, ...g, 0.45,
      0, -S, 0, ...g, 0.45, 0, 0, 0, ...g, 0.45,
    ]);
    const mk = (data) => {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      const pl = this.lineProg.attr('aPos'), cl = this.lineProg.attr('aColor');
      gl.enableVertexAttribArray(pl);
      gl.vertexAttribPointer(pl, 3, gl.FLOAT, false, 28, 0);
      gl.enableVertexAttribArray(cl);
      gl.vertexAttribPointer(cl, 4, gl.FLOAT, false, 28, 12);
      gl.bindVertexArray(null);
      return { vao, b, count: data.length / 7 };
    };
    if (this.grid) { gl.deleteVertexArray(this.grid.vao); gl.deleteBuffer(this.grid.b); }
    if (this.axes) { gl.deleteVertexArray(this.axes.vao); gl.deleteBuffer(this.axes.b); }
    this.grid = mk(this.gridData);
    this.axes = mk(this.axesData);
  }

  eye() {
    const { target, dist, theta, phi } = this.cam;
    return [
      target[0] + dist * Math.cos(phi) * Math.cos(theta),
      target[1] + dist * Math.cos(phi) * Math.sin(theta),
      target[2] + dist * Math.sin(phi),
    ];
  }

  matrices() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const aspect = w / Math.max(1, h);
    const eye = this.eye();
    const view = lookAt(eye, this.cam.target, [0, 0, 1]);
    const far = this.cam.dist * 4 + this.gridSize * 4;
    const near = Math.max(0.01, this.cam.dist / 1000);
    let proj;
    if (this.options.ortho) {
      const halfH = this.cam.dist * Math.tan((40 * Math.PI) / 180 / 2);
      proj = ortho(halfH * aspect, halfH, -far, far);
    } else {
      proj = perspective((40 * Math.PI) / 180, aspect, near, far);
    }
    return { view, proj };
  }

  requestRender() { this.dirty = true; }

  loop() {
    if (this.dirty) {
      this.dirty = false;
      this.render();
    }
    requestAnimationFrame(this.loop);
  }

  render() {
    const gl = this.gl, c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    gl.viewport(0, 0, w, h);
    gl.clearColor(...this.colors.background, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    const { view, proj } = this.matrices();

    const mp = this.meshProg;
    gl.useProgram(mp.p);
    gl.uniformMatrix4fv(mp.loc.uView, false, view);
    gl.uniformMatrix4fv(mp.loc.uProj, false, proj);
    gl.uniform1f(mp.loc.uWire, this.options.wireframe ? 1 : 0);
    gl.uniform3fv(mp.loc.uWireColor, this.colors.wire);
    // Manifold meshes are closed and consistently oriented: back faces are never visible.
    gl.enable(gl.CULL_FACE);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1, 1);
    for (const it of this.items) {
      gl.uniform3fv(mp.loc.uColor, it.color);
      gl.bindVertexArray(it.vao);
      gl.drawArrays(gl.TRIANGLES, 0, it.count);
    }
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.disable(gl.CULL_FACE);

    const lp = this.lineProg;
    gl.useProgram(lp.p);
    gl.uniformMatrix4fv(lp.loc.uView, false, view);
    gl.uniformMatrix4fv(lp.loc.uProj, false, proj);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    if (this.options.grid) {
      gl.bindVertexArray(this.grid.vao);
      gl.drawArrays(gl.LINES, 0, this.grid.count);
    }
    if (this.options.axes) {
      gl.bindVertexArray(this.axes.vao);
      gl.drawArrays(gl.LINES, 0, this.axes.count);
    }
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  // ---------- interaction ----------
  attachControls() {
    const c = this.canvas;
    const pointers = new Map();
    let mode = null, last = null, pinch = null;

    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
        mode = 'pinch';
      } else {
        mode = e.button === 2 || e.button === 1 || e.shiftKey ? 'pan' : 'orbit';
      }
      last = [e.clientX, e.clientY];
    });
    c.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      if (mode === 'pinch' && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        this.zoom(pinch.d / Math.max(1, d));
        this.pan(mid[0] - pinch.mid[0], mid[1] - pinch.mid[1]);
        pinch = { d, mid };
        return;
      }
      const dx = e.clientX - last[0], dy = e.clientY - last[1];
      last = [e.clientX, e.clientY];
      if (mode === 'orbit') {
        this.cam.theta -= dx * 0.008;
        this.cam.phi = Math.max(-Math.PI / 2 + 1e-3, Math.min(Math.PI / 2 - 1e-3, this.cam.phi + dy * 0.008));
        this.requestRender();
      } else if (mode === 'pan') {
        this.pan(dx, dy);
      }
    });
    const end = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size === 0) mode = null;
      else if (pointers.size === 1) { mode = 'orbit'; last = [...pointers.values()][0]; }
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoom(Math.exp(e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)));
    }, { passive: false });
    c.addEventListener('dblclick', () => this.fit());
  }

  zoom(factor) {
    this.cam.dist = Math.max(0.1, Math.min(1e5, this.cam.dist * factor));
    this.requestRender();
  }

  pan(dx, dy) {
    const { theta, phi } = this.cam;
    const right = [-Math.sin(theta), Math.cos(theta), 0];
    const up = [-Math.sin(phi) * Math.cos(theta), -Math.sin(phi) * Math.sin(theta), Math.cos(phi)];
    const scale = (2 * this.cam.dist * Math.tan((20 * Math.PI) / 180)) / Math.max(1, this.canvas.clientHeight);
    this.cam.target = this.cam.target.map((v, k) => v - right[k] * dx * scale + up[k] * dy * scale);
    this.requestRender();
  }
}
