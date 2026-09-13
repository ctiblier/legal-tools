// EmailRecord + options -> finished PDF bytes.
//
// Order is fixed and load-bearing: header, body, manifest, appended attachments,
// header appendix, certificate. The certificate is last because it reports the
// page count, and the page count is not known until everything before it is drawn.

import { loadFontSet } from '/shared/pdf/fonts.js';
import { PageWriter } from '/shared/pdf/writer.js';
import { drawBlocks } from '/shared/pdf/draw-blocks.js';
import { THEMES } from './themes.js';
import { sanitizeHtml } from './sanitize.js';
import { htmlToBlocks } from './html-to-blocks.js';
import { textToBlocks } from './text-to-blocks.js';
import { dispositionFor, manifestBlocks } from './manifest.js';
import { certificateBlocks, rawHeaderBlocks } from './certificate.js';
import { shortHash } from './hash.js';

export const DEFAULT_OPTIONS = {
  theme: 'mail-client',
  appendAttachments: true,
  zipOtherAttachments: true,
  certificate: true,
  rawHeaderAppendix: true,
  hashes: true,
  embedSource: false
};

const EMPTY_STATS = {
  remoteImagesBlocked: 0, trackingPixelsBlocked: 0,
  activeContentRemoved: 0, unresolvedCidImages: 0
};

function styleRun(text, extra) {
  return Object.assign({
    text, bold: false, italic: false, underline: false, strike: false,
    color: null, sizeScale: 1, href: null
  }, extra || {});
}

function bodyBlocksFor(record) {
  if (record.bodyPartUsed === 'html') {
    const { body, stats } = sanitizeHtml(record.bodyHtml, record.inlineImages);
    return { blocks: htmlToBlocks(body), stats };
  }
  if (record.bodyPartUsed === 'text') {
    return { blocks: textToBlocks(record.bodyText), stats: Object.assign({}, EMPTY_STATS) };
  }
  // A message that simply had no body and a message whose body could not be
  // decoded are different facts, and saying the first when the second is true
  // would misstate the evidence. Spec §7: a lawyer must learn the message exists
  // even when its body is unreadable.
  const decodeFailure = (record.defects || [])
    .find((d) => d.code === 'BODY_DECODE_FAILED');

  if (decodeFailure) {
    return {
      blocks: [{
        type: 'paragraph',
        runs: [styleRun(
          'The body of this message could not be decoded (' + decodeFailure.detail +
          '). The headers above are reproduced from the source file and are intact.',
          { italic: true }
        )]
      }],
      stats: Object.assign({}, EMPTY_STATS)
    };
  }

  return {
    blocks: [{
      type: 'paragraph',
      runs: [styleRun('This message contained no body text.', { italic: true })]
    }],
    stats: Object.assign({}, EMPTY_STATS)
  };
}

function mergeStats(into, from) {
  for (const key of Object.keys(EMPTY_STATS)) into[key] += (from[key] || 0);
  return into;
}

/** Draw one record's header and body. Used for the message and for nested ones. */
async function drawRecord(writer, record, ctx, stats) {
  writer.theme.drawHeaderBlock(writer, record);
  const { blocks, stats: bodyStats } = bodyBlocksFor(record);
  mergeStats(stats, bodyStats);
  await drawBlocks(writer, blocks, Object.assign({}, ctx, { images: record.inlineImages }));

  for (const nested of record.nested || []) {
    writer.moveDown(writer.theme.spacing.block);
    writer.drawRule();
    writer.moveDown(6);
    await drawBlocks(writer, [{
      type: 'paragraph',
      runs: [styleRun('Forwarded message, reproduced from the attached original:',
        { italic: true, sizeScale: 0.9 })]
    }], ctx);
    // A forwarded message is indented as a unit so a reader can see at a glance
    // where the outer message ends and the quoted original begins.
    const nestedCtx = Object.assign({}, ctx, {
      indent: (ctx.indent || 0) + writer.theme.spacing.quoteIndent
    });
    await drawRecord(writer, nested, nestedCtx, stats);
  }
}

/**
 * @param {EmailRecord} record
 * @param {Object} options
 */
export async function convertEmail(record, options = {}) {
  const opts = Object.assign({}, DEFAULT_OPTIONS, options);
  const theme = THEMES[opts.theme] || THEMES['mail-client'];

  const pdfDoc = await PDFLib.PDFDocument.create();
  pdfDoc.setTitle(record.subject || '(no subject)');
  pdfDoc.setProducer('BatesStamp.com Email to PDF');
  // No author or creator: those fields would carry the reviewer's identity into
  // a document that may be produced to the other side.

  const fontSet = await loadFontSet(pdfDoc, { family: theme.family });

  const footerLeft = opts.hashes
    ? (record.sourceFilename || 'message') + ' · ' + shortHash(record.sourceSha256)
    : (record.sourceFilename || 'message');

  const writer = new PageWriter({ pdfDoc, theme, fontSet, footerLeft });
  const ctx = { indent: 0, quoteDepth: 0, images: record.inlineImages, embedCache: new Map() };
  const stats = Object.assign({}, EMPTY_STATS);

  await drawRecord(writer, record, ctx, stats);

  // Dispositions are decided before the manifest is drawn, because the manifest
  // states them and the certificate repeats them. One decision, three readers.
  const dispositions = new Map();
  for (const att of record.attachments || []) {
    dispositions.set(att.sha256, dispositionFor(att, opts));
  }

  const manifest = manifestBlocks(record, dispositions);
  if (manifest.length) {
    writer.moveDown(theme.spacing.block);
    await drawBlocks(writer, manifest, ctx);
  }

  // Appended attachments.
  const zipFiles = [];
  for (const att of record.attachments || []) {
    const disposition = dispositions.get(att.sha256);
    if (disposition !== 'appended') {
      if (opts.zipOtherAttachments && !att.error) {
        zipFiles.push({ name: att.filename, bytes: att.bytes });
      }
      continue;
    }

    if (/^application\/pdf$/i.test(att.mimeType)) {
      try {
        writer.newPage();
        await drawBlocks(writer, [
          { type: 'heading', level: 4, runs: [styleRun('Attachment: ' + att.filename)] },
          { type: 'paragraph', runs: [styleRun('SHA-256 ' + att.sha256, { sizeScale: 0.8 })] }
        ], ctx);
        const src = await PDFLib.PDFDocument.load(att.bytes, { ignoreEncryption: true });
        const pages = await pdfDoc.copyPages(src, src.getPageIndices());
        for (const page of pages) pdfDoc.addPage(page);
        // Copied pages bypass the writer's cursor, so resynchronise it.
        writer.pages = pdfDoc.getPages();
        writer.newPage();
      } catch (err) {
        dispositions.set(att.sha256, 'unreadable');
        att.error = 'could not be merged: ' + String(err && err.message || err);
        record.defects.push({
          code: 'ATTACHMENT_UNREADABLE',
          detail: att.filename + ' — ' + att.error
        });
        if (opts.zipOtherAttachments) zipFiles.push({ name: att.filename, bytes: att.bytes });
      }
      continue;
    }

    // Images become their own page.
    writer.newPage();
    await drawBlocks(writer, [
      { type: 'heading', level: 4, runs: [styleRun('Attachment: ' + att.filename)] },
      { type: 'image', alt: att.filename, widthPx: 0, heightPx: 0,
        ref: { kind: 'cid', contentId: att.contentId || att.sha256 } }
    ], Object.assign({}, ctx, {
      images: new Map([[att.contentId || att.sha256, att]])
    }));
  }

  if (opts.rawHeaderAppendix) {
    writer.newPage();
    await drawBlocks(writer, rawHeaderBlocks(record), ctx);
  }

  const generatedAtUtc = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  if (opts.certificate) {
    writer.newPage();
    // The page count includes this page, which is being written now — so count
    // the pages that exist plus nothing, and let finalize() stamp the real total.
    await drawBlocks(writer, certificateBlocks(record, {
      pageCount: writer.pageCount,
      bodyPartUsed: record.bodyPartUsed,
      sanitizeStats: stats,
      substitutions: fontSet.substitutions,
      dispositions,
      defects: record.defects,
      generatedAtUtc
    }), ctx);
  }

  if (opts.embedSource) {
    await pdfDoc.attach(record.rawBytes, record.sourceFilename || 'source.eml', {
      mimeType: 'message/rfc822',
      description: 'Original email source file, SHA-256 ' + record.sourceSha256
    });
  }

  writer.finalize();
  const bytes = await pdfDoc.save();

  // Spec §9: retaining the source bytes doubles peak memory per file. The hash is
  // computed at parse time and the certificate has already been drawn, so unless
  // the source is being embedded the reference can go before the next file in a
  // batch is read.
  if (!opts.embedSource) record.rawBytes = null;

  return {
    bytes,
    pageCount: pdfDoc.getPageCount(),
    zipFiles,
    summary: {
      pageCount: pdfDoc.getPageCount(),
      bodyPartUsed: record.bodyPartUsed,
      sanitizeStats: stats,
      substitutions: fontSet.substitutions,
      dispositions,
      defects: record.defects,
      generatedAtUtc
    }
  };
}
