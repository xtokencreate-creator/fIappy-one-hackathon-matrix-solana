import { useEffect, useState } from 'react';
import './CashoutScreen.css';

const formatTime = (ms) => {
  const safe = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  const totalSeconds = Math.floor(safe / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
};

function CashoutScreen({
  amountUsd,
  amountSol,
  solPriceUsd,
  postCashoutTotalUsd,
  postCashoutTotalSol,
  postCashoutBalanceLoading,
  betAmount,
  timeSurvivedMs,
  eliminations,
  onPlayAgain,
  onMainMenu,
  onSpectate,
}) {
  const [landscapeLayout, setLandscapeLayout] = useState({
    mobileLandscape: false,
    scale: 1,
    offsetY: 0,
  });

  useEffect(() => {
    const computeLayout = () => {
      const vv = window.visualViewport;
      const vw = Math.floor(vv?.width || window.innerWidth || 0);
      const vh = Math.floor(vv?.height || window.innerHeight || 0);
      const coarse = window.matchMedia ? window.matchMedia('(pointer: coarse)').matches : false;
      const mobileLandscape = !!coarse && vw > vh;
      if (!mobileLandscape) {
        setLandscapeLayout({ mobileLandscape: false, scale: 1, offsetY: 0 });
        return;
      }
      const safe = vv
        ? {
            top: Math.max(0, vv.offsetTop || 0),
            left: Math.max(0, vv.offsetLeft || 0),
            right: Math.max(0, (window.innerWidth || vw) - vv.width - (vv.offsetLeft || 0)),
            bottom: Math.max(0, (window.innerHeight || vh) - vv.height - (vv.offsetTop || 0)),
          }
        : { top: 0, right: 0, bottom: 0, left: 0 };
      const availableW = Math.max(220, vw - safe.left - safe.right - 20);
      const availableH = Math.max(180, vh - safe.top - safe.bottom - 20);
      const baseW = 472;
      const baseH = 700;
      const scale = Math.min(1, availableW / baseW, availableH / baseH);
      const offsetY = -Math.round((safe.bottom || 0) * 0.45);
      setLandscapeLayout({ mobileLandscape: true, scale, offsetY });
    };

    computeLayout();
    const onResize = () => requestAnimationFrame(computeLayout);
    window.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('scroll', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('scroll', onResize);
    };
  }, []);

  const usdValue = Number.isFinite(amountUsd) ? amountUsd : 0;
  const resolvedSol =
    Number.isFinite(amountSol) && amountSol > 0
      ? amountSol
      : solPriceUsd && solPriceUsd > 0
        ? usdValue / solPriceUsd
        : 0;
  const solValue = Number.isFinite(resolvedSol) ? resolvedSol : 0;
  const hasPostBalance = Number.isFinite(postCashoutTotalUsd) && Number.isFinite(postCashoutTotalSol);
  return (
    <div className={`cashout-screen ${landscapeLayout.mobileLandscape ? 'cashout-screen--mobile-landscape' : ''}`}>
      <div
        className="cashout-panel"
        style={landscapeLayout.mobileLandscape
          ? { transform: `translateY(${landscapeLayout.offsetY}px) scale(${landscapeLayout.scale})` }
          : undefined}
      >
        <button className="cashout-close" onClick={onMainMenu}>
          x
        </button>
        <div className="cashout-badge">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="10" r="5.5" stroke="#f4c225" strokeWidth="2" />
            <path
              d="M8.5 14.5L7 21l5-3 5 3-1.5-6.5"
              stroke="#f4c225"
              strokeWidth="2"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <div className="cashout-title">Cashout Successful!</div>
        <div className="cashout-subtitle">AMOUNT RECEIVED</div>
        <div className="cashout-amount">${usdValue.toFixed(2)}</div>
        <div className="cashout-amount-sol">{solValue.toFixed(6)} SOL</div>
        <div className="cashout-divider" />
        <div className="cashout-stats">
          <div className="cashout-stat">
            <div className="cashout-stat-icon cashout-stat-icon--blue">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="9" stroke="#ffffff" strokeWidth="2" />
                <path d="M12 7v5l3 3" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <div className="cashout-stat-value">{formatTime(timeSurvivedMs)}</div>
            <div className="cashout-stat-label">Time Survived</div>
          </div>
          <div className="cashout-stat-sep" />
          <div className="cashout-stat">
            <div className="cashout-stat-icon cashout-stat-icon--red">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M12 3l2.5 5 5.5.8-4 3.9 1 5.6-5-2.6-5 2.6 1-5.6-4-3.9 5.5-.8L12 3z"
                  stroke="#ffffff"
                  strokeWidth="2"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div className="cashout-stat-value">{Number.isFinite(eliminations) ? eliminations : 0}</div>
            <div className="cashout-stat-label">Eliminations</div>
          </div>
        </div>
        <div className="cashout-payout-bar">
          {postCashoutBalanceLoading || !hasPostBalance ? (
            <span className="cashout-payout-updating">Updating...</span>
          ) : (
            <>
              <span className="cashout-payout-usd">${Number(postCashoutTotalUsd).toFixed(2)}</span>
              <span>/</span>
              <span className="cashout-payout-sol">{Number(postCashoutTotalSol).toFixed(6)} SOL</span>
            </>
          )}
        </div>
        <div className="cashout-actions">
          <button className="cashout-btn" onClick={onSpectate}>
            Spectate
          </button>
          <button className="cashout-btn cashout-btn--primary" onClick={onPlayAgain}>
            Play Again (${betAmount.toFixed(2)})
          </button>
          <button className="cashout-btn" onClick={onMainMenu}>
            Home
          </button>
        </div>
      </div>
    </div>
  );
}

export default CashoutScreen;
