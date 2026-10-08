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
        if (!natural.width || !natural.height) {
          // A decodable image with a zero dimension would make every downstream
          // measurement NaN, and a NaN cursor silently disables pagination for
          // the remainder of the document. Treat it as unrenderable instead.
          drawPlaceholder(writer, 'image could not be rendered' +
            (block.alt ? ' — ' + block.alt : ''));
          break;
        }
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

// How much of a table's column grid a cell covers: `cols` columns, and the row
// it sits in plus the `depth` rows below it. Cells carry rowspan but no
// position, so the grid only exists while the table is being laid out.
function cellFootprint(cell) {
  const cols = cell.colspan || 1;
  const rows = cell.rowspan || 1;
  return { cols: Math.max(1, cols), depth: Math.max(0, rows - 1) };
}

// Widest row of the table in columns, counting the columns held by rowspans from
// earlier rows as well as the colspans of the row's own cells: a row of two
// cells sitting under a rowspan=2 cell is three columns wide. Rowspans running
// past the last row are cut off, because no row is ever laid out against them.
function tableColumnCount(rows) {
  // Column occupancy is replayed row by row, exactly as drawRow does it, so the
  // two cannot disagree about where a column starts: the widest row, counted
  // with the columns its rowspans reserve, is the one the columns are cut to.
  let busy = []; // column -> how many more rows it is held for
  let count = 0;
  for (const row of rows) {
    const coming = [];
    let ci = 0;
    let width = 0;
    const step = () => {
      width++;
      if ((busy[ci] || 0) > 1) coming[ci] = (busy[ci] || 0) - 1;
      ci++;
    };
    for (const cell of row) {
      while ((busy[ci] || 0) > 0) step();
      const f = cellFootprint(cell);
      for (let c = 0; c < f.cols; c++) step();
      if (f.depth > 0) {
        for (let c = ci - f.cols; c < ci; c++) coming[c] = f.depth;
      }
    }
    while ((busy[ci] || 0) > 0) step();
    if (width > count) count = width;
    busy = coming;
  }
  return count;
}

async function drawTable(writer, block, ctx, x, width) {
  const t = writer.theme;
  const rows = block.rows || [];
  if (!rows.length) return;

  const columnCount = tableColumnCount(rows);
  const colWidth = width / Math.max(1, columnCount);
  const padding = 4;

  // Columns still held by rowspan when the row being drawn starts, and the same
  // for the row after it. A cell spanning N rows keeps its columns out of the
  // following N - 1.
  let occupied = [];
  let nextOccupied = [];

  const headerRow = rows[0] && rows[0].some((c) => c.header) ? rows[0] : null;

  // `repeats` marks a copy of the header row drawn on a new page. It shows the
  // headings, but it is not a row of the body's layout: it is laid out against
  // its own empty occupancy and hands nothing to the row under it, so a rowspan
  // in the header never reaches past the first page.
  async function drawRow(row, isHeader, repeats) {
    // Each cell is drawn from the same starting y; the deepest result sets the
    // row height. But a cell whose content overflows the page starts a new one,
    // and restoring a y measured on the previous page would then place the next
    // row's text on top of this row's. So track whether the page changed: if it
    // did, the row ends wherever the last cell left the cursor, and the columns
    // after the break are accepted as misaligned rather than overprinted.
    const startY = writer.y;
    const startPage = writer.pageCount;
    // How many more rows, starting with this one, each column is held for. Held
    // by a cell drawn in an earlier row, so the row now being drawn never
    // repays it: it is only ever decremented, and only as far as zero. A
    // repeated header reads none of it, and writes to a scratch table of its
    // own that is thrown away below.
    const carried = repeats ? [] : occupied;
    const inherited = repeats ? [] : nextOccupied;
    // Columns the cells of this row sit on, so their own footprint is not
    // counted against them a second time.
    const covered = [];
    let deepest = startY;
    let cx = x;
    let ci = 0;
    let brokePage = false;

    for (const cell of row) {
      // A cell from an earlier row still holds the column under this one, so
      // step over it: without that, every cell after a rowspan lands one column
      // too far left, under the wrong heading.
      while ((carried[ci] || 0) > 0) {
        cx += colWidth;
        ci++;
      }
      const f = cellFootprint(cell);
      if (f.depth > 0) {
        for (let c = 0; c < f.cols; c++) {
          // A cell spanning several columns and rows holds all of them for the
          // rows below, even columns its own row never mentions.
          covered[ci + c] = true;
          inherited[ci + c] = f.depth;
        }
      }
      if (!brokePage) writer.y = startY;
      const pageBefore = writer.pageCount;
      await drawBlocks(writer, cell.blocks, {
        ...ctx,
        indent: (cx - writer.left) + padding
      });
      if (writer.pageCount !== pageBefore) brokePage = true;
      if (!brokePage && writer.y < deepest) deepest = writer.y;
      cx += colWidth * f.cols;
      ci += f.cols;
    }

    // What the rows below inherit: the rest of every held column, except where
    // this row's own cell takes the column over from it.
    for (const c in carried) {
      if (covered[c]) continue;
      const rest = carried[c] - 1;
      if (rest > (inherited[c] || 0)) inherited[c] = rest;
    }

    // Only a row that is really drawn advances the grid. A header row repeated
    // on a new page is a copy of the table's first row, and handing its footprint
    // over would shift the body rows below it one column to the right.
    const keepsGrid = !repeats && (row !== headerRow || rows[0] === row);

    if (!brokePage && writer.pageCount === startPage) writer.y = deepest;
    writer.moveDown(2);
    writer.drawRule({ x, width, thickness: isHeader ? 0.8 : 0.3 });
    writer.moveDown(4);
    if (keepsGrid) {
      occupied = inherited;
      nextOccupied = [];
    }
  }

  for (let i = 0; i < rows.length; i++) {
    const estimate = writer.lineHeight(t.size.body) * 2 + 10;
    if (writer.y - estimate < writer.bottomLimit) {
      writer.newPage();
      // A table continuing onto a new page repeats its header row, so a reader
      // looking at page nine knows what the columns mean.
      if (headerRow && i > 0) await drawRow(headerRow, true, true);
    }
    await drawRow(rows[i], rows[i] === headerRow);
  }

  writer.moveDown(t.spacing.block);
}
