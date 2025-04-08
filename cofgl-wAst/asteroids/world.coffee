
class World
  constructor: (@spaceShip, @asteroids, @bullets, @c) ->
    @shader = cofgl.game.geometry.shader
    @bgColor = cofgl.floatColorFromHex '#F2F3DC'
    @vbo = cofgl.makeQuadVBO()
    @spaceShip.world = this
    now = new Date()
    @startTime = now.getTime()
    for @asteroid in @asteroids
      @asteroid.world = this
    for @bullet in @bullets
      @bullet.world = this
    @backgroundShader = cofgl.resmgr.resources['shaders/starfield']

    #cofgl.engine.height/width/aspect

  update: (dt) ->

  draw: ->
    #   {gl} = cofgl.engine
    cofgl.clear '#fff'#@bgColor

  #starField 
    now = new Date()
    time = now.getTime() - @startTime
    cofgl.withContext [@backgroundShader], =>
      @backgroundShader.uniform1f "time", time/1000
      @backgroundShader.uniform2f "resolution", cofgl.engine.width, cofgl.engine.height
      @vbo.draw()

  #Asteroids
    for @asteroid in @asteroids
      q = @asteroid.q
      p = @asteroid.p
      dir = @asteroid.dir
      ts = @asteroid.ts
      inverted = @asteroid.inv
      cSides = @asteroid.cSides
      cofgl.withContext [@shader, @asteroid.texture], =>
        @shader.uniform2f "uq", q.x, q.y
        @shader.uniform2f "up", p.x, p.y
        @shader.uniform2f "udir", dir.x, dir.y
        @shader.uniform1f "texSize", ts
        @shader.uniform1f "inverted", inverted
        @shader.uniform1f "glueSide1", cSides[1]
        @shader.uniform2f "glueSide2", cSides[0]
        @vbo.draw()

#Bullets
    for @bullet in @bullets
      q = @bullet.q
      p = @bullet.p
      dir = @bullet.dir
      ts = @bullet.ts
      inverted = @bullet.inv
      cSides = @bullet.cSides
      cofgl.withContext [@shader, @bullet.texture], =>
        @shader.uniform2f "uq", q.x, q.y
        @shader.uniform2f "up", p.x, p.y
        @shader.uniform2f "udir", dir.x, dir.y
        @shader.uniform1f "texSize", ts
        @shader.uniform1f "inverted", inverted
        @shader.uniform1f "glueSide1", cSides[1]
        @shader.uniform2f "glueSide2", cSides[0]
        @vbo.draw()

  #SpaceShip
    q = @spaceShip.q
    p = @spaceShip.p
    dir = @spaceShip.dir
    ts = @spaceShip.ts
    inverted = @spaceShip.inv
    cSides = @spaceShip.cSides
    # console.log cSides[1] + " e " + cSides[0]
    cofgl.withContext [@shader, @spaceShip.texture], =>
      @shader.uniform2f "uq", q.x, q.y
      @shader.uniform2f "up", p.x, p.y
      @shader.uniform2f "udir", dir.x, dir.y
      @shader.uniform1f "texSize", ts
      @shader.uniform1f "inverted", inverted
      @shader.uniform1f "glueSide1", cSides[1]
      @shader.uniform2f "glueSide2", cSides[0]
      @vbo.draw()
    

root = self.cofgl ?= {}
root.World = World
