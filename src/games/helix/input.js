// =============================================================================
// HELIX - Mouse & keyboard input
// -----------------------------------------------------------------------------
// Move the two-wide cursor with WASD / arrows, swap with Space/Enter, nudge the
// board up with Shift, or click a tile to swap it with its right neighbour.
// Owns no game state.
//
// Handlers: onMove(dRow,dCol), onSwapCursor(), onSwapAt(row,col), onNudge(),
//           onKey(name)
// =============================================================================

const MOVE_KEYS = {
  w: [-1, 0], ArrowUp: [-1, 0],
  s: [1, 0], ArrowDown: [1, 0],
  a: [0, -1], ArrowLeft: [0, -1],
  d: [0, 1], ArrowRight: [0, 1],
};
const CMD_KEYS = { r: 'restart', m: 'menu', h: 'help', p: 'pause', Escape: 'deselect' };

export class InputController {
  constructor(canvas, renderer, handlers) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.handlers = handlers;
    this.enabled = true;

    this._touchActive = false;
    this._onClick = this._onClick.bind(this);
    this._onTouch = this._onTouch.bind(this);
    this._onKey = this._onKey.bind(this);
    canvas.addEventListener('click', this._onClick);
    canvas.addEventListener('touchstart', this._onTouch, { passive: false });
    window.addEventListener('keydown', this._onKey);
  }

  setEnabled(on) {
    this.enabled = on;
  }

  _onTouch(ev) {
    if (!this.enabled) return;
    if (!ev.touches || ev.touches.length === 0) return;
    ev.preventDefault(); // tap on contact + suppress the 300ms ghost click
    this._touchActive = true;
    const rect = this.canvas.getBoundingClientRect();
    const t = ev.touches[0];
    const cell = this.renderer.pointToCell(t.clientX - rect.left, t.clientY - rect.top);
    if (cell) this.handlers.onSwapAt(cell.row, cell.col);
  }

  _onClick(ev) {
    if (!this.enabled) return;
    if (this._touchActive) {
      this._touchActive = false;
      return; // already handled on touchstart
    }
    const rect = this.canvas.getBoundingClientRect();
    const cell = this.renderer.pointToCell(ev.clientX - rect.left, ev.clientY - rect.top);
    if (cell) this.handlers.onSwapAt(cell.row, cell.col);
  }

  _onKey(ev) {
    const tag = (ev.target && ev.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const key = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;

    if (key in MOVE_KEYS) {
      ev.preventDefault();
      if (!this.enabled) return;
      const [dr, dc] = MOVE_KEYS[key];
      this.handlers.onMove(dr, dc);
      return;
    }
    if (key === ' ' || key === 'enter' || key === 'j') {
      ev.preventDefault();
      if (this.enabled) this.handlers.onSwapCursor();
      return;
    }
    if (key === 'shift' || key === 'k') {
      ev.preventDefault();
      if (this.enabled) this.handlers.onNudge();
      return;
    }
    if (key in CMD_KEYS) {
      ev.preventDefault();
      this.handlers.onKey(CMD_KEYS[key]);
    }
  }

  destroy() {
    this.canvas.removeEventListener('click', this._onClick);
    this.canvas.removeEventListener('touchstart', this._onTouch);
    window.removeEventListener('keydown', this._onKey);
  }
}
