function getConnectedGamepads() {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return [];
  const pads = navigator.getGamepads() || [];
  const connected = [];
  for (let i = 0; i < pads.length; i += 1) {
    const pad = pads[i];
    if (pad && pad.connected) connected.push(pad);
  }
  return connected;
}

function getActuators(gamepad) {
  if (!gamepad) return [];
  const list = [];
  if (gamepad.vibrationActuator) {
    if (typeof gamepad.vibrationActuator.playEffect === 'function') {
      list.push({ kind: 'dual-rumble', node: gamepad.vibrationActuator });
    } else if (typeof gamepad.vibrationActuator.pulse === 'function') {
      list.push({ kind: 'pulse', node: gamepad.vibrationActuator });
    }
  }
  if (Array.isArray(gamepad.hapticActuators)) {
    for (const act of gamepad.hapticActuators) {
      if (!act) continue;
      if (typeof act.playEffect === 'function') {
        list.push({ kind: 'playEffect', node: act });
      } else if (typeof act.pulse === 'function') {
        list.push({ kind: 'pulse', node: act });
      }
    }
  }
  return list;
}

function findBestHapticsPad(gamepads, preferredIndex) {
  const preferred = gamepads.find((p) => p.index === preferredIndex) || null;
  if (preferred && getActuators(preferred).length) return preferred;
  for (const pad of gamepads) {
    if (getActuators(pad).length) return pad;
  }
  return preferred || gamepads[0] || null;
}

export function createHapticsManager({ debug = false } = {}) {
  const state = {
    activeIndex: -1,
    actuators: [],
    support: 'unknown',
    gamepadId: '',
    gamepadMapping: '',
    lastProbeAt: 0,
    shotAt: 0,
    boostAt: 0,
    cashoutAt: 0,
    lastCashoutTick: -1,
    debugLogged: false,
    primeDone: false,
    lastReason: '',
    lastPulseAt: 0,
    lastError: '',
    lastRateBlock: '',
    lastPrimeAt: 0,
  };

  const log = (event, payload = {}) => {
    if (!debug || !import.meta.env.DEV) return;
    console.info(`[HAPTICS] ${event}`, payload);
  };

  const resolveActuators = (force = false) => {
    const now = performance.now();
    if (!force && state.actuators.length && now - state.lastProbeAt < 1000) {
      return state.actuators;
    }
    state.lastProbeAt = now;
    if (typeof window === 'undefined') {
      state.actuators = [];
      state.support = 'no-window';
      return state.actuators;
    }
    if (!window.isSecureContext) {
      state.actuators = [];
      state.support = 'insecure-context';
      return state.actuators;
    }
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') {
      state.actuators = [];
      state.support = 'no-gamepad-api';
      return state.actuators;
    }
    const pads = getConnectedGamepads();
    const primary = findBestHapticsPad(pads, state.activeIndex);
    const resolved = getActuators(primary);
    state.actuators = resolved;
    state.gamepadId = primary?.id || '';
    state.gamepadMapping = primary?.mapping || '';
    state.support = resolved.length ? 'supported' : (primary ? 'no-actuator' : 'no-gamepad');
    if (primary && !state.debugLogged) {
      state.debugLogged = true;
      log('init', {
        secureContext: !!window.isSecureContext,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
        gamepadsConnected: pads.length,
        activeIndex: primary.index,
        gamepadId: primary.id || '',
        connected: !!primary.connected,
        mapping: primary.mapping || '',
        hasVibrationActuator: !!primary.vibrationActuator,
        hasHapticActuator: !!(Array.isArray(primary.hapticActuators) && primary.hapticActuators.length),
        hapticActuatorCount: Array.isArray(primary.hapticActuators) ? primary.hapticActuators.length : 0,
        support: state.support,
        allPads: pads.map((p) => ({
          index: p.index,
          id: p.id || '',
          mapping: p.mapping || '',
          hasVibrationActuator: !!p.vibrationActuator,
          hapticActuatorCount: Array.isArray(p.hapticActuators) ? p.hapticActuators.length : 0,
          actuatorCount: getActuators(p).length,
        })),
      });
    }
    return resolved;
  };

  const play = (label, params, minIntervalMs, stampKey) => {
    const now = performance.now();
    const elapsed = now - state[stampKey];
    if (elapsed < minIntervalMs) {
      state.lastRateBlock = `${label}:${Math.round(elapsed)}/${minIntervalMs}`;
      log('rate-block', { label, elapsedMs: Number(elapsed.toFixed(1)), minIntervalMs });
      return false;
    }
    state[stampKey] = now;
    const actuators = resolveActuators();
    if (!actuators.length) {
      log('no-support', {
        label,
        support: state.support,
        gamepadId: state.gamepadId,
      });
      return false;
    }
    let played = false;
    let lastError = null;
    try {
      for (const actuator of actuators) {
        if (actuator.kind === 'dual-rumble' || actuator.kind === 'playEffect') {
          const effectType = actuator.node?.type || 'dual-rumble';
          let p = null;
          try {
            p = actuator.node.playEffect(effectType, {
              startDelay: 0,
              duration: params.duration,
              weakMagnitude: params.weakMagnitude,
              strongMagnitude: params.strongMagnitude,
            });
          } catch {
            p = actuator.node.playEffect('dual-rumble', {
              startDelay: 0,
              duration: params.duration,
              weakMagnitude: params.weakMagnitude,
              strongMagnitude: params.strongMagnitude,
            });
          }
          if (p && typeof p.catch === 'function') {
            void p.catch((err) => {
              const asyncError = `${err?.name || 'Error'}: ${err?.message || String(err)}`;
              state.lastError = asyncError;
              log('play-failed-async', { label, params, error: asyncError });
            });
          }
          played = true;
          continue;
        }
        if (actuator.kind === 'pulse') {
          const p = actuator.node.pulse(params.strongMagnitude, params.duration);
          if (p && typeof p.catch === 'function') {
            void p.catch((err) => {
              const asyncError = `${err?.name || 'Error'}: ${err?.message || String(err)}`;
              state.lastError = asyncError;
              log('play-failed-async', { label, params, error: asyncError });
            });
          }
          played = true;
        }
      }
    } catch (err) {
      lastError = err;
    }
    if (!played) {
      if (lastError) {
        state.lastError = `${lastError?.name || 'Error'}: ${lastError?.message || String(lastError)}`;
        log('play-failed', { label, params, error: state.lastError });
      }
      return false;
    }
    state.lastReason = label;
    state.lastPulseAt = now;
    state.lastError = '';
    log(label, params);
    return true;
  };

  return {
    setActiveGamepadIndex(index) {
      const next = Number.isInteger(index) ? index : -1;
      if (next === state.activeIndex) return;
      state.activeIndex = next;
      resolveActuators(true);
    },
    primeFromGesture(reason = 'gesture') {
      const now = performance.now();
      const hasAnyHaptics = state.support === 'supported';
      if (state.primeDone && hasAnyHaptics) return false;
      if (state.primeDone && now - state.lastPrimeAt < 3000) return false;
      state.primeDone = true;
      state.lastPrimeAt = now;
      if (debug && import.meta.env.DEV && typeof window !== 'undefined') {
        const pads = getConnectedGamepads();
        const active = findBestHapticsPad(pads, state.activeIndex);
        log('runtime', {
          secureContext: !!window.isSecureContext,
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
          gamepadsConnected: pads.length,
          activeIndex: active?.index ?? null,
          activeId: active?.id || '',
          activeConnected: !!active?.connected,
          activeMapping: active?.mapping || '',
          hasVibrationActuator: !!active?.vibrationActuator,
          vibrationType: active?.vibrationActuator?.type || '',
          hapticActuatorCount: Array.isArray(active?.hapticActuators) ? active.hapticActuators.length : 0,
          selectedActuatorCount: active ? getActuators(active).length : 0,
          allPads: pads.map((p) => ({
            index: p.index,
            id: p.id || '',
            mapping: p.mapping || '',
            hasVibrationActuator: !!p.vibrationActuator,
            hapticActuatorCount: Array.isArray(p.hapticActuators) ? p.hapticActuators.length : 0,
            actuatorCount: getActuators(p).length,
          })),
        });
      }
      resolveActuators(true);
      log('prime', { reason, support: state.support, gamepadId: state.gamepadId });
      return play('PRIME', { duration: 120, weakMagnitude: 0.85, strongMagnitude: 0.85 }, 0, 'shotAt');
    },
    onShot() {
      return play('SHOT', { duration: 30, weakMagnitude: 0.3, strongMagnitude: 0.1 }, debug ? 50 : 70, 'shotAt');
    },
    onBoostStart() {
      return play('BOOST', { duration: 70, weakMagnitude: 0.48, strongMagnitude: 0.12 }, 120, 'boostAt');
    },
    onCashoutTick(secondTick) {
      if (!Number.isFinite(secondTick)) return false;
      if (secondTick === state.lastCashoutTick) return false;
      state.lastCashoutTick = secondTick;
      return play(`CASHOUT_TICK_${secondTick}`, { duration: 45, weakMagnitude: 0.34, strongMagnitude: 0.1 }, 220, 'cashoutAt');
    },
    onCashoutComplete() {
      state.lastCashoutTick = -1;
      return play('CASHOUT_DONE', { duration: 95, weakMagnitude: 0.58, strongMagnitude: 0.22 }, 220, 'cashoutAt');
    },
    resetCashout() {
      state.lastCashoutTick = -1;
    },
    getDebugSnapshot() {
      return {
        support: state.support,
        gamepadId: state.gamepadId,
        mapping: state.gamepadMapping,
        activeIndex: state.activeIndex,
        actuatorCount: state.actuators.length,
        primeDone: state.primeDone,
        lastReason: state.lastReason,
        lastPulseAt: state.lastPulseAt,
        lastError: state.lastError,
        lastRateBlock: state.lastRateBlock,
      };
    },
  };
}
