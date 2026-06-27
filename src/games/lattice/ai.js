// =============================================================================
// LATTICE - Single-player opponent
// -----------------------------------------------------------------------------
// Depth-limited minimax (alpha-beta) behind the same small interface as RIFT's
// AI: createAI(level) -> { chooseAction(state) }.
//
// Evaluation blends positional weight (outer-ring nodes are more stable),
// mobility (how many replies each side has), and a disc-count term that grows
// in importance as the board fills.
// =============================================================================

import { applyMove, getLegalMoves, legalMovesFor, countDiscs, GEO, CELL_COUNT, RADIUS } from './rules.js';

export const DIFFICULTY = Object.freeze({
  easy: { name: 'Easy', depth: 1, noise: 6 },
  medium: { name: 'Medium', depth: 3, noise: 1 },
  hard: { name: 'Hard', depth: 5, noise: 0 },
});

// Seedable RNG (mulberry32) for reproducible tie-breaks.
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

// Positional weight per cell: stable outer ring is worth more; the ring just
// inside it is slightly risky (it can be flipped from the edge).
const CELL_WEIGHT = GEO.ring.map((ring) => {
  if (ring === RADIUS) return 5; // outer rim — hard to flip
  if (ring === RADIUS - 1) return -1; // exposes the rim
  return 1 + ring * 0.25;
});

export function evaluate(state, me) {
  const opp = me === 0 ? 1 : 0;
  if (state.status.over) {
    if (state.status.winner === me) return INF;
    if (state.status.winner === opp) return -INF;
    return 0;
  }

  const [c0, c1] = state.status.score;
  const filled = c0 + c1;
  const lateGame = filled / CELL_COUNT; // 0..1

  // Positional term.
  let positional = 0;
  for (let i = 0; i < state.cells.length; i++) {
    const v = state.cells[i];
    if (v === me) positional += CELL_WEIGHT[i];
    else if (v === opp) positional -= CELL_WEIGHT[i];
  }

  // Mobility term (matters most early).
  const myMoves = legalMovesFor(state.cells, me).length;
  const oppMoves = legalMovesFor(state.cells, opp).length;
  const mobility = (myMoves - oppMoves) * 2;

  // Disc-count term (matters most late).
  const discDiff = (me === 0 ? c0 - c1 : c1 - c0);

  return (
    positional * (1 - lateGame * 0.6) +
    mobility * (1 - lateGame) +
    discDiff * (1 + lateGame * 6)
  );
}

function minimax(state, depth, alpha, beta, me) {
  if (depth === 0 || state.status.over) return evaluate(state, me);
  const moves = getLegalMoves(state);
  if (moves.length === 0) return evaluate(state, me);

  // Order by immediate capture size for better pruning.
  moves.sort((a, b) => b.flips.length - a.flips.length);

  const maximizing = state.turn === me;
  let best = maximizing ? -INF : INF;
  for (const move of moves) {
    const next = applyMove(state, move.cellIndex);
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
export function createAI(level = 'medium', seed = 2027) {
  const cfg = DIFFICULTY[level] || DIFFICULTY.medium;
  const rng = makeRng(seed);

  return {
    level,
    config: cfg,
    /** Returns { cellIndex } for the best move, or null if none. */
    chooseAction(state) {
      const me = state.turn;
      const moves = getLegalMoves(state);
      if (moves.length === 0) return null;
      moves.sort((a, b) => b.flips.length - a.flips.length);

      let bestVal = -INF;
      let best = [];
      for (const move of moves) {
        const next = applyMove(state, move.cellIndex);
        let val = minimax(next, cfg.depth - 1, -INF, INF, me);
        if (cfg.noise > 0) val += rng() * cfg.noise;
        if (val > bestVal + 1e-6) {
          bestVal = val;
          best = [move];
        } else if (val >= bestVal - 1e-6) {
          best.push(move);
        }
      }
      const pick = best[Math.floor(rng() * best.length)] || best[0];
      return { cellIndex: pick.cellIndex };
    },
  };
}
