// ============================================================
// PARTICLE SWARM ENGINE
// 20000 particles with Spatial Grid + Boids flocking + morphing
// ============================================================

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const fpsEl = document.getElementById('fps');

// --- Config ---
const PARTICLE_COUNT = 20000;
const PARTICLE_SIZE = 1.2;
const MAX_SPEED = 4;
const MORPH_SPEED = 0.04;
const MOUSE_RADIUS = 150;
const MOUSE_FORCE = 0.8;

// Boids parameters
const BOIDS = {
  separation: 0.04,
  alignment: 0.025,
  cohesion: 0.018,
  separationDist: 12,
  neighborDist: 35,
};

// --- State ---
let width, height, centerX, centerY;
let mouse = { x: -9999, y: -9999, active: false };
let currentMode = 'swarm';
let time = 0;
let lastTime = performance.now();
let frameCount = 0;
let fps = 0;

// Flat arrays for performance (SoA layout)
const px = new Float32Array(PARTICLE_COUNT);
const py = new Float32Array(PARTICLE_COUNT);
const vx = new Float32Array(PARTICLE_COUNT);
const vy = new Float32Array(PARTICLE_COUNT);
const tx = new Float32Array(PARTICLE_COUNT);
const ty = new Float32Array(PARTICLE_COUNT);
const hasTarget = new Uint8Array(PARTICLE_COUNT);
const hue = new Float32Array(PARTICLE_COUNT);
const alpha = new Float32Array(PARTICLE_COUNT);
const size = new Float32Array(PARTICLE_COUNT);

// Spatial grid
const GRID_SIZE = 40;
let gridCols, gridRows;
let grid = [];
let gridCounts = [];

// --- Resize ---
function resize() {
  width = canvas.width = window.innerWidth;
  height = canvas.height = window.innerHeight;
  centerX = width / 2;
  centerY = height / 2;
  gridCols = Math.ceil(width / GRID_SIZE) + 1;
  gridRows = Math.ceil(height / GRID_SIZE) + 1;
  const totalCells = gridCols * gridRows;
  grid = new Array(totalCells);
  gridCounts = new Int32Array(totalCells);
  for (let i = 0; i < totalCells; i++) {
    grid[i] = new Int32Array(64); // max 64 per cell
  }
}
window.addEventListener('resize', resize);
resize();

// --- Init ---
function init() {
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    px[i] = Math.random() * width;
    py[i] = Math.random() * height;
    vx[i] = (Math.random() - 0.5) * 2;
    vy[i] = (Math.random() - 0.5) * 2;
    tx[i] = px[i];
    ty[i] = py[i];
    hasTarget[i] = 0;
    hue[i] = 220 + Math.random() * 40;
    alpha[i] = 0.6 + Math.random() * 0.4;
    size[i] = PARTICLE_SIZE * (0.6 + Math.random() * 0.5);
  }
}

// --- Build spatial grid ---
function buildGrid() {
  const totalCells = gridCols * gridRows;
  for (let c = 0; c < totalCells; c++) gridCounts[c] = 0;

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const col = Math.floor(px[i] / GRID_SIZE);
    const row = Math.floor(py[i] / GRID_SIZE);
    if (col >= 0 && col < gridCols && row >= 0 && row < gridRows) {
      const cell = row * gridCols + col;
      const count = gridCounts[cell];
      if (count < 64) {
        grid[cell][count] = i;
        gridCounts[cell] = count + 1;
      }
    }
  }
}

// --- Update particles ---
function updateParticles() {
  const sepDist2 = BOIDS.separationDist * BOIDS.separationDist;
  const nDist2 = BOIDS.neighborDist * BOIDS.neighborDist;
  const mouseActive = mouse.active;
  const mx = mouse.x, my = mouse.y;

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    let ax = 0, ay = 0;

    if (hasTarget[i]) {
      // Morph toward target
      const dx = tx[i] - px[i];
      const dy = ty[i] - py[i];
      ax = dx * MORPH_SPEED;
      ay = dy * MORPH_SPEED;
      vx[i] = (vx[i] + ax) * 0.92;
      vy[i] = (vy[i] + ay) * 0.92;
    } else {
      // Boids via spatial grid
      let sepX = 0, sepY = 0, sepCount = 0;
      let alignX = 0, alignY = 0;
      let cohX = 0, cohY = 0, neighborCount = 0;

      const col = Math.floor(px[i] / GRID_SIZE);
      const row = Math.floor(py[i] / GRID_SIZE);

      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nc = col + dc;
          const nr = row + dr;
          if (nc < 0 || nc >= gridCols || nr < 0 || nr >= gridRows) continue;
          const cell = nr * gridCols + nc;
          const count = gridCounts[cell];
          for (let k = 0; k < count; k++) {
            const j = grid[cell][k];
            if (j === i) continue;
            const dx = px[j] - px[i];
            const dy = py[j] - py[i];
            const dist2 = dx * dx + dy * dy;

            if (dist2 < sepDist2 && dist2 > 0) {
              const d = Math.sqrt(dist2);
              sepX -= dx / d;
              sepY -= dy / d;
              sepCount++;
            }
            if (dist2 < nDist2) {
              alignX += vx[j];
              alignY += vy[j];
              cohX += px[j];
              cohY += py[j];
              neighborCount++;
            }
          }
        }
      }

      if (sepCount > 0) {
        vx[i] += (sepX / sepCount) * BOIDS.separation;
        vy[i] += (sepY / sepCount) * BOIDS.separation;
      }
      if (neighborCount > 0) {
        vx[i] += (alignX / neighborCount - vx[i]) * BOIDS.alignment;
        vy[i] += (alignY / neighborCount - vy[i]) * BOIDS.alignment;
        vx[i] += (cohX / neighborCount - px[i]) * BOIDS.cohesion * 0.01;
        vy[i] += (cohY / neighborCount - py[i]) * BOIDS.cohesion * 0.01;
      }

      // Gentle drift
      vx[i] += (Math.random() - 0.5) * 0.1;
      vy[i] += (Math.random() - 0.5) * 0.1;
    }

    // Mouse repulsion
    if (mouseActive) {
      const dx = px[i] - mx;
      const dy = py[i] - my;
      const dist2 = dx * dx + dy * dy;
      if (dist2 < MOUSE_RADIUS * MOUSE_RADIUS && dist2 > 0) {
        const dist = Math.sqrt(dist2);
        const force = (1 - dist / MOUSE_RADIUS) * MOUSE_FORCE;
        vx[i] += (dx / dist) * force;
        vy[i] += (dy / dist) * force;
      }
    }

    // Speed limit
    const speed2 = vx[i] * vx[i] + vy[i] * vy[i];
    if (speed2 > MAX_SPEED * MAX_SPEED) {
      const speed = Math.sqrt(speed2);
      vx[i] = (vx[i] / speed) * MAX_SPEED;
      vy[i] = (vy[i] / speed) * MAX_SPEED;
    }

    px[i] += vx[i];
    py[i] += vy[i];

    // Soft boundary wrapping
    if (px[i] < -50) px[i] = width + 50;
    if (px[i] > width + 50) px[i] = -50;
    if (py[i] < -50) py[i] = height + 50;
    if (py[i] > height + 50) py[i] = -50;
  }
}

// --- Draw particles using ImageData for max performance ---
function drawParticles() {
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const ix = px[i] | 0;
    const iy = py[i] | 0;
    if (ix < 0 || ix >= width || iy < 0 || iy >= height) continue;

    const speed = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i]);
    const h = (hue[i] + speed * 15 + time * 0.2) % 360;
    const l = Math.min(80, 50 + speed * 12);
    const a = alpha[i];

    // HSL to RGB (fast approximation)
    const c = (1 - Math.abs(2 * l / 100 - 1)) * 0.8;
    const x2 = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l / 100 - c / 2;
    let r, g, b;
    if (h < 60) { r = c; g = x2; b = 0; }
    else if (h < 120) { r = x2; g = c; b = 0; }
    else if (h < 180) { r = 0; g = c; b = x2; }
    else if (h < 240) { r = 0; g = x2; b = c; }
    else if (h < 300) { r = c; g = 0; b = x2; }
    else { r = x2; g = 0; b = c; }

    const rr = ((r + m) * 255) | 0;
    const gg = ((g + m) * 255) | 0;
    const bb = ((b + m) * 255) | 0;
    const aa = (a * 255) | 0;

    // Draw 2x2 pixel block for visibility
    const s = size[i] > 1 ? 2 : 1;
    for (let dy = 0; dy < s; dy++) {
      for (let dx = 0; dx < s; dx++) {
        const fx = ix + dx;
        const fy = iy + dy;
        if (fx >= width || fy >= height) continue;
        const idx = (fy * width + fx) * 4;
        // Alpha blend
        const srcA = aa / 255;
        data[idx]     = Math.min(255, data[idx] + rr * srcA) | 0;
        data[idx + 1] = Math.min(255, data[idx + 1] + gg * srcA) | 0;
        data[idx + 2] = Math.min(255, data[idx + 2] + bb * srcA) | 0;
        data[idx + 3] = 255;
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);
}

// --- Target Generators ---
const formations = {
  swarm() {
    for (let i = 0; i < PARTICLE_COUNT; i++) hasTarget[i] = 0;
  },

  face() {
    const points = [];
    const s = Math.min(width, height) * 0.35;
    const cx = centerX;
    const cy = centerY - s * 0.05;

    // Mouth animation — opens and closes like talking
    const mouthOpen = (Math.sin(time * 0.15) * 0.5 + 0.5) * 0.7 + 0.1;
    // Eyebrow raise synced with speech
    const browRaise = Math.sin(time * 0.15 + 0.5) * 0.03;
    // Subtle eye blink
    const blink = (Math.sin(time * 0.04) > 0.97) ? 0.15 : 1.0;

    // Allocate particles to features
    const headCount = Math.floor(PARTICLE_COUNT * 0.35);
    const eyeCount = Math.floor(PARTICLE_COUNT * 0.08);
    const pupilCount = Math.floor(PARTICLE_COUNT * 0.04);
    const browCount = Math.floor(PARTICLE_COUNT * 0.04);
    const noseCount = Math.floor(PARTICLE_COUNT * 0.05);
    const mouthCount = Math.floor(PARTICLE_COUNT * 0.15);
    const lipCount = Math.floor(PARTICLE_COUNT * 0.08);
    const jawCount = PARTICLE_COUNT - headCount - eyeCount * 2 - pupilCount * 2 - browCount * 2 - noseCount - mouthCount - lipCount;

    // --- Head outline (oval) ---
    for (let i = 0; i < headCount; i++) {
      const t = (i / headCount) * Math.PI * 2;
      const rx = s * 0.42;
      const ry = s * 0.55;
      // Vary radius slightly for thickness
      const thick = 1 + Math.random() * 0.06;
      const x = cx + Math.cos(t) * rx * thick;
      const y = cy + Math.sin(t) * ry * thick;
      points.push(x, y);
    }

    // --- Left eye ---
    const eyeY = cy - s * 0.12 * blink;
    const eyeSpacing = s * 0.16;
    for (let i = 0; i < eyeCount; i++) {
      const t = (i / eyeCount) * Math.PI * 2;
      const rx = s * 0.085;
      const ry = s * 0.05 * blink;
      const fill = 0.3 + Math.random() * 0.7;
      const x = cx - eyeSpacing + Math.cos(t) * rx * fill;
      const y = eyeY + Math.sin(t) * ry * fill;
      points.push(x, y);
    }

    // --- Right eye ---
    for (let i = 0; i < eyeCount; i++) {
      const t = (i / eyeCount) * Math.PI * 2;
      const rx = s * 0.085;
      const ry = s * 0.05 * blink;
      const fill = 0.3 + Math.random() * 0.7;
      const x = cx + eyeSpacing + Math.cos(t) * rx * fill;
      const y = eyeY + Math.sin(t) * ry * fill;
      points.push(x, y);
    }

    // --- Left pupil ---
    for (let i = 0; i < pupilCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.random() * s * 0.03;
      const x = cx - eyeSpacing + Math.cos(angle) * r;
      const y = eyeY + Math.sin(angle) * r * blink;
      points.push(x, y);
    }

    // --- Right pupil ---
    for (let i = 0; i < pupilCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.random() * s * 0.03;
      const x = cx + eyeSpacing + Math.cos(angle) * r;
      const y = eyeY + Math.sin(angle) * r * blink;
      points.push(x, y);
    }

    // --- Left eyebrow ---
    const browY = cy - s * 0.22 - browRaise * s;
    for (let i = 0; i < browCount; i++) {
      const t = i / browCount;
      const x = cx - eyeSpacing - s * 0.08 + t * s * 0.16;
      const curve = -Math.sin(t * Math.PI) * s * 0.025;
      const y = browY + curve + (Math.random() - 0.5) * 3;
      points.push(x, y);
    }

    // --- Right eyebrow ---
    for (let i = 0; i < browCount; i++) {
      const t = i / browCount;
      const x = cx + eyeSpacing - s * 0.08 + t * s * 0.16;
      const curve = -Math.sin(t * Math.PI) * s * 0.025;
      const y = browY + curve + (Math.random() - 0.5) * 3;
      points.push(x, y);
    }

    // --- Nose ---
    for (let i = 0; i < noseCount; i++) {
      const t = i / noseCount;
      // Nose line
      if (t < 0.6) {
        const nt = t / 0.6;
        const x = cx + Math.sin(nt * Math.PI * 0.3) * s * 0.02;
        const y = cy - s * 0.02 + nt * s * 0.18;
        points.push(x + (Math.random() - 0.5) * 2, y);
      } else {
        // Nostril area
        const angle = ((t - 0.6) / 0.4) * Math.PI;
        const x = cx + Math.cos(angle) * s * 0.04;
        const y = cy + s * 0.16 + Math.sin(angle) * s * 0.015;
        points.push(x, y);
      }
    }

    // --- Mouth (animated opening) ---
    const mouthY = cy + s * 0.28;
    const mouthW = s * 0.18;
    const mouthH = s * 0.04 + mouthOpen * s * 0.12;

    // Upper lip
    for (let i = 0; i < lipCount / 2; i++) {
      const t = i / (lipCount / 2);
      const x = cx - mouthW + t * mouthW * 2;
      const curve = -Math.sin(t * Math.PI) * s * 0.015;
      // Cupid's bow
      const bow = Math.sin(t * Math.PI * 2) * s * 0.008;
      const y = mouthY - mouthH * 0.5 + curve + bow + (Math.random() - 0.5) * 2;
      points.push(x, y);
    }

    // Lower lip
    for (let i = 0; i < lipCount / 2; i++) {
      const t = i / (lipCount / 2);
      const x = cx - mouthW + t * mouthW * 2;
      const curve = Math.sin(t * Math.PI) * s * 0.02;
      const y = mouthY + mouthH * 0.5 + curve + (Math.random() - 0.5) * 2;
      points.push(x, y);
    }

    // Mouth interior (dark gap when open)
    for (let i = 0; i < mouthCount; i++) {
      const t = Math.random();
      const angle = Math.random() * Math.PI * 2;
      const rx = mouthW * 0.85;
      const ry = mouthH * 0.35;
      const fill = Math.random() * 0.9 + 0.1;
      const x = cx + Math.cos(angle) * rx * fill * (0.5 + t * 0.5);
      const y = mouthY + Math.sin(angle) * ry * fill;
      points.push(x, y);
    }

    // --- Jaw / chin emphasis ---
    for (let i = 0; i < jawCount; i++) {
      const t = (i / jawCount) * Math.PI;
      const x = cx + Math.cos(t + Math.PI) * s * 0.3;
      const y = cy + s * 0.45 + Math.sin(t) * s * 0.1;
      const jit = (Math.random() - 0.5) * 4;
      points.push(x + jit, y + jit);
    }

    assignTargetsFlat(points);
  },

  text() {
    const points = getTextPoints('PARTICLE SWARM', Math.min(width * 0.09, 120));
    assignTargets(points);
  },

  wave() {
    const points = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const t = i / PARTICLE_COUNT;
      const x = centerX - width * 0.35 + t * width * 0.7;
      const y = centerY + Math.sin(t * Math.PI * 4 + time * 0.02) * height * 0.25;
      points.push(x, y);
    }
    assignTargetsFlat(points);
  },

  chart() {
    const points = [];
    const barCount = 8;
    const barWidth = width * 0.06;
    const gap = width * 0.03;
    const totalWidth = barCount * barWidth + (barCount - 1) * gap;
    const startX = centerX - totalWidth / 2;
    const baseY = centerY + height * 0.2;
    const values = [0.4, 0.7, 0.5, 0.9, 0.6, 0.8, 0.3, 0.75];
    const perBar = Math.floor(PARTICLE_COUNT / barCount);

    for (let b = 0; b < barCount; b++) {
      const barH = values[b] * height * 0.45;
      const bx = startX + b * (barWidth + gap);
      for (let i = 0; i < perBar; i++) {
        points.push(bx + Math.random() * barWidth, baseY - Math.random() * barH);
      }
    }
    while (points.length / 2 < PARTICLE_COUNT) {
      const b = Math.floor(Math.random() * barCount);
      const barH = values[b] * height * 0.45;
      const bx = startX + b * (barWidth + gap);
      points.push(bx + Math.random() * barWidth, baseY - Math.random() * barH);
    }
    assignTargetsFlat(points);
  },

  sphere() {
    const points = [];
    const radius = Math.min(width, height) * 0.28;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const phi = Math.acos(1 - 2 * (i + 0.5) / PARTICLE_COUNT);
      const theta = Math.PI * (1 + Math.sqrt(5)) * i;
      points.push(
        centerX + radius * Math.sin(phi) * Math.cos(theta + time * 0.005),
        centerY + radius * Math.cos(phi)
      );
    }
    assignTargetsFlat(points);
  },

  dna() {
    const points = [];
    const amplitude = Math.min(width, height) * 0.15;
    const verticalSpan = height * 0.8;
    const startY = centerY - verticalSpan / 2;
    const turns = 8;
    const rungSpacing = 25;

    const strandCount = Math.floor(PARTICLE_COUNT * 0.38);
    const rungTotal = PARTICLE_COUNT - strandCount * 2;

    // Strand 1
    for (let i = 0; i < strandCount; i++) {
      const t = i / strandCount;
      const y = startY + t * verticalSpan;
      const angle = t * Math.PI * 2 * turns + time * 0.012;
      const x = centerX + Math.sin(angle) * amplitude;
      const off = (Math.random() - 0.5) * 3;
      points.push(x + off, y + off);
    }

    // Strand 2
    for (let i = 0; i < strandCount; i++) {
      const t = i / strandCount;
      const y = startY + t * verticalSpan;
      const angle = t * Math.PI * 2 * turns + time * 0.012 + Math.PI;
      const x = centerX + Math.sin(angle) * amplitude;
      const off = (Math.random() - 0.5) * 3;
      points.push(x + off, y + off);
    }

    // Rungs (base pairs)
    const numRungs = Math.floor(verticalSpan / rungSpacing);
    const perRung = Math.floor(rungTotal / numRungs);
    for (let r = 0; r < numRungs; r++) {
      const t = r / numRungs;
      const y = startY + t * verticalSpan;
      const angle = t * Math.PI * 2 * turns + time * 0.012;
      const x1 = centerX + Math.sin(angle) * amplitude;
      const x2 = centerX + Math.sin(angle + Math.PI) * amplitude;
      for (let i = 0; i < perRung; i++) {
        const lerp = i / perRung;
        const x = x1 + (x2 - x1) * lerp;
        const jit = (Math.random() - 0.5) * 2;
        points.push(x + jit, y + jit);
      }
    }

    while (points.length / 2 < PARTICLE_COUNT) {
      const t = Math.random();
      const y = startY + t * verticalSpan;
      const angle = t * Math.PI * 2 * turns + time * 0.012;
      const strand = Math.random() > 0.5 ? 0 : Math.PI;
      points.push(centerX + Math.sin(angle + strand) * amplitude, y);
    }

    assignTargetsFlat(points);
  },

  heart() {
    const points = [];
    const scale = Math.min(width, height) * 0.014;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const t = (i / PARTICLE_COUNT) * Math.PI * 2;
      const hx = 16 * Math.pow(Math.sin(t), 3);
      const hy = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
      const fill = Math.random() * 0.85 + 0.15;
      points.push(centerX + hx * scale * fill, centerY + hy * scale * fill - 20);
    }
    assignTargetsFlat(points);
  },

  spiral() {
    const points = [];
    const maxRadius = Math.min(width, height) * 0.38;
    const arms = 4;
    const perArm = Math.floor(PARTICLE_COUNT * 0.85 / arms);
    const coreCount = PARTICLE_COUNT - perArm * arms;

    for (let a = 0; a < arms; a++) {
      const armOffset = (a / arms) * Math.PI * 2;
      for (let i = 0; i < perArm; i++) {
        const t = i / perArm;
        const angle = t * Math.PI * 3 + armOffset + time * 0.003;
        const radius = t * maxRadius;
        const spread = t * 15 + 2;
        const jx = (Math.random() - 0.5) * spread;
        const jy = (Math.random() - 0.5) * spread;
        points.push(centerX + Math.cos(angle) * radius + jx, centerY + Math.sin(angle) * radius + jy);
      }
    }

    for (let i = 0; i < coreCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * maxRadius * 0.08;
      points.push(centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius);
    }

    assignTargetsFlat(points);
  },
};

// --- Text rendering to points ---
function getTextPoints(text, fontSize) {
  const offscreen = document.createElement('canvas');
  const offCtx = offscreen.getContext('2d');
  offscreen.width = width;
  offscreen.height = height;
  offCtx.fillStyle = '#fff';
  offCtx.font = `bold ${fontSize}px 'SF Pro Display', Arial, sans-serif`;
  offCtx.textAlign = 'center';
  offCtx.textBaseline = 'middle';
  offCtx.fillText(text, centerX, centerY);

  const imageData = offCtx.getImageData(0, 0, width, height);
  const pixels = imageData.data;
  const points = [];
  const step = 3;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      if (pixels[i + 3] > 128) {
        points.push({ x, y });
      }
    }
  }
  return points;
}

// --- Assign targets (object array version for text) ---
function assignTargets(points) {
  if (points.length === 0) return;
  for (let i = points.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [points[i], points[j]] = [points[j], points[i]];
  }
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const target = points[i % points.length];
    tx[i] = target.x + (Math.random() - 0.5) * 3;
    ty[i] = target.y + (Math.random() - 0.5) * 3;
    hasTarget[i] = 1;
  }
}

// --- Assign targets (flat array version for perf) ---
function assignTargetsFlat(points) {
  const count = points.length / 2;
  if (count === 0) return;
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const idx = (i % count) * 2;
    tx[i] = points[idx] + (Math.random() - 0.5) * 2;
    ty[i] = points[idx + 1] + (Math.random() - 0.5) * 2;
    hasTarget[i] = 1;
  }
}

// --- Animation Loop ---
function animate(timestamp) {
  frameCount++;
  if (timestamp - lastTime >= 1000) {
    fps = frameCount;
    fpsEl.textContent = fps + ' FPS';
    frameCount = 0;
    lastTime = timestamp;
  }

  time++;

  // Clear with trail
  ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
  ctx.fillRect(0, 0, width, height);

  // Build spatial grid for flocking
  if (currentMode === 'swarm') {
    buildGrid();
  }

  // Update animated formations
  if (currentMode === 'face' || currentMode === 'wave' || currentMode === 'sphere' || currentMode === 'dna' || currentMode === 'spiral') {
    formations[currentMode]();
  }

  updateParticles();
  drawParticles();

  requestAnimationFrame(animate);
}

// --- Mouse Events ---
canvas.addEventListener('mousemove', (e) => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
  mouse.active = true;
});

canvas.addEventListener('mouseleave', () => {
  mouse.active = false;
});

canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  mouse.x = e.touches[0].clientX;
  mouse.y = e.touches[0].clientY;
  mouse.active = true;
}, { passive: false });

canvas.addEventListener('touchend', () => {
  mouse.active = false;
});

// --- Button Controls ---
document.querySelectorAll('.controls button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.controls button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentMode = btn.dataset.mode;
    formations[currentMode]();
  });
});

// --- Keyboard shortcuts ---
document.addEventListener('keydown', (e) => {
  const keys = { '1': 'swarm', '2': 'face', '3': 'text', '4': 'wave', '5': 'chart', '6': 'sphere', '7': 'dna', '8': 'heart', '9': 'spiral' };
  if (keys[e.key]) {
    currentMode = keys[e.key];
    formations[currentMode]();
    document.querySelectorAll('.controls button').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === currentMode);
    });
  }
});

// --- Start ---
init();
requestAnimationFrame(animate);
