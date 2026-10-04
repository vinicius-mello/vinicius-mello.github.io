keyMapping =
  40:     'brake'        # Arrow Down
  38:     'thrust'       # Arrow Up
  37:     'rotateLeft'   # Arrow Left
  39:     'rotateRight'  # Arrow Right
  83:     'brake'        # S
  87:     'thrust'       # W
  65:     'rotateLeft'   # A
  68:     'rotateRight'  # D
  32:     'fire'         # Spacebar

TICK = 1/60            # longest physics step (s)
MAX_FRAME = 0.25       # longest frame simulated at once (e.g. after a hiccup)
FIRE_COOLDOWN = 0.12   # s between shots while fire is held
SHIELD_TIME = 1.5      # s of invulnerability after a hit or a new wave
TOUCH_DEADZONE = 20    # px a steering touch must move before it acts

#coffee -cwo compiled src/. asteroids/.

# In-place, so arrays shared with other objects stay valid.
removeWhere = (array, pred) ->
  i = array.length
  while i--
    array.splice(i, 1) if pred array[i]
  array

randomVelocity = (min, max) ->
  speed = min + Math.random()*(max - min)
  ang = Math.random()*2*Math.PI
  {x: speed*Math.cos(ang), y: speed*Math.sin(ang)}

captions =
  euclidean: "Flat torus. Leave through one edge and you come back through the
    opposite one: edges of the same color are glued."
  elliptic: "Projective plane, curvature +1. Antipodal points of the circle are
    glued (same colors). Crossing it mirrors you: the surface is non-orientable."
  hyperbolic: "Genus-2 surface, curvature &minus;1. Opposite sides of the octagon
    (same colors) are glued; eight octagons meet at each corner."

# localStorage may be unavailable (private mode, blocked storage)
loadBest = (geometry) ->
  try
    parseInt(window.localStorage.getItem('nes-best-' + geometry), 10) || 0
  catch e
    0

saveBest = (geometry, score) ->
  try
    window.localStorage.setItem('nes-best-' + geometry, score)
  catch e


class Game
  constructor: ->
    @keys = {}      # action -> held, from the keyboard
    @touches = {}   # touch identifier -> {fire, x0, y0, x, y}

  initGame: ->
    {resources} = cofgl.resmgr
    #@processor = new cofgl.Processor resources['shaders/nothing']
    @processor = new cofgl.Processor resources['shaders/postprocess']
    texture = (name) ->
      cofgl.Texture.fromImage resources[name], {mipmaps: true, filtering: 'LINEAR'}
    @textures =
      spaceship: texture 'space/spaceship'
      asteroid: texture 'space/asteroid'
      bigAsteroid: texture 'space/asteroid1'
      laser: texture 'space/laser'
    @geometries =
      euclidean:
        name: "euclidean"
        k: 0
        shader: resources['shaders/euclidean']
        step: cofgl.euclidTorusStep
        distance: cofgl.torusDistance
      elliptic:
        name: "elliptic"
        k: 1
        shader: resources['shaders/elliptic']
        step: cofgl.kleinStep
        distance: cofgl.projectiveDistance
      hyperbolic:
        name: "hyperbolic"
        k: -1
        shader: resources['shaders/hyperbolic']
        step: cofgl.poincareBitorusStep
        distance: cofgl.bitorusDistance
    {gl} = cofgl.engine
    gl.disable gl.DEPTH_TEST
    @world = new cofgl.World this
    # the browser may restore a previously checked radio button on reload
    @restart $("input[name='geometry']:checked").val()

  restart: (geometry) ->
    @geometry = @geometries[geometry] ? @geometries.euclidean
    @spaceShip = new cofgl.SpaceShip()
    @bullets = []
    @asteroids = []
    @time = 0
    @lastFireTime = -Infinity
    @best = loadBest @geometry.name
    @newRecord = false
    @state = 'playing'
    @newWave()
    $('#geocaption').html captions[@geometry.name]

  initEventHandlers: ->
    $(window)
      .on 'keydown', (event) => this.onKeyDown event
      .on 'keyup', (event) => this.onKeyUp event
      .on 'blur', => this.pause()
    $('#composite')
      .on 'touchstart touchmove', (event) => this.onTouch event
      .on 'touchend touchcancel', (event) => this.onTouchEnd event
    $("input[name='geometry']").on 'change', ->
      cofgl.game.restart this.value
      this.blur()   # so the arrow keys steer the ship, not the radio group
    @showGluing = $('#showgluing').prop('checked')
    $('#showgluing').on 'change', ->
      cofgl.game.showGluing = this.checked
      this.blur()

  onKeyDown: (event) ->
    switch event.which
      when 80, 27   # P, Esc
        this.togglePause()
        return false
      when 13       # Enter
        @restart @geometry.name if @state == 'gameover'
        return false
    action = keyMapping[event.which]
    if action?
      @keys[action] = true
      false

  onKeyUp: (event) ->
    action = keyMapping[event.which]
    if action?
      @keys[action] = false
      false

  # Left half of the screen is a virtual joystick (drag from where the finger
  # landed: sideways to turn, up to thrust, down to brake); right half fires.
  onTouch: (event) ->
    event.preventDefault()
    rect = event.currentTarget.getBoundingClientRect()
    for t in event.originalEvent.changedTouches
      x = t.clientX - rect.left
      y = t.clientY - rect.top
      touch = @touches[t.identifier]
      if touch?
        touch.x = x
        touch.y = y
      else if event.type == 'touchstart'
        if @state == 'gameover'
          @restart @geometry.name
        else if @state == 'paused'
          @state = 'playing'
        else
          @touches[t.identifier] = {fire: x > rect.width/2, x0: x, y0: y, x: x, y: y}
    false

  onTouchEnd: (event) ->
    event.preventDefault()
    for t in event.originalEvent.changedTouches
      delete @touches[t.identifier]
    false

  pause: ->
    @state = 'paused' if @state == 'playing'
    # key/touch releases are lost while the window is unfocused
    @keys = {}
    @touches = {}

  togglePause: ->
    if @state == 'paused'
      @state = 'playing'
    else
      this.pause()

  currentActions: ->
    actions = {}
    actions[action] = held for action, held of @keys
    for id, t of @touches
      if t.fire
        actions.fire = true
      else
        dx = t.x - t.x0
        dy = t.y - t.y0
        actions.rotateLeft = true if dx < -TOUCH_DEADZONE
        actions.rotateRight = true if dx > TOUCH_DEADZONE
        actions.thrust = true if dy < -TOUCH_DEADZONE
        actions.brake = true if dy > TOUCH_DEADZONE
    actions

  run: ->
    cofgl.resmgr.wait =>
      @initGame()
      @initEventHandlers()
      @mainloop()

  mainloop: ->
    cofgl.engine.mainloop (dt) =>
      @advance Math.min(dt, MAX_FRAME)
      @render()
      @updateUI()
      @compose()

  # Each frame is split into equal substeps of at most TICK, so motion
  # advances by exactly the frame time (no jitter from a fixed-step
  # accumulator running 0 or 2 steps in some frames).
  advance: (dt) ->
    return if @state == 'paused'
    n = Math.ceil(dt/TICK)
    @tick dt/n for i in [0...n]

  tick: (h) ->
    @time += h
    asteroid.update h for asteroid in @asteroids
    # after game over the asteroids keep drifting behind the message
    return if @state == 'gameover'
    @handleInput h
    bullet.update h for bullet in @bullets
    removeWhere @bullets, (b) -> b.faded
    @spaceShip.update h
    @checkCollisions()

  handleInput: (h) ->
    actions = @currentActions()
    @spaceShip.steer (if actions.rotateLeft then 1 else 0) - (if actions.rotateRight then 1 else 0), h
    @spaceShip.thrust h if actions.thrust
    @spaceShip.brake h if actions.brake
    @fire() if actions.fire

  fire: ->
    return if @time - @lastFireTime < FIRE_COOLDOWN
    @bullets.push new cofgl.Bullet(@spaceShip.q, @spaceShip.dir)
    @lastFireTime = @time

  checkCollisions: ->
    {distance} = @geometry

    #asteroid/bullet
    for asteroid in @asteroids
      for bullet in @bullets when not bullet.faded
        if distance(asteroid.q, bullet.q) < asteroid.radius
          bullet.faded = true
          asteroid.hp -= 1
          @spaceShip.score += 1
          if asteroid.hp <= 0
            @spaceShip.score += 10
            break
    removeWhere @bullets, (b) -> b.faded
    destroyed = (a for a in @asteroids when a.hp <= 0)
    removeWhere @asteroids, (a) -> a.hp <= 0
    for old in destroyed when old.initial
      for i in [1..2]
        @asteroids.push new cofgl.Asteroid(old.q, randomVelocity(0.2, 0.45), false)
    @newWave() if @asteroids.length == 0

    #asteroid/spaceShip
    return if @spaceShip.shield > 0
    for asteroid in @asteroids
      if distance(asteroid.q, @spaceShip.q) < asteroid.radius + @spaceShip.radius
        @shipHit()
        break

  shipHit: ->
    @spaceShip.hp -= 1
    if @spaceShip.hp > 0
      @spaceShip.respawn SHIELD_TIME
    else
      @gameOver()

  gameOver: ->
    @state = 'gameover'
    @bullets.length = 0
    if @spaceShip.score > @best
      @best = @spaceShip.score
      @newRecord = true
      saveBest @geometry.name, @best

  addAsteroid: ->
    #initial position won't be near the center
    randomQ = {x:(if Math.random()<.5 then -1 else 1)*(Math.random()*0.2 + 0.4), y:(if Math.random()<.5 then -1 else 1)*(Math.random()*0.2 + 0.4)}
    @asteroids.push new cofgl.Asteroid(randomQ, randomVelocity(0.15, 0.35), true)

  newWave: ->
    @spaceShip.wave = @spaceShip.wave + 1
    @addAsteroid() for i in [0...@spaceShip.wave]
    # the ship may be anywhere when the new asteroids appear
    @spaceShip.shield = SHIELD_TIME if @spaceShip.wave > 1

  render: ->
    cofgl.clear()
    @processor.push()
    @world.draw()
    @processor.pop()

  compose: ->
    ctx = $('#composite')[0].getContext('2d')
    ctx.globalCompositeOperation = "source-over"
    ctx.drawImage($('#viewport')[0], 0, 0)
    ctx.drawImage($('#gui')[0], 0, 0)

  updateUI: ->
    guiCanvas = $('#gui')[0]
    gui = guiCanvas.getContext('2d')
    w = guiCanvas.width
    h = guiCanvas.height
    gui.clearRect(0, 0, w, h)
    cofgl.drawGluing gui, @geometry.name if @showGluing

    gui.globalAlpha = 0.9
    gui.fillStyle = "#e0a458"
    gui.textBaseline = "alphabetic"
    gui.font = "bold 16px sans-serif"
    gui.textAlign = "left"
    gui.fillText("Lives: " + Math.max(@spaceShip.hp, 0), 15, 25)
    gui.textAlign = "right"
    gui.fillText("Score: " + @spaceShip.score, w - 15, 25)
    gui.font = "14px sans-serif"
    gui.fillText("Best: " + Math.max(@best, @spaceShip.score), w - 15, 45)
    gui.font = "bold 16px sans-serif"
    gui.fillText("Wave: " + @spaceShip.wave, w - 15, h - 15)

    if @spaceShip.shield > 0 and @state == 'playing'
      gui.textAlign = "center"
      gui.fillStyle = "#7fc8ff"
      gui.fillText("Shield", w/2, h - 15)

    switch @state
      when 'paused'
        @drawOverlay gui, "PAUSED", ["Press P or tap to resume"]
      when 'gameover'
        lines = ["Score: " + @spaceShip.score]
        lines.push(if @newRecord then "New record!" else "Best: " + @best)
        lines.push "Press Enter or tap to play again"
        @drawOverlay gui, "GAME OVER", lines
    gui.globalAlpha = 1.0

  drawOverlay: (gui, title, lines) ->
    w = gui.canvas.width
    h = gui.canvas.height
    gui.globalAlpha = 0.6
    gui.fillStyle = "#000"
    gui.fillRect(0, h/2 - 70, w, 30*lines.length + 90)
    gui.globalAlpha = 1.0
    gui.textAlign = "center"
    gui.fillStyle = "#e0a458"
    gui.font = "bold 36px sans-serif"
    gui.fillText(title, w/2, h/2 - 20)
    gui.fillStyle = "#ddd"
    gui.font = "18px sans-serif"
    for line, i in lines
      gui.fillText(line, w/2, h/2 + 20 + 30*i)

initEngineAndGame = (selector, debug) ->
  canvas = $(selector)[0]
  # probe on a scratch canvas: the engine sets its own context options
  unless window.WebGLRenderingContext and document.createElement('canvas').getContext('webgl')
    $('.container').html(
      "<p>Your browser could not initialize WebGL.<br>See " +
      "<a href='https://get.webgl.org'>get.webgl.org</a>.</p>")
    return
  cofgl.debugPanel = new cofgl.DebugPanel()
  cofgl.engine = new cofgl.Engine(canvas, debug)
  cofgl.resmgr = cofgl.makeDefaultResourceManager()
  cofgl.game = new Game
  cofgl.game.run()


$(document).ready ->
  debug = cofgl.getRuntimeParameter('debug') == '1'
  initEngineAndGame '#viewport', debug



root = self.cofgl ?= {}
root.game = null
root.geometries = null
root.debugPanel = null
root.resmgr = null
root.engine = null
