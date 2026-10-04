import { Complex } from './complex.js';

const STEP_ITERATIONS = 5;

// Ship tuning; rates are per second unless noted
const MAX_VEL = 5;
const MAX_TURN = 4.5;        // rad/s at full steering
const TURN_ACCEL = 40;       // rad/s^2 when steering starts
const TURN_DAMPING = 25;     // 1/s, how fast the spin stops when released
const THRUST_ACCEL = 6;      // momentum gained per second of thrust
const DECELERATION = 0.98;   // momentum kept per 1/60 s (the original frame time)
const BRAKE = 0.9;           // momentum kept per 1/60 s while braking
const BULLET_LIFETIME = 0.8; // s

// Something moving along geodesics: position q, momentum p, heading dir.
// A sprite has half-size 1/ts in the disk, and its collision radius
// (measured with the metric, which is twice the coordinate length at 0) is 2/ts.
class Body {
  constructor(game, q, p, dir, texture, ts) {
    this.game = game;
    this.q = q;
    this.p = p;
    this.dir = dir;
    this.texture = texture;
    this.ts = ts;
    this.radius = 2 / ts;
    this.inv = 1;
  }

  move(dt) {
    const { step } = this.game.geometry;
    for (let i = 0; i < STEP_ITERATIONS; i++) {
      [this.q, this.p, this.dir, this.inv] = step(this.q, this.p, this.dir, dt / STEP_ITERATIONS, this.inv);
    }
    this.dir = this.dir.plus(this.p);
    this.dir.normalize();
  }
}

export class SpaceShip extends Body {
  constructor(game) {
    super(game, new Complex(), new Complex(), new Complex(1, 0), game.textures.spaceship, 13);
    this.hp = 3;
    this.score = 0;
    this.wave = 0;
    this.shield = 0;   // seconds of invulnerability left
    this.turnVel = 0;  // rad/s, positive = counterclockwise
  }

  update(dt) {
    this.move(dt);
    this.p = this.p.scale(DECELERATION ** (60 * dt));
    this.shield = Math.max(0, this.shield - dt);
  }

  // input: -1 (right) .. 1 (left), 0 = none
  steer(input, dt) {
    if (input !== 0) {
      this.turnVel = Math.max(-MAX_TURN, Math.min(MAX_TURN, this.turnVel + input * TURN_ACCEL * dt));
    }
    if (input === 0 || input * this.turnVel < 0) {
      this.turnVel *= Math.exp(-TURN_DAMPING * dt);
    }
    const rot = Complex.polar(1, this.turnVel * dt);
    this.p = this.p.times(rot);
    this.dir = this.dir.times(rot);
  }

  thrust(dt) {
    const p = this.p.plus(this.dir.scale(THRUST_ACCEL * dt));
    const clamp = (v) => Math.max(-MAX_VEL, Math.min(MAX_VEL, v));
    this.p = new Complex(clamp(p.x), clamp(p.y));
  }

  // Slows down without reversing: a negative momentum would flip dir
  // in move (dir + p), making the ship flicker back and forth.
  brake(dt) {
    this.p = this.p.scale(BRAKE ** (60 * dt));
  }

  respawn(shieldTime) {
    this.q = new Complex();
    this.p = new Complex();
    this.inv = 1;
    this.shield = shieldTime;
  }
}

export class Asteroid extends Body {
  constructor(game, q, p, initial) {
    const { textures } = game;
    super(game, new Complex(q.x, q.y), new Complex(p.x, p.y), new Complex(1, 0),
      initial ? textures.bigAsteroid : textures.asteroid, initial ? 9 : 15);
    this.initial = initial;
    this.hp = initial ? 3 : 2;
  }

  update(dt) {
    this.move(dt);
  }
}

export class Bullet extends Body {
  constructor(game, q, dir) {
    super(game, new Complex(q.x, q.y), dir.scale(game.geometry.bulletSpeed),
      new Complex(dir.x, dir.y), game.textures.laser, 13);
    this.age = 0;
    this.faded = false;
  }

  update(dt) {
    this.move(dt);
    this.age += dt;
    if (this.age >= BULLET_LIFETIME) this.faded = true;
  }
}
