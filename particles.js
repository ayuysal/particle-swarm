// ============================================================
// PARTICLE SWARM ENGINE
// 20000 particles with Spatial Grid + Boids + Sound + Face
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
// Per-particle custom RGB (for image-sampled formations)
const pR = new Uint8Array(PARTICLE_COUNT);
const pG = new Uint8Array(PARTICLE_COUNT);
const pB = new Uint8Array(PARTICLE_COUNT);
const useCustomColor = new Uint8Array(PARTICLE_COUNT);

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
    case 'face': {
      // Voice-like formant synthesis
      const fundamental = audioCtx.createOscillator();
      fundamental.type = 'sawtooth';
      fundamental.frequency.value = 130; // Low voice
      // Formant filters (vowel-like)
      const f1 = audioCtx.createBiquadFilter();
      f1.type = 'bandpass'; f1.frequency.value = 600; f1.Q.value = 8;
      const f2 = audioCtx.createBiquadFilter();
      f2.type = 'bandpass'; f2.frequency.value = 1200; f2.Q.value = 8;
      const f3 = audioCtx.createBiquadFilter();
      f3.type = 'bandpass'; f3.frequency.value = 2500; f3.Q.value = 6;
      const fGain1 = audioCtx.createGain(); fGain1.gain.value = 0.5;
      const fGain2 = audioCtx.createGain(); fGain2.gain.value = 0.3;
      const fGain3 = audioCtx.createGain(); fGain3.gain.value = 0.15;
      fundamental.connect(f1); f1.connect(fGain1); fGain1.connect(masterGain);
      fundamental.connect(f2); f2.connect(fGain2); fGain2.connect(masterGain);
      fundamental.connect(f3); f3.connect(fGain3); fGain3.connect(masterGain);
      // Animate formants for speech-like quality
      const lfo1 = audioCtx.createOscillator(); lfo1.frequency.value = 0.8;
      const lfo1g = audioCtx.createGain(); lfo1g.gain.value = 200;
      lfo1.connect(lfo1g); lfo1g.connect(f1.frequency);
      const lfo2 = audioCtx.createOscillator(); lfo2.frequency.value = 1.2;
      const lfo2g = audioCtx.createGain(); lfo2g.gain.value = 300;
      lfo2.connect(lfo2g); lfo2g.connect(f2.frequency);
      // Amplitude modulation for syllable rhythm
      const ampLfo = audioCtx.createOscillator(); ampLfo.frequency.value = 2.5;
      const ampLfoG = audioCtx.createGain(); ampLfoG.gain.value = 0.08;
      ampLfo.connect(ampLfoG); ampLfoG.connect(masterGain.gain);
      fundamental.start(); lfo1.start(); lfo2.start(); ampLfo.start();
      nodes.push(fundamental, lfo1, lfo2, ampLfo);
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
      const ms = useCustomColor[i] ? 0.15 : MORPH_SPEED;
      const damp = useCustomColor[i] ? 0.82 : 0.92;
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

    if (useCustomColor[i]) {
      // Image-sampled color — use direct placement
      rr = pR[i]; gg = pG[i]; bb = pB[i];
      const ps = Math.max(1, Math.round(size[i]));
      const a2 = alpha[i];
      const invA = 1 - a2;
      for (let dy = 0; dy < ps; dy++) {
        for (let dx = 0; dx < ps; dx++) {
          const fx = ix + dx, fy = iy + dy;
          if (fx < 0 || fx >= width || fy < 0 || fy >= height) continue;
          const idx = (fy * width + fx) * 4;
          data[idx]     = (rr * a2 + data[idx] * invA) | 0;
          data[idx + 1] = (gg * a2 + data[idx + 1] * invA) | 0;
          data[idx + 2] = (bb * a2 + data[idx + 2] * invA) | 0;
          data[idx + 3] = 255;
        }
      }
      continue;
    } else {
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
function clearCustomColors() {
  for (let i = 0; i < PARTICLE_COUNT; i++) useCustomColor[i] = 0;
}

const formations = {
  swarm() {
    clearCustomColors();
    for (let i = 0; i < PARTICLE_COUNT; i++) hasTarget[i] = 0;
  },

  face() {
    // Render a realistic face on offscreen canvas, then sample pixels
    // Small canvas, then scale up — particles fill every pixel of the face
    const renderScale = 0.18;
    const faceW = Math.floor(Math.min(width, height) * renderScale);
    const faceH = Math.floor(faceW * 1.35);
    const displayScale = Math.min(width, height) * 0.55 / faceW;
    const fcx = Math.floor(faceW / 2);
    const fcy = Math.floor(faceH / 2);

    const oc = document.createElement('canvas');
    oc.width = Math.floor(faceW);
    oc.height = Math.floor(faceH);
    const g = oc.getContext('2d');

    // Animation
    const speechCycle = time * 0.12;
    const mouthOpen = Math.max(0, Math.sin(speechCycle) * 0.5 + Math.sin(speechCycle * 2.7) * 0.25) * faceW * 0.04;
    const blinkRaw = Math.sin(time * 0.035);
    const blink = blinkRaw > 0.96 ? Math.max(0.05, 1 - (blinkRaw - 0.96) / 0.04) : 1.0;

    const s = faceW;

    // --- Skin base (head shape) ---
    g.save();
    g.beginPath();
    g.ellipse(fcx, fcy, s * 0.38, s * 0.48, 0, 0, Math.PI * 2);
    g.closePath();
    g.clip();

    // Skin gradient (3D lighting)
    const skinGrad = g.createRadialGradient(fcx - s * 0.05, fcy - s * 0.15, s * 0.05, fcx, fcy, s * 0.5);
    skinGrad.addColorStop(0, '#f5d0a9');
    skinGrad.addColorStop(0.3, '#e8b88a');
    skinGrad.addColorStop(0.6, '#d4a074');
    skinGrad.addColorStop(0.85, '#c08860');
    skinGrad.addColorStop(1, '#8a6040');
    g.fillStyle = skinGrad;
    g.fillRect(0, 0, oc.width, oc.height);

    // Forehead highlight
    const fhGrad = g.createRadialGradient(fcx, fcy - s * 0.25, 0, fcx, fcy - s * 0.25, s * 0.2);
    fhGrad.addColorStop(0, 'rgba(255,230,200,0.4)');
    fhGrad.addColorStop(1, 'rgba(255,230,200,0)');
    g.fillStyle = fhGrad;
    g.fillRect(0, 0, oc.width, oc.height);

    // Cheek blush
    [[-1, 0.08], [1, 0.08]].forEach(([side, cy2]) => {
      const blush = g.createRadialGradient(fcx + side * s * 0.2, fcy + s * cy2, 0, fcx + side * s * 0.2, fcy + s * cy2, s * 0.1);
      blush.addColorStop(0, 'rgba(220,140,120,0.25)');
      blush.addColorStop(1, 'rgba(220,140,120,0)');
      g.fillStyle = blush;
      g.fillRect(0, 0, oc.width, oc.height);
    });

    // Nose shadow
    const noseShade = g.createLinearGradient(fcx - s * 0.03, fcy - s * 0.05, fcx + s * 0.03, fcy + s * 0.12);
    noseShade.addColorStop(0, 'rgba(160,100,60,0.15)');
    noseShade.addColorStop(0.5, 'rgba(160,100,60,0.05)');
    noseShade.addColorStop(1, 'rgba(160,100,60,0.2)');
    g.fillStyle = noseShade;
    g.beginPath();
    g.moveTo(fcx - s * 0.02, fcy - s * 0.06);
    g.quadraticCurveTo(fcx - s * 0.035, fcy + s * 0.08, fcx - s * 0.04, fcy + s * 0.12);
    g.quadraticCurveTo(fcx, fcy + s * 0.15, fcx + s * 0.04, fcy + s * 0.12);
    g.quadraticCurveTo(fcx + s * 0.035, fcy + s * 0.08, fcx + s * 0.02, fcy - s * 0.06);
    g.fill();

    // Nose highlight
    const noseHL = g.createLinearGradient(fcx, fcy - s * 0.04, fcx, fcy + s * 0.1);
    noseHL.addColorStop(0, 'rgba(255,235,210,0.4)');
    noseHL.addColorStop(1, 'rgba(255,235,210,0)');
    g.fillStyle = noseHL;
    g.beginPath();
    g.ellipse(fcx + s * 0.003, fcy + s * 0.02, s * 0.012, s * 0.08, 0, 0, Math.PI * 2);
    g.fill();

    // Nostril shadows (much darker)
    [[-1], [1]].forEach(([side]) => {
      g.fillStyle = 'rgba(40,15,5,0.7)';
      g.beginPath();
      g.ellipse(fcx + side * s * 0.03, fcy + s * 0.13, s * 0.02, s * 0.012, side * 0.3, 0, Math.PI * 2);
      g.fill();
    });

    // --- Eye sockets (deep shadows) ---
    [[-1], [1]].forEach(([side]) => {
      const ex = fcx + side * s * 0.14;
      const ey = fcy - s * 0.06;
      const socketGrad = g.createRadialGradient(ex, ey, s * 0.01, ex, ey, s * 0.1);
      socketGrad.addColorStop(0, 'rgba(60,30,15,0.5)');
      socketGrad.addColorStop(0.6, 'rgba(90,50,30,0.3)');
      socketGrad.addColorStop(1, 'rgba(120,70,40,0)');
      g.fillStyle = socketGrad;
      g.fillRect(ex - s * 0.12, ey - s * 0.08, s * 0.24, s * 0.16);
    });

    // --- Eyes (much larger for visibility at particle scale) ---
    [[-1], [1]].forEach(([side]) => {
      const ex = fcx + side * s * 0.14;
      const ey = fcy - s * 0.06;
      const eyeRx = s * 0.075;
      const eyeRy = s * 0.035 * blink;

      // Eye white
      g.fillStyle = '#eae6e0';
      g.beginPath();
      g.ellipse(ex, ey, eyeRx, eyeRy, 0, 0, Math.PI * 2);
      g.fill();

      // Eye white shadow (top, stronger)
      const ewGrad = g.createLinearGradient(ex, ey - eyeRy, ex, ey + eyeRy * 0.3);
      ewGrad.addColorStop(0, 'rgba(60,30,15,0.45)');
      ewGrad.addColorStop(0.5, 'rgba(80,50,30,0.15)');
      ewGrad.addColorStop(1, 'rgba(100,60,40,0)');
      g.fillStyle = ewGrad;
      g.beginPath();
      g.ellipse(ex, ey, eyeRx, eyeRy, 0, 0, Math.PI * 2);
      g.fill();

      if (blink > 0.2) {
        // Iris (larger, bolder)
        const irisR = s * 0.032;
        const irisGrad = g.createRadialGradient(ex, ey, irisR * 0.1, ex, ey, irisR);
        irisGrad.addColorStop(0, '#1a3a1a');
        irisGrad.addColorStop(0.3, '#2a5a2a');
        irisGrad.addColorStop(0.6, '#3d7a3d');
        irisGrad.addColorStop(0.85, '#2a4a20');
        irisGrad.addColorStop(1, '#1a3018');
        g.fillStyle = irisGrad;
        g.beginPath();
        g.arc(ex, ey, irisR, 0, Math.PI * 2);
        g.fill();

        // Pupil (larger)
        g.fillStyle = '#050505';
        g.beginPath();
        g.arc(ex, ey, s * 0.015, 0, Math.PI * 2);
        g.fill();

        // Catchlight (bigger)
        g.fillStyle = 'rgba(255,255,255,0.95)';
        g.beginPath();
        g.arc(ex + s * 0.01, ey - s * 0.01, s * 0.007, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = 'rgba(255,255,255,0.5)';
        g.beginPath();
        g.arc(ex - s * 0.006, ey + s * 0.006, s * 0.004, 0, Math.PI * 2);
        g.fill();
      }

      // Eyelid crease (stronger)
      g.strokeStyle = 'rgba(80,40,20,0.6)';
      g.lineWidth = 2;
      g.beginPath();
      g.ellipse(ex, ey - eyeRy * 0.2, eyeRx * 1.08, eyeRy * 1.5, 0, Math.PI + 0.25, Math.PI * 2 - 0.25);
      g.stroke();

      // Eyelashes (upper, bolder)
      g.strokeStyle = 'rgba(20,10,5,0.85)';
      g.lineWidth = 2.5;
      g.beginPath();
      g.ellipse(ex, ey, eyeRx, eyeRy, 0, Math.PI + 0.1, Math.PI * 2 - 0.1);
      g.stroke();

      // Lower lash line
      g.strokeStyle = 'rgba(40,20,10,0.4)';
      g.lineWidth = 1;
      g.beginPath();
      g.ellipse(ex, ey, eyeRx * 0.95, eyeRy * 0.9, 0, 0.15, Math.PI - 0.15);
      g.stroke();
    });

    // --- Eyebrows (much thicker, bolder) ---
    [[-1], [1]].forEach(([side]) => {
      const bx = fcx + side * s * 0.14;
      const by = fcy - s * 0.13;
      // Thick main stroke
      g.strokeStyle = 'rgba(35,18,8,0.9)';
      g.lineWidth = s * 0.02;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(bx - side * s * 0.065, by + s * 0.012);
      g.quadraticCurveTo(bx, by - s * 0.018, bx + side * s * 0.065, by + s * 0.008);
      g.stroke();
      // Fill for density
      g.fillStyle = 'rgba(35,18,8,0.7)';
      g.beginPath();
      g.moveTo(bx - side * s * 0.065, by + s * 0.012);
      g.quadraticCurveTo(bx, by - s * 0.025, bx + side * s * 0.065, by + s * 0.008);
      g.quadraticCurveTo(bx, by + s * 0.008, bx - side * s * 0.065, by + s * 0.012);
      g.fill();
    });

    // --- Mouth ---
    const my = fcy + s * 0.22;
    const mw = s * 0.1;
    const mh = s * 0.015 + mouthOpen;

    // Mouth interior (dark, always slightly visible)
    g.fillStyle = mouthOpen > 1.5 ? '#1a0505' : 'rgba(100,40,30,0.6)';
    g.beginPath();
    g.ellipse(fcx, my, mw * 0.9, Math.max(mh * 0.5, s * 0.008), 0, 0, Math.PI * 2);
    g.fill();

    // Teeth
    if (mouthOpen > 3) {
      g.fillStyle = '#e8e4dc';
      const tw = mw * 0.6;
      const th = Math.min(mh * 0.22, s * 0.02);
      g.beginPath();
      g.roundRect(fcx - tw, my - mh * 0.3, tw * 2, th, 2);
      g.fill();
    }

    // Upper lip (bolder, darker)
    g.fillStyle = '#a04535';
    g.beginPath();
    g.moveTo(fcx - mw, my - mh * 0.15);
    g.quadraticCurveTo(fcx - mw * 0.5, my - mh * 0.65, fcx, my - mh * 0.35);
    g.quadraticCurveTo(fcx + mw * 0.5, my - mh * 0.65, fcx + mw, my - mh * 0.15);
    g.quadraticCurveTo(fcx, my + mh * 0.1, fcx - mw, my - mh * 0.15);
    g.fill();

    // Lower lip (fuller, stronger color)
    g.fillStyle = '#b85550';
    g.beginPath();
    g.moveTo(fcx - mw * 0.9, my + mh * 0.08);
    g.quadraticCurveTo(fcx, my + mh * 0.75, fcx + mw * 0.9, my + mh * 0.08);
    g.quadraticCurveTo(fcx, my + mh * 0.2, fcx - mw * 0.9, my + mh * 0.08);
    g.fill();

    // Lip line (dark seam)
    g.strokeStyle = 'rgba(60,20,15,0.7)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(fcx - mw, my);
    g.quadraticCurveTo(fcx, my - mh * 0.05, fcx + mw, my);
    g.stroke();

    // Nasolabial folds (stronger)
    [[-1], [1]].forEach(([side]) => {
      g.strokeStyle = 'rgba(100,55,30,0.35)';
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(fcx + side * s * 0.06, fcy + s * 0.04);
      g.quadraticCurveTo(fcx + side * s * 0.11, fcy + s * 0.14, fcx + side * s * 0.1, my - s * 0.01);
      g.stroke();
    });

    // Chin shadow
    const chinGrad = g.createRadialGradient(fcx, fcy + s * 0.35, 0, fcx, fcy + s * 0.35, s * 0.1);
    chinGrad.addColorStop(0, 'rgba(140,90,60,0.15)');
    chinGrad.addColorStop(1, 'rgba(140,90,60,0)');
    g.fillStyle = chinGrad;
    g.fillRect(fcx - s * 0.15, fcy + s * 0.28, s * 0.3, s * 0.15);

    g.restore();

    // --- Sample ALL pixels from rendered face ---
    const imgData = g.getImageData(0, 0, oc.width, oc.height);
    const pixels = imgData.data;
    const samplePoints = [];

    // Sample every pixel (canvas is small enough)
    for (let y = 0; y < oc.height; y++) {
      for (let x = 0; x < oc.width; x++) {
        const idx = (y * oc.width + x) * 4;
        const r = pixels[idx], gr = pixels[idx + 1], b = pixels[idx + 2], a = pixels[idx + 3];
        if (a > 20 && (r > 15 || gr > 15 || b > 15)) {
          samplePoints.push(x, y, r, gr, b);
        }
      }
    }

    // Shuffle
    const numPts = samplePoints.length / 5;
    for (let i = numPts - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      for (let k = 0; k < 5; k++) {
        const tmp = samplePoints[i * 5 + k];
        samplePoints[i * 5 + k] = samplePoints[j * 5 + k];
        samplePoints[j * 5 + k] = tmp;
      }
    }

    // Scale up and center on screen
    const displayW = faceW * displayScale;
    const displayH = faceH * displayScale;
    const offX = centerX - displayW / 2;
    const offY = centerY - displayH / 2;

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const si = (i % numPts) * 5;
      tx[i] = samplePoints[si] * displayScale + offX + (Math.random() - 0.5) * 0.5;
      ty[i] = samplePoints[si + 1] * displayScale + offY + (Math.random() - 0.5) * 0.5;
      pR[i] = samplePoints[si + 2];
      pG[i] = samplePoints[si + 3];
      pB[i] = samplePoints[si + 4];
      useCustomColor[i] = 1;
      hasTarget[i] = 1;
      size[i] = displayScale * 0.7; // bigger particles to fill gaps
      alpha[i] = 0.85;
    }
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
  if (currentMode === 'face') {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
  } else {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
  }
  ctx.fillRect(0, 0, width, height);
  if (currentMode === 'swarm') buildGrid();
  if (currentMode === 'wave' || currentMode === 'sphere' || currentMode === 'dna' || currentMode === 'spiral') {
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
  const keys = { '1': 'swarm', '2': 'face', '3': 'text', '4': 'wave', '5': 'chart', '6': 'sphere', '7': 'dna', '8': 'heart', '9': 'spiral' };
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
  if (mode !== 'face') {
    clearCustomColors();
    // Reset particle sizes
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      size[i] = PARTICLE_SIZE * (0.6 + Math.random() * 0.5);
      alpha[i] = 0.6 + Math.random() * 0.4;
    }
  }
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
