import { useMemo } from 'react';
import { createPortal } from 'react-dom';
import { usePrivy } from '@privy-io/react-auth';

function getDebugEnabled() {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('authdebug') === '1') return true;
    return window.localStorage.getItem('DEBUG_AUTH_UI') === '1';
  } catch {
    return false;
  }
}

export default function MobileAuthFloatingButton() {
  const { ready, authenticated, login } = usePrivy();
  const debugEnabled = useMemo(() => getDebugEnabled(), []);

  if (!ready || authenticated || typeof document === 'undefined') return null;

  const node = (
    <>
      <button
        type="button"
        className={`mobile-auth-floating-btn${debugEnabled ? ' mobile-auth-floating-btn--debug' : ''}`}
        onClick={() => login()}
        title="Log in"
      >
        LOGIN
      </button>
      {debugEnabled ? (
        <div className="mobile-auth-debug" aria-hidden="true">
          <div>auth floating button active</div>
          <div>position: fixed</div>
          <div>z-index: 999999</div>
          <div>safe-area: top/right + 10px</div>
        </div>
      ) : null}
    </>
  );

  return createPortal(node, document.body);
}
