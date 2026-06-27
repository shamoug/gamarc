// =============================================================================
// QUANTA - Touch, mouse & keyboard input
// -----------------------------------------------------------------------------
// Tap (or click) a tile to rotate it clockwise — the primary, touch-native
// control. A hovered cell is reported for the desktop highlight. Keyboard
// shortcuts cover restart / menu / help / next. Owns no game state.
//
// Handlers: onRotate(row,col), onHover(row|null,col), onKey(name)
// =============================================================================

const CMD_KEYS = { r: 'restart', m: 'menu', h: 'help', n: 'next', Enter: 'next', Escape: 'deselect' };

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
    this._onTouchStart = this._onTouchStart.bind(this);
    this._onKey = this._onKey.bind(this);

    canvas.addEventListener('click', this._onClick);
    canvas.addEventListener('mousemove', this._onMove);
    canvas.addEventListener('mouseleave', this._onLeave);
    // Touch: handle directly and suppress the synthetic click that follows.
    canvas.addEventListener('touchstart', this._onTouchStart, { passive: false });
    window.addEventListener('keydown', this._onKey);
  }

  setEnabled(on) {
    this.enabled = on;
  }

  _cell(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    return this.renderer.pointToCell(clientX - rect.left, clientY - rect.top);
  }

  _onTouchStart(ev) {
    if (!this.enabled) return;
    if (!ev.touches || ev.touches.length === 0) return;
    ev.preventDefault(); // stop scroll/zoom + the 300ms ghost click
    this._touchActive = true;
    const t = ev.touches[0];
    const cell = this._cell(t.clientX, t.clientY);
    if (cell) this.handlers.onRotate(cell.row, cell.col);
  }

  _onClick(ev) {
    if (!this.enabled) return;
    if (this._touchActive) {
      this._touchActive = false;
      return; // already handled by touchstart
    }
    const cell = this._cell(ev.clientX, ev.clientY);
    if (cell) this.handlers.onRotate(cell.row, cell.col);
  }

  _onMove(ev) {
    if (this._touchActive) return;
    const cell = this._cell(ev.clientX, ev.clientY);
    if (this.handlers.onHover) {
      if (cell) this.handlers.onHover(cell.row, cell.col);
      else this.handlers.onHover(null, null);
    }
  }

  _onLeave() {
    if (this.handlers.onHover) this.handlers.onHover(null, null);
  }

  _onKey(ev) {
    const tag = (ev.target && ev.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const key = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
    const name = CMD_KEYS[key];
    if (!name) return;
    ev.preventDefault();
    this.handlers.onKey(name);
  }

  destroy() {
    this.canvas.removeEventListener('click', this._onClick);
    this.canvas.removeEventListener('mousemove', this._onMove);
    this.canvas.removeEventListener('mouseleave', this._onLeave);
    this.canvas.removeEventListener('touchstart', this._onTouchStart);
    window.removeEventListener('keydown', this._onKey);
  }
}
