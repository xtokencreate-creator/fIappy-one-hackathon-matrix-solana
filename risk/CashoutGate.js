'use strict';

const CFG = require('./config');
const PairTracker = require('./PairTracker');
const PlayerAnomalyTracker = require('./PlayerAnomalyTracker');

let _engine = null;

function init(engine) {
    _engine = engine;
}

/**
 * Evaluate whether a cashout should proceed.
 * Called synchronously from the game loop when cashout completes.
 *
 * Returns: { action: 'allow'|'delay'|'soft_hold', delayMs?, reasons?, playerScore?, maxPairScore? }
 */
function evaluate(player) {
    // Score the player (updates internal state)
    PlayerAnomalyTracker.scorePlayer(player.id);
    const playerScore = PlayerAnomalyTracker.getScore(player.id);
    const { maxPairScore, reasons } = PairTracker.getMaxPairRiskForPlayer(player.id);

    const combined = Math.max(playerScore, maxPairScore);
    const T = CFG.THRESHOLDS;

    // Fast path: if combined score is clearly safe, allow immediately
    if (combined < T.CASHOUT_ALLOW) {
        return { action: 'allow' };
    }

    // Delay tier
    if (combined < T.CASHOUT_SOFT_HOLD) {
        const delayMs = T.CASHOUT_DELAY_MIN_MS +
            Math.random() * (T.CASHOUT_DELAY_MAX_MS - T.CASHOUT_DELAY_MIN_MS);
        return {
            action: 'delay',
            delayMs: Math.round(delayMs),
            reasons,
            playerScore,
            maxPairScore,
        };
    }

    // Soft hold tier
    return {
        action: 'soft_hold',
        reasons,
        playerScore,
        maxPairScore,
    };
}

module.exports = { init, evaluate };
