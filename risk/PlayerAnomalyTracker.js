'use strict';

const CFG = require('./config');

const playerAnomaly = new Map();   // playerId -> AnomalyRecord

// ── Ring buffer helpers ────────────────────────────────────────────────

function ringPush(arr, idx, maxLen, value) {
    arr[idx % maxLen] = value;
    return (idx + 1) % maxLen;
}

function ringValues(arr, idx, maxLen) {
    // Return filled portion in chronological order
    const filled = arr.filter(v => v !== undefined);
    return filled;
}

// ── AnomalyRecord factory ──────────────────────────────────────────────

function createRecord(playerId) {
    return {
        playerId,

        // Fire rate ring buffer
        shotTimestamps: new Array(CFG.SHOT_BUFFER_SIZE),
        shotIdx: 0,
        shotCount: 0,

        // Hit tracking
        shotsTotal: 0,
        hitsTotal: 0,
        hitDistances: new Array(CFG.HIT_DIST_BUFFER),
        hitDistIdx: 0,

        // Aim stability ring buffer
        angleHistory: new Array(CFG.ANGLE_BUFFER_SIZE),
        angleIdx: 0,

        // Computed scores
        fireRateAnomaly: 0,
        hitRatioAnomaly: 0,
        aimStabilityAnomaly: 0,
        playerRiskScore: 0,
        flags: [],
        lastScoredAt: 0,

        // Device token hash
        deviceTokenHash: null,
    };
}

function getOrCreate(playerId) {
    let rec = playerAnomaly.get(playerId);
    if (!rec) {
        rec = createRecord(playerId);
        playerAnomaly.set(playerId, rec);
    }
    return rec;
}

// ── Event recorders ────────────────────────────────────────────────────

function recordShot(playerId, angle) {
    const rec = getOrCreate(playerId);
    const now = Date.now();
    rec.shotIdx = ringPush(rec.shotTimestamps, rec.shotIdx, CFG.SHOT_BUFFER_SIZE, now);
    rec.shotCount = Math.min(rec.shotCount + 1, CFG.SHOT_BUFFER_SIZE);
    rec.shotsTotal += 1;

    rec.angleIdx = ringPush(rec.angleHistory, rec.angleIdx, CFG.ANGLE_BUFFER_SIZE, angle);
}

function recordHit(attackerId, victimId, distance) {
    const rec = getOrCreate(attackerId);
    rec.hitsTotal += 1;
    rec.hitDistIdx = ringPush(rec.hitDistances, rec.hitDistIdx, CFG.HIT_DIST_BUFFER, distance);
}

function setDeviceTokenHash(playerId, hash) {
    const rec = getOrCreate(playerId);
    rec.deviceTokenHash = hash;
}

// ── Scoring ────────────────────────────────────────────────────────────

function computeMedianInterShotMs(rec) {
    const timestamps = ringValues(rec.shotTimestamps, rec.shotIdx, CFG.SHOT_BUFFER_SIZE);
    if (timestamps.length < 3) return Infinity;

    // Sort ascending
    const sorted = [...timestamps].sort((a, b) => a - b);
    const intervals = [];
    for (let i = 1; i < sorted.length; i++) {
        intervals.push(sorted[i] - sorted[i - 1]);
    }
    if (intervals.length === 0) return Infinity;

    intervals.sort((a, b) => a - b);
    return intervals[Math.floor(intervals.length / 2)];
}

function computeAvgHitDistance(rec) {
    const dists = ringValues(rec.hitDistances, rec.hitDistIdx, CFG.HIT_DIST_BUFFER);
    if (dists.length === 0) return 0;
    return dists.reduce((s, d) => s + d, 0) / dists.length;
}

function computeAngleStdDev(rec) {
    const angles = ringValues(rec.angleHistory, rec.angleIdx, CFG.ANGLE_BUFFER_SIZE);
    if (angles.length < 5) return Infinity; // not enough data -> not suspicious

    const mean = angles.reduce((s, a) => s + a, 0) / angles.length;
    const variance = angles.reduce((s, a) => s + (a - mean) ** 2, 0) / angles.length;
    return Math.sqrt(variance);
}

function scorePlayer(playerId) {
    const rec = getOrCreate(playerId);
    const now = Date.now();
    const W = CFG.PLAYER_WEIGHTS;
    const T = CFG.THRESHOLDS;

    // 1. Fire rate anomaly: how close to theoretical minimum cooldown
    const medianMs = computeMedianInterShotMs(rec);
    if (medianMs < T.FIRE_RATE_SUSPECT_MS && rec.shotCount >= 10) {
        // Closer to cooldown = higher anomaly (120 ms cooldown, 125 ms threshold)
        rec.fireRateAnomaly = Math.min(1, (T.FIRE_RATE_SUSPECT_MS - medianMs) / (T.FIRE_RATE_SUSPECT_MS - 100));
    } else {
        rec.fireRateAnomaly = 0;
    }

    // 2. Hit ratio anomaly: adjusted for distance
    const avgHitDist = computeAvgHitDistance(rec);
    if (rec.shotsTotal >= 20) {
        const hitRatio = rec.hitsTotal / rec.shotsTotal;
        if (hitRatio > T.HIT_RATIO_SUSPECT && avgHitDist > T.HIT_RATIO_DIST_FLOOR) {
            // Higher ratio at longer distance = more suspicious
            const distFactor = Math.min(1, avgHitDist / 600);
            rec.hitRatioAnomaly = Math.min(1, (hitRatio - T.HIT_RATIO_SUSPECT) / (1 - T.HIT_RATIO_SUSPECT) * (0.5 + 0.5 * distFactor));
        } else {
            rec.hitRatioAnomaly = 0;
        }
    } else {
        rec.hitRatioAnomaly = 0;
    }

    // 3. Aim stability: suspiciously low variance
    const stdDev = computeAngleStdDev(rec);
    if (stdDev < T.AIM_VARIANCE_SUSPECT && stdDev !== Infinity) {
        rec.aimStabilityAnomaly = Math.min(1, (T.AIM_VARIANCE_SUSPECT - stdDev) / T.AIM_VARIANCE_SUSPECT);
    } else {
        rec.aimStabilityAnomaly = 0;
    }

    // Weighted combination
    const raw = (
        rec.fireRateAnomaly     * W.FIRE_RATE +
        rec.hitRatioAnomaly     * W.HIT_RATIO +
        rec.aimStabilityAnomaly * W.AIM_STABILITY
    );
    rec.playerRiskScore = Math.max(0, Math.min(1, raw));

    // Flags
    rec.flags = [];
    if (rec.fireRateAnomaly > 0.3) rec.flags.push('FIRE_RATE_ANOMALY');
    if (rec.hitRatioAnomaly > 0.3) rec.flags.push('HIT_RATIO_ANOMALY');
    if (rec.aimStabilityAnomaly > 0.3) rec.flags.push('AIM_STABILITY_ANOMALY');

    rec.lastScoredAt = now;
    return { playerRiskScore: rec.playerRiskScore, flags: rec.flags };
}

// ── Queries ────────────────────────────────────────────────────────────

function getScore(playerId) {
    const rec = playerAnomaly.get(playerId);
    if (!rec) return 0;
    return rec.playerRiskScore;
}

function getRecord(playerId) {
    return playerAnomaly.get(playerId) || null;
}

function getFlaggedPlayers(threshold) {
    const results = [];
    playerAnomaly.forEach((rec) => {
        if (rec.playerRiskScore >= threshold) results.push(rec);
    });
    return results;
}

// ── Feature extraction for RiskEngine ──────────────────────────────────

function extractPlayerFeatures(playerId) {
    const rec = getOrCreate(playerId);
    return {
        fireRateAnomaly: rec.fireRateAnomaly,
        hitRatioAnomaly: rec.hitRatioAnomaly,
        aimStabilityAnomaly: rec.aimStabilityAnomaly,
        shotsTotal: rec.shotsTotal,
        hitsTotal: rec.hitsTotal,
        medianInterShotMs: computeMedianInterShotMs(rec),
        avgHitDistance: computeAvgHitDistance(rec),
        aimAngleStdDev: computeAngleStdDev(rec),
    };
}

// ── Cleanup ────────────────────────────────────────────────────────────

function onPlayerDisconnect(playerId) {
    // Keep record for a while (might be needed for cashout of counterparty)
    // Will be garbage collected when Map entry is no longer referenced
    // For now just leave it -- memory is negligible per player
}

function removePlayer(playerId) {
    playerAnomaly.delete(playerId);
}

module.exports = {
    recordShot,
    recordHit,
    setDeviceTokenHash,
    scorePlayer,
    getScore,
    getRecord,
    getFlaggedPlayers,
    extractPlayerFeatures,
    onPlayerDisconnect,
    removePlayer,
};
