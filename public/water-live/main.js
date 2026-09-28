/*
 * Local curated version of Evan Wallace's WebGL Water demo.
 * Original: http://madebyevan.com/webgl-water/
 * Copyright 2011 Evan Wallace — MIT License.
 *
 * Website adaptation: camera normal to the water surface, no sphere,
 * edge-to-edge cropped water field, occasional gentle ripples.
 */

var gl = GL.create();
var water;
var cubemap;
var renderer;

window.onload = function() {
  var ratio = Math.min(window.devicePixelRatio || 1, 1.6);

  function onresize() {
    var width = innerWidth;
    var height = innerHeight;
    gl.canvas.width = Math.max(1, Math.round(width * ratio));
    gl.canvas.height = Math.max(1, Math.round(height * ratio));
    gl.canvas.style.width = width + 'px';
    gl.canvas.style.height = height + 'px';
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.matrixMode(gl.PROJECTION);
    gl.loadIdentity();
    gl.perspective(39, gl.canvas.width / gl.canvas.height, 0.01, 100);
    gl.matrixMode(gl.MODELVIEW);
    draw();
  }

  document.body.appendChild(gl.canvas);
  gl.canvas.setAttribute('aria-label', 'Living rippling water surface');
  gl.clearColor(0.006, 0.018, 0.026, 1);
  document.documentElement.dataset.waterView = 'normal';
  document.documentElement.dataset.waterBounds = 'cropped-edge-to-edge';
  document.documentElement.dataset.poolWidth = 'baseline';
  document.documentElement.dataset.waveDriving = 'occasional-drops-only';
  document.documentElement.dataset.viewScale = 'pulled-back';
  document.documentElement.dataset.dropCadence = 'moderately-more-frequent';

  water = new Water();
  renderer = new Renderer();
  cubemap = new Cubemap({
    xneg: document.getElementById('xneg'),
    xpos: document.getElementById('xpos'),
    yneg: document.getElementById('ypos'),
    ypos: document.getElementById('ypos'),
    zneg: document.getElementById('zneg'),
    zpos: document.getElementById('zpos')
  });

  if (!water.textureA.canDrawTo() || !water.textureB.canDrawTo()) {
    throw new Error('Rendering to floating-point textures is required but not supported');
  }

  renderer.sphereCenter = new GL.Vector(0, -20, 0);
  renderer.sphereRadius = 0.01;

  var seeds = [
    [-0.38, -0.16, 0.034,  0.0045],
    [ 0.34,  0.24, 0.038, -0.0040]
  ];
  for (var i = 0; i < seeds.length; i++) {
    water.addDrop(seeds[i][0], seeds[i][1], seeds[i][2], seeds[i][3]);
  }
  for (var warm = 0; warm < 10; warm++) water.stepSimulation();
  water.updateNormals();
  renderer.updateCaustics(water);

  onresize();

  var prevTime = new Date().getTime();
  var elapsed = 0;
  var nextDrop = 4.0;
  var dropIndex = 0;
  var pattern = [
    [-0.66, -0.34, 0.031,  0.0042],
    [ 0.46, -0.20, 0.027, -0.0038],
    [-0.12,  0.38, 0.026,  0.0036],
    [ 0.31,  0.50, 0.029, -0.0037],
    [-0.43,  0.13, 0.026,  0.0035],
    [ 0.62,  0.24, 0.025, -0.0034],
    [ 0.06, -0.53, 0.028,  0.0039],
    [-0.28, -0.05, 0.024, -0.0033]
  ];

  function animate() {
    var now = new Date().getTime();
    var dt = Math.min(0.04, Math.max(0, (now - prevTime) / 1000));
    prevTime = now;
    elapsed += dt;

    if (elapsed >= nextDrop) {
      var p = pattern[dropIndex % pattern.length];
      water.addDrop(p[0], p[1], p[2], p[3]);
      dropIndex++;
      nextDrop = elapsed + 5.5 + (dropIndex % 3) * 1.15;
    }

    water.stepSimulation();
    water.stepSimulation();
    water.updateNormals();
    renderer.updateCaustics(water);
    draw();
    requestAnimationFrame(animate);
  }

  requestAnimationFrame(animate);
  window.onresize = onresize;
};

function draw() {
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.loadIdentity();

  // Look exactly along the surface normal. The camera is deliberately
  // close enough that the square simulation domain is wider/taller than the
  // viewport. The browser frame therefore crops an effectively unbounded
  // patch of water instead of revealing the pool walls.
  gl.translate(0, 0, -1.40);
  gl.rotate(90, 1, 0, 0);

  gl.enable(gl.DEPTH_TEST);
  renderer.sphereCenter = new GL.Vector(0, -20, 0);
  renderer.sphereRadius = 0.01;

  // Do not draw the pool geometry. The water shader still supplies the
  // physically motivated reflection/refraction response, but no wall or rim
  // can appear as a foreground container boundary.
  renderer.renderWater(water, cubemap);
  gl.disable(gl.DEPTH_TEST);
}
