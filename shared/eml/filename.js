// shared/eml/filename.js
// Output filenames: sortable by date, recognisable by subject, safe everywhere.

function sanitizeSegment(text) {
  return String(text)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function isoDate(record) {
  const d = record.date && record.date.parsed;
  if (!d) return 'undated';
  // Uses the parsed date purely to sort and name the file. The date *shown* in
  // the document is always the raw header — see themes.js.
  const pad = (n) => String(n).padStart(2, '0');
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
}

/**
 * @param {EmailRecord} record
 * @param {Set<string>} taken  filenames already used in this batch
 */
export function outputFilename(record, taken) {
  const subject = sanitizeSegment(record.subject || '') || 'no-subject';
  const base = isoDate(record) + '_' + subject;
  let candidate = base + '.pdf';
  let n = 2;
  while (taken.has(candidate)) {
    candidate = base + '-' + n + '.pdf';
    n++;
  }
  taken.add(candidate);
  return candidate;
}

/**
 * A ZIP entry name for an attachment. The filename is the sender's to choose,
 * so it may carry a path ("../../evil.txt") that a naive unzipper writes
 * outside the target directory. Keep the last path segment, drop characters no
 * filesystem accepts, and deduplicate within one message. The manifest still
 * prints the name exactly as the email gave it.
 *
 * @param {string} name   attachment filename as parsed
 * @param {Set<string>} taken  entry names already used for this message
 */
export function zipEntryName(name, taken) {
  let base = String(name || '').split(/[\\/]/).pop()
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_')
    .replace(/^[.\s]+|[.\s]+$/g, '');
  if (!base) base = 'unnamed';
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : '';
  let candidate = base;
  let n = 2;
  while (taken.has(candidate.toLowerCase())) {
    candidate = stem + '-' + n + ext;
    n++;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}
