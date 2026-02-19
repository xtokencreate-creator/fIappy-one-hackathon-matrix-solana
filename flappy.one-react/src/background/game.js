/*
README (quick edit guide)

Expected files in /assets:
- assets/bkg1.png
- assets/cloud_1.png
- assets/cloud_2.png
- assets/cloud-3.png
- assets/floor1.png
- assets/fire_fly_red/Layer 1_redbird_1.png
- assets/fire_fly_red/Layer 1_redbird_2.png
- assets/fire_fly_red/Layer 1_redbird_3.png
- assets/blue_fire_fly/sprite_0.png
- assets/blue_fire_fly/sprite_1.png
- assets/blue_fire_fly/sprite_2.png
- assets/green_fire_fly/sprite_0.png
- assets/green_fire_fly/sprite_1.png
- assets/green_fire_fly/sprite_2.png
- assets/orange_fire_fly/sprite_0.png.png
- assets/orange_fire_fly/sprite_1.png
- assets/orange_fire_fly/sprite_2.png
- assets/Yellow_fire_fly/fire_fly_1.png
- assets/Yellow_fire_fly/fire_fly_2.png.png
- assets/Yellow_fire_fly/fire_fly_3.png
- assets/blue_fly/sprite_0.png
- assets/blue_fly/sprite_1.png
- assets/blue_fly/sprite_2.png
- assets/cloudblue_fly/sprite_0.png
- assets/cloudblue_fly/sprite_1.png
- assets/cloudblue_fly/sprite_2.png
- assets/green_Fly/sprite_0.png
- assets/green_Fly/sprite_1.png
- assets/green_Fly/sprite_2.png
- assets/purple_fly/sprite_0.png
- assets/purple_fly/sprite_1.png
- assets/purple_fly/sprite_2.png
- assets/orange_fly/sprite_0.png
- assets/orange_fly/sprite_1.png
- assets/orange_fly/sprite_2.png
- assets/pink_fly/sprite_0.png
- assets/pink_fly/sprite_1.png
- assets/pink_fly/sprite_2.png
- assets/Yellow_fly/flying_1.png.png
- assets/Yellow_fly/flying_2.png
- assets/Yellow_fly/flying_3.png

Where to change scroll speeds:
- ENV_CONFIG.CLOUD_SPEED_RANGE
- CONFIG.BACKGROUND_BIRD_SPEED_RANGE

Where to change ground height ratio:
- ENV_CONFIG.GROUND_HEIGHT_RATIO

Where to adjust bird size:
- CONFIG.MAIN_BIRD_SCALE
- CONFIG.BACKGROUND_BIRD_SCALE_RANGE
*/

import {
  initEnvironment,
  updateEnvironment,
  renderEnvironment,
  setEnvironmentViewport,
  getEnvironmentGroundTop,
  setEnvironmentScrollEnabled,
  setEnvironmentQuality,
} from "./environment.js";

// ------------------------------------------------------
// Canvas setup (owned by the React renderer)
// ------------------------------------------------------
export const DESIGN_WIDTH = 1440;
export const DESIGN_HEIGHT = 1024;
let canvas = null;
let ctx = null;

// ------------------------------------------------------
// Asset loading helpers
// ------------------------------------------------------
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${src}`));
    img.src = src;
  });
}

function loadFrames(paths) {
  return Promise.all(paths.map(loadImage));
}

// ------------------------------------------------------
// Asset paths
// ------------------------------------------------------
const assetUrl = (path) => new URL(`./assets/${path}`, import.meta.url).toString();

const ASSETS = {
  fireBirdSets: [
    [
      assetUrl("fire_fly_red/Layer 1_redbird_1.png"),
      assetUrl("fire_fly_red/Layer 1_redbird_2.png"),
      assetUrl("fire_fly_red/Layer 1_redbird_3.png"),
    ],
    [
      assetUrl("Yellow_fire_fly/fire_fly_1.png"),
      assetUrl("Yellow_fire_fly/fire_fly_2.png.png"),
      assetUrl("Yellow_fire_fly/fire_fly_3.png"),
    ],
    [
      assetUrl("blue_fire_fly/sprite_0.png"),
      assetUrl("blue_fire_fly/sprite_1.png"),
      assetUrl("blue_fire_fly/sprite_2.png"),
    ],
    [
      assetUrl("green_fire_fly/sprite_0.png"),
      assetUrl("green_fire_fly/sprite_1.png"),
      assetUrl("green_fire_fly/sprite_2.png"),
    ],
    [
      assetUrl("orange_fire_fly/sprite_0.png.png"),
      assetUrl("orange_fire_fly/sprite_1.png"),
      assetUrl("orange_fire_fly/sprite_2.png"),
    ],
  ],
  normalBirdSets: [
    [
      assetUrl("blue_fly/sprite_0.png"),
      assetUrl("blue_fly/sprite_1.png"),
      assetUrl("blue_fly/sprite_2.png"),
    ],
    [
      assetUrl("cloudblue_fly/sprite_0.png"),
      assetUrl("cloudblue_fly/sprite_1.png"),
      assetUrl("cloudblue_fly/sprite_2.png"),
    ],
    [
      assetUrl("green_Fly/sprite_0.png"),
      assetUrl("green_Fly/sprite_1.png"),
      assetUrl("green_Fly/sprite_2.png"),
    ],
    [
      assetUrl("orange_fly/sprite_0.png"),
      assetUrl("orange_fly/sprite_1.png"),
      assetUrl("orange_fly/sprite_2.png"),
    ],
    [
      assetUrl("pink_fly/sprite_0.png"),
      assetUrl("pink_fly/sprite_1.png"),
      assetUrl("pink_fly/sprite_2.png"),
    ],
    [
      assetUrl("purple_fly/sprite_0.png"),
      assetUrl("purple_fly/sprite_1.png"),
      assetUrl("purple_fly/sprite_2.png"),
    ],
    [
      assetUrl("Yellow_fly/flying_1.png.png"),
      assetUrl("Yellow_fly/flying_2.png"),
      assetUrl("Yellow_fly/flying_3.png"),
    ],
  ],
};

// ------------------------------------------------------
// Tunable parameters (start here!)
// ------------------------------------------------------
const CONFIG = {
  MAIN_BIRD_SCALE: 0.7,
  MAIN_BIRD_X_RATIO: 0.33,
  MAIN_BIRD_Y_RATIO: 0.52,
  MAIN_BIRD_BOB_SPEED: 1.3,
  MAIN_BIRD_BOB_HEIGHT: 10,
  MAIN_BIRD_ANIM_FPS: 10,
  MAIN_BIRD_SPEED: 80,
  BACKGROUND_BIRD_SCALE_RANGE: [0.4, 0.55],
  BACKGROUND_BIRD_Y_RANGE: [90, 280],
  BACKGROUND_BIRD_DRIFT_RANGE: 70,
  BACKGROUND_BIRD_SPEED_RANGE: [70, 110],
  BACKGROUND_BIRD_INTERVAL: [5, 8],
  BACKGROUND_BIRD_MAX_COUNT: 3,
  BACKGROUND_BIRD_MIN_GAP: 90,
  BACKGROUND_BIRD_TILT_MAX: 0.45,
  CHASE_INTERVAL_MS: 10000,
  CHASE_DURATION_RANGE_MS: [7000, 9000],
  CHASE_COOLDOWN_MS: 2000,
  CHASE_SPEED: 260,
  CHASE_YELLOW_OFFSET: 960,
  CHASE_YELLOW_FIRE_RATE: 0.2,
  CHASE_BURST_DURATION_RANGE: [0.6, 1.1],
  CHASE_BURST_COOLDOWN_RANGE: [0.8, 1.4],
  CHASE_BULLET_SPEED: 700,
  CHASE_MUZZLE_OFFSET_Y: 0.58,
  CHASE_SHAKE_TIME: 0.06,
  CHASE_DEBUG_START: true,
  BULLET_FADE_TIME: 1.5,
  PARTICLE_GRAVITY: 1800,
  PARTICLE_DRAG: 3.5,
  BULLET_INTERVAL_RANGE: [0.8, 1.5],
  BULLET_SPEED: 420,
  BULLET_LIFETIME: 3,
};

// ------------------------------------------------------
// Game state
// ------------------------------------------------------
const state = {
  time: 0,
  lastTime: 0,
  width: DESIGN_WIDTH,
  height: DESIGN_HEIGHT,
  viewLeft: 0,
  viewTop: 0,
  hasBooted: false,
  backgroundBirds: [],
  bullets: [],
  particles: [],
  particlePool: [],
  nextBirdTime: 0,
  nextShotTime: 0,
  mainBird: {
    wingTime: 0,
  },
  chases: [],
  nextChaseStart: 0,
};


// ------------------------------------------------------
// Procedural bullet sprite
// ------------------------------------------------------
const bulletCanvas = document.createElement("canvas");
const bulletCtx = bulletCanvas.getContext("2d");
const chaseBulletCanvas = document.createElement("canvas");
const chaseBulletCtx = chaseBulletCanvas.getContext("2d");

bulletCanvas.width = 12;
bulletCanvas.height = 4;
chaseBulletCanvas.width = 63;
chaseBulletCanvas.height = 14;

function drawBulletSprite() {
  bulletCtx.clearRect(0, 0, bulletCanvas.width, bulletCanvas.height);
  bulletCtx.fillStyle = "#ffffff";
  bulletCtx.fillRect(0, 1, 12, 2);

  chaseBulletCtx.clearRect(0, 0, chaseBulletCanvas.width, chaseBulletCanvas.height);
  chaseBulletCtx.fillStyle = "#ffffff";
  chaseBulletCtx.fillRect(0, 5, 63, 4);
}

// ------------------------------------------------------
// Particle system (shared by explosions + muzzle bursts)
// ------------------------------------------------------
const EXPLOSION_COLORS = ["#ffffff", "#ffe27a", "#ffb84f", "#ff7a3a", "#e54b2c"];
const MUZZLE_COLORS = ["#ffffff", "#e8e8e8", "#d6d6d6"];

function getParticle() {
  return state.particlePool.length ? state.particlePool.pop() : {};
}

function recycleParticle(particle) {
  state.particlePool.push(particle);
}

function spawnExplosion(x, y, power = 1) {
  const count = Math.floor(20 + Math.random() * 21);
  for (let i = 0; i < count; i += 1) {
    const p = getParticle();
    const speed = (120 + Math.random() * 220) * power;
    const angle = Math.random() * Math.PI * 2;
    const size = 3 + Math.random() * 4;
    p.x = x;
    p.y = y;
    p.vx = Math.cos(angle) * speed;
    p.vy = Math.sin(angle) * speed - 60;
    p.size = size;
    p.rotation = Math.random() * Math.PI * 2;
    p.angularVelocity = randomRange(-6, 6);
    p.life = 0;
    p.maxLife = randomRange(0.6, 1.0);
    p.color = EXPLOSION_COLORS[Math.floor(Math.random() * EXPLOSION_COLORS.length)];
    state.particles.push(p);
  }
}

function spawnMuzzleBurst(x, y) {
  const count = Math.floor(12 + Math.random() * 6);
  for (let i = 0; i < count; i += 1) {
    const p = getParticle();
    const speed = 520 + Math.random() * 320;
    const angle = randomRange(-0.6, 0.6);
    const size = 10 + Math.random() * 5;
    p.x = x;
    p.y = y;
    p.vx = Math.cos(angle) * speed;
    p.vy = Math.sin(angle) * speed - 40;
    p.size = size;
    p.rotation = Math.random() * Math.PI * 2;
    p.angularVelocity = randomRange(-8, 8);
    p.life = 0;
    p.maxLife = randomRange(0.25, 0.4);
    p.color = MUZZLE_COLORS[Math.floor(Math.random() * MUZZLE_COLORS.length)];
    state.particles.push(p);
  }
}

function updateParticles(dt) {
  for (let i = state.particles.length - 1; i >= 0; i -= 1) {
    const p = state.particles[i];
    p.life += dt;
    if (p.life >= p.maxLife) {
      state.particles.splice(i, 1);
      recycleParticle(p);
      continue;
    }

    p.vy += CONFIG.PARTICLE_GRAVITY * dt;
    p.vx -= p.vx * CONFIG.PARTICLE_DRAG * dt;
    p.vy -= p.vy * CONFIG.PARTICLE_DRAG * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rotation += p.angularVelocity * dt;
  }
}

function renderParticles() {
  for (const p of state.particles) {
    const alpha = 1 - p.life / p.maxLife;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(Math.floor(p.x), Math.floor(p.y));
    ctx.rotate(p.rotation);
    ctx.fillStyle = p.color;
    ctx.fillRect(
      Math.floor(-p.size / 2),
      Math.floor(-p.size / 2),
      Math.floor(p.size),
      Math.floor(p.size)
    );
    ctx.restore();
  }
}

// ------------------------------------------------------
// Initialization
// ------------------------------------------------------
export async function init(targetCanvas) {
  // Reset state on init to avoid duplicate background spawns (e.g., hot reload / re-init).
  state.time = 0;
  state.lastTime = 0;
  state.hasBooted = false;
  state.backgroundBirds = [];
  state.bullets = [];
  state.particles = [];
  state.particlePool = [];
  state.chases = [];
  state.nextBirdTime = 0;
  state.nextShotTime = 0;
  state.nextChaseStart = 0;
  state.mainBird.wingTime = 0;

  canvas = targetCanvas;
  drawBulletSprite();

  const [, fireBirdSets, normalBirdSets] = await Promise.all([
    initEnvironment(),
    Promise.all(ASSETS.fireBirdSets.map(loadFrames)),
    Promise.all(ASSETS.normalBirdSets.map(loadFrames)),
  ]);

  state.assets = {
    fireBirdSets,
    normalBirdSets,
  };

  state.mainBirdFrames = pickRandomNormalFrames();

  // Schedule events.
  state.nextShotTime = randomRange(CONFIG.BULLET_INTERVAL_RANGE[0], CONFIG.BULLET_INTERVAL_RANGE[1]);
  state.nextBirdTime = randomRange(CONFIG.BACKGROUND_BIRD_INTERVAL[0], CONFIG.BACKGROUND_BIRD_INTERVAL[1]);
  state.nextChaseStart = state.time + CONFIG.CHASE_INTERVAL_MS / 1000;
  if (CONFIG.CHASE_DEBUG_START) {
    spawnChaseRandom();
  }
}

export function setViewport({ width, height, viewLeft, viewTop }) {
  state.width = width;
  state.height = height;
  state.viewLeft = viewLeft;
  state.viewTop = viewTop;
  setEnvironmentViewport({ width, height, viewLeft, viewTop });
  clampActiveChaseToScreen();
}

export function setEnvironmentScrollEnabledForMenu(enabled) {
  setEnvironmentScrollEnabled({ ground: enabled, bkg1: enabled });
}

export function setEnvironmentQualityForMenu({ mobilePortrait }) {
  setEnvironmentQuality({ mobilePortrait });
}

export function markBooted() {
  state.hasBooted = true;
}

// ------------------------------------------------------
// Spawners
// ------------------------------------------------------
function spawnBackgroundBird() {
  const bird = createBackgroundBird();
  if (canPlaceBird(bird.baseY, bird.scale)) {
    state.backgroundBirds.push(bird);
  }
}

function createBackgroundBird() {
  const data = { frames: pickRandomNormalFrames() };
  const scale = randomRange(CONFIG.BACKGROUND_BIRD_SCALE_RANGE[0], CONFIG.BACKGROUND_BIRD_SCALE_RANGE[1]);
  const baseY = pickSafeBirdY(scale);
  const driftRange = randomRange(CONFIG.BACKGROUND_BIRD_DRIFT_RANGE * 0.7, CONFIG.BACKGROUND_BIRD_DRIFT_RANGE);
  const driftSpeed = randomRange(0.4, 0.7);

  return {
    frames: data.frames,
    x: state.viewLeft + state.width + 80 + Math.random() * 120,
    baseY,
    driftRange,
    driftSpeed,
    driftTime: Math.random() * Math.PI * 2,
    y: baseY,
    prevY: baseY,
    tilt: 0,
    speed: randomRange(CONFIG.BACKGROUND_BIRD_SPEED_RANGE[0], CONFIG.BACKGROUND_BIRD_SPEED_RANGE[1]),
    scale,
    wingTime: Math.random() * 2,
    bobPhase: Math.random() * Math.PI * 2,
  };
}

function shootBullet(x, y, direction) {
  state.bullets.push({
    x,
    y,
    vx: CONFIG.BULLET_SPEED * direction,
    age: 0,
  });
}

// ------------------------------------------------------
// Update step
// ------------------------------------------------------
export function update(dt) {
  if (!state.hasBooted) {
    return;
  }
  state.time += dt;
  updateEnvironment(dt);
  updateParticles(dt);

  // Animate main bird wing frames.
  state.mainBird.wingTime += dt * CONFIG.MAIN_BIRD_ANIM_FPS;

  // Main bird shoots to the right on a gentle interval.
  if (state.time >= state.nextShotTime) {
    const mainPos = getMainBirdPosition();
    const groundY = getGroundTop() - bulletCanvas.height - 4;
    shootBullet(mainPos.x + mainPos.width - 2, groundY, 1);
    state.nextShotTime = state.time + randomRange(CONFIG.BULLET_INTERVAL_RANGE[0], CONFIG.BULLET_INTERVAL_RANGE[1]);
  }

  // Move bullets.
  for (const bullet of state.bullets) {
    bullet.x += bullet.vx * dt;
    bullet.age += dt;
  }
  state.bullets = state.bullets.filter(
    (bullet) =>
      bullet.x > state.viewLeft - 40 &&
      bullet.x < state.viewLeft + state.width + 40 &&
      bullet.age < CONFIG.BULLET_LIFETIME
  );

  // Spawn background birds occasionally.
  if (state.time >= state.nextBirdTime) {
    if (state.backgroundBirds.length < CONFIG.BACKGROUND_BIRD_MAX_COUNT) {
      spawnBackgroundBird();
    }
    state.nextBirdTime = state.time + randomRange(CONFIG.BACKGROUND_BIRD_INTERVAL[0], CONFIG.BACKGROUND_BIRD_INTERVAL[1]);
  }

  // Move background birds.
  for (const bgBird of state.backgroundBirds) {
    bgBird.x -= bgBird.speed * dt;
    bgBird.wingTime += dt * 8;
    moveBackgroundBird(bgBird, dt);
  }
  state.backgroundBirds = state.backgroundBirds.filter(
    (bgBird) => bgBird.x > state.viewLeft - 200
  );

  updateChases(dt);
}

// ------------------------------------------------------
// Render step
// ------------------------------------------------------
export function render(targetCtx) {
  ctx = targetCtx;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
  ctx.imageSmoothingEnabled = false;

  renderEnvironment(ctx);

  // Background birds (smaller + transparent).
  for (const bgBird of state.backgroundBirds) {
    const frame = bgBird.frames[Math.floor(bgBird.wingTime) % bgBird.frames.length];
    const w = Math.floor(frame.width * bgBird.scale);
    const h = Math.floor(frame.height * bgBird.scale);
    const y = getBirdY(bgBird, h);
    drawImageRotatedFlipped(frame, bgBird.x, y, w, h, bgBird.tilt, true);
  }

  // Main bird (yellow, centered, gentle bob).
  const mainFrames = state.mainBirdFrames;
  const mainFrame = mainFrames[Math.floor(state.mainBird.wingTime) % mainFrames.length];
  const mainPos = getMainBirdPosition();
  drawImage(mainFrame, mainPos.x, mainPos.y, mainPos.width, mainPos.height);

  // Bullets.
  for (const bullet of state.bullets) {
    drawImage(bulletCanvas, bullet.x, bullet.y, bulletCanvas.width, bulletCanvas.height);
  }

  renderParticles();

  renderChases();
}

// ------------------------------------------------------
// Drawing helpers
// ------------------------------------------------------
function drawImage(img, x, y, w, h) {
  ctx.drawImage(
    img,
    Math.floor(x),
    Math.floor(y),
    Math.floor(w),
    Math.floor(h)
  );
}

function drawImageFlipped(img, x, y, w, h, flip) {
  if (!flip) {
    drawImage(img, x, y, w, h);
    return;
  }

  ctx.save();
  ctx.translate(Math.floor(x + w / 2), Math.floor(y + h / 2));
  ctx.scale(-1, 1);
  ctx.drawImage(img, Math.floor(-w / 2), Math.floor(-h / 2), Math.floor(w), Math.floor(h));
  ctx.restore();
}

function drawImageRotated(img, x, y, w, h, angle) {
  ctx.save();
  ctx.translate(Math.floor(x + w / 2), Math.floor(y + h / 2));
  ctx.rotate(angle);
  ctx.drawImage(img, Math.floor(-w / 2), Math.floor(-h / 2), Math.floor(w), Math.floor(h));
  ctx.restore();
}

function drawImageRotatedFlipped(img, x, y, w, h, angle, flip) {
  ctx.save();
  ctx.translate(Math.floor(x + w / 2), Math.floor(y + h / 2));
  ctx.rotate(angle);
  ctx.scale(flip ? -1 : 1, 1);
  ctx.drawImage(img, Math.floor(-w / 2), Math.floor(-h / 2), Math.floor(w), Math.floor(h));
  ctx.restore();
}

function getGroundTop() {
  return getEnvironmentGroundTop();
}

function getBirdY(bird, height) {
  const groundTop = getGroundTop();
  let y = bird.y - height / 2;

  const maxY = groundTop - height - 6;
  if (y > maxY) y = maxY;
  if (y < 10) y = 10;

  return Math.floor(y);
}

function getMainBirdPosition() {
  const frame = state.mainBirdFrames[0];
  const width = Math.floor(frame.width * CONFIG.MAIN_BIRD_SCALE);
  const height = Math.floor(frame.height * CONFIG.MAIN_BIRD_SCALE);
  const travelWidth = state.width + width * 2;
  const baseX = Math.floor((state.time * CONFIG.MAIN_BIRD_SPEED) % travelWidth) - width + state.viewLeft;
  const baseY = Math.floor(state.viewTop + state.height * CONFIG.MAIN_BIRD_Y_RATIO);
  const bob = Math.sin(state.time * CONFIG.MAIN_BIRD_BOB_SPEED) * CONFIG.MAIN_BIRD_BOB_HEIGHT;

  let y = baseY + bob - height / 2;
  const maxY = getGroundTop() - height - 8;
  if (y > maxY) y = maxY;

  return {
    x: baseX,
    y: Math.floor(y),
    width,
    height,
  };
}

function pickSafeBirdY(scale) {
  const frame = state.assets.normalBirdSets[0][0];
  const height = Math.floor(frame.height * scale);
  const minY = state.viewTop + CONFIG.BACKGROUND_BIRD_Y_RANGE[0];
  const maxY = Math.min(
    state.viewTop + CONFIG.BACKGROUND_BIRD_Y_RANGE[1],
    getGroundTop() - height - 12
  );
  return Math.floor(randomRange(minY, Math.max(minY + 10, maxY)));
}

function pickRandomNormalFrames() {
  const sets = state.assets.normalBirdSets;
  return sets[Math.floor(Math.random() * sets.length)];
}

function pickRandomFireFrames() {
  const sets = state.assets.fireBirdSets;
  return sets[Math.floor(Math.random() * sets.length)];
}

function moveBackgroundBird(bird, dt) {
  const frame = bird.frames[0];
  const height = Math.floor(frame.height * bird.scale);
  const groundTop = getGroundTop();
  const minY = state.viewTop + CONFIG.BACKGROUND_BIRD_Y_RANGE[0];
  const maxY = Math.min(state.viewTop + CONFIG.BACKGROUND_BIRD_Y_RANGE[1], groundTop - height - 10);
  bird.driftTime += dt;

  const centerY = bird.baseY + Math.sin(bird.driftTime * bird.driftSpeed) * bird.driftRange;
  bird.prevY = bird.y;
  bird.y = clamp(centerY, minY + height * 0.5, maxY + height * 0.5);

  const dy = bird.y - bird.prevY;
  bird.tilt = clamp(dy * 0.06, -CONFIG.BACKGROUND_BIRD_TILT_MAX, CONFIG.BACKGROUND_BIRD_TILT_MAX);
}

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function smoothDamp(current, target, velocityKey, obj, smoothTime, maxSpeed, dt) {
  const omega = 2 / Math.max(0.0001, smoothTime);
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  let change = current - target;
  const originalTo = target;
  const maxChange = maxSpeed * smoothTime;
  change = clamp(change, -maxChange, maxChange);
  target = current - change;
  const temp = (obj[velocityKey] + omega * change) * dt;
  obj[velocityKey] = (obj[velocityKey] - omega * temp) * exp;
  let output = target + (change + temp) * exp;
  if ((originalTo - current > 0) === (output > originalTo)) {
    output = originalTo;
    obj[velocityKey] = (output - originalTo) / dt;
  }
  return output;
}

function canPlaceBird(y, scale) {
  const frame = state.assets.normalBirdSets[0][0];
  const height = Math.floor(frame.height * scale);
  for (const bird of state.backgroundBirds) {
    const otherHeight = Math.floor(bird.frames[0].height * bird.scale);
    const gap = Math.abs(y - bird.baseY);
    if (gap < CONFIG.BACKGROUND_BIRD_MIN_GAP + Math.max(height, otherHeight) * 0.5) {
      return false;
    }
  }
  return true;
}

// ------------------------------------------------------
// Chase event system (paired chases)
// ------------------------------------------------------
function updateChases(dt) {
  if (state.time >= state.nextChaseStart && state.chases.length === 0) {
    if (Math.random() < 0.6) {
      spawnChaseRandom();
    }
    state.nextChaseStart = state.time + CONFIG.CHASE_INTERVAL_MS / 1000;
  }

  for (let i = state.chases.length - 1; i >= 0; i -= 1) {
    const chase = state.chases[i];
    updateChaseBirds(chase, dt);
    updateChaseBullets(chase, dt);
    chase.duration -= dt;
    if (chase.duration <= 0 && chaseExitedScreen(chase)) {
      state.chases.splice(i, 1);
    }
  }
}

function spawnChaseRandom() {
  const dir = Math.random() < 0.5 ? 1 : -1;
  state.chases.push(createChase(dir));
}

function createChase(dir) {
  const chase = {
    duration: randomRange(CONFIG.CHASE_DURATION_RANGE_MS[0], CONFIG.CHASE_DURATION_RANGE_MS[1]) / 1000,
    bullets: [],
    bulletId: 0,
    shakeTime: 0,
    dir,
    yellow: null,
    red: null,
    nextShot: state.time,
    firePauseUntil: 0,
  };
  setupChase(chase);
  return chase;
}

function setupChase(chase) {
  const redFrame = state.assets.fireBirdSets[0][0];
  const yellowFrame = state.assets.normalBirdSets[0][0];
  const redScale = 0.6;
  const yellowScale = 0.55;
  const redWidth = Math.floor(redFrame.width * redScale);
  const redHeight = Math.floor(redFrame.height * redScale);
  const yellowWidth = Math.floor(yellowFrame.width * yellowScale);
  const yellowHeight = Math.floor(yellowFrame.height * yellowScale);

  const centerY = state.viewTop + state.height * 0.45;
  const redY = clamp(centerY - redHeight / 2, state.viewTop + 20, getGroundTop() - redHeight - 20);
  const yellowY = clamp(redY + 8, state.viewTop + 20, getGroundTop() - yellowHeight - 20);
  const startX = chase.dir === 1 ? state.viewLeft - yellowWidth - 60 : state.viewLeft + state.width + yellowWidth + 220;
  const offset =
    chase.dir === 1
      ? Math.max(CONFIG.CHASE_YELLOW_OFFSET, Math.floor(yellowWidth * 1.1))
      : Math.max(CONFIG.CHASE_YELLOW_OFFSET * 1.4, Math.floor(yellowWidth * 1.6));

  // Red target (dodging).
  chase.red = {
    frames: pickRandomNormalFrames(),
    x: startX,
    y: redY,
    width: redWidth,
    height: redHeight,
    speed: CONFIG.CHASE_SPEED * chase.dir,
    wingTime: Math.random() * 2,
    tilt: 0,
    baseY: redY,
    driftTarget: redY,
    driftTimer: 0,
    dodgeOffset: 0,
    dodgeTarget: 0,
    dodgeTimer: 0,
    dodgeVel: 0,
    lastDodgedBulletId: -1,
    vy: 0,
  };

  // Yellow attacker (firing).
  chase.yellow = {
    frames: pickRandomFireFrames(),
    x: startX - offset * chase.dir,
    y: yellowY,
    width: yellowWidth,
    height: yellowHeight,
    speed: (CONFIG.CHASE_SPEED + 20) * chase.dir,
    wingTime: Math.random() * 2,
    tilt: 0,
    followOffset: 14,
    noiseTarget: 0,
    noiseValue: 0,
    noiseTimer: 0,
    prevY: yellowY,
    vy: 0,
  };
}

function updateChaseBirds(chase, dt) {
  if (!chase.red || !chase.yellow) return;

  const groundTop = getGroundTop();
  const redMinY = state.viewTop + 20;
  const redMaxY = groundTop - chase.red.height - 20;
  const redSpan = Math.max(60, redMaxY - redMinY);

  // Red target: forward motion + noise drift + bullet dodges.
  chase.red.x += chase.red.speed * dt;
  chase.red.wingTime += dt * 10;

  chase.red.driftTimer -= dt;
  if (chase.red.driftTimer <= 0) {
    chase.red.driftTarget = randomRange(redMinY, redMaxY);
    chase.red.driftTimer = randomRange(2.4, 4.4);
  }
  chase.red.baseY += (chase.red.driftTarget - chase.red.baseY) * Math.min(1, dt * 1.2);

  const dodge = findImminentBulletDodge(chase, redMinY, redMaxY);
  if (dodge) {
    chase.red.dodgeTarget = dodge.offset;
    chase.red.dodgeTimer = 0.22;
    chase.red.lastDodgedBulletId = dodge.bulletId;
  } else {
    chase.red.dodgeTimer = Math.max(0, chase.red.dodgeTimer - dt);
    if (chase.red.dodgeTimer === 0) {
      chase.red.dodgeTarget = 0;
    }
  }

  chase.red.dodgeOffset += (chase.red.dodgeTarget - chase.red.dodgeOffset) * Math.min(1, dt * 6);

  const redDesired = clamp(chase.red.baseY + chase.red.dodgeOffset, redMinY, redMaxY);
  chase.red.y += (redDesired - chase.red.y) * Math.min(1, dt * 3.2);
  chase.red.tilt = clamp((redDesired - chase.red.y) * 0.02, -0.45, 0.45);

  // Yellow attacker: vertical position is driven by red with minor noise.
  const chaseGap = Math.max(CONFIG.CHASE_YELLOW_OFFSET, Math.floor(chase.red.width * 1.2));
  chase.yellow.x = chase.red.x - chaseGap * chase.dir;
  chase.yellow.wingTime += dt * 12;

  const yellowMinY = state.viewTop + 20;
  const yellowMaxY = groundTop - chase.yellow.height - 20;
  chase.yellow.noiseTimer -= dt;
  if (chase.yellow.noiseTimer <= 0) {
    chase.yellow.noiseTarget = randomRange(-28, 28);
    chase.yellow.noiseTimer = randomRange(1.2, 2.2);
  }
  chase.yellow.noiseValue += (chase.yellow.noiseTarget - chase.yellow.noiseValue) * Math.min(1, dt * 2.4);

  const yellowDesired = clamp(chase.red.y + chase.yellow.followOffset + chase.yellow.noiseValue, yellowMinY, yellowMaxY);
  chase.yellow.y += (yellowDesired - chase.yellow.y) * Math.min(1, dt * 4.2);
  chase.yellow.vy = (chase.yellow.y - chase.yellow.prevY) / Math.max(0.0001, dt);
  chase.yellow.prevY = chase.yellow.y;
  chase.yellow.tilt = clamp((yellowDesired - chase.yellow.y) * 0.02, -0.4, 0.4);
}

function updateChaseBullets(chase, dt) {
  if (!chase.yellow) return;

  if (Math.abs(chase.yellow.vy) > 60) {
    chase.firePauseUntil = state.time + 0.45;
  }

  const canFire = state.time >= chase.nextShot && state.time >= chase.firePauseUntil;
  if (canFire) {
    const muzzleX =
      chase.yellow.x +
      chase.yellow.width * 0.5 +
      (chase.dir === 1 ? 50 : -100);
    const bulletY = chase.yellow.y + chase.yellow.height * 0.5 + 50 + randomRange(-3, 3);
    spawnMuzzleBurst(muzzleX, bulletY);
    chase.bullets.push({
      id: chase.bulletId++,
      x: muzzleX,
      y: bulletY,
      vx: CONFIG.CHASE_BULLET_SPEED * chase.dir,
      age: 0,
    });
    chase.shakeTime = CONFIG.CHASE_SHAKE_TIME;
    chase.nextShot = state.time + CONFIG.CHASE_YELLOW_FIRE_RATE;
  }

  for (const bullet of chase.bullets) {
    bullet.x += bullet.vx * dt;
    bullet.age += dt;
  }
  chase.bullets = chase.bullets.filter((bullet) => bullet.age < CONFIG.BULLET_FADE_TIME);

  if (chase.shakeTime > 0) chase.shakeTime -= dt;
}

function renderChases() {
  for (const chase of state.chases) {
    renderChase(chase);
  }
}

function renderChase(chase) {
  if (!chase.red || !chase.yellow) return;

  const shakeX = chase.shakeTime > 0 ? randomRange(-1.5, 1.5) : 0;
  const shakeY = chase.shakeTime > 0 ? randomRange(-1.5, 1.5) : 0;
  const flip = chase.dir === -1;

  ctx.save();
  ctx.translate(Math.floor(shakeX), Math.floor(shakeY));

  // Bullets first (behind birds).
  for (const bullet of chase.bullets) {
    const alpha = clamp(1 - bullet.age / CONFIG.BULLET_FADE_TIME, 0, 1);
    ctx.save();
    ctx.globalAlpha = alpha;
    drawImage(chaseBulletCanvas, bullet.x, bullet.y, chaseBulletCanvas.width, chaseBulletCanvas.height);
    ctx.restore();
  }

  // Yellow target.
  const yellowFrame = chase.yellow.frames[Math.floor(chase.yellow.wingTime) % chase.yellow.frames.length];
  drawImageRotatedFlipped(
    yellowFrame,
    chase.yellow.x,
    chase.yellow.y,
    chase.yellow.width,
    chase.yellow.height,
    chase.yellow.tilt,
    flip
  );

  // Red attacker (firing).
  const redFrame = chase.red.frames[Math.floor(chase.red.wingTime) % chase.red.frames.length];
  drawImageRotatedFlipped(
    redFrame,
    chase.red.x,
    chase.red.y,
    chase.red.width,
    chase.red.height,
    chase.red.tilt,
    flip
  );

  // Muzzle flash handled by particle bursts.

  ctx.restore();
}

function chaseExitedScreen(chase) {
  if (!chase.red || !chase.yellow) return true;
  if (chase.dir === 1) {
    return chase.red.x > state.width + 80 && chase.yellow.x > state.width + 80;
  }
  return chase.red.x < -80 && chase.yellow.x < -80;
}

function clampActiveChaseToScreen() {
  for (const chase of state.chases) {
    if (!chase.red || !chase.yellow) continue;
    chase.red.y = clamp(chase.red.y, 20, getGroundTop() - chase.red.height - 20);
    chase.yellow.y = clamp(chase.yellow.y, 20, getGroundTop() - chase.yellow.height - 20);
  }
}

function findImminentBulletDodge(chase, minY, maxY) {
  const target = chase.red;
  const centerY = target.y + target.height * 0.5;
  const targetX = target.x + target.width * 0.5;
  const verticalSpan = Math.max(60, maxY - minY);
  const dodgeAmount = Math.min(260, verticalSpan * 0.6);
  let bestTime = Infinity;
  let bestBullet = null;

  for (const bullet of chase.bullets) {
    if (bullet.id === target.lastDodgedBulletId) continue;
    if (!bullet.vx) continue;
    const timeToImpact = (targetX - bullet.x) / bullet.vx;
    if (timeToImpact < 0.7 || timeToImpact > 1.0) continue;

    const verticalGap = Math.abs(bullet.y - centerY);
    if (verticalGap < target.height * 0.9 && timeToImpact < bestTime) {
      bestTime = timeToImpact;
      bestBullet = bullet;
    }
  }

  if (!bestBullet) return null;

  const preferUp = bestBullet.y >= centerY;
  const desired = (preferUp ? -1 : 1) * dodgeAmount;
  const clamped = clamp(centerY + desired, minY + target.height * 0.5, maxY + target.height * 0.5);
  return { offset: clamped - centerY, bulletId: bestBullet.id };
}
