import { describe, expect, test } from "bun:test";
import plugin from "./index";
import { decodeMappings, encodeMappings, remapSourceMap } from "./sourcemap";

function map(mappings: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({ version: 3, sources: ["../src/main.ts"], mappings, ...extra });
}

/** Reads a generated line's first source line out of a map, 0-based. */
function sourceLineOf(sourceMap: string, generatedLine: number): number | undefined {
  return decodeMappings(JSON.parse(sourceMap).mappings)[generatedLine]?.[0]?.sourceLine;
}

describe("decodeMappings", () => {
  test("resolves deltas into absolute positions", () => {
    // Two lines, the second pointing two source lines further on.
    const decoded = decodeMappings("AAAA;AAEA");

    expect(decoded[0][0]).toEqual({
      generatedColumn: 0,
      source: 0,
      sourceLine: 0,
      sourceColumn: 0,
    });
    expect(decoded[1][0].sourceLine).toBe(2);
  });

  test("keeps a line with no segments", () => {
    expect(decodeMappings("AAAA;;AAAA")).toHaveLength(3);
    expect(decodeMappings("AAAA;;AAAA")[1]).toEqual([]);
  });

  test("carries the name index when present", () => {
    expect(decodeMappings("AAAAA")[0][0].name).toBe(0);
  });
});

describe("encodeMappings", () => {
  test("round-trips", () => {
    for (const mappings of ["AAAA;AAEA", "AAAA;;AAAA", "AAAA,CAAC;AACD", "", "AAAAA"]) {
      expect(encodeMappings(decodeMappings(mappings))).toBe(mappings);
    }
  });

  test("recomputes deltas after lines move", () => {
    const decoded = decodeMappings("AAAA;AAEA");
    // Swapping the lines has to flip the sign of the carried delta.
    const swapped = encodeMappings([decoded[1], decoded[0]]);

    expect(decodeMappings(swapped)[0][0].sourceLine).toBe(2);
    expect(decodeMappings(swapped)[1][0].sourceLine).toBe(0);
  });
});

describe("remapSourceMap", () => {
  test("reorders mappings to follow the lines", () => {
    // Output line 0 came from bundle line 1, output line 1 from bundle line 0.
    const remapped = remapSourceMap(map("AAAA;AAEA"), [1, 0]);

    expect(sourceLineOf(remapped, 0)).toBe(2);
    expect(sourceLineOf(remapped, 1)).toBe(0);
  });

  test("gives introduced lines no mapping", () => {
    const remapped = remapSourceMap(map("AAAA;AAEA"), [0, -1, 1]);

    expect(decodeMappings(JSON.parse(remapped).mappings)[1]).toEqual([]);
    expect(sourceLineOf(remapped, 2)).toBe(2);
  });

  test("drops mappings for lines that were removed", () => {
    const remapped = remapSourceMap(map("AAAA;AAEA;AAEA"), [0, 2]);

    expect(sourceLineOf(remapped, 0)).toBe(0);
    expect(sourceLineOf(remapped, 1)).toBe(4);
    expect(decodeMappings(JSON.parse(remapped).mappings)).toHaveLength(2);
  });

  test("preserves the map's other fields", () => {
    const remapped = JSON.parse(remapSourceMap(map("AAAA", { sourceRoot: "../src" }), [0]));

    expect(remapped.version).toBe(3);
    expect(remapped.sources).toEqual(["../src/main.ts"]);
    expect(remapped.sourceRoot).toBe("../src");
  });

  test("leaves a map it cannot understand alone", () => {
    expect(remapSourceMap("not json", [0])).toBe("not json");
    expect(remapSourceMap('{"version":3}', [0])).toBe('{"version":3}');
  });
});

describe("the afterEmit hook", () => {
  const BUNDLE = '--[[ Generated ]]\nprint("hi")\n';

  /** TSTL always hands plugins a `sourceMap`, whatever the options say. */
  function emit(options: { sourceMap?: boolean }) {
    const written: Record<string, string> = {};
    const file = { outputPath: "out/bundle.lua", code: BUNDLE, sourceMap: '{"version":3,"mappings":"AAAA;AACA"}' };

    plugin.afterEmit(undefined, options, { writeFile: (path: string, code: string) => void (written[path] = code) }, [
      file,
    ]);

    return written;
  }

  test("writes the rewritten map when source maps are on", () => {
    const written = emit({ sourceMap: true });

    expect(Object.keys(written).toSorted()).toEqual(["out/bundle.lua", "out/bundle.lua.map"]);
  });

  test("writes no map when source maps are off", () => {
    const written = emit({});

    expect(Object.keys(written)).toEqual(["out/bundle.lua"]);
  });
});
