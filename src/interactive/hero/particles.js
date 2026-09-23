/** Existing decorative particle model, separated from page lifecycle. Not a quantitative simulation. */
export function createParticleHero(canvas) {
 const ctx=canvas.getContext('2d');
 if(!ctx) throw new Error('Canvas unavailable');
 let W=0,H=0,DPR=1,particles=[],time=0;
  const GRID = 200;
  const INTERACTION = 60;

  let RADIUS = 8;
  let COUNT = 160;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 1.5);

    const rect = canvas.parentElement.getBoundingClientRect();
    W = rect.width;
    H = rect.height;

    canvas.width = W * DPR;
    canvas.height = H * DPR;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    // 🔥 responsive tuning
    RADIUS = Math.max(3, Math.min(8, H / 35));
    COUNT = Math.min(140, Math.max(24, Math.floor((W * H) / 3000)));
  }

  function rand(a, b) {
    return Math.random() * (b - a) + a;
  }

  function createParticle() {
    return {
      x: rand(RADIUS, W - RADIUS),
      y: rand(RADIUS, H - RADIUS),
      vx: rand(-0.5, 0.5),
      vy: rand(-0.5, 0.5),
      order: 0
    };
  }

  function init() {
    particles = [];
    for (let i = 0; i < COUNT; i++) {
      particles.push(createParticle());
    }
  }

  // 🧠 Cell list (reused everywhere)
  function buildGrid() {
    const grid = new Map();

    for (let p of particles) {
      const gx = Math.floor(p.x / GRID);
      const gy = Math.floor(p.y / GRID);
      const key = gx + ',' + gy;

      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(p);
    }

    return grid;
  }

  function neighbors(grid, p) {
    const gx = Math.floor(p.x / GRID);
    const gy = Math.floor(p.y / GRID);

    let res = [];

    for (let x = -1; x <= 1; x++) {
      for (let y = -1; y <= 1; y++) {
        const key = (gx + x) + ',' + (gy + y);
        if (grid.has(key)) res = res.concat(grid.get(key));
      }
    }

    return res;
  }

  function temperature(t) {
    return (Math.sin(t * 0.00035) + 1) / 2;
  }

  function update(grid, temp) {
    const minDist = RADIUS * 2;

    for (let p of particles) {
      const neigh = neighbors(grid, p);

      let alignX = 0, alignY = 0;
      let count = 0;

      for (let n of neigh) {
        if (p === n) continue;

        const dx = n.x - p.x;
        const dy = n.y - p.y;
        const distSq = dx*dx + dy*dy;

        if (distSq < INTERACTION * INTERACTION) {
          alignX += n.vx;
          alignY += n.vy;
          count++;

          // ❄️ attraction (cold only)
          if (temp < 0.4) {
            p.vx += dx * 0.0004;
            p.vy += dy * 0.0004;
          }
        }

        // 🧱 excluded volume (soft repulsion)
        if (distSq < minDist * minDist && distSq > 0.0001) {
          const dist = Math.sqrt(distSq);
          const overlap = minDist - dist;
          const nx = dx / dist;
          const ny = dy / dist;

          p.x -= nx * overlap * 0.5;
          p.y -= ny * overlap * 0.5;
          n.x += nx * overlap * 0.5;
          n.y += ny * overlap * 0.5;

          // bounce effect
          p.vx -= nx * 0.02;
          p.vy -= ny * 0.02;
        }
      }

      // alignment (crystallinity)
      if (count > 0) {
        alignX /= count;
        alignY /= count;

        p.vx += (alignX - p.vx) * 0.03 * (1 - temp);
        p.vy += (alignY - p.vy) * 0.03 * (1 - temp);

        const mag = Math.sqrt(alignX*alignX + alignY*alignY);
        p.order = Math.min(1, mag * 2);
      } else {
        p.order *= 0.9;
      }

      // thermal noise
      const noise = temp * 0.7;
      p.vx += rand(-noise, noise);
      p.vy += rand(-noise, noise);

      // damping
      p.vx *= 0.97;
      p.vy *= 0.97;

      p.x += p.vx;
      p.y += p.vy;

      // 🧱 HARD WALL BOUNDARIES (FIXED)
      if (p.x < RADIUS) {
        p.x = RADIUS;
        p.vx *= -0.8;
      }
      if (p.x > W - RADIUS) {
        p.x = W - RADIUS;
        p.vx *= -0.8;
      }
      if (p.y < RADIUS) {
        p.y = RADIUS;
        p.vy *= -0.8;
      }
      if (p.y > H - RADIUS) {
        p.y = H - RADIUS;
        p.vy *= -0.8;
      }
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    for (let p of particles) {
      const hue = 210 - p.order * 170;
      const light = 50 + p.order * 20;

      ctx.beginPath();
      ctx.arc(p.x, p.y, RADIUS, 0, Math.PI * 2);

      ctx.fillStyle = `hsl(${hue}, 70%, ${light}%)`;

      // ✨ glow scales with order
      ctx.shadowBlur = 0;
      ctx.shadowColor = `hsl(${hue}, 80%, 60%)`;

      ctx.fill();
    }

    ctx.shadowBlur = 0;
  }


 function reset(){resize();init();draw();}
 reset();
 return {
   resize: reset,
   step(){time+=16;update(buildGrid(),temperature(time));},
   draw,
   dispose(){particles=[];}
 };
}
