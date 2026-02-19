import { useCallback, useEffect, useState } from 'react';

export function useLeaderboardData(enabled) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/social/leaderboard?limit=100');
      if (!res.ok) {
        throw new Error(await res.text() || `Failed to load leaderboard (${res.status})`);
      }
      const data = await res.json();
      const next = Array.isArray(data) ? data : [];
      // Defensive dedupe by wallet_address (safety net for backend/SQL issues)
      const seen = new Set();
      const deduped = [];
      for (const row of next) {
        const key = row.wallet_address;
        if (key && seen.has(key)) {
          console.warn('[Leaderboard] duplicate wallet_address in response:', key);
          continue;
        }
        if (key) seen.add(key);
        deduped.push(row);
      }
      setRows(deduped);
    } catch (err) {
      setError(err?.message || 'Failed to load leaderboard');
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    void reload();
  }, [enabled, reload]);

  return { rows, loading, error, reload };
}

