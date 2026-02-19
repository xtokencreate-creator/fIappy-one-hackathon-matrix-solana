'use strict';

const CFG = require('./config');
const PairTracker = require('./PairTracker');

let _players = null;
let lastScanAt = 0;

function init(players) {
    _players = players;
}

function tick(now) {
    if (now - lastScanAt < CFG.SCAN_INTERVAL_MS) return;
    lastScanAt = now;

    // Step 1: Collect alive non-bot players
    const alive = [];
    _players.forEach(p => {
        if (p.alive && p.joined && !p.isBot) alive.push(p);
    });
    if (alive.length < 2) return;

    // Step 2: Grid-based spatial bucketing (cell size = proximity threshold)
    const CELL = CFG.PROXIMITY_THRESHOLD;
    const grid = new Map();   // "cx,cy" -> player[]

    for (const p of alive) {
        const cx = Math.floor(p.x / CELL);
        const cy = Math.floor(p.y / CELL);
        const key = `${cx},${cy}`;
        let bucket = grid.get(key);
        if (!bucket) { bucket = []; grid.set(key, bucket); }
        bucket.push(p);
    }

    // Step 3: Check pairs within same + adjacent cells
    const checked = new Set();

    grid.forEach((cellPlayers, key) => {
        const [cx, cy] = key.split(',').map(Number);

        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const nk = `${cx + dx},${cy + dy}`;
                const neighbors = grid.get(nk);
                if (!neighbors) continue;

                for (const a of cellPlayers) {
                    for (const b of neighbors) {
                        if (a.id >= b.id) continue;  // canonical order + skip self
                        const pk = `${a.id}|${b.id}`;
                        if (checked.has(pk)) continue;
                        checked.add(pk);

                        const dx2 = a.x - b.x;
                        const dy2 = a.y - b.y;
                        const dist = Math.sqrt(dx2 * dx2 + dy2 * dy2);

                        if (dist < CFG.PROXIMITY_THRESHOLD) {
                            PairTracker.recordProximityTick(a, b, dist);
                        }
                    }
                }
            }
        }
    });

    // Step 4: Score all tracked pairs
    PairTracker.scoreAllPairs();

    // Step 5: Prune stale pairs
    PairTracker.pruneStale(now);
}

module.exports = { init, tick };
