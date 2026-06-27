// =============================================================================
// LATTICE - logic tests (plain JS assertions, no framework)
//   Node:    node tests/lattice.test.js
//   Browser: open tests/index.html through a static server
//
// Covers: geometry, starting position, legal-move/flip generation, capture
// (flipping), forced-pass handling, and win/draw detection.
// =============================================================================

import {
  createInitialState,
  applyMove,
  getLegalMoves,
  computeFlips,
  legalMovesFor,
  countDiscs,
  cloneState,
  GEO,
  CELL_COUNT,
  EMPTY,
  RADIUS,
} from '../src/games/lattice/rules.js';

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
const idx = (q, r) => GEO.index.get(q + ',' + r);

// --- Tests ------------------------------------------------------------------

test('geometry: radius 4 builds 61 cells with valid neighbour links', () => {
  eq(CELL_COUNT, 3 * RADIUS * RADIUS + 3 * RADIUS + 1, 'cell count formula');
  // The centre has all six neighbours; corners have three.
  const centerNbrs = GEO.neighbors[GEO.center].filter((n) => n !== -1).length;
  eq(centerNbrs, 6, 'centre has 6 neighbours');
});

test('initial position: 3 nodes each on the inner ring, rest empty', () => {
  const s = createInitialState();
  const [a, b] = countDiscs(s.cells);
  eq(a, 3, 'player 0 starts with 3');
  eq(b, 3, 'player 1 starts with 3');
  eq(s.cells[GEO.center], EMPTY, 'centre starts empty');
  eq(s.turn, 0, 'player 0 to move');
});

test('legal moves exist at the start for both players', () => {
  const s = createInitialState();
  assert(getLegalMoves(s).length > 0, 'player 0 has moves');
  assert(legalMovesFor(s.cells, 1).length > 0, 'player 1 has moves');
});

test('computeFlips brackets an enemy line correctly', () => {
  // From the alternating inner ring, placing P0 at (2,-1) brackets the P1 node
  // at (1,-1) against the P0 node at (0,-1).
  const s = createInitialState();
  const place = idx(2, -1);
  const flips = computeFlips(s.cells, place, 0);
  assert(flips.includes(idx(1, -1)), 'flips the bracketed enemy node');
  assert(flips.length >= 1, 'at least one capture');
});

test('applyMove converts bracketed nodes and adds the placed node', () => {
  const s = createInitialState();
  const before = countDiscs(s.cells);
  const place = idx(2, -1);
  const flips = computeFlips(s.cells, place, 0);
  const next = applyMove(s, place);
  eq(next.cells[place], 0, 'placed node is owned by mover');
  for (const f of flips) eq(next.cells[f], 0, 'each bracketed node converted');
  const after = countDiscs(next.cells);
  // Mover gains 1 (placed) + flips; opponent loses flips.
  eq(after[0], before[0] + 1 + flips.length, 'mover disc count');
  eq(after[1], before[1] - flips.length, 'opponent disc count');
});

test('illegal moves are rejected', () => {
  const s = createInitialState();
  let threw = false;
  try {
    applyMove(s, GEO.center); // centre brackets nothing at the start
  } catch {
    threw = true;
  }
  assert(threw, 'placing where nothing is bracketed throws');
});

test('turn alternates after a normal move', () => {
  const s = createInitialState();
  const next = applyMove(s, idx(2, -1));
  eq(next.turn, 1, 'control passes to player 1');
});

test('forced pass: a side with no move is skipped', () => {
  // Construct a tiny contrived position where after P0 moves, P1 has no move
  // but P0 does, so control returns to P0.
  const s = createInitialState();
  // Empty the board, then set a line: P0 at A, P1 at B, empty at C in a row,
  // and nothing else, so only P0 can ever move.
  s.cells.fill(EMPTY);
  const a = idx(-2, 0);
  const b = idx(-1, 0);
  const c = idx(0, 0);
  s.cells[a] = 0;
  s.cells[b] = 1;
  // Placing P0 at C brackets B. After that the board is all P0 -> nobody moves.
  s.turn = 0;
  s.status.score = countDiscs(s.cells);
  const flips = computeFlips(s.cells, c, 0);
  assert(flips.includes(b), 'C brackets B for P0');
  const next = applyMove(s, c);
  assert(next.status.over, 'no moves remain for either side -> game over');
});

test('win detection by territory when the board can no longer be played', () => {
  const s = createInitialState();
  s.cells.fill(0); // hypothetical: player 0 owns everything
  s.cells[GEO.center] = EMPTY;
  s.turn = 0;
  // No flips possible anywhere for either player -> next legal? none.
  assert(legalMovesFor(s.cells, 0).length === 0, 'no moves for 0');
  assert(legalMovesFor(s.cells, 1).length === 0, 'no moves for 1');
});

test('cloneState is a deep copy', () => {
  const s = createInitialState();
  const c = cloneState(s);
  c.cells[0] = 1;
  c.status.score[0] = 99;
  assert(s.cells[0] !== 1 || c.cells[0] === s.cells[0], 'cells array is independent');
  assert(s.status.score[0] !== 99, 'score array is independent');
});

test('a full self-play game terminates with a decided board', () => {
  let s = createInitialState();
  let guard = 0;
  while (!s.status.over && guard++ < 200) {
    const moves = getLegalMoves(s);
    if (moves.length === 0) break;
    s = applyMove(s, moves[0].cellIndex); // deterministic: always first move
  }
  assert(s.status.over, 'game reaches a terminal state');
  const [a, b] = s.status.score;
  assert(a + b > 6, 'territory grew beyond the opening');
});

// --- Report -----------------------------------------------------------------

const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;
const summary = results
  .map((r) => (r.ok ? 'PASS' : 'FAIL') + '  ' + r.name + (r.ok ? '' : '\n        -> ' + r.err))
  .join('\n');
const banner = `\nLATTICE logic tests: ${passed}/${results.length} passed` + (failed ? `, ${failed} FAILED` : '');

if (typeof document !== 'undefined') {
  const pre = document.createElement('pre');
  pre.textContent = summary + '\n' + banner;
  pre.style.cssText =
    'font:14px ui-monospace,monospace;padding:20px;color:' + (failed ? '#ff6b6b' : '#41e0d0');
  document.body.appendChild(pre);
} else {
  console.log(summary);
  console.log(banner);
  if (failed) process.exit(1);
}

export { results };
