// =============================================================================
// Game Interface contract
// -----------------------------------------------------------------------------
// Every game on the platform ships a *manifest* and a *factory*. The shell only
// ever talks to a game through the methods defined below, so new games plug in
// without the shell changing.
//
// A manifest:
//   {
//     id:          'rift',                 // unique, URL-safe (used in #/<id>)
//     title:       'RIFT',
//     description: 'Two-plane abstract strategy...',
//     accent:      '#41e0d0',              // card/theme accent colour
//     comingSoon:  false,                  // true => shown but not playable
//     thumbnail:   (canvas) => void,       // optional: draw a card thumbnail
//     factory:     () => GameInstance,     // returns an object implementing the
//                                          // interface below
//   }
//
// A GameInstance implements:
//   init(container, options)  Build DOM inside `container`. options = {
//                               settings,           // {sound, theme}
//                               onExit,             // call to return to launcher
//                               onSettingsChange,   // (settings) => void (optional)
//                             }
//   start()                   Begin / show the game (may show its own setup UI).
//   pause()                   Suspend timers / animation (e.g. tab hidden).
//   resume()                  Resume after pause().
//   destroy()                 Remove listeners, cancel RAF, clear container.
//
// `onExit` (passed via options) is how a game returns to the launcher. Games
// should never manipulate the URL hash directly; they call onExit().
// =============================================================================

/** The method names a game instance must implement. */
export const GAME_METHODS = Object.freeze(['init', 'start', 'pause', 'resume', 'destroy']);

/**
 * Validate that an object satisfies the game-instance contract.
 * Throws a descriptive error if a method is missing.
 * @param {object} instance
 * @param {string} id
 */
export function assertGameInstance(instance, id) {
  if (!instance || typeof instance !== 'object') {
    throw new Error(`Game "${id}" factory did not return an object`);
  }
  for (const m of GAME_METHODS) {
    if (typeof instance[m] !== 'function') {
      throw new Error(`Game "${id}" is missing required method: ${m}()`);
    }
  }
  return instance;
}

/**
 * Validate a manifest at registration time.
 * @param {object} manifest
 */
export function assertManifest(manifest) {
  const required = ['id', 'title', 'description'];
  for (const key of required) {
    if (!manifest[key]) throw new Error(`Manifest missing "${key}"`);
  }
  if (!manifest.comingSoon && typeof manifest.factory !== 'function') {
    throw new Error(`Manifest "${manifest.id}" needs a factory() (or comingSoon:true)`);
  }
  if (!/^[a-z0-9-]+$/.test(manifest.id)) {
    throw new Error(`Manifest id "${manifest.id}" must be URL-safe (a-z, 0-9, -)`);
  }
  return manifest;
}
