// =============================================================================
// VECTOR - Pure game logic
// -----------------------------------------------------------------------------
// A momentum dueling game on an open grid arena. Each craft has a position and
// a velocity. On your turn you choose an acceleration (dx,dy each in {-1,0,1});
// your velocity changes by it (clamped to MAX_SPEED) and you move by the new
// velocity in a straight line. Fly off the arena and you crash (you lose). If
// your path crosses the opponent's cell you ram them for damage that scales with
// your impact speed. Deplete the opponent — or make them crash — to win.
//
// DOM-free and deterministic; unit-tested in /tests. applyMove() never mutates
// its input.
// =============================================================================

/** Arena side length (cells indexed 0..SIZE-1). */
export const SIZE = 15;

/** Maximum magnitude of either velocity component. */
export const MAX_SPEED = 3;

/** Starting hull integrity per craft. */
export const MAX_HP = 24;

/** Ram damage = RAM_BASE + impactSpeed * RAM_SCALE. */
export const RAM_BASE = 6;
export const RAM_SCALE = 4;

/** Hard ply cap so a duel always terminates (higher HP wins; tie = draw). */
export const MAX_PLY = 80;

/** Symmetric start: facing each other across the arena, at rest. */
export const START = Object.freeze([
  { x: 3, y: 7, vx: 0, vy: 0 },
  { x: 11, y: 7, vx: 0, vy: 0 },
]);

/** The nine accelerations, as {ax, ay} with components in {-1,0,1}. */
export const ACCELS = Object.freeze(
  [-1, 0, 1].flatMap((ay) => [-1, 0, 1].map((ax) => ({ ax, ay }))),
);

const clampSpeed = (v) => Math.max(-MAX_SPEED, Math.min(MAX_SPEED, v));
const inBounds = (x, y) => x >= 0 && y >= 0 && x < SIZE && y < SIZE;

// --- State construction -----------------------------------------------------

/** @returns {VectorState} */
export function createInitialState() {
  return {
    craft: START.map((c) => ({ ...c, hp: MAX_HP })),
    turn: 0,
    ply: 0,
    status: { over: false, winner: null, reason: '' },
    lastEvent: null,
  };
}

export function cloneState(state) {
  return {
    craft: state.craft.map((c) => ({ ...c })),
    turn: state.turn,
    ply: state.ply,
    status: { ...state.status },
    lastEvent: state.lastEvent
      ? { ...state.lastEvent, path: state.lastEvent.path ? state.lastEvent.path.map((p) => [...p]) : null }
      : null,
  };
}

// --- Geometry ---------------------------------------------------------------

/**
 * Integer (Bresenham) line cells from (x0,y0) to (x1,y1), EXCLUDING the start
 * and INCLUDING the end. Empty if start === end. Used for the swept path.
 */
export function lineCells(x0, y0, x1, y1) {
  const cells = [];
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0;
  let y = y0;
  // Guard against pathological loops.
  for (let guard = 0; guard < SIZE * 4; guard++) {
    if (!(x === x0 && y === y0)) cells.push([x, y]);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
  return cells;
}

function pathHits(path, ox, oy) {
  return path.some(([x, y]) => x === ox && y === oy);
}

export function chebyshev(ax, ay, bx, by) {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

// --- Move preview & generation ----------------------------------------------

/**
 * Resolve what an acceleration would do for the player to move, without
 * applying it. Pure helper shared by the UI (ghost targets) and the AI.
 * @returns {{ax,ay, nvx,nvy, nx,ny, crash:boolean, ram:boolean, damage:number, lethal:boolean, path:number[][], speed:number}}
 */
export function previewMove(state, accel) {
  const me = state.craft[state.turn];
  const opp = state.craft[state.turn === 0 ? 1 : 0];
  const nvx = clampSpeed(me.vx + accel.ax);
  const nvy = clampSpeed(me.vy + accel.ay);
  const nx = me.x + nvx;
  const ny = me.y + nvy;
  const crash = !inBounds(nx, ny);
  const path = crash ? lineCells(me.x, me.y, clamp01(nx), clamp01(ny)) : lineCells(me.x, me.y, nx, ny);
  const speed = Math.max(Math.abs(nvx), Math.abs(nvy));
  let ram = false;
  let damage = 0;
  let lethal = false;
  if (!crash && speed > 0 && pathHits(path, opp.x, opp.y)) {
    ram = true;
    damage = RAM_BASE + speed * RAM_SCALE;
    lethal = opp.hp - damage <= 0;
  }
  return { ax: accel.ax, ay: accel.ay, nvx, nvy, nx, ny, crash, ram, damage, lethal, path, speed };
}

const clamp01 = (n) => Math.max(0, Math.min(SIZE - 1, n));

/** All nine accelerations are legal actions (some lead to a crash). */
export function getLegalMoves(state) {
  if (state.status.over) return [];
  return ACCELS.map((a) => ({ ...a }));
}

// --- Applying moves ---------------------------------------------------------

function finalizePlyCap(state) {
  if (state.status.over || state.ply < MAX_PLY) return;
  const [a, b] = state.craft;
  state.status = {
    over: true,
    winner: a.hp > b.hp ? 0 : b.hp > a.hp ? 1 : null,
    reason:
      a.hp === b.hp ? 'Time up — hull integrity tied' : `Time up — Player ${(a.hp > b.hp ? 0 : 1) + 1} has more hull`,
  };
}

/**
 * Apply an acceleration for the player to move.
 * @param {VectorState} prev
 * @param {{ax:number, ay:number}} accel
 * @returns {VectorState}
 */
export function applyMove(prev, accel) {
  if (prev.status.over) throw new Error('Game is already over');
  if (Math.abs(accel.ax) > 1 || Math.abs(accel.ay) > 1) throw new Error('Illegal acceleration');

  const state = cloneState(prev);
  const player = state.turn;
  const other = player === 0 ? 1 : 0;
  const me = state.craft[player];
  const opp = state.craft[other];

  const nvx = clampSpeed(me.vx + accel.ax);
  const nvy = clampSpeed(me.vy + accel.ay);
  const nx = me.x + nvx;
  const ny = me.y + nvy;

  if (!inBounds(nx, ny)) {
    state.lastEvent = { type: 'crash', player, from: [me.x, me.y], to: [nx, ny], path: lineCells(me.x, me.y, clamp01(nx), clamp01(ny)), damage: 0 };
    state.status = { over: true, winner: other, reason: `Player ${player + 1} flew off the arena` };
    state.turn = other;
    state.ply += 1;
    return state;
  }

  const path = lineCells(me.x, me.y, nx, ny);
  me.x = nx;
  me.y = ny;
  me.vx = nvx;
  me.vy = nvy;

  const speed = Math.max(Math.abs(nvx), Math.abs(nvy));
  let event = { type: 'move', player, from: [prev.craft[player].x, prev.craft[player].y], to: [nx, ny], path, damage: 0 };

  if (speed > 0 && pathHits(path, opp.x, opp.y)) {
    const damage = RAM_BASE + speed * RAM_SCALE;
    opp.hp -= damage;
    event = { ...event, type: 'ram', damage, target: other };
    if (opp.hp <= 0) {
      opp.hp = 0;
      state.status = { over: true, winner: player, reason: `Player ${player + 1} rammed the enemy hull to zero` };
    }
  }

  state.lastEvent = event;
  state.turn = other;
  state.ply += 1;
  finalizePlyCap(state);
  return state;
}

/**
 * @typedef {Object} Craft
 * @property {number} x @property {number} y
 * @property {number} vx @property {number} vy
 * @property {number} hp
 *
 * @typedef {Object} VectorState
 * @property {Craft[]} craft
 * @property {number} turn
 * @property {number} ply
 * @property {{over:boolean, winner:(number|null), reason:string}} status
 * @property {Object|null} lastEvent
 */
