// ============================================================
// PARTICLE SWARM ENGINE
// 20000 particles with Spatial Grid + Boids + Sound
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

// SoA layout
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
let gridCols, gridRows, grid, gridCounts;

// ============================================================
// SOUND ENGINE (Web Audio API)
// ============================================================
let audioCtx = null;
let soundNodes = {};
let soundStarted = false;

function initAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

function stopAllSounds() {
  Object.values(soundNodes).forEach(nodes => {
    nodes.forEach(n => {
      try {
        if (n.gain) n.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.3);
        if (n.stop) n.stop(audioCtx.currentTime + 0.4);
      } catch(e) {}
    });
  });
  soundNodes = {};
}

function createSound(mode) {
  if (!audioCtx) return;
  stopAllSounds();
  const nodes = [];
  const masterGain = audioCtx.createGain();
  masterGain.gain.value = 0;
  masterGain.gain.linearRampToValueAtTime(0.15, audioCtx.currentTime + 0.5);
  masterGain.connect(audioCtx.destination);
  nodes.push(masterGain);

  switch(mode) {
    case 'swarm': {
      // Gentle buzzing hive — two detuned oscillators + noise
      const osc1 = audioCtx.createOscillator();
      osc1.type = 'sawtooth';
      osc1.frequency.value = 80;
      const osc2 = audioCtx.createOscillator();
      osc2.type = 'sawtooth';
      osc2.frequency.value = 82;
      const filter = audioCtx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 300;
      filter.Q.value = 2;
      // LFO for movement feel
      const lfo = audioCtx.createOscillator();
      lfo.frequency.value = 0.3;
      const lfoGain = audioCtx.createGain();
      lfoGain.gain.value = 40;
      lfo.connect(lfoGain);
      lfoGain.connect(filter.frequency);
      lfo.start();
      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(masterGain);
      osc1.start(); osc2.start();
      nodes.push(osc1, osc2, lfo);
      break;
    }
    case 'galaxy': {
      // Deep space ambient — low drone + shimmer
      const osc1 = audioCtx.createOscillator(); osc1.type = 'sine'; osc1.frequency.value = 55;
      const osc2 = audioCtx.createOscillator(); osc2.type = 'sine'; osc2.frequency.value = 82.5;
      const osc3 = audioCtx.createOscillator(); osc3.type = 'triangle'; osc3.frequency.value = 220;
      const g1 = audioCtx.createGain(); g1.gain.value = 0.4;
      const g2 = audioCtx.createGain(); g2.gain.value = 0.25;
      const g3 = audioCtx.createGain(); g3.gain.value = 0.08;
      const filter = audioCtx.createBiquadFilter();
      filter.type = 'lowpass'; filter.frequency.value = 400; filter.Q.value = 3;
      const lfo = audioCtx.createOscillator(); lfo.frequency.value = 0.08;
      const lfoG = audioCtx.createGain(); lfoG.gain.value = 150;
      lfo.connect(lfoG); lfoG.connect(filter.frequency);
      // Shimmer LFO on high tone
      const lfo2 = audioCtx.createOscillator(); lfo2.frequency.value = 0.3;
      const lfo2G = audioCtx.createGain(); lfo2G.gain.value = 0.06;
      lfo2.connect(lfo2G); lfo2G.connect(g3.gain);
      osc1.connect(g1); g1.connect(filter);
      osc2.connect(g2); g2.connect(filter);
      osc3.connect(g3); g3.connect(masterGain);
      filter.connect(masterGain);
      osc1.start(); osc2.start(); osc3.start(); lfo.start(); lfo2.start();
      nodes.push(osc1, osc2, osc3, lfo, lfo2);
      break;
    }
    case 'text': {
      // Digital typewriter / data stream
      const osc = audioCtx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = 440;
      const filter = audioCtx.createBiquadFilter();
      filter.type = 'bandpass'; filter.frequency.value = 800; filter.Q.value = 5;
      const lfo = audioCtx.createOscillator(); lfo.frequency.value = 8;
      const lfoG = audioCtx.createGain(); lfoG.gain.value = 300;
      lfo.connect(lfoG); lfoG.connect(osc.frequency);
      const ampLfo = audioCtx.createOscillator(); ampLfo.frequency.value = 12;
      const ampG = audioCtx.createGain(); ampG.gain.value = 0.1;
      ampLfo.connect(ampG); ampG.connect(masterGain.gain);
      osc.connect(filter); filter.connect(masterGain);
      osc.start(); lfo.start(); ampLfo.start();
      masterGain.gain.value = 0; masterGain.gain.linearRampToValueAtTime(0.06, audioCtx.currentTime + 0.5);
      nodes.push(osc, lfo, ampLfo);
      break;
    }
    case 'wave': {
      // Ocean / sine wash
      const osc1 = audioCtx.createOscillator(); osc1.type = 'sine'; osc1.frequency.value = 110;
      const osc2 = audioCtx.createOscillator(); osc2.type = 'sine'; osc2.frequency.value = 165;
      const osc3 = audioCtx.createOscillator(); osc3.type = 'sine'; osc3.frequency.value = 220;
      const g1 = audioCtx.createGain(); g1.gain.value = 0.5;
      const g2 = audioCtx.createGain(); g2.gain.value = 0.3;
      const g3 = audioCtx.createGain(); g3.gain.value = 0.2;
      const lfo = audioCtx.createOscillator(); lfo.frequency.value = 0.15;
      const lfoG = audioCtx.createGain(); lfoG.gain.value = 0.12;
      lfo.connect(lfoG); lfoG.connect(masterGain.gain);
      osc1.connect(g1); g1.connect(masterGain);
      osc2.connect(g2); g2.connect(masterGain);
      osc3.connect(g3); g3.connect(masterGain);
      osc1.start(); osc2.start(); osc3.start(); lfo.start();
      nodes.push(osc1, osc2, osc3, lfo);
      break;
    }
    case 'chart': {
      // Data processing bleeps — arpeggiated tones
      const notes = [261, 329, 392, 523];
      let noteIdx = 0;
      const osc = audioCtx.createOscillator(); osc.type = 'triangle'; osc.frequency.value = notes[0];
      const filter = audioCtx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 2000;
      osc.connect(filter); filter.connect(masterGain);
      osc.start();
      const interval = setInterval(() => {
        noteIdx = (noteIdx + 1) % notes.length;
        if (osc.frequency) osc.frequency.setValueAtTime(notes[noteIdx], audioCtx.currentTime);
      }, 250);
      nodes.push(osc);
      nodes._interval = interval;
      break;
    }
    case 'sphere': {
      // Cosmic deep hum — sub bass + harmonics
      const osc1 = audioCtx.createOscillator(); osc1.type = 'sine'; osc1.frequency.value = 55;
      const osc2 = audioCtx.createOscillator(); osc2.type = 'sine'; osc2.frequency.value = 110;
      const osc3 = audioCtx.createOscillator(); osc3.type = 'sine'; osc3.frequency.value = 220;
      const g1 = audioCtx.createGain(); g1.gain.value = 0.5;
      const g2 = audioCtx.createGain(); g2.gain.value = 0.25;
      const g3 = audioCtx.createGain(); g3.gain.value = 0.1;
      const lfo = audioCtx.createOscillator(); lfo.frequency.value = 0.08;
      const lfoG = audioCtx.createGain(); lfoG.gain.value = 5;
      lfo.connect(lfoG); lfoG.connect(osc1.frequency);
      osc1.connect(g1); g1.connect(masterGain);
      osc2.connect(g2); g2.connect(masterGain);
      osc3.connect(g3); g3.connect(masterGain);
      osc1.start(); osc2.start(); osc3.start(); lfo.start();
      nodes.push(osc1, osc2, osc3, lfo);
      break;
    }
    case 'dna': {
      // Bio sequence — gentle plucks with reverb feel
      const notes = [329, 392, 440, 523, 587, 659];
      let ni = 0;
      const osc = audioCtx.createOscillator(); osc.type = 'sine'; osc.frequency.value = notes[0];
      const filter = audioCtx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 1500; filter.Q.value = 3;
      const ampLfo = audioCtx.createOscillator(); ampLfo.frequency.value = 3;
      const ampG = audioCtx.createGain(); ampG.gain.value = 0.06;
      ampLfo.connect(ampG); ampG.connect(masterGain.gain);
      osc.connect(filter); filter.connect(masterGain);
      osc.start(); ampLfo.start();
      const interval = setInterval(() => {
        ni = (ni + 1) % notes.length;
        osc.frequency.setValueAtTime(notes[ni], audioCtx.currentTime);
      }, 400);
      nodes.push(osc, ampLfo);
      nodes._interval = interval;
      break;
    }
    case 'heart': {
      // Heartbeat — rhythmic low thuds
      const osc = audioCtx.createOscillator(); osc.type = 'sine'; osc.frequency.value = 50;
      const beatGain = audioCtx.createGain(); beatGain.gain.value = 0;
      osc.connect(beatGain); beatGain.connect(masterGain);
      masterGain.gain.value = 0.3;
      osc.start();
      let beatPhase = 0;
      const interval = setInterval(() => {
        const now = audioCtx.currentTime;
        if (beatPhase === 0) {
          // Lub
          osc.frequency.setValueAtTime(60, now);
          beatGain.gain.setValueAtTime(0, now);
          beatGain.gain.linearRampToValueAtTime(1, now + 0.05);
          beatGain.gain.linearRampToValueAtTime(0, now + 0.15);
        } else if (beatPhase === 1) {
          // Dub
          osc.frequency.setValueAtTime(45, now);
          beatGain.gain.setValueAtTime(0, now);
          beatGain.gain.linearRampToValueAtTime(0.7, now + 0.04);
          beatGain.gain.linearRampToValueAtTime(0, now + 0.12);
        }
        beatPhase = (beatPhase + 1) % 4; // 2 beats + 2 pauses
      }, 200);
      nodes.push(osc);
      nodes._interval = interval;
      break;
    }
    case 'spiral': {
      // Cosmic whoosh — filtered noise sweep
      const bufferSize = audioCtx.sampleRate * 2;
      const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
      const noise = audioCtx.createBufferSource();
      noise.buffer = buffer; noise.loop = true;
      const filter = audioCtx.createBiquadFilter();
      filter.type = 'bandpass'; filter.frequency.value = 500; filter.Q.value = 4;
      const lfo = audioCtx.createOscillator(); lfo.frequency.value = 0.2;
      const lfoG = audioCtx.createGain(); lfoG.gain.value = 400;
      lfo.connect(lfoG); lfoG.connect(filter.frequency);
      noise.connect(filter); filter.connect(masterGain);
      masterGain.gain.value = 0; masterGain.gain.linearRampToValueAtTime(0.08, audioCtx.currentTime + 0.5);
      noise.start(); lfo.start();
      nodes.push(noise, lfo);
      break;
    }
  }

  soundNodes[mode] = nodes;
}

// ============================================================
// RESIZE
// ============================================================
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
  for (let i = 0; i < totalCells; i++) grid[i] = new Int32Array(64);
}
window.addEventListener('resize', resize);
resize();

// ============================================================
// INIT PARTICLES
// ============================================================
function init() {
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    px[i] = Math.random() * width;
    py[i] = Math.random() * height;
    vx[i] = (Math.random() - 0.5) * 2;
    vy[i] = (Math.random() - 0.5) * 2;
    hasTarget[i] = 0;
    hue[i] = 220 + Math.random() * 40;
    alpha[i] = 0.6 + Math.random() * 0.4;
    size[i] = PARTICLE_SIZE * (0.6 + Math.random() * 0.5);
  }
}

// ============================================================
// SPATIAL GRID
// ============================================================
function buildGrid() {
  const totalCells = gridCols * gridRows;
  for (let c = 0; c < totalCells; c++) gridCounts[c] = 0;
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const col = Math.floor(px[i] / GRID_SIZE);
    const row = Math.floor(py[i] / GRID_SIZE);
    if (col >= 0 && col < gridCols && row >= 0 && row < gridRows) {
      const cell = row * gridCols + col;
      const count = gridCounts[cell];
      if (count < 64) { grid[cell][count] = i; gridCounts[cell] = count + 1; }
    }
  }
}

// ============================================================
// UPDATE
// ============================================================
function updateParticles() {
  const sepDist2 = BOIDS.separationDist * BOIDS.separationDist;
  const nDist2 = BOIDS.neighborDist * BOIDS.neighborDist;
  const mouseActive = mouse.active;
  const mx = mouse.x, my = mouse.y;

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    if (hasTarget[i]) {
      const dx = tx[i] - px[i];
      const dy = ty[i] - py[i];
      const ms = MORPH_SPEED;
      const damp = 0.92;
      vx[i] = (vx[i] + dx * ms) * damp;
      vy[i] = (vy[i] + dy * ms) * damp;
    } else {
      let sepX = 0, sepY = 0, sepCount = 0;
      let alignX = 0, alignY = 0, cohX = 0, cohY = 0, neighborCount = 0;
      const col = Math.floor(px[i] / GRID_SIZE);
      const row = Math.floor(py[i] / GRID_SIZE);
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nc = col + dc, nr = row + dr;
          if (nc < 0 || nc >= gridCols || nr < 0 || nr >= gridRows) continue;
          const cell = nr * gridCols + nc;
          const count = gridCounts[cell];
          for (let k = 0; k < count; k++) {
            const j = grid[cell][k];
            if (j === i) continue;
            const dx = px[j] - px[i], dy = py[j] - py[i];
            const dist2 = dx * dx + dy * dy;
            if (dist2 < sepDist2 && dist2 > 0) {
              const d = Math.sqrt(dist2);
              sepX -= dx / d; sepY -= dy / d; sepCount++;
            }
            if (dist2 < nDist2) {
              alignX += vx[j]; alignY += vy[j];
              cohX += px[j]; cohY += py[j]; neighborCount++;
            }
          }
        }
      }
      if (sepCount > 0) { vx[i] += (sepX / sepCount) * BOIDS.separation; vy[i] += (sepY / sepCount) * BOIDS.separation; }
      if (neighborCount > 0) {
        vx[i] += (alignX / neighborCount - vx[i]) * BOIDS.alignment;
        vy[i] += (alignY / neighborCount - vy[i]) * BOIDS.alignment;
        vx[i] += (cohX / neighborCount - px[i]) * BOIDS.cohesion * 0.01;
        vy[i] += (cohY / neighborCount - py[i]) * BOIDS.cohesion * 0.01;
      }
      vx[i] += (Math.random() - 0.5) * 0.1;
      vy[i] += (Math.random() - 0.5) * 0.1;
    }

    if (mouseActive) {
      const dx = px[i] - mx, dy = py[i] - my;
      const dist2 = dx * dx + dy * dy;
      if (dist2 < MOUSE_RADIUS * MOUSE_RADIUS && dist2 > 0) {
        const dist = Math.sqrt(dist2);
        const force = (1 - dist / MOUSE_RADIUS) * MOUSE_FORCE;
        vx[i] += (dx / dist) * force; vy[i] += (dy / dist) * force;
      }
    }

    const speed2 = vx[i] * vx[i] + vy[i] * vy[i];
    if (speed2 > MAX_SPEED * MAX_SPEED) {
      const speed = Math.sqrt(speed2);
      vx[i] = (vx[i] / speed) * MAX_SPEED; vy[i] = (vy[i] / speed) * MAX_SPEED;
    }
    px[i] += vx[i]; py[i] += vy[i];
    if (px[i] < -50) px[i] = width + 50; if (px[i] > width + 50) px[i] = -50;
    if (py[i] < -50) py[i] = height + 50; if (py[i] > height + 50) py[i] = -50;
  }
}

// ============================================================
// DRAW (ImageData for 60fps)
// ============================================================
function drawParticles() {
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const ix = px[i] | 0, iy = py[i] | 0;
    if (ix < 0 || ix >= width || iy < 0 || iy >= height) continue;

    let rr, gg, bb, srcA;

    {
      // HSL dynamic color
      const speed = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i]);
      const h = (hue[i] + speed * 15 + time * 0.2) % 360;
      const l = Math.min(80, 50 + speed * 12);
      srcA = alpha[i];
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
      rr = ((r + m) * 255) | 0;
      gg = ((g + m) * 255) | 0;
      bb = ((b + m) * 255) | 0;
    }

    const s = size[i] > 1 ? 2 : 1;
    for (let dy = 0; dy < s; dy++) {
      for (let dx = 0; dx < s; dx++) {
        const fx = ix + dx, fy = iy + dy;
        if (fx >= width || fy >= height) continue;
        const idx = (fy * width + fx) * 4;
        data[idx]     = Math.min(255, data[idx] + rr * srcA) | 0;
        data[idx + 1] = Math.min(255, data[idx + 1] + gg * srcA) | 0;
        data[idx + 2] = Math.min(255, data[idx + 2] + bb * srcA) | 0;
        data[idx + 3] = 255;
      }
    }
  }
  ctx.putImageData(imgData, 0, 0);
}

// ============================================================
// FORMATIONS
// ============================================================
const formations = {
  swarm() {
    for (let i = 0; i < PARTICLE_COUNT; i++) hasTarget[i] = 0;
  },

  galaxy() {
    // Multi-arm spiral galaxy
    const points = [];
    const radius = Math.min(width, height) * 0.35;
    const arms = 5;
    const armParticles = Math.floor(PARTICLE_COUNT * 0.7);
    const coreParticles = PARTICLE_COUNT - armParticles;

    // Spiral arms
    for (let i = 0; i < armParticles; i++) {
      const arm = i % arms;
      const t = (i / armParticles) * 3.5; // how far along the arm
      const armAngle = (arm / arms) * Math.PI * 2;
      const spiralAngle = armAngle + t * 1.8 + time * 0.003;
      const r = t * radius * 0.28;
      // Spread perpendicular to arm
      const spread = (Math.random() - 0.5) * r * 0.25;
      const spreadAngle = spiralAngle + Math.PI / 2;
      points.push(
        centerX + Math.cos(spiralAngle) * r + Math.cos(spreadAngle) * spread,
        centerY + Math.sin(spiralAngle) * r * 0.55 + Math.sin(spreadAngle) * spread * 0.55 // flatten for tilt
      );
    }

    // Dense core
    for (let i = 0; i < coreParticles; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.pow(Math.random(), 2) * radius * 0.12;
      points.push(
        centerX + Math.cos(angle) * r,
        centerY + Math.sin(angle) * r * 0.55
      );
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
      points.push(
        centerX - width * 0.35 + t * width * 0.7,
        centerY + Math.sin(t * Math.PI * 4 + time * 0.02) * height * 0.25
      );
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
    for (let i = 0; i < strandCount; i++) {
      const t = i / strandCount;
      const y = startY + t * verticalSpan;
      const angle = t * Math.PI * 2 * turns + time * 0.012;
      const x = centerX + Math.sin(angle) * amplitude;
      const off = (Math.random() - 0.5) * 3;
      points.push(x + off, y + off);
    }
    for (let i = 0; i < strandCount; i++) {
      const t = i / strandCount;
      const y = startY + t * verticalSpan;
      const angle = t * Math.PI * 2 * turns + time * 0.012 + Math.PI;
      const x = centerX + Math.sin(angle) * amplitude;
      const off = (Math.random() - 0.5) * 3;
      points.push(x + off, y + off);
    }
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

// ============================================================
// TEXT RENDERING
// ============================================================
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
      if (pixels[i + 3] > 128) points.push({ x, y });
    }
  }
  return points;
}

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

// ============================================================
// ANIMATION LOOP
// ============================================================
function animate(timestamp) {
  frameCount++;
  if (timestamp - lastTime >= 1000) {
    fps = frameCount;
    fpsEl.textContent = fps + ' FPS';
    frameCount = 0;
    lastTime = timestamp;
  }
  time++;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
  ctx.fillRect(0, 0, width, height);
  if (currentMode === 'swarm') buildGrid();
  if (currentMode === 'wave' || currentMode === 'sphere' || currentMode === 'dna' || currentMode === 'spiral' || currentMode === 'galaxy') {
    formations[currentMode]();
  }
  updateParticles();
  drawParticles();
  requestAnimationFrame(animate);
}

// ============================================================
// EVENTS
// ============================================================
canvas.addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.active = true; });
canvas.addEventListener('mouseleave', () => { mouse.active = false; });
canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  mouse.x = e.touches[0].clientX; mouse.y = e.touches[0].clientY; mouse.active = true;
}, { passive: false });
canvas.addEventListener('touchend', () => { mouse.active = false; });

document.querySelectorAll('.controls button').forEach(btn => {
  btn.addEventListener('click', () => switchMode(btn.dataset.mode));
});

document.addEventListener('keydown', (e) => {
  const keys = { '1': 'swarm', '2': 'galaxy', '3': 'text', '4': 'wave', '5': 'chart', '6': 'sphere', '7': 'dna', '8': 'heart', '9': 'spiral' };
  if (keys[e.key]) switchMode(keys[e.key]);
});

// ============================================================
// SOUND TOGGLE
// ============================================================
const soundToggleBtn = document.getElementById('soundToggle');
soundToggleBtn.addEventListener('click', () => {
  if (!soundStarted) {
    initAudio();
    soundStarted = true;
    createSound(currentMode);
    soundToggleBtn.textContent = 'SOUND ON';
    soundToggleBtn.classList.add('on');
  } else {
    stopAllSounds();
    soundStarted = false;
    soundToggleBtn.textContent = 'SOUND OFF';
    soundToggleBtn.classList.remove('on');
  }
});

// Override switchMode to not auto-start sound unless toggle is on
function switchMode(mode) {
  currentMode = mode;
  formations[currentMode]();
  if (soundStarted) createSound(mode);
  document.querySelectorAll('.controls button').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === currentMode);
  });
}

// ============================================================
// START
// ============================================================
init();
requestAnimationFrame(animate);
