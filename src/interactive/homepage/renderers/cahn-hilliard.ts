import type { FieldRect, HomepageRenderer } from './types';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function createRng(seed = 0x6d2b79f5) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
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

export function createCahnHilliardRenderer(canvas: HTMLCanvasElement): HomepageRenderer {
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) throw new Error('Canvas 2D is unavailable');
  const ctx = context;
  const rng = createRng();

  let width = 1;
  let height = 1;
  let gridWidth = 96;
  let gridHeight = 64;
  let size = gridWidth * gridHeight;
  let phi = new Float32Array(size);
  let nextPhi = new Float32Array(size);
  let lapPhi = new Float32Array(size);
  let mu = new Float32Array(size);
  let quiet = new Float32Array(size);
  let image = ctx.createImageData(gridWidth, gridHeight);
  let elapsed = 0;
  let scrollProgress = 0;
  let reducedMotion = false;
  let disposed = false;
  let quietRects: FieldRect[] = [];
  let hasSeededQuietBoundary = false;
  let primary: [number, number, number] = [57, 127, 134];
  let secondary: [number, number, number] = [181, 108, 89];

  const lowCapability = () =>
    (navigator.hardwareConcurrency || 4) <= 4 ||
    matchMedia('(max-width:720px)').matches;

  const index = (x: number, y: number) => {
    const xx = x < 0 ? gridWidth - 1 : x >= gridWidth ? 0 : x;
    const yy = y < 0 ? gridHeight - 1 : y >= gridHeight ? 0 : y;
    return yy * gridWidth + xx;
  };

  function seedField() {
    for (let y = 0; y < gridHeight; y++) {
      for (let x = 0; x < gridWidth; x++) {
        const i = y * gridWidth + x;
        const broad =
          Math.sin(x * 0.095 + y * 0.027) * 0.028 +
          Math.cos(y * 0.11 - x * 0.018) * 0.024;
        phi[i] = (rng() - 0.5) * 0.16 + broad;
      }
    }
  }

  function rebuildQuietMask() {
    quiet.fill(0);
    if (!quietRects.length) return;

    const pad = clamp(Math.min(width, height) * 0.045, 26, 58);
    const feather = clamp(Math.min(width, height) * 0.085, 46, 92);

    for (let y = 0; y < gridHeight; y++) {
      const py = ((y + 0.5) / gridHeight) * height;
      for (let x = 0; x < gridWidth; x++) {
        const px = ((x + 0.5) / gridWidth) * width;
        let strength = 0;

        for (const rect of quietRects) {
          const left = rect.left - pad;
          const right = rect.right + pad;
          const top = rect.top - pad;
          const bottom = rect.bottom + pad;
          const dx = px < left ? left - px : px > right ? px - right : 0;
          const dy = py < top ? top - py : py > bottom ? py - bottom : 0;
          const distance = Math.hypot(dx, dy);
          strength = Math.max(strength, clamp(1 - distance / feather, 0, 1));
        }

        quiet[y * gridWidth + x] = strength;
      }
    }
  }

  function seedQuietBoundary() {
    if (hasSeededQuietBoundary || !quietRects.length) return;
    hasSeededQuietBoundary = true;
    for (let i = 0; i < size; i++) {
      const q = quiet[i];
      if (q > 0.08 && q < 0.9) {
        phi[i] = clamp(
          phi[i] + (rng() - 0.5) * 0.22 + Math.sin(i * 0.37) * 0.035,
          -0.9,
          0.9,
        );
      }
    }
    simulate(lowCapability() ? 70 : 95);
  }

  function simulate(iterations: number) {
    const kappa = 0.62;
    const mobility = 0.68;
    const dt = 0.047;
    const quietPotential = 1.45;

    for (let iteration = 0; iteration < iterations; iteration++) {
      for (let y = 0; y < gridHeight; y++) {
        for (let x = 0; x < gridWidth; x++) {
          const i = y * gridWidth + x;
          const center = phi[i];
          lapPhi[i] =
            phi[index(x - 1, y)] +
            phi[index(x + 1, y)] +
            phi[index(x, y - 1)] +
            phi[index(x, y + 1)] -
            4 * center;
        }
      }

      for (let i = 0; i < size; i++) {
        const value = phi[i];
        mu[i] =
          value * value * value -
          value -
          kappa * lapPhi[i] +
          quietPotential * quiet[i] * value;
      }

      for (let y = 0; y < gridHeight; y++) {
        for (let x = 0; x < gridWidth; x++) {
          const i = y * gridWidth + x;
          const lapMu =
            mu[index(x - 1, y)] +
            mu[index(x + 1, y)] +
            mu[index(x, y - 1)] +
            mu[index(x, y + 1)] -
            4 * mu[i];

          let value = phi[i] + dt * mobility * lapMu;
          if (quiet[i] > 0.02) value *= 1 - quiet[i] * 0.014;
          nextPhi[i] = clamp(value, -1.18, 1.18);
        }
      }

      [phi, nextPhi] = [nextPhi, phi];
    }
  }

  function settle() {
    simulate(lowCapability() ? 290 : 380);
  }

  function resize() {
    if (disposed) return;
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width || innerWidth);
    height = Math.max(1, rect.height || innerHeight);

    const cell = lowCapability() ? 12 : 10;
    const targetWidth = clamp(Math.round(width / cell), 60, lowCapability() ? 126 : 168);
    const targetHeight = clamp(Math.round(height / cell), 48, lowCapability() ? 96 : 118);
    if (targetWidth === gridWidth && targetHeight === gridHeight) {
      rebuildQuietMask();
      draw();
      return;
    }

    gridWidth = targetWidth;
    gridHeight = targetHeight;
    size = gridWidth * gridHeight;
    phi = new Float32Array(size);
    nextPhi = new Float32Array(size);
    lapPhi = new Float32Array(size);
    mu = new Float32Array(size);
    quiet = new Float32Array(size);
    canvas.width = gridWidth;
    canvas.height = gridHeight;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.imageSmoothingEnabled = true;
    image = ctx.createImageData(gridWidth, gridHeight);
    canvas.dataset.grid = `${gridWidth}x${gridHeight}`;
    seedField();
    rebuildQuietMask();
    settle();
    draw();
  }

  function step(deltaSeconds: number) {
    if (disposed || reducedMotion) return;
    elapsed += clamp(deltaSeconds, 0, 0.12);
    const cadence = lowCapability() ? 1 : 2;
    simulate(cadence);
  }

  function draw() {
    if (disposed) return;
    const pixels = image.data;
    const scrollFade = 1 - 0.18 * scrollProgress;

    for (let y = 0; y < gridHeight; y++) {
      for (let x = 0; x < gridWidth; x++) {
        const i = y * gridWidth + x;
        const value = phi[i];
        const dx = phi[index(x + 1, y)] - phi[index(x - 1, y)];
        const dy = phi[index(x, y + 1)] - phi[index(x, y - 1)];
        const interfaceStrength = clamp(Math.hypot(dx, dy) * 1.55, 0, 1);
        const domainStrength = clamp(Math.abs(value) * 0.45, 0, 1);
        const tone = clamp(0.5 + value * 0.42, 0, 1);
        const q = quiet[i];
        const quietFactor = 1 - q * 0.975;
        const boundary = 4 * q * (1 - q);
        const alpha =
          (0.008 + interfaceStrength * 0.15 + domainStrength * 0.028 + boundary * 0.024) *
          quietFactor *
          scrollFade;

        const r = Math.round(primary[0] + (secondary[0] - primary[0]) * tone);
        const g = Math.round(primary[1] + (secondary[1] - primary[1]) * tone);
        const b = Math.round(primary[2] + (secondary[2] - primary[2]) * tone);
        const p = i * 4;
        pixels[p] = r;
        pixels[p + 1] = g;
        pixels[p + 2] = b;
        pixels[p + 3] = Math.round(clamp(alpha, 0, 0.22) * 255);
      }
    }

    ctx.putImageData(image, 0, 0);
  }

  function setQuietZones(rects: FieldRect[]) {
    quietRects = rects;
    rebuildQuietMask();
    seedQuietBoundary();
    draw();
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
    canvas.dataset.motion = reduced ? 'static' : 'running';
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
    setQuietZones,
    setReducedMotion,
    refreshTheme,
    dispose,
  };
}
