import React, { useEffect, useMemo, useRef, useState } from 'react';

function formatUsd(amount) {
  const value = Number.isFinite(Number(amount)) ? Number(amount) : 0;
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(dateStr) {
  if (!dateStr) return '--';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '--';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDurationMinutes(totalMinutes) {
  const mins = Math.max(0, Math.floor(Number(totalMinutes) || 0));
  const hours = Math.floor(mins / 60);
  const remainder = mins % 60;
  return `${hours}h ${remainder}m`;
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d, days) {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
}

function toDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function normalizeRows(rows) {
  const byDay = new Map();
  for (const row of rows || []) {
    const key = typeof row?.bucket_date === 'string' ? row.bucket_date.slice(0, 10) : '';
    if (!key) continue;
    const value = Number(row.total_winnings_usd) || 0;
    const amount = Number(row.amount);
    const kills = Number(row.kills);
    const playTime = Number(row.play_time);
    const prev = byDay.get(key) || {
      total: 0,
      amount: 0,
      hasAmount: false,
      result: '',
      kills: 0,
      hasKills: false,
      playTime: 0,
      hasPlayTime: false,
    };
    prev.total += value;
    if (Number.isFinite(amount)) {
      prev.amount += amount;
      prev.hasAmount = true;
    }
    if (typeof row.result === 'string' && row.result) {
      prev.result = row.result;
    }
    if (Number.isFinite(kills)) {
      prev.kills += kills;
      prev.hasKills = true;
    }
    if (Number.isFinite(playTime)) {
      prev.playTime += playTime;
      prev.hasPlayTime = true;
    }
    byDay.set(key, prev);
  }
  return byDay;
}

function buildSeries(rows, range) {
  const today = startOfDay(new Date());
  const byDay = normalizeRows(rows);
  const rangeConfig = { '1w': 7, '1m': 30, '3m': 90 };

  if (range === 'ytd') {
    const jan1 = new Date(today.getFullYear(), 0, 1);
    const weeks = [];
    let cursor = startOfDay(jan1);
    let running = 0;
    let weekValue = 0;
    let weekAmount = 0;
    let weekResult = '';
    let weekKills = 0;
    let weekHasKills = false;
    let weekPlayTime = 0;
    let weekHasPlayTime = false;
    let weekStart = cursor;

    while (cursor <= today) {
      const key = toDateKey(cursor);
      const day = byDay.get(key) || null;
      if (day) {
        weekValue += day.total;
        weekAmount += day.hasAmount ? day.amount : day.total;
        if (day.result) weekResult = day.result;
        if (day.hasKills) {
          weekKills += day.kills;
          weekHasKills = true;
        }
        if (day.hasPlayTime) {
          weekPlayTime += day.playTime;
          weekHasPlayTime = true;
        }
      }
      if (cursor.getDay() === 6 || toDateKey(cursor) === toDateKey(today)) {
        running += weekValue;
        weeks.push({
          label: toDateKey(weekStart),
          value: running,
          amount: weekAmount,
          result: weekResult || (weekAmount > 0 ? 'Win' : 'Loss'),
          kills: weekHasKills ? weekKills : null,
          play_time: weekHasPlayTime ? weekPlayTime : null,
        });
        weekValue = 0;
        weekAmount = 0;
        weekResult = '';
        weekKills = 0;
        weekHasKills = false;
        weekPlayTime = 0;
        weekHasPlayTime = false;
        weekStart = addDays(cursor, 1);
      }
      cursor = addDays(cursor, 1);
    }

    return weeks.length
      ? weeks
      : [
        { label: toDateKey(today), value: 0, amount: 0, result: 'Loss', kills: null, play_time: null },
        { label: toDateKey(today), value: 0, amount: 0, result: 'Loss', kills: null, play_time: null },
      ];
  }

  const targetDays = rangeConfig[range] || 30;
  const start = addDays(today, -(targetDays - 1));
  const points = [];
  let running = 0;

  for (let i = 0; i < targetDays; i += 1) {
    const d = addDays(start, i);
    const key = toDateKey(d);
    const day = byDay.get(key) || null;
    const dailyTotal = day?.total || 0;
    running += dailyTotal;
    const amount = day ? (day.hasAmount ? day.amount : day.total) : 0;
    points.push({
      label: key,
      value: running,
      amount,
      result: day?.result || (amount > 0 ? 'Win' : 'Loss'),
      kills: day?.hasKills ? day.kills : null,
      play_time: day?.hasPlayTime ? day.playTime : null,
    });
  }

  if (points.length === 1) {
    points.push({ ...points[0], label: points[0].label });
  }
  return points;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatAxisUsd(value) {
  return `$${Math.max(0, Math.round(Number(value) || 0)).toString()}`;
}

function formatTooltipDate(dateStr) {
  if (!dateStr) return '--';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '--';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatXAxisDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatPlayTime(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return `${Math.max(0, Math.round(n))}m`;
}

function getNiceTickStep(targetStep) {
  const value = Math.max(1, Number(targetStep) || 1);
  const pow = 10 ** Math.floor(Math.log10(value));
  const normalized = value / pow;
  let nice = 1;
  if (normalized <= 1) nice = 1;
  else if (normalized <= 2) nice = 2;
  else if (normalized <= 2.5) nice = 2.5;
  else if (normalized <= 5) nice = 5;
  else nice = 10;
  return nice * pow;
}

function EarningsChart({ rows, range }) {
  const containerRef = useRef(null);
  const tooltipRef = useRef(null);
  const touchPointerIdRef = useRef(null);
  const tooltipIndexRef = useRef(-1);
  const pointerRef = useRef({ x: 0, y: 0 });
  const [size, setSize] = useState({ width: 520, height: 150 });
  const [tooltipState, setTooltipState] = useState({ visible: false, index: 0 });
  const isDev = typeof import.meta !== 'undefined' && import.meta.env?.DEV;
  const padding = { top: 12, right: 12, bottom: 30, left: 56 };
  const hasSourceRows = Array.isArray(rows) && rows.length > 0;

  useEffect(() => {
    if (!containerRef.current) return undefined;
    const node = containerRef.current;
    const applySize = () => {
      const rect = node.getBoundingClientRect();
      const width = Math.max(220, Math.floor(rect.width || 520));
      const height = Math.max(120, Math.floor(rect.height || 150));
      setSize({ width, height });
    };
    applySize();
    const observer = new ResizeObserver(applySize);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const { points, minY, maxY, yTicks, xTickIndices } = useMemo(() => {
    if (!hasSourceRows) {
      return { points: [], minY: 0, maxY: 1, yTicks: [0, 1, 2, 3, 4, 5], xTickIndices: [] };
    }
    const series = buildSeries(rows, range);
    const innerWidth = Math.max(1, size.width - padding.left - padding.right);
    const innerHeight = Math.max(1, size.height - padding.top - padding.bottom);

    if (!series.length) return { points: [], minY: 0, maxY: 1, yTicks: [0, 1, 2, 3, 4, 5], xTickIndices: [] };

    const values = series.map((p) => Number(p.value) || 0);
    const dataMax = Math.max(0, ...values);
    const tickCount = 6;
    const targetStep = dataMax > 0 ? (dataMax / (tickCount - 1)) : 1;
    const step = getNiceTickStep(targetStep > 0 ? targetStep : 1);
    const min = 0;
    const max = Math.max(step * (tickCount - 1), 1);
    const domain = Math.max(1, max - min);
    const stepX = series.length > 1 ? innerWidth / (series.length - 1) : 0;
    const ticks = Array.from({ length: tickCount }, (_, idx) => min + idx * step);

    const mapped = series.map((entry, index) => {
      const rawX = padding.left + index * stepX;
      const ratioY = (Number(entry.value) - min) / domain;
      const rawY = padding.top + (1 - ratioY) * innerHeight;
      return {
        x: clamp(rawX, padding.left, size.width - padding.right),
        y: clamp(rawY, padding.top, size.height - padding.bottom),
        label: entry.label,
        value: Number(entry.value) || 0,
        amount: Number(entry.amount) || 0,
        result: entry.result || '',
        kills: Number.isFinite(Number(entry.kills)) ? Number(entry.kills) : null,
        play_time: Number.isFinite(Number(entry.play_time)) ? Number(entry.play_time) : null,
      };
    });

    const baseByRange = {
      '1w': 1,
      '1m': 4,
      '3m': 7,
      ytd: 7,
    };
    const spacingPerPoint = mapped.length > 1 ? innerWidth / (mapped.length - 1) : innerWidth;
    const minLabelSpacingPx = 56;
    const spacingStep = Math.max(1, Math.ceil(minLabelSpacingPx / Math.max(1, spacingPerPoint)));
    const rangeStep = baseByRange[range] || 6;
    const xStep = Math.max(rangeStep, spacingStep);
    const tickIndices = [];
    for (let i = 0; i < mapped.length; i += xStep) {
      tickIndices.push(i);
    }
    if (mapped.length > 1 && tickIndices[tickIndices.length - 1] !== mapped.length - 1) {
      tickIndices.push(mapped.length - 1);
    }

    return { points: mapped, minY: min, maxY: max, yTicks: ticks, xTickIndices: tickIndices };
  }, [hasSourceRows, rows, range, size.height, size.width]);

  useEffect(() => {
    if (!isDev) return;
    console.info('[profileChart]', {
      points: points.length,
      minY,
      maxY,
      width: size.width,
      height: size.height,
    });
  }, [isDev, maxY, minY, points.length, size.height, size.width]);

  useEffect(() => {
    if (!tooltipState.visible) return;
    const onOutsidePointerDown = (event) => {
      const node = containerRef.current;
      if (!node || node.contains(event.target)) return;
      setTooltipState((prev) => ({ ...prev, visible: false }));
      tooltipIndexRef.current = -1;
      touchPointerIdRef.current = null;
    };
    document.addEventListener('pointerdown', onOutsidePointerDown, { passive: true });
    return () => {
      document.removeEventListener('pointerdown', onOutsidePointerDown);
    };
  }, [tooltipState.visible]);

  useEffect(() => {
    setTooltipState({ visible: false, index: 0 });
    tooltipIndexRef.current = -1;
    touchPointerIdRef.current = null;
  }, [range, rows]);

  const moveTooltip = (clientX, clientY) => {
    const node = containerRef.current;
    const tip = tooltipRef.current;
    if (!node || !tip) return;
    const rect = node.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const margin = 8;
    const offset = 12;
    const tipW = tip.offsetWidth || 220;
    const tipH = tip.offsetHeight || 160;
    const maxX = Math.max(margin, rect.width - tipW - margin);
    const maxY = Math.max(margin, rect.height - tipH - margin);

    let x = localX + offset;
    let y = localY - tipH - offset;
    if (x > maxX) x = localX - tipW - offset;
    if (y < margin) y = localY + offset;
    x = clamp(x, margin, maxX);
    y = clamp(y, margin, maxY);

    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  };

  const updateFromClientPoint = (clientX, clientY) => {
    if (!points.length || !containerRef.current) return;
    pointerRef.current = { x: clientX, y: clientY };
    const rect = containerRef.current.getBoundingClientRect();
    const localX = clientX - rect.left;

    let nearestIndex = 0;
    let nearestDistance = Math.abs(localX - points[0].x);
    for (let i = 1; i < points.length; i += 1) {
      const distance = Math.abs(localX - points[i].x);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = i;
      }
    }

    if (!tooltipState.visible || tooltipIndexRef.current !== nearestIndex) {
      tooltipIndexRef.current = nearestIndex;
      setTooltipState({ visible: true, index: nearestIndex });
    }

    moveTooltip(clientX, clientY);
  };

  useEffect(() => {
    if (!tooltipState.visible) return;
    const pointer = pointerRef.current;
    const id = requestAnimationFrame(() => {
      moveTooltip(pointer.x, pointer.y);
    });
    return () => cancelAnimationFrame(id);
  }, [tooltipState.index, tooltipState.visible]);

  if (!hasSourceRows) {
    return <div className="social-empty social-empty--chart">No earnings data yet</div>;
  }

  if (!points.length) {
    return <div className="social-empty social-empty--chart">No earnings data yet</div>;
  }

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const floorY = size.height - padding.bottom;
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${floorY} L ${points[0].x} ${floorY} Z`;
  const activePoint = points[Math.min(points.length - 1, Math.max(0, tooltipState.index))];
  const gameResult = activePoint?.result ? String(activePoint.result) : (activePoint?.amount > 0 ? 'Win' : 'Loss');
  const amountValue = Number(activePoint?.amount);
  const showPositiveAmount = Number.isFinite(amountValue) && amountValue > 0;

  return (
    <div
      ref={containerRef}
      className="social-chart social-chart--interactive"
      onPointerDown={(event) => {
        if (event.pointerType !== 'mouse') {
          touchPointerIdRef.current = event.pointerId;
        }
        updateFromClientPoint(event.clientX, event.clientY);
      }}
      onPointerMove={(event) => {
        if (event.pointerType === 'mouse') {
          updateFromClientPoint(event.clientX, event.clientY);
          return;
        }
        if (touchPointerIdRef.current === event.pointerId) {
          updateFromClientPoint(event.clientX, event.clientY);
        }
      }}
      onPointerUp={(event) => {
        if (touchPointerIdRef.current === event.pointerId) {
          touchPointerIdRef.current = null;
        }
      }}
      onPointerCancel={(event) => {
        if (touchPointerIdRef.current === event.pointerId) {
          touchPointerIdRef.current = null;
        }
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === 'mouse') {
          setTooltipState((prev) => ({ ...prev, visible: false }));
          tooltipIndexRef.current = -1;
        }
      }}
    >
      <svg
        viewBox={`0 0 ${size.width} ${size.height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Earnings chart"
        style={{ width: '100%', height: '100%', display: 'block' }}
      >
        {yTicks.map((tick) => {
          const yRaw = clamp(
            padding.top + (1 - ((tick - minY) / Math.max(1, maxY - minY))) * (size.height - padding.top - padding.bottom),
            padding.top,
            size.height - padding.bottom
          );
          const y = Math.round(yRaw) + 0.5;
          return (
            <line
              key={`grid-${tick}`}
              x1={padding.left}
              y1={y}
              x2={size.width - padding.right}
              y2={y}
              stroke="rgba(167, 167, 167, 0.35)"
              strokeWidth="1"
              strokeDasharray="2 6"
            />
          );
        })}

        <path className="social-chart__area" d={areaPath} />
        <path className="social-chart__line" d={linePath} />
        {points.map((p) => (
          <circle key={`${p.x}-${p.y}`} className="social-chart__dot" cx={p.x} cy={p.y} r="3" />
        ))}

        {yTicks.map((tick) => {
          const y = clamp(
            padding.top + (1 - ((tick - minY) / Math.max(1, maxY - minY))) * (size.height - padding.top - padding.bottom),
            padding.top,
            size.height - padding.bottom
          );
          return (
            <text
              key={`ylabel-${tick}`}
              x={padding.left - 8}
              y={y}
              textAnchor="end"
              dominantBaseline="middle"
              fill="#a7a7a7"
              fontSize="11"
            >
              {formatAxisUsd(tick)}
            </text>
          );
        })}

        {xTickIndices.map((idx) => {
          const point = points[idx];
          if (!point) return null;
          const isFirst = idx === xTickIndices[0];
          const isLast = idx === xTickIndices[xTickIndices.length - 1];
          return (
            <text
              key={`xlabel-${idx}-${point.label}`}
              x={point.x}
              y={size.height - 8}
              textAnchor={isFirst ? 'start' : isLast ? 'end' : 'middle'}
              dominantBaseline="ideographic"
              fill="#a7a7a7"
              fontSize="11"
            >
              {formatXAxisDate(point.label)}
            </text>
          );
        })}
      </svg>
      <div
        ref={tooltipRef}
        className={`social-chart-tooltip ${tooltipState.visible ? 'visible' : ''}`}
        role="status"
        aria-live="polite"
      >
        <div className="social-chart-tooltip__date">{formatTooltipDate(activePoint?.label)}</div>
        <div className="social-chart-tooltip__value">${formatUsd(activePoint?.value || 0)}</div>
        <div className="social-chart-tooltip__label">Total Earnings</div>
        <div className="social-chart-tooltip__divider" />
        <div className="social-chart-tooltip__row">
          <span>Game Result</span>
          <strong>{gameResult || '--'}</strong>
        </div>
        <div className="social-chart-tooltip__row">
          <span>Amount</span>
          <strong className={showPositiveAmount ? 'social-chart-tooltip__amount-positive' : ''}>
            {Number.isFinite(amountValue) ? `$${formatUsd(amountValue)}` : '--'}
          </strong>
        </div>
        <div className="social-chart-tooltip__row">
          <span>Kills</span>
          <strong>{Number.isFinite(Number(activePoint?.kills)) ? Number(activePoint.kills) : '--'}</strong>
        </div>
        <div className="social-chart-tooltip__row">
          <span>Play Time</span>
          <strong>{formatPlayTime(activePoint?.play_time)}</strong>
        </div>
      </div>
    </div>
  );
}

export default function PlayerProfileView({ profile, earnings, range, onRangeChange, loading, error }) {
  if (loading) {
    return (
      <div className="social-profile social-list--skeleton">
        {[...Array(5)].map((_, i) => <div key={`profile-skeleton-${i}`} className="social-row social-row--skeleton" />)}
      </div>
    );
  }
  if (error) return <div className="social-empty">{error}</div>;
  if (!profile) return <div className="social-empty">Player profile unavailable.</div>;

  return (
    <div className="social-profile">
      <div className="social-header">
        <div>
          <div className="social-title">{profile.username || 'Player'}</div>
          <div className="social-subtitle">Joined {formatDate(profile.joined_at)} • {profile.login_streak_days || 0} day streak</div>
        </div>
      </div>

      <div className="social-panel-grid">
        <section className="social-panel">
          <h4>Game Performance</h4>
          <div className="social-stats-grid">
            <div><span>Win Rate</span><strong>{Number(profile.win_rate_pct || 0).toFixed(1)}%</strong></div>
            <div><span>Games Won</span><strong>{profile.games_won || 0}</strong></div>
            <div><span>Games Played</span><strong>{profile.games_played || 0}</strong></div>
            <div><span>Avg Survival</span><strong>{Number(profile.avg_survival_seconds || 0).toFixed(1)}s</strong></div>
          </div>
        </section>

        <section className="social-panel">
          <h4>Combat & Time</h4>
          <div className="social-stats-grid">
            <div><span>Total Eliminations</span><strong>{profile.total_eliminations || 0}</strong></div>
            <div><span>Kills / Game</span><strong>{Number(profile.kills_per_game || 0).toFixed(2)}</strong></div>
            <div><span>Total Play Time</span><strong>{formatDurationMinutes(profile.total_play_minutes || 0)}</strong></div>
          </div>
        </section>
      </div>

      <section className="social-panel">
        <div className="social-panel-head">
          <h4>Total Winnings: ${formatUsd(profile.total_winnings || 0)}</h4>
          <div className="social-range-tabs">
            {[
              { id: 'ytd', label: 'YTD' },
              { id: '3m', label: '3 Months' },
              { id: '1m', label: '1 Month' },
              { id: '1w', label: '1 Week' },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                className={`social-range-tab ${range === item.id ? 'active' : ''}`}
                onClick={() => onRangeChange(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <EarningsChart rows={earnings} range={range} />
      </section>
    </div>
  );
}
