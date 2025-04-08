
step_iterations = 5

class Asteroid
  constructor: (q, p, @initial)->
    @texture = cofgl.Texture.fromImage cofgl.resmgr.resources['space/'+ (if @initial  then 'asteroid1' else 'asteroid')], {
        mipmaps: true,
        filtering: 'LINEAR'
      }
    @inv = 1.0
    @q = new cofgl.Complex(q.x, q.y)
    @p = new cofgl.Complex(p.x, p.y)
    @dir = new cofgl.Complex(1.0,0.0)
    ang = Math.PI/180 * 5
    @left = new cofgl.Complex(Math.cos(ang),Math.sin(ang))
    @right = new cofgl.Complex(Math.cos(-ang),Math.sin(-ang))
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
    @cSides = [10.0, 10.0]  

  update: (dt) ->
    for i in [1 .. step_iterations]
      [@q, @p, @dir, @inv, @cSides] = cofgl.game.geometry.step(@q, @p, @dir, dt/step_iterations, @inv, @cSides)
    @dir = @dir.plus @p
    # @dir = @dir.times @left
    @dir.normalize()

root = self.cofgl ?= {}
root.Asteroid = Asteroid
