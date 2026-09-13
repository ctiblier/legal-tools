// shared/eml/manifest.js
// Attachment manifest: what came with the message, and what this PDF did with it.

const APPENDABLE = [/^application\/pdf$/i, /^image\/(png|jpe?g)$/i];

function styleRun(text, extra) {
  return Object.assign({
    text, bold: false, italic: false, underline: false, strike: false,
    color: null, sizeScale: 1, href: null
  }, extra || {});
}

export function dispositionFor(att, options) {
  if (att.error) return 'unreadable';
  if (!options || !options.appendAttachments) return 'zip-only';
  return APPENDABLE.some((re) => re.test(att.mimeType || '')) ? 'appended' : 'zip-only';
}

function humanSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

const DISPOSITION_TEXT = {
  appended: 'appended to this PDF',
  'zip-only': 'not appended — provided in the attachment ZIP',
  unreadable: 'could not be read'
};

/**
 * @param {EmailRecord} record
 * @param {Map<string,string>} dispositions  sha256 -> disposition
 * @returns {Array<Object>} block IR
 */
export function manifestBlocks(record, dispositions) {
  if (!record.attachments || record.attachments.length === 0) return [];

  const blocks = [
    { type: 'rule' },
    { type: 'heading', level: 3,
      runs: [styleRun('Attachments (' + record.attachments.length + ')')] }
  ];

  const rows = [[
    { blocks: [{ type: 'paragraph', runs: [styleRun('#')] }], colspan: 1, rowspan: 1, header: true },
    { blocks: [{ type: 'paragraph', runs: [styleRun('File')] }], colspan: 1, rowspan: 1, header: true },
    { blocks: [{ type: 'paragraph', runs: [styleRun('Type / size')] }], colspan: 1, rowspan: 1, header: true },
    { blocks: [{ type: 'paragraph', runs: [styleRun('Disposition')] }], colspan: 1, rowspan: 1, header: true }
  ]];

  record.attachments.forEach((att, i) => {
    const disposition = dispositions.get(att.sha256) || 'zip-only';
    rows.push([
      { blocks: [{ type: 'paragraph', runs: [styleRun(String(i + 1))] }],
        colspan: 1, rowspan: 1, header: false },
      { blocks: [
          { type: 'paragraph', runs: [styleRun(att.filename, { bold: true })] },
          { type: 'paragraph', runs: [styleRun('SHA-256 ' + att.sha256, { sizeScale: 0.8 })] }
        ], colspan: 1, rowspan: 1, header: false },
      { blocks: [{ type: 'paragraph',
          runs: [styleRun(att.mimeType + '\n' + humanSize(att.size))] }],
        colspan: 1, rowspan: 1, header: false },
      { blocks: [{ type: 'paragraph',
          runs: [styleRun(DISPOSITION_TEXT[disposition] +
            (att.error ? ' (' + att.error + ')' : ''))] }],
        colspan: 1, rowspan: 1, header: false }
    ]);
  });

  blocks.push({ type: 'table', rows });
  return blocks;
}
