// Block IR -> HTML, for the in-page preview only.
//
// Everything here is escaped and inert. The preview shows the reviewer what the
// PDF will contain; it must not become a second, unguarded path by which hostile
// email markup reaches the live DOM, and no link in it may be clickable — a
// reviewer who clicks a link in an opposing party's email has told that party
// their message is being reviewed.

function esc(text) {
  return String(text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function runsToHtml(runs) {
  return (runs || []).map((r) => {
    let html = esc(r.text).replace(/\n/g, '<br>');
    if (r.bold) html = '<strong>' + html + '</strong>';
    if (r.italic) html = '<em>' + html + '</em>';
    if (r.underline) html = '<u>' + html + '</u>';
    if (r.strike) html = '<s>' + html + '</s>';
    if (r.href) {
      // Deliberately not an <a>: the target is shown, never followed.
      html = '<span class="eml-link" title="' + esc(r.href) + '">' + html + '</span>';
    }
    return html;
  }).join('');
}

export function blocksToHtml(blocks, opts = {}) {
  const images = opts.images || new Map();
  const out = [];

  for (const block of blocks || []) {
    switch (block.type) {
      case 'paragraph':
        out.push('<p>' + runsToHtml(block.runs) + '</p>');
        break;
      case 'heading':
        out.push('<h' + block.level + ' class="eml-h">' + runsToHtml(block.runs) +
                 '</h' + block.level + '>');
        break;
      case 'rule':
        out.push('<hr>');
        break;
      case 'preformatted':
        out.push('<pre>' + esc(block.text) + '</pre>');
        break;
      case 'list': {
        const tag = block.ordered ? 'ol' : 'ul';
        out.push('<' + tag + '>' + block.items
          .map((item) => '<li>' + blocksToHtml(item, opts) + '</li>').join('') +
          '</' + tag + '>');
        break;
      }
      case 'blockquote':
        out.push('<blockquote>' + blocksToHtml(block.children, opts) + '</blockquote>');
        break;
      case 'table':
        out.push('<table class="eml-table">' + block.rows.map((row) =>
          '<tr>' + row.map((cell) => {
            const tag = cell.header ? 'th' : 'td';
            const span = cell.colspan > 1 ? ' colspan="' + cell.colspan + '"' : '';
            return '<' + tag + span + '>' + blocksToHtml(cell.blocks, opts) + '</' + tag + '>';
          }).join('') + '</tr>').join('') + '</table>');
        break;
      case 'blockedImage':
        out.push('<div class="eml-blocked">' +
          (block.reason === 'cid-not-found'
            ? 'embedded image missing from message'
            : 'remote image not loaded') +
          (block.alt ? ' — ' + esc(block.alt) : '') + '</div>');
        break;
      case 'image': {
        if (block.ref.kind === 'data') {
          out.push('<img class="eml-img" alt="' + esc(block.alt) + '" src="' +
            esc(block.ref.url) + '">');
          break;
        }
        const att = images.get(block.ref.contentId);
        if (!att) { out.push('<div class="eml-blocked">inline image missing</div>'); break; }
        const blob = new Blob([att.bytes], { type: att.mimeType });
        const url = URL.createObjectURL(blob);
        if (opts.createdUrls) opts.createdUrls.push(url);
        out.push('<img class="eml-img" alt="' + esc(block.alt) + '" src="' + url + '">');
        break;
      }
      default:
        break;
    }
  }

  return out.join('');
}
