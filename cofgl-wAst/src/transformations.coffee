
class Inversion
  constructor: (@c0, @k) ->

  F: (c) ->
    l = ((c.x-@c0.x)*(c.x-@c0.x)+(c.y-@c0.y)*(c.y-@c0.y))
    r = new cofgl.Complex(
      @c0.x+@k*@k*(c.x-@c0.x)/l,
      @c0.y+@k*@k*(c.y-@c0.y)/l
    )
    #console.debug "Inv: #{r}"
    r

  D: (c,v) ->
    dx = (c.x-@c0.x)
    dy = (c.y-@c0.y)
    l = (dx*dx+dy*dy)
    f = @k*@k/(l*l)
    m11 = l-2.0*dx*dx
    m12 = -2.0*dx*dy
    m21 = m12
    m22 = -m11
    r = new cofgl.Complex(
      f*m11*v.x + f*m12*v.y,
      f*m21*v.x + f*m22*v.y
    )
    #console.debug "DInv: #{v} -> #{r}"
    r

class ReflectionOrigin
  constructor: (@l) ->

  F: (c) ->
    f = 2.0*(c.x*@l.x+c.y*@l.y)/(@l.x*@l.x+@l.y*@l.y)
    #console.debug "#{f*@l.x-c.x}, #{f*@l.y-c.y}"
    new cofgl.Complex(
      f*@l.x-c.x, f*@l.y-c.y
    )

  D: (c,v) ->
    lx2 = @l.x*@l.x
    ly2 = @l.y*@l.y
    m11 = 2.0*lx2/(lx2+ly2)-1.0
    m12 = 2.0*@l.x*@l.y/(lx2+ly2)
    m21 = m12
    m22 = -m11
    #console.debug "[[#{m11},#{m12}],[#{m21},#{m22}]]"
    new cofgl.Complex(
      m11*v.x + m12*v.y,
      m21*v.x + m22*v.y
    )

root = self.cofgl ?= {}
root.Inversion = Inversion
root.ReflectionOrigin = ReflectionOrigin