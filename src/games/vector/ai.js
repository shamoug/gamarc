// =============================================================================
// VECTOR - Single-player opponent
// -----------------------------------------------------------------------------
// Depth-limited minimax (alpha-beta) behind the shared AI interface:
// createAI(level) -> { chooseAction(state) } returning an {ax,ay} acceleration.
//
// Evaluation rewards hull advantage and ramming, encourages closing distance,
// and — crucially for a momentum game — penalises carrying speed toward a wall
// you can't brake before (crash risk).
// =============================================================================

import {
  applyMove,
  getLegalMoves,
  previewMove,
  lineCells,
  ACCELS,
  SIZE,
  MAX_SPEED,
  chebyshev,
} from './rules.js';

const clampSpeed = (v) => Math.max(-MAX_SPEED, Math.min(MAX_SPEED, v));
const inBounds = (x, y) => x >= 0 && y >= 0 && x < SIZE && y < SIZE;

// Could `atk` ram `def` on its next move from this position (any non-crashing
// accel whose swept path crosses the defender)?
function canRam(craft, atk, def) {
  const a = craft[atk];
  const d = craft[def];
  for (const ac of ACCELS) {
    const nvx = clampSpeed(a.vx + ac.ax);
    const nvy = clampSpeed(a.vy + ac.ay);
    const nx = a.x + nvx;
    const ny = a.y + nvy;
    if (!inBounds(nx, ny)) continue;
    if (Math.max(Math.abs(nvx), Math.abs(nvy)) === 0) continue;
    if (lineCells(a.x, a.y, nx, ny).some(([x, y]) => x === d.x && y === d.y)) return true;
  }
  return false;
}

export const DIFFICULTY = Object.freeze({
  easy: { name: 'Easy', depth: 1, noise: 5 },
  medium: { name: 'Medium', depth: 3, noise: 1 },
  hard: { name: 'Hard', depth: 5, noise: 0 },
});

function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const INF = 1e9;

// Distance (in cells) a craft would need to brake from its current speed on one
// axis: speed + (speed-1) + ... + 1 = s(s+1)/2.
function brakeDist(speed) {
  const s = Math.abs(speed);
  return (s * (s + 1)) / 2;
}

// How dangerously a craft is heading into a wall (0 = safe).
function wallRisk(c) {
  let risk = 0;
  if (c.vx > 0) risk += Math.max(0, brakeDist(c.vx) - (SIZE - 1 - c.x));
  else if (c.vx < 0) risk += Math.max(0, brakeDist(c.vx) - c.x);
  if (c.vy > 0) risk += Math.max(0, brakeDist(c.vy) - (SIZE - 1 - c.y));
  else if (c.vy < 0) risk += Math.max(0, brakeDist(c.vy) - c.y);
  return risk;
}

export function evaluate(state, me) {
  const opp = me === 0 ? 1 : 0;
  if (state.status.over) {
    if (state.status.winner === me) return INF;
    if (state.status.winner === opp) return -INF;
    return 0;
  }
  const mine = state.craft[me];
  const theirs = state.craft[opp];

  // Hull advantage dominates.
  let score = (mine.hp - theirs.hp) * 12;

  // Pressure: be near the opponent to threaten rams.
  const dist = chebyshev(mine.x, mine.y, theirs.x, theirs.y);
  score += (SIZE - dist) * 2;

  // Crash risk: heavily avoid driving myself into a wall; mildly enjoy when the
  // opponent is in that bind.
  score -= wallRisk(mine) * 10;
  score += wallRisk(theirs) * 5;

  // Ram threat: love positions where I can strike next turn; fear the reverse.
  if (canRam(state.craft, me, opp)) score += 25;
  if (canRam(state.craft, opp, me)) score -= 25;

  // Mild centre preference (more room to manoeuvre).
  const c = (SIZE - 1) / 2;
  score -= (Math.abs(mine.x - c) + Math.abs(mine.y - c)) * 0.3;

  return score;
}

// Order moves: rams first, obvious self-crashes last (better pruning).
function orderedMoves(state) {
  return getLegalMoves(state)
    .map((a) => ({ a, p: previewMove(state, a) }))
    .sort((m1, m2) => score(m2.p) - score(m1.p))
    .map((m) => m.a);
}
function score(p) {
  if (p.crash) return -1000;
  return (p.lethal ? 500 : 0) + (p.ram ? 100 + p.damage : 0);
}

function minimax(state, depth, alpha, beta, me) {
  if (depth === 0 || state.status.over) return evaluate(state, me);
  const moves = orderedMoves(state);
  const maximizing = state.turn === me;
  let best = maximizing ? -INF : INF;
  for (const a of moves) {
    const next = applyMove(state, a);
    const val = minimax(next, depth - 1, alpha, beta, me);
    if (maximizing) {
      if (val > best) best = val;
      if (best > alpha) alpha = best;
    } else {
      if (val < best) best = val;
      if (best < beta) beta = best;
    }
    if (beta <= alpha) break;
  }
  return best;
}

/**
 * @param {('easy'|'medium'|'hard')} level
 * @param {number} [seed]
 */
export function createAI(level = 'medium', seed = 3003) {
  const cfg = DIFFICULTY[level] || DIFFICULTY.medium;
  const rng = makeRng(seed);
  return {
    level,
    config: cfg,
    /** Returns an {ax,ay} acceleration, or null if the game is over. */
    chooseAction(state) {
      const me = state.turn;
      const moves = orderedMoves(state);
      if (moves.length === 0) return null;
      let bestVal = -INF;
      let best = [];
      for (const a of moves) {
        const next = applyMove(state, a);
        let val = minimax(next, cfg.depth - 1, -INF, INF, me);
        if (cfg.noise > 0) val += rng() * cfg.noise;
        if (val > bestVal + 1e-6) {
          bestVal = val;
          best = [a];
        } else if (val >= bestVal - 1e-6) {
          best.push(a);
        }
      }
      return best[Math.floor(rng() * best.length)] || best[0];
    },
  };
}
