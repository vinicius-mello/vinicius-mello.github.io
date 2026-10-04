Non-Euclidean Spaceship
=======================

Asteroids on three closed surfaces: a flat torus, the projective plane
(curvature +1) and a genus-2 surface (curvature −1). The math is in
`asteroids/details.html`.

Plain ES modules, no build step; serve the repository with any static server
(module scripts don't load from `file://`):

    python -m http.server   # then open /cofgl-wAst/asteroids/index.html

- `asteroids/js/geometry.js`: geodesic integrator, gluing maps, distances, aiming
- `asteroids/js/entities.js`: ship, asteroids, bullets, the enemy saucer
- `asteroids/js/sprites.js`: saucer and enemy shot, drawn on a canvas
- `asteroids/js/game.js`: game state, input, HUD, main loop (entry point)
- `asteroids/js/renderer.js`: WebGL; each sprite is a full-screen quad whose
  fragment shader (`asteroids/assets/shaders/`) applies the isometry and the
  gluings
- `asteroids/js/gluing.js`: fundamental domain overlay

Originally written in CoffeeScript on the "cofgl" engine, derived from
webglmc (see `LICENSE.webglmc`; `common.glsl` and `fxaa.glsl` come from it).
