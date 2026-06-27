// =============================================================================
// QUANTA - Game entry (implements the platform game interface)
// -----------------------------------------------------------------------------
// A relaxed, single-player routing puzzle. Pick a difficulty, then tap conduit
// tiles to spin them until the light from the source reaches every crystal. No
// timer pressure — we track moves and elapsed time for a star rating. Same
// controller shape as the other games: setup screen, a render loop, synthesised
// audio, pause via a clock shift.
// =============================================================================

import { createEngine, rotate, computeLit, litTargets, DIFFICULTY } from './engine.js';
import { Renderer } from './render.js';
import { InputController } from './input.js';
import { el, sfx } from '../../shared/helpers.js';

const BEST_KEY = 'quanta.best.v1';

export function createQuantaGame() {
  return new QuantaGame();
}

class QuantaGame {
  constructor() {
    this.container = null;
    this.options = null;
    this.engine = null;
    this.difficulty = 'medium';
    this.started = false;
    this._ended = false;
    this._startTime = 0;
    this._elapsed = 0;
    this._pausedAt = 0;
    this._paused = false;
    this.raf = null;
    this._round = 1;
    this.settings = { sound: true, theme: 'aurora' };
  }

  // --- Game interface ------------------------------------------------------

  init(container, options = {}) {
    this.container = container;
    this.options = options;
    this.settings = options.settings || this.settings;
    sfx.enabled = !!this.settings.sound;

    container.classList.add('quanta-root');
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
    if (!this.started || this._ended || this._paused) return;
    this._paused = true;
    this._pausedAt = performance.now();
  }
  resume() {
    if (!this._paused) return;
    this._startTime += performance.now() - this._pausedAt;
    this._paused = false;
  }
  destroy() {
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this.input) this.input.destroy();
    if (this._onResize) window.removeEventListener('resize', this._onResize);
    if (this.container) {
      this.container.classList.remove('quanta-root');
      this.container.innerHTML = '';
    }
  }
  applySettings(settings) {
    this.settings = settings;
    sfx.enabled = !!settings.sound;
    if (this.renderer) this.renderer.setTheme(settings.theme);
  }

  // --- Setup screen --------------------------------------------------------

  _buildSetup() {
    const diffButtons = [];
    const choice = (label, sub, diff) => {
      const b = el('button', { class: 'quanta-choice', onClick: () => this._setDifficulty(diff) }, [
        el('span', { class: 'quanta-choice-title', text: label }),
        el('span', { class: 'quanta-choice-sub', text: sub }),
      ]);
      diffButtons.push(b);
      return b;
    };
    const diffRow = el('div', { class: 'quanta-choice-row' }, [
      choice('Easy', '5 × 5 grid', 'easy'),
      choice('Medium', '6 × 6 grid', 'medium'),
      choice('Hard', '7 × 7 grid', 'hard'),
    ]);
    this._diffButtons = diffButtons;

    this.setupEl = el('div', { class: 'quanta-setup' }, [
      el('h2', { class: 'quanta-setup-h', text: 'QUANTA' }),
      el('p', { class: 'quanta-setup-p', text: 'Spin the conduits to route the light from the emitter into every crystal.' }),
      el('div', { class: 'quanta-setup-block' }, [el('h3', { text: 'Difficulty' }), diffRow]),
      el('p', { class: 'quanta-hint', html: 'Just <b>tap</b> (or click) a tile to rotate it. Connect every conduit so nothing points at a wall — light up all the crystals to solve it.' }),
      el('button', { class: 'btn btn-primary quanta-start', text: 'Start routing', onClick: () => this._startMatch(true) }),
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
    this.canvas = el('canvas', { class: 'quanta-canvas' });
    this.renderer = new Renderer(this.canvas, this.settings.theme);

    this.movesLabel = el('span', { class: 'hud-val' });
    this.litLabel = el('span', { class: 'hud-val' });
    this.timeLabel = el('span', { class: 'hud-val' });
    this.diffLabel = el('span', { class: 'hud-val' });
    this.bestLabel = el('span', { class: 'hud-val' });
    this.messageEl = el('div', { class: 'quanta-message' });

    this.newBtn = el('button', { class: 'btn', text: 'New board', onClick: () => this._startMatch(false) });
    this.restartBtn = el('button', { class: 'btn', text: 'Reset', onClick: () => this._restart() });
    this.helpBtn = el('button', { class: 'btn', text: 'Help', onClick: () => this._toggleHelp(true) });
    this.menuBtn = el('button', { class: 'btn', text: '‹ Menu', onClick: () => this.options.onExit && this.options.onExit() });

    const hud = el('div', { class: 'quanta-hud' }, [
      el('div', { class: 'hud-section' }, [
        this._hudRow('Crystals lit', this.litLabel),
        this._hudRow('Moves', this.movesLabel),
        this._hudRow('Time', this.timeLabel),
        this._hudRow('Difficulty', this.diffLabel),
        this._hudRow('Best moves', this.bestLabel),
      ]),
      this.messageEl,
      el('div', { class: 'hud-controls' }, [this.newBtn, this.restartBtn, this.helpBtn, this.menuBtn]),
      el('div', { class: 'hud-keys', html: '<b>Tap</b> a tile to rotate · <b>R</b> reset · <b>N</b> new · <b>H</b> help · <b>M</b> menu' }),
    ]);

    this.boardWrap = el('div', { class: 'quanta-board-wrap' }, [this.canvas]);
    this.endBanner = el('div', { class: 'quanta-overlay', style: 'display:none' });
    this.boardWrap.appendChild(this.endBanner);

    this.helpOverlay = el('div', { class: 'quanta-help', style: 'display:none', html: this._helpHtml() });
    this.helpOverlay.addEventListener('click', (e) => {
      if (e.target === this.helpOverlay || e.target.dataset.close) this._toggleHelp(false);
    });

    this.gameEl = el('div', { class: 'quanta-game' }, [hud, this.boardWrap, this.helpOverlay]);
    this.container.appendChild(this.gameEl);

    this.input = new InputController(this.canvas, this.renderer, {
      onRotate: (r, c) => this._doRotate(r, c),
      onKey: (name) => this._onKey(name),
    });

    this._onResize = () => this._fitBoard();
    window.addEventListener('resize', this._onResize);
  }

  _hudRow(label, valueEl) {
    return el('div', { class: 'hud-row' }, [el('span', { class: 'hud-label', text: label }), valueEl]);
  }
  _fitBoard() {
    // Square board that fits the available column width and the viewport height.
    const wrapW = this.boardWrap.clientWidth || 520;
    const avail = Math.min(wrapW, Math.max(280, window.innerHeight - 220), 620);
    this.renderer.resize(Math.max(260, Math.floor(avail)));
  }

  // --- Match lifecycle -----------------------------------------------------

  _startMatch(resetRound) {
    if (resetRound) this._round = 1;
    // A fresh seed per board so "New board" gives a different puzzle, but it
    // stays deterministic within a session.
    const base = { easy: 1000, medium: 2000, hard: 3000 }[this.difficulty] || 0;
    const seed = base + this._round * 97 + this.difficulty.length * 13;
    this.engine = createEngine({ difficulty: this.difficulty, seed });

    this._ended = false;
    this._paused = false;
    this.started = true;
    this._startTime = performance.now();
    this._elapsed = 0;
    this.endBanner.style.display = 'none';

    this.setupEl.style.display = 'none';
    this.gameEl.style.display = '';
    this._fitBoard();
    this._updateHud();
    this._flash('Tap tiles to route the light.');
  }

  _restart() {
    // Reset the current board to its scrambled start by rebuilding from seed.
    if (!this.engine) return;
    const seed = this.engine.seed;
    this.engine = createEngine({ difficulty: this.difficulty, seed });
    this._ended = false;
    this._paused = false;
    this.started = true;
    this._startTime = performance.now();
    this._elapsed = 0;
    this.endBanner.style.display = 'none';
    this._updateHud();
    this._flash('Board reset.');
    sfx.select();
  }

  // --- Actions -------------------------------------------------------------

  _doRotate(r, c) {
    if (!this.started || this._ended || this._paused) return;
    const res = rotate(this.engine, r, c);
    if (!res.rotated) return;
    this.renderer.spin(r, c, performance.now());
    sfx._tone(360, 55, 'triangle', 0.04);
    this._updateHud();
    if (res.win) this._onSolved();
  }

  _onKey(name) {
    switch (name) {
      case 'restart':
        this._restart();
        break;
      case 'next':
        if (this._ended) this._nextBoard();
        break;
      case 'menu':
        this.options.onExit && this.options.onExit();
        break;
      case 'help':
        this._toggleHelp(this.helpOverlay.style.display === 'none');
        break;
      case 'deselect':
        if (this.helpOverlay.style.display !== 'none') this._toggleHelp(false);
        break;
    }
  }

  _nextBoard() {
    this._round++;
    this._startMatch(false);
  }

  // --- Solved --------------------------------------------------------------

  _onSolved() {
    if (this._ended) return;
    this._ended = true;
    this._elapsed = performance.now() - this._startTime;
    sfx.win();

    const stars = this._stars();
    const best = this._recordBest();

    this.endBanner.innerHTML = '';
    this.endBanner.appendChild(
      el('div', { class: 'end-card' }, [
        el('h2', { class: 'end-title', text: 'Circuit complete' }),
        el('p', { class: 'end-reason', text: 'Every crystal is powered.' }),
        el('div', { class: 'quanta-stars', text: '★'.repeat(stars) + '☆'.repeat(3 - stars) }),
        el('div', { class: 'end-stats', html: this._statLine(best) }),
        el('div', { class: 'end-actions' }, [
          el('button', { class: 'btn btn-primary', text: 'Next board', onClick: () => this._nextBoard() }),
          el('button', { class: 'btn', text: 'Difficulty', onClick: () => this._showSetup() }),
          el('button', { class: 'btn', text: 'Menu', onClick: () => this.options.onExit && this.options.onExit() }),
        ]),
      ]),
    );
    this.endBanner.style.display = '';
  }

  _stars() {
    const par = Math.max(1, this.engine.par);
    const m = this.engine.moves;
    if (m <= par) return 3;
    if (m <= Math.ceil(par * 1.6)) return 2;
    return 1;
  }

  _statLine(best) {
    const e = this.engine;
    const bestTxt = best != null ? `<br><span class="end-breakdown">Best for ${DIFFICULTY[this.difficulty].name}: ${best} moves</span>` : '';
    return `Solved in <b>${e.moves}</b> moves · ${this._fmtTime(this._elapsed)} · par <b>${e.par}</b>${bestTxt}`;
  }

  _recordBest() {
    let store = {};
    try {
      store = JSON.parse(localStorage.getItem(BEST_KEY) || '{}');
    } catch {
      store = {};
    }
    const prev = store[this.difficulty];
    const m = this.engine.moves;
    if (prev == null || m < prev) {
      store[this.difficulty] = m;
      try {
        localStorage.setItem(BEST_KEY, JSON.stringify(store));
      } catch {
        /* storage unavailable */
      }
      return m;
    }
    return prev;
  }

  _bestFor(diff) {
    try {
      const store = JSON.parse(localStorage.getItem(BEST_KEY) || '{}');
      return store[diff];
    } catch {
      return undefined;
    }
  }

  // --- HUD -----------------------------------------------------------------

  _updateHud() {
    const e = this.engine;
    const lit = computeLit(e);
    this.litLabel.textContent = `${litTargets(e, lit)} / ${e.targets.length}`;
    this.movesLabel.textContent = String(e.moves);
    this.timeLabel.textContent = this._fmtTime(this._ended ? this._elapsed : performance.now() - this._startTime);
    this.diffLabel.textContent = DIFFICULTY[this.difficulty].name;
    const best = this._bestFor(this.difficulty);
    this.bestLabel.textContent = best == null ? '—' : String(best);
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
      if (!this._ended && !this._paused) {
        // Live time tick (cheap); HUD numbers only change on action otherwise.
        this.timeLabel.textContent = this._fmtTime(now - this._startTime);
      }
      this.renderer.draw(this.engine, now);
    }
    this.raf = requestAnimationFrame(this._loop);
  }

  _helpHtml() {
    return `
      <div class="quanta-help-card">
        <button class="quanta-help-close" data-close="1">✕</button>
        <h2>How to play QUANTA</h2>
        <div class="help-cols">
          <div>
            <h3>Goal</h3>
            <p>Light streams out of the glowing <b>emitter</b>. Spin the conduit tiles so the light flows all the way to every <b>crystal</b> on the board. When no conduit points at a wall or a dead edge, the circuit is complete.</p>
            <h3>Controls</h3>
            <p>Simply <b>tap</b> (or click) any tile to rotate it a quarter-turn clockwise. That's the only control — it plays great on a phone.</p>
          </div>
          <div>
            <h3>Scoring</h3>
            <p>Powered conduits glow; you can always see how far the light reaches. Solve the board in as few moves as possible — match or beat <b>par</b> for three stars.</p>
            <h3>Tips</h3>
            <p>Start from the emitter and the crystals — terminals only have one connection, so there are fewer orientations to get right. Work the loose ends inward.</p>
          </div>
        </div>
        <button class="btn btn-primary" data-close="1">Got it</button>
      </div>`;
  }
}
