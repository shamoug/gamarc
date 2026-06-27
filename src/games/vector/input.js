// =============================================================================
// VECTOR - Mouse & keyboard input
// -----------------------------------------------------------------------------
// A turn = choosing an acceleration (ax,ay) in {-1,0,1}^2. The player clicks one
// of the nine ghost steering targets, or presses a key. Owns no game state.
//
// Handlers: onAccel(ax, ay), onHoverAccel(ax|null, ay), onKey(name)
// =============================================================================

// Keyboard steering. Up is -y (screen). Includes WASD, arrows, diagonals, coast.
const ACCEL_KEYS = {
  w: [0, -1], ArrowUp: [0, -1],
  s: [0, 1], ArrowDown: [0, 1],
  a: [-1, 0], ArrowLeft: [-1, 0],
  d: [1, 0], ArrowRight: [1, 0],
  q: [-1, -1], e: [1, -1], z: [-1, 1], c: [1, 1],
  x: [0, 0], ' ': [0, 0], // coast
};
const CMD_KEYS = { r: 'restart', m: 'menu', h: 'help', u: 'undo', Escape: 'deselect' };

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
    const g = this.renderer.ghostAt(t.clientX - rect.left, t.clientY - rect.top);
    if (g) this.handlers.onAccel(g.ax, g.ay);
  }

  setEnabled(on) {
    this.enabled = on;
  }

  _ghost(ev) {
    const rect = this.canvas.getBoundingClientRect();
    return this.renderer.ghostAt(ev.clientX - rect.left, ev.clientY - rect.top);
  }

  _onClick(ev) {
    if (!this.enabled) return;
    if (this._touchActive) {
      this._touchActive = false;
      return; // already handled on touchstart
    }
    const g = this._ghost(ev);
    if (g) this.handlers.onAccel(g.ax, g.ay);
  }

  _onMove(ev) {
    const g = this._ghost(ev);
    if (this.handlers.onHoverAccel) {
      if (g) this.handlers.onHoverAccel(g.ax, g.ay);
      else this.handlers.onHoverAccel(null, null);
    }
  }

  _onLeave() {
    if (this.handlers.onHoverAccel) this.handlers.onHoverAccel(null, null);
  }

  _onKey(ev) {
    const tag = (ev.target && ev.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const key = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;

    if (key in ACCEL_KEYS) {
      ev.preventDefault();
      if (!this.enabled) return;
      const [ax, ay] = ACCEL_KEYS[key];
      this.handlers.onAccel(ax, ay);
      return;
    }
    if (key in CMD_KEYS) {
      ev.preventDefault();
      this.handlers.onKey(CMD_KEYS[key]);
    }
  }

  destroy() {
    this.canvas.removeEventListener('click', this._onClick);
    this.canvas.removeEventListener('mousemove', this._onMove);
    this.canvas.removeEventListener('mouseleave', this._onLeave);
    this.canvas.removeEventListener('touchstart', this._onTouch);
    window.removeEventListener('keydown', this._onKey);
  }
}
