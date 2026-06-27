// =============================================================================
// RIFT - Mouse & keyboard input
// -----------------------------------------------------------------------------
// Translates raw DOM events into semantic intents and forwards them to the game
// controller (rift.js). It owns no game state itself.
//
// Handlers expected:
//   onCellClick(row, col)   a board cell was clicked
//   onHover(row|null, col)  pointer moved over a cell (or off the board)
//   onKey(name)             a mapped keyboard shortcut fired
// =============================================================================

/** Keyboard map: raw key -> semantic action name. */
const KEY_MAP = {
  e: 'emphasis',
  Tab: 'emphasis',
  ' ': 'phase',
  p: 'phase',
  r: 'restart',
  m: 'menu',
  u: 'undo',
  h: 'help',
  Escape: 'deselect',
};

export class InputController {
  constructor(canvas, renderer, handlers) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.handlers = handlers;
    this.enabled = true;

    this._touchActive = false;
    this._onClick = this._onClick.bind(this);
    this._onMove = this._onMove.bind(this);
    this._onLeave = this._onLeave.bind(this);
    this._onTouch = this._onTouch.bind(this);
    this._onKey = this._onKey.bind(this);

    canvas.addEventListener('click', this._onClick);
    canvas.addEventListener('mousemove', this._onMove);
    canvas.addEventListener('mouseleave', this._onLeave);
    canvas.addEventListener('touchstart', this._onTouch, { passive: false });
    window.addEventListener('keydown', this._onKey);
  }

  _onTouch(ev) {
    if (!this.enabled) return;
    if (!ev.touches || ev.touches.length === 0) return;
    ev.preventDefault(); // tap on contact + suppress the 300ms ghost click
    this._touchActive = true;
    const rect = this.canvas.getBoundingClientRect();
    const t = ev.touches[0];
    const cell = this.renderer.pointToCell(t.clientX - rect.left, t.clientY - rect.top);
    if (cell) this.handlers.onCellClick(cell.row, cell.col);
  }

  setEnabled(on) {
    this.enabled = on;
  }

  _cellFromEvent(ev) {
    const rect = this.canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    return this.renderer.pointToCell(x, y);
  }

  _onClick(ev) {
    if (!this.enabled) return;
    if (this._touchActive) {
      this._touchActive = false;
      return; // already handled on touchstart
    }
    const cell = this._cellFromEvent(ev);
    if (cell) this.handlers.onCellClick(cell.row, cell.col);
  }

  _onMove(ev) {
    const cell = this._cellFromEvent(ev);
    if (this.handlers.onHover) {
      if (cell) this.handlers.onHover(cell.row, cell.col);
      else this.handlers.onHover(null, null);
    }
  }

  _onLeave() {
    if (this.handlers.onHover) this.handlers.onHover(null, null);
  }

  _onKey(ev) {
    const name = KEY_MAP[ev.key];
    if (!name) return;
    // Don't hijack typing in form fields.
    const tag = (ev.target && ev.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    ev.preventDefault();
    this.handlers.onKey(name);
  }

  destroy() {
    this.canvas.removeEventListener('click', this._onClick);
    this.canvas.removeEventListener('mousemove', this._onMove);
    this.canvas.removeEventListener('mouseleave', this._onLeave);
    this.canvas.removeEventListener('touchstart', this._onTouch);
    window.removeEventListener('keydown', this._onKey);
  }
}
