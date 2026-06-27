// =============================================================================
// PULSE - Canvas 2D rendering
// -----------------------------------------------------------------------------
// Four lanes of falling notes toward a hit line, enemy/player health bars, a
// beat-synced background pulse, combo counter, and judgement flashes. Pure
// presentation: it reads engine state and a little transient feedback.
// =============================================================================

import { LANES, TRAVEL_MS, MAX_HP, WINDOW } from './engine.js';

const PALETTES = {
  aurora: {
    bg: '#070b14',
    laneA: '#0b1422',
    laneB: '#0a1018',
    line: '#5bd6ff',
    grid: '#1c2c44',
    player: '#41e0d0',
    enemy: '#f25f8a',
    note: '#41e0d0',
    heavy: '#ffb347',
    perfect: '#7CFFB2',
    good: '#ffe08a',
    miss: '#ff5a6e',
    text: '#dce8f5',
    dim: '#7d8ba3',
  },
  amber: {
    bg: '#0c0a05',
    laneA: '#191207',
    laneB: '#120d06',
    line: '#ffe08a',
    grid: '#2e2412',
    player: '#ffcf5c',
    enemy: '#6ec1ff',
    note: '#ffcf5c',
    heavy: '#ff8c42',
    perfect: '#9be38a',
    good: '#ffe08a',
    miss: '#ff6a4d',
    text: '#f2e6cf',
    dim: '#a3917d',
  },
};

const LANE_KEYS = ['D', 'F', 'J', 'K'];
const JUDGE_MS = 420;
const FLASH_MS = 160;

export class Renderer {
  constructor(canvas, theme = 'aurora') {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.theme = PALETTES[theme] ? theme : 'aurora';
    this.dpr = window.devicePixelRatio || 1;
    this.laneFlash = new Array(LANES).fill(-1e9);
    this.judge = null; // { result, lane, start }
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
    this.laneW = cssSize / LANES;
    this.playTop = cssSize * 0.12; // below the enemy HP bar
    this.hitY = cssSize * 0.8;
    this.keyY = cssSize * 0.9;
  }

  laneAt(px, py) {
    if (py < this.playTop || py > this.h) return -1;
    const lane = Math.floor(px / this.laneW);
    return lane >= 0 && lane < LANES ? lane : -1;
  }

  flashLane(lane, now) {
    this.laneFlash[lane] = now;
  }
  popJudge(result, lane, now) {
    this.judge = { result, lane, start: now };
  }

  draw(state, now) {
    const ctx = this.ctx;
    const pal = this.palette;

    // Beat-synced background brightness.
    const phase = state.beatMs > 0 ? (state.clock % state.beatMs) / state.beatMs : 0;
    const pulse = Math.pow(1 - phase, 2); // bright on the beat, decays
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, this.w, this.h);

    this._drawLanes(state, now, pulse);
    this._drawHitLine(state, now, pulse);
    this._drawNotes(state, now);
    this._drawKeys(state, now);
    this._drawHealth(state);
    this._drawCombo(state);
    this._drawJudge(now);
  }

  _drawLanes(state, now, pulse) {
    const ctx = this.ctx;
    const pal = this.palette;
    for (let i = 0; i < LANES; i++) {
      const x = i * this.laneW;
      ctx.fillStyle = i % 2 === 0 ? pal.laneA : pal.laneB;
      ctx.fillRect(x, this.playTop, this.laneW, this.h - this.playTop);

      // Key-press flash.
      const dt = now - this.laneFlash[i];
      if (dt < FLASH_MS) {
        ctx.globalAlpha = (1 - dt / FLASH_MS) * 0.5;
        ctx.fillStyle = pal.player;
        ctx.fillRect(x, this.playTop, this.laneW, this.h - this.playTop);
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = pal.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, this.playTop);
      ctx.lineTo(x, this.h);
      ctx.stroke();
    }
  }

  _drawHitLine(state, now, pulse) {
    const ctx = this.ctx;
    const pal = this.palette;
    ctx.strokeStyle = pal.line;
    ctx.globalAlpha = 0.5 + 0.5 * pulse;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, this.hitY);
    ctx.lineTo(this.w, this.hitY);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Target rings per lane.
    for (let i = 0; i < LANES; i++) {
      const cx = i * this.laneW + this.laneW / 2;
      ctx.beginPath();
      ctx.arc(cx, this.hitY, this.laneW * 0.28, 0, Math.PI * 2);
      ctx.strokeStyle = pal.line;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  _drawNotes(state, now) {
    const ctx = this.ctx;
    const pal = this.palette;
    const span = this.hitY - this.playTop;
    for (const n of state.notes) {
      if (n.judged) continue;
      const remaining = n.time - state.clock; // ms until it should be hit
      const progress = 1 - remaining / TRAVEL_MS; // 0 at spawn, 1 at hit line
      if (progress < -0.05 || progress > 1.15) continue;
      const cx = n.lane * this.laneW + this.laneW / 2;
      const cy = this.playTop + progress * span;
      const r = this.laneW * 0.26;
      const color = n.type === 'heavy' ? pal.heavy : pal.note;

      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = 14;
      if (n.type === 'heavy') {
        // Diamond for heavy (enemy attack) notes.
        ctx.beginPath();
        ctx.moveTo(cx, cy - r);
        ctx.lineTo(cx + r, cy);
        ctx.lineTo(cx, cy + r);
        ctx.lineTo(cx - r, cy);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      }
      ctx.restore();
    }
  }

  _drawKeys(state, now) {
    const ctx = this.ctx;
    const pal = this.palette;
    ctx.font = `bold ${Math.round(this.laneW * 0.22)}px "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < LANES; i++) {
      const cx = i * this.laneW + this.laneW / 2;
      const active = now - this.laneFlash[i] < FLASH_MS;
      ctx.fillStyle = active ? pal.player : pal.dim;
      ctx.fillText(LANE_KEYS[i], cx, this.keyY);
    }
  }

  _drawHealth(state) {
    const ctx = this.ctx;
    const pal = this.palette;
    const pad = 14;
    const barH = 14;
    const w = this.w - pad * 2;

    // Enemy bar (top), depletes right-to-left.
    const eFrac = Math.max(0, state.enemyHP / MAX_HP);
    ctx.fillStyle = pal.grid;
    this._roundRect(pad, pad, w, barH, 6);
    ctx.fill();
    ctx.fillStyle = pal.enemy;
    this._roundRect(pad + w * (1 - eFrac), pad, w * eFrac, barH, 6);
    ctx.fill();
    ctx.fillStyle = pal.text;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('ENEMY', pad + 2, pad + barH / 2);
    ctx.textAlign = 'right';
    ctx.fillText(Math.ceil(state.enemyHP), pad + w - 2, pad + barH / 2);

    // Player bar (bottom).
    const pFrac = Math.max(0, state.playerHP / MAX_HP);
    const py = this.h - pad - barH;
    ctx.fillStyle = pal.grid;
    this._roundRect(pad, py, w, barH, 6);
    ctx.fill();
    ctx.fillStyle = pal.player;
    this._roundRect(pad, py, w * pFrac, barH, 6);
    ctx.fill();
    ctx.fillStyle = pal.text;
    ctx.textAlign = 'left';
    ctx.fillText('YOU', pad + 2, py + barH / 2);
    ctx.textAlign = 'right';
    ctx.fillText(Math.ceil(state.playerHP), pad + w - 2, py + barH / 2);
  }

  _drawCombo(state) {
    if (state.combo < 2) return;
    const ctx = this.ctx;
    const pal = this.palette;
    ctx.fillStyle = pal.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.round(this.w * 0.09)}px "Segoe UI", system-ui, sans-serif`;
    ctx.globalAlpha = 0.92;
    ctx.fillText(state.combo + '×', this.w / 2, this.playTop + this.h * 0.18);
    ctx.globalAlpha = 1;
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillStyle = pal.dim;
    ctx.fillText('COMBO', this.w / 2, this.playTop + this.h * 0.18 + this.w * 0.06);
  }

  _drawJudge(now) {
    if (!this.judge) return;
    const dt = now - this.judge.start;
    if (dt > JUDGE_MS) {
      this.judge = null;
      return;
    }
    const ctx = this.ctx;
    const pal = this.palette;
    const label = { perfect: 'PERFECT', good: 'GOOD', miss: 'MISS' }[this.judge.result] || '';
    const color = pal[this.judge.result] || pal.text;
    const t = dt / JUDGE_MS;
    ctx.globalAlpha = 1 - t;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.round(this.w * 0.06)}px "Segoe UI", system-ui, sans-serif`;
    ctx.fillText(label, this.w / 2, this.hitY - this.w * 0.12 - t * 20);
    ctx.globalAlpha = 1;
  }

  _roundRect(x, y, w, h, r) {
    const ctx = this.ctx;
    const rr = Math.min(r, h / 2, w / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }
}
