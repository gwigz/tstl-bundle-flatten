import { type Line, inserted, isBlank, render, splitLines } from "./lines";

const RE_COMMENT = /^\s*--/;
const RE_DOC_COMMENT = /^\s*---/;
const RE_BLANK = /^\s*$/;
const RE_LOCAL = /^\s*local\b/;
const RE_END = /^\s*end\b/;
const RE_BLOCK_OPENER = /(?:then|do|else|repeat)$/;
const RE_FUNCTION_HEAD = /\bfunction\b.*\)\s*$/;

/** What may follow an `end` without a blank line: it closes or continues it. */
const CONTINUES_END = /^(?:end\b|else\b|elseif\b|\)|[}\]]|,)/;

/** One adjacent pair of lines, as a rule sees it. */
interface Pair {
  previous: string;
  next: string;
  /**
   * `next` is the empty element that stands for the file's final newline.
   * The rules that reject an empty following line still fire there, because
   * in the text form there is no `\n` after the last one to reject.
   */
  atEof: boolean;
  lines: Line[];
  /** Index of `next` in `lines`. */
  at: number;
}

/**
 * Whether `pattern` matches at the first non-whitespace character at or after
 * `next`.
 *
 * The lookaheads this replaces were prefixed with `\s*`, which crosses
 * newlines, so whitespace-only lines are transparent to them.
 */
function afterWhitespace({ lines, at }: Pair, pattern: RegExp): boolean {
  for (let index = at; index < lines.length; index++) {
    const { text } = lines[index];

    if (isBlank(text)) continue;

    return pattern.test(text.trimStart());
  }

  return false;
}

/**
 * A rule decides whether a blank line belongs between two adjacent lines.
 *
 * Every rule the formatter has is a decision about one adjacent pair, which
 * is why the whole pass can run over `Line[]` instead of raw text.
 *
 * `matches` and `guard` are separate because the original regexes separated
 * them: the pattern decided how much text the global replace consumed, and
 * the callback only decided whether to insert. So a pattern that matched
 * consumed part of `next` even when the callback returned the match
 * unchanged, leaving the pair starting at `next` untested either way.
 */
interface Rule {
  matches(pair: Pair): boolean;
  /** Only the rules that were written as a callback have a guard. */
  guard?(pair: Pair): boolean;
  /**
   * Whether the pattern consumed part of `next`. The callback rules captured
   * a prefix of it; the two lookahead rules are zero-width and consume none.
   */
  consumesNext: boolean;
}

const RULES: Rule[] = [
  // After `end` at any indent, unless the next line closes or continues it.
  {
    matches: (pair) =>
      /^[ \t]*end$/.test(pair.previous) && (pair.atEof || pair.next !== "") && !afterWhitespace(pair, CONTINUES_END),
    consumesNext: false,
  },

  // After a top-level `)` or `}` followed by code.
  {
    matches: ({ previous, next, atEof }) => /^[)}]$/.test(previous) && (atEof || next !== "") && !/^[)}]/.test(next),
    consumesNext: false,
  },

  // After a `local` block when followed by non-local code, unless the local
  // opens a multiline function expression (e.g. `local x = wrap(function()`).
  {
    matches: ({ previous, next }) =>
      /^[ \t]*local (?!function\b)\w/.test(previous) && /^[^\S\n]*(?!local\b|--)\S/.test(next),
    guard: ({ previous }) => !RE_FUNCTION_HEAD.test(previous.trimEnd()),
    consumesNext: true,
  },

  // Before `local` declarations preceded by non-local, non-comment code.
  {
    matches: ({ previous, next }) => previous.length > 0 && /^[^\S\n]*local (?!function\b)\w/.test(next),
    guard: ({ previous }) =>
      !RE_LOCAL.test(previous) &&
      !RE_COMMENT.test(previous) &&
      !RE_BLANK.test(previous) &&
      !RE_BLOCK_OPENER.test(previous.trimEnd()) &&
      !RE_FUNCTION_HEAD.test(previous.trimEnd()),
    consumesNext: true,
  },

  // Before multiline calls (a line that opens a paren without closing it).
  {
    matches: ({ previous, next }) => previous.length > 0 && /^[^\S\n]*\w[\w.:]*\([^)]*$/.test(next),
    guard: ({ previous }) =>
      !RE_COMMENT.test(previous) &&
      !RE_BLANK.test(previous) &&
      !RE_END.test(previous) &&
      !RE_BLOCK_OPENER.test(previous.trimEnd()) &&
      !RE_FUNCTION_HEAD.test(previous.trimEnd()),
    consumesNext: true,
  },

  // Before block keywords or `return`, unless the previous line opens a block.
  {
    matches: ({ previous, next }) => previous.length > 0 && /^[^\S\n]*(?:if|for|while|repeat|return)\b/.test(next),
    guard: ({ previous }) =>
      !RE_BLOCK_OPENER.test(previous.trimEnd()) &&
      !RE_FUNCTION_HEAD.test(previous.trimEnd()) &&
      !RE_END.test(previous) &&
      !RE_DOC_COMMENT.test(previous) &&
      !RE_BLANK.test(previous),
    consumesNext: true,
  },

  // Before doc comments preceded by code.
  {
    matches: ({ previous, next }) => previous.length > 0 && /^[^\S\n]*---/.test(next),
    guard: ({ previous }) => !RE_COMMENT.test(previous) && !RE_BLANK.test(previous),
    consumesNext: true,
  },

  // Before function definitions preceded by code (but not comments).
  {
    matches: ({ previous, next }) => previous.length > 0 && /^[^\S\n]*(?:local )?function\b/.test(next),
    guard: ({ previous }) => !RE_COMMENT.test(previous) && !RE_BLANK.test(previous),
    consumesNext: true,
  },
];

function applyRule(lines: Line[], rule: Rule): Line[] {
  const result: Line[] = [];

  for (let index = 0; index < lines.length; index++) {
    result.push(lines[index]);

    const next = lines[index + 1];

    if (next === undefined) continue;

    const pair: Pair = {
      previous: lines[index].text,
      next: next.text,
      atEof: index + 2 === lines.length && next.text === "",
      lines,
      at: index + 1,
    };

    if (!rule.matches(pair)) continue;

    if (rule.guard === undefined || rule.guard(pair)) {
      result.push(inserted(""));
    }

    // A global regex resumes inside the line it just consumed, so the pair
    // starting at that line never gets tested, whether or not the guard let
    // the blank line through. Skip it to match.
    if (rule.consumesNext) {
      result.push(next);

      index++;
    }
  }

  return result;
}

/** Adds blank lines at natural code boundaries for readable Lua output. */
export function formatLines(lines: Line[]): Line[] {
  return RULES.reduce(applyRule, lines);
}

export function formatLua(code: string): string {
  return render(formatLines(splitLines(code)));
}
