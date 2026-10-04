
class World
  constructor: (@game) ->
    @vbo = cofgl.makeQuadVBO()
    @backgroundShader = cofgl.resmgr.resources['shaders/starfield']

  draw: ->
    cofgl.clear '#fff'

  #starField
    cofgl.withContext [@backgroundShader], =>
      @backgroundShader.uniform1f "time", @game.time
      @backgroundShader.uniform2f "resolution", cofgl.engine.width, cofgl.engine.height
      @vbo.draw()

    this.drawObject asteroid for asteroid in @game.asteroids
    this.drawObject bullet for bullet in @game.bullets

  #SpaceShip: hidden after game over, blinking while the shield is up
    ship = @game.spaceShip
    if @game.state != 'gameover' and Math.floor(ship.shield * 8) % 2 == 0
      this.drawObject ship

  drawObject: (obj) ->
    shader = @game.geometry.shader
    cofgl.withContext [shader, obj.texture], =>
      shader.uniform2f "uq", obj.q.x, obj.q.y
      shader.uniform2f "up", obj.p.x, obj.p.y
      shader.uniform2f "udir", obj.dir.x, obj.dir.y
      shader.uniform1f "texSize", obj.ts
      shader.uniform1f "inverted", obj.inv
      @vbo.draw()


root = self.cofgl ?= {}
root.World = World
