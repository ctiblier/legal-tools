// Block IR -> drawing calls. The only module that knows both the IR and the page.

import { tokenizeRuns, wrapTokens } from './measure.js';

const BULLETS = ['•', '◦', '▪'];

function sizeForHeading(theme, level) {
  return theme.size['h' + Math.min(6, Math.max(1, level))] || theme.size.body;
}

function drawRuns(writer, runs, { x, width, size, color, bold }) {
  const effective = bold
    ? runs.map((r) => Object.assign({}, r, { bold: true }))
    : runs;
  const lines = wrapTokens(
    tokenizeRuns(effective), width, (t) => writer.measureToken(t, size)
  );
  for (const line of lines) writer.drawLine(line, { x, size, color });
  if (!lines.length) writer.moveDown(writer.lineHeight(size));
  return lines.length;
}

async function embedImage(writer, ref, ctx) {
  const key = ref.kind === 'cid' ? 'cid:' + ref.contentId : ref.url;
  if (ctx.embedCache.has(key)) return ctx.embedCache.get(key);

  let bytes = null;
  let mime = '';

  if (ref.kind === 'cid') {
    const att = ctx.images.get(ref.contentId);
    if (!att) return null;
    bytes = att.bytes;
    mime = att.mimeType;
  } else {
    const match = /^data:([^;,]+)[^,]*,(.*)$/i.exec(ref.url || '');
    if (!match) return null;
    mime = match[1];
    try {
      const bin = atob(match[2]);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } catch (err) {
      return null;
    }
  }

  let embedded = null;
  try {
    if (/png/i.test(mime)) embedded = await writer.pdfDoc.embedPng(bytes);
    else if (/jpe?g/i.test(mime)) embedded = await writer.pdfDoc.embedJpg(bytes);
  } catch (err) {
    embedded = null; // unsupported or corrupt; caller draws a placeholder
  }

  ctx.embedCache.set(key, embedded);
  return embedded;
}

function drawPlaceholder(writer, label) {
  const t = writer.theme;
  const height = 30;
  writer.ensure(height + 6);
  const top = writer.y;
  writer.page.drawRectangle({
    x: writer.left, y: top - height, width: Math.min(260, writer.contentWidth),
    height, borderWidth: 0.5,
    borderColor: PDFLib.rgb(t.color.rule[0], t.color.rule[1], t.color.rule[2]),
    color: PDFLib.rgb(1, 1, 1)
  });
  writer.page.drawText(label, {
    x: writer.left + 8, y: top - height / 2 - t.size.small / 2 + 1,
    size: t.size.small, font: writer.fontSet.font('italic'),
    color: PDFLib.rgb(t.color.muted[0], t.color.muted[1], t.color.muted[2])
  });
  writer.moveDown(height + 6);
}

/**
 * @param {PageWriter} writer
 * @param {Array<Object>} blocks
 * @param {{indent: number, quoteDepth: number, images: Map, embedCache: Map}} ctx
 */
export async function drawBlocks(writer, blocks, ctx) {
  const t = writer.theme;
  const x = writer.left + (ctx.indent || 0);
  const width = writer.contentWidth - (ctx.indent || 0);

  for (const block of blocks || []) {
    switch (block.type) {
      case 'paragraph':
        drawRuns(writer, block.runs, { x, width, size: t.size.body, color: t.color.text });
        writer.moveDown(t.spacing.paragraph);
        break;

      case 'heading': {
        const size = sizeForHeading(t, block.level);
        writer.ensure(writer.lineHeight(size) + t.spacing.block);
        drawRuns(writer, block.runs, { x, width, size, color: t.color.text, bold: true });
        writer.moveDown(t.spacing.paragraph);
        break;
      }

      case 'rule':
        writer.moveDown(t.spacing.paragraph);
        writer.drawRule({ x, width });
        writer.moveDown(t.spacing.block);
        break;

      case 'preformatted': {
        const lines = String(block.text).replace(/\r\n/g, '\n').split('\n');
        for (const line of lines) {
          const runs = [{ text: line || ' ', bold: false, italic: false, underline: false,
                          strike: false, color: null, sizeScale: 1, href: null, mono: true }];
          drawRuns(writer, runs, { x, width, size: t.size.mono, color: t.color.text });
        }
        writer.moveDown(t.spacing.paragraph);
        break;
      }

      case 'list': {
        let index = 1;
        for (const itemBlocks of block.items) {
          const marker = block.ordered
            ? index + '.'
            : BULLETS[Math.min(BULLETS.length - 1, ctx.quoteDepth || 0)];
          writer.ensure(writer.lineHeight(t.size.body));
          const markerY = writer.y - t.size.body;
          writer.page.drawText(marker, {
            x, y: markerY, size: t.size.body, font: writer.fontSet.font('regular'),
            color: PDFLib.rgb(t.color.text[0], t.color.text[1], t.color.text[2])
          });
          await drawBlocks(writer, itemBlocks, {
            ...ctx, indent: (ctx.indent || 0) + t.spacing.listIndent
          });
          index++;
        }
        writer.moveDown(t.spacing.paragraph);
        break;
      }

      case 'blockquote': {
        const barX = x + 2;
        const topY = writer.y;
        const startPage = writer.pageCount;
        await drawBlocks(writer, block.children, {
          ...ctx,
          indent: (ctx.indent || 0) + t.spacing.quoteIndent,
          quoteDepth: (ctx.quoteDepth || 0) + 1
        });
        // The indent rail is drawn after the children so its length is known.
        // It is only drawn when the quote did not cross a page boundary; a rail
        // spanning pages would have to be drawn per page, and a missing rail is
        // cosmetic while a misplaced one is misleading.
        if (writer.pageCount === startPage) {
          writer.page.drawLine({
            start: { x: barX, y: topY }, end: { x: barX, y: writer.y + 2 },
            thickness: 1.5,
            color: PDFLib.rgb(t.color.quoteBar[0], t.color.quoteBar[1], t.color.quoteBar[2])
          });
        }
        writer.moveDown(t.spacing.paragraph);
        break;
      }

      case 'image': {
        const embedded = await embedImage(writer, block.ref, ctx);
        if (!embedded) {
          drawPlaceholder(writer, 'image could not be rendered' +
            (block.alt ? ' — ' + block.alt : ''));
          break;
        }
        const natural = embedded.scale(1);
        const targetW = Math.min(block.widthPx || natural.width, width);
        const scale = targetW / natural.width;
        const targetH = natural.height * scale;
        // An image taller than the printable area is scaled to fit rather than
        // cropped: cropping an exhibit removes evidence.
        const maxH = writer.usableHeight;
        const finalScale = targetH > maxH ? (maxH / targetH) : 1;
        const w = targetW * finalScale;
        const h = targetH * finalScale;
        writer.ensure(h + 6);
        writer.page.drawImage(embedded, { x, y: writer.y - h, width: w, height: h });
        writer.moveDown(h + t.spacing.paragraph);
        break;
      }

      case 'blockedImage':
        drawPlaceholder(
          writer,
          block.reason === 'cid-not-found'
            ? 'embedded image missing from message' + (block.alt ? ' — ' + block.alt : '')
            : 'remote image not loaded' + (block.alt ? ' — ' + block.alt : '')
        );
        break;

      case 'table':
        await drawTable(writer, block, ctx, x, width);
        break;

      default:
        break; // unknown block types are skipped rather than throwing
    }
  }
}

async function drawTable(writer, block, ctx, x, width) {
  const t = writer.theme;
  const rows = block.rows || [];
  if (!rows.length) return;

  const columnCount = Math.max(...rows.map((r) =>
    r.reduce((sum, c) => sum + (c.colspan || 1), 0)));
  const colWidth = width / Math.max(1, columnCount);
  const padding = 4;

  const headerRow = rows[0] && rows[0].some((c) => c.header) ? rows[0] : null;

  async function drawRow(row, isHeader) {
    // Each cell is drawn from the same starting y; the deepest result sets the
    // row height. But a cell whose content overflows the page starts a new one,
    // and restoring a y measured on the previous page would then place the next
    // row's text on top of this row's. So track whether the page changed: if it
    // did, the row ends wherever the last cell left the cursor, and the columns
    // after the break are accepted as misaligned rather than overprinted.
    const startY = writer.y;
    const startPage = writer.pageCount;
    let deepest = startY;
    let cx = x;
    let brokePage = false;

    for (const cell of row) {
      const span = cell.colspan || 1;
      if (!brokePage) writer.y = startY;
      const pageBefore = writer.pageCount;
      await drawBlocks(writer, cell.blocks, {
        ...ctx,
        indent: (cx - writer.left) + padding
      });
      if (writer.pageCount !== pageBefore) brokePage = true;
      if (!brokePage && writer.y < deepest) deepest = writer.y;
      cx += colWidth * span;
    }

    if (!brokePage && writer.pageCount === startPage) writer.y = deepest;
    writer.moveDown(2);
    writer.drawRule({ x, width, thickness: isHeader ? 0.8 : 0.3 });
    writer.moveDown(4);
  }

  for (let i = 0; i < rows.length; i++) {
    const estimate = writer.lineHeight(t.size.body) * 2 + 10;
    if (writer.y - estimate < writer.bottomLimit) {
      writer.newPage();
      // A table continuing onto a new page repeats its header row, so a reader
      // looking at page nine knows what the columns mean.
      if (headerRow && i > 0) await drawRow(headerRow, true);
    }
    await drawRow(rows[i], rows[i] === headerRow);
  }

  writer.moveDown(t.spacing.block);
}
