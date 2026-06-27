// =============================================================================
// HELIX - Game entry (implements the platform game interface)
// -----------------------------------------------------------------------------
// A real-time, single-player puzzle (no opponent — you race the rising board).
// Same controller shape as PULSE: setup screen, a render loop driving
// engine.update() each frame, synthesised audio, and pause via a clock shift.
// =============================================================================

import { createEngine, start, update, swap, moveCursor, nudge, DIFFICULTY, COLS } from './engine.js';
import { Renderer } from './render.js';
import { InputController } from './input.js';
import { el, sfx } from '../../shared/helpers.js';

export function createHelixGame() {
  return new HelixGame();
}

class HelixGame {
  constructor() {
    this.container = null;
    this.options = null;
    this.engine = null;
    this.difficulty = 'medium';
    this.started = false;
    this._paused = false;
    this._pauseAt = 0;
    this._ended = false;
    this.raf = null;
    this.settings = { sound: true, theme: 'aurora' };
  }

  // --- Game interface ------------------------------------------------------

  init(container, options = {}) {
    this.container = container;
    this.options = options;
    this.settings = options.settings || this.settings;
    sfx.enabled = !!this.settings.sound;

    container.classList.add('helix-root');
    container.innerHTML = '';
    this._buildSetup();
    this._buildGameDom();
    this._showSetup();
  }

  start() {
    this._loop = this._loop.bind(this);
    this.raf = requestAnimationFrame(this._loop);
  }
  pause() {
    this._setPaused(true);
  }
  resume() {
    this._setPaused(false);
  }
  destroy() {
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this.input) this.input.destroy();
    if (this._onResize) window.removeEventListener('resize', this._onResize);
    if (this.container) {
      this.container.classList.remove('helix-root');
      this.container.innerHTML = '';
    }
  }
  applySettings(settings) {
    this.settings = settings;
    sfx.enabled = !!settings.sound;
    if (this.renderer) this.renderer.setTheme(settings.theme);
  }

  _setPaused(on) {
    if (!this.started || this._ended) return;
    if (on && !this._paused) {
      this._paused = true;
      this._pauseAt = performance.now();
      this._flash('Paused — press P to resume');
    } else if (!on && this._paused) {
      const dur = performance.now() - this._pauseAt;
      this.engine.startTime += dur;
      this.engine.lastUpdate = performance.now();
      this._paused = false;
      this._flash('Resumed');
    }
  }

  // --- Setup screen --------------------------------------------------------

  _buildSetup() {
    const diffButtons = [];
    const choice = (label, sub, onClick) => {
      const b = el('button', { class: 'helix-choice', onClick }, [
        el('span', { class: 'helix-choice-title', text: label }),
        el('span', { class: 'helix-choice-sub', text: sub }),
      ]);
      diffButtons.push(b);
      return b;
    };
    const diffRow = el('div', { class: 'helix-choice-row' }, [
      choice('Easy', 'Gentle rise', () => this._setDifficulty('easy')),
      choice('Medium', 'Steady climb', () => this._setDifficulty('medium')),
      choice('Hard', 'Fast & relentless', () => this._setDifficulty('hard')),
    ]);
    this._diffButtons = diffButtons;

    this.setupEl = el('div', { class: 'helix-setup' }, [
      el('h2', { class: 'helix-setup-h', text: 'HELIX' }),
      el('p', { class: 'helix-setup-p', text: 'Splice matching nucleotides before the strand winds to the top.' }),
      el('div', { class: 'helix-setup-block' }, [el('h3', { text: 'Difficulty' }), diffRow]),
      el('p', { class: 'helix-hint', html: 'Move the cursor with <b>W A S D</b> / arrows and <b>Space</b> to swap the two cells — or click a tile to swap it right. Line up <b>3+</b> of a colour to splice them. <b>Shift</b> winds the strand up faster.' }),
      el('button', { class: 'btn btn-primary helix-start', text: 'Begin sequence', onClick: () => this._startMatch() }),
    ]);
    this.container.appendChild(this.setupEl);
    this._setDifficulty('medium');
  }

  _setDifficulty(diff) {
    this.difficulty = diff;
    const order = ['easy', 'medium', 'hard'];
    this._diffButtons.forEach((b, i) => b.classList.toggle('active', order[i] === diff));
  }
  _showSetup() {
    this.started = false;
    this.setupEl.style.display = '';
    this.gameEl.style.display = 'none';
  }

  // --- Game DOM ------------------------------------------------------------

  _buildGameDom() {
    this.canvas = el('canvas', { class: 'helix-canvas' });
    this.renderer = new Renderer(this.canvas, this.settings.theme);

    this.scoreLabel = el('span', { class: 'hud-val' });
    this.chainLabel = el('span', { class: 'hud-val' });
    this.clearedLabel = el('span', { class: 'hud-val' });
    this.timeLabel = el('span', { class: 'hud-val' });
    this.diffLabel = el('span', { class: 'hud-val' });
    this.messageEl = el('div', { class: 'helix-message' });

    this.pauseBtn = el('button', { class: 'btn', text: 'Pause', onClick: () => this._setPaused(!this._paused) });
    this.restartBtn = el('button', { class: 'btn', text: 'Restart', onClick: () => this._restart() });
    this.helpBtn = el('button', { class: 'btn', text: 'Help', onClick: () => this._toggleHelp(true) });
    this.menuBtn = el('button', { class: 'btn', text: '‹ Menu', onClick: () => this.options.onExit && this.options.onExit() });

    const hud = el('div', { class: 'helix-hud' }, [
      el('div', { class: 'hud-section' }, [
        this._hudRow('Score', this.scoreLabel),
        this._hudRow('Best chain', this.chainLabel),
        this._hudRow('Spliced', this.clearedLabel),
        this._hudRow('Time', this.timeLabel),
        this._hudRow('Difficulty', this.diffLabel),
      ]),
      this.messageEl,
      el('div', { class: 'hud-controls' }, [this.pauseBtn, this.restartBtn, this.helpBtn, this.menuBtn]),
      el('div', { class: 'hud-keys', html: 'Move: <b>W A S D</b> / arrows · <b>Space</b> swap · <b>Shift</b> wind up · <b>P</b> pause · <b>R</b> restart · <b>H</b> help · <b>M</b> menu' }),
    ]);

    this.boardWrap = el('div', { class: 'helix-board-wrap' }, [this.canvas]);
    this.endBanner = el('div', { class: 'helix-overlay', style: 'display:none' });
    this.boardWrap.appendChild(this.endBanner);

    this.helpOverlay = el('div', { class: 'helix-help', style: 'display:none', html: this._helpHtml() });
    this.helpOverlay.addEventListener('click', (e) => {
      if (e.target === this.helpOverlay || e.target.dataset.close) this._toggleHelp(false);
    });

    this.gameEl = el('div', { class: 'helix-game' }, [hud, this.boardWrap, this.helpOverlay]);
    this.container.appendChild(this.gameEl);

    this.input = new InputController(this.canvas, this.renderer, {
      onMove: (dr, dc) => moveCursor(this.engine, dr, dc),
      onSwapCursor: () => this._doSwap(this.engine.cursor.row, this.engine.cursor.col),
      onSwapAt: (row, col) => {
        this.engine.cursor.row = row;
        this.engine.cursor.col = Math.min(col, COLS - 2);
        this._doSwap(row, Math.min(col, COLS - 2));
      },
      onNudge: () => this._doNudge(),
      onKey: (name) => this._onKey(name),
    });

    this._onResize = () => this._fitBoard();
    window.addEventListener('resize', this._onResize);
  }

  _hudRow(label, valueEl) {
    return el('div', { class: 'hud-row' }, [el('span', { class: 'hud-label', text: label }), valueEl]);
  }
  _fitBoard() {
    const avail = Math.min(this.boardWrap.clientWidth || 560, 600);
    this.renderer.resize(Math.max(240, avail)); // floor low enough to fit small phones
  }

  // --- Match lifecycle -----------------------------------------------------

  _startMatch() {
    const seeds = { easy: 4101, medium: 5101, hard: 6101 };
    this.engine = createEngine({ difficulty: this.difficulty, seed: seeds[this.difficulty] || 11 });
    this._paused = false;
    this._ended = false;
    this.started = true;
    this.endBanner.style.display = 'none';

    this.setupEl.style.display = 'none';
    this.gameEl.style.display = '';
    this._fitBoard();

    start(this.engine, performance.now());
    this._updateHud();
    this._flash('Splice 3+ to clear!');
  }

  _restart() {
    this._startMatch();
    sfx.select();
  }

  // --- Actions -------------------------------------------------------------

  _doSwap(row, col) {
    if (!this.started || this._paused || this._ended || this.engine.status.over) return;
    const res = swap(this.engine, row, col);
    if (!res.swapped) return;
    if (res.cleared > 0) {
      this.renderer.markClears(res.clearedCells, performance.now());
      if (res.chain >= 2) this.renderer.popup(`Chain ×${res.chain}`, performance.now());
      sfx._tone(440 + Math.min(res.chain, 6) * 110, 110, 'triangle', 0.06);
    } else {
      sfx._tone(300, 40, 'sine', 0.03);
    }
    this._updateHud();
  }

  _doNudge() {
    if (!this.started || this._paused || this._ended || this.engine.status.over) return;
    nudge(this.engine);
    sfx._tone(180, 50, 'sine', 0.03);
  }

  _onKey(name) {
    switch (name) {
      case 'restart':
        this._restart();
        break;
      case 'menu':
        this.options.onExit && this.options.onExit();
        break;
      case 'pause':
        this._setPaused(!this._paused);
        break;
      case 'help':
        this._toggleHelp(this.helpOverlay.style.display === 'none');
        break;
      case 'deselect':
        if (this.helpOverlay.style.display !== 'none') this._toggleHelp(false);
        break;
    }
  }

  // --- Game over -----------------------------------------------------------

  _onGameOver() {
    if (this._ended) return;
    this._ended = true;
    sfx.lose();
    this.endBanner.innerHTML = '';
    this.endBanner.appendChild(
      el('div', { class: 'end-card' }, [
        el('h2', { class: 'end-title', text: 'Sequence ended' }),
        el('p', { class: 'end-reason', text: this.engine.status.reason }),
        el('div', { class: 'end-stats', html: this._statLine() }),
        el('div', { class: 'end-actions' }, [
          el('button', { class: 'btn btn-primary', text: 'Play again', onClick: () => this._restart() }),
          el('button', { class: 'btn', text: 'Difficulty', onClick: () => this._showSetup() }),
          el('button', { class: 'btn', text: 'Menu', onClick: () => this.options.onExit && this.options.onExit() }),
        ]),
      ]),
    );
    this.endBanner.style.display = '';
  }

  _statLine() {
    const e = this.engine;
    return `Score <b>${e.score}</b> · Best chain <b>×${e.maxChain}</b> · Spliced <b>${e.cleared}</b><br><span class="end-breakdown">Survived ${this._fmtTime(e.elapsed)}</span>`;
  }

  // --- HUD -----------------------------------------------------------------

  _updateHud() {
    const e = this.engine;
    this.scoreLabel.textContent = String(e.score);
    this.chainLabel.textContent = '×' + e.maxChain;
    this.clearedLabel.textContent = String(e.cleared);
    this.timeLabel.textContent = this._fmtTime(e.elapsed);
    this.diffLabel.textContent = DIFFICULTY[this.difficulty].name;
  }

  _fmtTime(ms) {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  _flash(text) {
    this.messageEl.textContent = text;
  }
  _toggleHelp(show) {
    this.helpOverlay.style.display = show ? '' : 'none';
  }

  // --- Loop ----------------------------------------------------------------

  _loop(now) {
    if (this.started && this.gameEl.style.display !== 'none') {
      if (!this._paused && !this._ended && !this.engine.status.over) {
        const events = update(this.engine, now);
        for (const ev of events) {
          if (ev.type === 'clear') {
            this.renderer.markClears(ev.clearedCells, now);
            if (ev.chain >= 2) this.renderer.popup(`Chain ×${ev.chain}`, now);
            sfx._tone(440 + Math.min(ev.chain, 6) * 110, 110, 'triangle', 0.06);
          } else if (ev.type === 'gameover') {
            this._updateHud();
            this._onGameOver();
          }
        }
        this._updateHud();
      }
      this.renderer.draw(this.engine, now);
    }
    this.raf = requestAnimationFrame(this._loop);
  }

  _helpHtml() {
    return `
      <div class="helix-help-card">
        <button class="helix-help-close" data-close="1">✕</button>
        <h2>How to play HELIX</h2>
        <div class="help-cols">
          <div>
            <h3>Goal</h3>
            <p>The strand winds upward — a new row keeps rising from the bottom. Splice tiles to keep the stack down. If a tile is pushed past the top line, the run ends.</p>
            <h3>Splicing</h3>
            <p>Line up <b>3 or more</b> of the same nucleotide in a row or column and they clear. Tiles above fall to fill the gap, and a fall that forms another match keeps the <b>chain</b> going for big bonuses.</p>
          </div>
          <div>
            <h3>Controls</h3>
            <p>Move the two-wide cursor with <b>W A S D</b> or the arrow keys; press <b>Space</b> (or Enter) to swap its two cells. Or simply <b>click</b> a tile to swap it with the one to its right.</p>
            <p>Hold nothing back: tap <b>Shift</b> to wind the strand up faster when you want to set up a chain.</p>
            <h3>Scoring</h3>
            <p>Longer chains multiply your score. Survive as long as you can.</p>
          </div>
        </div>
        <button class="btn btn-primary" data-close="1">Got it</button>
      </div>`;
  }
}
