// EmailRecord + options -> finished PDF bytes.
//
// Order is fixed and load-bearing: header, body, manifest, appended attachments,
// header appendix, certificate. The certificate is last because it reports the
// page count, and the page count is not known until everything before it is drawn.

import { loadFontSet } from '/shared/pdf/fonts.js';
import { PageWriter } from '/shared/pdf/writer.js';
import { drawBlocks } from '/shared/pdf/draw-blocks.js';
import { tokenizeRuns } from '/shared/pdf/measure.js';
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
  // The certificate's field is labelled "Pages of message content", excluding the
  // manifest, appendix and the certificate itself. Capture it here — reading
  // writer.pageCount later counts everything drawn since, which is the opposite
  // of what the label claims.
  const messageContentPages = writer.pageCount;

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
    // messageContentPages was captured before the manifest, appendix and this
    // page were drawn — the certificate's footer total (from finalize()) still
    // covers the whole document; only this field is scoped to message content.
    await drawBlocks(writer, certificateBlocks(record, {
      pageCount: messageContentPages,
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
      pageCount: messageContentPages,
      bodyPartUsed: record.bodyPartUsed,
      sanitizeStats: stats,
      substitutions: fontSet.substitutions,
      dispositions,
      defects: record.defects,
      generatedAtUtc
    }
  };
}

const TOC_TITLE = 'Contents';

function sortChronologically(records) {
  // Undated messages sort last, in the order given, rather than being dropped or
  // forced to an invented date.
  return records.slice().sort((a, b) => {
    const at = a.date.parsed ? a.date.parsed.getTime() : Infinity;
    const bt = b.date.parsed ? b.date.parsed.getTime() : Infinity;
    return at - bt;
  });
}

/**
 * @param {EmailRecord[]} records
 * @param {Object} options
 */
export async function convertBatchCombined(records, options = {}) {
  const opts = Object.assign({}, DEFAULT_OPTIONS, options);
  const theme = THEMES[opts.theme] || THEMES['mail-client'];
  const ordered = sortChronologically(records);

  const pdfDoc = await PDFLib.PDFDocument.create();
  pdfDoc.setTitle(ordered.length + ' email messages');
  pdfDoc.setProducer('BatesStamp.com Email to PDF');

  const fontSet = await loadFontSet(pdfDoc, { family: theme.family });
  const writer = new PageWriter({
    pdfDoc, theme, fontSet,
    footerLeft: ordered.length + ' messages · combined'
  });

  // Page 1 already exists and becomes the first TOC page. Two lines per entry
  // plus the heading, rounded up.
  const usable = theme.page.height - theme.page.margin.top - theme.page.margin.bottom;
  const perPage = Math.max(1, Math.floor(usable / (writer.lineHeight(theme.size.body) * 2.4)) - 2);
  // Reserve one spare page. Under-reserving is not a cosmetic error: entries that
  // run past the last reserved page would call ensure(), which appends a page at
  // the END of the document — a table of contents continuing after the exhibits.
  const tocPageCount = Math.max(1, Math.ceil(ordered.length / perPage)) + 1;
  const tocIndices = [0].concat(tocPageCount > 1 ? writer.reservePages(tocPageCount - 1) : []);

  const perEmail = [];
  const zipFiles = [];
  const allStats = Object.assign({}, EMPTY_STATS);

  for (const record of ordered) {
    writer.newPage();
    const startPage = writer.currentPageIndex + 1;
    writer.markDestination('email-' + perEmail.length);

    const ctx = { indent: 0, quoteDepth: 0, images: record.inlineImages, embedCache: new Map() };
    await drawRecord(writer, record, ctx, allStats);

    const dispositions = new Map();
    for (const att of record.attachments || []) {
      dispositions.set(att.sha256, dispositionFor(att, opts));
      if (dispositions.get(att.sha256) !== 'appended' && opts.zipOtherAttachments && !att.error) {
        zipFiles.push({ name: att.filename, bytes: att.bytes });
      }
    }

    const manifest = manifestBlocks(record, dispositions);
    if (manifest.length) {
      writer.moveDown(theme.spacing.block);
      await drawBlocks(writer, manifest, ctx);
    }

    if (opts.rawHeaderAppendix) {
      writer.newPage();
      await drawBlocks(writer, rawHeaderBlocks(record), ctx);
    }

    if (opts.certificate) {
      writer.newPage();
      await drawBlocks(writer, certificateBlocks(record, {
        pageCount: writer.pageCount,
        bodyPartUsed: record.bodyPartUsed,
        sanitizeStats: allStats,
        substitutions: fontSet.substitutions,
        dispositions,
        defects: record.defects,
        generatedAtUtc: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
      }), ctx);
    }

    perEmail.push({
      subject: record.subject || '(no subject)',
      from: record.from ? (record.from.name || record.from.address) : '(unknown sender)',
      dateRaw: record.date.raw || '(no date header)',
      sourceFilename: record.sourceFilename,
      startPage
    });
  }

  // Fill the reserved table of contents now that every start page is known.
  let tocCursor = 0;
  writer.useExistingPage(tocIndices[0]);
  await drawBlocks(writer, [
    { type: 'heading', level: 2, runs: [styleRun(TOC_TITLE)] },
    { type: 'rule' }
  ], { indent: 0, quoteDepth: 0, images: new Map(), embedCache: new Map() });

  for (let i = 0; i < perEmail.length; i++) {
    const entry = perEmail[i];
    const needed = writer.lineHeight(theme.size.body) * 2.4;
    if (writer.y - needed < writer.bottomLimit) {
      if (tocCursor + 1 < tocIndices.length) {
        tocCursor++;
        writer.useExistingPage(tocIndices[tocCursor]);
      } else {
        // Out of reserved space. Stop rather than spill the contents list to the
        // back of the document, and say so once — an incomplete list that admits
        // it is incomplete is recoverable; one that silently stops is not.
        writer.drawLine(
          tokenizeRunsForToc({ meta: 'Contents continue — ' +
            (perEmail.length - i) + ' further message(s) are not listed here.' }),
          { x: writer.left, size: theme.size.small, color: theme.color.muted }
        );
        break;
      }
    }
    const top = writer.y;
    writer.drawLine(
      tokenizeRunsForToc(entry),
      { x: writer.left, size: theme.size.body }
    );
    writer.drawLine(
      tokenizeRunsForToc({ meta: entry.from + ' · ' + entry.dateRaw }),
      { x: writer.left, size: theme.size.small, color: theme.color.muted }
    );
    writer.linkToDestination('email-' + i, {
      x: writer.left, y: writer.y, width: writer.contentWidth, height: top - writer.y
    });
    writer.moveDown(4);
  }

  writer.finalize();
  const bytes = await pdfDoc.save();
  return { bytes, pageCount: pdfDoc.getPageCount(), perEmail, zipFiles };
}

function tokenizeRunsForToc(entry) {
  const text = entry.meta != null
    ? entry.meta
    : entry.startPage + '.  ' + entry.subject;
  return tokenizeRuns([styleRun(text, entry.meta != null ? {} : { bold: true })]);
}
