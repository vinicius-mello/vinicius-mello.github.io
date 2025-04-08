RESOURCES = [
  ['shaders/hyperbolic', 'assets/shaders/hyperbolic.glsl'],
  ['shaders/hyperbolic_bg', 'assets/shaders/hyperbolic_bg.glsl'],
  ['shaders/elliptic', 'assets/shaders/elliptic.glsl'],
  ['shaders/euclidean', 'assets/shaders/euclidean.glsl'],
  ['shaders/postprocess', '../assets/shaders/postprocess.glsl'],
  ['shaders/nothing', '../assets/shaders/nothing.glsl'],
  ['shaders/starfield', 'assets/shaders/starfield.glsl'],
  ['space/asteroid', 'assets/textures/bwAst.png'],
  ['space/asteroid1', 'assets/textures/roundAst.png'],
  ['space/laser', 'assets/textures/laser.png'],
  ['space/spaceship', 'assets/textures/spaceship.png'],
  ['space/2spaceship', 'assets/textures/2spaceship.png'],
  ['space/spaceship', 'assets/textures/spaceship.png'],
]


makeDefaultResourceManager = ->
  resmgr = new cofgl.ResourceManager
  resmgr.addFromList RESOURCES
  resmgr


root = self.cofgl ?= {}
root.makeDefaultResourceManager = makeDefaultResourceManager
