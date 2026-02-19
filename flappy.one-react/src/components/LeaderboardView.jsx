import React from 'react';

function formatUsd(amount) {
  const value = Number.isFinite(Number(amount)) ? Number(amount) : 0;
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function LeaderboardView({ rows, loading, error, onSelectPlayer }) {
  if (loading) {
    return (
      <div className="social-list social-list--skeleton">
        {[...Array(8)].map((_, index) => (
          <div key={`skeleton-${index}`} className="social-row social-row--skeleton" />
        ))}
      </div>
    );
  }

  if (error) {
    return <div className="social-empty">{error}</div>;
  }

  if (!rows.length) {
    return <div className="social-empty">No leaderboard data yet.</div>;
  }

  return (
    <div className="social-list">
      {rows.map((row, index) => {
        const rank = Number(row.rank || index + 1);
        const top3 = rank <= 3;
        return (
          <button
            key={`${row.wallet_address || 'unknown'}-${index}`}
            type="button"
            className={`social-row ${top3 ? 'social-row--top' : ''}`}
            onClick={() => onSelectPlayer?.(row)}
          >
            <span className={`social-rank ${top3 ? 'social-rank--top' : ''}`}>{rank}</span>
            <span className="social-name">{row.username || 'Player'}</span>
            <span className="social-amount">${formatUsd(row.total_winnings ?? row.total_profit)}</span>
          </button>
        );
      })}
    </div>
  );
}

