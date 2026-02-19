import { useState, useEffect, useMemo } from 'react';
import './GameHUD.css';

function GameHUD({
  player,
  playersRef,
  killFeed,
  config,
  currentBorderMargin,
  connected,
  playersVersion,
}) {
  const [cashoutHolding, setCashoutHolding] = useState(false);

  // Calculate leaderboard (top 5 by balance)
  const leaderboard = useMemo(() => {
    return Array.from(playersRef.current.values())
      .filter(p => p.alive)
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 5);
  }, [playersVersion]);

  // Get player count
  const playerCount = useMemo(() => {
    return playersRef.current.size;
  }, [playersVersion]);

  // Format currency
  const formatCurrency = (amount) => {
    return amount?.toFixed(2) || '0.00';
  };

  // Handle F key for cashout visual feedback
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code === 'KeyF') setCashoutHolding(true);
    };
    const handleKeyUp = (e) => {
      if (e.code === 'KeyF') setCashoutHolding(false);
    };
    
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Clear sticky cashout holding when you are no longer actively alive in-game
  useEffect(() => {
    if (!player?.alive || player?.status !== 'alive') {
      setCashoutHolding(false);
    }
  }, [player?.alive, player?.status]);

  if (!player) return null;

  const healthPercent = (player.health / 100) * 100;
  const boostPercent = (player.boost / (config?.boostMax || 100)) * 100;
  const cashoutSegments = config?.cashoutSegments || 4;
  const cashoutProgress = player.cashingOut ? Math.max(0, Math.min(cashoutSegments, player.cashoutProgress)) : cashoutSegments;
  const cashoutPct = player.cashingOut ? ((cashoutSegments - cashoutProgress) / cashoutSegments) * 100 : 0;

  return (
    <div className="game-hud">
      {/* Top Stats */}
      <div className="hud-top">
        <div className="stat-box">
          <span className="stat-label">KILLS</span>
          <span className="stat-value">{player.kills || 0}</span>
        </div>
        <div className="stat-box balance">
          <span className="stat-label">BALANCE</span>
          <span className="stat-value">${formatCurrency(player.balance)}</span>
        </div>
        <div className="stat-box">
          <span className="stat-label">PLAYERS</span>
          <span className="stat-value">{playerCount}</span>
        </div>
      </div>

      {/* Leaderboard */}
      <div className="hud-leaderboard">
        <div className="leaderboard-title">TOP BALANCES</div>
        {leaderboard.map((p, index) => (
          <div 
            key={p.id} 
            className={`leaderboard-entry ${p.id === player.id ? 'self' : ''}`}
          >
            <span className="lb-name">{p.name}</span>
            <span className="lb-balance">${formatCurrency(p.balance)}</span>
          </div>
        ))}
      </div>

      {/* Bars Container */}
      <div className="hud-bars">
        {/* Health Bar */}
        <div className="bar-wrapper">
          <div className="bar-label">
            <span>HEALTH</span>
            <span>{Math.round(player.health)}</span>
          </div>
          <div className="bar-bg">
            <div 
              className="bar-fill health" 
              style={{ width: `${healthPercent}%` }}
            />
          </div>
        </div>
        
        {/* Boost Bar */}
        <div className="bar-wrapper">
          <div className="bar-label">
            <span>BOOST</span>
            <span>{Math.round(player.boost)}</span>
          </div>
          <div className="bar-bg">
            <div 
              className={`bar-fill boost ${player.boostDepleted ? 'depleted' : ''} ${player.boosting && !player.boostDepleted ? 'active' : ''}`}
              style={{ width: `${boostPercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* Cashout Button */}
      <div className="hud-cashout">
        <button 
          className={`cashout-button ${cashoutHolding ? 'holding' : ''} ${player.cashingOut ? 'active' : ''}`}
          style={{ '--cashout-progress': `${cashoutPct}%` }}
        >
          <span className="cashout-ring" aria-hidden="true" />
          {player.cashingOut 
            ? `CASHING OUT... ${cashoutProgress}s`
            : `CASHOUT $${formatCurrency(player.balance)}`
          }
        </button>
        <div className="cashout-hint">
          Hold <span className="key">F</span> to cash out
        </div>
      </div>

      {/* Kill Feed */}
      <div className="hud-killfeed">
        {killFeed.map((entry) => (
          <div key={entry.id} className="kill-entry">
            <span className="killer">{entry.killer}</span>
            <span className="action"> eliminated </span>
            <span className="victim">{entry.victim}</span>
          </div>
        ))}
      </div>

      {/* Connection Status */}
      <div className="connection-status">
        <div className={`status-dot ${connected ? '' : 'disconnected'}`} />
        <span>{connected ? 'Connected' : 'Disconnected'}</span>
      </div>

      {/* Pause Indicator */}
      {player.paused && (
        <div className="pause-indicator">PAUSED</div>
      )}
    </div>
  );
}

export default GameHUD;
