// =============================================================================
// LATTICE - Pure game logic
// -----------------------------------------------------------------------------
// A territory-capture duel on a hexagonal grid: a Reversi/Othello variant.
// Place a node on an empty cell so that it brackets one or more straight lines
// of enemy nodes (ending in one of your own). Every bracketed enemy node is
// converted to your colour. Most nodes when the board fills wins.
//
// Like RIFT's rules.js this module is DOM-free and unit-tested. All functions
// are pure: applyMove() never mutates its input.
// =============================================================================

/** Board radius in rings. Radius 4 => 61 hexes (3R^2+3R+1). */
export const RADIUS = 4;

/** Cell ownership sentinels. */
export const EMPTY = -1;

/** The six axial neighbour directions for a flat-top hex grid. */
export const DIRS = Object.freeze([
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
]);

// --- Static geometry (computed once; deterministic) -------------------------

function buildGeometry(radius) {
  const list = [];
  const index = new Map();
  const key = (q, r) => q + ',' + r;
  for (let q = -radius; q <= radius; q++) {
    const rLo = Math.max(-radius, -q - radius);
    const rHi = Math.min(radius, -q + radius);
    for (let r = rLo; r <= rHi; r++) {
      index.set(key(q, r), list.length);
      list.push({ q, r });
    }
  }
  const neighbors = list.map(({ q, r }) =>
    DIRS.map(([dq, dr]) => {
      const i = index.get(key(q + dq, r + dr));
      return i === undefined ? -1 : i;
    }),
  );
  const ring = list.map(({ q, r }) => (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2);
  return { list, index, neighbors, ring, center: index.get(key(0, 0)) };
}

export const GEO = buildGeometry(RADIUS);
export const CELL_COUNT = GEO.list.length;

/** Axial coordinates of a cell index. */
export function cellAt(i) {
  return GEO.list[i];
}

// --- State construction -----------------------------------------------------

/**
 * Build the initial position: the six inner-ring cells alternate ownership
 * (3 each), the centre and everything outward starts empty. This is symmetric
 * under a 60° rotation that swaps colours, so neither side is favoured.
 * @returns {LatticeState}
 */
export function createInitialState() {
  const cells = new Array(CELL_COUNT).fill(EMPTY);
  GEO.neighbors[GEO.center].forEach((nb, dir) => {
    if (nb !== -1) cells[nb] = dir % 2; // alternate 0,1,0,1,0,1
  });
  const state = {
    cells,
    turn: 0,
    passes: 0,
    status: { over: false, winner: null, reason: '', score: [0, 0] },
    lastEvent: null,
  };
  state.status.score = countDiscs(cells);
  return state;
}

/** Deterministic clone. */
export function cloneState(state) {
  return {
    cells: state.cells.slice(),
    turn: state.turn,
    passes: state.passes,
    status: { ...state.status, score: state.status.score.slice() },
    lastEvent: state.lastEvent ? { ...state.lastEvent } : null,
  };
}

/** [count0, count1] discs on the board. */
export function countDiscs(cells) {
  let a = 0;
  let b = 0;
  for (const v of cells) {
    if (v === 0) a++;
    else if (v === 1) b++;
  }
  return [a, b];
}

// --- Move generation --------------------------------------------------------

/**
 * Indices of enemy nodes that a placement at `cellIndex` by `player` would
 * convert. Empty array => the move is illegal.
 */
export function computeFlips(cells, cellIndex, player) {
  if (cells[cellIndex] !== EMPTY) return [];
  const enemy = player === 0 ? 1 : 0;
  const flips = [];
  for (let dir = 0; dir < 6; dir++) {
    const line = [];
    let cur = GEO.neighbors[cellIndex][dir];
    while (cur !== -1 && cells[cur] === enemy) {
      line.push(cur);
      cur = GEO.neighbors[cur][dir];
    }
    if (cur !== -1 && cells[cur] === player && line.length > 0) {
      for (const idx of line) flips.push(idx);
    }
  }
  return flips;
}

/** Legal moves for a given player: [{ cellIndex, flips:[...] }]. */
export function legalMovesFor(cells, player) {
  const moves = [];
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] !== EMPTY) continue;
    const flips = computeFlips(cells, i, player);
    if (flips.length > 0) moves.push({ cellIndex: i, flips });
  }
  return moves;
}

/** Legal moves for the player to move. */
export function getLegalMoves(state) {
  if (state.status.over) return [];
  return legalMovesFor(state.cells, state.turn);
}

// --- Applying moves ---------------------------------------------------------

function finalize(state) {
  state.status.score = countDiscs(state.cells);
  const [a, b] = state.status.score;
  if (a + b >= CELL_COUNT || state.status.over) {
    state.status.over = true;
  }
  if (state.status.over) {
    state.status.winner = a > b ? 0 : b > a ? 1 : null;
    state.status.reason =
      state.status.winner === null
        ? 'Territory tied'
        : `Player ${state.status.winner + 1} holds the most territory (${Math.max(a, b)}–${Math.min(a, b)})`;
  }
  return state;
}

/**
 * Apply a legal move. Forced passes (a side with no legal move) are handled
 * automatically: control skips back to the mover; if neither side can move the
 * game ends. Throws if the move is illegal.
 * @param {LatticeState} prev
 * @param {number} cellIndex
 * @returns {LatticeState}
 */
export function applyMove(prev, cellIndex) {
  if (prev.status.over) throw new Error('Game is already over');
  const state = cloneState(prev);
  const player = state.turn;
  const flips = computeFlips(state.cells, cellIndex, player);
  if (flips.length === 0) throw new Error('Illegal move (no captures)');

  state.cells[cellIndex] = player;
  for (const idx of flips) state.cells[idx] = player;

  const other = player === 0 ? 1 : 0;
  const otherHasMove = legalMovesFor(state.cells, other).length > 0;
  const selfHasMove = legalMovesFor(state.cells, player).length > 0;

  state.lastEvent = { type: 'move', cellIndex, flips, player, opponentPassed: false };

  if (otherHasMove) {
    state.turn = other;
    state.passes = 0;
  } else if (selfHasMove) {
    // Opponent must pass; the mover goes again.
    state.turn = player;
    state.passes = 1;
    state.lastEvent.opponentPassed = true;
  } else {
    // Neither side can move: the game is over.
    state.status.over = true;
    state.passes = 2;
  }

  return finalize(state);
}

// --- Convenience ------------------------------------------------------------

/** Does the player to move have any legal move? */
export function hasMove(state) {
  return getLegalMoves(state).length > 0;
}

/**
 * @typedef {Object} LatticeState
 * @property {number[]} cells      ownership per cell index: EMPTY | 0 | 1
 * @property {number} turn         player to move (0 or 1)
 * @property {number} passes       consecutive passes
 * @property {{over:boolean, winner:(number|null), reason:string, score:number[]}} status
 * @property {Object|null} lastEvent
 */
