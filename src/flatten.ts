import { type Line, inserted, isBlank, render, splitLines } from "./lines";

/**
 * Flattens a TSTL bundle by eliminating the module system entirely.
 *
 * TSTL's luaBundle wraps each module in a closure with a require() runtime.
 * This rewrites the bundle to emit all module code in dependency order as
 * top-level locals, removing the ____modules table, ____moduleCache,
 * require() function, module closures, and import/export boilerplate.
 *
 * Everything happens over `Line[]` rather than raw text so each surviving line
 * remembers where it came from, which is what lets the source map survive.
 */

// `d` gives us the body's exact offset, which is how we find its first line.
const MODULE = /\["([^"]+)"\] = function\([^)]*\)\s*\n([\s\S]*?)\n end,/dg;

const EXPORTS_TABLE = "local ____exports = {}";
const REQUIRE_LINE = /^[ \t]*local ____\w+ = require\("[^"]+"\)$/;
const IMPORT_LINE = /^([ \t]*)local (\w+) = ____\w+\.(\w+)$/;
const RETURN_EXPORTS = /(?:^|\n)return (?:____exports|\{[^}]*\})$/;

/** Rewrites the ____exports table away, one line at a time. */
function stripExports(lines: Line[]): Line[] {
  const rewritten = lines.map((line) => ({
    ...line,
    text: line.text
      .replace(/function ____exports\.(\w+)\s*\(/g, "local function $1(")
      .replace(/____exports\.(\w+)\s*=/g, "local $1 =")
      .replace(/____exports\./g, ""),
  }));

  // Only the first declaration goes, matching the original single replace.
  const index = rewritten.findIndex((line) => line.text.endsWith(EXPORTS_TABLE));

  if (index === -1) return rewritten;

  const prefix = rewritten[index].text.slice(0, -EXPORTS_TABLE.length);
  const rest = rewritten.slice(index + 1);

  // An indented declaration leaves its indent behind on the following line.
  if (prefix !== "" && rest.length > 0) {
    rest[0] = { ...rest[0], text: prefix + rest[0].text };
  }

  return [...rewritten.slice(0, index), ...rest];
}

/** Drops a trailing `return ____exports` or `return { ... }`. */
function stripReturn(lines: Line[]): Line[] {
  const body = render(lines);
  const stripped = body.replace(RETURN_EXPORTS, "");

  if (stripped === body) return lines;

  // The match is always a suffix, so the difference is whole trailing lines.
  // An empty result is zero lines, not the one that splitting "" would give.
  return lines.slice(0, stripped === "" ? 0 : stripped.split("\n").length);
}

/** Drops require() calls and resolves the destructuring that follows them. */
function stripImports(lines: Line[]): Line[] {
  const result: Line[] = [];

  for (const line of lines) {
    if (REQUIRE_LINE.test(line.text)) continue;

    const match = IMPORT_LINE.exec(line.text);

    if (!match) {
      result.push(line);

      continue;
    }

    const [, indent, localName, exportName] = match;

    // Same name means the earlier module already put it in scope.
    if (localName === exportName) continue;

    result.push({ ...line, text: `${indent}local ${localName} = ${exportName}` });
  }

  return result;
}

/**
 * Drops `do ... end` scopes left empty once their requires disappeared.
 *
 * TSTL wraps side-effect imports and some hoisted references in a `do` block;
 * with every statement gone the block is just dead whitespace.
 */
function stripEmptyScopes(lines: Line[]): Line[] {
  const result: Line[] = [];

  for (let index = 0; index < lines.length; index++) {
    if (lines[index].text !== "do") {
      result.push(lines[index]);

      continue;
    }

    let end = index + 1;

    while (end < lines.length && isBlank(lines[end].text)) end++;

    if (end < lines.length && lines[end].text.trimStart() === "end") {
      index = end;

      continue;
    }

    result.push(lines[index]);
  }

  return result;
}

/** The line-array equivalent of `String.prototype.trim` on the body. */
function trimLines(lines: Line[]): Line[] {
  let start = 0;
  let end = lines.length;

  while (start < end && isBlank(lines[start].text)) start++;
  while (end > start && isBlank(lines[end - 1].text)) end--;

  if (start >= end) return [];

  const trimmed = lines.slice(start, end);

  trimmed[0] = { ...trimmed[0], text: trimmed[0].text.trimStart() };
  trimmed[trimmed.length - 1] = {
    ...trimmed[trimmed.length - 1],
    text: trimmed[trimmed.length - 1].text.trimEnd(),
  };

  return trimmed;
}

export function flattenLines(lines: Line[], skipModules: string[]): Line[] {
  const code = render(lines);
  const runtimeStart = code.indexOf("\nlocal ____modules = {}\n");

  if (runtimeStart < 0) return lines;

  // Everything before the module table is kept verbatim.
  const header = code.slice(0, runtimeStart + 1);
  const headerLineCount = header.split("\n").length - 1;
  const bodies: Line[][] = [];

  MODULE.lastIndex = 0;

  let match: RegExpExecArray | null;

  while ((match = MODULE.exec(code)) !== null) {
    if (skipModules.includes(match[1])) continue;

    const bodyStart = match.indices![2][0];
    const firstLine = code.slice(0, bodyStart).split("\n").length - 1;
    const bodyLines = lines.slice(firstLine, firstLine + match[2].split("\n").length);
    const body = trimLines(stripEmptyScopes(stripImports(stripReturn(stripExports(bodyLines)))));

    // An emptied-out module still contributes its separator, as it did when
    // this worked on strings and pushed "" into the joined list.
    bodies.push(body.length > 0 ? body : [inserted("")]);
  }

  const result = lines.slice(0, headerLineCount);

  // With every module skipped the output is just the header plus a blank
  // line, which is what joining an empty list of bodies used to produce.
  if (bodies.length === 0) result.push(inserted(""));

  for (const [index, body] of bodies.entries()) {
    // Bodies are separated by a blank line, which nothing in the bundle owns.
    if (index > 0) result.push(inserted(""));

    result.push(...body);
  }

  return result;
}

export function flattenBundle(code: string, skipModules: string[]): string {
  const lines = splitLines(code);
  const flattened = flattenLines(lines, skipModules);

  if (flattened === lines) return code;

  return `${render(flattened)}\n`;
}
