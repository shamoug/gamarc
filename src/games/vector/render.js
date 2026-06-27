// =============================================================================
// VECTOR - Canvas 2D rendering
// -----------------------------------------------------------------------------
// Open arena, two craft drawn as triangles oriented along their velocity, a
// velocity arrow showing where momentum carries them, nine "ghost" steering
// targets on the human's turn (colour-coded for ram / crash), a hovered swept
// path, hull bars, and slide/ram/crash animations.
// =============================================================================

import { SIZE, previewMove, ACCELS, MAX_HP } from './rules.js';
import { easeInOut, clamp } from '../../shared/helpers.js';

const PALETTES = {
  aurora: {
    bg: '#070b14',
    grid: '#13233a',
    cell: '#0b1422',
    wall: '#21344f',
    p0: '#41e0d0',
    p1: '#f25f8a',
    text: '#dce8f5',
    dim: '#7d8ba3',
    ram: '#ffb347',
    crash: '#ff5a6e',
    safe: '#5bd6ff',
  },
  amber: {
    bg: '#0c0a05',
    grid: '#2a2110',
    cell: '#171008',
    wall: '#3a2c13',
    p0: '#ffcf5c',
    p1: '#6ec1ff',
    text: '#f2e6cf',
    dim: '#a3917d',
    ram: '#ff8c42',
    crash: '#ff6a4d',
    safe: '#ffe08a',
  },
};

const MOVE_MS = 260;
const FX_MS = 420;

export class Renderer {
  constructor(canvas, theme = 'aurora') {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.theme = PALETTES[theme] ? theme : 'aurora';
    this.dpr = window.devicePixelRatio || 1;
    this.anims = [];
    this.ghosts = [];
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
    this.size = cssSize;
    this.margin = 16;
    this.canvas.width = cssSize * this.dpr;
    this.canvas.height = cssSize * this.dpr;
    this.canvas.style.width = cssSize + 'px';
    this.canvas.style.height = cssSize + 'px';
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.cell = (cssSize - this.margin * 2) / SIZE;
  }

  cx(gx) {
    return this.margin + (gx + 0.5) * this.cell;
  }
  cy(gy) {
    return this.margin + (gy + 0.5) * this.cell;
  }
  pointToCell(px, py) {
    const gx = Math.floor((px - this.margin) / this.cell);
    const gy = Math.floor((py - this.margin) / this.cell);
    return { gx, gy };
  }

  /** Nearest ghost steering target to a pixel, or null. */
  ghostAt(px, py) {
    let best = null;
    let bd = this.cell * 0.7;
    for (const g of this.ghosts) {
      const d = Math.hypot(px - g.px, py - g.py);
      if (d < bd) {
        bd = d;
        best = g;
      }
    }
    return best;
  }

  // --- Animations ----------------------------------------------------------

  startMoveAnim(ev, now) {
    if (!ev) return;
    if (ev.type === 'move' || ev.type === 'ram' || ev.type === 'crash') {
      this.anims.push({ kind: 'slide', player: ev.player, from: ev.from, to: ev.to, start: now, dur: MOVE_MS });
    }
    if (ev.type === 'ram') this.anims.push({ kind: 'ram', at: ev.to, start: now + MOVE_MS * 0.6, dur: FX_MS });
    if (ev.type === 'crash') this.anims.push({ kind: 'crash', at: ev.path.length ? ev.path[ev.path.length - 1] : ev.from, start: now + MOVE_MS * 0.6, dur: FX_MS });
  }
  isAnimating(now) {
    return this.anims.some((a) => now - a.start < a.dur && now >= a.start);
  }
  _prune(now) {
    this.anims = this.anims.filter((a) => now - a.start < a.dur);
  }

  // --- Draw ----------------------------------------------------------------

  draw(state, view, now) {
    this._prune(now);
    const ctx = this.ctx;
    const pal = this.palette;
    ctx.clearRect(0, 0, this.size, this.size);
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, this.size, this.size);

    this._drawArena();
    if (state.lastEvent && state.lastEvent.path) this._drawTrail(state.lastEvent, now);

    this.ghosts = [];
    if (view.isHumanTurn && !this.isAnimating(now) && !state.status.over) {
      this._drawGhosts(state, view, now);
    }

    this._drawCraft(state, 1, now);
    this._drawCraft(state, 0, now);
    this._drawFx(now);
  }

  _drawArena() {
    const ctx = this.ctx;
    const pal = this.palette;
    // Cells.
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        ctx.fillStyle = pal.cell;
        ctx.fillRect(this.margin + x * this.cell, this.margin + y * this.cell, this.cell - 1, this.cell - 1);
      }
    }
    // Grid lines.
    ctx.strokeStyle = pal.grid;
    ctx.lineWidth = 1;
    for (let i = 0; i <= SIZE; i++) {
      const p = this.margin + i * this.cell;
      ctx.beginPath();
      ctx.moveTo(this.margin, p);
      ctx.lineTo(this.size - this.margin, p);
      ctx.moveTo(p, this.margin);
      ctx.lineTo(p, this.size - this.margin);
      ctx.stroke();
    }
    // Wall border (the lethal edge).
    ctx.strokeStyle = pal.wall;
    ctx.lineWidth = 3;
    ctx.strokeRect(this.margin, this.margin, this.size - this.margin * 2, this.size - this.margin * 2);
  }

  _drawTrail(ev, now) {
    const ctx = this.ctx;
    const pal = this.palette;
    const color = ev.player === 0 ? pal.p0 : pal.p1;
    ctx.fillStyle = color;
    for (const [x, y] of ev.path) {
      ctx.globalAlpha = 0.18;
      ctx.beginPath();
      ctx.arc(this.cx(x), this.cy(y), this.cell * 0.12, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  _drawGhosts(state, view, now) {
    const ctx = this.ctx;
    const pal = this.palette;
    const player = state.turn;
    const color = player === 0 ? pal.p0 : pal.p1;

    for (const accel of ACCELS) {
      const p = previewMove(state, accel);
      const tx = clamp(p.nx, 0, SIZE - 1);
      const ty = clamp(p.ny, 0, SIZE - 1);
      const px = this.cx(tx);
      const py = this.cy(ty);
      const hovered = view.hover && view.hover.ax === accel.ax && view.hover.ay === accel.ay;
      this.ghosts.push({ ax: accel.ax, ay: accel.ay, px, py, preview: p });

      // Hovered: draw the swept path.
      if (hovered && p.path.length) {
        ctx.strokeStyle = p.crash ? pal.crash : p.ram ? pal.ram : pal.safe;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        ctx.moveTo(this.cx(state.craft[player].x), this.cy(state.craft[player].y));
        for (const [x, y] of p.path) ctx.lineTo(this.cx(x), this.cy(y));
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // Marker.
      const r = this.cell * (hovered ? 0.34 : 0.22);
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      if (p.crash) {
        ctx.strokeStyle = pal.crash;
        ctx.lineWidth = 2;
        ctx.stroke();
        // X mark.
        ctx.beginPath();
        ctx.moveTo(px - r * 0.5, py - r * 0.5);
        ctx.lineTo(px + r * 0.5, py + r * 0.5);
        ctx.moveTo(px + r * 0.5, py - r * 0.5);
        ctx.lineTo(px - r * 0.5, py + r * 0.5);
        ctx.stroke();
      } else if (p.ram) {
        ctx.fillStyle = pal.ram;
        ctx.globalAlpha = 0.85;
        ctx.fill();
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = color;
        ctx.globalAlpha = hovered ? 0.7 : 0.35;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }

  _craftRenderPos(state, idx, now) {
    const c = state.craft[idx];
    const slide = this.anims.find((a) => a.kind === 'slide' && a.player === idx && now >= a.start && now - a.start < a.dur);
    if (slide) {
      const t = easeInOut(clamp((now - slide.start) / slide.dur, 0, 1));
      return [slide.from[0] + (slide.to[0] - slide.from[0]) * t, slide.from[1] + (slide.to[1] - slide.from[1]) * t];
    }
    // After a crash the craft's state position is unchanged; hold it at the edge
    // it flew into rather than snapping back.
    const le = state.lastEvent;
    if (state.status.over && le && le.type === 'crash' && le.player === idx) {
      return [clamp(le.to[0], 0, SIZE - 1), clamp(le.to[1], 0, SIZE - 1)];
    }
    return [c.x, c.y];
  }

  _drawCraft(state, idx, now) {
    const ctx = this.ctx;
    const pal = this.palette;
    const c = state.craft[idx];
    const color = idx === 0 ? pal.p0 : pal.p1;
    const [gx, gy] = this._craftRenderPos(state, idx, now);
    const px = this.cx(gx);
    const py = this.cy(gy);

    // Heading: velocity, else toward the opponent.
    let hx = c.vx;
    let hy = c.vy;
    if (hx === 0 && hy === 0) {
      const o = state.craft[idx === 0 ? 1 : 0];
      hx = Math.sign(o.x - c.x);
      hy = Math.sign(o.y - c.y);
      if (hx === 0 && hy === 0) hx = 1;
    }
    const ang = Math.atan2(hy, hx);

    // Velocity arrow (momentum preview): where coasting carries it.
    if (c.vx !== 0 || c.vy !== 0) {
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(this.cx(c.x + c.vx), this.cy(c.y + c.vy));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // Triangle hull.
    const r = this.cell * 0.42;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(-r * 0.7, r * 0.6);
    ctx.lineTo(-r * 0.7, -r * 0.6);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    ctx.fill();
    ctx.restore();

    // Hull bar above the craft.
    const bw = this.cell * 1.1;
    const bh = 4;
    const bx = px - bw / 2;
    const by = py - r - 8;
    ctx.fillStyle = pal.grid;
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = color;
    ctx.fillRect(bx, by, bw * Math.max(0, c.hp / MAX_HP), bh);
  }

  _drawFx(now) {
    const ctx = this.ctx;
    const pal = this.palette;
    for (const a of this.anims) {
      if (now < a.start || now - a.start >= a.dur) continue;
      if (a.kind !== 'ram' && a.kind !== 'crash') continue;
      const t = (now - a.start) / a.dur;
      const px = this.cx(a.at[0]);
      const py = this.cy(a.at[1]);
      ctx.strokeStyle = a.kind === 'crash' ? pal.crash : pal.ram;
      ctx.globalAlpha = 1 - t;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(px, py, this.cell * (0.2 + t * 0.9), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
}
