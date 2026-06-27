// =============================================================================
// VECTOR - logic tests (plain JS assertions, no framework)
//   Node:    node tests/vector.test.js
//   Browser: open tests/index.html through a static server
//
// Covers: momentum/clamping, the swept-path line, ramming (direct + pass
// through) with speed-scaled damage, crashing off the arena, win-by-KO,
// and the ply-cap tiebreak.
// =============================================================================

import {
  createInitialState,
  applyMove,
  getLegalMoves,
  previewMove,
  lineCells,
  cloneState,
  SIZE,
  MAX_SPEED,
  MAX_HP,
  RAM_BASE,
  RAM_SCALE,
  MAX_PLY,
} from '../src/games/vector/rules.js';

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

// --- Tests ------------------------------------------------------------------

test('initial state: two craft at rest, full hull, 9 legal accels', () => {
  const s = createInitialState();
  eq(s.craft.length, 2, 'two craft');
  assert(s.craft.every((c) => c.hp === MAX_HP && c.vx === 0 && c.vy === 0), 'at rest, full hull');
  eq(getLegalMoves(s).length, 9, 'nine accelerations');
  eq(s.turn, 0, 'player 0 first');
});

test('coasting at rest does not move and passes the turn', () => {
  const s = createInitialState();
  const p = { ...s.craft[0] };
  const next = applyMove(s, { ax: 0, ay: 0 });
  eq(next.craft[0].x, p.x, 'x unchanged');
  eq(next.craft[0].y, p.y, 'y unchanged');
  eq(next.turn, 1, 'turn passes');
});

test('acceleration changes velocity then position; speed clamps to MAX_SPEED', () => {
  const s = createInitialState();
  s.craft[0] = { x: 5, y: 5, vx: MAX_SPEED, vy: 0, hp: MAX_HP };
  const next = applyMove(s, { ax: 1, ay: 0 }); // would exceed MAX_SPEED
  eq(next.craft[0].vx, MAX_SPEED, 'vx clamped');
  eq(next.craft[0].x, 5 + MAX_SPEED, 'moved by clamped velocity');
});

test('lineCells excludes the start and includes the end', () => {
  const cells = lineCells(2, 2, 5, 2);
  assert(!cells.some(([x, y]) => x === 2 && y === 2), 'start excluded');
  assert(cells.some(([x, y]) => x === 5 && y === 2), 'end included');
  eq(cells.length, 3, '(3,2),(4,2),(5,2)');
});

test('direct ram: landing on the opponent deals speed-scaled damage', () => {
  const s = createInitialState();
  s.craft[0] = { x: 5, y: 7, vx: 1, vy: 0, hp: MAX_HP };
  s.craft[1] = { x: 7, y: 7, vx: 0, vy: 0, hp: MAX_HP };
  const next = applyMove(s, { ax: 1, ay: 0 }); // v ->(2,0), lands on (7,7)
  eq(next.lastEvent.type, 'ram', 'ram event');
  eq(next.craft[1].hp, MAX_HP - (RAM_BASE + 2 * RAM_SCALE), 'damage = base + speed*scale');
});

test('pass-through ram: sweeping over the opponent cell also hits', () => {
  const s = createInitialState();
  s.craft[0] = { x: 5, y: 7, vx: 2, vy: 0, hp: MAX_HP };
  s.craft[1] = { x: 7, y: 7, vx: 0, vy: 0, hp: MAX_HP };
  const next = applyMove(s, { ax: 1, ay: 0 }); // v ->(3,0): 6->7->8, passes (7,7)
  eq(next.craft[0].x, 8, 'flew past to (8,7)');
  eq(next.lastEvent.type, 'ram', 'still rams while passing through');
  eq(next.craft[1].hp, MAX_HP - (RAM_BASE + 3 * RAM_SCALE), 'speed-3 damage');
});

test('crashing off the arena ends the game for the opponent', () => {
  const s = createInitialState();
  s.craft[0] = { x: SIZE - 2, y: 7, vx: 2, vy: 0, hp: MAX_HP };
  const next = applyMove(s, { ax: 0, ay: 0 }); // v stays (2,0): x -> SIZE (out)
  eq(next.lastEvent.type, 'crash', 'crash event');
  assert(next.status.over, 'game over');
  eq(next.status.winner, 1, 'opponent wins on a crash');
});

test('win by KO: a lethal ram ends the game', () => {
  const s = createInitialState();
  s.craft[0] = { x: 5, y: 7, vx: 1, vy: 0, hp: MAX_HP };
  s.craft[1] = { x: 7, y: 7, vx: 0, vy: 0, hp: 5 }; // fragile
  const next = applyMove(s, { ax: 1, ay: 0 });
  assert(next.status.over && next.status.winner === 0, 'player 0 wins by KO');
  eq(next.craft[1].hp, 0, 'hull clamped to zero');
});

test('previewMove flags crash, ram and lethality without mutating state', () => {
  const s = createInitialState();
  s.craft[0] = { x: 5, y: 7, vx: 1, vy: 0, hp: MAX_HP };
  s.craft[1] = { x: 7, y: 7, vx: 0, vy: 0, hp: 5 };
  const p = previewMove(s, { ax: 1, ay: 0 });
  assert(p.ram && p.lethal, 'previews a lethal ram');
  eq(s.craft[1].hp, 5, 'state untouched by preview');
  const edge = createInitialState();
  edge.craft[0] = { x: SIZE - 1, y: 7, vx: 1, vy: 0, hp: MAX_HP };
  assert(previewMove(edge, { ax: 0, ay: 0 }).crash, 'previews a crash');
});

test('ply cap ends the duel with the higher-hull craft winning', () => {
  const s = createInitialState();
  s.ply = MAX_PLY - 1;
  s.craft[0].hp = 20;
  s.craft[1].hp = 10;
  const next = applyMove(s, { ax: 0, ay: 0 }); // ply reaches the cap
  assert(next.status.over, 'over at the cap');
  eq(next.status.winner, 0, 'more hull wins');
});

test('cloneState is a deep copy', () => {
  const s = createInitialState();
  const c = cloneState(s);
  c.craft[0].x = 99;
  assert(s.craft[0].x !== 99, 'craft array is independent');
});

// --- Report -----------------------------------------------------------------

const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;
const summary = results
  .map((r) => (r.ok ? 'PASS' : 'FAIL') + '  ' + r.name + (r.ok ? '' : '\n        -> ' + r.err))
  .join('\n');
const banner = `\nVECTOR logic tests: ${passed}/${results.length} passed` + (failed ? `, ${failed} FAILED` : '');

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
