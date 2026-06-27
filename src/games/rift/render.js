// =============================================================================
// RIFT - Canvas 2D rendering
// -----------------------------------------------------------------------------
// Draws both planes at once: the Real plane fills each cell; Rift-plane pieces
// are drawn translucent, outlined and tucked into the cell corner so the board
// is always readable without toggling. A plane-emphasis mode dims the other
// plane on request. Lightweight tween animations cover move/capture/phase and
// the ring collapse.
// =============================================================================

import {
  BOARD_SIZE,
  PLANE,
  PIECE,
  ringLevel,
  isAlive,
  getCollapseInfo,
} from './rules.js';
import { easeInOut, clamp } from '../../shared/helpers.js';

const PALETTES = {
  aurora: {
    bg: '#070b14',
    grid: '#16263b',
    cellA: '#0c1626',
    cellB: '#0a1320',
    dead: '#05080d',
    riftCell: '#0e1d2e',
    p0: '#41e0d0',
    p0dark: '#1c6f68',
    p1: '#f25f8a',
    p1dark: '#7a2842',
    text: '#dce8f5',
    legal: '#5bd6ff',
    capture: '#ff5a6e',
    warn: '#ffb347',
    select: '#ffffff',
  },
  amber: {
    bg: '#0d0a06',
    grid: '#2e2412',
    cellA: '#1a140a',
    cellB: '#150f07',
    dead: '#080603',
    riftCell: '#241a0c',
    p0: '#ffcf5c',
    p0dark: '#8a6c1c',
    p1: '#6ec1ff',
    p1dark: '#2a5a85',
    text: '#f2e6cf',
    legal: '#ffe08a',
    capture: '#ff6a4d',
    warn: '#ff8c42',
    select: '#ffffff',
  },
};

const MOVE_MS = 220;
const PHASE_MS = 300;
const CAPTURE_MS = 280;
const COLLAPSE_MS = 600;

export class Renderer {
  constructor(canvas, theme = 'aurora') {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.theme = PALETTES[theme] ? theme : 'aurora';
    this.size = 560;
    this.margin = 18;
    this.dpr = window.devicePixelRatio || 1;
    this.emphasis = null; // null | PLANE.REAL | PLANE.RIFT
    this.anims = []; // active animations
    this.resize(this.size);
  }

  get palette() {
    return PALETTES[this.theme];
  }

  setTheme(theme) {
    if (PALETTES[theme]) this.theme = theme;
  }

  resize(cssSize) {
    this.size = cssSize;
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = cssSize * this.dpr;
    this.canvas.height = cssSize * this.dpr;
    this.canvas.style.width = cssSize + 'px';
    this.canvas.style.height = cssSize + 'px';
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.cell = (cssSize - this.margin * 2) / BOARD_SIZE;
  }

  // --- Geometry ------------------------------------------------------------

  cellOrigin(row, col) {
    return {
      x: this.margin + col * this.cell,
      y: this.margin + row * this.cell,
    };
  }

  cellCenter(row, col) {
    const o = this.cellOrigin(row, col);
    return { x: o.x + this.cell / 2, y: o.y + this.cell / 2 };
  }

  /** Map a CSS-pixel point to a board cell, or null. */
  pointToCell(px, py) {
    const col = Math.floor((px - this.margin) / this.cell);
    const row = Math.floor((py - this.margin) / this.cell);
    if (row < 0 || col < 0 || row >= BOARD_SIZE || col >= BOARD_SIZE) return null;
    return { row, col };
  }

  // --- Animations ----------------------------------------------------------

  startMoveAnim(pieceId, from, to, now) {
    this.anims.push({ kind: 'move', pieceId, from, to, start: now, dur: MOVE_MS });
  }
  startPhaseAnim(pieceId, now) {
    this.anims.push({ kind: 'phase', pieceId, start: now, dur: PHASE_MS });
  }
  startCaptureAnim(row, col, now) {
    this.anims.push({ kind: 'capture', row, col, start: now, dur: CAPTURE_MS });
  }
  startCollapseAnim(level, now) {
    this.anims.push({ kind: 'collapse', level, start: now, dur: COLLAPSE_MS });
  }

  _active(kind, now) {
    return this.anims.filter((a) => a.kind === kind && now - a.start < a.dur);
  }
  isAnimating(now) {
    return this.anims.some((a) => now - a.start < a.dur);
  }
  _prune(now) {
    this.anims = this.anims.filter((a) => now - a.start < a.dur);
  }

  // --- Main draw -----------------------------------------------------------

  /**
   * @param {GameState} state
   * @param {object} view  { selectedId, legalCells:[{row,col,capture}], hintPlaneSwap }
   * @param {number} now   performance.now()
   */
  draw(state, view, now) {
    this._prune(now);
    const ctx = this.ctx;
    const pal = this.palette;
    ctx.clearRect(0, 0, this.size, this.size);
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, this.size, this.size);

    const info = getCollapseInfo(state);
    this._drawCells(state, info, now);
    this._drawHighlights(state, view);
    this._drawPieces(state, view, now);
    this._drawCaptureFx(now);
  }

  _drawCells(state, info, now) {
    const ctx = this.ctx;
    const pal = this.palette;
    const collapseAnims = this._active('collapse', now);

    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const o = this.cellOrigin(r, c);
        const alive = isAlive(r, c, state.collapseLevel);
        const lvl = ringLevel(r, c);

        if (!alive) {
          ctx.fillStyle = pal.dead;
          ctx.fillRect(o.x, o.y, this.cell, this.cell);
          continue;
        }

        // Base cell (checker).
        ctx.fillStyle = (r + c) % 2 === 0 ? pal.cellA : pal.cellB;
        ctx.fillRect(o.x, o.y, this.cell, this.cell);

        // A faint inset to suggest the Rift layer beneath.
        ctx.strokeStyle = pal.riftCell;
        ctx.lineWidth = 1;
        ctx.strokeRect(o.x + 4, o.y + 4, this.cell - 8, this.cell - 8);

        // Collapse warning: outermost live ring, one round before it goes.
        if (info.warning && lvl === info.warningRingLevel) {
          const pulse = 0.5 + 0.5 * Math.sin(now / 180);
          ctx.strokeStyle = pal.warn;
          ctx.globalAlpha = 0.5 + 0.5 * pulse;
          ctx.lineWidth = 3;
          ctx.strokeRect(o.x + 2, o.y + 2, this.cell - 4, this.cell - 4);
          ctx.globalAlpha = 1;
        }

        // Collapse flash on cells that just died.
        for (const a of collapseAnims) {
          if (ringLevel(r, c) === a.level - 1) {
            const t = (now - a.start) / a.dur;
            ctx.fillStyle = pal.capture;
            ctx.globalAlpha = (1 - t) * 0.7;
            ctx.fillRect(o.x, o.y, this.cell, this.cell);
            ctx.globalAlpha = 1;
          }
        }

        // Grid line.
        ctx.strokeStyle = pal.grid;
        ctx.lineWidth = 1;
        ctx.strokeRect(o.x, o.y, this.cell, this.cell);
      }
    }
  }

  _drawHighlights(state, view) {
    const ctx = this.ctx;
    const pal = this.palette;
    if (view.selectedId != null) {
      const sel = state.pieces.find((p) => p.id === view.selectedId);
      if (sel) {
        const o = this.cellOrigin(sel.row, sel.col);
        ctx.strokeStyle = pal.select;
        ctx.lineWidth = 3;
        ctx.strokeRect(o.x + 2, o.y + 2, this.cell - 4, this.cell - 4);
      }
    }
    for (const cellEntry of view.legalCells || []) {
      const ctr = this.cellCenter(cellEntry.row, cellEntry.col);
      ctx.beginPath();
      if (cellEntry.capture) {
        ctx.strokeStyle = pal.capture;
        ctx.lineWidth = 3;
        ctx.arc(ctr.x, ctr.y, this.cell * 0.42, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = pal.legal;
        ctx.globalAlpha = 0.85;
        ctx.arc(ctr.x, ctr.y, this.cell * 0.14, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }

  _drawPieces(state, view, now) {
    const moveAnims = this._active('move', now);
    const phaseAnims = this._active('phase', now);
    const animatingIds = new Set(moveAnims.map((a) => a.pieceId));

    // Draw Rift-plane pieces first (so Real sits on top in shared cells).
    const order = [...state.pieces].sort((a, b) => a.plane - b.plane);
    for (const p of order) {
      if (animatingIds.has(p.id)) continue; // drawn by the move tween
      const phaseAnim = phaseAnims.find((a) => a.pieceId === p.id);
      const ctr = this.cellCenter(p.row, p.col);
      this._drawPiece(p, ctr.x, ctr.y, 1, phaseAnim ? (now - phaseAnim.start) / phaseAnim.dur : null);
    }

    // Moving pieces last, at their interpolated position.
    for (const a of moveAnims) {
      const p = state.pieces.find((pp) => pp.id === a.pieceId);
      if (!p) continue;
      const t = easeInOut(clamp((now - a.start) / a.dur, 0, 1));
      const fc = this.cellCenter(a.from.row, a.from.col);
      const tc = this.cellCenter(a.to.row, a.to.col);
      const x = fc.x + (tc.x - fc.x) * t;
      const y = fc.y + (tc.y - fc.y) * t;
      this._drawPiece(p, x, y, 1, null);
    }
  }

  _drawPiece(p, x, y, scale, phaseT) {
    const ctx = this.ctx;
    const pal = this.palette;
    const isReal = p.plane === PLANE.REAL;
    const base = p.owner === 0 ? pal.p0 : pal.p1;
    const dark = p.owner === 0 ? pal.p0dark : pal.p1dark;

    // Emphasis dimming.
    let alpha = 1;
    if (this.emphasis !== null) {
      alpha = p.plane === this.emphasis ? 1 : 0.28;
    } else {
      alpha = isReal ? 1 : 0.62;
    }

    // Real pieces sit centred & full size; Rift pieces are smaller, tucked
    // toward the lower-right corner, dashed-outlined and translucent.
    let cx = x;
    let cy = y;
    let radius = this.cell * 0.34 * scale;
    if (!isReal) {
      cx = x + this.cell * 0.18;
      cy = y + this.cell * 0.18;
      radius = this.cell * 0.2 * scale;
    }

    // Phase animation: scale-pop the piece.
    if (phaseT !== null) {
      const pop = 1 + Math.sin(phaseT * Math.PI) * 0.35;
      radius *= pop;
    }

    ctx.save();
    ctx.globalAlpha = alpha;

    if (p.type === PIECE.CORE) {
      this._drawCore(cx, cy, radius * 1.05, base, dark);
    } else {
      // Body.
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = isReal ? base : 'transparent';
      if (isReal) ctx.fill();
      ctx.lineWidth = isReal ? 2 : 2;
      if (!isReal) ctx.setLineDash([4, 3]);
      ctx.strokeStyle = base;
      ctx.stroke();
      ctx.setLineDash([]);

      // Inner ring for depth.
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 0.62, 0, Math.PI * 2);
      ctx.strokeStyle = dark;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Glyph.
    const glyph = { runner: 'R', shifter: 'S', guard: 'G', core: '' }[p.type];
    if (glyph) {
      ctx.fillStyle = isReal ? pal.bg : base;
      ctx.font = `bold ${Math.round(radius * 1.05)}px "Segoe UI", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(glyph, cx, cy + 1);
    }

    ctx.restore();
  }

  _drawCore(x, y, r, base, dark) {
    const ctx = this.ctx;
    // Four-point star / diamond to mark the Core.
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r * 0.4, y);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x - r * 0.4, y);
    ctx.closePath();
    ctx.moveTo(x - r, y);
    ctx.lineTo(x, y - r * 0.4);
    ctx.lineTo(x + r, y);
    ctx.lineTo(x, y + r * 0.4);
    ctx.closePath();
    ctx.fillStyle = base;
    ctx.fill();
    ctx.strokeStyle = dark;
    ctx.lineWidth = 2;
    ctx.stroke();
    // Core glow dot.
    ctx.beginPath();
    ctx.arc(x, y, r * 0.28, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
  }

  _drawCaptureFx(now) {
    const ctx = this.ctx;
    const pal = this.palette;
    for (const a of this._active('capture', now)) {
      const t = (now - a.start) / a.dur;
      const ctr = this.cellCenter(a.row, a.col);
      ctx.beginPath();
      ctx.strokeStyle = pal.capture;
      ctx.globalAlpha = 1 - t;
      ctx.lineWidth = 3;
      ctx.arc(ctr.x, ctr.y, this.cell * 0.2 + t * this.cell * 0.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
}
