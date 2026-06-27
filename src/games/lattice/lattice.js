// =============================================================================
// LATTICE - Game entry (implements the platform game interface)
// -----------------------------------------------------------------------------
// Mirrors RIFT's controller shape: a setup screen, a game view with HUD + hex
// canvas, an AI driver gated on animation, hotseat undo, and a help overlay.
// =============================================================================

import {
  createInitialState,
  applyMove,
  getLegalMoves,
  computeFlips,
  CELL_COUNT,
} from './rules.js';
import { Renderer } from './render.js';
import { InputController } from './input.js';
import { createAI, DIFFICULTY } from './ai.js';
import { el, sfx } from '../../shared/helpers.js';

const AI_PLAYER = 1; // human is player 0 in vs-AI mode
const PLAYER_NAMES = ['Player 1', 'Player 2'];

export function createLatticeGame() {
  return new LatticeGame();
}

class LatticeGame {
  constructor() {
    this.container = null;
    this.options = null;
    this.state = null;
    this.history = [];
    this.mode = 'ai';
    this.difficulty = 'medium';
    this.ai = null;
    this.hover = -1;
    this.view = { legal: new Set(), hover: -1, lastMove: -1, isHumanTurn: true };
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

    container.classList.add('lattice-root');
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
      this.container.classList.remove('lattice-root');
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
      const b = el('button', { class: 'lat-choice', onClick }, [
        el('span', { class: 'lat-choice-title', text: label }),
        el('span', { class: 'lat-choice-sub', text: sub }),
      ]);
      group.push(b);
      return b;
    };

    const modeRow = el('div', { class: 'lat-choice-row' }, [
      choice('Single player', 'Battle the AI', () => this._setMode('ai'), modeButtons),
      choice('Local hotseat', 'Two players, one PC', () => this._setMode('hotseat'), modeButtons),
    ]);
    const diffRow = el('div', { class: 'lat-choice-row' }, [
      choice('Easy', 'Greedy AI', () => this._setDifficulty('easy'), diffButtons),
      choice('Medium', 'Searches ahead', () => this._setDifficulty('medium'), diffButtons),
      choice('Hard', 'Deep search', () => this._setDifficulty('hard'), diffButtons),
    ]);
    this._modeButtons = modeButtons;
    this._diffButtons = diffButtons;
    this._diffRow = diffRow;

    this.setupEl = el('div', { class: 'lat-setup' }, [
      el('h2', { class: 'lat-setup-h', text: 'LATTICE' }),
      el('p', { class: 'lat-setup-p', text: 'Bracket your rival’s nodes and convert the grid. Most territory wins.' }),
      el('div', { class: 'lat-setup-block' }, [el('h3', { text: 'Mode' }), modeRow]),
      el('div', { class: 'lat-setup-block' }, [el('h3', { text: 'AI difficulty' }), diffRow]),
      el('button', { class: 'btn btn-primary lat-start', text: 'Power the Lattice', onClick: () => this._startMatch() }),
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
    this.canvas = el('canvas', { class: 'lat-canvas' });
    this.renderer = new Renderer(this.canvas, this.settings.theme);

    this.turnPill = el('div', { class: 'turn-pill' });
    this.score0 = el('span', { class: 'lat-score-num p0', text: '0' });
    this.score1 = el('span', { class: 'lat-score-num p1', text: '0' });
    this.movesLabel = el('span', { class: 'hud-val' });
    this.modeLabel = el('span', { class: 'hud-val' });
    this.messageEl = el('div', { class: 'lat-message' });

    this.undoBtn = el('button', { class: 'btn', text: 'Undo', onClick: () => this._undo() });
    this.restartBtn = el('button', { class: 'btn', text: 'Restart', onClick: () => this._restart() });
    this.helpBtn = el('button', { class: 'btn', text: 'Help', onClick: () => this._toggleHelp(true) });
    this.menuBtn = el('button', {
      class: 'btn',
      text: '‹ Menu',
      onClick: () => this.options.onExit && this.options.onExit(),
    });

    const scoreBoard = el('div', { class: 'lat-scoreboard' }, [
      el('div', { class: 'lat-score s0' }, [el('span', { class: 'lat-score-label', text: 'P1' }), this.score0]),
      el('div', { class: 'lat-score s1' }, [el('span', { class: 'lat-score-label', text: 'P2' }), this.score1]),
    ]);

    const hud = el('div', { class: 'lat-hud' }, [
      this.turnPill,
      scoreBoard,
      el('div', { class: 'hud-section' }, [
        this._hudRow('Legal moves', this.movesLabel),
        this._hudRow('Mode', this.modeLabel),
      ]),
      this.messageEl,
      el('div', { class: 'hud-controls' }, [this.undoBtn, this.restartBtn, this.helpBtn, this.menuBtn]),
      el('div', { class: 'hud-keys', html: 'Keys: <b>U</b> undo · <b>R</b> restart · <b>H</b> help · <b>M</b> menu' }),
    ]);

    this.boardWrap = el('div', { class: 'lat-board-wrap' }, [this.canvas]);
    this.endBanner = el('div', { class: 'lat-overlay', style: 'display:none' });
    this.boardWrap.appendChild(this.endBanner);

    this.helpOverlay = el('div', { class: 'lat-help', style: 'display:none', html: this._helpHtml() });
    this.helpOverlay.addEventListener('click', (e) => {
      if (e.target === this.helpOverlay || e.target.dataset.close) this._toggleHelp(false);
    });

    this.gameEl = el('div', { class: 'lat-game' }, [hud, this.boardWrap, this.helpOverlay]);
    this.container.appendChild(this.gameEl);

    this.input = new InputController(this.canvas, this.renderer, {
      onCellClick: (i) => this._onCellClick(i),
      onHover: (i) => {
        this.hover = i;
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
    const avail = Math.min(this.boardWrap.clientWidth || 560, 640);
    this.renderer.resize(Math.max(240, avail)); // floor low enough to fit small phones
  }

  // --- Match lifecycle -----------------------------------------------------

  _startMatch() {
    if (this._overTimer) clearTimeout(this._overTimer);
    this.state = createInitialState();
    this.history = [];
    this.aiThinking = false;
    this.ai = this.mode === 'ai' ? createAI(this.difficulty) : null;
    this.endBanner.style.display = 'none';

    this.setupEl.style.display = 'none';
    this.gameEl.style.display = '';
    this.undoBtn.style.display = this.mode === 'hotseat' ? '' : 'none';

    this._fitBoard();
    this._refreshView();
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

  _onCellClick(i) {
    if (!this._interactive()) return;
    if (computeFlips(this.state.cells, i, this.state.turn).length === 0) {
      sfx.select();
      return; // not a legal placement
    }
    this._perform(i);
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

  _refreshView() {
    const legal = new Set(getLegalMoves(this.state).map((m) => m.cellIndex));
    this.view = {
      legal,
      hover: this.hover,
      lastMove: this.state.lastEvent ? this.state.lastEvent.cellIndex : -1,
      isHumanTurn: this.mode === 'hotseat' || this.state.turn !== AI_PLAYER,
    };
  }

  // --- Applying moves ------------------------------------------------------

  _perform(cellIndex) {
    const now = performance.now();
    const next = applyMove(this.state, cellIndex);
    this.history.push(this.state);

    this.renderer.startMoveAnim(next.lastEvent, now);
    if (next.lastEvent.flips.length > 0) sfx.capture();
    else sfx.move();

    const passed = next.lastEvent.opponentPassed;
    this.state = next;
    this._updateHud();

    if (this.state.status.over) {
      this._overTimer = setTimeout(() => this._onGameOver(), 600);
    } else if (passed) {
      const name = (p) => (this.mode === 'ai' ? (p === 0 ? 'You' : 'AI') : PLAYER_NAMES[p]);
      const passer = this.state.turn === 0 ? 1 : 0;
      this._flash(`${name(passer)} passed — ${name(this.state.turn)} to move again`);
    } else {
      this._announceTurn();
    }
  }

  _announceTurn() {
    if (this.mode === 'hotseat') this._flash(`${PLAYER_NAMES[this.state.turn]} to move`);
    else if (this.state.turn === AI_PLAYER) this._flash('AI is thinking…');
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
    const { winner, reason, score } = this.state.status;
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
        el('p', { class: 'end-score', html: `<span class="p0">${score[0]}</span> — <span class="p1">${score[1]}</span>` }),
        el('p', { class: 'end-reason', text: reason }),
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
      const action = this.ai.chooseAction(this.state);
      this.aiThinking = false;
      if (action) this._perform(action.cellIndex);
    }, 360);
  }

  // --- HUD -----------------------------------------------------------------

  _updateHud() {
    const s = this.state;
    const turnName =
      this.mode === 'ai' ? (s.turn === 0 ? 'Your turn' : 'AI turn') : `${PLAYER_NAMES[s.turn]}'s turn`;
    this.turnPill.textContent = turnName;
    this.turnPill.className = 'turn-pill p' + s.turn;

    this.score0.textContent = String(s.status.score[0]);
    this.score1.textContent = String(s.status.score[1]);
    this.movesLabel.textContent = `${getLegalMoves(s).length} · ${CELL_COUNT - s.status.score[0] - s.status.score[1]} open`;
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
      this._refreshView();
      this.renderer.draw(this.state, this.view, now);
      this._maybeRunAI(now);
    }
    this.raf = requestAnimationFrame(this._loop);
  }

  _helpHtml() {
    return `
      <div class="lat-help-card">
        <button class="lat-help-close" data-close="1">✕</button>
        <h2>How to play LATTICE</h2>
        <div class="help-cols">
          <div>
            <h3>Goal</h3>
            <p>Own the most nodes on the hex lattice when no moves remain.</p>
            <h3>Placing</h3>
            <p>Click an empty cell that <b>brackets</b> one or more straight lines of enemy nodes — a line of your rival's nodes with one of yours at the far end. Every bracketed node converts to your colour.</p>
            <p>Glowing dots mark legal placements. Hovering previews exactly which nodes you'd flip.</p>
          </div>
          <div>
            <h3>Passing</h3>
            <p>If you have no legal placement, your turn is skipped automatically. If neither side can move, the game ends.</p>
            <h3>Winning</h3>
            <p>When the lattice locks up, whoever holds more nodes wins. Equal nodes is a draw.</p>
            <h3>Tip</h3>
            <p>The outer rim is hard to flip — nodes there are the most stable territory.</p>
          </div>
        </div>
        <button class="btn btn-primary" data-close="1">Got it</button>
      </div>`;
  }
}
