
step_iterations = 5

class Bullet
  constructor: (spq, spp, spd)->
    @texture = cofgl.Texture.fromImage cofgl.resmgr.resources['space/laser'], {
        mipmaps: true,
        filtering: 'LINEAR'
      }
    @inv = 1.0
    acceleration = switch cofgl.game.geometry.name
        when "euclidean" then 4.0
        when "elliptic" then 15.0
        when "hyperbolic" then 20.0
    @q = new cofgl.Complex(spq.x, spq.y)
    @p = new cofgl.Complex(0.0, 0.0)
    @dir = new cofgl.Complex(spd.x, spd.y)
    v = new cofgl.Complex(@dir.x*acceleration, @dir.y*acceleration)
    @p = @p.plus (v)
    # ang = Math.PI/180 * 5
    # @left = new cofgl.Complex(Math.cos(ang),Math.sin(ang))
    # @right = new cofgl.Complex(Math.cos(-ang),Math.sin(-ang))
    @width = 0.01
    @height = 0.01
    @ts = 13.0
    @radius = 2/@ts
    @mass = 0.1
    @faded = false
    self = this
    setTimeout(->
      self.faded = true
      # alert cofgl.game.geometry.name
    ,800)
    @cSides = [10.0, 10.0]


  update: (dt) ->
    for i in [1 .. step_iterations]
      [@q, @p, @dir, @inv, @cSides] = cofgl.game.geometry.step(@q, @p, @dir, dt/step_iterations, @inv, @cSides)
    @dir = @dir.plus @p
    @dir.normalize()

root = self.cofgl ?= {}
root.Bullet = Bullet
