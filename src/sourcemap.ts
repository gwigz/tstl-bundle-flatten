import type { LineMap } from "./lines";

/**
 * Rewrites a source map so it follows the lines through the emit transforms.
 *
 * TSTL writes `<output>.map` before plugins run, so once the bundle has been
 * flattened, shaken and formatted, the map on disk points at lines that have
 * moved. Only the generated *line* can be preserved, because the transforms
 * rewrite line contents and columns stop being meaningful, but that is all a
 * compiler error needs to name the original TypeScript.
 */
const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const CHAR_TO_INT = new Map<string, number>([...BASE64].map((char, index) => [char, index]));

/** One mapping segment, with every field absolute rather than delta encoded. */
interface Segment {
  generatedColumn: number;
  source?: number;
  sourceLine?: number;
  sourceColumn?: number;
  name?: number;
}

function decodeVlq(text: string): number[] {
  const values: number[] = [];

  let shift = 0;
  let value = 0;

  for (const char of text) {
    const digit = CHAR_TO_INT.get(char);

    if (digit === undefined) return values;

    value += (digit & 31) << shift;

    if ((digit & 32) !== 0) {
      shift += 5;

      continue;
    }

    const negative = (value & 1) === 1;

    value >>= 1;
    values.push(negative ? -value : value);

    shift = 0;
    value = 0;
  }

  return values;
}

function encodeVlq(value: number): string {
  let encoded = "";
  let remaining = value < 0 ? (-value << 1) | 1 : value << 1;

  do {
    let digit = remaining & 31;

    remaining >>>= 5;

    if (remaining > 0) digit |= 32;

    encoded += BASE64[digit];
  } while (remaining > 0);

  return encoded;
}

export function decodeMappings(mappings: string): Segment[][] {
  const lines: Segment[][] = [];

  // Every field except the generated column carries across line boundaries.
  let source = 0;
  let sourceLine = 0;
  let sourceColumn = 0;
  let name = 0;

  for (const group of mappings.split(";")) {
    const segments: Segment[] = [];

    let generatedColumn = 0;

    for (const raw of group.split(",")) {
      if (raw === "") continue;

      const values = decodeVlq(raw);

      if (values.length === 0) continue;

      generatedColumn += values[0];

      const segment: Segment = { generatedColumn };

      if (values.length >= 4) {
        source += values[1];
        sourceLine += values[2];
        sourceColumn += values[3];

        segment.source = source;
        segment.sourceLine = sourceLine;
        segment.sourceColumn = sourceColumn;
      }

      if (values.length >= 5) {
        name += values[4];
        segment.name = name;
      }

      segments.push(segment);
    }

    lines.push(segments);
  }

  return lines;
}

export function encodeMappings(lines: Segment[][]): string {
  let source = 0;
  let sourceLine = 0;
  let sourceColumn = 0;
  let name = 0;

  return lines
    .map((segments) => {
      let generatedColumn = 0;

      return segments
        .map((segment) => {
          let encoded = encodeVlq(segment.generatedColumn - generatedColumn);

          generatedColumn = segment.generatedColumn;

          if (segment.source === undefined) return encoded;

          encoded += encodeVlq(segment.source - source);
          encoded += encodeVlq(segment.sourceLine! - sourceLine);
          encoded += encodeVlq(segment.sourceColumn! - sourceColumn);

          source = segment.source;
          sourceLine = segment.sourceLine!;
          sourceColumn = segment.sourceColumn!;

          if (segment.name === undefined) return encoded;

          encoded += encodeVlq(segment.name - name);
          name = segment.name;

          return encoded;
        })
        .join(",");
    })
    .join(";");
}

/**
 * Reorders a map's mappings to follow `lineMap`.
 *
 * Returns the input unchanged if it cannot be understood, so a map this does
 * not recognise is left alone rather than corrupted.
 */
export function remapSourceMap(sourceMap: string, lineMap: LineMap): string {
  let parsed: { mappings?: unknown };

  try {
    parsed = JSON.parse(sourceMap);
  } catch {
    return sourceMap;
  }

  if (typeof parsed.mappings !== "string") return sourceMap;

  const original = decodeMappings(parsed.mappings);

  // Lines we introduced map to nothing; the rest inherit their old segments.
  const remapped = lineMap.map((line) => (line === -1 ? [] : (original[line] ?? [])));

  return JSON.stringify({ ...parsed, mappings: encodeMappings(remapped) });
}
