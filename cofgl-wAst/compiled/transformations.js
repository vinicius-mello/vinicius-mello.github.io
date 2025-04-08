// Generated by CoffeeScript 1.8.0
(function() {
  var Inversion, ReflectionOrigin, root;

  Inversion = (function() {
    function Inversion(c0, k) {
      this.c0 = c0;
      this.k = k;
    }

    Inversion.prototype.F = function(c) {
      var l, r;
      l = (c.x - this.c0.x) * (c.x - this.c0.x) + (c.y - this.c0.y) * (c.y - this.c0.y);
      r = new cofgl.Complex(this.c0.x + this.k * this.k * (c.x - this.c0.x) / l, this.c0.y + this.k * this.k * (c.y - this.c0.y) / l);
      return r;
    };

    Inversion.prototype.D = function(c, v) {
      var dx, dy, f, l, m11, m12, m21, m22, r;
      dx = c.x - this.c0.x;
      dy = c.y - this.c0.y;
      l = dx * dx + dy * dy;
      f = this.k * this.k / (l * l);
      m11 = l - 2.0 * dx * dx;
      m12 = -2.0 * dx * dy;
      m21 = m12;
      m22 = -m11;
      r = new cofgl.Complex(f * m11 * v.x + f * m12 * v.y, f * m21 * v.x + f * m22 * v.y);
      return r;
    };

    return Inversion;

  })();

  ReflectionOrigin = (function() {
    function ReflectionOrigin(l) {
      this.l = l;
    }

    ReflectionOrigin.prototype.F = function(c) {
      var f;
      f = 2.0 * (c.x * this.l.x + c.y * this.l.y) / (this.l.x * this.l.x + this.l.y * this.l.y);
      return new cofgl.Complex(f * this.l.x - c.x, f * this.l.y - c.y);
    };

    ReflectionOrigin.prototype.D = function(c, v) {
      var lx2, ly2, m11, m12, m21, m22;
      lx2 = this.l.x * this.l.x;
      ly2 = this.l.y * this.l.y;
      m11 = 2.0 * lx2 / (lx2 + ly2) - 1.0;
      m12 = 2.0 * this.l.x * this.l.y / (lx2 + ly2);
      m21 = m12;
      m22 = -m11;
      return new cofgl.Complex(m11 * v.x + m12 * v.y, m21 * v.x + m22 * v.y);
    };

    return ReflectionOrigin;

  })();

  root = self.cofgl != null ? self.cofgl : self.cofgl = {};

  root.Inversion = Inversion;

  root.ReflectionOrigin = ReflectionOrigin;

}).call(this);
