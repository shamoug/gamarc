// =============================================================================
// PULSE - Pure rhythm/combat engine
// -----------------------------------------------------------------------------
// DOM-free and time-driven: every function takes an explicit `now` (ms), so the
// engine is fully deterministic for a given seed + sequence of inputs and can be
// unit-tested without a browser or real clock.
//
// Notes fall on a steady beat grid toward a hit line. Hitting on time damages
// the enemy and builds combo; missed notes damage the player. An adaptive AI
// nudges the tempo and note density up when you play well and eases off when you
// struggle. Deplete the enemy to win; lose all health and you lose.
// =============================================================================

export const LANES = 4;

/** Timing windows (ms from a note's target time). */
export const WINDOW = Object.freeze({ PERFECT: 45, GOOD: 100 });

/** How far ahead (ms) notes are scheduled / how long they travel on screen. */
export const TRAVEL_MS = 2200;
const GEN_AHEAD_MS = TRAVEL_MS + 300;

/** Health and damage tunables. */
export const MAX_HP = 100;
const DAMAGE = Object.freeze({
  enemy: { perfect: 4, good: 2 },
  enemyHeavy: { perfect: 8, good: 4 },
  player: { normal: 7, heavy: 12 },
});

const HEAVY_EVERY = 8; // every Nth beat is a heavy (enemy attack) note
const SCORE_BASE = 100;

/** Adaptation: re-tune every N beats from the last K judgements. */
const ADAPT_EVERY_BEATS = 8;
const ADAPT_WINDOW = 12;

export const DIFFICULTY = Object.freeze({
  easy: { name: 'Easy', bpm: 84, density: 0.12, bpmMin: 70, bpmMax: 120, densityMax: 0.35 },
  medium: { name: 'Medium', bpm: 110, density: 0.34, bpmMin: 90, bpmMax: 165, densityMax: 0.6 },
  hard: { name: 'Hard', bpm: 132, density: 0.52, bpmMin: 110, bpmMax: 205, densityMax: 0.8 },
});

// Seedable RNG (mulberry32) so generated charts are reproducible per seed.
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

/**
 * Create a fresh engine state.
 * @param {{difficulty?:string, seed?:number}} opts
 */
export function createEngine({ difficulty = 'medium', seed = 7 } = {}) {
  const cfg = DIFFICULTY[difficulty] || DIFFICULTY.medium;
  return {
    difficulty,
    cfg,
    seed,
    rng: makeRng(seed),
    started: false,
    startTime: 0,
    clock: 0,
    bpm: cfg.bpm,
    density: cfg.density,
    beatMs: 60000 / cfg.bpm,
    notes: [],
    nextNoteId: 0,
    beatCursor: 0,
    nextBeatTime: TRAVEL_MS, // lead-in: first note enters the top at clock 0
    lastAdaptBeat: 0,
    playerHP: MAX_HP,
    enemyHP: MAX_HP,
    maxHP: MAX_HP,
    combo: 0,
    maxCombo: 0,
    score: 0,
    stats: { perfect: 0, good: 0, miss: 0, total: 0 },
    recent: [], // booleans: was each judged note hit?
    status: { over: false, win: null, reason: '' },
  };
}

/** Begin the clock. Notes already lead-in by TRAVEL_MS. */
export function start(state, now) {
  state.started = true;
  state.startTime = now;
  state.clock = 0;
  generate(state);
  return state;
}

function setClock(state, now) {
  state.clock = now - state.startTime;
}

function pushNote(state, lane, time, type) {
  state.notes.push({ id: state.nextNoteId++, lane, time, type, judged: false, result: null });
}

/** Generate beats until we're scheduled GEN_AHEAD_MS past the clock. */
export function generate(state) {
  if (!state.started || state.status.over) return;
  while (state.nextBeatTime <= state.clock + GEN_AHEAD_MS) {
    const t = state.nextBeatTime;
    const beat = state.beatCursor;
    const lane = Math.floor(state.rng() * LANES);
    const type = beat > 0 && beat % HEAVY_EVERY === 0 ? 'heavy' : 'normal';
    pushNote(state, lane, t, type);

    // Optional off-beat (eighth) note, density-controlled.
    if (state.rng() < state.density) {
      const lane2 = (lane + 1 + Math.floor(state.rng() * (LANES - 1))) % LANES;
      pushNote(state, lane2, t + state.beatMs / 2, 'normal');
    }

    state.beatCursor += 1;
    state.nextBeatTime += state.beatMs;
  }
}

function recordJudgement(state, hit, result) {
  state.stats.total += 1;
  if (result === 'perfect') state.stats.perfect += 1;
  else if (result === 'good') state.stats.good += 1;
  else if (result === 'miss') state.stats.miss += 1;
  state.recent.push(hit);
  if (state.recent.length > ADAPT_WINDOW) state.recent.shift();
}

function checkStatus(state) {
  if (state.status.over) return;
  if (state.enemyHP <= 0) {
    state.enemyHP = 0;
    state.status = { over: true, win: true, reason: 'Enemy pulse flatlined' };
  } else if (state.playerHP <= 0) {
    state.playerHP = 0;
    state.status = { over: true, win: false, reason: 'Your pulse flatlined' };
  }
}

/**
 * Register a lane press. Returns a judgement:
 *   { result:'perfect'|'good'|'empty', note?, diff? }
 * 'empty' means no note was in range (breaks combo, no health change).
 */
export function pressLane(state, lane, now) {
  if (!state.started || state.status.over) return { result: 'empty' };
  setClock(state, now);

  // Nearest un-judged note in this lane within the GOOD window.
  let best = null;
  let bestDiff = Infinity;
  for (const n of state.notes) {
    if (n.judged || n.lane !== lane) continue;
    const diff = Math.abs(n.time - state.clock);
    if (diff <= WINDOW.GOOD && diff < bestDiff) {
      best = n;
      bestDiff = diff;
    }
  }

  if (!best) {
    state.combo = 0; // mashing breaks combo
    return { result: 'empty' };
  }

  const result = bestDiff <= WINDOW.PERFECT ? 'perfect' : 'good';
  best.judged = true;
  best.result = result;

  const table = best.type === 'heavy' ? DAMAGE.enemyHeavy : DAMAGE.enemy;
  state.enemyHP -= table[result];
  state.combo += 1;
  state.maxCombo = Math.max(state.maxCombo, state.combo);
  const mult = 1 + Math.floor(state.combo / 10) * 0.5;
  state.score += Math.round(SCORE_BASE * (result === 'perfect' ? 1 : 0.5) * mult);

  recordJudgement(state, true, result);
  checkStatus(state);
  return { result, note: best, diff: bestDiff };
}

/**
 * Advance the simulation: generate upcoming notes, resolve notes that fell past
 * the hit window (misses), run periodic adaptation, and update status.
 * Returns transient events for the renderer/audio: [{type:'miss', note}].
 */
export function update(state, now) {
  if (!state.started || state.status.over) return [];
  setClock(state, now);
  generate(state);

  const events = [];
  const missCutoff = state.clock - WINDOW.GOOD;
  for (const n of state.notes) {
    if (!n.judged && n.time < missCutoff) {
      n.judged = true;
      n.result = 'miss';
      state.playerHP -= DAMAGE.player[n.type === 'heavy' ? 'heavy' : 'normal'];
      state.combo = 0;
      recordJudgement(state, false, 'miss');
      events.push({ type: 'miss', note: n });
    }
  }

  // Drop notes well past the line to keep the array small.
  const dropBefore = state.clock - 800;
  state.notes = state.notes.filter((n) => n.time >= dropBefore);

  adapt(state);
  checkStatus(state);
  return events;
}

/** Periodic difficulty adaptation based on recent accuracy. */
export function adapt(state) {
  if (state.beatCursor - state.lastAdaptBeat < ADAPT_EVERY_BEATS) return;
  state.lastAdaptBeat = state.beatCursor;
  if (state.recent.length < 4) return;

  const hits = state.recent.filter(Boolean).length;
  const acc = hits / state.recent.length;
  const cfg = state.cfg;

  if (acc > 0.85) {
    state.bpm = Math.min(cfg.bpmMax, state.bpm + 6);
    state.density = Math.min(cfg.densityMax, state.density + 0.05);
  } else if (acc < 0.5) {
    state.bpm = Math.max(cfg.bpmMin, state.bpm - 6);
    state.density = Math.max(0, state.density - 0.05);
  }
  state.beatMs = 60000 / state.bpm;
}

/** Overall accuracy 0..1 across the whole match. */
export function accuracy(state) {
  const t = state.stats.total;
  return t === 0 ? 1 : (state.stats.perfect + state.stats.good) / t;
}

/**
 * @typedef {Object} Note
 * @property {number} id
 * @property {number} lane
 * @property {number} time     target hit time in clock-ms
 * @property {string} type     'normal' | 'heavy'
 * @property {boolean} judged
 * @property {(string|null)} result
 */
