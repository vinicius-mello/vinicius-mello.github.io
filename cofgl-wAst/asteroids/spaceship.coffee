
step_iterations = 5
max_vel = 5
max_turn = 4.5       # rad/s at full steering
turn_accel = 40.0    # rad/s^2 when steering starts
turn_damping = 25.0  # 1/s, how fast the spin stops when released

class SpaceShip
  constructor: ->
    @texture = cofgl.game.textures.spaceship
    @inv = 1.0
    @q = new cofgl.Complex(0.0,0.0)
    @p = new cofgl.Complex(0.0,0.0)
    @dir = new cofgl.Complex(1.0,0.0)
    @turnVel = 0     # rad/s, positive = counterclockwise
    @ts = 13.0
    @radius = 2/@ts
    @mass = 10
    @hp = 3
    @score = 0
    @wave = 0
    @shield = 0      # seconds of invulnerability left
    # rates per 1/60 s, the frame time the game was originally tuned for
    @dec = 0.98
    @brakeDec = 0.9
    @thrustAccel = 6.0   # momentum gained per second of thrust

  # steering: -1 (right) .. 1 (left), 0 = none
  steer: (input, dt) ->
    if input != 0
      @turnVel += input*turn_accel*dt
      @turnVel = Math.max(-max_turn, Math.min(max_turn, @turnVel))
    if input == 0 or input*@turnVel < 0
      @turnVel *= Math.exp(-turn_damping*dt)
    ang = @turnVel*dt
    rot = new cofgl.Complex(Math.cos(ang), Math.sin(ang))
    @p = @p.times rot
    @dir = @dir.times rot

  update: (dt) ->
    #console.debug "q = #{@q}"
    #console.debug "p = #{@p}"
    for i in [1 .. step_iterations]
      [@q, @p, @dir, @inv] = cofgl.game.geometry.step(@q, @p, @dir, dt/step_iterations, @inv)
    @dir = @dir.plus @p
    @dir.normalize()
    #deceleration
    dec = Math.pow(@dec, 60*dt)
    @p.x = @p.x * dec
    @p.y = @p.y * dec
    @shield = Math.max(0, @shield - dt)

  thrust: (dt) ->
    v = new cofgl.Complex(@dir.x*@thrustAccel*dt, @dir.y*@thrustAccel*dt)
    @p = @p.plus (v)
    if @p.y > max_vel then @p.y = max_vel
    if @p.x > max_vel then @p.x = max_vel
    if @p.y < -max_vel then @p.y = -max_vel
    if @p.x < -max_vel then @p.x = -max_vel

  # Slows down without reversing: a negative momentum would flip @dir
  # in update (dir + p), making the ship flicker back and forth.
  brake: (dt) ->
    dec = Math.pow(@brakeDec, 60*dt)
    @p = new cofgl.Complex(@p.x * dec, @p.y * dec)

  respawn: (shieldTime) ->
    @q = new cofgl.Complex(0.0,0.0)
    @p = new cofgl.Complex(0.0,0.0)
    @inv = 1.0
    @shield = shieldTime


root = self.cofgl ?= {}
root.SpaceShip = SpaceShip
