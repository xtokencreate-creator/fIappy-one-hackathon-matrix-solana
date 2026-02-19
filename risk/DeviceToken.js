'use strict';

const crypto = require('crypto');
const CFG = require('./config');
const PlayerAnomalyTracker = require('./PlayerAnomalyTracker');

// ── HMAC salt rotation ─────────────────────────────────────────────────
let currentSalt = crypto.randomBytes(32).toString('hex');
let previousSalt = null;
let saltRotatedAt = Date.now();

function rotateSaltIfNeeded() {
    const now = Date.now();
    if (now - saltRotatedAt > CFG.SALT_ROTATION_MS) {
        previousSalt = currentSalt;
        currentSalt = crypto.randomBytes(32).toString('hex');
        saltRotatedAt = now;
        console.log('[risk] Device token salt rotated');
    }
}

function hashToken(rawToken) {
    rotateSaltIfNeeded();
    return crypto.createHmac('sha256', currentSalt).update(rawToken).digest('hex');
}

// ── In-memory device → wallet mapping ──────────────────────────────────
// tokenHash -> Set<walletAddress>
const hashToWallets = new Map();

// ── Supabase helper reference (set by init) ────────────────────────────
let _supabaseRequest = null;

function init(supabaseRequest) {
    _supabaseRequest = supabaseRequest;
}

/**
 * Register a device token for a player.
 * Called when client sends { type: 'deviceToken', token }.
 * The raw token is NEVER stored — only the HMAC hash.
 */
function register(playerId, rawToken, walletAddress) {
    if (!rawToken || typeof rawToken !== 'string' || rawToken.length < 16) return;

    const hash = hashToken(rawToken);

    // Associate hash with player anomaly record
    PlayerAnomalyTracker.setDeviceTokenHash(playerId, hash);

    // Track wallet associations in-memory
    if (walletAddress) {
        if (!hashToWallets.has(hash)) hashToWallets.set(hash, new Set());
        hashToWallets.get(hash).add(walletAddress);
    }

    // Async persist to Supabase (fire-and-forget)
    if (walletAddress && _supabaseRequest) {
        _supabaseRequest('/device_tokens', {
            method: 'POST',
            headers: { 'Prefer': 'resolution=merge-duplicates' },
            body: JSON.stringify({
                token_hash: hash,
                wallet_address: walletAddress,
                last_seen_at: new Date().toISOString(),
            }),
        }).catch(err => console.error('[risk] device token persist failed:', err.message));
    }
}

/**
 * Check if a device token hash is associated with multiple wallets.
 * Returns the set of wallets sharing this device, or null.
 */
function getSharedDeviceWallets(tokenHash) {
    const wallets = hashToWallets.get(tokenHash);
    if (!wallets || wallets.size <= 1) return null;
    return [...wallets];
}

/**
 * Check if two players share a device token.
 */
function playersShareDevice(playerIdA, playerIdB) {
    const recA = PlayerAnomalyTracker.getRecord(playerIdA);
    const recB = PlayerAnomalyTracker.getRecord(playerIdB);
    if (!recA || !recB) return false;
    if (!recA.deviceTokenHash || !recB.deviceTokenHash) return false;
    return recA.deviceTokenHash === recB.deviceTokenHash;
}

module.exports = { init, register, getSharedDeviceWallets, playersShareDevice };
