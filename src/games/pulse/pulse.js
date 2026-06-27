// =============================================================================
// PULSE - Game entry (implements the platform game interface)
// -----------------------------------------------------------------------------
// A real-time rhythm/combat game. Unlike RIFT/LATTICE there is no hotseat: you
// play solo against an adaptive engine. The controller owns the game clock,
// drives engine.update() each frame, renders, plays synthesised audio, and
// handles pause by shifting the engine's start time so notes don't desync.
// =============================================================================

import { createEngine, start, update, pressLane, accuracy, DIFFICULTY } from './engine.js';
import { Renderer } from './render.js';
import { InputController } from './input.js';
import { el, sfx } from '../../shared/helpers.js';

export function createPulseGame() {
  return new PulseGame();
}

class PulseGame {
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

    container.classList.add('pulse-root');
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
      this.container.classList.remove('pulse-root');
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
      // Shift the clock forward by the paused duration so notes keep their
      // relative timing.
      this.engine.startTime += performance.now() - this._pauseAt;
      this._paused = false;
      this._flash('Go!');
    }
  }

  // --- Setup screen --------------------------------------------------------

  _buildSetup() {
    const diffButtons = [];
    const choice = (label, sub, onClick) => {
      const b = el('button', { class: 'pulse-choice', onClick }, [
        el('span', { class: 'pulse-choice-title', text: label }),
        el('span', { class: 'pulse-choice-sub', text: sub }),
      ]);
      diffButtons.push(b);
      return b;
    };
    const diffRow = el('div', { class: 'pulse-choice-row' }, [
      choice('Easy', 'Slower, sparser', () => this._setDifficulty('easy')),
      choice('Medium', 'Balanced tempo', () => this._setDifficulty('medium')),
      choice('Hard', 'Fast & dense', () => this._setDifficulty('hard')),
    ]);
    this._diffButtons = diffButtons;

    this.setupEl = el('div', { class: 'pulse-setup' }, [
      el('h2', { class: 'pulse-setup-h', text: 'PULSE' }),
      el('p', { class: 'pulse-setup-p', text: 'Strike the beat to drain the enemy. The tempo adapts to how well you play.' }),
      el('div', { class: 'pulse-setup-block' }, [el('h3', { text: 'Starting difficulty' }), diffRow]),
      el('p', { class: 'pulse-hint', html: 'Hit notes on the line with <b>D</b> <b>F</b> <b>J</b> <b>K</b> (or click a lane). Diamonds are enemy strikes — don’t miss them.' }),
      el('button', { class: 'btn btn-primary pulse-start', text: 'Start the beat', onClick: () => this._startMatch() }),
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
    this.canvas = el('canvas', { class: 'pulse-canvas' });
    this.renderer = new Renderer(this.canvas, this.settings.theme);

    this.scoreLabel = el('span', { class: 'hud-val' });
    this.comboLabel = el('span', { class: 'hud-val' });
    this.accLabel = el('span', { class: 'hud-val' });
    this.bpmLabel = el('span', { class: 'hud-val' });
    this.modeLabel = el('span', { class: 'hud-val' });
    this.messageEl = el('div', { class: 'pulse-message' });

    this.restartBtn = el('button', { class: 'btn', text: 'Restart', onClick: () => this._restart() });
    this.pauseBtn = el('button', { class: 'btn', text: 'Pause', onClick: () => this._setPaused(!this._paused) });
    this.helpBtn = el('button', { class: 'btn', text: 'Help', onClick: () => this._toggleHelp(true) });
    this.menuBtn = el('button', { class: 'btn', text: '‹ Menu', onClick: () => this.options.onExit && this.options.onExit() });

    const hud = el('div', { class: 'pulse-hud' }, [
      el('div', { class: 'hud-section' }, [
        this._hudRow('Score', this.scoreLabel),
        this._hudRow('Max combo', this.comboLabel),
        this._hudRow('Accuracy', this.accLabel),
        this._hudRow('Tempo', this.bpmLabel),
        this._hudRow('Difficulty', this.modeLabel),
      ]),
      this.messageEl,
      el('div', { class: 'hud-controls' }, [this.pauseBtn, this.restartBtn, this.helpBtn, this.menuBtn]),
      el('div', { class: 'hud-keys', html: 'Lanes: <b>D</b> <b>F</b> <b>J</b> <b>K</b> · <b>P</b> pause · <b>R</b> restart · <b>H</b> help · <b>M</b> menu' }),
    ]);

    this.boardWrap = el('div', { class: 'pulse-board-wrap' }, [this.canvas]);
    this.endBanner = el('div', { class: 'pulse-overlay', style: 'display:none' });
    this.boardWrap.appendChild(this.endBanner);

    this.helpOverlay = el('div', { class: 'pulse-help', style: 'display:none', html: this._helpHtml() });
    this.helpOverlay.addEventListener('click', (e) => {
      if (e.target === this.helpOverlay || e.target.dataset.close) this._toggleHelp(false);
    });

    this.gameEl = el('div', { class: 'pulse-game' }, [hud, this.boardWrap, this.helpOverlay]);
    this.container.appendChild(this.gameEl);

    this.input = new InputController(this.canvas, this.renderer, {
      onLanePress: (lane) => this._onLanePress(lane),
      onKey: (name) => this._onKey(name),
    });

    this._onResize = () => this._fitBoard();
    window.addEventListener('resize', this._onResize);
  }

  _hudRow(label, valueEl) {
    return el('div', { class: 'hud-row' }, [el('span', { class: 'hud-label', text: label }), valueEl]);
  }

  _fitBoard() {
    const avail = Math.min(this.boardWrap.clientWidth || 560, 620);
    this.renderer.resize(Math.max(240, avail)); // floor low enough to fit small phones
  }

  // --- Match lifecycle -----------------------------------------------------

  _startMatch() {
    const seeds = { easy: 1207, medium: 2207, hard: 3207 };
    this.engine = createEngine({ difficulty: this.difficulty, seed: seeds[this.difficulty] || 1234 });
    this._paused = false;
    this._ended = false;
    this.started = true;
    this.endBanner.style.display = 'none';

    this.setupEl.style.display = 'none';
    this.gameEl.style.display = '';
    this._fitBoard();

    start(this.engine, performance.now());
    this._updateHud();
    this._flash('Hit the beat!');
  }

  _restart() {
    this._startMatch();
    sfx.select();
  }

  // --- Input ---------------------------------------------------------------

  _onLanePress(lane) {
    if (!this.started || this._paused || this._ended || this.engine.status.over) return;
    const now = performance.now();
    this.renderer.flashLane(lane, now);
    const j = pressLane(this.engine, lane, now);
    if (j.result === 'perfect' || j.result === 'good') {
      this.renderer.popJudge(j.result, lane, now);
      this._playHit(j.result);
    } else {
      this._playEmpty();
    }
    this._updateHud();
    if (this.engine.status.over) this._onGameOver();
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

  // --- Audio (synthesised) -------------------------------------------------

  _playHit(result) {
    if (result === 'perfect') sfx._tone(880, 90, 'triangle', 0.06);
    else sfx._tone(620, 90, 'sine', 0.05);
  }
  _playMiss() {
    sfx._tone(140, 180, 'sawtooth', 0.08);
  }
  _playEmpty() {
    sfx._tone(300, 50, 'sine', 0.03);
  }

  // --- Game over -----------------------------------------------------------

  _onGameOver() {
    if (this._ended) return;
    this._ended = true;
    const won = this.engine.status.win;
    won ? sfx.win() : sfx.lose();

    this.endBanner.innerHTML = '';
    this.endBanner.appendChild(
      el('div', { class: 'end-card' }, [
        el('h2', { class: 'end-title', text: won ? 'Victory' : 'Defeat' }),
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
    return `Score <b>${e.score}</b> · Max combo <b>${e.maxCombo}×</b> · Accuracy <b>${Math.round(
      accuracy(e) * 100,
    )}%</b><br><span class="end-breakdown">${e.stats.perfect} perfect · ${e.stats.good} good · ${e.stats.miss} miss</span>`;
  }

  // --- HUD -----------------------------------------------------------------

  _updateHud() {
    const e = this.engine;
    this.scoreLabel.textContent = String(e.score);
    this.comboLabel.textContent = e.maxCombo + '×';
    this.accLabel.textContent = Math.round(accuracy(e) * 100) + '%';
    this.bpmLabel.textContent = Math.round(e.bpm) + ' BPM';
    this.modeLabel.textContent = `${DIFFICULTY[this.difficulty].name} · adaptive`;
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
          if (ev.type === 'miss') {
            this.renderer.popJudge('miss', ev.note.lane, now);
            this._playMiss();
          }
        }
        this._updateHud();
        if (this.engine.status.over) this._onGameOver();
      }
      this.renderer.draw(this.engine, now);
    }
    this.raf = requestAnimationFrame(this._loop);
  }

  _helpHtml() {
    return `
      <div class="pulse-help-card">
        <button class="pulse-help-close" data-close="1">✕</button>
        <h2>How to play PULSE</h2>
        <div class="help-cols">
          <div>
            <h3>Goal</h3>
            <p>Drain the enemy's pulse (top bar) to zero before yours (bottom bar) runs out.</p>
            <h3>Hitting</h3>
            <p>Notes fall down four lanes. When a note reaches the line, press its lane — <b>D F J K</b> from left to right, or click the lane. The closer to the line, the better: <b>PERFECT</b> beats <b>GOOD</b>.</p>
          </div>
          <div>
            <h3>Damage & combo</h3>
            <p>Every clean hit damages the enemy and builds your combo (which multiplies score). A <b>miss</b> — wrong timing or letting a note pass — costs <b>you</b> health and breaks the combo.</p>
            <h3>Heavy notes</h3>
            <p>Diamonds are enemy strikes: they hit harder if missed, and reward more if landed.</p>
            <h3>Adaptive tempo</h3>
            <p>Play well and the beat speeds up and thickens; struggle and it eases off.</p>
          </div>
        </div>
        <button class="btn btn-primary" data-close="1">Got it</button>
      </div>`;
  }
}
