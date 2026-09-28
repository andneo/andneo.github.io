/*
 * Local curated version of Evan Wallace's WebGL Water demo.
 * Original: http://madebyevan.com/webgl-water/
 * Copyright 2011 Evan Wallace — MIT License.
 *
 * Website adaptation: fixed near-top-down camera, no sphere,
 * wide rectangular presentation, continuous autonomous ripples.
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
  gl.clearColor(0.008, 0.022, 0.032, 1);

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
    [-0.55, -0.20, 0.040,  0.010],
    [ 0.48,  0.28, 0.046, -0.008],
    [-0.14,  0.50, 0.035,  0.008],
    [ 0.24, -0.46, 0.042, -0.007],
    [ 0.03,  0.05, 0.032,  0.006]
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
  var nextDrop = 0.15;
  var dropIndex = 0;
  var pattern = [
    [-0.66, -0.34, 0.031,  0.0062],
    [ 0.46, -0.20, 0.027, -0.0055],
    [-0.12,  0.38, 0.026,  0.0050],
    [ 0.31,  0.50, 0.029, -0.0052],
    [-0.43,  0.13, 0.026,  0.0048],
    [ 0.62,  0.24, 0.025, -0.0046],
    [ 0.06, -0.53, 0.028,  0.0054],
    [-0.28, -0.05, 0.024, -0.0044]
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
      nextDrop = elapsed + 0.28 + (dropIndex % 4) * 0.055;
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

  // Strongly overhead, but still oblique enough to retain reflections,
  // refraction and a sense of depth.
  gl.translate(0, 0, -3.05);
  gl.rotate(69, 1, 0, 0);
  gl.rotate(180, 0, 1, 0);
  gl.translate(0, 0.34, 0);

  // Present the square simulation domain as a wide installation window.
  // Both pool and water are transformed together, preserving their alignment.
  gl.scale(1.38, 1.0, 0.78);

  gl.enable(gl.DEPTH_TEST);
  renderer.sphereCenter = new GL.Vector(0, -20, 0);
  renderer.sphereRadius = 0.01;
  renderer.renderCube();
  renderer.renderWater(water, cubemap);
  gl.disable(gl.DEPTH_TEST);
}
