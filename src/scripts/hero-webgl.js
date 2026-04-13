const canvas = document.getElementById("hero-canvas");
const gl = canvas.getContext("webgl");

if (!gl) {
  console.error("WebGL not supported");
}

/* ─────────────────────────────────────────────
   Resize (FIXED)
───────────────────────────────────────────── */
let DPR = Math.min(window.devicePixelRatio, 2);
let W = 0, H = 0;

function resize() {
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * DPR;
  canvas.height = rect.height * DPR;

  W = canvas.width;
  H = canvas.height;

  gl.viewport(0, 0, W, H);
}
resize();
window.addEventListener("resize", resize);

/* ─────────────────────────────────────────────
   Shader helpers (WITH ERROR LOGGING)
───────────────────────────────────────────── */
function createShader(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);

  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(s));
  }
  return s;
}

/* ─────────────────────────────────────────────
   Minimal aesthetic shaders
───────────────────────────────────────────── */
const vs = `
attribute vec2 position;
attribute float order;
uniform vec2 resolution;
uniform float pointSize;

varying float vOrder;

void main() {
  vec2 clip = (position / resolution) * 2.0 - 1.0;
  gl_Position = vec4(clip * vec2(1.0, -1.0), 0.0, 1.0);
  gl_PointSize = pointSize;
  vOrder = order;
}
`;

const fs = `
precision mediump float;
varying float vOrder;

void main() {
  vec2 c = gl_PointCoord - vec2(0.5);
  float d = length(c);

  if (d > 0.5) discard;

  // soft radial falloff
  float alpha = smoothstep(0.5, 0.2, d);

  // minimal palette (cream → amber)
  vec3 cold = vec3(0.85, 0.82, 0.75);
  vec3 hot  = vec3(1.0, 0.65, 0.2);

  vec3 color = mix(hot, cold, vOrder);

  gl_FragColor = vec4(color, alpha * 0.9);
}
`;

const program = gl.createProgram();
gl.attachShader(program, createShader(gl.VERTEX_SHADER, vs));
gl.attachShader(program, createShader(gl.FRAGMENT_SHADER, fs));
gl.linkProgram(program);

if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
  console.error(gl.getProgramInfoLog(program));
}

gl.useProgram(program);

const posLoc = gl.getAttribLocation(program, "position");
const orderLoc = gl.getAttribLocation(program, "order");
const resLoc = gl.getUniformLocation(program, "resolution");
const sizeLoc = gl.getUniformLocation(program, "pointSize");

/* ─────────────────────────────────────────────
   Simulation (denser + stable)
───────────────────────────────────────────── */
let particles = [];

function init() {
  particles = [];

  const area = W * H;
  const N = Math.min(1800, Math.floor(area / 3500));

  for (let i = 0; i < N; i++) {
    particles.push({
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - 0.5) * 1.5,
      vy: (Math.random() - 0.5) * 1.5,
      order: 0,
    });
  }
}

init();

/* ─────────────────────────────────────────────
   Physics (soft + stable)
───────────────────────────────────────────── */
let t = 0;

function step() {
  t += 0.01;
  const temp = 0.15 + 0.6 * (0.5 + 0.5 * Math.sin(t * 0.3));

  for (let p of particles) {
    p.vx += (Math.random() - 0.5) * temp;
    p.vy += (Math.random() - 0.5) * temp;

    p.vx *= 0.985;
    p.vy *= 0.985;

    p.x += p.vx;
    p.y += p.vy;

    // container bounds (FIXED)
    if (p.x < 0) { p.x = 0; p.vx *= -1; }
    if (p.x > W) { p.x = W; p.vx *= -1; }
    if (p.y < 0) { p.y = 0; p.vy *= -1; }
    if (p.y > H) { p.y = H; p.vy *= -1; }
  }

  computeOrder();
}

/* ─────────────────────────────────────────────
   Order parameter (local alignment proxy)
───────────────────────────────────────────── */
function computeOrder() {
  for (let p of particles) {
    let sum = 0;
    let count = 0;

    for (let q of particles) {
      let dx = q.x - p.x;
      let dy = q.y - p.y;
      let d = dx*dx + dy*dy;

      if (d > 0 && d < 4000) {
        sum += Math.cos(Math.atan2(dy, dx) * 6);
        count++;
      }
    }

    p.order = count ? Math.abs(sum / count) : 0;
  }
}

/* ─────────────────────────────────────────────
   Buffers
───────────────────────────────────────────── */
const posBuffer = gl.createBuffer();
const orderBuffer = gl.createBuffer();

/* ─────────────────────────────────────────────
   Draw (FIXED TRAILS)
───────────────────────────────────────────── */
function draw() {
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  // subtle fade instead of transparent wipe
  gl.clearColor(0.05, 0.05, 0.04, 0.15);
  gl.clear(gl.COLOR_BUFFER_BIT);

  const positions = [];
  const orders = [];

  for (let p of particles) {
    positions.push(p.x, p.y);
    orders.push(p.order);
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.DYNAMIC_DRAW);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(posLoc);

  gl.bindBuffer(gl.ARRAY_BUFFER, orderBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(orders), gl.DYNAMIC_DRAW);
  gl.vertexAttribPointer(orderLoc, 1, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(orderLoc);

  gl.uniform2f(resLoc, W, H);

  // responsive particle size (FIXED)
  const size = Math.max(3, Math.min(10, W / 180));
  gl.uniform1f(sizeLoc, size);

  gl.drawArrays(gl.POINTS, 0, particles.length);
}

/* ─────────────────────────────────────────────
   Loop
───────────────────────────────────────────── */
function loop() {
  step();
  draw();
  requestAnimationFrame(loop);
}

loop();