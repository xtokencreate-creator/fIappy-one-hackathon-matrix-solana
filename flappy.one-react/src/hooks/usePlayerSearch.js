import { useEffect, useState } from 'react';

const SEARCH_DEBOUNCE_MS = 250;

export function usePlayerSearch(query, enabled) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!enabled) return undefined;
    const q = (query || '').trim();
    if (q.length < 2) {
      setRows([]);
      setLoading(false);
      setError('');
      return undefined;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`/api/social/search?q=${encodeURIComponent(q)}&limit=20`);
        if (!res.ok) {
          throw new Error((await res.text()) || `Failed to search players (${res.status})`);
        }
        const data = await res.json();
        if (!cancelled) {
          setRows(Array.isArray(data) ? data : []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err?.message || 'Failed to search players');
          setRows([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [enabled, query]);

  return { rows, loading, error };
}
