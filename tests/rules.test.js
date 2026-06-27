// =============================================================================
// RIFT - logic tests
// -----------------------------------------------------------------------------
// Plain-JS assertions, no test framework. Runnable two ways:
//   Node:    node tests/rules.test.js
//   Browser: open tests/index.html through a static server
//
// Covers: legal move generation, capture across planes, phasing, collapse
// destruction (incl. Core loss), and win detection.
// =============================================================================

import {
  createInitialState,
  applyAction,
  getLegalActions,
  getMovesForPiece,
  getActionsForPiece,
  getPiece,
  occupantAt,
  canPhase,
  PLANE,
  PIECE,
  coreOf,
} from '../src/games/rift/rules.js';

// --- Tiny harness -----------------------------------------------------------

const results = [];
function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, err: err.message });
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}
function eq(a, b, msg) {
  if (a !== b) throw new Error((msg || 'expected equality') + ` (got ${a}, want ${b})`);
}

// Build a bare state with explicit pieces (ids auto-assigned).
let _id = 0;
function piece(type, owner, row, col, plane = PLANE.REAL) {
  return { id: _id++, type, owner, row, col, plane };
}
function makeState(pieces, { turn = 0, round = 1, collapseLevel = 0 } = {}) {
  _id = pieces.reduce((m, p) => Math.max(m, p.id + 1), 0);
  return {
    pieces,
    turn,
    round,
    collapseLevel,
    status: { over: false, winner: null, reason: '' },
    lastEvent: null,
  };
}
function cellHas(moves, r, c) {
  return moves.some((m) => m.toRow === r && m.toCol === c);
}

// --- Tests ------------------------------------------------------------------

test('initial state: 7 pieces each, all Real, player 0 to move', () => {
  const s = createInitialState();
  eq(s.pieces.filter((p) => p.owner === 0).length, 7, 'player 0 piece count');
  eq(s.pieces.filter((p) => p.owner === 1).length, 7, 'player 1 piece count');
  assert(s.pieces.every((p) => p.plane === PLANE.REAL), 'all start on Real plane');
  eq(s.turn, 0, 'player 0 moves first');
  assert(getLegalActions(s).length > 0, 'has legal actions');
});

test('runner slides orthogonally and is blocked by same-plane allies', () => {
  const core0 = piece(PIECE.CORE, 0, 6, 3);
  const core1 = piece(PIECE.CORE, 1, 0, 3);
  const runner = piece(PIECE.RUNNER, 0, 3, 0);
  const ally = piece(PIECE.GUARD, 0, 3, 3); // blocks the row at col 3
  const s = makeState([core0, core1, runner, ally]);
  const moves = getMovesForPiece(s, runner);
  assert(cellHas(moves, 3, 1), 'can reach (3,1)');
  assert(cellHas(moves, 3, 2), 'can reach (3,2)');
  assert(!cellHas(moves, 3, 3), 'blocked at ally');
  assert(!cellHas(moves, 3, 4), 'cannot jump past ally');
});

test('capture on the Real plane removes the enemy', () => {
  const core0 = piece(PIECE.CORE, 0, 6, 3);
  const core1 = piece(PIECE.CORE, 1, 0, 3);
  const runner = piece(PIECE.RUNNER, 0, 3, 0);
  const enemy = piece(PIECE.GUARD, 1, 3, 3, PLANE.REAL);
  const s = makeState([core0, core1, runner, enemy]);
  const moves = getMovesForPiece(s, runner);
  assert(cellHas(moves, 3, 3), 'can move onto enemy (capture)');
  const next = applyAction(s, { type: 'move', pieceId: runner.id, toRow: 3, toCol: 3 });
  assert(!getPiece(next, enemy.id), 'enemy removed after capture');
  eq(next.lastEvent.type, 'capture', 'capture event recorded');
});

test('no capture across planes: Real piece passes a Rift piece without taking it', () => {
  const core0 = piece(PIECE.CORE, 0, 6, 3);
  const core1 = piece(PIECE.CORE, 1, 0, 3);
  const runner = piece(PIECE.RUNNER, 0, 3, 0, PLANE.REAL);
  const enemyRift = piece(PIECE.GUARD, 1, 3, 3, PLANE.RIFT);
  const s = makeState([core0, core1, runner, enemyRift]);
  const moves = getMovesForPiece(s, runner);
  assert(cellHas(moves, 3, 3), 'can land on the square (other plane is empty)');
  assert(cellHas(moves, 3, 4), 'Rift piece does not block the slide');
  const next = applyAction(s, { type: 'move', pieceId: runner.id, toRow: 3, toCol: 3 });
  assert(getPiece(next, enemyRift.id), 'Rift enemy NOT captured');
  eq(next.lastEvent.type, 'move', 'plain move, not capture');
});

test('Rift piece cannot capture and is blocked by a Rift occupant', () => {
  const core0 = piece(PIECE.CORE, 0, 6, 3);
  const core1 = piece(PIECE.CORE, 1, 0, 3);
  const runner = piece(PIECE.RUNNER, 0, 3, 0, PLANE.RIFT);
  const enemyRift = piece(PIECE.GUARD, 1, 3, 3, PLANE.RIFT);
  const s = makeState([core0, core1, runner, enemyRift]);
  const moves = getMovesForPiece(s, runner);
  assert(cellHas(moves, 3, 2), 'can advance up to the blocker');
  assert(!cellHas(moves, 3, 3), 'cannot capture on the Rift plane');
});

test('phasing: toggles plane only when the other layer is empty; Core cannot phase', () => {
  const core0 = piece(PIECE.CORE, 0, 6, 3);
  const core1 = piece(PIECE.CORE, 1, 0, 3);
  const guard = piece(PIECE.GUARD, 0, 3, 3, PLANE.REAL);
  const s1 = makeState([core0, core1, guard]);
  assert(canPhase(s1, guard), 'guard can phase to empty Rift layer');
  const after = applyAction(s1, { type: 'phase', pieceId: guard.id });
  eq(getPiece(after, guard.id).plane, PLANE.RIFT, 'guard now on Rift');

  // Block the other layer.
  const blocker = piece(PIECE.RUNNER, 0, 3, 3, PLANE.RIFT);
  const s2 = makeState([core0, core1, piece(PIECE.GUARD, 0, 3, 3, PLANE.REAL), blocker]);
  const g2 = s2.pieces.find((p) => p.type === PIECE.GUARD);
  assert(!canPhase(s2, g2), 'cannot phase into an occupied layer');

  // Core never phases.
  assert(!canPhase(s1, core0), 'core cannot phase');
});

test('collapse destroys outer-ring pieces on schedule', () => {
  // round=4, player 1 to move; player 1 makes a safe move completing the round.
  const core0 = piece(PIECE.CORE, 0, 3, 3); // centre, survives
  const core1 = piece(PIECE.CORE, 1, 3, 4); // centre-ish, survives
  const mover = piece(PIECE.GUARD, 1, 3, 5); // player 1, can step inward
  const victim = piece(PIECE.RUNNER, 0, 0, 3); // outer ring -> destroyed
  const s = makeState([core0, core1, mover, victim], { turn: 1, round: 4 });
  const next = applyAction(s, { type: 'move', pieceId: mover.id, toRow: 3, toCol: 6 });
  eq(next.collapseLevel, 1, 'collapsed one ring');
  assert(!getPiece(next, victim.id), 'outer-ring piece destroyed');
  assert(getPiece(next, core0.id) && getPiece(next, core1.id), 'central cores survive');
  eq(next.lastEvent.type, 'collapse', 'collapse event recorded');
});

test('collapse that destroys a Core ends the game', () => {
  const core0 = piece(PIECE.CORE, 0, 3, 3); // safe
  const core1 = piece(PIECE.CORE, 1, 0, 0); // outer corner -> destroyed on collapse
  const mover = piece(PIECE.GUARD, 1, 3, 4);
  const s = makeState([core0, core1, mover], { turn: 1, round: 4 });
  const next = applyAction(s, { type: 'move', pieceId: mover.id, toRow: 3, toCol: 5 });
  assert(next.status.over, 'game over');
  eq(next.status.winner, 0, 'player 0 wins when player 1 Core collapses');
});

test('win detection: capturing the enemy Core ends the game', () => {
  const core0 = piece(PIECE.CORE, 0, 6, 3);
  const core1 = piece(PIECE.CORE, 1, 3, 4, PLANE.REAL);
  const killer = piece(PIECE.RUNNER, 0, 3, 0, PLANE.REAL);
  const s = makeState([core0, core1, killer]);
  const next = applyAction(s, { type: 'move', pieceId: killer.id, toRow: 3, toCol: 4 });
  assert(next.status.over, 'game over after Core capture');
  eq(next.status.winner, 0, 'player 0 wins');
  assert(!coreOf(next, 1), 'enemy Core gone');
});

test('getActionsForPiece includes a phase action when legal', () => {
  const core0 = piece(PIECE.CORE, 0, 6, 3);
  const core1 = piece(PIECE.CORE, 1, 0, 3);
  const guard = piece(PIECE.GUARD, 0, 3, 3);
  const s = makeState([core0, core1, guard]);
  const actions = getActionsForPiece(s, guard);
  assert(actions.some((a) => a.type === 'phase'), 'phase action present');
  assert(actions.some((a) => a.type === 'move'), 'move actions present');
});

test('illegal actions are rejected', () => {
  const s = createInitialState();
  let threw = false;
  try {
    // Move a player-1 piece on player-0's turn.
    const p1 = s.pieces.find((p) => p.owner === 1);
    applyAction(s, { type: 'move', pieceId: p1.id, toRow: p1.row + 1, toCol: p1.col });
  } catch {
    threw = true;
  }
  assert(threw, 'moving opponent piece throws');
});

// --- Report -----------------------------------------------------------------

const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;

function lineFor(r) {
  return (r.ok ? 'PASS' : 'FAIL') + '  ' + r.name + (r.ok ? '' : '\n        -> ' + r.err);
}

const summary = results.map(lineFor).join('\n');
const banner = `\nRIFT logic tests: ${passed}/${results.length} passed` + (failed ? `, ${failed} FAILED` : '');

if (typeof document !== 'undefined') {
  const pre = document.createElement('pre');
  pre.textContent = summary + '\n' + banner;
  pre.style.cssText =
    'font:14px ui-monospace,monospace;padding:20px;color:' + (failed ? '#ff6b6b' : '#41e0d0');
  document.body.appendChild(pre);
} else {
  // Node.
  console.log(summary);
  console.log(banner);
  if (failed) process.exit(1);
}

export { results };
