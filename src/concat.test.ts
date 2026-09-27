import { describe, expect, test } from "bun:test";
import { flattenConcatChains } from "./concat";
import { splitLines, render } from "./lines";

const rewrite = (code: string) => render(flattenConcatChains(splitLines(code)));

describe("flattenConcatChains", () => {
  test("drops the nesting a template literal lowers to", () => {
    expect(rewrite(`local r = (((a .. ",") .. b) .. ",") .. c`)).toBe(`local r = a .. "," .. b .. "," .. c`);
  });

  test("keeps a call's own parentheses", () => {
    expect(rewrite("print((a .. b) .. c)")).toBe("print(a .. b .. c)");
    expect(rewrite("f(a .. b)")).toBe("f(a .. b)");
    expect(rewrite("t.m(a .. b)")).toBe("t.m(a .. b)");
    expect(rewrite("t[k](a .. b)")).toBe("t[k](a .. b)");
    expect(rewrite('("x")(a .. b)')).toBe('("x")(a .. b)');
  });

  test("keeps parentheses a looser operator needs", () => {
    expect(rewrite("local y = (a .. b or c) .. d")).toBe("local y = (a .. b or c) .. d");
    expect(rewrite("local y = (a .. b == c) .. d")).toBe("local y = (a .. b == c) .. d");
    expect(rewrite("local y = (a .. b and c) .. d")).toBe("local y = (a .. b and c) .. d");
  });

  test("keeps a group that ends an if-expression", () => {
    // `Result: ${ok ? "PASS" : "FAIL"}; n=${n}`, as TSTL lowers it for Luau. Without the
    // inner group, the `else` branch would take the rest of the concatenation.
    expect(rewrite(`print((("Result: " .. if ok then "PASS" else "FAIL") .. "; n=") .. tostring(n))`)).toBe(
      `print(("Result: " .. if ok then "PASS" else "FAIL") .. "; n=" .. tostring(n))`,
    );

    // Concatenation on both sides of the group.
    expect(rewrite(`local r = x .. ("a" .. if ok then b else c) .. y`)).toBe(
      `local r = x .. ("a" .. if ok then b else c) .. y`,
    );

    // A branch that concatenates.
    expect(rewrite(`print(("x" .. if ok then s .. "!" else "none") .. "y")`)).toBe(
      `print(("x" .. if ok then s .. "!" else "none") .. "y")`,
    );
  });

  test("keeps a group that ends an if-expression holding other operators", () => {
    expect(rewrite(`local r = ("a" .. if ok then n + 1 else n * 2) .. "b"`)).toBe(
      `local r = ("a" .. if ok then n + 1 else n * 2) .. "b"`,
    );
    expect(rewrite(`local r = ("a" .. if n < 1 then "lt" else n == 1) .. "b"`)).toBe(
      `local r = ("a" .. if n < 1 then "lt" else n == 1) .. "b"`,
    );
    expect(rewrite(`local r = ("a" .. if ok then s else t or u) .. "b"`)).toBe(
      `local r = ("a" .. if ok then s else t or u) .. "b"`,
    );
  });

  test("keeps a group that ends a nested if-expression", () => {
    expect(rewrite(`print((("a" .. if ok then "x" else if big then "y" else "z") .. "b") .. s)`)).toBe(
      `print(("a" .. if ok then "x" else if big then "y" else "z") .. "b" .. s)`,
    );
    expect(rewrite(`print(("a" .. if ok then if big then "y" else "z" else "x") .. "b")`)).toBe(
      `print(("a" .. if ok then if big then "y" else "z" else "x") .. "b")`,
    );
  });

  test("still flattens around an if-expression that has its own parentheses", () => {
    expect(rewrite(`print(((if ok then "A" else "B") .. " tail") .. s)`)).toBe(
      `print((if ok then "A" else "B") .. " tail" .. s)`,
    );
    expect(rewrite(`print((s .. (if ok then "A" else "B")) .. " tail")`)).toBe(
      `print(s .. (if ok then "A" else "B") .. " tail")`,
    );
    expect(rewrite(`print((s .. f(if ok then "A" else "B")) .. " tail")`)).toBe(
      `print(s .. f(if ok then "A" else "B") .. " tail")`,
    );
  });

  test("leaves a group that is not an operand of a concatenation", () => {
    expect(rewrite("local x = (a .. b) == c")).toBe("local x = (a .. b) == c");
    expect(rewrite("local x = (a + b) .. c")).toBe("local x = (a + b) .. c");
  });

  test("reads strings and comments as text", () => {
    expect(rewrite('local s = "(x .. y)" .. z')).toBe('local s = "(x .. y)" .. z');
    expect(rewrite("local s = '(x .. y)' .. z")).toBe("local s = '(x .. y)' .. z");
    expect(rewrite('local s = "a\\"(b .. c)" .. d')).toBe('local s = "a\\"(b .. c)" .. d');
    expect(rewrite("local c = (a .. b) .. c -- (d .. e)")).toBe("local c = a .. b .. c -- (d .. e)");
    expect(rewrite("local l = [[(x .. y)]] .. z")).toBe("local l = [[(x .. y)]] .. z");
  });

  test("leaves a line with no concatenation alone", () => {
    const untouched = "local t = { a = (b), c = ((d)) }";

    expect(rewrite(untouched)).toBe(untouched);
  });

  test("keeps the line count, which the source map depends on", () => {
    const code = "local a = 1\nlocal r = ((a .. b) .. c)\nreturn r";

    expect(rewrite(code).split("\n")).toHaveLength(3);
  });
});
