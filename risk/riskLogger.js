'use strict';

const CFG = require('./config');
const PairTracker = require('./PairTracker');
const PlayerAnomalyTracker = require('./PlayerAnomalyTracker');

const LOG_ENABLED = process.env.RISK_LOG === '1' || process.env.NODE_ENV !== 'production';
let lastLogAt = 0;
let _players = null;
const startedAt = Date.now();

function init(players) {
    _players = players;
}

// Recent cashout decisions (ring buffer, last 50)
const cashoutLog = [];
const CASHOUT_LOG_MAX = 50;

function logCashoutDecision(playerId, verdict) {
    cashoutLog.push({
        playerId,
        action: verdict.action,
        playerScore: verdict.playerScore || 0,
        maxPairScore: verdict.maxPairScore || 0,
        reasons: verdict.reasons || [],
        ts: Date.now(),
    });
    if (cashoutLog.length > CASHOUT_LOG_MAX) cashoutLog.shift();
}

function logRiskEvent(eventType, player, verdict) {
    if (!LOG_ENABLED) return;
    console.log(`[RISK][${eventType}] player=${player.id} action=${verdict.action} playerScore=${(verdict.playerScore || 0).toFixed(3)} pairScore=${(verdict.maxPairScore || 0).toFixed(3)} reasons=[${(verdict.reasons || []).join(',')}]`);
}

function tickLog(now) {
    if (!LOG_ENABLED) return;
    if (now - lastLogAt < CFG.LOG_INTERVAL_MS) return;
    lastLogAt = now;

    const activePairs = PairTracker.getActivePairCount();
    const flaggedPairs = PairTracker.getFlaggedPairs(0.3);
    const flaggedPlayers = PlayerAnomalyTracker.getFlaggedPlayers(0.3);

    if (activePairs === 0 && flaggedPlayers.length === 0) return;

    console.log(`[RISK] tracking ${activePairs} pairs | ${flaggedPairs.length} flagged pairs | ${flaggedPlayers.length} flagged players`);

    for (const pair of flaggedPairs.slice(0, 5)) {
        const wa = pair.walletA ? pair.walletA.slice(0, 8) : pair.playerA;
        const wb = pair.walletB ? pair.walletB.slice(0, 8) : pair.playerB;
        console.log(`  PAIR ${wa}..${wb} score=${pair.pairRiskScore.toFixed(3)} [${pair.reasonCodes.join(',')}]`);
    }

    for (const rec of flaggedPlayers.slice(0, 5)) {
        console.log(`  PLAYER ${rec.playerId} score=${rec.playerRiskScore.toFixed(3)} fire=${rec.fireRateAnomaly.toFixed(2)} hit=${rec.hitRatioAnomaly.toFixed(2)} aim=${rec.aimStabilityAnomaly.toFixed(2)}`);
    }
}

function getActivePlayerCount() {
    if (!_players) return 0;
    let count = 0;
    _players.forEach(p => { if (p.alive && p.joined && !p.isBot) count++; });
    return count;
}

/**
 * Returns enriched JSON-serializable dashboard data.
 */
function getDashboardData() {
    // Show ALL tracked pairs (not just flagged) so the dashboard is useful even at low scores
    const allPairs = PairTracker.getFlaggedPairs(0);
    const allPlayers = PlayerAnomalyTracker.getFlaggedPlayers(0);

    return {
        timestamp: Date.now(),
        uptimeMs: Date.now() - startedAt,
        activePlayerCount: getActivePlayerCount(),
        activePairs: PairTracker.getActivePairCount(),

        engine: process.env.ARCIUM_PROGRAM_ID ? 'ArciumRiskEngine' : 'LocalRiskEngine',

        config: {
            scanIntervalMs: CFG.SCAN_INTERVAL_MS,
            proximityThreshold: CFG.PROXIMITY_THRESHOLD,
            windowDurationMs: CFG.WINDOW_DURATION_MS,
            cashoutAllow: CFG.THRESHOLDS.CASHOUT_ALLOW,
            cashoutSoftHold: CFG.THRESHOLDS.CASHOUT_SOFT_HOLD,
            farmDiminishStart: CFG.THRESHOLDS.FARM_DIMINISH_START,
        },

        pairs: allPairs
            .sort((a, b) => b.pairRiskScore - a.pairRiskScore)
            .slice(0, 50)
            .map(p => {
                const features = PairTracker.extractPairFeatures(p);
                return {
                    playerA: p.playerA,
                    playerB: p.playerB,
                    walletA: p.walletA ? p.walletA.slice(0, 8) + '...' : null,
                    walletB: p.walletB ? p.walletB.slice(0, 8) + '...' : null,
                    score: Number(p.pairRiskScore.toFixed(4)),
                    reasons: p.reasonCodes,
                    features: {
                        proximity: Number(features.time_in_proximity.toFixed(3)),
                        nonAggression: Number(features.non_aggression_score.toFixed(3)),
                        farmLoop: Number(features.farm_loop_score.toFixed(3)),
                        encounters24h: features.repeated_encounter_count,
                        dmgSymmetry: Number(features.mutual_damage_ratio.toFixed(3)),
                        totalKills: features.total_kills,
                        totalDamage: features.total_damage,
                    },
                    lastActive: p.lastActivityAt,
                };
            }),

        players: allPlayers
            .sort((a, b) => b.playerRiskScore - a.playerRiskScore)
            .slice(0, 50)
            .map(r => ({
                playerId: r.playerId,
                score: Number(r.playerRiskScore.toFixed(4)),
                fireRate: Number(r.fireRateAnomaly.toFixed(3)),
                hitRatio: Number(r.hitRatioAnomaly.toFixed(3)),
                aimStability: Number(r.aimStabilityAnomaly.toFixed(3)),
                shots: r.shotsTotal,
                hits: r.hitsTotal,
                flags: r.flags,
                deviceTokenHash: r.deviceTokenHash ? r.deviceTokenHash.slice(0, 8) + '...' : null,
            })),

        recentCashouts: cashoutLog.slice(-20).reverse(),
    };
}

module.exports = { init, logCashoutDecision, logRiskEvent, tickLog, getDashboardData };
