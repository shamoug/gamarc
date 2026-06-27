// =============================================================================
// HELIX - Canvas 2D rendering
// -----------------------------------------------------------------------------
// Draws the rising grid of nucleotide tiles (smoothly offset by riseProgress),
// the incoming preview row peeking up from the bottom, the two-wide swap cursor,
// a ceiling/danger indicator, clear sparks, and floating score/chain popups.
// =============================================================================

import { COLS, ROWS, EMPTY, COLORS } from './engine.js';

const LETTERS = ['A', 'T', 'C', 'G', 'U'];

const PALETTES = {
  aurora: {
    bg: '#070b14',
    cell: '#0b1422',
    grid: '#16263b',
    ceiling: '#5bd6ff',
    danger: '#ff5a6e',
    cursor: '#ffffff',
    text: '#06101c',
    popup: '#dce8f5',
    tiles: ['#ff7eb6', '#5bd6ff', '#7ce0a3', '#ffcf5c', '#9b7bff'],
  },
  amber: {
    bg: '#0c0a05',
    cell: '#171008',
    grid: '#2e2412',
    ceiling: '#ffe08a',
    danger: '#ff6a4d',
    cursor: '#ffffff',
    text: '#1a1205',
    popup: '#f2e6cf',
    tiles: ['#ff9e57', '#6ec1ff', '#9be38a', '#ffcf5c', '#c79bff'],
  },
};

const SPARK_MS = 360;
const POPUP_MS = 800;

export class Renderer {
  constructor(canvas, theme = 'aurora') {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.theme = PALETTES[theme] ? theme : 'aurora';
    this.dpr = window.devicePixelRatio || 1;
    this.sparks = [];
    this.popups = [];
    this.prog = 0;
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
    this.canvas.width = cssSize * this.dpr;
    this.canvas.height = cssSize * this.dpr;
    this.canvas.style.width = cssSize + 'px';
    this.canvas.style.height = cssSize + 'px';
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.margin = 16;
    this.cell = (cssSize - this.margin * 2) / ROWS;
    this.ox = (cssSize - COLS * this.cell) / 2;
    this.oy = this.margin;
  }

  cellX(c) {
    return this.ox + c * this.cell;
  }
  cellY(r) {
    return this.oy + r * this.cell - this.prog * this.cell;
  }

  /** Map a pixel to a grid cell using the current rise offset. */
  pointToCell(px, py) {
    const col = Math.floor((px - this.ox) / this.cell);
    const row = Math.floor((py - this.oy + this.prog * this.cell) / this.cell);
    if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return null;
    return { row, col };
  }

  markClears(cells, now) {
    for (const c of cells) this.sparks.push({ row: c.row, col: c.col, color: c.color, start: now });
  }
  popup(text, now) {
    this.popups.push({ text, start: now });
  }
  _prune(now) {
    this.sparks = this.sparks.filter((s) => now - s.start < SPARK_MS);
    this.popups = this.popups.filter((p) => now - p.start < POPUP_MS);
  }

  draw(state, now) {
    this._prune(now);
    this.prog = state.riseProgress;
    const ctx = this.ctx;
    const pal = this.palette;
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, this.w, this.h);

    const boardH = ROWS * this.cell;

    // Clip to the board so the preview row only shows its risen sliver.
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.ox, this.oy, COLS * this.cell, boardH);
    ctx.clip();

    // Empty-cell backdrop.
    ctx.fillStyle = pal.cell;
    ctx.fillRect(this.ox, this.oy, COLS * this.cell, boardH);

    // Grid lines.
    ctx.strokeStyle = pal.grid;
    ctx.lineWidth = 1;
    for (let c = 0; c <= COLS; c++) {
      ctx.beginPath();
      ctx.moveTo(this.ox + c * this.cell, this.oy);
      ctx.lineTo(this.ox + c * this.cell, this.oy + boardH);
      ctx.stroke();
    }

    // Tiles.
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (state.grid[r][c] !== EMPTY) this._tile(state.grid[r][c], this.cellX(c), this.cellY(r), 1);
      }
    }
    // Preview row rising into the bottom gap (dimmed).
    for (let c = 0; c < COLS; c++) {
      this._tile(state.nextRow[c], this.cellX(c), this.cellY(ROWS), 0.5);
    }

    // Clear sparks.
    for (const s of this.sparks) {
      const t = (now - s.start) / SPARK_MS;
      const x = this.cellX(s.col) + this.cell / 2;
      const y = this.cellY(s.row) + this.cell / 2;
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = pal.tiles[s.color] || '#fff';
      ctx.beginPath();
      ctx.arc(x, y, this.cell * (0.3 + t * 0.5), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Swap cursor (two cells wide).
    const cur = state.cursor;
    const cx = this.cellX(cur.col);
    const cy = this.cellY(cur.row);
    ctx.strokeStyle = pal.cursor;
    ctx.lineWidth = 3;
    this._round(cx + 2, cy + 2, this.cell * 2 - 4, this.cell - 4, 6);
    ctx.stroke();

    ctx.restore();

    // Ceiling line + danger glow (drawn over the clip edge).
    const danger = state.grid[0].some((v) => v !== EMPTY) || state.grid[1].some((v) => v !== EMPTY);
    ctx.strokeStyle = danger ? pal.danger : pal.ceiling;
    ctx.globalAlpha = danger ? 0.6 + 0.4 * Math.sin(now / 120) : 0.7;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(this.ox, this.oy);
    ctx.lineTo(this.ox + COLS * this.cell, this.oy);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Floating popups (score / chain), centred, rising and fading.
    for (const p of this.popups) {
      const t = (now - p.start) / POPUP_MS;
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = pal.popup;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `bold ${Math.round(this.cell * 0.7)}px "Segoe UI", system-ui, sans-serif`;
      ctx.fillText(p.text, this.w / 2, this.h * 0.4 - t * 40);
      ctx.globalAlpha = 1;
    }
  }

  _tile(color, x, y, alpha) {
    const ctx = this.ctx;
    const pal = this.palette;
    const fill = pal.tiles[color] || '#888';
    const pad = this.cell * 0.08;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.shadowColor = fill;
    ctx.shadowBlur = alpha >= 1 ? 8 : 0;
    this._round(x + pad, y + pad, this.cell - pad * 2, this.cell - pad * 2, this.cell * 0.22);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.shadowBlur = 0;
    // Nucleotide letter.
    ctx.fillStyle = pal.text;
    ctx.font = `bold ${Math.round(this.cell * 0.42)}px "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(LETTERS[color] || '?', x + this.cell / 2, y + this.cell / 2 + 1);
    ctx.restore();
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
