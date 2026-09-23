import type { HomepageRenderer } from './types';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function createRng(seed = 0x7f4a7c15) {
  let state = seed >>> 0;
  return () => {
    state = Math.imul(state ^ (state >>> 15), 1 | state);
    state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
    return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
  };
}

function parseColor(value: string, fallback: [number, number, number]): [number, number, number] {
  const input = value.trim();
  const hex = input.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = Number.parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb = input.match(/rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)/i);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : fallback;
}

export function createReactionDiffusionRenderer(canvas: HTMLCanvasElement): HomepageRenderer {
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) throw new Error('Canvas 2D is unavailable');
  const ctx = context;
  const rng = createRng();

  let width = 1;
  let height = 1;
  let gridWidth = 96;
  let gridHeight = 64;
  let size = gridWidth * gridHeight;
  let a = new Float32Array(size);
  let b = new Float32Array(size);
  let nextA = new Float32Array(size);
  let nextB = new Float32Array(size);
  let image = ctx.createImageData(gridWidth, gridHeight);
  let elapsed = 0;
  let scrollProgress = 0;
  let reducedMotion = false;
  let disposed = false;
  let primary: [number, number, number] = [27, 111, 116];
  let secondary: [number, number, number] = [174, 91, 68];

  const lowCapability = () =>
    (navigator.hardwareConcurrency || 4) <= 4 ||
    matchMedia('(max-width: 720px)').matches;

  function seedField() {
    a.fill(1);
    b.fill(0);
    const seeds = clamp(Math.round((gridWidth * gridHeight) / 3500), 5, 10);
    for (let s = 0; s < seeds; s++) {
      const cx = Math.floor((0.1 + rng() * 0.8) * gridWidth);
      const cy = Math.floor((0.08 + rng() * 0.84) * gridHeight);
      const radius = 3 + Math.floor(rng() * 5);
      for (let oy = -radius; oy <= radius; oy++) {
        for (let ox = -radius; ox <= radius; ox++) {
          if (ox * ox + oy * oy > radius * radius) continue;
          const x = (cx + ox + gridWidth) % gridWidth;
          const y = (cy + oy + gridHeight) % gridHeight;
          const i = y * gridWidth + x;
          a[i] = 0.12 + rng() * 0.08;
          b[i] = 0.78 + rng() * 0.18;
        }
      }
    }
    for (let i = 0; i < size; i++) {
      a[i] = clamp(a[i] + (rng() - 0.5) * 0.018, 0, 1);
      b[i] = clamp(b[i] + (rng() - 0.5) * 0.012, 0, 1);
    }
  }

  function simulate(iterations: number, dt = 1) {
    const phase = Math.sin((elapsed / 110) * Math.PI * 2);
    const feed = 0.0362 + phase * 0.0007 + scrollProgress * 0.00025;
    const kill = 0.0630 - phase * 0.00045;
    const da = 0.16;
    const db = 0.08;

    for (let iteration = 0; iteration < iterations; iteration++) {
      for (let y = 0; y < gridHeight; y++) {
        const ym = y === 0 ? gridHeight - 1 : y - 1;
        const yp = y === gridHeight - 1 ? 0 : y + 1;
        for (let x = 0; x < gridWidth; x++) {
          const xm = x === 0 ? gridWidth - 1 : x - 1;
          const xp = x === gridWidth - 1 ? 0 : x + 1;
          const i = y * gridWidth + x;
          const left = y * gridWidth + xm;
          const right = y * gridWidth + xp;
          const up = ym * gridWidth + x;
          const down = yp * gridWidth + x;
          const ul = ym * gridWidth + xm;
          const ur = ym * gridWidth + xp;
          const dl = yp * gridWidth + xm;
          const dr = yp * gridWidth + xp;

          const av = a[i];
          const bv = b[i];
          const lapA =
            -av +
            0.2 * (a[left] + a[right] + a[up] + a[down]) +
            0.05 * (a[ul] + a[ur] + a[dl] + a[dr]);
          const lapB =
            -bv +
            0.2 * (b[left] + b[right] + b[up] + b[down]) +
            0.05 * (b[ul] + b[ur] + b[dl] + b[dr]);
          const reaction = av * bv * bv;
          nextA[i] = clamp(av + (da * lapA - reaction + feed * (1 - av)) * dt, 0, 1);
          nextB[i] = clamp(bv + (db * lapB + reaction - (kill + feed) * bv) * dt, 0, 1);
        }
      }
      [a, nextA] = [nextA, a];
      [b, nextB] = [nextB, b];
    }
  }

  function settle() {
    simulate(lowCapability() ? 105 : 145, 1);
  }

  function resize() {
    if (disposed) return;
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width || innerWidth);
    height = Math.max(1, rect.height || innerHeight);
    const cell = lowCapability() ? 11 : 9;
    const targetWidth = clamp(Math.round(width / cell), 64, lowCapability() ? 132 : 190);
    const targetHeight = clamp(Math.round(height / cell), 52, lowCapability() ? 104 : 132);
    if (targetWidth === gridWidth && targetHeight === gridHeight) return;

    gridWidth = targetWidth;
    gridHeight = targetHeight;
    size = gridWidth * gridHeight;
    a = new Float32Array(size);
    b = new Float32Array(size);
    nextA = new Float32Array(size);
    nextB = new Float32Array(size);
    canvas.width = gridWidth;
    canvas.height = gridHeight;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.imageSmoothingEnabled = true;
    image = ctx.createImageData(gridWidth, gridHeight);
    canvas.dataset.grid = `${gridWidth}x${gridHeight}`;
    seedField();
    settle();
    draw();
  }

  function step(deltaSeconds: number) {
    if (disposed || reducedMotion) return;
    elapsed += clamp(deltaSeconds, 0, 0.08);
    simulate(1, 1);
  }

  function draw() {
    if (disposed) return;
    const pixels = image.data;
    for (let i = 0; i < size; i++) {
      const value = b[i];
      const band = clamp(1 - Math.abs(value - 0.34) / 0.25, 0, 1);
      const filament = clamp((value - 0.12) * 2.4, 0, 1);
      const tone = clamp((value - 0.28) * 3.1, 0, 1);
      const r = Math.round(primary[0] + (secondary[0] - primary[0]) * tone);
      const g = Math.round(primary[1] + (secondary[1] - primary[1]) * tone);
      const blue = Math.round(primary[2] + (secondary[2] - primary[2]) * tone);
      const alpha = Math.round((0.025 + band * 0.11 + filament * 0.045) * 255);
      const p = i * 4;
      pixels[p] = r;
      pixels[p + 1] = g;
      pixels[p + 2] = blue;
      pixels[p + 3] = alpha;
    }
    ctx.putImageData(image, 0, 0);
  }

  function refreshTheme() {
    const style = getComputedStyle(canvas);
    primary = parseColor(style.getPropertyValue('--field-primary'), primary);
    secondary = parseColor(style.getPropertyValue('--field-secondary'), secondary);
  }

  function setScroll(progress: number) {
    scrollProgress = clamp(progress, 0, 1);
  }

  function setReducedMotion(reduced: boolean) {
    reducedMotion = reduced;
    if (reducedMotion) draw();
  }

  function dispose() {
    disposed = true;
  }

  refreshTheme();
  resize();

  return {
    resize,
    step,
    draw,
    setPointer: () => {},
    setScroll,
    setReducedMotion,
    refreshTheme,
    dispose,
  };
}
