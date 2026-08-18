import { describe, expect, test } from "bun:test";
import { flattenBundle } from "./flatten";
import { formatLua } from "./format";
import { transformLines } from "./index";
import { render } from "./lines";
import { shakeBundle } from "./shake";

/** The pipeline as it ran before line tracking, composed from the string APIs. */
function referencePipeline(
  code: string,
  {
    skipModules = [],
    format = true,
    shake = false,
  }: {
    skipModules?: string[];
    format?: boolean;
    shake?: boolean;
  },
) {
  let output = flattenBundle(code, skipModules);

  if (shake) output = shakeBundle(output);
  if (format) output = formatLua(output);

  return output;
}

function bundle(modules: [name: string, body: string][], entry: string) {
  const header = `--[[ Generated with https://github.com/TypeScriptToLua/TypeScriptToLua ]]`;

  const runtime = `local ____modules = {}
local ____moduleCache = {}
local function require(file, ...)
    if ____moduleCache[file] then
        return ____moduleCache[file].value
    end
end`;

  const entries = modules.map(([name, body]) => `["${name}"] = function(...) \n${body}\n end,`).join("\n");

  return `${header}\n\n${runtime}\n____modules = {\n${entries}\n}\nlocal ____entry = require("${entry}", ...)\nreturn ____entry\n`;
}

const BUNDLE = bundle(
  [
    [
      "src/constants",
      `local ____exports = {}
____exports.PI = 3.14159
____exports.UNUSED = 1
return ____exports`,
    ],
    [
      "src/math",
      `local ____exports = {}
local ____constants = require("src/constants")
local PI = ____constants.PI
function ____exports.area(self, r)
    return PI * r * r
end
function ____exports.unusedHelper(self)
    return 0
end
return ____exports`,
    ],
    [
      "src/main",
      `local ____math = require("src/math")
local area = ____math.area
print(area(nil, 2))`,
    ],
  ],
  "src/main",
);

const NOT_A_BUNDLE = `--[[ Generated ]]\nprint("hello")\n`;

const OPTIONS = [
  {},
  { format: false },
  { shake: true },
  { shake: true, format: false },
  { skipModules: ["src/constants"] },
  { skipModules: ["src/constants", "src/math", "src/main"] },
];

describe("transformLines", () => {
  for (const options of OPTIONS) {
    test(`matches the string pipeline for ${JSON.stringify(options)}`, () => {
      expect(render(transformLines(BUNDLE, options))).toBe(referencePipeline(BUNDLE, options));
    });

    test(`passes non-bundle code through for ${JSON.stringify(options)}`, () => {
      expect(render(transformLines(NOT_A_BUNDLE, options))).toBe(referencePipeline(NOT_A_BUNDLE, options));
    });
  }

  test("produces one map entry per output line", () => {
    const lines = transformLines(BUNDLE, { shake: true });

    expect(lines).toHaveLength(render(lines).split("\n").length);
  });
});
