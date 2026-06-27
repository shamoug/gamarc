// =============================================================================
// RIFT - Game entry (implements the platform game interface)
// -----------------------------------------------------------------------------
// Wires together rules (logic), render (canvas), input, and ai. Owns the
// view-level state: selection, history (undo), mode, difficulty, animation
// pacing and the HUD.
// =============================================================================

import {
  createInitialState,
  applyAction,
  getMovesForPiece,
  getPiece,
  occupantAt,
  canPhase,
  getCollapseInfo,
  PLANE,
  BACK_ROW,
  COLLAPSE_EVERY_ROUNDS,
} from './rules.js';
import { Renderer } from './render.js';
import { InputController } from './input.js';
import { createAI, DIFFICULTY } from './ai.js';
import { el, sfx } from '../../shared/helpers.js';

const AI_PLAYER = 1; // in vs-AI mode the human is player 0
const PLAYER_NAMES = ['Player 1', 'Player 2'];
const TYPE_GLYPH = { core: '◆', runner: 'R', shifter: 'S', guard: 'G' };

/** Factory used by the manifest. */
export function createRiftGame() {
  return new RiftGame();
}

class RiftGame {
  constructor() {
    this.container = null;
    this.options = null;
    this.state = null;
    this.history = [];
    this.mode = 'ai';
    this.difficulty = 'medium';
    this.ai = null;
    this.selectedId = null;
    this.view = { selectedId: null, legalCells: [] };
    this.paused = false;
    this.aiThinking = false;
    this.raf = null;
    this.renderer = null;
    this.input = null;
    this.settings = { sound: true, theme: 'aurora' };
  }

  // --- Game interface ------------------------------------------------------

  init(container, options = {}) {
    this.container = container;
    this.options = options;
    this.settings = options.settings || this.settings;
    sfx.enabled = !!this.settings.sound;

    container.classList.add('rift-root');
    container.innerHTML = '';
    this._buildSetup();
    this._buildGameDom();
    this._showSetup();
  }

  start() {
    // The setup screen is shown by init(); the player presses "Enter the Rift".
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
      this.container.classList.remove('rift-root');
      this.container.innerHTML = '';
    }
  }

  /** Called by the shell when global settings change. */
  applySettings(settings) {
    this.settings = settings;
    sfx.enabled = !!settings.sound;
    if (this.renderer) this.renderer.setTheme(settings.theme);
  }

  // --- Setup screen --------------------------------------------------------

  _buildSetup() {
    const modeButtons = [];
    const diffButtons = [];

    const makeChoice = (label, sub, onClick, group) => {
      const b = el('button', { class: 'rift-choice', onClick }, [
        el('span', { class: 'rift-choice-title', text: label }),
        el('span', { class: 'rift-choice-sub', text: sub }),
      ]);
      group.push(b);
      return b;
    };

    const modeRow = el('div', { class: 'rift-choice-row' }, [
      makeChoice('Single player', 'Battle the AI', () => this._setMode('ai'), modeButtons),
      makeChoice('Local hotseat', 'Two players, one PC', () => this._setMode('hotseat'), modeButtons),
    ]);

    const diffRow = el('div', { class: 'rift-choice-row' }, [
      makeChoice('Easy', 'Greedy AI', () => this._setDifficulty('easy'), diffButtons),
      makeChoice('Medium', 'Looks 1 move ahead', () => this._setDifficulty('medium'), diffButtons),
      makeChoice('Hard', 'Deeper search', () => this._setDifficulty('hard'), diffButtons),
    ]);

    this._modeButtons = modeButtons;
    this._diffButtons = diffButtons;
    this._diffRow = diffRow;

    const startBtn = el('button', {
      class: 'btn btn-primary rift-start',
      text: 'Enter the Rift',
      onClick: () => this._startMatch(),
    });

    this.setupEl = el('div', { class: 'rift-setup' }, [
      el('h2', { class: 'rift-setup-h', text: 'RIFT' }),
      el('p', { class: 'rift-setup-p', text: 'Two planes. One Core. The arena is closing in.' }),
      el('div', { class: 'rift-setup-block' }, [el('h3', { text: 'Mode' }), modeRow]),
      el('div', { class: 'rift-setup-block', id: 'rift-diff-block' }, [el('h3', { text: 'AI difficulty' }), diffRow]),
      startBtn,
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
    this.canvas = el('canvas', { class: 'rift-canvas' });
    this.renderer = new Renderer(this.canvas, this.settings.theme);

    // HUD elements (filled by _updateHud).
    this.turnPill = el('div', { class: 'turn-pill' });
    this.roundLabel = el('span', { class: 'hud-val' });
    this.collapseLabel = el('span', { class: 'hud-val' });
    this.modeLabel = el('span', { class: 'hud-val' });
    this.capturedP0 = el('div', { class: 'captured-row' });
    this.capturedP1 = el('div', { class: 'captured-row' });
    this.messageEl = el('div', { class: 'rift-message' });

    this.phaseBtn = el('button', { class: 'btn', text: 'Phase ⤬', onClick: () => this._tryPhase() });
    this.undoBtn = el('button', { class: 'btn', text: 'Undo', onClick: () => this._undo() });
    this.restartBtn = el('button', { class: 'btn', text: 'Restart', onClick: () => this._restart() });
    this.emphasisBtn = el('button', { class: 'btn', text: 'Emphasis', onClick: () => this._cycleEmphasis() });
    this.helpBtn = el('button', { class: 'btn', text: 'Help', onClick: () => this._toggleHelp(true) });
    this.menuBtn = el('button', {
      class: 'btn',
      text: '‹ Menu',
      onClick: () => this.options.onExit && this.options.onExit(),
    });

    const hud = el('div', { class: 'rift-hud' }, [
      this.turnPill,
      el('div', { class: 'hud-section' }, [
        this._hudRow('Round', this.roundLabel),
        this._hudRow('Next collapse', this.collapseLabel),
        this._hudRow('Mode', this.modeLabel),
      ]),
      el('div', { class: 'hud-section' }, [
        el('div', { class: 'hud-label', text: 'Player 1 lost' }),
        this.capturedP0,
        el('div', { class: 'hud-label', text: 'Player 2 lost' }),
        this.capturedP1,
      ]),
      this.messageEl,
      el('div', { class: 'hud-controls' }, [
        this.phaseBtn,
        this.emphasisBtn,
        this.undoBtn,
        this.restartBtn,
        this.helpBtn,
        this.menuBtn,
      ]),
      el('div', { class: 'hud-keys', html: 'Keys: <b>Space</b> phase · <b>E</b> emphasis · <b>U</b> undo · <b>R</b> restart · <b>H</b> help · <b>M</b> menu' }),
    ]);

    this.boardWrap = el('div', { class: 'rift-board-wrap' }, [this.canvas]);

    // End-of-game banner.
    this.endBanner = el('div', { class: 'rift-overlay', style: 'display:none' });
    this.boardWrap.appendChild(this.endBanner);

    // Help overlay.
    this.helpOverlay = el('div', { class: 'rift-help', style: 'display:none', html: this._helpHtml() });
    this.helpOverlay.addEventListener('click', (e) => {
      if (e.target === this.helpOverlay || e.target.dataset.close) this._toggleHelp(false);
    });

    this.gameEl = el('div', { class: 'rift-game' }, [hud, this.boardWrap, this.helpOverlay]);
    this.container.appendChild(this.gameEl);

    this.input = new InputController(this.canvas, this.renderer, {
      onCellClick: (r, c) => this._onCellClick(r, c),
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
    const size = Math.max(240, avail); // floor low enough to fit small phones
    this.renderer.resize(size);
  }

  // --- Match lifecycle -----------------------------------------------------

  _startMatch() {
    if (this._overTimer) clearTimeout(this._overTimer);
    this.state = createInitialState();
    this.history = [];
    this.selectedId = null;
    this.aiThinking = false;
    this.ai = this.mode === 'ai' ? createAI(this.difficulty) : null;
    this.endBanner.style.display = 'none';

    this.setupEl.style.display = 'none';
    this.gameEl.style.display = '';
    this.undoBtn.style.display = this.mode === 'hotseat' ? '' : 'none';

    this._fitBoard();
    this._clearSelection();
    this._updateHud();
    this._flash(this.mode === 'ai' ? `You are Player 1 (${DIFFICULTY[this.difficulty].name} AI)` : 'Player 1 to move');
  }

  _restart() {
    this._startMatch();
    sfx.select();
  }

  // --- Selection & input ---------------------------------------------------

  _interactive() {
    if (!this.state || this.state.status.over) return false;
    if (this.paused || this.aiThinking) return false;
    if (this.renderer.isAnimating(performance.now())) return false;
    if (this.mode === 'ai' && this.state.turn === AI_PLAYER) return false;
    return true;
  }

  _onCellClick(row, col) {
    if (!this._interactive()) return;

    // If a piece is selected and this is a legal destination, move there.
    if (this.selectedId != null) {
      const dest = this.view.legalCells.find((c) => c.row === row && c.col === col);
      if (dest) {
        this._perform({ type: 'move', pieceId: this.selectedId, toRow: row, toCol: col });
        return;
      }
    }

    // Otherwise (re)select an own piece on this cell.
    const own = this._ownPiecesAt(row, col);
    if (own.length === 0) {
      this._clearSelection();
      return;
    }
    // Stacked own pieces (Real + Rift): clicking again cycles between them.
    let pick = own[0];
    if (own.length > 1 && own.some((p) => p.id === this.selectedId)) {
      const idx = own.findIndex((p) => p.id === this.selectedId);
      pick = own[(idx + 1) % own.length];
    } else if (own.some((p) => p.id === this.selectedId)) {
      pick = own.find((p) => p.id === this.selectedId);
    }
    this._select(pick.id);
    sfx.select();
  }

  _ownPiecesAt(row, col) {
    return this.state.pieces.filter((p) => p.row === row && p.col === col && p.owner === this.state.turn);
  }

  _select(id) {
    this.selectedId = id;
    const piece = getPiece(this.state, id);
    const moves = piece ? getMovesForPiece(this.state, piece) : [];
    this.view = {
      selectedId: id,
      legalCells: moves.map((m) => ({
        row: m.toRow,
        col: m.toCol,
        capture: !!occupantAt(this.state, m.toRow, m.toCol, piece.plane),
      })),
    };
    this.phaseBtn.disabled = !(piece && canPhase(this.state, piece));
  }

  _clearSelection() {
    this.selectedId = null;
    this.view = { selectedId: null, legalCells: [] };
    this.phaseBtn.disabled = true;
  }

  _tryPhase() {
    if (!this._interactive() || this.selectedId == null) return;
    const piece = getPiece(this.state, this.selectedId);
    if (piece && canPhase(this.state, piece)) {
      this._perform({ type: 'phase', pieceId: piece.id });
    } else {
      this._flash('That piece cannot phase here.');
    }
  }

  _onKey(name) {
    switch (name) {
      case 'phase':
        this._tryPhase();
        break;
      case 'emphasis':
        this._cycleEmphasis();
        break;
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
        else this._clearSelection();
        break;
    }
  }

  _cycleEmphasis() {
    const order = [null, PLANE.REAL, PLANE.RIFT];
    const cur = order.indexOf(this.renderer.emphasis);
    this.renderer.emphasis = order[(cur + 1) % order.length];
    const label = ['Both planes', 'Real plane', 'Rift plane'][(cur + 1) % order.length];
    this._flash(label + ' emphasised');
  }

  // --- Applying actions ----------------------------------------------------

  _perform(action) {
    const piece = getPiece(this.state, action.pieceId);
    const from = { row: piece.row, col: piece.col };
    const now = performance.now();

    // Detect a capture from the board itself: a move that also completes a
    // collapse round overwrites lastEvent, so we can't read the capture off it.
    const captured =
      action.type === 'move' && !!occupantAt(this.state, action.toRow, action.toCol, piece.plane);
    const prevCollapse = this.state.collapseLevel;

    const next = applyAction(this.state, action);
    this.history.push(this.state);

    // Animations + sound based on what happened.
    if (action.type === 'move') {
      this.renderer.startMoveAnim(action.pieceId, from, { row: action.toRow, col: action.toCol }, now);
      if (captured) {
        this.renderer.startCaptureAnim(action.toRow, action.toCol, now);
        sfx.capture();
      } else {
        sfx.move();
      }
    } else if (action.type === 'phase') {
      this.renderer.startPhaseAnim(action.pieceId, now);
      sfx.phase();
    }
    if (next.collapseLevel > prevCollapse) {
      this.renderer.startCollapseAnim(next.collapseLevel, now);
      sfx.collapse();
    }

    this.state = next;
    this._clearSelection();
    this._updateHud();

    if (this.state.status.over) {
      // Let the closing animation play, then show the result.
      this._overTimer = setTimeout(() => this._onGameOver(), 650);
    } else {
      this._announceTurn();
    }
  }

  _announceTurn() {
    if (this.mode === 'hotseat') {
      this._flash(`${PLAYER_NAMES[this.state.turn]} to move`);
    } else if (this.state.turn === AI_PLAYER) {
      this._flash('AI is thinking…');
    } else {
      this._flash('Your move');
    }
  }

  _undo() {
    if (this.mode !== 'hotseat') return;
    if (this.history.length === 0 || this.aiThinking) return;
    if (this.renderer.isAnimating(performance.now())) return;
    this.state = this.history.pop();
    this.endBanner.style.display = 'none';
    this._clearSelection();
    this._updateHud();
    this._flash('Move undone');
    sfx.select();
  }

  _onGameOver() {
    if (!this.state || !this.state.status.over) return; // stale timer after restart
    const { winner, reason } = this.state.status;
    let title;
    let won = false;
    if (winner === null) {
      title = 'Draw';
    } else if (this.mode === 'ai') {
      won = winner === 0;
      title = won ? 'Victory' : 'Defeat';
    } else {
      title = `${PLAYER_NAMES[winner]} wins`;
      won = true;
    }
    if (winner === null) sfx.lose();
    else if (this.mode === 'ai') (won ? sfx.win : sfx.lose)();
    else sfx.win();

    this.endBanner.innerHTML = '';
    this.endBanner.appendChild(
      el('div', { class: 'end-card' }, [
        el('h2', { class: 'end-title', text: title }),
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
      if (action) this._perform(action);
    }, 380);
  }

  // --- HUD -----------------------------------------------------------------

  _updateHud() {
    const s = this.state;
    const turnName = this.mode === 'ai' ? (s.turn === 0 ? 'Your turn' : 'AI turn') : `${PLAYER_NAMES[s.turn]}'s turn`;
    this.turnPill.textContent = turnName;
    this.turnPill.className = 'turn-pill p' + s.turn;

    this.roundLabel.textContent = String(s.round);
    const info = getCollapseInfo(s);
    if (info.maxedOut) {
      this.collapseLabel.textContent = 'Arena minimal';
    } else {
      const r = info.roundsUntil;
      this.collapseLabel.textContent = r <= 0 ? 'now' : `${r} round${r === 1 ? '' : 's'}` + (info.warning ? '  ⚠' : '');
    }
    this.collapseLabel.classList.toggle('danger', info.warning);

    this.modeLabel.textContent =
      this.mode === 'ai' ? `vs AI · ${DIFFICULTY[this.difficulty].name}` : 'Hotseat';

    this.capturedP0.innerHTML = this._lostGlyphs(0);
    this.capturedP1.innerHTML = this._lostGlyphs(1);
  }

  _lostGlyphs(owner) {
    // Compare the full starting roster against what remains.
    const remaining = {};
    for (const p of this.state.pieces) {
      if (p.owner === owner) remaining[p.type] = (remaining[p.type] || 0) + 1;
    }
    const startCounts = {};
    for (const t of BACK_ROW) startCounts[t] = (startCounts[t] || 0) + 1;
    const lost = [];
    for (const [type, n] of Object.entries(startCounts)) {
      const gone = n - (remaining[type] || 0);
      for (let i = 0; i < gone; i++) lost.push(TYPE_GLYPH[type]);
    }
    if (lost.length === 0) return '<span class="captured-none">—</span>';
    return lost.map((g) => `<span class="cap-glyph p${owner}">${g}</span>`).join('');
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
      this.renderer.draw(this.state, this.view, now);
      this._maybeRunAI(now);
      // Keep the collapse countdown / phase-button state fresh.
    }
    this.raf = requestAnimationFrame(this._loop);
  }

  _helpHtml() {
    return `
      <div class="rift-help-card">
        <button class="rift-help-close" data-close="1">✕</button>
        <h2>How to play RIFT</h2>
        <div class="help-cols">
          <div>
            <h3>Goal</h3>
            <p>Capture or destroy the enemy <b>Core ◆</b>. Lose your own Core and you lose.</p>
            <h3>Two planes</h3>
            <p>Every square has a <b>Real</b> layer and a <b>Rift</b> layer. Real pieces are solid; Rift pieces are translucent and tucked into the corner. Two pieces can share a square only on different layers.</p>
            <h3>Your turn — pick one</h3>
            <ul>
              <li><b>Move</b> a piece on its current plane.</li>
              <li><b>Phase</b> a piece to the other layer of its square (it must be empty). Press <b>Space</b> or the Phase button.</li>
            </ul>
          </div>
          <div>
            <h3>Pieces</h3>
            <ul>
              <li><b>◆ Core</b> — 1 step any direction. Always Real, never phases.</li>
              <li><b>R Runner</b> — slides orthogonally.</li>
              <li><b>S Shifter</b> — slides diagonally.</li>
              <li><b>G Guard</b> — 1 step any direction.</li>
            </ul>
            <h3>Capture</h3>
            <p>Only on the <b>Real</b> plane, and only between same-plane pieces. Rift pieces cannot capture or be captured — phase up to strike.</p>
            <h3>Collapse</h3>
            <p>Every ${COLLAPSE_EVERY_ROUNDS} rounds the outer ring is destroyed (it flashes a warning one round ahead). Anything on it — including a Core — is lost. 7×7 → 5×5 → 3×3 → centre.</p>
          </div>
        </div>
        <button class="btn btn-primary" data-close="1">Got it</button>
      </div>`;
  }
}
