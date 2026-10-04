import { Complex } from './complex.js';
import { geometries } from './geometry.js';
import { SpaceShip, Asteroid, Bullet, Saucer } from './entities.js';
import { Renderer } from './renderer.js';
import { drawGluing } from './gluing.js';
import { drawSaucer, drawEnemyLaser } from './sprites.js';

const KEY_ACTIONS = {
  ArrowUp: 'thrust', KeyW: 'thrust',
  ArrowDown: 'reverse', KeyS: 'reverse',
  ArrowLeft: 'rotateLeft', KeyA: 'rotateLeft',
  ArrowRight: 'rotateRight', KeyD: 'rotateRight',
  Space: 'fire',
};

const TICK = 1 / 60;          // longest physics step (s)
const MAX_FRAME = 0.25;       // longest frame simulated at once (e.g. after a hiccup)
const FIRE_COOLDOWN = 0.12;   // s between shots while fire is held
const SHIELD_TIME = 1.5;      // s of invulnerability after a hit or a new wave
const SAUCER_SCORE = 50;
const SAUCER_MIN_DISTANCE = 1;  // saucers appear at least this far from the ship
const TOUCH_DEADZONE = 20;    // CSS px a steering touch must move before it acts
const LAYOUT_SIZE = 768;      // HUD sizes are given for a canvas this wide
const MAX_PIXELS = 1536;      // cap on the drawing buffer size (hi-dpi)

const CAPTIONS = {
  euclidean: 'Flat torus. Leave through one edge and you come back through the '
    + 'opposite one: edges of the same color are glued.',
  elliptic: 'Projective plane, curvature +1. Antipodal points of the circle are '
    + 'glued (same colors). Crossing it mirrors you: the surface is non-orientable.',
  hyperbolic: 'Genus-2 surface, curvature −1. Opposite sides of the octagon '
    + '(same colors) are glued; eight octagons meet at each corner.',
};

function randomVelocity(min, max) {
  return Complex.polar(min + Math.random() * (max - min), Math.random() * 2 * Math.PI);
}

// localStorage may be unavailable (private mode, blocked storage)
function loadBest(geometry) {
  try {
    return parseInt(localStorage.getItem(`nes-best-${geometry}`), 10) || 0;
  } catch {
    return 0;
  }
}

function saveBest(geometry, score) {
  try {
    localStorage.setItem(`nes-best-${geometry}`, score);
  } catch {
    // not persisted, that's fine
  }
}

// In place, so arrays shared with other objects stay valid.
function removeWhere(array, pred) {
  for (let i = array.length - 1; i >= 0; i--) {
    if (pred(array[i])) array.splice(i, 1);
  }
}

class Game {
  constructor(renderer, hud, ui) {
    this.renderer = renderer;
    this.textures = {
      ...renderer.textures,
      saucer: renderer.createSpriteTexture(drawSaucer()),
      enemyLaser: renderer.createSpriteTexture(drawEnemyLaser()),
    };
    this.hud = hud;
    this.ui = ui;
    this.keys = {};      // action -> held, from the keyboard
    this.touches = {};   // pointer id -> {fire, x0, y0, x, y}
    this.showGluing = ui.showGluing.checked;
    this.fps = 0;
    this.restart(ui.selectedGeometry());
  }

  restart(geometry) {
    this.geometry = geometries[geometry] ?? geometries.euclidean;
    this.spaceShip = new SpaceShip(this);
    this.bullets = [];
    this.enemyBullets = [];
    this.saucer = null;
    this.saucerTimer = 15;   // s of game time until the first saucer
    this.asteroids = [];
    this.time = 0;
    this.lastFireTime = -Infinity;
    this.best = loadBest(this.geometry.name);
    this.newRecord = false;
    this.state = 'playing';
    this.newWave();
    this.ui.caption.textContent = CAPTIONS[this.geometry.name];
  }

  // --- input -------------------------------------------------------------

  bindEvents() {
    window.addEventListener('keydown', (event) => this.onKeyDown(event));
    window.addEventListener('keyup', (event) => this.onKeyUp(event));
    window.addEventListener('blur', () => this.pause());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pause();
    });

    const stage = this.hud.canvas;
    stage.addEventListener('pointerdown', (event) => this.onPointerDown(event));
    stage.addEventListener('pointermove', (event) => this.onPointerMove(event));
    for (const type of ['pointerup', 'pointercancel']) {
      stage.addEventListener(type, (event) => delete this.touches[event.pointerId]);
    }

    for (const radio of this.ui.geometryRadios) {
      radio.addEventListener('change', () => {
        this.restart(radio.value);
        radio.blur();   // so the arrow keys steer the ship, not the radio group
      });
    }
    this.ui.showGluing.addEventListener('change', () => {
      this.showGluing = this.ui.showGluing.checked;
      this.ui.showGluing.blur();
    });
  }

  onKeyDown(event) {
    if (event.code === 'KeyP' || event.code === 'Escape') {
      this.togglePause();
    } else if (event.code === 'Enter') {
      if (this.state === 'gameover') this.restart(this.geometry.name);
    } else if (KEY_ACTIONS[event.code]) {
      this.keys[KEY_ACTIONS[event.code]] = true;
    } else {
      return;
    }
    event.preventDefault();
  }

  onKeyUp(event) {
    if (KEY_ACTIONS[event.code]) {
      this.keys[KEY_ACTIONS[event.code]] = false;
      event.preventDefault();
    }
  }

  // Left half of the screen is a virtual joystick (drag from where the finger
  // landed: sideways to turn, up to thrust, down to reverse); right half fires.
  // A tap also resumes a paused game and restarts after game over.
  onPointerDown(event) {
    if (event.pointerType === 'mouse') {
      if (this.state !== 'playing') this.onTap();
      return;
    }
    event.preventDefault();
    if (this.state !== 'playing') {
      this.onTap();
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    this.touches[event.pointerId] = { fire: x > rect.width / 2, x0: x, y0: y, x, y };
  }

  onPointerMove(event) {
    const touch = this.touches[event.pointerId];
    if (!touch) return;
    const rect = event.currentTarget.getBoundingClientRect();
    touch.x = event.clientX - rect.left;
    touch.y = event.clientY - rect.top;
  }

  onTap() {
    if (this.state === 'gameover') this.restart(this.geometry.name);
    else if (this.state === 'paused') this.state = 'playing';
  }

  pause() {
    if (this.state === 'playing') this.state = 'paused';
    // key/touch releases are lost while the window is unfocused
    this.keys = {};
    this.touches = {};
  }

  togglePause() {
    if (this.state === 'paused') this.state = 'playing';
    else this.pause();
  }

  currentActions() {
    const actions = { ...this.keys };
    for (const t of Object.values(this.touches)) {
      if (t.fire) {
        actions.fire = true;
        continue;
      }
      const dx = t.x - t.x0;
      const dy = t.y - t.y0;
      if (dx < -TOUCH_DEADZONE) actions.rotateLeft = true;
      if (dx > TOUCH_DEADZONE) actions.rotateRight = true;
      if (dy < -TOUCH_DEADZONE) actions.thrust = true;
      if (dy > TOUCH_DEADZONE) actions.reverse = true;
    }
    return actions;
  }

  // --- simulation --------------------------------------------------------

  // Each frame is split into equal substeps of at most TICK, so motion
  // advances by exactly the frame time, whatever the display's refresh rate.
  advance(dt) {
    if (this.state === 'paused') return;
    const n = Math.ceil(dt / TICK);
    for (let i = 0; i < n; i++) this.tick(dt / n);
  }

  tick(h) {
    this.time += h;
    for (const asteroid of this.asteroids) asteroid.update(h);
    // after game over the asteroids keep drifting behind the message
    if (this.state === 'gameover') return;
    this.handleInput(h);
    for (const bullet of this.bullets) bullet.update(h);
    removeWhere(this.bullets, (b) => b.faded);
    this.spaceShip.update(h);
    this.updateSaucer(h);
    this.checkCollisions();
  }

  handleInput(h) {
    const actions = this.currentActions();
    const ship = this.spaceShip;
    ship.steer((actions.rotateLeft ? 1 : 0) - (actions.rotateRight ? 1 : 0), h);
    if (actions.thrust) ship.thrust(h);
    if (actions.reverse) ship.reverse(h);
    if (actions.fire) this.fire();
  }

  fire() {
    if (this.time - this.lastFireTime < FIRE_COOLDOWN) return;
    this.bullets.push(new Bullet(this, this.spaceShip.q, this.spaceShip.dir));
    this.lastFireTime = this.time;
  }

  updateSaucer(h) {
    for (const bullet of this.enemyBullets) bullet.update(h);
    removeWhere(this.enemyBullets, (b) => b.faded);
    if (this.saucer) {
      const shot = this.saucer.update(h, this.spaceShip.q);
      if (shot) this.enemyBullets.push(shot);
      if (this.saucer.gone) {
        this.saucer = null;
        // they come back sooner in later waves
        this.saucerTimer = 10 + Math.random() * 10 - Math.min(this.spaceShip.wave, 6);
      }
    } else {
      this.saucerTimer -= h;
      if (this.saucerTimer <= 0) this.spawnSaucer();
    }
  }

  // somewhere random, but not on top of the ship
  spawnSaucer() {
    const { distance, spawnRadius, name } = this.geometry;
    for (let tries = 0; tries < 30; tries++) {
      const q = name === 'euclidean'
        ? new Complex((Math.random() * 2 - 1) * spawnRadius, (Math.random() * 2 - 1) * spawnRadius)
        : Complex.polar(spawnRadius * Math.sqrt(Math.random()), Math.random() * 2 * Math.PI);
      if (distance(q, this.spaceShip.q) > SAUCER_MIN_DISTANCE) {
        this.saucer = new Saucer(this, q, this.spaceShip.wave);
        return;
      }
    }
    this.saucerTimer = 1;   // try again soon
  }

  checkCollisions() {
    const { distance } = this.geometry;
    const ship = this.spaceShip;

    for (const asteroid of this.asteroids) {
      for (const bullet of this.bullets) {
        if (bullet.faded || !(distance(asteroid.q, bullet.q) < asteroid.radius)) continue;
        bullet.faded = true;
        asteroid.hp -= 1;
        ship.score += 1;
        if (asteroid.hp <= 0) {
          ship.score += 10;
          break;
        }
      }
    }
    removeWhere(this.bullets, (b) => b.faded);
    const destroyed = this.asteroids.filter((a) => a.hp <= 0);
    removeWhere(this.asteroids, (a) => a.hp <= 0);
    for (const old of destroyed) {
      if (!old.initial) continue;
      for (let i = 0; i < 2; i++) {
        this.asteroids.push(new Asteroid(this, old.q, randomVelocity(0.2, 0.45), false));
      }
    }
    if (this.asteroids.length === 0) this.newWave();

    const { saucer } = this;
    if (saucer) {
      for (const bullet of this.bullets) {
        if (saucer.hp > 0 && distance(saucer.q, bullet.q) < saucer.radius) {
          bullet.faded = true;
          saucer.hp -= 1;
          if (saucer.hp <= 0) ship.score += SAUCER_SCORE;
        }
      }
      removeWhere(this.bullets, (b) => b.faded);
    }

    if (ship.shield > 0) return;
    const shot = this.enemyBullets.find((b) => distance(b.q, ship.q) < ship.radius);
    if (shot) shot.faded = true;
    const rammed = saucer && saucer.hp > 0 && distance(saucer.q, ship.q) < saucer.radius + ship.radius;
    if (rammed) saucer.hp = 0;
    if (shot || rammed || this.asteroids.some((a) => distance(a.q, ship.q) < a.radius + ship.radius)) {
      this.shipHit();
    }
  }

  shipHit() {
    const ship = this.spaceShip;
    ship.hp -= 1;
    if (ship.hp > 0) ship.respawn(SHIELD_TIME);
    else this.gameOver();
  }

  gameOver() {
    this.state = 'gameover';
    this.bullets.length = 0;
    this.enemyBullets.length = 0;
    this.saucer = null;
    if (this.spaceShip.score > this.best) {
      this.best = this.spaceShip.score;
      this.newRecord = true;
      saveBest(this.geometry.name, this.best);
    }
  }

  addAsteroid() {
    // initial position won't be near the center
    const coord = () => (Math.random() < 0.5 ? -1 : 1) * (Math.random() * 0.2 + 0.4);
    this.asteroids.push(new Asteroid(this, { x: coord(), y: coord() }, randomVelocity(0.15, 0.35), true));
  }

  newWave() {
    const ship = this.spaceShip;
    ship.wave += 1;
    for (let i = 0; i < ship.wave; i++) this.addAsteroid();
    // the ship may be anywhere when the new asteroids appear
    if (ship.wave > 1) ship.shield = SHIELD_TIME;
  }

  // --- drawing -----------------------------------------------------------

  // Matches the drawing buffers to the displayed size (times the pixel ratio).
  resize() {
    const rect = this.hud.canvas.getBoundingClientRect();
    const size = Math.min(MAX_PIXELS, Math.round(rect.width * (window.devicePixelRatio || 1)));
    if (size > 0) {
      this.renderer.resize(size, size);
      if (this.hud.canvas.width !== size) {
        this.hud.canvas.width = size;
        this.hud.canvas.height = size;
      }
    }
  }

  render() {
    const ship = this.spaceShip;
    const bodies = [...this.asteroids, ...this.bullets, ...this.enemyBullets];
    if (this.saucer) bodies.push(this.saucer);
    // the ship is hidden after game over and blinks while the shield is up
    if (this.state !== 'gameover' && Math.floor(ship.shield * 8) % 2 === 0) bodies.push(ship);
    this.renderer.render({ time: this.time, geometry: this.geometry.name, bodies });
    this.drawHud();
  }

  drawHud() {
    const { hud } = this;
    const { width: w, height: h } = hud.canvas;
    const s = w / LAYOUT_SIZE;
    const font = (size, bold = false) => `${bold ? 'bold ' : ''}${Math.round(size * s)}px sans-serif`;
    const ship = this.spaceShip;
    hud.clearRect(0, 0, w, h);
    if (this.showGluing) drawGluing(hud, this.geometry.name, s);

    hud.globalAlpha = 0.9;
    hud.fillStyle = '#e0a458';
    hud.font = font(16, true);
    hud.textAlign = 'left';
    hud.fillText(`Lives: ${Math.max(ship.hp, 0)}`, 15 * s, 25 * s);
    hud.textAlign = 'right';
    hud.fillText(`Score: ${ship.score}`, w - 15 * s, 25 * s);
    hud.fillText(`Wave: ${ship.wave}`, w - 15 * s, h - 15 * s);
    hud.font = font(14);
    hud.fillText(`Best: ${Math.max(this.best, ship.score)}`, w - 15 * s, 45 * s);
    hud.textAlign = 'left';
    hud.fillStyle = '#888';
    hud.font = font(12);
    hud.fillText(`${this.fps} FPS`, 15 * s, h - 15 * s);

    if (ship.shield > 0 && this.state === 'playing') {
      hud.textAlign = 'center';
      hud.fillStyle = '#7fc8ff';
      hud.font = font(16, true);
      hud.fillText('Shield', w / 2, h - 15 * s);
    }

    if (this.state === 'paused') {
      this.drawOverlay('PAUSED', ['Press P or tap to resume'], s);
    } else if (this.state === 'gameover') {
      this.drawOverlay('GAME OVER', [
        `Score: ${ship.score}`,
        this.newRecord ? 'New record!' : `Best: ${this.best}`,
        'Press Enter or tap to play again',
      ], s);
    }
    hud.globalAlpha = 1;
  }

  drawOverlay(title, lines, s) {
    const { hud } = this;
    const { width: w, height: h } = hud.canvas;
    hud.globalAlpha = 0.6;
    hud.fillStyle = '#000';
    hud.fillRect(0, h / 2 - 70 * s, w, (30 * lines.length + 90) * s);
    hud.globalAlpha = 1;
    hud.textAlign = 'center';
    hud.fillStyle = '#e0a458';
    hud.font = `bold ${Math.round(36 * s)}px sans-serif`;
    hud.fillText(title, w / 2, h / 2 - 20 * s);
    hud.fillStyle = '#ddd';
    hud.font = `${Math.round(18 * s)}px sans-serif`;
    lines.forEach((line, i) => hud.fillText(line, w / 2, h / 2 + (20 + 30 * i) * s));
  }

  run() {
    this.bindEvents();
    let last = null;
    let fpsFrames = 0;
    let fpsTime = 0;
    const frame = (timestamp) => {
      if (last !== null) {
        const dt = (timestamp - last) / 1000;
        this.advance(Math.min(dt, MAX_FRAME));
        fpsFrames += 1;
        fpsTime += dt;
        if (fpsTime >= 0.5) {
          this.fps = Math.round(fpsFrames / fpsTime);
          fpsFrames = 0;
          fpsTime = 0;
        }
      }
      last = timestamp;
      this.resize();
      this.render();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }
}

async function main() {
  const stage = document.querySelector('.stage');
  const ui = {
    geometryRadios: [...document.querySelectorAll("input[name='geometry']")],
    // the browser may restore a previously checked radio button on reload
    selectedGeometry: () => document.querySelector("input[name='geometry']:checked")?.value,
    caption: document.getElementById('geocaption'),
    showGluing: document.getElementById('showgluing'),
  };
  let renderer;
  try {
    renderer = new Renderer(document.getElementById('viewport'));
  } catch {
    stage.innerHTML = '<p class="error">Your browser could not initialize WebGL. '
      + 'See <a href="https://get.webgl.org">get.webgl.org</a>.</p>';
    return;
  }
  await renderer.load();
  const game = new Game(renderer, document.getElementById('gui').getContext('2d'), ui);
  window.game = game;   // handy from the console
  game.run();
}

main();
