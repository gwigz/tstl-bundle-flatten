import { describe, expect, test } from "bun:test";
import { flattenBundle } from "./flatten";

/**
 * The original string-based flattener, kept verbatim as an oracle.
 *
 * It is an oracle, not a specification: its import and require strips are
 * anchored on a trailing newline, so it mangles a module whose last line is
 * one of them. `MODULES` below deliberately holds no such module: that shape
 * is covered by "strips imports the return left as the body's last line" in
 * index.test.ts, where the line-based rewrite is asserted against what the
 * output should be rather than against what this used to produce.
 */
function referenceFlatten(code: string, skipModules: string[]): string {
  const runtimeStart = code.indexOf("\nlocal ____modules = {}\n");

  if (runtimeStart < 0) return code;

  const header = code.substring(0, runtimeStart + 1);
  const moduleRegex = /\["([^"]+)"\] = function\([^)]*\)\s*\n([\s\S]*?)\n end,/g;
  const bodies: string[] = [];

  let match;

  while ((match = moduleRegex.exec(code)) !== null) {
    const [, name, rawBody] = match;

    if (skipModules.includes(name)) {
      continue;
    }

    let body = rawBody;

    body = body.replace(/function ____exports\.(\w+)\s*\(/g, "local function $1(");
    body = body.replace(/____exports\.(\w+)\s*=/g, "local $1 =");
    body = body.replace(/____exports\./g, "");
    body = body.replace(/local ____exports = \{\}\n/, "");
    body = body.replace(/(?:^|\n)return (?:____exports|\{[^}]*\})$/, "");
    body = body.replace(/^[ \t]*local ____\w+ = require\("[^"]+"\)\n/gm, "");
    body = body.replace(
      /^([ \t]*)local (\w+) = ____\w+\.(\w+)\n/gm,
      (_m, indent: string, localName: string, exportName: string) =>
        localName === exportName ? "" : `${indent}local ${localName} = ${exportName}\n`,
    );
    body = body.replace(/^do(?:\n\s*)+end\n?/gm, "");

    bodies.push(body.trim());
  }

  return header + bodies.join("\n\n") + "\n";
}

function bundle(modules: [name: string, body: string][], entry: string) {
  const header = `--[[ Generated with https://github.com/TypeScriptToLua/TypeScriptToLua ]]`;

  const runtime = `local ____modules = {}
local ____moduleCache = {}
local ____originalRequire = require
local function require(file, ...)
    if ____moduleCache[file] then
        return ____moduleCache[file].value
    end
end`;

  const entries = modules.map(([name, body]) => `["${name}"] = function(...) \n${body}\n end,`).join("\n");

  return `${header}\n\n${runtime}\n____modules = {\n${entries}\n}\nlocal ____entry = require("${entry}", ...)\nreturn ____entry\n`;
}

const MODULES: [name: string, body: string][] = [
  ["src/empty", `local ____exports = {}\nreturn ____exports`],
  [
    "src/constants",
    `local ____exports = {}
____exports.PI = 3.14159
____exports.E = 2.71828
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
return ____exports`,
  ],
  [
    "src/aliased",
    `local ____exports = {}
local ____constants = require("src/constants")
local circleConstant = ____constants.PI
function ____exports.tau(self)
    return circleConstant * 2
end
return ____exports`,
  ],
  [
    "src/side-effect",
    `local ____exports = {}
do
    local ____effects = require("src/effects")
end
return ____exports`,
  ],
  [
    "src/table-return",
    `local ____exports = {}
local a = 1
local b = 2
return { a = a, b = b }`,
  ],
  [
    "src/indented-do",
    `local ____exports = {}
do
    local ____x = require("src/x")
    local y = ____x.y
end
print("after")
return ____exports`,
  ],
  [
    "src/main",
    `local ____math = require("src/math")
local area = ____math.area
print(area(nil, 2))`,
  ],
  ["src/no-exports", `print("just a side effect")`],
];

describe("flattenLines", () => {
  test("passes through code that is not a bundle", () => {
    const code = `--[[ Generated ]]\nprint("hello")\n`;

    expect(flattenBundle(code, [])).toBe(referenceFlatten(code, []));
  });

  for (const [name] of MODULES) {
    test(`matches the original flattener with only: ${name}`, () => {
      const code = bundle(
        MODULES.filter(([id]) => id === name),
        name,
      );

      expect(flattenBundle(code, [])).toBe(referenceFlatten(code, []));
    });
  }

  test("matches the original flattener on the full bundle", () => {
    const code = bundle(MODULES, "src/main");

    expect(flattenBundle(code, [])).toBe(referenceFlatten(code, []));
  });

  test("matches the original flattener for every skipModules choice", () => {
    const code = bundle(MODULES, "src/main");

    for (const [name] of MODULES) {
      expect(flattenBundle(code, [name])).toBe(referenceFlatten(code, [name]));
    }

    expect(
      flattenBundle(
        code,
        MODULES.map(([name]) => name),
      ),
    ).toBe(
      referenceFlatten(
        code,
        MODULES.map(([name]) => name),
      ),
    );
  });

  test("matches the original flattener on every adjacent module pair", () => {
    for (let i = 0; i < MODULES.length; i++) {
      for (let j = 0; j < MODULES.length; j++) {
        const code = bundle([MODULES[i], MODULES[j]], MODULES[j][0]);

        expect(flattenBundle(code, [])).toBe(referenceFlatten(code, []));
      }
    }
  });
});
