import { createPortal } from 'react-dom';
import { usePrivy } from '@privy-io/react-auth';

export default function MobileAuthLogoutPanel() {
  const { ready, authenticated, logout } = usePrivy();

  if (!ready || !authenticated || typeof document === 'undefined') return null;

  return createPortal(
    <div className="mobile-auth-logout-panel">
      <button
        type="button"
        className="mobile-auth-logout-btn"
        onClick={() => logout()}
        title="Log out"
      >
        LOG OUT
      </button>
    </div>,
    document.body,
  );
}
