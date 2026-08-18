import { flattenLines } from "./flatten";
import { formatLines } from "./format";
import { type Line, inserted, lineMap, render, splitLines } from "./lines";
import { shakeLines } from "./shake";
import { remapSourceMap } from "./sourcemap";

interface PluginConfig {
  name: string;
  skipModules?: string[];
  format?: boolean;
  shake?: boolean;
}

interface EmitFile {
  outputPath: string;
  code: string;
  /**
   * Always filled in by TSTL, whether or not source maps were asked for.
   * `sourceMap` in the compiler options is what decides whether it reaches
   * disk, so gate on that rather than on this being present.
   */
  sourceMap?: string;
}

interface CompilerOptions {
  luaPlugins?: PluginConfig[];
  sourceMap?: boolean;
}

interface EmitHost {
  writeFile(path: string, code: string, writeByteOrderMark: boolean): void;
}

const PLUGIN_NAME = "@gwigz/tstl-bundle-flatten";

/**
 * Runs the emit transforms, tracking which bundle line each output line
 * came from so the source map can be rewritten to match.
 */
export function transformLines(
  code: string,
  { skipModules = [], format = true, shake = false }: Omit<PluginConfig, "name">,
): Line[] {
  const original = splitLines(code);
  const flattened = flattenLines(original, skipModules);

  // Flattening ends the file with a newline; code that was not a bundle is
  // passed through untouched, so it keeps whatever ending it already had.
  let lines = flattened === original ? original : [...flattened, inserted("")];

  if (shake) {
    lines = shakeLines(lines);
  }

  if (format) {
    lines = formatLines(lines);
  }

  return lines;
}

const plugin = {
  afterEmit(_program: unknown, options: CompilerOptions, emitHost: EmitHost, result: EmitFile[]) {
    const config = options.luaPlugins?.find((p) => p.name === PLUGIN_NAME);

    for (const file of result) {
      const lines = transformLines(file.code, config ?? {});

      file.code = render(lines);

      emitHost.writeFile(file.outputPath, file.code, false);

      // TSTL wrote the map before plugins ran, so it still describes the
      // unflattened bundle. Rewrite it to match what we just emitted, but
      // only where TSTL wrote one, or we leave a stray `.map` behind.
      if (options.sourceMap && file.sourceMap !== undefined) {
        file.sourceMap = remapSourceMap(file.sourceMap, lineMap(lines));

        emitHost.writeFile(`${file.outputPath}.map`, file.sourceMap, false);
      }
    }
  },
};

export default plugin;
