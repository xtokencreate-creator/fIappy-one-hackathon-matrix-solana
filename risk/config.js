'use strict';

// All thresholds and weights for the anti-collusion / anomaly detection system.
// Tune these based on observed gameplay data.

module.exports = {
    // ── Proximity Scanner ──────────────────────────────────────────────
    SCAN_INTERVAL_MS: 2000,           // run proximity scan every 2 s
    PROXIMITY_THRESHOLD: 300,         // pixels (~12x PLAYER_SIZE) to count as "near"
    PAIR_STALE_TIMEOUT_MS: 300_000,   // prune pairs with no activity for 5 min

    // ── Rolling Window ─────────────────────────────────────────────────
    WINDOW_DURATION_MS: 120_000,      // 2-minute tumbling window
    DECAY_FACTOR: 0.5,                // halve accumulators each window

    // ── Pairwise Feature Weights (must sum to 1.0) ─────────────────────
    PAIR_WEIGHTS: {
        PROXIMITY:          0.20,
        NON_AGGRESSION:     0.25,
        FARM_LOOP:          0.25,
        REPEATED_ENCOUNTER: 0.15,
        DAMAGE_SYMMETRY:    0.15,
    },

    // ── Player Anomaly Weights (must sum to 1.0) ───────────────────────
    PLAYER_WEIGHTS: {
        FIRE_RATE:      0.35,
        HIT_RATIO:      0.35,
        AIM_STABILITY:  0.30,
    },

    // ── Reason-Code Thresholds ─────────────────────────────────────────
    THRESHOLDS: {
        // Pair flags
        NON_AGGRESSION:        0.7,   // non-aggression ratio above this
        FARM_LOOP:             0.5,   // farm-loop composite above this
        DAMAGE_SYMMETRY:       0.8,   // mutual-damage ratio above this
        REPEATED_ENCOUNTER:    10,    // raw 24 h encounter count above this
        STALKING_PROXIMITY:    0.3,   // time-in-proximity fraction for STALKING flag

        // Cashout gate
        CASHOUT_ALLOW:         0.4,   // below this -> allow
        CASHOUT_SOFT_HOLD:     0.7,   // below this -> delay, above -> soft_hold
        CASHOUT_DELAY_MIN_MS:  5000,
        CASHOUT_DELAY_MAX_MS:  15000,

        // Diminishing returns on orb pickup
        FARM_DIMINISH_START:   0.5,   // start reducing orb value at this farm_loop_score
        FARM_DIMINISH_FLOOR:   0.3,   // minimum multiplier (30 % of full value)

        // Player anomaly flags
        FIRE_RATE_SUSPECT_MS:  125,   // median inter-shot below this = suspicious
        HIT_RATIO_SUSPECT:     0.6,   // hit ratio above this (at avg dist > 200 px)
        HIT_RATIO_DIST_FLOOR:  200,   // only flag hit ratio when avg distance above this
        AIM_VARIANCE_SUSPECT:  0.02,  // radian std-dev below this = aimbot-like
    },

    // ── Ring Buffer Sizes ──────────────────────────────────────────────
    SHOT_BUFFER_SIZE:  30,
    HIT_DIST_BUFFER:   50,
    ANGLE_BUFFER_SIZE: 20,

    // ── Orb Pickup Farm Detection ──────────────────────────────────────
    ORB_KILL_WINDOW_MS: 10_000,       // orbs picked up within 10 s of kill count toward farm score

    // ── Supabase Flush ─────────────────────────────────────────────────
    SUPABASE_FLUSH_INTERVAL_MS: 30_000,

    // ── Device Token ───────────────────────────────────────────────────
    SALT_ROTATION_MS: 86_400_000,     // rotate HMAC salt every 24 h

    // ── Logging ────────────────────────────────────────────────────────
    LOG_INTERVAL_MS: 10_000,          // risk summary log every 10 s
};
