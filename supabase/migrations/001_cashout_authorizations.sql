-- Tracks issued cashout authorizations for replay prevention + audit trail.
-- The Edge Function inserts a row on every authorization; the game server
-- (or a reconciliation job) marks rows as 'consumed' once the on-chain
-- cashout transaction is confirmed.

CREATE TABLE IF NOT EXISTS cashout_authorizations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_pubkey TEXT NOT NULL,
    nonce       TEXT NOT NULL,              -- u64 as string (JS BigInt safety)
    max_claimable TEXT NOT NULL,            -- lamports as string
    expiry      TEXT NOT NULL,              -- unix timestamp as string
    signature   TEXT NOT NULL,              -- base64 encoded ed25519 signature
    status      TEXT NOT NULL DEFAULT 'issued',  -- issued | consumed | expired
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Prevent issuing two authorizations for the same (player, nonce) pair.
    UNIQUE (player_pubkey, nonce)
);

-- Index for rate-limiting queries (recent auths by player).
CREATE INDEX IF NOT EXISTS idx_cashout_auth_player_created
    ON cashout_authorizations (player_pubkey, created_at DESC);

-- Index for reconciliation (find issued but not yet consumed).
CREATE INDEX IF NOT EXISTS idx_cashout_auth_status
    ON cashout_authorizations (status)
    WHERE status = 'issued';
