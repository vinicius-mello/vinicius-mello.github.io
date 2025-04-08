checkFBO = ->
  {gl} = cofgl.engine
  result = gl.checkFramebufferStatus gl.FRAMEBUFFER
  if result != gl.FRAMEBUFFER_COMPLETE
    throw 'Framebuffer problem: ' + WebGLDebugUtils.glEnumToString(result)


class RenderBufferObject extends cofgl.ContextObject
  @withStack 'rbo'

  constructor: (width, height, format) ->
    {gl} = cofgl.engine
    @format = gl[format]
    @id = gl.createRenderbuffer()
    this.push()
    gl.renderbufferStorage gl.RENDERBUFFER, @format, width, height
    this.pop()

  this.makeDepthBuffer = (width, height) ->
    return new RenderBufferObject width, height, 'DEPTH_COMPONENT16'

  bind: ->
    {gl} = cofgl.engine
    gl.bindRenderbuffer gl.RENDERBUFFER, @id

  unbind: ->
    {gl} = cofgl.engine
    gl.bindRenderbuffer gl.RENDERBUFFER, null


class FrameBufferObject extends cofgl.ContextObject
  @withStack 'fbo'

  constructor: (width, height, options = {}) ->
    {gl} = cofgl.engine
    @width = width ? cofgl.engine.width
    @height = height ? cofgl.engine.height
    @id = gl.createFramebuffer()
    @texture = cofgl.Texture.fromSize @width, @height,
      flipY:        false
      mipmaps:      false
      forcePOT:     options.forcePOT ? false
      filtering:    options.filtering ? 'NEAREST'
      clampToEdge:  options.clampToEdge ? true
      pushTexture:  true
    this.executeWithContext =>
      gl.framebufferTexture2D gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D, @texture.id, 0
      @depthBuffer = RenderBufferObject.makeDepthBuffer @width, @height
      this.attachRenderBuffer 'DEPTH_ATTACHMENT', @depthBuffer
      checkFBO()
    @texture.pop()

  attachRenderBuffer: (attachmentType, rbo) ->
    this.executeWithContext ->
      {gl} = cofgl.engine
      type = gl[attachmentType]
      gl.framebufferRenderbuffer gl.FRAMEBUFFER, type,
        gl.RENDERBUFFER, rbo.id

  bind: ->
    {gl} = cofgl.engine
    gl.bindFramebuffer gl.FRAMEBUFFER, @id

  unbind: ->
    {gl} = cofgl.engine
    gl.bindFramebuffer gl.FRAMEBUFFER, null


root = self.cofgl ?= {}
root.RenderBufferObject = RenderBufferObject
root.FrameBufferObject = FrameBufferObject
