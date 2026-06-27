// =============================================================================
// QUANTA - Canvas 2D rendering
// -----------------------------------------------------------------------------
// Draws the grid of conduit tiles: each tile is a set of rounded "spokes" from
// its centre to the open edges. Powered conduits glow with the accent colour and
// animate; unpowered ones sit dim. The source is a pulsing emitter, targets are
// crystals that ignite once lit. Smooth per-tile rotation is interpolated so a
// tap visibly spins the tile rather than snapping.
// =============================================================================

import { DIRS, N, E, S, W, delta, computeLit } from './engine.js';

const PALETTES = {
  aurora: {
    bg: '#070b14',
    cell: '#0c1626',
    cellLit: '#0e1d33',
    grid: '#16263b',
    wireOff: '#33465f',
    wireOn: '#41e0d0',
    glow: '#41e0d0',
    source: '#ffcf5c',
    sourceGlow: '#ffd86b',
    target: '#6b7790',
    targetOn: '#f25f8a',
    targetGlow: '#ff7ea6',
    hub: '#dce8f5',
  },
  amber: {
    bg: '#0c0a05',
    cell: '#171008',
    cellLit: '#241808',
    grid: '#2e2412',
    wireOff: '#5a4a2c',
    wireOn: '#ffcf5c',
    glow: '#ffcf5c',
    source: '#6ec1ff',
    sourceGlow: '#9bd4ff',
    target: '#8c7a52',
    targetOn: '#ff8c42',
    targetGlow: '#ffb07a',
    hub: '#f2e6cf',
  },
};

const ROT_MS = 130; // tile spin duration

export class Renderer {
  constructor(canvas, theme = 'aurora') {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.theme = PALETTES[theme] ? theme : 'aurora';
    this.dpr = window.devicePixelRatio || 1;
    this.size = 6;
    this.anim = new Map(); // flatIndex -> { from, start } animated rotation (radians)
    this.solveT = 0; // 0..1 solve celebration ramp
    this.resize(560);
  }

  get palette() {
    return PALETTES[this.theme];
  }
  setTheme(t) {
    if (PALETTES[t]) this.theme = t;
  }

  resize(cssSize) {
    this.dpr = window.devicePixelRatio || 1;
    this.w = cssSize;
    this.h = cssSize;
    this.canvas.width = Math.round(cssSize * this.dpr);
    this.canvas.height = Math.round(cssSize * this.dpr);
    this.canvas.style.width = cssSize + 'px';
    this.canvas.style.height = cssSize + 'px';
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.margin = Math.max(10, cssSize * 0.03);
  }

  configure(size) {
    this.size = size;
    this.cell = (this.w - this.margin * 2) / size;
  }

  cellX(c) {
    return this.margin + c * this.cell;
  }
  cellY(r) {
    return this.margin + r * this.cell;
  }

  /** Map a pixel (canvas-local) to a grid cell, or null if outside the board. */
  pointToCell(px, py) {
    const c = Math.floor((px - this.margin) / this.cell);
    const r = Math.floor((py - this.margin) / this.cell);
    if (r < 0 || r >= this.size || c < 0 || c >= this.size) return null;
    return { row: r, col: c };
  }

  /** Kick off a smooth spin animation for the tile that was just rotated. */
  spin(r, c, now) {
    const i = r * this.size + c;
    this.anim.set(i, { start: now });
  }

  draw(state, now) {
    this.configure(state.size);
    const ctx = this.ctx;
    const pal = this.palette;
    const lit = computeLit(state);

    if (state.status.win) this.solveT = Math.min(1, this.solveT + 0.04);
    else this.solveT = 0;

    ctx.clearRect(0, 0, this.w, this.h);
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, this.w, this.h);

    // Cell backdrops + subtle grid.
    for (let r = 0; r < state.size; r++) {
      for (let c = 0; c < state.size; c++) {
        const i = r * state.size + c;
        const x = this.cellX(c);
        const y = this.cellY(r);
        const pad = this.cell * 0.04;
        ctx.fillStyle = lit[i] ? pal.cellLit : pal.cell;
        this._round(x + pad, y + pad, this.cell - pad * 2, this.cell - pad * 2, this.cell * 0.16);
        ctx.fill();
        ctx.strokeStyle = pal.grid;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    // Conduits (two passes: dim wires first, glowing wires on top).
    for (let r = 0; r < state.size; r++) {
      for (let c = 0; c < state.size; c++) {
        this._tile(state, r, c, lit, now);
      }
    }
  }

  // --- One tile -------------------------------------------------------------

  _tile(state, r, c, lit, now) {
    const ctx = this.ctx;
    const pal = this.palette;
    const i = r * state.size + c;
    const mask = state.cur[i];
    const cx = this.cellX(c) + this.cell / 2;
    const cy = this.cellY(r) + this.cell / 2;
    const isLit = lit[i];
    const isSource = i === state.source;
    const isTarget = state.targets.includes(i);

    // Spin animation: rotate the whole tile drawing by an easing offset that
    // decays to zero, so the final orientation matches the engine mask.
    let spin = 0;
    const a = this.anim.get(i);
    if (a) {
      const t = (now - a.start) / ROT_MS;
      if (t >= 1) this.anim.delete(i);
      else spin = -(Math.PI / 2) * (1 - this._easeOut(t)); // start a quarter-turn back, settle to 0
    }

    ctx.save();
    ctx.translate(cx, cy);
    if (spin) ctx.rotate(spin);

    const reach = this.cell * 0.5;
    const wireW = Math.max(3, this.cell * 0.13);

    // Dim base wire.
    ctx.lineCap = 'round';
    ctx.lineWidth = wireW;
    ctx.strokeStyle = isLit ? pal.wireOn : pal.wireOff;
    if (isLit) {
      ctx.shadowColor = pal.glow;
      ctx.shadowBlur = this.cell * 0.28;
    }
    for (const d of DIRS) {
      if (!(mask & d)) continue;
      const [dr, dc] = delta(d);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(dc * reach, dr * reach);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;

    // Centre hub.
    if (!isSource && !isTarget) {
      ctx.beginPath();
      ctx.arc(0, 0, wireW * 0.62, 0, Math.PI * 2);
      ctx.fillStyle = isLit ? pal.wireOn : pal.wireOff;
      ctx.fill();
    }

    ctx.restore();

    // Source emitter + target crystals are drawn unrotated (they're terminals,
    // visually anchored) on top of the wire.
    if (isSource) this._source(cx, cy, now);
    else if (isTarget) this._target(cx, cy, isLit, now);
  }

  _source(cx, cy, now) {
    const ctx = this.ctx;
    const pal = this.palette;
    const pulse = 0.5 + 0.5 * Math.sin(now / 280);
    const rad = this.cell * 0.2;
    ctx.save();
    ctx.shadowColor = pal.sourceGlow;
    ctx.shadowBlur = this.cell * (0.3 + pulse * 0.25);
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fillStyle = pal.source;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(cx, cy, rad * 0.55, 0, Math.PI * 2);
    ctx.fillStyle = '#fffefa';
    ctx.globalAlpha = 0.85;
    ctx.fill();
    ctx.restore();
  }

  _target(cx, cy, isLit, now) {
    const ctx = this.ctx;
    const pal = this.palette;
    const rad = this.cell * (isLit ? 0.21 : 0.17);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.PI / 4 + (isLit ? Math.sin(now / 400) * 0.06 : 0));
    if (isLit) {
      ctx.shadowColor = pal.targetGlow;
      ctx.shadowBlur = this.cell * 0.35;
    }
    ctx.beginPath();
    ctx.rect(-rad, -rad, rad * 2, rad * 2);
    ctx.fillStyle = isLit ? pal.targetOn : pal.target;
    ctx.fill();
    ctx.shadowBlur = 0;
    if (isLit) {
      ctx.beginPath();
      ctx.rect(-rad * 0.4, -rad * 0.4, rad * 0.8, rad * 0.8);
      ctx.fillStyle = '#fff';
      ctx.globalAlpha = 0.85;
      ctx.fill();
    }
    ctx.restore();
  }

  _easeOut(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  _round(x, y, w, h, r) {
    const ctx = this.ctx;
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }
}
