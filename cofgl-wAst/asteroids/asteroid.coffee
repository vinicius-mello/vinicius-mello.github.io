
step_iterations = 5

class Asteroid
  constructor: (q, p, @initial)->
    @texture = if @initial then cofgl.game.textures.bigAsteroid else cofgl.game.textures.asteroid
    @inv = 1.0
    @q = new cofgl.Complex(q.x, q.y)
    @p = new cofgl.Complex(p.x, p.y)
    @dir = new cofgl.Complex(1.0,0.0)
    if @initial
      @ts = 9.0
      @radius = 2/@ts
      @mass = 50
      @hp = 3
    else
      @ts = 15.0
      @radius = 2/@ts
      @mass = 20
      @hp = 2

  update: (dt) ->
    for i in [1 .. step_iterations]
      [@q, @p, @dir, @inv] = cofgl.game.geometry.step(@q, @p, @dir, dt/step_iterations, @inv)
    @dir = @dir.plus @p
    @dir.normalize()

root = self.cofgl ?= {}
root.Asteroid = Asteroid
