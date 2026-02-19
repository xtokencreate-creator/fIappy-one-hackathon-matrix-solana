CREATE TABLE IF NOT EXISTS event_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id TEXT NOT NULL UNIQUE,
    event_type TEXT NOT NULL,
    user_id TEXT NULL,
    wallet_pubkey TEXT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_log_event_type_created_idx
    ON event_log (event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS event_log_user_created_idx
    ON event_log (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS event_log_wallet_created_idx
    ON event_log (wallet_pubkey, created_at DESC);
