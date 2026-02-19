-- Fix: player_login_streaks previously returned multiple rows per wallet_address
-- (one per streak group), causing row multiplication in player_profile_stats
-- and duplicate entries on the leaderboard.
-- This version aggregates to exactly one row per wallet_address.

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
    MAX(CASE WHEN streak_end = CURRENT_DATE THEN streak_days ELSE 0 END) AS login_streak_days
FROM streak_groups
GROUP BY wallet_address;
