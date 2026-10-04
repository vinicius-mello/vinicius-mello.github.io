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

octagonInversion = (new cofgl.Inversion(octagon[j], R) for j in octagonGluing)


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


euclidTorusStep = (q, p, dir, h, glued) ->
  [q, p, dir] = euclidStep(q, p, dir, h)
  if q.x > 1.0
    q.x = q.x - 2.0
  if q.x < -1.0
    q.x = q.x + 2.0
  if q.y > 1.0
    q.y = q.y - 2.0
  if q.y < -1.0
    q.y = q.y + 2.0
  [q, p, dir, glued]

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

kleinStep = (q, p, dir, h, glued) ->
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
  [q, p, dir, glued]

dist = (a, b) -> Math.sqrt((a.x-b.x)*(a.x-b.x)+(a.y-b.y)*(a.y-b.y))

poincareBitorusStep = (q, p, dir, h, glued) ->
  [q, p, dir] = poincareStep(q, p, dir, h)
  for c,i in octagon
    if dist(q,c)<R
      #console.debug "Disk In: #{q},#{p}"
      refl = octagonReflection[i]
      p = refl.D(q, p)
      dir = refl.D(q, dir)
      q = refl.F(q)
      inv = octagonInversion[i]
      p = inv.D(q, p)
      dir = inv.D(q, dir)
      q = inv.F(q)
      #console.debug "Disk Out: #{q},#{p}"
      break
  [q, p, dir, glued]

# Geodesic distance in the disk model of curvature k (see details.md):
# d(z1,z2) = 2 arctan_k |(z1-z2)/(1+k z1 conj(z2))|
diskDistance = (z1, z2, k) ->
  den = new cofgl.Complex(1.0 + k*(z1.x*z2.x + z1.y*z2.y), k*(z1.y*z2.x - z1.x*z2.y))
  r = Math.sqrt(z1.minus(z2).divide(den).magnitude)
  switch k
    when -1 then 2.0*Math.atanh(Math.min(r, 1.0 - 1e-12))
    when 0 then 2.0*r
    else 2.0*Math.atan(r)

# Distances on the closed surfaces take the glued copies into account,
# otherwise objects touching across an edge would not collide.
torusDistance = (z1, z2) ->
  d = Infinity
  for ox in [-2.0, 0.0, 2.0]
    for oy in [-2.0, 0.0, 2.0]
      d = Math.min(d, diskDistance(z1, new cofgl.Complex(z2.x + ox, z2.y + oy), 0))
  d

# Projective plane = sphere / antipodal map, and the antipode is at distance pi.
projectiveDistance = (z1, z2) ->
  d = diskDistance(z1, z2, 1)
  Math.min(d, Math.PI - d)

bitorusDistance = (z1, z2) ->
  d = diskDistance(z1, z2, -1)
  for refl, i in octagonReflection
    d = Math.min(d, diskDistance(z1, octagonInversion[i].F(refl.F(z2)), -1))
  d

root = self.cofgl ?= {}
root.poincareStep = poincareStep
root.kleinStep = kleinStep
root.euclidStep = euclidStep
root.euclidTorusStep = euclidTorusStep
root.poincareBitorusStep = poincareBitorusStep
root.octagonGeometry = {C: C, R: R}
root.torusDistance = torusDistance
root.projectiveDistance = projectiveDistance
root.bitorusDistance = bitorusDistance
