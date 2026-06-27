// =============================================================================
// LATTICE - Canvas 2D rendering (flat-top hex grid)
// -----------------------------------------------------------------------------
// Draws the hexagonal lattice, owned nodes with a glow, legal-move hints, a
// hover preview of which nodes a placement would convert, and a colour-morph
// animation when nodes flip.
// =============================================================================

import { GEO, RADIUS, EMPTY, computeFlips } from './rules.js';

const SQRT3 = Math.sqrt(3);

const PALETTES = {
  aurora: {
    bg: '#070b14',
    grid: '#1c2c44',
    empty: '#0c1626',
    p0: '#41e0d0',
    p1: '#f25f8a',
    text: '#dce8f5',
    hint: '#5bd6ff',
    preview: '#ffb347',
    last: '#ffffff',
  },
  amber: {
    bg: '#0c0a05',
    grid: '#2e2412',
    empty: '#1a140a',
    p0: '#ffcf5c',
    p1: '#6ec1ff',
    text: '#f2e6cf',
    hint: '#ffe08a',
    preview: '#ff8c42',
    last: '#ffffff',
  },
};

const FLIP_MS = 380;
const PLACE_MS = 280;

function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a, b, t) {
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(
    a[2] + (b[2] - a[2]) * t,
  )})`;
}

export class Renderer {
  constructor(canvas, theme = 'aurora') {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.theme = PALETTES[theme] ? theme : 'aurora';
    this.size = 1;
    this.margin = 22;
    this.dpr = window.devicePixelRatio || 1;
    this.anims = [];
    // Base (size-1) centres, used to compute fit + pixel positions.
    this._base = GEO.list.map(({ q, r }) => ({ x: 1.5 * q, y: SQRT3 * (r + q / 2) }));
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
    this.canvas.width = cssSize * this.dpr;
    this.canvas.height = cssSize * this.dpr;
    this.canvas.style.width = cssSize + 'px';
    this.canvas.style.height = cssSize + 'px';
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.cssSize = cssSize;

    // Fit the hexagon (centres + corner padding) into the square canvas.
    let maxX = 0;
    let maxY = 0;
    for (const p of this._base) {
      maxX = Math.max(maxX, Math.abs(p.x));
      maxY = Math.max(maxY, Math.abs(p.y));
    }
    const halfX = maxX + 1; // +1 size for a corner on the x axis
    const halfY = maxY + SQRT3 / 2; // +corner on the y axis
    const avail = cssSize / 2 - this.margin;
    this.size = avail / Math.max(halfX, halfY);
    this.ox = cssSize / 2;
    this.oy = cssSize / 2;
  }

  center(i) {
    return { x: this.ox + this._base[i].x * this.size, y: this.oy + this._base[i].y * this.size };
  }

  /** Map a CSS-pixel point to a cell index, or -1. */
  pointToCell(px, py) {
    const x = (px - this.ox) / this.size;
    const y = (py - this.oy) / this.size;
    const q = (2 / 3) * x;
    const r = (SQRT3 / 3) * y - (1 / 3) * x;
    // Cube rounding.
    let cx = q;
    let cz = r;
    let cy = -cx - cz;
    let rx = Math.round(cx);
    let ry = Math.round(cy);
    let rz = Math.round(cz);
    const dx = Math.abs(rx - cx);
    const dy = Math.abs(ry - cy);
    const dz = Math.abs(rz - cz);
    if (dx > dy && dx > dz) rx = -ry - rz;
    else if (dy > dz) ry = -rx - rz;
    else rz = -rx - ry;
    const idx = GEO.index.get(rx + ',' + rz);
    return idx === undefined ? -1 : idx;
  }

  // --- Animations ----------------------------------------------------------

  startMoveAnim(lastEvent, now) {
    if (!lastEvent || lastEvent.type !== 'move') return;
    this.anims.push({ kind: 'place', cell: lastEvent.cellIndex, start: now, dur: PLACE_MS });
    for (const f of lastEvent.flips) {
      this.anims.push({
        kind: 'flip',
        cell: f,
        from: lastEvent.player === 0 ? 1 : 0,
        to: lastEvent.player,
        start: now,
        dur: FLIP_MS,
      });
    }
  }
  isAnimating(now) {
    return this.anims.some((a) => now - a.start < a.dur);
  }
  _prune(now) {
    this.anims = this.anims.filter((a) => now - a.start < a.dur);
  }

  // --- Drawing -------------------------------------------------------------

  _hexPath(cx, cy, s) {
    const ctx = this.ctx;
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = (Math.PI / 3) * k; // flat-top: first corner at angle 0
      const x = cx + s * Math.cos(a);
      const y = cy + s * Math.sin(a);
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  /**
   * @param {LatticeState} state
   * @param {object} view  { legal:Set<number>, hover:number, lastMove:number, isHumanTurn:bool }
   * @param {number} now
   */
  draw(state, view, now) {
    this._prune(now);
    const ctx = this.ctx;
    const pal = this.palette;
    ctx.clearRect(0, 0, this.cssSize, this.cssSize);
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, this.cssSize, this.cssSize);

    const rgb = { 0: hexToRgb(pal.p0), 1: hexToRgb(pal.p1), empty: hexToRgb(pal.empty) };
    const flipMap = new Map();
    const placeSet = new Map();
    for (const a of this.anims) {
      const t = Math.min(1, (now - a.start) / a.dur);
      if (a.kind === 'flip') flipMap.set(a.cell, { t, from: a.from, to: a.to });
      else if (a.kind === 'place') placeSet.set(a.cell, t);
    }

    // Preview of a hovered legal placement.
    let previewFlips = null;
    if (view.isHumanTurn && view.hover >= 0 && view.legal.has(view.hover)) {
      previewFlips = new Set(computeFlips(state.cells, view.hover, state.turn));
    }

    for (let i = 0; i < state.cells.length; i++) {
      const c = this.center(i);
      const s = this.size * 0.94;
      this._hexPath(c.x, c.y, s);

      // Cell background.
      ctx.fillStyle = pal.empty;
      ctx.fill();
      ctx.strokeStyle = pal.grid;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      const owner = state.cells[i];

      // Node (owned cell) with optional flip morph.
      let drawOwner = owner;
      let nodeScale = 1;
      let fillColor = null;
      const flip = flipMap.get(i);
      if (flip) {
        fillColor = mix(rgb[flip.from], rgb[flip.to], flip.t);
        nodeScale = 0.85 + Math.abs(0.5 - flip.t) * 0.3; // squash through the middle
        drawOwner = 1; // ensure node is drawn
      } else if (owner !== EMPTY) {
        fillColor = `rgb(${rgb[owner].join(',')})`;
      }

      if (drawOwner !== EMPTY && fillColor) {
        const placeT = placeSet.get(i);
        const grow = placeT !== undefined ? 0.4 + 0.6 * placeT : 1;
        ctx.save();
        ctx.shadowColor = fillColor;
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(c.x, c.y, s * 0.55 * nodeScale * grow, 0, Math.PI * 2);
        ctx.fillStyle = fillColor;
        ctx.fill();
        ctx.restore();
      }

      // Preview: outline the placement and the nodes it would convert.
      if (previewFlips) {
        if (i === view.hover) {
          this._hexPath(c.x, c.y, s);
          ctx.strokeStyle = pal.preview;
          ctx.lineWidth = 3;
          ctx.stroke();
        } else if (previewFlips.has(i)) {
          ctx.beginPath();
          ctx.arc(c.x, c.y, s * 0.62, 0, Math.PI * 2);
          ctx.strokeStyle = pal.preview;
          ctx.lineWidth = 2;
          ctx.setLineDash([4, 3]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // Legal-move hint dots (human turn, not currently hovering this cell).
      if (view.isHumanTurn && owner === EMPTY && view.legal.has(i) && i !== view.hover) {
        ctx.beginPath();
        ctx.arc(c.x, c.y, s * 0.16, 0, Math.PI * 2);
        ctx.fillStyle = pal.hint;
        ctx.globalAlpha = 0.7 + 0.3 * Math.sin(now / 300);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // Last-move marker.
      if (i === view.lastMove && !flip) {
        ctx.beginPath();
        ctx.arc(c.x, c.y, s * 0.66, 0, Math.PI * 2);
        ctx.strokeStyle = pal.last;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }
}
