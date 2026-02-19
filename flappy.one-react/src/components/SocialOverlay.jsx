import { useEffect, useMemo, useState } from 'react';
import LeaderboardView from './LeaderboardView';
import PlayerProfileView from './PlayerProfileView';
import SearchPlayersView from './SearchPlayersView';
import { useLeaderboardData } from '../hooks/useLeaderboardData';
import { usePlayerProfile } from '../hooks/usePlayerProfile';
import { usePlayerSearch } from '../hooks/usePlayerSearch';
import './SocialOverlay.css';

const TABS = [
  { id: 'leaderboard', label: 'Leaderboard', enabled: true },
  { id: 'search', label: 'Search', enabled: true },
  { id: 'profile', label: 'Profile', enabled: true },
  { id: 'friends', label: 'Friends', enabled: false },
];

export default function SocialOverlay({ open, onClose, currentWalletAddress = '' }) {
  const [tab, setTab] = useState('leaderboard');
  const [selectedProfileUserId, setSelectedProfileUserId] = useState(null); // null means "my profile"
  const [searchQuery, setSearchQuery] = useState('');
  const { rows, loading, error } = useLeaderboardData(open && tab === 'leaderboard');
  const profileWallet = selectedProfileUserId || currentWalletAddress || '';
  const {
    profile,
    earnings,
    range,
    setRange,
    loading: profileLoading,
    error: profileError,
  } = usePlayerProfile(profileWallet, open && tab === 'profile' && !!profileWallet);
  const {
    rows: searchRows,
    loading: searchLoading,
    error: searchError,
  } = usePlayerSearch(searchQuery, open && tab === 'search');

  useEffect(() => {
    if (!open) return;
    setTab('leaderboard');
    setSelectedProfileUserId(null);
    setSearchQuery('');
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  const title = useMemo(() => {
    if (tab === 'profile') return 'Profile';
    if (tab === 'search') return 'Search Players';
    if (tab === 'friends') return 'Friends';
    return 'Leaderboard';
  }, [tab]);

  const viewingOtherProfile = tab === 'profile' && !!selectedProfileUserId && selectedProfileUserId !== currentWalletAddress;
  if (!open) return null;

  return (
    <div className="social-overlay-backdrop" role="dialog" aria-modal="true">
      <div className="social-overlay">
        <div className="social-overlay__head">
          <div className="social-overlay__tabs">
            {TABS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={`social-tab ${tab === entry.id ? 'active' : ''}`}
                onClick={() => {
                  if (!entry.enabled) return;
                  if (entry.id === 'profile') {
                    setSelectedProfileUserId(null);
                  }
                  setTab(entry.id);
                }}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <button className="social-close" type="button" onClick={onClose}>Close</button>
        </div>

        <div className="social-overlay__body">
          <div className="social-overlay__title-row">
            {viewingOtherProfile ? (
              <button
                type="button"
                className="social-back-btn"
                onClick={() => {
                  setSelectedProfileUserId(null);
                  setTab('profile');
                }}
              >
                Back to My Profile
              </button>
            ) : null}
            <h3>{title}</h3>
          </div>

          {tab === 'profile' && !profileWallet ? (
            <div className="social-empty">Connect your wallet to view your profile.</div>
          ) : null}

          {tab === 'profile' && !!profileWallet ? (
            <PlayerProfileView
              profile={profile}
              earnings={earnings}
              range={range}
              onRangeChange={setRange}
              loading={profileLoading}
              error={profileError}
            />
          ) : null}

          {tab === 'leaderboard' ? (
            <LeaderboardView
              rows={rows}
              loading={loading}
              error={error}
              onSelectPlayer={(player) => {
                const wallet = player?.wallet_address || '';
                if (!wallet) return;
                setSelectedProfileUserId(wallet);
                setTab('profile');
              }}
            />
          ) : null}

          {tab === 'search' ? (
            <SearchPlayersView
              query={searchQuery}
              onQueryChange={setSearchQuery}
              rows={searchRows}
              loading={searchLoading}
              error={searchError}
              onSelectPlayer={(player) => {
                const wallet = player?.wallet_address || '';
                if (!wallet) return;
                setSelectedProfileUserId(wallet);
                setTab('profile');
              }}
            />
          ) : null}

          {tab === 'friends' ? <div className="social-empty">Friends tab coming soon.</div> : null}
        </div>
      </div>
    </div>
  );
}
