'use strict';

const CFG = require('./config');
const PairTracker = require('./PairTracker');
const PlayerAnomalyTracker = require('./PlayerAnomalyTracker');
const ProximityScanner = require('./ProximityScanner');
const { createEngine } = require('./RiskEngineInterface');
const CashoutGate = require('./CashoutGate');
const DeviceToken = require('./DeviceToken');
const riskLogger = require('./riskLogger');

let _players = null;
let _playerPrivyMap = null;
let _orbs = null;
let _engine = null;
let _supabaseRequest = null;
let _lastFlushAt = 0;

/**
 * Initialize the risk module. Call once after the server's players / playerPrivyMap
 * maps are created.
 *
 * @param {Map} players           - server's live player map
 * @param {Map} playerPrivyMap    - playerId -> { privyUserId, walletAddress }
 * @param {Map} orbs              - server's live orb map
 * @param {Function} supabaseRequest - optional async function(path, options) for Supabase REST
 */
function init(players, playerPrivyMap, orbs, supabaseRequest) {
    _players = players;
    _playerPrivyMap = playerPrivyMap;
    _orbs = orbs;
    _supabaseRequest = supabaseRequest || null;

    PairTracker.init(players, playerPrivyMap);
    ProximityScanner.init(players);
    riskLogger.init(players);

    _engine = createEngine();
    CashoutGate.init(_engine);
    DeviceToken.init(_supabaseRequest);

    console.log('[risk] Module initialized');
}

// ── Hook: called from game loop top (internally rate-limited) ──────────

function tickProximityScanner(now) {
    ProximityScanner.tick(now);
    riskLogger.tickLog(now);

    // Periodic Supabase flush for encounter data
    if (_supabaseRequest && now - _lastFlushAt > CFG.SUPABASE_FLUSH_INTERVAL_MS) {
        _lastFlushAt = now;
        flushToSupabase();
    }
}

// ── Hook: player fires a shot ──────────────────────────────────────────

function recordShot(playerId, angle) {
    PlayerAnomalyTracker.recordShot(playerId, angle);
}

// ── Hook: hit landed ───────────────────────────────────────────────────

function recordHit(attackerId, victimId, dist) {
    PlayerAnomalyTracker.recordHit(attackerId, victimId, dist);
    PairTracker.recordDamage(attackerId, victimId, 10); // CONFIG.BULLET_DAMAGE
}

// ── Hook: kill event ───────────────────────────────────────────────────

function recordKill(killerId, victimId, x, y) {
    PairTracker.recordKill(killerId, victimId, x, y);
}

// ── Hook: orb pickup ───────────────────────────────────────────────────

function recordOrbPickup(collectorId, sourcePlayerId) {
    PairTracker.recordOrbPickup(collectorId, sourcePlayerId);
}

/**
 * Get orb value multiplier based on farm-loop risk between collector and source.
 * Returns 1.0 (full value) if no farming detected, down to FARM_DIMINISH_FLOOR.
 */
function getOrbPickupMultiplier(collectorId, sourcePlayerId) {
    if (!sourcePlayerId || collectorId === sourcePlayerId) return 1.0;

    const farmScore = PairTracker.getFarmLoopScore(collectorId, sourcePlayerId);
    const T = CFG.THRESHOLDS;

    if (farmScore <= T.FARM_DIMINISH_START) return 1.0;

    // Linear reduction: at FARM_DIMINISH_START -> 1.0, at 1.0 -> FARM_DIMINISH_FLOOR
    const range = 1 - T.FARM_DIMINISH_START;
    const progress = (farmScore - T.FARM_DIMINISH_START) / range;
    const multiplier = 1.0 - progress * (1.0 - T.FARM_DIMINISH_FLOOR);
    return Math.max(T.FARM_DIMINISH_FLOOR, multiplier);
}

// ── Hook: cashout gate ─────────────────────────────────────────────────

/**
 * Evaluate whether a cashout should proceed.
 * @returns {{ action: 'allow'|'delay'|'soft_hold', delayMs?, reasons?, playerScore?, maxPairScore? }}
 */
function cashoutGate(player) {
    const verdict = CashoutGate.evaluate(player);
    riskLogger.logCashoutDecision(player.id, verdict);
    if (verdict.action !== 'allow') {
        riskLogger.logRiskEvent('cashout_' + verdict.action, player, verdict);
        persistRiskEvent('cashout_' + verdict.action, player, verdict);
    }
    return verdict;
}

// ── Hook: device token ─────────────────────────────────────────────────

function registerDeviceToken(playerId, rawToken) {
    const privyData = _playerPrivyMap ? _playerPrivyMap.get(playerId) : null;
    const wallet = privyData ? privyData.walletAddress : null;
    DeviceToken.register(playerId, rawToken, wallet);
}

// ── Hook: player disconnect ────────────────────────────────────────────

function onPlayerDisconnect(playerId) {
    PairTracker.onPlayerDisconnect(playerId);
    PlayerAnomalyTracker.onPlayerDisconnect(playerId);
}

// ── Dev dashboard data ─────────────────────────────────────────────────

function getDashboardData() {
    return riskLogger.getDashboardData();
}

// ── Supabase persistence (fire-and-forget) ─────────────────────────────

function persistRiskEvent(eventType, player, verdict) {
    if (!_supabaseRequest) return;
    const privyData = _playerPrivyMap ? _playerPrivyMap.get(player.id) : null;

    _supabaseRequest('/risk_events', {
        method: 'POST',
        body: JSON.stringify({
            event_type: eventType,
            player_id: player.id,
            wallet_address: privyData ? privyData.walletAddress : null,
            pair_risk_score: verdict.maxPairScore || null,
            player_risk_score: verdict.playerScore || null,
            reason_codes: verdict.reasons || [],
            metadata: {
                action: verdict.action,
                delayMs: verdict.delayMs || null,
            },
        }),
    }).catch(err => console.error('[risk] persist risk_event failed:', err.message));
}

function flushToSupabase() {
    if (!_supabaseRequest) return;
    const encounters = PairTracker.getEncountersToFlush();
    if (encounters.length === 0) return;

    // Batch insert encounter summaries
    for (const enc of encounters) {
        _supabaseRequest('/wallet_pair_encounters', {
            method: 'POST',
            body: JSON.stringify({
                wallet_a: enc.wallet_a,
                wallet_b: enc.wallet_b,
                proximity_duration_ms: enc.encounter_count * CFG.SCAN_INTERVAL_MS,
            }),
        }).catch(err => console.error('[risk] flush encounter failed:', err.message));
    }
}

module.exports = {
    init,
    tickProximityScanner,
    recordShot,
    recordHit,
    recordKill,
    recordOrbPickup,
    getOrbPickupMultiplier,
    cashoutGate,
    registerDeviceToken,
    onPlayerDisconnect,
    getDashboardData,
};
