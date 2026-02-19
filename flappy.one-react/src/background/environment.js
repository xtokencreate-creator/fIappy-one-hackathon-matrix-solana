const assetUrl = (path) => new URL(`./assets/${path}`, import.meta.url).toString();

export const DESIGN_WIDTH = 1440;
export const DESIGN_HEIGHT = 1024;

const ASSETS = {
  sky: assetUrl("bkg1.png"),
  clouds: [assetUrl("cloud_1.png"), assetUrl("cloud_2.png"), assetUrl("cloud-3.png")],
  ground: assetUrl("floor1.png"),
};

export const ENV_CONFIG = {
  SKY_COLOR: "#79c8ff",
  GROUND_HEIGHT_RATIO: 0.18,
  GROUND_SPEED: 120,
  CLOUD_SPEED_RANGE: [8, 16],
  CLOUD_SCALE_RANGE: [0.35, 0.55],
  CLOUD_Y_RANGE: [20, 140],
  CLOUD_COUNT: 9,
  BKG1_SPEED: 80,
};

const state = {
  width: DESIGN_WIDTH,
  height: DESIGN_HEIGHT,
  viewLeft: 0,
  viewTop: 0,
  groundScroll: 0,
  bkg1Scroll: 0,
  clouds: [],
  assets: null,
  scrollGround: true,
  scrollBkg1: true,
  targetCloudCount: ENV_CONFIG.CLOUD_COUNT,
};

let initPromise = null;

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

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

function drawImage(ctx, img, x, y, w, h) {
  ctx.drawImage(
    img,
    Math.floor(x),
    Math.floor(y),
    Math.floor(w),
    Math.floor(h)
  );
}

function spawnCloud(x = state.viewLeft + state.width + 60) {
  if (!state.assets?.cloudImgs?.length) return;
  const img = state.assets.cloudImgs[Math.floor(Math.random() * state.assets.cloudImgs.length)];
  const scale = randomRange(ENV_CONFIG.CLOUD_SCALE_RANGE[0], ENV_CONFIG.CLOUD_SCALE_RANGE[1]);
  const y = randomRange(ENV_CONFIG.CLOUD_Y_RANGE[0], ENV_CONFIG.CLOUD_Y_RANGE[1]);
  const speed = randomRange(ENV_CONFIG.CLOUD_SPEED_RANGE[0], ENV_CONFIG.CLOUD_SPEED_RANGE[1]);

  state.clouds.push({
    img,
    x,
    y,
    speed,
    scale,
  });
}

function drawSky(ctx) {
  ctx.fillStyle = ENV_CONFIG.SKY_COLOR;
  ctx.fillRect(state.viewLeft, state.viewTop, state.width, state.height);

  if (!state.assets?.sky) {
    return;
  }

  const img = state.assets.sky;
  const y = getGroundTop() - img.height;
  const scroll = state.scrollBkg1 ? state.bkg1Scroll % img.width : 0;
  const startX = state.viewLeft - scroll - img.width;
  for (let x = startX; x < state.viewLeft + state.width + img.width; x += img.width) {
    drawImage(ctx, img, x, y, img.width, img.height);
  }
}

function drawGround(ctx) {
  const img = state.assets?.ground;
  if (!img) return;
  const groundHeight = Math.floor(state.height * ENV_CONFIG.GROUND_HEIGHT_RATIO);
  const scale = groundHeight / img.height;
  const tileWidth = Math.floor(img.width * scale);
  const tileHeight = Math.floor(img.height * scale);
  const y = getGroundTop();
  const scroll = state.scrollGround ? state.groundScroll % tileWidth : 0;
  const startX = state.viewLeft - scroll - tileWidth;
  for (let x = startX; x < state.viewLeft + state.width + tileWidth; x += tileWidth) {
    drawImage(ctx, img, x - 1, y, tileWidth + 1, tileHeight);
  }
}

export function setEnvironmentViewport({ width, height, viewLeft, viewTop }) {
  if (Number.isFinite(width)) state.width = width;
  if (Number.isFinite(height)) state.height = height;
  if (Number.isFinite(viewLeft)) state.viewLeft = viewLeft;
  if (Number.isFinite(viewTop)) state.viewTop = viewTop;
}

export function getEnvironmentGroundTop() {
  return getGroundTop();
}

export function getEnvironmentAssets() {
  return state.assets;
}

export function getEnvironmentClouds() {
  return state.clouds;
}

export function getEnvironmentScroll() {
  return {
    groundScroll: state.groundScroll,
    bkg1Scroll: state.bkg1Scroll,
  };
}

export function setEnvironmentScrollEnabled({ ground, bkg1 }) {
  if (typeof ground === "boolean") state.scrollGround = ground;
  if (typeof bkg1 === "boolean") state.scrollBkg1 = bkg1;
}

export function setEnvironmentQuality({ mobilePortrait } = {}) {
  state.targetCloudCount = mobilePortrait ? 5 : ENV_CONFIG.CLOUD_COUNT;
}

export function initEnvironment() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const [skyImg, groundImg, cloudImgs] = await Promise.all([
      loadImage(ASSETS.sky),
      loadImage(ASSETS.ground),
      loadFrames(ASSETS.clouds),
    ]);

    state.assets = {
      sky: skyImg,
      ground: groundImg,
      cloudImgs,
    };

    if (state.clouds.length === 0) {
      let x = state.viewLeft;
      while (state.clouds.length < ENV_CONFIG.CLOUD_COUNT) {
        spawnCloud(x);
        x += 220 + Math.random() * 160;
      }
    }
  })();
  return initPromise;
}

export function updateEnvironment(dt) {
  if (state.scrollGround) {
    state.groundScroll += ENV_CONFIG.GROUND_SPEED * dt;
  }
  if (state.scrollBkg1) {
    state.bkg1Scroll += ENV_CONFIG.BKG1_SPEED * dt;
  }

  for (const cloud of state.clouds) {
    cloud.x -= cloud.speed * dt;
  }

  const recycleEdge = state.viewLeft - 80;
  // In-place compaction avoids per-frame array allocation and GC hitches.
  let writeIndex = 0;
  for (let readIndex = 0; readIndex < state.clouds.length; readIndex += 1) {
    const cloud = state.clouds[readIndex];
    if (cloud.x + cloud.img.width * cloud.scale > recycleEdge) {
      state.clouds[writeIndex] = cloud;
      writeIndex += 1;
    }
  }
  state.clouds.length = writeIndex;
  while (state.clouds.length < state.targetCloudCount) {
    spawnCloud();
  }
}

export function renderEnvironment(ctx) {
  drawSky(ctx);

  for (const cloud of state.clouds) {
    const w = Math.floor(cloud.img.width * cloud.scale);
    const h = Math.floor(cloud.img.height * cloud.scale);
    drawImage(ctx, cloud.img, cloud.x, cloud.y, w, h);
  }

  drawGround(ctx);
}

function getGroundTop() {
  const groundHeight = Math.floor(state.height * ENV_CONFIG.GROUND_HEIGHT_RATIO);
  return state.viewTop + state.height - groundHeight;
}
