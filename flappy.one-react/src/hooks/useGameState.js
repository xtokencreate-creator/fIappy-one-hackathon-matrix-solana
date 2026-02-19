import { useState, useEffect, useCallback, useRef } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useWallets } from '@privy-io/react-auth/solana';
import bs58 from 'bs58';
import { Connection, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { getOrCreateDeviceToken } from '../utils/deviceToken';

const DEFAULT_CONFIG = {
  worldWidth: 6400,
  worldHeight: 5600,
  playerSize: 25,
  bulletSize: 3,
  bulletSpeed: 18,
  bulletLifetime: 120,
  bulletRange: 310,
  playerSpeed: 7,
  shootCooldown: 120,
  boostMax: 100,
  orbSize: 12,
  orbMagnetRadius: 120,
  cashoutTime: 4000,
  cashoutSegments: 4,
  borderMarginMin: 50,
  borderMarginMax: 250,
};

function normalizeSolanaChain(chain) {
  if (!chain) return 'solana:mainnet';
  if (chain.includes('5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp')) return 'solana:mainnet';
  return chain;
}

const DEFAULT_SOLANA_CAIP2 = normalizeSolanaChain(import.meta.env.VITE_SOLANA_CAIP2);
const POT_WALLET_PUBLIC_KEY = import.meta.env.VITE_POT_WALLET_PUBLIC_KEY || '';
const SOLANA_RPC_URL = import.meta.env.VITE_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

let cachedBlockhash = null;
let cachedBlockhashAt = 0;

async function getRecentBlockhash() {
  const now = Date.now();
  if (cachedBlockhash && now - cachedBlockhashAt < 15000) return cachedBlockhash;
  const connection = new Connection(SOLANA_RPC_URL, 'confirmed');
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const { blockhash } = await connection.getLatestBlockhash('confirmed');
      cachedBlockhash = blockhash;
      cachedBlockhashAt = now;
      return blockhash;
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function createBetDepositSignature({ wallet, lamports, potWallet }) {
  if (!wallet) throw new Error('No wallet available');
  if (!wallet.address) throw new Error('Missing wallet address');
  const potAddress = potWallet || POT_WALLET_PUBLIC_KEY;
  if (!potAddress) throw new Error('Missing pot wallet address');

  const fromPubkey = new PublicKey(wallet.address);
  const toPubkey = new PublicKey(potAddress);
  const lamportsInt = Math.floor(Number(lamports));
  if (!Number.isFinite(lamportsInt) || lamportsInt <= 0) throw new Error('Invalid bet amount');

  const tx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey, toPubkey, lamports: lamportsInt })
  );
  tx.recentBlockhash = await getRecentBlockhash();
  tx.feePayer = fromPubkey;

  const serialized = new Uint8Array(
    tx.serialize({ requireAllSignatures: false, verifySignatures: false })
  );

  if (typeof wallet.signTransaction === 'function') {
    const signed = await wallet.signTransaction({
      chain: DEFAULT_SOLANA_CAIP2,
      transaction: serialized,
      address: wallet.address,
    });
    const signedTx = signed?.signedTransaction;
    if (signedTx instanceof Uint8Array) {
      const connection = new Connection(SOLANA_RPC_URL, 'confirmed');
      const signature = await connection.sendRawTransaction(signedTx, { maxRetries: 3 });
      return signature;
    }
  }

  let res;
  try {
    res = await wallet.signAndSendTransaction({
      chain: DEFAULT_SOLANA_CAIP2,
      transaction: serialized,
      address: wallet.address,
    });
  } catch (err) {
    const errSig = err?.signature || err?.data?.signature;
    if (typeof errSig === 'string') return errSig;
    const rawTx = err?.transaction || err?.data?.transaction;
    if (rawTx instanceof Uint8Array) {
      const connection = new Connection(SOLANA_RPC_URL, 'confirmed');
      const signature = await connection.sendRawTransaction(rawTx, { skipPreflight: true });
      return signature;
    }
    throw err;
  }

  if (res?.signature && res.signature instanceof Uint8Array) return bs58.encode(res.signature);
  if (typeof res?.hash === 'string') return res.hash;
  if (typeof res === 'string') return res;
  throw new Error('Unexpected response from signAndSendTransaction');
}

export function useGameState() {
  const { wallets, ready: walletsReady } = useWallets();

  const { ready, authenticated, login, getAccessToken } = usePrivy();
  const demoDebug = import.meta.env.DEV
    && typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('demoDebug') === '1';
  const [demoActive, setDemoActive] = useState(() => {
    if (typeof window === 'undefined') return false;
    return !!window.__FLAPPY_DEMO_ACTIVE__;
  });

  // Used to make join/respawn feel reliable: we only let the UI
  // switch into the "game" screen once the server has actually
  // acknowledged the join and sent an `init` payload.
  const pendingInitResolveRef = useRef(null);
  const pendingInitRejectRef = useRef(null);
  const pendingInitTimeoutRef = useRef(null);
  const pendingEntryResolveRef = useRef(null);
  const pendingEntryRejectRef = useRef(null);
  const pendingEntryTimeoutRef = useRef(null);
  const pendingConfirmRef = useRef(null);
  const pendingConfirmTimerRef = useRef(null);

  const getJwt = useCallback(async () => {
    if (!ready) throw new Error('Privy not ready');
    if (!authenticated) {
      await login();
    }
    const token = await getAccessToken();
    if (!token) throw new Error('No auth token');
    return token;
  }, [ready, authenticated, login, getAccessToken]);

  const [connected, setConnected] = useState(false);
  const [myPlayerId, setMyPlayerId] = useState(null);
  const myPlayerIdRef = useRef(null);
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [pipes, setPipes] = useState([]);
  const [currentBorderMargin, setCurrentBorderMargin] = useState(200);
  const [killFeed, setKillFeed] = useState([]);
  const [sessionLeaderboardRows, setSessionLeaderboardRows] = useState([]);
  const sessionLeaderboardRowsRef = useRef([]);
  const pendingLeaderboardRowsRef = useRef([]);
  const leaderboardReorderTimerRef = useRef(null);
  const lastLeaderboardTsRef = useRef(0);
  
  // Use refs for frequently updated game state (accessed in render loop)
  const playersRef = useRef(new Map());
  const bulletsRef = useRef(new Map());
  const orbsRef = useRef(new Map());
  
  // Also keep state versions for React re-renders when needed
  const [playersVersion, setPlayersVersion] = useState(0);
  const [bulletsVersion, setBulletsVersion] = useState(0);
  const [orbsVersion, setOrbsVersion] = useState(0);
  
  // --- perf: reusable containers + state throttle ---
  const _playerIdBuf = useRef(new Set());
  const _orbIdBuf = useRef(new Set());
  const lastStateAtRef = useRef(0);
  const STATE_THROTTLE_MS = 0;
  const lastUiSyncAtRef = useRef(0);
  const uiSyncTimerRef = useRef(null);
  const perfEnabledRef = useRef(false);
  const netPerfRef = useRef({
    snapshotCount: 0,
    snapshotApplied: 0,
    droppedByThrottle: 0,
    snapshotIntervals: [],
    applyMs: [],
    lastSnapshotRecvTs: 0,
    lastPublishAt: 0,
    trace: [],
  });
  const inputPerfRef = useRef({ count: 0, windowStart: 0, lastEmitMs: 0 });
  const UI_SYNC_INTERVAL_MS = 200;
  const wsMessageCountRef = useRef({ count: 0, bytes: 0, windowStart: 0 });

  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const intentionalCloseRef = useRef(false);
  const perfShotsRef = useRef({ enabled: false, lastInputAt: 0, lastEmitMs: 0, lastDamageMs: 0 });
  const inputSeqRef = useRef(0);
  const remoteShotGateRef = useRef(new Map());
  const lastInputSendRef = useRef({
    at: 0,
    angleQ: 0,
    shooting: false,
    boosting: false,
    cashingOut: false,
    throttleQ: 0,
    paused: false,
  });

  const pushPerfTrace = useCallback((event) => {
    if (!perfEnabledRef.current) return;
    const trace = netPerfRef.current.trace;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    trace.push({ t: now, ...event });
    while (trace.length && now - trace[0].t > 10000) {
      trace.shift();
    }
    if (typeof window !== 'undefined') {
      window.__FLAPPY_STUTTER_TRACE__ = trace.slice();
    }
  }, []);

  const publishNetPerf = useCallback(() => {
    if (typeof window === 'undefined') return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const np = netPerfRef.current;
    if (now - np.lastPublishAt < 250) return;
    np.lastPublishAt = now;

    const intervals = np.snapshotIntervals;
    const applyMs = np.applyMs;
    const avgInterval = intervals.length
      ? intervals.reduce((sum, value) => sum + value, 0) / intervals.length
      : 0;
    const jitter = intervals.length > 1
      ? Math.sqrt(
        intervals.reduce((sum, value) => sum + ((value - avgInterval) ** 2), 0) / intervals.length,
      )
      : 0;
    const sortedIntervals = intervals.length ? [...intervals].sort((a, b) => a - b) : [];
    const p95Interval = sortedIntervals.length
      ? sortedIntervals[Math.min(sortedIntervals.length - 1, Math.floor(sortedIntervals.length * 0.95))]
      : 0;
    const avgApply = applyMs.length
      ? applyMs.reduce((sum, value) => sum + value, 0) / applyMs.length
      : 0;
    const ws = wsRef.current;
    window.__FLAPPY_NET_PERF__ = {
      snapshotRate: avgInterval > 0 ? 1000 / avgInterval : 0,
      snapshotAvgIntervalMs: avgInterval,
      snapshotP95IntervalMs: p95Interval,
      snapshotJitterMs: jitter,
      snapshotCount: np.snapshotCount,
      snapshotApplied: np.snapshotApplied,
      droppedByThrottle: np.droppedByThrottle,
      applyAvgMs: avgApply,
      wsBufferedAmount: Number(ws?.bufferedAmount || 0),
      traceSize: np.trace.length,
    };
  }, []);

  const flushUiSync = useCallback(() => {
    lastUiSyncAtRef.current = typeof performance !== 'undefined' ? performance.now() : Date.now();
    setPlayersVersion(v => v + 1);
    setOrbsVersion(v => v + 1);
    setBulletsVersion(v => v + 1);
  }, []);

  const scheduleUiSync = useCallback((force = false) => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (force || (now - lastUiSyncAtRef.current) >= UI_SYNC_INTERVAL_MS) {
      if (uiSyncTimerRef.current) {
        clearTimeout(uiSyncTimerRef.current);
        uiSyncTimerRef.current = null;
      }
      flushUiSync();
      return;
    }
    if (uiSyncTimerRef.current) return;
    const waitMs = Math.max(0, UI_SYNC_INTERVAL_MS - (now - lastUiSyncAtRef.current));
    uiSyncTimerRef.current = setTimeout(() => {
      uiSyncTimerRef.current = null;
      flushUiSync();
    }, waitMs);
  }, [flushUiSync]);

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (demoActive) {
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
      setConnected(false);
      return;
    }
    if (!ready || !authenticated || !walletsReady || !wallets?.length) {
      console.log('Waiting for Privy auth before connecting WS');
      return;
    }
    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    intentionalCloseRef.current = false;
    
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const envWsUrl = import.meta.env.VITE_WS_URL;
    const normalizedEnvWsUrl = envWsUrl
      ? envWsUrl.replace(/^https?:/i, protocol)
      : null;
    const isLocalHost =
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1';
    const wsUrl = normalizedEnvWsUrl
      ? normalizedEnvWsUrl
      : import.meta.env.DEV && isLocalHost
        ? 'ws://localhost:3000'
        : `${protocol}//${window.location.host}/socket`;

    
    console.log('Connecting to:', wsUrl);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('WebSocket connected');
      setConnected(true);
      // Send privacy-preserving device token for anti-collusion tracking
      const dt = getOrCreateDeviceToken();
      if (dt) { try { ws.send(JSON.stringify({ type: 'deviceToken', token: dt })); } catch (_) {} }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
      setConnected(false);
      if (leaderboardReorderTimerRef.current) {
        clearTimeout(leaderboardReorderTimerRef.current);
        leaderboardReorderTimerRef.current = null;
      }
      pendingLeaderboardRowsRef.current = [];
      sessionLeaderboardRowsRef.current = [];
      lastLeaderboardTsRef.current = 0;
      setSessionLeaderboardRows([]);
      scheduleUiSync(true);
      if (wsRef.current === ws) {
        wsRef.current = null;
      }
      if (intentionalCloseRef.current) return;
      reconnectTimeoutRef.current = setTimeout(connect, 2000);
    };

    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
    };

    ws.onmessage = (event) => {
      try {
        const parseStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
        // --- perf: message rate tracking (exposed on window for perf overlay) ---
        const mc = wsMessageCountRef.current;
        mc.count += 1;
        if (typeof event.data === 'string') mc.bytes += event.data.length;
        if (typeof window !== 'undefined') window.__FLAPPY_WS_PERF__ = mc;
        const message = JSON.parse(event.data);
        const parseCost = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - parseStart;
        if (perfEnabledRef.current) {
          pushPerfTrace({
            kind: 'ws_parse',
            type: message?.type || 'unknown',
            ms: Number(parseCost.toFixed(3)),
            bytes: typeof event.data === 'string' ? event.data.length : 0,
          });
        }
        if (message?.type === 'state') {
          const recvTs = typeof performance !== 'undefined' ? performance.now() : Date.now();
          const np = netPerfRef.current;
          np.snapshotCount += 1;
          if (np.lastSnapshotRecvTs > 0) {
            const interval = recvTs - np.lastSnapshotRecvTs;
            if (Number.isFinite(interval) && interval > 0) {
              np.snapshotIntervals.push(interval);
              if (np.snapshotIntervals.length > 160) np.snapshotIntervals.shift();
            }
          }
          np.lastSnapshotRecvTs = recvTs;
          pushPerfTrace({ kind: 'snapshot_recv', recvTs });
          publishNetPerf();
        }
        handleMessage(message);
      } catch (e) {
        console.error('Failed to parse message:', e);
      }
    };
  }, [ready, authenticated, walletsReady, wallets, demoActive, publishNetPerf, pushPerfTrace, scheduleUiSync]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const perfEnabled = params.get('perf') === '1' || window.localStorage?.getItem('PERF') === '1';
    perfShotsRef.current.enabled = perfEnabled;
    perfEnabledRef.current = perfEnabled;
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const updateDemoActive = (event) => {
      if (typeof event?.detail?.active === 'boolean') {
        setDemoActive(event.detail.active);
        return;
      }
      setDemoActive(!!window.__FLAPPY_DEMO_ACTIVE__);
    };
    window.addEventListener('flappy:demoActiveChange', updateDemoActive);
    return () => window.removeEventListener('flappy:demoActiveChange', updateDemoActive);
  }, []);

  // Handle incoming messages
  const handleMessage = useCallback((message) => {
    if (demoActive) return;
    switch (message.type) {
      case 'init':
        // Resolve any pending join/respawn waiters.
        if (pendingInitTimeoutRef.current) {
          clearTimeout(pendingInitTimeoutRef.current);
          pendingInitTimeoutRef.current = null;
        }
        if (pendingInitResolveRef.current) {
          pendingInitResolveRef.current(true);
          pendingInitResolveRef.current = null;
          pendingInitRejectRef.current = null;
        }

        setMyPlayerId(message.playerId);
        myPlayerIdRef.current = message.playerId;
        setConfig(message.config || DEFAULT_CONFIG);
        setPipes(message.pipes || []);
        setCurrentBorderMargin(message.currentBorderMargin || 200);
        
        {
          const recvTs = typeof performance !== 'undefined' ? performance.now() : Date.now();
          const snapshotTs = Number(message.timestamp || Date.now());
        // Initialize players
        playersRef.current = new Map();
        message.players.forEach(p => {
          playersRef.current.set(p.id, { 
            ...p, 
            // Interpolation state
            displayX: p.x, 
            displayY: p.y, 
            displayAngle: p.angle,
            _snapshotTs: snapshotTs,
            _snapshotRecvTs: recvTs,
          });
        });
        }
        scheduleUiSync(true);
        
        // Initialize orbs
        orbsRef.current = new Map();
        message.orbs.forEach(o => {
          orbsRef.current.set(o.id, { ...o });
        });
        scheduleUiSync(true);
        break;
      case 'entryCreated':
        if (pendingEntryTimeoutRef.current) {
          clearTimeout(pendingEntryTimeoutRef.current);
          pendingEntryTimeoutRef.current = null;
        }
        if (pendingEntryResolveRef.current) {
          pendingEntryResolveRef.current(message);
          pendingEntryResolveRef.current = null;
          pendingEntryRejectRef.current = null;
        }
        break;
      case 'entryError':
        console.warn('[ENTRY_ERROR]', message.code, message.message);
        if (message.code === 'BET_PENDING' && pendingConfirmRef.current) {
          const { entryId, jwt, depositSignature, action } = pendingConfirmRef.current;
          if (!entryId || !depositSignature || !jwt) break;
          const retryAfterMs = typeof message.retryAfterMs === 'number' ? message.retryAfterMs : 1500;
          // Reset the ack timeout — server is still working on it
          if (pendingInitTimeoutRef.current && pendingInitRejectRef.current) {
            clearTimeout(pendingInitTimeoutRef.current);
            const rejectFn = pendingInitRejectRef.current;
            pendingInitTimeoutRef.current = setTimeout(() => {
              pendingInitTimeoutRef.current = null;
              pendingInitResolveRef.current = null;
              pendingInitRejectRef.current = null;
              rejectFn(new Error('Timed out waiting for server response'));
            }, 15000);
          }
          if (pendingConfirmTimerRef.current) {
            clearTimeout(pendingConfirmTimerRef.current);
          }
          pendingConfirmTimerRef.current = setTimeout(() => {
            send({ type: 'confirmEntry', entryId, jwt, depositSignature, action });
          }, retryAfterMs);
          break;
        }
        if (pendingEntryTimeoutRef.current) {
          clearTimeout(pendingEntryTimeoutRef.current);
          pendingEntryTimeoutRef.current = null;
        }
        if (pendingEntryRejectRef.current) {
          const entryErr = new Error(message.message || 'Entry failed');
          entryErr.code = message.code || message.error || 'ENTRY_FAILED';
          pendingEntryRejectRef.current(entryErr);
          pendingEntryResolveRef.current = null;
          pendingEntryRejectRef.current = null;
        }
        if (pendingInitTimeoutRef.current) {
          clearTimeout(pendingInitTimeoutRef.current);
          pendingInitTimeoutRef.current = null;
        }
        if (pendingInitRejectRef.current) {
          const initErr = new Error(message.message || 'Entry failed');
          initErr.code = message.code || message.error || 'ENTRY_FAILED';
          pendingInitRejectRef.current(initErr);
          pendingInitResolveRef.current = null;
          pendingInitRejectRef.current = null;
        }
        break;

      case 'state': {
        const stateNow = performance.now();
        if (stateNow - lastStateAtRef.current < STATE_THROTTLE_MS) {
          netPerfRef.current.droppedByThrottle += 1;
          publishNetPerf();
          break;
        }
        lastStateAtRef.current = stateNow;
        const applyStart = stateNow;

        const recvTs = stateNow;
        const snapshotTs = Number(message.timestamp || Date.now());
        const pMap = playersRef.current;

        // Reuse Set to avoid per-message allocation
        const serverPlayerIds = _playerIdBuf.current;
        serverPlayerIds.clear();

        message.players.forEach(p => {
          serverPlayerIds.add(p.id);
          const existing = pMap.get(p.id);
          if (existing) {
            // Mutate in-place instead of spread-copy
            Object.assign(existing, p);
            existing._snapshotTs = snapshotTs;
            existing._snapshotRecvTs = recvTs;
          } else {
            pMap.set(p.id, {
              ...p,
              displayX: p.x,
              displayY: p.y,
              displayAngle: p.angle,
              _snapshotTs: snapshotTs,
              _snapshotRecvTs: recvTs,
            });
          }
          if (p.id === myPlayerIdRef.current && typeof window !== 'undefined') {
            window.__FLAPPY_INPUT_SEQ_LAST_ACK__ = Number(p.lastInputSeq || 0);
          }
        });

        // Remove disconnected players
        if (pMap.size !== serverPlayerIds.size) {
          pMap.forEach((_, id) => {
            if (!serverPlayerIds.has(id)) pMap.delete(id);
          });
        }
        // Merge-update orbs in-place (avoid new Map every tick)
        const orbMap = orbsRef.current;
        const orbIds = _orbIdBuf.current;
        orbIds.clear();
        message.orbs.forEach(o => {
          orbIds.add(o.id);
          const ex = orbMap.get(o.id);
          if (ex) {
            Object.assign(ex, o);
          } else {
            orbMap.set(o.id, { ...o });
          }
        });
        if (orbMap.size !== orbIds.size) {
          orbMap.forEach((_, id) => {
            if (!orbIds.has(id)) orbMap.delete(id);
          });
        }
        if (message.currentBorderMargin !== undefined) {
          setCurrentBorderMargin((prev) => (
            prev === message.currentBorderMargin ? prev : message.currentBorderMargin
          ));
        }
        scheduleUiSync(false);
        const applyCost = performance.now() - applyStart;
        const np = netPerfRef.current;
        np.snapshotApplied += 1;
        np.applyMs.push(applyCost);
        if (np.applyMs.length > 160) np.applyMs.shift();
        pushPerfTrace({ kind: 'snapshot_apply', applyMs: Number(applyCost.toFixed(3)) });
        publishNetPerf();
        break;
      }

      case 'leaderboard_update':
        {
          const leaderboardApplyStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
          const ts = Number(message?.ts || 0);
          if (ts && ts < lastLeaderboardTsRef.current) break;
          if (ts) lastLeaderboardTsRef.current = ts;
          const rows = Array.isArray(message.rows) ? message.rows : [];
          const normalizedRows = rows.map((row) => ({
            id: row?.id,
            username: row?.username || 'Player',
            balance: Number(row?.balance || 0),
          }));
          const nextTop3 = normalizedRows.slice(0, 3).map((row) => row.id).join('|');
          const prevTop3 = sessionLeaderboardRowsRef.current.slice(0, 3).map((row) => row.id).join('|');
          const top3Changed = nextTop3 !== prevTop3;

          if (top3Changed) {
            if (leaderboardReorderTimerRef.current) {
              clearTimeout(leaderboardReorderTimerRef.current);
              leaderboardReorderTimerRef.current = null;
            }
            pendingLeaderboardRowsRef.current = [];
            sessionLeaderboardRowsRef.current = normalizedRows;
            setSessionLeaderboardRows(normalizedRows);
            break;
          }

          setSessionLeaderboardRows((prev) => {
            const byId = new Map(normalizedRows.map((row) => [row.id, row]));
            const seen = new Set();
            const merged = [];
            for (const row of prev) {
              const next = byId.get(row.id);
              if (!next) continue;
              merged.push({ ...row, ...next });
              seen.add(row.id);
            }
            for (const row of normalizedRows) {
              if (seen.has(row.id)) continue;
              merged.push(row);
            }
            sessionLeaderboardRowsRef.current = merged;
            return merged;
          });

          pendingLeaderboardRowsRef.current = normalizedRows;
          if (!leaderboardReorderTimerRef.current) {
            leaderboardReorderTimerRef.current = setTimeout(() => {
              leaderboardReorderTimerRef.current = null;
              const nextRows = pendingLeaderboardRowsRef.current;
              if (!Array.isArray(nextRows) || !nextRows.length) return;
              pendingLeaderboardRowsRef.current = [];
              sessionLeaderboardRowsRef.current = nextRows;
              setSessionLeaderboardRows(nextRows);
            }, 250);
          }
          if (perfEnabledRef.current) {
            const leaderboardApplyMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - leaderboardApplyStart;
            pushPerfTrace({
              kind: 'leaderboard_apply',
              rows: normalizedRows.length,
              ms: Number(leaderboardApplyMs.toFixed(3)),
            });
          }
          break;
        }

      case 'playerJoin':
        {
        const recvTs = typeof performance !== 'undefined' ? performance.now() : Date.now();
        playersRef.current.set(message.player.id, {
          ...message.player,
          displayX: message.player.x,
          displayY: message.player.y,
          displayAngle: message.player.angle,
          _snapshotTs: Date.now(),
          _snapshotRecvTs: recvTs,
        });
        }
        scheduleUiSync(true);
        break;

      case 'playerLeave':
        playersRef.current.delete(message.playerId);
        scheduleUiSync(true);
        break;

      case 'playerRespawn':
        {
        const recvTs = typeof performance !== 'undefined' ? performance.now() : Date.now();
        playersRef.current.set(message.player.id, {
          ...message.player,
          displayX: message.player.x,
          displayY: message.player.y,
          displayAngle: message.player.angle,
          _snapshotTs: Date.now(),
          _snapshotRecvTs: recvTs,
        });
        }
        scheduleUiSync(true);
        break;
      case 'joinSuccess':
      case 'respawnSuccess':
        // Cancel any pending BET_PENDING retry
        if (pendingConfirmTimerRef.current) {
          clearTimeout(pendingConfirmTimerRef.current);
          pendingConfirmTimerRef.current = null;
        }
        pendingConfirmRef.current = null;
        if (pendingInitTimeoutRef.current) {
          clearTimeout(pendingInitTimeoutRef.current);
          pendingInitTimeoutRef.current = null;
        }
        if (pendingInitResolveRef.current) {
          pendingInitResolveRef.current(true);
          pendingInitResolveRef.current = null;
          pendingInitRejectRef.current = null;
        } else {
          // Arrived after timeout — force into game anyway since server confirmed
          window.dispatchEvent(new CustomEvent('flappy:lateJoinSuccess'));
        }
        break;

      case 'playerDeath':
        // Update kill feed
        const killer = playersRef.current.get(message.killerId);
        const victim = playersRef.current.get(message.playerId);
        if (victim) {
          const killerLabel = killer?.name || (message.cause === 'pipe' ? 'Pipe' : message.cause === 'border' ? 'Border' : 'Unknown');
          setKillFeed(prev => [
            { 
              id: Date.now(), 
              killer: killerLabel, 
              victim: victim.name, 
              cause: message.cause 
            },
            ...prev.slice(0, 4)
          ]);
        }
        
        // Global death FX (for everyone): explosion + proximity death sound
        if (typeof message.x === 'number' && typeof message.y === 'number') {
          const dead = playersRef.current.get(message.playerId);
          const deathTick = Number.isFinite(Number(message.deathTick))
            ? Number(message.deathTick)
            : Date.now();
          window.dispatchEvent(new CustomEvent('flappy:anyDeath', {
            detail: {
              x: message.x,
              y: message.y,
              playerId: message.playerId,
              birdType: dead?.birdType || 'yellow',
              hpBefore: dead?.health ?? null,
              hpAfter: 0,
              deathTick,
              sourceEvent: 'server:playerDeath',
            },
          }));
        }

        // Add death orbs
        if (message.orbs) {
          message.orbs.forEach(o => {
            orbsRef.current.set(o.id, { ...o });
          });
          scheduleUiSync(true);
        }
        scheduleUiSync(true);

        // If it's me, emit a UI-level event with a resolved killer label.
        if (message.playerId && message.playerId === myPlayerIdRef.current) {
          const killerName = killer?.name || (message.cause === 'pipe' ? 'Pipe' : message.cause === 'border' ? 'Border' : 'Unknown');
          console.log('[DEATH]', { cause: message.cause, killerName });
          window.dispatchEvent(new CustomEvent('flappy:death', { detail: { killerName, cause: message.cause || 'unknown' } }));
        }
        break;

      case 'player_shot':
        {
          const shooterId = message.shooterId != null ? String(message.shooterId) : 'unknown';
          const nowPerf = typeof performance !== 'undefined' ? performance.now() : Date.now();
          const lastShotAt = remoteShotGateRef.current.get(shooterId) || 0;
          if (nowPerf - lastShotAt < 35) break;
          remoteShotGateRef.current.set(shooterId, nowPerf);
          const x = Number(message.worldX);
          const y = Number(message.worldY);
          if (!Number.isFinite(x) || !Number.isFinite(y)) break;
          window.dispatchEvent(new CustomEvent('flappy:remoteShot', {
            detail: {
              x,
              y,
              ownerId: message.shooterId,
              timestamp: message.timestamp || Date.now(),
            },
          }));
          break;
        }

      case 'bulletSpawn':
        {
        const coarse = typeof window !== 'undefined' && window.matchMedia
          ? window.matchMedia('(pointer: coarse)').matches
          : false;
        const mobileLandscape = coarse && typeof window !== 'undefined' && window.innerWidth > window.innerHeight;
        const bullet = message.bullet;

        if (mobileLandscape) {
          // Mobile landscape perf mode: skip server bullet entity churn entirely.
          if (bullet && typeof bullet.x === 'number' && typeof bullet.y === 'number') {
            window.dispatchEvent(new CustomEvent('flappy:shot', { detail: { x: bullet.x, y: bullet.y, ownerId: bullet.ownerId } }));
          }
          break;
        }

        // Add bullet with local position tracking
        bulletsRef.current.set(bullet.id, {
          ...bullet,
          localX: bullet.x,
          localY: bullet.y,
          spawnTime: Date.now(),
        });
        if (perfShotsRef.current.enabled) {
          const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
          const tSpawn = Number((message?.perf?.t_spawnBullet ?? 0).toFixed(3));
          const tEmit = Number((message?.perf?.t_emitNetwork ?? perfShotsRef.current.lastEmitMs ?? 0).toFixed(3));
          const tDamage = Number((perfShotsRef.current.lastDamageMs ?? 0).toFixed(3));
          const tAlloc = Number((message?.perf?.t_allocations ?? 0).toFixed(3));
          console.info('[perf] shot', {
            t_input: Number(Math.max(0, now - perfShotsRef.current.lastInputAt).toFixed(3)),
            t_spawnBullet: tSpawn,
            t_emitNetwork: tEmit,
            t_damageCheck: tDamage,
            t_audio: 0,
            t_allocations: tAlloc,
            t_totalShotCost: Number((tSpawn + tEmit + tDamage + tAlloc).toFixed(3)),
            bullets_alive: bulletsRef.current.size,
            players_count: playersRef.current.size,
            entities_collision: playersRef.current.size + bulletsRef.current.size + orbsRef.current.size,
            events_queue_len: 0,
          });
        }

        // Global shot FX event; on mobile landscape only emit for local shots to avoid
        // per-bullet event churn from remote players.
        if (bullet && typeof bullet.x === 'number' && typeof bullet.y === 'number') {
          const coarse = typeof window !== 'undefined' && window.matchMedia
            ? window.matchMedia('(pointer: coarse)').matches
            : false;
          const mobileLandscape = coarse && typeof window !== 'undefined' && window.innerWidth > window.innerHeight;
          if (mobileLandscape && bullet.ownerId !== myPlayerIdRef.current) {
            break;
          }
          if (demoDebug) {
            console.info('[SRV] spawnBullet', {
              shooter: bullet.ownerId,
              x: Math.round(bullet.x),
              y: Math.round(bullet.y),
            });
          }
          window.dispatchEvent(new CustomEvent('flappy:shot', { detail: { x: bullet.x, y: bullet.y, ownerId: bullet.ownerId } }));
        }
        break;
        }

      case 'bulletsRemove':
        {
        const coarse = typeof window !== 'undefined' && window.matchMedia
          ? window.matchMedia('(pointer: coarse)').matches
          : false;
        const mobileLandscape = coarse && typeof window !== 'undefined' && window.innerWidth > window.innerHeight;
        if (mobileLandscape) break;
        message.bulletIds.forEach(id => {
          bulletsRef.current.delete(id);
        });
        break;
        }

      case 'orbsCollected':
        if (demoDebug) {
          console.info('[DROP] pickedUp', { ids: message.orbIds?.length || 0, newBalanceLamports: message.newBalanceLamports ?? 0 });
        }
        {
          const firstOrbId = Array.isArray(message.orbIds) ? message.orbIds[0] : null;
          const firstOrb = firstOrbId ? orbsRef.current.get(firstOrbId) : null;
          const collector = message.playerId ? playersRef.current.get(message.playerId) : null;
          const x = Number.isFinite(firstOrb?.x) ? firstOrb.x : collector?.x;
          const y = Number.isFinite(firstOrb?.y) ? firstOrb.y : collector?.y;
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('flappy:orbsCollected', {
              detail: {
                playerId: message.playerId,
                orbCount: Array.isArray(message.orbIds) ? message.orbIds.length : 0,
                x,
                y,
              },
            }));
          }
        }
        message.orbIds.forEach(id => {
          orbsRef.current.delete(id);
        });
        scheduleUiSync(true);
        break;

      case 'orbsSpawned':
        if (demoDebug) {
          const first = message.orbs?.[0];
          console.info('[DROP] received', {
            clientCount: Array.isArray(message.orbs) ? message.orbs.length : 0,
            id: first?.id,
            x: Math.round(Number(first?.x || 0)),
            y: Math.round(Number(first?.y || 0)),
          });
        }
        message.orbs.forEach(o => {
          orbsRef.current.set(o.id, { ...o });
        });
        scheduleUiSync(true);
        break;

      case 'playerHit':
        const hitPlayer = playersRef.current.get(message.playerId);
        if (hitPlayer) {
          if (perfShotsRef.current.enabled) {
            perfShotsRef.current.lastDamageMs = Number((message?.perf?.t_damageCheck ?? 0).toFixed(3));
          }
          const hitAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
          playersRef.current.set(message.playerId, { 
            ...hitPlayer, 
            health: message.health,
            hitAt
          });
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('flappy:playerHit', { 
              detail: { playerId: message.playerId, x: hitPlayer.x, y: hitPlayer.y, attackerId: message.attackerId } 
            }));
          }
          scheduleUiSync(true);
        }
        break;

      case 'playerCashout':
        break;

      case 'cashoutSuccess':
        // Notify UI (GameCanvas/App) that my cashout succeeded.
        window.dispatchEvent(new CustomEvent('flappy:cashout', { detail: { amountUsd: message.amountUsd ?? 0, amountLamports: message.amountLamports ?? 0 } }));
        break;
      case 'cashoutStatus':
        window.dispatchEvent(new CustomEvent('flappy:cashoutStatus', { detail: message }));
        break;
      case 'cashoutFailed':
        console.error('Cashout failed:', message.error || 'Unknown error');
        window.dispatchEvent(new CustomEvent('flappy:cashoutFailed', { detail: { error: message.error } }));
        break;

      case 'error':
        // If the server rejects a join/respawn, keep the UI in menu and surface a message.
        if (pendingInitTimeoutRef.current) {
          clearTimeout(pendingInitTimeoutRef.current);
          pendingInitTimeoutRef.current = null;
        }
        if (pendingInitRejectRef.current) {
          pendingInitRejectRef.current(new Error(message.message || 'Server error'));
          pendingInitResolveRef.current = null;
          pendingInitRejectRef.current = null;
        }
        if (pendingEntryTimeoutRef.current) {
          clearTimeout(pendingEntryTimeoutRef.current);
          pendingEntryTimeoutRef.current = null;
        }
        if (pendingEntryRejectRef.current) {
          pendingEntryRejectRef.current(new Error(message.message || 'Server error'));
          pendingEntryResolveRef.current = null;
          pendingEntryRejectRef.current = null;
        }
        break;
    }
  }, [demoActive, publishNetPerf, pushPerfTrace, scheduleUiSync]);

  // Send message to server
  const send = useCallback((message) => {
    if (demoActive) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, [demoActive]);

  const waitForSocketOpen = useCallback(async () => {
    const start = Date.now();
    while (Date.now() - start < 10000) {
      if (ready && authenticated && walletsReady && wallets?.length) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    if (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED) {
      connect();
    }
    const wsStart = Date.now();
    while (Date.now() - wsStart < 10000) {
      if (wsRef.current?.readyState === WebSocket.OPEN) return;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error('WebSocket not connected');
  }, [connect, ready, authenticated, walletsReady, wallets]);

  // Game actions
  const setName = useCallback((name) => {
    send({ type: 'setName', name });
  }, [send]);

  const waitForServerAck = useCallback(() => {
    if (pendingInitTimeoutRef.current) {
      clearTimeout(pendingInitTimeoutRef.current);
      pendingInitTimeoutRef.current = null;
    }
    return new Promise((resolve, reject) => {
      pendingInitResolveRef.current = resolve;
      pendingInitRejectRef.current = reject;
      pendingInitTimeoutRef.current = setTimeout(() => {
        pendingInitTimeoutRef.current = null;
        pendingInitResolveRef.current = null;
        pendingInitRejectRef.current = null;
        reject(new Error('Timed out waiting for server response'));
      }, 30000);
    });
  }, []);

  const requestEntry = useCallback((payload) => {
    if (pendingEntryTimeoutRef.current) {
      clearTimeout(pendingEntryTimeoutRef.current);
      pendingEntryTimeoutRef.current = null;
    }
    return new Promise(async (resolve, reject) => {
      pendingEntryResolveRef.current = resolve;
      pendingEntryRejectRef.current = reject;
      pendingEntryTimeoutRef.current = setTimeout(() => {
        pendingEntryTimeoutRef.current = null;
        pendingEntryResolveRef.current = null;
        pendingEntryRejectRef.current = null;
        reject(new Error('Timed out waiting for entry response'));
      }, 12000);
      try {
        await waitForSocketOpen();
        send({ type: 'requestEntry', ...payload });
      } catch (err) {
        if (pendingEntryTimeoutRef.current) {
          clearTimeout(pendingEntryTimeoutRef.current);
          pendingEntryTimeoutRef.current = null;
        }
        pendingEntryResolveRef.current = null;
        pendingEntryRejectRef.current = null;
        reject(err);
      }
    });
  }, [send, waitForSocketOpen]);

  const joinGame = useCallback(async (betAmount, serverId, birdType, username) => {
    console.info('[JOIN] request', { betAmount, serverId, birdType });
    const jwt = await getJwt();
    await waitForSocketOpen();
    const wallet = wallets?.find(
      (candidate) =>
        candidate?.walletClientType === 'privy' ||
        candidate?.isPrivyWallet ||
        candidate?.wallet?.isPrivyWallet,
    ) || wallets?.[0];
    if (!wallet) throw new Error('No Solana wallet available. Please log in first.');
    const entry = await requestEntry({ betAmount, serverId, birdType, action: 'join', jwt, username });
    const depositSignature = await createBetDepositSignature({
      wallet,
      lamports: entry.buyInLamports,
      potWallet: entry.potWallet,
    });
    pendingConfirmRef.current = { entryId: entry.entryId, jwt, depositSignature, action: 'join' };
    const ackPromise = waitForServerAck();
    send({ type: 'confirmEntry', entryId: entry.entryId, jwt, depositSignature });
    return ackPromise;
  }, [send, getJwt, waitForServerAck, requestEntry, wallets]);

  // Track pause state to only send when changed
  const lastPausedRef = useRef(false);
  const lastShootLogRef = useRef(false);
  
  const sendInput = useCallback((angle, shooting, boosting, cashingOut, paused = false, throttle = 1) => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const coarse = typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(pointer: coarse)').matches
      : false;
    const mobileLandscape = coarse && typeof window !== 'undefined' && window.innerWidth > window.innerHeight;
    const anglePrecision = mobileLandscape ? 100 : 1000;
    const throttlePrecision = mobileLandscape ? 20 : 100;
    const angleQ = Math.round(angle * anglePrecision) / anglePrecision;
    const throttleQ = Math.round(throttle * throttlePrecision) / throttlePrecision;
    const prev = lastInputSendRef.current;
    const sameState =
      prev.angleQ === angleQ &&
      prev.shooting === shooting &&
      prev.boosting === boosting &&
      prev.cashingOut === cashingOut &&
      prev.throttleQ === throttleQ &&
      prev.paused === paused;
    const minIntervalMs = mobileLandscape
      ? 50
      : (shooting ? 66 : 33);
    if (sameState && now - prev.at < minIntervalMs) {
      return;
    }
    const emitStart = now;
    if (demoDebug && lastShootLogRef.current !== !!shooting) {
      lastShootLogRef.current = !!shooting;
      console.info('[NET] client fire pressed -> sendInput', { fire: shooting ? 1 : 0 });
    }
    const inputSeq = ++inputSeqRef.current;
    if (typeof window !== 'undefined') {
      window.__FLAPPY_INPUT_SEQ_LAST_SENT__ = inputSeq;
    }
    send({
      type: 'input',
      angle: angleQ,
      shooting,
      boosting,
      cashingOut,
      throttle: throttleQ,
      inputSeq,
      clientInputTs: Date.now(),
      mobileLowFx: mobileLandscape,
      perf: perfShotsRef.current.enabled,
    });
    const emitMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - emitStart;
    {
      const ip = inputPerfRef.current;
      ip.count += 1;
      ip.lastEmitMs = emitMs;
      if (typeof window !== 'undefined') {
        const nowWindow = typeof performance !== 'undefined' ? performance.now() : Date.now();
        if (!ip.windowStart) ip.windowStart = nowWindow;
        const elapsedSec = Math.max(0.001, (nowWindow - ip.windowStart) / 1000);
        if (elapsedSec >= 1) {
          window.__FLAPPY_INPUT_PERF__ = {
            rate: ip.count / elapsedSec,
            emitMs: ip.lastEmitMs,
          };
          ip.count = 0;
          ip.windowStart = nowWindow;
        }
      }
    }
    lastInputSendRef.current = {
      at: now,
      angleQ,
      shooting,
      boosting,
      cashingOut,
      throttleQ,
      paused,
    };
    if (shooting && perfShotsRef.current.enabled) {
      perfShotsRef.current.lastInputAt = now;
      perfShotsRef.current.lastEmitMs = Number(emitMs.toFixed(3));
    }
    // Only send pause state when it changes
    if (paused !== lastPausedRef.current) {
      lastPausedRef.current = paused;
      send({ type: 'pause', paused });
    }
  }, [send]);

  const respawn = useCallback(async (betAmount, birdType) => {
    const jwt = await getJwt();
    await waitForSocketOpen();
    const wallet = wallets?.find(
      (candidate) =>
        candidate?.walletClientType === 'privy' ||
        candidate?.isPrivyWallet ||
        candidate?.wallet?.isPrivyWallet,
    ) || wallets?.[0];
    if (!wallet) throw new Error('No Solana wallet available. Please log in first.');
    const entry = await requestEntry({ betAmount, birdType, action: 'respawn', jwt });
    const depositSignature = await createBetDepositSignature({
      wallet,
      lamports: entry.buyInLamports,
      potWallet: entry.potWallet,
    });
    pendingConfirmRef.current = { entryId: entry.entryId, jwt, depositSignature, action: 'respawn' };
    const ackPromise = waitForServerAck();
    send({ type: 'confirmEntry', entryId: entry.entryId, jwt, depositSignature, action: 'respawn' });
    return ackPromise;
  }, [send, getJwt, waitForServerAck, requestEntry, wallets, waitForSocketOpen]);

  // Connect on mount
 useEffect(() => {
  connect();
  return () => {
    intentionalCloseRef.current = true;
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (pendingConfirmTimerRef.current) {
      clearTimeout(pendingConfirmTimerRef.current);
    }
    if (leaderboardReorderTimerRef.current) {
      clearTimeout(leaderboardReorderTimerRef.current);
      leaderboardReorderTimerRef.current = null;
    }
    if (uiSyncTimerRef.current) {
      clearTimeout(uiSyncTimerRef.current);
      uiSyncTimerRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }
  };
}, [connect]);


  // Get my player data
  const myPlayer = playersRef.current.get(myPlayerId);

  return {
    connected,
    privyReady: ready,
    privyAuthenticated: authenticated,
    myPlayerId,
    myPlayer,
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
    wsMessageCountRef,
    setName,
    joinGame,
    sendInput,
    respawn,
  };
}



