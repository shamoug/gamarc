// =============================================================================
// QUANTA - engine tests (plain JS assertions, no framework)
//   Node:    node tests/quanta.test.js
//   Browser: open tests/index.html through a static server
//
// Covers: bit/rotation primitives, deterministic + solvable generation, the
// solved spanning-tree invariants, rotating to count moves & detect the win,
// light flooding from the source, and par computation.
// =============================================================================

import {
  createEngine,
  rotate,
  isSolved,
  computeLit,
  litTargets,
  computePar,
  rotateCW,
  opposite,
  popcount,
  delta,
  N,
  E,
  S,
  W,
  DIRS,
  DIFFICULTY,
} from '../src/games/quanta/engine.js';

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

/** Solve a board in place by rotating each cell to its solved orientation. */
function solveBoard(e) {
  for (let r = 0; r < e.size; r++) {
    for (let c = 0; c < e.size; c++) {
      const i = r * e.size + c;
      while (e.cur[i] !== e.solved[i]) rotate(e, r, c);
    }
  }
}

// --- Tests ------------------------------------------------------------------

test('rotateCW cycles a direction bit through N->E->S->W->N', () => {
  eq(rotateCW(N), E, 'N->E');
  eq(rotateCW(E), S, 'E->S');
  eq(rotateCW(S), W, 'S->W');
  eq(rotateCW(W), N, 'W->N');
  eq(rotateCW(rotateCW(rotateCW(rotateCW(N)))), N, 'four turns return to start');
  eq(rotateCW(N | S), E | W, 'a straight line rotates onto the other axis');
});

test('opposite and delta are consistent', () => {
  for (const d of DIRS) {
    eq(opposite(opposite(d)), d, 'opposite is an involution');
    const [dr, dc] = delta(d);
    const [or, oc] = delta(opposite(d));
    eq(dr + or, 0, 'opposite row deltas cancel');
    eq(dc + oc, 0, 'opposite col deltas cancel');
  }
  eq(popcount(N | E | S | W), 4, 'full cross has four edges');
  eq(popcount(0), 0, 'empty mask has none');
});

test('generation is deterministic for a given seed', () => {
  const a = createEngine({ seed: 7, difficulty: 'medium' });
  const b = createEngine({ seed: 7, difficulty: 'medium' });
  eq(JSON.stringify(a.cur), JSON.stringify(b.cur), 'same seed -> same scrambled board');
  eq(JSON.stringify(a.solved), JSON.stringify(b.solved), 'same seed -> same solution');
  const c = createEngine({ seed: 8, difficulty: 'medium' });
  assert(JSON.stringify(c.solved) !== JSON.stringify(a.solved), 'different seed -> different board');
});

test('board sizes follow difficulty', () => {
  eq(createEngine({ difficulty: 'easy' }).size, DIFFICULTY.easy.size, 'easy size');
  eq(createEngine({ difficulty: 'hard' }).size, DIFFICULTY.hard.size, 'hard size');
});

test('the solved layout is a fully-matched, connected spanning tree', () => {
  for (let s = 0; s < 8; s++) {
    const e = createEngine({ seed: 50 + s, difficulty: 'medium' });
    // Force current = solved and check the invariant.
    e.cur = e.solved.slice();
    assert(isSolved(e), 'solved layout passes isSolved for seed ' + (50 + s));
    // No cell is isolated (every cell has at least one edge).
    assert(e.cur.every((m) => popcount(m) >= 1), 'no isolated cell');
    // Light from the source reaches the whole board (connected tree).
    const lit = computeLit(e);
    assert(lit.every(Boolean), 'every cell powered when solved');
    eq(litTargets(e, lit), e.targets.length, 'all crystals lit when solved');
  }
});

test('a freshly generated board is not already solved', () => {
  for (let s = 0; s < 8; s++) {
    const e = createEngine({ seed: 200 + s });
    assert(!isSolved(e), 'scrambled board is unsolved for seed ' + (200 + s));
  }
});

test('source and targets are degree-1 terminals and disjoint', () => {
  const e = createEngine({ seed: 11, difficulty: 'medium' });
  eq(popcount(e.solved[e.source]), 1, 'source is a terminal');
  assert(e.targets.length >= 1, 'at least one target');
  assert(!e.targets.includes(e.source), 'source is not also a target');
  for (const t of e.targets) eq(popcount(e.solved[t]), 1, 'each target is a terminal');
});

test('rotate counts a move and rotating a cell four times is a no-op', () => {
  const e = createEngine({ seed: 3 });
  const before = e.cur[0];
  rotate(e, 0, 0);
  rotate(e, 0, 0);
  rotate(e, 0, 0);
  rotate(e, 0, 0);
  eq(e.moves, 4, 'four moves counted');
  eq(e.cur[0], before, 'mask back to original after four turns');
});

test('solving the board triggers the win and lights every crystal', () => {
  const e = createEngine({ seed: 21, difficulty: 'easy' });
  solveBoard(e);
  assert(e.status.win, 'win flagged after solving');
  assert(isSolved(e), 'isSolved true after solving');
  const lit = computeLit(e);
  eq(litTargets(e, lit), e.targets.length, 'all crystals lit');
});

test('rotations are ignored once the board is solved', () => {
  const e = createEngine({ seed: 22, difficulty: 'easy' });
  solveBoard(e);
  const moves = e.moves;
  const res = rotate(e, 0, 0);
  assert(!res.rotated, 'no rotation after game over');
  eq(e.moves, moves, 'move count unchanged');
});

test('computePar is zero exactly when the board is already solved', () => {
  const e = createEngine({ seed: 30 });
  assert(computePar(e) > 0, 'scrambled board needs > 0 turns');
  solveBoard(e);
  eq(computePar(e), 0, 'solved board needs 0 turns');
});

test('par never exceeds 3 turns per cell', () => {
  const e = createEngine({ seed: 31, difficulty: 'hard' });
  assert(e.par <= e.cur.length * 3, 'par within 3 turns per cell');
});

// --- Report -----------------------------------------------------------------

const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;
const summary = results
  .map((r) => (r.ok ? 'PASS' : 'FAIL') + '  ' + r.name + (r.ok ? '' : '\n        -> ' + r.err))
  .join('\n');
const banner = `\nQUANTA engine tests: ${passed}/${results.length} passed` + (failed ? `, ${failed} FAILED` : '');

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
