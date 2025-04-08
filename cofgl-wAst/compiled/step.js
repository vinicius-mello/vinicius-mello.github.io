// Generated by CoffeeScript 1.8.0
(function() {
  var C, R, dist, euclidStep, euclidTorusStep, kleinStep, l, octagon, octagonGluing, octagonReflection, poincareBitorusStep, poincareStep, root, solveSystem, sqr2, sqr4;

  sqr2 = Math.sqrt(2.0);

  sqr4 = Math.sqrt(sqr2);

  l = (sqr4 + 1.0 / sqr4) / 2.0;

  C = l / Math.cos(Math.PI / 8.0);

  R = C * Math.tan(Math.PI / 8.0);

  octagon = [new cofgl.Complex(C, 0.0), new cofgl.Complex(C / sqr2, C / sqr2), new cofgl.Complex(0.0, C), new cofgl.Complex(-C / sqr2, C / sqr2), new cofgl.Complex(-C, 0.0), new cofgl.Complex(-C / sqr2, -C / sqr2), new cofgl.Complex(0.0, -C), new cofgl.Complex(C / sqr2, -C / sqr2)];

  octagonReflection = [new cofgl.ReflectionOrigin(new cofgl.Complex(0, 1)), new cofgl.ReflectionOrigin(new cofgl.Complex(-1, 1)), new cofgl.ReflectionOrigin(new cofgl.Complex(1, 0)), new cofgl.ReflectionOrigin(new cofgl.Complex(1, 1)), new cofgl.ReflectionOrigin(new cofgl.Complex(0, 1)), new cofgl.ReflectionOrigin(new cofgl.Complex(-1, 1)), new cofgl.ReflectionOrigin(new cofgl.Complex(1, 0)), new cofgl.ReflectionOrigin(new cofgl.Complex(1, 1))];

  octagonGluing = [4, 5, 6, 7, 0, 1, 2, 3];


  /*
  octagonReflection = [
    new cofgl.ReflectionOrigin(new cofgl.Complex(1,1)),
    new cofgl.ReflectionOrigin(new cofgl.Complex(0,1)),
    new cofgl.ReflectionOrigin(new cofgl.Complex(1,1)),
    new cofgl.ReflectionOrigin(new cofgl.Complex(0,1)),
    new cofgl.ReflectionOrigin(new cofgl.Complex(1,1)),
    new cofgl.ReflectionOrigin(new cofgl.Complex(0,1)),
    new cofgl.ReflectionOrigin(new cofgl.Complex(1,1)),
    new cofgl.ReflectionOrigin(new cofgl.Complex(0,1))
  ]
  
  octagonGluing = [2, 3, 0, 1, 6, 7, 4, 5]
   */

  solveSystem = function(a, b, c, d, f) {
    var b2, delta, den, g, h, p1, p2, sqdelta;
    b2 = b * b;
    g = a * f - c * d;
    h = a * c + d * f;
    den = 2.0 * b2 * (c * c + f * f);
    delta = b2 * (b2 * b2 - 4.0 * g * g - 4.0 * b2 * h);
    sqdelta = Math.sqrt(delta);
    p1 = b2 * b * c + 2.0 * b * f * g;
    p2 = b2 * b * f - 2.0 * b * c * g;
    switch (false) {
      case c === 0.0:
        return [(p1 - c * sqdelta) / den, (p2 - f * sqdelta) / den, (p1 + c * sqdelta) / den, (p2 + f * sqdelta) / den];
      default:
        if (f === 0.0) {
          return [a / b, d / b, a / b, d / b];
        } else {
          return [a / b, (p2 - f * sqdelta) / den, a / b, (p2 + f * sqdelta) / den];
        }
    }
  };

  euclidStep = function(q, p, dir, h) {
    q.x = q.x + h * p.x / 2.0;
    q.y = q.y + h * p.y / 2.0;
    return [q, p, dir];
  };

  euclidTorusStep = function(q, p, dir, h, glued, cSides) {
    var _ref;
    _ref = euclidStep(q, p, dir, h), q = _ref[0], p = _ref[1], dir = _ref[2];
    if (q.x > 1.0) {
      q.x = q.x - 2.0;
    }
    if (q.x < -1.0) {
      q.x = q.x + 2.0;
    }
    if (q.y > 1.0) {
      q.y = q.y - 2.0;
    }
    if (q.y < -1.0) {
      q.y = q.y + 2.0;
    }
    return [q, p, dir, glued, cSides];
  };

  poincareStep = function(q, p, dir, h) {
    var D, D2h, a, b, c, d, dqx, dqy, f, _ref;
    D = 1.0 - q.x * q.x - q.y * q.y;
    D2h = D * D * h;
    a = D * D2h * p.x;
    b = 8.0 * D;
    c = 16.0 * q.x;
    d = D * D2h * p.y;
    f = 16.0 * q.y;
    _ref = solveSystem(a, b, c, d, f), dqx = _ref[0], dqy = _ref[1];
    q.x = q.x + dqx;
    q.y = q.y + dqy;
    p.x = 8.0 * dqx / D2h;
    p.y = 8.0 * dqy / D2h;
    return [q, p, dir];
  };

  kleinStep = function(q, p, dir, h, glued, cSides) {
    var D, D2h, a, b, c, d, dqx, dqy, dx, dy, f, n, n2, px, py, _ref;
    D = 1.0 + q.x * q.x + q.y * q.y;
    D2h = D * D * h;
    a = D * D2h * p.x;
    b = 8.0 * D;
    c = -16.0 * q.x;
    d = D * D2h * p.y;
    f = -16.0 * q.y;
    _ref = solveSystem(a, b, c, d, f), dqx = _ref[0], dqy = _ref[1];
    q.x = q.x + dqx;
    q.y = q.y + dqy;
    p.x = 8.0 * dqx / D2h;
    p.y = 8.0 * dqy / D2h;
    n = q.x * q.x + q.y * q.y;
    if (n > 1.0) {
      glued = glued * -1.0;
      n2 = n * n;
      a = (q.x * q.x - q.y * q.y) / n2;
      b = 2.0 * q.x * q.y / n2;
      c = b;
      d = -a;
      px = p.x * a + p.y * b;
      py = p.x * c + p.y * d;
      p.x = px;
      p.y = py;
      dx = dir.x * a + dir.y * b;
      dy = dir.x * c + dir.y * d;
      dir.x = dx;
      dir.y = dy;
      q = new cofgl.Complex(-q.x / n2, -q.y / n2);
    }
    return [q, p, dir, glued, cSides];
  };

  dist = function(a, b) {
    return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));
  };

  poincareBitorusStep = function(q, p, dir, h, glued, cSides) {
    var c, d, d0, d1, i, inv, refl, td, ts, _i, _len, _ref;
    _ref = poincareStep(q, p, dir, h), q = _ref[0], p = _ref[1], dir = _ref[2];
    d0 = d1 = 10.0;
    for (i = _i = 0, _len = octagon.length; _i < _len; i = ++_i) {
      c = octagon[i];
      d = dist(q, c);
      if (d < d0) {
        d0 = d;
        cSides[0] = octagonGluing[i];
        if (d0 < d1) {
          td = d1;
          ts = cSides[1];
          d1 = d0;
          cSides[1] = cSides[0];
          d0 = td;
          cSides[0] = ts;
        }
      }
      if (d < R) {
        refl = octagonReflection[i];
        p = refl.D(q, p);
        dir = refl.D(q, dir);
        q = refl.F(q);
        inv = new cofgl.Inversion(octagon[octagonGluing[i]], R);
        p = inv.D(q, p);
        dir = inv.D(q, dir);
        q = inv.F(q);
        break;
      }
    }
    return [q, p, dir, glued, cSides];
  };

  root = self.cofgl != null ? self.cofgl : self.cofgl = {};

  root.poincareStep = poincareStep;

  root.kleinStep = kleinStep;

  root.euclidStep = euclidStep;

  root.euclidTorusStep = euclidTorusStep;

  root.poincareBitorusStep = poincareBitorusStep;

}).call(this);
