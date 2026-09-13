// Three presentations of the same content. A theme owns the type system, the
// colour set, and the header block; it owns nothing structural, so the manifest,
// appendix and certificate look the same in all three.

import { tokenizeRuns, wrapTokens } from '/shared/pdf/measure.js';

const LETTER = { width: 612, height: 792 };

function run(text, extra) {
  return Object.assign({
    text, bold: false, italic: false, underline: false, strike: false,
    color: null, sizeScale: 1, href: null
  }, extra || {});
}

function addressLine(list) {
  return (list || [])
    .map((a) => (a.name ? a.name + ' <' + a.address + '>' : a.address))
    .join(', ');
}

/** Wrap and draw a single logical line of runs, paginating if it is long. */
function drawWrapped(writer, runs, { x, size, color, indent }) {
  const startX = x != null ? x : writer.left;
  const width = writer.contentWidth - (startX - writer.left) - (indent || 0);
  const tokens = tokenizeRuns(runs);
  const lines = wrapTokens(tokens, width, (t) => writer.measureToken(t, size));
  for (const line of lines) {
    writer.drawLine(line, { x: startX, size, color });
  }
  if (!lines.length) writer.moveDown(writer.lineHeight(size));
}

/** Height drawWrapped will consume for these runs, without drawing anything. */
function measureWrapped(writer, runs, { x, size, indent }) {
  const startX = x != null ? x : writer.left;
  const width = writer.contentWidth - (startX - writer.left) - (indent || 0);
  const lines = wrapTokens(tokenizeRuns(runs), width, (t) => writer.measureToken(t, size));
  return Math.max(1, lines.length) * writer.lineHeight(size);
}

// ---------------------------------------------------------------------------
// mail-client — echoes how the message looked on screen
// ---------------------------------------------------------------------------

function drawMailClientHeader(writer, record) {
  const t = writer.theme;
  const bandLeft = t.page.margin.left - 12;
  const bandWidth = writer.contentWidth + 24;

  const subject = record.subject || '(no subject)';
  const fromName = record.from ? (record.from.name || record.from.address) : '(unknown sender)';
  const fromAddr = record.from ? record.from.address : '';
  const toLine = 'to ' + (addressLine(record.to) || '(undisclosed recipients)');
  const ccLine = record.cc.length ? 'cc ' + addressLine(record.cc) : null;

  // The band has to be painted before the text, so its height cannot be a
  // guess: build the field list once, measure it with the same width math
  // drawWrapped uses, then draw the same runs — measurement and drawing can
  // never drift apart because they share one list.
  const lines = [];
  lines.push({ runs: [run(subject, { bold: true })], size: t.size.h2, color: t.color.bandText });
  lines.push({ runs: [run(fromName, { bold: true })], size: t.size.body, color: t.color.bandText });
  if (fromAddr && fromAddr !== fromName) {
    lines.push({ runs: [run(fromAddr)], size: t.size.small, color: t.color.muted });
  }
  lines.push({ runs: [run(toLine)], size: t.size.small, color: t.color.muted });
  if (ccLine) lines.push({ runs: [run(ccLine)], size: t.size.small, color: t.color.muted });
  // The date prints exactly as received, offset intact — never localised.
  lines.push({ runs: [run(record.date.raw || '(no date header)')],
               size: t.size.small, color: t.color.muted });

  const PAD_TOP = 10;
  const PAD_BOTTOM = 12;
  const bandHeight = PAD_TOP + PAD_BOTTOM +
    lines.reduce((sum, l) => sum + measureWrapped(writer, l.runs, { size: l.size }), 0);

  writer.ensure(bandHeight + 20);
  writer.drawRect({
    x: bandLeft, y: writer.y + 14 - bandHeight, width: bandWidth, height: bandHeight,
    color: t.color.band
  });

  writer.moveDown(PAD_TOP - 6);
  for (const l of lines) drawWrapped(writer, l.runs, { size: l.size, color: l.color });
  writer.moveDown(16);
}

// ---------------------------------------------------------------------------
// exhibit — formal, ruled, photocopies cleanly
// ---------------------------------------------------------------------------

function drawExhibitHeader(writer, record) {
  const t = writer.theme;
  writer.ensure(150);

  drawWrapped(writer, [run('ELECTRONIC MAIL RECORD', { bold: true })],
    { size: t.size.h3, color: t.color.text });
  writer.moveDown(6);
  writer.drawRule({ thickness: 1 });
  writer.moveDown(10);

  const fields = [
    ['FROM', record.from ? addressLine([record.from]) : '(unknown sender)'],
    ['TO', addressLine(record.to) || '(undisclosed recipients)']
  ];
  if (record.cc.length) fields.push(['CC', addressLine(record.cc)]);
  if (record.bcc.length) fields.push(['BCC', addressLine(record.bcc)]);
  fields.push(['DATE', record.date.raw || '(no date header)']);
  fields.push(['SUBJECT', record.subject || '(no subject)']);
  if (record.messageId) fields.push(['MESSAGE-ID', record.messageId]);

  const labelWidth = 78;
  for (const [label, value] of fields) {
    // Reserve one line so the label and the value's first line cannot end up
    // on different pages, then draw the label BEFORE the value. Drawing the
    // label does not move the cursor, so they still align — and there is no
    // window in which the value's own pagination can invalidate the label's
    // page or y (drawWrapped can call ensure()/newPage() internally, which
    // reassigns writer.page and resets writer.y).
    writer.ensure(writer.lineHeight(t.size.body));
    writer.page.drawText(label, {
      x: writer.left,
      y: writer.y - t.size.body,
      size: t.size.small,
      font: writer.fontSet.font('bold'),
      color: PDFLib.rgb(t.color.muted[0], t.color.muted[1], t.color.muted[2])
    });
    drawWrapped(writer, [run(value)],
      { x: writer.left + labelWidth, size: t.size.body, color: t.color.text });
    writer.moveDown(3);
    writer.drawRule({ color: t.color.rule, thickness: 0.4 });
    writer.moveDown(7);
  }
  writer.moveDown(8);
}

// ---------------------------------------------------------------------------
// minimal — typography and whitespace only
// ---------------------------------------------------------------------------

function drawMinimalHeader(writer, record) {
  const t = writer.theme;
  writer.ensure(130);

  const fields = [
    ['from', record.from ? addressLine([record.from]) : '(unknown sender)'],
    ['to', addressLine(record.to) || '(undisclosed recipients)']
  ];
  if (record.cc.length) fields.push(['cc', addressLine(record.cc)]);
  fields.push(['date', record.date.raw || '(no date header)']);

  const labelWidth = 52;
  for (const [label, value] of fields) {
    // Same inversion as the exhibit theme: reserve a line, draw the label
    // first at a known-good position, then draw the value (which may paginate
    // on its own via drawWrapped/drawLine and move to a new page).
    writer.ensure(writer.lineHeight(t.size.body));
    writer.page.drawText(label, {
      x: writer.left,
      y: writer.y - t.size.body,
      size: t.size.small,
      font: writer.fontSet.font('regular'),
      color: PDFLib.rgb(t.color.muted[0], t.color.muted[1], t.color.muted[2])
    });
    drawWrapped(writer, [run(value)],
      { x: writer.left + labelWidth, size: t.size.body, color: t.color.text });
    writer.moveDown(5);
  }

  writer.moveDown(12);
  drawWrapped(writer, [run(record.subject || '(no subject)', { bold: true })],
    { size: t.size.h3, color: t.color.text });
  writer.moveDown(4);
  writer.drawRule({ width: writer.contentWidth * 0.35 });
  writer.moveDown(16);
}

export const THEMES = {
  'mail-client': {
    id: 'mail-client',
    name: 'Mail client',
    description: 'Reads like the message did on screen',
    family: 'sans',
    page: { ...LETTER, margin: { top: 54, right: 54, bottom: 64, left: 54 } },
    size: { body: 10.5, small: 8.5, footer: 7.5, mono: 8,
            h1: 17, h2: 15, h3: 13, h4: 12, h5: 11, h6: 10.5 },
    leading: 1.38,
    color: {
      text: [0.10, 0.10, 0.12], muted: [0.42, 0.44, 0.48], rule: [0.85, 0.86, 0.88],
      quoteBar: [0.78, 0.80, 0.84], link: [0.11, 0.29, 0.55],
      band: [0.96, 0.97, 0.98], bandText: [0.12, 0.16, 0.24]
    },
    spacing: { paragraph: 6, block: 10, listIndent: 18, quoteIndent: 14, quoteBarGap: 8 },
    drawHeaderBlock: drawMailClientHeader
  },

  exhibit: {
    id: 'exhibit',
    name: 'Court exhibit',
    description: 'Formal, ruled, photocopies cleanly',
    family: 'serif',
    page: { ...LETTER, margin: { top: 64, right: 68, bottom: 70, left: 68 } },
    size: { body: 10.5, small: 8, footer: 7.5, mono: 8,
            h1: 16, h2: 14, h3: 12.5, h4: 11.5, h5: 11, h6: 10.5 },
    leading: 1.45,
    color: {
      text: [0.07, 0.07, 0.09], muted: [0.38, 0.40, 0.44], rule: [0.55, 0.57, 0.60],
      quoteBar: [0.62, 0.64, 0.68], link: [0.10, 0.22, 0.42],
      band: [1, 1, 1], bandText: [0.07, 0.07, 0.09]
    },
    spacing: { paragraph: 7, block: 12, listIndent: 20, quoteIndent: 16, quoteBarGap: 9 },
    drawHeaderBlock: drawExhibitHeader
  },

  minimal: {
    id: 'minimal',
    name: 'Minimal',
    description: 'Typography and whitespace, no rules or bands',
    family: 'sans',
    page: { ...LETTER, margin: { top: 72, right: 80, bottom: 72, left: 80 } },
    size: { body: 10, small: 8, footer: 7, mono: 8,
            h1: 16, h2: 14, h3: 12, h4: 11, h5: 10.5, h6: 10 },
    leading: 1.5,
    color: {
      text: [0.13, 0.13, 0.14], muted: [0.55, 0.56, 0.58], rule: [0.80, 0.81, 0.83],
      quoteBar: [0.84, 0.85, 0.87], link: [0.20, 0.30, 0.45],
      band: [1, 1, 1], bandText: [0.13, 0.13, 0.14]
    },
    spacing: { paragraph: 8, block: 14, listIndent: 20, quoteIndent: 18, quoteBarGap: 10 },
    drawHeaderBlock: drawMinimalHeader
  }
};

export const THEME_ORDER = ['mail-client', 'exhibit', 'minimal'];
