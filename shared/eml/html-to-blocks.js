// Sanitized DOM -> block IR. Pure: no I/O, no PDF knowledge, no live-DOM access.
//
// The IR is deliberately flat and small. Email HTML is written by thirty years of
// mail clients with no shared idea of correctness, so the goal is not to honour
// the markup but to recover the structure a reader would perceive: paragraphs,
// emphasis, lists, quote levels, tables, images.

const BLOCK_TAGS = new Set([
  'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI',
  'BLOCKQUOTE', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'PRE', 'HR', 'BR'
]);

const EMPTY_STYLE = {
  bold: false, italic: false, underline: false, strike: false,
  color: null, sizeScale: 1, href: null
};

const COLOR_OK = /^(#[0-9a-f]{3}|#[0-9a-f]{6}|rgba?\(\s*[\d.,\s%]+\)|[a-z]+)$/i;

function styleFor(el, inherited) {
  const s = Object.assign({}, inherited);
  const tag = el.tagName;
  if (tag === 'B' || tag === 'STRONG') s.bold = true;
  if (tag === 'I' || tag === 'EM') s.italic = true;
  if (tag === 'U' || tag === 'INS') s.underline = true;
  if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') s.strike = true;
  if (tag === 'A' && el.getAttribute('href')) s.href = el.getAttribute('href');
  if (tag === 'SMALL') s.sizeScale = 0.85;
  if (tag === 'BIG') s.sizeScale = 1.15;

  // The style attribute is read for colour and weight only. It is never applied
  // as CSS; the renderer has no cascade and pretending otherwise would produce
  // confident, wrong layout.
  const style = el.getAttribute && el.getAttribute('style');
  if (style) {
    const color = /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(style);
    if (color) {
      const value = color[1].trim();
      // Read for colour only: anything that is not a colour is dropped rather
      // than carried as free text out of the sanitization boundary.
      s.color = COLOR_OK.test(value) ? value : null;
    }
    if (/font-weight\s*:\s*(bold|[6-9]00)/i.test(style)) s.bold = true;
    if (/font-style\s*:\s*italic/i.test(style)) s.italic = true;
  }
  return s;
}

function collectRuns(node, style, runs) {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) { // text
      const text = child.nodeValue.replace(/\s+/g, ' ');
      if (text) runs.push(Object.assign({}, style, { text }));
      continue;
    }
    if (child.nodeType !== 1) continue;
    if (child.tagName === 'BR') {
      runs.push(Object.assign({}, style, { text: '\n' }));
      continue;
    }
    if (child.hasAttribute && child.hasAttribute('data-blocked-image')) continue;
    if (child.hasAttribute && (child.hasAttribute('data-cid-ref') ||
                               child.hasAttribute('data-data-uri'))) continue;
    collectRuns(child, styleFor(child, style), runs);
  }
}

function trimRuns(runs) {
  const out = runs.filter((r) => r.text !== '');
  if (out.length) out[0] = Object.assign({}, out[0], { text: out[0].text.replace(/^ +/, '') });
  const last = out.length - 1;
  if (last >= 0) out[last] = Object.assign({}, out[last], { text: out[last].text.replace(/ +$/, '') });
  return out.filter((r) => r.text !== '');
}

function imageBlockFrom(el) {
  const alt = el.getAttribute('data-alt') || '';
  const widthPx = parseInt(el.getAttribute('width') || '0', 10) || 0;
  const heightPx = parseInt(el.getAttribute('height') || '0', 10) || 0;
  if (el.hasAttribute('data-blocked-image')) {
    return { type: 'blockedImage', reason: el.getAttribute('data-blocked-image'), alt };
  }
  if (el.hasAttribute('data-cid-ref')) {
    return {
      type: 'image', alt, widthPx, heightPx,
      ref: { kind: 'cid', contentId: el.getAttribute('data-cid-ref') }
    };
  }
  return {
    type: 'image', alt, widthPx, heightPx,
    ref: { kind: 'data', url: el.getAttribute('data-data-uri') }
  };
}

function isImageish(el) {
  return el.nodeType === 1 && el.hasAttribute &&
    (el.hasAttribute('data-blocked-image') || el.hasAttribute('data-cid-ref') ||
     el.hasAttribute('data-data-uri'));
}

function hasBlockChild(el) {
  for (const c of Array.from(el.childNodes)) {
    if (c.nodeType === 1 && (BLOCK_TAGS.has(c.tagName) || isImageish(c)) && c.tagName !== 'BR') {
      return true;
    }
  }
  // An image marker nested inside an inline wrapper (<a><img></a> is the most
  // common image in email) must still escape to block level. Left inline, it is
  // skipped by collectRuns and disappears -- while sanitize has already counted
  // it, so the certificate would claim a blocked image the body never shows.
  // Losing the surrounding link styling is an acceptable price; losing the
  // image is not.
  return !!(el.querySelector &&
            el.querySelector('[data-blocked-image],[data-cid-ref],[data-data-uri]'));
}

/**
 * @param {HTMLElement} root  the body element returned by sanitizeHtml
 * @param {number} [quoteDepth]
 * @param {Object} [inherited]  style flags inherited from an enclosing inline
 *   wrapper (e.g. an <a> around block content), so a link target or emphasis
 *   applied above a block-child boundary is not lost when we recurse.
 * @returns {Array<Object>} block IR
 */
export function htmlToBlocks(root, quoteDepth = 0, inherited = EMPTY_STYLE) {
  const out = [];
  let pending = [];

  function flushPending() {
    const runs = trimRuns(pending);
    pending = [];
    if (runs.length) out.push({ type: 'paragraph', runs });
  }

  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === 3) {
      const text = node.nodeValue.replace(/\s+/g, ' ');
      if (text.trim()) pending.push(Object.assign({}, inherited, { text }));
      continue;
    }
    if (node.nodeType !== 1) continue;

    if (isImageish(node)) {
      flushPending();
      out.push(imageBlockFrom(node));
      continue;
    }

    const tag = node.tagName;

    if (tag === 'BR') { pending.push(Object.assign({}, inherited, { text: '\n' })); continue; }

    if (tag === 'HR') { flushPending(); out.push({ type: 'rule' }); continue; }

    if (tag === 'PRE') {
      flushPending();
      out.push({ type: 'preformatted', text: node.textContent });
      continue;
    }

    if (/^H[1-6]$/.test(tag)) {
      flushPending();
      const runs = [];
      collectRuns(node, inherited, runs);
      const trimmed = trimRuns(runs);
      if (trimmed.length) {
        out.push({ type: 'heading', level: parseInt(tag.slice(1), 10), runs: trimmed });
      }
      continue;
    }

    if (tag === 'UL' || tag === 'OL') {
      flushPending();
      const items = [];
      for (const child of Array.from(node.children)) {
        // A non-<li> child (a directly nested list, or a <div> some mail client
        // emitted) still carries content. Skipping it silently loses text.
        items.push(htmlToBlocks(child, quoteDepth, inherited));
      }
      if (items.length) {
        out.push({ type: 'list', ordered: tag === 'OL', depth: quoteDepth, items });
      }
      continue;
    }

    if (tag === 'BLOCKQUOTE') {
      flushPending();
      out.push({
        type: 'blockquote',
        depth: quoteDepth + 1,
        children: htmlToBlocks(node, quoteDepth + 1, inherited)
      });
      continue;
    }

    if (tag === 'TABLE') {
      flushPending();

      const caption = node.querySelector(':scope > caption');
      if (caption) {
        const capRuns = [];
        collectRuns(caption, inherited, capRuns);
        const trimmedCap = trimRuns(capRuns);
        if (trimmedCap.length) out.push({ type: 'paragraph', runs: trimmedCap });
      }

      // Gather rows by section explicitly, in visual order (head, then body,
      // then foot), rather than trusting querySelectorAll's document order --
      // a <tfoot> authored before <tbody> (legal, and required pre-HTML5)
      // would otherwise render above the body rows.
      const rowEls = [];
      for (const tr of Array.from(node.children)) {
        if (tr.tagName === 'TR') rowEls.push(tr);
      }
      for (const section of ['THEAD', 'TBODY', 'TFOOT']) {
        for (const sec of Array.from(node.children)) {
          if (sec.tagName !== section) continue;
          for (const tr of Array.from(sec.children)) {
            if (tr.tagName === 'TR') rowEls.push(tr);
          }
        }
      }

      const rows = [];
      for (const tr of rowEls) {
        const cells = [];
        for (const td of Array.from(tr.children)) {
          if (td.tagName !== 'TD' && td.tagName !== 'TH') continue;
          cells.push({
            blocks: htmlToBlocks(td, quoteDepth, inherited),
            colspan: parseInt(td.getAttribute('colspan') || '1', 10) || 1,
            rowspan: parseInt(td.getAttribute('rowspan') || '1', 10) || 1,
            header: td.tagName === 'TH'
          });
        }
        if (cells.length) rows.push(cells);
      }

      if (rows.length) {
        out.push({ type: 'table', rows });
      } else {
        // No conforming rows, but the element still held content (e.g. only a
        // caption, or markup too irregular to yield a row). Recurse the
        // element's children -- never the element itself, which would re-enter
        // this same TABLE branch and loop forever -- rather than drop it.
        for (const child of Array.from(node.children)) {
          if (child === caption) continue;
          out.push(...htmlToBlocks(child, quoteDepth, inherited));
        }
      }
      continue;
    }

    // DIV, P, SPAN, TD used loosely, and everything else: recurse when it holds
    // block-level children, otherwise treat it as inline content.
    if (hasBlockChild(node)) {
      flushPending();
      out.push(...htmlToBlocks(node, quoteDepth, styleFor(node, inherited)));
      continue;
    }

    const runs = [];
    collectRuns(node, styleFor(node, inherited), runs);
    if (tag === 'P' || tag === 'DIV') {
      flushPending();
      const trimmed = trimRuns(runs);
      if (trimmed.length) out.push({ type: 'paragraph', runs: trimmed });
    } else {
      pending.push(...runs);
    }
  }

  flushPending();
  return out;
}
