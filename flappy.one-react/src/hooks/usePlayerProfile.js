import { useCallback, useEffect, useState } from 'react';

export function usePlayerProfile(walletAddress, enabled) {
  const [profile, setProfile] = useState(null);
  const [earnings, setEarnings] = useState([]);
  const [range, setRange] = useState('ytd');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!enabled || !walletAddress) return;
    setLoading(true);
    setError('');
    try {
      const [profileRes, earningsRes] = await Promise.all([
        fetch(`/api/social/profile?wallet=${encodeURIComponent(walletAddress)}`),
        fetch(`/api/social/earnings?wallet=${encodeURIComponent(walletAddress)}&range=${encodeURIComponent(range)}`),
      ]);
      if (!profileRes.ok) {
        throw new Error(await profileRes.text() || `Failed to load profile (${profileRes.status})`);
      }
      if (!earningsRes.ok) {
        throw new Error(await earningsRes.text() || `Failed to load earnings (${earningsRes.status})`);
      }
      const profileData = await profileRes.json();
      const earningsData = await earningsRes.json();
      setProfile(profileData || null);
      setEarnings(Array.isArray(earningsData) ? earningsData : []);
    } catch (err) {
      setError(err?.message || 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  }, [enabled, walletAddress, range]);

  useEffect(() => {
    if (!enabled || !walletAddress) {
      setProfile(null);
      setEarnings([]);
      setLoading(false);
      return;
    }
    void load();
  }, [enabled, walletAddress, range, load]);

  return { profile, earnings, range, setRange, loading, error, reload: load };
}
