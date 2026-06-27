// =============================================================================
// Shared helpers used across the platform shell and games.
// No external dependencies, no network calls.
// =============================================================================

/** Clamp n into [lo, hi]. */
export function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

/** Linear interpolation. */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Ease in/out cubic, t in [0,1]. */
export function easeInOut(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// --- Persistent settings ----------------------------------------------------

const SETTINGS_KEY = 'arcade.settings.v1';

const DEFAULT_SETTINGS = Object.freeze({
  sound: true,
  theme: 'aurora', // 'aurora' | 'amber'
});

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable: ignore, settings stay in-memory */
  }
}

// --- Sound (synthesised, no asset files) ------------------------------------

let audioCtx = null;
function ctx() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audioCtx = new AC();
  }
  return audioCtx;
}

/**
 * A tiny WebAudio sound effect bank. All tones are generated at runtime so the
 * project ships with zero audio files and makes no network calls.
 */
export const sfx = {
  enabled: true,
  _tone(freq, durMs, type = 'sine', gain = 0.06) {
    if (!this.enabled) return;
    const ac = ctx();
    if (!ac) return;
    if (ac.state === 'suspended') ac.resume();
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.value = gain;
    osc.connect(g);
    g.connect(ac.destination);
    const now = ac.currentTime;
    g.gain.setValueAtTime(gain, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + durMs / 1000);
    osc.start(now);
    osc.stop(now + durMs / 1000);
  },
  select() {
    this._tone(520, 70, 'triangle');
  },
  move() {
    this._tone(360, 90, 'sine');
  },
  capture() {
    this._tone(200, 140, 'sawtooth', 0.08);
  },
  phase() {
    this._tone(700, 120, 'sine');
    setTimeout(() => this._tone(900, 90, 'sine'), 60);
  },
  collapse() {
    this._tone(120, 320, 'sawtooth', 0.09);
  },
  win() {
    [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this._tone(f, 160, 'triangle'), i * 110));
  },
  lose() {
    [392, 330, 262].forEach((f, i) => setTimeout(() => this._tone(f, 200, 'sine'), i * 140));
  },
};

/** Create a DOM element with attributes/children in one call. */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (v !== null && v !== undefined) {
      node.setAttribute(k, v);
    }
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}
