-- Social overlay analytics backing tables/views.
-- This migration adds:
-- 1) Per-session tracking for gameplay/profile stats
-- 2) Login-day tracking for streak calculations
-- 3) Read-optimized views for profile and earnings chart queries

CREATE TABLE IF NOT EXISTS player_game_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_address TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ NOT NULL,
    survival_duration_ms INTEGER NOT NULL CHECK (survival_duration_ms >= 0),
    cashout_amount_usd NUMERIC(18, 6) NOT NULL DEFAULT 0,
    kills INTEGER NOT NULL DEFAULT 0 CHECK (kills >= 0),
    outcome TEXT NOT NULL CHECK (outcome IN ('died', 'cashed_out')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_player_game_sessions_wallet_started
    ON player_game_sessions (wallet_address, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_player_game_sessions_wallet_ended
    ON player_game_sessions (wallet_address, ended_at DESC);

CREATE INDEX IF NOT EXISTS idx_player_game_sessions_wallet_outcome
    ON player_game_sessions (wallet_address, outcome);

CREATE TABLE IF NOT EXISTS player_login_days (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_address TEXT NOT NULL,
    login_date DATE NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (wallet_address, login_date)
);

CREATE INDEX IF NOT EXISTS idx_player_login_days_wallet_date
    ON player_login_days (wallet_address, login_date DESC);

-- Current login streak (consecutive days ending on CURRENT_DATE).
CREATE OR REPLACE VIEW player_login_streaks AS
WITH ordered AS (
    SELECT
        wallet_address,
        login_date,
        row_number() OVER (PARTITION BY wallet_address ORDER BY login_date) AS rn
    FROM player_login_days
),
grouped AS (
    SELECT
        wallet_address,
        login_date,
        login_date - (rn * INTERVAL '1 day') AS grp_key
    FROM ordered
),
streak_groups AS (
    SELECT
        wallet_address,
        min(login_date) AS streak_start,
        max(login_date) AS streak_end,
        count(*)::INTEGER AS streak_days
    FROM grouped
    GROUP BY wallet_address, grp_key
)
SELECT
    wallet_address,
    CASE WHEN streak_end = CURRENT_DATE THEN streak_days ELSE 0 END AS login_streak_days
FROM streak_groups;

-- Profile stats view used by social profile endpoint.
-- Survival uses median (percentile_cont 0.5) because it is more stable than mean
-- under outlier rounds (very short or very long sessions).
CREATE OR REPLACE VIEW player_profile_stats AS
WITH session_agg AS (
    SELECT
        wallet_address,
        count(*)::INTEGER AS games_played,
        count(*) FILTER (WHERE outcome = 'cashed_out')::INTEGER AS games_won,
        COALESCE(
            percentile_cont(0.5) WITHIN GROUP (ORDER BY survival_duration_ms) / 1000.0,
            0
        ) AS avg_survival_seconds,
        COALESCE(sum(kills), 0)::INTEGER AS total_eliminations,
        COALESCE(avg(kills), 0) AS kills_per_game,
        COALESCE(sum(EXTRACT(EPOCH FROM (ended_at - started_at))) / 60.0, 0) AS total_play_minutes,
        COALESCE(sum(cashout_amount_usd), 0) AS session_winnings,
        min(started_at) AS first_session_at
    FROM player_game_sessions
    GROUP BY wallet_address
),
wallets AS (
    SELECT wallet_address FROM leaderboard
    UNION
    SELECT wallet_address FROM session_agg
    UNION
    SELECT wallet_address FROM player_login_days
)
SELECT
    w.wallet_address,
    COALESCE(lb.username, 'Player') AS username,
    COALESCE(lb.created_at, sa.first_session_at) AS joined_at,
    COALESCE(pls.login_streak_days, 0) AS login_streak_days,
    COALESCE(sa.games_played, 0) AS games_played,
    COALESCE(sa.games_won, 0) AS games_won,
    CASE
        WHEN COALESCE(sa.games_played, 0) = 0 THEN 0
        ELSE (sa.games_won::NUMERIC * 100.0) / sa.games_played::NUMERIC
    END AS win_rate_pct,
    COALESCE(sa.avg_survival_seconds, 0) AS avg_survival_seconds,
    COALESCE(sa.total_eliminations, 0) AS total_eliminations,
    COALESCE(sa.kills_per_game, 0) AS kills_per_game,
    COALESCE(sa.total_play_minutes, 0) AS total_play_minutes,
    COALESCE(lb.total_profit, sa.session_winnings, 0) AS total_winnings
FROM wallets w
LEFT JOIN leaderboard lb ON lb.wallet_address = w.wallet_address
LEFT JOIN session_agg sa ON sa.wallet_address = w.wallet_address
LEFT JOIN player_login_streaks pls ON pls.wallet_address = w.wallet_address;

-- Daily earnings buckets for charting.
CREATE OR REPLACE VIEW player_earnings_daily AS
SELECT
    wallet_address,
    ended_at::DATE AS bucket_date,
    COALESCE(sum(cashout_amount_usd), 0) AS total_winnings_usd
FROM player_game_sessions
GROUP BY wallet_address, ended_at::DATE;
