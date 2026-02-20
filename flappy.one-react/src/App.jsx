import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Connection, PublicKey, LAMPORTS_PER_SOL, SystemProgram, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { useGameState } from './hooks/useGameState';
import GameCanvas from './components/GameCanvas';
import DeathScreen from './components/DeathScreen';
import CashoutScreen from './components/CashoutScreen';
import CashOutModal from './components/CashOutModal';
import './styles/App.css';
import { initGameRenderer } from './game/GameRenderer';
import { usePrivy } from '@privy-io/react-auth';
import { useWallets, useCreateWallet, useFundWallet } from '@privy-io/react-auth/solana';
import { setWalletDisplay, setWalletActions, setMenuUsername, setUsernameListener, setUsernameCommitListener, setUsernameInvalidListener, setLeaderboardRows as setMenuLeaderboardRows, setSkinData, setSelectedSkin as setMenuSelectedSkin, setSkinSelectCallback, setSkinModalOpenCallback, setViewLeaderboardCallback, setMenuStats, setJoinEnabled } from './menu/main';
import TopRightLoginBox from './components/TopRightLoginBox';
import SocialOverlay from './components/SocialOverlay';
import DemoOverlay from './components/DemoOverlay';
import CrateRevealOverlay from './components/CrateRevealOverlay';
import { useDemoController } from './hooks/useDemoController';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    if (typeof window !== 'undefined') {
      window.__LAST_APP_ERROR__ = {
        message: error?.message || String(error),
        stack: error?.stack || '',
        componentStack: info?.componentStack || '',
      };
    }
  }

  render() {
    if (this.state.error) {
      return this.props.fallback || null;
    }
    return this.props.children;
  }
}

function App() {
  const USERNAME_REGEX = /^[a-zA-Z0-9_-]{3,21}$/;
  const USERNAME_REQUIRED_MESSAGE = 'Update your username to play!';
  const normalizeUsername = useCallback((value) => {
    const safe = String(value || '').replace(/[^a-zA-Z0-9_-]/g, '');
    return safe.slice(0, 21);
  }, []);
  const isValidUsername = useCallback((value) => {
    const normalized = normalizeUsername(value);
    return USERNAME_REGEX.test(normalized);
  }, [normalizeUsername]);
  const shortenAddress = useCallback((value) => {
    const text = String(value || '');
    if (!text) return '';
    if (text.length <= 12) return text;
    return `${text.slice(0, 6)}...${text.slice(-6)}`;
  }, []);

  // Game state from WebSocket (refs for fast access)
  const {
    connected,
    myPlayerId,
    config,
    pipes,
    playersRef,
    bulletsRef,
    orbsRef,
    currentBorderMargin,
    killFeed,
    sessionLeaderboardRows,
    playersVersion,
    bulletsVersion,
    orbsVersion,
    setName,
    joinGame,
    sendInput,
    respawn,
    privyReady,
    privyAuthenticated,
  } = useGameState();

  // Local UI state
  const [gameScreen, setGameScreen] = useState('menu'); // 'menu', 'demo', 'demo_reward', 'game', 'death', 'cashout', 'spectate'
  const [username, setUsername] = useState('');
  const [pendingUsername, setPendingUsername] = useState('');
  const [selectedBet, setSelectedBet] = useState(1);
  const [selectedRegion, setSelectedRegion] = useState('us');
  const [selectedBird, setSelectedBird] = useState('yellow');
  const [cashoutDetails, setCashoutDetails] = useState({
    amountUsd: 0,
    amountSol: 0,
    timeMs: 0,
    eliminations: 0,
  });
  const [postCashoutBalance, setPostCashoutBalance] = useState({
    loading: false,
    usd: null,
    sol: null,
  });
  const [killerName, setKillerName] = useState('');
  const [deathCause, setDeathCause] = useState('unknown');
  const [joining, setJoining] = useState(false);
  const [cashoutError, setCashoutError] = useState('');
  const [cashoutToast, setCashoutToast] = useState(null);
  const [walletBalanceUsd, setWalletBalanceUsd] = useState(0);
  const [walletBalanceSol, setWalletBalanceSol] = useState(0);
  const [cashOutModalOpen, setCashOutModalOpen] = useState(false);
  const [cashoutBalanceLoading, setCashoutBalanceLoading] = useState(false);
  const [cashoutSubmitting, setCashoutSubmitting] = useState(false);
  const [cashoutBalanceError, setCashoutBalanceError] = useState('');
  const [cashoutBalance, setCashoutBalance] = useState({
    usdBalance: 0,
    solBalance: 0,
    reservedUsd: 0.21,
    maxWithdrawableUsd: 0,
    walletPubkey: '',
    cluster: 'devnet',
  });
  const walletBalanceRequestRef = useRef(0);
  const walletBalanceAppliedRef = useRef(0);
  const cashoutSubmitInFlightRef = useRef(false);
  const [solPriceUsd, setSolPriceUsd] = useState(Number(import.meta.env.VITE_SOL_PRICE_USD || 0));
  const [leaderboardRows, setLeaderboardRows] = useState([]);
  const [leaderboardSelf, setLeaderboardSelf] = useState(null);
  const [hasLeaderboardRow, setHasLeaderboardRow] = useState(false);
  const [skins, setSkins] = useState([]);
  const [skinsLoaded, setSkinsLoaded] = useState(false);
  const [privyDebugInfo, setPrivyDebugInfo] = useState(null);
  const [view, setView] = useState('lobby'); // 'lobby' | 'demo' | 'game'
  const [lastError, setLastError] = useState(null);
  const gameRootRef = useRef(null);
  const rendererRef = useRef(null);
  const [menuOverlayRoot, setMenuOverlayRoot] = useState(null);
  const [loginAnchor, setLoginAnchor] = useState(null);
  const [isMobilePortrait, setIsMobilePortrait] = useState(false);
  const [socialOpen, setSocialOpen] = useState(false);
  const [demoOverlayRect, setDemoOverlayRect] = useState(null);
  const [demoPlay, setDemoPlay] = useState(false);
  const [demoStatusLoaded, setDemoStatusLoaded] = useState(false);
  const demoDeathOverrideRef = useRef(false);
  const demoDeathHandlerRef = useRef(null);
  const loginInProgressRef = useRef(false);
  const pendingJoinAfterLoginRef = useRef(false);
  const matchStartRef = useRef(null);
  const voucherMintTriggeredRef = useRef(false);
  const [rewardRevealActive, setRewardRevealActive] = useState(false);
  const [voucherMintFailed, setVoucherMintFailed] = useState(false);
  const [voucherMintInfo, setVoucherMintInfo] = useState(null);
  const { ready: privyUiReady, authenticated: privyUiAuthed, login, logout, getAccessToken } = usePrivy();
  const { createWallet } = useCreateWallet();
  const { fundWallet } = useFundWallet();
  const { wallets } = useWallets();
  const solanaRpc = import.meta.env.VITE_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
  const debugEnabled = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('debug') === '1';
  }, []);
  const demoModeActive = gameScreen === 'demo' && !demoPlay;

  // Demo gating entrypoint:
  // after auth, load onboarding status and force the client into demo mode
  // until demo_play is true.
  useEffect(() => {
    const nextView = gameScreen === 'menu'
      ? 'lobby'
      : gameScreen === 'demo'
        ? 'demo'
        : 'game';
    setView(nextView);
  }, [gameScreen]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    if (window.__FLAPPY_AUDIO_UNLOCK_BOUND__) return undefined;
    window.__FLAPPY_AUDIO_UNLOCK_BOUND__ = true;
    const unlock = () => {
      if (window.__FLAPPY_AUDIO_UNLOCKED__) return;
      window.__FLAPPY_AUDIO_UNLOCKED__ = true;
      window.dispatchEvent(new CustomEvent('flappy:audioUnlock'));
    };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('touchstart', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('touchstart', unlock);
      window.removeEventListener('keydown', unlock);
      window.__FLAPPY_AUDIO_UNLOCK_BOUND__ = false;
    };
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const onGestureStart = (e) => e.preventDefault();
    const onGestureChange = (e) => e.preventDefault();
    const onTouchMove = (e) => {
      if (e.touches && e.touches.length > 1) {
        e.preventDefault();
      }
    };
    let lastTouchEnd = 0;
    const onTouchEnd = (e) => {
      const now = Date.now();
      if (now - lastTouchEnd <= 300) {
        e.preventDefault();
      }
      lastTouchEnd = now;
    };

    document.addEventListener('gesturestart', onGestureStart, { passive: false });
    document.addEventListener('gesturechange', onGestureChange, { passive: false });
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd, { passive: false });

    return () => {
      document.removeEventListener('gesturestart', onGestureStart);
      document.removeEventListener('gesturechange', onGestureChange);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
    };
  }, []);

  useEffect(() => {
    if (!privyReady || !privyAuthenticated) {
      setDemoStatusLoaded(false);
      setDemoPlay(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken?.();
        if (!token) return;
        const response = await fetch('/api/onboarding/status', {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || 'Failed to fetch onboarding');
        }
        const data = await response.json();
        if (cancelled) return;
        const completed = !!data?.demo_play;
        setDemoPlay(completed);
        setDemoStatusLoaded(true);
        if (!completed) {
          setGameScreen('demo');
        }
      } catch (err) {
        console.error('[demo] onboarding status failed', err);
        if (cancelled) return;
        setDemoPlay(false);
        setDemoStatusLoaded(true);
        setGameScreen('demo');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [privyReady, privyAuthenticated, getAccessToken]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onError = (event) => {
      const message = event?.message || 'Unknown error';
      setLastError({ type: 'error', message });
    };
    const onRejection = (event) => {
      const message = event?.reason?.message || String(event?.reason || 'Unhandled rejection');
      setLastError({ type: 'rejection', message });
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  const usernameStorageKey = useCallback((address) => {
    return address ? `flappy:username:${address}` : 'flappy:username:last';
  }, []);

  const readStoredUsername = useCallback((address) => {
    if (typeof window === 'undefined') return '';
    const key = usernameStorageKey(address);
    return window.localStorage.getItem(key) || '';
  }, [usernameStorageKey]);

  const writeStoredUsername = useCallback((address, value) => {
    if (typeof window === 'undefined') return;
    const key = usernameStorageKey(address);
    window.localStorage.setItem(key, value);
    if (address) {
      window.localStorage.setItem('flappy:username:last', value);
    }
  }, [usernameStorageKey]);

  const embeddedWallet = useMemo(
    () =>
      wallets?.find(
        (candidate) =>
          candidate?.walletClientType === 'privy' ||
          candidate?.isPrivyWallet ||
          candidate?.wallet?.isPrivyWallet ||
          candidate?.standardWallet?.name === 'Privy',
      ) ?? wallets?.[0],
    [wallets],
  );
  const walletAddress = embeddedWallet?.address;

  // Get my player from ref (updates when playersVersion changes)
  const myPlayer = useMemo(() => {
    return playersRef.current.get(myPlayerId);
  }, [myPlayerId, playersVersion]);


  // Get player count (updates when playersVersion changes)
  const playersInGame = useMemo(() => {
    return playersRef.current.size;
  }, [playersVersion]);

  const parseNumber = useCallback((value) => {
    if (value == null) return 0;
    const num = typeof value === 'string' ? Number(value) : value;
    return Number.isFinite(num) ? num : 0;
  }, []);

  const normalizeLeaderboardRow = useCallback((row) => {
    if (!row) return null;
    return {
      id: row.id,
      wallet_address: row.wallet_address,
      username: row.username || 'Player',
      balance: parseNumber(row.balance),
      total_profit: parseNumber(row.total_profit),
      games_played: Number(row.games_played ?? 0),
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }, [parseNumber]);

  const fetchLeaderboardJson = useCallback(async (url, options = {}) => {
    const res = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
      },
      ...options,
    });
    if (!res.ok) {
      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      let payload = null;
      let text = '';
      try {
        if (contentType.includes('application/json')) {
          payload = await res.json();
        } else {
          text = await res.text();
        }
      } catch {
        text = '';
      }
      const message = payload?.message || payload?.error || text || `Request failed (${res.status})`;
      const error = new Error(message);
      error.status = res.status;
      error.code = payload?.error || payload?.code || null;
      throw error;
    }
    if (res.status === 204) return null;
    return res.json();
  }, []);

  const fetchMenuStats = useCallback(async () => {
    try {
      const data = await fetchLeaderboardJson('/api/menu/stats');
      setMenuStats({
        playersInGame: Number(data?.playersInGame || 0),
        globalWinnings: Number(data?.globalWinnings || 0),
      });
    } catch (error) {
      console.error('Failed to load menu stats:', error?.message || error);
    }
  }, [fetchLeaderboardJson]);

  const loadLeaderboardSelf = useCallback(async () => {
    if (!walletAddress) {
      setLeaderboardSelf(null);
      setHasLeaderboardRow(false);
      return;
    }
    try {
      const data = await fetchLeaderboardJson(
        `/api/leaderboard/self?wallet=${encodeURIComponent(walletAddress)}`,
      );
      if (data) {
        const normalized = normalizeLeaderboardRow(data);
        setLeaderboardSelf(normalized);
        setHasLeaderboardRow(true);
        if (normalized?.username) {
          setUsername(normalized.username);
          setPendingUsername(normalized.username);
          setMenuUsername(normalized.username);
          writeStoredUsername(walletAddress, normalized.username);
        }
      } else {
        setLeaderboardSelf(null);
        setHasLeaderboardRow(false);
      }
    } catch (error) {
      console.error('Failed to load leaderboard entry:', error?.message || error);
    }
  }, [walletAddress, normalizeLeaderboardRow, writeStoredUsername, fetchLeaderboardJson]);

  const updateLeaderboardRow = useCallback(async (updates) => {
    if (!walletAddress) return null;
    try {
      const data = await fetchLeaderboardJson('/api/leaderboard/update', {
        method: 'POST',
        body: JSON.stringify({ wallet_address: walletAddress, updates }),
      });
      if (!data) return null;
      const normalized = normalizeLeaderboardRow(data);
      setLeaderboardSelf(normalized);
      setHasLeaderboardRow(true);
      return normalized;
    } catch (error) {
      console.error('Failed to update leaderboard row:', error?.message || error);
      if (error?.status === 409 || error?.code === 'USERNAME_TAKEN') {
        throw error;
      }
      return null;
    }
  }, [walletAddress, normalizeLeaderboardRow, fetchLeaderboardJson]);

  const insertLeaderboardRow = useCallback(async (payload) => {
    try {
      const data = await fetchLeaderboardJson('/api/leaderboard/upsert', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (!data) return null;
      const normalized = normalizeLeaderboardRow(data);
      setLeaderboardSelf(normalized);
      setHasLeaderboardRow(true);
      return normalized;
    } catch (error) {
      console.error('Failed to insert leaderboard row:', error?.message || error);
      if (error?.status === 409 || error?.code === 'USERNAME_TAKEN') {
        throw error;
      }
      return null;
    }
  }, [normalizeLeaderboardRow, fetchLeaderboardJson]);

  const fetchLeaderboard = useCallback(async () => {
    try {
      const data = await fetchLeaderboardJson('/api/leaderboard/top?limit=10');
      const normalizedRows = (data || [])
        .map(normalizeLeaderboardRow)
        .filter(Boolean)
        .map((row, index) => ({ ...row, rank: index + 1 }));

      let rows = normalizedRows;
      let selfRow = leaderboardSelf;
      if (!selfRow && walletAddress) {
        const selfData = await fetchLeaderboardJson(
          `/api/leaderboard/self?wallet=${encodeURIComponent(walletAddress)}`,
        );
        if (selfData) {
          selfRow = normalizeLeaderboardRow(selfData);
          setLeaderboardSelf(selfRow);
          setHasLeaderboardRow(true);
        }
      }

      if (selfRow && walletAddress) {
        const isInTop = rows.some((row) => row.wallet_address === selfRow.wallet_address);
        if (isInTop) {
          rows = rows.map((row) =>
            row.wallet_address === selfRow.wallet_address ? { ...row, isSelf: true } : row,
          );
        } else {
          const rankData = await fetchLeaderboardJson(
            `/api/leaderboard/rank?total_profit=${encodeURIComponent(selfRow.total_profit ?? 0)}`,
          );
          const count = typeof rankData?.count === 'number' ? rankData.count : null;
          const rank = typeof count === 'number' ? count + 1 : null;
          rows = [...rows, { ...selfRow, rank, isSelf: true }];
        }
      }

      setLeaderboardRows(rows);
      setMenuLeaderboardRows(rows);
    } catch (error) {
      console.error('Failed to load leaderboard:', error?.message || error);
    }
  }, [walletAddress, leaderboardSelf, normalizeLeaderboardRow, fetchLeaderboardJson]);

  const commitUsername = useCallback(async (value) => {
    const normalized = normalizeUsername(value);
    if (!isValidUsername(normalized)) return false;

    if (!walletAddress) {
      setUsername(normalized);
      setPendingUsername(normalized);
      setMenuUsername(normalized);
      setName(normalized);
      return true;
    }

    let persisted = null;
    if (hasLeaderboardRow) {
      persisted = await updateLeaderboardRow({
        username: normalized,
        updated_at: new Date().toISOString(),
      });
    } else {
      const payload = {
        wallet_address: walletAddress,
        username: normalized,
        balance: 0,
        total_profit: 0,
        games_played: 0,
        updated_at: new Date().toISOString(),
      };
      persisted = await insertLeaderboardRow(payload);
    }

    if (!persisted) {
      const error = new Error('Failed to save username.');
      error.code = 'USERNAME_SAVE_FAILED';
      throw error;
    }

    setUsername(normalized);
    setPendingUsername(normalized);
    setMenuUsername(normalized);
    setName(normalized);
    writeStoredUsername(walletAddress, normalized);
    void fetchLeaderboard();
    return true;
  }, [walletAddress, hasLeaderboardRow, updateLeaderboardRow, insertLeaderboardRow, fetchLeaderboard, setName, writeStoredUsername, normalizeUsername, isValidUsername]);

  useEffect(() => {
    const stored = readStoredUsername(walletAddress);
    if (stored && !username) {
      setUsername(stored);
      setPendingUsername(stored);
      setMenuUsername(stored);
      setName(stored);
    }
  }, [walletAddress, username, readStoredUsername, setName]);

  useEffect(() => {
    setUsernameListener((value) => {
      setPendingUsername(value);
    });
    setUsernameCommitListener((value) => {
      void (async () => {
        const normalized = normalizeUsername(value);
        if (!isValidUsername(normalized)) {
          setCashoutToast({
            stage: 'joinBlocked',
            message: 'Invalid username. Use 3-21 characters: letters, numbers, _ or -.',
          });
          return;
        }
        try {
          const saved = await commitUsername(normalized);
          if (!saved) return;
          setCashoutToast({
            stage: 'usernameSaved',
            message: 'Username successfully saved!',
          });
        } catch (error) {
          const duplicate = error?.status === 409 || error?.code === 'USERNAME_TAKEN' || String(error?.message || '').toLowerCase().includes('already in use');
          setCashoutToast({
            stage: 'joinBlocked',
            message: duplicate ? 'Username already in use.' : 'Failed to save username. Please try again.',
          });
        }
      })();
    });
    setUsernameInvalidListener(() => {
      setCashoutToast({
        stage: 'joinBlocked',
        message: 'Invalid username. Use 3-21 characters: letters, numbers, _ or -.',
      });
    });
    return () => {
      setUsernameListener(null);
      setUsernameCommitListener(null);
      setUsernameInvalidListener(null);
    };
  }, [commitUsername, normalizeUsername, isValidUsername]);

  useEffect(() => {
    setMenuUsername(username);
  }, [username]);

  useEffect(() => {
    const candidate = normalizeUsername(pendingUsername || username || '');
    setJoinEnabled(!joining && isValidUsername(candidate) && demoPlay);
  }, [pendingUsername, username, joining, normalizeUsername, isValidUsername, demoPlay]);

  useEffect(() => {
    void loadLeaderboardSelf();
  }, [loadLeaderboardSelf]);

  useEffect(() => {
    void fetchLeaderboard();
    const interval = setInterval(fetchLeaderboard, 15000);
    return () => clearInterval(interval);
  }, [fetchLeaderboard]);

  useEffect(() => {
    setMenuStats({
      playersInGame: Number(playersInGame || 0),
      globalWinnings: leaderboardRows.reduce((sum, row) => sum + Number(row?.total_profit || 0), 0),
    });
  }, [playersInGame, leaderboardRows]);

  useEffect(() => {
    void fetchMenuStats();
    const interval = setInterval(fetchMenuStats, 30000);
    return () => clearInterval(interval);
  }, [fetchMenuStats]);

  // Track if we've done initial skin load from server
  const initialSkinLoadedRef = useRef(false);

  // Fetch skins and ownership data
  const fetchSkins = useCallback(async () => {
    try {
      // If wallet is connected, fetch with ownership data
      if (walletAddress) {
        const res = await fetch(`/api/skins/ownership?wallet=${encodeURIComponent(walletAddress)}`);
        if (res.ok) {
          const data = await res.json();
          setSkins(data.skins || []);
          setSkinData(data.skins || []);
          // Only set selected skin on initial load, not on subsequent fetches
          if (data.selectedSkin && !initialSkinLoadedRef.current) {
            setSelectedBird(data.selectedSkin);
            setMenuSelectedSkin(data.selectedSkin);
            initialSkinLoadedRef.current = true;
          }
          setSkinsLoaded(true);
          return;
        }
      }

      // Fallback: fetch all skins without ownership (base skins always owned)
      const res = await fetch('/api/skins');
      if (res.ok) {
        const data = await res.json();
        const skinsWithOwnership = (data.skins || []).map(skin => ({
          ...skin,
          owned: skin.isBaseSkin, // Base skins are always unlocked
        }));
        setSkins(skinsWithOwnership);
        setSkinData(skinsWithOwnership);
        setSkinsLoaded(true);
      }
    } catch (err) {
      console.error('Failed to fetch skins:', err);
    }
  }, [walletAddress]);

  useEffect(() => {
    void fetchSkins();
  }, [fetchSkins]);

  // Handle skin selection
  const handleSkinSelect = useCallback(async (skinId) => {
    // Update local state immediately for responsiveness
    setSelectedBird(skinId);
    setMenuSelectedSkin(skinId);

    // Persist to backend if wallet is connected (don't revert on failure - keep local selection)
    if (walletAddress) {
      try {
        const res = await fetch('/api/skins/select', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wallet_address: walletAddress, skin_id: skinId }),
        });

        if (!res.ok) {
          const errorText = await res.text();
          console.error('Failed to persist skin selection:', res.status, errorText);
          // Don't revert - keep the local selection working
        }
      } catch (err) {
        console.error('Failed to persist skin selection:', err);
        // Don't revert - keep the local selection working
      }
    }
  }, [walletAddress]);

  // Set up skin selection callback for the canvas menu
  useEffect(() => {
    setSkinSelectCallback(handleSkinSelect);
    return () => setSkinSelectCallback(null);
  }, [handleSkinSelect]);

  // Set up modal open callback (refresh only if skins not loaded yet)
  useEffect(() => {
    setSkinModalOpenCallback(() => {
      if (!skinsLoaded) {
        void fetchSkins();
      }
    });
    return () => setSkinModalOpenCallback(null);
  }, [fetchSkins, skinsLoaded]);

  useEffect(() => {
    setViewLeaderboardCallback(() => setSocialOpen(true));
    return () => setViewLeaderboardCallback(null);
  }, []);

  const ensureLeaderboardEntry = useCallback(async () => {
    if (!walletAddress) return;
    const name = normalizeUsername(username);
    if (!isValidUsername(name)) return;
    if (!hasLeaderboardRow) {
      const payload = {
        wallet_address: walletAddress,
        username: name,
        balance: 0,
        total_profit: 0,
        games_played: 1,
        updated_at: new Date().toISOString(),
      };
      await insertLeaderboardRow(payload);
      void fetchLeaderboard();
      return;
    }
    const nextGamesPlayed = (leaderboardSelf?.games_played ?? 0) + 1;
    await updateLeaderboardRow({
      username: name,
      games_played: nextGamesPlayed,
      updated_at: new Date().toISOString(),
    });
    void fetchLeaderboard();
  }, [walletAddress, username, hasLeaderboardRow, leaderboardSelf, updateLeaderboardRow, insertLeaderboardRow, fetchLeaderboard, normalizeUsername, isValidUsername]);

  const syncCashoutToLeaderboard = useCallback(async (amount) => {
    if (!walletAddress || !amount || amount <= 0) return;
    if (!hasLeaderboardRow) return;
    const nextProfit = (leaderboardSelf?.total_profit ?? 0) + amount;
    const nextBalance = amount;
    await updateLeaderboardRow({
      total_profit: nextProfit,
      balance: nextBalance,
      updated_at: new Date().toISOString(),
    });
    void fetchLeaderboard();
  }, [walletAddress, hasLeaderboardRow, leaderboardSelf, updateLeaderboardRow, fetchLeaderboard]);

  useEffect(() => {
    if (solPriceUsd > 0) return;
    let cancelled = false;

    const fetchPrice = async () => {
      try {
        const res = await fetch('https://api.coinbase.com/v2/prices/SOL-USD/spot');
        if (!res.ok) return;
        const data = await res.json();
        const price = Number(data?.data?.amount);
        if (!cancelled && Number.isFinite(price) && price > 0) {
          setSolPriceUsd(price);
        }
      } catch {
        // Ignore price fetch errors; SOL balance still shows.
      }
    };

    fetchPrice();
    const interval = setInterval(fetchPrice, 60000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [solPriceUsd]);

  const refreshWalletBalance = useCallback(async () => {
    const isAuthed = !!privyReady && !!privyAuthenticated;
    if (!isAuthed || !walletAddress || !solanaRpc) {
      throw new Error('Connect wallet to view balance');
    }
    const requestId = walletBalanceRequestRef.current + 1;
    walletBalanceRequestRef.current = requestId;

    const connection = new Connection(solanaRpc, 'confirmed');
    const lamports = await connection.getBalance(new PublicKey(walletAddress));
    const sol = lamports / LAMPORTS_PER_SOL;
    const usd = solPriceUsd > 0 ? sol * solPriceUsd : 0;
    const reservedUsd = 0.21;
    const next = {
      solBalance: sol,
      usdBalance: usd,
      reservedUsd,
      maxWithdrawableUsd: Math.max(0, usd - reservedUsd),
      walletPubkey: walletAddress,
      cluster: import.meta.env.VITE_SOLANA_CLUSTER || 'devnet',
    };

    if (requestId < walletBalanceAppliedRef.current) {
      return next;
    }
    walletBalanceAppliedRef.current = requestId;
    setWalletBalanceSol(sol);
    setWalletBalanceUsd(usd);
    setCashoutBalance(next);
    return next;
  }, [privyReady, privyAuthenticated, walletAddress, solanaRpc, solPriceUsd]);

  useEffect(() => {
    const isAuthed = !!privyReady && !!privyAuthenticated;
    if (!isAuthed || !walletAddress || !solanaRpc) {
      setWalletBalanceSol(0);
      setWalletBalanceUsd(0);
      setCashoutBalance({
        usdBalance: 0,
        solBalance: 0,
        reservedUsd: 0.21,
        maxWithdrawableUsd: 0,
        walletPubkey: '',
        cluster: import.meta.env.VITE_SOLANA_CLUSTER || 'devnet',
      });
      return;
    }

    let cancelled = false;
    let backoffMs = 0;
    let timeoutId = null;

    const scheduleNext = (delay) => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(loadBalance, delay);
    };

    const loadBalance = async () => {
      try {
        await refreshWalletBalance();
        if (cancelled) return;
        backoffMs = 0;
        scheduleNext(30000);
      } catch (err) {
        if (cancelled) return;
        const message = err?.message || '';
        const isRateLimit = message.includes('429') || message.toLowerCase().includes('rate limited');
        if (isRateLimit) {
          backoffMs = backoffMs ? Math.min(backoffMs * 2, 120000) : 30000;
          scheduleNext(backoffMs);
          return;
        }
        console.error('Failed to load wallet balance:', err);
        setWalletBalanceSol(null);
        setWalletBalanceUsd(null);
        scheduleNext(30000);
      }
    };

    loadBalance();

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [privyReady, privyAuthenticated, walletAddress, solanaRpc, refreshWalletBalance]);

  useEffect(() => {
    const isAuthed = !!privyReady && !!privyAuthenticated;
    setWalletDisplay({
      usd: isAuthed ? walletBalanceUsd : 0,
      sol: isAuthed ? walletBalanceSol : 0,
      authenticated: isAuthed,
      address: walletAddress || '',
    });
  }, [privyReady, privyAuthenticated, walletBalanceUsd, walletBalanceSol, walletAddress]);

  const handleAddFunds = useCallback(async () => {
    try {
      if (!privyUiReady) return;
      if (!privyUiAuthed) {
        await login();
        return;
      }

      let wallet = embeddedWallet;
      if (!wallet) {
        wallet = await createWallet({ createAdditional: false });
      }

      if (!wallet?.address) return;
      await fundWallet({ address: wallet.address, chain: 'solana:mainnet' });
    } catch (err) {
      console.error('Add funds error:', err);
    }
  }, [privyUiReady, privyUiAuthed, login, embeddedWallet, createWallet, fundWallet]);

  const handleCashOutOpen = useCallback(async () => {
    try {
      if (!privyUiReady) return;
      setCashOutModalOpen(true);
      if (!privyUiAuthed || !walletAddress) {
        setCashoutBalanceError('Connect wallet to view balance');
        return;
      }
      setCashoutBalanceError('');
      setCashoutBalanceLoading(true);
      await refreshWalletBalance();
    } catch (err) {
      setCashoutBalanceError(err?.message || 'Failed to load wallet balance');
    } finally {
      setCashoutBalanceLoading(false);
    }
  }, [privyUiReady, privyUiAuthed, walletAddress, refreshWalletBalance]);

  const handleCashoutRefresh = useCallback(async () => {
    try {
      setCashoutBalanceError('');
      setCashoutBalanceLoading(true);
      await refreshWalletBalance();
    } catch (err) {
      setCashoutBalanceError(err?.message || 'Failed to refresh wallet balance');
    } finally {
      setCashoutBalanceLoading(false);
    }
  }, [refreshWalletBalance]);

  const handleWalletCashoutSubmit = useCallback(async ({ destination, amountUsd }) => {
    if (cashoutSubmitInFlightRef.current) {
      throw new Error('Cashout is already in progress');
    }
    if (!embeddedWallet?.address) throw new Error('No Privy wallet connected');
    if (typeof embeddedWallet.signAndSendTransaction !== 'function') {
      throw new Error('Wallet signing is unavailable for this account');
    }

    cashoutSubmitInFlightRef.current = true;
    setCashoutSubmitting(true);
    try {
      setCashoutToast({
        stage: 'processing',
        message: 'Awaiting wallet signature...',
      });

      if (!solPriceUsd || !Number.isFinite(solPriceUsd) || solPriceUsd <= 0) {
        throw new Error('SOL price unavailable. Please refresh balance and try again.');
      }
      const lamports = Math.floor((Number(amountUsd) / solPriceUsd) * LAMPORTS_PER_SOL);
      if (!Number.isFinite(lamports) || lamports <= 0) {
        throw new Error('Amount is too small for on-chain transfer.');
      }

      const connection = new Connection(solanaRpc, 'confirmed');
      const fromPubkey = new PublicKey(embeddedWallet.address);
      const toPubkey = new PublicKey(destination);
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');

      const tx = new Transaction().add(SystemProgram.transfer({
        fromPubkey,
        toPubkey,
        lamports,
      }));
      tx.recentBlockhash = blockhash;
      tx.feePayer = fromPubkey;

      const unsignedBytes = new Uint8Array(
        tx.serialize({ requireAllSignatures: false, verifySignatures: false }),
      );

      const toBase58Signature = (value) => {
        if (!value) return null;
        if (typeof value === 'string') return value;
        if (value instanceof Uint8Array) return bs58.encode(value);
        if (Array.isArray(value)) return bs58.encode(Uint8Array.from(value));
        if (value?.type === 'Buffer' && Array.isArray(value?.data)) {
          return bs58.encode(Uint8Array.from(value.data));
        }
        return null;
      };

      const extractSignature = (candidate) => {
        if (!candidate) return null;
        const direct = toBase58Signature(candidate);
        if (direct) return direct;
        const keys = ['signature', 'txSignature', 'hash', 'txHash', 'transactionHash'];
        for (const key of keys) {
          const next = toBase58Signature(candidate?.[key]);
          if (next) return next;
        }
        const nestedKeys = ['data', 'response', 'result', 'payload'];
        for (const key of nestedKeys) {
          const nested = extractSignature(candidate?.[key]);
          if (nested) return nested;
        }
        return null;
      };

      let result = null;
      try {
        result = await embeddedWallet.signAndSendTransaction({
          chain: import.meta.env.VITE_SOLANA_CAIP2 || 'solana:devnet',
          transaction: unsignedBytes,
          address: embeddedWallet.address,
        });
      } catch (signErr) {
        const fallbackSig = extractSignature(signErr);
        if (!fallbackSig) throw signErr;
        result = { signature: fallbackSig };
      }

      const signature = extractSignature(result);
      if (!signature) throw new Error('Unable to read transaction signature from wallet response');

      try {
        await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
      } catch {
        // Wallet approval can exceed recent-blockhash validity; retry with signature-only confirmation.
        await connection.confirmTransaction(signature, 'confirmed');
      }

      const cluster = cashoutBalance?.cluster || import.meta.env.VITE_SOLANA_CLUSTER || 'devnet';
      setCashoutToast({
        stage: 'walletCashoutSent',
        signature,
        signatureShort: shortenAddress(signature),
        explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=${encodeURIComponent(cluster)}`,
      });
      setCashOutModalOpen(false);
      await refreshWalletBalance();
    } catch (err) {
      setCashoutToast({
        stage: 'walletCashoutFailed',
        message: err?.message || 'Cashout failed',
      });
      throw err;
    } finally {
      setCashoutSubmitting(false);
      cashoutSubmitInFlightRef.current = false;
    }
  }, [embeddedWallet, shortenAddress, refreshWalletBalance, solPriceUsd, solanaRpc, cashoutBalance]);

  const handleCopyAddress = useCallback(async (address) => {
    const value = address || walletAddress;
    if (!value) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        setCashoutToast({ stage: 'walletCopied', message: 'Wallet address copied' });
        return;
      }
    } catch {
      // Fall back to legacy copy.
    }

    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
      document.execCommand('copy');
    } catch {
      // Ignore copy failures.
    }
    document.body.removeChild(textarea);
    setCashoutToast({ stage: 'walletCopied', message: 'Wallet address copied' });
  }, [walletAddress]);

  const handleMenuLogout = useCallback(async () => {
    try {
      await logout();
    } catch (error) {
      console.warn('Logout failed:', error?.message || error);
    }
  }, [logout]);

  useEffect(() => {
    setWalletActions({
      onAddFunds: handleAddFunds,
      onCopyAddress: handleCopyAddress,
      onCashOut: handleCashOutOpen,
      onLogout: handleMenuLogout,
    });
  }, [handleAddFunds, handleCopyAddress, handleCashOutOpen, handleMenuLogout]);

  // Get server ID based on bet and region
  const getServerId = useCallback((bet, region) => {
    if (bet >= 20) return `${region}-20`;
    if (bet >= 5) return `${region}-5`;
    return `${region}-1`;
  }, []);

  const runNormalJoinFlow = useCallback(async () => {
    if (joining) {
      console.info('[JOIN] early return', { reason: 'joining_in_progress' });
      return;
    }

    if (!privyReady) {
      console.warn('Privy not ready yet');
      console.info('[JOIN] early return', { reason: 'privy_not_ready' });
      return;
    }

    if (!demoPlay) {
      console.info('[JOIN] early return', { reason: 'demo_not_completed' });
      setCashoutToast({
        stage: 'joinBlocked',
        message: 'Please complete the tutorial before joining matches.',
      });
      return;
    }

    const nextName = normalizeUsername(pendingUsername || username || '');
    if (!isValidUsername(nextName)) {
      console.info('[JOIN] early return', { reason: 'invalid_username', nextName });
      setCashoutToast({
        stage: 'joinBlocked',
        message: USERNAME_REQUIRED_MESSAGE,
      });
      return;
    }

    try {
      console.info('[JOIN] start');
      setJoining(true);
      setCashoutError('');
      setName(nextName);
      await commitUsername(nextName);
      await joinGame(selectedBet, getServerId(selectedBet, selectedRegion), selectedBird, nextName);
      await ensureLeaderboardEntry();
      matchStartRef.current = Date.now();
      setGameScreen('game');
      console.info('[JOIN] success');
    } catch (err) {
      console.error('Failed to join game:', err);
      console.info('[JOIN] failed', { reason: err?.message || 'unknown' });
      if (err?.code === 'USERNAME_REQUIRED' || (err?.message || '').toLowerCase().includes('username')) {
        setCashoutToast({
          stage: 'joinBlocked',
          message: USERNAME_REQUIRED_MESSAGE,
        });
      }
      setGameScreen('menu');
      setCashoutError(err?.message || 'Failed to join match');
    } finally {
      setJoining(false);
    }
  }, [joining, privyReady, demoPlay, pendingUsername, username, selectedBet, selectedRegion, selectedBird, setName, joinGame, getServerId, ensureLeaderboardEntry, normalizeUsername, isValidUsername, USERNAME_REQUIRED_MESSAGE, commitUsername]);

  // Handle start game
  const handleStartGame = useCallback(async () => {
    console.info('[JOIN] click', {
      view,
      gameScreen,
      joining: !!joining,
      demoPlay: !!demoPlay,
      demoModeActive: !!demoModeActive,
      username: normalizeUsername(pendingUsername || username || ''),
      isAuthed: !!privyUiAuthed,
      loginInProgress: !!loginInProgressRef.current,
    });
    if (cashoutToast?.stage === 'tutorialComplete') {
      setCashoutToast(null);
    }
    if (joining) {
      console.info('[JOIN] early return', { reason: 'joining_in_progress' });
      return;
    }

    if (!privyReady) {
      console.warn('Privy not ready yet');
      console.info('[JOIN] early return', { reason: 'privy_not_ready' });
      return;
    }

    const isAuthed = !!privyUiAuthed;
    if (!isAuthed) {
      if (loginInProgressRef.current) {
        console.info('[JOIN] early return', { reason: 'login_in_progress' });
        return;
      }
      pendingJoinAfterLoginRef.current = true;
      loginInProgressRef.current = true;
      try {
        await login();
      } catch (err) {
        pendingJoinAfterLoginRef.current = false;
        console.info('[JOIN] login cancelled/failed', { reason: err?.message || 'login_cancelled' });
      } finally {
        loginInProgressRef.current = false;
      }
      return;
    }

    pendingJoinAfterLoginRef.current = false;
    await runNormalJoinFlow();
  }, [joining, view, gameScreen, demoPlay, demoModeActive, privyReady, pendingUsername, username, normalizeUsername, cashoutToast, privyUiAuthed, login, runNormalJoinFlow]);

  useEffect(() => {
    if (!pendingJoinAfterLoginRef.current) return;
    if (!privyReady || !privyUiAuthed) return;
    if (joining || loginInProgressRef.current) return;
    pendingJoinAfterLoginRef.current = false;
    void runNormalJoinFlow();
  }, [privyReady, privyUiAuthed, joining, runNormalJoinFlow]);

  useEffect(() => {
    if (!debugEnabled) return;
    let cancelled = false;
    const scan = () => {
      if (cancelled) return;
      const root =
        document.querySelector('[data-privy-root]') ||
        document.querySelector('[data-privy-modal]') ||
        document.querySelector('[data-privy-overlay]') ||
        document.querySelector('.privy-root') ||
        document.querySelector('.privy-modal');
      if (!root) {
        setPrivyDebugInfo({
          found: false,
          rect: null,
          zIndex: null,
          offscreen: null,
        });
        return;
      }
      const rect = root.getBoundingClientRect();
      const style = window.getComputedStyle(root);
      const zIndex = style.zIndex || 'auto';
      const offscreen =
        rect.bottom < 0 ||
        rect.right < 0 ||
        rect.left > window.innerWidth ||
        rect.top > window.innerHeight;
      setPrivyDebugInfo({
        found: true,
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        },
        zIndex,
        offscreen,
      });
    };
    scan();
    const interval = setInterval(scan, 800);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [debugEnabled, joining]);

  // Handle respawn
  const handleRespawn = useCallback(async () => {
    if (joining) return;
    try {
      setJoining(true);
      await respawn(selectedBet, selectedBird);
      await ensureLeaderboardEntry();
      matchStartRef.current = Date.now();
      setGameScreen('game');
    } catch (err) {
      console.error('Failed to respawn:', err);
      setGameScreen('menu');
    } finally {
      setJoining(false);
    }
  }, [joining, selectedBet, selectedBird, respawn, ensureLeaderboardEntry]);

  const returnToMenuCleanly = useCallback(() => {
    matchStartRef.current = null;
    setGameScreen('menu');
    const forceRelayout = () => {
      rendererRef.current?.resize?.();
      window.dispatchEvent(new Event('resize'));
    };
    requestAnimationFrame(() => {
      forceRelayout();
      requestAnimationFrame(forceRelayout);
    });
  }, []);

  // Handle return to menu
  const handleMainMenu = useCallback(() => {
    returnToMenuCleanly();
  }, [returnToMenuCleanly]);

  const triggerVoucherMintOnce = useCallback(async () => {
    if (voucherMintTriggeredRef.current) return;
    voucherMintTriggeredRef.current = true;
    setVoucherMintFailed(false);
    setVoucherMintInfo(null);
    try {
      const token = await getAccessToken?.();
      if (!token) throw new Error('Missing auth token');
      const response = await fetch('/api/voucher/mint', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Voucher mint failed');
      }
      const data = await response.json();
      if (!data?.ok) {
        throw new Error(data?.error || 'Voucher mint failed');
      }
      const mintAddress = data?.mintAddress || data?.voucher_mint_address || null;
      const txSignature = data?.txSignature || data?.voucher_tx_signature || null;
      setVoucherMintInfo({
        alreadyMinted: !!data?.alreadyMinted,
        mintAddress,
        txSignature,
        explorerUrl: mintAddress
          ? `https://explorer.solana.com/address/${mintAddress}?cluster=devnet`
          : null,
        metadataUri: data?.voucher_metadata_uri || null,
      });
    } catch (err) {
      console.error('[voucher] mint failed', err);
      setVoucherMintFailed(true);
    }
  }, [getAccessToken]);

  const handleSpectate = useCallback(() => {
    setGameScreen('spectate');
  }, []);

  // Handle player death (called from GameCanvas)
  const handleDeath = useCallback((detail) => {
    if (demoModeActive && demoDeathOverrideRef.current) {
      void demoDeathHandlerRef.current?.('app_onDeath');
      return;
    }
    if (typeof detail === 'string') {
      setKillerName(detail || 'Unknown');
      setDeathCause('unknown');
    } else {
      setKillerName(detail?.killerName || 'Unknown');
      setDeathCause(detail?.cause || 'unknown');
    }
    setGameScreen('death');
  }, [demoModeActive]);

  // Handle cashout success (called from GameCanvas)
  const handleCashout = useCallback((detail) => {
    const amountUsd = typeof detail === 'number' ? detail : detail?.amountUsd ?? 0;
    const amountLamports = typeof detail === 'number' ? 0 : detail?.amountLamports ?? 0;
    const amountSol =
      typeof detail === 'number'
        ? 0
        : detail?.amountSol ?? (amountLamports > 0 ? amountLamports / LAMPORTS_PER_SOL : 0);
    const timeMs = matchStartRef.current ? Date.now() - matchStartRef.current : 0;
    const eliminations = myPlayer?.kills ?? 0;
    setCashoutDetails({ amountUsd, amountSol, timeMs, eliminations });
    setPostCashoutBalance({
      loading: true,
      usd: null,
      sol: null,
    });
    setGameScreen('cashout');
    void syncCashoutToLeaderboard(amountUsd);
  }, [syncCashoutToLeaderboard, myPlayer]);

  useEffect(() => {
    if (gameScreen !== 'cashout') return;
    let cancelled = false;
    const refreshPostCashoutBalance = async () => {
      // Keep modal visible immediately, then update lower balance pill when refreshed.
      setPostCashoutBalance((prev) => ({ ...prev, loading: true }));
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          const data = await refreshWalletBalance();
          if (cancelled) return;
          setPostCashoutBalance({
            loading: false,
            usd: Number(data?.usdBalance || 0),
            sol: Number(data?.solBalance || 0),
          });
          return;
        } catch {
          if (cancelled) return;
          await new Promise((resolve) => setTimeout(resolve, 600 + (attempt * 500)));
        }
      }
      if (cancelled) return;
      setPostCashoutBalance({
        loading: false,
        usd: Number.isFinite(walletBalanceUsd) ? walletBalanceUsd : null,
        sol: Number.isFinite(walletBalanceSol) ? walletBalanceSol : null,
      });
    };
    void refreshPostCashoutBalance();
    return () => {
      cancelled = true;
    };
  }, [gameScreen, refreshWalletBalance, walletBalanceUsd, walletBalanceSol]);

  useEffect(() => {
    const onCashoutFailed = (e) => {
      const message = e?.detail?.error || 'Cashout failed. Please try again.';
      setCashoutError(message);
      setGameScreen('menu');
      setCashoutToast({ stage: 'failed', message });
    };
    const onCashoutConfirmed = (e) => {
      const amountUsd = e?.detail?.amountUsd ?? 0;
      const amountLamports = e?.detail?.amountLamports ?? 0;
      const amountSol = amountLamports > 0 ? amountLamports / LAMPORTS_PER_SOL : 0;
      setCashoutToast({ stage: 'confirmed', amountUsd, amountSol });
    };
    const onCashoutStatus = (e) => {
      const detail = e?.detail || {};
      if (detail.stage === 'checking') {
        setCashoutToast({ stage: 'checking' });
      } else if (detail.stage === 'processing') {
        setCashoutToast({ stage: 'processing', signature: detail.signature, message: detail.message });
      }
    };
    const onLateJoinSuccess = () => {
      // Server confirmed join after client timeout — force into game
      console.info('[JOIN] late joinSuccess received, forcing into game');
      setJoining(false);
      matchStartRef.current = Date.now();
      setGameScreen('game');
    };
    window.addEventListener('flappy:cashoutFailed', onCashoutFailed);
    window.addEventListener('flappy:cashout', onCashoutConfirmed);
    window.addEventListener('flappy:cashoutStatus', onCashoutStatus);
    window.addEventListener('flappy:lateJoinSuccess', onLateJoinSuccess);
    return () => {
      window.removeEventListener('flappy:cashoutFailed', onCashoutFailed);
      window.removeEventListener('flappy:cashout', onCashoutConfirmed);
      window.removeEventListener('flappy:cashoutStatus', onCashoutStatus);
      window.removeEventListener('flappy:lateJoinSuccess', onLateJoinSuccess);
    };
  }, []);

  useEffect(() => {
    if (!cashoutToast) return;
    let duration = 6000;
    if (cashoutToast.stage === 'walletCopied') duration = 1800;
    if (cashoutToast.stage === 'usernameSaved') duration = 2200;
    if (cashoutToast.stage === 'joinBlocked') duration = 2000;
    if (cashoutToast.stage === 'tutorialComplete') duration = 3000;
    if (cashoutToast.stage === 'voucherMinted' || cashoutToast.stage === 'voucherMintFailed') duration = 7000;
    if (cashoutToast.stage === 'walletCashoutSent' || cashoutToast.stage === 'walletCashoutFailed') duration = 7000;
    if (cashoutToast.stage === 'confirmed' || cashoutToast.stage === 'failed' || cashoutToast.stage === 'walletCopied' || cashoutToast.stage === 'usernameSaved' || cashoutToast.stage === 'joinBlocked' || cashoutToast.stage === 'tutorialComplete' || cashoutToast.stage === 'voucherMinted' || cashoutToast.stage === 'voucherMintFailed' || cashoutToast.stage === 'walletCashoutSent' || cashoutToast.stage === 'walletCashoutFailed') {
      const timeout = setTimeout(() => setCashoutToast(null), duration);
      return () => clearTimeout(timeout);
    }
  }, [cashoutToast]);

  useEffect(() => {
    if (!gameRootRef.current) return;
    const renderer = initGameRenderer({
      root: gameRootRef.current,
      onPlay: handleStartGame,
      menuVisible: view === 'lobby',
    });
    rendererRef.current = renderer;
    if (renderer?.getMenuOverlayRoot) {
      setMenuOverlayRoot(renderer.getMenuOverlayRoot());
    }
    return () => renderer.destroy();
  }, []);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setMenuVisible(view === 'lobby');
    renderer.setOnPlay(handleStartGame);
  }, [view, handleStartGame]);

  // Local deterministic demo runtime (no multiplayer socket state).
  const demoController = useDemoController({
    enabled: demoModeActive,
    username: normalizeUsername(pendingUsername || username || ''),
    getAuthToken: getAccessToken,
    onExitToMenu: async ({ completedRemotely } = {}) => {
      if (completedRemotely) {
        setDemoPlay(true);
        setDemoStatusLoaded(true);
        setRewardRevealActive(true);
        setGameScreen('demo_reward');
        void triggerVoucherMintOnce();
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('flappy:resetInputLatch', { detail: { reason: 'demo_exit_to_menu' } }));
        }
      } else {
        returnToMenuCleanly();
        setCashoutToast({
          stage: 'failed',
          message: 'Tutorial completion did not save. Try once more.',
        });
      }
    },
  });

  const handleRewardBackToMenu = useCallback(() => {
    setRewardRevealActive(false);
    returnToMenuCleanly();
    if (voucherMintFailed) {
      setCashoutToast({
        stage: 'voucherMintFailed',
        message: 'Voucher mint failed, try again from menu',
      });
      return;
    }
    if (voucherMintInfo && !voucherMintInfo.alreadyMinted) {
      setCashoutToast({
        stage: 'voucherMinted',
        mintAddress: voucherMintInfo.mintAddress || '',
        mintShort: shortenAddress(voucherMintInfo.mintAddress || ''),
        explorerUrl: voucherMintInfo.explorerUrl || null,
      });
    }
  }, [returnToMenuCleanly, voucherMintFailed, voucherMintInfo, shortenAddress]);
  const demoOverlayMounted = demoModeActive;

  useEffect(() => {
    demoDeathOverrideRef.current = !!demoController?.wantsOverrideDeath;
    demoDeathHandlerRef.current = demoController?.handleDemoDeath || null;
  }, [demoController?.wantsOverrideDeath, demoController?.handleDemoDeath]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const active = !!demoModeActive;
    window.__FLAPPY_DEMO_ACTIVE__ = active;
    window.dispatchEvent(new CustomEvent('flappy:demoActiveChange', { detail: { active } }));
    return () => {
      window.__FLAPPY_DEMO_ACTIVE__ = false;
      window.dispatchEvent(new CustomEvent('flappy:demoActiveChange', { detail: { active: false } }));
    };
  }, [demoModeActive]);

  useEffect(() => {
    const update = () => {
      const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
      setIsMobilePortrait(!!coarse && window.innerHeight > window.innerWidth);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const showPortraitLoginButton = view === 'lobby' && isMobilePortrait && !privyUiAuthed;

  useEffect(() => {
    if (!showPortraitLoginButton) {
      setLoginAnchor(null);
      const renderer = rendererRef.current;
      if (renderer?.setMenuOverlayRect) {
        renderer.setMenuOverlayRect(null);
      }
      return;
    }
    const renderer = rendererRef.current;
    if (!renderer?.getMenuLoginAnchor) return;
    const update = () => setLoginAnchor(renderer.getMenuLoginAnchor());
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [showPortraitLoginButton]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer?.setMenuOverlayRect) return;
    renderer.setMenuOverlayRect(loginAnchor || null);
  }, [loginAnchor]);

  const canvasVisible = gameScreen === 'demo' || gameScreen === 'game' || gameScreen === 'death' || gameScreen === 'cashout' || gameScreen === 'spectate';
  const canvasInteractive = gameScreen === 'demo' || gameScreen === 'game';
  const cameraMode = gameScreen === 'cashout' ? 'center' : gameScreen === 'spectate' ? 'spectate' : 'player';
  const showHud = gameScreen === 'demo' || gameScreen === 'game';
  const activeGameState = demoModeActive ? demoController.gameProps : {
    myPlayerId,
    config,
    pipes,
    playersRef,
    bulletsRef,
    orbsRef,
    currentBorderMargin,
    sendInput,
    sessionLeaderboardRows,
    paused: false,
    cameraOverride: null,
    cashoutUiUnlocked: true,
  };

  return (
    <div className="app">
      <div id="game-root" ref={gameRootRef} />
      {view === 'lobby' && !isMobilePortrait && <TopRightLoginBox />}
      <SocialOverlay
        open={socialOpen && view === 'lobby'}
        onClose={() => setSocialOpen(false)}
        currentWalletAddress={walletAddress || ''}
      />
      {showPortraitLoginButton && menuOverlayRoot && loginAnchor
        ? createPortal(
            <TopRightLoginBox
              className="privy-login-box--menu"
              style={{
                left: `${Math.round(loginAnchor.x)}px`,
                top: `${Math.round(loginAnchor.y)}px`,
                width: `${Math.round(loginAnchor.w)}px`,
                height: `${Math.round(loginAnchor.h)}px`,
              }}
            />,
            menuOverlayRoot
          )
        : null}

      <div className="game-layer-stack" style={{ pointerEvents: canvasVisible || demoOverlayMounted ? 'auto' : 'none' }}>
        {/* Game Canvas - always rendered but hidden when not playing */}
        <GameCanvas
          visible={canvasVisible}
          interactive={canvasInteractive}
          cameraMode={cameraMode}
          showHud={showHud}
          demoMode={view === 'demo'}
          demoInputLocked={!!demoController.inputLocked}
          demoInputMode={demoController.scene}
          onContainerRectChange={setDemoOverlayRect}
          myPlayerId={activeGameState.myPlayerId}
          config={activeGameState.config}
          pipes={activeGameState.pipes}
          playersRef={activeGameState.playersRef}
          bulletsRef={activeGameState.bulletsRef}
          orbsRef={activeGameState.orbsRef}
          currentBorderMargin={activeGameState.currentBorderMargin}
          sendInput={activeGameState.sendInput}
          onDeath={handleDeath}
          onCashout={handleCashout}
          /* playersVersion removed — cashout check moved into game loop to avoid 60Hz re-renders */
          sessionLeaderboardRows={activeGameState.sessionLeaderboardRows}
          paused={activeGameState.paused}
          cameraOverride={activeGameState.cameraOverride}
          demoCashoutUiUnlocked={activeGameState.cashoutUiUnlocked}
        />

        {demoOverlayMounted ? (
          <DemoOverlay
            visible={demoController.overlay.visible}
            text={demoController.overlay.typedText}
            promptId={demoController.overlay.promptId}
            currentSceneId={demoController.overlay.currentSceneId}
            sceneIndex={demoController.overlay.sceneIndex}
            sceneTextLength={(demoController.overlay.sceneText || '').length}
            typingProgress={demoController.overlay.typingProgress}
            isTypingComplete={demoController.overlay.isTypingComplete}
            audioComplete={demoController.overlay.audioComplete}
            audioState={demoController.overlay.audioState}
            isPaused={demoController.overlay.isPaused}
            containerRect={demoOverlayRect}
            showActionButton={demoController.overlay.showActionButton}
            actionButtonLabel={demoController.overlay.actionButtonLabel}
            onAction={demoController.overlay.onAction}
            pointerTarget={demoController.overlay.pointerTarget}
            isBusy={demoController.overlay.isBusy}
          />
        ) : null}
      </div>

      <CrateRevealOverlay
        visible={rewardRevealActive && gameScreen === 'demo_reward'}
        onBackToMenu={handleRewardBackToMenu}
        mintInfo={voucherMintInfo}
        mintFailed={voucherMintFailed}
      />

      <CashOutModal
        open={cashOutModalOpen}
        onClose={() => {
          if (!cashoutSubmitting) {
            setCashOutModalOpen(false);
            setCashoutBalanceError('');
          }
        }}
        onRefresh={handleCashoutRefresh}
        onSubmit={handleWalletCashoutSubmit}
        balance={cashoutBalance}
        balanceError={cashoutBalanceError}
        walletConnected={!!walletAddress && !!privyUiAuthed}
        loadingBalance={cashoutBalanceLoading}
        submitting={cashoutSubmitting}
      />

      {/* Death Screen */}
      {gameScreen === 'death' && (
        <DeathScreen
          killerName={killerName}
          cause={deathCause}
          betAmount={selectedBet}
          onRespawn={handleRespawn}
          onMainMenu={handleMainMenu}
        />
      )}

      {/* Cashout Screen */}
      {gameScreen === 'cashout' && (
        <CashoutScreen
          amountUsd={cashoutDetails.amountUsd}
          amountSol={cashoutDetails.amountSol}
          solPriceUsd={solPriceUsd}
          postCashoutTotalUsd={postCashoutBalance.usd}
          postCashoutTotalSol={postCashoutBalance.sol}
          postCashoutBalanceLoading={postCashoutBalance.loading}
          timeSurvivedMs={cashoutDetails.timeMs}
          eliminations={cashoutDetails.eliminations}
          betAmount={selectedBet}
          onPlayAgain={handleRespawn}
          onMainMenu={handleMainMenu}
          onSpectate={handleSpectate}
        />
      )}

      {cashoutToast && (
        <div
          className={`cashout-toast ${cashoutToast.stage === 'walletCopied' ? 'cashout-toast--wallet' : ''} ${cashoutToast.stage === 'usernameSaved' || cashoutToast.stage === 'joinBlocked' || cashoutToast.stage === 'voucherMinted' || cashoutToast.stage === 'voucherMintFailed' || cashoutToast.stage === 'walletCashoutSent' || cashoutToast.stage === 'walletCashoutFailed' ? 'cashout-toast--lobby' : ''} ${cashoutToast.stage === 'tutorialComplete' ? 'cashout-toast--tutorial' : ''} ${cashoutToast.stage === 'voucherMinted' || cashoutToast.stage === 'voucherMintFailed' || cashoutToast.stage === 'walletCashoutSent' ? 'cashout-toast--voucher' : ''}`}
          role="status"
          aria-live="polite"
        >
          {(cashoutToast.stage === 'checking' || cashoutToast.stage === 'processing') && (
            <div className="cashout-toast__button cashout-toast__button--blue">
              <span className="cashout-toast__icon" aria-hidden="true">i</span>
              <span className="cashout-toast__text">
                {cashoutToast.stage === 'checking'
                  ? 'Checking your balance..'
                  : cashoutToast.message || 'Processing payment..'}
              </span>
            </div>
          )}
          {cashoutToast.stage === 'confirmed' && (
            <div className="cashout-toast__button cashout-toast__button--green">
              <span className="cashout-toast__icon cashout-toast__icon--green" aria-hidden="true">i</span>
              <span className="cashout-toast__text cashout-toast__text--green">
                <span>Payment Confirmed! Sent</span>
                <span>{cashoutToast.amountSol?.toFixed(4) ?? '0.0000'} SOL.</span>
              </span>
            </div>
          )}
          {cashoutToast.stage === 'failed' && (
            <div className="cashout-toast__error">
              Cashout failed: {cashoutToast.message}
            </div>
          )}
          {cashoutToast.stage === 'walletCashoutFailed' && (
            <div className="cashout-toast__button cashout-toast__button--red">
              <span className="cashout-toast__icon" aria-hidden="true">i</span>
              <span className="cashout-toast__text">
                {cashoutToast.message || 'Cashout failed'}
              </span>
            </div>
          )}
          {cashoutToast.stage === 'walletCashoutSent' && (
            <div className="cashout-toast__button cashout-toast__button--green cashout-toast__button--voucher">
              <span className="cashout-toast__icon cashout-toast__icon--green" aria-hidden="true">i</span>
              <button className="cashout-toast__close" type="button" onClick={() => setCashoutToast(null)} aria-label="Close notification">x</button>
              <span className="cashout-toast__text cashout-toast__text--green">
                <span>Cashout sent</span>
                <span>Tx: {cashoutToast.signatureShort || 'unavailable'}</span>
                {cashoutToast.explorerUrl ? (
                  <a
                    className="cashout-toast__link"
                    href={cashoutToast.explorerUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View on Explorer
                  </a>
                ) : (
                  <span>Explorer link unavailable</span>
                )}
              </span>
            </div>
          )}
          {cashoutToast.stage === 'walletCopied' && (
            <div className="cashout-toast__button cashout-toast__button--green">
              <span className="cashout-toast__icon cashout-toast__icon--green" aria-hidden="true">i</span>
              <span className="cashout-toast__text cashout-toast__text--green">
                <span>{cashoutToast.message || 'Wallet address copied'}</span>
              </span>
            </div>
          )}
          {cashoutToast.stage === 'usernameSaved' && (
            <div className="cashout-toast__button cashout-toast__button--green">
              <span className="cashout-toast__icon cashout-toast__icon--green" aria-hidden="true">i</span>
              <span className="cashout-toast__text cashout-toast__text--green">
                <span>{cashoutToast.message || 'Username successfully saved!'}</span>
              </span>
            </div>
          )}
          {cashoutToast.stage === 'joinBlocked' && (
            <div className="cashout-toast__button cashout-toast__button--red">
              <span className="cashout-toast__icon" aria-hidden="true">i</span>
              <span className="cashout-toast__text">
                {cashoutToast.message || USERNAME_REQUIRED_MESSAGE}
              </span>
            </div>
          )}
          {cashoutToast.stage === 'tutorialComplete' && (
            <div className="cashout-toast__button cashout-toast__button--green cashout-toast__button--tutorial">
              <span className="cashout-toast__icon cashout-toast__icon--green" aria-hidden="true">i</span>
              <span className="cashout-toast__text cashout-toast__text--green">
                <span>{cashoutToast.message || 'Tutorial completed. You can now join real matches.'}</span>
              </span>
            </div>
          )}
          {cashoutToast.stage === 'voucherMinted' && (
            <div className="cashout-toast__button cashout-toast__button--green cashout-toast__button--voucher">
              <span className="cashout-toast__icon cashout-toast__icon--green" aria-hidden="true">i</span>
              <button className="cashout-toast__close" type="button" onClick={() => setCashoutToast(null)} aria-label="Close notification">x</button>
              <span className="cashout-toast__text cashout-toast__text--green">
                <span>NFT Minted!</span>
                <span>Voucher successfully issued.</span>
                <span>Mint: {cashoutToast.mintShort || 'unavailable'}</span>
                {cashoutToast.explorerUrl ? (
                  <a
                    className="cashout-toast__link"
                    href={cashoutToast.explorerUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View on Explorer
                  </a>
                ) : (
                  <span>Mint complete - explorer link unavailable</span>
                )}
              </span>
            </div>
          )}
          {cashoutToast.stage === 'voucherMintFailed' && (
            <div className="cashout-toast__button cashout-toast__button--red cashout-toast__button--voucher">
              <span className="cashout-toast__icon" aria-hidden="true">i</span>
              <button className="cashout-toast__close" type="button" onClick={() => setCashoutToast(null)} aria-label="Close notification">x</button>
              <span className="cashout-toast__text">
                {cashoutToast.message || 'Voucher mint failed, try again from menu'}
              </span>
            </div>
          )}
        </div>
      )}
      {view === 'lobby' && joining && (
        <div className="join-overlay" role="status" aria-live="polite">
          Joining match...
        </div>
      )}
      {debugEnabled && (
        <div className="privy-debug">
          <div>view: {view}</div>
          <div>screen: {gameScreen}</div>
          <div>privyReady: {privyReady ? 'yes' : 'no'}</div>
          <div>authed: {privyAuthenticated ? 'yes' : 'no'}</div>
          <div>uiReady: {privyUiReady ? 'yes' : 'no'}</div>
          <div>uiAuthed: {privyUiAuthed ? 'yes' : 'no'}</div>
          <div>connected: {connected ? 'yes' : 'no'}</div>
          <div>joining: {joining ? 'yes' : 'no'}</div>
          <div>demoLoaded: {demoStatusLoaded ? 'yes' : 'no'}</div>
          <div>demoPlay: {demoPlay ? 'yes' : 'no'}</div>
          <div>demoScene: {demoModeActive ? demoController.scene : '--'}</div>
          <div>lastError: {lastError?.message || window.__LAST_APP_ERROR__?.message || '--'}</div>
          <div>Privy modal found: {privyDebugInfo?.found ? 'yes' : 'no'}</div>
          <div>
            rect: {privyDebugInfo?.rect ? `${privyDebugInfo.rect.x},${privyDebugInfo.rect.y},${privyDebugInfo.rect.w},${privyDebugInfo.rect.h}` : '--'}
          </div>
          <div>z-index: {privyDebugInfo?.zIndex ?? '--'}</div>
          <div>offscreen: {privyDebugInfo?.offscreen ? 'yes' : 'no'}</div>
        </div>
      )}
    </div>
  );
}

export default function AppWithBoundary() {
  return (
    <ErrorBoundary fallback={<div className="app">Something went wrong.</div>}>
      <App />
    </ErrorBoundary>
  );
}
