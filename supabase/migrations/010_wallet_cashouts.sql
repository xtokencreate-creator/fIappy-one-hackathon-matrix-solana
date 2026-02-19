CREATE TABLE IF NOT EXISTS wallet_cashouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    idempotency_key TEXT NULL,
    source_pubkey TEXT NOT NULL,
    destination_pubkey TEXT NOT NULL,
    amount_usd NUMERIC(18, 6) NOT NULL,
    amount_sol NUMERIC(18, 9) NOT NULL,
    amount_lamports BIGINT NOT NULL,
    sol_price_usd NUMERIC(18, 6) NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'success', 'failed')),
    tx_signature TEXT NULL,
    error_message TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT wallet_cashouts_amount_positive CHECK (amount_usd > 0 AND amount_sol > 0 AND amount_lamports > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS wallet_cashouts_user_idempotency_idx
    ON wallet_cashouts (user_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS wallet_cashouts_user_status_created_idx
    ON wallet_cashouts (user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS wallet_cashouts_created_idx
    ON wallet_cashouts (created_at DESC);

CREATE INDEX IF NOT EXISTS wallet_cashouts_tx_signature_idx
    ON wallet_cashouts (tx_signature)
    WHERE tx_signature IS NOT NULL;

CREATE OR REPLACE FUNCTION set_wallet_cashouts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS wallet_cashouts_set_updated_at ON wallet_cashouts;
CREATE TRIGGER wallet_cashouts_set_updated_at
BEFORE UPDATE ON wallet_cashouts
FOR EACH ROW
EXECUTE FUNCTION set_wallet_cashouts_updated_at();
