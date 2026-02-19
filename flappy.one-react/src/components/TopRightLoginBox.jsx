import { useRef } from 'react';
import { usePrivy } from '@privy-io/react-auth';

export default function TopRightLoginBox({ className = '', style }) {
  const { ready, authenticated, login, logout } = usePrivy();
  const hoverAudioRef = useRef(null);

  const playHoverSfx = () => {
    if (!hoverAudioRef.current) {
      hoverAudioRef.current = new Audio('/assets/sfx/menu_click.mp3');
      hoverAudioRef.current.preload = 'auto';
      hoverAudioRef.current.volume = 0.25;
    }
    try {
      const sound = hoverAudioRef.current.cloneNode();
      sound.volume = 0.25;
      sound.play().catch(() => {});
    } catch {
      // Ignore autoplay restrictions until first user interaction.
    }
  };

  if (!ready) return null;

  return (
    <button
      type="button"
      className={`privy-login-box ${className}`.trim()}
      style={style}
      onClick={authenticated ? logout : () => login()}
      onMouseEnter={playHoverSfx}
      title={authenticated ? 'Log out' : 'Log in'}
    >
      {authenticated ? 'LOG OUT' : 'LOGIN'}
    </button>
  );
}
