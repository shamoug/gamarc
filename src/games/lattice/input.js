// =============================================================================
// LATTICE - Mouse & keyboard input
// -----------------------------------------------------------------------------
// Translates DOM events into semantic intents for the controller. The renderer
// maps pixels to a hex-cell index; this module owns no game state.
//
// Handlers: onCellClick(index), onHover(index|-1), onKey(name)
// =============================================================================

const KEY_MAP = {
  r: 'restart',
  m: 'menu',
  h: 'help',
  u: 'undo',
  Escape: 'deselect',
};

export class InputController {
  constructor(canvas, renderer, handlers) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.handlers = handlers;

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
    if (!ev.touches || ev.touches.length === 0) return;
    ev.preventDefault(); // tap on contact + suppress the 300ms ghost click
    this._touchActive = true;
    const rect = this.canvas.getBoundingClientRect();
    const t = ev.touches[0];
    const i = this.renderer.pointToCell(t.clientX - rect.left, t.clientY - rect.top);
    if (i >= 0) this.handlers.onCellClick(i);
  }

  _index(ev) {
    const rect = this.canvas.getBoundingClientRect();
    return this.renderer.pointToCell(ev.clientX - rect.left, ev.clientY - rect.top);
  }

  _onClick(ev) {
    if (this._touchActive) {
      this._touchActive = false;
      return; // already handled on touchstart
    }
    const i = this._index(ev);
    if (i >= 0) this.handlers.onCellClick(i);
  }

  _onMove(ev) {
    if (this.handlers.onHover) this.handlers.onHover(this._index(ev));
  }

  _onLeave() {
    if (this.handlers.onHover) this.handlers.onHover(-1);
  }

  _onKey(ev) {
    const name = KEY_MAP[ev.key];
    if (!name) return;
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
