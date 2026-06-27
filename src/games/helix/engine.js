// =============================================================================
// HELIX - Pure puzzle engine
// -----------------------------------------------------------------------------
// A DNA-themed swap-match puzzle (Panel de Pon / Tetris Attack lineage). The
// board rises from the bottom over time; you swap two horizontally adjacent
// cells (the "two strands") to line up 3+ matching nucleotides, which splice out
// and let the stack above cascade into chains. The stack reaching the top ends
// the run — a race against the shifting board.
//
// DOM-free and deterministic: time-driven functions take an explicit `now`, and
// all randomness comes from a seeded RNG, so a given seed + input sequence is
// fully reproducible and unit-testable without a browser.
// =============================================================================

export const COLS = 6;
export const ROWS = 12;
export const INITIAL_ROWS = 5; // filled rows at the bottom on start
export const COLORS = 5; // nucleotide types (0..4)
export const EMPTY = -1;
export const MATCH_LEN = 3;

const CLEAR_BASE = 10;

/** Rise rate (cells per second) and how it ramps, per difficulty. */
export const DIFFICULTY = Object.freeze({
  easy: { name: 'Easy', rise: 0.1, ramp: 0.35 },
  medium: { name: 'Medium', rise: 0.17, ramp: 0.6 },
  hard: { name: 'Hard', rise: 0.27, ramp: 0.9 },
});

// Seedable RNG (mulberry32).
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

function emptyGrid() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(EMPTY));
}

/**
 * Pick a colour for (r,c) that avoids completing a 3-run with the two cells to
 * the left and the two cells below (already-filled when building bottom-up).
 */
function pickColor(grid, r, c, rng) {
  const forbidden = new Set();
  if (c >= 2 && grid[r][c - 1] === grid[r][c - 2] && grid[r][c - 1] !== EMPTY) forbidden.add(grid[r][c - 1]);
  if (r + 2 < ROWS && grid[r + 1][c] === grid[r + 2][c] && grid[r + 1][c] !== EMPTY) forbidden.add(grid[r + 1][c]);
  let color;
  do {
    color = Math.floor(rng() * COLORS);
  } while (forbidden.has(color));
  return color;
}

/** Generate the next incoming bottom row, avoiding cheap instant matches. */
function generateRow(grid, rng) {
  const row = new Array(COLS).fill(EMPTY);
  for (let c = 0; c < COLS; c++) {
    const forbidden = new Set();
    if (c >= 2 && row[c - 1] === row[c - 2]) forbidden.add(row[c - 1]);
    // Avoid a vertical triple with the two rows that will sit directly above it.
    if (grid[ROWS - 1][c] === grid[ROWS - 2][c] && grid[ROWS - 1][c] !== EMPTY) forbidden.add(grid[ROWS - 1][c]);
    let color;
    do {
      color = Math.floor(rng() * COLORS);
    } while (forbidden.has(color));
    row[c] = color;
  }
  return row;
}

/**
 * @param {{difficulty?:string, seed?:number}} opts
 */
export function createEngine({ difficulty = 'medium', seed = 11 } = {}) {
  const cfg = DIFFICULTY[difficulty] || DIFFICULTY.medium;
  const rng = makeRng(seed);
  const grid = emptyGrid();
  // Fill the bottom INITIAL_ROWS, building upward so pickColor sees what's below.
  for (let r = ROWS - 1; r >= ROWS - INITIAL_ROWS; r--) {
    for (let c = 0; c < COLS; c++) grid[r][c] = pickColor(grid, r, c, rng);
  }
  const state = {
    difficulty,
    cfg,
    seed,
    rng,
    grid,
    nextRow: generateRow(grid, rng),
    cursor: { row: ROWS - 3, col: Math.floor((COLS - 2) / 2) },
    started: false,
    startTime: 0,
    lastUpdate: 0,
    elapsed: 0,
    riseProgress: 0,
    score: 0,
    chains: 0,
    maxChain: 0,
    cleared: 0,
    status: { over: false, reason: '' },
  };
  return state;
}

export function start(state, now) {
  state.started = true;
  state.startTime = now;
  state.lastUpdate = now;
  return state;
}

// --- Grid mechanics (pure on the grid) --------------------------------------

/** Mark all cells in horizontal/vertical runs of MATCH_LEN+, or null if none. */
export function findMatches(grid) {
  const marked = Array.from({ length: ROWS }, () => new Array(COLS).fill(false));
  let any = false;

  // Horizontal.
  for (let r = 0; r < ROWS; r++) {
    let start = 0;
    for (let c = 1; c <= COLS; c++) {
      const same = c < COLS && grid[r][c] !== EMPTY && grid[r][c] === grid[r][start];
      if (!same) {
        if (grid[r][start] !== EMPTY && c - start >= MATCH_LEN) {
          for (let k = start; k < c; k++) {
            marked[r][k] = true;
            any = true;
          }
        }
        start = c;
      }
    }
  }
  // Vertical.
  for (let c = 0; c < COLS; c++) {
    let start = 0;
    for (let r = 1; r <= ROWS; r++) {
      const same = r < ROWS && grid[r][c] !== EMPTY && grid[r][c] === grid[start][c];
      if (!same) {
        if (grid[start][c] !== EMPTY && r - start >= MATCH_LEN) {
          for (let k = start; k < r; k++) {
            marked[k][c] = true;
            any = true;
          }
        }
        start = r;
      }
    }
  }
  return any ? marked : null;
}

/** Compact each column downward so tiles rest on the bottom. */
export function applyGravity(grid) {
  for (let c = 0; c < COLS; c++) {
    let write = ROWS - 1;
    for (let r = ROWS - 1; r >= 0; r--) {
      if (grid[r][c] !== EMPTY) {
        const v = grid[r][c];
        grid[r][c] = EMPTY;
        grid[write][c] = v;
        write--;
      }
    }
  }
}

/**
 * Resolve all matches and cascades on the current grid, scoring as it goes.
 * Mutates state.grid/score/etc. Returns { cleared, chain, clearedCells }.
 */
export function resolve(state) {
  let chain = 0;
  let total = 0;
  const clearedCells = [];
  while (true) {
    const marked = findMatches(state.grid);
    if (!marked) break;
    chain++;
    let step = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (marked[r][c]) {
          clearedCells.push({ row: r, col: c, color: state.grid[r][c] });
          state.grid[r][c] = EMPTY;
          step++;
        }
      }
    }
    total += step;
    state.score += step * CLEAR_BASE * chain;
    applyGravity(state.grid);
  }
  if (total > 0) {
    state.cleared += total;
    state.chains++;
    state.maxChain = Math.max(state.maxChain, chain);
  }
  return { cleared: total, chain, clearedCells };
}

// --- Player actions ---------------------------------------------------------

export function moveCursor(state, dRow, dCol) {
  if (!state.started || state.status.over) return;
  state.cursor.row = Math.max(0, Math.min(ROWS - 1, state.cursor.row + dRow));
  state.cursor.col = Math.max(0, Math.min(COLS - 2, state.cursor.col + dCol));
}

/**
 * Swap the two horizontally adjacent cells at (row, col)/(row, col+1), then let
 * gravity settle and resolve any matches/cascades. Returns the resolve result
 * plus { swapped, from } or { swapped:false } if out of bounds.
 */
export function swap(state, row, col) {
  if (!state.started || state.status.over) return { swapped: false };
  if (row < 0 || row >= ROWS || col < 0 || col >= COLS - 1) return { swapped: false };
  const a = state.grid[row][col];
  const b = state.grid[row][col + 1];
  if (a === EMPTY && b === EMPTY) return { swapped: false };
  state.grid[row][col] = b;
  state.grid[row][col + 1] = a;
  applyGravity(state.grid);
  const res = resolve(state);
  return { swapped: true, from: { row, col }, ...res };
}

// --- Time / rising board ----------------------------------------------------

function riseRate(state) {
  // cells/sec, ramping with elapsed minutes.
  return state.cfg.rise + state.cfg.ramp * (state.elapsed / 60000);
}

/** Commit one risen row: shift everything up and add a new bottom row. */
function commitRise(state, events) {
  // Overflow: a tile already in the top row means the stack hits the ceiling.
  for (let c = 0; c < COLS; c++) {
    if (state.grid[0][c] !== EMPTY) {
      state.status = { over: true, reason: 'The strand reached the top' };
      events.push({ type: 'gameover' });
      return;
    }
  }
  for (let r = 0; r < ROWS - 1; r++) state.grid[r] = state.grid[r + 1];
  state.grid[ROWS - 1] = state.nextRow;
  state.nextRow = generateRow(state.grid, state.rng);
  state.cursor.row = Math.max(0, state.cursor.row - 1);
  events.push({ type: 'rise' });
  const res = resolve(state);
  if (res.cleared > 0) events.push({ type: 'clear', ...res });
}

/**
 * Advance the rising board by real elapsed time. Returns transient events
 * (rise / clear / gameover) for the renderer + audio.
 */
export function update(state, now) {
  if (!state.started || state.status.over) return [];
  const dt = now - state.lastUpdate;
  state.lastUpdate = now;
  state.elapsed = now - state.startTime;
  state.riseProgress += riseRate(state) * (dt / 1000);

  const events = [];
  let guard = 0;
  while (state.riseProgress >= 1 && !state.status.over && guard++ < ROWS) {
    state.riseProgress -= 1;
    commitRise(state, events);
  }
  if (state.status.over) state.riseProgress = 0;
  return events;
}

/** Manually nudge the board up (strategic speed-up). */
export function nudge(state, amount = 0.34) {
  if (!state.started || state.status.over) return;
  state.riseProgress += amount;
}

/**
 * @typedef {Object} HelixState
 * @property {number[][]} grid   ROWS x COLS, EMPTY | 0..COLORS-1 (row 0 = top)
 * @property {number[]} nextRow  the incoming bottom row (preview)
 * @property {{row:number,col:number}} cursor  left cell of the 2-wide swap pair
 * @property {number} riseProgress  0..1 toward the next committed row
 * @property {{over:boolean, reason:string}} status
 */
