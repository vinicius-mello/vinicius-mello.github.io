requestAnimationFrame = (
  window.requestAnimationFrame       ||
  window.webkitRequestAnimationFrame ||
  window.mozRequestAnimationFrame    ||
  window.oRequestAnimationFrame      ||
  window.msRequestAnimationFrame)


makeGLContext = (canvas, debug, options) ->
  try
    ctx = canvas.getContext('webgl', options) ||
      canvas.getContext('experimental-webgl', options)
  catch e
    alert "Error: This browser does not support WebGL"
    return null
  if debug
    ctx = WebGLDebugUtils.makeDebugContext ctx, (err, funcName, args) ->
      args = (x for x in args)
      errorStr = WebGLDebugUtils.glEnumToString(err)
      console.error "WebGL Error: func=#{funcName} args=", args, " error=", errorStr
      console.trace?()
      throw "Aborting rendering after critical WebGL error"
  ctx


clear = (color = cofgl.floatColorFromHex '#ffffff') ->
  {gl} = cofgl.engine
  # No splats because of chrome bug
  gl.clearColor color[0], color[1], color[2], color[3]
  gl.clear gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT


class Engine
  constructor: (canvas, debug = false) ->
    @debug = debug
    @canvas = canvas
    @throbber = $('<img src=assets/throbber.gif id=throbber>')
      .appendTo('body')
      .hide()
    @throbberLevel = 0

    #@frameTimeDisplay = cofgl.debugPanel.addDisplay 'Frame time'
    @FPSDisplay = cofgl.debugPanel.addDisplay 'FPS'

    @gl = makeGLContext canvas, @debug,
      antialias: false
    @width = @canvas.width
    @height = @canvas.height
    @aspect = @canvas.width / @canvas.height

    @gl.enable @gl.DEPTH_TEST
    @gl.depthFunc @gl.LEQUAL
    @gl.enable @gl.CULL_FACE
    @gl.cullFace @gl.BACK
    @gl.enable @gl.BLEND
    @gl.blendFunc @gl.SRC_ALPHA, @gl.ONE_MINUS_SRC_ALPHA

    @model = new MatrixStack
    @view = new MatrixStack
    @projection = new MatrixStack
    @_uniformVersion = 0
    this.markMVPDirty()

    console.debug 'Render canvas =', @canvas
    console.debug 'WebGL context =', @gl

  pushThrobber: ->
    if @throbberLevel++ == 0
      @throbber.fadeIn()

  popThrobber: ->
    if --@throbberLevel == 0
      @throbber.fadeOut()

  markMVPDirty: ->
    @_uniformVersion++
    @_frustum = null
    @_mvp = null
    @_modelView = null
    @_normal = null
    @_iview = null
    @_ivp = null

  getModelView: ->
    @_modelView ?= mat4.multiply @view.top, @model.top

  getModelViewProjection: ->
    @_mvp ?= mat4.multiply @projection.top, this.getModelView(), mat4.create()

  getNormal: ->
    @_normal = mat4.toInverseMat3 @model.top

  getCurrentFrustum: ->
    @_frustum ?= new cofgl.Frustum this.getModelViewProjection()

  getInverseView: ->
    @_iview ?= mat4.inverse @view.top, mat4.create()

  getInverseViewProjection: ->
    viewproj = mat4.multiply @projection.top, @view.top, mat4.create()
    @_ivp ?= mat4.inverse viewproj

  getCameraPos: ->
    iview = this.getInverseView()
    vec3.create [iview[12], iview[13], iview[14]]

  getForward: ->
    vec3.create [-@view.top[2], -@view.top[6], -@view.top[10]]

  flushUniforms: ->
    shader = cofgl.Shader.top()
    if shader._uniformVersion == @_uniformVersion
      return

    shader.uniform2f "uViewportSize", @width, @height
    shader.uniformMatrix4fv "uModelMatrix", @model.top
    shader.uniformMatrix4fv "uViewMatrix", @view.top
    shader.uniformMatrix4fv "uModelViewMatrix", this.getModelView()
    shader.uniformMatrix4fv "uProjectionMatrix", @projection.top
    shader.uniformMatrix4fv "uModelViewProjectionMatrix", this.getModelViewProjection()
    shader.uniformMatrix3fv "uNormalMatrix", this.getNormal()

    shader._uniformVersion = @_uniformVersion

  mainloop: (iterate) ->
    lastTimestamp = null
    step = (timestamp) =>
      if not lastTimestamp?
        lastTimestamp = timestamp
        requestAnimationFrame step
      else 
        dt = timestamp - lastTimestamp
        #@frameTimeDisplay.setText dt + 'ms'
        @FPSDisplay.setText Math.floor(1000/dt) + 'FPS'
        iterate dt / 1000.0
        lastTimestamp = timestamp
        requestAnimationFrame step
    requestAnimationFrame step


class MatrixStack
  constructor: ->
    @top = mat4.identity()
    @stack = []

  set: (value) ->
    @top = value
    cofgl.engine.markMVPDirty()

  identity: ->
    this.set mat4.identity()

  multiply: (mat) ->
    mat4.multiply @top, mat
    cofgl.engine.markMVPDirty()

  translate: (vector) ->
    mat4.translate @top, vector
    cofgl.engine.markMVPDirty()

  rotate: (angle, axis) ->
    mat4.rotate @top, angle, axis
    cofgl.engine.markMVPDirty()

  scale: (vector) ->
    mat4.scale @top, vector
    cofgl.engine.markMVPDirty()

  push: (mat = null) ->
    if !mat
      @stack.push mat4.create mat
      @top = mat4.create mat
    else
      @stack.push mat4.create mat
    null

  pop: ->
    @top = @stack.pop()
    cofgl.engine.markMVPDirty()


root = self.cofgl ?= {}
root.Engine = Engine
root.clear = clear
