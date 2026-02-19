import { useEffect, useMemo, useRef, useState } from 'react';
import './DemoOverlay.css';

// Scenes where the yellow pointer is only useful on mobile (touch targets).
const TOUCH_ONLY_POINTER_SCENES = new Set(['fire_intro', 'cashout_intro']);

function resolvePointerPosition(target, containerRect) {
  const bounds = containerRect && Number.isFinite(containerRect.width) && Number.isFinite(containerRect.height) && containerRect.width > 0 && containerRect.height > 0
    ? containerRect
    : {
      left: 0,
      top: 0,
      width: window.innerWidth,
      height: window.innerHeight,
    };
  if (!target) return null;
  if (target.kind === 'selector' && target.selector) {
    const el = document.querySelector(target.selector);
    if (el) {
      const rect = el.getBoundingClientRect();
      return {
        left: rect.left + rect.width / 2,
        top: rect.top + rect.height / 2,
      };
    }
  }
  if (target.kind === 'region') {
    return {
      left: Math.round(bounds.left + bounds.width * (target.xPct || 0.5)),
      top: Math.round(bounds.top + bounds.height * (target.yPct || 0.5)),
    };
  }
  return {
    left: Math.round(bounds.left + bounds.width * (target.fallbackXPct || 0.5)),
    top: Math.round(bounds.top + bounds.height * (target.fallbackYPct || 0.5)),
  };
}

export default function DemoOverlay({
  visible,
  text,
  promptId = '',
  currentSceneId = '',
  sceneIndex = -1,
  sceneTextLength = 0,
  typingProgress = '0/0',
  isTypingComplete = false,
  audioComplete = false,
  audioState = 'unknown',
  isPaused = false,
  containerRect,
  showActionButton,
  actionButtonLabel,
  onAction,
  pointerTarget,
  isBusy = false,
}) {
  const [pointerPos, setPointerPos] = useState(null);
  const isTouchRef = useRef(
    typeof window !== 'undefined'
      && ((window.matchMedia?.('(pointer: coarse)')?.matches ?? false) || (navigator?.maxTouchPoints || 0) > 0),
  );

  useEffect(() => {
    if (!visible || !pointerTarget) {
      setPointerPos(null);
      return undefined;
    }
    const updatePointer = () => {
      const nextPos = resolvePointerPosition(pointerTarget, containerRect);
      if (!nextPos) return;
      setPointerPos((prev) => {
        if (!prev) return nextPos;
        if (Math.abs(prev.left - nextPos.left) < 1 && Math.abs(prev.top - nextPos.top) < 1) return prev;
        return nextPos;
      });
    };
    updatePointer();
    const interval = setInterval(updatePointer, 120);
    window.addEventListener('resize', updatePointer);
    window.addEventListener('scroll', updatePointer, true);
    return () => {
      clearInterval(interval);
      window.removeEventListener('resize', updatePointer);
      window.removeEventListener('scroll', updatePointer, true);
    };
  }, [visible, pointerTarget, containerRect]);

  const sceneText = useMemo(() => (typeof text === 'string' ? text : ''), [text]);
  const renderedText = sceneText || (isTypingComplete ? 'SCENE TEXT MISSING - CHECK useDemoController' : '');

  const hasAction = !!(showActionButton || actionButtonLabel) && typeof onAction === 'function';
  const shouldRenderAction = !!isTypingComplete && !!audioComplete && hasAction;

  if (!visible) return null;

  return (
    <div className="demo-overlay">
      <div className="demo-overlay__panel" role="dialog" aria-live="polite">
        <div className="demo-overlay__text">{renderedText}</div>
        {shouldRenderAction ? (
          <div className="demo-overlay__actions">
            <button
              type="button"
              className="demo-overlay__button"
              onClick={onAction}
              disabled={isBusy}
            >
              {isBusy ? 'Please wait...' : (actionButtonLabel || 'Next')}
            </button>
          </div>
        ) : null}
      </div>

      {pointerPos && !(TOUCH_ONLY_POINTER_SCENES.has(currentSceneId) && !isTouchRef.current) ? (
        <div className="demo-overlay__pointer" style={{ left: `${pointerPos.left}px`, top: `${pointerPos.top}px` }} aria-hidden="true">
          <div className="demo-overlay__finger" />
          <div className="demo-overlay__pulse" />
        </div>
      ) : null}
    </div>
  );
}
