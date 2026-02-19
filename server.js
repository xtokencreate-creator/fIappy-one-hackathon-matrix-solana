require('dotenv').config();
// console.log("RPC =", process.env.SOLANA_RPC_URL);
const crypto = require('crypto');
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const risk = require('./risk');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_REST_URL = SUPABASE_URL ? `${SUPABASE_URL.replace(/\/+$/, '')}/rest/v1` : null;

const {
  Connection,
  Transaction,
  SystemProgram,
  PublicKey,
  LAMPORTS_PER_SOL,
  Keypair
} = require('@solana/web3.js');
const { Metaplex, keypairIdentity } = require('@metaplex-foundation/js');

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL;
if (!SOLANA_RPC_URL) {
  throw new Error("Missing SOLANA_RPC_URL in .env");
}

const connection = new Connection(SOLANA_RPC_URL, "confirmed");
const VOUCHER_SOLANA_RPC_URL = process.env.VOUCHER_SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const voucherConnection = new Connection(VOUCHER_SOLANA_RPC_URL, "confirmed");


require('dotenv').config();

// ============================================================================
// CONFIGURATION
// ============================================================================
const CONFIG = {
    PORT: 3000,
    TICK_RATE: 60,
    STATE_BROADCAST_RATE: 60,
    WORLD_WIDTH: 6400,
    WORLD_HEIGHT: 5600,
    
    // Player settings
    PLAYER_SPEED: 21,
    PLAYER_BOOST_SPEED: 28.5,
    PLAYER_TURN_SPEED: 0.18,
    PLAYER_MAX_TURN_SLOWDOWN: 0.4,
    PLAYER_SIZE: 25,
    PLAYER_MAX_HEALTH: 100,
    PLAYER_RESPAWN_TIME: 3000,
    
    // Boost settings
    BOOST_MAX: 100,
    BOOST_DRAIN_RATE: 40,
    BOOST_REGEN_RATE: 20,
    BOOST_DEPLETED_DELAY: 1500,
    BOOST_MIN_THRESHOLD: 5,
    
    // Bullet settings
    BULLET_SPEED: 18,
    BULLET_DAMAGE: 10,
    BULLET_LIFETIME: 1200,
    BULLET_SIZE: 9,
    SHOOT_COOLDOWN: 120,
    BULLET_SPREAD: 0.08,
    BULLET_RANGE: 1240,
    
    // Orb/Feather settings
    ORB_COUNT_ON_DEATH: 10,
    ORB_SIZE: 12,
    ORB_COLLECT_RADIUS: 50,
    ORB_MAGNET_RADIUS: 120,
    ORB_MAGNET_SPEED: 2,
    ORB_SPREAD_RADIUS: 100,
    ORB_INITIAL_VELOCITY: 2,
    ORB_FRICTION: 0.92,
    ORB_SETTLE_TIME: 400,
    
    // Border settings
    BORDER_MARGIN_MIN: 80,
    BORDER_MARGIN_MAX: 320,
    BORDER_PLAYERS_MIN: 1,
    BORDER_PLAYERS_MAX: 8,
    
    // Spawn settings
    SPAWN_MARGIN: 250,
    
    // Cashout settings
    CASHOUT_TIME: 4000,
    CASHOUT_SEGMENTS: 4,
    
    // Security
    MAX_INPUT_QUEUE: 10,
    POSITION_TOLERANCE: 50,
    RATE_LIMIT_WINDOW: 1000,
    MAX_MESSAGES_PER_WINDOW: 60,
};

// =====================================================================
// TEMP TEST BOTS (SERVER-AUTH, REMOVE AFTER FOOTAGE)
// =====================================================================
const TEST_BOT_COUNT = 5;
const TEST_BOT_NAMES = ['Sky', 'Rookie', 'Nova', 'Jet', 'Echo', 'Piper', 'Zuzu', 'Indigo', 'Kiwi', 'Sparx'];
const TEST_BOT_MIN_SHOT_MS = 1500;
const TEST_BOT_MAX_SHOT_MS = 3000;
const TEST_BOT_BURST_MS = 3000;
const TEST_BOT_BURST_PAUSE_MIN_MS = 1000;
const TEST_BOT_BURST_PAUSE_MAX_MS = 2000;
const TEST_BOT_BURST_SHOT_MIN_MS = 140;
const TEST_BOT_BURST_SHOT_MAX_MS = 220;
const TEST_BOT_TARGET_MS = 1200;
const TEST_BOT_WANDER_MS = 1500;
const TEST_BOT_AVOID_MARGIN = CONFIG.PLAYER_SIZE * 6;
const TEST_BOT_PIPE_PAD = CONFIG.PLAYER_SIZE * 2.2;
const TEST_BOT_MIN_SHOT_DISTANCE = CONFIG.PLAYER_SIZE * 6.5;
const TEST_BOT_BORDER_SOFT = CONFIG.PLAYER_SIZE * 12; // Much larger buffer from border
const TEST_BOT_AIM_BASE_ERROR_MIN_DEG = 8;
const TEST_BOT_AIM_BASE_ERROR_MAX_DEG = 18;
const TEST_BOT_AIM_MAX_ERROR_MULT = 1.8;
const TEST_BOT_AIM_JITTER_MIN_MS = 300;
const TEST_BOT_AIM_JITTER_MAX_MS = 500;
// Balance range for bots ($5-$20 flat integers)
const TEST_BOT_MIN_BALANCE_USD = 5;
const TEST_BOT_MAX_BALANCE_USD = 20;
// Cashout chance and duration (per second, not per tick)
const TEST_BOT_CASHOUT_CHANCE = 0.08; // 8% chance per second to start cashout
const TEST_BOT_CASHOUT_CANCEL_CHANCE = 0.05; // 5% chance per second to cancel mid-cashout
const DISABLE_BOTS = true;
// Fake WebSocket for bots - never sends, always appears closed
const TEST_BOT_WS = { readyState: WebSocket.CLOSED, send: () => {} };
let testBotsSpawned = false;
let botsDisabledLogged = false;

// Bot AI state storage (keyed by bot playerId)
const botAIState = new Map();

const CAMERA_ZOOM = 3;
const GROUND_HEIGHT_RATIO = 0.18;
const DEBUG_DISABLE_BORDER = false;
const GROUND_HEIGHT = Math.floor(CONFIG.WORLD_HEIGHT * GROUND_HEIGHT_RATIO);
const GROUND_EPS = 0.5;
const BASE_BIRD_SCALE = 2.5;
const VISUAL_BIRD_SCALE = 10.5;
const BULLET_MUZZLE_SCALE = VISUAL_BIRD_SCALE / BASE_BIRD_SCALE;
const GROUND_Y = CONFIG.WORLD_HEIGHT - GROUND_HEIGHT;

function getGroundTopWorldY() {
    return GROUND_Y;
}

const BUYIN_OPTIONS = new Set([1, 5, 25]);
const ENTRY_FEE_BUFFER_USD = Number(process.env.ENTRY_FEE_BUFFER_USD || '0.20');
const WALLET_CASHOUT_RESERVED_USD = Number(process.env.WALLET_CASHOUT_RESERVED_USD || '0.21');
const WALLET_CASHOUT_RATE_LIMIT_MAX = Number(process.env.WALLET_CASHOUT_RATE_LIMIT_MAX || '3');
const WALLET_CASHOUT_RATE_LIMIT_WINDOW_MS = Number(process.env.WALLET_CASHOUT_RATE_LIMIT_WINDOW_MS || '60000');
const WALLET_CASHOUT_PENDING_TTL_MS = Number(process.env.WALLET_CASHOUT_PENDING_TTL_MS || '300000');
const SOLANA_EXPLORER_CLUSTER = String(process.env.SOLANA_EXPLORER_CLUSTER || 'devnet').trim();
const DISCORD_WEBHOOK_URL = String(process.env.DISCORD_WEBHOOK_URL || '').trim();
const DISCORD_EVENT_DEDUPE_WINDOW_MS = Number(process.env.DISCORD_EVENT_DEDUPE_WINDOW_MS || '60000');
const ENTRY_EXPIRY_MS = Number(process.env.ENTRY_EXPIRY_MS || '120000');
const SOL_PRICE_TTL_MS = Number(process.env.SOL_PRICE_TTL_MS || '60000');
const PAYOUT_TX_FEE_BUFFER_LAMPORTS = Number(process.env.PAYOUT_TX_FEE_BUFFER_LAMPORTS || '5000');
const ACCOUNT_INFO_TTL_MS = Number(process.env.ACCOUNT_INFO_TTL_MS || '60000');
const PAYOUT_BACKOFF_MS = Number(process.env.PAYOUT_BACKOFF_MS || '60000');
const BLOCKHASH_TTL_MS = Number(process.env.BLOCKHASH_TTL_MS || '15000');
const LOG_LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase();
const MOVEMENT_DEBUG = process.env.NODE_ENV !== 'production' && process.env.MOVEMENT_DEBUG === '1';
const PERF_METRICS_ENABLED = process.env.NODE_ENV !== 'production' || process.env.PERF_METRICS === '1';
const PERF_SAMPLE_MAX = 180;
let movementDebugPlayerId = null;

const serverPerf = {
    tickIntervalsMs: [],
    loopDurationsMs: [],
    stateBroadcastIntervalsMs: [],
    stateBroadcastBytes: [],
    stateBroadcastSendMs: [],
    tickCount: 0,
    longTicks32: 0,
    longTicks50: 0,
    skippedTicks: 0,
    clients: 0,
    entities: { players: 0, bullets: 0, orbs: 0 },
    heapUsedMb: 0,
    rssMb: 0,
    lastUpdatedAt: 0,
};

function perfPush(arr, value) {
    if (!Number.isFinite(value)) return;
    arr.push(value);
    if (arr.length > PERF_SAMPLE_MAX) arr.shift();
}

function perfAvg(arr) {
    if (!arr.length) return 0;
    return arr.reduce((sum, value) => sum + value, 0) / arr.length;
}

function perfP95(arr) {
    if (!arr.length) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
}

function perfStdDev(arr) {
    if (!arr.length) return 0;
    const avg = perfAvg(arr);
    const variance = arr.reduce((sum, value) => sum + ((value - avg) ** 2), 0) / arr.length;
    return Math.sqrt(Math.max(0, variance));
}

function getServerPerfSnapshot() {
    const tickAvgMs = perfAvg(serverPerf.tickIntervalsMs);
    const loopAvgMs = perfAvg(serverPerf.loopDurationsMs);
    const longTickPct = serverPerf.tickCount > 0
        ? ((serverPerf.longTicks32 / serverPerf.tickCount) * 100)
        : 0;
    return {
        enabled: PERF_METRICS_ENABLED,
        tickAvgMs,
        tickP95Ms: perfP95(serverPerf.tickIntervalsMs),
        loopAvgMs,
        loopP95Ms: perfP95(serverPerf.loopDurationsMs),
        longTickPct,
        longTicks32: serverPerf.longTicks32,
        longTicks50: serverPerf.longTicks50,
        skippedTicks: serverPerf.skippedTicks,
        stateBytesAvg: perfAvg(serverPerf.stateBroadcastBytes),
        stateBytesP95: perfP95(serverPerf.stateBroadcastBytes),
        stateIntervalAvgMs: perfAvg(serverPerf.stateBroadcastIntervalsMs),
        stateIntervalP95Ms: perfP95(serverPerf.stateBroadcastIntervalsMs),
        stateIntervalJitterMs: perfStdDev(serverPerf.stateBroadcastIntervalsMs),
        stateSendAvgMs: perfAvg(serverPerf.stateBroadcastSendMs),
        clients: serverPerf.clients,
        entities: serverPerf.entities,
        heapUsedMb: serverPerf.heapUsedMb,
        rssMb: serverPerf.rssMb,
        updatedAt: serverPerf.lastUpdatedAt,
    };
}

if (PERF_METRICS_ENABLED) {
    setInterval(() => {
        const mem = process.memoryUsage();
        serverPerf.heapUsedMb = Number((mem.heapUsed / (1024 * 1024)).toFixed(2));
        serverPerf.rssMb = Number((mem.rss / (1024 * 1024)).toFixed(2));
        serverPerf.lastUpdatedAt = Date.now();
    }, 1000);
}

function logDebug(message, meta) {
    if (LOG_LEVEL !== 'debug') return;
    if (meta) {
        console.log(`[DEBUG] ${message}`, meta);
    } else {
        console.log(`[DEBUG] ${message}`);
    }
}

function logInfo(message, meta) {
    if (meta) {
        console.log(`[INFO] ${message}`, meta);
    } else {
        console.log(`[INFO] ${message}`);
    }
}

logInfo(`Log level set to ${LOG_LEVEL}`);
const DEV_LOG_BOTS = process.env.NODE_ENV !== 'production';
const DEG_TO_RAD = Math.PI / 180;

// ============================================================================
// PRIVY & SOLANA SETUP
// ============================================================================
const { PrivyClient } = require('@privy-io/server-auth');
const bs58 = require('bs58');

const privy = new PrivyClient(
    process.env.PRIVY_APP_ID,
    process.env.PRIVY_APP_SECRET
);

const POT_WALLET = new PublicKey(process.env.POT_WALLET_PUBLIC_KEY || 'YourPotWallet...');

// Store privy user data per player
const playerPrivyMap = new Map(); // playerId -> { privyUserId, walletAddress }

// ============================================================================
/**
 * BET DEPOSITS & PAYOUTS (Solana)
 *
 * We intentionally verify player bet deposits by checking the on-chain signature
 * of a transfer from the player's wallet to the pot wallet. This avoids giving
 * the backend the ability to arbitrarily move user funds.
 *
 * Required env vars:
 *  - POT_WALLET_PUBLIC_KEY (base58 public key)
 *  - POT_WALLET_PRIVATE_KEY (base58 *secret key* for payouts; 64-byte keypair encoded as base58)
 *  - TREASURY_WALLET_PUBLIC_KEY (base58 public key)  // receives the 10% fee
 */
let POT_WALLET_PUBKEY = null;
let POT_WALLET_KEYPAIR = null;
let TREASURY_WALLET_PUBKEY = null;

function safeParsePublicKey(value, name) {
    try {
        if (!value) return null;
        return new PublicKey(value);
    } catch (e) {
        console.warn(`[WARN] Invalid ${name}:`, e.message);
        return null;
    }
}
function safeParseKeypair(value, name) {
    try {
        if (!value) return null;
        const secret = bs58.decode(value);
        return Keypair.fromSecretKey(secret);
    } catch (e) {
        console.warn(`[WARN] Invalid ${name}:`, e.message);
        return null;
    }
}

POT_WALLET_PUBKEY = safeParsePublicKey(process.env.POT_WALLET_PUBLIC_KEY, 'POT_WALLET_PUBLIC_KEY');
TREASURY_WALLET_PUBKEY = safeParsePublicKey(process.env.HOUSE_WALLET_PUBLIC_KEY || process.env.TREASURY_WALLET_PUBLIC_KEY, 'HOUSE_WALLET_PUBLIC_KEY');
POT_WALLET_KEYPAIR = safeParseKeypair(process.env.POT_WALLET_SECRET_KEY || process.env.POT_WALLET_PRIVATE_KEY, 'POT_WALLET_SECRET_KEY');

if (!POT_WALLET_PUBKEY) {
    console.warn('[WARN] POT_WALLET_PUBLIC_KEY not configured.');
} else {
    console.log('[PAYOUT] Pot wallet:', POT_WALLET_PUBKEY.toBase58());
}
if (!TREASURY_WALLET_PUBKEY) {
    console.warn('[WARN] HOUSE_WALLET_PUBLIC_KEY not configured.');
} else {
    console.log('[PAYOUT] Treasury wallet:', TREASURY_WALLET_PUBKEY.toBase58());
}
if (!POT_WALLET_KEYPAIR) {
    console.warn('[WARN] POT_WALLET_SECRET_KEY not configured or invalid.');
} else {
    console.log('[PAYOUT] Payout signer:', POT_WALLET_KEYPAIR.publicKey.toBase58());
}

const USED_SIGS_PATH = path.join(__dirname, 'used_bet_signatures.json');
let usedBetSignatures = new Set();
try {
    if (fs.existsSync(USED_SIGS_PATH)) {
        const raw = fs.readFileSync(USED_SIGS_PATH, 'utf-8');
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) usedBetSignatures = new Set(arr.filter(Boolean));
    }
} catch (e) {
    console.warn('[WARN] Failed to load used bet signatures file:', e.message);
}

function persistUsedBetSigs() {
    try {
        fs.writeFileSync(USED_SIGS_PATH, JSON.stringify(Array.from(usedBetSignatures).slice(-20000)));
    } catch (e) {
        console.warn('[WARN] Failed to persist used bet signatures:', e.message);
    }
}

async function getWalletBalanceLamports(pubkey) {
    try {
        return await connection.getBalance(pubkey, 'confirmed');
    } catch (e) {
        console.error('[PAYOUT] Failed to fetch wallet balance:', e.message);
        return null;
    }
}

const entryRecords = new Map(); // entryId -> entry data
const entryByPlayer = new Map(); // playerId -> entryId

let cachedSolPriceUsd = null;
let cachedSolPriceAt = 0;
const cashoutRateLimitByUser = new Map(); // userId -> number[] timestamps
const cashoutActiveUsers = new Set(); // userId lock
const pendingWalletCashoutsByUser = new Map(); // userId -> { cashoutId, destination, lamports, amountUsd, createdAt }
const discordEventDedupe = new Map(); // eventId -> timestamp

setInterval(() => {
    const now = Date.now();
    for (const [eventId, seenAt] of discordEventDedupe.entries()) {
        if (now - seenAt > DISCORD_EVENT_DEDUPE_WINDOW_MS * 2) {
            discordEventDedupe.delete(eventId);
        }
    }
}, 30000).unref?.();

async function getSolPriceUsd() {
    const fallback = Number(process.env.SOL_PRICE_USD || 0);
    const now = Date.now();
    if (cachedSolPriceUsd && now - cachedSolPriceAt < SOL_PRICE_TTL_MS) return cachedSolPriceUsd;
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4000);
        const res = await fetch('https://api.coinbase.com/v2/prices/SOL-USD/spot', { signal: controller.signal });
        clearTimeout(timeout);
        if (!res.ok) throw new Error(`Price fetch failed: ${res.status}`);
        const data = await res.json();
        const price = Number(data?.data?.amount);
        if (!Number.isFinite(price) || price <= 0) throw new Error('Invalid price');
        cachedSolPriceUsd = price;
        cachedSolPriceAt = now;
        return price;
    } catch (e) {
        if (fallback > 0) return fallback;
        throw e;
    }
}

function lamportsToUsd(lamports, usdPerSol) {
    if (!usdPerSol || lamports <= 0) return 0;
    return (lamports / LAMPORTS_PER_SOL) * usdPerSol;
}

function roundUsd(value, decimals = 2) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return 0;
    const factor = 10 ** decimals;
    return Math.floor(amount * factor) / factor;
}

function isRateLimitError(err) {
    const message = err?.message || '';
    return message.includes('429') || message.toLowerCase().includes('rate limited');
}

const accountInfoCache = new Map(); // pubkey -> { exists, checkedAt }
let cachedBlockhashInfo = null; // { blockhash, lastValidBlockHeight, fetchedAt }
let blockhashBackoffUntil = 0;

async function getAccountExists(pubkey) {
    const key = pubkey.toBase58();
    const cached = accountInfoCache.get(key);
    const now = Date.now();
    if (cached && now - cached.checkedAt < ACCOUNT_INFO_TTL_MS) {
        logDebug(`Account info cache hit for ${key}: ${cached.exists ? 'exists' : 'missing'}`);
        return cached.exists;
    }
    logDebug(`Account info cache miss for ${key}`);
    try {
        const info = await connection.getAccountInfo(pubkey, 'confirmed');
        const exists = !!info;
        accountInfoCache.set(key, { exists, checkedAt: now });
        logDebug(`Account info fetched for ${key}: ${exists ? 'exists' : 'missing'}`);
        return exists;
    } catch (e) {
        if (isRateLimitError(e)) {
            logInfo(`RPC rate limited while fetching account info for ${key}`);
            throw e;
        }
        accountInfoCache.set(key, { exists: false, checkedAt: now });
        logInfo(`Account info fetch failed for ${key}: ${e.message}`);
        return false;
    }
}

async function getLatestBlockhashCached() {
    const now = Date.now();
    if (cachedBlockhashInfo && now - cachedBlockhashInfo.fetchedAt < BLOCKHASH_TTL_MS) {
        logDebug('Using cached blockhash');
        return cachedBlockhashInfo;
    }
    if (now < blockhashBackoffUntil) {
        logInfo('Blockhash fetch is in backoff window');
        if (cachedBlockhashInfo) return cachedBlockhashInfo;
        throw new Error('RPC rate limited while fetching blockhash');
    }
    try {
        const info = await connection.getLatestBlockhash('confirmed');
        cachedBlockhashInfo = { ...info, fetchedAt: now };
        logDebug('Fetched new blockhash', { blockhash: info.blockhash });
        return cachedBlockhashInfo;
    } catch (e) {
        if (isRateLimitError(e)) {
            blockhashBackoffUntil = now + PAYOUT_BACKOFF_MS;
            logInfo(`RPC rate limited while fetching blockhash. Backing off for ${PAYOUT_BACKOFF_MS}ms`);
        }
        throw e;
    }
}

async function getBuyInLamports(betUsd) {
    const solPriceUsd = await getSolPriceUsd();
    const solAmount = betUsd / solPriceUsd;
    return Math.floor(solAmount * LAMPORTS_PER_SOL);
}

async function getFeeBufferLamports() {
    if (!ENTRY_FEE_BUFFER_USD || ENTRY_FEE_BUFFER_USD <= 0) return 0;
    const solPriceUsd = await getSolPriceUsd();
    const solAmount = ENTRY_FEE_BUFFER_USD / solPriceUsd;
    return Math.floor(solAmount * LAMPORTS_PER_SOL);
}

async function verifyBetDepositSignature(signature, expectedFromAddress, requiredLamports) {
    if (!POT_WALLET_PUBKEY) return { success: false, error: 'Server not configured (missing POT_WALLET_PUBLIC_KEY)' };
    if (!signature || typeof signature !== 'string') return { success: false, error: 'Missing deposit signature' };
    if (!expectedFromAddress) return { success: false, error: 'Missing from address' };
    if (usedBetSignatures.has(signature)) return { success: false, error: 'Deposit signature already used' };

    let expectedFrom;
    try { expectedFrom = new PublicKey(expectedFromAddress); }
    catch { return { success: false, error: 'Invalid from address' }; }

    if (!Number.isFinite(requiredLamports) || requiredLamports <= 0) {
        return { success: false, error: 'Invalid bet amount' };
    }

    // Fetch and validate transaction (retry to allow confirmation propagation)
    let tx;
    for (let attempt = 0; attempt < 6; attempt += 1) {
        try {
            tx = await connection.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
        } catch (e) {
            if (isRateLimitError(e)) {
                return { success: false, error: 'RPC rate limited while fetching transaction', retryable: true };
            }
            return { success: false, error: 'RPC error while fetching transaction', retryable: true };
        }
        if (tx) break;
        await new Promise((resolve) => setTimeout(resolve, 500 + attempt * 300));
    }
    if (!tx) return { success: false, error: 'Transaction not found (yet). Wait for confirmation.', retryable: true };
    if (tx.meta && tx.meta.err) return { success: false, error: 'Transaction failed on-chain' };

    const message = tx.transaction.message;
    const instructions = message.instructions || [];

    let matched = false;
    for (const ix of instructions) {
        // Parsed system transfer looks like:
        // { program: 'system', parsed: { type: 'transfer', info: { source, destination, lamports } } }
        if (ix.program === 'system' && ix.parsed && ix.parsed.type === 'transfer' && ix.parsed.info) {
            const info = ix.parsed.info;
            const src = info.source;
            const dst = info.destination;
            const lamports = Number(info.lamports);
            if (src === expectedFrom.toBase58() && dst === POT_WALLET_PUBKEY.toBase58() && lamports === requiredLamports) {
                matched = true;
                break;
            }
        }
    }

    if (!matched) return { success: false, error: 'Deposit transaction does not match required transfer' };

    usedBetSignatures.add(signature);
    // Persist occasionally to avoid excessive disk writes
    if (usedBetSignatures.size % 50 === 0) persistUsedBetSigs();

    return { success: true, signature };
}

async function payoutWinnerLamports(toWalletAddress, amountLamports, onSubmitted) {
    try {
        if (!POT_WALLET_KEYPAIR) return { success: false, error: 'Server not configured (missing POT_WALLET_SECRET_KEY)' };
        if (!TREASURY_WALLET_PUBKEY) return { success: false, error: 'Server not configured (missing HOUSE_WALLET_PUBLIC_KEY)' };

        const toPubkey = new PublicKey(toWalletAddress);

        if (!Number.isFinite(amountLamports) || amountLamports <= 0) return { success: false, error: 'Invalid payout amount' };
        logInfo(`Payout start for ${toWalletAddress}: ${amountLamports} lamports`);

        let treasuryExists = false;
        let playerExists = false;
        try {
            [treasuryExists, playerExists] = await Promise.all([
                getAccountExists(TREASURY_WALLET_PUBKEY),
                getAccountExists(toPubkey),
            ]);
        } catch (e) {
            if (isRateLimitError(e)) {
                logInfo('Rate limited during account existence checks');
                return { success: false, error: e.message, retryAfterMs: PAYOUT_BACKOFF_MS };
            }
            throw e;
        }
        if (!treasuryExists) {
            return {
                success: false,
                error: 'Treasury account is not initialized on-chain. Send a small amount of SOL to create it.',
            };
        }
        if (!playerExists) {
            return {
                success: false,
                error: 'Player wallet is not initialized on-chain. Please send a small amount of SOL to create it.',
            };
        }

        const buildPayoutTx = (totalLamports) => {
            const feeLamports = Math.floor(totalLamports / 10);
            const netLamports = totalLamports - feeLamports;
            if (netLamports <= 0) return null;
            const tx = new Transaction().add(
                SystemProgram.transfer({
                    fromPubkey: POT_WALLET_KEYPAIR.publicKey,
                    toPubkey,
                    lamports: netLamports,
                }),
                SystemProgram.transfer({
                    fromPubkey: POT_WALLET_KEYPAIR.publicKey,
                    toPubkey: TREASURY_WALLET_PUBKEY,
                    lamports: feeLamports,
                }),
            );
            return { tx, netLamports, feeLamports };
        };

        const draft = buildPayoutTx(amountLamports);
        if (!draft) return { success: false, error: 'Payout too small after fee' };
        let blockhash;
        let lastValidBlockHeight;
        try {
            ({ blockhash, lastValidBlockHeight } = await getLatestBlockhashCached());
        } catch (e) {
            if (isRateLimitError(e)) {
                logInfo('Rate limited while fetching blockhash');
                return { success: false, error: e.message, retryAfterMs: PAYOUT_BACKOFF_MS };
            }
            throw e;
        }
        draft.tx.recentBlockhash = blockhash;
        draft.tx.feePayer = POT_WALLET_KEYPAIR.publicKey;

        let feeLamportsEstimate = 0;
        try {
            const feeResp = await connection.getFeeForMessage(draft.tx.compileMessage(), 'confirmed');
            feeLamportsEstimate = feeResp?.value || 0;
        } catch (e) {
            console.warn('[PAYOUT] Fee estimate failed, continuing without estimate:', e.message);
        }

        const potBalance = await getWalletBalanceLamports(POT_WALLET_KEYPAIR.publicKey);
        if (potBalance !== null) {
            const maxPayoutLamports = potBalance - feeLamportsEstimate - PAYOUT_TX_FEE_BUFFER_LAMPORTS;
            if (maxPayoutLamports <= 0) {
                return {
                    success: false,
                    error: `Insufficient pot balance. Have ${potBalance} lamports, need at least ${feeLamportsEstimate + PAYOUT_TX_FEE_BUFFER_LAMPORTS} for fees.`,
                };
            }
            if (amountLamports > maxPayoutLamports) {
                logInfo(`Capping payout from ${amountLamports} to ${maxPayoutLamports} lamports due to pot balance`);
                amountLamports = maxPayoutLamports;
            }
        }

        const adjusted = buildPayoutTx(amountLamports);
        if (!adjusted) return { success: false, error: 'Payout too small after fee' };
        const finalTx = adjusted.tx;
        const netLamports = adjusted.netLamports;
        const feeLamports = adjusted.feeLamports;
        finalTx.recentBlockhash = blockhash;
        finalTx.feePayer = POT_WALLET_KEYPAIR.publicKey;

        let sig;
        try {
            sig = await connection.sendTransaction(finalTx, [POT_WALLET_KEYPAIR], { skipPreflight: false });
        } catch (e) {
            if (isRateLimitError(e)) {
                logInfo('Rate limited while sending payout transaction');
                return { success: false, error: e.message, retryAfterMs: PAYOUT_BACKOFF_MS };
            }
            throw e;
        }
        if (typeof onSubmitted === 'function') {
            try {
                onSubmitted(sig);
            } catch {}
        }
        logInfo(`Payout submitted: ${sig}`);
        await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');

        return { success: true, signature: sig, netLamports, feeLamports, paidLamports: amountLamports };
    } catch (e) {
        console.error('Payout error:', e);
        if (isRateLimitError(e)) {
            return { success: false, error: e.message, retryAfterMs: PAYOUT_BACKOFF_MS };
        }
        return { success: false, error: e.message };
    }
}



async function verifyUserAndGetWallet(jwt) {
    // Verify JWT
    const { userId } = await privy.verifyAuthToken(jwt);
    
    // Get user's wallet
    const user = await privy.getUser(userId);
    const solanaWallet = user.linkedAccounts.find(
        (a) => a.type === 'wallet' && a.chainType === 'solana'
    );
    
    if (!solanaWallet) {
        throw new Error('No Solana wallet found');
    }
    
    return {
        privyUserId: userId,
        walletAddress: solanaWallet.address,
    };
}

// ============================================================================
// GAME STATE & UTILITY FUNCTIONS (unchanged, keeping them compact)
// ============================================================================
const BIRD_TYPES = ['yellow', 'blue', 'cloudyblue', 'orange', 'pink', 'purple', 'red', 'teal', 'diddy'];

const SERVER_ZONES = {
    'us-1': { name: 'US $1', region: 'us', minBet: 1, maxBet: 4 },
    'us-5': { name: 'US $5', region: 'us', minBet: 5, maxBet: 19 },
    'us-20': { name: 'US $20', region: 'us', minBet: 20, maxBet: Infinity },
    'eu-1': { name: 'EU $1', region: 'eu', minBet: 1, maxBet: 4 },
    'eu-5': { name: 'EU $5', region: 'eu', minBet: 5, maxBet: 19 },
    'eu-20': { name: 'EU $20', region: 'eu', minBet: 20, maxBet: Infinity },
};

const PIPES = [
    { x: 970, y: 880, width: 60, height: 240, type: 'vertical', caps: ['top', 'bottom'] },
    { x: 880, y: 970, width: 240, height: 60, type: 'horizontal', caps: ['left', 'right'] },
    { x: 500, y: 400, width: 60, height: 140, type: 'vertical', caps: ['bottom'] },
    { x: 500, y: 400, width: 140, height: 60, type: 'horizontal', caps: ['right'] },
    { x: 1440, y: 400, width: 60, height: 140, type: 'vertical', caps: ['bottom'] },
    { x: 1360, y: 400, width: 140, height: 60, type: 'horizontal', caps: ['left'] },
    { x: 500, y: 1460, width: 60, height: 140, type: 'vertical', caps: ['top'] },
    { x: 500, y: 1540, width: 140, height: 60, type: 'horizontal', caps: ['right'] },
    { x: 1440, y: 1460, width: 60, height: 140, type: 'vertical', caps: ['top'] },
    { x: 1360, y: 1540, width: 140, height: 60, type: 'horizontal', caps: ['left'] },
];

let players = new Map();
let bullets = new Map();
let orbs = new Map();
let playerJoinSeqCounter = 0;
let lastSessionLeaderboardSig = '';
let lastSessionLeaderboardBroadcastAt = 0;
let bulletIdCounter = 0;
let orbIdCounter = 0;

function getActivePlayerCount() {
    let count = 0;
    players.forEach(p => { if (p && p.joined) count += 1; });
    return count;
}

function generateId() { return Math.random().toString(36).substring(2, 15); }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function normalizeAngle(angle) {
    while (angle > Math.PI) angle -= 2 * Math.PI;
    while (angle < -Math.PI) angle += 2 * Math.PI;
    return angle;
}
function distance(x1, y1, x2, y2) { return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2); }
function circleCollision(x1, y1, r1, x2, y2, r2) { return distance(x1, y1, x2, y2) < r1 + r2; }
function pointSegmentDistanceSq(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq <= 0.000001) {
        const ox = px - x1;
        const oy = py - y1;
        return { distSq: ox * ox + oy * oy, t: 0 };
    }
    let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
    t = clamp(t, 0, 1);
    const cx = x1 + dx * t;
    const cy = y1 + dy * t;
    const ox = px - cx;
    const oy = py - cy;
    return { distSq: ox * ox + oy * oy, t };
}
function shotBlockedByPipe(x1, y1, x2, y2, radius = CONFIG.BULLET_SIZE) {
    const steps = 20;
    for (let i = 1; i <= steps; i += 1) {
        const t = i / steps;
        const sx = x1 + (x2 - x1) * t;
        const sy = y1 + (y2 - y1) * t;
        if (collidesWithPipe(sx, sy, radius)) return true;
    }
    return false;
}
function circleRectCollision(cx, cy, radius, rx, ry, rw, rh) {
    const closestX = clamp(cx, rx, rx + rw);
    const closestY = clamp(cy, ry, ry + rh);
    const distX = cx - closestX;
    const distY = cy - closestY;
    return (distX * distX + distY * distY) < (radius * radius);
}
function pointInRect(px, py, rx, ry, rw, rh) {
    return px >= rx && px <= rx + rw && py >= ry && py <= ry + rh;
}
function getDynamicBorderMargin() {
    if (DEBUG_DISABLE_BORDER) return 0;
    const playerCount = getActivePlayerCount();
    const t = clamp((playerCount - CONFIG.BORDER_PLAYERS_MIN) / (CONFIG.BORDER_PLAYERS_MAX - CONFIG.BORDER_PLAYERS_MIN), 0, 1);
    return CONFIG.BORDER_MARGIN_MAX - t * (CONFIG.BORDER_MARGIN_MAX - CONFIG.BORDER_MARGIN_MIN);
}
function isOutsideBorder(x, y) {
    if (DEBUG_DISABLE_BORDER) return false;
    const margin = getDynamicBorderMargin();
    return x < margin || x > CONFIG.WORLD_WIDTH - margin || y < margin || y > CONFIG.WORLD_HEIGHT - margin;
}
function collidesWithPipe(x, y, radius) {
    for (const pipe of PIPES) {
        if (circleRectCollision(x, y, radius, pipe.x, pipe.y, pipe.width, pipe.height)) return true;
    }
    return false;
}
function isValidBirdType(birdType) { return BIRD_TYPES.includes(birdType); }

function getRandomSafePosition() {
    const margin = getDynamicBorderMargin();
    const safeMargin = Math.max(margin + 150, CONFIG.SPAWN_MARGIN);
    const spawnAreaWidth = CONFIG.WORLD_WIDTH - 2 * safeMargin;
    const spawnAreaHeight = CONFIG.WORLD_HEIGHT - 2 * safeMargin;
    
    const alivePlayers = [];
    players.forEach(player => { if (player.alive) alivePlayers.push({ x: player.x, y: player.y }); });
    
    let bestPosition = null;
    let bestScore = -Infinity;
    
    for (let attempts = 0; attempts < 100; attempts++) {
        const x = safeMargin + Math.random() * spawnAreaWidth;
        const y = safeMargin + Math.random() * spawnAreaHeight;
        if (collidesWithPipe(x, y, CONFIG.PLAYER_SIZE * 2)) continue;
        
        let score = alivePlayers.length > 0 ? 0 : 1000;
        for (const p of alivePlayers) {
            score += distance(x, y, p.x, p.y) * 5;
        }
        
        if (score > bestScore) {
            bestScore = score;
            bestPosition = { x, y };
        }
    }
    
    return bestPosition || { x: CONFIG.WORLD_WIDTH / 2, y: CONFIG.WORLD_HEIGHT / 2 };
}

function getSafeSpawnAngle(x, y) {
    const centerX = CONFIG.WORLD_WIDTH / 2;
    const centerY = CONFIG.WORLD_HEIGHT / 2;
    return Math.atan2(centerY - y, centerX - x);
}

// ============================================================================
// ORB CLASS
// ============================================================================
class Orb {
    constructor(x, y, valueLamports, angle, birdType = 'yellow', sourcePlayerId = null) {
        this.id = orbIdCounter++;
        this.x = x;
        this.y = y;
        this.valueLamports = valueLamports;
        this.birdType = birdType;
        this.sourcePlayerId = sourcePlayerId; // player whose death spawned this orb
        this.createdAt = Date.now();
        this.settled = false;
        this.vx = Math.cos(angle) * CONFIG.ORB_INITIAL_VELOCITY * (0.5 + Math.random() * 1.0);
        this.vy = Math.sin(angle) * CONFIG.ORB_INITIAL_VELOCITY * (0.5 + Math.random() * 1.0);
    }
    
    update(deltaTime) {
        if (this.settled) return;
        const age = Date.now() - this.createdAt;
        this.x += this.vx;
        this.y += this.vy;
        this.vx *= CONFIG.ORB_FRICTION;
        this.vy *= CONFIG.ORB_FRICTION;
        
        const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
        if (speed < 0.2 || age > CONFIG.ORB_SETTLE_TIME) {
            this.settled = true;
            this.vx = 0;
            this.vy = 0;
        }
        
        const margin = getDynamicBorderMargin();
        this.x = clamp(this.x, margin + 20, CONFIG.WORLD_WIDTH - margin - 20);
        this.y = clamp(this.y, margin + 20, CONFIG.WORLD_HEIGHT - margin - 20);
    }
    
    serialize() {
        return { id: this.id, x: this.x, y: this.y, valueLamports: this.valueLamports, vx: this.vx, vy: this.vy, birdType: this.birdType, settled: this.settled };
    }
}

function spawnOrbs(x, y, totalLamports, birdType = 'yellow', sourcePlayerId = null) {
    const orbCount = CONFIG.ORB_COUNT_ON_DEATH;
    const baseValue = Math.floor(totalLamports / orbCount);
    const remainder = totalLamports - (baseValue * orbCount);
    const newOrbs = [];
    const margin = getDynamicBorderMargin();

    for (let i = 0; i < orbCount; i++) {
        const angle = (Math.PI * 2 / orbCount) * i + (Math.random() - 0.5) * 0.5;
        let orbX = clamp(x, margin + 20, CONFIG.WORLD_WIDTH - margin - 20);
        let orbY = clamp(y, margin + 20, CONFIG.WORLD_HEIGHT - margin - 20);
        const valueLamports = baseValue + (i < remainder ? 1 : 0);
        const orb = new Orb(orbX, orbY, valueLamports, angle, birdType, sourcePlayerId);
        orbs.set(orb.id, orb);
        newOrbs.push(orb);
    }
    return newOrbs;
}

// ============================================================================
// PLAYER CLASS
// ============================================================================
class Player {
    constructor(id, ws, isBot = false) {
        this.id = id;
        this.ws = ws;
        this.isBot = isBot;
        this.name = 'Player';
        this.betUsd = 1;
        this.betLamports = 0;
        this.balanceLamports = 0;
        this.usdPerSol = null;
        this.serverId = 'us-1';
        this.birdType = 'yellow';
        this.joined = false;
        this.status = 'spectating';

        const pos = getRandomSafePosition();
        this.x = pos.x;
        this.y = pos.y;
        this.angle = getSafeSpawnAngle(pos.x, pos.y);
        this.targetAngle = this.angle;
        this.throttle = 1.0;
        this.health = CONFIG.PLAYER_MAX_HEALTH;
        this.kills = 0;
        this.alive = false;
        this.lastShot = 0;
        this.shooting = false;
        this.perfFire = false;
        this.mobileLowFx = false;
        
        this.boost = CONFIG.BOOST_MAX;
        this.boosting = false;
        this.boostDepleted = false;
        this.boostDepletedTime = 0;
        this.heldThroughDepletion = false;
        
        this.cashingOut = false;
        this.cashoutStartTime = 0;
        this.cashoutProgress = 0;
        this.paused = false;
        this.settled = false;
        this.payoutPendingLamports = 0;
        this.payoutNextAttemptAt = 0;
        this.payoutInFlight = false;
        
        this.messageCount = 0;
        this.messageWindowStart = Date.now();
        this.rateLimitWarned = false;
        this.spawnProtectUntil = 0;
        this.onGround = false;
        this.vy = 0;
        this.sessionStartAt = null;
        this.sessionStartBalanceLamports = 0;
        this.joinSeq = ++playerJoinSeqCounter;
        this.lastInputSeq = 0;
        this.lastInputClientTs = 0;
        this.lastInputRecvAt = 0;
        this.lastMoveDebugInputLogAt = 0;
        this.lastMoveDebugSimLogAt = 0;
    }
    
    checkRateLimit() {
        const now = Date.now();
        if (now - this.messageWindowStart > CONFIG.RATE_LIMIT_WINDOW) {
            this.messageCount = 0;
            this.messageWindowStart = now;
            this.rateLimitWarned = false;
        }
        this.messageCount++;
        return this.messageCount <= CONFIG.MAX_MESSAGES_PER_WINDOW;
    }
    
    setTargetAngle(angle) {
        if (typeof angle !== 'number' || isNaN(angle)) return;
        this.targetAngle = normalizeAngle(angle);
    }
    
    startCashout() {
        if (!this.cashingOut) {
            this.cashingOut = true;
            this.cashoutStartTime = Date.now();
            this.cashoutProgress = CONFIG.CASHOUT_SEGMENTS;
        }
    }
    
    stopCashout() {
        this.cashingOut = false;
        this.cashoutStartTime = 0;
        this.cashoutProgress = 0;
    }
    
    update(deltaTime) {
        if (!this.joined || !this.alive) return;
        
        if (this.cashingOut) {
            const elapsed = Date.now() - this.cashoutStartTime;
            const segmentTime = CONFIG.CASHOUT_TIME / CONFIG.CASHOUT_SEGMENTS;
            this.cashoutProgress = CONFIG.CASHOUT_SEGMENTS - Math.floor(elapsed / segmentTime);
            if (elapsed >= CONFIG.CASHOUT_TIME) return 'cashout_complete';
        }
        
        if (this.paused) return;
        if (this.spawnProtectUntil && Date.now() < this.spawnProtectUntil) return;
        
        const deltaSeconds = deltaTime / 1000;
        
        if (!this.boosting) this.heldThroughDepletion = false;
        if (this.boostDepleted && Date.now() - this.boostDepletedTime > CONFIG.BOOST_DEPLETED_DELAY) {
            this.boostDepleted = false;
        }
        
        let canBoost = false;
        if (this.boosting && !this.boostDepleted) {
            if (this.heldThroughDepletion) {
                if (this.boost >= CONFIG.BOOST_MIN_THRESHOLD) {
                    this.heldThroughDepletion = false;
                    canBoost = true;
                }
            } else if (this.boost > 0) {
                canBoost = true;
            }
        }
        
        if (canBoost) {
            this.boost -= CONFIG.BOOST_DRAIN_RATE * deltaSeconds;
            if (this.boost <= 0) {
                this.boost = 0;
                this.boostDepleted = true;
                this.boostDepletedTime = Date.now();
                this.heldThroughDepletion = true;
            }
        }
        
        const shouldRegen = !this.boosting || this.boostDepleted || (this.heldThroughDepletion && this.boost < CONFIG.BOOST_MIN_THRESHOLD);
        if (shouldRegen && !this.boostDepleted && this.boost < CONFIG.BOOST_MAX) {
            this.boost = Math.min(CONFIG.BOOST_MAX, this.boost + CONFIG.BOOST_REGEN_RATE * deltaSeconds);
        }
        
        const isActuallyBoosting = canBoost && this.boost > 0;
        let baseSpeed = isActuallyBoosting ? CONFIG.PLAYER_BOOST_SPEED : CONFIG.PLAYER_SPEED;
        
        let turnSlowdown = 1.0;
        if (!this.cashingOut) {
            let angleDiff = normalizeAngle(this.targetAngle - this.angle);
            const turnIntensity = Math.min(Math.abs(angleDiff) / (Math.PI * 0.5), 1.0);
            turnSlowdown = 1.0 - (turnIntensity * (1.0 - CONFIG.PLAYER_MAX_TURN_SLOWDOWN));
        }
        
        let speedMultiplier = 1.0;
        if (this.cashingOut) {
            const elapsed = Date.now() - this.cashoutStartTime;
            const slowdownStart = CONFIG.CASHOUT_TIME * 0.75;
            if (elapsed > slowdownStart) {
                const slowdownProgress = (elapsed - slowdownStart) / (CONFIG.CASHOUT_TIME - slowdownStart);
                speedMultiplier = Math.max(0, 1.0 - slowdownProgress);
            }
        }
        
        const currentSpeed = baseSpeed * speedMultiplier * turnSlowdown;
        
        if (!this.cashingOut) {
            let angleDiff = normalizeAngle(this.targetAngle - this.angle);
            if (Math.abs(angleDiff) > 0.01) {
                this.angle += Math.sign(angleDiff) * Math.min(Math.abs(angleDiff), CONFIG.PLAYER_TURN_SPEED);
                this.angle = normalizeAngle(this.angle);
            }
        }
        
        const dx = Math.cos(this.angle) * currentSpeed;
        const dy = Math.sin(this.angle) * currentSpeed;
        const newX = this.x + dx;
        const newY = this.y + dy;
        let clampedY = newY;
        let onGround = false;
        const groundTop = getGroundTopWorldY();

        if (newY + CONFIG.PLAYER_SIZE >= groundTop - GROUND_EPS) {
            clampedY = groundTop - CONFIG.PLAYER_SIZE;
            onGround = true;
        }

        if (!DEBUG_DISABLE_BORDER && isOutsideBorder(newX, clampedY)) { this.die(null, 'border'); return; }
        if (collidesWithPipe(newX, clampedY, CONFIG.PLAYER_SIZE)) { this.die(null, 'pipe'); return; }
        
        this.x = newX;
        this.y = clampedY;
        this.onGround = onGround;
        this.vy = onGround && dy > 0 ? 0 : dy;
        if (MOVEMENT_DEBUG && !this.isBot && this.id === movementDebugPlayerId) {
            const now = Date.now();
            if (now - this.lastMoveDebugSimLogAt >= 300) {
                this.lastMoveDebugSimLogAt = now;
                console.info('[MOVE DBG][sim]', {
                    playerId: this.id,
                    tickTs: now,
                    x: Number(this.x.toFixed(2)),
                    y: Number(this.y.toFixed(2)),
                    vy: Number(this.vy.toFixed(2)),
                    angle: Number(this.angle.toFixed(3)),
                    targetAngle: Number(this.targetAngle.toFixed(3)),
                    throttle: Number(this.throttle.toFixed(3)),
                    groundClamp: clampedY !== newY ? 1 : 0,
                    onGround: this.onGround ? 1 : 0,
                    inputSeq: this.lastInputSeq || 0,
                });
            }
        }
        this.collectOrbs();
    }
    
    collectOrbs() {
        const collectedOrbs = [];
        orbs.forEach((orb, id) => {
            const dist = distance(this.x, this.y, orb.x, orb.y);
            if (dist < CONFIG.ORB_MAGNET_RADIUS && dist > CONFIG.ORB_COLLECT_RADIUS) {
                const angle = Math.atan2(this.y - orb.y, this.x - orb.x);
                orb.vx += Math.cos(angle) * CONFIG.ORB_MAGNET_SPEED * 0.1;
                orb.vy += Math.sin(angle) * CONFIG.ORB_MAGNET_SPEED * 0.1;
            }
            if (dist < CONFIG.ORB_COLLECT_RADIUS) {
                const multiplier = risk.getOrbPickupMultiplier(this.id, orb.sourcePlayerId);
                this.balanceLamports += Math.floor(orb.valueLamports * multiplier);
                if (orb.sourcePlayerId) risk.recordOrbPickup(this.id, orb.sourcePlayerId);
                collectedOrbs.push(id);
            }
        });
        collectedOrbs.forEach(id => orbs.delete(id));
        if (collectedOrbs.length > 0) {
            broadcastToAll({ type: 'orbsCollected', orbIds: collectedOrbs, playerId: this.id, newBalanceLamports: this.balanceLamports });
        }
    }
    
    getShotOriginAndAngle() {
        if (!this.alive) return null;
        const now = Date.now();
        if (now - this.lastShot < CONFIG.SHOOT_COOLDOWN) return null;
        this.lastShot = now;
        const spread = (Math.random() - 0.5) * CONFIG.BULLET_SPREAD;
        const bulletAngle = this.angle + spread;
        const birdSize = CONFIG.PLAYER_SIZE * VISUAL_BIRD_SCALE;
        const mouthOffset = birdSize * 0.48;
        const mouthX = this.x + Math.cos(this.angle) * mouthOffset;
        const mouthY = this.y + Math.sin(this.angle) * mouthOffset + birdSize * 0.21;
        return { mouthX, mouthY, bulletAngle };
    }

    tryShoot() {
        const shot = this.getShotOriginAndAngle();
        if (!shot) return null;
        const { mouthX, mouthY, bulletAngle } = shot;
        return new Bullet(bulletIdCounter++, this.id, mouthX, mouthY, bulletAngle);
    }
    
    takeDamage(amount, attackerId) {
        if (!this.alive) return false;
        this.health -= amount;
        if (this.health <= 0) {
            this.health = 0;
            this.die(attackerId, 'bullet');
            return true;
        }
        return false;
    }
    
    die(killerId, cause) {
        queuePlayerSessionRecord(this, {
            outcome: 'died',
            cashoutLamports: 0,
        });
        this.alive = false;
        this.status = 'dead';
        this.cashingOut = false;
        console.log(`[DEATH] player=${this.id} cause=${cause}`);
        
        const droppedOrbs = spawnOrbs(this.x, this.y, this.balanceLamports, this.birdType, this.id);

        if (killerId) {
            const attacker = players.get(killerId);
            if (attacker) {
                attacker.kills += 1;
                attacker.health = CONFIG.PLAYER_MAX_HEALTH;
            }
            risk.recordKill(killerId, this.id, this.x, this.y);
        }
        
        broadcastToAll({
            type: 'playerDeath',
            playerId: this.id,
            x: this.x,
            y: this.y,
            killerId: killerId,
            killerKills: killerId ? (players.get(killerId)?.kills || 0) : 0,
            killerHealth: killerId ? (players.get(killerId)?.health || 0) : 0,
            cause: cause,
            orbs: droppedOrbs.map(o => o.serialize()),
        });
        broadcastSessionLeaderboard(true);
        
        this.balanceLamports = 0;
    }
    
    respawn(betUsd, birdType, betLamports, usdPerSol) {
        this.joined = true;
        this.status = 'alive';
        const pos = getRandomSafePosition();
        this.x = pos.x;
        this.y = pos.y;
        this.angle = getSafeSpawnAngle(pos.x, pos.y);
        this.targetAngle = this.angle;
        this.throttle = 1.0;
        this.health = CONFIG.PLAYER_MAX_HEALTH;
        this.alive = true;
        this.boost = CONFIG.BOOST_MAX;
        this.boostDepleted = false;
        this.boosting = false;
        this.heldThroughDepletion = false;
        this.shooting = false;
        this.cashingOut = false;
        this.cashoutProgress = 0;
        this.spawnProtectUntil = Date.now() + 800;
        this.betUsd = betUsd || this.betUsd;
        this.betLamports = betLamports || this.betLamports;
        this.balanceLamports = this.betLamports;
        this.usdPerSol = usdPerSol || this.usdPerSol;
        this.kills = 0;
        if (birdType && isValidBirdType(birdType)) this.birdType = birdType;
        this.settled = false;
        this.payoutPendingLamports = 0;
        this.payoutNextAttemptAt = 0;
        this.payoutInFlight = false;
        this.sessionStartAt = Date.now();
        this.sessionStartBalanceLamports = this.balanceLamports;
    }
    
    cashout() {
        if (this.payoutPendingLamports > 0 || this.settled) return 0;
        const cashoutLamports = this.balanceLamports;
        queuePlayerSessionRecord(this, {
            outcome: 'cashed_out',
            cashoutLamports,
        });
        this.alive = false;
        this.status = 'payout_pending';
        this.cashingOut = false;
        this.payoutPendingLamports = cashoutLamports;
        this.payoutNextAttemptAt = Date.now();
        this.payoutInFlight = false;
        broadcastToAll({ type: 'playerCashout', playerId: this.id, amountLamports: cashoutLamports });
        broadcastSessionLeaderboard(true);
        return cashoutLamports;
    }
    
    serialize() {
        const balanceSol = this.balanceLamports / LAMPORTS_PER_SOL;
        const balanceUsd = lamportsToUsd(this.balanceLamports, this.usdPerSol);
        let isActuallyBoosting = false;
        if (this.boosting && !this.boostDepleted) {
            isActuallyBoosting = this.heldThroughDepletion ? this.boost >= CONFIG.BOOST_MIN_THRESHOLD : this.boost > 0;
        }
        let cashoutPct = 0;
        if (this.cashingOut && this.cashoutStartTime) {
            cashoutPct = Math.max(0, Math.min(1, (Date.now() - this.cashoutStartTime) / CONFIG.CASHOUT_TIME));
        }
        return {
            id: this.id, name: this.name, x: this.x, y: this.y, angle: this.angle,
            health: this.health, kills: this.kills, alive: this.alive, joined: this.joined,
            status: this.status, balance: balanceUsd, balanceLamports: this.balanceLamports, balanceSol,
            boost: this.boost, boosting: isActuallyBoosting,
            boostDepleted: this.boostDepleted, shooting: this.shooting, cashingOut: this.cashingOut,
            cashoutProgress: this.cashoutProgress, cashoutPct, paused: this.paused, birdType: this.birdType,
            onGround: this.onGround, vy: this.vy, isBot: this.isBot,
            lastInputSeq: this.lastInputSeq || 0,
        };
    }
}

// ============================================================================
// BOT SPAWNING & AI (SERVER-SIDE)
// ============================================================================
function spawnTestBots() {
    if (DISABLE_BOTS) {
        if (!botsDisabledLogged) {
            botsDisabledLogged = true;
            const activeBotCount = Array.from(players.values()).filter((p) => p.isBot).length;
            console.log('[bots] DISABLED', { botCount: activeBotCount });
        }
        testBotsSpawned = true;
        return;
    }
    if (testBotsSpawned) return;
    testBotsSpawned = true;

    const margin = getDynamicBorderMargin();
    const groundYWorld = CONFIG.WORLD_HEIGHT - Math.floor(CONFIG.WORLD_HEIGHT * GROUND_HEIGHT_RATIO);
    const playableWidth = CONFIG.WORLD_WIDTH - margin * 2;
    const playableHeight = groundYWorld - margin * 2;

    // Divide map into zones so bots spread out (grid-like distribution)
    const zoneCount = TEST_BOT_COUNT;
    const cols = Math.ceil(Math.sqrt(zoneCount));
    const rows = Math.ceil(zoneCount / cols);
    const zoneWidth = playableWidth / cols;
    const zoneHeight = playableHeight / rows;

    for (let i = 0; i < TEST_BOT_COUNT; i++) {
        const botId = `bot-${generateId()}`;
        const bot = new Player(botId, TEST_BOT_WS, true);

        // Set bot properties
        bot.name = TEST_BOT_NAMES[i % TEST_BOT_NAMES.length] + (i + 1);
        bot.birdType = BIRD_TYPES[i % BIRD_TYPES.length];
        bot.joined = true;
        bot.alive = true;
        bot.status = 'alive';
        bot.health = CONFIG.PLAYER_MAX_HEALTH;

        // Balance: $5-$20 flat integer, converted to lamports
        const balanceUsd = Math.floor(TEST_BOT_MIN_BALANCE_USD + Math.random() * (TEST_BOT_MAX_BALANCE_USD - TEST_BOT_MIN_BALANCE_USD + 1));
        bot.usdPerSol = 150; // Fake SOL price for display
        bot.balanceLamports = Math.floor(balanceUsd / bot.usdPerSol * 1e9);

        // Spawn in different zones to spread out
        const col = i % cols;
        const row = Math.floor(i / cols);
        const zoneX = margin + col * zoneWidth;
        const zoneY = margin + row * zoneHeight;
        bot.x = zoneX + zoneWidth * 0.2 + Math.random() * zoneWidth * 0.6;
        bot.y = zoneY + zoneHeight * 0.2 + Math.random() * zoneHeight * 0.6;

        // Varied speed multiplier per bot
        // Hunters (first 2) are faster: 0.6-0.75, wanderers are slower: 0.35-0.55
        const speedMult = i < 2 ? (0.6 + Math.random() * 0.15) : (0.35 + Math.random() * 0.2);

        // Initialize bot AI state with varied timings
        const now = Date.now();
        botAIState.set(botId, {
            targetId: null,
            goalX: bot.x,
            goalY: bot.y,
            // Each bot has different timing patterns
            nextShotAt: now + randomInRange(TEST_BOT_MIN_SHOT_MS, TEST_BOT_MAX_SHOT_MS) * (0.8 + Math.random() * 0.4),
            nextTargetAt: now + randomInRange(800, TEST_BOT_TARGET_MS * 2),
            nextWanderAt: now + randomInRange(500, TEST_BOT_WANDER_MS * 1.5),
            burstUntil: now + randomInRange(400, 1200),
            nextBurstAt: now + randomInRange(400, 1200),
            aimErrorRad: 0,
            nextAimJitterAt: now + randomInRange(TEST_BOT_AIM_JITTER_MIN_MS, TEST_BOT_AIM_JITTER_MAX_MS),
            // Store per-bot parameters
            speedMult: speedMult,
            wanderRadius: 0.6 + Math.random() * 0.3, // How far from zone center they wander (larger zones)
            // First 2 bots are hunters (chase player), rest are wanderers
            aggressiveness: i < 2 ? (0.85 + Math.random() * 0.15) : (0.15 + Math.random() * 0.35),
            isHunter: i < 2, // Mark first 2 as hunters
            preferredZoneX: zoneX + zoneWidth / 2,
            preferredZoneY: zoneY + zoneHeight / 2,
            zoneWidth: zoneWidth,
            zoneHeight: zoneHeight,
        });

        players.set(botId, bot);
        console.log(`[BOT] Spawned bot ${bot.name} (${botId}) at zone ${col},${row} with $${balanceUsd}`);
    }
}

function randomInRange(min, max) {
    return min + Math.random() * (max - min);
}

function respawnBot(bot) {
    const aiState = botAIState.get(bot.id);

    // Spawn back in preferred zone if we have one, otherwise random
    if (aiState && aiState.preferredZoneX) {
        const halfW = aiState.zoneWidth / 2 * aiState.wanderRadius;
        const halfH = aiState.zoneHeight / 2 * aiState.wanderRadius;
        bot.x = aiState.preferredZoneX + randomInRange(-halfW, halfW);
        bot.y = aiState.preferredZoneY + randomInRange(-halfH, halfH);
    } else {
        const pos = getRandomSafePosition();
        bot.x = pos.x;
        bot.y = pos.y;
    }

    bot.angle = getSafeSpawnAngle(bot.x, bot.y);
    bot.targetAngle = bot.angle;
    bot.health = CONFIG.PLAYER_MAX_HEALTH;
    bot.alive = true;
    bot.status = 'alive';
    bot.kills = 0;
    bot.cashingOut = false;
    bot.cashoutStartTime = 0;
    bot.shooting = false;

    // Balance: $5-$20 flat integer
    const balanceUsd = Math.floor(TEST_BOT_MIN_BALANCE_USD + Math.random() * (TEST_BOT_MAX_BALANCE_USD - TEST_BOT_MIN_BALANCE_USD + 1));
    bot.usdPerSol = 150;
    bot.balanceLamports = Math.floor(balanceUsd / bot.usdPerSol * 1e9);
    bot.birdType = BIRD_TYPES[Math.floor(Math.random() * BIRD_TYPES.length)];

    // Reset AI state timings
    const now = Date.now();
    if (aiState) {
        aiState.targetId = null;
        aiState.goalX = bot.x;
        aiState.goalY = bot.y;
        aiState.nextShotAt = now + randomInRange(200, 700);
        aiState.nextTargetAt = now + randomInRange(800, TEST_BOT_TARGET_MS * 2);
        aiState.nextWanderAt = now + randomInRange(500, TEST_BOT_WANDER_MS * 1.5);
        aiState.burstUntil = now + randomInRange(500, 1200);
        aiState.nextBurstAt = now + randomInRange(500, 1200);
        aiState.aimErrorRad = 0;
        aiState.nextAimJitterAt = now + randomInRange(TEST_BOT_AIM_JITTER_MIN_MS, TEST_BOT_AIM_JITTER_MAX_MS);
    }

    broadcastToAll({
        type: 'playerRespawn',
        player: bot.serialize(),
        currentBorderMargin: getDynamicBorderMargin(),
    });
}

function updateBotAI(deltaTime) {
    if (DISABLE_BOTS) return;
    const now = Date.now();
    const margin = getDynamicBorderMargin();
    const groundYWorld = CONFIG.WORLD_HEIGHT - Math.floor(CONFIG.WORLD_HEIGHT * GROUND_HEIGHT_RATIO);
    const botRadius = CONFIG.PLAYER_SIZE;
    // Keep bots well away from borders
    const safeMargin = TEST_BOT_BORDER_SOFT + botRadius;
    const minX = margin + safeMargin;
    const maxX = CONFIG.WORLD_WIDTH - margin - safeMargin;
    const minY = margin + safeMargin;
    const maxY = groundYWorld - safeMargin;

    players.forEach((bot) => {
        if (!bot.isBot) return;

        // Respawn dead bots after a delay
        if (!bot.alive) {
            bot.shooting = false;
            if (!bot.respawnAt) {
                bot.respawnAt = now + 3000; // 3 second respawn delay
            } else if (now >= bot.respawnAt) {
                bot.respawnAt = null;
                respawnBot(bot);
            }
            return;
        }

        const aiState = botAIState.get(bot.id);
        if (!aiState) return;

        // Per-bot speed multiplier (default 0.45 if not set)
        const speedMult = aiState.speedMult || 0.45;

        // === CASHOUT BEHAVIOR (visual only) ===
        if (bot.cashingOut && bot.cashoutStartTime) {
            bot.shooting = false;
            // Check if cashout is complete
            const elapsed = now - bot.cashoutStartTime;
            if (elapsed >= CONFIG.CASHOUT_TIME) {
                // Cashout "completes" - bot gets new balance and stops cashing out
                bot.cashingOut = false;
                bot.cashoutStartTime = 0;
                // Give new random balance
                const newBalanceUsd = Math.floor(TEST_BOT_MIN_BALANCE_USD + Math.random() * (TEST_BOT_MAX_BALANCE_USD - TEST_BOT_MIN_BALANCE_USD + 1));
                bot.balanceLamports = Math.floor(newBalanceUsd / bot.usdPerSol * 1e9);
            } else if (Math.random() < TEST_BOT_CASHOUT_CANCEL_CHANCE * (deltaTime / 1000)) {
                // Random chance to cancel cashout (simulates getting interrupted)
                bot.cashingOut = false;
                bot.cashoutStartTime = 0;
            }
        } else if (!bot.cashingOut) {
            // Small chance to start cashing out
            if (Math.random() < TEST_BOT_CASHOUT_CHANCE * (deltaTime / 1000)) {
                bot.cashingOut = true;
                bot.cashoutStartTime = Date.now();
            }
        }

        // Pick a new target periodically - use aggressiveness to determine chase vs wander
        if (now >= aiState.nextTargetAt) {
            // More aggressive bots pick targets more often
            if (Math.random() < aiState.aggressiveness) {
                aiState.targetId = pickBotTarget(bot);
            } else {
                aiState.targetId = null; // Wander instead
            }
            aiState.nextTargetAt = now + randomInRange(TEST_BOT_TARGET_MS * 2, TEST_BOT_TARGET_MS * 5);
        }

        // Pick new wander goal periodically - stay near preferred zone
        if (now >= aiState.nextWanderAt || !aiState.goalX) {
            // Wander within preferred zone, with some variance
            const wanderRadius = aiState.wanderRadius || 0.5;
            if (aiState.preferredZoneX) {
                const halfW = aiState.zoneWidth * wanderRadius;
                const halfH = aiState.zoneHeight * wanderRadius;
                aiState.goalX = clamp(aiState.preferredZoneX + randomInRange(-halfW, halfW), minX, maxX);
                aiState.goalY = clamp(aiState.preferredZoneY + randomInRange(-halfH, halfH), minY, maxY);
            } else {
                aiState.goalX = randomInRange(minX, maxX);
                aiState.goalY = randomInRange(minY, maxY);
            }
            aiState.nextWanderAt = now + randomInRange(TEST_BOT_WANDER_MS * 1.5, TEST_BOT_WANDER_MS * 4);
        }

        // Adjust goal towards target if we have one (but not too directly)
        const target = aiState.targetId ? players.get(aiState.targetId) : null;
        if (target && target.alive) {
            // Add some randomness to target approach
            const offset = CONFIG.PLAYER_SIZE * (3 + Math.random() * 8);
            aiState.goalX = clamp(target.x + randomInRange(-offset, offset), minX, maxX);
            aiState.goalY = clamp(target.y + randomInRange(-offset, offset), minY, maxY);
        }

        // Calculate movement with per-bot speed
        const dx = aiState.goalX - bot.x;
        const dy = aiState.goalY - bot.y;
        const len = Math.hypot(dx, dy) || 1;
        let desiredVx = (dx / len) * CONFIG.PLAYER_SPEED * speedMult;
        let desiredVy = (dy / len) * CONFIG.PLAYER_SPEED * speedMult;

        // Border avoidance - strong push away from borders
        const borderPushStrength = 0.15;
        if (bot.x < minX + TEST_BOT_BORDER_SOFT) {
            const urgency = 1 - (bot.x - minX) / TEST_BOT_BORDER_SOFT;
            desiredVx += urgency * CONFIG.PLAYER_SPEED * borderPushStrength;
        }
        if (bot.x > maxX - TEST_BOT_BORDER_SOFT) {
            const urgency = 1 - (maxX - bot.x) / TEST_BOT_BORDER_SOFT;
            desiredVx -= urgency * CONFIG.PLAYER_SPEED * borderPushStrength;
        }
        if (bot.y < minY + TEST_BOT_BORDER_SOFT) {
            const urgency = 1 - (bot.y - minY) / TEST_BOT_BORDER_SOFT;
            desiredVy += urgency * CONFIG.PLAYER_SPEED * borderPushStrength;
        }
        if (bot.y > maxY - TEST_BOT_BORDER_SOFT) {
            const urgency = 1 - (maxY - bot.y) / TEST_BOT_BORDER_SOFT;
            desiredVy -= urgency * CONFIG.PLAYER_SPEED * borderPushStrength;
        }

        // Pipe avoidance
        const hitPipe = isNearPipe(bot.x, bot.y, CONFIG.PLAYER_SIZE + TEST_BOT_PIPE_PAD);
        if (hitPipe) {
            const centerY = hitPipe.y + hitPipe.height / 2;
            const push = bot.y < centerY ? -1 : 1;
            desiredVy += push * CONFIG.PLAYER_SPEED * 0.9;
        }

        // Smooth velocity (lower = slower/smoother movement)
        const smoothing = 0.03 + (aiState.aggressiveness || 0.25) * 0.02;
        if (!bot.vx) bot.vx = 0;
        if (!bot.vy) bot.vy = 0;
        bot.vx = bot.vx + (desiredVx - bot.vx) * smoothing;
        bot.vy = bot.vy + (desiredVy - bot.vy) * smoothing;

        // Apply movement
        const dt = deltaTime / 16.666;
        const newX = clamp(bot.x + bot.vx * dt, minX, maxX);
        const newY = clamp(bot.y + bot.vy * dt, minY, maxY);

        // Check for collisions before applying
        if (!collidesWithPipe(newX, newY, CONFIG.PLAYER_SIZE)) {
            bot.x = newX;
            bot.y = newY;
        }

        // Burst cadence (server-authoritative): 3s fire, 1-2s pause.
        const inBurst = now < (aiState.burstUntil || 0);
        if (!inBurst && now >= (aiState.nextBurstAt || 0)) {
            aiState.burstUntil = now + TEST_BOT_BURST_MS;
            aiState.nextShotAt = now + randomInRange(80, 180);
            aiState.nextBurstAt = aiState.burstUntil + randomInRange(TEST_BOT_BURST_PAUSE_MIN_MS, TEST_BOT_BURST_PAUSE_MAX_MS);
            if (!bot.shooting && DEV_LOG_BOTS) {
                console.info('[BOT] burst start', { id: bot.id, at: now, until: aiState.burstUntil });
            }
            bot.shooting = true;
        } else if (inBurst) {
            bot.shooting = true;
        } else {
            if (bot.shooting && DEV_LOG_BOTS) {
                console.info('[BOT] burst end', { id: bot.id, at: now, nextAt: aiState.nextBurstAt });
            }
            bot.shooting = false;
        }

        // Aim at target or movement direction with intentional inaccuracy/jitter.
        const rawAimDx = target && target.alive ? target.x - bot.x : bot.vx;
        const rawAimDy = target && target.alive ? target.y - bot.y : bot.vy;
        const targetDistance = target && target.alive ? distance(bot.x, bot.y, target.x, target.y) : 0;
        const baseAimAngle = Math.atan2(rawAimDy, rawAimDx);
        if (!Number.isFinite(aiState.nextAimJitterAt)) {
            aiState.nextAimJitterAt = now + randomInRange(TEST_BOT_AIM_JITTER_MIN_MS, TEST_BOT_AIM_JITTER_MAX_MS);
        }
        if (now >= aiState.nextAimJitterAt) {
            const distMul = 1 + clamp(targetDistance / CONFIG.BULLET_RANGE, 0, 1) * (TEST_BOT_AIM_MAX_ERROR_MULT - 1);
            const minErr = TEST_BOT_AIM_BASE_ERROR_MIN_DEG * distMul;
            const maxErr = TEST_BOT_AIM_BASE_ERROR_MAX_DEG * distMul;
            const sign = Math.random() < 0.5 ? -1 : 1;
            const errDeg = sign * randomInRange(minErr, maxErr);
            aiState.aimErrorRad = errDeg * DEG_TO_RAD;
            aiState.nextAimJitterAt = now + randomInRange(TEST_BOT_AIM_JITTER_MIN_MS, TEST_BOT_AIM_JITTER_MAX_MS);
            if (DEV_LOG_BOTS) {
                console.info('[BOT AIM] error angle', {
                    id: bot.id,
                    deg: Number(errDeg.toFixed(2)),
                    dist: Math.round(targetDistance),
                });
            }
        }
        bot.targetAngle = baseAimAngle + (aiState.aimErrorRad || 0);

        // Smoothly rotate towards target angle
        let angleDiff = normalizeAngle(bot.targetAngle - bot.angle);
        if (Math.abs(angleDiff) > 0.01) {
            bot.angle += Math.sign(angleDiff) * Math.min(Math.abs(angleDiff), CONFIG.PLAYER_TURN_SPEED);
            bot.angle = normalizeAngle(bot.angle);
        }

        // Shooting (don't shoot while cashing out) - per-bullet spawn only during active burst.
        if (!bot.cashingOut && bot.shooting) {
            if (now >= aiState.nextShotAt && targetDistance > TEST_BOT_MIN_SHOT_DISTANCE && targetDistance < CONFIG.BULLET_RANGE) {
                const bullet = bot.tryShoot();
                if (bullet) {
                    bullets.set(bullet.id, bullet);
                    broadcastToAll({ type: 'bulletSpawn', bullet: bullet.serialize() });
                    aiState.nextShotAt = now + randomInRange(TEST_BOT_BURST_SHOT_MIN_MS, TEST_BOT_BURST_SHOT_MAX_MS);
                }
            }
        }
    });
}

function pickBotTarget(bot) {
    const aiState = botAIState.get(bot.id);
    const isHunter = aiState?.isHunter;

    const realPlayers = [];
    const otherBots = [];

    players.forEach((p) => {
        if (p.id !== bot.id && p.alive && p.joined) {
            if (p.isBot) {
                otherBots.push(p.id);
            } else {
                realPlayers.push(p.id);
            }
        }
    });

    // Hunters strongly prefer real players
    if (isHunter && realPlayers.length > 0) {
        return realPlayers[Math.floor(Math.random() * realPlayers.length)];
    }

    // Otherwise pick from all candidates
    const candidates = [...realPlayers, ...otherBots];
    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
}

function isNearPipe(x, y, pad) {
    for (const pipe of PIPES) {
        const rx = pipe.x - pad;
        const ry = pipe.y - pad;
        const rw = pipe.width + pad * 2;
        const rh = pipe.height + pad * 2;
        if (x >= rx && x <= rx + rw && y >= ry && y <= ry + rh) return pipe;
    }
    return null;
}

// ============================================================================
// BULLET CLASS
// ============================================================================
class Bullet {
    constructor(id, ownerId, x, y, angle) {
        this.id = id;
        this.ownerId = ownerId;
        this.x = x;
        this.y = y;
        this.angle = angle;
        this.vx = Math.cos(angle) * CONFIG.BULLET_SPEED;
        this.vy = Math.sin(angle) * CONFIG.BULLET_SPEED;
        this.createdAt = Date.now();
        this.alive = true;
    }
    
    update() {
        if (!this.alive) return;
        this.x += this.vx;
        this.y += this.vy;
        if (Date.now() - this.createdAt > CONFIG.BULLET_LIFETIME) { this.alive = false; return; }
        if (isOutsideBorder(this.x, this.y)) { this.alive = false; return; }
        if (collidesWithPipe(this.x, this.y, CONFIG.BULLET_SIZE)) { this.alive = false; return; }
    }
    
    serialize() {
        return { id: this.id, ownerId: this.ownerId, x: this.x, y: this.y, angle: this.angle, vx: this.vx, vy: this.vy, createdAt: this.createdAt };
    }
}

// ============================================================================
// HTTP SERVER
// ============================================================================
function sendJson(res, status, payload) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
}

function sendText(res, status, message) {
    res.writeHead(status, { 'Content-Type': 'text/plain' });
    res.end(message || '');
}

function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', (chunk) => {
            body += chunk;
            if (body.length > 1e6) {
                reject(new Error('Payload too large'));
                req.destroy();
            }
        });
        req.on('end', () => {
            if (!body) return resolve(null);
            try {
                resolve(JSON.parse(body));
            } catch (err) {
                reject(err);
            }
        });
    });
}

async function supabaseRequest(pathname, options = {}) {
    if (!SUPABASE_REST_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        const err = new Error('Supabase server configuration missing');
        err.status = 503;
        throw err;
    }
    const url = `${SUPABASE_REST_URL}${pathname}`;
    const headers = {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
    };
    const response = await fetch(url, { ...options, headers });
    return response;
}

// ── Risk module init (anti-collusion + anomaly detection) ──────────────
risk.init(players, playerPrivyMap, orbs, supabaseRequest);

const MENU_STATS_CACHE_TTL_MS = 30000;
let menuStatsCache = {
    playersInGame: 0,
    globalWinnings: 0,
    updatedAt: 0,
};

function getConnectedPlayerCount() {
    let count = 0;
    players.forEach((player) => {
        if (player?.isBot) return;
        count += 1;
    });
    return count;
}

async function getMenuStats() {
    const now = Date.now();
    if (now - menuStatsCache.updatedAt < MENU_STATS_CACHE_TTL_MS) {
        return {
            playersInGame: getConnectedPlayerCount(),
            globalWinnings: menuStatsCache.globalWinnings,
        };
    }

    let globalWinnings = menuStatsCache.globalWinnings || 0;
    try {
        const response = await supabaseRequest('/player_profile_stats?select=total_winnings');
        if (response.ok) {
            const rows = await response.json();
            if (Array.isArray(rows)) {
                globalWinnings = rows.reduce((sum, row) => {
                    const value = Number(row?.total_winnings || 0);
                    return sum + (Number.isFinite(value) ? value : 0);
                }, 0);
            }
        }
    } catch (err) {
        console.error('[menu] failed to load global winnings:', err?.message || err);
    }

    menuStatsCache = {
        playersInGame: getConnectedPlayerCount(),
        globalWinnings,
        updatedAt: now,
    };

    return {
        playersInGame: menuStatsCache.playersInGame,
        globalWinnings: menuStatsCache.globalWinnings,
    };
}

function getRangeStartDate(range) {
    const now = new Date();
    const start = new Date(now);
    if (range === '1w') {
        start.setDate(start.getDate() - 7);
    } else if (range === '1m') {
        start.setMonth(start.getMonth() - 1);
    } else if (range === '3m') {
        start.setMonth(start.getMonth() - 3);
    } else {
        start.setMonth(0, 1);
        start.setHours(0, 0, 0, 0);
    }
    return start.toISOString().slice(0, 10);
}

function scoreSearchMatch(query, username, walletAddress) {
    const q = String(query || '').toLowerCase();
    const u = String(username || '').toLowerCase();
    const w = String(walletAddress || '').toLowerCase();
    let score = 0;
    if (u.startsWith(q)) score += 100;
    if (w.startsWith(q)) score += 80;
    if (u.includes(q)) score += 40;
    if (w.includes(q)) score += 30;
    return score;
}

function queuePlayerSessionRecord(player, { outcome, cashoutLamports = 0 }) {
    if (!player || player.isBot) return;
    if (!player.sessionStartAt || !player.joined) return;
    const privyData = playerPrivyMap.get(player.id);
    const wallet = privyData?.walletAddress;
    if (!wallet) {
        player.sessionStartAt = null;
        return;
    }
    const startedAt = new Date(player.sessionStartAt).toISOString();
    const endedAt = new Date().toISOString();
    const survivalDurationMs = Math.max(0, Date.now() - player.sessionStartAt);
    const cashoutUsd = lamportsToUsd(cashoutLamports, player.usdPerSol);
    const payload = {
        wallet_address: wallet,
        started_at: startedAt,
        ended_at: endedAt,
        survival_duration_ms: survivalDurationMs,
        cashout_amount_usd: Number.isFinite(cashoutUsd) ? cashoutUsd : 0,
        kills: Number(player.kills || 0),
        outcome: outcome === 'cashed_out' ? 'cashed_out' : 'died',
    };
    player.sessionStartAt = null;
    supabaseRequest('/player_game_sessions', {
        method: 'POST',
        body: JSON.stringify(payload),
    }).catch((err) => {
        console.error('[social] failed to store player_game_sessions row', err?.message || err);
    });
}

function recordLoginDay(walletAddress) {
    if (!walletAddress) return;
    const payload = {
        wallet_address: walletAddress,
        login_date: new Date().toISOString().slice(0, 10),
        last_seen_at: new Date().toISOString(),
    };
    supabaseRequest('/player_login_days?on_conflict=wallet_address,login_date', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(payload),
    }).catch((err) => {
        console.error('[social] failed to upsert player_login_days row', err?.message || err);
    });
}

function escapeIlikeLiteral(value) {
    return String(value || '')
        .replace(/\\/g, '\\\\')
        .replace(/%/g, '\\%')
        .replace(/_/g, '\\_');
}

async function findLeaderboardRowByUsername(username) {
    const normalized = normalizeUsername(username);
    if (!isValidUsername(normalized)) return null;
    const pattern = escapeIlikeLiteral(normalized);
    const response = await supabaseRequest(
        `/leaderboard?select=wallet_address,username&username=ilike.${encodeURIComponent(pattern)}&limit=20`
    );
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Username lookup failed (${response.status})`);
    }
    const rows = await response.json();
    if (!Array.isArray(rows)) return null;
    const match = rows.find((row) => normalizeUsername(row?.username).toLowerCase() === normalized.toLowerCase());
    return match || null;
}

async function handleLeaderboardApi(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    if (pathname === '/api/leaderboard/top' && req.method === 'GET') {
        const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '10', 10), 1), 50);
        const response = await supabaseRequest(
            `/leaderboard?select=id,wallet_address,username,balance,total_profit,games_played&order=total_profit.desc&limit=${limit}`
        );
        const data = await response.json();
        return sendJson(res, response.ok ? 200 : response.status, data);
    }

    if (pathname === '/api/leaderboard/self' && req.method === 'GET') {
        const wallet = url.searchParams.get('wallet');
        if (!wallet) return sendText(res, 400, 'Missing wallet');
        const response = await supabaseRequest(
            `/leaderboard?select=id,wallet_address,username,balance,total_profit,games_played,created_at,updated_at&wallet_address=eq.${encodeURIComponent(wallet)}&limit=1`
        );
        const data = await response.json();
        return sendJson(res, response.ok ? 200 : response.status, data?.[0] || null);
    }

    if (pathname === '/api/leaderboard/rank' && req.method === 'GET') {
        const totalProfitRaw = url.searchParams.get('total_profit');
        const totalProfit = Number(totalProfitRaw || 0);
        if (!Number.isFinite(totalProfit)) return sendText(res, 400, 'Invalid total_profit');
        const response = await supabaseRequest(
            `/leaderboard?select=id&total_profit=gt.${encodeURIComponent(totalProfit)}&limit=1`,
            { headers: { Prefer: 'count=exact' } }
        );
        const range = response.headers.get('content-range') || '';
        const total = range.includes('/') ? Number(range.split('/')[1]) : null;
        const count = Number.isFinite(total) ? total : 0;
        return sendJson(res, response.ok ? 200 : response.status, { count });
    }

    if (pathname === '/api/leaderboard/update' && req.method === 'POST') {
        const body = await readJsonBody(req);
        if (!body?.wallet_address || !body?.updates) return sendText(res, 400, 'Missing payload');
        if (typeof body?.updates?.username !== 'undefined') {
            const normalizedUsername = normalizeUsername(body.updates.username);
            if (!isValidUsername(normalizedUsername)) {
                return sendJson(res, 400, { error: 'INVALID_USERNAME', message: 'Invalid username. Use 3-21 characters: letters, numbers, _ or -.' });
            }
            const existing = await findLeaderboardRowByUsername(normalizedUsername);
            if (existing && String(existing.wallet_address || '') !== String(body.wallet_address || '')) {
                return sendJson(res, 409, { error: 'USERNAME_TAKEN', message: 'Username already in use.' });
            }
            body.updates.username = normalizedUsername;
        }
        const response = await supabaseRequest(
            `/leaderboard?wallet_address=eq.${encodeURIComponent(body.wallet_address)}`,
            {
                method: 'PATCH',
                headers: { Prefer: 'return=representation' },
                body: JSON.stringify(body.updates),
            }
        );
        const data = await response.json();
        return sendJson(res, response.ok ? 200 : response.status, data?.[0] || null);
    }

    if (pathname === '/api/leaderboard/upsert' && req.method === 'POST') {
        const body = await readJsonBody(req);
        if (!body?.wallet_address) return sendText(res, 400, 'Missing wallet_address');
        if (typeof body?.username !== 'undefined') {
            const normalizedUsername = normalizeUsername(body.username);
            if (!isValidUsername(normalizedUsername)) {
                return sendJson(res, 400, { error: 'INVALID_USERNAME', message: 'Invalid username. Use 3-21 characters: letters, numbers, _ or -.' });
            }
            const existing = await findLeaderboardRowByUsername(normalizedUsername);
            if (existing && String(existing.wallet_address || '') !== String(body.wallet_address || '')) {
                return sendJson(res, 409, { error: 'USERNAME_TAKEN', message: 'Username already in use.' });
            }
            body.username = normalizedUsername;
        }
        const response = await supabaseRequest(
            `/leaderboard?on_conflict=wallet_address`,
            {
                method: 'POST',
                headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
                body: JSON.stringify(body),
            }
        );
        const data = await response.json();
        return sendJson(res, response.ok ? 200 : response.status, data?.[0] || null);
    }

    return false;
}

async function handleSocialApi(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    if (pathname === '/api/social/leaderboard' && req.method === 'GET') {
        const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '100', 10), 1), 200);
        const response = await supabaseRequest(
            `/player_profile_stats?select=wallet_address,username,joined_at,total_winnings&order=total_winnings.desc.nullslast&limit=${limit}`
        );
        const data = await response.json();
        const mapped = Array.isArray(data)
            ? data.map((row) => ({
                wallet_address: row.wallet_address,
                username: row.username || 'Player',
                total_winnings: Number(row.total_winnings || 0),
                joined_at: row.joined_at || null,
            }))
            : [];
        // Defensive dedupe by wallet_address (guards against JOIN fan-out in views)
        const seen = new Set();
        const rows = [];
        for (const row of mapped) {
            if (seen.has(row.wallet_address)) continue;
            seen.add(row.wallet_address);
            row.rank = rows.length + 1;
            rows.push(row);
        }
        return sendJson(res, response.ok ? 200 : response.status, rows);
    }

    if (pathname === '/api/social/profile' && req.method === 'GET') {
        const wallet = url.searchParams.get('wallet');
        if (!wallet) return sendText(res, 400, 'Missing wallet');

        const [profileResponse, leaderboardResponse] = await Promise.all([
            supabaseRequest(`/player_profile_stats?select=*&wallet_address=eq.${encodeURIComponent(wallet)}&limit=1`),
            supabaseRequest(`/leaderboard?select=username,total_profit,created_at&wallet_address=eq.${encodeURIComponent(wallet)}&limit=1`),
        ]);

        const profileData = await profileResponse.json();
        const leaderboardData = await leaderboardResponse.json();
        const profile = Array.isArray(profileData) ? profileData[0] : null;
        const leaderboardRow = Array.isArray(leaderboardData) ? leaderboardData[0] : null;

        if (!profile && !leaderboardRow) {
            return sendJson(res, 404, { error: 'Profile not found' });
        }

        return sendJson(res, 200, {
            wallet_address: wallet,
            username: profile?.username || leaderboardRow?.username || 'Player',
            joined_at: profile?.joined_at || leaderboardRow?.created_at || null,
            login_streak_days: Number(profile?.login_streak_days || 0),
            games_played: Number(profile?.games_played || 0),
            games_won: Number(profile?.games_won || 0),
            win_rate_pct: Number(profile?.win_rate_pct || 0),
            avg_survival_seconds: Number(profile?.avg_survival_seconds || 0),
            total_eliminations: Number(profile?.total_eliminations || 0),
            kills_per_game: Number(profile?.kills_per_game || 0),
            total_play_minutes: Number(profile?.total_play_minutes || 0),
            total_winnings: Number(profile?.total_winnings || 0),
        });
    }

    if (pathname === '/api/social/earnings' && req.method === 'GET') {
        const wallet = url.searchParams.get('wallet');
        const range = (url.searchParams.get('range') || 'ytd').toLowerCase();
        if (!wallet) return sendText(res, 400, 'Missing wallet');
        const startDate = getRangeStartDate(range);
        const response = await supabaseRequest(
            `/player_earnings_daily?select=bucket_date,total_winnings_usd&wallet_address=eq.${encodeURIComponent(wallet)}&bucket_date=gte.${startDate}&order=bucket_date.asc`
        );
        const data = await response.json();
        return sendJson(res, response.ok ? 200 : response.status, Array.isArray(data) ? data : []);
    }

    if (pathname === '/api/social/search' && req.method === 'GET') {
        const rawQuery = (url.searchParams.get('q') || '').trim();
        const query = rawQuery.toLowerCase();
        const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '20', 10), 1), 50);
        if (query.length < 2) return sendJson(res, 200, []);

        const response = await supabaseRequest(
            `/player_profile_stats?select=wallet_address,username,total_winnings,games_won&or=(username.ilike.*${encodeURIComponent(query)}*,wallet_address.ilike.*${encodeURIComponent(query)}*)&limit=${Math.max(limit * 2, 20)}`
        );
        const data = await response.json();
        const baseRows = Array.isArray(data) ? data : [];

        const rows = baseRows
            .map((row) => {
                const wallet = row.wallet_address;
                return {
                    wallet_address: wallet,
                    username: row.username || 'Player',
                    game_id: wallet,
                    games_won: Number(row.games_won || 0),
                    total_winnings: Number(row.total_winnings || 0),
                    _score: scoreSearchMatch(query, row.username || '', wallet),
                };
            })
            .sort((a, b) => (b._score - a._score) || (b.total_winnings - a.total_winnings))
            .slice(0, limit)
            .map(({ _score, ...row }) => row);

        return sendJson(res, response.ok ? 200 : response.status, rows);
    }

    return false;
}

function readBearerToken(req) {
    const auth = String(req?.headers?.authorization || '');
    if (!auth.toLowerCase().startsWith('bearer ')) return null;
    return auth.slice(7).trim();
}

async function emitAccountCreatedEvent({ userId, walletAddress, source = 'unknown' }) {
    if (!userId || !walletAddress) return;
    const username = await getProfileUsernameByWallet(walletAddress).catch(() => '');
    void emitLifecycleDiscordEvent({
        type: 'ACCOUNT_CREATED',
        eventId: `account_created:${userId}`,
        persist: true,
        data: {
            userId,
            walletPubkey: walletAddress,
            username: username || 'unset',
            serverId: source,
            amountDisplay: 'n/a',
            stakeTier: 'n/a',
        },
    });
}

function readIdempotencyKey(req) {
    const raw = String(req?.headers?.['idempotency-key'] || '').trim();
    if (!raw) return null;
    if (!/^[a-zA-Z0-9-]{8,128}$/.test(raw)) return null;
    return raw;
}

function getClientIp(req) {
    const forwarded = String(req?.headers?.['x-forwarded-for'] || '').trim();
    if (forwarded) {
        const first = forwarded.split(',')[0]?.trim();
        if (first) return first;
    }
    return req?.socket?.remoteAddress || 'unknown';
}

function isWalletCashoutRateLimited(userId) {
    const now = Date.now();
    const current = cashoutRateLimitByUser.get(userId) || [];
    const next = current.filter((ts) => now - ts < WALLET_CASHOUT_RATE_LIMIT_WINDOW_MS);
    if (next.length >= WALLET_CASHOUT_RATE_LIMIT_MAX) {
        cashoutRateLimitByUser.set(userId, next);
        return true;
    }
    next.push(now);
    cashoutRateLimitByUser.set(userId, next);
    return false;
}

function buildExplorerUrl(signature) {
    if (!signature) return null;
    const cluster = encodeURIComponent(SOLANA_EXPLORER_CLUSTER || 'devnet');
    return `https://explorer.solana.com/tx/${encodeURIComponent(signature)}?cluster=${cluster}`;
}

async function findWalletCashoutByIdempotencyKey(userId, idempotencyKey) {
    if (!idempotencyKey) return null;
    const response = await supabaseRequest(
        `/wallet_cashouts?select=*&user_id=eq.${encodeURIComponent(userId)}&idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&order=created_at.desc&limit=1`
    );
    if (!response.ok) return null;
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length === 0) return null;
    return rows[0];
}

async function insertWalletCashoutPendingRow(payload) {
    const response = await supabaseRequest('/wallet_cashouts', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(payload),
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Failed to create wallet cashout row');
    }
    const rows = await response.json();
    return Array.isArray(rows) ? rows[0] : null;
}

async function updateWalletCashoutRow(id, fields) {
    const response = await supabaseRequest(
        `/wallet_cashouts?id=eq.${encodeURIComponent(id)}`,
        {
            method: 'PATCH',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify(fields),
        }
    );
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Failed to update wallet cashout row');
    }
    const rows = await response.json();
    return Array.isArray(rows) ? rows[0] : null;
}

async function getPendingWalletCashoutRow(userId) {
    const response = await supabaseRequest(
        `/wallet_cashouts?select=*&user_id=eq.${encodeURIComponent(userId)}&status=eq.pending&order=created_at.desc&limit=1`
    );
    if (!response.ok) return null;
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length === 0) return null;
    return rows[0];
}

async function getWalletCashoutById(userId, cashoutId) {
    const response = await supabaseRequest(
        `/wallet_cashouts?select=*&id=eq.${encodeURIComponent(cashoutId)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`
    );
    if (!response.ok) return null;
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length === 0) return null;
    return rows[0];
}

function parseSystemTransferFromSignedTransaction(tx, expectedFrom, expectedTo) {
    if (!tx || !Array.isArray(tx.instructions) || tx.instructions.length !== 1) {
        throw new Error('Signed transaction must contain exactly one instruction');
    }

    const ix = tx.instructions[0];
    if (!ix.programId?.equals(SystemProgram.programId)) {
        throw new Error('Signed transaction must be a system transfer');
    }

    const keys = Array.isArray(ix.keys) ? ix.keys : [];
    if (keys.length < 2) {
        throw new Error('Signed transaction transfer keys are invalid');
    }
    const fromPubkey = keys[0].pubkey;
    const toPubkey = keys[1].pubkey;
    if (!fromPubkey?.equals(expectedFrom)) {
        throw new Error('Signed transaction source does not match wallet');
    }
    if (!toPubkey?.equals(expectedTo)) {
        throw new Error('Signed transaction destination mismatch');
    }

    const raw = Buffer.from(ix.data || []);
    if (raw.length < 12 || raw.readUInt32LE(0) !== 2) {
        throw new Error('Signed transaction is not a transfer instruction');
    }
    const lamportsBigInt = raw.readBigUInt64LE(4);
    const lamports = Number(lamportsBigInt);
    if (!Number.isFinite(lamports) || lamports <= 0) {
        throw new Error('Signed transaction transfer amount is invalid');
    }

    return lamports;
}

function shortenWallet(value) {
    const text = String(value || '');
    if (!text) return 'unset';
    if (text.length <= 12) return text;
    return `${text.slice(0, 6)}...${text.slice(-6)}`;
}

function getDiscordColor(type) {
    switch (type) {
        case 'ACCOUNT_CREATED':
        case 'CASHOUT_SUCCESS':
            return 0x2ecc71;
        case 'JOIN':
            return 0xf1c40f;
        case 'CASHOUT_REQUEST':
            return 0xe67e22;
        case 'CASHOUT_FAILED':
            return 0xe74c3c;
        default:
            return 0x95a5a6;
    }
}

function formatStakeTier(usd) {
    const numeric = Number(usd || 0);
    if (!Number.isFinite(numeric) || numeric <= 0) return 'unset';
    if (Math.abs(numeric - 1) < 0.001) return '$1';
    if (Math.abs(numeric - 5) < 0.001) return '$5';
    if (Math.abs(numeric - 20) < 0.001) return '$20';
    return `$${numeric.toFixed(2)}`;
}

function buildTxUrl(signature) {
    if (!signature) return null;
    const cluster = encodeURIComponent(SOLANA_EXPLORER_CLUSTER || 'devnet');
    return `https://explorer.solana.com/tx/${encodeURIComponent(signature)}?cluster=${cluster}`;
}

function buildDiscordEmbed(type, data = {}) {
    const eventType = String(type || 'EVENT').toUpperCase();
    const timestamp = data.isoTimestamp || new Date().toISOString();
    const fields = [
        { name: 'Username', value: String(data.username || 'unset'), inline: true },
        { name: 'User ID', value: String(data.userId || 'unset'), inline: true },
        { name: 'Wallet', value: String(data.walletShort || shortenWallet(data.walletPubkey)), inline: true },
        { name: 'Stake', value: String(data.stakeTier || formatStakeTier(data.stakeUsd)), inline: true },
        { name: 'Amount', value: String(data.amountDisplay || 'n/a'), inline: true },
        { name: 'Server', value: String(data.serverId || 'n/a'), inline: true },
    ];
    if (data.txSignature) {
        fields.push({
            name: 'Tx Signature',
            value: `[${data.txSignature}](${buildTxUrl(data.txSignature)})`,
            inline: false,
        });
    }
    if (data.error) {
        fields.push({
            name: 'Error',
            value: String(data.error).slice(0, 900),
            inline: false,
        });
    }
    fields.push({
        name: 'Timestamp',
        value: timestamp,
        inline: false,
    });
    return {
        embeds: [
            {
                title: eventType,
                color: getDiscordColor(eventType),
                fields,
            },
        ],
    };
}

async function sendDiscordEvent(payload) {
    if (!DISCORD_WEBHOOK_URL) return false;
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4500);
        const response = await fetch(DISCORD_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal,
        });
        clearTimeout(timeout);
        return response.ok;
    } catch (err) {
        logDebug('Discord webhook send failed', { message: err?.message || String(err) });
        return false;
    }
}

async function persistLifecycleEvent(eventId, eventType, data = {}) {
    try {
        const response = await supabaseRequest('/event_log?on_conflict=event_id', {
            method: 'POST',
            headers: {
                Prefer: 'resolution=ignore-duplicates,return=representation',
            },
            body: JSON.stringify({
                event_id: eventId,
                event_type: eventType,
                user_id: data.userId || null,
                wallet_pubkey: data.walletPubkey || null,
                payload: data,
            }),
        });
        if (!response.ok) {
            if (response.status === 409) return false;
            const text = await response.text();
            logDebug('event_log persist failed', { status: response.status, error: text?.slice(0, 200) });
            return null;
        }
        const rows = await response.json();
        return Array.isArray(rows) && rows.length > 0;
    } catch (err) {
        logDebug('event_log persist exception', { message: err?.message || String(err) });
        return null;
    }
}

async function emitLifecycleDiscordEvent({
    type,
    eventId,
    persist = false,
    dedupeKey = null,
    data = {},
}) {
    const key = String(eventId || dedupeKey || `${type}:${data.userId || data.walletPubkey || 'anon'}`);
    const now = Date.now();
    const seenAt = discordEventDedupe.get(key);
    if (seenAt && now - seenAt < DISCORD_EVENT_DEDUPE_WINDOW_MS) {
        return false;
    }

    if (persist) {
        const inserted = await persistLifecycleEvent(key, type, data);
        if (inserted === false) {
            discordEventDedupe.set(key, now);
            return false;
        }
    }

    discordEventDedupe.set(key, now);
    const payload = buildDiscordEmbed(type, {
        ...data,
        walletShort: shortenWallet(data.walletPubkey),
        isoTimestamp: new Date().toISOString(),
    });
    return sendDiscordEvent(payload);
}

async function getOnboardingStatus(privyUserId, walletAddress) {
    const response = await supabaseRequest(
        `/user_onboarding?select=wallet_address,privy_user_id,demo_play,demo_started_at,demo_completed_at,demo_version&wallet_address=eq.${encodeURIComponent(walletAddress)}&privy_user_id=eq.${encodeURIComponent(privyUserId)}&limit=1`
    );
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Failed to fetch onboarding status');
    }
    const rows = await response.json();
    const row = Array.isArray(rows) ? rows[0] : null;
    return {
        demo_play: !!row?.demo_play,
        demo_started_at: row?.demo_started_at || null,
        demo_completed_at: row?.demo_completed_at || null,
        demo_version: row?.demo_version || 'v1',
    };
}

async function upsertOnboardingStart(privyUserId, walletAddress, demoVersion = 'v1') {
    const response = await supabaseRequest(
        '/user_onboarding?on_conflict=wallet_address',
        {
            method: 'POST',
            headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
            body: JSON.stringify({
                wallet_address: walletAddress,
                privy_user_id: privyUserId,
                demo_play: false,
                demo_started_at: new Date().toISOString(),
                demo_version: demoVersion,
                updated_at: new Date().toISOString(),
            }),
        }
    );
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Failed to update onboarding start');
    }
    const rows = await response.json();
    const row = Array.isArray(rows) ? rows[0] : null;
    return {
        demo_play: !!row?.demo_play,
        demo_started_at: row?.demo_started_at || null,
        demo_completed_at: row?.demo_completed_at || null,
        demo_version: row?.demo_version || demoVersion,
    };
}

async function markOnboardingComplete(privyUserId, walletAddress, demoVersion = 'v1') {
    const response = await supabaseRequest('/rpc/mark_demo_complete', {
        method: 'POST',
        body: JSON.stringify({
            p_privy_user_id: privyUserId,
            p_wallet_address: walletAddress,
            p_demo_version: demoVersion,
        }),
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Failed to mark demo completion');
    }
    const result = await response.json();
    if (typeof result === 'boolean') return result;
    if (Array.isArray(result) && result.length > 0) {
        const first = result[0];
        if (typeof first === 'boolean') return first;
        if (first && typeof first.mark_demo_complete === 'boolean') return first.mark_demo_complete;
    }
    if (result && typeof result.mark_demo_complete === 'boolean') return result.mark_demo_complete;
    return false;
}

const VOUCHER_IMAGE_PATH = path.join(__dirname, 'images', 'nft_flappy_voucher.png');
const VOUCHER_METADATA = {
    name: 'Flappy.one $1 Play Voucher',
    symbol: '$FLAP1',
    description: '$1 Free-Play Voucher for Flappy.one',
    attributes: [
        { trait_type: 'type', value: 'voucher' },
        { trait_type: 'utility', value: '1 free match credit' },
        { trait_type: 'issued_for', value: 'demo_complete' },
    ],
};
let voucherMintAuthorityCache = null;

function parseVoucherAuthorityKeypair(rawValue) {
    const raw = String(rawValue || '').trim();
    if (!raw) {
        throw new Error('Missing VOUCHER_MINT_AUTHORITY_SECRET');
    }

    // 1) JSON array secret key.
    if (raw.startsWith('[')) {
        const arr = JSON.parse(raw);
        return Keypair.fromSecretKey(Uint8Array.from(arr));
    }

    // 2) base64-encoded secret key bytes.
    try {
        const b64 = Buffer.from(raw, 'base64');
        if (b64.length >= 64) {
            return Keypair.fromSecretKey(Uint8Array.from(b64.slice(0, 64)));
        }
    } catch {}

    // 3) base58 secret key.
    try {
        const b58 = bs58.decode(raw);
        if (b58.length >= 64) {
            return Keypair.fromSecretKey(Uint8Array.from(b58.slice(0, 64)));
        }
    } catch {}

    throw new Error('Invalid VOUCHER_MINT_AUTHORITY_SECRET format (expected json array, base64, or base58 secret key)');
}

function getVoucherMintAuthorityKeypair() {
    if (voucherMintAuthorityCache) return voucherMintAuthorityCache;
    voucherMintAuthorityCache = parseVoucherAuthorityKeypair(process.env.VOUCHER_MINT_AUTHORITY_SECRET);
    return voucherMintAuthorityCache;
}

function getPublicBaseUrl(req) {
    const configured = String(process.env.PUBLIC_BASE_URL || '').trim();
    if (configured) return configured.replace(/\/+$/, '');
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const proto = req.headers['x-forwarded-proto'] || 'http';
    return `${proto}://${host}`.replace(/\/+$/, '');
}

function getVoucherMetadataUri(req) {
    const configured = String(process.env.VOUCHER_METADATA_URI || '').trim();
    if (configured) return configured;
    return `${getPublicBaseUrl(req)}/nft/voucher/metadata.json`;
}

function getVoucherImageUri(req) {
    const configured = String(process.env.VOUCHER_IMAGE_URI || '').trim();
    if (configured) return configured;
    return `${getPublicBaseUrl(req)}/nft/voucher/image.png`;
}

async function getVoucherMintStatus(privyUserId, walletAddress) {
    const response = await supabaseRequest(
        `/user_onboarding?select=voucher_minted,voucher_minted_at,voucher_mint_in_progress,voucher_mint_tx,voucher_mint_address,voucher_tx_signature,voucher_metadata_uri,demo_play,demo_completed_at&wallet_address=eq.${encodeURIComponent(walletAddress)}&privy_user_id=eq.${encodeURIComponent(privyUserId)}&limit=1`
    );
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Failed to fetch voucher mint status');
    }
    const rows = await response.json();
    const row = Array.isArray(rows) ? rows[0] : null;
    return {
        voucher_minted: !!row?.voucher_minted,
        voucher_mint_in_progress: !!row?.voucher_mint_in_progress,
        voucher_minted_at: row?.voucher_minted_at || null,
        voucher_mint_address: row?.voucher_mint_address || null,
        voucher_tx_signature: row?.voucher_tx_signature || row?.voucher_mint_tx || null,
        voucher_metadata_uri: row?.voucher_metadata_uri || null,
        demo_play: !!row?.demo_play,
        demo_completed_at: row?.demo_completed_at || null,
    };
}

async function claimVoucherMintLock(privyUserId, walletAddress) {
    const response = await supabaseRequest('/rpc/claim_demo_voucher_mint', {
        method: 'POST',
        body: JSON.stringify({
            p_privy_user_id: privyUserId,
            p_wallet_address: walletAddress,
        }),
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Failed to claim voucher mint lock');
    }
    const rows = await response.json();
    const row = Array.isArray(rows) ? rows[0] : null;
    return row || null;
}

async function finalizeVoucherMintRecord(privyUserId, walletAddress, mintAddress, txSignature, metadataUri) {
    const response = await supabaseRequest('/rpc/finalize_demo_voucher_mint', {
        method: 'POST',
        body: JSON.stringify({
            p_privy_user_id: privyUserId,
            p_wallet_address: walletAddress,
            p_voucher_mint_address: mintAddress,
            p_voucher_tx_signature: txSignature,
            p_voucher_metadata_uri: metadataUri,
        }),
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Failed to finalize voucher mint');
    }
    return true;
}

async function releaseVoucherMintLock(privyUserId, walletAddress) {
    const response = await supabaseRequest('/rpc/release_demo_voucher_mint_lock', {
        method: 'POST',
        body: JSON.stringify({
            p_privy_user_id: privyUserId,
            p_wallet_address: walletAddress,
        }),
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Failed to release voucher mint lock');
    }
    return true;
}

async function mintDemoVoucherDevnet({ walletAddress, metadataUri }) {
    const recipient = new PublicKey(walletAddress);
    const authority = getVoucherMintAuthorityKeypair();
    const authorityBalance = await voucherConnection.getBalance(authority.publicKey, 'confirmed');
    const minBalance = Number(process.env.VOUCHER_MIN_LAMPORTS || 2000000);
    if (authorityBalance < minBalance) {
        throw new Error(`Voucher mint authority has insufficient devnet SOL (${authorityBalance} lamports)`);
    }

    const metaplex = Metaplex.make(voucherConnection).use(keypairIdentity(authority));
    const { nft, response } = await metaplex.nfts().create({
        uri: metadataUri,
        name: VOUCHER_METADATA.name,
        symbol: VOUCHER_METADATA.symbol,
        sellerFeeBasisPoints: 0,
        tokenOwner: recipient,
        isMutable: false,
        maxSupply: 1,
    });

    return {
        ok: true,
        mintAddress: nft?.address?.toBase58?.() || null,
        txSignature: response?.signature || null,
        metadataUri,
    };
}

function handleVoucherAssetRoutes(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method !== 'GET') return false;

    if (url.pathname === '/nft/voucher/metadata.json') {
        const metadata = {
            ...VOUCHER_METADATA,
            image: getVoucherImageUri(req),
            properties: {
                files: [{ uri: getVoucherImageUri(req), type: 'image/png' }],
                category: 'image',
            },
        };
        res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'public, max-age=300',
        });
        res.end(JSON.stringify(metadata));
        return true;
    }

    if (url.pathname === '/nft/voucher/image.png') {
        fs.readFile(VOUCHER_IMAGE_PATH, (err, imageBuffer) => {
            if (err) {
                sendText(res, 404, 'Voucher image not found');
                return;
            }
            res.writeHead(200, {
                'Content-Type': 'image/png',
                'Cache-Control': 'public, max-age=86400',
            });
            res.end(imageBuffer);
        });
        return true;
    }

    return false;
}

async function handleOnboardingApi(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;
    if (!pathname.startsWith('/api/onboarding')) return false;

    const jwt = readBearerToken(req);
    if (!jwt) return sendText(res, 401, 'Missing authorization token');

    let privyData;
    try {
        privyData = await verifyUserAndGetWallet(jwt);
    } catch (err) {
        return sendText(res, 401, err?.message || 'Unauthorized');
    }

    const demoVersion = String(url.searchParams.get('version') || 'v1');

    if (pathname === '/api/onboarding/status' && req.method === 'GET') {
        const status = await getOnboardingStatus(privyData.privyUserId, privyData.walletAddress);
        return sendJson(res, 200, {
            wallet_address: privyData.walletAddress,
            demo_play: status.demo_play,
            demo_started_at: status.demo_started_at,
            demo_completed_at: status.demo_completed_at,
            demo_version: status.demo_version,
        });
    }

    if (pathname === '/api/onboarding/start' && req.method === 'POST') {
        const status = await upsertOnboardingStart(privyData.privyUserId, privyData.walletAddress, demoVersion);
        return sendJson(res, 200, {
            ok: true,
            wallet_address: privyData.walletAddress,
            demo_play: status.demo_play,
            demo_started_at: status.demo_started_at,
            demo_version: status.demo_version,
        });
    }

    if (pathname === '/api/onboarding/complete' && req.method === 'POST') {
        const rpcOk = await markOnboardingComplete(privyData.privyUserId, privyData.walletAddress, demoVersion);
        const status = await getOnboardingStatus(privyData.privyUserId, privyData.walletAddress);
        const ok = !!rpcOk || !!status.demo_play;
        if (ok) {
            await emitAccountCreatedEvent({
                userId: privyData.privyUserId,
                walletAddress: privyData.walletAddress,
                source: 'onboarding_complete',
            });
        }
        return sendJson(res, 200, {
            ok,
            wallet_address: privyData.walletAddress,
            demo_play: status.demo_play,
            demo_started_at: status.demo_started_at,
            demo_completed_at: status.demo_completed_at,
            demo_version: status.demo_version,
        });
    }

    return sendText(res, 405, 'Method not allowed');
}

async function handleVoucherApi(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;
    if (!pathname.startsWith('/api/voucher')) return false;

    const jwt = readBearerToken(req);
    if (!jwt) return sendText(res, 401, 'Missing authorization token');

    let privyData;
    try {
        privyData = await verifyUserAndGetWallet(jwt);
    } catch (err) {
        return sendText(res, 401, err?.message || 'Unauthorized');
    }

    if (pathname === '/api/voucher/mint' && req.method === 'POST') {
        const status = await getVoucherMintStatus(privyData.privyUserId, privyData.walletAddress);
        if (!status.demo_play) {
            return sendJson(res, 409, {
                ok: false,
                error: 'DEMO_NOT_COMPLETED',
            });
        }
        if (status.voucher_minted) {
            return sendJson(res, 200, {
                success: true,
                ok: true,
                alreadyMinted: true,
                voucher_minted: true,
                mintAddress: status.voucher_mint_address,
                txSignature: status.voucher_tx_signature,
                voucher_mint_address: status.voucher_mint_address,
                voucher_tx_signature: status.voucher_tx_signature,
                voucher_metadata_uri: status.voucher_metadata_uri,
                voucher_minted_at: status.voucher_minted_at,
            });
        }

        const lock = await claimVoucherMintLock(privyData.privyUserId, privyData.walletAddress);
        if (lock?.status === 'already_minted') {
            return sendJson(res, 200, {
                success: true,
                ok: true,
                alreadyMinted: true,
                voucher_minted: true,
                mintAddress: lock.voucher_mint_address || null,
                txSignature: lock.voucher_tx_signature || null,
                voucher_mint_address: lock.voucher_mint_address || null,
                voucher_tx_signature: lock.voucher_tx_signature || null,
                voucher_metadata_uri: lock.voucher_metadata_uri || null,
                voucher_minted_at: lock.voucher_minted_at || null,
            });
        }
        if (lock?.status === 'in_progress') {
            return sendJson(res, 409, {
                ok: false,
                error: 'MINT_IN_PROGRESS',
            });
        }
        if (lock?.status !== 'claimed') {
            return sendJson(res, 500, {
                ok: false,
                error: 'MINT_LOCK_FAILED',
            });
        }

        const metadataUri = getVoucherMetadataUri(req);
        let mintResult;
        try {
            mintResult = await mintDemoVoucherDevnet({
                walletAddress: privyData.walletAddress,
                metadataUri,
            });
            await finalizeVoucherMintRecord(
                privyData.privyUserId,
                privyData.walletAddress,
                mintResult.mintAddress || null,
                mintResult.txSignature || null,
                metadataUri
            );
        } catch (err) {
            console.error('[voucher] mint failed', err);
            try {
                await releaseVoucherMintLock(privyData.privyUserId, privyData.walletAddress);
            } catch (releaseErr) {
                console.error('[voucher] failed to release lock', releaseErr);
            }
            return sendJson(res, 502, {
                success: false,
                ok: false,
                error: 'MINT_FAILED',
                message: err?.message || 'Voucher mint failed',
            });
        }

        const next = await getVoucherMintStatus(privyData.privyUserId, privyData.walletAddress);
        return sendJson(res, 200, {
            success: true,
            ok: true,
            alreadyMinted: false,
            voucher_minted: next.voucher_minted,
            mintAddress: next.voucher_mint_address,
            txSignature: next.voucher_tx_signature,
            voucher_mint_address: next.voucher_mint_address,
            voucher_tx_signature: next.voucher_tx_signature,
            voucher_metadata_uri: next.voucher_metadata_uri,
            voucher_minted_at: next.voucher_minted_at,
        });
    }

    return sendText(res, 405, 'Method not allowed');
}

async function handleDemoApi(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;
    if (!pathname.startsWith('/api/demo')) return false;

    if (pathname === '/api/demo/reset' && req.method === 'POST') {
        const jwt = readBearerToken(req);
        if (!jwt) return sendText(res, 401, 'Missing authorization token');
        try {
            await verifyUserAndGetWallet(jwt);
        } catch (err) {
            return sendText(res, 401, err?.message || 'Unauthorized');
        }
        if (DEV_LOG_BOTS) {
            console.info('[DEMO] reset ack');
        }
        return sendJson(res, 200, {
            ok: true,
            resetAt: Date.now(),
        });
    }

    return sendText(res, 405, 'Method not allowed');
}

async function handleMenuApi(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    if (pathname === '/api/menu/stats' && req.method === 'GET') {
        const stats = await getMenuStats();
        return sendJson(res, 200, stats);
    }

    return false;
}

async function handleWalletApi(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;
    if (!pathname.startsWith('/api/wallet') && !pathname.startsWith('/api/cashout')) return false;

    const jwt = readBearerToken(req);
    if (!jwt) return sendText(res, 401, 'Missing authorization token');

    let privyData;
    try {
        privyData = await verifyUserAndGetWallet(jwt);
    } catch (err) {
        return sendText(res, 401, err?.message || 'Unauthorized');
    }

    let sourcePubkey;
    try {
        sourcePubkey = new PublicKey(privyData.walletAddress);
    } catch {
        return sendText(res, 400, 'User wallet is invalid');
    }

    if ((pathname === '/api/wallet/balance' || pathname === '/api/cashout/balance') && req.method === 'GET') {
        const [balanceLamports, solPriceUsd] = await Promise.all([
            connection.getBalance(sourcePubkey, 'confirmed'),
            getSolPriceUsd(),
        ]);
        const solBalance = balanceLamports / LAMPORTS_PER_SOL;
        const usdBalance = solBalance * solPriceUsd;
        const maxWithdrawableUsd = Math.max(0, usdBalance - WALLET_CASHOUT_RESERVED_USD);
        return sendJson(res, 200, {
            solBalance,
            usdBalance,
            reservedUsd: WALLET_CASHOUT_RESERVED_USD,
            maxWithdrawableUsd: roundUsd(maxWithdrawableUsd, 2),
            walletPubkey: sourcePubkey.toBase58(),
            cluster: SOLANA_EXPLORER_CLUSTER,
        });
    }

    if (
        (
            pathname === '/api/wallet/cashout'
            || pathname === '/api/wallet/cashout/prepare'
            || pathname === '/api/cashout'
            || pathname === '/api/cashout/prepare'
        )
        && req.method === 'POST'
    ) {
        const userId = privyData.privyUserId;
        const ip = getClientIp(req);
        if (isWalletCashoutRateLimited(`${userId}:${ip}`)) {
            return sendJson(res, 429, { error: 'Too many cashout attempts. Try again in a minute.' });
        }
        if (cashoutActiveUsers.has(userId)) {
            return sendJson(res, 409, { error: 'A cashout request is already being processed.' });
        }
        cashoutActiveUsers.add(userId);
        try {
            const idempotencyKey = readIdempotencyKey(req);
            if (idempotencyKey) {
                const existing = await findWalletCashoutByIdempotencyKey(userId, idempotencyKey);
                if (existing && (existing.status === 'pending' || existing.status === 'success')) {
                    return sendJson(res, 200, {
                        ok: true,
                        stage: existing.status === 'success' ? 'success' : 'pending',
                        cashoutId: existing.id,
                        txSignature: existing.tx_signature || null,
                        explorerUrl: buildExplorerUrl(existing.tx_signature),
                        amountUsd: Number(existing.amount_usd || 0),
                        amountSol: Number(existing.amount_sol || 0),
                        destination: existing.destination_pubkey,
                    });
                }
            }

            const pendingInMemory = pendingWalletCashoutsByUser.get(userId);
            if (pendingInMemory && (Date.now() - pendingInMemory.createdAt) < WALLET_CASHOUT_PENDING_TTL_MS) {
                return sendJson(res, 409, { error: 'Another cashout is still pending signature.' });
            }

            const pendingRow = await getPendingWalletCashoutRow(userId);
            if (pendingRow) {
                const pendingAgeMs = Date.now() - Date.parse(pendingRow.created_at || 0);
                if (Number.isFinite(pendingAgeMs) && pendingAgeMs >= WALLET_CASHOUT_PENDING_TTL_MS) {
                    await updateWalletCashoutRow(pendingRow.id, {
                        status: 'failed',
                        error_message: 'Timed out before signature submission',
                    });
                } else {
                    return sendJson(res, 409, { error: 'Another cashout is already pending.' });
                }
            }

            const body = await readJsonBody(req);
            const destination = String(body?.destination || '').trim();
            const amountUsdRaw = Number(body?.amountUsd);
            if (!destination) return sendText(res, 400, 'Missing destination address');
            if (!Number.isFinite(amountUsdRaw) || amountUsdRaw <= 0) {
                return sendText(res, 400, 'Invalid amountUsd');
            }

            let destinationPubkey;
            try {
                destinationPubkey = new PublicKey(destination);
            } catch {
                return sendText(res, 400, 'Invalid destination wallet address');
            }

            const amountUsd = roundUsd(amountUsdRaw, 2);
            const [solPriceUsd, balanceLamports, blockhashInfo] = await Promise.all([
                getSolPriceUsd(),
                connection.getBalance(sourcePubkey, 'confirmed'),
                getLatestBlockhashCached(),
            ]);
            const solBalance = balanceLamports / LAMPORTS_PER_SOL;
            const usdBalance = solBalance * solPriceUsd;
            const maxWithdrawableUsd = Math.max(0, usdBalance - WALLET_CASHOUT_RESERVED_USD);

            if (maxWithdrawableUsd <= 0) {
                return sendJson(res, 400, { error: 'Insufficient balance for cashout. Minimum $0.20 + $0.01 required.' });
            }
            if (amountUsd > roundUsd(maxWithdrawableUsd, 2) + 1e-9) {
                return sendJson(res, 400, { error: 'Requested amount exceeds withdrawable balance.' });
            }

            const lamports = Math.floor((amountUsd / solPriceUsd) * LAMPORTS_PER_SOL);
            if (!Number.isFinite(lamports) || lamports <= 0) {
                return sendJson(res, 400, { error: 'Amount is too small for on-chain transfer at current price.' });
            }

            const reservedLamports = Math.ceil((WALLET_CASHOUT_RESERVED_USD / solPriceUsd) * LAMPORTS_PER_SOL);
            if ((balanceLamports - reservedLamports) < lamports) {
                return sendJson(res, 400, { error: 'Insufficient withdrawable balance after reserve.' });
            }

            const tx = new Transaction().add(
                SystemProgram.transfer({
                    fromPubkey: sourcePubkey,
                    toPubkey: destinationPubkey,
                    lamports,
                })
            );
            tx.recentBlockhash = blockhashInfo.blockhash;
            tx.feePayer = sourcePubkey;
            const unsignedTransaction = tx
                .serialize({ requireAllSignatures: false, verifySignatures: false })
                .toString('base64');

            const row = await insertWalletCashoutPendingRow({
                user_id: userId,
                idempotency_key: readIdempotencyKey(req),
                source_pubkey: sourcePubkey.toBase58(),
                destination_pubkey: destinationPubkey.toBase58(),
                amount_usd: amountUsd,
                amount_sol: lamports / LAMPORTS_PER_SOL,
                amount_lamports: lamports,
                sol_price_usd: solPriceUsd,
                status: 'pending',
            });
            if (!row?.id) throw new Error('Failed to create pending cashout record');

            pendingWalletCashoutsByUser.set(userId, {
                cashoutId: row.id,
                destination: destinationPubkey.toBase58(),
                lamports,
                amountUsd,
                createdAt: Date.now(),
            });

            void emitLifecycleDiscordEvent({
                type: 'CASHOUT_REQUEST',
                eventId: `wallet_cashout_request:${row.id}`,
                data: {
                    userId,
                    walletPubkey: sourcePubkey.toBase58(),
                    username: await getProfileUsernameByWallet(sourcePubkey.toBase58()).catch(() => '') || 'unset',
                    serverId: 'wallet_api',
                    stakeTier: 'wallet',
                    amountDisplay: `$${amountUsd.toFixed(2)} / ${(lamports / LAMPORTS_PER_SOL).toFixed(6)} SOL`,
                },
            });

            return sendJson(res, 200, {
                ok: true,
                stage: 'prepared',
                cashoutId: row.id,
                unsignedTransaction,
                destination: destinationPubkey.toBase58(),
                amountUsd,
                amountLamports: lamports,
                amountSol: lamports / LAMPORTS_PER_SOL,
                reservedUsd: WALLET_CASHOUT_RESERVED_USD,
                maxWithdrawableUsd: roundUsd(maxWithdrawableUsd, 2),
                walletPubkey: sourcePubkey.toBase58(),
                cluster: SOLANA_EXPLORER_CLUSTER,
            });
        } finally {
            cashoutActiveUsers.delete(userId);
        }
    }

    if (
        (
            pathname === '/api/wallet/cashout/submit'
            || pathname === '/api/wallet/cashout/confirm'
            || pathname === '/api/cashout/submit'
            || pathname === '/api/cashout/confirm'
        )
        && req.method === 'POST'
    ) {
        const userId = privyData.privyUserId;
        if (cashoutActiveUsers.has(userId)) {
            return sendJson(res, 409, { error: 'A cashout request is already being processed.' });
        }
        cashoutActiveUsers.add(userId);

        let cashoutId = null;
        try {
            const body = await readJsonBody(req);
            cashoutId = String(body?.cashoutId || '').trim();
            const signedTransaction = String(body?.signedTransaction || '').trim();
            if (!cashoutId) return sendText(res, 400, 'Missing cashoutId');
            if (!signedTransaction) return sendText(res, 400, 'Missing signedTransaction');

            const row = await getWalletCashoutById(userId, cashoutId);
            if (!row) return sendText(res, 404, 'Cashout request not found');
            if (row.status === 'success') {
                return sendJson(res, 200, {
                    ok: true,
                    stage: 'success',
                    cashoutId: row.id,
                    txSignature: row.tx_signature,
                    explorerUrl: buildExplorerUrl(row.tx_signature),
                    amountUsd: Number(row.amount_usd || 0),
                    amountSol: Number(row.amount_sol || 0),
                });
            }
            if (row.status !== 'pending') {
                return sendJson(res, 409, { error: 'Cashout request is not pending.' });
            }

            let signedBytes;
            let tx;
            try {
                signedBytes = Buffer.from(signedTransaction, 'base64');
                tx = Transaction.from(signedBytes);
            } catch {
                return sendText(res, 400, 'Invalid signed transaction encoding');
            }

            if (!tx.feePayer || !tx.feePayer.equals(sourcePubkey)) {
                return sendText(res, 400, 'Signed transaction fee payer mismatch');
            }
            const sourceSig = tx.signatures.find((item) => item.publicKey?.equals(sourcePubkey));
            if (!sourceSig?.signature) {
                return sendText(res, 400, 'Missing source wallet signature');
            }
            if (!tx.verifySignatures(false)) {
                return sendText(res, 400, 'Signed transaction signatures failed verification');
            }

            const destinationPubkey = new PublicKey(String(row.destination_pubkey || ''));
            const lamportsInTx = parseSystemTransferFromSignedTransaction(tx, sourcePubkey, destinationPubkey);
            const expectedLamports = Number(row.amount_lamports || 0);
            if (!Number.isFinite(expectedLamports) || expectedLamports <= 0 || lamportsInTx !== expectedLamports) {
                return sendText(res, 400, 'Signed transaction amount mismatch');
            }

            const [solPriceUsd, balanceLamports] = await Promise.all([
                Promise.resolve(Number(row.sol_price_usd || 0) || getSolPriceUsd()),
                connection.getBalance(sourcePubkey, 'confirmed'),
            ]);
            const reservedLamports = Math.ceil((WALLET_CASHOUT_RESERVED_USD / solPriceUsd) * LAMPORTS_PER_SOL);
            if ((balanceLamports - reservedLamports) < expectedLamports) {
                await updateWalletCashoutRow(cashoutId, {
                    status: 'failed',
                    error_message: 'Insufficient balance after reserve check',
                });
                pendingWalletCashoutsByUser.delete(userId);
                void emitLifecycleDiscordEvent({
                    type: 'CASHOUT_FAILED',
                    eventId: `wallet_cashout_failed:${cashoutId}:reserve`,
                    data: {
                        userId,
                        walletPubkey: sourcePubkey.toBase58(),
                        username: await getProfileUsernameByWallet(sourcePubkey.toBase58()).catch(() => '') || 'unset',
                        serverId: 'wallet_api',
                        stakeTier: 'wallet',
                        amountDisplay: `$${Number(row.amount_usd || 0).toFixed(2)} / ${Number(row.amount_sol || 0).toFixed(6)} SOL`,
                        error: 'Insufficient withdrawable balance after reserve.',
                    },
                });
                return sendJson(res, 400, { error: 'Insufficient withdrawable balance after reserve.' });
            }

            let signature;
            try {
                signature = await connection.sendRawTransaction(signedBytes, { skipPreflight: false, maxRetries: 3 });
                await connection.confirmTransaction(signature, 'confirmed');
            } catch (err) {
                await updateWalletCashoutRow(cashoutId, {
                    status: 'failed',
                    error_message: err?.message || 'Failed to broadcast cashout transaction',
                });
                pendingWalletCashoutsByUser.delete(userId);
                void emitLifecycleDiscordEvent({
                    type: 'CASHOUT_FAILED',
                    eventId: `wallet_cashout_failed:${cashoutId}:broadcast`,
                    data: {
                        userId,
                        walletPubkey: sourcePubkey.toBase58(),
                        username: await getProfileUsernameByWallet(sourcePubkey.toBase58()).catch(() => '') || 'unset',
                        serverId: 'wallet_api',
                        stakeTier: 'wallet',
                        amountDisplay: `$${Number(row.amount_usd || 0).toFixed(2)} / ${Number(row.amount_sol || 0).toFixed(6)} SOL`,
                        error: err?.message || 'Failed to broadcast cashout transaction',
                    },
                });
                return sendJson(res, 502, { error: err?.message || 'Failed to broadcast cashout transaction' });
            }

            await updateWalletCashoutRow(cashoutId, {
                status: 'success',
                tx_signature: signature,
                error_message: null,
            });
            pendingWalletCashoutsByUser.delete(userId);
            void emitLifecycleDiscordEvent({
                type: 'CASHOUT_SUCCESS',
                eventId: `wallet_cashout_success:${signature}`,
                persist: true,
                data: {
                    userId,
                    walletPubkey: sourcePubkey.toBase58(),
                    username: await getProfileUsernameByWallet(sourcePubkey.toBase58()).catch(() => '') || 'unset',
                    serverId: 'wallet_api',
                    stakeTier: 'wallet',
                    amountDisplay: `$${Number(row.amount_usd || 0).toFixed(2)} / ${Number(row.amount_sol || 0).toFixed(6)} SOL`,
                    txSignature: signature,
                },
            });
            return sendJson(res, 200, {
                ok: true,
                stage: 'success',
                cashoutId,
                txSignature: signature,
                explorerUrl: buildExplorerUrl(signature),
                amountUsd: Number(row.amount_usd || 0),
                amountSol: Number(row.amount_sol || 0),
                amountLamports: expectedLamports,
                cluster: SOLANA_EXPLORER_CLUSTER,
            });
        } catch (err) {
            if (cashoutId) {
                try {
                    await updateWalletCashoutRow(cashoutId, {
                        status: 'failed',
                        error_message: err?.message || 'Cashout submit failed',
                    });
                } catch {}
                void emitLifecycleDiscordEvent({
                    type: 'CASHOUT_FAILED',
                    eventId: `wallet_cashout_failed:${cashoutId}:exception`,
                    data: {
                        userId,
                        walletPubkey: sourcePubkey.toBase58(),
                        username: await getProfileUsernameByWallet(sourcePubkey.toBase58()).catch(() => '') || 'unset',
                        serverId: 'wallet_api',
                        stakeTier: 'wallet',
                        error: err?.message || 'Cashout submit failed',
                    },
                });
            }
            return sendJson(res, 500, { error: err?.message || 'Cashout submit failed' });
        } finally {
            pendingWalletCashoutsByUser.delete(userId);
            cashoutActiveUsers.delete(userId);
        }
    }

    return sendText(res, 405, 'Method not allowed');
}

// ============================================================================
// SKIN API
// ============================================================================
const SKINS_DIR = path.join(__dirname, 'flappy.one-react', 'public', 'assets', 'sprites', 'birds');
const DEFAULT_SKIN = 'yellow';

// Base skins that are always free/unlocked for all players
// Only special/reward skins (like 'diddy') require ownership via player_skin_ownership
const BASE_SKINS = new Set([
    'yellow',
    'blue',
    'cloudyblue',
    'orange',
    'pink',
    'purple',
    'red',
    'teal',
    'diddy'  // TODO: Move to special skins once ownership system is ready
]);

function isBaseSkin(skinId) {
    return BASE_SKINS.has(skinId);
}

// Cache discovered skins (refreshed on startup and periodically)
let cachedSkins = null;
let skinsCacheTime = 0;
const SKINS_CACHE_TTL_MS = 60000; // 1 minute

function discoverSkins() {
    const now = Date.now();
    if (cachedSkins && (now - skinsCacheTime) < SKINS_CACHE_TTL_MS) {
        return cachedSkins;
    }

    try {
        const entries = fs.readdirSync(SKINS_DIR, { withFileTypes: true });
        const skins = entries
            .filter(entry => entry.isDirectory())
            .map(entry => ({
                id: entry.name,
                name: entry.name.charAt(0).toUpperCase() + entry.name.slice(1).replace(/([A-Z])/g, ' $1').trim(),
                preview: `/assets/sprites/birds/${entry.name}/fly_1.png`,
                isDefault: entry.name === DEFAULT_SKIN,
                isBaseSkin: isBaseSkin(entry.name)
            }));

        cachedSkins = skins;
        skinsCacheTime = now;
        return skins;
    } catch (err) {
        console.error('Failed to discover skins:', err);
        return cachedSkins || [{ id: DEFAULT_SKIN, name: 'Yellow', preview: `/assets/sprites/birds/${DEFAULT_SKIN}/fly_1.png`, isDefault: true, isBaseSkin: true }];
    }
}

async function handleSkinsApi(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    // GET /api/skins - List all available skins
    if (pathname === '/api/skins' && req.method === 'GET') {
        const skins = discoverSkins();
        return sendJson(res, 200, { skins });
    }

    // GET /api/skins/ownership - Get user's owned skins
    if (pathname === '/api/skins/ownership' && req.method === 'GET') {
        const wallet = url.searchParams.get('wallet');
        if (!wallet) return sendText(res, 400, 'Missing wallet');

        // Get all skins
        const allSkins = discoverSkins();

        // Query player_skin_ownership table for this wallet (for special/reward skins)
        const response = await supabaseRequest(
            `/player_skin_ownership?select=skin_id&wallet_address=eq.${encodeURIComponent(wallet)}`
        );

        // Build set of explicitly owned special skins
        let explicitlyOwnedIds = new Set();
        if (response.ok) {
            const ownershipData = await response.json();
            explicitlyOwnedIds = new Set(ownershipData.map(row => row.skin_id));
        }

        // Determine ownership: base skins are always owned, special skins need explicit ownership
        const isOwnedSkin = (skin) => {
            if (skin.isBaseSkin) return true; // Base skins always unlocked
            return explicitlyOwnedIds.has(skin.id); // Special skins need explicit ownership
        };

        // Get user's selected skin from leaderboard table
        const userResponse = await supabaseRequest(
            `/leaderboard?select=selected_skin&wallet_address=eq.${encodeURIComponent(wallet)}&limit=1`
        );
        let selectedSkin = DEFAULT_SKIN;
        if (userResponse.ok) {
            const userData = await userResponse.json();
            const savedSkin = userData?.[0]?.selected_skin;
            // Only use saved skin if user actually owns it
            if (savedSkin) {
                const skinInfo = allSkins.find(s => s.id === savedSkin);
                if (skinInfo && isOwnedSkin(skinInfo)) {
                    selectedSkin = savedSkin;
                }
            }
        }

        const result = allSkins.map(skin => ({
            ...skin,
            owned: isOwnedSkin(skin)
        }));

        return sendJson(res, 200, { skins: result, selectedSkin });
    }

    // POST /api/skins/select - Select a skin
    if (pathname === '/api/skins/select' && req.method === 'POST') {
        const body = await readJsonBody(req);
        if (!body?.wallet_address || !body?.skin_id) {
            return sendText(res, 400, 'Missing wallet_address or skin_id');
        }

        const { wallet_address, skin_id } = body;

        // Validate skin exists
        const allSkins = discoverSkins();
        const skinInfo = allSkins.find(s => s.id === skin_id);
        if (!skinInfo) {
            return sendText(res, 400, 'Invalid skin_id');
        }

        // Check ownership: base skins are always allowed, special skins need ownership
        if (!skinInfo.isBaseSkin) {
            const ownershipResponse = await supabaseRequest(
                `/player_skin_ownership?select=skin_id&wallet_address=eq.${encodeURIComponent(wallet_address)}&skin_id=eq.${encodeURIComponent(skin_id)}&limit=1`
            );

            if (ownershipResponse.ok) {
                const ownershipData = await ownershipResponse.json();
                if (!ownershipData || ownershipData.length === 0) {
                    return sendText(res, 403, 'You do not own this skin');
                }
            } else {
                // If we can't verify ownership, deny special skins
                return sendText(res, 403, 'Unable to verify skin ownership');
            }
        }

        // Update selected_skin in leaderboard table (upsert to handle missing rows)
        const updateResponse = await supabaseRequest(
            `/leaderboard?wallet_address=eq.${encodeURIComponent(wallet_address)}`,
            {
                method: 'PATCH',
                headers: { Prefer: 'return=representation' },
                body: JSON.stringify({ selected_skin: skin_id, updated_at: new Date().toISOString() }),
            }
        );

        if (!updateResponse.ok) {
            const errorText = await updateResponse.text();
            console.error('Failed to update selected skin:', errorText);
            return sendText(res, 500, 'Failed to save skin selection');
        }

        const data = await updateResponse.json();

        // If no rows were updated (user has no leaderboard entry), create one
        if (!data || data.length === 0) {
            const insertResponse = await supabaseRequest(
                `/leaderboard`,
                {
                    method: 'POST',
                    headers: { Prefer: 'return=representation' },
                    body: JSON.stringify({
                        wallet_address: wallet_address,
                        selected_skin: skin_id,
                        username: 'Player',
                        balance: 0,
                        total_profit: 0,
                        games_played: 0,
                        updated_at: new Date().toISOString()
                    }),
                }
            );

            if (!insertResponse.ok) {
                const errorText = await insertResponse.text();
                console.error('Failed to create leaderboard entry for skin:', errorText);
                return sendText(res, 500, 'Failed to save skin selection');
            }
        }

        return sendJson(res, 200, { success: true, selectedSkin: skin_id });
    }

    return false;
}

const server = http.createServer((req, res) => {
    if (req.url.startsWith('/nft/voucher/')) {
        if (handleVoucherAssetRoutes(req, res)) {
            return;
        }
    }
    if (req.url.startsWith('/api/skins')) {
        handleSkinsApi(req, res)
            .catch((err) => {
                const status = err?.status || 500;
                sendText(res, status, err?.message || 'Server error');
            });
        return;
    }
    if (req.url === '/admin/risk' && req.method === 'GET') {
        if (process.env.NODE_ENV === 'production') { sendText(res, 404, 'Not found'); return; }
        const htmlPath = path.join(__dirname, 'risk', 'dashboard.html');
        fs.readFile(htmlPath, 'utf8', (err, html) => {
            if (err) { sendText(res, 500, 'Dashboard file not found'); return; }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(html);
        });
        return;
    }
    if (req.url === '/api/risk/dashboard' && req.method === 'GET') {
        if (process.env.NODE_ENV === 'production') { sendText(res, 404, 'Not found'); return; }
        const data = risk.getDashboardData();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
        return;
    }
    if (req.url.startsWith('/api/perf/server') && req.method === 'GET') {
        if (!PERF_METRICS_ENABLED) {
            sendText(res, 404, 'Not found');
            return;
        }
        sendJson(res, 200, getServerPerfSnapshot());
        return;
    }
    if (req.url.startsWith('/api/leaderboard')) {
        handleLeaderboardApi(req, res)
            .catch((err) => {
                const status = err?.status || 500;
                sendText(res, status, err?.message || 'Server error');
            });
        return;
    }
    if (req.url.startsWith('/api/social')) {
        handleSocialApi(req, res)
            .catch((err) => {
                const status = err?.status || 500;
                sendText(res, status, err?.message || 'Server error');
            });
        return;
    }
    if (req.url.startsWith('/api/menu')) {
        handleMenuApi(req, res)
            .catch((err) => {
                const status = err?.status || 500;
                sendText(res, status, err?.message || 'Server error');
            });
        return;
    }
    if (req.url.startsWith('/api/wallet')) {
        handleWalletApi(req, res)
            .catch((err) => {
                const status = err?.status || 500;
                sendText(res, status, err?.message || 'Server error');
            });
        return;
    }
    if (req.url.startsWith('/api/cashout')) {
        handleWalletApi(req, res)
            .catch((err) => {
                const status = err?.status || 500;
                sendText(res, status, err?.message || 'Server error');
            });
        return;
    }
    if (req.url.startsWith('/api/onboarding')) {
        handleOnboardingApi(req, res)
            .catch((err) => {
                const status = err?.status || 500;
                sendText(res, status, err?.message || 'Server error');
            });
        return;
    }
    if (req.url.startsWith('/api/voucher')) {
        handleVoucherApi(req, res)
            .catch((err) => {
                const status = err?.status || 500;
                sendText(res, status, err?.message || 'Server error');
            });
        return;
    }
    if (req.url.startsWith('/api/demo')) {
        handleDemoApi(req, res)
            .catch((err) => {
                const status = err?.status || 500;
                sendText(res, status, err?.message || 'Server error');
            });
        return;
    }
    let filePath = req.url === '/' ? '/index.html' : req.url;
    filePath = path.join(__dirname, 'public', filePath);
    const extname = path.extname(filePath);
    const contentTypes = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg' };
    const contentType = contentTypes[extname] || 'application/octet-stream';
    
    fs.readFile(filePath, (err, content) => {
        if (err) { res.writeHead(404); res.end('Not found'); }
        else { res.writeHead(200, { 'Content-Type': contentType }); res.end(content); }
    });
});

// ============================================================================
// WEBSOCKET SERVER
// ============================================================================
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
    console.log(`WebSocket connected: ${req?.url || '/'} | origin=${req?.headers?.origin || 'unknown'}`);
    const playerId = generateId();
    const player = new Player(playerId, ws);
    players.set(playerId, player);
    
    console.log(`Player connected: ${playerId} (Total: ${players.size})`);
    
    ws.send(JSON.stringify({
        type: 'init',
        playerId: playerId,
        config: {
            worldWidth: CONFIG.WORLD_WIDTH,
            worldHeight: CONFIG.WORLD_HEIGHT,
            playerSize: CONFIG.PLAYER_SIZE,
            bulletSize: CONFIG.BULLET_SIZE,
            bulletSpeed: CONFIG.BULLET_SPEED,
            bulletLifetime: CONFIG.BULLET_LIFETIME,
            bulletRange: CONFIG.BULLET_RANGE,
            playerSpeed: CONFIG.PLAYER_SPEED,
            shootCooldown: CONFIG.SHOOT_COOLDOWN,
            boostMax: CONFIG.BOOST_MAX,
            orbSize: CONFIG.ORB_SIZE,
            orbMagnetRadius: CONFIG.ORB_MAGNET_RADIUS,
            cashoutTime: CONFIG.CASHOUT_TIME,
            cashoutSegments: CONFIG.CASHOUT_SEGMENTS,
            borderMarginMin: CONFIG.BORDER_MARGIN_MIN,
            borderMarginMax: CONFIG.BORDER_MARGIN_MAX,
        },
        pipes: PIPES,
        serverZones: SERVER_ZONES,
        birdTypes: BIRD_TYPES,
        players: Array.from(players.values()).filter(p => p.joined).map(p => p.serialize()),
        orbs: Array.from(orbs.values()).map(o => o.serialize()),
        currentBorderMargin: getDynamicBorderMargin(),
    }));
    ws.send(JSON.stringify({
        type: 'leaderboard_update',
        rows: getSessionLeaderboardRows(),
    }));

    // Use async message handler
    ws.on('message', async (data) => {
        try {
            if (!player.checkRateLimit()) return;
            const message = JSON.parse(data);
            await handleMessage(player, message);
        } catch (e) {
            console.error('Message error:', e);
        }
    });
    
    ws.on('close', () => {
        console.log(`Player disconnected: ${playerId}`);

        if (player.joined && player.alive) {
            queuePlayerSessionRecord(player, {
                outcome: 'died',
                cashoutLamports: 0,
            });
        }
        
        if (player.joined && player.alive && player.balanceLamports > 0) {
            const droppedOrbs = spawnOrbs(player.x, player.y, player.balanceLamports, player.birdType, player.id);
            broadcastToAll({ type: 'orbsSpawned', orbs: droppedOrbs.map(o => o.serialize()) });
        }

        risk.onPlayerDisconnect(playerId);
        players.delete(playerId);
        playerPrivyMap.delete(playerId);
        const pendingEntryId = entryByPlayer.get(playerId);
        if (pendingEntryId) {
            entryRecords.delete(pendingEntryId);
            entryByPlayer.delete(playerId);
        }
        broadcast({ type: 'playerLeave', playerId: playerId, currentBorderMargin: getDynamicBorderMargin() });
        broadcastSessionLeaderboard(true);
    });
    
ws.on('error', (err) => console.error(`WebSocket error for ${playerId}:`, err));
});

// ============================================================================
// ASYNC MESSAGE HANDLER
// ============================================================================
function normalizeBetUsd(value) {
    if (typeof value !== 'number') return null;
    const bet = Math.floor(value * 100) / 100;
    return Number.isFinite(bet) ? bet : null;
}

function normalizeUsername(value) {
    if (typeof value !== 'string') return '';
    return value.replace(/[^a-zA-Z0-9_-]/g, '').trim().slice(0, 21);
}

function isValidUsername(value) {
    return /^[a-zA-Z0-9_-]{3,21}$/.test(String(value || ''));
}

async function getProfileUsernameByWallet(walletAddress) {
    const wallet = String(walletAddress || '').trim();
    if (!wallet) return '';
    try {
        const lbResponse = await supabaseRequest(
            `/leaderboard?select=username&wallet_address=eq.${encodeURIComponent(wallet)}&limit=1`
        );
        if (lbResponse.ok) {
            const rows = await lbResponse.json();
            const raw = Array.isArray(rows) && rows.length > 0 ? rows[0]?.username : '';
            const trimmed = String(raw || '').trim();
            if (trimmed) return trimmed;
        }
    } catch (err) {
        console.error('[username] leaderboard lookup failed:', err?.message || err);
    }
    try {
        const profileResponse = await supabaseRequest(
            `/player_profile_stats?select=username&wallet_address=eq.${encodeURIComponent(wallet)}&limit=1`
        );
        if (profileResponse.ok) {
            const rows = await profileResponse.json();
            const raw = Array.isArray(rows) && rows.length > 0 ? rows[0]?.username : '';
            return String(raw || '').trim();
        }
    } catch (err) {
        console.error('[username] profile lookup failed:', err?.message || err);
    }
    return '';
}

function validateBetAmount(betUsd) {
    if (!BUYIN_OPTIONS.has(betUsd)) return 'Bet must be one of: 1, 5, 25';
    return null;
}

async function handleMessage(player, message) {
    if (!message || typeof message.type !== 'string') return;
    
    switch (message.type) {
        case 'setName':
            if (typeof message.name === 'string') {
                let name = normalizeUsername(message.name);
                if (name.length > 0) {
                    player.name = name;
                    broadcast({ type: 'playerUpdate', player: player.serialize() });
                    broadcastSessionLeaderboard(true);
                }
            }
            break;
        case 'joinGame':
            player.ws.send(JSON.stringify({ type: 'error', code: 'JOIN_FLOW_MOVED', message: 'Use requestEntry/confirmEntry' }));
            break;
            
        case 'requestEntry':
            try {
                if (!message.jwt) {
                    player.ws.send(JSON.stringify({ type: 'entryError', code: 'NO_JWT', message: 'Authentication required' }));
                    return;
                }

                const betUsd = normalizeBetUsd(message.betAmount);
                if (!betUsd || betUsd < 1) {
                    player.ws.send(JSON.stringify({ type: 'entryError', code: 'INVALID_BET', message: 'Invalid bet amount' }));
                    return;
                }

                const betError = validateBetAmount(betUsd);
                if (betError) {
                    player.ws.send(JSON.stringify({ type: 'entryError', code: 'INVALID_BET', message: betError }));
                    return;
                }

                const serverId = message.serverId || player.serverId || 'us-1';
                const serverConfig = SERVER_ZONES[serverId];
                const birdType = message.birdType && isValidBirdType(message.birdType) ? message.birdType : 'yellow';
                const action = message.action === 'respawn' ? 'respawn' : 'join';

                if (!serverConfig) {
                    player.ws.send(JSON.stringify({ type: 'entryError', code: 'INVALID_SERVER', message: 'Invalid server' }));
                    return;
                }

                if (betUsd < serverConfig.minBet || betUsd > serverConfig.maxBet) {
                    player.ws.send(JSON.stringify({ type: 'entryError', code: 'BET_OUT_OF_RANGE', message: `Bet must be between ${serverConfig.minBet} and ${serverConfig.maxBet}` }));
                    return;
                }

                if (action === 'join' && player.joined) {
                    player.ws.send(JSON.stringify({ type: 'entryError', code: 'ALREADY_JOINED', message: 'Already in match' }));
                    return;
                }

                if (action === 'respawn' && player.alive) {
                    player.ws.send(JSON.stringify({ type: 'entryError', code: 'ALREADY_ALIVE', message: 'Player already alive' }));
                    return;
                }

                if (entryByPlayer.has(player.id)) {
                    player.ws.send(JSON.stringify({ type: 'entryError', code: 'ENTRY_PENDING', message: 'Entry already pending' }));
                    return;
                }

                if (!POT_WALLET_PUBKEY) {
                    player.ws.send(JSON.stringify({ type: 'entryError', code: 'SERVER_NOT_READY', message: 'Server not configured' }));
                    return;
                }

                let privyData;
                try {
                    privyData = await verifyUserAndGetWallet(message.jwt);
                } catch (err) {
                    console.error('Privy verification failed:', err);
                    player.ws.send(JSON.stringify({ type: 'entryError', code: 'AUTH_FAILED', message: 'Authentication failed' }));
                    return;
                }

                if (action === 'join') {
                    const storedUsernameRaw = await getProfileUsernameByWallet(privyData.walletAddress);
                    const storedUsername = normalizeUsername(storedUsernameRaw);
                    const msgUsername = normalizeUsername(message.username);
                    const finalUsername = isValidUsername(storedUsername) ? storedUsername : (isValidUsername(msgUsername) ? msgUsername : '');
                    if (!finalUsername) {
                        player.ws.send(JSON.stringify({
                            type: 'entryError',
                            error: 'USERNAME_REQUIRED',
                            code: 'USERNAME_REQUIRED',
                            message: 'Update your username to play!',
                        }));
                        return;
                    }
                    player.name = finalUsername;
                }

                const solPriceUsd = await getSolPriceUsd();
                const betLamports = await getBuyInLamports(betUsd);
                const feeBufferLamports = await getFeeBufferLamports();
                if (!Number.isFinite(betLamports) || betLamports <= 0) {
                    player.ws.send(JSON.stringify({ type: 'entryError', code: 'INVALID_PRICE', message: 'Unable to price bet' }));
                    return;
                }

                const entryId = crypto.randomUUID();
                const entry = {
                    entryId,
                    playerId: player.id,
                    privyUserId: privyData.privyUserId,
                    walletAddress: privyData.walletAddress,
                    betUsd,
                    betLamports,
                    usdPerSol: solPriceUsd,
                    serverId,
                    birdType,
                    action,
                    status: 'pending',
                    createdAt: Date.now(),
                    expiresAt: Date.now() + ENTRY_EXPIRY_MS,
                };

                entryRecords.set(entryId, entry);
                entryByPlayer.set(player.id, entryId);

                player.ws.send(JSON.stringify({
                    type: 'entryCreated',
                    entryId,
                    buyInLamports: betLamports,
                    feeBufferLamports,
                    potWallet: POT_WALLET_PUBKEY ? POT_WALLET_PUBKEY.toBase58() : null,
                }));
            } catch (err) {
                console.error('requestEntry error:', err);
                player.ws.send(JSON.stringify({ type: 'entryError', code: 'ENTRY_FAILED', message: 'Failed to start entry' }));
            }
            break;

        case 'confirmEntry':
            try {
                if (!message.jwt) {
                    player.ws.send(JSON.stringify({ type: 'entryError', code: 'NO_JWT', message: 'Authentication required' }));
                    return;
                }

                let privyData;
                try {
                    privyData = await verifyUserAndGetWallet(message.jwt);
                } catch (err) {
                    console.error('Privy verification failed:', err);
                    player.ws.send(JSON.stringify({ type: 'entryError', code: 'AUTH_FAILED', message: 'Authentication failed' }));
                    return;
                }

                const entryId = message.entryId;
                const entry = entryId ? entryRecords.get(entryId) : null;
                if (!entry) {
                    player.ws.send(JSON.stringify({ type: 'entryError', code: 'ENTRY_NOT_FOUND', message: 'Entry not found' }));
                    return;
                }

                if (entry.action === 'join') {
                    const storedUsernameRaw = await getProfileUsernameByWallet(privyData.walletAddress);
                    const storedUsername = normalizeUsername(storedUsernameRaw);
                    const finalUsername = isValidUsername(storedUsername) ? storedUsername : (isValidUsername(player.name) ? player.name : '');
                    if (!finalUsername) {
                        player.ws.send(JSON.stringify({
                            type: 'entryError',
                            error: 'USERNAME_REQUIRED',
                            code: 'USERNAME_REQUIRED',
                            message: 'Update your username to play!',
                        }));
                        return;
                    }
                    player.name = finalUsername;
                }

                if (entry.playerId !== player.id) {
                    if (privyData.walletAddress !== entry.walletAddress) {
                        player.ws.send(JSON.stringify({ type: 'entryError', code: 'WALLET_MISMATCH', message: 'Wallet mismatch' }));
                        return;
                    }
                    if (entry.playerId) {
                        entryByPlayer.delete(entry.playerId);
                    }
                    entry.playerId = player.id;
                    entryByPlayer.set(player.id, entryId);
                }

                if (entry.status !== 'pending') {
                    player.ws.send(JSON.stringify({ type: 'entryError', code: 'ENTRY_INVALID', message: 'Entry already processed' }));
                    return;
                }

                if (Date.now() > entry.expiresAt) {
                    entryRecords.delete(entryId);
                    entryByPlayer.delete(player.id);
                    player.ws.send(JSON.stringify({ type: 'entryError', code: 'ENTRY_EXPIRED', message: 'Entry expired' }));
                    return;
                }

                if (privyData.walletAddress !== entry.walletAddress) {
                    player.ws.send(JSON.stringify({ type: 'entryError', code: 'WALLET_MISMATCH', message: 'Wallet mismatch' }));
                    return;
                }

                const depositSig = message.depositSignature;
                const verifyResult = await verifyBetDepositSignature(depositSig, entry.walletAddress, entry.betLamports);
                if (!verifyResult.success) {
                    if (verifyResult.retryable) {
                        entry.expiresAt = Math.max(entry.expiresAt, Date.now() + 30000);
                        player.ws.send(JSON.stringify({
                            type: 'entryError',
                            code: 'BET_PENDING',
                            message: verifyResult.error || 'Bet not confirmed yet',
                            retryAfterMs: 1500,
                        }));
                        return;
                    }
                    entryRecords.delete(entryId);
                    entryByPlayer.delete(player.id);
                    player.ws.send(JSON.stringify({ type: 'entryError', code: 'BET_NOT_PAID', message: verifyResult.error || 'Bet not paid' }));
                    return;
                }

                entry.status = 'confirmed';
                entry.signature = verifyResult.signature;
                entry.confirmedAt = Date.now();

                playerPrivyMap.set(player.id, {
                    privyUserId: privyData.privyUserId,
                    walletAddress: privyData.walletAddress,
                });
                recordLoginDay(privyData.walletAddress);
                await emitAccountCreatedEvent({
                    userId: privyData.privyUserId,
                    walletAddress: privyData.walletAddress,
                    source: 'first_live_join',
                });

                player.serverId = entry.serverId;
                player.birdType = entry.birdType;
                player.respawn(entry.betUsd, entry.birdType, entry.betLamports, entry.usdPerSol);

                entry.status = 'inMatch';
                entryByPlayer.delete(player.id);
                entryRecords.delete(entryId);

                const successType = entry.action === 'respawn' ? 'respawnSuccess' : 'joinSuccess';
                player.ws.send(JSON.stringify({
                    type: successType,
                    signature: verifyResult.signature,
                    player: player.serialize(),
                }));

                if (entry.action === 'join') {
                    void emitLifecycleDiscordEvent({
                        type: 'JOIN',
                        eventId: `join:${privyData.privyUserId}:${verifyResult.signature || entry.entryId}`,
                        data: {
                            userId: privyData.privyUserId,
                            walletPubkey: privyData.walletAddress,
                            username: player.name || 'unset',
                            serverId: entry.serverId,
                            stakeUsd: entry.betUsd,
                            stakeTier: formatStakeTier(entry.betUsd),
                            amountDisplay: `$${Number(entry.betUsd || 0).toFixed(2)}`,
                            txSignature: verifyResult.signature || null,
                        },
                    });
                }

                broadcastToAll({
                    type: 'playerRespawn',
                    player: player.serialize(),
                    currentBorderMargin: getDynamicBorderMargin(),
                });
                broadcastSessionLeaderboard(true);
            } catch (err) {
                console.error('confirmEntry error:', err);
                player.ws.send(JSON.stringify({ type: 'entryError', code: 'ENTRY_FAILED', message: 'Failed to confirm entry' }));
            }
            break;
            
        case 'input':
            if (!player.joined) break;
            if (typeof message.inputSeq === 'number' && Number.isFinite(message.inputSeq)) {
                player.lastInputSeq = Math.max(0, Math.trunc(message.inputSeq));
            }
            if (typeof message.clientInputTs === 'number' && Number.isFinite(message.clientInputTs)) {
                player.lastInputClientTs = message.clientInputTs;
            }
            player.lastInputRecvAt = Date.now();
            if (typeof message.angle === 'number' && !isNaN(message.angle)) {
                player.setTargetAngle(message.angle);
            }
            if (typeof message.throttle === 'number' && !isNaN(message.throttle)) {
                player.throttle = Math.max(0, Math.min(1, message.throttle));
            }
            if (typeof message.shooting === 'boolean') {
                player.shooting = message.shooting;
            }
            if (typeof message.perf === 'boolean') {
                player.perfFire = message.perf;
            }
            if (typeof message.mobileLowFx === 'boolean') {
                player.mobileLowFx = message.mobileLowFx;
            }
            if (typeof message.boosting === 'boolean') {
                player.boosting = message.boosting;
            }
            if (typeof message.cashingOut === 'boolean') {
                if (message.cashingOut && !player.cashingOut && player.alive) {
                    player.startCashout();
                    const privyData = playerPrivyMap.get(player.id);
                    if (privyData) {
                        const amountLamports = Math.max(0, Number(player.balanceLamports || 0));
                        const amountUsd = lamportsToUsd(amountLamports, player.usdPerSol);
                        const bucket = Math.floor(Date.now() / 30000);
                        void emitLifecycleDiscordEvent({
                            type: 'CASHOUT_REQUEST',
                            eventId: `cashout_request:${privyData.privyUserId}:${player.id}:${bucket}`,
                            dedupeKey: `cashout_request:${privyData.privyUserId}:${player.id}`,
                            data: {
                                userId: privyData.privyUserId,
                                walletPubkey: privyData.walletAddress,
                                username: player.name || 'unset',
                                serverId: player.serverId || 'n/a',
                                stakeUsd: player.betUsd,
                                stakeTier: formatStakeTier(player.betUsd),
                                amountDisplay: `$${Number.isFinite(amountUsd) ? amountUsd.toFixed(2) : '0.00'} / ${(amountLamports / LAMPORTS_PER_SOL).toFixed(6)} SOL`,
                            },
                        });
                    }
                } else if (!message.cashingOut && player.cashingOut) {
                    player.stopCashout();
                }
            }
            if (MOVEMENT_DEBUG && !player.isBot) {
                if (!movementDebugPlayerId) movementDebugPlayerId = player.id;
                if (movementDebugPlayerId === player.id) {
                    const now = Date.now();
                    if (now - player.lastMoveDebugInputLogAt >= 300) {
                        player.lastMoveDebugInputLogAt = now;
                        console.info('[MOVE DBG][input]', {
                            playerId: player.id,
                            recvAt: now,
                            inputSeq: player.lastInputSeq || 0,
                            angle: Number((player.targetAngle || 0).toFixed(3)),
                            throttle: Number((player.throttle || 0).toFixed(3)),
                            boosting: player.boosting ? 1 : 0,
                            shooting: player.shooting ? 1 : 0,
                            cashingOut: player.cashingOut ? 1 : 0,
                        });
                    }
                }
            }
            break;
            
        case 'respawn':
            player.ws.send(JSON.stringify({ type: 'error', code: 'RESPAWN_FLOW_MOVED', message: 'Use requestEntry/confirmEntry' }));
            break;
            
        case 'pause':
            if (typeof message.paused === 'boolean') {
                player.paused = message.paused;
            }
            break;

        case 'deviceToken':
            if (typeof message.token === 'string') {
                risk.registerDeviceToken(player.id, message.token);
            }
            break;
    }
}

// ============================================================================
// BROADCAST HELPERS
// ============================================================================
function broadcast(message, excludeId = null) {
    const data = JSON.stringify(message);
    players.forEach((player, id) => {
        if (id !== excludeId && player.ws.readyState === WebSocket.OPEN) {
            player.ws.send(data);
        }
    });
}

function broadcastToAll(message) {
    const data = JSON.stringify(message);
    players.forEach((player) => {
        if (player.ws.readyState === WebSocket.OPEN) {
            player.ws.send(data);
        }
    });
}

function broadcastToAllGameplay(message, options = {}) {
    const { skipMobileLowFx = false } = options;
    const data = JSON.stringify(message);
    players.forEach((player) => {
        if (player.ws.readyState !== WebSocket.OPEN) return;
        if (skipMobileLowFx && player.mobileLowFx) return;
        player.ws.send(data);
    });
}

function getSessionLeaderboardRows() {
    const rows = [];
    players.forEach((player) => {
        if (!player || !player.joined) return;
        const username = String(player.name || '').trim();
        if (!username) return;
        const balanceUsd = Number(lamportsToUsd(player.balanceLamports || 0, player.usdPerSol) || 0);
        rows.push({
            id: player.id,
            username,
            balance: Number.isFinite(balanceUsd) ? balanceUsd : 0,
            joinSeq: player.joinSeq || 0,
        });
    });
    rows.sort((a, b) => {
        const diff = (b.balance || 0) - (a.balance || 0);
        if (Math.abs(diff) > 1e-9) return diff;
        if ((a.joinSeq || 0) !== (b.joinSeq || 0)) return (a.joinSeq || 0) - (b.joinSeq || 0);
        return String(a.id || '').localeCompare(String(b.id || ''));
    });
    return rows.map(({ id, username, balance }) => ({ id, username, balance }));
}

function broadcastSessionLeaderboard(force = false) {
    const now = Date.now();
    const MIN_INTERVAL_MS = 100; // 10Hz max
    if (!force && now - lastSessionLeaderboardBroadcastAt < MIN_INTERVAL_MS) return;
    const rows = getSessionLeaderboardRows();
    const sig = rows.map((row) => `${row.id}|${row.username}|${Math.round(Number(row.balance || 0) * 100)}`).join(',');
    if (!force && sig === lastSessionLeaderboardSig) return;
    lastSessionLeaderboardSig = sig;
    lastSessionLeaderboardBroadcastAt = now;
    broadcastToAll({
        type: 'leaderboard_update',
        ts: now,
        rows,
    });
}

// ============================================================================
// GAME LOOP (with async payout handling)
// ============================================================================
let lastTick = Date.now();
let lastStateBroadcastAt = 0;
let payoutBackoffUntil = 0;
let tickInProgress = false;
let botModeLogged = false;

async function gameLoop() {
    if (tickInProgress) {
        if (PERF_METRICS_ENABLED) {
            serverPerf.skippedTicks += 1;
        }
        return;
    }
    const loopStartAt = Date.now();
    tickInProgress = true;
    try {
    if (!botModeLogged) {
        botModeLogged = true;
        const activeBotCount = Array.from(players.values()).filter((p) => p.isBot).length;
        console.log('[bots] mode', { botsEnabled: !DISABLE_BOTS, botCount: activeBotCount });
    }
    const now = Date.now();
    const deltaTime = now - lastTick;
    lastTick = now;
    if (PERF_METRICS_ENABLED) {
        perfPush(serverPerf.tickIntervalsMs, deltaTime);
        serverPerf.tickCount += 1;
        if (deltaTime > 32) serverPerf.longTicks32 += 1;
        if (deltaTime > 50) serverPerf.longTicks50 += 1;
    }

    orbs.forEach((orb) => orb.update(deltaTime));

    // Anti-collusion proximity scan (internally rate-limited to every 2 s)
    risk.tickProximityScanner(now);

    // Update bot AI (movement, targeting, shooting)
    updateBotAI(deltaTime);

    // Process players - collect cashout completions
    const cashoutQueue = [];
    
    players.forEach((player) => {
        const result = player.update(deltaTime);
        
        if (result === 'cashout_complete') {
            const verdict = risk.cashoutGate(player);
            if (verdict.action === 'allow') {
                const cashoutLamports = player.cashout();
                if (cashoutLamports > 0) {
                    cashoutQueue.push(player);
                }
            } else if (verdict.action === 'delay') {
                // Extend cashout timer by verdict.delayMs (player sees "verifying")
                player.cashoutStartTime = Date.now() - CONFIG.CASHOUT_TIME + verdict.delayMs;
                try { player.ws.send(JSON.stringify({ type: 'cashoutStatus', stage: 'verifying', message: 'Verifying transaction...' })); } catch (_) {}
            } else if (verdict.action === 'soft_hold') {
                player.stopCashout();
                try { player.ws.send(JSON.stringify({ type: 'cashoutStatus', stage: 'review', message: 'Your cashout is under review. Funds are safe.' })); } catch (_) {}
            }
        }
        
        if (player.joined && !player.isBot && player.shooting && player.alive) {
            const shotStart = performance.now();
            const shot = player.getShotOriginAndAngle();
            if (!shot) return;
            risk.recordShot(player.id, player.angle);
            const { mouthX, mouthY, bulletAngle } = shot;
            broadcast({
                type: 'player_shot',
                shooterId: player.id,
                worldX: mouthX,
                worldY: mouthY,
                timestamp: Date.now(),
            }, player.id);
            const endX = mouthX + Math.cos(bulletAngle) * CONFIG.BULLET_RANGE;
            const endY = mouthY + Math.sin(bulletAngle) * CONFIG.BULLET_RANGE;

            const blocked = shotBlockedByPipe(mouthX, mouthY, endX, endY, CONFIG.BULLET_SIZE);
            if (!blocked) {
                let nearestTarget = null;
                let nearestT = Infinity;
                let damageMs = 0;
                players.forEach((target) => {
                    if (!target.alive || target.id === player.id) return;
                    const damageStart = performance.now();
                    const hit = pointSegmentDistanceSq(target.x, target.y, mouthX, mouthY, endX, endY);
                    damageMs += performance.now() - damageStart;
                    if (hit.distSq <= CONFIG.PLAYER_SIZE * CONFIG.PLAYER_SIZE && hit.t < nearestT) {
                        nearestT = hit.t;
                        nearestTarget = target;
                    }
                });
                if (nearestTarget) {
                    const hitDist = Math.sqrt((player.x - nearestTarget.x) ** 2 + (player.y - nearestTarget.y) ** 2);
                    nearestTarget.takeDamage(CONFIG.BULLET_DAMAGE, player.id);
                    risk.recordHit(player.id, nearestTarget.id, hitDist);
                    broadcastToAll({
                        type: 'playerHit',
                        playerId: nearestTarget.id,
                        health: nearestTarget.health,
                        attackerId: player.id,
                        perf: { t_damageCheck: Number(damageMs.toFixed(3)) },
                    });
                }
            }
            if (player.perfFire) {
                console.info('[perf] server-shot-hitscan', {
                    shooterId: player.id,
                    players_count: players.size,
                    blocked,
                    t_totalShotCost: Number((performance.now() - shotStart).toFixed(3)),
                });
            }
        }
    });
    
    // Process cashouts (async payouts)
    const allowPayouts = now >= payoutBackoffUntil;
    const payoutCandidates = new Set();
    for (const player of cashoutQueue) {
        payoutCandidates.add(player);
    }
    players.forEach((player) => {
        if (player.payoutPendingLamports > 0 && now >= player.payoutNextAttemptAt) {
            payoutCandidates.add(player);
        }
    });

    if (allowPayouts) for (const player of payoutCandidates) {
        if (player.settled) continue;
        if (player.payoutPendingLamports > 0 && now < player.payoutNextAttemptAt) {
            logDebug(`Skipping payout retry for ${player.id}; next attempt in ${player.payoutNextAttemptAt - now}ms`);
            continue;
        }
        if (player.payoutInFlight) {
            logDebug(`Skipping payout for ${player.id}; payout already in flight`);
            continue;
        }
        const amountLamports = player.payoutPendingLamports > 0
            ? player.payoutPendingLamports
            : player.cashout();
        const privyData = playerPrivyMap.get(player.id);
        if (amountLamports <= 0) {
            player.settled = true;
            continue;
        }
        
        const amountUsd = lamportsToUsd(amountLamports, player.usdPerSol);
        if (privyData && amountLamports > 0) {
            logInfo(`Cashout stage=checking player=${player.id} lamports=${amountLamports}`);
            player.payoutInFlight = true;
            player.ws.send(JSON.stringify({
                type: 'cashoutStatus',
                stage: 'checking',
                amountLamports,
                amountUsd,
            }));
            let payoutResult;
            try {
                payoutResult = await payoutWinnerLamports(
                    privyData.walletAddress,
                    amountLamports,
                    (signature) => {
                        logInfo(`Cashout stage=processing player=${player.id} sig=${signature}`);
                        player.ws.send(JSON.stringify({
                            type: 'cashoutStatus',
                            stage: 'processing',
                            signature,
                            amountLamports,
                            amountUsd,
                        }));
                    }
                );
            } finally {
                player.payoutInFlight = false;
            }

            if (!payoutResult) {
                console.error(`[PAYOUT] Failed for player ${player.id}: no payout result`);
                player.payoutPendingLamports = amountLamports;
                player.payoutNextAttemptAt = Date.now() + PAYOUT_BACKOFF_MS;
                payoutBackoffUntil = Math.max(payoutBackoffUntil, Date.now() + PAYOUT_BACKOFF_MS);
                player.ws.send(JSON.stringify({
                    type: 'cashoutStatus',
                    stage: 'processing',
                    message: 'Payout failed, retrying...',
                    amountLamports,
                    amountUsd,
                }));
            } else if (payoutResult.success) {
                const paidLamports = payoutResult.paidLamports ?? amountLamports;
                const paidUsd = lamportsToUsd(paidLamports, player.usdPerSol);
                player.balanceLamports = 0;
                player.payoutPendingLamports = 0;
                player.payoutNextAttemptAt = 0;
                player.settled = true;
                player.status = 'cashed_out';
                logInfo(`[PAYOUT] Success: ${paidLamports} lamports to ${privyData.walletAddress} (sig=${payoutResult.signature})`);
                player.ws.send(JSON.stringify({
                    type: 'cashoutSuccess',
                    amountLamports: paidLamports,
                    amountUsd: paidUsd,
                    signature: payoutResult.signature,
                }));
                void emitLifecycleDiscordEvent({
                    type: 'CASHOUT_SUCCESS',
                    eventId: `cashout_success:${payoutResult.signature || `${privyData.privyUserId}:${Date.now()}`}`,
                    persist: true,
                    data: {
                        userId: privyData.privyUserId,
                        walletPubkey: privyData.walletAddress,
                        username: player.name || 'unset',
                        serverId: player.serverId || 'n/a',
                        stakeUsd: player.betUsd,
                        stakeTier: formatStakeTier(player.betUsd),
                        amountDisplay: `$${Number.isFinite(paidUsd) ? paidUsd.toFixed(2) : '0.00'} / ${(paidLamports / LAMPORTS_PER_SOL).toFixed(6)} SOL`,
                        txSignature: payoutResult.signature || null,
                    },
                });
            } else {
                console.error(`[PAYOUT] Failed for player ${player.id}: ${amountLamports} lamports to ${privyData.walletAddress} - ${payoutResult.error}`);
                player.payoutPendingLamports = amountLamports;
                const retryDelay = Number.isFinite(payoutResult.retryAfterMs) ? payoutResult.retryAfterMs : 5000;
                player.payoutNextAttemptAt = Date.now() + retryDelay;
                if (Number.isFinite(payoutResult.retryAfterMs)) {
                    payoutBackoffUntil = Math.max(payoutBackoffUntil, Date.now() + payoutResult.retryAfterMs);
                }
                if (Number.isFinite(payoutResult.retryAfterMs)) {
                    logInfo(`Payout rate-limited; retrying in ${retryDelay}ms`);
                    player.ws.send(JSON.stringify({
                        type: 'cashoutStatus',
                        stage: 'processing',
                        message: 'RPC rate limited, retrying...',
                        amountLamports,
                        amountUsd,
                    }));
                } else {
                    player.ws.send(JSON.stringify({
                        type: 'cashoutFailed',
                        amountLamports,
                        amountUsd,
                        error: payoutResult.error || 'Payout pending - contact support',
                    }));
                    void emitLifecycleDiscordEvent({
                        type: 'CASHOUT_FAILED',
                        eventId: `cashout_failed:${privyData.privyUserId}:${player.id}:${Math.floor(Date.now() / 30000)}`,
                        dedupeKey: `cashout_failed:${privyData.privyUserId}:${player.id}`,
                        data: {
                            userId: privyData.privyUserId,
                            walletPubkey: privyData.walletAddress,
                            username: player.name || 'unset',
                            serverId: player.serverId || 'n/a',
                            stakeUsd: player.betUsd,
                            stakeTier: formatStakeTier(player.betUsd),
                            amountDisplay: `$${Number.isFinite(amountUsd) ? amountUsd.toFixed(2) : '0.00'} / ${(amountLamports / LAMPORTS_PER_SOL).toFixed(6)} SOL`,
                            error: payoutResult.error || 'Payout pending - contact support',
                        },
                    });
                }
            }
        } else {
            player.payoutPendingLamports = 0;
            player.payoutNextAttemptAt = 0;
            player.settled = true;
            player.status = 'cashed_out';
            player.ws.send(JSON.stringify({
                type: 'cashoutSuccess',
                amountLamports,
                amountUsd,
            }));
        }
    }
    
    // Process bullets
    const deadBullets = [];
    bullets.forEach((bullet, id) => {
        bullet.update();
        if (!bullet.alive) { deadBullets.push(id); return; }
        
        players.forEach((player) => {
            if (!player.alive || player.id === bullet.ownerId) return;
            const damageCheckStart = performance.now();
            const hit = circleCollision(bullet.x, bullet.y, CONFIG.BULLET_SIZE, player.x, player.y, CONFIG.PLAYER_SIZE);
            const tDamageCheck = performance.now() - damageCheckStart;
            if (hit) {
                bullet.alive = false;
                deadBullets.push(id);
                player.takeDamage(CONFIG.BULLET_DAMAGE, bullet.ownerId);
                broadcastToAll({
                    type: 'playerHit',
                    playerId: player.id,
                    health: player.health,
                    attackerId: bullet.ownerId,
                    perf: { t_damageCheck: Number(tDamageCheck.toFixed(3)) },
                });
            }
        });
    });
    
    deadBullets.forEach(id => bullets.delete(id));
    if (deadBullets.length > 0) {
        broadcastToAllGameplay({ type: 'bulletsRemove', bulletIds: deadBullets }, { skipMobileLowFx: true });
    }
    
    // State update (match known-good path: every server tick)
    const broadcastInterval = lastStateBroadcastAt > 0 ? (now - lastStateBroadcastAt) : 0;
    lastStateBroadcastAt = now;
    if (PERF_METRICS_ENABLED && broadcastInterval > 0) {
        perfPush(serverPerf.stateBroadcastIntervalsMs, broadcastInterval);
    }
    const statePayload = {
        type: 'state',
        players: Array.from(players.values()).filter(p => p.joined).map(p => p.serialize()),
        orbs: Array.from(orbs.values()).map(o => o.serialize()),
        currentBorderMargin: getDynamicBorderMargin(),
        timestamp: now,
    };
    if (PERF_METRICS_ENABLED) {
        const stateData = JSON.stringify(statePayload);
        const sendStart = Date.now();
        let sent = 0;
        players.forEach((player) => {
            if (player.ws.readyState === WebSocket.OPEN) {
                player.ws.send(stateData);
                sent += 1;
            }
        });
        perfPush(serverPerf.stateBroadcastBytes, stateData.length);
        perfPush(serverPerf.stateBroadcastSendMs, Date.now() - sendStart);
        serverPerf.clients = sent;
        serverPerf.entities = {
            players: statePayload.players.length,
            bullets: bullets.size,
            orbs: statePayload.orbs.length,
        };
    } else {
        broadcastToAll(statePayload);
    }
    broadcastSessionLeaderboard(false);
    } finally {
        if (PERF_METRICS_ENABLED) {
            perfPush(serverPerf.loopDurationsMs, Date.now() - loopStartAt);
            serverPerf.lastUpdatedAt = Date.now();
        }
        tickInProgress = false;
    }
}

// Use setInterval but handle async properly
setInterval(() => {
    gameLoop().catch(err => console.error('Game loop error:', err));
}, 1000 / CONFIG.TICK_RATE);

// ============================================================================
// START SERVER
// ============================================================================
server.listen(CONFIG.PORT, () => {
    console.log(`
+-------------------------------------------------------+
|                    FLAPPY.ONE                         |
|                                                       |
|   Server running on http://localhost:${CONFIG.PORT}   |
|                                                       |
|   Privy: ${process.env.PRIVY_APP_ID ? 'Configured' : 'NOT CONFIGURED'}                              |
|   Solana RPC: ${process.env.SOLANA_RPC_URL ? 'Configured' : 'NOT CONFIGURED'}                        |
|                                                       |
+-------------------------------------------------------+
    `);

    // Spawn test bots after server starts
    spawnTestBots();
});
process.on('SIGINT', () => {
    console.log('\nShutting down...');
    persistUsedBetSigs();
    process.exit(0);
});
process.on('SIGTERM', () => {
    persistUsedBetSigs();
    process.exit(0);
});
