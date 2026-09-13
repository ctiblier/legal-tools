// shared/eml/certificate.js
// The certificate of conversion and the raw header appendix.
//
// The certificate is a factual record of what this tool did. It asserts nothing
// about the underlying email — not that it is genuine, not that it is complete as
// sent — only what was converted, from what bytes, and what the conversion could
// not reproduce. Keeping it on that side of the line is what makes it usable.

import { EML_TOOL_VERSION } from './version.js';

function styleRun(text, extra) {
  return Object.assign({
    text, bold: false, italic: false, underline: false, strike: false,
    color: null, sizeScale: 1, href: null
  }, extra || {});
}

const para = (text, extra) => ({ type: 'paragraph', runs: [styleRun(text, extra)] });

function field(label, value) {
  return { type: 'paragraph', runs: [
    styleRun(label + '  ', { bold: true }),
    styleRun(value)
  ] };
}

export function rawHeaderBlocks(record) {
  return [
    { type: 'heading', level: 3, runs: [styleRun('Appendix: full message headers')] },
    para('Reproduced verbatim from the source file. Lines too long for the page ' +
         'are wrapped with a leading marker; a wrapped line is a continuation of ' +
         'the line above it, not a separate header.', { italic: true, sizeScale: 0.9 }),
    { type: 'rule' },
    // Preformatted keeps the monospace face and every original line break, which
    // is what makes a Received chain readable as a chain.
    { type: 'preformatted', text: record.rawHeaderBlock.replace(/\r\n/g, '\n') }
  ];
}

/**
 * @param {EmailRecord} record
 * @param {Object} summary
 */
export function certificateBlocks(record, summary) {
  const limitations = [];
  const s = summary.sanitizeStats || {};

  if (s.remoteImagesBlocked) {
    limitations.push(
      s.remoteImagesBlocked + ' remote image(s) were not loaded' +
      (s.trackingPixelsBlocked
        ? ', of which ' + s.trackingPixelsBlocked + ' were tracking pixels'
        : '') +
      '. Remote content is never fetched, so that converting this message does ' +
      'not notify its sender.'
    );
  }
  if (s.unresolvedCidImages) {
    limitations.push(s.unresolvedCidImages +
      ' inline image(s) referenced by the message body were absent from the file.');
  }
  if (s.activeContentRemoved) {
    limitations.push(s.activeContentRemoved +
      ' script or style element(s) were removed. Style sheets are not applied; ' +
      'the layout of the body is a reconstruction, not a screenshot.');
  } else {
    limitations.push('Style sheets are not applied; the layout of the body is a ' +
      'reconstruction of the message, not a screenshot of it.');
  }
  if (summary.substitutions) {
    limitations.push(summary.substitutions +
      ' character(s) could not be rendered in any embedded font and appear as ' +
      'the replacement character «�».');
  }

  const notAppended = [];
  for (const att of record.attachments || []) {
    const d = summary.dispositions.get(att.sha256);
    if (d !== 'appended') notAppended.push(att.filename + ' (' + (d || 'zip-only') + ')');
  }
  if (notAppended.length) {
    limitations.push('Attachment(s) not appended to this PDF: ' + notAppended.join('; ') + '.');
  }

  for (const defect of summary.defects || []) {
    limitations.push(defect.code + ': ' + defect.detail);
  }

  const blocks = [
    { type: 'heading', level: 3, runs: [styleRun('Certificate of conversion')] },
    { type: 'rule' },
    field('Tool', 'BatesStamp.com Email to PDF, version ' + EML_TOOL_VERSION),
    field('Converted at', summary.generatedAtUtc + ' (UTC)'),
    field('Source file', record.sourceFilename || '(unnamed)'),
    field('Source SHA-256', record.sourceSha256),
    field('Message-ID', record.messageId || '(none present)'),
    field('Date header', record.date.raw || '(none present)'),
    field('Pages', String(summary.pageCount)),
    field('Attachments', String((record.attachments || []).length)),
    field('Body rendered from', summary.bodyPartUsed === 'html'
      ? 'the message’s HTML part'
      : summary.bodyPartUsed === 'text'
        ? 'the message’s plain-text part'
        : 'no body part — the message had none'),
    { type: 'rule' },
    { type: 'heading', level: 4, runs: [styleRun('Limitations of this conversion')] },
    {
      type: 'list', ordered: false, depth: 0,
      items: limitations.map((text) => [para(text)])
    },
    { type: 'rule' },
    para('The statements above describe this conversion only. They are not a ' +
         'representation about the authenticity, completeness, or contents of the ' +
         'underlying message.', { italic: true, sizeScale: 0.9 }),
    para(' '),
    para(' '),
    para('Signature: ____________________________________    Date: ______________'),
    para(' '),
    para('Printed name: _________________________________')
  ];

  return blocks;
}
