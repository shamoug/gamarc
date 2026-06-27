// =============================================================================
// VECTOR - Game entry (implements the platform game interface)
// -----------------------------------------------------------------------------
// Turn-based momentum duel. Same controller shape as RIFT/LATTICE: setup screen
// (mode + difficulty), a game view with HUD + canvas, an AI driver gated on
// animation, hotseat undo, and a help overlay.
// =============================================================================

import { createInitialState, applyMove, MAX_PLY, MAX_SPEED } from './rules.js';
import { Renderer } from './render.js';
import { InputController } from './input.js';
import { createAI, DIFFICULTY } from './ai.js';
import { el, sfx } from '../../shared/helpers.js';

const AI_PLAYER = 1;
const PLAYER_NAMES = ['Player 1', 'Player 2'];

export function createVectorGame() {
  return new VectorGame();
}

class VectorGame {
  constructor() {
    this.container = null;
    this.options = null;
    this.state = null;
    this.history = [];
    this.mode = 'ai';
    this.difficulty = 'medium';
    this.ai = null;
    this.hover = null;
    this.paused = false;
    this.aiThinking = false;
    this.raf = null;
    this.settings = { sound: true, theme: 'aurora' };
  }

  // --- Game interface ------------------------------------------------------

  init(container, options = {}) {
    this.container = container;
    this.options = options;
    this.settings = options.settings || this.settings;
    sfx.enabled = !!this.settings.sound;

    container.classList.add('vector-root');
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
    this.paused = true;
  }
  resume() {
    this.paused = false;
  }
  destroy() {
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this._overTimer) clearTimeout(this._overTimer);
    if (this.input) this.input.destroy();
    if (this._onResize) window.removeEventListener('resize', this._onResize);
    if (this.container) {
      this.container.classList.remove('vector-root');
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
    const modeButtons = [];
    const diffButtons = [];
    const choice = (label, sub, onClick, group) => {
      const b = el('button', { class: 'vec-choice', onClick }, [
        el('span', { class: 'vec-choice-title', text: label }),
        el('span', { class: 'vec-choice-sub', text: sub }),
      ]);
      group.push(b);
      return b;
    };

    const modeRow = el('div', { class: 'vec-choice-row' }, [
      choice('Single player', 'Battle the AI', () => this._setMode('ai'), modeButtons),
      choice('Local hotseat', 'Two players, one PC', () => this._setMode('hotseat'), modeButtons),
    ]);
    const diffRow = el('div', { class: 'vec-choice-row' }, [
      choice('Easy', 'Greedy AI', () => this._setDifficulty('easy'), diffButtons),
      choice('Medium', 'Searches ahead', () => this._setDifficulty('medium'), diffButtons),
      choice('Hard', 'Deep search', () => this._setDifficulty('hard'), diffButtons),
    ]);
    this._modeButtons = modeButtons;
    this._diffButtons = diffButtons;
    this._diffRow = diffRow;

    this.setupEl = el('div', { class: 'vec-setup' }, [
      el('h2', { class: 'vec-setup-h', text: 'VECTOR' }),
      el('p', { class: 'vec-setup-p', text: 'Steer with momentum. Ram your rival — but don’t overshoot into the wall.' }),
      el('div', { class: 'vec-setup-block' }, [el('h3', { text: 'Mode' }), modeRow]),
      el('div', { class: 'vec-setup-block' }, [el('h3', { text: 'AI difficulty' }), diffRow]),
      el('button', { class: 'btn btn-primary vec-start', text: 'Launch', onClick: () => this._startMatch() }),
    ]);
    this.container.appendChild(this.setupEl);
    this._setMode('ai');
    this._setDifficulty('medium');
  }

  _setMode(mode) {
    this.mode = mode;
    this._modeButtons.forEach((b, i) => b.classList.toggle('active', (i === 0) === (mode === 'ai')));
    this._diffRow.parentElement.style.opacity = mode === 'ai' ? '1' : '0.35';
    this._diffRow.style.pointerEvents = mode === 'ai' ? 'auto' : 'none';
  }
  _setDifficulty(diff) {
    this.difficulty = diff;
    const order = ['easy', 'medium', 'hard'];
    this._diffButtons.forEach((b, i) => b.classList.toggle('active', order[i] === diff));
  }
  _showSetup() {
    this.setupEl.style.display = '';
    this.gameEl.style.display = 'none';
  }

  // --- Game DOM ------------------------------------------------------------

  _buildGameDom() {
    this.canvas = el('canvas', { class: 'vec-canvas' });
    this.renderer = new Renderer(this.canvas, this.settings.theme);

    this.turnPill = el('div', { class: 'turn-pill' });
    this.hull0 = el('span', { class: 'vec-stat-num p0', text: '' });
    this.hull1 = el('span', { class: 'vec-stat-num p1', text: '' });
    this.speed0 = el('span', { class: 'hud-val' });
    this.speed1 = el('span', { class: 'hud-val' });
    this.roundLabel = el('span', { class: 'hud-val' });
    this.modeLabel = el('span', { class: 'hud-val' });
    this.messageEl = el('div', { class: 'vec-message' });

    this.undoBtn = el('button', { class: 'btn', text: 'Undo', onClick: () => this._undo() });
    this.restartBtn = el('button', { class: 'btn', text: 'Restart', onClick: () => this._restart() });
    this.helpBtn = el('button', { class: 'btn', text: 'Help', onClick: () => this._toggleHelp(true) });
    this.menuBtn = el('button', { class: 'btn', text: '‹ Menu', onClick: () => this.options.onExit && this.options.onExit() });

    const board = el('div', { class: 'vec-statboard' }, [
      el('div', { class: 'vec-stat s0' }, [el('span', { class: 'vec-stat-label', text: 'P1 hull' }), this.hull0]),
      el('div', { class: 'vec-stat s1' }, [el('span', { class: 'vec-stat-label', text: 'P2 hull' }), this.hull1]),
    ]);

    const hud = el('div', { class: 'vec-hud' }, [
      this.turnPill,
      board,
      el('div', { class: 'hud-section' }, [
        this._hudRow('P1 speed', this.speed0),
        this._hudRow('P2 speed', this.speed1),
        this._hudRow('Round', this.roundLabel),
        this._hudRow('Mode', this.modeLabel),
      ]),
      this.messageEl,
      el('div', { class: 'hud-controls' }, [this.undoBtn, this.restartBtn, this.helpBtn, this.menuBtn]),
      el('div', { class: 'hud-keys', html: 'Steer: <b>W A S D</b> / arrows · <b>Q E Z C</b> diagonals · <b>Space</b> coast · or click a target. <b>U</b> undo · <b>R</b> restart · <b>H</b> help' }),
    ]);

    this.boardWrap = el('div', { class: 'vec-board-wrap' }, [this.canvas]);
    this.endBanner = el('div', { class: 'vec-overlay', style: 'display:none' });
    this.boardWrap.appendChild(this.endBanner);

    this.helpOverlay = el('div', { class: 'vec-help', style: 'display:none', html: this._helpHtml() });
    this.helpOverlay.addEventListener('click', (e) => {
      if (e.target === this.helpOverlay || e.target.dataset.close) this._toggleHelp(false);
    });

    this.gameEl = el('div', { class: 'vec-game' }, [hud, this.boardWrap, this.helpOverlay]);
    this.container.appendChild(this.gameEl);

    this.input = new InputController(this.canvas, this.renderer, {
      onAccel: (ax, ay) => this._onAccel(ax, ay),
      onHoverAccel: (ax, ay) => {
        this.hover = ax === null ? null : { ax, ay };
      },
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
    if (this._overTimer) clearTimeout(this._overTimer);
    this.state = createInitialState();
    this.history = [];
    this.aiThinking = false;
    this.hover = null;
    this.ai = this.mode === 'ai' ? createAI(this.difficulty) : null;
    this.endBanner.style.display = 'none';

    this.setupEl.style.display = 'none';
    this.gameEl.style.display = '';
    this.undoBtn.style.display = this.mode === 'hotseat' ? '' : 'none';

    this._fitBoard();
    this._updateHud();
    this._flash(this.mode === 'ai' ? `You are Player 1 (${DIFFICULTY[this.difficulty].name} AI)` : 'Player 1 to move');
  }
  _restart() {
    this._startMatch();
    sfx.select();
  }

  // --- Input ---------------------------------------------------------------

  _interactive() {
    if (!this.state || this.state.status.over) return false;
    if (this.paused || this.aiThinking) return false;
    if (this.renderer.isAnimating(performance.now())) return false;
    if (this.mode === 'ai' && this.state.turn === AI_PLAYER) return false;
    return true;
  }

  _onAccel(ax, ay) {
    if (!this._interactive()) return;
    this._perform({ ax, ay });
  }

  _onKey(name) {
    switch (name) {
      case 'restart':
        this._restart();
        break;
      case 'menu':
        this.options.onExit && this.options.onExit();
        break;
      case 'undo':
        this._undo();
        break;
      case 'help':
        this._toggleHelp(this.helpOverlay.style.display === 'none');
        break;
      case 'deselect':
        if (this.helpOverlay.style.display !== 'none') this._toggleHelp(false);
        break;
    }
  }

  // --- Applying moves ------------------------------------------------------

  _perform(accel) {
    const now = performance.now();
    const next = applyMove(this.state, accel);
    this.history.push(this.state);

    const ev = next.lastEvent;
    this.renderer.startMoveAnim(ev, now);
    if (ev.type === 'ram') sfx.capture();
    else if (ev.type === 'crash') sfx.lose();
    else sfx.move();

    this.state = next;
    this.hover = null;
    this._updateHud();

    if (this.state.status.over) {
      this._overTimer = setTimeout(() => this._onGameOver(), 700);
    } else {
      this._announceTurn();
    }
  }

  _announceTurn() {
    if (this.mode === 'hotseat') this._flash(`${PLAYER_NAMES[this.state.turn]} to move`);
    else if (this.state.turn === AI_PLAYER) this._flash('AI is plotting a course…');
    else this._flash('Your move');
  }

  _undo() {
    if (this.mode !== 'hotseat') return;
    if (this.history.length === 0 || this.aiThinking) return;
    if (this.renderer.isAnimating(performance.now())) return;
    this.state = this.history.pop();
    this.endBanner.style.display = 'none';
    this._updateHud();
    this._flash('Move undone');
    sfx.select();
  }

  _onGameOver() {
    if (!this.state || !this.state.status.over) return; // stale timer after restart
    const { winner, reason } = this.state.status;
    let title;
    if (winner === null) title = 'Stalemate';
    else if (this.mode === 'ai') title = winner === 0 ? 'Victory' : 'Defeat';
    else title = `${PLAYER_NAMES[winner]} wins`;

    if (winner === null) sfx.lose();
    else if (this.mode === 'ai') (winner === 0 ? sfx.win : sfx.lose)();
    else sfx.win();

    this.endBanner.innerHTML = '';
    this.endBanner.appendChild(
      el('div', { class: 'end-card' }, [
        el('h2', { class: 'end-title', text: title }),
        el('p', { class: 'end-reason', text: reason }),
        el('p', { class: 'end-score', html: `Hull <span class="p0">${this.state.craft[0].hp}</span> — <span class="p1">${this.state.craft[1].hp}</span>` }),
        el('div', { class: 'end-actions' }, [
          el('button', { class: 'btn btn-primary', text: 'Play again', onClick: () => this._restart() }),
          el('button', { class: 'btn', text: 'New setup', onClick: () => this._showSetup() }),
          el('button', { class: 'btn', text: 'Menu', onClick: () => this.options.onExit && this.options.onExit() }),
        ]),
      ]),
    );
    this.endBanner.style.display = '';
  }

  // --- AI driver -----------------------------------------------------------

  _maybeRunAI(now) {
    if (this.mode !== 'ai') return;
    if (!this.state || this.state.status.over) return;
    if (this.state.turn !== AI_PLAYER) return;
    if (this.paused || this.aiThinking) return;
    if (this.renderer.isAnimating(now)) return;

    this.aiThinking = true;
    setTimeout(() => {
      if (!this.state || this.state.status.over || this.state.turn !== AI_PLAYER) {
        this.aiThinking = false;
        return;
      }
      const accel = this.ai.chooseAction(this.state);
      this.aiThinking = false;
      if (accel) this._perform(accel);
    }, 360);
  }

  // --- HUD -----------------------------------------------------------------

  _updateHud() {
    const s = this.state;
    const turnName = this.mode === 'ai' ? (s.turn === 0 ? 'Your turn' : 'AI turn') : `${PLAYER_NAMES[s.turn]}'s turn`;
    this.turnPill.textContent = turnName;
    this.turnPill.className = 'turn-pill p' + s.turn;

    this.hull0.textContent = String(s.craft[0].hp);
    this.hull1.textContent = String(s.craft[1].hp);
    const spd = (c) => Math.max(Math.abs(c.vx), Math.abs(c.vy));
    this.speed0.textContent = `${spd(s.craft[0])} / ${MAX_SPEED}`;
    this.speed1.textContent = `${spd(s.craft[1])} / ${MAX_SPEED}`;
    this.roundLabel.textContent = `${Math.floor(s.ply / 2) + 1} / ${MAX_PLY / 2}`;
    this.modeLabel.textContent = this.mode === 'ai' ? `vs AI · ${DIFFICULTY[this.difficulty].name}` : 'Hotseat';
  }

  _flash(text) {
    this.messageEl.textContent = text;
  }
  _toggleHelp(show) {
    this.helpOverlay.style.display = show ? '' : 'none';
  }

  // --- Render loop ---------------------------------------------------------

  _loop(now) {
    if (this.state && this.gameEl.style.display !== 'none') {
      const view = { isHumanTurn: this.mode === 'hotseat' || this.state.turn !== AI_PLAYER, hover: this.hover };
      this.renderer.draw(this.state, view, now);
      this._maybeRunAI(now);
    }
    this.raf = requestAnimationFrame(this._loop);
  }

  _helpHtml() {
    return `
      <div class="vec-help-card">
        <button class="vec-help-close" data-close="1">✕</button>
        <h2>How to play VECTOR</h2>
        <div class="help-cols">
          <div>
            <h3>Momentum</h3>
            <p>Each craft has a <b>velocity</b>. On your turn you nudge it: pick one of nine accelerations (each axis −1, 0 or +1). Your new velocity then carries you in a straight line — the dashed arrow shows where coasting takes you.</p>
            <h3>Steering</h3>
            <p>Click a glowing <b>target</b> to fly there, or use <b>W A S D</b> / arrows (and <b>Q E Z C</b> for diagonals, <b>Space</b> to coast). Top speed is ${MAX_SPEED} per axis.</p>
          </div>
          <div>
            <h3>Ramming</h3>
            <p>If your path crosses the enemy's cell you <b>ram</b> them — damage grows with your impact speed. Drain their hull to zero to win.</p>
            <h3>The wall</h3>
            <p>Fly off the arena and you <b>crash</b> — instant loss. Carrying speed toward the edge is the central risk: brake in time. Crash targets are marked with a red ✕.</p>
            <h3>Time</h3>
            <p>If the round limit is reached, the craft with more hull wins (equal hull is a draw).</p>
          </div>
        </div>
        <button class="btn btn-primary" data-close="1">Got it</button>
      </div>`;
  }
}
