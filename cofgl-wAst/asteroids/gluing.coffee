# Draws the boundary of each fundamental domain on the 2D overlay, with
# identified edges in the same color, so the player can see the topology.

pairColors = ['#e0a458', '#5fb3d9', '#9ad46a', '#e36d8e']
lineWidth = 4

# disk coordinates ([-1,1]^2, y up) -> canvas pixels
toCanvas = (ctx, x, y) ->
  [(x + 1)/2*ctx.canvas.width, (1 - y)/2*ctx.canvas.height]

arrowHead = (ctx, x, y, angle, size = 9) ->
  ctx.save()
  ctx.translate x, y
  ctx.rotate angle
  ctx.beginPath()
  ctx.moveTo size, 0
  ctx.lineTo -size, -size*0.8
  ctx.lineTo -size, size*0.8
  ctx.closePath()
  ctx.fill()
  ctx.restore()

# Torus: left/right and top/bottom edges glued by translation; the usual
# single/double arrows show they are glued with the same orientation.
drawTorus = (ctx) ->
  w = ctx.canvas.width
  h = ctx.canvas.height
  o = lineWidth/2
  edges = [
    [pairColors[0], [o, h], [o, 0], 1]
    [pairColors[0], [w - o, h], [w - o, 0], 1]
    [pairColors[1], [0, h - o], [w, h - o], 2]
    [pairColors[1], [0, o], [w, o], 2]
  ]
  for [color, [x0, y0], [x1, y1], arrows] in edges
    ctx.strokeStyle = ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo x0, y0
    ctx.lineTo x1, y1
    ctx.stroke()
    angle = Math.atan2(y1 - y0, x1 - x0)
    # the edge lies on the canvas border: push the arrows inwards
    nx = if x0 == x1 then (if x0 < w/2 then 10 else -10) else 0
    ny = if y0 == y1 then (if y0 < h/2 then 10 else -10) else 0
    for k in [0...arrows]
      t = 0.5 + 0.035*(k - (arrows - 1)/2)*2
      arrowHead ctx, x0 + t*(x1 - x0) + nx, y0 + t*(y1 - y0) + ny, angle

# Projective plane: antipodal boundary points are glued, so the hue goes
# around twice and opposite points get the same color.
drawProjective = (ctx) ->
  [cx, cy] = toCanvas ctx, 0, 0
  r = ctx.canvas.width/2 - lineWidth/2
  n = 96
  for i in [0...n]
    a0 = 2*Math.PI*i/n
    a1 = 2*Math.PI*(i + 1)/n
    ctx.strokeStyle = "hsl(#{Math.round(360*2*i/n) % 360}, 65%, 60%)"
    ctx.beginPath()
    ctx.arc cx, cy, r, a0, a1 + 0.01
    ctx.stroke()

# Genus-2 surface: side i of the octagon is glued to side i+4.
drawBitorus = (ctx) ->
  {C, R} = cofgl.octagonGeometry
  scale = ctx.canvas.width/2
  phi = Math.PI/8
  # vertices: where adjacent side circles meet, at angle (2i+1) pi/8
  rv = C*Math.cos(phi) - Math.sqrt(R*R - C*C*Math.sin(phi)*Math.sin(phi))
  for i in [0...8]
    th = i*Math.PI/4
    [cx, cy] = toCanvas ctx, C*Math.cos(th), C*Math.sin(th)
    [x0, y0] = toCanvas ctx, rv*Math.cos(th - phi), rv*Math.sin(th - phi)
    [x1, y1] = toCanvas ctx, rv*Math.cos(th + phi), rv*Math.sin(th + phi)
    a0 = Math.atan2(y0 - cy, x0 - cx)
    a1 = Math.atan2(y1 - cy, x1 - cx)
    d = a1 - a0
    d -= 2*Math.PI while d > Math.PI
    d += 2*Math.PI while d <= -Math.PI
    ctx.strokeStyle = pairColors[i % 4]
    ctx.beginPath()
    ctx.arc cx, cy, R*scale, a0, a1, d < 0
    ctx.stroke()

drawGluing = (ctx, geometry) ->
  ctx.save()
  ctx.globalAlpha = 0.85
  ctx.lineWidth = lineWidth
  ctx.lineCap = 'butt'
  switch geometry
    when 'euclidean' then drawTorus ctx
    when 'elliptic' then drawProjective ctx
    when 'hyperbolic' then drawBitorus ctx
  ctx.restore()


root = self.cofgl ?= {}
root.drawGluing = drawGluing
