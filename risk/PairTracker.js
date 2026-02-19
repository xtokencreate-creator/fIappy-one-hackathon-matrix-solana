'use strict';

const CFG = require('./config');

// Canonical pair key: always smaller ID first
function pairKey(a, b) { return a < b ? `${a}|${b}` : `${b}|${a}`; }

function walletPairKey(wa, wb) {
    return wa < wb ? `${wa}|${wb}` : `${wb}|${wa}`;
}

// ── In-memory stores ───────────────────────────────────────────────────
const pairState = new Map();          // pairKey -> PairRecord
const walletEncounters = new Map();   // walletPairKey -> timestamp[]

// Reference to server maps (set by init())
let _players = null;
let _playerPrivyMap = null;

function init(players, playerPrivyMap) {
    _players = players;
    _playerPrivyMap = playerPrivyMap;
}

// ── PairRecord factory ─────────────────────────────────────────────────
function createPairRecord(idA, idB) {
    const privyA = _playerPrivyMap ? _playerPrivyMap.get(idA) : null;
    const privyB = _playerPrivyMap ? _playerPrivyMap.get(idB) : null;
    return {
        playerA: idA < idB ? idA : idB,
        playerB: idA < idB ? idB : idA,
        walletA: privyA ? privyA.walletAddress : null,
        walletB: privyB ? privyB.walletAddress : null,

        // Rolling-window accumulators (120 s, exponential decay)
        proximityTicks: 0,
        windowStart: Date.now(),

        damageAtoB: 0,               // A -> B damage in window
        damageBtoA: 0,               // B -> A damage in window

        killsAtoB: 0,
        killsBtoA: 0,
        lastKillTs: 0,
        lastKillPos: null,           // { x, y } of most recent kill

        orbPickupsNearKill: 0,       // killer picked up victim's orbs within ORB_KILL_WINDOW_MS

        closeNoShotTicks: 0,         // both in range, neither shooting

        // Computed scores
        pairRiskScore: 0,
        reasonCodes: [],
        lastScoredAt: 0,
        lastActivityAt: Date.now(),
    };
}

// ── Ensure a record exists ─────────────────────────────────────────────
function getOrCreate(idA, idB) {
    const key = pairKey(idA, idB);
    let rec = pairState.get(key);
    if (!rec) {
        rec = createPairRecord(idA, idB);
        pairState.set(key, rec);
    }
    return rec;
}

// ── Window decay ───────────────────────────────────────────────────────
function decayIfNeeded(rec, now) {
    const elapsed = now - rec.windowStart;
    if (elapsed < CFG.WINDOW_DURATION_MS) return;

    const windowsPassed = Math.floor(elapsed / CFG.WINDOW_DURATION_MS);
    const factor = Math.pow(CFG.DECAY_FACTOR, windowsPassed);

    rec.proximityTicks     = Math.round(rec.proximityTicks * factor);
    rec.damageAtoB         = Math.round(rec.damageAtoB * factor);
    rec.damageBtoA         = Math.round(rec.damageBtoA * factor);
    rec.killsAtoB          = Math.round(rec.killsAtoB * factor);
    rec.killsBtoA          = Math.round(rec.killsBtoA * factor);
    rec.orbPickupsNearKill = Math.round(rec.orbPickupsNearKill * factor);
    rec.closeNoShotTicks   = Math.round(rec.closeNoShotTicks * factor);

    rec.windowStart = now;
}

// ── Event recorders (called from server hooks) ─────────────────────────

function recordProximityTick(playerA, playerB, _dist) {
    const rec = getOrCreate(playerA.id, playerB.id);
    const now = Date.now();
    decayIfNeeded(rec, now);
    rec.proximityTicks += 1;
    rec.lastActivityAt = now;

    // Non-aggression: both alive, in proximity, neither shooting
    if (!playerA.shooting && !playerB.shooting) {
        rec.closeNoShotTicks += 1;
    }

    // Track wallet-level 24 h encounters
    if (rec.walletA && rec.walletB) {
        const wk = walletPairKey(rec.walletA, rec.walletB);
        if (!walletEncounters.has(wk)) walletEncounters.set(wk, []);
        const arr = walletEncounters.get(wk);
        arr.push(now);
        // Prune older than 24 h
        const cutoff = now - 86_400_000;
        while (arr.length > 0 && arr[0] < cutoff) arr.shift();
    }
}

function recordDamage(attackerId, victimId, amount) {
    const rec = getOrCreate(attackerId, victimId);
    const now = Date.now();
    decayIfNeeded(rec, now);
    rec.lastActivityAt = now;

    if ((attackerId < victimId ? attackerId : victimId) === rec.playerA) {
        // attacker is A
        if (attackerId === rec.playerA) rec.damageAtoB += amount;
        else rec.damageBtoA += amount;
    } else {
        if (attackerId === rec.playerA) rec.damageAtoB += amount;
        else rec.damageBtoA += amount;
    }
}

function recordKill(killerId, victimId, x, y) {
    const rec = getOrCreate(killerId, victimId);
    const now = Date.now();
    decayIfNeeded(rec, now);
    rec.lastActivityAt = now;

    if (killerId === rec.playerA) rec.killsAtoB += 1;
    else rec.killsBtoA += 1;

    rec.lastKillTs = now;
    rec.lastKillPos = { x, y };
}

function recordOrbPickup(collectorId, sourcePlayerId) {
    if (!sourcePlayerId || collectorId === sourcePlayerId) return;
    const rec = getOrCreate(collectorId, sourcePlayerId);
    const now = Date.now();
    decayIfNeeded(rec, now);

    // Only count if a kill between these two happened recently
    if (rec.lastKillTs && (now - rec.lastKillTs) < CFG.ORB_KILL_WINDOW_MS) {
        rec.orbPickupsNearKill += 1;
        rec.lastActivityAt = now;
    }
}

// ── Scoring ────────────────────────────────────────────────────────────

// Expected ticks in a full window at scan interval
const EXPECTED_TICKS = Math.floor(CFG.WINDOW_DURATION_MS / CFG.SCAN_INTERVAL_MS);

function scorePair(rec) {
    const now = Date.now();
    decayIfNeeded(rec, now);

    const W = CFG.PAIR_WEIGHTS;
    const T = CFG.THRESHOLDS;

    // 1. time_in_proximity: fraction of window where pair was near
    const timeInProx = Math.min(1, rec.proximityTicks / Math.max(1, EXPECTED_TICKS));

    // 2. non_aggression: close but not fighting
    const nonAgg = rec.proximityTicks > 0
        ? rec.closeNoShotTicks / rec.proximityTicks
        : 0;

    // 3. farm_loop: repeated kill + orb pickup pattern
    const totalKills = rec.killsAtoB + rec.killsBtoA;
    const farmRaw = totalKills > 0
        ? (rec.orbPickupsNearKill / Math.max(1, totalKills)) * Math.min(1, totalKills / 3)
        : 0;
    const farmLoop = Math.min(1, farmRaw);

    // 4. repeated_encounter (24 h wallet-level)
    let encounterCount = 0;
    if (rec.walletA && rec.walletB) {
        const wk = walletPairKey(rec.walletA, rec.walletB);
        const arr = walletEncounters.get(wk);
        if (arr) encounterCount = arr.length;
    }
    const encounterNorm = Math.min(1, encounterCount / Math.max(1, T.REPEATED_ENCOUNTER * 2));

    // 5. damage_symmetry: min/max ratio (close to 1.0 = suspicious trading)
    const maxDmg = Math.max(rec.damageAtoB, rec.damageBtoA, 1);
    const minDmg = Math.min(rec.damageAtoB, rec.damageBtoA);
    const dmgSymmetry = maxDmg > 10 ? minDmg / maxDmg : 0; // only flag if meaningful damage

    // Weighted score
    const raw = (
        timeInProx    * W.PROXIMITY +
        nonAgg        * W.NON_AGGRESSION +
        farmLoop      * W.FARM_LOOP +
        encounterNorm * W.REPEATED_ENCOUNTER +
        dmgSymmetry   * W.DAMAGE_SYMMETRY
    );
    const score = Math.max(0, Math.min(1, raw));

    // Reason codes
    const reasons = [];
    if (nonAgg > T.NON_AGGRESSION) reasons.push('NON_AGGRESSION');
    if (farmLoop > T.FARM_LOOP) reasons.push('FARM_LOOP');
    if (dmgSymmetry > T.DAMAGE_SYMMETRY && maxDmg > 50) reasons.push('DAMAGE_SYMMETRY');
    if (encounterCount > T.REPEATED_ENCOUNTER) reasons.push('REPEATED_PAIR');
    if (encounterCount > T.REPEATED_ENCOUNTER && timeInProx > T.STALKING_PROXIMITY) {
        reasons.push('STALKING');
    }

    rec.pairRiskScore = score;
    rec.reasonCodes = reasons;
    rec.lastScoredAt = now;

    return { pairRiskScore: score, reasonCodes: reasons };
}

function scoreAllPairs() {
    pairState.forEach(rec => scorePair(rec));
}

// ── Queries ────────────────────────────────────────────────────────────

function getPairsForPlayer(playerId) {
    const results = [];
    pairState.forEach((rec) => {
        if (rec.playerA === playerId || rec.playerB === playerId) {
            results.push(rec);
        }
    });
    return results;
}

function getMaxPairRiskForPlayer(playerId) {
    let max = 0;
    let worstReasons = [];
    pairState.forEach((rec) => {
        if (rec.playerA === playerId || rec.playerB === playerId) {
            if (rec.pairRiskScore > max) {
                max = rec.pairRiskScore;
                worstReasons = rec.reasonCodes;
            }
        }
    });
    return { maxPairScore: max, reasons: worstReasons };
}

function getFlaggedPairs(threshold) {
    const results = [];
    pairState.forEach((rec) => {
        if (rec.pairRiskScore >= threshold) results.push(rec);
    });
    return results;
}

function getActivePairCount() {
    return pairState.size;
}

function getFarmLoopScore(collectorId, sourcePlayerId) {
    if (!sourcePlayerId || collectorId === sourcePlayerId) return 0;
    const key = pairKey(collectorId, sourcePlayerId);
    const rec = pairState.get(key);
    if (!rec) return 0;

    // Compute farm_loop feature inline (same as in scorePair)
    const totalKills = rec.killsAtoB + rec.killsBtoA;
    if (totalKills === 0) return 0;
    const farmRaw = (rec.orbPickupsNearKill / Math.max(1, totalKills)) * Math.min(1, totalKills / 3);
    return Math.min(1, farmRaw);
}

// ── Pruning ────────────────────────────────────────────────────────────

function pruneStale(now) {
    const cutoff = now - CFG.PAIR_STALE_TIMEOUT_MS;
    const toDelete = [];
    pairState.forEach((rec, key) => {
        if (rec.lastActivityAt < cutoff) toDelete.push(key);
    });
    toDelete.forEach(key => pairState.delete(key));
}

// ── Cleanup on disconnect ──────────────────────────────────────────────

function onPlayerDisconnect(playerId) {
    // Don't delete pair records immediately — they may be needed for cashout gate
    // of the remaining player. They'll be pruned by staleness timer.
}

// ── Flush encounter data to Supabase (fire-and-forget) ─────────────────

function getEncountersToFlush() {
    const rows = [];
    walletEncounters.forEach((timestamps, wk) => {
        const [walletA, walletB] = wk.split('|');
        if (timestamps.length > 0) {
            rows.push({
                wallet_a: walletA,
                wallet_b: walletB,
                encounter_count: timestamps.length,
                latest_at: new Date(timestamps[timestamps.length - 1]).toISOString(),
            });
        }
    });
    return rows;
}

// ── Feature extraction for RiskEngine ──────────────────────────────────

function extractPairFeatures(rec) {
    const now = Date.now();
    decayIfNeeded(rec, now);

    const timeInProx = Math.min(1, rec.proximityTicks / Math.max(1, EXPECTED_TICKS));
    const nonAgg = rec.proximityTicks > 0 ? rec.closeNoShotTicks / rec.proximityTicks : 0;
    const totalKills = rec.killsAtoB + rec.killsBtoA;
    const farmLoop = totalKills > 0
        ? Math.min(1, (rec.orbPickupsNearKill / Math.max(1, totalKills)) * Math.min(1, totalKills / 3))
        : 0;

    let encounterCount = 0;
    if (rec.walletA && rec.walletB) {
        const wk = walletPairKey(rec.walletA, rec.walletB);
        const arr = walletEncounters.get(wk);
        if (arr) encounterCount = arr.length;
    }

    const maxDmg = Math.max(rec.damageAtoB, rec.damageBtoA, 1);
    const minDmg = Math.min(rec.damageAtoB, rec.damageBtoA);
    const dmgSymmetry = maxDmg > 10 ? minDmg / maxDmg : 0;

    return {
        time_in_proximity: timeInProx,
        non_aggression_score: nonAgg,
        farm_loop_score: farmLoop,
        repeated_encounter_count: encounterCount,
        repeated_encounter_count_normalized: Math.min(1, encounterCount / Math.max(1, CFG.THRESHOLDS.REPEATED_ENCOUNTER * 2)),
        mutual_damage_ratio: dmgSymmetry,
        total_kills: totalKills,
        total_damage: rec.damageAtoB + rec.damageBtoA,
    };
}

module.exports = {
    init,
    pairKey,
    recordProximityTick,
    recordDamage,
    recordKill,
    recordOrbPickup,
    scorePair,
    scoreAllPairs,
    getPairsForPlayer,
    getMaxPairRiskForPlayer,
    getFlaggedPairs,
    getActivePairCount,
    getFarmLoopScore,
    pruneStale,
    onPlayerDisconnect,
    getEncountersToFlush,
    extractPairFeatures,
};
