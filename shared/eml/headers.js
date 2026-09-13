// Raw header handling, kept separate from MIME parsing.
//
// The raw header appendix must reproduce the header block as received. Anything
// re-serialized from parsed values is no longer evidence of routing — a Received
// chain rebuilt from a parser's model proves nothing about what the mail servers
// actually wrote.

export const MAX_HEADER_SCAN = 1024 * 1024; // 1 MB; no legitimate header block is larger

function decodeAscii(bytes) {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

/**
 * Return the verbatim header block: everything up to (not including) the blank
 * line that separates headers from body. Handles CRLFCRLF and bare LFLF.
 */
export function extractRawHeaderBlock(bytes) {
  const limit = Math.min(bytes.length, MAX_HEADER_SCAN);
  for (let i = 0; i + 1 < limit; i++) {
    if (bytes[i] === 13 && bytes[i + 1] === 10 &&
        bytes[i + 2] === 13 && bytes[i + 3] === 10) {
      return decodeAscii(bytes.subarray(0, i + 2));
    }
    if (bytes[i] === 10 && bytes[i + 1] === 10) {
      return decodeAscii(bytes.subarray(0, i + 1));
    }
  }
  return decodeAscii(bytes.subarray(0, limit));
}

/**
 * Split a raw header block into rows, joining RFC 5322 folded continuation
 * lines. Values are returned undecoded — encoded-words stay as written.
 */
export function unfoldHeaders(block) {
  const rows = [];
  let lastLineWasHeader = false;

  for (const line of block.split(/\r?\n/)) {
    if (line === '') continue;

    if (/^[ \t]/.test(line)) {
      // A folded line continues the line directly above it. If that line was
      // malformed and skipped, this continuation has no header to join —
      // appending it to the last *valid* row would silently corrupt an
      // unrelated header's value.
      if (lastLineWasHeader && rows.length) {
        rows[rows.length - 1].rawValue += ' ' + line.trim();
      }
      continue;
    }

    const idx = line.indexOf(':');
    if (idx === -1) {
      lastLineWasHeader = false; // malformed; the appendix still prints it verbatim
      continue;
    }

    rows.push({ key: line.slice(0, idx).trim(), rawValue: line.slice(idx + 1).trim() });
    lastLineWasHeader = true;
  }

  return rows;
}

/** First occurrence wins: the topmost Received line is the last hop. */
export function rawHeaderValue(block, name) {
  const wanted = name.toLowerCase();
  for (const row of unfoldHeaders(block)) {
    if (row.key.toLowerCase() === wanted) return row.rawValue;
  }
  return null;
}
