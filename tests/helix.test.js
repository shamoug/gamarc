// =============================================================================
// HELIX - engine tests (plain JS assertions, no framework)
//   Node:    node tests/helix.test.js
//   Browser: open tests/index.html through a static server
//
// Covers: deterministic setup, no instant matches at start, swap, match/clear +
// scoring, gravity, cascading chains, the rising board + cursor follow, and
// overflow game-over.
// =============================================================================

import {
  createEngine,
  start,
  update,
  swap,
  moveCursor,
  nudge,
  findMatches,
  applyGravity,
  resolve,
  COLS,
  ROWS,
  EMPTY,
  COLORS,
  INITIAL_ROWS,
} from '../src/games/helix/engine.js';

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
function countTiles(grid) {
  let n = 0;
  for (const row of grid) for (const v of row) if (v !== EMPTY) n++;
  return n;
}

// --- Tests ------------------------------------------------------------------

test('setup is deterministic and seeds the bottom rows only', () => {
  const a = createEngine({ seed: 5 });
  const b = createEngine({ seed: 5 });
  eq(JSON.stringify(a.grid), JSON.stringify(b.grid), 'same seed -> same board');
  eq(countTiles(a.grid), INITIAL_ROWS * COLS, 'exactly the bottom rows are filled');
  // Top rows empty.
  assert(a.grid[0].every((v) => v === EMPTY), 'top row empty');
  const c = createEngine({ seed: 9 });
  assert(JSON.stringify(c.grid) !== JSON.stringify(a.grid), 'different seed -> different board');
});

test('initial board has no pre-existing matches', () => {
  for (let s = 0; s < 8; s++) {
    const e = createEngine({ seed: 100 + s });
    assert(findMatches(e.grid) === null, 'no instant match for seed ' + (100 + s));
  }
});

test('findMatches detects horizontal and vertical runs of 3+', () => {
  const e = createEngine({ seed: 1 });
  // Clear the grid and plant a horizontal triple.
  e.grid = Array.from({ length: ROWS }, () => new Array(COLS).fill(EMPTY));
  e.grid[ROWS - 1][0] = 2;
  e.grid[ROWS - 1][1] = 2;
  e.grid[ROWS - 1][2] = 2;
  const m = findMatches(e.grid);
  assert(m && m[ROWS - 1][0] && m[ROWS - 1][1] && m[ROWS - 1][2], 'horizontal triple marked');
});

test('applyGravity compacts a column to the bottom', () => {
  const grid = Array.from({ length: ROWS }, () => new Array(COLS).fill(EMPTY));
  grid[0][0] = 1;
  grid[5][0] = 2;
  applyGravity(grid);
  eq(grid[ROWS - 1][0], 2, 'lower tile ends on the floor');
  eq(grid[ROWS - 2][0], 1, 'upper tile stacks above it');
  eq(grid[0][0], EMPTY, 'top emptied');
});

test('a swap that forms a triple clears it and scores', () => {
  const e = createEngine({ seed: 1 });
  start(e, 0);
  e.grid = Array.from({ length: ROWS }, () => new Array(COLS).fill(EMPTY));
  const r = ROWS - 1;
  // X X . Y  -> swapping (r,2)&(r,3) brings the third X together? Set up:
  // Put X at 0,1 and 3; Y at 2. Swap col 2<->3 makes X,X,X at 0,1,2.
  e.grid[r][0] = 1;
  e.grid[r][1] = 1;
  e.grid[r][2] = 2;
  e.grid[r][3] = 1;
  const before = e.score;
  const res = swap(e, r, 2);
  assert(res.swapped, 'swap happened');
  eq(res.cleared, 3, 'three tiles cleared');
  assert(e.score > before, 'score increased');
  assert(e.grid[r][0] === EMPTY && e.grid[r][1] === EMPTY && e.grid[r][2] === EMPTY, 'triple removed');
});

test('cascades increase the chain count', () => {
  const e = createEngine({ seed: 1 });
  start(e, 0);
  const g = Array.from({ length: ROWS }, () => new Array(COLS).fill(EMPTY));
  const r = ROWS - 1;
  // Chain 1: the three 1s on the floor line up and clear.
  g[r][0] = 1; g[r][1] = 1; g[r][2] = 1;
  // Two 2s sit directly above cols 0,1; a third 2 is suspended one row higher in
  // col 2. They are NOT aligned yet. After the 1s clear, all three 2s fall to
  // the floor and form a new triple -> chain 2.
  g[r - 1][0] = 2; g[r - 1][1] = 2;
  g[r - 2][2] = 2;
  e.grid = g;
  const res = resolve(e);
  assert(res.chain >= 2, 'at least a 2-chain cascade (got ' + res.chain + ')');
  eq(res.cleared, 6, 'both trios cleared');
});

test('moveCursor stays in bounds (col limited to COLS-2)', () => {
  const e = createEngine({ seed: 1 });
  start(e, 0);
  for (let i = 0; i < 20; i++) moveCursor(e, -1, 1);
  eq(e.cursor.row, 0, 'row clamped at top');
  eq(e.cursor.col, COLS - 2, 'col clamped so the pair fits');
});

test('the board rises over time, shifting tiles up and following the cursor', () => {
  const e = createEngine({ seed: 2, difficulty: 'hard' });
  start(e, 0);
  const topBefore = e.grid[ROWS - INITIAL_ROWS].slice();
  const curRowBefore = e.cursor.row;
  const events = update(e, 100000); // long jump -> several rises
  assert(events.some((ev) => ev.type === 'rise'), 'rise events emitted');
  assert(e.cursor.row < curRowBefore, 'cursor followed the rise upward');
  assert(countTiles(e.grid) > INITIAL_ROWS * COLS, 'new rows were added');
});

test('overflow ends the game', () => {
  const e = createEngine({ seed: 2 });
  start(e, 0);
  // Force a tile into the top row, then commit a rise via a big time jump.
  e.grid[0][0] = 1;
  const events = update(e, 100000);
  assert(e.status.over, 'game over on overflow');
  assert(events.some((ev) => ev.type === 'gameover'), 'gameover event emitted');
});

test('nudge advances rise progress', () => {
  const e = createEngine({ seed: 1 });
  start(e, 0);
  const before = e.riseProgress;
  nudge(e, 0.3);
  assert(e.riseProgress > before, 'nudge increased rise progress');
});

// --- Report -----------------------------------------------------------------

const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;
const summary = results
  .map((r) => (r.ok ? 'PASS' : 'FAIL') + '  ' + r.name + (r.ok ? '' : '\n        -> ' + r.err))
  .join('\n');
const banner = `\nHELIX engine tests: ${passed}/${results.length} passed` + (failed ? `, ${failed} FAILED` : '');

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
