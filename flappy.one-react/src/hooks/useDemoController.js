import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// Demo controller:
// runs a fully local tutorial state machine and deterministic mini-sim,
// then calls secure onboarding completion only after the final continue click.
const DEMO_VERSION = 'v1';
const WORLD_WIDTH = 6400;
const WORLD_HEIGHT = 5600;
const PLAYER_ID = 'demo-player';
const BOT_ID = 'demo-bot';
// Match live game tuning (server.js): 21 / 28.5 units per 16.666ms tick.
const PLAYER_SPEED = 1.26; // world units per ms
const BOOST_SPEED = 1.71;
const BOT_SPEED = 1.26;
const BOT_WEAVE_AMPLITUDE = 120;
const BOT_WEAVE_FREQ = 0.0044;
const BOOST_DRAIN_PER_SEC = 34;
const BOOST_REGEN_PER_SEC = 18;
const SHOT_INTERVAL_MS = 130;
const BOT_SHOT_INTERVAL_MS = 780;
const BOT_BURST_MS = 3000;
const BOT_BURST_PAUSE_MIN_MS = 1000;
const BOT_BURST_PAUSE_MAX_MS = 2000;
const BOT_DAMAGE = 8;
const BOT_MAX_HP = 5; // demo-only: exact 5-hit kill
const PLAYER_MAX_HP = 100;
const CASHOUT_HOLD_MS = 3000;
const TAP_REGION = { minX: 0.52, maxX: 0.84, minY: 0.18, maxY: 0.5 };
const TYPE_INTERVAL_MS = 45;
const MIN_SCENE_TEXT_MS = 5000;
const PLAYER_SYNC_INTERVAL_MS = 50;
const LEADERBOARD_SYNC_INTERVAL_MS = 250;
const DEMO_HIT_FLASH_MS = 80;
const BORDER_IMPACT_FREEZE_MS = 95;
const SCENE_ORDER = [
  'intro',
  'move_hold',
  'move_drag',
  'move_boost',
  'fire_intro',
  'border_intro',
  'fight_intro',
  'fight',
  'collect_intro',
  'collect',
  'cashout_intro',
  'cashout',
  'done',
];
const SCENE_REQUIREMENT = {
  move_hold: 'move',
  move_drag: 'turn',
  move_boost: 'boost',
  fire_intro: 'fire',
  cashout: 'cashout',
};
const SCENE_ALLOW_PROMPT_INPUT = new Set(['move_hold', 'move_drag', 'move_boost']);
const DEMO_SCENE_PROMPTS = [
  {
    id: 'intro',
    audio: 'intro_1',
    text: 'Welcome to the MOST FAIR SKILL-BASED PVP BETTING game on Solana, here are your controls.',
  },
  {
    id: 'move_hold',
    audio: 'intro_2',
    text: 'Hold your finger anywhere you want to move.\n(Desktop: Move your mouse to steer. Controller: Use the left stick to move.)',
  },
  {
    id: 'move_drag',
    audio: 'intro_3',
    text: 'Continuously move your finger across the screen to change directions.\n(Desktop: Move your mouse to change direction. Controller: Tilt the left stick in any direction.)',
  },
  {
    id: 'move_boost',
    audio: 'intro_4',
    text: 'Double tap & hold while moving to boost.\n(Desktop: Hold Shift while moving to boost. Controller: Hold X while moving to boost.)',
  },
  {
    id: 'fire_intro',
    audio: 'intro_5',
    text: 'Fire with this button, you have infinite bullets & no cool-down.\n(Desktop: Left click or press Spacebar to fire. Controller: Pull R2 to fire.)',
  },
  {
    id: 'border_intro',
    audio: 'audio/border_intro',
    text: 'DO NOT fly into the border! It will KILL YOU.',
  },
  {
    id: 'fight_intro',
    audio: 'intro_6',
    text: 'Now you are ready to fight! Quick! An enemy flappy is flying towards you! Shoot him down before he kills you!',
  },
  {
    id: 'collect_intro',
    audioClips: ['intro_7.5', 'intro_7.9'],
    text: 'Good job! You have killed the bird which had a value of $2, YOU NEED TO FLY OVER THE BIRDS FEATHERS TO RECEIVE THE MONEY!',
  },
  {
    id: 'cashout_intro',
    audioClips: ['intro_8.5', 'intro_8.9'],
    text: 'Great! You now have $3! You just 3xed your play-money!, to realise your gains you now have to CASHOUT, hold the cashout button until the 3 second wait ends\n(Desktop: Hold F to cashout. Controller: Hold Circle to cashout.)',
  },
  {
    id: 'done',
    audioClips: ['intro_9.5', 'intro_9.9'],
    text: 'Great! You are now ready to ACTUALLY play with other players on FlappyOne! Press the menu button to continue and I wish you luck with your journey my fellow padawan!\n(Desktop: Click the button to continue. Controller: Press X to continue.)',
  },
];
const DEMO_SCENE_PROMPT_BY_ID = new Map(DEMO_SCENE_PROMPTS.map((item) => [item.id, item]));

function getSceneAudioQueue(scenePrompt) {
  if (!scenePrompt) return [];
  if (Array.isArray(scenePrompt.audioClips) && scenePrompt.audioClips.length > 0) {
    return scenePrompt.audioClips.filter(Boolean);
  }
  if (scenePrompt.audio) return [scenePrompt.audio];
  return [];
}
const GROUND_HEIGHT_RATIO = 0.18;
const GROUND_TOP_Y = WORLD_HEIGHT - Math.floor(WORLD_HEIGHT * GROUND_HEIGHT_RATIO);
const FLOOR_CLAMP_Y = GROUND_TOP_Y - 26;
const BORDER_MARGIN = 180;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeAngle(angle) {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function lerpAngle(from, to, t) {
  const diff = normalizeAngle(to - from);
  return from + diff * t;
}

function dist(a, b) {
  const dx = (a?.x || 0) - (b?.x || 0);
  const dy = (a?.y || 0) - (b?.y || 0);
  return Math.hypot(dx, dy);
}

function createPlayer(name = 'Player') {
  return {
    id: PLAYER_ID,
    name,
    x: WORLD_WIDTH * 0.48,
    y: WORLD_HEIGHT * 0.46,
    angle: -0.2,
    health: PLAYER_MAX_HP,
    kills: 0,
    alive: true,
    joined: true,
    status: 'playing',
    balance: 1,
    balanceLamports: 0,
    balanceSol: 0,
    boost: 100,
    boosting: false,
    boostDepleted: false,
    shooting: false,
    cashingOut: false,
    cashoutProgress: 4,
    cashoutPct: 0,
    paused: false,
    birdType: 'yellow',
    onGround: false,
    vy: 0,
    isBot: false,
  };
}

function createBot(options = {}) {
  const x = Number.isFinite(options.x) ? options.x : WORLD_WIDTH * 0.7;
  const y = Number.isFinite(options.y) ? options.y : WORLD_HEIGHT * 0.42;
  const angle = Number.isFinite(options.angle) ? options.angle : Math.PI;
  return {
    id: BOT_ID,
    name: 'Enemy Flappy',
    x,
    y,
    angle,
    health: BOT_MAX_HP,
    kills: 0,
    alive: true,
    joined: true,
    status: 'playing',
    balance: 2,
    boost: 100,
    boosting: false,
    boostDepleted: false,
    shooting: false,
    cashingOut: false,
    cashoutProgress: 4,
    cashoutPct: 0,
    paused: false,
    birdType: 'red',
    onGround: false,
    vy: 0,
    baseY: y,
    isBot: true,
  };
}

function sceneLog(name, extra) {
  void name;
  void extra;
}

function createDemoVoiceManager() {
  const preloadCache = new Map();
  const audio = new Audio();
  audio.preload = 'auto';
  let unlocked = false;
  let playToken = 0;
  let currentKey = '';

  const resolveClipSrc = (clip) => {
    const value = String(clip || '').trim();
    if (!value) return '';
    if (value.startsWith('/')) return value.endsWith('.mp3') ? value : `${value}.mp3`;
    if (value.includes('/')) return value.endsWith('.mp3') ? `/${value}` : `/${value}.mp3`;
    return `/audios/${value}.mp3`;
  };

  const setSource = (src) => {
    if (audio.src.endsWith(src)) return;
    audio.src = src;
  };

  const playWithSource = async (src) => {
    setSource(src);
    await new Promise((resolve, reject) => {
      const onEnded = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error(`AUDIO_LOAD_FAILED:${src}`));
      };
      const cleanup = () => {
        audio.removeEventListener('ended', onEnded);
        audio.removeEventListener('error', onError);
      };
      audio.addEventListener('ended', onEnded);
      audio.addEventListener('error', onError);
      try {
        audio.currentTime = 0;
      } catch {}
      void audio.play().catch((err) => {
        cleanup();
        reject(err);
      });
    });
  };

  const preloadSource = async (src) => {
    if (preloadCache.has(src)) return preloadCache.get(src);
    const loader = new Audio();
    loader.preload = 'auto';
    const promise = new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        cleanup();
        resolve();
      };
      const cleanup = () => {
        loader.removeEventListener('canplaythrough', finish);
        loader.removeEventListener('loadeddata', finish);
        loader.removeEventListener('error', finish);
      };
      loader.addEventListener('canplaythrough', finish);
      loader.addEventListener('loadeddata', finish);
      loader.addEventListener('error', finish);
      loader.src = src;
      loader.load();
      setTimeout(finish, 1200);
    });
    preloadCache.set(src, promise);
    return promise;
  };

  return {
    async initUnlock() {
      if (unlocked) return true;
      try {
        if (!audio.src) {
          audio.src = '/audios/intro_1.mp3';
          audio.load();
        }
        audio.muted = true;
        await audio.play();
        audio.pause();
        audio.currentTime = 0;
        audio.muted = false;
        unlocked = true;
        return true;
      } catch {
        audio.muted = false;
        return false;
      }
    },
    async playSceneNarration(queue = [], options = {}) {
      const clips = Array.isArray(queue) ? queue.filter(Boolean) : [];
      if (clips.length === 0) return;
      if (!unlocked) throw new Error('AUDIO_LOCKED');
      this.stop();
      playToken += 1;
      const token = playToken;
      currentKey = clips.join(',');
      const log = typeof options.log === 'function' ? options.log : null;
      const onGap = typeof options.onGap === 'function' ? options.onGap : null;
      const sources = clips.map((clip) => resolveClipSrc(clip)).filter(Boolean);
      await Promise.all(sources.map((src) => preloadSource(src)));
      let previousEndedAt = 0;
      for (const clip of clips) {
        if (token !== playToken) return;
        const src = resolveClipSrc(clip);
        if (!src) continue;
        const startAt = performance.now();
        if (onGap && previousEndedAt > 0) {
          onGap(startAt - previousEndedAt, clip);
        }
        if (log) log('start', clip);
        await playWithSource(src);
        previousEndedAt = performance.now();
        if (log) log('end', clip);
      }
    },
    stop() {
      playToken += 1;
      try {
        audio.pause();
        audio.currentTime = 0;
      } catch {}
    },
    isPlaying() {
      return !audio.paused && !audio.ended;
    },
    isUnlocked() {
      return unlocked;
    },
    currentKey() {
      return currentKey;
    },
  };
}

export function useDemoController({ enabled, username, getAuthToken, onExitToMenu }) {
  const demoDebug = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('demoDebug') === '1';
  }, []);
  const [isComplete, setIsComplete] = useState(false);
  const [scene, setScene] = useState('intro');
  const [promptId, setPromptId] = useState('intro_1');
  const [instructionText, setInstructionText] = useState(DEMO_SCENE_PROMPT_BY_ID.get('intro')?.text || '');
  const [typedText, setTypedText] = useState('');
  const [typingDone, setTypingDone] = useState(false);
  const [audioDone, setAudioDone] = useState(false);
  const [showActionButton, setShowActionButton] = useState(false);
  const [actionButtonLabel, setActionButtonLabel] = useState('');
  const [buttonBusy, setButtonBusy] = useState(false);
  const [paused, setPaused] = useState(true);
  const [inputLocked, setInputLocked] = useState(true);
  const [pointerTarget, setPointerTarget] = useState(null);
  const [overlayVisible, setOverlayVisible] = useState(true);
  const [playersVersion, setPlayersVersion] = useState(1);
  const [sessionLeaderboardRows, setSessionLeaderboardRows] = useState([]);

  const playersRef = useRef(new Map());
  const bulletsRef = useRef(new Map());
  const orbsRef = useRef(new Map());
  const inputRef = useRef({
    angle: -0.2,
    shooting: false,
    boosting: false,
    cashingOut: false,
    throttle: 0,
    paused: false,
  });
  const inputTelemetryRef = useRef({
    lastMoveAt: 0,
    lastTurnAt: 0,
    lastBoostAt: 0,
    lastFireAt: 0,
    lastCashoutAt: 0,
    lastAngle: -0.2,
    turnAccum: 0,
  });
  const gameRef = useRef({
    lastAt: 0,
    sceneStartedAt: 0,
    dragMs: 0,
    moveHoldMs: 0,
    dragDirectionDelta: 0,
    boostMs: 0,
    botLastShotAt: 0,
    botBurstUntil: 0,
    botNextBurstAt: 0,
    playerLastShotAt: 0,
    cashoutMs: 0,
    firstFireAt: 0,
    firePracticeMs: 0,
    touchHeldInRegion: false,
    collected: false,
    sceneTextShownAt: 0,
    fireLoopActive: false,
    awaitInputRelease: false,
  });
  const voiceManagerRef = useRef(null);
  const promptSeqRef = useRef(1);
  const voicePlayTokenRef = useRef(0);
  const voiceStartedPromptRef = useRef('');
  const typeTimerRef = useRef(null);
  const rafRef = useRef(null);
  const onboardingStartedRef = useRef(false);
  const demoStartedRef = useRef(false);
  const borderDeathPendingRef = useRef(false);
  const autoAdvanceRef = useRef('');
  const sceneRef = useRef('intro');
  const resetInFlightRef = useRef(false);
  const cameraOverrideRef = useRef(null);
  const cameraOverrideSeqRef = useRef(0);
  const [cameraOverrideVersion, setCameraOverrideVersion] = useState(0);
  const cinematicTokenRef = useRef(0);
  const cinematicTimersRef = useRef([]);
  const nextPlayerSyncAtRef = useRef(0);
  const nextLeaderboardSyncAtRef = useRef(0);
  const leaderboardSignatureRef = useRef('');
  const devMetricsRef = useRef({
    lastLogAt: 0,
    sceneUpdates: 0,
    overlaySetState: 0,
    loopTicks: 0,
    audioTriggers: 0,
    shotEvents: 0,
    hitEvents: 0,
  });
  const uiClickAudioRef = useRef(null);
  const uiClickLastAtRef = useRef(0);

  const markDemoMetric = useCallback((name, amount = 1) => {
    if (!import.meta.env.DEV) return;
    if (!devMetricsRef.current[name]) devMetricsRef.current[name] = 0;
    devMetricsRef.current[name] += amount;
  }, []);

  const playUiClick = useCallback(() => {
    if (typeof window === 'undefined') return;
    const now = performance.now();
    if (now - uiClickLastAtRef.current < 70) return;
    uiClickLastAtRef.current = now;
    if (!uiClickAudioRef.current) {
      const audio = new Audio('/assets/sfx/menu_click.mp3');
      audio.preload = 'auto';
      audio.volume = 0.45;
      uiClickAudioRef.current = audio;
    }
    const audio = uiClickAudioRef.current;
    try {
      audio.currentTime = 0;
    } catch {}
    void audio.play().catch(() => {});
  }, []);

  const setCameraOverride = useCallback((nextOverride) => {
    cameraOverrideRef.current = nextOverride;
    cameraOverrideSeqRef.current += 1;
    setCameraOverrideVersion(cameraOverrideSeqRef.current);
  }, []);

  const clearCameraOverride = useCallback(() => {
    setCameraOverride(null);
  }, [setCameraOverride]);

  const cancelCinematics = useCallback(() => {
    cinematicTokenRef.current += 1;
    cinematicTimersRef.current.forEach((timer) => clearTimeout(timer));
    cinematicTimersRef.current = [];
    clearCameraOverride();
  }, [clearCameraOverride]);

  const runCinematic = useCallback((steps = [], onDone = null) => {
    cancelCinematics();
    const token = cinematicTokenRef.current;
    let cursorMs = 0;
    for (const step of steps) {
      const delay = Math.max(0, Number(step?.delayMs || 0));
      const hold = Math.max(0, Number(step?.holdMs || 0));
      cursorMs += delay;
      const timer = setTimeout(() => {
        if (token !== cinematicTokenRef.current) return;
        setCameraOverride({
          active: true,
          x: step.x,
          y: step.y,
          zoom: step.zoom,
          lerp: step.lerp,
        });
      }, cursorMs);
      cinematicTimersRef.current.push(timer);
      cursorMs += hold;
    }
    const doneTimer = setTimeout(() => {
      if (token !== cinematicTokenRef.current) return;
      clearCameraOverride();
      if (typeof onDone === 'function') onDone();
    }, cursorMs);
    cinematicTimersRef.current.push(doneTimer);
  }, [cancelCinematics, clearCameraOverride, setCameraOverride]);
  const isTypingComplete = useMemo(() => {
    const total = (instructionText || '').length;
    if (total === 0) return true;
    return (typedText || '').length >= total;
  }, [instructionText, typedText]);
  const cashoutUiUnlocked = useMemo(
    () => scene === 'cashout_intro' || scene === 'cashout' || scene === 'done',
    [scene]
  );

  const config = useMemo(() => ({
    worldWidth: WORLD_WIDTH,
    worldHeight: WORLD_HEIGHT,
    playerSize: 25,
    bulletSize: 9,
    bulletSpeed: 18,
    bulletLifetime: 1200,
    bulletRange: 1240,
    playerSpeed: 21,
    shootCooldown: SHOT_INTERVAL_MS,
    boostMax: 100,
    orbSize: 12,
    orbMagnetRadius: 120,
    cashoutTime: CASHOUT_HOLD_MS,
    cashoutSegments: 4,
    borderMarginMin: 90,
    borderMarginMax: 260,
  }), []);

  const resetCoreState = useCallback(() => {
    cancelCinematics();
    borderDeathPendingRef.current = false;
    const p = createPlayer(username || 'Player');
    playersRef.current = new Map([[PLAYER_ID, p]]);
    bulletsRef.current = new Map();
    orbsRef.current = new Map();
    setSessionLeaderboardRows([{ id: PLAYER_ID, username: p.name, balance: p.balance }]);
    setPlayersVersion((v) => v + 1);
    gameRef.current = {
      lastAt: performance.now(),
      sceneStartedAt: performance.now(),
      dragMs: 0,
      moveHoldMs: 0,
      dragDirectionDelta: 0,
      boostMs: 0,
      botLastShotAt: 0,
      botBurstUntil: 0,
      botNextBurstAt: 0,
      playerLastShotAt: 0,
      cashoutMs: 0,
      firstFireAt: 0,
      firePracticeMs: 0,
      touchHeldInRegion: false,
      collected: false,
    };
    inputRef.current = {
      angle: p.angle,
      shooting: false,
      boosting: false,
      cashingOut: false,
      throttle: 0,
      paused: false,
    };
    nextPlayerSyncAtRef.current = 0;
    nextLeaderboardSyncAtRef.current = 0;
    leaderboardSignatureRef.current = '';
    promptSeqRef.current = 1;
    setPromptId('intro_1');
    setAudioDone(false);
    voiceStartedPromptRef.current = '';
  }, [username, cancelCinematics]);

  const setInstruction = useCallback((nextScene, options = {}) => {
    const prompt = DEMO_SCENE_PROMPT_BY_ID.get(nextScene);
    const nextText = prompt?.text || '';
    autoAdvanceRef.current = '';
    setScene(nextScene);
    promptSeqRef.current += 1;
    setPromptId(`${nextScene}_${promptSeqRef.current}`);
    setInstructionText(nextText);
    setTypedText('');
    setTypingDone(false);
    setAudioDone(false);
    setOverlayVisible(true);
    // Text blocks always freeze demo simulation until explicitly resumed.
    setPaused(true);
    setInputLocked(true);
    setPointerTarget(options.pointer || null);
    setActionButtonLabel(options.buttonLabel || '');
    setShowActionButton(false);
    gameRef.current.sceneTextShownAt = performance.now();
    gameRef.current.awaitInputRelease = (
      nextScene === 'move_hold'
      || nextScene === 'move_drag'
      || nextScene === 'move_boost'
      || nextScene === 'fire_intro'
      || nextScene === 'cashout'
    );
    markDemoMetric('sceneUpdates');
    markDemoMetric('overlaySetState', 8);
    sceneLog('scene', nextScene);
    if (demoDebug) {
      const queue = getSceneAudioQueue(prompt);
      console.info('[DEMO] scene transition', {
        scene: nextScene,
        audioQueue: queue,
        paused: !!options.paused,
        inputLocked: typeof options.inputLocked === 'boolean' ? !!options.inputLocked : !!options.paused,
      });
    }
  }, [markDemoMetric, demoDebug]);

  useEffect(() => {
    sceneRef.current = scene;
  }, [scene]);

  const primeFightScene = useCallback(() => {
    const player = playersRef.current.get(PLAYER_ID);
    if (!player) return null;
    player.alive = true;
    player.health = PLAYER_MAX_HP;
    player.kills = 0;
    player.balance = 1;
    player.cashoutPct = 0;
    player.cashoutProgress = 4;
    player.cashingOut = false;
    player.boost = 100;
    player.boostDepleted = false;
    player.x = WORLD_WIDTH * 0.46;
    player.y = WORLD_HEIGHT * 0.47;
    player.angle = -0.2;

    const enemyX = clamp(player.x + 920, 120, WORLD_WIDTH - 120);
    const enemyY = clamp(player.y - 110, 120, FLOOR_CLAMP_Y);
    const bot = createBot({
      x: enemyX,
      y: enemyY,
      angle: Math.atan2(player.y - enemyY, player.x - enemyX),
    });
    playersRef.current.set(BOT_ID, bot);
    setPlayersVersion((v) => v + 1);
    return { player, bot };
  }, []);

  const enterFightCombat = useCallback(() => {
    const player = playersRef.current.get(PLAYER_ID);
    const bot = playersRef.current.get(BOT_ID);
    if (!player || !bot) return;
    gameRef.current.botLastShotAt = 0;
    gameRef.current.botBurstUntil = 0;
    gameRef.current.botNextBurstAt = 0;
    gameRef.current.playerLastShotAt = 0;
    setPaused(false);
    setInputLocked(false);
    setOverlayVisible(false);
    setScene('fight');
    setPlayersVersion((v) => v + 1);
    sceneLog('fight-start');
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('flappy:resetInputLatch', { detail: { reason: 'start_fight' } }));
    }
  }, []);

  const playBorderWarningCutscene = useCallback(() => {
    const player = playersRef.current.get(PLAYER_ID);
    if (!player) return;
    const borderFocusX = clamp(player.x + 640, BORDER_MARGIN + 20, WORLD_WIDTH - BORDER_MARGIN - 20);
    const borderFocusY = BORDER_MARGIN + 42;
    runCinematic(
      [
        { x: player.x, y: player.y, zoom: 1, lerp: 0.12, delayMs: 0, holdMs: 120 },
        { x: borderFocusX, y: borderFocusY, zoom: 0.8, lerp: 0.12, delayMs: 0, holdMs: 920 },
        { x: player.x, y: player.y, zoom: 1, lerp: 0.14, delayMs: 0, holdMs: 700 },
      ],
      () => {
        primeFightScene();
        setInstruction('fight_intro', { paused: true });
      },
    );
  }, [primeFightScene, runCinematic, setInstruction]);

  const playFightIntroCutscene = useCallback(() => {
    const player = playersRef.current.get(PLAYER_ID);
    const bot = playersRef.current.get(BOT_ID);
    if (!player || !bot) {
      enterFightCombat();
      return;
    }
    setOverlayVisible(false);
    setPaused(true);
    setInputLocked(true);
    runCinematic(
      [
        { x: bot.x, y: bot.y, zoom: 0.82, lerp: 0.12, delayMs: 0, holdMs: 980 },
        { x: player.x, y: player.y, zoom: 1, lerp: 0.14, delayMs: 0, holdMs: 860 },
      ],
      () => {
        enterFightCombat();
      },
    );
  }, [enterFightCombat, runCinematic]);

  const restartFightBeat = useCallback(() => {
    cancelCinematics();
    borderDeathPendingRef.current = false;
    playersRef.current.delete(BOT_ID);
    orbsRef.current.clear();
    gameRef.current.collected = false;
    const primed = primeFightScene();
    const player = primed?.player || playersRef.current.get(PLAYER_ID);
    inputRef.current = {
      angle: player?.angle ?? -0.2,
      shooting: false,
      boosting: false,
      cashingOut: false,
      throttle: 0,
      paused: false,
    };
    gameRef.current.botLastShotAt = 0;
    gameRef.current.botBurstUntil = 0;
    gameRef.current.botNextBurstAt = 0;
    gameRef.current.playerLastShotAt = 0;
    gameRef.current.firstFireAt = 0;
    gameRef.current.moveHoldMs = 0;
    gameRef.current.firePracticeMs = 0;
    gameRef.current.cashoutMs = 0;
    if (gameRef.current.fireLoopActive && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('flappy:mobileFireStop'));
    }
    gameRef.current.fireLoopActive = false;
    setPlayersVersion((v) => v + 1);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('flappy:resetInputLatch', { detail: { reason: 'restart_fight' } }));
    }
    setInstruction(
      'fight_intro',
      { paused: true },
    );
  }, [cancelCinematics, primeFightScene, setInstruction]);

  const requestServerFightReset = useCallback(async () => {
    const token = await getAuthToken?.();
    const response = await fetch('/api/demo/reset', {
      method: 'POST',
      headers: token
        ? { Authorization: `Bearer ${token}` }
        : undefined,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || 'demo reset failed');
    }
    return response.json().catch(() => ({}));
  }, [getAuthToken]);

  const resetFightScene = useCallback(async (origin = 'unknown') => {
    if (!enabled || isComplete) return false;
    if (resetInFlightRef.current) return false;
    resetInFlightRef.current = true;
    if (demoDebug) {
      console.info('[DEMO] resetFightScene start', { origin });
    }
    try {
      try {
        await requestServerFightReset();
        if (demoDebug) {
          console.info('[DEMO] reset ack received');
        }
      } catch (err) {
        if (demoDebug) {
          console.warn('[DEMO] reset ack failed, using local fallback', err?.message || err);
        }
      }
      restartFightBeat();
      if (demoDebug) {
        console.info('[DEMO] resetFightScene done; scene=fight_intro');
      }
      return true;
    } finally {
      resetInFlightRef.current = false;
    }
  }, [enabled, isComplete, requestServerFightReset, restartFightBeat, demoDebug]);

  const restartCollectBeat = useCallback(() => {
    cancelCinematics();
    borderDeathPendingRef.current = false;
    const player = playersRef.current.get(PLAYER_ID);
    if (!player) return;
    player.alive = true;
    player.health = PLAYER_MAX_HP;
    player.balance = 1;
    player.kills = 1;
    player.cashoutPct = 0;
    player.cashoutProgress = 4;
    player.cashingOut = false;
    player.x = WORLD_WIDTH * 0.58;
    player.y = WORLD_HEIGHT * 0.44;
    player.angle = -0.28;
    const featherBaseX = clamp(player.x + 220, 160, WORLD_WIDTH - 160);
    const featherBaseY = clamp(player.y, 160, FLOOR_CLAMP_Y - 80);
    playersRef.current.delete(BOT_ID);
    orbsRef.current.clear();
    for (let i = 0; i < 4; i += 1) {
      const angle = (Math.PI * 2 * i) / 4;
      orbsRef.current.set(`demo-orb-${i}`, {
        id: `demo-orb-${i}`,
        x: featherBaseX + Math.cos(angle) * 30,
        y: featherBaseY + Math.sin(angle) * 30,
        vx: 0,
        vy: 0,
        valueLamports: 0,
        birdType: 'red',
        settled: true,
        demoUsd: 0.5,
      });
    }
    inputRef.current.shooting = false;
    inputRef.current.boosting = false;
    inputRef.current.cashingOut = false;
    setPlayersVersion((v) => v + 1);
    setInstruction('collect_intro', { paused: true });
  }, [cancelCinematics, setInstruction]);

  const restartCashoutBeat = useCallback(() => {
    cancelCinematics();
    borderDeathPendingRef.current = false;
    const player = playersRef.current.get(PLAYER_ID);
    if (!player) return;
    playersRef.current.delete(BOT_ID);
    orbsRef.current.clear();
    player.alive = true;
    player.health = PLAYER_MAX_HP;
    player.balance = 3;
    player.kills = 1;
    player.cashoutPct = 0;
    player.cashoutProgress = 4;
    player.cashingOut = false;
    player.x = WORLD_WIDTH * 0.52;
    player.y = WORLD_HEIGHT * 0.45;
    player.angle = -0.1;
    gameRef.current.cashoutMs = 0;
    inputRef.current.shooting = false;
    inputRef.current.boosting = false;
    inputRef.current.cashingOut = false;
    setPlayersVersion((v) => v + 1);
    setInstruction(
      'cashout_intro',
      { paused: true, pointer: { kind: 'selector', selector: '.mobile-cashout-button', fallbackXPct: 0.82, fallbackYPct: 0.85 } },
    );
  }, [cancelCinematics, setInstruction]);

  const handleDemoDeath = useCallback(async (origin = 'unknown') => {
    if (!enabled || isComplete) return false;
    borderDeathPendingRef.current = false;
    const activeScene = sceneRef.current;
    if (!SCENE_ORDER.includes(activeScene)) return false;
    if (demoDebug) {
      console.info(`[DEMO] death detected in scene ${activeScene}`, { origin });
    }
    if (activeScene === 'fight' || activeScene === 'fight_intro' || activeScene === 'border_intro') {
      return resetFightScene(origin);
    }
    if (activeScene === 'collect' || activeScene === 'collect_intro') {
      restartCollectBeat();
      return true;
    }
    if (activeScene === 'cashout' || activeScene === 'cashout_intro' || activeScene === 'done') {
      restartCashoutBeat();
      return true;
    }
    return false;
  }, [enabled, isComplete, resetFightScene, restartCollectBeat, restartCashoutBeat, demoDebug]);

  const completeDemoSecurely = useCallback(async () => {
    if (buttonBusy) return;
    setButtonBusy(true);
    try {
      const token = await getAuthToken?.();
      if (!token) throw new Error('Missing auth token');
      const response = await fetch(`/api/onboarding/complete?version=${encodeURIComponent(DEMO_VERSION)}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Failed to complete tutorial');
      }
      const data = await response.json().catch(() => ({}));
      if (!data?.ok || !data?.demo_play) {
        throw new Error('Tutorial completion not persisted');
      }
      setIsComplete(true);
      onExitToMenu?.({ completedRemotely: true });
    } catch (err) {
      console.error('[demo] completion failed', err);
      setIsComplete(false);
      onExitToMenu?.({ completedRemotely: false });
    } finally {
      setButtonBusy(false);
    }
  }, [buttonBusy, getAuthToken, onExitToMenu]);

  const tryAdvanceAfterTyping = useCallback(() => {
    const introBypass = scene === 'intro';
    if (!isTypingComplete || (!audioDone && !introBypass)) return;
    const shownAt = Number(gameRef.current.sceneTextShownAt || 0);
    if (!shownAt || performance.now() - shownAt < MIN_SCENE_TEXT_MS) return;
    // Fire intro must wait for explicit "Next".
    if (scene === 'fire_intro') {
      setShowActionButton(true);
      setActionButtonLabel('Next');
      return;
    }
    if (scene === 'intro') {
      if (!audioDone) setAudioDone(true);
      setShowActionButton(true);
      setActionButtonLabel('Next');
      return;
    }
    if (scene === 'done') {
      setShowActionButton(true);
      return;
    }
    if (scene === 'border_intro') {
      if (autoAdvanceRef.current === scene) return;
      autoAdvanceRef.current = scene;
      playBorderWarningCutscene();
      return;
    }
    if (scene === 'fight_intro') {
      if (autoAdvanceRef.current === scene) return;
      autoAdvanceRef.current = scene;
      playFightIntroCutscene();
      return;
    }
    if (scene === 'collect_intro') {
      if (autoAdvanceRef.current === scene) return;
      autoAdvanceRef.current = scene;
      setOverlayVisible(false);
      setPaused(false);
      setInputLocked(false);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('flappy:resetInputLatch', { detail: { reason: 'enter_collect' } }));
      }
      if (demoDebug) {
        console.info('[DEMO] enemyKilled -> advancing to collect scene');
      }
      setScene('collect');
      return;
    }
    if (scene === 'cashout_intro') {
      if (autoAdvanceRef.current === scene) return;
      autoAdvanceRef.current = scene;
      setOverlayVisible(false);
      setPaused(false);
      setInputLocked(false);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('flappy:resetInputLatch', { detail: { reason: 'enter_cashout' } }));
      }
      setScene('cashout');
      return;
    }
  }, [isTypingComplete, audioDone, scene, playBorderWarningCutscene, playFightIntroCutscene, demoDebug]);

  useEffect(() => {
    if (!enabled || isComplete) return;
    if (!demoStartedRef.current) {
      demoStartedRef.current = true;
      if (demoDebug) {
        console.info('[DEMO] start called');
      }
    }
    if (!voiceManagerRef.current) {
      voiceManagerRef.current = createDemoVoiceManager();
    }
  }, [enabled, isComplete, demoDebug]);

  useEffect(() => {
    if (!enabled || isComplete) return;
    const unlockAndRetry = async () => {
      const voice = voiceManagerRef.current;
      if (!voice) return;
      const unlocked = await voice.initUnlock();
      if (!unlocked) return;
      if (demoDebug) {
        console.info('[DEMO VO] audio unlocked');
      }
    };
    window.addEventListener('flappy:audioUnlock', unlockAndRetry);
    window.addEventListener('pointerdown', unlockAndRetry, { passive: true, capture: true });
    window.addEventListener('touchstart', unlockAndRetry, { passive: true, capture: true });
    return () => {
      window.removeEventListener('flappy:audioUnlock', unlockAndRetry);
      window.removeEventListener('pointerdown', unlockAndRetry, { capture: true });
      window.removeEventListener('touchstart', unlockAndRetry, { capture: true });
    };
  }, [enabled, isComplete, demoDebug]);

  useEffect(() => {
    if (!enabled || isComplete) return;
    const prompt = DEMO_SCENE_PROMPT_BY_ID.get(scene);
    const rawQueue = getSceneAudioQueue(prompt);
    if (!overlayVisible || rawQueue.length === 0) {
      setAudioDone(true);
      return;
    }
    const voicePromptKey = `${promptId}:${rawQueue.join('|')}`;
    if (voiceStartedPromptRef.current === voicePromptKey) {
      return;
    }
    voiceStartedPromptRef.current = voicePromptKey;
    const voice = voiceManagerRef.current;
    if (!voice) return;
    const runToken = ++voicePlayTokenRef.current;
    setAudioDone(false);
    markDemoMetric('audioTriggers');
    if (demoDebug) {
      console.info(`[DEMO VO] scene=${scene} queue=${rawQueue.join(',')}`);
      console.info('[DEMO VO] gating', { audioComplete: false, typewriterComplete: isTypingComplete });
    }
    const play = async () => {
      let watchdog = null;
      const clearWatchdog = () => {
        if (watchdog) {
          clearTimeout(watchdog);
          watchdog = null;
        }
      };
      if (!voice.isUnlocked()) {
        const unlocked = await voice.initUnlock();
        if (!unlocked) {
          if (runToken !== voicePlayTokenRef.current) return;
          setAudioDone(true);
          return;
        }
      }
      try {
        const resolvedQueue = rawQueue;
        watchdog = setTimeout(() => {
          if (runToken !== voicePlayTokenRef.current) return;
          voice.stop();
          setAudioDone(true);
          if (demoDebug) {
            console.warn('[DEMO VO] watchdog timeout -> force complete', { scene, queue: resolvedQueue });
          }
        }, 25000);
        await voice.playSceneNarration(resolvedQueue, {
          log: demoDebug
            ? (phase, clip) => console.info(`[DEMO VO] ${phase} ${clip}`, { t: Math.round(performance.now()) })
            : null,
          onGap: demoDebug
            ? (gapMs, clip) => console.info(`[DEMO VO] gap->${clip}`, { gapMs: Number(gapMs.toFixed(1)) })
            : null,
        });
        if (runToken !== voicePlayTokenRef.current) return;
        clearWatchdog();
        if (demoDebug) console.info('[DEMO VO] narrationComplete=true', { scene, queue: resolvedQueue });
        setAudioDone(true);
        if (demoDebug) {
          console.info('[DEMO VO] gating', { audioComplete: true, typewriterComplete: isTypingComplete });
        }
      } catch (error) {
        if (runToken !== voicePlayTokenRef.current) return;
        clearWatchdog();
        setAudioDone(true);
        if (demoDebug) {
          console.warn('[DEMO VO] failed', { scene, queue: rawQueue, error: error?.message || error });
        }
      }
    };
    void play();
    return () => {
      if (runToken === voicePlayTokenRef.current) {
        voice.stop();
      }
    };
  }, [enabled, isComplete, overlayVisible, scene, promptId, markDemoMetric, demoDebug]);

  useEffect(() => {
    if (!enabled || isComplete) return;
    clearTimeout(typeTimerRef.current);
    const source = instructionText || '';
    if (!source) {
      setTypedText('');
      setTypingDone(true);
      markDemoMetric('overlaySetState', 2);
      return;
    }
    let i = 0;
    const tick = () => {
      i += 2;
      setTypedText(source.slice(0, i));
      markDemoMetric('overlaySetState');
      if (i >= source.length) {
        setTypingDone(true);
        markDemoMetric('overlaySetState');
        return;
      }
      typeTimerRef.current = setTimeout(tick, TYPE_INTERVAL_MS);
    };
    setTypingDone(false);
    setTypedText('');
    markDemoMetric('overlaySetState', 2);
    typeTimerRef.current = setTimeout(tick, TYPE_INTERVAL_MS);
    return () => clearTimeout(typeTimerRef.current);
  }, [enabled, instructionText, promptId, isComplete, markDemoMetric]);

  useEffect(() => {
    if (!enabled || isComplete) return;
    tryAdvanceAfterTyping();
  }, [enabled, isComplete, isTypingComplete, scene, tryAdvanceAfterTyping]);

  useEffect(() => {
    if (!enabled || isComplete) return undefined;
    if (!isTypingComplete) return undefined;
    const shownAt = Number(gameRef.current.sceneTextShownAt || 0);
    if (!shownAt) return undefined;
    const elapsed = performance.now() - shownAt;
    if (elapsed >= MIN_SCENE_TEXT_MS) return undefined;
    const waitMs = Math.max(0, MIN_SCENE_TEXT_MS - elapsed);
    const timer = setTimeout(() => {
      tryAdvanceAfterTyping();
    }, waitMs + 20);
    return () => clearTimeout(timer);
  }, [enabled, isComplete, isTypingComplete, scene, tryAdvanceAfterTyping]);

  useEffect(() => {
    return () => {
      cancelCinematics();
      if (gameRef.current.fireLoopActive && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('flappy:mobileFireStop'));
      }
      gameRef.current.fireLoopActive = false;
      voiceManagerRef.current?.stop?.();
    };
  }, [cancelCinematics]);

  useEffect(() => {
    if (!enabled || isComplete) return;
    if (onboardingStartedRef.current) return;
    onboardingStartedRef.current = true;
    (async () => {
      try {
        const token = await getAuthToken?.();
        if (!token) return;
        await fetch(`/api/onboarding/start?version=${encodeURIComponent(DEMO_VERSION)}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch (err) {
        console.error('[demo] start update failed', err);
      }
    })();
  }, [enabled, isComplete, getAuthToken]);

  const updateInputTelemetry = useCallback((sample) => {
    const now = performance.now();
    const t = inputTelemetryRef.current;
    const angle = Number(sample?.angle);
    const throttle = clamp(Number(sample?.throttle) || 0, 0, 1);
    const boosting = !!sample?.boosting;
    const shooting = !!sample?.shooting;
    const cashingOut = !!sample?.cashingOut;
    if (throttle > 0.12) t.lastMoveAt = now;
    if (boosting) t.lastBoostAt = now;
    if (shooting) t.lastFireAt = now;
    if (cashingOut) t.lastCashoutAt = now;
    if (Number.isFinite(angle)) {
      const delta = Math.abs(normalizeAngle(angle - t.lastAngle));
      t.turnAccum = Math.max(0, t.turnAccum * 0.92) + delta;
      if (delta > 0.06) t.lastTurnAt = now;
      t.lastAngle = angle;
    }
    return t;
  }, []);

  const maybeUnlockPromptByInput = useCallback((sample, source = 'unknown') => {
    if (!enabled || isComplete) return;
    if (!SCENE_ALLOW_PROMPT_INPUT.has(sceneRef.current)) return;
    if (!isTypingComplete || !audioDone) return;
    const shownAt = Number(gameRef.current.sceneTextShownAt || 0);
    if (!shownAt || performance.now() - shownAt < MIN_SCENE_TEXT_MS) return;

    const throttle = clamp(Number(sample?.throttle) || 0, 0, 1);
    const boosting = !!sample?.boosting;
    const requirement = SCENE_REQUIREMENT[sceneRef.current] || null;
    const movementReady = throttle > 0.12;
    const requirementReady = requirement === 'boost' ? (movementReady && boosting) : movementReady;
    if (!requirementReady) return;

    gameRef.current.touchHeldInRegion = true;
    gameRef.current.awaitInputRelease = false;
    setOverlayVisible(false);
    setPaused(false);
    setInputLocked(false);
    if (demoDebug) {
      console.info('[DEMO] prompt unlocked by input', {
        scene: sceneRef.current,
        source,
        requirement,
        throttle: Number(throttle.toFixed(3)),
        boosting: boosting ? 1 : 0,
      });
    }
  }, [enabled, isComplete, isTypingComplete, audioDone, demoDebug]);

  const sendInput = useCallback((angle, shooting, boosting, cashingOut, pausedFromCanvas = false, throttle = 1) => {
    inputRef.current.angle = angle;
    inputRef.current.shooting = !!shooting;
    inputRef.current.boosting = !!boosting;
    inputRef.current.cashingOut = !!cashingOut;
    inputRef.current.paused = !!pausedFromCanvas;
    inputRef.current.throttle = clamp(Number(throttle) || 0, 0, 1);
    updateInputTelemetry({ angle, shooting, boosting, cashingOut, throttle });
    if (typeof window !== 'undefined') {
      if (shooting && !gameRef.current.fireLoopActive) {
        gameRef.current.fireLoopActive = true;
        window.dispatchEvent(new CustomEvent('flappy:mobileFireStart'));
      } else if (!shooting && gameRef.current.fireLoopActive) {
        gameRef.current.fireLoopActive = false;
        window.dispatchEvent(new CustomEvent('flappy:mobileFireStop'));
      }
    }

    if (!enabled || isComplete) return;
    // Prompt scenes are hard-frozen; do not progress action milestones while locked.
    if (paused || inputLocked) return;
    const requirement = SCENE_REQUIREMENT[scene] || null;
    if (requirement === 'move' && inputRef.current.throttle > 0.12) {
      gameRef.current.moveHoldMs += 33;
      if (gameRef.current.moveHoldMs >= 5000) {
        setInstruction('move_drag', {
          paused: false,
          pointer: { kind: 'region', xPct: 0.56, yPct: 0.4 },
        });
        gameRef.current.dragMs = 0;
        gameRef.current.dragDirectionDelta = 0;
      }
    }
    if (requirement === 'turn' && inputRef.current.throttle > 0.12) {
      gameRef.current.dragMs += 33;
      const da = Math.abs(normalizeAngle(angle - (gameRef.current.lastDragAngle ?? angle)));
      gameRef.current.dragDirectionDelta += da;
      gameRef.current.lastDragAngle = angle;
      if (gameRef.current.dragMs >= 5000 && gameRef.current.dragDirectionDelta > 1.1) {
        setInstruction('move_boost', {
          paused: false,
          pointer: { kind: 'region', xPct: 0.62, yPct: 0.35 },
        });
      }
    }
    if (requirement === 'boost' && inputRef.current.throttle > 0.15 && inputRef.current.boosting) {
      gameRef.current.boostMs += 33;
      if (gameRef.current.boostMs >= 5000) {
        setInstruction('fire_intro', {
          paused: false,
          pointer: { kind: 'selector', selector: '.mobile-fire-button', fallbackXPct: 0.86, fallbackYPct: 0.78 },
        });
      }
    }
    if (requirement === 'fire' && shooting) {
      gameRef.current.firePracticeMs += 33;
      if (gameRef.current.firePracticeMs >= 5000) {
        setInstruction('border_intro', { paused: true });
      }
    }
  }, [enabled, isComplete, scene, paused, inputLocked, setInstruction, updateInputTelemetry]);

  const handleActionButton = useCallback(() => {
    if (scene !== 'done' && (!isTypingComplete || !audioDone)) return;
    playUiClick();
    if (scene === 'intro') {
      setInstruction('move_hold', {
        paused: false,
        inputLocked: false,
        pointer: { kind: 'region', xPct: 0.68, yPct: 0.32 },
      });
      setShowActionButton(false);
      return;
    }
    if (scene === 'fire_intro') {
      setShowActionButton(false);
      gameRef.current.firePracticeMs = 0;
      setOverlayVisible(false);
      setPaused(false);
      setInputLocked(false);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('flappy:resetInputLatch', { detail: { reason: 'resume_fire_intro' } }));
      }
      return;
    }
    if (scene === 'done') {
      void completeDemoSecurely();
    }
  }, [scene, setInstruction, completeDemoSecurely, isTypingComplete, audioDone, playUiClick]);

  useEffect(() => {
    if (!enabled || isComplete) return undefined;
    const onTouch = (event) => {
      if (!SCENE_ALLOW_PROMPT_INPUT.has(sceneRef.current)) return;
      const detail = event?.detail || {};
      if (detail?.type !== 'down' && detail?.type !== 'move') return;
      maybeUnlockPromptByInput({ throttle: 1, boosting: false, angle: inputRef.current.angle }, 'touch');
    };
    window.addEventListener('flappy:demoTouch', onTouch);
    return () => window.removeEventListener('flappy:demoTouch', onTouch);
  }, [enabled, isComplete, maybeUnlockPromptByInput]);

  useEffect(() => {
    if (!enabled || isComplete) return undefined;
    const onInputIntent = (event) => {
      const detail = event?.detail || {};
      updateInputTelemetry(detail);
      maybeUnlockPromptByInput(detail, detail.source || 'intent');
    };
    window.addEventListener('flappy:demoInputIntent', onInputIntent);
    return () => window.removeEventListener('flappy:demoInputIntent', onInputIntent);
  }, [enabled, isComplete, maybeUnlockPromptByInput, updateInputTelemetry]);

  useEffect(() => {
    if (!enabled || isComplete) return;
    const loop = (now) => {
      markDemoMetric('loopTicks');
      const state = gameRef.current;
      const dt = clamp(now - (state.lastAt || now), 0, 60);
      state.lastAt = now;

      const player = playersRef.current.get(PLAYER_ID);
      if (player) {
        player.name = username || player.name;
        player.paused = paused;
      }
      const bot = playersRef.current.get(BOT_ID);
      if (bot) bot.paused = paused;

      if (!paused && player?.alive) {
        player.angle = lerpAngle(player.angle, inputRef.current.angle, 0.2);
        const throttle = clamp(inputRef.current.throttle, 0, 1);
        const boostingNow = inputRef.current.boosting && throttle > 0.1 && player.boost > 0;
        player.shooting = !!inputRef.current.shooting;
        player.boosting = boostingNow;
        if (boostingNow) {
          player.boost = clamp(player.boost - (BOOST_DRAIN_PER_SEC * dt) / 1000, 0, 100);
          if (player.boost <= 0) player.boostDepleted = true;
        } else {
          player.boost = clamp(player.boost + (BOOST_REGEN_PER_SEC * dt) / 1000, 0, 100);
          if (player.boost > 5) player.boostDepleted = false;
        }
        const speed = boostingNow ? BOOST_SPEED : PLAYER_SPEED;
        if (throttle > 0.02) {
          player.x += Math.cos(player.angle) * speed * throttle * dt;
          player.y += Math.sin(player.angle) * speed * throttle * dt;
        }
        player.x = clamp(player.x, 120, WORLD_WIDTH - 120);
        player.y = clamp(player.y, 120, FLOOR_CLAMP_Y);
        player.onGround = player.y >= FLOOR_CLAMP_Y - 0.5;
      }

      const borderWarningUnlocked = SCENE_ORDER.indexOf(sceneRef.current) >= SCENE_ORDER.indexOf('border_intro');
      if (player?.alive && borderWarningUnlocked) {
        const hitBorder =
          player.x <= BORDER_MARGIN ||
          player.x >= WORLD_WIDTH - BORDER_MARGIN ||
          player.y <= BORDER_MARGIN;
        if (hitBorder && !borderDeathPendingRef.current) {
          borderDeathPendingRef.current = true;
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('flappy:anyDeath', {
              detail: {
                x: player.x,
                y: player.y,
                playerId: PLAYER_ID,
                birdType: player.birdType || 'yellow',
                reason: 'border',
                hpBefore: player.health ?? null,
                hpAfter: 0,
                deathTick: Date.now(),
                sourceEvent: 'demo:border',
              },
            }));
          }
          player.alive = false;
          setPaused(true);
          setInputLocked(true);
          const timer = setTimeout(() => {
            void handleDemoDeath('border_collision');
          }, BORDER_IMPACT_FREEZE_MS);
          cinematicTimersRef.current.push(timer);
        }
      }

      if (scene === 'fight' && bot?.alive && player?.alive && !paused) {
        const targetAngle = Math.atan2(player.y - bot.y, player.x - bot.x);
        bot.angle = lerpAngle(bot.angle, targetAngle, 0.16);
        const strafe = Math.cos(now * (BOT_WEAVE_FREQ * 0.85)) * 0.22;
        const nextX = bot.x + (Math.cos(bot.angle) + strafe) * BOT_SPEED * dt;
        const weaveY = (bot.baseY || bot.y) + Math.sin(now * BOT_WEAVE_FREQ) * BOT_WEAVE_AMPLITUDE;
        const chaseY = bot.y + Math.sin(bot.angle) * BOT_SPEED * dt * 0.65;
        bot.x = clamp(nextX, 120, WORLD_WIDTH - 120);
        bot.y = clamp((weaveY * 0.55) + (chaseY * 0.45), 120, FLOOR_CLAMP_Y);
        bot.onGround = bot.y >= FLOOR_CLAMP_Y - 0.5;
        if (now >= (state.botNextBurstAt || 0)) {
          state.botBurstUntil = now + BOT_BURST_MS;
          const cooldown = BOT_BURST_PAUSE_MIN_MS + Math.random() * (BOT_BURST_PAUSE_MAX_MS - BOT_BURST_PAUSE_MIN_MS);
          state.botNextBurstAt = state.botBurstUntil + cooldown;
        }
        const botInBurst = now < (state.botBurstUntil || 0);
        bot.shooting = botInBurst;
        if (botInBurst && now - state.botLastShotAt >= BOT_SHOT_INTERVAL_MS && dist(bot, player) < 1200) {
          state.botLastShotAt = now;
          markDemoMetric('shotEvents');
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('flappy:shot', {
              detail: {
                x: bot.x,
                y: bot.y,
                ownerId: BOT_ID,
                timestamp: Date.now(),
              },
            }));
          }
          if (demoDebug) {
            console.info('[SRV] spawnBullet', { shooter: BOT_ID, x: Math.round(bot.x), y: Math.round(bot.y) });
          }
          player.health = clamp(player.health - BOT_DAMAGE, 0, PLAYER_MAX_HP);
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('flappy:playerHit', {
              detail: {
                playerId: PLAYER_ID,
                attackerId: BOT_ID,
                x: player.x,
                y: player.y,
              },
            }));
          }
          if (player.health <= 0) {
            player.alive = false;
            void handleDemoDeath('loop_hp_zero');
          }
        }
        if (inputRef.current.shooting && now - state.playerLastShotAt >= SHOT_INTERVAL_MS) {
          state.playerLastShotAt = now;
          markDemoMetric('shotEvents');
          if (demoDebug) {
            console.info('[SRV] spawnBullet', { shooter: PLAYER_ID, x: Math.round(player.x), y: Math.round(player.y) });
          }
          const d = dist(player, bot);
          const aimErr = Math.abs(normalizeAngle(Math.atan2(bot.y - player.y, bot.x - player.x) - player.angle));
          if (d < 1400 && aimErr < 0.45) {
            bot.health = clamp(bot.health - 1, 0, BOT_MAX_HP);
            bot.hitAt = now;
            markDemoMetric('hitEvents');
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('flappy:playerHit', {
                detail: {
                  playerId: BOT_ID,
                  attackerId: PLAYER_ID,
                  x: bot.x,
                  y: bot.y,
                  hitFlashUntil: now + DEMO_HIT_FLASH_MS,
                },
              }));
            }
          }
          if (bot.health <= 0) {
            bot.alive = false;
            bot.shooting = false;
            player.kills += 1;
            if (demoDebug) {
              console.info('[SRV] entityKilled', { id: BOT_ID, by: PLAYER_ID });
            }
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('flappy:anyDeath', {
                detail: {
                  x: bot.x,
                  y: bot.y,
                  playerId: BOT_ID,
                  birdType: 'red',
                  hpBefore: 1,
                  hpAfter: 0,
                  deathTick: Date.now(),
                  sourceEvent: 'demo:fight',
                },
              }));
            }
            const featherBaseX = bot.x + 40;
            const featherBaseY = bot.y + 24;
            for (let i = 0; i < 4; i += 1) {
              const angle = (Math.PI * 2 * i) / 4;
              orbsRef.current.set(`demo-orb-${i}`, {
                id: `demo-orb-${i}`,
                x: featherBaseX + Math.cos(angle) * 30,
                y: featherBaseY + Math.sin(angle) * 30,
                vx: 0,
                vy: 0,
                valueLamports: 0,
                birdType: 'red',
                settled: true,
                demoUsd: 0.5,
              });
            }
            if (demoDebug) {
              console.info('[DROP] spawned', {
                id: 'demo-orb-*',
                value: 2,
                x: Math.round(featherBaseX),
                y: Math.round(featherBaseY),
              });
            }
            setPaused(false);
            setOverlayVisible(false);
            setTimeout(() => {
              setPaused(true);
              setInstruction(
                'collect_intro',
                { paused: true },
              );
            }, 420);
          }
        }
      }

      if (scene === 'collect' && player?.alive) {
        let collected = false;
        let pickupX = null;
        let pickupY = null;
        let pickupCount = 0;
        orbsRef.current.forEach((orb, key) => {
          if (!String(key).startsWith('demo-orb-')) return;
          if (dist(player, orb) < 74) {
            orbsRef.current.delete(key);
            pickupCount += 1;
            if (pickupX == null || pickupY == null) {
              pickupX = orb.x;
              pickupY = orb.y;
            }
            if (demoDebug) {
              console.info('[DROP] pickedUp', { id: key });
            }
            collected = true;
          }
        });
        if (collected && typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('flappy:orbsCollected', {
            detail: {
              playerId: PLAYER_ID,
              orbCount: pickupCount || 1,
              x: pickupX ?? player.x,
              y: pickupY ?? player.y,
            },
          }));
        }
        if (collected) {
          orbsRef.current.clear();
          player.balance = 3;
          if (demoDebug) {
            console.info('[DROP] pickedUp complete', { newMoney: player.balance });
          }
          state.collected = true;
          setInstruction(
            'cashout_intro',
            {
              paused: true,
              pointer: { kind: 'selector', selector: '.mobile-cashout-button', fallbackXPct: 0.82, fallbackYPct: 0.85 },
            },
          );
        }
      }

      if (scene === 'cashout' && player?.alive) {
        if (inputRef.current.cashingOut) {
          state.cashoutMs += dt;
          player.cashingOut = true;
          player.cashoutPct = clamp(state.cashoutMs / CASHOUT_HOLD_MS, 0, 1);
          player.cashoutProgress = clamp(4 - Math.floor(player.cashoutPct * 4), 0, 4);
          if (state.cashoutMs >= CASHOUT_HOLD_MS) {
            setPaused(true);
            setInputLocked(true);
            player.cashingOut = false;
            player.cashoutPct = 1;
            setInstruction(
              'done',
              { paused: true, buttonLabel: 'Main Menu' },
            );
          }
        } else {
          state.cashoutMs = 0;
          player.cashingOut = false;
          player.cashoutPct = 0;
          player.cashoutProgress = 4;
        }
      }

      const rows = Array.from(playersRef.current.values())
        .filter((p) => p?.alive && String(p?.name || '').trim())
        .map((p) => ({ id: p.id, username: p.name, balance: Number(p.balance || 0) }))
        .sort((a, b) => (b.balance - a.balance) || String(a.id).localeCompare(String(b.id)));
      const signature = rows.map((row) => `${row.id}:${row.username}:${row.balance}`).join('|');
      if (signature !== leaderboardSignatureRef.current || now >= nextLeaderboardSyncAtRef.current) {
        leaderboardSignatureRef.current = signature;
        nextLeaderboardSyncAtRef.current = now + LEADERBOARD_SYNC_INTERVAL_MS;
        setSessionLeaderboardRows(rows);
        markDemoMetric('overlaySetState');
      }
      if (now >= nextPlayerSyncAtRef.current) {
        nextPlayerSyncAtRef.current = now + PLAYER_SYNC_INTERVAL_MS;
        setPlayersVersion((v) => v + 1);
        markDemoMetric('overlaySetState');
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [enabled, isComplete, paused, scene, username, setInstruction, handleDemoDeath, markDemoMetric, demoDebug]);

  useEffect(() => {
    if (!enabled || isComplete) return;
    resetCoreState();
    const introPrompt = DEMO_SCENE_PROMPT_BY_ID.get('intro');
    setScene('intro');
    setInstructionText(introPrompt?.text || '');
    setTypedText('');
    setTypingDone(false);
    setAudioDone(false);
    setOverlayVisible(true);
    setInputLocked(true);
    setShowActionButton(false);
    setActionButtonLabel('');
    setPointerTarget(null);
    setPaused(true);
    gameRef.current.sceneTextShownAt = performance.now();
  }, [enabled, isComplete, resetCoreState]);

  useEffect(() => {
    if (!enabled || isComplete) return undefined;
    const onDemoCashoutHold = (event) => {
      if (sceneRef.current !== 'cashout' && sceneRef.current !== 'cashout_intro') return;
      const active = !!event?.detail?.active;
      inputRef.current.cashingOut = active;
      if (import.meta.env.DEV && demoDebug) {
        console.info('[DEMO] cashout hold', { active: active ? 1 : 0 });
      }
    };
    const onDemoConfirm = (event) => {
      const canAdvance = overlayVisible && isTypingComplete && audioDone && !!showActionButton && !buttonBusy;
      if (import.meta.env.DEV && demoDebug) {
        console.info('[DEMO] controller confirm', {
          scene: sceneRef.current,
          accepted: canAdvance ? 1 : 0,
          overlayVisible: overlayVisible ? 1 : 0,
          typingDone: isTypingComplete ? 1 : 0,
          audioDone: audioDone ? 1 : 0,
          showActionButton: showActionButton ? 1 : 0,
          source: event?.detail?.source || 'unknown',
        });
      }
      if (!canAdvance) return;
      handleActionButton();
    };
    window.addEventListener('flappy:demoCashoutHold', onDemoCashoutHold);
    window.addEventListener('flappy:demoConfirm', onDemoConfirm);
    return () => {
      window.removeEventListener('flappy:demoCashoutHold', onDemoCashoutHold);
      window.removeEventListener('flappy:demoConfirm', onDemoConfirm);
    };
  }, [enabled, isComplete, demoDebug, overlayVisible, isTypingComplete, audioDone, showActionButton, buttonBusy, handleActionButton]);

  const gameProps = useMemo(() => ({
    myPlayerId: PLAYER_ID,
    config,
    pipes: [],
    playersRef,
    bulletsRef,
    orbsRef,
    currentBorderMargin: 180,
    sendInput,
    sessionLeaderboardRows,
    paused,
    cameraOverride: cameraOverrideRef.current,
    cashoutUiUnlocked,
  }), [config, sendInput, sessionLeaderboardRows, paused, cameraOverrideVersion, cashoutUiUnlocked]);

  return {
    isComplete,
    isActive: enabled && !isComplete,
    inputLocked,
    scene,
    wantsOverrideDeath: enabled && !isComplete,
    handleDemoDeath,
    gameProps,
    overlay: {
      visible: overlayVisible,
      typedText,
      sceneText: instructionText || 'SCENE TEXT MISSING - CHECK useDemoController',
      promptId,
      currentSceneId: promptId || scene || 'missing',
      sceneIndex: SCENE_ORDER.indexOf(scene),
      typingProgress: `${(typedText || '').length}/${(instructionText || '').length}`,
      isTypingComplete,
      audioState: audioDone ? 'complete' : (voiceManagerRef.current?.isUnlocked?.() ? 'playing' : 'locked'),
      audioComplete: audioDone,
      isPaused: paused,
      showActionButton: !!showActionButton,
      actionButtonLabel,
      onAction: handleActionButton,
      pointerTarget,
      isBusy: buttonBusy,
    },
  };
}
