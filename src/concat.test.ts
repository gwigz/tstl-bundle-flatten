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
