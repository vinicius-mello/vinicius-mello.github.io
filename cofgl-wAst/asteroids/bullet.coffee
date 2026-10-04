
step_iterations = 5
lifetime = 0.8   # seconds of game time

class Bullet
  constructor: (spq, spd)->
    @texture = cofgl.game.textures.laser
    @inv = 1.0
    acceleration = switch cofgl.game.geometry.name
        when "euclidean" then 4.0
        when "elliptic" then 15.0
        when "hyperbolic" then 20.0
    @q = new cofgl.Complex(spq.x, spq.y)
    @dir = new cofgl.Complex(spd.x, spd.y)
    @p = new cofgl.Complex(@dir.x*acceleration, @dir.y*acceleration)
    @ts = 13.0
    @radius = 2/@ts
    @mass = 0.1
    @age = 0
    @faded = false

  update: (dt) ->
    for i in [1 .. step_iterations]
      [@q, @p, @dir, @inv] = cofgl.game.geometry.step(@q, @p, @dir, dt/step_iterations, @inv)
    @dir = @dir.plus @p
    @dir.normalize()
    @age += dt
    @faded = true if @age >= lifetime

root = self.cofgl ?= {}
root.Bullet = Bullet
