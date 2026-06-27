// =============================================================================
// QUANTA - Pure puzzle engine
// -----------------------------------------------------------------------------
// A light-routing puzzle in the "Infinity Loop / Pipes" lineage. The board is a
// grid of conduit tiles; one tile is the SOURCE (an emitter) and every dead-end
// tile is a TARGET crystal. Rotating tiles re-routes the conduits. The puzzle is
// solved when every conduit edge connects to a matching neighbour (no loose ends
// pointing at a wall or an empty edge) — which, because the solved layout is a
// spanning tree, means the light reaches every crystal.
//
// DOM-free and deterministic: all randomness comes from a seeded RNG, so a given
// seed produces the same solvable board every time and the whole engine is
// unit-testable without a browser.
// =============================================================================

// Edge bitmask: a tile's `mask` is an OR of the directions it opens onto.
export const N = 1;
export const E = 2;
export const S = 4;
export const W = 8;
export const DIRS = [N, E, S, W];

/** Row/col delta for a single direction bit. */
export function delta(bit) {
  if (bit === N) return [-1, 0];
  if (bit === E) return [0, 1];
  if (bit === S) return [1, 0];
  return [0, -1]; // W
}

/** The opposing edge of a direction bit (N<->S, E<->W). */
export function opposite(bit) {
  if (bit === N) return S;
  if (bit === S) return N;
  if (bit === E) return W;
  return E; // W
}

/** Rotate a mask 90° clockwise (N->E->S->W->N). */
export function rotateCW(mask) {
  return ((mask << 1) | (mask >> 3)) & 0b1111;
}

/** Number of open edges in a mask (1 = terminal, 2 = line/elbow, etc.). */
export function popcount(mask) {
  let n = 0;
  for (const d of DIRS) if (mask & d) n++;
  return n;
}

/** Grid sizes per difficulty (square boards keep mobile layout simple). */
export const DIFFICULTY = Object.freeze({
  easy: { name: 'Easy', size: 5 },
  medium: { name: 'Medium', size: 6 },
  hard: { name: 'Hard', size: 7 },
});

// Seedable RNG (mulberry32) — matches the other games' generator.
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
 * Carve a random spanning tree (perfect maze) over the grid with a randomised
 * depth-first backtracker. Every cell is visited and linked, so the resulting
 * conduit network is fully connected with no loops.
 * @returns {number[]} flat array of solved masks, length size*size
 */
function buildTree(size, rng) {
  const masks = new Array(size * size).fill(0);
  const visited = new Array(size * size).fill(false);
  const idx = (r, c) => r * size + c;
  const sr = Math.floor(rng() * size);
  const sc = Math.floor(rng() * size);
  const stack = [[sr, sc]];
  visited[idx(sr, sc)] = true;

  while (stack.length) {
    const [r, c] = stack[stack.length - 1];
    const opts = [];
    for (const d of DIRS) {
      const [dr, dc] = delta(d);
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
      if (!visited[idx(nr, nc)]) opts.push([d, nr, nc]);
    }
    if (opts.length === 0) {
      stack.pop();
      continue;
    }
    const [d, nr, nc] = opts[Math.floor(rng() * opts.length)];
    masks[idx(r, c)] |= d;
    masks[idx(nr, nc)] |= opposite(d);
    visited[idx(nr, nc)] = true;
    stack.push([nr, nc]);
  }
  return masks;
}

/**
 * @param {{difficulty?:string, seed?:number}} opts
 */
export function createEngine({ difficulty = 'medium', seed = 31 } = {}) {
  const cfg = DIFFICULTY[difficulty] || DIFFICULTY.medium;
  const size = cfg.size;
  const rng = makeRng(seed);
  const solved = buildTree(size, rng);

  // Source = the first terminal (degree-1) cell in scan order; every other
  // terminal becomes a target crystal to light up.
  let source = 0;
  for (let i = 0; i < solved.length; i++) {
    if (popcount(solved[i]) === 1) {
      source = i;
      break;
    }
  }
  const targets = [];
  for (let i = 0; i < solved.length; i++) {
    if (i !== source && popcount(solved[i]) === 1) targets.push(i);
  }

  // Scramble: rotate every cell a random amount. Guarantee the board does not
  // start already solved (re-roll one off if a degenerate seed lands solved).
  const cur = solved.slice();
  const rot = new Array(solved.length).fill(0);
  for (let i = 0; i < cur.length; i++) {
    const turns = Math.floor(rng() * 4);
    rot[i] = turns;
    for (let t = 0; t < turns; t++) cur[i] = rotateCW(cur[i]);
  }

  const state = {
    difficulty,
    cfg,
    size,
    seed,
    solved, // target masks (a connected spanning tree)
    cur, // current masks (solved, rotated by `rot`)
    rot, // current clockwise rotation count per cell (0..3)
    source,
    targets,
    moves: 0,
    par: 0,
    status: { over: false, win: false },
  };
  // Avoid a board that is already solved at t=0 (degenerate seeds).
  if (isSolved(state)) rotateAt(state, source);
  state.par = computePar(state);
  return state;
}

const idx2 = (state, r, c) => r * state.size + c;

/** Minimum clockwise taps to bring every cell to a solved orientation. */
export function computePar(state) {
  let total = 0;
  for (let i = 0; i < state.cur.length; i++) {
    let m = state.cur[i];
    for (let k = 0; k < 4; k++) {
      if (m === state.solved[i]) {
        total += k;
        break;
      }
      m = rotateCW(m);
    }
  }
  return total;
}

/** Rotate the tile at flat index `i` one quarter-turn clockwise. */
function rotateAt(state, i) {
  state.cur[i] = rotateCW(state.cur[i]);
  state.rot[i] = (state.rot[i] + 1) % 4;
}

/**
 * Player action: rotate the tile at (r,c) clockwise. Counts a move and
 * re-checks the win condition. Returns { rotated, win }.
 */
export function rotate(state, r, c) {
  if (state.status.over) return { rotated: false, win: false };
  if (r < 0 || r >= state.size || c < 0 || c >= state.size) return { rotated: false, win: false };
  rotateAt(state, idx2(state, r, c));
  state.moves++;
  const win = isSolved(state);
  if (win) state.status = { over: true, win: true };
  return { rotated: true, win };
}

/**
 * True when every open edge connects to a matching neighbour edge and none
 * point off the board. On a spanning-tree layout this also means the whole
 * network is connected and powered.
 */
export function isSolved(state) {
  const { size, cur } = state;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const mask = cur[idx2(state, r, c)];
      for (const d of DIRS) {
        if (!(mask & d)) continue;
        const [dr, dc] = delta(d);
        const nr = r + dr;
        const nc = c + dc;
        if (nr < 0 || nr >= size || nc < 0 || nc >= size) return false; // loose end at wall
        if (!(cur[idx2(state, nr, nc)] & opposite(d))) return false; // unmatched edge
      }
    }
  }
  return true;
}

/**
 * Flood the light from the source through matched edges. Returns a boolean
 * array (flat) marking which cells are currently powered — used for the glow.
 */
export function computeLit(state) {
  const { size, cur, source } = state;
  const lit = new Array(size * size).fill(false);
  const queue = [source];
  lit[source] = true;
  while (queue.length) {
    const i = queue.pop();
    const r = Math.floor(i / size);
    const c = i % size;
    const mask = cur[i];
    for (const d of DIRS) {
      if (!(mask & d)) continue;
      const [dr, dc] = delta(d);
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
      const ni = nr * size + nc;
      if (lit[ni]) continue;
      if (cur[ni] & opposite(d)) {
        lit[ni] = true;
        queue.push(ni);
      }
    }
  }
  return lit;
}

/** How many target crystals are currently powered. */
export function litTargets(state, lit = computeLit(state)) {
  let n = 0;
  for (const t of state.targets) if (lit[t]) n++;
  return n;
}
