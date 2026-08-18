# `@gwigz/tstl-bundle-flatten`

A [TypeScriptToLua](https://github.com/TypeScriptToLua/TypeScriptToLua) plugin that flattens `luaBundle` output, eliminating the module system entirely.

TSTL's bundler wraps each module in a closure with a `require()` runtime. This plugin rewrites the bundle to emit all module code in dependency order as top-level locals, removing the `____modules` table, `____moduleCache`, `require()` function, module closures, and import/export boilerplate.

## When is this useful?

Some Lua runtimes don't support or benefit from a module system, or are have tight limitations. If you're targeting an environment like this and using `luaBundle`, the generated runtime adds unnecessary overhead. This plugin strips it out and gives you clean, top-level code.

## Install

```sh
bun add -D @gwigz/tstl-bundle-flatten
# or
npm install -D @gwigz/tstl-bundle-flatten
```

## Setup

Add the plugin to your `tsconfig.json`:

```diff
{
  "tstl": {
    "luaBundle": "bundle.lua",
    "luaBundleEntry": "src/index.ts",
    "luaPlugins": [
+     { "name": "@gwigz/tstl-bundle-flatten" }
    ]
  }
}
```

## Options

Options are passed inline in the plugin entry:

```jsonc
{
  "name": "@gwigz/tstl-bundle-flatten",
  // Modules to exclude from flattening (kept in the bundle runtime)
  "skipModules": ["constants"],
  // Insert blank lines at code boundaries for readability (default: true)
  "format": true,
  // Remove unused code after flattening, requires darklua-wasm (default: false)
  "shake": false,
}
```

| Option        | Type       | Default | Description                                              |
| ------------- | ---------- | ------- | -------------------------------------------------------- |
| `skipModules` | `string[]` | `[]`    | Module names to leave untouched by the flattener         |
| `format`      | `boolean`  | `true`  | Add whitespace between logical code blocks in the output |
| `shake`       | `boolean`  | `false` | Remove unused top-level code after flattening            |

## Tree shaking

Flattening turns every module export into a top-level `local`, which makes dead code
elimination simple: anything nothing references can be removed. With `"shake": true`,
the plugin runs [darklua](https://darklua.com)'s `remove_unused_variable` and
`remove_empty_do` rules over the flattened output.

This requires the optional [`darklua-wasm`](https://www.npmjs.com/package/darklua-wasm)
peer dependency:

```sh
bun add -D darklua-wasm
# or
npm install -D darklua-wasm
```

What it does:

- Removes unused `local function` definitions and unused locals, including
  functions only referenced by other removed functions
- Keeps side effects: an unused `local x = call()` becomes a bare `call()`
- Shakes inlined lualib functions too, since they flatten into locals like
  everything else

Unlike TypeScript-level tree shaking, this happens after bundling, so it also
catches unused exports pulled in through re-export chains (barrel files).

## Source maps

With `"sourceMap": true` in your `compilerOptions`, the plugin rewrites the emitted
`.map` alongside the code, so generated lines still resolve back to the original
TypeScript after flattening, shaking and formatting.

Mapping is line accurate, not column accurate: the transforms rewrite line contents,
so only the line a statement ended up on is meaningful. That is enough to turn a
runtime or compiler error in the flattened output back into a file and line you
recognise.

TSTL writes the map before plugins run, so without this the `.map` on disk would
describe the unflattened bundle and point at the wrong lines.

`inlineSourceMap` is not supported: TSTL appends its comment after the bundle's
entry call, which flattening drops along with the rest of the module runtime.

## Example

Given a bundle with two modules:

```
src/
├── greet.ts → export function greet(name: string) { ... }
└── index.ts → import { greet } from "./greet"
```

TSTL's default `luaBundle` output wraps everything in a module runtime. After `tstl-bundle-flatten`, you get:

```lua
local function greet(name)
  print("Hello, " .. name)
end

greet("world")
```

No `____modules`, no `require`, no closures, just flat Lua.
