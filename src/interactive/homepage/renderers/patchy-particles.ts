import type { HomepageRenderer } from './types';

const TAU = Math.PI * 2;
const PATCH_COUNT = 3;
const PATCH_STEP = TAU / PATCH_COUNT;
const TARGET_FRAME_SECONDS = 1 / 60;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const wrapAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

function createRng(seed = 0x51f15e) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export function createPatchyParticleRenderer(canvas: HTMLCanvasElement): HomepageRenderer {
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) throw new Error('Canvas 2D is unavailable');
  const ctx: CanvasRenderingContext2D = context;

  const rng = createRng();
  let width = 1;
  let height = 1;
  let dpr = 1;
  let count = 0;
  let radius = 4;
  let diameter = 8;
  let cutoff = 30;
  let cellSize = 32;
  let columns = 1;
  let rows = 1;
  let elapsed = 12;
  let scrollProgress = 0;
  let reducedMotion = false;
  let pointerX = 0;
  let pointerY = 0;
  let pointerActive = false;
  let disposed = false;
  let colors = {
    particle: 'rgba(32, 78, 70, .54)',
    ordered: 'rgba(177, 91, 42, .72)',
    patch: 'rgba(130, 71, 39, .72)',
    bond: 'rgba(34, 91, 80, .34)',
  };

  let x = new Float32Array(0);
  let y = new Float32Array(0);
  let vx = new Float32Array(0);
  let vy = new Float32Array(0);
  let angle = new Float32Array(0);
  let omega = new Float32Array(0);
  let fx = new Float32Array(0);
  let fy = new Float32Array(0);
  let torque = new Float32Array(0);
  let order = new Float32Array(0);
  let coordination = new Uint8Array(0);
  let next = new Int32Array(0);
  let heads = new Int32Array(1);
  let bondA = new Int32Array(0);
  let bondB = new Int32Array(0);
  let bondStrength = new Float32Array(0);
  let bondCount = 0;

  const lowCapability = () => {
    const cores = navigator.hardwareConcurrency || 4;
    return cores <= 4 || matchMedia('(max-width: 720px)').matches;
  };

  function allocate(nextCount: number) {
    count = nextCount;
    x = new Float32Array(count);
    y = new Float32Array(count);
    vx = new Float32Array(count);
    vy = new Float32Array(count);
    angle = new Float32Array(count);
    omega = new Float32Array(count);
    fx = new Float32Array(count);
    fy = new Float32Array(count);
    torque = new Float32Array(count);
    order = new Float32Array(count);
    coordination = new Uint8Array(count);
    next = new Int32Array(count);
    bondA = new Int32Array(Math.max(24, count * 4));
    bondB = new Int32Array(bondA.length);
    bondStrength = new Float32Array(bondA.length);
  }

  function minimumImage(delta: number, span: number) {
    if (delta > span * 0.5) return delta - span;
    if (delta < -span * 0.5) return delta + span;
    return delta;
  }

  function rebuildGrid() {
    heads.fill(-1);
    for (let i = 0; i < count; i++) {
      const gx = clamp(Math.floor(x[i] / cellSize), 0, columns - 1);
      const gy = clamp(Math.floor(y[i] / cellSize), 0, rows - 1);
      const cell = gy * columns + gx;
      next[i] = heads[cell];
      heads[cell] = i;
    }
  }

  function patchAlignment(particleAngle: number, targetAngle: number) {
    let best = -1;
    for (let patch = 0; patch < PATCH_COUNT; patch++) {
      const value = Math.cos(wrapAngle(targetAngle - (particleAngle + patch * PATCH_STEP)));
      if (value > best) best = value;
    }
    return best;
  }

  function patchTorque(particleAngle: number, targetAngle: number) {
    let bestDelta = Math.PI;
    for (let patch = 0; patch < PATCH_COUNT; patch++) {
      const delta = wrapAngle(targetAngle - (particleAngle + patch * PATCH_STEP));
      if (Math.abs(delta) < Math.abs(bestDelta)) bestDelta = delta;
    }
    return bestDelta;
  }

  function initialiseParticles() {
    const clusterCount = clamp(Math.round(Math.sqrt(count) / 3.4), 3, 6);
    const clusterX = new Float32Array(clusterCount);
    const clusterY = new Float32Array(clusterCount);
    const clusterAngle = new Float32Array(clusterCount);
    for (let c = 0; c < clusterCount; c++) {
      clusterX[c] = rng() * width;
      clusterY[c] = rng() * height;
      clusterAngle[c] = rng() * TAU;
    }

    const particlesPerCluster = Math.ceil(count / clusterCount);
    const side = Math.ceil(Math.sqrt(particlesPerCluster));
    const latticeSpacing = diameter * 1.42;
    const rowSpacing = latticeSpacing * 0.8660254;

    for (let i = 0; i < count; i++) {
      const cluster = i % clusterCount;
      const local = Math.floor(i / clusterCount);
      const row = Math.floor(local / side);
      const column = local % side;
      const ox = (column - (side - 1) * 0.5) * latticeSpacing + (row % 2) * latticeSpacing * 0.5;
      const oy = (row - (side - 1) * 0.5) * rowSpacing;
      const cos = Math.cos(clusterAngle[cluster]);
      const sin = Math.sin(clusterAngle[cluster]);
      const jitter = radius * 0.55;
      x[i] = (clusterX[cluster] + ox * cos - oy * sin + (rng() - 0.5) * jitter + width) % width;
      y[i] = (clusterY[cluster] + ox * sin + oy * cos + (rng() - 0.5) * jitter + height) % height;
      vx[i] = (rng() - 0.5) * 12;
      vy[i] = (rng() - 0.5) * 12;
      angle[i] = clusterAngle[cluster] + (rng() - 0.5) * 0.35;
      omega[i] = (rng() - 0.5) * 0.42;
      order[i] = 0.28 + rng() * 0.18;
    }
  }

  function resize() {
    if (disposed) return;
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width || innerWidth);
    height = Math.max(1, rect.height || innerHeight);
    dpr = Math.min(window.devicePixelRatio || 1, lowCapability() ? 1.15 : 1.4);
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    radius = clamp(Math.min(width, height) / 150, 3.2, 5.4);
    diameter = radius * 2;
    cutoff = diameter * 3.35;
    cellSize = cutoff;
    columns = Math.max(1, Math.ceil(width / cellSize));
    rows = Math.max(1, Math.ceil(height / cellSize));
    heads = new Int32Array(columns * rows);

    const area = width * height;
    const density = lowCapability() ? 12500 : 10500;
    const target = clamp(Math.round(area / density), lowCapability() ? 42 : 58, lowCapability() ? 92 : 180);
    if (target !== count) {
      allocate(target);
      initialiseParticles();
      if (reducedMotion) settleStaticState();
    } else {
      for (let i = 0; i < count; i++) {
        x[i] = ((x[i] % width) + width) % width;
        y[i] = ((y[i] % height) + height) % height;
      }
    }
    draw();
  }

  function registerBond(i: number, j: number, strength: number, rawDx: number, rawDy: number) {
    if (bondCount >= bondA.length) return;
    if (Math.abs(rawDx) > width * 0.5 || Math.abs(rawDy) > height * 0.5) return;
    bondA[bondCount] = i;
    bondB[bondCount] = j;
    bondStrength[bondCount] = strength;
    bondCount++;
  }

  function pairForces(interaction: number) {
    bondCount = 0;
    coordination.fill(0);
    rebuildGrid();

    const bondLength = diameter * 1.34;
    const sigma = diameter * 0.72;
    const cutoffSq = cutoff * cutoff;
    const alignmentThreshold = 0.69;

    for (let i = 0; i < count; i++) {
      const gx = clamp(Math.floor(x[i] / cellSize), 0, columns - 1);
      const gy = clamp(Math.floor(y[i] / cellSize), 0, rows - 1);
      for (let ox = -1; ox <= 1; ox++) {
        const cx = (gx + ox + columns) % columns;
        for (let oy = -1; oy <= 1; oy++) {
          const cy = (gy + oy + rows) % rows;
          let j = heads[cy * columns + cx];
          while (j !== -1) {
            if (j > i) {
              const rawDx = x[j] - x[i];
              const rawDy = y[j] - y[i];
              const dx = minimumImage(rawDx, width);
              const dy = minimumImage(rawDy, height);
              const distSq = dx * dx + dy * dy;
              if (distSq > 0.0001 && distSq < cutoffSq) {
                const dist = Math.sqrt(distSq);
                const nx = dx / dist;
                const ny = dy / dist;
                let force = 0;

                if (dist < diameter) {
                  const overlap = 1 - dist / diameter;
                  force = -520 * overlap * overlap;
                } else {
                  const theta = Math.atan2(dy, dx);
                  const alignI = patchAlignment(angle[i], theta);
                  const alignJ = patchAlignment(angle[j], theta + Math.PI);
                  const directionalI = clamp((alignI - alignmentThreshold) / (1 - alignmentThreshold), 0, 1);
                  const directionalJ = clamp((alignJ - alignmentThreshold) / (1 - alignmentThreshold), 0, 1);
                  const directional = directionalI * directionalJ;
                  if (directional > 0) {
                    const offset = (dist - bondLength) / sigma;
                    const well = Math.exp(-offset * offset);
                    force = 78 * interaction * directional * well * Math.sign(dist - bondLength || 1);
                    const strength = directional * well * clamp(interaction / 1.5, 0, 1);
                    if (strength > 0.16) {
                      coordination[i] = Math.min(255, coordination[i] + 1);
                      coordination[j] = Math.min(255, coordination[j] + 1);
                      registerBond(i, j, strength, rawDx, rawDy);
                    }
                    torque[i] += patchTorque(angle[i], theta) * 4.4 * interaction * directional;
                    torque[j] += patchTorque(angle[j], theta + Math.PI) * 4.4 * interaction * directional;
                  }
                }

                fx[i] += nx * force;
                fy[i] += ny * force;
                fx[j] -= nx * force;
                fy[j] -= ny * force;
              }
            }
            j = next[j];
          }
        }
      }
    }
  }

  function pointerForce() {
    if (!pointerActive) return;
    const range = Math.min(170, Math.max(105, Math.min(width, height) * 0.18));
    const rangeSq = range * range;
    for (let i = 0; i < count; i++) {
      const dx = minimumImage(x[i] - pointerX, width);
      const dy = minimumImage(y[i] - pointerY, height);
      const distSq = dx * dx + dy * dy;
      if (distSq <= 1 || distSq >= rangeSq) continue;
      const dist = Math.sqrt(distSq);
      const falloff = 1 - dist / range;
      const force = 22 * falloff * falloff;
      fx[i] += (dx / dist) * force;
      fy[i] += (dy / dist) * force;
      torque[i] += Math.sin((pointerX + pointerY) * 0.002 + i) * 0.08 * falloff;
    }
  }

  function integrate(deltaSeconds: number, forcedInteraction?: number, forcedTemperature?: number) {
    const dt = clamp(deltaSeconds, TARGET_FRAME_SECONDS * 0.5, 0.045);
    fx.fill(0);
    fy.fill(0);
    torque.fill(0);

    const phase = 0.5 + 0.5 * Math.sin((elapsed / 76) * TAU - Math.PI / 2);
    const temperature = forcedTemperature ?? clamp(0.18 + phase * 0.78 + Math.sin(scrollProgress * Math.PI) * 0.06, 0.14, 0.98);
    const interaction = forcedInteraction ?? (1.48 - phase * 0.88);
    pairForces(interaction);
    pointerForce();

    const damping = Math.exp(-2.15 * dt);
    const rotationalDamping = Math.exp(-3.2 * dt);
    const thermalKick = (12 + 44 * temperature) * Math.sqrt(dt);
    const angularKick = (0.22 + 0.78 * temperature) * Math.sqrt(dt);

    for (let i = 0; i < count; i++) {
      const translationalNoiseX = (rng() + rng() + rng() - 1.5) * thermalKick;
      const translationalNoiseY = (rng() + rng() + rng() - 1.5) * thermalKick;
      vx[i] = (vx[i] + fx[i] * dt + translationalNoiseX) * damping;
      vy[i] = (vy[i] + fy[i] * dt + translationalNoiseY) * damping;
      omega[i] = (omega[i] + torque[i] * dt + (rng() + rng() - 1) * angularKick) * rotationalDamping;

      x[i] = (x[i] + vx[i] * dt + width) % width;
      y[i] = (y[i] + vy[i] * dt + height) % height;
      angle[i] = (angle[i] + omega[i] * dt + TAU) % TAU;
      const localOrder = clamp(coordination[i] / PATCH_COUNT, 0, 1);
      order[i] += (localOrder - order[i]) * Math.min(1, dt * 2.5);
    }
  }

  function settleStaticState() {
    const wasPointerActive = pointerActive;
    pointerActive = false;
    for (let i = 0; i < 72; i++) integrate(0.022, 1.34, 0.2);
    pointerActive = wasPointerActive;
  }

  function step(deltaSeconds: number) {
    if (disposed || reducedMotion) return;
    elapsed += deltaSeconds;
    integrate(deltaSeconds);
  }

  function refreshTheme() {
    const style = getComputedStyle(canvas);
    colors = {
      particle: style.getPropertyValue('--field-particle').trim() || colors.particle,
      ordered: style.getPropertyValue('--field-ordered').trim() || colors.ordered,
      patch: style.getPropertyValue('--field-patch').trim() || colors.patch,
      bond: style.getPropertyValue('--field-bond').trim() || colors.bond,
    };
  }

  function draw() {
    if (disposed) return;
    ctx.clearRect(0, 0, width, height);
    const contrast = 0.74 + 0.14 * Math.cos(scrollProgress * Math.PI * 2);

    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(0.65, radius * 0.18);
    for (let b = 0; b < bondCount; b++) {
      const i = bondA[b];
      const j = bondB[b];
      const strength = bondStrength[b];
      ctx.globalAlpha = (0.13 + strength * 0.30) * contrast;
      ctx.strokeStyle = colors.bond;
      ctx.beginPath();
      ctx.moveTo(x[i], y[i]);
      ctx.lineTo(x[j], y[j]);
      ctx.stroke();
    }

    for (let i = 0; i < count; i++) {
      const localOrder = order[i];
      ctx.globalAlpha = (0.34 + localOrder * 0.38) * contrast;
      ctx.fillStyle = localOrder > 0.56 ? colors.ordered : colors.particle;
      ctx.beginPath();
      ctx.arc(x[i], y[i], radius * (0.72 + localOrder * 0.12), 0, TAU);
      ctx.fill();

      if (localOrder > 0.62) {
        ctx.globalAlpha = (localOrder - 0.55) * 0.14 * contrast;
        ctx.strokeStyle = colors.ordered;
        ctx.lineWidth = 0.65;
        ctx.beginPath();
        ctx.arc(x[i], y[i], radius * 2.1, 0, TAU);
        ctx.stroke();
      }

      ctx.fillStyle = colors.patch;
      ctx.globalAlpha = (0.40 + localOrder * 0.28) * contrast;
      const patchRadius = Math.max(0.7, radius * 0.2);
      const patchDistance = radius * 0.86;
      for (let patch = 0; patch < PATCH_COUNT; patch++) {
        const theta = angle[i] + patch * PATCH_STEP;
        ctx.beginPath();
        ctx.arc(x[i] + Math.cos(theta) * patchDistance, y[i] + Math.sin(theta) * patchDistance, patchRadius, 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  function setPointer(nextX: number, nextY: number, active: boolean) {
    pointerX = clamp(nextX, 0, width);
    pointerY = clamp(nextY, 0, height);
    pointerActive = active && !reducedMotion;
  }

  function setScroll(progress: number) {
    scrollProgress = clamp(progress, 0, 1);
  }

  function setReducedMotion(reduced: boolean) {
    if (reduced === reducedMotion) return;
    reducedMotion = reduced;
    pointerActive = false;
    if (reducedMotion) {
      settleStaticState();
      draw();
    }
  }

  function dispose() {
    disposed = true;
    bondCount = 0;
  }

  refreshTheme();
  resize();

  return { resize, step, draw, setPointer, setScroll, setReducedMotion, refreshTheme, dispose };
}
