import { usePrivy } from '@privy-io/react-auth';

export default function PrivyLoginButton({ className = '' }) {
  const { ready, authenticated, user, login, logout } = usePrivy();

  if (!ready) return null;

  return (
    <div className={className} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
      {!authenticated ? (
        <button className="btn btn-outline" onClick={login}>
          Login
        </button>
      ) : (
        <>
          <span style={{ fontSize: 12, opacity: 0.85, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {user?.email?.address ?? 'Logged in'}
          </span>
          <button className="btn btn-outline" onClick={logout}>
            Logout
          </button>
        </>
      )}
    </div>
  );
}
