
step_iterations = 5
max_vel = 5

class SpaceShip
  constructor: -> 
    @texture = cofgl.Texture.fromImage cofgl.resmgr.resources['space/spaceship'], {
        mipmaps: true,
        filtering: 'LINEAR'
      }
    @inv = 1.0
    @q = new cofgl.Complex(0.0,0.0)
    @p = new cofgl.Complex(0.0,0.0)
    @dir = new cofgl.Complex(1.0,0.0)
    ang = Math.PI/180 * 5
    @left = new cofgl.Complex(Math.cos(ang),Math.sin(ang))
    @right = new cofgl.Complex(Math.cos(-ang),Math.sin(-ang))
    angTouch = Math.PI/180 * 20
    @leftTouch = new cofgl.Complex(Math.cos(angTouch),Math.sin(angTouch))
    @rightTouch = new cofgl.Complex(Math.cos(-angTouch),Math.sin(-angTouch))
    @ts = 13.0
    @radius = 2/@ts
    @mass = 10
    @hp = 3
    @score = 0
    @wave = 0
    @hit = false
    @lastBulletTime = 0
    @bulletsUsed = 0
    @bulletCooldown = 100
    @dec = 0.98 
    @cSides = [10.0, 10.0]

  update: (dt) ->
    #console.debug "q = #{@q}"
    #console.debug "p = #{@p}"
    for i in [1 .. step_iterations]
      [@q, @p, @dir, @inv, @cSides] = cofgl.game.geometry.step(@q, @p, @dir, dt/step_iterations, @inv, @cSides)
    @dir = @dir.plus @p
    @dir.normalize()
    #deceleration
    @p.x = @p.x * @dec
    @p.y = @p.y * @dec

  #keyboard controls
  rotateLeft: ->
    @p = @p.times @left
    @dir = @dir.times @left

  rotateRight: ->
    @p = @p.times @right
    @dir = @dir.times @right

  thurst: ->  
    v = new cofgl.Complex(@dir.x/10.0, @dir.y/10.0)
    @p = @p.plus (v)
    if @p.y > max_vel then @p.y = max_vel
    if @p.x > max_vel then @p.x = max_vel
    if @p.y < -max_vel then @p.y = -max_vel
    if @p.x < -max_vel then @p.x = -max_vel

  break: ->
    v = new cofgl.Complex(-(@dir.x)/10.0, -(@dir.y)/10.0)
    @p = @p.plus (v)

  #touch controls
  swipeLeft: ->
    @p = @p.times @leftTouch
    @dir = @dir.times @leftTouch

  swipeRight: ->
    @p = @p.times @rightTouch
    @dir = @dir.times @rightTouch

  swipeThurst: ->  
    v = new cofgl.Complex(@dir.x * 3.0, @dir.y * 3.0)
    @p = @p.plus (v)
    if @p.y > max_vel then @p.y = max_vel
    if @p.x > max_vel then @p.x = max_vel
    if @p.y < -max_vel then @p.y = -max_vel
    if @p.x < -max_vel then @p.x = -max_vel

  swipeBreak: ->
    v = new cofgl.Complex(-(@dir.x * 3.0), -(@dir.y * 3.0))
    @p = @p.plus (v)
  
  hitShield: ->
    self = this
    @q = new cofgl.Complex(0.0,0.0)
    @p = new cofgl.Complex(0.0,0.0)
    setTimeout(->
      self.hit = false
    ,1500)


root = self.cofgl ?= {}
root.SpaceShip = SpaceShip
