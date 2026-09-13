// Plain-text bodies -> the same block IR the HTML path produces.
//
// Plain text carries real structure that a naive renderer throws away: '>' quote
// levels are the entire reply history of a thread. Indentation and alignment are
// preserved by keeping soft line breaks rather than reflowing, because a plain-text
// email that lines up columns with spaces means them to line up.

const URL_RE = /(https?:\/\/[^\s<>()]+[^\s<>().,;:!?])/g;

const EMPTY_STYLE = {
  bold: false, italic: false, underline: false, strike: false,
  color: null, sizeScale: 1, href: null
};

function runsWithLinks(text) {
  const runs = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    if (match.index > last) {
      runs.push(Object.assign({}, EMPTY_STYLE, { text: text.slice(last, match.index) }));
    }
    runs.push(Object.assign({}, EMPTY_STYLE, { text: match[0], href: match[0] }));
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    runs.push(Object.assign({}, EMPTY_STYLE, { text: text.slice(last) }));
  }
  return runs.length ? runs : [Object.assign({}, EMPTY_STYLE, { text })];
}

function quoteDepthOf(line) {
  const m = /^((?:\s*>)+)\s?/.exec(line);
  if (!m) return 0;
  return (m[1].match(/>/g) || []).length;
}

function stripQuoteMarkers(line, depth) {
  let out = line;
  for (let i = 0; i < depth; i++) out = out.replace(/^\s*>\s?/, '');
  return out;
}

function paragraphsFrom(lines) {
  const blocks = [];
  let buffer = [];
  const flush = () => {
    if (!buffer.length) return;
    const text = buffer.join('\n').replace(/\n+$/, '');
    if (text.trim()) blocks.push({ type: 'paragraph', runs: runsWithLinks(text) });
    buffer = [];
  };
  for (const line of lines) {
    if (line.trim() === '') flush();
    else buffer.push(line);
  }
  flush();
  return blocks;
}

/**
 * @param {string} text
 * @returns {Array<Object>} block IR
 */
export function textToBlocks(text) {
  const lines = (text || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const depth = quoteDepthOf(lines[i]);

    if (depth === 0) {
      const plain = [];
      while (i < lines.length && quoteDepthOf(lines[i]) === 0) plain.push(lines[i++]);
      out.push(...paragraphsFrom(plain));
      continue;
    }

    // Gather the whole quoted region at this depth or deeper, strip one level of
    // markers, and recurse — which yields nesting for free.
    const quoted = [];
    while (i < lines.length && quoteDepthOf(lines[i]) >= depth) {
      quoted.push(stripQuoteMarkers(lines[i++], 1));
    }

    // The recursive call sees markers one level shallower, so the blockquotes it
    // returns number their depths from 1. Rebase them onto the current depth or a
    // three-level reply chain would render as three separate first-level quotes.
    const children = rebaseDepth(textToBlocks(quoted.join('\n')), depth);
    out.push({ type: 'blockquote', depth, children });
  }

  return out;
}

function rebaseDepth(blocks, offset) {
  return blocks.map((b) => {
    if (b.type !== 'blockquote') return b;
    return {
      type: 'blockquote',
      depth: b.depth + offset,
      children: rebaseDepth(b.children, offset)
    };
  });
}
