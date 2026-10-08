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

// C0 and C1 controls, and the bidi marks, embeddings and isolates that let
// "inv\u202Efdp.exe" display as "invexe.pdf". Removed outright, not replaced, so
// the real extension stays last.
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
// Device names Windows will not create a file under, with any extension.
const RESERVED_STEM = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;
// Leaves room under the common 255-byte limit for a "-N" dedupe suffix.
const MAX_NAME_BYTES = 200;

function utf8Length(text) {
  return new TextEncoder().encode(text).length;
}

/**
 * A ZIP entry name for an attachment. The filename is the sender's to choose,
 * so it may carry a path ("../../evil.txt") that a naive unzipper writes
 * outside the target directory, a device name Windows refuses, or characters
 * that disguise its extension. Keep the last path segment, make it safe on
 * every common filesystem, and deduplicate within `taken`. The manifest still
 * prints the name exactly as the email gave it.
 *
 * @param {string} name   attachment filename as parsed
 * @param {Set<string>} taken  entry names already used in this folder
 */
export function zipEntryName(name, taken) {
  let base = String(name || '').normalize('NFC').split(/[\\/]/).pop()
    .replace(INVISIBLE, '')
    .replace(/[<>:"|?*]/g, '_')
    .replace(/^[.\s]+|[.\s]+$/g, '');
  if (!base) base = 'unnamed';
  const dot = base.lastIndexOf('.');
  let stem = dot > 0 ? base.slice(0, dot) : base;
  let ext = dot > 0 ? base.slice(dot) : '';
  if (utf8Length(ext) > 20) { stem = base; ext = ''; }
  if (RESERVED_STEM.test(stem.split('.')[0])) stem = '_' + stem;
  const chars = Array.from(stem);
  while (chars.length > 1 && utf8Length(chars.join('') + ext) > MAX_NAME_BYTES) chars.pop();
  stem = chars.join('');

  let candidate = stem + ext;
  let n = 2;
  while (taken.has(candidate.toLowerCase())) {
    candidate = stem + '-' + n + ext;
    n++;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}
