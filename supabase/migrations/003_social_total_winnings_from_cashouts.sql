-- Ensure social profile total_winnings always reflects cashout sum.
-- Wins are already defined as count(outcome='cashed_out') in player_profile_stats.
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
    COALESCE(sa.session_winnings, 0) AS total_winnings
FROM wallets w
LEFT JOIN leaderboard lb ON lb.wallet_address = w.wallet_address
LEFT JOIN session_agg sa ON sa.wallet_address = w.wallet_address
LEFT JOIN player_login_streaks pls ON pls.wallet_address = w.wallet_address;
