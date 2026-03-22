import { flattenBundle } from "./flatten";
import { formatLua } from "./format";

interface PluginConfig {
  name: string;
  skipModules?: string[];
  format?: boolean;
}

interface EmitFile {
  outputPath: string;
  code: string;
}

interface EmitHost {
  writeFile(path: string, code: string, writeByteOrderMark: boolean): void;
}

const PLUGIN_NAME = "@gwigz/tstl-bundle-flatten";

const plugin = {
  afterEmit(_program: unknown, options: { luaPlugins?: PluginConfig[] }, emitHost: EmitHost, result: EmitFile[]) {
    const config = options.luaPlugins?.find((p) => p.name === PLUGIN_NAME);

    const skipModules = config?.skipModules ?? [];
    const format = config?.format ?? true;

    for (const file of result) {
      file.code = flattenBundle(file.code, skipModules);

      if (format) {
        file.code = formatLua(file.code);
      }

      emitHost.writeFile(file.outputPath, file.code, false);
    }
  },
};

export default plugin;
