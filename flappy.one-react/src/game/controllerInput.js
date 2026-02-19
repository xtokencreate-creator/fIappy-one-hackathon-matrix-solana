export const CONTROLLER_BINDINGS = {
  moveXAxis: 0,
  moveYAxis: 1,
  boostButton: 0, // Cross (X)
  cashoutButton: 1, // Circle (O)
  fireButton: 7, // R2
  deadzone: 0.15,
  smoothing: 0.28,
  buttonPressThreshold: 0.35,
  activeTimeoutMs: 900,
};

export function createControllerState() {
  return {
    connected: false,
    index: -1,
    id: '',
    rawX: 0,
    rawY: 0,
    moveX: 0,
    moveY: 0,
    intensity: 0,
    hasDirection: false,
    fire: false,
    boost: false,
    cashout: false,
    isActive: false,
    lastActiveAt: 0,
  };
}

function readButtonValue(gamepad, index) {
  const btn = gamepad?.buttons?.[index];
  if (!btn) return 0;
  if (typeof btn === 'number') return btn;
  if (typeof btn.value === 'number') return btn.value;
  return btn.pressed ? 1 : 0;
}

function applyRadialDeadzone(x, y, deadzone) {
  const mag = Math.hypot(x, y);
  if (mag <= deadzone) {
    return { x: 0, y: 0, intensity: 0, hasDirection: false };
  }
  const scaled = Math.min(1, (mag - deadzone) / (1 - deadzone));
  const nx = x / mag;
  const ny = y / mag;
  return {
    x: nx * scaled,
    y: ny * scaled,
    intensity: scaled,
    hasDirection: scaled > 0.001,
  };
}

function pickGamepad(currentIndex) {
  const pads = navigator.getGamepads ? navigator.getGamepads() : null;
  if (!pads) return null;
  if (currentIndex >= 0 && pads[currentIndex] && pads[currentIndex].connected) {
    return pads[currentIndex];
  }
  for (let i = 0; i < pads.length; i += 1) {
    if (pads[i] && pads[i].connected) return pads[i];
  }
  return null;
}

export function pollControllerInput(state, now, bindings = CONTROLLER_BINDINGS) {
  const gamepad = pickGamepad(state.index);
  if (!gamepad) {
    state.connected = false;
    state.index = -1;
    state.id = '';
    state.rawX = 0;
    state.rawY = 0;
    state.moveX = 0;
    state.moveY = 0;
    state.intensity = 0;
    state.hasDirection = false;
    state.fire = false;
    state.boost = false;
    state.cashout = false;
    state.isActive = false;
    return state;
  }

  state.connected = true;
  state.index = gamepad.index;
  state.id = gamepad.id || '';

  const rawX = Number(gamepad.axes?.[bindings.moveXAxis] || 0);
  const rawY = Number(gamepad.axes?.[bindings.moveYAxis] || 0);
  state.rawX = rawX;
  state.rawY = rawY;

  const deadzoned = applyRadialDeadzone(rawX, rawY, bindings.deadzone);
  const smoothing = Math.max(0, Math.min(1, bindings.smoothing));
  state.moveX += (deadzoned.x - state.moveX) * smoothing;
  state.moveY += (deadzoned.y - state.moveY) * smoothing;
  if (Math.abs(state.moveX) < 0.0005) state.moveX = 0;
  if (Math.abs(state.moveY) < 0.0005) state.moveY = 0;

  const smoothedMag = Math.hypot(state.moveX, state.moveY);
  state.intensity = Math.max(0, Math.min(1, smoothedMag));
  state.hasDirection = state.intensity > 0.01;

  const fireValue = readButtonValue(gamepad, bindings.fireButton);
  const boostValue = readButtonValue(gamepad, bindings.boostButton);
  const cashoutValue = readButtonValue(gamepad, bindings.cashoutButton);
  const threshold = bindings.buttonPressThreshold;
  state.fire = fireValue >= threshold;
  state.boost = boostValue >= threshold;
  state.cashout = cashoutValue >= threshold;

  const hasActiveInput = deadzoned.hasDirection || state.fire || state.boost || state.cashout;
  if (hasActiveInput) {
    state.lastActiveAt = now;
  }
  state.isActive = (now - state.lastActiveAt) <= bindings.activeTimeoutMs;
  return state;
}
