/**
 * Line tracking for the emit transforms.
 *
 * Flattening, shaking and formatting are all whole-line operations: they drop
 * lines, rewrite a line in place, or insert blank ones, and they never split,
 * merge or reorder. That means each output line can carry the index of the
 * bundle line it came from, which is everything a source map needs. The
 * generated column is not preserved, but the viewer only ever reports lines.
 */
export interface Line {
  text: string;
  /** 0-based index in the original bundle, or -1 for a line we introduced. */
  src: number;
}

/** Maps a 0-based output line to its bundle line, or -1 if it was introduced. */
export type LineMap = number[];

export function splitLines(code: string): Line[] {
  return code.split("\n").map((text, src) => ({ text, src }));
}

export function render(lines: Line[]): string {
  return lines.map((line) => line.text).join("\n");
}

export function lineMap(lines: Line[]): LineMap {
  return lines.map((line) => line.src);
}

/** A line we introduced, which no bundle line corresponds to. */
export function inserted(text: string): Line {
  return { text, src: -1 };
}

export function isBlank(text: string): boolean {
  return text.trim() === "";
}
