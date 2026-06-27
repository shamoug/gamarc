// =============================================================================
// RIFT - Single-player opponent
// -----------------------------------------------------------------------------
// A depth-limited minimax (alpha-beta) AI behind a small, swappable interface.
// Create one with createAI(difficulty); call chooseAction(state) to get a move.
//
// The evaluation considers: material, Core safety, board control (mobility),
// distance to the enemy Core, and the danger of the next ring collapse.
// =============================================================================

import {
  PLANE,
  PIECE,
  PIECE_VALUES,
  applyAction,
  getLegalActions,
  coreOf,
  ringLevel,
  chebyshev,
  getCollapseInfo,
} from './rules.js';

/** Difficulty presets. Each maps to a search depth and eval flavour. */
export const DIFFICULTY = Object.freeze({
  easy: { name: 'Easy', depth: 1, noise: 8 },
  medium: { name: 'Medium', depth: 2, noise: 2 },
  hard: { name: 'Hard', depth: 3, noise: 0 },
});

// Seedable RNG (mulberry32) so any tie-break noise is reproducible.
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

/**
 * Static evaluation from `me`'s point of view (higher = better for `me`).
 */
export function evaluate(state, me) {
  const opp = me === 0 ? 1 : 0;

  // Terminal positions.
  if (state.status.over) {
    if (state.status.winner === me) return INF;
    if (state.status.winner === opp) return -INF;
    return 0; // draw
  }

  let score = 0;
  const myCore = coreOf(state, me);
  const oppCore = coreOf(state, opp);

  // 1. Material.
  for (const p of state.pieces) {
    const v = PIECE_VALUES[p.type] || 0;
    score += p.owner === me ? v : -v;
  }

  // 2. Distance to the enemy Core: reward my attackers for closing in.
  if (oppCore) {
    for (const p of state.pieces) {
      if (p.owner !== me || p.type === PIECE.CORE) continue;
      // Only Real-plane pieces can actually strike.
      if (p.plane !== PLANE.REAL) continue;
      const d = chebyshev(p.row, p.col, oppCore.row, oppCore.col);
      score += (6 - d) * 1.5;
    }
  }

  // 3. Core safety: penalise enemy Real-plane pieces sitting near my Core.
  if (myCore) {
    for (const p of state.pieces) {
      if (p.owner === me || p.plane !== PLANE.REAL) continue;
      const d = chebyshev(p.row, p.col, myCore.row, myCore.col);
      if (d <= 2) score -= (3 - d) * 6;
    }
  }

  // 4. Board control: mobility difference (cheap proxy — count my actions).
  //    We approximate by counting reachable squares is expensive, so use the
  //    legal action count for the side to move and invert appropriately.
  const mobility = getLegalActions(state).length;
  score += state.turn === me ? mobility * 0.4 : -mobility * 0.4;

  // 5. Collapse awareness: pieces (especially Cores) standing on a ring that
  //    will collapse soon are in danger.
  const info = getCollapseInfo(state);
  if (!info.maxedOut) {
    const dangerRing = state.collapseLevel; // the ring that goes next
    const proximity = info.roundsUntil <= 1 ? 3 : info.roundsUntil <= 2 ? 1.5 : 0.5;
    for (const p of state.pieces) {
      if (ringLevel(p.row, p.col) === dangerRing) {
        const weight = p.type === PIECE.CORE ? 40 : 6;
        score += (p.owner === me ? -1 : 1) * weight * proximity;
      }
    }
  }

  return score;
}

// Order actions so captures are searched first (better alpha-beta pruning).
function orderActions(state, actions) {
  return actions
    .map((a) => {
      let priority = 0;
      if (a.type === 'move') {
        // A capture lands on an enemy-occupied Real square.
        for (const p of state.pieces) {
          if (p.row === a.toRow && p.col === a.toCol && p.plane === PLANE.REAL && p.owner !== state.turn) {
            priority = PIECE_VALUES[p.type] || 1;
          }
        }
      }
      return { a, priority };
    })
    .sort((x, y) => y.priority - x.priority)
    .map((x) => x.a);
}

function minimax(state, depth, alpha, beta, me) {
  if (depth === 0 || state.status.over) {
    return evaluate(state, me);
  }
  const actions = orderActions(state, getLegalActions(state));
  if (actions.length === 0) return evaluate(state, me);

  const maximizing = state.turn === me;
  let best = maximizing ? -INF : INF;

  for (const action of actions) {
    const next = applyAction(state, action);
    const val = minimax(next, depth - 1, alpha, beta, me);
    if (maximizing) {
      if (val > best) best = val;
      if (best > alpha) alpha = best;
    } else {
      if (val < best) best = val;
      if (best < beta) beta = best;
    }
    if (beta <= alpha) break; // prune
  }
  return best;
}

/**
 * Create an AI opponent.
 * @param {('easy'|'medium'|'hard')} level
 * @param {number} [seed]
 */
export function createAI(level = 'medium', seed = 12345) {
  const cfg = DIFFICULTY[level] || DIFFICULTY.medium;
  const rng = makeRng(seed);

  return {
    level,
    config: cfg,
    /**
     * Choose the best action for the player to move in `state`.
     * Returns null if there are no legal actions.
     * @param {GameState} state
     */
    chooseAction(state) {
      const me = state.turn;
      const actions = orderActions(state, getLegalActions(state));
      if (actions.length === 0) return null;

      let bestVal = -INF;
      let bestActions = [];
      for (const action of actions) {
        const next = applyAction(state, action);
        let val = minimax(next, cfg.depth - 1, -INF, INF, me);
        // Small reproducible noise so easy/medium feel less robotic.
        if (cfg.noise > 0) val += rng() * cfg.noise;
        if (val > bestVal + 1e-6) {
          bestVal = val;
          bestActions = [action];
        } else if (val >= bestVal - 1e-6) {
          bestActions.push(action);
        }
      }
      // Deterministic-ish tie break via seeded RNG.
      const idx = Math.floor(rng() * bestActions.length);
      return bestActions[idx] || bestActions[0];
    },
  };
}
