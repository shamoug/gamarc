// =============================================================================
// PULSE - Mouse & keyboard input
// -----------------------------------------------------------------------------
// Lane keys D/F/J/K (and clicks on a lane) fire that lane. Auto-repeat is
// ignored so a held key doesn't spam presses. Owns no game state.
//
// Handlers: onLanePress(lane), onKey(name)
// =============================================================================

const LANE_KEYS = { d: 0, f: 1, j: 2, k: 3 };
const CMD_KEYS = { r: 'restart', m: 'menu', h: 'help', p: 'pause', Escape: 'deselect' };

export class InputController {
  constructor(canvas, renderer, handlers) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.handlers = handlers;
    this.held = new Set();

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onClick = this._onClick.bind(this);
    this._onTouch = this._onTouch.bind(this);

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    canvas.addEventListener('mousedown', this._onClick);
    // Touch lanes: each finger can strike a different lane at once.
    canvas.addEventListener('touchstart', this._onTouch, { passive: false });
  }

  _onTouch(ev) {
    ev.preventDefault(); // fire on contact + suppress the emulated mousedown
    const rect = this.canvas.getBoundingClientRect();
    for (const t of ev.changedTouches) {
      const lane = this.renderer.laneAt(t.clientX - rect.left, t.clientY - rect.top);
      if (lane >= 0) this.handlers.onLanePress(lane);
    }
  }

  _onKeyDown(ev) {
    const tag = (ev.target && ev.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    const key = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;

    if (key in LANE_KEYS) {
      ev.preventDefault();
      if (ev.repeat || this.held.has(key)) return; // ignore auto-repeat
      this.held.add(key);
      this.handlers.onLanePress(LANE_KEYS[key]);
      return;
    }
    if (key in CMD_KEYS) {
      ev.preventDefault();
      this.handlers.onKey(CMD_KEYS[key]);
    }
  }

  _onKeyUp(ev) {
    const key = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
    this.held.delete(key);
  }

  _onClick(ev) {
    const rect = this.canvas.getBoundingClientRect();
    const lane = this.renderer.laneAt(ev.clientX - rect.left, ev.clientY - rect.top);
    if (lane >= 0) this.handlers.onLanePress(lane);
  }

  destroy() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    this.canvas.removeEventListener('mousedown', this._onClick);
    this.canvas.removeEventListener('touchstart', this._onTouch);
  }
}
