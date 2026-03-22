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
}
```

| Option        | Type       | Default | Description                                              |
| ------------- | ---------- | ------- | -------------------------------------------------------- |
| `skipModules` | `string[]` | `[]`    | Module names to leave untouched by the flattener         |
| `format`      | `boolean`  | `true`  | Add whitespace between logical code blocks in the output |

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
