'use strict';

const CFG = require('./config');

// ── Base class (abstract interface) ────────────────────────────────────

class RiskEngine {
    /** @returns {Promise<{pairRiskScore: number, reasonCodes: string[]}>} */
    async scorePair(_pairFeatures) { throw new Error('Not implemented'); }

    /** @returns {Promise<{playerRiskScore: number, flags: string[]}>} */
    async scorePlayer(_playerFeatures) { throw new Error('Not implemented'); }

    /** @returns {Promise<'allow'|'delay'|'soft_hold'>} */
    async cashoutVerdict(_playerScore, _maxPairScore) { throw new Error('Not implemented'); }
}

// ── LocalRiskEngine (ships now — simple weighted sums) ─────────────────

class LocalRiskEngine extends RiskEngine {
    async scorePair(f) {
        const W = CFG.PAIR_WEIGHTS;
        const T = CFG.THRESHOLDS;

        const raw = (
            f.time_in_proximity                * W.PROXIMITY +
            f.non_aggression_score             * W.NON_AGGRESSION +
            f.farm_loop_score                  * W.FARM_LOOP +
            f.repeated_encounter_count_normalized * W.REPEATED_ENCOUNTER +
            f.mutual_damage_ratio              * W.DAMAGE_SYMMETRY
        );
        const score = Math.max(0, Math.min(1, raw));

        const reasonCodes = [];
        if (f.non_aggression_score > T.NON_AGGRESSION) reasonCodes.push('NON_AGGRESSION');
        if (f.farm_loop_score > T.FARM_LOOP)           reasonCodes.push('FARM_LOOP');
        if (f.mutual_damage_ratio > T.DAMAGE_SYMMETRY && f.total_damage > 50) {
            reasonCodes.push('DAMAGE_SYMMETRY');
        }
        if (f.repeated_encounter_count > T.REPEATED_ENCOUNTER) reasonCodes.push('REPEATED_PAIR');
        if (f.repeated_encounter_count > T.REPEATED_ENCOUNTER && f.time_in_proximity > T.STALKING_PROXIMITY) {
            reasonCodes.push('STALKING');
        }

        return { pairRiskScore: score, reasonCodes };
    }

    async scorePlayer(f) {
        const W = CFG.PLAYER_WEIGHTS;

        const raw = (
            f.fireRateAnomaly     * W.FIRE_RATE +
            f.hitRatioAnomaly     * W.HIT_RATIO +
            f.aimStabilityAnomaly * W.AIM_STABILITY
        );
        const score = Math.max(0, Math.min(1, raw));

        const flags = [];
        if (f.fireRateAnomaly > 0.3)     flags.push('FIRE_RATE_ANOMALY');
        if (f.hitRatioAnomaly > 0.3)     flags.push('HIT_RATIO_ANOMALY');
        if (f.aimStabilityAnomaly > 0.3) flags.push('AIM_STABILITY_ANOMALY');

        return { playerRiskScore: score, flags };
    }

    async cashoutVerdict(playerScore, maxPairScore) {
        const combined = Math.max(playerScore, maxPairScore);
        if (combined < CFG.THRESHOLDS.CASHOUT_ALLOW)     return 'allow';
        if (combined < CFG.THRESHOLDS.CASHOUT_SOFT_HOLD) return 'delay';
        return 'soft_hold';
    }
}

// ── ArciumRiskEngine (on-chain MPC via Arcium MXE network) ──────────
//
// Submits pair features as encrypted ciphertexts to the Arcium MPC network
// via a Solana on-chain program. The MPC nodes compute a weighted risk score
// on the encrypted data and return the encrypted result via a callback.
//
// Env vars:
//   ARCIUM_PROGRAM_ID  — deployed Solana program ID
//   ARCIUM_KEYPAIR     — path to payer keypair JSON
//   SOLANA_RPC_URL     — RPC endpoint (default: devnet)
//
// Falls back to LocalRiskEngine when:
//   - Env vars not set (graceful degradation)
//   - Arcium client init fails
//   - Any individual computation fails or times out

const ArciumClient = require('./ArciumClient');

class ArciumRiskEngine extends RiskEngine {
    constructor(localFallback) {
        super();
        this.fallback = localFallback;
        this._initPromise = ArciumClient.init();
    }

    async scorePair(pairFeatures) {
        if (!ArciumClient.isReady()) return this.fallback.scorePair(pairFeatures);

        try {
            const result = await ArciumClient.submitPairScore(pairFeatures);
            if (!result) return this.fallback.scorePair(pairFeatures);

            // Use the on-chain MPC score, but still compute reason codes locally
            // (reason codes are threshold-based flags, no privacy concern)
            const localResult = await this.fallback.scorePair(pairFeatures);
            return {
                pairRiskScore: result.score,
                reasonCodes: localResult.reasonCodes,
                arciumTx: result.txSig,
            };
        } catch (err) {
            console.error('[risk][arcium] scorePair failed, using local fallback:', err.message);
            return this.fallback.scorePair(pairFeatures);
        }
    }

    async scorePlayer(playerFeatures) {
        // Player scoring stays local (single-player features, no privacy benefit from MPC)
        return this.fallback.scorePlayer(playerFeatures);
    }

    async cashoutVerdict(playerScore, maxPairScore) {
        // Cashout verdict uses the scores already computed (which may be from Arcium)
        return this.fallback.cashoutVerdict(playerScore, maxPairScore);
    }
}

// ── Factory ────────────────────────────────────────────────────────────

function createEngine() {
    const local = new LocalRiskEngine();
    if (process.env.ARCIUM_PROGRAM_ID) {
        console.log('[risk] Using ArciumRiskEngine with program:', process.env.ARCIUM_PROGRAM_ID);
        return new ArciumRiskEngine(local);
    }
    console.log('[risk] Using LocalRiskEngine (no ARCIUM_PROGRAM_ID set)');
    return local;
}

module.exports = { RiskEngine, LocalRiskEngine, ArciumRiskEngine, createEngine };
