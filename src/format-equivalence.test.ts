import { describe, expect, test } from "bun:test";
import { formatLua } from "./format";

/**
 * The original regex-over-whole-text formatter, kept verbatim as an oracle.
 *
 * The line-tracking rewrite has to stay byte-identical to this, including its
 * quirks: a global replace resumes inside the line it just consumed, so it
 * skips the following pair, and at end of file there is no `\n` for the
 * negative lookaheads to reject.
 */
function referenceFormat(code: string): string {
  const RE_COMMENT = /^\s*--/;
  const RE_DOC_COMMENT = /^\s*---/;
  const RE_BLANK = /^\s*$/;
  const RE_LOCAL = /^\s*local\b/;
  const RE_END = /^\s*end\b/;
  const RE_BLOCK_OPENER = /(?:then|do|else|repeat)$/;
  const RE_FUNCTION_HEAD = /\bfunction\b.*\)\s*$/;

  code = code.replace(/^(\s*end)\n(?!\n|\s*end\b|\s*else\b|\s*elseif\b|\s*\)|\s*[}\]]|\s*,)/gm, "$1\n\n");

  code = code.replace(/^([)}])\n(?!\n|[)}])/gm, "$1\n\n");

  code = code.replace(
    /^(\s*local (?!function\b)\w[^\n]*)\n([^\S\n]*(?!local\b|--)\S)/gm,
    (match, prev: string, next: string) => {
      if (RE_FUNCTION_HEAD.test(prev.trimEnd())) {
        return match;
      }

      return prev + "\n\n" + next;
    },
  );

  code = code.replace(/^([^\n]+)\n([^\S\n]*local (?!function\b)\w)/gm, (match, prev: string, localLine: string) => {
    const trimmed = prev.trimEnd();
    if (
      RE_LOCAL.test(prev) ||
      RE_COMMENT.test(prev) ||
      RE_BLANK.test(prev) ||
      RE_BLOCK_OPENER.test(trimmed) ||
      RE_FUNCTION_HEAD.test(trimmed)
    ) {
      return match;
    }

    return prev + "\n\n" + localLine;
  });

  code = code.replace(/^(.+)\n([^\S\n]*\w[\w.:]*\([^)]*$)/gm, (match, prev: string, callLine: string) => {
    const trimmed = prev.trimEnd();
    if (
      RE_COMMENT.test(prev) ||
      RE_BLANK.test(prev) ||
      RE_END.test(prev) ||
      RE_BLOCK_OPENER.test(trimmed) ||
      RE_FUNCTION_HEAD.test(trimmed)
    ) {
      return match;
    }

    return prev + "\n\n" + callLine;
  });

  code = code.replace(/^(.+)\n([^\S\n]*(?:if|for|while|repeat|return)\b)/gm, (match, prev: string, keyword: string) => {
    const trimmed = prev.trimEnd();
    if (
      RE_BLOCK_OPENER.test(trimmed) ||
      RE_FUNCTION_HEAD.test(trimmed) ||
      RE_END.test(prev) ||
      RE_DOC_COMMENT.test(prev) ||
      RE_BLANK.test(prev)
    ) {
      return match;
    }

    return prev + "\n\n" + keyword;
  });

  code = code.replace(/^(.+)\n([^\S\n]*---)/gm, (match, prev: string, comment: string) => {
    if (RE_COMMENT.test(prev) || RE_BLANK.test(prev)) {
      return match;
    }

    return prev + "\n\n" + comment;
  });

  code = code.replace(/^(.+)\n([^\S\n]*(?:local )?function\b)/gm, (match, prev: string, fn: string) => {
    if (RE_COMMENT.test(prev) || RE_BLANK.test(prev)) {
      return match;
    }

    return prev + "\n\n" + fn;
  });

  return code;
}

const CASES: [name: string, code: string][] = [
  ["empty", ""],
  ["single line", "print(1)"],
  ["single line with newline", "print(1)\n"],
  ["trailing end", "if x then\n    print(1)\nend\n"],
  ["trailing end no newline", "if x then\n    print(1)\nend"],
  ["end followed by blank", "if x then\n    print(1)\nend\n\nprint(2)\n"],
  ["end followed by else", "if x then\n    print(1)\nelse\n    print(2)\nend\n"],
  ["end followed by comma", "local t = {\n    f = function()\n    end,\n}\n"],
  ["consecutive functions", "local function a()\nend\nlocal function b()\nend\nlocal function c()\nend\n"],
  ["consecutive locals", "local a = 1\nlocal b = 2\nlocal c = 3\n"],
  ["local then code", "local a = 1\nprint(a)\n"],
  ["code then local", "print(1)\nlocal a = 2\n"],
  ["local function head", "local wrapped = wrap(function()\n    print(1)\nend)\n"],
  ["doc comments", "print(1)\n--- doc\nlocal a = 1\n"],
  ["comment then function", "-- note\nlocal function a()\nend\n"],
  ["multiline call", "local a = 1\nprint(\n    a\n)\n"],
  ["closing paren", "call(\n    1\n)\nprint(2)\n"],
  ["closing brace", "local t = {\n    1,\n}\nprint(2)\n"],
  ["return after code", "local a = 1\nreturn a\n"],
  ["return after then", "if x then\n    return 1\nend\n"],
  ["for loop", "local a = 1\nfor i = 1, 10 do\n    print(i)\nend\n"],
  ["while loop", "print(1)\nwhile true do\n    break\nend\n"],
  ["repeat", "print(1)\nrepeat\n    print(2)\nuntil x\n"],
  ["nested ends", "local function a()\n    if x then\n        print(1)\n    end\nend\n"],
  ["indented end then code", "do\n    print(1)\n    end\nprint(2)\n"],
  ["blank lines everywhere", "\n\nprint(1)\n\n\nlocal a = 1\n\n"],
  ["whitespace only lines", "print(1)\n   \nlocal a = 1\n"],
  ["header comment", "--[[ Generated ]]\nlocal a = 1\nprint(a)\n"],
  ["table with methods", "local t = {}\nfunction t.a()\nend\nfunction t.b()\nend\n"],
  ["colon call multiline", "local a = 1\nobj:method(\n    a\n)\n"],
  // A guard that rejects still consumes the pair, so the pair after it is
  // never tested and the blank line the next rule would add never appears.
  ["guarded pair still skips the next", "end\nlocal t = wrap(function()\nobj:m(\nobj:m(\nfunction g()\n"],
  ["guarded block keyword still skips the next", "}\nif x then\nreturn a\nfor i=1,2 do\n  "],
  // `\s*` in the `end`/`)` lookaheads crosses newlines, so a whitespace-only
  // line neither blocks the blank nor hides what comes after it.
  ["whitespace line after end", "  end\n  \nprint(1)\n  \nend,"],
  ["whitespace line after paren", ")\n  \n-- c"],
  ["whitespace line hides a continuing end", "end\n  \nend\n"],
  ["whitespace line hides a closing brace", "end\n \n\t\n}\n"],
  [
    "realistic bundle",
    `--[[ Generated with https://github.com/TypeScriptToLua/TypeScriptToLua ]]
local PI = 3.14159
local function area(r)
    return PI * r * r
end
local message = "hello"
if area(2) > 10 then
    print(message)
end
local t = {
    a = 1,
    b = 2,
}
for k, v in pairs(t) do
    print(k, v)
end
`,
  ],
];

describe("formatLines", () => {
  for (const [name, code] of CASES) {
    test(`matches the original formatter: ${name}`, () => {
      expect(formatLua(code)).toBe(referenceFormat(code));
    });
  }

  test("matches the original formatter on shuffled fragments", () => {
    // Recombine the fragments so rule interactions get exercised in orders
    // the hand-written cases above do not reach.
    const fragments = CASES.map(([, code]) => code).filter((code) => code !== "");

    for (let i = 0; i < fragments.length; i++) {
      for (let j = 0; j < fragments.length; j++) {
        const combined = fragments[i] + fragments[j];

        expect(formatLua(combined)).toBe(referenceFormat(combined));
      }
    }
  });

  test("matches the original formatter on random line sequences", () => {
    // Short random programs built from a vocabulary of the line shapes the
    // rules key off, including the whitespace-only lines and guard-rejecting
    // heads that the fragment cases above are too well-formed to produce.
    const VOCABULARY = [
      "",
      " ",
      "  ",
      "\t",
      "end",
      "  end",
      "end,",
      "end)",
      "else",
      "elseif y then",
      ")",
      "}",
      "  )",
      "]",
      ",",
      "local a = 1",
      "local t = wrap(function()",
      "local function f()",
      "function g()",
      "function t.h()",
      "print(1)",
      "obj:m(",
      "  call(",
      "if x then",
      "for i = 1, 2 do",
      "while true do",
      "repeat",
      "return a",
      "do",
      "-- note",
      "--- doc",
      "  a,",
    ];

    // A deterministic generator, so a failure is reproducible from the seed.
    let seed = 0x2f6e2b1;
    const next = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;

      return seed;
    };

    for (let iteration = 0; iteration < 20000; iteration++) {
      const length = 2 + (next() % 7);
      const picked: string[] = [];

      for (let line = 0; line < length; line++) {
        picked.push(VOCABULARY[next() % VOCABULARY.length]);
      }

      const code = picked.join("\n") + (next() % 2 === 0 ? "\n" : "");

      expect(formatLua(code)).toBe(referenceFormat(code));
    }
  });
});
