// postal-mime wrapper producing the EmailRecord shape the rest of the pipeline
// consumes. Swapping in a .msg parser later means writing a module that returns
// this same shape; nothing downstream changes.

import PostalMime from '/vendor/postal-mime/postal-mime.js';
import { sha256Hex } from './hash.js';
import { extractRawHeaderBlock, unfoldHeaders, rawHeaderValue, MAX_HEADER_SCAN } from './headers.js';

const MAX_NEST_DEPTH = 5;

function toAddressList(value) {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return list
    .filter((a) => a && (a.address || a.name))
    .map((a) => ({ name: a.name || '', address: a.address || '' }));
}

function bareContentId(cid) {
  if (!cid) return null;
  return cid.replace(/^</, '').replace(/>$/, '');
}

function toBytes(content) {
  if (content instanceof Uint8Array) return content;
  if (content instanceof ArrayBuffer) return new Uint8Array(content);
  // postal-mime may hand back a base64 string depending on part encoding.
  if (typeof content === 'string') {
    const bin = atob(content);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(0);
}

/**
 * @param {Uint8Array} bytes
 * @param {{depth?: number, filename?: string}} [opts]
 * @returns {Promise<EmailRecord>}
 */
export async function parseEml(bytes, opts = {}) {
  const depth = opts.depth || 0;
  const sourceFilename = opts.filename || '';
  const defects = [];

  const rawHeaderBlock = extractRawHeaderBlock(bytes);
  if (rawHeaderBlock.length >= MAX_HEADER_SCAN) {
    defects.push({
      code: 'HEADER_BLOCK_TRUNCATED',
      detail: 'No blank line separating headers from body within ' +
              MAX_HEADER_SCAN + ' bytes; the header appendix is incomplete.'
    });
  }
  const rawHeaders = unfoldHeaders(rawHeaderBlock);
  if (rawHeaders.length === 0) {
    // Not a partial: a file with no parseable headers is not an email, and
    // producing a PDF for it would assert something untrue about its contents.
    throw new Error('No email headers found — this does not appear to be a .eml file');
  }

  let parsed;
  try {
    parsed = await new PostalMime().parse(bytes);
  } catch (err) {
    defects.push({ code: 'BODY_DECODE_FAILED', detail: String(err && err.message || err) });
    parsed = { headers: [], attachments: [], html: null, text: null };
  }

  const attachments = [];
  const inlineImages = new Map();
  const nested = [];

  for (const att of parsed.attachments || []) {
    let attBytes;
    try {
      attBytes = toBytes(att.content);
    } catch (err) {
      defects.push({
        code: 'ATTACHMENT_UNREADABLE',
        detail: (att.filename || 'unnamed attachment') + ': ' + String(err && err.message || err)
      });
      continue;
    }

    const mimeType = att.mimeType || 'application/octet-stream';

    if (mimeType === 'message/rfc822') {
      if (depth >= MAX_NEST_DEPTH) {
        defects.push({
          code: 'NEST_DEPTH_EXCEEDED',
          detail: 'stopped at ' + MAX_NEST_DEPTH + ' levels of forwarded messages'
        });
      } else {
        try {
          nested.push(await parseEml(attBytes, {
            depth: depth + 1,
            filename: att.filename || 'forwarded-message.eml'
          }));
          continue; // rendered as a nested record, not listed as a file attachment
        } catch (err) {
          defects.push({
            code: 'NESTED_PARSE_FAILED',
            detail: String(err && err.message || err)
          });
        }
      }
    }

    const record = {
      filename: att.filename || 'unnamed',
      mimeType,
      size: attBytes.length,
      bytes: attBytes,
      contentId: bareContentId(att.contentId),
      disposition: att.disposition === 'inline' ? 'inline' : 'attachment',
      sha256: await sha256Hex(attBytes)
    };
    attachments.push(record);
    if (record.contentId) inlineImages.set(record.contentId, record);
  }

  const bodyHtml = parsed.html || null;
  const bodyText = parsed.text || null;
  const bodyPartUsed = bodyHtml ? 'html' : (bodyText && bodyText.trim() ? 'text' : 'none');

  const rawDate = rawHeaderValue(rawHeaderBlock, 'Date');
  let parsedDate = null;
  if (rawDate) {
    const d = new Date(rawDate);
    parsedDate = isNaN(d.getTime()) ? null : d;
  }

  return {
    rawBytes: bytes,
    sourceFilename,
    sourceSha256: await sha256Hex(bytes),
    rawHeaderBlock,
    rawHeaders,
    from: toAddressList(parsed.from)[0] || null,
    to: toAddressList(parsed.to),
    cc: toAddressList(parsed.cc),
    bcc: toAddressList(parsed.bcc),
    // The raw string is what renders. parsedDate exists only for sorting a batch
    // into chronological order and must never reach the page — converting to the
    // reviewer's local zone would silently alter the exhibit.
    date: { raw: rawDate, parsed: parsedDate },
    subject: parsed.subject || '',
    messageId: rawHeaderValue(rawHeaderBlock, 'Message-ID'),
    bodyHtml,
    bodyText,
    bodyPartUsed,
    attachments,
    inlineImages,
    nested,
    defects
  };
}
