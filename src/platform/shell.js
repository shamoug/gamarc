// =============================================================================
// Platform shell
// -----------------------------------------------------------------------------
// The launcher + game registry + hash router. Games are registered as manifests
// and the shell talks to them only through the game interface (gameInterface.js)
// so new games plug in without changing this file.
// =============================================================================

import { assertManifest, assertGameInstance } from './gameInterface.js';
import { createRiftGame } from '../games/rift/rift.js';
import { createLatticeGame } from '../games/lattice/lattice.js';
import { createPulseGame } from '../games/pulse/pulse.js';
import { createVectorGame } from '../games/vector/vector.js';
import { createHelixGame } from '../games/helix/helix.js';
import { createQuantaGame } from '../games/quanta/quanta.js';
import { el, loadSettings, saveSettings, sfx } from '../shared/helpers.js';

// --- Game registry ----------------------------------------------------------
// To add a game: import its factory and push a manifest here. See README.

const REGISTRY = [
  {
    id: 'rift',
    title: 'RIFT',
    description:
      'Two-plane abstract strategy. Phase between the Real and Rift planes, protect your Core, and outlast the collapsing arena.',
    accent: '#41e0d0',
    accent2: '#f25f8a',
    comingSoon: false,
    factory: createRiftGame,
    thumbnail: drawRiftThumb,
  },
  {
    id: 'lattice',
    title: 'LATTICE',
    description:
      'A territory-capture duel on a hex grid. Bracket your rival’s nodes to convert them, and hold the most territory when the lattice locks up.',
    accent: '#9b7bff',
    accent2: '#41e0d0',
    comingSoon: false,
    factory: createLatticeGame,
    thumbnail: drawLatticeThumb,
  },
  {
    id: 'pulse',
    title: 'PULSE',
    description:
      'Reflex-driven rhythm combat against an adaptive AI. Strike four lanes on the beat to drain the enemy while the tempo bends to your skill.',
    accent: '#ffb347',
    accent2: '#f25f8a',
    comingSoon: false,
    factory: createPulseGame,
    thumbnail: drawPulseThumb,
  },
  {
    id: 'vector',
    title: 'VECTOR',
    description:
      'A momentum-based dueling game on an open field. Steer with inertia, ram your rival, and don’t overshoot into the wall.',
    accent: '#7ce0a3',
    accent2: '#9b7bff',
    comingSoon: false,
    factory: createVectorGame,
    thumbnail: drawVectorThumb,
  },
  {
    id: 'helix',
    title: 'HELIX',
    description:
      'A two-strand puzzle race against a shifting board. Swap nucleotides to splice matches and cascade chains before the strand winds to the top.',
    accent: '#ff7eb6',
    accent2: '#5bd6ff',
    comingSoon: false,
    factory: createHelixGame,
    thumbnail: drawHelixThumb,
  },
  {
    id: 'quanta',
    title: 'QUANTA',
    description:
      'A light-routing puzzle of glowing conduits. Tap to spin each tile and thread the beam from the emitter into every crystal — pure one-finger play.',
    accent: '#5be0c0',
    accent2: '#ffcf5c',
    comingSoon: false,
    factory: createQuantaGame,
    thumbnail: drawQuantaThumb,
  },
];

REGISTRY.forEach(assertManifest);

// --- Shell state ------------------------------------------------------------

let settings = loadSettings();
let activeGame = null; // { instance, container }
let viewEl = null;

export function boot(rootId = 'app') {
  const root = document.getElementById(rootId);
  root.innerHTML = '';
  applyTheme();
  sfx.enabled = settings.sound;

  root.appendChild(buildAppBar());
  viewEl = el('main', { id: 'view', class: 'view' });
  root.appendChild(viewEl);

  window.addEventListener('hashchange', route);
  document.addEventListener('visibilitychange', () => {
    if (!activeGame) return;
    if (document.hidden) activeGame.instance.pause();
    else activeGame.instance.resume();
  });

  route();
}

// --- App bar / settings -----------------------------------------------------

function buildAppBar() {
  const soundBtn = el('button', {
    class: 'icon-btn',
    title: 'Toggle sound',
    onClick: () => {
      settings.sound = !settings.sound;
      sfx.enabled = settings.sound;
      persist();
      soundBtn.textContent = settings.sound ? '🔊' : '🔈';
      if (settings.sound) sfx.select();
    },
  });
  soundBtn.textContent = settings.sound ? '🔊' : '🔈';

  const themeBtn = el('button', {
    class: 'icon-btn',
    title: 'Toggle theme',
    text: '🎨',
    onClick: () => {
      settings.theme = settings.theme === 'aurora' ? 'amber' : 'aurora';
      applyTheme();
      persist();
      if (activeGame && activeGame.instance.applySettings) {
        activeGame.instance.applySettings(settings);
      }
    },
  });

  const title = el('button', {
    class: 'app-title',
    onClick: () => {
      location.hash = '#/';
    },
  }, [
    el('span', { class: 'app-title-mark', text: '◈' }),
    el('span', { class: 'app-title-text', text: 'NEXUS ARCADE' }),
  ]);

  return el('header', { class: 'app-bar' }, [
    title,
    el('div', { class: 'app-bar-spacer' }),
    el('div', { class: 'app-bar-tools' }, [soundBtn, themeBtn]),
  ]);
}

function applyTheme() {
  document.documentElement.dataset.theme = settings.theme;
}

function persist() {
  saveSettings(settings);
}

// --- Routing ----------------------------------------------------------------

function route() {
  const id = (location.hash || '').replace(/^#\/?/, '').trim();
  teardownGame();
  if (!id) {
    showLauncher();
  } else {
    const manifest = REGISTRY.find((m) => m.id === id);
    if (!manifest || manifest.comingSoon) {
      location.hash = '#/';
    } else {
      showGame(manifest);
    }
  }
}

function teardownGame() {
  if (activeGame) {
    try {
      activeGame.instance.destroy();
    } catch (e) {
      console.error('Game destroy failed:', e);
    }
    activeGame = null;
  }
}

function showLauncher() {
  viewEl.innerHTML = '';
  viewEl.className = 'view view-launcher';

  const playable = REGISTRY.filter((m) => !m.comingSoon).length;
  const intro = el('section', { class: 'launcher-intro' }, [
    el('h1', { class: 'launcher-h', text: 'NEXUS ARCADE' }),
    el('p', { class: 'launcher-sub', text: 'A self-contained browser arcade. Pick a game to begin.' }),
    el('div', { class: 'launcher-chips' }, [
      el('span', { class: 'launcher-chip', html: `<b>${playable}</b> games` }),
      el('span', { class: 'launcher-chip', html: 'Works <b>offline</b>' }),
      el('span', { class: 'launcher-chip', html: 'Keyboard <b>&amp;</b> touch' }),
      el('span', { class: 'launcher-chip', html: 'No installs' }),
    ]),
  ]);

  const grid = el('div', { class: 'card-grid' }, REGISTRY.map(buildCard));

  const footer = el('footer', { class: 'launcher-footer' }, [
    el('span', { html: 'Nexus Arcade · built with vanilla JS, zero dependencies' }),
    el('a', { href: 'https://github.com/shamoug/gamarc', target: '_blank', rel: 'noopener', text: 'Source on GitHub ↗' }),
  ]);

  viewEl.appendChild(intro);
  viewEl.appendChild(grid);
  viewEl.appendChild(footer);
}

function buildCard(manifest, index) {
  const thumbCanvas = el('canvas', { class: 'card-thumb', width: 320, height: 180 });
  const ctx = thumbCanvas.getContext('2d');
  if (manifest.thumbnail) manifest.thumbnail(ctx, 320, 180);

  const badge = manifest.comingSoon
    ? el('span', { class: 'card-badge soon', text: 'Coming soon' })
    : el('span', { class: 'card-badge live', text: `Game #${index + 1}` });

  const card = el('article', {
    class: 'game-card' + (manifest.comingSoon ? ' is-soon' : ''),
    style: `--card-accent:${manifest.accent || 'var(--accent)'};--card-accent2:${manifest.accent2 || 'var(--accent-2)'}`,
  }, [
    el('div', { class: 'card-thumb-wrap' }, [thumbCanvas, badge]),
    el('div', { class: 'card-body' }, [
      el('h3', { class: 'card-title', text: manifest.title }),
      el('p', { class: 'card-desc', text: manifest.description }),
      manifest.comingSoon
        ? el('button', { class: 'btn', disabled: 'true', text: 'Locked' })
        : el('button', {
            class: 'btn btn-primary',
            text: 'Play',
            onClick: () => {
              sfx.select();
              location.hash = '#/' + manifest.id;
            },
          }),
    ]),
  ]);

  if (!manifest.comingSoon) {
    card.addEventListener('click', (e) => {
      if (e.target.tagName !== 'BUTTON') location.hash = '#/' + manifest.id;
    });
  }
  return card;
}

function showGame(manifest) {
  viewEl.innerHTML = '';
  viewEl.className = 'view view-game';

  const container = el('div', { class: 'game-container' });
  viewEl.appendChild(container);

  const instance = manifest.factory();
  assertGameInstance(instance, manifest.id);
  activeGame = { instance, container };

  instance.init(container, {
    settings,
    onExit: () => {
      location.hash = '#/';
    },
    onSettingsChange: (s) => {
      settings = { ...settings, ...s };
      persist();
    },
  });
  instance.start();
}

// --- Thumbnails (drawn, no asset files) -------------------------------------

function drawRiftThumb(ctx, w, h) {
  ctx.fillStyle = '#070b14';
  ctx.fillRect(0, 0, w, h);
  const n = 5;
  const cs = 26;
  const ox = w / 2 - (n * cs) / 2;
  const oy = h / 2 - (n * cs) / 2;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const x = ox + c * cs;
      const y = oy + r * cs;
      ctx.fillStyle = (r + c) % 2 ? '#0a1320' : '#0c1626';
      ctx.fillRect(x, y, cs - 2, cs - 2);
      ctx.strokeStyle = '#16263b';
      ctx.strokeRect(x, y, cs - 2, cs - 2);
    }
  }
  // Real piece (cyan) + rift echo (magenta, offset, translucent).
  const cx = ox + 2 * cs + cs / 2;
  const cy = oy + 2 * cs + cs / 2;
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = '#f25f8a';
  ctx.beginPath();
  ctx.arc(cx + 8, cy + 8, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#41e0d0';
  ctx.beginPath();
  ctx.arc(cx, cy, 11, 0, Math.PI * 2);
  ctx.fill();
}

function drawLatticeThumb(ctx, w, h) {
  ctx.fillStyle = '#070b14';
  ctx.fillRect(0, 0, w, h);
  const s = 16;
  const SQRT3 = Math.sqrt(3);
  const hex = (cx, cy, fill) => {
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = (Math.PI / 3) * k;
      const x = cx + s * Math.cos(a);
      const y = cy + s * Math.sin(a);
      k === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = fill || '#0c1626';
    ctx.fill();
    ctx.strokeStyle = '#1c2c44';
    ctx.stroke();
  };
  // A small hex cluster (radius 2) with a few owned nodes.
  const owners = { '0,0': '#9b7bff', '1,-1': '#41e0d0', '-1,1': '#9b7bff', '1,0': '#41e0d0', '0,1': '#9b7bff' };
  for (let q = -2; q <= 2; q++) {
    for (let r = Math.max(-2, -q - 2); r <= Math.min(2, -q + 2); r++) {
      const cx = w / 2 + s * 1.5 * q;
      const cy = h / 2 + s * SQRT3 * (r + q / 2);
      hex(cx, cy);
      const own = owners[q + ',' + r];
      if (own) {
        ctx.beginPath();
        ctx.arc(cx, cy, s * 0.55, 0, Math.PI * 2);
        ctx.fillStyle = own;
        ctx.fill();
      }
    }
  }
}

function drawPulseThumb(ctx, w, h) {
  ctx.fillStyle = '#070b14';
  ctx.fillRect(0, 0, w, h);
  const lanes = 4;
  const lw = w / lanes;
  for (let i = 0; i < lanes; i++) {
    ctx.fillStyle = i % 2 ? '#0a1018' : '#0b1422';
    ctx.fillRect(i * lw, 0, lw, h);
    ctx.strokeStyle = '#1c2c44';
    ctx.beginPath();
    ctx.moveTo(i * lw, 0);
    ctx.lineTo(i * lw, h);
    ctx.stroke();
  }
  // Hit line.
  const hitY = h * 0.74;
  ctx.strokeStyle = '#5bd6ff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, hitY);
  ctx.lineTo(w, hitY);
  ctx.stroke();
  // A few falling notes.
  const notes = [
    [0, h * 0.2, '#41e0d0', false],
    [1, h * 0.5, '#41e0d0', false],
    [2, h * 0.36, '#ffb347', true],
    [3, hitY, '#41e0d0', false],
  ];
  for (const [lane, y, color, heavy] of notes) {
    const cx = lane * lw + lw / 2;
    const r = lw * 0.26;
    ctx.fillStyle = color;
    ctx.beginPath();
    if (heavy) {
      ctx.moveTo(cx, y - r);
      ctx.lineTo(cx + r, y);
      ctx.lineTo(cx, y + r);
      ctx.lineTo(cx - r, y);
      ctx.closePath();
    } else {
      ctx.arc(cx, y, r, 0, Math.PI * 2);
    }
    ctx.fill();
  }
}

function drawVectorThumb(ctx, w, h) {
  ctx.fillStyle = '#070b14';
  ctx.fillRect(0, 0, w, h);
  // Faint grid arena.
  ctx.strokeStyle = '#13233a';
  ctx.lineWidth = 1;
  const step = 20;
  for (let x = 0; x <= w; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y <= h; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  // Two craft with momentum trails closing on each other.
  const craft = (x, y, ang, color, tx, ty) => {
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.5;
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(12, 0);
    ctx.lineTo(-8, 7);
    ctx.lineTo(-8, -7);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  };
  craft(w * 0.3, h * 0.6, 0, '#7ce0a3', w * 0.55, h * 0.5);
  craft(w * 0.72, h * 0.38, Math.PI, '#9b7bff', w * 0.5, h * 0.5);
}

function drawHelixThumb(ctx, w, h) {
  ctx.fillStyle = '#070b14';
  ctx.fillRect(0, 0, w, h);
  const cols = 6;
  const rows = 4;
  const cell = 30;
  const ox = w / 2 - (cols * cell) / 2;
  const oy = h / 2 - (rows * cell) / 2;
  const tiles = ['#ff7eb6', '#5bd6ff', '#7ce0a3', '#ffcf5c', '#9b7bff'];
  // A small spliced-looking stack (deterministic pattern).
  const pat = [
    [0, 1, 2, 0, 1, 2],
    [3, 3, 1, 4, 4, 0],
    [2, 2, 2, 1, 0, 3],
    [4, 0, 1, 1, 1, 2],
  ];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = ox + c * cell;
      const y = oy + r * cell;
      ctx.fillStyle = tiles[pat[r][c]];
      const pad = 3;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(x + pad, y + pad, cell - pad * 2, cell - pad * 2, 6) : ctx.rect(x + pad, y + pad, cell - pad * 2, cell - pad * 2);
      ctx.fill();
    }
  }
  // Two-wide cursor highlight.
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.strokeRect(ox + 2 * cell + 2, oy + 2 * cell + 2, cell * 2 - 4, cell - 4);
}

function drawQuantaThumb(ctx, w, h) {
  ctx.fillStyle = '#070b14';
  ctx.fillRect(0, 0, w, h);
  const n = 4;
  const cell = Math.min(w, h) / (n + 0.5);
  const ox = (w - n * cell) / 2;
  const oy = (h - n * cell) / 2;
  const on = '#5be0c0';
  const off = '#33465f';
  // A small solved-looking conduit run from an emitter to a crystal.
  // masks: N=1,E=2,S=4,W=8 — hand-picked so the lit path connects.
  const grid = [
    [2, 10, 12, 0],
    [0, 0, 5, 0],
    [2, 12, 9, 0],
    [0, 5, 0, 0],
  ];
  const lit = new Set(['0,0', '0,1', '0,2', '1,2', '2,2', '2,1', '2,0', '3,1']);
  const reach = cell * 0.5;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const mask = grid[r][c];
      if (!mask) continue;
      const cx = ox + c * cell + cell / 2;
      const cy = oy + r * cell + cell / 2;
      const isLit = lit.has(r + ',' + c);
      ctx.strokeStyle = isLit ? on : off;
      ctx.lineWidth = Math.max(2, cell * 0.13);
      ctx.lineCap = 'round';
      if (isLit) {
        ctx.shadowColor = on;
        ctx.shadowBlur = 10;
      }
      const dirs = [[1, 0, -1], [2, 1, 0], [4, 0, 1], [8, -1, 0]];
      for (const [bit, dx, dy] of dirs) {
        if (!(mask & bit)) continue;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + dx * reach, cy + dy * reach);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
    }
  }
  // Emitter (top-left) and a crystal (bottom).
  ctx.fillStyle = '#ffcf5c';
  ctx.shadowColor = '#ffcf5c';
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.arc(ox + cell / 2, oy + cell / 2, cell * 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.save();
  ctx.translate(ox + cell + cell / 2, oy + 3 * cell + cell / 2);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = '#f25f8a';
  ctx.shadowColor = '#ff7ea6';
  ctx.shadowBlur = 12;
  ctx.fillRect(-cell * 0.16, -cell * 0.16, cell * 0.32, cell * 0.32);
  ctx.restore();
  ctx.shadowBlur = 0;
}

function drawPlaceholderThumb(ctx, w, h, accent) {
  ctx.fillStyle = '#0a0e18';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = accent;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = 0; x <= w; x += 4) {
    const y = h / 2 + Math.sin(x / 18) * 30;
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = accent;
  ctx.font = 'bold 40px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('?', w / 2, h / 2);
}
