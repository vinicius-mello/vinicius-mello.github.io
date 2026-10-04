// Minimal WebGL layer: every pass draws one full-screen quad, and the
// fragment shaders do the geometry (see assets/shaders).

const SHADERS = {
  euclidean: 'euclidean.glsl',
  elliptic: 'elliptic.glsl',
  hyperbolic: 'hyperbolic.glsl',
  starfield: 'starfield.glsl',
  postprocess: 'postprocess.glsl',
};

const TEXTURES = {
  spaceship: 'spaceship.png',
  asteroid: 'bwAst.png',
  bigAsteroid: 'roundAst.png',
  laser: 'laser.png',
};

const shaderBase = new URL('../assets/shaders/', import.meta.url);
const textureBase = new URL('../assets/textures/', import.meta.url);

// Fetches a shader and splices in its #include "file" lines (the included
// files carry their own include guards).
const sourceCache = new Map();
function loadSource(url) {
  if (!sourceCache.has(url)) {
    sourceCache.set(url, fetch(url).then((response) => {
      if (!response.ok) throw new Error(`Could not load ${url}`);
      return response.text();
    }).then((text) => Promise.all(text.split(/\r?\n/).map((line) => {
      const match = line.match(/^\s*#include\s+"(.*?)"\s*$/);
      return match ? loadSource(new URL(match[1], url).href) : line;
    }))).then((lines) => lines.join('\n')));
  }
  return sourceCache.get(url);
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load ${url}`));
    image.src = url;
  });
}

class Program {
  constructor(gl, source, name) {
    this.gl = gl;
    this.prog = gl.createProgram();
    for (const type of ['VERTEX_SHADER', 'FRAGMENT_SHADER']) {
      const shader = gl.createShader(gl[type]);
      gl.shaderSource(shader, `#define ${type}\n${source}`);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(`${name} (${type}): ${gl.getShaderInfoLog(shader)}`);
      }
      gl.attachShader(this.prog, shader);
    }
    gl.linkProgram(this.prog);
    if (!gl.getProgramParameter(this.prog, gl.LINK_STATUS)) {
      throw new Error(`${name}: ${gl.getProgramInfoLog(this.prog)}`);
    }
    this.uniforms = new Map();
    this.position = gl.getAttribLocation(this.prog, 'aVertexPosition');
    this.texCoord = gl.getAttribLocation(this.prog, 'aTextureCoord');
  }

  uniform(name) {
    if (!this.uniforms.has(name)) {
      this.uniforms.set(name, this.gl.getUniformLocation(this.prog, name));
    }
    return this.uniforms.get(name);
  }

  // Unused uniforms are optimized away; their location is null and the
  // call is a no-op.
  set1f(name, x) {
    this.gl.uniform1f(this.uniform(name), x);
  }

  set2f(name, x, y) {
    this.gl.uniform2f(this.uniform(name), x, y);
  }
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', { antialias: false });
    if (!gl) throw new Error('WebGL is not available');
    this.gl = gl;

    // two triangles covering clip space: x, y, z, u, v
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      1, 1, 0, 1, 1, -1, 1, 0, 0, 1, -1, -1, 0, 0, 0,
      1, 1, 0, 1, 1, -1, -1, 0, 0, 0, 1, -1, 0, 1, 0,
    ]), gl.STATIC_DRAW);

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // the scene is rendered here, then drawn to the screen through FXAA
    this.fbo = gl.createFramebuffer();
    this.fboTexture = gl.createTexture();
  }

  async load() {
    const { gl } = this;
    const [sources, images] = await Promise.all([
      Promise.all(Object.values(SHADERS).map((file) => loadSource(new URL(file, shaderBase).href))),
      Promise.all(Object.values(TEXTURES).map((file) => loadImage(new URL(file, textureBase).href))),
    ]);
    this.programs = {};
    Object.keys(SHADERS).forEach((name, i) => {
      this.programs[name] = new Program(gl, sources[i], name);
    });
    this.textures = {};
    Object.keys(TEXTURES).forEach((name, i) => {
      this.textures[name] = this.createSpriteTexture(images[i]);
    });
  }

  createSpriteTexture(image) {
    const { gl } = this;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
    return texture;
  }

  // (Re)allocates the offscreen target when the canvas size changes.
  resize(width, height) {
    const { gl, canvas } = this;
    if (this.fboSize === `${width}x${height}`) return;
    canvas.width = width;
    canvas.height = height;
    gl.bindTexture(gl.TEXTURE_2D, this.fboTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fboTexture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.fboSize = `${width}x${height}`;
  }

  drawQuad(program, texture = null) {
    const { gl } = this;
    gl.useProgram(program.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(program.position);
    gl.vertexAttribPointer(program.position, 3, gl.FLOAT, false, 20, 0);
    if (program.texCoord >= 0) {
      gl.enableVertexAttribArray(program.texCoord);
      gl.vertexAttribPointer(program.texCoord, 2, gl.FLOAT, false, 20, 12);
    }
    if (texture) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  // scene: {time, geometry: name, bodies: [{q, p, dir, ts, inv, texture}]}
  render({ time, geometry, bodies }) {
    const { gl, canvas } = this;
    const { width, height } = canvas;
    gl.viewport(0, 0, width, height);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const stars = this.programs.starfield;
    gl.useProgram(stars.prog);
    stars.set1f('time', time);
    stars.set2f('resolution', width, height);
    this.drawQuad(stars);

    const shader = this.programs[geometry];
    gl.useProgram(shader.prog);
    for (const body of bodies) {
      shader.set2f('uq', body.q.x, body.q.y);
      shader.set2f('up', body.p.x, body.p.y);
      shader.set2f('udir', body.dir.x, body.dir.y);
      shader.set1f('texSize', body.ts);
      shader.set1f('inverted', body.inv);
      this.drawQuad(shader, body.texture);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clearColor(1, 1, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const post = this.programs.postprocess;
    gl.useProgram(post.prog);
    post.set2f('uViewportSize', width, height);
    this.drawQuad(post, this.fboTexture);
  }
}
