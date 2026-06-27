// =============================================================================
// RIFT - Pure game logic
// -----------------------------------------------------------------------------
// This module is intentionally free of any DOM / Canvas / rendering code so it
// can be imported and unit-tested directly under Node (see /tests).
//
// All rules and tunables live here as named constants. The functions are pure:
// applyAction() never mutates the state it is given; it returns a fresh state.
// =============================================================================

// --- Board ------------------------------------------------------------------

/** Side length of the (initial) square board. */
export const BOARD_SIZE = 7;

/** The two layers every square owns. */
export const PLANE = Object.freeze({ REAL: 0, RIFT: 1 });

/** Piece type identifiers. */
export const PIECE = Object.freeze({
  CORE: 'core',
  RUNNER: 'runner',
  SHIFTER: 'shifter',
  GUARD: 'guard',
});

// --- Tunables ---------------------------------------------------------------

/** A full ring collapses every N completed rounds. */
export const COLLAPSE_EVERY_ROUNDS = 4;

/** Highest collapse level (7x7 -> 5x5 -> 3x3 -> 1x1 center). */
export const MAX_COLLAPSE_LEVEL = 3;

/**
 * Result awarded when the player to move has no legal action.
 * 'loss' => that player loses. Change to 'draw' to make stalemate a draw.
 */
export const NO_MOVES_RESULT = 'loss';

/** Material values used by the AI evaluation. */
export const PIECE_VALUES = Object.freeze({
  [PIECE.CORE]: 1000,
  [PIECE.RUNNER]: 50,
  [PIECE.SHIFTER]: 50,
  [PIECE.GUARD]: 30,
});

/** The eight compass directions as [dRow, dCol]. */
export const DIRECTIONS = Object.freeze({
  ORTHO: [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ],
  DIAG: [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ],
  ALL: [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ],
});

/**
 * Symmetric starting layout. Both back rows hold every piece, mirrored across
 * the board centre. Player 0 sits on row 6 (bottom), player 1 on row 0 (top).
 * All pieces begin on the Real plane. Columns 0..6:
 *   Runner, Shifter, Guard, Core, Guard, Shifter, Runner
 */
export const BACK_ROW = Object.freeze([
  PIECE.RUNNER,
  PIECE.SHIFTER,
  PIECE.GUARD,
  PIECE.CORE,
  PIECE.GUARD,
  PIECE.SHIFTER,
  PIECE.RUNNER,
]);

/** Which pieces are allowed to phase between planes. */
export function canTypePhase(type) {
  return type !== PIECE.CORE;
}

// --- State construction -----------------------------------------------------

/**
 * Build the initial game state.
 * @returns {GameState}
 */
export function createInitialState() {
  const pieces = [];
  let nextId = 0;
  const addRow = (owner, row) => {
    BACK_ROW.forEach((type, col) => {
      pieces.push({
        id: nextId++,
        type,
        owner,
        row,
        col,
        plane: PLANE.REAL,
      });
    });
  };
  addRow(1, 0); // player 1 on top
  addRow(0, BOARD_SIZE - 1); // player 0 on bottom

  return {
    pieces,
    turn: 0, // whose action it is (0 or 1)
    round: 1, // 1-based full-round counter
    collapseLevel: 0, // rings already removed
    status: { over: false, winner: null, reason: '' },
    lastEvent: null, // { type:'collapse'|'capture'|'phase'|'move', ... }
  };
}

/** Deep, deterministic clone of a state. */
export function cloneState(state) {
  return {
    pieces: state.pieces.map((p) => ({ ...p })),
    turn: state.turn,
    round: state.round,
    collapseLevel: state.collapseLevel,
    status: { ...state.status },
    lastEvent: state.lastEvent ? { ...state.lastEvent } : null,
  };
}

// --- Geometry ---------------------------------------------------------------

/** Distance (in rings) of a square from the nearest edge. */
export function ringLevel(row, col) {
  return Math.min(row, col, BOARD_SIZE - 1 - row, BOARD_SIZE - 1 - col);
}

/** Is a square still in play given how many rings have collapsed? */
export function isAlive(row, col, collapseLevel) {
  if (row < 0 || col < 0 || row >= BOARD_SIZE || col >= BOARD_SIZE) return false;
  return ringLevel(row, col) >= collapseLevel;
}

/** Piece occupying a given square/plane, or null. */
export function occupantAt(state, row, col, plane) {
  for (const p of state.pieces) {
    if (p.row === row && p.col === col && p.plane === plane) return p;
  }
  return null;
}

export function getPiece(state, id) {
  return state.pieces.find((p) => p.id === id) || null;
}

export function coreOf(state, owner) {
  return state.pieces.find((p) => p.owner === owner && p.type === PIECE.CORE) || null;
}

// --- Collapse schedule ------------------------------------------------------

/**
 * Information about the upcoming collapse.
 * @returns {{nextCollapseRound:number, roundsUntil:number, warning:boolean, warningRingLevel:number, maxedOut:boolean}}
 */
export function getCollapseInfo(state) {
  const maxedOut = state.collapseLevel >= MAX_COLLAPSE_LEVEL;
  const nextCollapseRound = (state.collapseLevel + 1) * COLLAPSE_EVERY_ROUNDS;
  const roundsUntil = nextCollapseRound - state.round;
  return {
    nextCollapseRound,
    roundsUntil,
    warning: !maxedOut && roundsUntil === 1,
    warningRingLevel: state.collapseLevel, // the current outermost ring
    maxedOut,
  };
}

// --- Move generation --------------------------------------------------------

/**
 * Can the moving piece (on `plane`) land on (row,col)?
 * Returns 'empty' | 'capture' | 'blocked'.
 * Capture is only possible on the Real plane (Rift pieces cannot capture/be
 * captured). On the Rift plane any occupant blocks.
 */
function landingKind(state, mover, row, col, plane) {
  if (!isAlive(row, col, state.collapseLevel)) return 'blocked';
  const occ = occupantAt(state, row, col, plane);
  if (!occ) return 'empty';
  if (plane === PLANE.REAL && occ.owner !== mover.owner) return 'capture';
  return 'blocked';
}

/** Slide moves (Runner/Shifter) along a set of directions. */
function slideMoves(state, piece, dirs) {
  const moves = [];
  for (const [dr, dc] of dirs) {
    let r = piece.row + dr;
    let c = piece.col + dc;
    while (isAlive(r, c, state.collapseLevel)) {
      const occ = occupantAt(state, r, c, piece.plane);
      if (!occ) {
        moves.push({ type: 'move', pieceId: piece.id, toRow: r, toCol: c });
      } else {
        // First same-plane piece stops the slide; capture it if it's an enemy
        // on the Real plane.
        if (piece.plane === PLANE.REAL && occ.owner !== piece.owner) {
          moves.push({ type: 'move', pieceId: piece.id, toRow: r, toCol: c });
        }
        break;
      }
      r += dr;
      c += dc;
    }
  }
  return moves;
}

/** Single-step moves (Core/Guard) in a set of directions. */
function stepMoves(state, piece, dirs) {
  const moves = [];
  for (const [dr, dc] of dirs) {
    const r = piece.row + dr;
    const c = piece.col + dc;
    const kind = landingKind(state, piece, r, c, piece.plane);
    if (kind === 'empty' || kind === 'capture') {
      moves.push({ type: 'move', pieceId: piece.id, toRow: r, toCol: c });
    }
  }
  return moves;
}

/** All legal MOVE actions for a single piece (no phase actions). */
export function getMovesForPiece(state, piece) {
  switch (piece.type) {
    case PIECE.CORE:
      return stepMoves(state, piece, DIRECTIONS.ALL);
    case PIECE.GUARD:
      return stepMoves(state, piece, DIRECTIONS.ALL);
    case PIECE.RUNNER:
      return slideMoves(state, piece, DIRECTIONS.ORTHO);
    case PIECE.SHIFTER:
      return slideMoves(state, piece, DIRECTIONS.DIAG);
    default:
      return [];
  }
}

/** Can this piece phase to the other layer of its current square right now? */
export function canPhase(state, piece) {
  if (!canTypePhase(piece.type)) return false;
  const other = piece.plane === PLANE.REAL ? PLANE.RIFT : PLANE.REAL;
  return occupantAt(state, piece.row, piece.col, other) === null;
}

/** The phase action for a piece, or null if it cannot phase. */
export function getPhaseAction(state, piece) {
  return canPhase(state, piece) ? { type: 'phase', pieceId: piece.id } : null;
}

/** All legal actions (move + phase) for one piece. */
export function getActionsForPiece(state, piece) {
  const actions = getMovesForPiece(state, piece);
  const phase = getPhaseAction(state, piece);
  if (phase) actions.push(phase);
  return actions;
}

/** All legal actions for the player to move. */
export function getLegalActions(state) {
  if (state.status.over) return [];
  const actions = [];
  for (const piece of state.pieces) {
    if (piece.owner !== state.turn) continue;
    actions.push(...getActionsForPiece(state, piece));
  }
  return actions;
}

// --- Applying actions -------------------------------------------------------

/**
 * Apply a collapse: remove the next outer ring and any pieces standing on it
 * (on either plane). Mutates the (already cloned) state in place.
 */
function applyCollapse(state) {
  if (state.collapseLevel >= MAX_COLLAPSE_LEVEL) return [];
  state.collapseLevel += 1;
  const destroyed = [];
  state.pieces = state.pieces.filter((p) => {
    if (isAlive(p.row, p.col, state.collapseLevel)) return true;
    destroyed.push({ ...p });
    return false;
  });
  return destroyed;
}

/** Recompute status from the board + the player to move. */
function recomputeStatus(state) {
  const core0 = coreOf(state, 0);
  const core1 = coreOf(state, 1);
  if (!core0 && !core1) {
    state.status = { over: true, winner: null, reason: 'Both Cores destroyed' };
    return;
  }
  if (!core0) {
    state.status = { over: true, winner: 1, reason: 'Player 1 destroyed the enemy Core' };
    return;
  }
  if (!core1) {
    state.status = { over: true, winner: 0, reason: 'Player 0 destroyed the enemy Core' };
    return;
  }
  // No Core lost: check whether the player to move is stuck.
  if (getLegalActions(state).length === 0) {
    if (NO_MOVES_RESULT === 'loss') {
      state.status = {
        over: true,
        winner: state.turn === 0 ? 1 : 0,
        reason: `Player ${state.turn} has no legal action`,
      };
    } else {
      state.status = { over: true, winner: null, reason: 'No legal action (draw)' };
    }
    return;
  }
  state.status = { over: false, winner: null, reason: '' };
}

/**
 * Apply one action and return the resulting (new) state. Throws if the action
 * is not currently legal for the player to move.
 * @param {GameState} prev
 * @param {Action} action  {type:'move', pieceId, toRow, toCol} | {type:'phase', pieceId}
 * @returns {GameState}
 */
export function applyAction(prev, action) {
  if (prev.status.over) throw new Error('Game is already over');
  const state = cloneState(prev);
  const piece = getPiece(state, action.pieceId);
  if (!piece) throw new Error('No such piece: ' + action.pieceId);
  if (piece.owner !== state.turn) throw new Error('Not this player\'s piece');

  let captured = null;

  if (action.type === 'move') {
    const legal = getMovesForPiece(state, piece).some(
      (m) => m.toRow === action.toRow && m.toCol === action.toCol,
    );
    if (!legal) throw new Error('Illegal move');
    // Capture on the Real plane.
    const occ = occupantAt(state, action.toRow, action.toCol, piece.plane);
    if (occ && occ.owner !== piece.owner) {
      captured = { ...occ };
      state.pieces = state.pieces.filter((p) => p.id !== occ.id);
    }
    piece.row = action.toRow;
    piece.col = action.toCol;
    state.lastEvent = captured
      ? { type: 'capture', pieceId: piece.id, captured }
      : { type: 'move', pieceId: piece.id };
  } else if (action.type === 'phase') {
    if (!canPhase(state, piece)) throw new Error('Illegal phase');
    piece.plane = piece.plane === PLANE.REAL ? PLANE.RIFT : PLANE.REAL;
    state.lastEvent = { type: 'phase', pieceId: piece.id };
  } else {
    throw new Error('Unknown action type: ' + action.type);
  }

  // Advance the turn. A full round completes when control returns to player 0.
  const roundCompleted = state.turn === 1;
  state.turn = state.turn === 0 ? 1 : 0;

  if (roundCompleted) {
    // Does *this* completed round trigger a collapse?
    if (state.round % COLLAPSE_EVERY_ROUNDS === 0 && state.collapseLevel < MAX_COLLAPSE_LEVEL) {
      const destroyed = applyCollapse(state);
      state.lastEvent = { type: 'collapse', collapseLevel: state.collapseLevel, destroyed };
    }
    state.round += 1;
  }

  recomputeStatus(state);
  return state;
}

// --- Convenience ------------------------------------------------------------

/** Manhattan-ish (Chebyshev) distance between two squares. */
export function chebyshev(r1, c1, r2, c2) {
  return Math.max(Math.abs(r1 - r2), Math.abs(c1 - c2));
}

/**
 * @typedef {Object} Piece
 * @property {number} id
 * @property {string} type
 * @property {number} owner
 * @property {number} row
 * @property {number} col
 * @property {number} plane
 *
 * @typedef {Object} GameState
 * @property {Piece[]} pieces
 * @property {number} turn
 * @property {number} round
 * @property {number} collapseLevel
 * @property {{over:boolean, winner:(number|null), reason:string}} status
 * @property {Object|null} lastEvent
 *
 * @typedef {Object} Action
 * @property {string} type
 * @property {number} pieceId
 * @property {number} [toRow]
 * @property {number} [toCol]
 */
