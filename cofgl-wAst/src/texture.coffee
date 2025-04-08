createAndPushTexture = (width, height, options = {}, image = null) ->
  {gl} = cofgl.engine
  if options.forcePOT ? true
    storedWidth = cofgl.nextPowerOfTwo width
    storedHeight = cofgl.nextPowerOfTwo height
  else
    storedWidth = width
    storedHeight = height
  texture = new Texture width, height, storedWidth, storedHeight, 0, 0
  texture.unit = options.unit ? 0
  texture.id = gl.createTexture()
  texture.push()

  filtering = options.filtering ? 'LINEAR'
  filter = mipmapFilter = gl[filtering]

  if options.flipY ? true
    gl.pixelStorei gl.UNPACK_FLIP_Y_WEBGL, true

  if image
    # gl.texImage2D gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image
    gl.texImage2D gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image
  else
    gl.texImage2D gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null
  gl.texParameteri gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter

  if options.clampToEdge
    gl.texParameteri gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE
    gl.texParameteri gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE

  if options.mipmaps
    mipmapFilter = gl["#{filtering}_MIPMAP_#{filtering}"]
  gl.texParameteri gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmapFilter

  if options.mipmaps
    gl.generateMipmap gl.TEXTURE_2D

  texture


class Texture extends cofgl.ContextObject
  @withStack 'texture'

  constructor: (width, height, storedWidth, storedHeight, offsetX, offsetY) ->
    @id = -1
    @unit = 0
    @width = width
    @height = height
    @storedWidth = storedWidth
    @storedHeight = storedHeight
    @offsetX = offsetX
    @offsetY = offsetY
    @parent = null
    @name = "uTexture"

  bind: ->
    {gl} = cofgl.engine
    gl.activeTexture gl.TEXTURE0 + @unit
    gl.bindTexture gl.TEXTURE_2D, @id
    shader = cofgl.Shader.top()
    if shader
      shader.uniform1i @name, @unit

  unbind: ->
    {gl} = cofgl.engine
    gl.bindTexture gl.TEXTURE_2D, null

  destroy: ->
    if @parent
      return
    cofgl.engine.gl.deleteTexture @id

  scaleCoords: (coords) ->
    facX = @width / @storedWidth
    facY = @height / @storedHeight
    offX = @offsetX / @storedWidth
    offY = @offsetY / @storedHeight

    rv = new Array coords.length
    for coord, idx in coords
      if idx % 2 == 0
        coord = coord * facX + offX
      else
        coord = coord * facY + offY
      rv[idx] = coord
    rv

  slice: (x, y, width, height) ->
    return new TextureSlice this, @offsetX + x, @offsetY + y,
      width, height

  this.fromSize = (width, height, options = {}) ->
    {gl} = cofgl.engine
    texture = createAndPushTexture width, height, options
    if !options.pushTexture
      texture.pop()
    texture

  this.fromImage = (image, options = {}) ->
    texture = createAndPushTexture image.width, image.height, options, image
    filename = cofgl.autoShortenFilename(image.src || '<dynamic>')
    console.debug "Created texture from '#{filename}' [dim=#{image.width}x#{image.height}, filtering=#{options.filtering || 'LINEAR'}] ->", texture
    texture.pop()
    texture


class TextureSlice extends Texture
  constructor: (texture, offsetX, offsetY, width, height) ->
    super(width, height, texture.storedWidth, texture.storedHeight,
          offsetX, offsetY)
    @parent = texture
    @id = texture.id
    @unit = texture.unit


root = self.cofgl ?= {}
root.Texture = Texture
