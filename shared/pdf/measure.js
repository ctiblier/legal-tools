// Tokenizing and line breaking. Pure: measurement is injected, so this module is
// testable with a one-unit-per-character stub and has no font dependency.

/**
 * Split styled runs into word, space and newline tokens. Style travels with each
 * token so a line can mix bold and regular text without extra bookkeeping.
 */
export function tokenizeRuns(runs) {
  const tokens = [];
  for (const run of runs || []) {
    const parts = String(run.text).split(/(\n|[ \t]+)/);
    for (const part of parts) {
      if (part === '') continue;
      if (part === '\n') { tokens.push({ text: '', space: false, newline: true, style: run }); continue; }
      if (/^[ \t]+$/.test(part)) { tokens.push({ text: ' ', space: true, newline: false, style: run }); continue; }
      tokens.push({ text: part, space: false, newline: false, style: run });
    }
  }
  return tokens;
}

/** Split one over-long token (a URL, usually) into pieces that each fit. */
function hardBreak(token, maxWidth, measure) {
  const pieces = [];
  let buffer = '';
  for (const ch of token.text) {
    const candidate = buffer + ch;
    if (buffer && measure({ ...token, text: candidate }) > maxWidth) {
      pieces.push({ ...token, text: buffer });
      buffer = ch;
    } else {
      buffer = candidate;
    }
  }
  if (buffer) pieces.push({ ...token, text: buffer });
  return pieces;
}

/**
 * Greedy line breaking. Returns an array of lines, each an array of tokens.
 * Trailing spaces are trimmed from a line before it is measured, so a line whose
 * only overflow is a trailing space still fits.
 */
export function wrapTokens(tokens, maxWidth, measure) {
  const lines = [];
  let line = [];
  let width = 0;

  const trimTrailingSpaces = (arr) => {
    while (arr.length && arr[arr.length - 1].space) arr.pop();
    return arr;
  };

  const pushLine = () => {
    lines.push(trimTrailingSpaces(line));
    line = [];
    width = 0;
  };

  for (const token of tokens) {
    if (token.newline) { pushLine(); continue; }

    if (token.space) {
      if (line.length === 0) continue; // never start a line with a space
      line.push(token);
      width += measure(token);
      continue;
    }

    let w = measure(token);

    if (w > maxWidth) {
      if (line.length) pushLine();
      const pieces = hardBreak(token, maxWidth, measure);
      for (let i = 0; i < pieces.length; i++) {
        line = [pieces[i]];
        width = measure(pieces[i]);
        if (i < pieces.length - 1) pushLine();
      }
      continue;
    }

    if (width + w > maxWidth && line.length) {
      // Pull back the trailing space that would have preceded this word.
      trimTrailingSpaces(line);
      pushLine();
    }

    line.push(token);
    width += w;
  }

  if (line.length) pushLine();
  return lines;
}
