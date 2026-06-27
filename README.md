# ◈ Nexus Arcade

A self-contained, **offline-first browser arcade**. Pure front-end — static HTML,
CSS, and vanilla JavaScript (ES modules). No backend, no database, no build step,
no runtime dependencies, and **no network calls of any kind**. It runs from a
folder of static files and deploys to GitHub Pages unchanged. Works on desktop
and **phones** — every game is fully playable by touch.

**▶ Play online: https://shamoug.github.io/gamarc/**

**Game #1 is [RIFT](#rift--the-rules)** — a two-plane abstract strategy duel where
pieces phase between a *Real* plane and a *Rift* plane while the arena collapses
inward around them.

**Game #2 is [LATTICE](#lattice--the-rules)** — a hex-grid territory duel: bracket
your rival's nodes to convert them, Reversi-style, and hold the most territory
when the grid locks up.

**Game #3 is [PULSE](#pulse--the-rules)** — real-time rhythm combat: strike four
lanes on the beat to drain an enemy while an adaptive engine bends the tempo to
your skill.

**Game #4 is [VECTOR](#vector--the-rules)** — a momentum dueling game: steer with
inertia on an open arena, ram your rival, and avoid overshooting into the wall.

**Game #5 is [HELIX](#helix--the-rules)** — a two-strand puzzle race: swap
nucleotides to splice 3+ matches and cascade chains before the steadily rising
strand winds to the top.

**Game #6 is QUANTA** — a light-routing puzzle: tap conduit tiles to spin them
and thread the beam from the emitter into every crystal. One-finger play that
shines on a phone.

---

## Quick start (run locally)

ES modules must be served over HTTP (opening `index.html` via `file://` will be
blocked by the browser). Any static server works. The simplest, with Python
(bundled on macOS/Linux and easy on Windows):

```bash
python -m http.server 8000
```

Then open **http://localhost:8000** in Chrome, Edge, or Firefox.

Alternatives if you prefer them (all optional):

```bash
npx serve .            # Node, no install needed beyond npx
php -S localhost:8000  # PHP
```

There is **nothing to install** to play. The optional `package.json` only adds
`npm start` (an alias for the Python server) and `npm test` (the logic tests).

---

## Deploy to GitHub Pages

The repo is already Pages-ready: `index.html` is at the root and every asset path
is relative.

1. Push the repository to GitHub.
2. Repo **Settings → Pages**.
3. **Source:** *Deploy from a branch*. **Branch:** `main` (or your default),
   **folder:** `/ (root)`.
4. Save. Your arcade goes live at
   `https://<your-username>.github.io/<repo-name>/`.

No configuration, bundler, or CI is required.

---

## RIFT — the rules

A two-player abstract strategy game on a **7×7 grid where every square has two
layers**: the **Real** plane and the **Rift** plane.

### Objective

**Capture or destroy the enemy Core.** Lose your Core and you lose.

### Pieces (per player, symmetric — 7 each)

| Piece       | Count | Movement                                   | Phases? |
| ----------- | ----- | ------------------------------------------ | ------- |
| **◆ Core**  | 1     | 1 square, any direction                    | No — always Real |
| **R Runner**| 2     | Any distance, orthogonally (cannot jump)   | Yes     |
| **S Shifter**| 2    | Any distance, diagonally (cannot jump)     | Yes     |
| **G Guard** | 2     | 1 square, any direction                    | Yes     |

**Starting layout** (documented exactly in
[`src/games/rift/rules.js`](src/games/rift/rules.js) as `BACK_ROW`): each player's
back row, columns 0–6, holds `Runner, Shifter, Guard, Core, Guard, Shifter, Runner`.
Player 1 starts on row 0, Player 2 on row 6. All pieces begin on the Real plane.

### Two planes

A piece occupies **one layer of one square**. Two pieces may share a square only
if they are on **different layers**. Both planes are always visible: Real pieces
are solid and centred; Rift pieces are translucent, dashed, and tucked into the
cell corner.

### Your turn — choose exactly one action

1. **Move** a piece along its movement rule, on its *current* plane. Movement is
   blocked only by pieces on the **same** plane — pieces on the other plane never
   block.
2. **Phase** one phase-capable piece to the other layer of its current square.
   That layer must be empty. Phasing ends the turn.

### Capture

- Capture happens **only on the Real plane**, between same-plane pieces. Moving
  onto a Real square occupied by an enemy Real piece removes that enemy.
- If the enemy on that square is on the **Rift** plane, you simply coexist on the
  (empty) Real layer — **no capture**.
- A piece on the **Rift plane cannot capture and cannot be captured**. To threaten
  or strike, phase up to the Real plane first.

### Collapsing arena

- Every **4 rounds** (`COLLAPSE_EVERY_ROUNDS`, configurable) the outermost ring of
  squares is **permanently removed** from both planes: 7×7 → 5×5 → 3×3 → centre.
- Any piece on a collapsing square — on **either** plane — is **destroyed**. If a
  Core dies this way, its owner loses.
- The ring that will collapse next **flashes a warning one round in advance**.

### Win, loss, draw

- **Win** by capturing or destroying the enemy Core.
- If **both** Cores die in the same collapse, it's a **draw**.
- If a player has **no legal action**, they **lose** (this is a single constant,
  `NO_MOVES_RESULT`, that can be switched to a draw).

### Modes & controls

- **Single player vs AI** (Easy / Medium / Hard) or **local hotseat**.
- **Mouse:** click a piece to select it and see legal destinations; click a
  destination to move. Stacked own pieces (Real + Rift on one square) cycle on
  repeated clicks.
- **Keyboard:** `Space`/`P` phase the selected piece · `E` cycle plane emphasis ·
  `U` undo (hotseat) · `R` restart · `H` help · `M` menu · `Esc` deselect / close.
- **HUD** shows whose turn it is, the round counter, rounds until the next
  collapse (with a ⚠ warning), captured pieces, mode, and difficulty.

---

## LATTICE — the rules

A two-player **territory-capture** duel on a **hexagonal grid** (radius 4 → 61
hex cells). A Reversi/Othello variant adapted to six directions. Rules and
tunables live in [`src/games/lattice/rules.js`](src/games/lattice/rules.js).

### Objective

Own the **most nodes** when no moves remain.

### Setup

The six inner-ring cells start alternating ownership (3 nodes each); the centre
and everything outward begin empty. The position is symmetric under a 60°
colour-swapping rotation, so neither side is favoured.

### Placing a node

On your turn, click an empty cell that **brackets** at least one straight line of
enemy nodes — a contiguous run of your rival's nodes with one of *your* nodes at
the far end, along one of the six hex directions. Every bracketed enemy node in
every bracketed direction **converts to your colour**. A placement that captures
nothing is illegal.

- Glowing dots mark every legal placement.
- Hovering a legal cell **previews** exactly which nodes you would flip.

### Passing & end

- If you have **no legal placement**, your turn is skipped automatically.
- If **neither** side can move, the game ends.
- Most nodes wins; equal nodes is a **draw**. (The outer rim is hard to flip, so
  rim nodes are the most stable territory — the AI values them accordingly.)

### Modes & controls

- **Single player vs AI** (Easy / Medium / Hard) or **local hotseat**.
- **Mouse:** click a legal (highlighted) cell to place; hover to preview flips.
- **Keyboard:** `U` undo (hotseat) · `R` restart · `H` help · `M` menu.
- **HUD** shows whose turn it is, both territory scores, legal-move and open-cell
  counts, mode, and difficulty.

---

## PULSE — the rules

A real-time, single-player **rhythm combat** game. You face an adaptive engine
rather than a turn-based opponent. Engine and tunables live in
[`src/games/pulse/engine.js`](src/games/pulse/engine.js); the engine is
time-driven and fully deterministic for a given seed + input sequence.

### Objective

Drain the **enemy's pulse** (top bar) to zero before **yours** (bottom bar) runs
out.

### Hitting notes

Notes fall down **four lanes** toward a hit line. When a note reaches the line,
press its lane:

- **Keys** `D` `F` `J` `K` (left→right), or **click** a lane.
- Timing is graded: within ~45 ms is **PERFECT**, within ~100 ms is **GOOD**;
  outside that the note passes as a **miss**.

### Damage, combo & heavy notes

- Every clean hit damages the enemy and extends your **combo** (which multiplies
  score). A **miss** — wrong timing or a note slipping past — costs **you**
  health and resets the combo.
- **Heavy notes** (diamonds) are enemy strikes: they hit harder if missed and
  reward more if landed.

### Adaptive tempo

An adaptive AI tracks your recent accuracy and re-tunes every few beats: play
well and the **BPM and note density rise**; struggle and they ease off. Three
starting difficulties set the base tempo and density.

### Controls

- **Lanes:** `D` `F` `J` `K` or mouse click.
- `P` pause/resume · `R` restart · `H` help · `M` menu.
- The HUD tracks score, max combo, accuracy, the live (adapting) tempo, and the
  difficulty; health bars are drawn on the playfield.

---

## VECTOR — the rules

A two-player **momentum duel** on an open 15×15 arena. Turn-based, but governed
by inertia rather than free movement. Rules and tunables live in
[`src/games/vector/rules.js`](src/games/vector/rules.js).

### Objective

Reduce the enemy craft's **hull** to zero — or make them **crash** into the wall.

### Momentum

Each craft has a position and a **velocity**. On your turn you pick one of nine
**accelerations** (each axis −1, 0 or +1). Your velocity changes by it (capped at
±3 per axis), then you move by the *new* velocity in a straight line. You don't
move freely — you bend a trajectory.

### Steering

- **Click** one of the nine glowing targets, or use **W A S D** / arrows, **Q E
  Z C** for diagonals, and **Space** to coast (no acceleration).
- The dashed arrow shows where coasting would carry you; hovering a target draws
  its swept path.

### Ramming

If your swept path **crosses the opponent's cell** (landing on it *or* passing
through it), you ram them. Damage = `RAM_BASE + impactSpeed × RAM_SCALE`, so
faster hits hurt more.

### Crashing

If your move would take you **off the arena**, you crash and lose instantly.
Carrying speed toward an edge is the core risk — brake in time. Targets that
would crash are marked with a red ✕.

### Ending

First hull to zero loses; a crash loses immediately. If the round limit is
reached, the craft with more hull wins (equal hull is a draw).

### Modes & controls

- **Single player vs AI** (Easy / Medium / Hard) or **local hotseat**.
- `U` undo (hotseat) · `R` restart · `H` help · `M` menu.
- The HUD tracks both hulls, both speeds, the round counter, mode, and
  difficulty.

---

## HELIX — the rules

A real-time, single-player **swap-match puzzle** (Panel de Pon / Tetris Attack
lineage), DNA-themed. There's no opponent — you race the board itself. Engine and
tunables live in [`src/games/helix/engine.js`](src/games/helix/engine.js); it is
time-driven and deterministic for a given seed.

### Objective

Keep the stack down. A new row of nucleotides keeps **rising from the bottom**; if
a tile is pushed past the top line, the run ends. Score as high as you can before
that happens.

### Splicing

- A 6×12 grid holds tiles in five nucleotide colours (A T C G U).
- Line up **3 or more** of the same colour in a row or column and they **splice
  out**. Tiles above fall to fill the gap.
- A fall that forms a new match keeps the **chain** going — cascades multiply your
  score.

### Controls

- Move the two-wide cursor with **W A S D** / arrow keys; press **Space** (or
  Enter) to swap its two cells. Or **click** a tile to swap it with the one to its
  right.
- **Shift** winds the strand up faster (set up chains on your terms).
- `P` pause/resume · `R` restart · `H` help · `M` menu.

### Pacing

The rise rate starts from the chosen difficulty and ramps up the longer you
survive. The HUD tracks score, best chain, tiles spliced, and elapsed time.

---

## Project structure

```
/
  index.html                 Entry point — loads the platform shell
  /src
    /platform
      shell.js               Launcher, game registry, hash routing, settings
      gameInterface.js       The contract every game implements (+ validators)
      ui.css                 Shell, theme variables (aurora / amber) + shared HUD/overlay styles
    /games
      /rift
        rift.js              Game entry — implements the game interface
        rules.js             Pure game logic & tunables (no DOM; unit-tested)
        render.js            Canvas 2D drawing (both planes, animations)
        input.js             Mouse & keyboard handling
        ai.js                Minimax opponent (Easy / Medium / Hard)
        rift.css             Game-specific styles
      /lattice               Game #2 — same module layout as RIFT
        lattice.js           Game entry — implements the game interface
        rules.js             Pure hex-Reversi logic & geometry (unit-tested)
        render.js            Canvas 2D hex-grid drawing + flip animations
        input.js             Mouse & keyboard handling
        ai.js                Minimax opponent (Easy / Medium / Hard)
        lattice.css          Game-specific styles
      /pulse                 Game #3 — real-time rhythm (no AI minimax)
        pulse.js             Game entry — implements the game interface
        engine.js            Pure, time-driven rhythm/combat engine (unit-tested)
        render.js            Canvas 2D lanes, notes, health bars, judgements
        input.js             Lane keys (D/F/J/K) + click; auto-repeat guarded
        pulse.css            Game-specific styles
      /vector                Game #4 — turn-based momentum duel + minimax
        vector.js            Game entry — implements the game interface
        rules.js             Pure momentum/ram/crash logic (unit-tested)
        render.js            Canvas 2D arena, craft, steering ghosts, animations
        input.js             Acceleration via click target or WASD/arrows
        ai.js                Minimax opponent with crash-risk evaluation
        vector.css           Game-specific styles
      /helix                 Game #5 — real-time swap-match puzzle (no opponent)
        helix.js             Game entry — implements the game interface
        engine.js            Pure, time-driven match/gravity/rise engine (unit-tested)
        render.js            Canvas 2D rising grid, cursor, sparks, popups
        input.js             Cursor (WASD/arrows) + swap + click-to-swap
        helix.css            Game-specific styles
    /shared
      helpers.js             DOM helper, settings storage, synthesised SFX
  /tests
    rules.test.js            RIFT logic assertions (run in node or browser)
    lattice.test.js          LATTICE logic assertions
    pulse.test.js            PULSE engine assertions
    vector.test.js           VECTOR logic assertions
    helix.test.js            HELIX engine assertions
    index.html               Browser test runner (loads all five)
  README.md
  LICENSE                    MIT — Aladdin Shamoug
  .gitignore
  package.json               OPTIONAL dev tooling only
  start.bat                  Windows one-click launcher (serves + opens browser)
```

---

## Running the tests

No framework, no dependencies.

```bash
node tests/rules.test.js        # RIFT
node tests/lattice.test.js      # LATTICE
node tests/pulse.test.js        # PULSE
node tests/vector.test.js       # VECTOR
node tests/helix.test.js        # HELIX
npm test                        # runs all five
```

Or open `tests/index.html` through the static server in a browser. The RIFT
suite covers legal-move generation, capture across planes, phasing rules,
scheduled collapse destruction (including Core loss), and win detection. The
LATTICE suite covers hex geometry, the starting position, flip/legal-move
generation, capture, forced-pass handling, and win/draw detection. The PULSE
suite covers deterministic chart generation, timing-window judging, miss
resolution and health, scoring/combo, adaptive difficulty, and win/lose. The
VECTOR suite covers momentum/clamping, the swept path, ramming (direct and
pass-through), crashing, win-by-KO, and the ply-cap tiebreak. The HELIX suite
covers deterministic setup, no-instant-match boards, match/gravity, cascading
chains, the rising board with cursor follow, and overflow game-over.

---

## The game interface contract

The shell talks to every game only through this interface, so new games plug in
without touching the shell. A game ships a **manifest** and a **factory** that
returns an instance implementing:

```js
init(container, options)   // Build DOM inside `container`.
                           // options = { settings, onExit, onSettingsChange }
start()                    // Begin / show the game (may show its own setup UI).
pause()                    // Suspend timers / animation (e.g. tab hidden).
resume()                   // Resume after pause().
destroy()                  // Remove listeners, cancel RAF, clear container.
```

A game returns to the launcher by calling `options.onExit()` — it never touches
the URL hash directly. Optionally, a game may expose `applySettings(settings)` to
react to live theme/sound changes. The contract and its validators live in
[`src/platform/gameInterface.js`](src/platform/gameInterface.js).

A **manifest** describes the card and how to launch the game:

```js
{
  id:          'rift',          // URL-safe; used in the hash route #/rift
  title:       'RIFT',
  description: 'Two-plane abstract strategy…',
  accent:      '#41e0d0',       // card accent colour
  accent2:     '#f25f8a',
  comingSoon:  false,           // true => shown but not playable
  thumbnail:   (ctx, w, h) => {/* draw a card thumbnail; optional */},
  factory:     () => createRiftGame(),  // returns a game instance
}
```

---

## Adding a new game

1. **Create a folder** under `src/games/<your-id>/`.
2. **Implement the interface.** Export a factory that returns an object with
   `init`, `start`, `pause`, `resume`, and `destroy`. Keep pure game logic in its
   own module (like RIFT's `rules.js`) so it can be unit-tested without a browser.
3. **Register it** in the `REGISTRY` array in
   [`src/platform/shell.js`](src/platform/shell.js): import your factory and push
   a manifest (see the shape above). Set `comingSoon: true` to show a locked
   placeholder card.
4. **Add styles** in a `<your-id>.css` and link it from `index.html` (or inject
   it from your game module).
5. That's it — the launcher card, the `#/<your-id>` route, settings, and the
   Back-to-menu flow are all handled by the shell.

> The registry currently lists six live games (RIFT, LATTICE, PULSE, VECTOR,
> HELIX, QUANTA). They are worked examples of how varied games share one
> interface: RIFT, LATTICE and VECTOR are turn-based with minimax AIs (board
> capture, territory, and momentum); PULSE and HELIX are real-time with their own
> clocks and no opponent (a rhythm chart and a rising-board puzzle); QUANTA is a
> tap-only routing puzzle — yet all six plug into the very same shell. The
> `comingSoon` manifest flag still lets you register a locked "coming soon" card.

---

## Design notes

- **Deterministic logic.** `rules.js` is pure and side-effect free; `applyAction`
  never mutates its input. The only randomness is the AI's tie-break, which uses a
  **seedable** RNG (mulberry32) so games are reproducible.
- **No assets, no network.** Thumbnails are drawn on canvas at runtime; sound
  effects are synthesised with the Web Audio API. Nothing is fetched.
- **Browser support:** any modern browser — desktop Chrome, Edge, Firefox, Safari
  and their mobile counterparts. Every game accepts touch input (tap to act), the
  layouts reflow to a single column on narrow screens, and canvases scale to fit a
  phone. Keyboard shortcuts remain available where a physical keyboard exists.

## Publishing

Run **`publish.bat`** (double-click it) to push the whole folder to GitHub and
switch on GitHub Pages. It is safe to re-run any time — it commits and pushes
whatever changed. The arcade then lives at **https://shamoug.github.io/gamarc/**.

---

## License

MIT © Aladdin Shamoug. See [LICENSE](LICENSE).
