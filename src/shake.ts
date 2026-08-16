/**
 * Tree-shakes flattened output by removing unused top-level locals.
 *
 * Flattening turns every module export into a top-level `local`, so dead
 * code elimination becomes a matter of dropping locals nothing references.
 * The heavy lifting is done by darklua (via its wasm build): the
 * `remove_unused_variable` rule removes unused locals and local functions
 * while preserving side effects (`local x = call()` becomes `call()`), and
 * `remove_empty_do` cleans up any scopes left empty by that removal.
 */
interface DarkluaWasm {
  process_code(code: string, config: unknown): string;
}

const DARKLUA_CONFIG = {
  rules: ["remove_unused_variable", "remove_empty_do"],
  generator: "retain_lines",
};

let darklua: DarkluaWasm | undefined;

function loadDarklua(): DarkluaWasm {
  if (darklua) return darklua;

  try {
    darklua = require("darklua-wasm") as DarkluaWasm;
  } catch {
    throw new Error(
      "tstl-bundle-flatten: the `shake` option requires darklua-wasm as a peer dependency. " +
        "Install it with: bun add -D darklua-wasm",
    );
  }

  return darklua;
}

export function shakeBundle(code: string): string {
  const shaken = loadDarklua().process_code(code, DARKLUA_CONFIG);

  // The retain_lines generator leaves blank lines where code was removed
  // (sometimes mid-statement); strip them all and let formatLua rebuild
  // the spacing at natural code boundaries
  return shaken
    .replace(/^[ \t]+$/gm, "")
    .replace(/\n{2,}/g, "\n")
    .replace(/^\n+/, "")
    .replace(/^(--\[\[[^\n]*\]\])\n/, "$1\n\n");
}
