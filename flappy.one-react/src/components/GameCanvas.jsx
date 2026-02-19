import { useRef, useEffect, useState, memo } from 'react';
import {
  initEnvironment,
  setEnvironmentViewport,
  getEnvironmentAssets,
  setEnvironmentScrollEnabled,
  ENV_CONFIG,
  DESIGN_WIDTH,
  DESIGN_HEIGHT,
} from '../background/environment';
import AudioPool from '../utils/AudioPool';
import sfxManager from '../audio/SfxManager';
import { CONTROLLER_BINDINGS, createControllerState, pollControllerInput } from '../game/controllerInput';
import { createHapticsManager } from '../game/hapticsManager';
import './GameCanvas.css';

// Constants from server
const PLAYER_SIZE = 25;
const BULLET_SIZE = 9;
const BULLET_SPEED = 18;
const BULLET_SPREAD = 0.08;
const SHOOT_COOLDOWN = 120;
const ORB_SIZE = 12;
const ANIMATION_FPS = 8;

// Sprite scale and zoom
const BIRD_SCALE = 10.5;
const ZOOM_LEVEL = 0.5;
const DEBUG_DISABLE_BORDER = false;
const GROUND_HEIGHT_RATIO = ENV_CONFIG.GROUND_HEIGHT_RATIO;
const GROUND_BASE_PX = 560;
const BKG1_BASE_PX = 128;
const CLOUD_SCALE_FACTOR = 2.75;
const GAMEPLAY_CLOUD_COUNT = 5;
const BIRD_TYPES = ['yellow', 'blue', 'cloudyblue', 'orange', 'pink', 'purple', 'red', 'teal', 'diddy'];

// Note: Bots are now server-side and come through as regular players with isBot: true

// Bullet range (2.5 bird lengths in world units)
const BULLET_RANGE = PLAYER_SIZE * 2.5 * 12; // fallback only; server config drives live range

// Interpolation - KEY for smooth movement
const POSITION_LERP = 0.25;  // Smooth but responsive
const ANGLE_LERP = 0.3;
const CAMERA_LERP = 0.15;
const INTERPOLATION_DELAY_MS = 100;
const SNAPSHOT_RETENTION_MS = 1500;
const MUZZLE_COLORS = ['#ffffff', '#e8e8e8', '#d6d6d6'];
const HUD_COLORS = {
  panelTop: '#171717',
  panelBottom: '#0f0f0f',
  panelEdge: '#2a2a2a',
  panelGlow: 'rgba(255,255,255,0.06)',
  textWhite: '#f5f5f5',
  textMuted: '#8b8b8b',
  green: '#2bd96b',
  healthFill: '#34d399',
  boostFill: '#43c6ff',
  boostFillDim: '#2a6f8f',
  yellow: '#ffd54a',
  yellowEdge: '#b8930a',
  yellowText: '#1b1b1b',
  shadowDark: 'rgba(0,0,0,0.6)',
  radarRing: '#5a1014',
  radarRingInner: '#8b1a1f',
};
const HUD_FONT = '"Inter Bold", "Inter", "Segoe UI", Arial, sans-serif';
const HUD_MONEY_FORMAT = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const MOBILE_CASHOUT_BAR_HEIGHT = 84;
const MOBILE_LANDSCAPE_BUTTON_SIZE = 86;
const MOBILE_LANDSCAPE_CASHOUT_WIDTH = 148;
const MOBILE_LANDSCAPE_CASHOUT_HEIGHT = 46;
const MOBILE_LANDSCAPE_CONTROLS_MARGIN = 16;
const MOBILE_LANDSCAPE_CONTROLS_GAP = 12;
const MOBILE_LANDSCAPE_CONTROLS_RAISE_PX = 20;
const MOBILE_CASHOUT_ONLY_RAISE_PX = 55;
const MOBILE_DOUBLE_TAP_BOOST_MS = 250;
const MOBILE_DOUBLE_TAP_BOOST_MAX_DIST_PX = 30;
const MOBILE_DPR_CAP = 1.25;
const DESKTOP_DPR_CAP = 2;
const MAX_HEAR_DISTANCE = 800;
const SHOT_HEAR_DISTANCE = MAX_HEAR_DISTANCE * 3;
const MAX_FRAME_MS = 33;
const MUZZLE_MAX_MOBILE = 12;
const MUZZLE_MAX_DESKTOP = 80;
const MAX_BULLETS = 120;
const MAX_PARTICLES = 120;
const MAX_TRAILS = 80;
const MAX_PARTICLES_MOBILE = 48;
const MAX_TRAILS_MOBILE = 32;
const MAX_BULLETS_MOBILE_LS = 40;
const EFFECTS_ENABLED_DESKTOP = true;
const EFFECTS_ENABLED_MOBILE = true;
const MUZZLE_SPAWN_Y_OFFSET = -20;
const MUZZLE_SHOT_COUNT_MOBILE = 2;
const MUZZLE_SHOT_COUNT_DESKTOP_MIN = 6;
const MUZZLE_SHOT_COUNT_DESKTOP_VAR = 4;
const FEATHER_VFX_CAP_DESKTOP = 140;
const FEATHER_VFX_CAP_MOBILE = 48;
const FEATHER_VFX_PER_DEATH_DESKTOP = 14;
const FEATHER_VFX_PER_DEATH_MOBILE = 7;
const BOOST_TRAIL_ADD_DIST = 16;
const BOOST_TRAIL_MAX_DESKTOP = 72;
const BOOST_TRAIL_MAX_MOBILE = 28;
const BOOST_TRAIL_LIFE_DECAY = 0.055;
const SHOT_SHAKE_MS = 85;
const SHOT_SHAKE_AMP_PX = 1.8;
const CONTROLLER_CRUISE_THROTTLE = 0.72;
const CONTROLLER_AIM_RADIUS_PX = 220;

// Helper functions
function lerp(a, b, t) {
  return a + (b - a) * t;
}

function normalizeAngle(angle) {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

function lerpAngle(a, b, t) {
  let diff = normalizeAngle(b - a);
  return a + diff * t;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function distance(x1, y1, x2, y2) {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

function circleCollision(x1, y1, r1, x2, y2, r2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const rr = r1 + r2;
  return dx * dx + dy * dy <= rr * rr;
}

function circleRectCollision(cx, cy, radius, rx, ry, rw, rh) {
  const closestX = clamp(cx, rx, rx + rw);
  const closestY = clamp(cy, ry, ry + rh);
  const dx = cx - closestX;
  const dy = cy - closestY;
  return dx * dx + dy * dy <= radius * radius;
}

function formatUsd(value) {
  const amount = Number.isFinite(value) ? value : 0;
  return HUD_MONEY_FORMAT.format(amount);
}

function roundRectPath(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function fillRoundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  roundRectPath(ctx, x, y, w, h, r);
  ctx.fill();
}

function strokeRoundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  roundRectPath(ctx, x, y, w, h, r);
  ctx.stroke();
}

function drawHudPanel(ctx, rect) {
  const shadowOffset = 3;
  ctx.save();
  ctx.fillStyle = HUD_COLORS.shadowDark;
  fillRoundedRect(ctx, rect.x, rect.y + shadowOffset, rect.w, rect.h, rect.r);
  const gradient = ctx.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.h);
  gradient.addColorStop(0, HUD_COLORS.panelTop);
  gradient.addColorStop(1, HUD_COLORS.panelBottom);
  ctx.fillStyle = gradient;
  fillRoundedRect(ctx, rect.x, rect.y, rect.w, rect.h, rect.r);
  ctx.strokeStyle = HUD_COLORS.panelEdge;
  ctx.lineWidth = 1.5;
  strokeRoundedRect(ctx, rect.x, rect.y, rect.w, rect.h, rect.r);
  ctx.fillStyle = HUD_COLORS.panelGlow;
  fillRoundedRect(ctx, rect.x + 6, rect.y + 6, rect.w - 12, 10, rect.r);
  ctx.restore();
}

function drawHudButton(ctx, rect, label, state) {
  const baseShadow = 4;
  const hoverOffset = state.hover ? 4 : 0;
  const pressOffset = state.pressed ? 2 : 0;
  const offset = hoverOffset + pressOffset;
  const shadowDepth = Math.max(1, baseShadow - offset * 0.6);

  ctx.save();
  ctx.fillStyle = '#7a5e08';
  fillRoundedRect(ctx, rect.x, rect.y + offset + shadowDepth, rect.w, rect.h, rect.r);
  const gradient = ctx.createLinearGradient(rect.x, rect.y + offset, rect.x, rect.y + rect.h + offset);
  gradient.addColorStop(0, '#ffe06a');
  gradient.addColorStop(1, '#e6b800');
  ctx.fillStyle = gradient;
  fillRoundedRect(ctx, rect.x, rect.y + offset, rect.w, rect.h, rect.r);
  ctx.strokeStyle = HUD_COLORS.yellowEdge;
  ctx.lineWidth = 1.5;
  strokeRoundedRect(ctx, rect.x, rect.y + offset, rect.w, rect.h, rect.r);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  fillRoundedRect(ctx, rect.x + 6, rect.y + offset + 6, rect.w - 12, 8, rect.r);
  ctx.fillStyle = HUD_COLORS.yellowText;
  ctx.font = `700 16px ${HUD_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, rect.x + rect.w / 2, rect.y + offset + rect.h / 2);
  ctx.restore();
}

function drawHudBar(ctx, rect, percent, options = {}) {
  const pct = clamp(percent, 0, 1);
  const {
    fill = HUD_COLORS.green,
    track = '#0c0c0c',
    glow = null,
    label = '',
    value = '',
  } = options;

  ctx.save();
  ctx.fillStyle = track;
  fillRoundedRect(ctx, rect.x, rect.y, rect.w, rect.h, rect.r);
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1;
  strokeRoundedRect(ctx, rect.x, rect.y, rect.w, rect.h, rect.r);

  if (pct > 0) {
    if (glow) {
      ctx.save();
      ctx.shadowColor = glow;
      ctx.shadowBlur = 12;
      ctx.fillStyle = fill;
      fillRoundedRect(ctx, rect.x, rect.y, rect.w * pct, rect.h, rect.r);
      ctx.restore();
    } else {
      ctx.fillStyle = fill;
      fillRoundedRect(ctx, rect.x, rect.y, rect.w * pct, rect.h, rect.r);
    }
  }

  if (label) {
    ctx.fillStyle = HUD_COLORS.textMuted;
    ctx.font = `600 10px ${HUD_FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(label, rect.x, rect.y - 4);
  }

  if (value) {
    ctx.fillStyle = HUD_COLORS.textWhite;
    ctx.font = `600 10px ${HUD_FONT}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText(value, rect.x + rect.w, rect.y - 4);
  }
  ctx.restore();
}

function GameCanvas({
  visible,
  interactive,
  paused = false,
  cameraMode = 'player',
  showHud = true,
  demoMode = false,
  demoInputLocked = false,
  demoInputMode = '',
  demoCashoutUiUnlocked = false,
  onContainerRectChange,
  myPlayerId,
  config,
  pipes,
  playersRef,
  bulletsRef,
  orbsRef,
  currentBorderMargin,
  sendInput,
  onDeath,
  onCashout,
  sessionLeaderboardRows,
  cameraOverride = null,
}) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const animFrameRef = useRef(null);
  const viewportRef = useRef({
    width: window.innerWidth,
    height: window.innerHeight,
    dpr: window.devicePixelRatio || 1,
  });
  const safeInsetsRef = useRef({ top: 0, right: 0, bottom: 0, left: 0 });
  const fireButtonRef = useRef(null);
  const cashoutButtonRef = useRef(null);
  const resizeNowRef = useRef(null);
  const cloudsRef = useRef([]);
  const lastLocalShotRef = useRef(0);
  const localBulletIdRef = useRef(0);
  const groundScrollRef = useRef(0);
  const debugRef = useRef(false);
  const demoDebugRef = useRef(false);
  const [isTouchUi, setIsTouchUi] = useState(false);
  const [controllerConnected, setControllerConnected] = useState(false);
  const controllerConnectedRef = useRef(false);
  const [fireUiActive, setFireUiActive] = useState(false);
  const [cashoutUiActive, setCashoutUiActive] = useState(false);
  const cashoutUiActiveRef = useRef(false);
  const [hapticsDebugSnapshot, setHapticsDebugSnapshot] = useState(null);
  const [mobileHudLayout, setMobileHudLayout] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
    safeInsets: { top: 0, right: 0, bottom: 0, left: 0 },
  });
  const demoCashoutEnabled = !demoMode || !!demoCashoutUiUnlocked;
  const fireInputBlockedByDemo = !!demoMode && !!demoInputLocked && (demoInputMode === 'fire_intro' || demoInputMode === 'fight_intro');
  const demoFireEnabled = !demoMode || demoInputMode === 'fire_intro' || demoInputMode === 'fight_intro' || demoInputMode === 'fight';
  const showMobileFire = interactive && isTouchUi && demoFireEnabled;
  const fireInputBlockedRef = useRef(false);
  const hapticsDebugEnabledRef = useRef(false);
  const currentBorderMarginRef = useRef(currentBorderMargin);
  const sessionLeaderboardRowsRef = useRef(sessionLeaderboardRows);
  const renderLoopTokenRef = useRef(0);
  const renderLoopCountRef = useRef(0);
  const renderLoopRestartsRef = useRef(0);
  const domWriteCounterRef = useRef(0);

  useEffect(() => {
    fireInputBlockedRef.current = fireInputBlockedByDemo;
    if (!fireInputBlockedByDemo) return;
    inputRef.current.shooting = false;
    inputRef.current.firePointerId = null;
    setFireUiActive(false);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('flappy:mobileFireStop'));
    }
  }, [fireInputBlockedByDemo]);

  useEffect(() => {
    if (showMobileFire) return;
    inputRef.current.shooting = false;
    inputRef.current.firePointerId = null;
    setFireUiActive(false);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('flappy:mobileFireStop'));
    }
  }, [showMobileFire]);

  useEffect(() => {
    if (!demoMode || !demoInputLocked) return;
    inputRef.current.shooting = false;
    inputRef.current.boosting = false;
    inputRef.current.cashingOut = false;
    inputRef.current.cashoutPointer = false;
    setFireUiActive(false);
    setCashoutUiActive(false);
  }, [demoMode, demoInputLocked]);

  useEffect(() => {
    currentBorderMarginRef.current = currentBorderMargin;
  }, [currentBorderMargin]);

  useEffect(() => {
    sessionLeaderboardRowsRef.current = sessionLeaderboardRows;
  }, [sessionLeaderboardRows]);

  useEffect(() => {
    if (demoCashoutEnabled) return;
    inputRef.current.cashingOut = false;
    inputRef.current.cashoutPointer = false;
    setCashoutUiActive(false);
  }, [demoCashoutEnabled]);

  useEffect(() => {
    if (typeof onContainerRectChange !== 'function') return undefined;
    const publishRect = () => {
      const rect = containerRef.current?.getBoundingClientRect?.();
      if (!rect) return;
      onContainerRectChange({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      });
    };

    publishRect();
    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => publishRect())
      : null;
    if (observer && containerRef.current) observer.observe(containerRef.current);
    window.addEventListener('resize', publishRect);
    window.visualViewport?.addEventListener('resize', publishRect);
    window.visualViewport?.addEventListener('scroll', publishRect);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', publishRect);
      window.visualViewport?.removeEventListener('resize', publishRect);
      window.visualViewport?.removeEventListener('scroll', publishRect);
    };
  }, [onContainerRectChange, visible]);
  
  // Interpolated positions (separate from server state)
  const interpolatedRef = useRef(new Map()); // playerId -> { x, y, angle }
  const snapshotBufferRef = useRef(new Map()); // playerId -> [{t,x,y,angle,snapshotTs}]
  const snapshotSigRef = useRef(new Map()); // playerId -> last sig
  const movementDebugRef = useRef(false);
  const movementDebugStateRef = useRef({
    lastLogAt: 0,
    error: 0,
    snapshotTs: 0,
    renderTs: 0,
    interpX: 0,
    interpY: 0,
    serverX: 0,
    serverY: 0,
  });
  
  // Camera state
  const cameraRef = useRef({ x: 0, y: 0 });
  const spectateTargetRef = useRef(null);
  
  // Input state
  const inputRef = useRef({
    mouseX: window.innerWidth / 2,
    mouseY: window.innerHeight / 2,
    moveX: 0,
    moveY: 0,
    shooting: false,
    boosting: false,
    cashingOut: false,
    cashoutPointer: false,
    movePointerId: null,
    firePointerId: null,
    cashoutPointerId: null,
    boostPointerId: null,
    isTouchHeld: false,
    joyActive: false,
    joyCenterX: window.innerWidth * 0.35,
    joyCenterY: window.innerHeight * 0.58,
    joyRadius: 200,
    usingTouch: false,
    lastMoveAngle: -0.2,
    moveAnchorX: null,
    moveAnchorY: null,
    source: 'mouse',
    lastNonControllerAt: 0,
  });
  const controllerRef = useRef(createControllerState());
  const controllerAimAngleRef = useRef(-0.2);
  const controllerHasAimRef = useRef(false);
  const controllerThrottleRef = useRef(CONTROLLER_CRUISE_THROTTLE);
  const controllerDebugRef = useRef({ until: 0, lastLogAt: 0 });
  const controllerConfirmPrevRef = useRef(false);
  const hapticsRef = useRef(null);
  const boostHapticPrevRef = useRef(false);
  const cashoutHapticActiveRef = useRef(false);
  const cashoutHapticSecondRef = useRef(-1);
  const cashoutHapticStartAtRef = useRef(0);
  
  const wasAliveRef = useRef(false);
  const animTimeRef = useRef(0);
  const lastFrameTimeRef = useRef(performance.now());
  const pausedRef = useRef(false);
  const isTouchRef = useRef(false);
  const isIOSRef = useRef(false);
  const effectsKillRef = useRef(0);
  const tmpSpectateCandidatesRef = useRef([]);
  const tmpLeaderboardRef = useRef([]);
  const fpsRef = useRef({ elapsed: 0, frames: 0, value: 0 });
  const perfRef = useRef({ maxMs: 0, avgMs: 0, count: 0, samples: [] });
  const allocRef = useRef({
    lastReset: performance.now(),
    particles: 0,
    bullets: 0,
    trails: 0,
  });
  const opsRef = useRef({ splices: 0, filters: 0 });
  const hudStateRef = useRef({
    cashoutHover: false,
    cashoutPressed: false,
    radarDots: new Map(),
    moneyTags: new Map(),
  });
  
  // Flip state tracking
  const playerFlipRef = useRef(new Map());

  // Local bullets with range tracking
  const localBulletsRef = useRef(new Map());
  const localBulletPoolRef = useRef([]);

  // Boost particles
  const boostParticlesRef = useRef([]);
  const muzzleParticlesRef = useRef([]);
  const muzzlePoolRef = useRef([]);
  const boostPoolRef = useRef([]);
  const boostTrailRef = useRef(new Map());
  const boostTrailPoolRef = useRef([]);
  const featherVfxRef = useRef([]);
  const featherVfxPoolRef = useRef([]);
  const deathVfxDedupRef = useRef(new Map());
  const viewShakeRef = useRef({ until: 0, startedAt: 0, amp: 0, x: 0, y: 0 });
  const mobileDoubleTapRef = useRef({ time: 0, x: 0, y: 0 });
  const activeTouchPointersRef = useRef(new Set());
  const heartbeatRef = useRef({ frame: 0, lastDeltaMs: 0, startedLogged: false });
  const stressBulletsRef = useRef([]);
  const stressBulletPoolRef = useRef([]);
  const localTracersRef = useRef([]);
  const stressRef = useRef({ active: false, until: 0, shooters: 0, rate: 0, acc: 0 });
  const spriteWarnedRef = useRef(new Set());
  const perfModeRef = useRef(false);
  const vfxDebugRef = useRef(false);
  const vfxStatsRef = useRef({ lastLogAt: 0, featherSpawns: 0 });
  const lowFxRef = useRef(false);
  const perfCountersRef = useRef({
    frames: 0,
    fireHandlerMs: 0,
    updateMs: 0,
    renderMs: 0,
    shootMs: 0,
    bulletUpdateMs: 0,
    bulletDrawMs: 0,
    sendInputMs: 0,
    soundMs: 0,
  });
  // --- perf overlay: ring buffer + snapshot ---
  const PERF_RING_SIZE = 120;
  const perfRingRef = useRef(new Float64Array(PERF_RING_SIZE));
  const perfRingIdxRef = useRef(0);
  const rafRingRef = useRef(new Float64Array(PERF_RING_SIZE));
  const rafRingIdxRef = useRef(0);
  const lastRafTsRef = useRef(0);
  const perfOverlayRef = useRef({
    lastUpdate: 0,
    fps: 0,
    avgMs: 0,
    p95Ms: 0,
    drawAvgMs: 0,
    drawP95Ms: 0,
    rafJitterMs: 0,
    longFrames33: 0,
    longFrames50: 0,
    players: 0,
    bullets: 0,
    particles: 0,
    wsRate: 0,
    wsKbps: 0,
    wsAvgBytes: 0,
    wsBufferedKb: 0,
    inputRate: 0,
    inputEmitMs: 0,
    snapRate: 0,
    snapAvgMs: 0,
    snapP95Ms: 0,
    snapJitterMs: 0,
    snapApplyMs: 0,
    interpAvgSamples: 0,
    serverTickMs: 0,
    serverTickP95Ms: 0,
    serverLoopMs: 0,
    serverStateBytes: 0,
    serverStateIntervalAvgMs: 0,
    serverStateIntervalJitterMs: 0,
    serverClients: 0,
    serverLongTickPct: 0,
    serverHeapMb: 0,
    reactRenders: 0,
    worldDrawAvgMs: 0,
    hudDrawAvgMs: 0,
    domWrites: 0,
    loopRestarts: 0,
    playersDrawn: 0,
    bulletsDrawn: 0,
    orbsDrawn: 0,
    allocPerSec: 0,
  });
  const reactRenderCountRef = useRef(0);
  reactRenderCountRef.current += 1; // track every React re-render of GameCanvas
  const fireStatsRef = useRef({ windowStart: performance.now(), shots: 0, sps: 0 });
  const shotDebugCountersRef = useRef({
    shotsRequested: 0,
    shotsPlayed: 0,
    rateLimited: 0,
    poolMisses: 0,
  });
  const inputStateDebugRef = useRef({ sig: '' });

  if (!hapticsRef.current) {
    const debugHaptics =
      import.meta.env.DEV &&
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('haptics') === '1';
    hapticsRef.current = createHapticsManager({ debug: debugHaptics });
  }

  // Death explosions (Minecraft-ish white puffs)
  const deathExplosionsRef = useRef([]); // {x,y,createdAt}

  // Audio pools (so rapid fire doesn't cut off)
  const audioRef = useRef({
    shotPool: null,
    hitPool: null,
    pickupPool: null,
    deathPool: null,
    shotCtx: null,
    shotBuffer: null,
    shotLoopSource: null,
    shotLoopGain: null,
    shotLoadPromise: null,
    shotLooping: false,
    shotLoopWindow: { start: 0.06, end: 0.22 },
    shotStartWindow: { start: 0.0, duration: 0.07 },
    shotEndWindow: { start: 0.22, duration: 0.09 },
    botShotLoops: new Map(),
    lastBotAudioSyncAt: 0,
    shotGain: null,
    inited: false,
    rateWindowStart: 0,
    rateCount: 0,
    shotPerShooterAt: new Map(),
    lastMenu: 0,
    lastPickupAt: 0,
  });
  const lastShotRef = useRef(new Map());
  
  // Sprites
  const spritesRef = useRef({
    birds: {},
    feathers: {},
    loaded: false,
  });

  // Load sprites
  useEffect(() => {
    const sprites = spritesRef.current;
    let loadedCount = 0;
    const totalCount = BIRD_TYPES.length * 6 + BIRD_TYPES.length;
    
    const checkLoaded = () => {
      loadedCount++;
      if (loadedCount >= totalCount) {
        sprites.loaded = true;
        if (import.meta.env.DEV) {
          console.info('[game] sprites loaded', { loadedCount, totalCount });
        }
      }
    };
    
    BIRD_TYPES.forEach(birdType => {
      sprites.birds[birdType] = { fly: [], fire: [] };
      
      for (let i = 1; i <= 3; i++) {
        const flyImg = new Image();
        flyImg.onload = checkLoaded;
        flyImg.onerror = checkLoaded;
        flyImg.src = `/assets/sprites/birds/${birdType}/fly_${i}.png`;
        sprites.birds[birdType].fly.push(flyImg);
        
        const fireImg = new Image();
        fireImg.onload = checkLoaded;
        fireImg.onerror = checkLoaded;
        fireImg.src = `/assets/sprites/birds/${birdType}/fire_${i}.png`;
        sprites.birds[birdType].fire.push(fireImg);
      }
    });
    
    BIRD_TYPES.forEach(birdType => {
      const img = new Image();
      img.onload = checkLoaded;
      img.onerror = checkLoaded;
      img.src = `/assets/sprites/feathers/${birdType}.png`;
      sprites.feathers[birdType] = img;
    });
  }, []);

  useEffect(() => {
    initEnvironment().catch(() => {});
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    debugRef.current = false;
    demoDebugRef.current = params.get('demoDebug') === '1';
    movementDebugRef.current = params.get('moveDebug') === '1';
    perfModeRef.current = params.get('perf') === '1';
    vfxDebugRef.current = params.get('vfx') === '1';
    lowFxRef.current = params.get('lowfx') === '1';
    hapticsDebugEnabledRef.current = import.meta.env.DEV && params.get('haptics') === '1';
    const stress = params.get('stress') === '1';
    if (stress) {
      const shooters = Number(params.get('stressShooters') || 8);
      const rate = Number(params.get('stressRate') || 10);
      stressRef.current.active = true;
      stressRef.current.until = performance.now() + 10000;
      stressRef.current.shooters = Math.max(1, shooters);
      stressRef.current.rate = Math.max(1, rate);
      stressRef.current.acc = 0;
    }
    const ua = navigator?.userAgent || '';
    const isIOS =
      /iP(ad|hone|od)/.test(ua) ||
      (navigator?.platform === 'MacIntel' && navigator?.maxTouchPoints > 1);
    isIOSRef.current = isIOS;
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    let cancelled = false;
    let timer = null;

    const poll = async () => {
      if (cancelled) return;
      if (perfModeRef.current) {
        try {
          const res = await fetch('/api/perf/server');
          if (res.ok) {
            window.__FLAPPY_SERVER_PERF__ = await res.json();
          }
        } catch {
          // Ignore perf polling failures.
        }
      }
      if (!cancelled) {
        timer = setTimeout(poll, 1000);
      }
    };

    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!interactive) return;
    setEnvironmentViewport({
      width: DESIGN_WIDTH,
      height: DESIGN_HEIGHT,
      viewLeft: 0,
      viewTop: 0,
    });
    setEnvironmentScrollEnabled({ ground: true, bkg1: true });
    groundScrollRef.current = 0;
    cloudsRef.current = [];
  }, [interactive]);

  useEffect(() => {
    if (!import.meta.env.DEV || !hapticsDebugEnabledRef.current) return undefined;
    const tick = () => {
      const snap = hapticsRef.current?.getDebugSnapshot?.();
      if (snap) setHapticsDebugSnapshot(snap);
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [visible]);

  // Canvas resize
  useEffect(() => {
    const handleResize = () => {
      const rawDpr = window.devicePixelRatio || 1;
      const coarse = typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia('(pointer: coarse)').matches
        : false;
      const dpr = coarse ? Math.min(rawDpr, MOBILE_DPR_CAP) : Math.min(rawDpr, DESKTOP_DPR_CAP);
      const viewport = window.visualViewport;
      const rect = containerRef.current?.getBoundingClientRect?.();
      const width = coarse
        ? Math.max(1, Math.floor(viewport?.width || window.innerWidth || 1))
        : Math.max(1, Math.floor(rect?.width || window.innerWidth || 1));
      const height = coarse
        ? Math.max(1, Math.floor(viewport?.height || window.innerHeight || 1))
        : Math.max(1, Math.floor(rect?.height || window.innerHeight || 1));
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        if (import.meta.env.DEV) {
          console.warn('[game] resize skipped invalid size', { width, height });
        }
        return;
      }
      viewportRef.current = {
        width,
        height,
        dpr,
      };
      if (typeof window !== 'undefined') {
        const styles = getComputedStyle(document.documentElement);
        const fallbackInsets = viewport
          ? {
              top: Math.max(0, viewport.offsetTop || 0),
              left: Math.max(0, viewport.offsetLeft || 0),
              right: Math.max(0, (window.innerWidth || width) - viewport.width - (viewport.offsetLeft || 0)),
              bottom: Math.max(0, (window.innerHeight || height) - viewport.height - (viewport.offsetTop || 0)),
            }
          : { top: 0, right: 0, bottom: 0, left: 0 };
        safeInsetsRef.current = {
          top: Math.max(parseFloat(styles.getPropertyValue('--safe-top')) || 0, fallbackInsets.top),
          right: Math.max(parseFloat(styles.getPropertyValue('--safe-right')) || 0, fallbackInsets.right),
          bottom: Math.max(parseFloat(styles.getPropertyValue('--safe-bottom')) || 0, fallbackInsets.bottom),
          left: Math.max(parseFloat(styles.getPropertyValue('--safe-left')) || 0, fallbackInsets.left),
        };
      }
      setMobileHudLayout({
        width,
        height,
        safeInsets: safeInsetsRef.current,
      });
      if (canvasRef.current) {
        canvasRef.current.width = Math.floor(width * dpr);
        canvasRef.current.height = Math.floor(height * dpr);
        canvasRef.current.style.width = `${width}px`;
        canvasRef.current.style.height = `${height}px`;
        domWriteCounterRef.current += 4;
      }
      if (containerRef.current && coarse && viewport) {
        const viewportLeft = Math.max(0, Math.floor(viewport.offsetLeft || 0));
        const viewportTop = Math.max(0, Math.floor(viewport.offsetTop || 0));
        containerRef.current.style.width = `${width}px`;
        containerRef.current.style.height = `${height}px`;
        containerRef.current.style.left = `${viewportLeft}px`;
        containerRef.current.style.top = `${viewportTop}px`;
        containerRef.current.style.right = 'auto';
        containerRef.current.style.bottom = 'auto';
        containerRef.current.style.margin = '0';
        containerRef.current.style.transform = 'none';
        domWriteCounterRef.current += 8;
      } else if (containerRef.current) {
        containerRef.current.style.width = '';
        containerRef.current.style.height = '';
        containerRef.current.style.left = '0px';
        containerRef.current.style.top = '0px';
        containerRef.current.style.right = '0px';
        containerRef.current.style.bottom = '0px';
        containerRef.current.style.margin = '0';
        containerRef.current.style.transform = 'none';
        domWriteCounterRef.current += 8;
      }
      if (import.meta.env.DEV) {
        const containerRect = containerRef.current?.getBoundingClientRect?.();
        const canvasCssRect = canvasRef.current?.getBoundingClientRect?.();
        const containerStyle = containerRef.current ? window.getComputedStyle(containerRef.current) : null;
        console.info('[game] canvas resize', {
          viewport: viewport
            ? {
                width: Math.round(viewport.width || 0),
                height: Math.round(viewport.height || 0),
                offsetLeft: Math.round(viewport.offsetLeft || 0),
                offsetTop: Math.round(viewport.offsetTop || 0),
              }
            : {
                width: Math.round(window.innerWidth || 0),
                height: Math.round(window.innerHeight || 0),
                offsetLeft: 0,
                offsetTop: 0,
              },
          viewportRef: { width, height },
          dpr,
          canvasCss: canvasCssRect
            ? { width: Math.round(canvasCssRect.width), height: Math.round(canvasCssRect.height) }
            : null,
          backingW: canvasRef.current?.width,
          backingH: canvasRef.current?.height,
          safeInsets: safeInsetsRef.current,
          containerRect: containerRect
            ? {
                left: Math.round(containerRect.left),
                top: Math.round(containerRect.top),
                width: Math.round(containerRect.width),
                height: Math.round(containerRect.height),
              }
            : null,
          containerTransform: containerStyle?.transform || 'none',
        });
      }
    };
    resizeNowRef.current = handleResize;

    let resizeRaf = null;
    let resizeTimer = null;
    const scheduleResize = () => {
      if (resizeTimer != null) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        resizeTimer = null;
        if (resizeRaf != null) return;
        resizeRaf = requestAnimationFrame(() => {
          resizeRaf = null;
          handleResize();
        });
      }, 120);
    };

    handleResize();
    window.addEventListener('resize', scheduleResize);
    window.addEventListener('orientationchange', scheduleResize);
    window.visualViewport?.addEventListener('resize', scheduleResize);
    window.visualViewport?.addEventListener('scroll', scheduleResize);
    return () => {
      window.removeEventListener('resize', scheduleResize);
      window.removeEventListener('orientationchange', scheduleResize);
      window.visualViewport?.removeEventListener('resize', scheduleResize);
      window.visualViewport?.removeEventListener('scroll', scheduleResize);
      if (resizeRaf != null) cancelAnimationFrame(resizeRaf);
      if (resizeTimer != null) clearTimeout(resizeTimer);
      resizeNowRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!visible) return;
    const raf = requestAnimationFrame(() => {
      resizeNowRef.current?.();
    });
    return () => cancelAnimationFrame(raf);
  }, [visible, interactive, demoMode]);

  useEffect(() => {
    if (!import.meta.env.DEV || !isTouchUi) return;
    const { width, height, safeInsets } = mobileHudLayout;
    const isLandscapeNow = width > height;
    if (!isLandscapeNow) return;

    const margin = MOBILE_LANDSCAPE_CONTROLS_MARGIN;
    const gap = MOBILE_LANDSCAPE_CONTROLS_GAP;
    const buttonW = MOBILE_LANDSCAPE_BUTTON_SIZE;
    const buttonH = MOBILE_LANDSCAPE_BUTTON_SIZE;
    const cashoutW = MOBILE_LANDSCAPE_CASHOUT_WIDTH;
    const cashoutH = MOBILE_LANDSCAPE_CASHOUT_HEIGHT;
    const controlsBottomY = height - (safeInsets.bottom || 0) - margin - MOBILE_LANDSCAPE_CONTROLS_RAISE_PX - buttonH;

    const boostRect = {
      x: (safeInsets.left || 0) + margin,
      y: controlsBottomY,
      w: buttonW,
      h: buttonH,
    };
    const fireRect = {
      x: width - (safeInsets.right || 0) - margin - buttonW,
      y: controlsBottomY,
      w: buttonW,
      h: buttonH,
    };
    const cashoutRect = {
      x: fireRect.x - gap - cashoutW,
      y: controlsBottomY + (buttonH - cashoutH),
      w: cashoutW,
      h: cashoutH,
    };
    console.info('[hud] mobile-controls-layout', {
      vw: width,
      vh: height,
      safeBottom: safeInsets.bottom || 0,
      controlsBottomY: Math.round(controlsBottomY),
      boostRect: {
        x: Math.round(boostRect.x),
        y: Math.round(boostRect.y),
        w: boostRect.w,
        h: boostRect.h,
      },
      fireRect: {
        x: Math.round(fireRect.x),
        y: Math.round(fireRect.y),
        w: fireRect.w,
        h: fireRect.h,
      },
      cashoutRect: {
        x: Math.round(cashoutRect.x),
        y: Math.round(cashoutRect.y),
        w: cashoutRect.w,
        h: cashoutRect.h,
      },
    });
  }, [isTouchUi, mobileHudLayout]);

  useEffect(() => {
    const updateTouchMode = () => {
      const coarse = typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia('(pointer: coarse)').matches
        : false;
      const touchCapable = (navigator?.maxTouchPoints || 0) > 0 || coarse;
      isTouchRef.current = touchCapable;
      setIsTouchUi(touchCapable);
    };
    updateTouchMode();
    window.addEventListener('resize', updateTouchMode);
    return () => window.removeEventListener('resize', updateTouchMode);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onGamepadConnected = () => {
      const now = performance.now();
      pollControllerInput(controllerRef.current, now, CONTROLLER_BINDINGS);
      const next = !!controllerRef.current.connected;
      controllerConnectedRef.current = next;
      setControllerConnected(next);
    };
    const onGamepadDisconnected = () => {
      const now = performance.now();
      pollControllerInput(controllerRef.current, now, CONTROLLER_BINDINGS);
      const next = !!controllerRef.current.connected;
      controllerConnectedRef.current = next;
      setControllerConnected(next);
    };
    window.addEventListener('gamepadconnected', onGamepadConnected);
    window.addEventListener('gamepaddisconnected', onGamepadDisconnected);
    onGamepadConnected();
    return () => {
      window.removeEventListener('gamepadconnected', onGamepadConnected);
      window.removeEventListener('gamepaddisconnected', onGamepadDisconnected);
    };
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (visible && interactive) {
      console.info('[game] ENTER_GAMEPLAY');
    }
  }, [visible, interactive]);

  useEffect(() => {
    pausedRef.current = !!paused;
  }, [paused]);

  // Input handlers
  useEffect(() => {
    if (!interactive) return;

    const resetInputLatch = (reason = 'external') => {
      inputRef.current.shooting = false;
      inputRef.current.boosting = false;
      inputRef.current.cashingOut = false;
      inputRef.current.cashoutPointer = false;
      inputRef.current.movePointerId = null;
      inputRef.current.firePointerId = null;
      inputRef.current.cashoutPointerId = null;
      inputRef.current.boostPointerId = null;
      inputRef.current.isTouchHeld = false;
      inputRef.current.joyActive = false;
      inputRef.current.moveAnchorX = null;
      inputRef.current.moveAnchorY = null;
      inputRef.current.lastMoveAngle = Number.isFinite(inputRef.current.lastMoveAngle)
        ? inputRef.current.lastMoveAngle
        : -0.2;
      inputRef.current.source = 'mouse';
      activeTouchPointersRef.current.clear();
      setFireUiActive(false);
      setCashoutUiActive(false);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('flappy:mobileFireStop'));
        window.dispatchEvent(new CustomEvent('flappy:demoCashoutHold', { detail: { active: false } }));
      }
      if (demoDebugRef.current) {
        console.info('[INPUT] resetInputLatch', {
          reason,
          held: inputRef.current.isTouchHeld ? 1 : 0,
          pointerId: inputRef.current.movePointerId,
          paused: pausedRef.current ? 1 : 0,
        });
      }
    };

    // Safety: when (re)entering the game view, clear sticky inputs
    resetInputLatch('enter_gameplay');

    // When returning to game, ensure we aren't "stuck" cashing out due to missed keyup.
    inputRef.current.cashingOut = false;
    inputRef.current.cashoutPointer = false;
    inputRef.current.boostPointerId = null;
    hudStateRef.current.cashoutPressed = false;
    inputRef.current.isTouchHeld = false;
    activeTouchPointersRef.current.clear();
    
    const handleMouseMove = (e) => {
      inputRef.current.mouseX = e.clientX;
      inputRef.current.mouseY = e.clientY;
      inputRef.current.source = 'mouse';
      inputRef.current.lastNonControllerAt = performance.now();
    };
    
    const handleMouseDown = (e) => {
      if (e.button !== 0) return;
      if (typeof window !== 'undefined' && !audioRef.current.unlocked) {
        window.dispatchEvent(new CustomEvent('flappy:audioUnlock'));
      }
      if (hudStateRef.current.cashoutHover) {
        inputRef.current.cashoutPointer = true;
        inputRef.current.cashingOut = true;
        inputRef.current.shooting = false;
        hudStateRef.current.cashoutPressed = true;
        return;
      }
      inputRef.current.shooting = true;
      inputRef.current.source = 'mouse';
      inputRef.current.lastNonControllerAt = performance.now();
      if (demoDebugRef.current) {
        console.info('[NET] client fire pressed -> sendInput fire=1', { source: 'mouse' });
      }
    };
    
    const handleMouseUp = (e) => {
      if (e.button !== 0) return;
      inputRef.current.shooting = false;
      inputRef.current.cashoutPointer = false;
      inputRef.current.cashingOut = false;
      hudStateRef.current.cashoutPressed = false;
    };
    
    const handleKeyDown = (e) => {
      const fireLockedByDemo = !!demoMode && !!demoInputLocked && (demoInputMode === 'fire_intro' || demoInputMode === 'fight_intro');
      if (typeof window !== 'undefined' && !audioRef.current.unlocked) {
        if (e.code === 'Space' || e.code === 'KeyF' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
          window.dispatchEvent(new CustomEvent('flappy:audioUnlock'));
        }
      }
      if (e.code === 'Space') {
        if (fireLockedByDemo) {
          e.preventDefault();
          return;
        }
        inputRef.current.shooting = true;
        inputRef.current.source = 'keyboard';
        inputRef.current.lastNonControllerAt = performance.now();
        if (demoDebugRef.current) {
          console.info('[NET] client fire pressed -> sendInput fire=1', { source: 'keyboard' });
        }
        e.preventDefault();
      }
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        inputRef.current.boosting = true;
        inputRef.current.source = 'keyboard';
        inputRef.current.lastNonControllerAt = performance.now();
      }
      if (e.code === 'KeyF') {
        inputRef.current.cashingOut = true;
        inputRef.current.source = 'keyboard';
        inputRef.current.lastNonControllerAt = performance.now();
      }
    };
    
    const handleKeyUp = (e) => {
      if (e.code === 'Space') inputRef.current.shooting = false;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') inputRef.current.boosting = false;
      if (e.code === 'KeyF') inputRef.current.cashingOut = false;
    };
    
    const handleContextMenu = (e) => e.preventDefault();

    const updateJoystickFromClient = (clientX, clientY) => {
      const { width, height } = viewportRef.current;
      inputRef.current.joyCenterX = width * 0.5;
      inputRef.current.joyCenterY = height * 0.5;
      inputRef.current.joyRadius = Math.min(width, height) * 0.5;
      inputRef.current.joyActive = true;
      inputRef.current.usingTouch = true;
      inputRef.current.source = 'touch';
      inputRef.current.lastNonControllerAt = performance.now();
      // Absolute touch targeting: movement aims exactly where the player touches.
      inputRef.current.mouseX = clientX;
      inputRef.current.mouseY = clientY;
    };

    const markTouchDown = (pointerId) => {
      if (pointerId === undefined || pointerId === null) return;
      activeTouchPointersRef.current.add(pointerId);
      inputRef.current.isTouchHeld = activeTouchPointersRef.current.size > 0;
    };

    const markTouchUp = (pointerId) => {
      if (pointerId === undefined || pointerId === null) return;
      activeTouchPointersRef.current.delete(pointerId);
      inputRef.current.isTouchHeld = activeTouchPointersRef.current.size > 0;
    };

    const emitDemoTouch = (type, e) => {
      if (typeof window === 'undefined' || !window.__FLAPPY_DEMO_ACTIVE__) return;
      const vw = Math.max(1, viewportRef.current.width || window.innerWidth || 1);
      const vh = Math.max(1, viewportRef.current.height || window.innerHeight || 1);
      window.dispatchEvent(new CustomEvent('flappy:demoTouch', {
        detail: {
          type,
          x: e.clientX,
          y: e.clientY,
          xNorm: e.clientX / vw,
          yNorm: e.clientY / vh,
          pointerId: e.pointerId,
        },
      }));
    };

    const isOnMobileUiButton = (clientX, clientY) => {
      const fireRect = fireButtonRef.current?.getBoundingClientRect?.();
      if (fireRect &&
          clientX >= fireRect.left &&
          clientX <= fireRect.right &&
          clientY >= fireRect.top &&
          clientY <= fireRect.bottom) {
        return true;
      }
      const cashoutRect = cashoutButtonRef.current?.getBoundingClientRect?.();
      if (cashoutRect &&
          clientX >= cashoutRect.left &&
          clientX <= cashoutRect.right &&
          clientY >= cashoutRect.top &&
          clientY <= cashoutRect.bottom) {
        return true;
      }
      return false;
    };

    const setBoostPointer = (pointerId) => {
      inputRef.current.boostPointerId = pointerId;
      inputRef.current.boosting = true;
    };

    const clearBoostPointer = (pointerId) => {
      if (inputRef.current.boostPointerId !== pointerId) return;
      inputRef.current.boostPointerId = null;
      inputRef.current.boosting = false;
    };

    const handlePointerDown = (e) => {
      if (!isTouchRef.current) return;
      if (e.pointerType === 'mouse') return;
      if (isOnMobileUiButton(e.clientX, e.clientY)) return;
      if (typeof window !== 'undefined' && !audioRef.current.unlocked) {
        window.dispatchEvent(new CustomEvent('flappy:audioUnlock'));
      }
      emitDemoTouch('down', e);
      markTouchDown(e.pointerId);
      const container = containerRef.current;
      if (!container) return;

      if (inputRef.current.cashoutPointer) return;

      const now = performance.now();
      const lastTap = mobileDoubleTapRef.current;
      const dt = now - lastTap.time;
      const dist = Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y);
      const promptLocked = !!demoMode && !!demoInputLocked;
      const allowBoostTapDuringPrompt = promptLocked && demoInputMode === 'move_boost';
      if (!promptLocked || allowBoostTapDuringPrompt) {
        if (dt <= MOBILE_DOUBLE_TAP_BOOST_MS && dist <= MOBILE_DOUBLE_TAP_BOOST_MAX_DIST_PX) {
          setBoostPointer(e.pointerId);
          mobileDoubleTapRef.current.time = 0;
        } else {
          mobileDoubleTapRef.current.time = now;
          mobileDoubleTapRef.current.x = e.clientX;
          mobileDoubleTapRef.current.y = e.clientY;
        }
      }

      inputRef.current.movePointerId = e.pointerId;
      inputRef.current.moveAnchorX = e.clientX;
      inputRef.current.moveAnchorY = e.clientY;
      inputRef.current.joyActive = true;
      inputRef.current.source = 'touch';
      inputRef.current.lastNonControllerAt = performance.now();
      updateJoystickFromClient(e.clientX, e.clientY);
      const viewDx = e.clientX - (viewportRef.current.width * 0.5);
      const viewDy = e.clientY - (viewportRef.current.height * 0.5);
      if (Math.hypot(viewDx, viewDy) > 3) {
        inputRef.current.lastMoveAngle = Math.atan2(viewDy, viewDx);
      }
      try {
        container.setPointerCapture(e.pointerId);
      } catch {}
      e.preventDefault();
    };

    const handlePointerMove = (e) => {
      if (!isTouchRef.current) return;
      if (e.pointerType === 'mouse') return;
      emitDemoTouch('move', e);
      if (inputRef.current.movePointerId === null) {
        inputRef.current.movePointerId = e.pointerId;
      }
      if (inputRef.current.movePointerId !== e.pointerId) return;
      updateJoystickFromClient(e.clientX, e.clientY);
      const viewDx = e.clientX - (viewportRef.current.width * 0.5);
      const viewDy = e.clientY - (viewportRef.current.height * 0.5);
      if (Math.hypot(viewDx, viewDy) > 3) {
        inputRef.current.lastMoveAngle = Math.atan2(viewDy, viewDx);
      }
      e.preventDefault();
    };

    const clearMovePointer = (pointerId) => {
      if (inputRef.current.movePointerId !== pointerId) return;
      inputRef.current.movePointerId = null;
      inputRef.current.moveAnchorX = null;
      inputRef.current.moveAnchorY = null;
      inputRef.current.joyActive = false;
    };

    const handlePointerUp = (e) => {
      if (e.pointerType === 'mouse') return;
      emitDemoTouch('up', e);
      markTouchUp(e.pointerId);
      clearBoostPointer(e.pointerId);
      clearMovePointer(e.pointerId);
      e.preventDefault();
    };

    const handlePointerCancel = (e) => {
      if (e.pointerType === 'mouse') return;
      emitDemoTouch('cancel', e);
      markTouchUp(e.pointerId);
      clearBoostPointer(e.pointerId);
      clearMovePointer(e.pointerId);
      e.preventDefault();
    };

    const handlePointerLeave = (e) => {
      if (e.pointerType === 'mouse') return;
      emitDemoTouch('leave', e);
      markTouchUp(e.pointerId);
      clearBoostPointer(e.pointerId);
      clearMovePointer(e.pointerId);
    };

    const handleTouchStart = (e) => {
      if (!isTouchRef.current) return;
      inputRef.current.isTouchHeld = true;
      e.preventDefault();
    };

    const handleTouchEnd = (e) => {
      if (!isTouchRef.current) return;
      if (!e.touches || e.touches.length === 0) {
        inputRef.current.isTouchHeld = false;
        activeTouchPointersRef.current.clear();
        inputRef.current.movePointerId = null;
        inputRef.current.moveAnchorX = null;
        inputRef.current.moveAnchorY = null;
        inputRef.current.joyActive = false;
        inputRef.current.boostPointerId = null;
        inputRef.current.boosting = false;
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('flappy:mobileFireStop'));
        }
      }
      e.preventDefault();
    };

    const handleFirePointerDown = (e) => {
      const fireLockedByDemo = !!demoMode && !!demoInputLocked && (demoInputMode === 'fire_intro' || demoInputMode === 'fight_intro');
      if (fireLockedByDemo) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.pointerType === 'mouse') return;
      if (inputRef.current.firePointerId !== null) return;
      markTouchDown(e.pointerId);
      inputRef.current.firePointerId = e.pointerId;
      inputRef.current.shooting = true;
      inputRef.current.source = 'touch';
      inputRef.current.lastNonControllerAt = performance.now();
      if (demoDebugRef.current) {
        console.info('[NET] client fire pressed -> sendInput fire=1', { source: 'touch', pointerId: e.pointerId });
      }
      inputRef.current.usingTouch = true;
      setFireUiActive(true);
      if (typeof window !== 'undefined') {
        if (!audioRef.current.unlocked) {
          window.dispatchEvent(new CustomEvent('flappy:audioUnlock'));
        }
        window.dispatchEvent(new CustomEvent('flappy:mobileFireStart'));
      }
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {}
      e.preventDefault();
      e.stopPropagation();
    };

    const handleFirePointerUp = (e) => {
      if (inputRef.current.firePointerId !== e.pointerId) return;
      markTouchUp(e.pointerId);
      inputRef.current.firePointerId = null;
      inputRef.current.shooting = false;
      setFireUiActive(false);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('flappy:mobileFireStop'));
      }
      e.preventDefault();
      e.stopPropagation();
    };

    const handleCashoutPointerDown = (e) => {
      if (!!demoMode && !demoCashoutEnabled) return;
      if (inputRef.current.cashoutPointerId !== null) return;
      if (inputRef.current.cashingOut || inputRef.current.cashoutPointer) return;
      const myPlayer = playersRef.current.get(myPlayerId);
      if (myPlayer?.cashingOut) return;

      markTouchDown(e.pointerId);
      inputRef.current.cashoutPointerId = e.pointerId;
      inputRef.current.cashoutPointer = true;
      inputRef.current.cashingOut = true;
      inputRef.current.shooting = false;
      inputRef.current.firePointerId = null;
      inputRef.current.movePointerId = null;
      inputRef.current.moveAnchorX = null;
      inputRef.current.moveAnchorY = null;
      inputRef.current.joyActive = false;
      inputRef.current.usingTouch = false;
      inputRef.current.source = 'touch';
      inputRef.current.lastNonControllerAt = performance.now();
      setFireUiActive(false);
      setCashoutUiActive(true);
      if (typeof window !== 'undefined') {
        if (!audioRef.current.unlocked) {
          window.dispatchEvent(new CustomEvent('flappy:audioUnlock'));
        }
        window.dispatchEvent(new CustomEvent('flappy:demoCashoutHold', { detail: { active: true } }));
      }

      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {}
      e.preventDefault();
      e.stopPropagation();
    };

    const handleCashoutPointerUp = (e) => {
      if (inputRef.current.cashoutPointerId !== e.pointerId) return;
      markTouchUp(e.pointerId);
      inputRef.current.cashoutPointerId = null;
      inputRef.current.cashoutPointer = false;
      inputRef.current.cashingOut = false;
      inputRef.current.usingTouch = false;
      setCashoutUiActive(false);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('flappy:demoCashoutHold', { detail: { active: false } }));
      }
      e.preventDefault();
      e.stopPropagation();
    };

    const onResetInputLatch = (event) => {
      const reason = event?.detail?.reason || 'external_event';
      resetInputLatch(reason);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('flappy:resetInputLatch', onResetInputLatch);
    if (containerRef.current) {
      containerRef.current.addEventListener('pointerdown', handlePointerDown);
      containerRef.current.addEventListener('pointermove', handlePointerMove);
      containerRef.current.addEventListener('pointerup', handlePointerUp);
      containerRef.current.addEventListener('pointercancel', handlePointerCancel);
      containerRef.current.addEventListener('pointerleave', handlePointerLeave);
      containerRef.current.addEventListener('touchstart', handleTouchStart, { passive: false });
      containerRef.current.addEventListener('touchend', handleTouchEnd, { passive: false });
      containerRef.current.addEventListener('touchcancel', handleTouchEnd, { passive: false });
    }
    if (fireButtonRef.current) {
      fireButtonRef.current.addEventListener('pointerdown', handleFirePointerDown);
      fireButtonRef.current.addEventListener('pointerup', handleFirePointerUp);
      fireButtonRef.current.addEventListener('pointercancel', handleFirePointerUp);
      fireButtonRef.current.addEventListener('pointerleave', handleFirePointerUp);
    }
    if (cashoutButtonRef.current) {
      cashoutButtonRef.current.addEventListener('pointerdown', handleCashoutPointerDown);
      cashoutButtonRef.current.addEventListener('pointerup', handleCashoutPointerUp);
      cashoutButtonRef.current.addEventListener('pointercancel', handleCashoutPointerUp);
      cashoutButtonRef.current.addEventListener('pointerleave', handleCashoutPointerUp);
    }
    
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('flappy:resetInputLatch', onResetInputLatch);
      if (containerRef.current) {
        containerRef.current.removeEventListener('pointerdown', handlePointerDown);
        containerRef.current.removeEventListener('pointermove', handlePointerMove);
        containerRef.current.removeEventListener('pointerup', handlePointerUp);
        containerRef.current.removeEventListener('pointercancel', handlePointerCancel);
        containerRef.current.removeEventListener('pointerleave', handlePointerLeave);
        containerRef.current.removeEventListener('touchstart', handleTouchStart);
        containerRef.current.removeEventListener('touchend', handleTouchEnd);
        containerRef.current.removeEventListener('touchcancel', handleTouchEnd);
      }
      if (fireButtonRef.current) {
        fireButtonRef.current.removeEventListener('pointerdown', handleFirePointerDown);
        fireButtonRef.current.removeEventListener('pointerup', handleFirePointerUp);
        fireButtonRef.current.removeEventListener('pointercancel', handleFirePointerUp);
        fireButtonRef.current.removeEventListener('pointerleave', handleFirePointerUp);
      }
      if (cashoutButtonRef.current) {
        cashoutButtonRef.current.removeEventListener('pointerdown', handleCashoutPointerDown);
        cashoutButtonRef.current.removeEventListener('pointerup', handleCashoutPointerUp);
        cashoutButtonRef.current.removeEventListener('pointercancel', handleCashoutPointerUp);
        cashoutButtonRef.current.removeEventListener('pointerleave', handleCashoutPointerUp);
      }
    };
  }, [visible, myPlayerId, playersRef, demoMode, demoInputLocked, demoInputMode, demoCashoutEnabled]);

  // Cashout UI check moved into game loop (was useEffect on playersVersion at 60Hz)

  const spawnMuzzleBurst = (x, y) => {
    const effectsEnabled = isTouchRef.current ? EFFECTS_ENABLED_MOBILE : EFFECTS_ENABLED_DESKTOP;
    if (!effectsEnabled) return;
    if (effectsKillRef.current > performance.now()) return;
    if (isTouchRef.current && heartbeatRef.current.lastDeltaMs > 28 && muzzleParticlesRef.current.length > Math.floor(MUZZLE_MAX_MOBILE * 0.75)) {
      return;
    }
    const particles = muzzleParticlesRef.current;
    const maxParticles = isTouchRef.current ? MUZZLE_MAX_MOBILE : MUZZLE_MAX_DESKTOP;
    if (particles.length >= maxParticles) return;
    const pool = muzzlePoolRef.current;
    const count = isTouchRef.current
      ? MUZZLE_SHOT_COUNT_MOBILE
      : Math.floor(MUZZLE_SHOT_COUNT_DESKTOP_MIN + Math.random() * MUZZLE_SHOT_COUNT_DESKTOP_VAR);
    for (let i = 0; i < count; i += 1) {
      if (particles.length >= maxParticles) break;
      const fromPool = pool.pop();
      const p = fromPool || {};
      p.x = x;
      p.y = y;
      const angle = Math.random() * 1.2 - 0.6;
      const speed = isTouchRef.current ? 380 + Math.random() * 200 : 520 + Math.random() * 320;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed - 40;
      p.size = isTouchRef.current ? 5 + Math.random() * 2 : 9 + Math.random() * 4;
      p.life = 0;
      p.maxLife = isTouchRef.current ? 0.14 + Math.random() * 0.08 : 0.22 + Math.random() * 0.12;
      p.color = MUZZLE_COLORS[Math.floor(Math.random() * MUZZLE_COLORS.length)];
      particles.push(p);
      if (!fromPool) {
        allocRef.current.particles += 1;
      }
    }
  };

  const spawnPlayerMuzzle = (ownerId, fallbackX = null, fallbackY = null) => {
    const interp = interpolatedRef.current.get(ownerId);
    if (!interp && (typeof fallbackX !== 'number' || typeof fallbackY !== 'number')) return;
    const size = PLAYER_SIZE * BIRD_SCALE;
    const angle = interp ? interp.angle : 0;
    const dir = Math.cos(angle) < 0 ? -1 : 1;
    const baseX = interp ? interp.x : fallbackX;
    const baseY = interp ? interp.y : fallbackY;
    const muzzleX = baseX + size * 0.5 + (dir === 1 ? 50 : -100);
    const muzzleY = baseY + size * 0.5 + 50 + MUZZLE_SPAWN_Y_OFFSET;
    spawnMuzzleBurst(muzzleX, muzzleY);
  };

  const spawnFeatherBurst = (x, y, birdType = 'yellow') => {
    const effectsEnabled = isTouchRef.current ? EFFECTS_ENABLED_MOBILE : EFFECTS_ENABLED_DESKTOP;
    if (!effectsEnabled) return;
    if (effectsKillRef.current > performance.now()) return;
    const feathers = featherVfxRef.current;
    const maxFeathers = isTouchRef.current ? FEATHER_VFX_CAP_MOBILE : FEATHER_VFX_CAP_DESKTOP;
    if (feathers.length >= maxFeathers) return;
    const spawnCount = isTouchRef.current ? FEATHER_VFX_PER_DEATH_MOBILE : FEATHER_VFX_PER_DEATH_DESKTOP;
    for (let i = 0; i < spawnCount; i += 1) {
      if (feathers.length >= maxFeathers) break;
      const fromPool = featherVfxPoolRef.current.pop();
      const p = fromPool || {};
      const ang = Math.random() * Math.PI * 2;
      const speed = (isTouchRef.current ? 110 : 170) + Math.random() * (isTouchRef.current ? 90 : 150);
      p.x = x;
      p.y = y;
      p.vx = Math.cos(ang) * speed;
      p.vy = Math.sin(ang) * speed - 30;
      p.life = 0;
      p.maxLife = (isTouchRef.current ? 0.52 : 0.72) + Math.random() * 0.2;
      p.size = (isTouchRef.current ? 7 : 9) + Math.random() * 4;
      p.rot = Math.random() * Math.PI * 2;
      p.rotVel = (Math.random() - 0.5) * 8;
      p.birdType = birdType || 'yellow';
      feathers.push(p);
      if (!fromPool) {
        allocRef.current.particles += 1;
      }
    }
    if (vfxDebugRef.current) {
      vfxStatsRef.current.featherSpawns += 1;
    }
  };

  // Proximity audio + global effects listeners
  useEffect(() => {
    if (!interactive) return;

    const initAudio = () => {
      const a = audioRef.current;
      if (a.inited) return;
      a.shotPool = new AudioPool('/assets/sfx/shot.wav', 10, 0.9);
      a.hitPool = new AudioPool('/assets/sfx/punch.mp3', 6, 0.8);
      a.pickupPool = new AudioPool('/assets/sfx/feather.mp3', 6, 0.8);
      a.deathPool = new AudioPool('/assets/sfx/death_explode.mp3', 4, 0.9);
      a.inited = true;
    };

    const unlockAudio = async () => {
      const a = audioRef.current;
      if (a.unlocked) return;
      initAudio();
      let unlockedAny = false;
      try {
        unlockedAny = Boolean(await ensureShotAudio());
        await Promise.allSettled([
          sfxManager.load('/assets/sfx/punch.mp3'),
          sfxManager.load('/assets/sfx/feather.mp3'),
          sfxManager.load('/assets/sfx/death_explode.mp3'),
        ]);
      } catch {}
      a.unlocked = !!a.unlocked || !!unlockedAny;
      if (demoDebugRef.current) {
        console.info('[SFX] unlock', { ok: a.unlocked ? 1 : 0, ...sfxManager.getDebugSnapshot() });
      }
    };

    const ensureShotAudio = async () => {
      const a = audioRef.current;
      const ctx = await sfxManager.ensureContext();
      if (!ctx) return false;
      a.shotCtx = ctx;
      if (!a.shotGain) {
        a.shotGain = sfxManager.createGain(0.2);
      }
      if (a.shotBuffer) return true;
      if (!a.shotLoadPromise) {
        a.shotLoadPromise = sfxManager.load('/assets/sfx/shot.wav')
          .then((buffer) => {
            a.shotBuffer = buffer;
            return !!buffer;
          })
          .catch(() => false);
      }
      return Boolean(await a.shotLoadPromise);
    };

    const playShotSegment = async (windowSpec) => {
      const ok = await ensureShotAudio();
      if (!ok) return;
      const a = audioRef.current;
      if (!a.shotBuffer || !a.shotGain) return;
      const source = a.shotCtx.createBufferSource();
      source.buffer = a.shotBuffer;
      source.connect(a.shotGain);
      const start = clamp(windowSpec.start, 0, Math.max(0, a.shotBuffer.duration - 0.01));
      const duration = clamp(windowSpec.duration, 0.03, Math.max(0.03, a.shotBuffer.duration - start));
      try {
        source.start(0, start, duration);
      } catch {}
    };

    const allowAudioRate = () => {
      const a = audioRef.current;
      const now = performance.now();
      if (now - (a.rateWindowStart || 0) >= 1000) {
        a.rateWindowStart = now;
        a.rateCount = 0;
      }
      const limitPerSecond = isTouchRef.current ? 24 : 44;
      if ((a.rateCount || 0) >= limitPerSecond) return false;
      a.rateCount = (a.rateCount || 0) + 1;
      return true;
    };

    const playProximity = (kind, x, y, ownerId = null, meta = null) => {
      const soundT0 = performance.now();
      initAudio();
      const players = playersRef.current;
      const me = players.get(myPlayerId);
      if (!me && kind !== 'death' && kind !== 'pickup') return;
      const a = audioRef.current;
      const isMobileLandscapeNow = isTouchRef.current && viewportRef.current.width > viewportRef.current.height;

      const hearDistance = kind === 'shot'
        ? SHOT_HEAR_DISTANCE
        : (kind === 'death'
          ? Math.max(MAX_HEAR_DISTANCE * 3, 2200)
          : (kind === 'pickup'
            ? Math.max(MAX_HEAR_DISTANCE * 6, 3600)
            : Math.max(MAX_HEAR_DISTANCE * 3, 2200)));
      const listenerX = me?.x ?? x;
      const listenerY = me?.y ?? y;
      const d = distance(listenerX, listenerY, x, y);
      if (d > hearDistance) return;

      const volume = Math.max(0, Math.min(1, 1 - d / hearDistance));
      if (kind === 'shot') {
        shotDebugCountersRef.current.shotsRequested += 1;
        if (!allowAudioRate()) {
          shotDebugCountersRef.current.rateLimited += 1;
          return;
        }
        const shooterKey = String(ownerId || 'unknown');
        const now = performance.now();
        const shooterLastAt = a.shotPerShooterAt.get(shooterKey) || 0;
        const shooterMinInterval = 1000 / 14;
        if (now - shooterLastAt < shooterMinInterval) {
          shotDebugCountersRef.current.rateLimited += 1;
          return;
        }
        a.shotPerShooterAt.set(shooterKey, now);
        const nextVolume = isMobileLandscapeNow ? 0.22 : (0.15 + volume * 0.85);
        if (!a.shotPool) {
          shotDebugCountersRef.current.poolMisses += 1;
          return;
        }
        void a.shotPool.play(nextVolume).then((ok) => {
          if (!ok) {
            void unlockAudio().then(() => a.shotPool.play(nextVolume)).catch(() => false);
          }
          if (ok) {
            shotDebugCountersRef.current.shotsPlayed += 1;
          }
          if (demoDebugRef.current) {
            console.info('[SFX] playShot', {
              shooterId: shooterKey,
              ok: ok ? 1 : 0,
              unlocked: !!a.unlocked,
              distance: Number(d.toFixed(1)),
              volume: Number(nextVolume.toFixed(2)),
              ...sfxManager.getDebugSnapshot(),
            });
          }
        });
      } else if (kind === 'hit' && a.hitPool) {
        const hitVol = 0.2 + volume * 0.8;
        void a.hitPool.play(hitVol).then((ok) => {
          if (!ok) {
            void unlockAudio().then(() => a.hitPool.play(hitVol)).catch(() => false);
          }
          if (demoDebugRef.current) {
            console.info('[SFX] hit', { fired: 1, ok: ok ? 1 : 0, distance: Number(d.toFixed(1)), ...sfxManager.getDebugSnapshot() });
          }
        });
      } else if (kind === 'pickup' && a.pickupPool) {
        const now = performance.now();
        if (now - (a.lastPickupAt || 0) < 30) return;
        a.lastPickupAt = now;
        const pickupVol = 0.25 + volume * 0.75;
        void a.pickupPool.play(pickupVol).then((ok) => {
          if (!ok) {
            void unlockAudio().then(() => a.pickupPool.play(pickupVol)).catch(() => false);
          }
          if (demoDebugRef.current) {
            console.info('[SFX] pickup', { fired: 1, ok: ok ? 1 : 0, distance: Number(d.toFixed(1)), ...sfxManager.getDebugSnapshot() });
          }
        });
      } else if (kind === 'death' && a.deathPool) {
        const deathVol = Math.max(0.55, 0.35 + volume * 0.75);
        void a.deathPool.play(deathVol).then((ok) => {
          if (!ok) {
            void unlockAudio().then(() => a.deathPool.play(deathVol)).catch(() => false);
          }
          if (demoDebugRef.current) {
            console.info('[SFX] explosion', { fired: 1, ok: ok ? 1 : 0, distance: Number(d.toFixed(1)), ...sfxManager.getDebugSnapshot() });
          }
        });
      }
      if (perfModeRef.current) {
        perfCountersRef.current.soundMs += performance.now() - soundT0;
      }
    };

    const triggerLocalShotFeedback = () => {
      if (!isTouchRef.current) return;
      try {
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
          navigator.vibrate(8);
          return;
        }
      } catch {}
      const now = performance.now();
      const shake = viewShakeRef.current;
      shake.startedAt = now;
      shake.until = now + SHOT_SHAKE_MS;
      shake.amp = SHOT_SHAKE_AMP_PX;
    };

    const onShot = (e) => {
      const shotPerfStart = performance.now();
      const { x, y, ownerId, local } = e.detail || {};
      if (typeof x !== 'number' || typeof y !== 'number') return;
      const demoActive = typeof window !== 'undefined' && !!window.__FLAPPY_DEMO_ACTIVE__;
      const isMobileLandscapeNow = isTouchRef.current && viewportRef.current.width > viewportRef.current.height;
      if (ownerId !== undefined && ownerId !== null) {
        const now = performance.now();
        const lastAt = lastShotRef.current.get(ownerId) || 0;
        const cooldownMs = isMobileLandscapeNow ? 95 : 40;
        if (now - lastAt < cooldownMs) return;
        lastShotRef.current.set(ownerId, now);
      }
      const isLocalShotOwner = ownerId === myPlayerId || String(ownerId) === String(myPlayerId) || (local && ownerId == null);
      if (isLocalShotOwner) {
        if (fireInputBlockedRef.current) {
          if (demoDebugRef.current) {
            console.info('[SFX] suppress local shot during fire_intro lock');
          }
          return;
        }
        triggerLocalShotFeedback();
        if (hapticsDebugEnabledRef.current) {
          console.info('[HAPTICS EVT] onShot', { source: 'shot_event_local_owner' });
        }
        hapticsRef.current?.onShot();
      }
      const tracers = localTracersRef.current;
      const shooter = ownerId != null ? playersRef.current.get(ownerId) : null;
      const ang = Number.isFinite(shooter?.angle) ? shooter.angle : 0;
      const len = 390;
      const tracerForwardOffset = 150;
      tracers.push({
        x1: x + Math.cos(ang) * tracerForwardOffset,
        y1: y + Math.sin(ang) * tracerForwardOffset,
        x2: x + Math.cos(ang) * (tracerForwardOffset + len),
        y2: y + Math.sin(ang) * (tracerForwardOffset + len),
        life: 0.18,
        maxLife: 0.18,
      });
      if (tracers.length > 64) tracers.shift();
      spawnPlayerMuzzle(ownerId, x, y);
      const audioStart = performance.now();
      const isLocalShooter = ownerId === myPlayerId;
      const isBotShooter = !!shooter?.isBot;
      const isLoopedLocalShooter = isLocalShooter && !!audioRef.current.shotLooping;
      const isLoopedBotShooter = isBotShooter && audioRef.current.botShotLoops?.has(ownerId);
      const suppressShotEventAudio = isLoopedLocalShooter || isLoopedBotShooter;
      const playShotNow = () => playProximity('shot', x, y, ownerId);
      if (!suppressShotEventAudio) {
        if (!audioRef.current.unlocked) {
          void unlockAudio().finally(playShotNow);
        } else {
          playShotNow();
        }
      }
      if (perfModeRef.current) {
        perfCountersRef.current.fireHandlerMs += performance.now() - shotPerfStart;
        console.info('[perf] shot-audio', {
          ownerId,
          t_audio: Number((performance.now() - audioStart).toFixed(3)),
          t_totalShotCost: Number((performance.now() - shotPerfStart).toFixed(3)),
          bullets_alive: bulletsRef.current.size,
          players_count: playersRef.current.size,
          entities_collision: playersRef.current.size + bulletsRef.current.size + orbsRef.current.size,
        });
      }
    };

    const onRemoteShot = (e) => {
      const { x, y, ownerId } = e.detail || {};
      if (typeof x !== 'number' || typeof y !== 'number') return;
      const now = performance.now();
      if (ownerId !== undefined && ownerId !== null) {
        const lastAt = lastShotRef.current.get(ownerId) || 0;
        if (now - lastAt < 40) return;
        lastShotRef.current.set(ownerId, now);
      }
      spawnPlayerMuzzle(ownerId, x, y);
    };

    const startMobileFireLoop = async () => {
      if (fireInputBlockedRef.current) return;
      const touchMode = !!isTouchRef.current;
      const demoActive = typeof window !== 'undefined' && !!window.__FLAPPY_DEMO_ACTIVE__;
      if (!touchMode && !demoActive) return;
      const me = playersRef.current.get(myPlayerId);
      if (!me?.alive) return;
      initAudio();
      const ok = await ensureShotAudio();
      if (!ok) return;
      const a = audioRef.current;
      if (!a.shotBuffer || !a.shotGain || a.shotLooping) return;
      a.shotLooping = true;
      try {
        await playShotSegment(a.shotStartWindow);
        const source = a.shotCtx.createBufferSource();
        const loopGain = a.shotCtx.createGain();
        source.buffer = a.shotBuffer;
        source.loop = true;
        source.loopStart = a.shotLoopWindow.start;
        source.loopEnd = a.shotLoopWindow.end;
        const now = a.shotCtx.currentTime;
        loopGain.gain.setValueAtTime(1, now);
        source.connect(loopGain);
        loopGain.connect(a.shotGain);
        source.start(0, a.shotLoopWindow.start);
        a.shotLoopSource = source;
        a.shotLoopGain = loopGain;
        source.onended = () => {
          if (audioRef.current.shotLoopSource === source) {
            audioRef.current.shotLoopSource = null;
            audioRef.current.shotLoopGain = null;
          }
        };
      } catch {}
    };

    const stopMobileFireLoop = () => {
      const a = audioRef.current;
      if (a.shotLoopSource) {
        try {
          if (a.shotCtx && a.shotLoopGain) {
            const now = a.shotCtx.currentTime;
            a.shotLoopGain.gain.cancelScheduledValues(now);
            a.shotLoopGain.gain.setValueAtTime(Math.max(0.0001, a.shotLoopGain.gain.value || 1), now);
            a.shotLoopGain.gain.linearRampToValueAtTime(0.0001, now + 0.09);
            a.shotLoopSource.stop(now + 0.1);
          } else {
            a.shotLoopSource.stop();
          }
        } catch {}
        a.shotLoopSource = null;
        a.shotLoopGain = null;
      }
      if (a.shotLooping) {
        a.shotLooping = false;
        void playShotSegment(a.shotEndWindow);
      }
    };

    const stopBotShotLoop = (botId) => {
      const a = audioRef.current;
      const loop = a.botShotLoops?.get(botId);
      if (!loop) return;
      a.botShotLoops.delete(botId);
      try {
        if (a.shotCtx && loop.gain) {
          const now = a.shotCtx.currentTime;
          loop.gain.gain.cancelScheduledValues(now);
          loop.gain.gain.setValueAtTime(Math.max(0.0001, loop.gain.gain.value || 1), now);
          loop.gain.gain.linearRampToValueAtTime(0.0001, now + 0.12);
          loop.source.stop(now + 0.16);
        } else {
          loop.source.stop();
        }
      } catch {}
      if (import.meta.env.DEV) {
        console.info('[BOT AUDIO] stop', { botId });
      }
    };

    const startBotShotLoop = async (botId, worldX, worldY) => {
      const a = audioRef.current;
      if (!botId) return;
      if (a.botShotLoops?.has(botId)) return;
      initAudio();
      const ok = await ensureShotAudio();
      if (!ok || !a.shotBuffer || !a.shotGain || !a.shotCtx) return;
      const source = a.shotCtx.createBufferSource();
      const loopGain = a.shotCtx.createGain();
      const listener = playersRef.current.get(myPlayerId);
      const dist = listener ? distance(listener.x, listener.y, worldX, worldY) : 0;
      const volume = Math.max(0.04, Math.min(0.65, 1 - dist / SHOT_HEAR_DISTANCE));
      source.buffer = a.shotBuffer;
      source.loop = true;
      source.loopStart = a.shotLoopWindow.start;
      source.loopEnd = a.shotLoopWindow.end;
      const now = a.shotCtx.currentTime;
      loopGain.gain.setValueAtTime(0.0001, now);
      loopGain.gain.linearRampToValueAtTime(volume, now + 0.05);
      source.connect(loopGain);
      loopGain.connect(a.shotGain);
      source.start(0, a.shotLoopWindow.start);
      a.botShotLoops.set(botId, { source, gain: loopGain, worldX, worldY });
      source.onended = () => {
        const active = audioRef.current.botShotLoops.get(botId);
        if (active?.source === source) {
          audioRef.current.botShotLoops.delete(botId);
        }
      };
      if (import.meta.env.DEV) {
        console.info('[BOT AUDIO] start', { botId, volume: Number(volume.toFixed(2)) });
      }
    };

    const syncBotShotLoops = () => {
      const a = audioRef.current;
      const now = performance.now();
      if (now - (a.lastBotAudioSyncAt || 0) < 90) return;
      a.lastBotAudioSyncAt = now;

      const me = playersRef.current.get(myPlayerId);
      const heardBots = new Set();
      playersRef.current.forEach((player, id) => {
        if (!player?.alive || !player?.isBot || !player?.shooting) return;
        if (!me) return;
        const dist = distance(me.x, me.y, player.x, player.y);
        if (dist > SHOT_HEAR_DISTANCE) return;
        heardBots.add(id);
        if (!a.botShotLoops.has(id)) {
          void startBotShotLoop(id, player.x, player.y);
        } else {
          const active = a.botShotLoops.get(id);
          if (active?.gain && a.shotCtx) {
            const targetVol = Math.max(0.04, Math.min(0.65, 1 - dist / SHOT_HEAR_DISTANCE));
            const t = a.shotCtx.currentTime;
            active.gain.gain.cancelScheduledValues(t);
            active.gain.gain.linearRampToValueAtTime(targetVol, t + 0.08);
          }
        }
      });

      const toStop = [];
      a.botShotLoops.forEach((_, botId) => {
        if (!heardBots.has(botId)) toStop.push(botId);
      });
      toStop.forEach((botId) => stopBotShotLoop(botId));
    };

    const onAnyDeath = (e) => {
      const { x, y, playerId, birdType, deathTick, sourceEvent, hpBefore, hpAfter } = e.detail || {};
      if (typeof x !== 'number' || typeof y !== 'number') return;
      const now = performance.now();
      const resolvedTick = Number.isFinite(Number(deathTick))
        ? Math.trunc(Number(deathTick))
        : Math.trunc(now);
      const dedupKey = playerId
        ? `${playerId}:${resolvedTick}`
        : `${Math.round(x)}:${Math.round(y)}:${resolvedTick}`;
      if (deathVfxDedupRef.current.has(dedupKey)) return;
      deathVfxDedupRef.current.set(dedupKey, now);
      if (deathVfxDedupRef.current.size > 128) {
        deathVfxDedupRef.current.forEach((value, key) => {
          if (now - value > 8000) deathVfxDedupRef.current.delete(key);
        });
      }
      if (demoDebugRef.current) {
        const victim = playerId != null ? playersRef.current.get(playerId) : null;
        console.info('[SFX EVT] death-detected', {
          victimId: playerId || null,
          tick: resolvedTick,
          hpBefore: Number.isFinite(Number(hpBefore)) ? Number(hpBefore) : (victim?.health ?? null),
          hpAfter: Number.isFinite(Number(hpAfter)) ? Number(hpAfter) : 0,
          sourceEvent: sourceEvent || 'unknown',
          x: Math.round(x),
          y: Math.round(y),
        });
      }
      // Visual explosion for everyone
      deathExplosionsRef.current.push({ x, y, createdAt: performance.now() });
      if (deathExplosionsRef.current.length > 64) {
        deathExplosionsRef.current.shift();
      }
      spawnFeatherBurst(x, y, birdType || 'yellow');
      const playDeathAudio = () => {
        if (demoDebugRef.current) {
          console.info('[SFX EVT] death-audio-start', {
            victimId: playerId || null,
            tick: resolvedTick,
            sourceEvent: sourceEvent || 'unknown',
          });
        }
        playProximity('death', x, y);
      };
      playDeathAudio();
      if (playerId) {
        stopBotShotLoop(playerId);
      }
    };

    const onPlayerHit = (e) => {
      const { x, y, attackerId, playerId } = e.detail || {};
      if (typeof x !== 'number' || typeof y !== 'number') return;
      if (demoDebugRef.current) {
        console.info('[SFX EVT] hit', { attackerId: attackerId || null, playerId: playerId || null, x: Math.round(x), y: Math.round(y) });
      }
      if (playerId != null) {
        const target = playersRef.current.get(playerId);
        if (target) {
          target.hitAt = performance.now();
        }
      }
      const playHitNow = () =>
        playProximity('hit', x, y, attackerId, { pairKey: `${attackerId || 'unknown'}>${playerId || 'unknown'}` });
      if (attackerId && attackerId === myPlayerId) {
        if (import.meta.env.DEV) {
          console.info('[hitscan] hit-confirmed', { attackerId, x: Math.round(x), y: Math.round(y) });
        }
        playHitNow();
        return;
      }
      playHitNow();
    };

    const onOrbsCollected = (e) => {
      const { x, y, playerId, orbCount } = e.detail || {};
      const playPickup = () => {
        if (typeof x !== 'number' || typeof y !== 'number') {
          const collector = playerId != null ? playersRef.current.get(playerId) : null;
          if (collector) {
            playProximity('pickup', collector.x, collector.y);
          }
          return;
        }
        if (demoDebugRef.current) {
          console.info('[SFX] pickup', { playerId, orbCount: orbCount || 0, x: Math.round(x), y: Math.round(y) });
        }
        playProximity('pickup', x, y);
      };
      playPickup();
    };

    const primeHapticsFromGesture = (reason) => {
      hapticsRef.current?.primeFromGesture?.(reason);
    };
    const onPointerUnlock = () => {
      void unlockAudio();
      primeHapticsFromGesture('pointerdown');
    };
    const onKeyUnlock = () => {
      void unlockAudio();
      primeHapticsFromGesture('keydown');
    };
    const onTouchUnlock = () => {
      void unlockAudio();
      primeHapticsFromGesture('touchstart');
    };

    window.addEventListener('flappy:shot', onShot);
    window.addEventListener('flappy:remoteShot', onRemoteShot);
    window.addEventListener('flappy:anyDeath', onAnyDeath);
    window.addEventListener('flappy:playerHit', onPlayerHit);
    window.addEventListener('flappy:orbsCollected', onOrbsCollected);
    window.addEventListener('flappy:mobileFireStart', startMobileFireLoop);
    window.addEventListener('flappy:mobileFireStop', stopMobileFireLoop);
    window.addEventListener('flappy:audioUnlock', unlockAudio);
    window.addEventListener('pointerdown', onPointerUnlock, { capture: true });
    window.addEventListener('keydown', onKeyUnlock, { capture: true });
    window.addEventListener('touchstart', onTouchUnlock, { capture: true, passive: true });
    if (typeof window !== 'undefined' && window.__FLAPPY_AUDIO_UNLOCKED__) {
      void unlockAudio();
    }
    const botLoopTimer = setInterval(syncBotShotLoops, 90);
    let shotDebugTimer = null;
    if (demoDebugRef.current) {
      shotDebugTimer = setInterval(() => {
        console.info('[SFX] counters', { ...shotDebugCountersRef.current });
      }, 1000);
    }
    return () => {
      clearInterval(botLoopTimer);
      if (shotDebugTimer) clearInterval(shotDebugTimer);
      window.removeEventListener('flappy:shot', onShot);
      window.removeEventListener('flappy:remoteShot', onRemoteShot);
      window.removeEventListener('flappy:anyDeath', onAnyDeath);
      window.removeEventListener('flappy:playerHit', onPlayerHit);
      window.removeEventListener('flappy:orbsCollected', onOrbsCollected);
      window.removeEventListener('flappy:mobileFireStart', startMobileFireLoop);
      window.removeEventListener('flappy:mobileFireStop', stopMobileFireLoop);
      window.removeEventListener('flappy:audioUnlock', unlockAudio);
      window.removeEventListener('pointerdown', onPointerUnlock, { capture: true });
      window.removeEventListener('keydown', onKeyUnlock, { capture: true });
      window.removeEventListener('touchstart', onTouchUnlock, { capture: true });
      stopMobileFireLoop();
      const a = audioRef.current;
      if (a.botShotLoops?.size) {
        Array.from(a.botShotLoops.keys()).forEach((botId) => stopBotShotLoop(botId));
      }
    };
  }, [interactive, myPlayerId, playersRef]);

  // Send input to server
  useEffect(() => {
    if (!interactive) return;
    
    const inputInterval = setInterval(() => {
      const myPlayer = playersRef.current.get(myPlayerId);
      if (!myPlayer?.alive && !pausedRef.current) return;
      
      const canvas = canvasRef.current;
      if (!canvas) return;
      
      const input = inputRef.current;
      const now = performance.now();
      const controller = pollControllerInput(controllerRef.current, now, CONTROLLER_BINDINGS);
      hapticsRef.current?.setActiveGamepadIndex(controller.connected ? controller.index : -1);
      if (controller.connected && (controller.isActive || controller.fire || controller.boost || controller.cashout || controller.hasDirection)) {
        hapticsRef.current?.primeFromGesture?.('controller_input');
      }
      const confirmPressed = !!controller.boost;
      const confirmPressedThisFrame = !!demoMode && confirmPressed && !controllerConfirmPrevRef.current;
      controllerConfirmPrevRef.current = confirmPressed;
      if (confirmPressedThisFrame && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('flappy:demoConfirm', { detail: { source: 'controller_x', at: now } }));
      }
      if (controllerConnectedRef.current !== !!controller.connected) {
        controllerConnectedRef.current = !!controller.connected;
        setControllerConnected(!!controller.connected);
      }
      if (!controller.connected) {
        controllerConfirmPrevRef.current = false;
      }
      const { width, height } = viewportRef.current;
      const controllerHasPriority = !!controller.isActive && controller.lastActiveAt >= (input.lastNonControllerAt || 0);
      let angle = input.lastMoveAngle;
      let throttle = 0;
      let rawShooting = input.shooting;
      let rawBoosting = input.boosting;
      let rawCashingOut = input.cashingOut || input.cashoutPointer;

      if (controllerHasPriority) {
        input.source = 'controller';
        const stickMag = Math.hypot(controller.moveX, controller.moveY);
        const centerX = width / 2;
        const centerY = height / 2;
        if (controller.hasDirection) {
          angle = Math.atan2(controller.moveY, controller.moveX);
          controllerAimAngleRef.current = angle;
          controllerHasAimRef.current = true;
          controllerThrottleRef.current = clamp(controller.intensity, CONTROLLER_CRUISE_THROTTLE, 1);
          input.lastMoveAngle = angle;
          input.moveX = controller.moveX;
          input.moveY = controller.moveY;
        } else if (controllerHasAimRef.current || Number.isFinite(myPlayer?.angle)) {
          if (!controllerHasAimRef.current) {
            controllerAimAngleRef.current = Number.isFinite(myPlayer?.angle) ? myPlayer.angle : input.lastMoveAngle;
            controllerHasAimRef.current = true;
          }
          angle = controllerAimAngleRef.current;
          input.lastMoveAngle = angle;
          input.moveX = Math.cos(angle);
          input.moveY = Math.sin(angle);
        } else {
          angle = input.lastMoveAngle;
          input.moveX = Math.cos(angle);
          input.moveY = Math.sin(angle);
        }
        throttle = controller.hasDirection
          ? controllerThrottleRef.current
          : Math.max(CONTROLLER_CRUISE_THROTTLE, controllerThrottleRef.current || CONTROLLER_CRUISE_THROTTLE);
        const aimRadius = CONTROLLER_AIM_RADIUS_PX * throttle;
        input.mouseX = centerX + Math.cos(angle) * aimRadius;
        input.mouseY = centerY + Math.sin(angle) * aimRadius;
        rawShooting = controller.fire;
        rawBoosting = controller.boost;
        rawCashingOut = controller.cashout;
        if (import.meta.env.DEV && demoDebugRef.current) {
          if (!controllerDebugRef.current.until) {
            controllerDebugRef.current.until = now + 60000;
          }
          const shouldLog = now <= controllerDebugRef.current.until && (now - controllerDebugRef.current.lastLogAt >= 250);
          if (shouldLog) {
            controllerDebugRef.current.lastLogAt = now;
            console.info('[CTRL]', {
              mag: Number(stickMag.toFixed(3)),
              angle: Number(angle.toFixed(3)),
              boost: rawBoosting ? 1 : 0,
              fire: rawShooting ? 1 : 0,
              cashout: rawCashingOut ? 1 : 0,
              reusedAim: controller.hasDirection ? 0 : 1,
              vectorReset: controller.hasDirection ? 0 : (controllerHasAimRef.current ? 0 : 1),
              aimX: Math.round(input.mouseX),
              aimY: Math.round(input.mouseY),
              throttle: Number(throttle.toFixed(3)),
            });
          }
        }
      } else {
        const centerX = input.usingTouch ? input.joyCenterX : width / 2;
        const centerY = input.usingTouch ? input.joyCenterY : height / 2;
        const dx = input.mouseX - centerX;
        const dy = input.mouseY - centerY;
        const dist = Math.hypot(dx, dy);
        const hasDirection = dist > 4;
        angle = hasDirection ? Math.atan2(dy, dx) : input.lastMoveAngle;
        if (hasDirection) input.lastMoveAngle = angle;
        // Movement throttle: touch moves only while movement pointer is held.
        const DEADZONE_PX = 6;
        const touchContinuous = input.movePointerId !== null;
        throttle = touchContinuous ? 1 : (dist <= DEADZONE_PX ? 0 : 1);
      }
      
      const lockInput = !!demoMode && !!demoInputLocked;
      if (lockInput && !!demoMode && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('flappy:demoInputIntent', {
          detail: {
            angle,
            throttle,
            shooting: !!rawShooting,
            boosting: !!rawBoosting,
            cashingOut: !!rawCashingOut,
            source: controllerHasPriority ? 'controller' : (input.source || 'pointer'),
            controllerConnected: !!controller.connected,
            controllerActive: !!controllerHasPriority,
            controllerStickActive: !!controller.hasDirection,
            controllerMagnitude: Number(controller.intensity || 0),
          },
        }));
      }
      const cashingOut = lockInput
        ? false
        : rawCashingOut && !pausedRef.current;
      const shooting = lockInput
        ? false
        : rawShooting && !pausedRef.current && !cashingOut;
      const boosting = lockInput
        ? false
        : rawBoosting && !pausedRef.current && !cashingOut;
      if (boosting && !boostHapticPrevRef.current) {
        if (hapticsDebugEnabledRef.current) {
          console.info('[HAPTICS EVT] onBoostStart');
        }
        hapticsRef.current?.onBoostStart();
      }
      boostHapticPrevRef.current = boosting;
      if (cashingOut) {
        if (!cashoutHapticActiveRef.current) {
          cashoutHapticActiveRef.current = true;
          cashoutHapticStartAtRef.current = now;
          cashoutHapticSecondRef.current = 0;
          if (hapticsDebugEnabledRef.current) {
            console.info('[HAPTICS EVT] onCashoutTick', { tick: 0 });
          }
          hapticsRef.current?.onCashoutTick(0);
        } else {
          const elapsedSec = Math.floor((now - cashoutHapticStartAtRef.current) / 1000);
          if (elapsedSec >= 1 && elapsedSec <= 3 && elapsedSec !== cashoutHapticSecondRef.current) {
            cashoutHapticSecondRef.current = elapsedSec;
            if (hapticsDebugEnabledRef.current) {
              console.info('[HAPTICS EVT] onCashoutTick', { tick: elapsedSec });
            }
            hapticsRef.current?.onCashoutTick(elapsedSec);
          }
        }
      } else if (cashoutHapticActiveRef.current) {
        cashoutHapticActiveRef.current = false;
        cashoutHapticStartAtRef.current = 0;
        cashoutHapticSecondRef.current = -1;
        hapticsRef.current?.resetCashout();
      }
      if (controllerHasPriority) {
        input.shooting = shooting;
        input.boosting = boosting;
        input.cashingOut = cashingOut;
      }
      const frozenAngle = Number.isFinite(myPlayer?.angle) ? myPlayer.angle : angle;
      const angleToSend = cashingOut ? frozenAngle : angle;
      const throttleToSend = lockInput ? 0 : throttle;
      if (demoDebugRef.current) {
        const sig = [
          lockInput ? 1 : 0,
          pausedRef.current ? 1 : 0,
          input.isTouchHeld ? 1 : 0,
          input.movePointerId ?? '-',
          shooting ? 1 : 0,
          controllerHasPriority ? 'controller' : (input.source || 'pointer'),
        ].join('|');
        if (sig !== inputStateDebugRef.current.sig) {
          inputStateDebugRef.current.sig = sig;
          console.info('[INPUT] state', {
            lockMovement: lockInput ? 1 : 0,
            paused: pausedRef.current ? 1 : 0,
            held: input.isTouchHeld ? 1 : 0,
            pointerId: input.movePointerId,
            fire: shooting ? 1 : 0,
            source: controllerHasPriority ? 'controller' : (input.source || 'pointer'),
            controllerConnected: controller.connected ? 1 : 0,
            controllerIntensity: Number(controller.intensity.toFixed(2)),
          });
        }
      }
      const sendStart = performance.now();
      sendInput(
        angleToSend,
        shooting,
        boosting,
        cashingOut,
        pausedRef.current,
        throttleToSend
      );
      if (perfModeRef.current && shooting) {
        perfCountersRef.current.sendInputMs += performance.now() - sendStart;
      }
    }, 1000 / 60);
    
    return () => clearInterval(inputInterval);
  }, [interactive, myPlayerId, sendInput, demoMode, demoInputLocked]);

  useEffect(() => {
    if (cameraMode !== 'spectate') {
      spectateTargetRef.current = null;
    }
  }, [cameraMode]);

  // Server-authoritative lifecycle events
  useEffect(() => {
    const onServerDeath = (e) => {
      const detail = e?.detail || {};
      onDeath({
        killerName: detail.killerName || 'Unknown',
        cause: detail.cause || 'unknown',
      });
    };
    const onServerCashout = (e) => {
      const amountUsd = e?.detail?.amountUsd ?? 0;
      const amountLamports = e?.detail?.amountLamports ?? 0;
      const amountSol = e?.detail?.amountSol ?? 0;
      if (hapticsDebugEnabledRef.current) {
        console.info('[HAPTICS EVT] onCashoutComplete');
      }
      hapticsRef.current?.onCashoutComplete();
      cashoutHapticActiveRef.current = false;
      cashoutHapticStartAtRef.current = 0;
      cashoutHapticSecondRef.current = -1;
      onCashout({ amountUsd, amountLamports, amountSol });
    };
    window.addEventListener('flappy:death', onServerDeath);
    window.addEventListener('flappy:cashout', onServerCashout);
    return () => {
      window.removeEventListener('flappy:death', onServerDeath);
      window.removeEventListener('flappy:cashout', onServerCashout);
    };
  }, [onDeath, onCashout]);

  // Main render loop
  useEffect(() => {
    if (!visible) return;
    const loopToken = renderLoopTokenRef.current + 1;
    renderLoopTokenRef.current = loopToken;
    renderLoopRestartsRef.current += 1;
    renderLoopCountRef.current += 1;
    if (import.meta.env.DEV && renderLoopCountRef.current > 1) {
      console.warn('[perf] multiple render loops detected', {
        activeLoops: renderLoopCountRef.current,
        token: loopToken,
      });
    }
    
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    
    if (!canvas || !ctx) return;
    
    const sprites = spritesRef.current;
    
    const gameLoop = (currentTime) => {
      if (renderLoopTokenRef.current !== loopToken) return;
      try {
      const frameStart = performance.now();
      const configNow = config || {};
      const worldWidth = configNow.worldWidth || 3200;
      const worldHeight = configNow.worldHeight || 2800;
      const bulletRange = configNow.bulletRange || BULLET_RANGE;
      const bulletRangeVisual = bulletRange * 0.5;
      heartbeatRef.current.frame += 1;
      const deltaTime = Math.min(Math.max(currentTime - lastFrameTimeRef.current, 0), MAX_FRAME_MS);
      lastFrameTimeRef.current = currentTime;
      heartbeatRef.current.lastDeltaMs = deltaTime;
      if (debugRef.current) {
        const perf = perfRef.current;
        perf.count += 1;
        perf.avgMs += (deltaTime - perf.avgMs) / perf.count;
        if (deltaTime > perf.maxMs) perf.maxMs = deltaTime;
        perf.samples.push({ t: currentTime, ms: deltaTime });
        while (perf.samples.length && perf.samples[0].t < currentTime - 2000) {
          perf.samples.shift();
        }
        if (perf.count > 300) {
          perf.count = 1;
          perf.avgMs = deltaTime;
          perf.maxMs = deltaTime;
        }
        const alloc = allocRef.current;
        if (currentTime - alloc.lastReset >= 1000) {
          alloc.particles = 0;
          alloc.bullets = 0;
          alloc.trails = 0;
          alloc.lastReset = currentTime;
        }
      }

      if (deltaTime > 80) {
        effectsKillRef.current = currentTime + 5000;
      }
      
      if (!pausedRef.current) {
        animTimeRef.current += deltaTime;
      }
      if (!pausedRef.current) {
        groundScrollRef.current += ENV_CONFIG.GROUND_SPEED * (deltaTime / 1000);
      }
      
      const animFrame = Math.floor(animTimeRef.current / (1000 / ANIMATION_FPS)) % 3;
      if (debugRef.current) {
        const fpsState = fpsRef.current;
        fpsState.elapsed += deltaTime;
        fpsState.frames += 1;
        if (fpsState.elapsed >= 500) {
          fpsState.value = Math.round((fpsState.frames * 1000) / fpsState.elapsed);
          fpsState.elapsed = 0;
          fpsState.frames = 0;
        }
      }

      const iosMode = isIOSRef.current;
      const viewportWNow = viewportRef.current.width;
      const viewportHNow = viewportRef.current.height;
      const isMobileLandscapeNow = isTouchRef.current && viewportWNow > viewportHNow;
      const lowQuality = iosMode || isTouchRef.current;
      const perfLow = lowQuality;
      const effectsEnabled = isTouchRef.current ? EFFECTS_ENABLED_MOBILE : EFFECTS_ENABLED_DESKTOP;
      const effectsOff = effectsKillRef.current > currentTime;
      const skipEffects = !effectsEnabled || lowFxRef.current || effectsOff;
      const skipBoostEffects = lowFxRef.current || effectsOff;
      // Mobile perf: keep bullets client-local to avoid per-bullet WS churn.
      const useLocalBullets = isTouchRef.current || !iosMode;
      
      const players = playersRef.current;
      const bullets = bulletsRef.current;
      const orbs = orbsRef.current;
      const camera = cameraRef.current;
      const input = inputRef.current;

      // Cashout UI sync (moved from useEffect on playersVersion to avoid 60Hz re-renders)
      const _myP = players.get(myPlayerId);
      if (_myP?.cashingOut) {
        if (!cashoutUiActiveRef.current) { cashoutUiActiveRef.current = true; setCashoutUiActive(true); }
      } else if (!input.cashoutPointer && cashoutUiActiveRef.current) {
        cashoutUiActiveRef.current = false; setCashoutUiActive(false);
      }

      const boostParticles = boostParticlesRef.current;
      if (skipBoostEffects) {
        boostParticles.length = 0;
        boostTrailRef.current.clear();
      }
      if (skipEffects) {
        muzzleParticlesRef.current.length = 0;
      }
      const localBullets = localBulletsRef.current;
      const interpolated = interpolatedRef.current;
      const playerFlips = playerFlipRef.current;

      const myPlayer = players.get(myPlayerId);
      
      // === SERVER-AUTH INTERPOLATION (buffered, no local movement prediction) ===
      const nowPerf = performance.now();
      const renderTs = nowPerf - INTERPOLATION_DELAY_MS;
      players.forEach((player, id) => {
        const recvTsRaw = Number(player?._snapshotRecvTs);
        const snapshotTsRaw = Number(player?._snapshotTs);
        const sampleTs = Number.isFinite(recvTsRaw)
          ? recvTsRaw
          : (Number.isFinite(snapshotTsRaw) ? snapshotTsRaw : 0);
        const posSig = `${sampleTs}|${Number(player.x).toFixed(3)}|${Number(player.y).toFixed(3)}|${Number(player.angle).toFixed(5)}`;
        const prevSig = snapshotSigRef.current.get(id);
        if (posSig !== prevSig) {
          let samples = snapshotBufferRef.current.get(id);
          if (!samples) {
            samples = [];
            snapshotBufferRef.current.set(id, samples);
          }
          samples.push({
            t: sampleTs,
            x: player.x,
            y: player.y,
            angle: player.angle,
            snapshotTs: Number(player?._snapshotTs || 0),
          });
          while (samples.length > 12 || (samples.length && (sampleTs - samples[0].t) > SNAPSHOT_RETENTION_MS)) {
            samples.shift();
          }
          snapshotSigRef.current.set(id, posSig);
        }

        let interp = interpolated.get(id);
        if (!interp) {
          interp = { x: player.x, y: player.y, angle: player.angle };
          interpolated.set(id, interp);
        }

        const samples = snapshotBufferRef.current.get(id);
        if (!samples || samples.length === 0) {
          interp.x = player.x;
          interp.y = player.y;
          interp.angle = player.angle;
          return;
        }

        if (samples.length === 1) {
          const s = samples[0];
          interp.x = s.x;
          interp.y = s.y;
          interp.angle = s.angle;
          return;
        }

        let prev = samples[0];
        let next = samples[samples.length - 1];
        if (renderTs <= samples[0].t) {
          prev = samples[0];
          next = samples[0];
        } else if (renderTs >= samples[samples.length - 1].t) {
          prev = samples[samples.length - 1];
          next = samples[samples.length - 1];
        } else {
          for (let i = 1; i < samples.length; i += 1) {
            if (samples[i].t >= renderTs) {
              prev = samples[i - 1];
              next = samples[i];
              break;
            }
          }
        }

        const span = Math.max(1, next.t - prev.t);
        const alpha = clamp((renderTs - prev.t) / span, 0, 1);
        interp.x = lerp(prev.x, next.x, alpha);
        interp.y = lerp(prev.y, next.y, alpha);
        interp.angle = lerpAngle(prev.angle, next.angle, alpha);
      });
      
      // Clean up interpolated state for disconnected players
      interpolated.forEach((_, id) => {
        if (!players.has(id)) {
          interpolated.delete(id);
        }
      });
      snapshotBufferRef.current.forEach((_, id) => {
        if (!players.has(id)) {
          snapshotBufferRef.current.delete(id);
          snapshotSigRef.current.delete(id);
        }
      });
      
      // === GAME UPDATES ===
      if (!pausedRef.current) {
        const updateStart = performance.now();
        const myInterp = interpolated.get(myPlayerId);
        const shootCooldown = config?.shootCooldown || SHOOT_COOLDOWN;
        const bulletSpeed = config?.bulletSpeed || BULLET_SPEED;
        const now = performance.now();

        const bulletRadius = (config?.bulletSize || BULLET_SIZE) * 0.5;

        const releaseLocalBullet = (id) => {
          const b = localBullets.get(id);
          if (!b) return;
          localBullets.delete(id);
          localBulletPoolRef.current.push(b);
        };
        if (isMobileLandscapeNow && localBullets.size) {
          localBullets.forEach((_, id) => releaseLocalBullet(id));
        }
        {
          const tracers = localTracersRef.current;
          for (let i = tracers.length - 1; i >= 0; i -= 1) {
            tracers[i].life -= deltaTime / 1000;
            if (tracers[i].life <= 0) {
              tracers.splice(i, 1);
            }
          }
        }
        if (useLocalBullets && !isMobileLandscapeNow) {
          const shootStart = performance.now();
          if (myPlayer?.alive && input.shooting && myInterp) {
            if (now - lastLocalShotRef.current >= shootCooldown) {
              lastLocalShotRef.current = now;
              const spread = (Math.random() - 0.5) * BULLET_SPREAD;
              const bulletAngle = myInterp.angle + spread;
              const birdSize = PLAYER_SIZE * BIRD_SCALE;
              const mouthOffset = birdSize * 0.48;
              const muzzleX = myInterp.x + Math.cos(myInterp.angle) * mouthOffset;
              const muzzleY = myInterp.y + Math.sin(myInterp.angle) * mouthOffset + birdSize * 0.21;
              const id = `local-${localBulletIdRef.current++}`;
              const maxLocalBullets = isMobileLandscapeNow
                ? MAX_BULLETS_MOBILE_LS
                : (isTouchRef.current ? 64 : MAX_BULLETS);
              if (localBullets.size >= maxLocalBullets) {
                const firstKey = localBullets.keys().next().value;
                if (firstKey) releaseLocalBullet(firstKey);
              }
              const pooled = localBulletPoolRef.current.pop() || {};
              pooled.id = id;
              pooled.ownerId = myPlayerId;
              pooled.x = muzzleX;
              pooled.y = muzzleY;
              pooled.localX = muzzleX;
              pooled.localY = muzzleY;
              pooled.startX = muzzleX;
              pooled.startY = muzzleY;
              pooled.vx = Math.cos(bulletAngle) * bulletSpeed;
              pooled.vy = Math.sin(bulletAngle) * bulletSpeed;
              pooled.createdAt = Date.now();
              pooled.isLocal = true;
              localBullets.set(id, pooled);
              allocRef.current.bullets += 1;
              if (typeof window !== 'undefined' && !isMobileLandscapeNow) {
                window.dispatchEvent(new CustomEvent('flappy:shot', {
                  detail: { x: muzzleX, y: muzzleY, ownerId: myPlayerId, local: true },
                }));
              }
              if (import.meta.env.DEV && demoDebugRef.current) {
                const sampleLocal = localBullets.get(id);
                const sampleBot = Array.from(localBullets.values()).find((b) => b && b.ownerId !== myPlayerId) || null;
                console.info('[TRACER DEBUG] local-shot-spawn', {
                  renderCollection: 'localBulletsRef.current',
                  existsInRenderedCollection: !!sampleLocal,
                  bulletCount: localBullets.size,
                  localSample: sampleLocal ? {
                    id: sampleLocal.id,
                    ownerId: sampleLocal.ownerId,
                    localX: Number(sampleLocal.localX?.toFixed?.(1) || sampleLocal.localX || 0),
                    localY: Number(sampleLocal.localY?.toFixed?.(1) || sampleLocal.localY || 0),
                    startX: Number(sampleLocal.startX?.toFixed?.(1) || sampleLocal.startX || 0),
                    startY: Number(sampleLocal.startY?.toFixed?.(1) || sampleLocal.startY || 0),
                    vx: Number(sampleLocal.vx?.toFixed?.(2) || sampleLocal.vx || 0),
                    vy: Number(sampleLocal.vy?.toFixed?.(2) || sampleLocal.vy || 0),
                  } : null,
                  botSample: sampleBot ? {
                    id: sampleBot.id,
                    ownerId: sampleBot.ownerId,
                    localX: Number(sampleBot.localX?.toFixed?.(1) || sampleBot.localX || 0),
                    localY: Number(sampleBot.localY?.toFixed?.(1) || sampleBot.localY || 0),
                    startX: Number(sampleBot.startX?.toFixed?.(1) || sampleBot.startX || 0),
                    startY: Number(sampleBot.startY?.toFixed?.(1) || sampleBot.startY || 0),
                    vx: Number(sampleBot.vx?.toFixed?.(2) || sampleBot.vx || 0),
                    vy: Number(sampleBot.vy?.toFixed?.(2) || sampleBot.vy || 0),
                  } : null,
                });
              }
              if (perfModeRef.current) {
                const fireStats = fireStatsRef.current;
                fireStats.shots += 1;
                const elapsed = performance.now() - fireStats.windowStart;
                if (elapsed >= 1000) {
                  fireStats.sps = Number(((fireStats.shots * 1000) / elapsed).toFixed(1));
                  fireStats.windowStart = performance.now();
                  fireStats.shots = 0;
                }
              }
              // Mobile landscape perf mode: keep shot feedback local-only (no shot event/audio fanout).
            }
          }
          if (perfModeRef.current) {
            perfCountersRef.current.shootMs += performance.now() - shootStart;
          }

          // Sync bullets from server
          bullets.forEach((bullet, id) => {
            if (bullet.ownerId === myPlayerId) return;
            if (isMobileLandscapeNow) return;
            const maxLocalBullets = isMobileLandscapeNow
              ? MAX_BULLETS_MOBILE_LS
              : (isTouchRef.current ? 64 : MAX_BULLETS);
            if (localBullets.size >= maxLocalBullets) return;
            if (!localBullets.has(id)) {
              const pooled = localBulletPoolRef.current.pop() || {};
              pooled.id = bullet.id;
              pooled.ownerId = bullet.ownerId;
              pooled.x = bullet.x;
              pooled.y = bullet.y;
              pooled.vx = bullet.vx;
              pooled.vy = bullet.vy;
              pooled.localX = bullet.x;
              pooled.localY = bullet.y;
              pooled.startX = bullet.x;
              pooled.startY = bullet.y;
              pooled.createdAt = bullet.createdAt;
              pooled.isLocal = false;
              localBullets.set(id, pooled);
            }
          });
          
          // Remove server-removed bullets
          localBullets.forEach((bullet, id) => {
            if (bullet?.isLocal) return;
            if (!bullets.has(id)) {
              releaseLocalBullet(id);
            }
          });
          
          // Update bullet positions and enforce range
          const bulletUpdateStart = performance.now();
          localBullets.forEach((bullet, id) => {
            bullet.localX += bullet.vx;
            bullet.localY += bullet.vy;

            if (bullet.isLocal && pipes?.length) {
              for (const pipe of pipes) {
                if (circleRectCollision(bullet.localX, bullet.localY, bulletRadius, pipe.x, pipe.y, pipe.width, pipe.height)) {
                  releaseLocalBullet(id);
                  return;
                }
              }
            }
            
            // Remove if exceeded range
            const traveled = distance(bullet.startX, bullet.startY, bullet.localX, bullet.localY);
            if (traveled > bulletRange) {
              releaseLocalBullet(id);
            }
          });
          if (perfModeRef.current) {
            perfCountersRef.current.bulletUpdateMs += performance.now() - bulletUpdateStart;
          }
        } else if (isMobileLandscapeNow) {
          if (myPlayer?.alive && input.shooting && myInterp) {
            if (now - lastLocalShotRef.current >= shootCooldown) {
              lastLocalShotRef.current = now;
              const birdSize = PLAYER_SIZE * BIRD_SCALE;
              const mouthOffset = birdSize * 0.48;
              const muzzleX = myInterp.x + Math.cos(myInterp.angle) * mouthOffset;
              const muzzleY = myInterp.y + Math.sin(myInterp.angle) * mouthOffset + birdSize * 0.21;
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('flappy:shot', {
                  detail: { x: muzzleX, y: muzzleY, ownerId: myPlayerId, local: true },
                }));
              }
            }
          }
        }

        // Orbs/feathers are server-authoritative.
        // Do not mutate orb positions here (it causes jitter/desync).
        
        // Update flip states
        // Replicate the original "keep upright" behavior, but in a way that matches your recording:
        // - When aiming left (cos(angle) < 0), we flip on X and add PI to the render rotation.
        //   This avoids the "upside down" look caused by Y-flips.
        players.forEach((player, id) => {
          const interp = interpolated.get(id);
          if (!interp) return;

          const a = normalizeAngle(interp.angle);
          const aimingLeft = Math.cos(a) < 0;
          const targetFlipX = aimingLeft ? -1 : 1;

          if (!playerFlips.has(id)) {
            playerFlips.set(id, { current: targetFlipX, target: targetFlipX });
          }

          const flipState = playerFlips.get(id);
          flipState.target = targetFlipX;
          flipState.current = lerp(flipState.current, flipState.target, 0.25);
        });
        
        // Boost particles
        const localBoostVisualActive = isTouchRef.current && input.boosting;
        const myBoostVisualActive =
          myPlayer?.alive &&
          !myPlayer?.boostDepleted &&
          (myPlayer?.boosting || localBoostVisualActive);
        if (!skipBoostEffects && myBoostVisualActive) {
          if (!effectsOff) {
            const myInterp = interpolated.get(myPlayerId);
            if (myInterp) {
              const boostLimit = (isTouchRef.current || isIOSRef.current) ? MAX_PARTICLES_MOBILE : MAX_PARTICLES;
              for (let i = 0; i < 2; i++) {
                if (boostParticles.length >= boostLimit) break;
                const pAngle = normalizeAngle(myInterp.angle);
                const spawnAngle = pAngle + Math.PI + (Math.random() - 0.5) * 0.5;
                const fromPool = boostPoolRef.current.pop();
                const p = fromPool || {};
                p.x = myInterp.x - Math.cos(pAngle) * PLAYER_SIZE * 0.8;
                p.y = myInterp.y - Math.sin(pAngle) * PLAYER_SIZE * 0.8;
                p.vx = Math.cos(spawnAngle) * (2 + Math.random() * 2);
                p.vy = Math.sin(spawnAngle) * (2 + Math.random() * 2);
                p.life = 1.0;
                p.size = 3 + Math.random() * 4;
                boostParticles.push(p);
                if (!fromPool) {
                  allocRef.current.particles += 1;
                }
              }
            }
          }
        }
        
        for (let i = boostParticles.length - 1; i >= 0; i--) {
          const p = boostParticles[i];
          p.x += p.vx;
          p.y += p.vy;
          p.life -= 0.05;
          p.size *= 0.95;
          if (p.life <= 0) {
            const last = boostParticles.pop();
            if (i < boostParticles.length && last) {
              boostParticles[i] = last;
            }
            boostPoolRef.current.push(p);
          }
        }

        const muzzleParticles = muzzleParticlesRef.current;
        const pool = muzzlePoolRef.current;
        const dt = deltaTime / 1000;
        for (let i = muzzleParticles.length - 1; i >= 0; i--) {
          const p = muzzleParticles[i];
          p.life += dt;
          if (p.life >= p.maxLife) {
            const last = muzzleParticles.pop();
            if (i < muzzleParticles.length && last) {
              muzzleParticles[i] = last;
            }
            pool.push(p);
            continue;
          }
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.vy += 380 * dt;
          p.vx -= p.vx * 4.2 * dt;
          p.vy -= p.vy * 4.2 * dt;
        }

        // Boost trail (lightweight position history while boosting).
        const trailMap = boostTrailRef.current;
        const trailPool = boostTrailPoolRef.current;
        const maxTrail = isTouchRef.current ? BOOST_TRAIL_MAX_MOBILE : BOOST_TRAIL_MAX_DESKTOP;
        players.forEach((player, id) => {
          const interp = interpolated.get(id);
          if (!interp || !player.alive) return;
          const localBoostVisualActive = id === myPlayerId && isTouchRef.current && input.boosting;
          const boostingNow = !skipBoostEffects && !player.boostDepleted && (player.boosting || localBoostVisualActive);
          let list = trailMap.get(id);
          if (!list) {
            list = [];
            trailMap.set(id, list);
          }
          if (boostingNow) {
            const last = list.length ? list[list.length - 1] : null;
            const d = last ? distance(last.x, last.y, interp.x, interp.y) : Infinity;
            if (!last || d >= BOOST_TRAIL_ADD_DIST) {
              if (list.length >= maxTrail) {
                const recycled = list.shift();
                if (recycled) trailPool.push(recycled);
              }
              const fromPool = trailPool.pop();
              const node = fromPool || {};
              node.x = interp.x;
              node.y = interp.y;
              node.life = 1;
              list.push(node);
              if (!fromPool) {
                allocRef.current.trails += 1;
              }
            }
          }
          for (let i = list.length - 1; i >= 0; i -= 1) {
            list[i].life -= BOOST_TRAIL_LIFE_DECAY;
            if (list[i].life <= 0) {
              const recycled = list[i];
              const tail = list.pop();
              if (i < list.length && tail) list[i] = tail;
              trailPool.push(recycled);
            }
          }
          if (!list.length && !boostingNow) {
            trailMap.delete(id);
          }
        });

        // Feather death burst particles.
        const feathers = featherVfxRef.current;
        const featherPool = featherVfxPoolRef.current;
        for (let i = feathers.length - 1; i >= 0; i -= 1) {
          const p = feathers[i];
          p.life += dt;
          if (p.life >= p.maxLife) {
            const last = feathers.pop();
            if (i < feathers.length && last) feathers[i] = last;
            featherPool.push(p);
            continue;
          }
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.vy += 360 * dt;
          p.vx -= p.vx * 1.7 * dt;
          p.rot += p.rotVel * dt;
        }

        if (debugRef.current && stressRef.current.active) {
          const stress = stressRef.current;
          if (currentTime >= stress.until) {
            stress.active = false;
          } else {
            const shotsPerSec = stress.shooters * stress.rate;
            stress.acc += (deltaTime / 1000) * shotsPerSec;
            const stressBullets = stressBulletsRef.current;
            const stressPool = stressBulletPoolRef.current;
            while (stress.acc >= 1) {
              stress.acc -= 1;
              const sx = camera.x + Math.random() * viewWorldWidth;
              const sy = camera.y + Math.random() * viewWorldHeight;
              spawnMuzzleBurst(sx, sy);
              if (stressBullets.length >= MAX_BULLETS) break;
              const fromPool = stressPool.pop();
              const b = fromPool || {};
              const ang = Math.random() * Math.PI * 2;
              b.x = sx;
              b.y = sy;
              b.vx = Math.cos(ang) * (bulletSpeed * 1.2);
              b.vy = Math.sin(ang) * (bulletSpeed * 1.2);
              b.life = 0;
              b.maxLife = 1.2;
              stressBullets.push(b);
              if (!fromPool) {
                allocRef.current.bullets += 1;
              }
            }
            for (let i = stressBullets.length - 1; i >= 0; i--) {
              const b = stressBullets[i];
              b.life += dt;
              b.x += b.vx;
              b.y += b.vy;
              if (b.life >= b.maxLife) {
                const last = stressBullets.pop();
                if (i < stressBullets.length && last) {
                  stressBullets[i] = last;
                }
                stressPool.push(b);
              }
            }
          }
        }
        if (perfModeRef.current) {
          perfCountersRef.current.updateMs += performance.now() - updateStart;
        }
      }
      
      // === CAMERA UPDATE ===
      const viewportW = viewportRef.current.width;
      const viewportH = viewportRef.current.height;
      const isMobileLandscapeView = isTouchRef.current && viewportW > viewportH;
      const zoomOverride = cameraOverride?.active && Number.isFinite(cameraOverride?.zoom)
        ? clamp(cameraOverride.zoom, 0.68, 1.24)
        : 1;
      // Portrait mobile: zoom out to show more world (0.82x).
      // Landscape mobile: existing 0.88x reduction.
      const isMobilePortraitView = isTouchRef.current && viewportW <= viewportH;
      const baseZoom = isMobileLandscapeView
        ? ZOOM_LEVEL * 0.88
        : isMobilePortraitView
          ? ZOOM_LEVEL * 0.82
          : ZOOM_LEVEL;
      const effectiveZoom = baseZoom * zoomOverride;
      const viewWorldWidth = DESIGN_WIDTH / effectiveZoom;
      const viewWorldHeight = DESIGN_HEIGHT / effectiveZoom;
      const centerCamX = (worldWidth - viewWorldWidth) / 2;
      const centerCamY = (worldHeight - viewWorldHeight) / 2;
      const myInterp = interpolated.get(myPlayerId);
      if (movementDebugRef.current && myPlayer && myInterp) {
        const err = distance(myInterp.x, myInterp.y, myPlayer.x, myPlayer.y);
        movementDebugStateRef.current.error = err;
        movementDebugStateRef.current.snapshotTs = Number(myPlayer?._snapshotTs || 0);
        movementDebugStateRef.current.renderTs = renderTs;
        movementDebugStateRef.current.interpX = myInterp.x;
        movementDebugStateRef.current.interpY = myInterp.y;
        movementDebugStateRef.current.serverX = myPlayer.x;
        movementDebugStateRef.current.serverY = myPlayer.y;
        if (nowPerf - movementDebugStateRef.current.lastLogAt >= 1000) {
          movementDebugStateRef.current.lastLogAt = nowPerf;
          const lastInputSeqSent = typeof window !== 'undefined' ? Number(window.__FLAPPY_INPUT_SEQ_LAST_SENT__ || 0) : 0;
          const lastInputSeqAck = typeof window !== 'undefined' ? Number(window.__FLAPPY_INPUT_SEQ_LAST_ACK__ || 0) : 0;
          console.info('[MOVE DBG]', {
            predictedPos: { x: Number(myInterp.x.toFixed(2)), y: Number(myInterp.y.toFixed(2)) },
            serverPos: { x: Number(myPlayer.x.toFixed(2)), y: Number(myPlayer.y.toFixed(2)) },
            error: Number(err.toFixed(2)),
            lastInputSeqSent,
            lastAckSeq: lastInputSeqAck || null,
            snapshotTs: Number(myPlayer?._snapshotTs || 0) || null,
            localRenderTime: Number(nowPerf.toFixed(1)),
            authority: 'server_interpolation_only',
          });
        }
      }
      const overrideActive = !!cameraOverride?.active
        && Number.isFinite(cameraOverride?.x)
        && Number.isFinite(cameraOverride?.y);

      if (overrideActive) {
        const targetX = cameraOverride.x - viewWorldWidth / 2;
        const targetY = cameraOverride.y - viewWorldHeight / 2;
        const camLerp = Number.isFinite(cameraOverride?.lerp) ? clamp(cameraOverride.lerp, 0.04, 0.6) : 0.14;
        camera.x = lerp(camera.x, targetX, camLerp);
        camera.y = lerp(camera.y, targetY, camLerp);
      } else if (cameraMode === 'center') {
        camera.x = centerCamX;
        camera.y = centerCamY;
      } else if (cameraMode === 'spectate') {
        let targetId = spectateTargetRef.current;
        let target = targetId ? players.get(targetId) : null;
        if (!target || !target.alive) {
          const candidates = tmpSpectateCandidatesRef.current;
          candidates.length = 0;
          players.forEach((p) => {
            if (p.id !== myPlayerId && p.alive) candidates.push(p);
          });
          target = candidates[0] || null;
          spectateTargetRef.current = target?.id || null;
        }
        const targetInterp = target ? interpolated.get(target.id) || target : null;
        if (targetInterp) {
          const targetX = targetInterp.x - viewWorldWidth / 2;
          const targetY = targetInterp.y - viewWorldHeight / 2;
          camera.x = lerp(camera.x, targetX, CAMERA_LERP);
          camera.y = lerp(camera.y, targetY, CAMERA_LERP);
        } else {
          camera.x = centerCamX;
          camera.y = centerCamY;
        }
      } else if (myInterp) {
        const targetX = myInterp.x - viewWorldWidth / 2;
        const groundTopWorldY = worldHeight - Math.floor(worldHeight * GROUND_HEIGHT_RATIO);
        const groundY = groundTopWorldY - PLAYER_SIZE;
        const clampedTargetY = Math.min(myInterp.y, groundY);
        const targetY = clampedTargetY - viewWorldHeight / 2;
        camera.x = lerp(camera.x, targetX, CAMERA_LERP);
        const groundedByPos = (myPlayer?.y ?? myInterp.y ?? 0) >= groundY - 0.5;
        if (myPlayer?.onGround || groundedByPos) {
          camera.y = groundY - viewWorldHeight / 2;
          if (Math.abs(myPlayer.vy ?? 0) > 0.001) {
            console.error('Grounded but moving vertically', myPlayer.vy);
          }
          if (Math.abs(camera.y - (groundY - viewWorldHeight / 2)) > 0.5) {
            console.error('Camera drifting while grounded', camera.y, groundY);
          }
        } else {
          camera.y = lerp(camera.y, targetY, CAMERA_LERP);
        }
      }
      if (!Number.isFinite(camera.x) || !Number.isFinite(camera.y)) {
        if (import.meta.env.DEV) {
          console.warn('[game] non-finite camera reset', { x: camera.x, y: camera.y });
        }
        camera.x = centerCamX;
        camera.y = centerCamY;
      }
      
      // === RENDER ===
      const { width: viewWidth, height: viewHeight, dpr } = viewportRef.current;
      if (!Number.isFinite(viewWidth) || !Number.isFinite(viewHeight) || viewWidth <= 0 || viewHeight <= 0) {
        return;
      }
      if (!canvas.width || !canvas.height) {
        const backingW = Math.floor(viewWidth * dpr);
        const backingH = Math.floor(viewHeight * dpr);
        if (backingW > 0 && backingH > 0) {
          canvas.width = backingW;
          canvas.height = backingH;
          canvas.style.width = `${viewWidth}px`;
          canvas.style.height = `${viewHeight}px`;
        }
        return;
      }
      const isLandscape = viewWidth > viewHeight;
      const isMobile = isTouchRef.current;
      const isMobileLandscape = isMobile && isLandscape;
      const menuScale = isMobile
        ? Math.max(viewWidth / DESIGN_WIDTH, viewHeight / DESIGN_HEIGHT)
        : Math.min(viewWidth / DESIGN_WIDTH, viewHeight / DESIGN_HEIGHT);
      const menuOffsetX = Math.floor((viewWidth - DESIGN_WIDTH * menuScale) / 2);
      const menuOffsetY = Math.floor((viewHeight - DESIGN_HEIGHT * menuScale) / 2);

      setEnvironmentViewport({
        width: DESIGN_WIDTH,
        height: DESIGN_HEIGHT,
        viewLeft: 0,
        viewTop: 0,
      });

      // Screen-space reset for deterministic frame start.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, viewWidth, viewHeight);
      ctx.fillStyle = ENV_CONFIG.SKY_COLOR;
      ctx.fillRect(0, 0, viewWidth, viewHeight);

      // World-space: single camera transform for all world layers/entities.
      const worldScale = menuScale * effectiveZoom * dpr;
      if (!Number.isFinite(worldScale) || worldScale <= 0) {
        if (import.meta.env.DEV) {
          console.warn('[game] invalid worldScale, skipping frame', { worldScale, menuScale, dpr });
        }
        return;
      }
      const shake = viewShakeRef.current;
      let shakePxX = 0;
      let shakePxY = 0;
      if (shake.until > currentTime) {
        const remain = Math.max(0, (shake.until - currentTime) / SHOT_SHAKE_MS);
        const amp = shake.amp * remain;
        shakePxX = (Math.random() * 2 - 1) * amp;
        shakePxY = (Math.random() * 2 - 1) * amp;
        shake.x = shakePxX;
        shake.y = shakePxY;
      } else {
        shake.x = 0;
        shake.y = 0;
      }
      ctx.setTransform(
        worldScale,
        0,
        0,
        worldScale,
        menuOffsetX * dpr - camera.x * worldScale + shakePxX * dpr,
        menuOffsetY * dpr - camera.y * worldScale + shakePxY * dpr
      );
      ctx.imageSmoothingEnabled = false;

      const assets = getEnvironmentAssets();
      const clouds = cloudsRef.current;
      const groundImg = assets?.ground;
      const bkg1Img = assets?.sky;

      const camX = camera.x;
      const camY = camera.y;
      const viewTop = camY;
      const viewBottom = camY + viewWorldHeight;

      const margin = DEBUG_DISABLE_BORDER ? 0 : currentBorderMarginRef.current;
      const borderBottom = worldHeight;
      const groundHeightWorld = Math.floor(worldHeight * GROUND_HEIGHT_RATIO);
      const bkg1HeightWorld = Math.floor(groundHeightWorld * (BKG1_BASE_PX / GROUND_BASE_PX));
      const groundYWorld = borderBottom - groundHeightWorld;
      const bkg1YWorld = groundYWorld - bkg1HeightWorld;
      const clampY = (y) => (groundHeightWorld ? Math.min(y, groundYWorld) : y);

      if (groundHeightWorld > 0) {
        ctx.fillStyle = '#2c2319';
        const dirtTop = Math.max(groundYWorld, viewTop);
        if (dirtTop < viewBottom) {
          ctx.fillRect(camX, dirtTop, viewWorldWidth, viewBottom - dirtTop);
        }
      }

      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 0, 0.6)';
      ctx.lineWidth = 1 / ZOOM_LEVEL;
      ctx.beginPath();
      ctx.moveTo(0, groundYWorld);
      ctx.lineTo(worldWidth, groundYWorld);
      ctx.stroke();
      ctx.restore();

      const cloudSpawnMargin = Math.max(40, Math.floor(worldHeight * 0.02));
      const cloudBandTop = margin + cloudSpawnMargin;
      const cloudBandBottom = margin + Math.floor(worldHeight * 0.18);
      const cloudSpawnMinX = margin;
      const cloudSpawnMaxX = worldWidth - margin;
      if (assets?.cloudImgs?.length && !pausedRef.current) {
        for (const cloud of clouds) {
          cloud.x -= cloud.speed * (deltaTime / 1000);
        }
        const cloudDespawnPadding = Math.max(800, Math.floor(worldWidth * 0.12));
        const recycleX = margin - cloudDespawnPadding;
        const bandBottom = cloudBandBottom;
        let keepIndex = 0;
        for (let i = 0; i < cloudsRef.current.length; i++) {
          const cloud = cloudsRef.current[i];
          const keep =
            cloud.x + cloud.img.width * cloud.scale > recycleX &&
            cloud.y <= bandBottom &&
            cloud.y >= cloudBandTop;
          if (keep) {
            cloudsRef.current[keepIndex++] = cloud;
          }
        }
        cloudsRef.current.length = keepIndex;
        while (cloudsRef.current.length < GAMEPLAY_CLOUD_COUNT) {
          const img = assets.cloudImgs[Math.floor(Math.random() * assets.cloudImgs.length)];
          const scale =
            (ENV_CONFIG.CLOUD_SCALE_RANGE[0] + Math.random() * (ENV_CONFIG.CLOUD_SCALE_RANGE[1] - ENV_CONFIG.CLOUD_SCALE_RANGE[0])) *
            CLOUD_SCALE_FACTOR;
          const y = cloudBandTop + Math.random() * Math.max(1, cloudBandBottom - cloudBandTop);
          const speed =
            ENV_CONFIG.CLOUD_SPEED_RANGE[0] + Math.random() * (ENV_CONFIG.CLOUD_SPEED_RANGE[1] - ENV_CONFIG.CLOUD_SPEED_RANGE[0]);
          const spawnPad = Math.max(200, Math.floor(viewWorldWidth * 0.2));
          const desiredX = camX + viewWorldWidth + spawnPad + Math.random() * spawnPad;
          const x = Math.min(cloudSpawnMaxX, Math.max(cloudSpawnMinX, desiredX));
          cloudsRef.current.push({
            img,
            x,
            y,
            speed,
            scale,
          });
        }
      }

      for (const cloud of cloudsRef.current) {
        const w = Math.floor(cloud.img.width * cloud.scale);
        const h = Math.floor(cloud.img.height * cloud.scale);
        ctx.drawImage(
          cloud.img,
          Math.floor(cloud.x),
          Math.floor(cloud.y),
          Math.floor(w),
          Math.floor(h)
        );
      }

      if (bkg1Img && bkg1HeightWorld > 0) {
        const bkg1Scale = bkg1HeightWorld / bkg1Img.height;
        const tileWidth = bkg1Img.width * bkg1Scale;
        const scrollX = ((groundScrollRef.current % tileWidth) + tileWidth) % tileWidth;
        const drawStart = camX - tileWidth * 2;
        const drawEnd = camX + viewWorldWidth + tileWidth * 2;
        const firstTileX = Math.floor((drawStart + scrollX) / tileWidth) * tileWidth - scrollX;
        for (let x = firstTileX; x < drawEnd; x += tileWidth) {
          ctx.drawImage(
            bkg1Img,
            Math.floor(x),
            Math.floor(bkg1YWorld),
            Math.floor(tileWidth),
            Math.floor(bkg1HeightWorld)
          );
        }
      }

      if (groundImg && groundHeightWorld > 0) {
        const groundScale = groundHeightWorld / groundImg.height;
        const tileWidth = groundImg.width * groundScale;
        const scrollX = ((groundScrollRef.current % tileWidth) + tileWidth) % tileWidth;
        const drawStart = camX - tileWidth * 2;
        const drawEnd = camX + viewWorldWidth + tileWidth * 2;
        const firstTileX = Math.floor((drawStart + scrollX) / tileWidth) * tileWidth - scrollX;
        for (let x = firstTileX; x < drawEnd; x += tileWidth) {
          ctx.drawImage(
            groundImg,
            Math.floor(x),
            Math.floor(groundYWorld),
            Math.floor(tileWidth),
            Math.floor(groundHeightWorld)
          );
        }
      }
      
      if (debugRef.current) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.lineWidth = 1 / ZOOM_LEVEL;
        const gridSize = 100;
        const gridStartX = Math.floor(camera.x / gridSize) * gridSize;
        const gridStartY = Math.floor(camera.y / gridSize) * gridSize;
        const gridEndX = camera.x + viewWorldWidth + gridSize;
        const gridEndY = camera.y + viewWorldHeight + gridSize;
        for (let x = gridStartX; x < gridEndX; x += gridSize) {
          ctx.beginPath();
          ctx.moveTo(x, camera.y);
          ctx.lineTo(x, gridEndY);
          ctx.stroke();
        }
        for (let y = gridStartY; y < gridEndY; y += gridSize) {
          ctx.beginPath();
          ctx.moveTo(camera.x, y);
          ctx.lineTo(gridEndX, y);
          ctx.stroke();
        }
      }
      if (movementDebugRef.current && myPlayer && myInterp) {
        ctx.save();
        ctx.strokeStyle = 'rgba(0,255,255,0.85)';
        ctx.lineWidth = 2 / ZOOM_LEVEL;
        ctx.beginPath();
        ctx.moveTo(myInterp.x, clampY(myInterp.y));
        ctx.lineTo(myPlayer.x, clampY(myPlayer.y));
        ctx.stroke();
        ctx.fillStyle = '#00ff88';
        ctx.fillRect(myInterp.x - 6, clampY(myInterp.y) - 6, 12, 12);
        ctx.fillStyle = '#ff3b3b';
        ctx.fillRect(myPlayer.x - 5, clampY(myPlayer.y) - 5, 10, 10);
        ctx.restore();

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = 'rgba(0,0,0,0.68)';
        ctx.fillRect(8, 8, 420, 92);
        ctx.fillStyle = '#ffffff';
        ctx.font = '12px monospace';
        ctx.textBaseline = 'top';
        const dbg = movementDebugStateRef.current;
        const lastInputSeqSent = typeof window !== 'undefined' ? Number(window.__FLAPPY_INPUT_SEQ_LAST_SENT__ || 0) : 0;
        const lastInputSeqAck = typeof window !== 'undefined' ? Number(window.__FLAPPY_INPUT_SEQ_LAST_ACK__ || 0) : 0;
        ctx.fillText(`MOVE DBG (server-authoritative interpolation)`, 16, 16);
        ctx.fillText(`interp(${dbg.interpX.toFixed(1)}, ${dbg.interpY.toFixed(1)}) vs srv(${dbg.serverX.toFixed(1)}, ${dbg.serverY.toFixed(1)}) err=${dbg.error.toFixed(2)}`, 16, 34);
        ctx.fillText(`seq sent=${lastInputSeqSent} ack=${lastInputSeqAck || 0} snapshotTs=${dbg.snapshotTs || 0}`, 16, 52);
      }
      
      // Border
      const borderBottomDraw = worldHeight;
      if (!DEBUG_DISABLE_BORDER) {
        ctx.strokeStyle = 'rgba(255, 68, 68, 0.5)';
        ctx.lineWidth = 4 / ZOOM_LEVEL;
        ctx.setLineDash([20, 10]);
        ctx.strokeRect(margin, margin, worldWidth - 2 * margin, borderBottomDraw - margin);
        ctx.setLineDash([]);
      }
      
      // Danger zone
      if (!DEBUG_DISABLE_BORDER) {
        ctx.fillStyle = 'rgba(255, 0, 0, 0.08)';
        ctx.fillRect(0, 0, worldWidth, margin);
        ctx.fillRect(0, margin, margin, borderBottomDraw - margin);
        ctx.fillRect(worldWidth - margin, margin, margin, borderBottomDraw - margin);
      }
      
      const cullPad = isTouchRef.current ? 120 : 180;
      const worldCull = {
        left: camera.x - cullPad,
        top: camera.y - cullPad,
        right: camera.x + viewWorldWidth + cullPad,
        bottom: camera.y + viewWorldHeight + cullPad,
      };
      let drawnOrbs = 0;
      let drawnBullets = 0;
      let drawnPlayers = 0;
      const worldDrawStartMs = performance.now();
      const isWorldPointVisible = (x, y, radius = 0) =>
        x + radius >= worldCull.left &&
        x - radius <= worldCull.right &&
        y + radius >= worldCull.top &&
        y - radius <= worldCull.bottom;

      // Pipes
      drawFlappyPipes(ctx, pipes, worldCull);
      
      if (!skipBoostEffects) {
        // Boost particles (same path as desktop; only active while boosting)
        const maxBoostDraw = lowQuality ? MAX_PARTICLES_MOBILE : MAX_PARTICLES;
        let boostDrawn = 0;
        boostParticles.forEach((p) => {
          if (boostDrawn >= maxBoostDraw) return;
          boostDrawn += 1;
          ctx.globalAlpha = p.life * 0.6;
          ctx.fillStyle = '#00c8ff';
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
        });
        ctx.globalAlpha = 1;

      }

      if (!skipEffects) {
        // Muzzle bursts (behind birds)
        for (const p of muzzleParticlesRef.current) {
          const alpha = 1 - p.life / p.maxLife;
          ctx.globalAlpha = alpha;
          ctx.fillStyle = p.color;
          ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        }
        ctx.globalAlpha = 1;
      }
      
      // Orbs (bobbing)
      orbs.forEach((orb) => {
        if (!isWorldPointVisible(orb.x, orb.y, ORB_SIZE * 8)) return;
        drawnOrbs += 1;
        const rawSeed = Number(orb?.id);
        const seed = Number.isFinite(rawSeed)
          ? rawSeed
          : String(orb?.id || '').split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
        ctx.save();
        const bobOffset = Math.sin(currentTime / 300 + seed * 1.5) * 4;
        ctx.translate(orb.x, clampY(orb.y) + bobOffset);
        const tilt = Math.sin(currentTime / 300 + seed * 1.5) * 0.15;
        ctx.rotate(tilt);
        
        const featherSprite = sprites.feathers[orb.birdType || 'yellow'];
        if (featherSprite?.complete && featherSprite.naturalWidth > 0) {
          const baseScale = orb.birdType === 'red' ? 7.5 : 2.5;
          const realGameScale = 1;
          const size = ORB_SIZE * baseScale * realGameScale;
          ctx.drawImage(featherSprite, -size/2, -size/2, size, size);
        } else {
          ctx.fillStyle = '#ffd700';
          ctx.beginPath();
          ctx.arc(0, 0, ORB_SIZE, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      });

      // Bullets: single thin line only (no particles/trails)
      const bulletDrawStart = performance.now();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.lineCap = 'round';
      const bulletSource = useLocalBullets ? localBullets : bullets;
      const lineLen = 10;
      const maxBulletLines = isMobileLandscapeNow ? MAX_BULLETS_MOBILE_LS : (isTouchRef.current ? 50 : 200);
      let bulletDrawn = 0;
      ctx.beginPath();
      for (const bullet of bulletSource.values()) {
        if (bulletDrawn >= maxBulletLines) break;
        bulletDrawn += 1;
        const x = useLocalBullets ? bullet.localX : bullet.x;
        const y = useLocalBullets ? bullet.localY : bullet.y;
        if (!isWorldPointVisible(x, y, 24)) continue;
        drawnBullets += 1;
        const vx = bullet.vx ?? 1;
        const vy = bullet.vy ?? 0;
        const speed = Math.sqrt(vx * vx + vy * vy) || 1;
        const lx = x - (vx / speed) * lineLen;
        const ly = y - (vy / speed) * lineLen;
        ctx.moveTo(lx, clampY(ly));
        ctx.lineTo(x, clampY(y));
      }
      ctx.stroke();
      if (localTracersRef.current.length) {
        ctx.lineWidth = 4.62;
        for (const t of localTracersRef.current) {
          const maxLife = Math.max(0.001, t.maxLife || 0.12);
          const alpha = Math.max(0, Math.min(1, t.life / maxLife));
          ctx.strokeStyle = `rgba(255,255,255,${(0.15 + alpha * 0.7).toFixed(3)})`;
          ctx.beginPath();
          ctx.moveTo(t.x1, clampY(t.y1));
          ctx.lineTo(t.x2, clampY(t.y2));
          ctx.stroke();
        }
      }
      if (perfModeRef.current) {
        perfCountersRef.current.bulletDrawMs += performance.now() - bulletDrawStart;
      }

      // Boost trails (behind birds).
      if (!skipBoostEffects) {
        const trailMap = boostTrailRef.current;
        ctx.save();
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#43c6ff'; // avoid per-segment rgba template string
        const trailBaseWidth = isTouchRef.current ? 1.6 : 2.4;
        trailMap.forEach((list, id) => {
          if (!list || list.length < 2) return;
          const isMe = id === myPlayerId;
          const alphaMul = isMe ? 0.3 : 0.2;
          for (let i = 1; i < list.length; i += 1) {
            const a = list[i - 1];
            const b = list[i];
            ctx.globalAlpha = Math.max(0.04, b.life * alphaMul);
            ctx.lineWidth = trailBaseWidth + b.life * 1.2;
            ctx.beginPath();
            ctx.moveTo(a.x, clampY(a.y));
            ctx.lineTo(b.x, clampY(b.y));
            ctx.stroke();
          }
        });
        ctx.restore();
      }

      // Feather death burst particles.
      const featherVfx = featherVfxRef.current;
      if (featherVfx.length) {
        for (const p of featherVfx) {
          const t = 1 - (p.life / p.maxLife);
          ctx.save();
          ctx.translate(p.x, clampY(p.y));
          ctx.rotate(p.rot);
          ctx.globalAlpha = Math.max(0, t);
          const sprite = sprites.feathers[p.birdType || 'yellow'];
          if (sprite?.complete && sprite.naturalWidth > 0) {
            ctx.drawImage(sprite, -p.size / 2, -p.size / 2, p.size, p.size);
          } else {
            ctx.fillStyle = `rgba(255,255,255,${(0.35 + t * 0.35).toFixed(3)})`;
            ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
          }
          ctx.restore();
        }
      }
      
      // Range indicators (draw behind birds)
      players.forEach((player, id) => {
        if (!player.alive) return;
        if (id !== myPlayerId && isTouchRef.current) return;
        const interp = interpolated.get(id);
        if (!interp) return;
        if (!isWorldPointVisible(interp.x, interp.y, bulletRangeVisual + 40)) return;
        
        ctx.save();
        ctx.translate(interp.x, clampY(interp.y));
        
        // My range = white, enemy range = red
        const isMe = id === myPlayerId;
        ctx.strokeStyle = isMe ? 'rgba(255, 255, 255, 0.4)' : 'rgba(255, 80, 80, 0.35)';
        ctx.lineWidth = (isMe ? 2.5 : 2) / ZOOM_LEVEL;
        
      const segments = perfLow ? 16 : 32;
        const gapAngle = 0.08;
        
        for (let i = 0; i < segments; i++) {
          const startAngle = (i / segments) * Math.PI * 2 + gapAngle;
          const endAngle = ((i + 1) / segments) * Math.PI * 2 - gapAngle;
          
          ctx.beginPath();
          ctx.arc(0, 0, bulletRangeVisual, startAngle, endAngle);
          ctx.stroke();
        }
        ctx.restore();
      });
      
      const now = performance.now();
      // Players
      players.forEach((player, id) => {
        if (!player.alive) return;
        
        const interp = interpolated.get(id);
        if (!interp) return;
        
        const px = Number.isFinite(interp.x) ? interp.x : 0;
        const py = Number.isFinite(interp.y) ? interp.y : 0;
        if (!isWorldPointVisible(px, py, PLAYER_SIZE * BIRD_SCALE * 1.2)) return;
        drawnPlayers += 1;
        const baseAngle = normalizeAngle(interp.angle);

        // Keep sprite upright: when aiming left, mirror on X and subtract PI from the render rotation.
        // This keeps the bird facing left without going upside down.
        const aimingLeft = Math.cos(baseAngle) < 0;
        const renderAngle = aimingLeft ? normalizeAngle(baseAngle - Math.PI) : baseAngle;
        const flipState = playerFlips.get(id);
        const flipX = flipState ? flipState.current : 1;

        ctx.save();
        ctx.translate(px, clampY(py));
        ctx.rotate(renderAngle);
        ctx.scale(flipX, 1);
        
        const isMe = id === myPlayerId;
        const localBoostVisualActive = isMe && isTouchRef.current && input.boosting;
        if ((player.boosting || localBoostVisualActive) && !player.boostDepleted && !(effectsKillRef.current > currentTime)) {
          ctx.shadowColor = '#00c8ff';
          ctx.shadowBlur = 20;
        }
        
        const birdType = player.birdType || 'yellow';
        const birdSprites = sprites.birds[birdType];
        const isShooting = (id === myPlayerId) ? input.shooting : !!player.shooting;
        const useFireFrames = isShooting;
        const frameSet = useFireFrames ? birdSprites?.fire : birdSprites?.fly;
        const sprite = frameSet?.[animFrame];
        
        if (sprite?.complete && sprite.naturalWidth > 0) {
          const size = PLAYER_SIZE * BIRD_SCALE;
          ctx.drawImage(sprite, -size/2, -size/2, size, size);
        } else {
          if (import.meta.env.DEV) {
            const key = `${birdType}:${animFrame}`;
            if (!spriteWarnedRef.current.has(key)) {
              spriteWarnedRef.current.add(key);
              console.warn('[game] sprite missing, using fallback', {
                birdType,
                animFrame,
                complete: !!sprite?.complete,
                naturalWidth: sprite?.naturalWidth,
                src: sprite?.src,
              });
            }
          }
          const size = PLAYER_SIZE * BIRD_SCALE;
          ctx.fillStyle = id === myPlayerId ? '#00ff88' : '#ff6666';
          ctx.fillRect(-size / 2, -size / 2, size, size);
        }



        const hitAt = player.hitAt;
        const size = PLAYER_SIZE * BIRD_SCALE;
        if (hitAt && now - hitAt < 140) {
          const tFlash = 1 - (now - hitAt) / 140;
          ctx.save();
          ctx.globalCompositeOperation = 'source-atop';
          ctx.globalAlpha = 0.5 + tFlash * 0.45;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(-size / 2, -size / 2, size, size);
          ctx.restore();
        }
        if (hitAt && now - hitAt < 300 && !(isIOSRef.current || effectsKillRef.current > currentTime)) {
          const t = 1 - (now - hitAt) / 300;
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.2 + t * 0.5;
          ctx.fillStyle = 'rgba(255,255,255,1)';
          ctx.beginPath();
          ctx.arc(0, 0, PLAYER_SIZE * 0.9, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 0.35 + t * 0.35;
          ctx.strokeStyle = 'rgba(255,255,255,1)';
          ctx.lineWidth = 2 / ZOOM_LEVEL;
          ctx.beginPath();
          ctx.arc(0, 0, PLAYER_SIZE * 1.05, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
        
        ctx.shadowBlur = 0;
        ctx.restore();
      });

      // === WORLD SPACE EFFECTS (death explosions) ===
      // Keep these visible long enough to notice, and don't rely on pause state.
      {
        const now = performance.now();
        const life = 900; // ms
        const explosions = deathExplosionsRef.current;
        for (let i = explosions.length - 1; i >= 0; i -= 1) {
          if (now - explosions[i].createdAt >= life) {
            const last = explosions.pop();
            if (i < explosions.length && last) explosions[i] = last;
          }
        }
      }

      // Draw explosions in the same transform as the main scene.
      const now2 = performance.now();
      const life2 = 900;
      if (!skipEffects) {
        deathExplosionsRef.current.forEach(ex => {
          if (!isWorldPointVisible(ex.x, ex.y, 220)) return;
          const t = Math.min(1, (now2 - ex.createdAt) / life2);
          const r = (14 + t * 42) * 4;
          const alpha = 1 - t;
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.fillStyle = 'rgba(255,255,255,1)';
          // Minecraft-ish "cs" puff: square particles
          const count = 12;
          for (let i = 0; i < count; i++) {
            const ang = (i / count) * Math.PI * 2;
            const px2 = ex.x + Math.cos(ang) * r * (0.7 + (i % 3) * 0.12);
            const py2 = clampY(ex.y + Math.sin(ang) * r * (0.7 + ((i + 1) % 3) * 0.12));
            const s = (4 + (1 - t) * 6) * 4;
            ctx.fillRect(px2 - s / 2, py2 - s / 2, s, s);
          }
          // Center flash
          const s2 = 12 * (1 - t) * 4;
          ctx.fillRect(ex.x - s2 / 2, clampY(ex.y) - s2 / 2, s2, s2);
          ctx.restore();
        });
      }
      
      if (debugRef.current) {
        ctx.save();
        if (!DEBUG_DISABLE_BORDER) {
          ctx.strokeStyle = 'rgba(255, 80, 80, 0.9)';
          ctx.lineWidth = 2 / ZOOM_LEVEL;
          ctx.strokeRect(margin, margin, worldWidth - 2 * margin, borderBottomDraw - margin);
        }
        ctx.strokeStyle = 'rgba(0, 255, 255, 0.8)';
        ctx.lineWidth = 2 / ZOOM_LEVEL;
        ctx.strokeRect(camX, camY, viewWorldWidth, viewWorldHeight);
        ctx.strokeStyle = 'rgba(255, 255, 0, 0.9)';
        ctx.beginPath();
        ctx.moveTo(camX, groundYWorld);
        ctx.lineTo(camX + viewWorldWidth, groundYWorld);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(0, 255, 0, 0.8)';
        ctx.strokeRect(camX, groundYWorld, viewWorldWidth, groundHeightWorld);
        ctx.strokeStyle = 'rgba(255, 0, 255, 0.8)';
        ctx.strokeRect(camX, bkg1YWorld, viewWorldWidth, bkg1HeightWorld);
        if (myInterp) {
          const size = PLAYER_SIZE * 2;
          ctx.strokeStyle = 'rgba(0, 200, 255, 0.9)';
          ctx.strokeRect(myInterp.x - size / 2, clampY(myInterp.y) - size / 2, size, size);
        }
        ctx.strokeStyle = 'rgba(255, 160, 0, 0.9)';
        ctx.strokeRect(
          cloudSpawnMinX,
          cloudBandTop,
          Math.max(0, cloudSpawnMaxX - cloudSpawnMinX),
          Math.max(0, cloudBandBottom - cloudBandTop)
        );
        ctx.restore();

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
        const debugHeight = myPlayer ? 206 : 170;
        ctx.fillRect(8, 8, 390, debugHeight);
        ctx.fillStyle = '#ffffff';
        ctx.font = '12px monospace';
        ctx.textBaseline = 'top';
        const fpsValue = fpsRef.current.value || 0;
        const perf = perfRef.current;
        const maxWindow = perf.samples.reduce((acc, s) => Math.max(acc, s.ms), 0);
        const alloc = allocRef.current;
        ctx.fillText(`fps: ${fpsValue}`, 16, 16);
        ctx.fillText(`ms avg: ${perf.avgMs.toFixed(1)} max: ${maxWindow.toFixed(1)}`, 16, 32);
        const stressCount = stressBulletsRef.current.length;
        const bulletCount = useLocalBullets ? localBullets.size + stressCount : bullets.size + stressCount;
        ctx.fillText(`bullets: ${bulletCount} trails: ${alloc.trails}`, 16, 48);
        ctx.fillText(`particles: ${muzzleParticlesRef.current.length + boostParticlesRef.current.length}`, 16, 64);
        ctx.fillText(`impacts: ${deathExplosionsRef.current.length}`, 16, 80);
        ctx.fillText(`alloc/s bullets: ${alloc.bullets} particles: ${alloc.particles} trails: ${alloc.trails}`, 16, 96);
        ctx.fillText(`world: ${worldWidth} x ${worldHeight}`, 16, 112);
        ctx.fillText(`groundH: ${groundHeightWorld} | bkg1H: ${bkg1HeightWorld}`, 16, 128);
        ctx.fillText(`scrollX: ${groundScrollRef.current.toFixed(2)}`, 16, 144);
        if (myPlayer) {
          const playerBottom = myPlayer.y + PLAYER_SIZE;
          ctx.fillText(`player.y: ${myPlayer.y.toFixed(2)} vy: ${(myPlayer.vy ?? 0).toFixed(2)}`, 16, 160);
          ctx.fillText(`onGround: ${!!myPlayer.onGround} bottom: ${playerBottom.toFixed(2)}`, 16, 176);
        }
      }

      const worldDrawMs = performance.now() - worldDrawStartMs;

      // === SCREEN SPACE HUD ===
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      const hudDrawStartMs = performance.now();
      if (showHud || interactive) {
        const hudScale = isMobile ? 1 : menuScale;
        const hudOffsetX = isMobile ? 0 : menuOffsetX;
        const hudOffsetY = isMobile ? 0 : menuOffsetY;
        const hudW = isMobile ? viewWidth : DESIGN_WIDTH;
        const hudH = isMobile ? viewHeight : DESIGN_HEIGHT;
        ctx.setTransform(
          hudScale * dpr,
          0,
          0,
          hudScale * dpr,
          hudOffsetX * dpr,
          hudOffsetY * dpr
        );
        ctx.imageSmoothingEnabled = true;


        const hudState = hudStateRef.current;
        const activeIds = new Set();

      players.forEach((player, id) => {
        if (!player.alive) return;
        const interp = interpolated.get(id);
        if (!interp) return;
        activeIds.add(id);

        const worldToHudScale = isMobile ? menuScale : 1;
        const worldToHudOffsetX = isMobile ? menuOffsetX : 0;
        const worldToHudOffsetY = isMobile ? menuOffsetY : 0;
        const screenX = worldToHudOffsetX + (interp.x - camera.x) * effectiveZoom * worldToHudScale;
        const screenY = worldToHudOffsetY + (clampY(interp.y) - camera.y) * effectiveZoom * worldToHudScale;
        if (
          screenX < -90 || screenX > hudW + 90 ||
          screenY < -90 || screenY > hudH + 90
        ) {
          return;
        }
        const labelY = screenY - PLAYER_SIZE * BIRD_SCALE * effectiveZoom * worldToHudScale * 0.62;

        if (player.cashingOut) {
          const w = 64;
          const h = 7;
          const pct = typeof player.cashoutPct === 'number'
            ? Math.max(0, Math.min(1, player.cashoutPct))
            : 0;
          const barY = labelY - 36;
          ctx.fillStyle = 'rgba(0,0,0,0.65)';
          fillRoundedRect(ctx, screenX - w / 2, barY, w, h, 3);
          ctx.fillStyle = HUD_COLORS.green;
          fillRoundedRect(ctx, screenX - w / 2, barY, w * pct, h, 3);
          ctx.strokeStyle = 'rgba(255,255,255,0.35)';
          ctx.lineWidth = 1;
          strokeRoundedRect(ctx, screenX - w / 2, barY, w, h, 3);
        }

        const value = `$${formatUsd(player.balance || 0)}`;
        ctx.font = `700 12px ${HUD_FONT}`;
        const textWidth = ctx.measureText(value).width;
        const padX = 10;
        const padY = 6;
        const tagW = Math.max(46, textWidth + padX * 2);
        const tagH = 22;
        const tagX = screenX - tagW / 2;
        const tagY = labelY - tagH / 2;

        const prev = hudState.moneyTags.get(id);
        const smoothX = prev ? lerp(prev.x, tagX, 0.2) : tagX;
        const smoothY = prev ? lerp(prev.y, tagY, 0.2) : tagY;
        hudState.moneyTags.set(id, { x: smoothX, y: smoothY });

        ctx.fillStyle = '#121212';
        fillRoundedRect(ctx, smoothX, smoothY, tagW, tagH, tagH / 2);
        ctx.strokeStyle = HUD_COLORS.yellowEdge;
        ctx.lineWidth = 1.2;
        strokeRoundedRect(ctx, smoothX, smoothY, tagW, tagH, tagH / 2);
        ctx.fillStyle = HUD_COLORS.green;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(value, smoothX + tagW / 2, smoothY + tagH / 2 + 0.5);
      });

      hudState.moneyTags.forEach((_, id) => {
        if (!activeIds.has(id)) hudState.moneyTags.delete(id);
      });

      const safeInsets = safeInsetsRef.current;
      const hudMarginX = 16 + (safeInsets.left || 0);
      const hudMarginY = 16 + (safeInsets.top || 0);
      const hudMarginRight = 16 + (safeInsets.right || 0);
      const hudMarginBottom = 16 + (safeInsets.bottom || 0);
      const isMobilePortraitHud = isTouchRef.current && !isMobileLandscape;
      const useCircularRadar = true;
      // Viewport-proportional HUD clamping: normalise to iPhone 13 Pro Max (428px min dim)
      // so smaller phones (e.g. iPhone 11 Pro, 375px) keep the same visual ratio.
      const HUD_REF_MIN_DIM = 428;
      const hudViewportScale = isMobile ? Math.min(1, Math.min(hudW, hudH) / HUD_REF_MIN_DIM) : 1;
      const radarPanelScale = (isMobileLandscape ? 0.62 : (isMobilePortraitHud ? 0.72 : (isTouchRef.current ? 0.85 : 1))) * hudViewportScale;
      const leaderboardPanelScale = (isMobileLandscape ? 0.52 : (isMobilePortraitHud ? 0.58 : (isTouchRef.current ? 0.72 : 1))) * hudViewportScale;
      const radarSize = Math.round(190 * radarPanelScale);
      const leaderboardW = Math.round(260 * leaderboardPanelScale);
      const leaderboardH = Math.round((isMobilePortraitHud ? 248 : 286) * leaderboardPanelScale);
      const leaderboardRect = {
        x: hudW - hudMarginRight - leaderboardW,
        y: hudMarginY,
        w: leaderboardW,
        h: leaderboardH,
        r: 10,
      };
      const radarRect = {
        x: hudMarginX,
        y: hudMarginY,
        w: radarSize,
        h: radarSize,
        r: 10,
      };
      const cashoutRect = isMobileLandscape
        ? {
            x: (hudW - 230) / 2,
            y: hudH - hudMarginBottom - 54,
            w: 230,
            h: 54,
            r: 10,
          }
        : isMobilePortraitHud
          ? {
              x: (hudW - 230) / 2,
              y: hudH - hudMarginBottom - 52,
              w: 230,
              h: 50,
              r: 10,
            }
          : {
              x: (hudW - 210) / 2,
              y: hudH - 16 - 52,
              w: 210,
              h: 52,
              r: 10,
            };
      const statusRectBase = {
        x: cashoutRect.x - 20,
        y: isMobilePortraitHud ? cashoutRect.y - 64 : cashoutRect.y - 70,
        w: cashoutRect.w + 40,
        h: 56,
        r: 12,
      };

      const cashoutScreenX = hudOffsetX + cashoutRect.x * hudScale;
      const cashoutScreenY = hudOffsetY + cashoutRect.y * hudScale;
      const cashoutScreenW = cashoutRect.w * hudScale;
      const cashoutScreenH = cashoutRect.h * hudScale;
      if (!demoCashoutEnabled) {
        hudState.cashoutHover = false;
        hudState.cashoutPressed = false;
      } else if (isTouchRef.current) {
        hudState.cashoutHover = false;
        hudState.cashoutPressed = false;
      } else {
        const mouseX = inputRef.current.mouseX;
        const mouseY = inputRef.current.mouseY;
        hudState.cashoutHover =
          mouseX >= cashoutScreenX &&
          mouseX <= cashoutScreenX + cashoutScreenW &&
          mouseY >= cashoutScreenY &&
          mouseY <= cashoutScreenY + cashoutScreenH;
        hudState.cashoutPressed = inputRef.current.cashoutPointer;
      }

      drawHudPanel(ctx, leaderboardRect);
      ctx.fillStyle = HUD_COLORS.textWhite;
      ctx.font = `700 14px ${HUD_FONT}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText('LEADERBOARD', leaderboardRect.x + 14, leaderboardRect.y + 22);
      ctx.fillStyle = HUD_COLORS.panelEdge;
      ctx.fillRect(leaderboardRect.x + 12, leaderboardRect.y + 34, leaderboardRect.w - 24, 1);

      const sessionRows = sessionLeaderboardRowsRef.current;
      const hasSessionLeaderboardRows = Array.isArray(sessionRows) && sessionRows.length;
      let leaderboardDisplay = sessionRows;
      if (!hasSessionLeaderboardRows) {
        // Bots are now server-side players, so they're included in players.values()
        const fallbackRows = tmpLeaderboardRef.current;
        fallbackRows.length = 0;
        players.forEach((player) => {
          if (!player.joined) return;
          const username = String(player.name || '').trim();
          if (!username) return;
          fallbackRows.push({
            id: player.id,
            username,
            total_profit: player.balance || 0,
            isSelf: player.id === myPlayerId,
          });
        });
        fallbackRows.sort((a, b) => {
          const diff = (b.total_profit || 0) - (a.total_profit || 0);
          if (Math.abs(diff) > 1e-9) return diff;
          return String(a.id || '').localeCompare(String(b.id || ''));
        });
        leaderboardDisplay = fallbackRows;
      }

      const rowStartY = leaderboardRect.y + 48;
      const rowHeight = isMobilePortraitHud ? 17 : 20;
      const maxRows = leaderboardDisplay.length > 10 ? 11 : 10;
      const rowCount = Math.min(maxRows, leaderboardDisplay.length);
      const amountRightX = leaderboardRect.x + leaderboardRect.w - 14;
      const usernameStartX = leaderboardRect.x + 40;
      const truncateToWidth = (value, maxWidth) => {
        const raw = String(value || '');
        if (!raw) return 'Player';
        if (ctx.measureText(raw).width <= maxWidth) return raw;
        const ellipsis = '...';
        let out = raw;
        while (out.length > 1 && ctx.measureText(`${out}${ellipsis}`).width > maxWidth) {
          out = out.slice(0, -1);
        }
        return `${out}${ellipsis}`;
      };
      for (let index = 0; index < rowCount; index += 1) {
        const row = leaderboardDisplay[index];
        const rowY = rowStartY + index * rowHeight;
        const isSelf = row.isSelf;
        if (isSelf) {
          ctx.fillStyle = '#2a2414';
          fillRoundedRect(ctx, leaderboardRect.x + 8, rowY - 8, leaderboardRect.w - 16, 18, 6);
          ctx.strokeStyle = HUD_COLORS.yellowEdge;
          ctx.lineWidth = 1;
          strokeRoundedRect(ctx, leaderboardRect.x + 8, rowY - 8, leaderboardRect.w - 16, 18, 6);
        }
        const rank = row.rank || index + 1;
        ctx.fillStyle = HUD_COLORS.textMuted;
        ctx.font = `600 ${isMobilePortraitHud ? 11 : 12}px ${HUD_FONT}`;
        ctx.textAlign = 'left';
        ctx.fillText(`${rank}.`, leaderboardRect.x + 14, rowY + 6);
        const amount = Number(row.balance ?? row.total_profit ?? 0);
        const amountText = `$${formatUsd(amount)}`;
        ctx.fillStyle = HUD_COLORS.green;
        ctx.textAlign = 'right';
        ctx.fillText(amountText, amountRightX, rowY + 6);
        const amountWidth = ctx.measureText(amountText).width;
        const usernameMaxW = Math.max(40, (amountRightX - amountWidth - 12) - usernameStartX);
        ctx.fillStyle = HUD_COLORS.textWhite;
        ctx.textAlign = 'left';
        const usernameText = truncateToWidth(row.username || 'Player', usernameMaxW);
        ctx.fillText(usernameText, usernameStartX, rowY + 6);
      }

      ctx.fillStyle = HUD_COLORS.textMuted;
      ctx.textAlign = 'center';
      ctx.font = `600 11px ${HUD_FONT}`;
      ctx.fillText(
        `${players.size} players online`,
        leaderboardRect.x + leaderboardRect.w / 2,
        leaderboardRect.y + leaderboardRect.h - 10
      );

      if (!useCircularRadar) {
        drawHudPanel(ctx, radarRect);
      } else {
        const cx = radarRect.x + radarRect.w / 2;
        const cy = radarRect.y + radarRect.h / 2;
        const r = radarRect.w / 2;
        const grad = ctx.createRadialGradient(cx, cy - r * 0.32, r * 0.25, cx, cy, r);
        grad.addColorStop(0, '#1a1a1a');
        grad.addColorStop(1, '#0e0e0e');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = HUD_COLORS.panelEdge;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, r - 1, 0, Math.PI * 2);
        ctx.stroke();
      }
      const mapLabelY = useCircularRadar ? (radarRect.y + 16) : (radarRect.y + 18);
      ctx.fillStyle = HUD_COLORS.textWhite;
      ctx.font = `700 12px ${HUD_FONT}`;
      ctx.textAlign = useCircularRadar ? 'center' : 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(useCircularRadar ? 'RADAR' : 'MAP', useCircularRadar ? (radarRect.x + radarRect.w / 2) : (radarRect.x + 14), mapLabelY);

      const mapPadding = useCircularRadar ? 10 : 12;
      const mapTop = useCircularRadar ? (radarRect.y + 22) : (radarRect.y + 28);
      const mapAvailW = radarRect.w - mapPadding * 2;
      const mapAvailH = radarRect.h - (mapTop - radarRect.y) - mapPadding;
      const mapSize = Math.max(0, Math.min(mapAvailW, mapAvailH));
      const mapRect = {
        x: radarRect.x + (radarRect.w - mapSize) / 2,
        y: mapTop + (mapAvailH - mapSize) / 2,
        w: mapSize,
        h: mapSize,
        r: 8,
      };

      ctx.save();
      if (useCircularRadar) {
        const mapCx = mapRect.x + mapRect.w / 2;
        const mapCy = mapRect.y + mapRect.h / 2;
        const mapR = mapRect.w / 2;
        ctx.fillStyle = '#0b0b0b';
        ctx.beginPath();
        ctx.arc(mapCx, mapCy, mapR, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = HUD_COLORS.radarRing;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(mapCx, mapCy, mapR - 1, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = HUD_COLORS.radarRingInner;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(mapCx, mapCy, Math.max(1, mapR - 5), 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(mapCx, mapCy, Math.max(1, mapR - 2), 0, Math.PI * 2);
        ctx.clip();
      } else {
        ctx.fillStyle = '#0b0b0b';
        fillRoundedRect(ctx, mapRect.x, mapRect.y, mapRect.w, mapRect.h, mapRect.r);
        ctx.strokeStyle = HUD_COLORS.radarRing;
        ctx.lineWidth = 2;
        strokeRoundedRect(ctx, mapRect.x, mapRect.y, mapRect.w, mapRect.h, mapRect.r);
        ctx.strokeStyle = HUD_COLORS.radarRingInner;
        ctx.lineWidth = 1;
        strokeRoundedRect(ctx, mapRect.x + 4, mapRect.y + 4, mapRect.w - 8, mapRect.h - 8, mapRect.r - 2);
      }

      const safeWorldWidth = Math.max(1, worldWidth);
      const safeWorldHeight = Math.max(1, worldHeight);
      const worldToMapScale = Math.min(mapRect.w / safeWorldWidth, mapRect.h / safeWorldHeight);
      const radarWorldRect = {
        x: mapRect.x + (mapRect.w - safeWorldWidth * worldToMapScale) / 2,
        y: mapRect.y + (mapRect.h - safeWorldHeight * worldToMapScale) / 2,
        w: safeWorldWidth * worldToMapScale,
        h: safeWorldHeight * worldToMapScale,
      };
      const mapMargin = DEBUG_DISABLE_BORDER ? 0 : currentBorderMarginRef.current;
      const borderW = Math.max(0, safeWorldWidth - 2 * mapMargin);
      const borderBottom = clamp(borderBottomDraw, 0, safeWorldHeight);
      const borderH = Math.max(0, borderBottom - mapMargin);
      const borderX = radarWorldRect.x + mapMargin * worldToMapScale;
      const borderY = radarWorldRect.y + mapMargin * worldToMapScale;
      ctx.strokeStyle = 'rgba(255, 68, 68, 0.7)';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(borderX, borderY, borderW * worldToMapScale, borderH * worldToMapScale);

      if (pipes?.length) {
        ctx.fillStyle = 'rgba(115, 191, 46, 0.75)';
        pipes.forEach((pipe) => {
          const px = radarWorldRect.x + pipe.x * worldToMapScale;
          const py = radarWorldRect.y + pipe.y * worldToMapScale;
          const pw = Math.max(1, pipe.width * worldToMapScale);
          const ph = Math.max(1, pipe.height * worldToMapScale);
          ctx.fillRect(px, py, pw, ph);
        });
      }

      const activeRadarIds = new Set();
      players.forEach((player, id) => {
        if (!player.alive) return;
        const clampedX = clamp(player.x, 0, safeWorldWidth);
        const clampedY = clamp(player.y, 0, safeWorldHeight);
        const targetX = radarWorldRect.x + clampedX * worldToMapScale;
        const targetY = radarWorldRect.y + clampedY * worldToMapScale;
        const prev = hudState.radarDots.get(id);
        const smoothX = prev ? lerp(prev.x, targetX, 0.25) : targetX;
        const smoothY = prev ? lerp(prev.y, targetY, 0.25) : targetY;
        hudState.radarDots.set(id, { x: smoothX, y: smoothY });
        // Bots show as pink, own player yellow, others white
        const isMe = id === myPlayerId;
        const isBot = player.isBot;
        ctx.fillStyle = isMe ? HUD_COLORS.yellow : isBot ? '#ff9aa2' : '#d8e3ff';
        ctx.beginPath();
        ctx.arc(smoothX, smoothY, isMe ? 2.6 : 2, 0, Math.PI * 2);
        ctx.fill();
        activeRadarIds.add(id);
      });
      hudState.radarDots.forEach((_, id) => {
        if (!activeRadarIds.has(id)) hudState.radarDots.delete(id);
      });
      ctx.restore();

      const myHealth = myPlayer ? myPlayer.health ?? 0 : 0;
      const maxHealth = 100;
      const boostMax = config?.boostMax || 100;
      const myBoost = myPlayer ? myPlayer.boost ?? 0 : 0;
      const healthPct = clamp(myHealth / maxHealth, 0, 1);
      const boostPct = clamp(myBoost / boostMax, 0, 1);
      const boostActive = myPlayer?.boosting && !myPlayer?.boostDepleted;
      const boostDepleted = myPlayer?.boostDepleted;

      const barInsetX = 12;
      const barInsetY = 18;
      const barGap = 16;
      const barHeight = 10;
      const topBarMaxRight = leaderboardRect.x - 12;
      const topBarMaxLeft = radarRect.x + radarRect.w + 12;
      const topBarW = Math.max(140, Math.min(320, topBarMaxRight - topBarMaxLeft));
      const topBarX = topBarMaxLeft + Math.max(0, (topBarMaxRight - topBarMaxLeft - topBarW) / 2);
      const topBarY = hudMarginY + 4;
      const statusRect = isMobileLandscape
        ? { x: topBarX, y: topBarY, w: topBarW, h: 44, r: 10 }
        : statusRectBase;

      if (!isMobileLandscape) {
        drawHudPanel(ctx, statusRect);
      }
      const barWidth = statusRect.w - barInsetX * 2;
      const healthBarRect = {
        x: statusRect.x + barInsetX,
        y: statusRect.y + barInsetY,
        w: barWidth,
        h: barHeight,
        r: 6,
      };
      const boostBarRect = {
        x: statusRect.x + barInsetX,
        y: statusRect.y + barInsetY + barGap,
        w: barWidth,
        h: barHeight,
        r: 6,
      };

      drawHudBar(ctx, healthBarRect, healthPct, {
        fill: HUD_COLORS.healthFill,
        label: 'HEALTH',
        value: `${Math.round(myHealth)}`,
      });

      drawHudBar(ctx, boostBarRect, boostPct, {
        fill: boostDepleted ? '#ff6b6b' : boostActive ? HUD_COLORS.boostFill : HUD_COLORS.boostFillDim,
        glow: boostActive ? 'rgba(67, 198, 255, 0.6)' : null,
        label: 'BOOST',
        value: `${Math.round(myBoost)}`,
      });

      const myPlayerBalance = myPlayer ? myPlayer.balance || 0 : 0;
      if (!isTouchRef.current && demoCashoutEnabled) {
        drawHudButton(
          ctx,
          cashoutRect,
          `CASH OUT $${formatUsd(myPlayerBalance)}`,
          { hover: hudState.cashoutHover, pressed: hudState.cashoutPressed }
        );
      }
      // Pause overlay
      }

      const hudDrawMs = performance.now() - hudDrawStartMs;

      // === PERF OVERLAY (enabled via ?perf=1) ===
      if (perfModeRef.current) {
        const frameMs = performance.now() - frameStart;
        const ring = perfRingRef.current;
        const drawIdx = perfRingIdxRef.current % PERF_RING_SIZE;
        ring[drawIdx] = frameMs;
        perfRingIdxRef.current += 1;
        if (lastRafTsRef.current > 0) {
          const rafDt = currentTime - lastRafTsRef.current;
          const rafRing = rafRingRef.current;
          const rafIdx = rafRingIdxRef.current % PERF_RING_SIZE;
          rafRing[rafIdx] = rafDt;
          rafRingIdxRef.current += 1;
          if (typeof window !== 'undefined' && Array.isArray(window.__FLAPPY_STUTTER_TRACE__)) {
            window.__FLAPPY_STUTTER_TRACE__.push({
              t: currentTime,
              kind: 'frame',
              rafDt: Number(rafDt.toFixed(3)),
              drawMs: Number(frameMs.toFixed(3)),
            });
            while (window.__FLAPPY_STUTTER_TRACE__.length > 800) {
              window.__FLAPPY_STUTTER_TRACE__.shift();
            }
          }
        }
        lastRafTsRef.current = currentTime;

        const po = perfOverlayRef.current;
        if (frameMs > 33) po.longFrames33 += 1;
        if (frameMs > 50) po.longFrames50 += 1;

        // Update overlay snapshot at ~4Hz
        if (currentTime - po.lastUpdate >= 250) {
          po.lastUpdate = currentTime;
          const drawFilled = Math.min(perfRingIdxRef.current, PERF_RING_SIZE);
          let drawSum = 0;
          const drawSorted = [];
          for (let si = 0; si < drawFilled; si++) {
            drawSum += ring[si];
            drawSorted.push(ring[si]);
          }
          drawSorted.sort((sa, sb) => sa - sb);
          po.drawAvgMs = drawFilled ? drawSum / drawFilled : 0;
          po.drawP95Ms = drawFilled ? drawSorted[Math.floor(drawFilled * 0.95)] : 0;

          const rafRing = rafRingRef.current;
          const rafFilled = Math.min(rafRingIdxRef.current, PERF_RING_SIZE);
          let rafSum = 0;
          const rafSorted = [];
          for (let si = 0; si < rafFilled; si++) {
            rafSum += rafRing[si];
            rafSorted.push(rafRing[si]);
          }
          rafSorted.sort((a, b) => a - b);
          po.avgMs = rafFilled ? rafSum / rafFilled : 0;
          po.p95Ms = rafFilled ? rafSorted[Math.floor(rafFilled * 0.95)] : 0;
          if (rafFilled) {
            const mean = po.avgMs;
            const variance = rafRing
              .slice(0, rafFilled)
              .reduce((sum, value) => sum + ((value - mean) ** 2), 0) / rafFilled;
            po.rafJitterMs = Math.sqrt(Math.max(0, variance));
          } else {
            po.rafJitterMs = 0;
          }
          po.fps = po.avgMs > 0 ? Math.round(1000 / po.avgMs) : 0;
          po.players = players.size;
          po.bullets = bulletSource.size;
          po.orbsDrawn = drawnOrbs;
          po.bulletsDrawn = drawnBullets;
          po.playersDrawn = drawnPlayers;
          po.particles = boostParticlesRef.current.length + muzzleParticlesRef.current.length + featherVfxRef.current.length;
          po.worldDrawAvgMs = po.worldDrawAvgMs === 0 ? worldDrawMs : (po.worldDrawAvgMs * 0.8 + worldDrawMs * 0.2);
          po.hudDrawAvgMs = po.hudDrawAvgMs === 0 ? hudDrawMs : (po.hudDrawAvgMs * 0.8 + hudDrawMs * 0.2);
          po.domWrites = domWriteCounterRef.current;
          po.loopRestarts = renderLoopRestartsRef.current;
          po.allocPerSec = allocRef.current.bullets + allocRef.current.particles + allocRef.current.trails;
          domWriteCounterRef.current = 0;
          po.reactRenders = reactRenderCountRef.current;

          let sampleTotal = 0;
          let samplePlayers = 0;
          snapshotBufferRef.current.forEach((samples) => {
            samplePlayers += 1;
            sampleTotal += Array.isArray(samples) ? samples.length : 0;
          });
          po.interpAvgSamples = samplePlayers ? (sampleTotal / samplePlayers) : 0;

          // WS stats
          const wsp = typeof window !== 'undefined' ? window.__FLAPPY_WS_PERF__ : null;
          if (wsp) {
            const wsElapsed = (currentTime - (wsp.windowStart || currentTime)) / 1000 || 1;
            po.wsRate = Math.round(wsp.count / wsElapsed);
            po.wsKbps = Math.round(wsp.bytes / wsElapsed / 1024 * 10) / 10;
            po.wsAvgBytes = wsp.count > 0 ? Math.round(wsp.bytes / wsp.count) : 0;
            // Reset window
            wsp.count = 0;
            wsp.bytes = 0;
            wsp.windowStart = currentTime;
          }

          const netp = typeof window !== 'undefined' ? window.__FLAPPY_NET_PERF__ : null;
          if (netp) {
            po.snapRate = Number(netp.snapshotRate || 0);
            po.snapAvgMs = Number(netp.snapshotAvgIntervalMs || 0);
            po.snapP95Ms = Number(netp.snapshotP95IntervalMs || 0);
            po.snapJitterMs = Number(netp.snapshotJitterMs || 0);
            po.snapApplyMs = Number(netp.applyAvgMs || 0);
            po.wsBufferedKb = Math.round((Number(netp.wsBufferedAmount || 0) / 1024) * 10) / 10;
          }

          const inputPerf = typeof window !== 'undefined' ? window.__FLAPPY_INPUT_PERF__ : null;
          if (inputPerf) {
            po.inputRate = Number(inputPerf.rate || 0);
            po.inputEmitMs = Number(inputPerf.emitMs || 0);
          }

          const sp = typeof window !== 'undefined' ? window.__FLAPPY_SERVER_PERF__ : null;
          if (sp) {
            po.serverTickMs = Number(sp.tickAvgMs || 0);
            po.serverTickP95Ms = Number(sp.tickP95Ms || 0);
            po.serverLoopMs = Number(sp.loopAvgMs || 0);
            po.serverStateBytes = Number(sp.stateBytesAvg || 0);
            po.serverStateIntervalAvgMs = Number(sp.stateIntervalAvgMs || 0);
            po.serverStateIntervalJitterMs = Number(sp.stateIntervalJitterMs || 0);
            po.serverClients = Number(sp.clients || 0);
            po.serverLongTickPct = Number(sp.longTickPct || 0);
            po.serverHeapMb = Number(sp.heapUsedMb || 0);
          }
        }

        // Draw overlay (screen-space, top-left)
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.globalAlpha = 0.85;
        const olX = 8, olY = 8, olW = 340, lineH = 13;
        const lines = [
          `FPS: ${po.fps}  rAF avg: ${po.avgMs.toFixed(1)}ms  p95: ${po.p95Ms.toFixed(1)}ms  jitter: ${po.rafJitterMs.toFixed(1)}ms`,
          `Draw: avg ${po.drawAvgMs.toFixed(1)}ms p95 ${po.drawP95Ms.toFixed(1)}ms | world ${po.worldDrawAvgMs.toFixed(1)} hud ${po.hudDrawAvgMs.toFixed(1)}`,
          `Long >33ms: ${po.longFrames33}  >50ms: ${po.longFrames50}`,
          `Players: ${po.playersDrawn}/${po.players}  Bullets: ${po.bulletsDrawn}/${po.bullets}  Orbs: ${po.orbsDrawn}  Particles: ${po.particles}`,
          `WS: ${po.wsRate} msg/s  avg ${po.wsAvgBytes}B  ${po.wsKbps} KB/s  buffered: ${po.wsBufferedKb.toFixed(1)}KB`,
          `Snapshots: ${po.snapRate.toFixed(1)}/s  avg:${po.snapAvgMs.toFixed(1)} p95:${po.snapP95Ms.toFixed(1)} jitter:${po.snapJitterMs.toFixed(1)} apply:${po.snapApplyMs.toFixed(2)}ms`,
          `Input send: ${po.inputRate.toFixed(1)}/s  emit:${po.inputEmitMs.toFixed(2)}ms  interpBuf:${po.interpAvgSamples.toFixed(1)}`,
          `Server tick avg:${po.serverTickMs.toFixed(1)}ms p95:${po.serverTickP95Ms.toFixed(1)} loop:${po.serverLoopMs.toFixed(1)}ms`,
          `Server state:${Math.round(po.serverStateBytes)}B avgInt:${po.serverStateIntervalAvgMs.toFixed(1)}ms jitter:${po.serverStateIntervalJitterMs.toFixed(1)} clients:${po.serverClients} longTick:${po.serverLongTickPct.toFixed(1)}% heap:${po.serverHeapMb.toFixed(1)}MB`,
          `React renders: ${po.reactRenders} domWrites:${po.domWrites} alloc/s:${po.allocPerSec} loops:${po.loopRestarts}`,
        ];
        const olH = lines.length * lineH + 10;
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(olX, olY, olW, olH);
        ctx.font = '600 10px monospace';
        ctx.fillStyle = po.fps >= 50 ? '#00ff88' : po.fps >= 30 ? '#ffcc00' : '#ff4444';
        for (let li = 0; li < lines.length; li++) {
          if (li >= 2) ctx.fillStyle = '#cccccc';
          ctx.fillText(lines[li], olX + 4, olY + 12 + li * lineH);
        }
        ctx.globalAlpha = 1;
      }

      if (perfModeRef.current) {
        const counters = perfCountersRef.current;
        counters.frames += 1;
        counters.renderMs += performance.now() - frameStart;
        if (counters.frames >= 60) {
          console.info('[perf] gameplay', {
            bullets: bulletSource.size,
            particles: boostParticlesRef.current.length + muzzleParticlesRef.current.length,
            shotsPerSec: fireStatsRef.current.sps,
            fireHandlerMs: Number((counters.fireHandlerMs / counters.frames).toFixed(3)),
            updateMs: Number((counters.updateMs / counters.frames).toFixed(3)),
            renderMs: Number((counters.renderMs / counters.frames).toFixed(3)),
            shootFxMs: Number((counters.shootMs / counters.frames).toFixed(3)),
            bulletUpdateMs: Number((counters.bulletUpdateMs / counters.frames).toFixed(3)),
            bulletDrawMs: Number((counters.bulletDrawMs / counters.frames).toFixed(3)),
            sendInputMs: Number((counters.sendInputMs / counters.frames).toFixed(3)),
            soundMs: Number((counters.soundMs / counters.frames).toFixed(3)),
            newObjectsThisFrame: allocRef.current.bullets + allocRef.current.particles + allocRef.current.trails,
          });
          counters.frames = 0;
          counters.fireHandlerMs = 0;
          counters.updateMs = 0;
          counters.renderMs = 0;
          counters.shootMs = 0;
          counters.bulletUpdateMs = 0;
          counters.bulletDrawMs = 0;
          counters.sendInputMs = 0;
          counters.soundMs = 0;
        }
      }
      if (vfxDebugRef.current) {
        const now = performance.now();
        const stats = vfxStatsRef.current;
        if (now - stats.lastLogAt >= 1000) {
          stats.lastLogAt = now;
          const trailSegments = Array.from(boostTrailRef.current.values()).reduce((sum, list) => sum + (list?.length || 0), 0);
          console.info('[vfx]', {
            particlesAlive: muzzleParticlesRef.current.length + boostParticlesRef.current.length + featherVfxRef.current.length,
            trailsSegments: trailSegments,
            featherSpawnsPerDeath: stats.featherSpawns,
          });
          stats.featherSpawns = 0;
        }
      }
      } catch (err) {
        if (import.meta.env.DEV) {
          console.error('[game] render loop error', err);
        }
      } finally {
        if (renderLoopTokenRef.current === loopToken) {
          animFrameRef.current = requestAnimationFrame(gameLoop);
        }
      }
    };
    
    // World-space: pipes use server world units, so the camera transform applies to them.
    function drawFlappyPipes(ctx, pipes, cullRect = null) {
      pipes.forEach((pipe) => {
        if (cullRect) {
          const offscreen =
            pipe.x + pipe.width < cullRect.left ||
            pipe.x > cullRect.right ||
            pipe.y + pipe.height < cullRect.top ||
            pipe.y > cullRect.bottom;
          if (offscreen) return;
        }
        // Inline includes() avoids per-pipe Set allocation
        const capArr = Array.isArray(pipe.caps) ? pipe.caps : [];
        const caps = {
          top: capArr.includes('top'),
          bottom: capArr.includes('bottom'),
          left: capArr.includes('left'),
          right: capArr.includes('right'),
        };
        const capSize = 10;
        const capOverhang = 5;
        
        // Main pipe body
        ctx.fillStyle = '#73BF2E';
        ctx.fillRect(pipe.x, pipe.y, pipe.width, pipe.height);
        
        // Dark edge
        ctx.fillStyle = '#558B2F';
        ctx.fillRect(pipe.x + pipe.width - 8, pipe.y, 8, pipe.height);
        
        // Light edge
        ctx.fillStyle = '#8BC34A';
        ctx.fillRect(pipe.x, pipe.y, 5, pipe.height);
        
        // Vertical caps
        if (pipe.type === 'vertical' || !pipe.type) {
          if (caps.top) {
            ctx.fillStyle = '#73BF2E';
            ctx.fillRect(pipe.x - capOverhang, pipe.y - capSize, pipe.width + capOverhang * 2, capSize);
            ctx.fillStyle = '#558B2F';
            ctx.fillRect(pipe.x + pipe.width + capOverhang - 8, pipe.y - capSize, 8, capSize);
            ctx.fillStyle = '#8BC34A';
            ctx.fillRect(pipe.x - capOverhang, pipe.y - capSize, 5, capSize);
            ctx.strokeStyle = '#2E7D32';
            ctx.lineWidth = 2;
            ctx.strokeRect(pipe.x - capOverhang, pipe.y - capSize, pipe.width + capOverhang * 2, capSize);
          }
          if (caps.bottom) {
            ctx.fillStyle = '#73BF2E';
            ctx.fillRect(pipe.x - capOverhang, pipe.y + pipe.height, pipe.width + capOverhang * 2, capSize);
            ctx.fillStyle = '#558B2F';
            ctx.fillRect(pipe.x + pipe.width + capOverhang - 8, pipe.y + pipe.height, 8, capSize);
            ctx.fillStyle = '#8BC34A';
            ctx.fillRect(pipe.x - capOverhang, pipe.y + pipe.height, 5, capSize);
            ctx.strokeStyle = '#2E7D32';
            ctx.lineWidth = 2;
            ctx.strokeRect(pipe.x - capOverhang, pipe.y + pipe.height, pipe.width + capOverhang * 2, capSize);
          }
        }
        
        // Horizontal caps
        if (pipe.type === 'horizontal') {
          if (caps.left) {
            ctx.fillStyle = '#73BF2E';
            ctx.fillRect(pipe.x - capSize, pipe.y - capOverhang, capSize, pipe.height + capOverhang * 2);
            ctx.fillStyle = '#8BC34A';
            ctx.fillRect(pipe.x - capSize, pipe.y - capOverhang, 5, pipe.height + capOverhang * 2);
            ctx.strokeStyle = '#2E7D32';
            ctx.lineWidth = 2;
            ctx.strokeRect(pipe.x - capSize, pipe.y - capOverhang, capSize, pipe.height + capOverhang * 2);
          }
          if (caps.right) {
            ctx.fillStyle = '#73BF2E';
            ctx.fillRect(pipe.x + pipe.width, pipe.y - capOverhang, capSize, pipe.height + capOverhang * 2);
            ctx.fillStyle = '#558B2F';
            ctx.fillRect(pipe.x + pipe.width + capSize - 8, pipe.y - capOverhang, 8, pipe.height + capOverhang * 2);
            ctx.strokeStyle = '#2E7D32';
            ctx.lineWidth = 2;
            ctx.strokeRect(pipe.x + pipe.width, pipe.y - capOverhang, capSize, pipe.height + capOverhang * 2);
          }
        }
        
        // Main border
        ctx.strokeStyle = '#2E7D32';
        ctx.lineWidth = 2;
        ctx.strokeRect(pipe.x, pipe.y, pipe.width, pipe.height);
      });
    }
    
    if (import.meta.env.DEV && !heartbeatRef.current.startedLogged) {
      heartbeatRef.current.startedLogged = true;
      // console.info('[game] RAF started');
    }
    animFrameRef.current = requestAnimationFrame(gameLoop);
    
    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
      renderLoopCountRef.current = Math.max(0, renderLoopCountRef.current - 1);
      if (import.meta.env.DEV) {
        heartbeatRef.current.startedLogged = false;
        // console.info('[game] RAF stopped');
      }
    };
  }, [visible, myPlayerId, config, pipes, playersRef, bulletsRef, orbsRef, cameraMode, showHud, demoCashoutEnabled, cameraOverride]);

  const myPlayer = playersRef.current.get(myPlayerId);
  const cashoutLabel = myPlayer?.cashingOut
    ? 'CASHING OUT...'
    : `CASH OUT $${formatUsd(myPlayer?.balance || 0)}`;
  const cashoutSegments = config?.cashoutSegments || 4;
  const mobileCashoutProgress = myPlayer?.cashingOut
    ? Math.max(0, Math.min(cashoutSegments, myPlayer?.cashoutProgress ?? cashoutSegments))
    : cashoutSegments;
  const mobileCashoutPct = myPlayer?.cashingOut
    ? (typeof myPlayer?.cashoutPct === 'number'
      ? clamp(myPlayer.cashoutPct, 0, 1)
      : clamp((cashoutSegments - mobileCashoutProgress) / cashoutSegments, 0, 1))
    : 0;
  const isLandscape = mobileHudLayout.width > mobileHudLayout.height;
  const showMobileHud = interactive && isTouchUi;
  // Landscape behavior remains unchanged (already gated by demoCashoutEnabled there).
  // Portrait now also waits for demo cashout unlock state.
  const showMobileCashout = showMobileHud && (isLandscape ? demoCashoutEnabled : (!demoMode || !!demoCashoutUiUnlocked));
  const cashoutUiDisabled = !!demoMode && !demoCashoutEnabled;
  const hapticsDebugEnabled = import.meta.env.DEV
    && typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('haptics') === '1';
  const safeLeft = mobileHudLayout.safeInsets.left || 0;
  const safeRight = mobileHudLayout.safeInsets.right || 0;
  const safeBottom = mobileHudLayout.safeInsets.bottom || 0;
  const landscapeControlsStyle = isLandscape
    ? {
        '--mobile-controls-bottom': `${safeBottom + MOBILE_LANDSCAPE_CONTROLS_MARGIN + MOBILE_LANDSCAPE_CONTROLS_RAISE_PX}px`,
        '--mobile-boost-left': `${Math.max(12, safeLeft + MOBILE_LANDSCAPE_CONTROLS_MARGIN)}px`,
        '--mobile-fire-right': `${Math.max(12, safeRight + MOBILE_LANDSCAPE_CONTROLS_MARGIN)}px`,
        '--mobile-fire-bottom-offset': '15px',
        '--mobile-cashout-right': `${Math.max(12, safeRight + MOBILE_LANDSCAPE_CONTROLS_MARGIN)}px`,
        '--mobile-cashout-bottom': `${safeBottom + MOBILE_LANDSCAPE_CONTROLS_MARGIN + MOBILE_CASHOUT_ONLY_RAISE_PX}px`,
        '--mobile-cashout-width': `${MOBILE_LANDSCAPE_CASHOUT_WIDTH}px`,
        '--mobile-cashout-height': `${MOBILE_LANDSCAPE_CASHOUT_HEIGHT}px`,
      }
    : undefined;

  return (
    <div
      ref={containerRef}
      className={`game-canvas-container ${visible ? 'visible' : ''} ${showMobileHud ? 'touch-mode' : ''}`}
      style={landscapeControlsStyle}
    >
      <canvas ref={canvasRef} id="gameCanvas" />
      {import.meta.env.DEV && controllerConnected ? (
        <div
          style={{
            position: 'absolute',
            top: '10px',
            left: '10px',
            zIndex: 50,
            pointerEvents: 'none',
            fontSize: '11px',
            fontWeight: 700,
            letterSpacing: '0.04em',
            color: '#d8ffe3',
            background: 'rgba(8,24,12,0.72)',
            border: '1px solid rgba(99,214,133,0.55)',
            borderRadius: '6px',
            padding: '4px 7px',
            textTransform: 'uppercase',
          }}
        >
          Controller Connected
        </div>
      ) : null}
      {hapticsDebugEnabled ? (
        <div
          style={{
            position: 'absolute',
            top: '36px',
            left: '10px',
            zIndex: 50,
            pointerEvents: 'none',
            fontSize: '10px',
            fontWeight: 600,
            letterSpacing: '0.03em',
            color: '#e2f6ff',
            background: 'rgba(6,16,28,0.78)',
            border: '1px solid rgba(91,165,255,0.5)',
            borderRadius: '6px',
            padding: '6px 8px',
            textTransform: 'uppercase',
            lineHeight: 1.3,
            maxWidth: '320px',
          }}
        >
          <div>Haptics: {hapticsDebugSnapshot?.support || 'unknown'}</div>
          <div>Pad: {hapticsDebugSnapshot?.gamepadId || 'none'}</div>
          <div>Actuators: {hapticsDebugSnapshot?.actuatorCount ?? 0}</div>
          <div>Last: {hapticsDebugSnapshot?.lastReason || '-'}</div>
          <div>At: {hapticsDebugSnapshot?.lastPulseAt ? Math.round(hapticsDebugSnapshot.lastPulseAt) : 0}</div>
          {hapticsDebugSnapshot?.lastRateBlock ? <div>Rate: {hapticsDebugSnapshot.lastRateBlock}</div> : null}
          {hapticsDebugSnapshot?.lastError ? <div>Error: {hapticsDebugSnapshot.lastError}</div> : null}
        </div>
      ) : null}
      {showMobileHud ? (
        <>
          {showMobileFire ? (
            <button
              ref={fireButtonRef}
              className={`mobile-fire-button ${fireUiActive ? 'active' : ''} ${fireInputBlockedByDemo ? 'disabled' : ''}`}
              type="button"
              disabled={fireInputBlockedByDemo}
              aria-pressed={fireUiActive}
            >
              FIRE
            </button>
          ) : null}
          {showMobileCashout ? (
          <div className={`mobile-cashout-bar ${cashoutUiActive ? 'active' : ''}`}>
            {myPlayer?.cashingOut ? (
              <div className="mobile-cashout-progress" aria-hidden="true">
                <div
                  className="mobile-cashout-progress__fill"
                  style={{ width: `${Math.round(mobileCashoutPct * 100)}%` }}
                />
              </div>
            ) : null}
            <button
              ref={cashoutButtonRef}
              className={`mobile-cashout-button ${cashoutUiDisabled ? 'disabled' : ''}`}
              type="button"
              disabled={cashoutUiDisabled}
              aria-pressed={cashoutUiActive}
            >
              {cashoutLabel}
            </button>
          </div>
          ) : null}
          {null}
        </>
      ) : null}
    </div>
  );
}

export default memo(GameCanvas);
