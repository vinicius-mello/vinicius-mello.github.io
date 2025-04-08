keyMapping =
  40:     'break'        # Arrow Down
  38:     'thurst'       # Arrow Up
  37:     'rotateLeft'   # Arrow Left
  39:     'rotateRight'  # Arrow Right
  83:     'break'        # S
  87:     'thurst'       # W
  65:     'rotateLeft'   # A
  68:     'rotateRight'  # D
  32:     'fire'         # Spacebar

swipedir = undefined
x = undefined
startX = undefined
startY = undefined
distX = undefined
distY = undefined
threshold = 150
restraint = 140
allowedTime = 500
elapsedTime = undefined
startTime = undefined

#coffee -cwo compiled src/. asteroids/.

class Game
  constructor: ->
    @actions = {}
    for code, action of keyMapping
      @actions[action] = false

  restart: (geometry) ->
    @geometry = @geometries[geometry]
    @spaceShip = new cofgl.SpaceShip()
    @bullets = []
    @asteroids = []    
    @newWave()
    @world = new cofgl.World(@spaceShip, @asteroids, @bullets)

  initGame: ->
    #@processor = new cofgl.Processor cofgl.resmgr.resources['shaders/nothing']
    @processor = new cofgl.Processor cofgl.resmgr.resources['shaders/postprocess']
    @geometries =
      euclidean:
        name: "euclidean"
        k: 0
        shader: cofgl.resmgr.resources['shaders/euclidean']
        step: cofgl.euclidTorusStep
      elliptic:
        name: "elliptic"
        k: 1
        shader: cofgl.resmgr.resources['shaders/elliptic']
        step: cofgl.kleinStep
      hyperbolic:
        name: "hyperbolic"
        k: -1
        shader: cofgl.resmgr.resources['shaders/hyperbolic']
        step: cofgl.poincareBitorusStep
    @geometry = @geometries.euclidean
    # @geometry = @geometries.elliptic
    # @geometry = @geometries.hyperbolic
    @spaceShip = new cofgl.SpaceShip()
    @bullets = []
    @asteroids = []    
    @newWave()
    @world = new cofgl.World(@spaceShip, @asteroids, @bullets, @c)
    {gl} = cofgl.engine
    gl.disable gl.DEPTH_TEST    

  initEventHandlers: ->
    $(window)
      .bind 'keydown', (event) =>
        this.onKeyDown event
      .bind 'keyup', (event) =>
        this.onKeyUp event
      .bind 'touchstart', (event) =>
        this.onTouchStart event
      .bind 'touchend', (event) =>
        this.onTouchEnd event
      .bind 'touchcancel', (event) =>
        this.onTouchCancel event
      .bind 'touchleave', (event) =>
        this.onTouchLeave event
      .bind 'touchendMove', (event) =>
        this.onTouchMove event

  onKeyDown: (event) ->
    action = keyMapping[event.which]
    if action?
      @actions[action] = true
      false

  onKeyUp: (event) ->
    action = keyMapping[event.which]
    if action == 'fire' then @resetBulletCooldown()
    if action?
      @actions[action] = false
      false

  onTouchStart: (event) ->
    event.preventDefault()
    touchobj = event.originalEvent.touches[0] or event.originalEvent.changedTouches[0]
    x = touchobj.pageX - event.target.offsetLeft
    # y = touchobj.pageY - event.target.offsetTop
    # console.log "ponto: " + x + "x"
    # console.log "ponto: " + y + "y"
    if x > $('#composite')[0].width /2 
      @fire(@spaceShip, @bullets)
    else
      swipedir = 'none'
      dist = 0
      startX = touchobj.pageX
      startY = touchobj.pageY
      now = new Date
      startTime = now.getTime() 

  onTouchEnd: (event) ->
    event.preventDefault()     
    if x < $('#composite')[0].width /2 
      touchobj = event.originalEvent.changedTouches[0] or event.originalEvent.touches[0]
      distX = touchobj.pageX - startX
      # get horizontal distance
      distY = touchobj.pageY - startY
      # get vertical distance
      now = new Date
      elapsedTime = now.getTime() - startTime
      if elapsedTime <= allowedTime
        #condition for horizontal swipe
        if Math.abs(distX) >= threshold and Math.abs(distY) <= restraint
          swipedir = if distX < 0 then 'left' else 'right'
        # condition for vertical swipe 
        else if Math.abs(distY) >= threshold and Math.abs(distX) <= restraint
          # if negative, up swipe
          swipedir = if distY < 0 then 'up' else 'down'
      switch swipedir
        when 'up' then @spaceShip.swipeThurst()
        when 'down' then @spaceShip.swipeBreak()
        when 'left' then @spaceShip.swipeLeft()
        when 'right' then @spaceShip.swipeRight() 

  onTouchCancel: (event) ->
    event.preventDefault()  

  onTouchLeave: (event) ->
    event.preventDefault()   

  onTouchMove: (event) ->
    event.preventDefault()   

  run: ->
    cofgl.resmgr.wait =>
      @initGame()
      @initEventHandlers()
      @mainloop()

  mainloop: ->
    cofgl.engine.mainloop (dt) =>
      @updateGame dt
      @render()
      @updateUI dt
      @compose() 

  updateGame: (dt) ->
    @checkCollision @spaceShip, @asteroids, @bullets
    @handleInput()
    for asteroid in @asteroids
      asteroid.update dt      
    for b, @bullet of @bullets 
      if @bullet.faded
        @bullets.splice(b, 1)
      else
        @bullet.update dt
    @spaceShip.update dt
    @world.update dt

  handleInput: ->
    if @actions.rotateRight
      #console.debug "rotateRight"
      @spaceShip.rotateRight()
    if @actions.rotateLeft
      #console.debug "rotateLeft"
      @spaceShip.rotateLeft()
    if @actions.thurst
      #console.debug "thurst"
      @spaceShip.thurst()
    if @actions.break
      #console.debug "break"
      @spaceShip.break()
    if @actions.fire
      @fire(@spaceShip, @bullets)

  checkCollision: (@sp, @as, @blt) ->
    geo = $("input[name='geometry']:checked").val()
    k = @geometries[geo].k
    # console.debug "k: "+k

    #handle asteroid/bullet collision
    for a, @asteroid of @as
      for b, @bullet of @blt
        # if(Math.pow(@asteroid.radius+@bullet.radius,2) > Math.pow(@bullet.q.x - @asteroid.q.x,2) + Math.pow(@bullet.q.y-@asteroid.q.y,2)) 
        if @asteroid.radius > metric(@asteroid.q, @bullet.q, k) 
          # vf = finalVelocity(@asteroid, @bullet)
          @asteroid.hp = @asteroid.hp - 1
          @sp.score = @sp.score + 1
          @blt.splice(b, 1)
          if @asteroid.hp <= 0
            @sp.score = @sp.score + 10
            @divideAsteroid(@asteroid, a)

    #handle asteroid/spaceShip collision
    if !@sp.hit
      for @asteroid in @as
        r = @asteroid.radius+@sp.radius
        r = Math.sqrt(r*r)
        # console.debug "radiusTotal: " + r
        # console.debug "metric: " + metric(@asteroid.q, @sp.q, k)
        if r > metric(@asteroid.q, @sp.q, k) 
          handleHit geo, @sp
          break

    #handle asteroid/asteroid collision
    # for a1, @asteroid1 of @as
      # for a2, @asteroid2 of @as
      #   if a1 != a2 
      #     r = @asteroid1.radius+@asteroid2.radius
      #     r = Math.sqrt(r*r)
      #     if r > metric(@asteroid1.q, @asteroid2.q, k) 
      #       vf = finalVelocity(@asteroid1, @asteroid2)
      #       @as[a1].p = vf.a
      #       @as[a2].p = vf.b

  divideAsteroid: (@old, @index) -> 
    if @old.initial
      asteroid1 = new cofgl.Asteroid(@old.q, {x:Math.random()/2, y:Math.random()/2}, false)
      asteroid2 = new cofgl.Asteroid(@old.q, {x:Math.random()/2, y:Math.random()/2}, false)
      @asteroids.push asteroid1
      @asteroids.push asteroid2
    @asteroids.splice(@index, 1)
    if @asteroids.length == 0
      @newWave()

  handleHit = (geo, @sp) ->
    @sp.hp = @sp.hp - 1
    if @sp.hp > 0
      @sp.hit = true
      @sp.hitShield()
    else
      cofgl.game.restart geo
      #gameOver

  metric = (z1, z2, k) ->
    #d(z1, z2) = 2arctanK| z1-z2 / 1 + Kz1z2_ |     
    ck = new cofgl.Complex(k, 0.0)
    cOne = new cofgl.Complex(1, 0)
    # numerator = z1.minus(z2)
    # denominator = cOne.plus(z1.times(z2.conjugate()).times(ck))
    # z = numerator.divide(denominator)
    z = z1.minus(z2).divide(cOne.plus(z1.times(z2.conjugate()).times(ck)))
    z = Math.sqrt(z.magnitude) #abs
    switch k
      when -1 then d = Math.atanh(z)
      when 0 then d = z
      when 1 then d = Math.atan(z)
    # console.log d
    return d*2

  # finalVelocity = (a, b) ->
  #   #ke =1/2*m*v^2
  #   #p = mv (em cada eixo )
  #   #v = p/m
  #   totalMass = new cofgl.Complex(a.mass + b.mass, 0.0)
  #   massDiff = new cofgl.Complex(a.mass - b.mass, 0.0)
  #   bMass = new cofgl.Complex(b.mass, 0.0)
  #   aMass = new cofgl.Complex(a.mass, 0.0)
  #   two = new cofgl.Complex(2.0, 0.0)

  #   console.log "a initial p:"
  #   console.log a.p
  #   #vaf = (2*mb*vbi + vai*(ma – mb))/(ma + mb)
  #   vaf = ((two.times(bMass).times(b.p)).plus(a.p.times(massDiff))).divide(totalMass)
  #   console.log "a final p:"
  #   console.log vaf
  #   console.log "b initial p:"
  #   console.log b.p
  #   #vbf = (2*ma*vai - vbi*(ma – mb))/(ma + mb)
  #   vbf = ((two.times(aMass).times(a.p)).plus(b.p.times(massDiff))).divide(totalMass)
  #   console.log "b final p:"
  #   console.log vbf
  #   return {a:vaf, b:vbf}

  fire: (@sp, @bullets) ->
    now = new Date()
    if now.getTime() - @sp.lastBulletTime >= @sp.bulletCooldown
      if @sp.bulletsUsed < 10 #max bullet stream
        bullet = new cofgl.Bullet(@sp.q, @sp.p, @sp.dir)
        @bullets.push bullet
        # console.log @sp.bulletsUsed
        @sp.bulletsUsed = @sp.bulletsUsed + 1
        # console.log @sp.bulletsUsed
        @sp.lastBulletTime = now.getTime()
    
  resetBulletCooldown: ->
    @sp.lastBulletTime = 0
    @sp.bulletsUsed = 0

  magnitude = (pa, pb)->
    [a, b] = [pa?.x - pb?.x, pa?.y - pb?.y]
    Math.sqrt Math.pow(a, 2) + Math.pow(b, 2)
  
  addAsteroid: -> 
    # #initial position won't be near the center
    randomQ = {x:(if Math.random()<.5 then -1 else 1)*(Math.random()*0.2 + 0.4), y:(if Math.random()<.5 then -1 else 1)*(Math.random()*0.2 + 0.4)}
    randomP = {x:Math.random()/3, y:Math.random()/3}
    asteroid = new cofgl.Asteroid(randomQ, randomP, true)
    @asteroids.push asteroid

  newWave: =>
    @spaceShip.wave = @spaceShip.wave + 1
    @addAsteroid() for i in [0...@spaceShip.wave]# + 2]

  render: ->
#    {gl} = cofgl.engine
    cofgl.clear()
    @processor.push()
    @world.draw()
    @processor.pop()

  compose: ->
    ctx = $('#composite')[0].getContext('2d')
    ctx.globalCompositeOperation = "source-over"
    ctx.drawImage($('#viewport')[0], 0, 0)
    ctx.drawImage($('#gui')[0], 0, 0)

  updateUI: (dt) ->
    guiCanvas = $('#gui')[0]
    gui = guiCanvas.getContext('2d')
    gui.clearRect(0, 0, guiCanvas.width, guiCanvas.height);

    gui.globalAlpha = 0.9
    gui.fillStyle = "#f00"
    #Lives
    gui.font = "bold 16px sans-serif"
    gui.fillText("Lives: " + @spaceShip.hp, 15, 20)
    #Score
    gui.font = "bold 16px sans-serif"
    gui.fillText("Score", guiCanvas.width - 60, 20)
    gui.font = "bold 18px sans-serif"
    gui.fillText(@spaceShip.score, guiCanvas.width - 60, 40)
    #Shield
      #tbd
    #Waves
    gui.font = "bold 16px sans-serif"
    gui.fillText("Wave: " + @spaceShip.wave, guiCanvas.width - 80, guiCanvas.height - 20)
    
    if @spaceShip.hit
      gui.globalAlpha = 0.5
      gui.fillStyle = "#000"
      gui.fillRect(guiCanvas.width/2 - 90, guiCanvas.height - 25, 160, 20)
      gui.globalAlpha = 1.0
      gui.fillStyle = "#00f"
      gui.fillText("Go to a safe zone!", guiCanvas.width/2 - 80, guiCanvas.height - 10)
    
initEngineAndGame = (selector, debug) ->
  canvas = $(selector)[0]
  cofgl.debugPanel = new cofgl.DebugPanel()
  cofgl.engine = new cofgl.Engine(canvas, debug)
  cofgl.resmgr = cofgl.makeDefaultResourceManager()
  cofgl.game = new Game
  cofgl.game.run()
  $("input[name='geometry']").change( -> cofgl.game.restart this.value)


$(document).ready ->
  debug = cofgl.getRuntimeParameter('debug') == '1'
  initEngineAndGame '#viewport', debug
  


root = self.cofgl ?= {}
root.game = null
root.geometries = null
root.debugPanel = null
root.resmgr = null
root.engine = null

# toCheck
# http://seb.ly/demos/JSTouchController/Touches.html
# http://seb.ly/demos/JSTouchController/TouchControl.html
# https://github.com/sebleedelisle/JSTouchController
