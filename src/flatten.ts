/**
 * Flattens a TSTL bundle by eliminating the module system entirely.
 *
 * TSTL's luaBundle wraps each module in a closure with a require() runtime.
 * This rewrites the bundle to emit all module code in dependency order as
 * top-level locals, removing the ____modules table, ____moduleCache,
 * require() function, module closures, and import/export boilerplate.
 */
export function flattenBundle(code: string, skipModules: string[]): string {
  const runtimeStart = code.indexOf("\nlocal ____modules = {}\n");

  if (runtimeStart < 0) return code;

  const header = code.substring(0, runtimeStart + 1);

  // Extract module bodies in bundle order (TSTL emits dependencies first)
  const moduleRegex = /\["([^"]+)"\] = function\([^)]*\)\s*\n([\s\S]*?)\n end,/g;
  const bodies: string[] = [];

  let match;

  while ((match = moduleRegex.exec(code)) !== null) {
    const [, name, rawBody] = match;

    if (skipModules.includes(name)) {
      continue;
    }

    let body = rawBody;

    // Eliminate ____exports table pattern (function defs, value assignments, internal refs)
    body = body.replace(/function ____exports\.(\w+)\s*\(/g, "local function $1(");
    body = body.replace(/____exports\.(\w+)\s*=/g, "local $1 =");
    body = body.replace(/____exports\./g, "");
    body = body.replace(/local ____exports = \{\}\n/, "");

    // Strip return (table constructor or bare ____exports)
    body = body.replace(/(?:^|\n)return (?:____exports|\{[^}]*\})$/, "");

    // Strip require() lines
    body = body.replace(/^local ____\w+ = require\("[^"]+"\)\n/gm, "");

    // Resolve import destructuring:
    //   same name  -> remove (function already in scope from earlier module)
    //   different  -> alias (local newName = originalName)
    body = body.replace(/^local (\w+) = ____\w+\.(\w+)\n/gm, (_m, localName: string, exportName: string) =>
      localName === exportName ? "" : `local ${localName} = ${exportName}\n`,
    );

    bodies.push(body.trim());
  }

  return header + bodies.join("\n\n") + "\n";
}
