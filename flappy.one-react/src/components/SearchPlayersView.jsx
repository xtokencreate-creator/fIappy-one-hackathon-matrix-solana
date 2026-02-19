import React from 'react';

function truncateGameId(value) {
  const text = String(value || '');
  if (text.length <= 18) return text;
  return `${text.slice(0, 8)}...${text.slice(-6)}`;
}

function formatUsd(amount) {
  const value = Number.isFinite(Number(amount)) ? Number(amount) : 0;
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function SearchPlayersView({ query, onQueryChange, rows, loading, error, onSelectPlayer }) {
  const trimmed = (query || '').trim();
  const showHelperOnly = trimmed.length < 2;

  return (
    <div className="social-search">
      <div className="social-title">Search Players</div>
      <div className="social-subtitle">Start typing to find players by username or Game ID</div>
      <div className="social-search-examples">
        <div>• Username: "john", "player123"</div>
        <div>• Game ID: "abc123def456..."</div>
      </div>
      <input
        type="text"
        className="social-search-input"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Search username or Game ID..."
        autoFocus
      />

      {showHelperOnly ? (
        <div className="social-empty">Enter at least 2 characters to search.</div>
      ) : null}
      {!showHelperOnly && loading ? (
        <div className="social-list social-list--skeleton">
          {[...Array(4)].map((_, index) => (
            <div key={`search-skeleton-${index}`} className="social-row social-row--skeleton" />
          ))}
        </div>
      ) : null}
      {!showHelperOnly && !loading && error ? <div className="social-empty">{error}</div> : null}
      {!showHelperOnly && !loading && !error && !rows.length ? (
        <div className="social-empty">No players found.</div>
      ) : null}

      {!showHelperOnly && !loading && !error && rows.length ? (
        <div className="social-list">
          {rows.map((row) => (
            <button
              key={row.wallet_address}
              type="button"
              className="social-row"
              onClick={() => onSelectPlayer?.(row)}
            >
              <span className="social-avatar" aria-hidden="true">{(row.username || 'P').slice(0, 1).toUpperCase()}</span>
              <span className="social-name-wrap">
                <span className="social-name">{row.username || 'Player'}</span>
                <span className="social-row-subtext">Game ID: {truncateGameId(row.game_id || row.wallet_address)}</span>
              </span>
              <span className="social-amount">${formatUsd(row.total_winnings)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
