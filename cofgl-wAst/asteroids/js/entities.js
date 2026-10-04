import { Complex } from './complex.js';

const STEP_ITERATIONS = 5;

// Ship tuning; rates are per second unless noted. Like the arcade game, the
// ship drifts: turning only changes where the nose points, and stopping
// takes a burst of thrust the other way.
const MAX_SPEED = 4;          // cap on |p|
const MAX_TURN = 4.5;         // rad/s at full steering
const TURN_ACCEL = 40;        // rad/s^2 when steering starts
const TURN_DAMPING = 25;      // 1/s, how fast the spin stops when released
const THRUST_ACCEL = 6;       // momentum gained per second of thrust
const REVERSE_ACCEL = 3;      // same, backwards
const DRAG = 0.993;           // momentum kept per 1/60 s

const BULLET_LIFETIME = 0.8;  // s

// The saucer: speeds are fractions of the player's bullet speed, which is
// already scaled for each geometry.
const SAUCER_SPEED = 0.1;
const SAUCER_LIFETIME = 14;   // s before it jumps away
const ENEMY_BULLET_SPEED = 0.6;
const ENEMY_BULLET_LIFETIME = 1.3;

function randomDirection() {
  return Complex.polar(1, Math.random() * 2 * Math.PI);
}

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

  // The steps parallel transport dir; alignToVelocity also turns it
  // towards p, so rocks and bullets face where they are going.
  move(dt, alignToVelocity = true) {
    const { step } = this.game.geometry;
    for (let i = 0; i < STEP_ITERATIONS; i++) {
      [this.q, this.p, this.dir, this.inv] = step(this.q, this.p, this.dir, dt / STEP_ITERATIONS, this.inv);
    }
    if (alignToVelocity) this.dir = this.dir.plus(this.p);
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
    this.move(dt, false);
    this.p = this.p.scale(DRAG ** (60 * dt));
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
    this.dir = this.dir.times(Complex.polar(1, this.turnVel * dt));
  }

  push(accel) {
    this.p = this.p.plus(this.dir.scale(accel));
    const speed = Math.sqrt(this.p.magnitude);
    if (speed > MAX_SPEED) this.p = this.p.scale(MAX_SPEED / speed);
  }

  thrust(dt) {
    this.push(THRUST_ACCEL * dt);
  }

  reverse(dt) {
    this.push(-REVERSE_ACCEL * dt);
  }

  respawn(shieldTime) {
    this.q = new Complex();
    this.p = new Complex();
    this.inv = 1;
    this.turnVel = 0;
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
  constructor(game, q, dir, { texture = game.textures.laser, speed = 1, lifetime = BULLET_LIFETIME } = {}) {
    super(game, new Complex(q.x, q.y), dir.scale(game.geometry.bulletSpeed * speed),
      new Complex(dir.x, dir.y), texture, 13);
    this.lifetime = lifetime;
    this.age = 0;
    this.faded = false;
  }

  update(dt) {
    this.move(dt);
    this.age += dt;
    if (this.age >= this.lifetime) this.faded = true;
  }
}

// Flies around changing course every few seconds and shoots at the ship,
// less and less inaccurately as the waves go by.
export class Saucer extends Body {
  constructor(game, q, wave) {
    const speed = game.geometry.bulletSpeed * SAUCER_SPEED;
    super(game, q, randomDirection().scale(speed), new Complex(1, 0), game.textures.saucer, 9);
    this.hp = 2;
    this.age = 0;
    this.turnTimer = 1 + Math.random() * 2;
    this.fireInterval = Math.max(0.8, 1.7 - 0.1 * wave);
    this.fireTimer = this.fireInterval;
    this.spread = Math.max(0.05, 0.35 - 0.04 * wave);   // rad
  }

  get gone() {
    return this.hp <= 0 || this.age >= SAUCER_LIFETIME;
  }

  // returns a bullet when it shoots
  update(dt, target) {
    this.move(dt, false);
    this.age += dt;
    this.turnTimer -= dt;
    if (this.turnTimer <= 0) {
      // new course, same speed
      this.p = randomDirection().scale(Math.sqrt(this.p.magnitude));
      this.turnTimer = 1.5 + Math.random() * 1.5;
    }
    this.fireTimer -= dt;
    if (this.fireTimer > 0) return null;
    this.fireTimer = this.fireInterval;
    const aim = this.game.geometry.directionTo(this.q, target)
      .times(Complex.polar(1, (Math.random() * 2 - 1) * this.spread));
    return new Bullet(this.game, this.q, aim, {
      texture: this.game.textures.enemyLaser,
      speed: ENEMY_BULLET_SPEED,
      lifetime: ENEMY_BULLET_LIFETIME,
    });
  }
}
