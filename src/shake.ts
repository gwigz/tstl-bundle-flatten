import { type Line, inserted, isBlank, render, splitLines } from "./lines";

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

const HEADER_COMMENT = /^--\[\[[^\n]*\]\]$/;

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

export function shakeLines(lines: Line[]): Line[] {
  const shaken = loadDarklua().process_code(render(lines), DARKLUA_CONFIG);
  const shakenLines = shaken.split("\n");

  // `retain_lines` keeps the line count identical, blanking out what it
  // removed, so output line N still corresponds to input line N. If a
  // darklua release ever stops holding to that, give up on the mapping
  // entirely rather than point every later line at the wrong TypeScript.
  const aligned = shakenLines.length === lines.length;

  const tracked: Line[] = shakenLines.map((text, index) => ({
    text,
    src: aligned ? lines[index].src : -1,
  }));

  // A trailing empty element is the file's final newline, not a line.
  const trailingNewline = tracked.length > 0 && tracked[tracked.length - 1].text === "";
  const body = trailingNewline ? tracked.slice(0, -1) : tracked;

  // The retain_lines generator leaves blank lines where code was removed
  // (sometimes mid-statement); strip them all and let formatting rebuild the
  // spacing at natural code boundaries.
  const compact = body.filter((line) => !isBlank(line.text));

  if (trailingNewline) compact.push(inserted(""));

  // Keep the generated-by header visually separated.
  if (compact.length > 1 && HEADER_COMMENT.test(compact[0].text)) {
    compact.splice(1, 0, inserted(""));
  }

  return compact;
}

export function shakeBundle(code: string): string {
  return render(shakeLines(splitLines(code)));
}
