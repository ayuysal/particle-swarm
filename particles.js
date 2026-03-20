// ============================================================
// PARTICLE SWARM ENGINE
// 5000 particles with Boids flocking + target morphing
// ============================================================

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const fpsEl = document.getElementById('fps');

// --- Config ---
const PARTICLE_COUNT = 5000;
const PARTICLE_SIZE = 1.8;
const MAX_SPEED = 4;
const MORPH_SPEED = 0.04;
const MOUSE_RADIUS = 120;
const MOUSE_FORCE = 0.8;

// Boids parameters
const BOIDS = {
  separation: 0.035,
  alignment: 0.02,
  cohesion: 0.015,
  separationDist: 20,
  neighborDist: 50,
};

// --- State ---
let width, height, centerX, centerY;
let mouse = { x: -9999, y: -9999, active: false };
let currentMode = 'swarm';
let particles = [];
let targetPoints = [];
let time = 0;
let lastTime = performance.now();
let frameCount = 0;
let fps = 0;

// --- Resize ---
function resize() {
  width = canvas.width = window.innerWidth;
  height = canvas.height = window.innerHeight;
  centerX = width / 2;
  centerY = height / 2;
}
window.addEventListener('resize', resize);
resize();

// --- Particle Class ---
class Particle {
  constructor(i) {
    this.index = i;
    this.x = Math.random() * width;
    this.y = Math.random() * height;
    this.vx = (Math.random() - 0.5) * 2;
    this.vy = (Math.random() - 0.5) * 2;
    this.tx = this.x;
    this.ty = this.y;
    this.hasTarget = false;
    this.hue = 220 + Math.random() * 40;
    this.alpha = 0.6 + Math.random() * 0.4;
    this.size = PARTICLE_SIZE * (0.7 + Math.random() * 0.6);
  }

  update(dt) {
    if (this.hasTarget) {
      // Morph toward target
      const dx = this.tx - this.x;
      const dy = this.ty - this.y;
      this.vx += dx * MORPH_SPEED;
      this.vy += dy * MORPH_SPEED;
      this.vx *= 0.92;
      this.vy *= 0.92;
    } else {
      // Boids flocking (spatial grid optimized)
      this.flock();
      // Gentle drift
      this.vx += (Math.random() - 0.5) * 0.1;
      this.vy += (Math.random() - 0.5) * 0.1;
    }

    // Mouse interaction
    if (mouse.active) {
      const dx = this.x - mouse.x;
      const dy = this.y - mouse.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < MOUSE_RADIUS && dist > 0) {
        const force = (1 - dist / MOUSE_RADIUS) * MOUSE_FORCE;
        this.vx += (dx / dist) * force;
        this.vy += (dy / dist) * force;
      }
    }

    // Speed limit
    const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
    if (speed > MAX_SPEED) {
      this.vx = (this.vx / speed) * MAX_SPEED;
      this.vy = (this.vy / speed) * MAX_SPEED;
    }

    this.x += this.vx;
    this.y += this.vy;

    // Soft boundary wrapping
    const margin = 50;
    if (this.x < -margin) this.x = width + margin;
    if (this.x > width + margin) this.x = -margin;
    if (this.y < -margin) this.y = height + margin;
    if (this.y > height + margin) this.y = -margin;
  }

  flock() {
    let sepX = 0, sepY = 0;
    let alignX = 0, alignY = 0;
    let cohX = 0, cohY = 0;
    let sepCount = 0, neighborCount = 0;

    // Sample neighbors (not all — performance)
    const step = Math.max(1, Math.floor(PARTICLE_COUNT / 200));
    for (let i = 0; i < PARTICLE_COUNT; i += step) {
      if (i === this.index) continue;
      const other = particles[i];
      const dx = other.x - this.x;
      const dy = other.y - this.y;
      const dist = dx * dx + dy * dy;

      if (dist < BOIDS.separationDist * BOIDS.separationDist && dist > 0) {
        const d = Math.sqrt(dist);
        sepX -= dx / d;
        sepY -= dy / d;
        sepCount++;
      }

      if (dist < BOIDS.neighborDist * BOIDS.neighborDist) {
        alignX += other.vx;
        alignY += other.vy;
        cohX += other.x;
        cohY += other.y;
        neighborCount++;
      }
    }

    if (sepCount > 0) {
      this.vx += (sepX / sepCount) * BOIDS.separation;
      this.vy += (sepY / sepCount) * BOIDS.separation;
    }
    if (neighborCount > 0) {
      this.vx += (alignX / neighborCount - this.vx) * BOIDS.alignment;
      this.vy += (alignY / neighborCount - this.vy) * BOIDS.alignment;
      this.vx += (cohX / neighborCount - this.x) * BOIDS.cohesion * 0.01;
      this.vy += (cohY / neighborCount - this.y) * BOIDS.cohesion * 0.01;
    }
  }

  draw() {
    // Dynamic color based on velocity
    const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
    const hue = this.hue + speed * 15 + time * 0.2;
    const brightness = 50 + speed * 12;

    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fillStyle = `hsla(${hue}, 80%, ${brightness}%, ${this.alpha})`;
    ctx.fill();
  }
}

// --- Target Generators ---
const formations = {
  swarm() {
    particles.forEach(p => { p.hasTarget = false; });
  },

  text() {
    const points = getTextPoints('HELLO', 140);
    assignTargets(points);
  },

  wave() {
    const points = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const t = i / PARTICLE_COUNT;
      const x = centerX - width * 0.35 + t * width * 0.7;
      const y = centerY + Math.sin(t * Math.PI * 4 + time * 0.02) * height * 0.25;
      points.push({ x, y });
    }
    assignTargets(points);
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
        const x = bx + Math.random() * barWidth;
        const y = baseY - Math.random() * barH;
        points.push({ x, y });
      }
    }

    // Fill remaining
    while (points.length < PARTICLE_COUNT) {
      const b = Math.floor(Math.random() * barCount);
      const barH = values[b] * height * 0.45;
      const bx = startX + b * (barWidth + gap);
      points.push({ x: bx + Math.random() * barWidth, y: baseY - Math.random() * barH });
    }

    assignTargets(points);
  },

  sphere() {
    const points = [];
    const radius = Math.min(width, height) * 0.28;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      // Fibonacci sphere projection
      const phi = Math.acos(1 - 2 * (i + 0.5) / PARTICLE_COUNT);
      const theta = Math.PI * (1 + Math.sqrt(5)) * i;
      const x = centerX + radius * Math.sin(phi) * Math.cos(theta + time * 0.005);
      const y = centerY + radius * Math.cos(phi);
      points.push({ x, y });
    }
    assignTargets(points);
  },

  dna() {
    const points = [];
    const amplitude = Math.min(width, height) * 0.12;
    const verticalSpan = height * 0.7;
    const startY = centerY - verticalSpan / 2;

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const t = i / PARTICLE_COUNT;
      const y = startY + t * verticalSpan;
      const angle = t * Math.PI * 6 + time * 0.01;

      // Two strands
      if (i % 2 === 0) {
        const x = centerX + Math.sin(angle) * amplitude;
        points.push({ x, y });
      } else {
        const x = centerX + Math.sin(angle + Math.PI) * amplitude;
        points.push({ x, y });
      }
    }
    assignTargets(points);
  },

  heart() {
    const points = [];
    const scale = Math.min(width, height) * 0.012;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const t = (i / PARTICLE_COUNT) * Math.PI * 2;
      // Heart parametric equation
      const hx = 16 * Math.pow(Math.sin(t), 3);
      const hy = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
      // Add some fill (random offset toward center)
      const fill = Math.random() * 0.8 + 0.2;
      const x = centerX + hx * scale * fill;
      const y = centerY + hy * scale * fill - 20;
      points.push({ x, y });
    }
    assignTargets(points);
  },

  spiral() {
    const points = [];
    const maxRadius = Math.min(width, height) * 0.35;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const t = i / PARTICLE_COUNT;
      const angle = t * Math.PI * 10 + time * 0.005;
      const radius = t * maxRadius;
      const x = centerX + Math.cos(angle) * radius;
      const y = centerY + Math.sin(angle) * radius;
      points.push({ x, y });
    }
    assignTargets(points);
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

// --- Assign target points to particles ---
function assignTargets(points) {
  if (points.length === 0) return;

  // Shuffle points for natural distribution
  for (let i = points.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [points[i], points[j]] = [points[j], points[i]];
  }

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const target = points[i % points.length];
    // Add slight jitter
    particles[i].tx = target.x + (Math.random() - 0.5) * 3;
    particles[i].ty = target.y + (Math.random() - 0.5) * 3;
    particles[i].hasTarget = true;
  }
}

// --- Init Particles ---
function init() {
  particles = [];
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    particles.push(new Particle(i));
  }
}

// --- Animation Loop ---
function animate(timestamp) {
  // FPS counter
  frameCount++;
  if (timestamp - lastTime >= 1000) {
    fps = frameCount;
    fpsEl.textContent = fps + ' FPS';
    frameCount = 0;
    lastTime = timestamp;
  }

  time++;

  // Clear with trail effect
  ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
  ctx.fillRect(0, 0, width, height);

  // Update formation continuously for animated modes
  if (currentMode === 'wave' || currentMode === 'sphere' || currentMode === 'dna' || currentMode === 'spiral') {
    formations[currentMode]();
  }

  // Update & draw particles
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    particles[i].update();
    particles[i].draw();
  }

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
  const keys = { '1': 'swarm', '2': 'text', '3': 'wave', '4': 'chart', '5': 'sphere', '6': 'dna', '7': 'heart', '8': 'spiral' };
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
