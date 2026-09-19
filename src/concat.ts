import type { Line } from "./lines";

/**
 * Removes the redundant parentheses TSTL puts around concatenations.
 *
 * A template literal is lowered to one parenthesised concatenation per
 * substitution, so `\`${a},${b},${c}\`` comes out as `((a .. ",") .. b) ..`
 * and so on, nesting one level deeper for every value in the string.
 *
 * darklua's parser is exponential in that nesting, at roughly four times per
 * level: twelve deep takes three seconds and fourteen never finishes. A row
 * built from nineteen values, which is an ordinary thing for a script to log,
 * extrapolates to hours. Dropping the parentheses is the difference between
 * five milliseconds and never, and the result is identical because `..` is
 * associative and both forms evaluate their operands left to right.
 *
 * Both forms are identical for strings and numbers. They differ only if an
 * operand is a table carrying a `__concat` metamethod, because the flattened
 * form is right associative and would call the metamethods in the other
 * order. TSTL emits `..` only where it has established the operands are
 * strings, so that case does not arise in a bundle.
 */
export function flattenConcatChains(lines: Line[]): Line[] {
  return lines.map((line) => (line.text.includes("..") ? { ...line, text: rewrite(line.text) } : line));
}

/** Which characters of a line are code, rather than a string literal or a comment. */
function codeMask(text: string): boolean[] {
  const mask: boolean[] = Array.from({ length: text.length }, () => true);

  for (let index = 0; index < text.length; index++) {
    const character = text[index];

    if (character === "-" && text[index + 1] === "-") {
      mask.fill(false, index);

      return mask;
    }

    if (character === '"' || character === "'") {
      mask[index] = false;

      for (index++; index < text.length; index++) {
        mask[index] = false;

        if (text[index] === "\\") {
          if (index + 1 < text.length) mask[++index] = false;

          continue;
        }

        if (text[index] === character) break;
      }

      continue;
    }

    // Long brackets, `[[` through `[==[`. A line-based pass cannot follow one
    // past the end of its line, so everything after it is treated as literal.
    const long = /^\[=*\[/.exec(text.slice(index));

    if (long) {
      const close = text.indexOf(long[0].replace(/\[$/, "]").replace(/^\[/, "]"), index + long[0].length);

      mask.fill(false, index, close === -1 ? text.length : close + long[0].length);

      if (close === -1) return mask;

      index = close + long[0].length - 1;
    }
  }

  return mask;
}

const IDENTIFIER_END = /[\w\]")]/;

/** Operators that bind looser than `..`, so a group holding one is not redundant. */
const LOOSER = /(?:^|[^\w])(?:or|and|not)(?:[^\w]|$)|[<>~=]=|[<>]/;

function rewrite(text: string): string {
  const mask = codeMask(text);
  const opens: number[] = [];
  const drop = new Set<number>();

  for (let index = 0; index < text.length; index++) {
    if (!mask[index]) continue;

    if (text[index] === "(") {
      opens.push(index);

      continue;
    }

    if (text[index] !== ")") continue;

    const open = opens.pop();

    if (open === undefined) continue;

    const before = text.slice(0, open).trimEnd();
    const after = text.slice(index + 1).trimStart();

    // A call's argument list looks the same from here. Dropping those parentheses
    // would turn `print(a .. b)` into `print a .. b`.
    if (IDENTIFIER_END.test(before.slice(-1))) continue;

    if (!before.endsWith("..") && !after.startsWith("..")) continue;

    const inner = insideConcatOnly(text, mask, open + 1, index);

    if (inner) {
      drop.add(open);
      drop.add(index);
    }
  }

  return drop.size === 0 ? text : [...text].filter((_character, index) => !drop.has(index)).join("");
}

/** Whether a group's own operators are all `..`, so its parentheses say nothing. */
function insideConcatOnly(text: string, mask: boolean[], from: number, to: number): boolean {
  let depth = 0;
  let concatenates = false;
  let own = "";

  for (let index = from; index < to; index++) {
    if (!mask[index]) {
      own += " ";

      continue;
    }

    const character = text[index];

    if (character === "(" || character === "[" || character === "{") depth++;
    else if (character === ")" || character === "]" || character === "}") depth--;

    if (depth > 0) {
      own += " ";

      continue;
    }

    own += character;

    if (character === "." && text[index + 1] === "." && text[index - 1] !== ".") concatenates = true;
  }

  return concatenates && !LOOSER.test(own);
}
