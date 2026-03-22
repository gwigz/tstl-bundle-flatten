const RE_COMMENT = /^\s*--/;
const RE_DOC_COMMENT = /^\s*---/;
const RE_BLANK = /^\s*$/;
const RE_LOCAL = /^\s*local\b/;
const RE_END = /^\s*end\b/;
const RE_BLOCK_OPENER = /(?:then|do|else|repeat)$/;
const RE_FUNCTION_HEAD = /\bfunction\b.*\)\s*$/;

/** Adds blank lines at natural code boundaries for readable Lua output. */
export function formatLua(code: string): string {
  // After `end` at any indent, unless followed by end/else/elseif/)/}/,
  code = code.replace(/^(\s*end)\n(?!\n|\s*end\b|\s*else\b|\s*elseif\b|\s*\)|\s*[}\]]|\s*,)/gm, "$1\n\n");

  // After top-level `)` or `}` followed by code
  code = code.replace(/^([)}])\n(?!\n|[)}])/gm, "$1\n\n");

  // After `local` block when followed by non-local code
  code = code.replace(/^(\s*local (?!function\b)\w[^\n]*)\n([^\S\n]*(?!local\b|--)\S)/gm, "$1\n\n$2");

  // Before `local` declarations when preceded by non-local, non-comment code
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

  // Before multiline calls (line opens paren/brace but doesn't close it)
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

  // Before block keywords or `return` when preceded by non-block-opener code
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

  // Before doc comments (---) when preceded by code
  code = code.replace(/^(.+)\n([^\S\n]*---)/gm, (match, prev: string, comment: string) => {
    if (RE_COMMENT.test(prev) || RE_BLANK.test(prev)) {
      return match;
    }

    return prev + "\n\n" + comment;
  });

  // Before function definitions when preceded by code (not comments)
  code = code.replace(/^(.+)\n([^\S\n]*(?:local )?function\b)/gm, (match, prev: string, fn: string) => {
    if (RE_COMMENT.test(prev) || RE_BLANK.test(prev)) {
      return match;
    }

    return prev + "\n\n" + fn;
  });

  return code;
}
