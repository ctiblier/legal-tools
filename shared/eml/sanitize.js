// Privacy and safety filtering, performed on a detached, inert document.
//
// The motivating threat is not script execution — DOMParser documents have no
// browsing context and never execute or fetch anything. It is the tracking pixel:
// loading a remote image tells the sender, with a timestamp and an IP address,
// that their email is being reviewed. For opposing counsel's correspondence that
// is an unacceptable disclosure, so no remote reference is ever resolved, and
// every removal is counted so the certificate can disclose it.

const ACTIVE_TAGS = [
  'script', 'style', 'iframe', 'object', 'embed', 'svg', 'link',
  'meta', 'base', 'form', 'input', 'button', 'textarea', 'select'
];

const SAFE_ATTRS = new Set([
  'href', 'alt', 'title', 'width', 'height', 'colspan', 'rowspan',
  'start', 'type', 'align', 'color', 'face', 'size',
  'data-cid-ref', 'data-data-uri', 'data-blocked-image', 'data-alt'
]);

function blockedPlaceholder(doc, alt, reason) {
  const el = doc.createElement('span');
  el.setAttribute('data-blocked-image', reason);
  el.setAttribute('data-alt', alt || '');
  return el;
}

/**
 * @param {string} html
 * @param {Map<string, Object>} inlineImages  keyed by bare Content-ID
 * @returns {{body: HTMLElement, stats: Object}}
 */
export function sanitizeHtml(html, inlineImages) {
  const stats = {
    remoteImagesBlocked: 0,
    trackingPixelsBlocked: 0,
    activeContentRemoved: 0,
    unresolvedCidImages: 0
  };

  const doc = new DOMParser().parseFromString(html || '', 'text/html');

  for (const tag of ACTIVE_TAGS) {
    for (const el of Array.from(doc.querySelectorAll(tag))) {
      stats.activeContentRemoved++;
      el.remove();
    }
  }

  for (const img of Array.from(doc.querySelectorAll('img'))) {
    const src = (img.getAttribute('src') || '').trim();
    const alt = img.getAttribute('alt') || '';
    const w = parseInt(img.getAttribute('width') || '0', 10);
    const h = parseInt(img.getAttribute('height') || '0', 10);

    if (/^cid:/i.test(src)) {
      const cid = src.slice(4).replace(/^</, '').replace(/>$/, '');
      if (inlineImages && inlineImages.has(cid)) {
        const keep = doc.createElement('span');
        keep.setAttribute('data-cid-ref', cid);
        if (w) keep.setAttribute('width', String(w));
        if (h) keep.setAttribute('height', String(h));
        keep.setAttribute('data-alt', alt);
        img.replaceWith(keep);
      } else {
        stats.unresolvedCidImages++;
        img.replaceWith(blockedPlaceholder(doc, alt, 'cid-not-found'));
      }
      continue;
    }

    if (/^data:image\//i.test(src)) {
      const keep = doc.createElement('span');
      keep.setAttribute('data-data-uri', src);
      if (w) keep.setAttribute('width', String(w));
      if (h) keep.setAttribute('height', String(h));
      keep.setAttribute('data-alt', alt);
      img.replaceWith(keep);
      continue;
    }

    if (/^https?:/i.test(src)) {
      stats.remoteImagesBlocked++;
      // Only declared 1x1 geometry proves an image had nothing to show. A URL
      // that merely looks tracker-ish ("/pixel/", "/track/") is a guess, and
      // guessing wrong deletes visible evidence with no mark on the page — so
      // anything else gets a placeholder, even if it is probably a beacon.
      if (w === 1 && h === 1) {
        stats.trackingPixelsBlocked++;
        img.remove();
      } else {
        img.replaceWith(blockedPlaceholder(doc, alt, 'remote'));
      }
      continue;
    }

    // Any other scheme — relative, protocol-relative, ftp:, empty. The reference
    // is unresolvable rather than merely unsafe, but the reader still needs to
    // know something was there.
    stats.remoteImagesBlocked++;
    img.replaceWith(blockedPlaceholder(doc, alt, 'remote'));
  }

  // Attribute scrub over everything that survived.
  for (const el of Array.from(doc.body.querySelectorAll('*'))) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) { el.removeAttribute(attr.name); continue; }
      if (name === 'href') {
        if (!/^(https?:|mailto:|tel:)/i.test(attr.value.trim())) el.removeAttribute('href');
        continue;
      }
      if (name === 'style') continue; // read by html-to-blocks, never applied as CSS
      if (!SAFE_ATTRS.has(name)) el.removeAttribute(attr.name);
    }
  }

  return { body: doc.body, stats };
}
