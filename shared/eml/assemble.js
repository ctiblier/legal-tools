// EmailRecord + options -> finished PDF bytes.
//
// Order is fixed and load-bearing: header, body, manifest, appended attachments,
// header appendix, certificate. The certificate is last because it reports the
// page count, and the page count is not known until everything before it is drawn.

import { loadFontSet } from '/shared/pdf/fonts.js';
import { PageWriter } from '/shared/pdf/writer.js';
import { drawBlocks } from '/shared/pdf/draw-blocks.js';
import { tokenizeRuns, wrapTokens } from '/shared/pdf/measure.js';
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
    const blocks = htmlToBlocks(body);
    if (blocks.length) return { blocks, stats };

    // The HTML part was selected on truthiness but carried no renderable
    // content — structure only, or whitespace. Drawing nothing here would leave
    // a blank body under a certificate stating the body came from the HTML
    // part, and would discard a text/plain part that may hold the whole
    // message. Fall back and say so.
    if (record.bodyText && record.bodyText.trim()) {
      record.defects.push({
        code: 'BODY_PART_EMPTY',
        detail: 'the HTML part contained no renderable content; the ' +
          'plain-text part was used instead'
      });
      record.bodyPartUsed = 'text';
      return { blocks: textToBlocks(record.bodyText), stats };
    }

    record.defects.push({
      code: 'BODY_PART_EMPTY',
      detail: 'the HTML part contained no renderable content, and the message ' +
        'carried no plain-text part'
    });
    return {
      blocks: [{
        type: 'paragraph',
        runs: [styleRun('This message’s HTML body contained no renderable text.',
          { italic: true })]
      }],
      stats
    };
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
 * Merge or draw this record's attachments, and collect the rest for the ZIP.
 * Shared by convertEmail and convertBatchCombined — they diverged once, and a
 * manifest that says "appended to this PDF" while the bytes are in neither the
 * PDF nor the ZIP is the document lying about itself.
 */
async function appendAttachments(writer, pdfDoc, record, opts, dispositions, zipFiles, ctx) {
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
        // Embed each source page as a form XObject and draw it onto a page of
        // ours, rather than copying the page wholesale, so the footer can be
        // stamped without landing on content the attachment already had in its
        // bottom margin. See PageWriter#drawAttachmentPage.
        //
        // A page with no /Contents is a legitimately blank page, and embedPdf
        // refuses it ("Can't embed page with missing Contents") where copyPages
        // tolerated it. Such a page is still a page of the attachment and still
        // has to be counted, so it is reproduced as a blank one.
        const indices = src.getPageIndices();
        const hasContents = (i) => !!src.getPage(i).node.Contents();
        const drawable = indices.filter(hasContents);
        // Embed from the already-parsed document, not from the bytes: passing
        // bytes makes embedPdf run a second full PDFDocument.load() with
        // default options, which both re-decompresses the attachment and drops
        // the ignoreEncryption above — so an encrypted-but-readable PDF would
        // throw here and be demoted to the ZIP.
        const embedded = drawable.length
          ? await pdfDoc.embedPdf(src, drawable)
          : [];

        // Pages of an attachment need not be the same size, so report the
        // largest reduction rather than whichever page happened to be last.
        let scale = 1;
        let next = 0;
        for (const i of indices) {
          if (hasContents(i)) {
            scale = Math.min(scale, writer.drawAttachmentPage(
              embedded[next++], src.getPage(i).getRotation().angle));
          } else {
            writer.newPage();
          }
        }

        if (scale < 1) {
          record.defects.push({
            code: 'ATTACHMENT_SCALED',
            detail: att.filename + ' — appended pages were reduced to ' +
              Math.round(scale * 100) + '% so the page footer clears the ' +
              'original content; nothing was cropped or hidden'
          });
        }
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
  await appendAttachments(writer, pdfDoc, record, opts, dispositions, zipFiles, ctx);

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

  for (const record of ordered) {
    writer.newPage();
    const startPage = writer.currentPageIndex + 1;
    writer.markDestination('email-' + perEmail.length);

    // Every figure on a certificate must describe the message that certificate
    // is about. A single shared stats object and a document-wide page count made
    // each certificate report a running total, so a plain-text message with no
    // images inherited an earlier message's blocked trackers — a false
    // statement of fact on an authenticating document. Each record gets its own
    // stats, and the substitution total is read as a delta across this record.
    const stats = Object.assign({}, EMPTY_STATS);
    const substitutionsBefore = fontSet.substitutions;

    const ctx = { indent: 0, quoteDepth: 0, images: record.inlineImages, embedCache: new Map() };
    await drawRecord(writer, record, ctx, stats);
    // Captured before the manifest, appendix and certificate are drawn, for the
    // same reason convertEmail captures it there: the field excludes them.
    const messageContentPages = writer.pageCount - (startPage - 1);

    const dispositions = new Map();
    for (const att of record.attachments || []) {
      dispositions.set(att.sha256, dispositionFor(att, opts));
    }

    const manifest = manifestBlocks(record, dispositions);
    if (manifest.length) {
      writer.moveDown(theme.spacing.block);
      await drawBlocks(writer, manifest, ctx);
    }

    // Collect this record's ZIP entries separately and prefix them, the way the
    // per-email path does with the output PDF's stem. Pushing the bare MIME
    // filename into one shared list meant two messages attaching invoice.pdf
    // produced two identically-named entries, and the user extracted one file.
    const recordZipFiles = [];
    await appendAttachments(writer, pdfDoc, record, opts, dispositions, recordZipFiles, ctx);
    const folder = (record.sourceFilename || ('message-' + (perEmail.length + 1)))
      .replace(/\.eml$/i, '');
    for (const entry of recordZipFiles) {
      zipFiles.push({ name: folder + '/' + entry.name, bytes: entry.bytes });
    }

    if (opts.rawHeaderAppendix) {
      writer.newPage();
      await drawBlocks(writer, rawHeaderBlocks(record), ctx);
    }

    if (opts.certificate) {
      writer.newPage();
      await drawBlocks(writer, certificateBlocks(record, {
        pageCount: messageContentPages,
        bodyPartUsed: record.bodyPartUsed,
        sanitizeStats: stats,
        substitutions: fontSet.substitutions - substitutionsBefore,
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

  // Enough room for the "contents continue" notice, so admitting the list is
  // incomplete never itself needs a page the reservation did not allow for.
  const noticeHeight = writer.lineHeight(theme.size.small);

  for (let i = 0; i < perEmail.length; i++) {
    const entry = perEmail[i];
    // Measure what this entry will actually occupy. A wrapped subject is taller
    // than two lines, and assuming 2.4 lines would let the list run past the
    // last reserved page — where drawLine's own ensure() appends a page at the
    // END of the document, putting contents after the exhibits.
    const titleLines = wrapTokens(tokenizeRunsForToc(entry), writer.contentWidth,
      (t) => writer.measureToken(t, theme.size.body)).length;
    const metaLines = wrapTokens(
      tokenizeRunsForToc({ meta: entry.from + ' · ' + entry.dateRaw }),
      writer.contentWidth, (t) => writer.measureToken(t, theme.size.small)).length;
    const needed = titleLines * writer.lineHeight(theme.size.body)
      + metaLines * writer.lineHeight(theme.size.small) + 4;

    if (writer.y - needed - noticeHeight < writer.bottomLimit) {
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
    // drawLine draws every token it is handed, so each entry has to be wrapped
    // to the content width first. A long subject — the norm in litigation email
    // — otherwise ran off the right edge of the sheet with nothing to mark it.
    drawTocEntry(writer, tokenizeRunsForToc(entry), theme.size.body, null);
    drawTocEntry(writer, tokenizeRunsForToc({ meta: entry.from + ' · ' + entry.dateRaw }),
      theme.size.small, theme.color.muted);
    writer.linkToDestination('email-' + i, {
      x: writer.left, y: writer.y, width: writer.contentWidth, height: top - writer.y
    });
    writer.moveDown(4);
  }

  writer.finalize();

  // Embed each message's source alongside the exhibit. Names are made unique
  // because a PDF's embedded-file names are a flat namespace, and two messages
  // from the same mailbox export very often share a filename.
  const embeddedSources = [];
  if (opts.embedSource) {
    const taken = new Set();
    for (const record of ordered) {
      if (!record.rawBytes) continue;
      let name = record.sourceFilename || 'source.eml';
      if (taken.has(name)) {
        const stem = name.replace(/\.eml$/i, '');
        let n = 2;
        while (taken.has(stem + '-' + n + '.eml')) n++;
        name = stem + '-' + n + '.eml';
      }
      taken.add(name);
      await pdfDoc.attach(record.rawBytes, name, {
        mimeType: 'message/rfc822',
        description: 'Original email source file, SHA-256 ' + record.sourceSha256
      });
      embeddedSources.push(name);
    }
  }

  // Spec §9: release the source bytes once they are hashed, drawn and (if asked
  // for) embedded, so a large combined exhibit does not hold every message's
  // bytes at once. convertEmail does the same for the single-file path.
  for (const record of ordered) record.rawBytes = null;

  const bytes = await pdfDoc.save();
  return {
    bytes, pageCount: pdfDoc.getPageCount(), perEmail, zipFiles, embeddedSources
  };
}

/**
 * Draw one table-of-contents line, wrapped to the content width.
 *
 * drawLine is documented as taking a single already-wrapped line, so anything
 * longer than the measure has to be split before it gets there.
 */
function drawTocEntry(writer, tokens, size, color) {
  const lines = wrapTokens(tokens, writer.contentWidth,
    (t) => writer.measureToken(t, size));
  for (const line of lines) {
    writer.drawLine(line, color
      ? { x: writer.left, size, color }
      : { x: writer.left, size });
  }
}

function tokenizeRunsForToc(entry) {
  const text = entry.meta != null
    ? entry.meta
    : entry.startPage + '.  ' + entry.subject;
  return tokenizeRuns([styleRun(text, entry.meta != null ? {} : { bold: true })]);
}
