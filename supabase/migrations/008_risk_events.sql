-- Anti-collusion and anomaly detection persistence layer.
-- In-memory state is authoritative; these tables are for audit trail
-- and cross-session tracking (24h encounter counts).

-- Risk events log (audit trail for cashout holds, detected collusion, etc.)
CREATE TABLE IF NOT EXISTS risk_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type TEXT NOT NULL,           -- 'cashout_delayed', 'cashout_held', 'collusion_detected', 'anomaly_flagged'
    player_id TEXT,
    wallet_address TEXT,
    partner_wallet_address TEXT,        -- for pair events
    pair_risk_score NUMERIC(5,4),
    player_risk_score NUMERIC(5,4),
    reason_codes TEXT[],                -- PostgreSQL array: e.g. {'NON_AGGRESSION','FARM_LOOP'}
    metadata JSONB,                     -- arbitrary extra data (feature values, verdict details)
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_risk_events_wallet
    ON risk_events (wallet_address, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_risk_events_type
    ON risk_events (event_type, created_at DESC);


-- Wallet pair encounter tracking (survives server restarts)
-- Stores rolling proximity data per wallet pair for 24h cross-session tracking.
CREATE TABLE IF NOT EXISTS wallet_pair_encounters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_a TEXT NOT NULL,             -- canonical ordering: wallet_a < wallet_b
    wallet_b TEXT NOT NULL,
    encounter_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    proximity_duration_ms INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT wallet_pair_order CHECK (wallet_a < wallet_b)
);

CREATE INDEX IF NOT EXISTS idx_wallet_pair_encounters_pair
    ON wallet_pair_encounters (wallet_a, wallet_b, encounter_at DESC);


-- Device token hashes (for same-device / multi-wallet detection)
-- The raw device token is NEVER stored; only the HMAC-SHA256 hash.
CREATE TABLE IF NOT EXISTS device_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash TEXT NOT NULL,
    wallet_address TEXT NOT NULL,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (token_hash, wallet_address)
);

CREATE INDEX IF NOT EXISTS idx_device_tokens_hash
    ON device_tokens (token_hash);

CREATE INDEX IF NOT EXISTS idx_device_tokens_wallet
    ON device_tokens (wallet_address);


-- View: wallets sharing the same device token
CREATE OR REPLACE VIEW shared_device_wallets AS
SELECT
    token_hash,
    array_agg(DISTINCT wallet_address) AS wallets,
    count(DISTINCT wallet_address) AS wallet_count
FROM device_tokens
GROUP BY token_hash
HAVING count(DISTINCT wallet_address) > 1;
