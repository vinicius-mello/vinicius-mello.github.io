export class Complex {
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }

  get magnitude() {
    return this.x * this.x + this.y * this.y;
  }

  plus(c) {
    return new Complex(this.x + c.x, this.y + c.y);
  }

  minus(c) {
    return new Complex(this.x - c.x, this.y - c.y);
  }

  times(c) {
    return new Complex(this.x * c.x - this.y * c.y, this.x * c.y + this.y * c.x);
  }

  scale(s) {
    return new Complex(this.x * s, this.y * s);
  }

  divide(c) {
    const d = c.x * c.x + c.y * c.y;
    return new Complex(
      (this.x * c.x + this.y * c.y) / d,
      (this.y * c.x - this.x * c.y) / d
    );
  }

  conjugate() {
    return new Complex(this.x, -this.y);
  }

  normalize() {
    const n = Math.sqrt(this.magnitude);
    this.x /= n;
    this.y /= n;
  }

  static polar(r, angle) {
    return new Complex(r * Math.cos(angle), r * Math.sin(angle));
  }
}
