sqr2 = Math.sqrt(2.0)
sqr4 = Math.sqrt(sqr2)
l = (sqr4+1.0/sqr4)/2.0
C = l/Math.cos(Math.PI/8.0)
R = C*Math.tan(Math.PI/8.0)

octagon = [
  new cofgl.Complex(C,0.0),
  new cofgl.Complex(C/sqr2,C/sqr2),
  new cofgl.Complex(0.0,C),
  new cofgl.Complex(-C/sqr2,C/sqr2),
  new cofgl.Complex(-C,0.0),
  new cofgl.Complex(-C/sqr2,-C/sqr2),
  new cofgl.Complex(0.0,-C),
  new cofgl.Complex(C/sqr2,-C/sqr2)
]

octagonReflection = [
  new cofgl.ReflectionOrigin(new cofgl.Complex(0,1)),
  new cofgl.ReflectionOrigin(new cofgl.Complex(-1,1)),
  new cofgl.ReflectionOrigin(new cofgl.Complex(1,0)),
  new cofgl.ReflectionOrigin(new cofgl.Complex(1,1)),
  new cofgl.ReflectionOrigin(new cofgl.Complex(0,1)),
  new cofgl.ReflectionOrigin(new cofgl.Complex(-1,1)),
  new cofgl.ReflectionOrigin(new cofgl.Complex(1,0)),
  new cofgl.ReflectionOrigin(new cofgl.Complex(1,1))
]

octagonGluing = [4, 5, 6, 7, 0, 1, 2, 3]


###
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
###


# a = b x - c (x^2 + y^2)
# d = e y - f (x^2 + y^2)
# e = b
solveSystem = (a, b, c, d, f) ->
  #console.debug "a = #{a}"
  #console.debug "b = #{b}"
  #console.debug "c = #{c}"
  #console.debug "d = #{d}"
  #console.debug "f = #{f}"
  b2 = b*b
  g = a*f - c*d
  h = a*c + d*f
  den = 2.0*b2*(c*c + f*f)
  #console.debug "den = #{den}"
  delta = b2*(b2*b2 - 4.0*g*g - 4.0*b2*h)
  #console.debug "delta = #{delta}"
  sqdelta = Math.sqrt(delta)
  #console.debug "sqdelta = #{sqdelta}"
  p1 = b2*b*c + 2.0*b*f*g
  p2 = b2*b*f - 2.0*b*c*g
  switch
    when c != 0.0 then [
      (p1 - c*sqdelta)/den,
      (p2 - f*sqdelta)/den,
      (p1 + c*sqdelta)/den,
      (p2 + f*sqdelta)/den,
    ]
    else
      if f==0.0
        [a/b, d/b, a/b, d/b]
      else
        [a/b, (p2 - f*sqdelta)/den, a/b, (p2 + f*sqdelta)/den]

euclidStep = (q, p, dir, h) ->
  q.x = q.x + h*p.x/2.0
  q.y = q.y + h*p.y/2.0
  [q, p, dir]


euclidTorusStep = (q, p, dir, h, glued, cSides) ->
  [q, p, dir] = euclidStep(q, p, dir, h)
  if q.x > 1.0
    q.x = q.x - 2.0
  if q.x < -1.0
    q.x = q.x + 2.0
  if q.y > 1.0
    q.y = q.y - 2.0
  if q.y < -1.0
    q.y = q.y + 2.0
  [q, p, dir, glued, cSides]

poincareStep = (q, p, dir, h) ->
  #console.debug "Step In: #{q},#{p},#{dir},#{h}"
  D = 1.0 - q.x*q.x - q.y*q.y
  D2h = D*D*h
  a = D*D2h*p.x
  b = 8.0*D
  c = 16.0*q.x
  d = D*D2h*p.y
  #e = 8.0*D
  f = 16.0*q.y
  [dqx, dqy] = solveSystem(a, b, c, d, f)
  q.x = q.x + dqx
  q.y = q.y + dqy
  p.x = 8.0*dqx/D2h
  p.y = 8.0*dqy/D2h
  #console.debug "Step Out: #{q},#{p},#{dir},#{h}"
  [q, p, dir]

kleinStep = (q, p, dir, h, glued, cSides) ->
  # console.debug "q = #{q}"
  # console.debug "p = #{p}"
  # console.debug "dir = #{dir}"
  # console.debug "h = #{h}"
  D = 1.0 + q.x*q.x + q.y*q.y
  D2h = D*D*h
  a = D*D2h*p.x
  b = 8.0*D
  c = -16.0*q.x
  d = D*D2h*p.y
  #e = 8.0*D
  f = -16.0*q.y
  [dqx, dqy] = solveSystem(a, b, c, d, f)
  q.x = q.x + dqx
  q.y = q.y + dqy
  p.x = 8.0*dqx/D2h
  p.y = 8.0*dqy/D2h
  n = q.x*q.x + q.y*q.y
  if n > 1.0
    glued = glued * -1.0
    n2 = n*n
    a = (q.x*q.x-q.y*q.y)/n2
    b = 2.0*q.x*q.y/n2
    c = b
    d = -a
    px = p.x*a + p.y*b
    py = p.x*c + p.y*d
    p.x = px
    p.y = py
    dx = dir.x*a + dir.y*b
    dy = dir.x*c + dir.y*d
    dir.x = dx
    dir.y = dy
    q = new cofgl.Complex(-q.x/n2,-q.y/n2)
  # console.debug "fq = #{q}"
  # console.debug "fp = #{p}"
  # console.debug "fdir = #{dir}"
  [q, p, dir, glued, cSides]

dist = (a, b) -> Math.sqrt((a.x-b.x)*(a.x-b.x)+(a.y-b.y)*(a.y-b.y))

poincareBitorusStep = (q, p, dir, h, glued, cSides) ->
  [q, p, dir] = poincareStep(q, p, dir, h)
  d0 = d1 = 10.0
  for c,i in octagon
    d = dist(q,c)
    if d<d0
      d0 = d
      cSides[0] = octagonGluing[i] 
      if d0<d1
        td = d1
        ts = cSides[1]
        d1 = d0
        cSides[1] = cSides[0]
        d0 = td
        cSides[0] = ts
    if d<R
      #console.debug "Disk In: #{q},#{p}"
      refl = octagonReflection[i]
      p = refl.D(q, p)
      dir = refl.D(q, dir)
      q = refl.F(q)
      inv = new cofgl.Inversion(octagon[octagonGluing[i]], R)
      p = inv.D(q, p)
      dir = inv.D(q, dir)
      q = inv.F(q)
      #console.debug "Disk Out: #{q},#{p}"
      break
  [q, p, dir, glued, cSides]

root = self.cofgl ?= {}
root.poincareStep = poincareStep
root.kleinStep = kleinStep
root.euclidStep = euclidStep
root.euclidTorusStep = euclidTorusStep
root.poincareBitorusStep = poincareBitorusStep
