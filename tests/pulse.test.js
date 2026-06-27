// =============================================================================
// PULSE - engine tests (plain JS assertions, no framework)
//   Node:    node tests/pulse.test.js
//   Browser: open tests/index.html through a static server
//
// Covers: deterministic chart generation, timing-window judging, miss
// resolution + health, scoring/combo, adaptive difficulty, and win/lose.
// =============================================================================

import {
  createEngine,
  start,
  update,
  pressLane,
  adapt,
  accuracy,
  LANES,
  WINDOW,
  MAX_HP,
  TRAVEL_MS,
} from '../src/games/pulse/engine.js';

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

test('chart generation is deterministic for a given seed', () => {
  const a = start(createEngine({ difficulty: 'medium', seed: 42 }), 0);
  const b = start(createEngine({ difficulty: 'medium', seed: 42 }), 0);
  eq(a.notes.length, b.notes.length, 'same note count');
  for (let i = 0; i < a.notes.length; i++) {
    eq(a.notes[i].lane, b.notes[i].lane, 'same lane @' + i);
    eq(a.notes[i].time, b.notes[i].time, 'same time @' + i);
  }
  // Different seed should (very likely) differ somewhere.
  const c = start(createEngine({ difficulty: 'medium', seed: 99 }), 0);
  const differs = c.notes.some((n, i) => !a.notes[i] || n.lane !== a.notes[i].lane);
  assert(differs, 'different seed yields a different chart');
});

test('notes lead in: every generated note has a positive future time', () => {
  const s = start(createEngine({ seed: 1 }), 0);
  assert(s.notes.length > 0, 'notes were generated');
  assert(s.notes[0].time >= TRAVEL_MS - 1, 'first note leads in by the travel time');
  assert(s.notes.every((n) => n.lane >= 0 && n.lane < LANES), 'lanes in range');
});

test('a press on a note time scores a PERFECT and damages the enemy', () => {
  const s = start(createEngine({ seed: 1 }), 0);
  const note = s.notes[0];
  const before = s.enemyHP;
  const j = pressLane(s, note.lane, note.time); // exactly on time
  eq(j.result, 'perfect', 'perfect on exact timing');
  assert(s.enemyHP < before, 'enemy took damage');
  eq(s.combo, 1, 'combo started');
});

test('a press inside the GOOD but outside PERFECT window scores GOOD', () => {
  const s = start(createEngine({ seed: 2 }), 0);
  const note = s.notes[0];
  const off = (WINDOW.PERFECT + WINDOW.GOOD) / 2; // between the two windows
  const j = pressLane(s, note.lane, note.time + off);
  eq(j.result, 'good', 'good when slightly off');
});

test('a press with no note in range is empty and breaks combo', () => {
  const s = start(createEngine({ seed: 3 }), 0);
  // Build a combo first.
  const n0 = s.notes[0];
  pressLane(s, n0.lane, n0.time);
  assert(s.combo === 1, 'combo is 1');
  // Press a lane with nothing near the current time.
  const emptyLane = (n0.lane + 2) % LANES;
  const j = pressLane(s, emptyLane, n0.time + 5000); // far from any note in that lane
  eq(j.result, 'empty', 'empty press');
  eq(s.combo, 0, 'combo broken');
});

test('a note that falls past the window is a miss and damages the player', () => {
  const s = start(createEngine({ seed: 4 }), 0);
  const note = s.notes[0];
  const before = s.playerHP;
  // Advance the clock well past the note without pressing.
  const events = update(s, note.time + WINDOW.GOOD + 50);
  assert(note.judged && note.result === 'miss', 'note marked missed');
  assert(s.playerHP < before, 'player took damage');
  assert(events.some((e) => e.type === 'miss'), 'miss event emitted');
});

test('winning: depleting enemy HP ends the match as a win', () => {
  const s = start(createEngine({ seed: 5 }), 0);
  s.enemyHP = 4; // one perfect normal hit (4 dmg) finishes it
  const note = s.notes.find((n) => n.type === 'normal') || s.notes[0];
  pressLane(s, note.lane, note.time);
  assert(s.status.over && s.status.win === true, 'win recorded');
});

test('losing: depleting player HP ends the match as a loss', () => {
  const s = start(createEngine({ seed: 6 }), 0);
  s.playerHP = 5; // a single normal miss (7 dmg) finishes it
  const note = s.notes[0];
  update(s, note.time + WINDOW.GOOD + 50);
  assert(s.status.over && s.status.win === false, 'loss recorded');
});

test('adaptive AI: strong play raises tempo, weak play lowers it', () => {
  const up = start(createEngine({ difficulty: 'medium', seed: 8 }), 0);
  up.beatCursor = 8; // trigger an adaptation cycle
  up.recent = new Array(12).fill(true); // perfect recent accuracy
  const bpmBefore = up.bpm;
  adapt(up);
  assert(up.bpm > bpmBefore, 'tempo increased after strong play');

  const down = start(createEngine({ difficulty: 'medium', seed: 8 }), 0);
  down.beatCursor = 8;
  down.recent = new Array(12).fill(false); // all misses
  const dBefore = down.bpm;
  adapt(down);
  assert(down.bpm < dBefore, 'tempo decreased after weak play');
});

test('accuracy reflects hits over total judgements', () => {
  const s = start(createEngine({ seed: 9 }), 0);
  eq(accuracy(s), 1, 'no judgements => 1');
  const n = s.notes[0];
  pressLane(s, n.lane, n.time);
  assert(accuracy(s) > 0, 'accuracy positive after a hit');
  eq(s.maxHP, MAX_HP, 'max HP constant exposed');
});

// --- Report -----------------------------------------------------------------

const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;
const summary = results
  .map((r) => (r.ok ? 'PASS' : 'FAIL') + '  ' + r.name + (r.ok ? '' : '\n        -> ' + r.err))
  .join('\n');
const banner = `\nPULSE engine tests: ${passed}/${results.length} passed` + (failed ? `, ${failed} FAILED` : '');

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
