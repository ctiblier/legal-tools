// ---------------------------------------------------------------
// Format presets
// ---------------------------------------------------------------
var FORMATS = {
    california: {
        lines: 28,
        margins: { top: 1.0, bottom: 0.75, left: 1.5, right: 0.75 },
        doubleVertical: true,
        verticalLinePositions: [1.0, 1.25]
    },
    federal: {
        lines: 25,
        margins: { top: 1.0, bottom: 1.0, left: 1.5, right: 1.0 },
        doubleVertical: false,
        verticalLinePositions: [1.0]
    },
    custom: {
        lines: 28,
        margins: { top: 1.0, bottom: 1.0, left: 1.5, right: 1.0 },
        doubleVertical: false,
        verticalLinePositions: [1.0]
    }
};

// ---------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------
initNav({
    title: 'Pleading Paper Generator',
    subtitle: 'Numbered-line paper for court filings'
});

// ---------------------------------------------------------------
// Format radio buttons — update fields when format changes
// ---------------------------------------------------------------
var formatInputs = document.querySelectorAll('input[name="format"]');
var formatLabels = {
    california: document.getElementById('label-california'),
    federal: document.getElementById('label-federal'),
    custom: document.getElementById('label-custom')
};
var marginFields = ['marginTop', 'marginBottom', 'marginLeft', 'marginRight'];

function getCurrentFormatName() {
    for (var i = 0; i < formatInputs.length; i++) {
        if (formatInputs[i].checked) return formatInputs[i].value;
    }
    return 'california';
}

function applyFormat(formatName) {
    var preset = FORMATS[formatName];
    var isCustom = formatName === 'custom';

    // Update active label styling
    var keys = Object.keys(formatLabels);
    for (var k = 0; k < keys.length; k++) {
        if (keys[k] === formatName) {
            formatLabels[keys[k]].classList.add('active');
        } else {
            formatLabels[keys[k]].classList.remove('active');
        }
    }

    // Update line count field
    var lineCountEl = document.getElementById('lineCount');
    lineCountEl.value = preset.lines;
    if (isCustom) {
        lineCountEl.removeAttribute('readonly');
        lineCountEl.classList.remove('readonly-field');
        document.getElementById('lineCountHint').textContent = 'Enter the number of lines per page (10–50).';
    } else {
        lineCountEl.setAttribute('readonly', 'readonly');
        lineCountEl.classList.add('readonly-field');
        document.getElementById('lineCountHint').textContent = 'Set by format. Change to Custom to edit.';
    }

    // Update margin fields
    var marginKeys = ['top', 'bottom', 'left', 'right'];
    var marginIds = ['marginTop', 'marginBottom', 'marginLeft', 'marginRight'];
    for (var m = 0; m < marginIds.length; m++) {
        var el = document.getElementById(marginIds[m]);
        el.value = preset.margins[marginKeys[m]];
        if (isCustom) {
            el.removeAttribute('readonly');
            el.classList.remove('readonly-field');
        } else {
            el.setAttribute('readonly', 'readonly');
            el.classList.add('readonly-field');
        }
    }
}

for (var i = 0; i < formatInputs.length; i++) {
    formatInputs[i].addEventListener('change', function() {
        applyFormat(this.value);
    });
}

// ---------------------------------------------------------------
// Collapsible caption section
// ---------------------------------------------------------------
var captionToggle = document.getElementById('captionToggle');
var captionBody = document.getElementById('captionBody');
var captionToggleIcon = captionToggle.querySelector('.collapsible-toggle');

captionToggle.addEventListener('click', function() {
    var isOpen = !captionBody.classList.contains('hidden');
    if (isOpen) {
        captionBody.classList.add('hidden');
        captionToggle.setAttribute('aria-expanded', 'false');
        captionToggleIcon.classList.remove('open');
    } else {
        captionBody.classList.remove('hidden');
        captionToggle.setAttribute('aria-expanded', 'true');
        captionToggleIcon.classList.add('open');
    }
});

// ---------------------------------------------------------------
// Helper: get current format preset (with live custom values)
// ---------------------------------------------------------------
function getCurrentFormat() {
    var name = getCurrentFormatName();
    var preset = FORMATS[name];

    if (name === 'custom') {
        var lines = parseInt(document.getElementById('lineCount').value) || 28;
        lines = Math.min(50, Math.max(10, lines));
        return {
            lines: lines,
            margins: {
                top: parseFloat(document.getElementById('marginTop').value) || 1.0,
                bottom: parseFloat(document.getElementById('marginBottom').value) || 1.0,
                left: parseFloat(document.getElementById('marginLeft').value) || 1.5,
                right: parseFloat(document.getElementById('marginRight').value) || 1.0
            },
            verticalLinePositions: [parseFloat(document.getElementById('marginLeft').value) - 0.5 || 1.0]
        };
    }

    return {
        lines: preset.lines,
        margins: {
            top: parseFloat(document.getElementById('marginTop').value) || preset.margins.top,
            bottom: parseFloat(document.getElementById('marginBottom').value) || preset.margins.bottom,
            left: parseFloat(document.getElementById('marginLeft').value) || preset.margins.left,
            right: parseFloat(document.getElementById('marginRight').value) || preset.margins.right
        },
        verticalLinePositions: preset.verticalLinePositions
    };
}

// ---------------------------------------------------------------
// Helper: get caption data
// ---------------------------------------------------------------
function getCaptionData() {
    return {
        courtName: document.getElementById('courtName').value.trim(),
        caseCaption: document.getElementById('caseCaption').value.trim(),
        caseNumber: document.getElementById('caseNumber').value.trim(),
        documentTitle: document.getElementById('documentTitle').value.trim()
    };
}

// ---------------------------------------------------------------
// Generate button
// ---------------------------------------------------------------
document.getElementById('generateBtn').addEventListener('click', generatePleading);

// ---------------------------------------------------------------
// Core generation function
// ---------------------------------------------------------------
async function generatePleading() {
    var statusEl = document.getElementById('status');
    var btn = document.getElementById('generateBtn');

    statusEl.className = 'status status-processing';
    statusEl.textContent = 'Generating pleading paper...';
    btn.disabled = true;

    try {
        var pdfDoc = await PDFLib.PDFDocument.create();
        var font = await pdfDoc.embedFont(PDFLib.StandardFonts.TimesRoman);
        var boldFont = await pdfDoc.embedFont(PDFLib.StandardFonts.TimesRomanBold);

        var format = getCurrentFormat();
        var pageCount = parseInt(document.getElementById('pageCount').value) || 1;
        pageCount = Math.min(50, Math.max(1, pageCount));

        // US Letter: 8.5" x 11" = 612 x 792 points (72 points per inch)
        var pageWidth = 612;
        var pageHeight = 792;

        // Margins in points
        var marginTop = format.margins.top * 72;
        var marginBottom = format.margins.bottom * 72;
        var marginLeft = format.margins.left * 72;
        var marginRight = format.margins.right * 72;

        // Usable area and line spacing
        var usableHeight = pageHeight - marginTop - marginBottom;
        var lineSpacing = usableHeight / format.lines;

        // Caption data (if provided)
        var caption = getCaptionData();

        for (var p = 0; p < pageCount; p++) {
            var page = pdfDoc.addPage([pageWidth, pageHeight]);

            // Draw vertical line(s) at left margin
            for (var v = 0; v < format.verticalLinePositions.length; v++) {
                var vx = format.verticalLinePositions[v] * 72;
                page.drawLine({
                    start: { x: vx, y: marginBottom },
                    end: { x: vx, y: pageHeight - marginTop },
                    thickness: 0.5,
                    color: PDFLib.rgb(0, 0, 0)
                });
            }

            // Draw line numbers
            for (var line = 1; line <= format.lines; line++) {
                var y = pageHeight - marginTop - (line * lineSpacing);

                // Line number positioned to the left of the first vertical line
                var numStr = String(line);
                var numWidth = font.widthOfTextAtSize(numStr, 10);
                var firstVLine = format.verticalLinePositions[0] * 72;
                var numX = firstVLine - numWidth - 8;

                // Clamp so numbers don't go off the left edge
                if (numX < 4) numX = 4;

                page.drawText(numStr, {
                    x: numX,
                    y: y - 3,
                    size: 10,
                    font: font,
                    color: PDFLib.rgb(0, 0, 0)
                });
            }

            // Draw caption on first page only (if provided)
            if (p === 0 && (caption.courtName || caption.documentTitle)) {
                var textAreaLeft = marginLeft;
                var textAreaWidth = pageWidth - marginLeft - marginRight;
                var captionFontSize = 12;
                var captionLineHeight = lineSpacing;
                var currentLine = 1; // which pleading line we are placing content on

                // Court name — centered, bold, uppercase
                if (caption.courtName) {
                    var courtText = caption.courtName.toUpperCase();
                    // Truncate if too wide
                    var courtWidth = boldFont.widthOfTextAtSize(courtText, captionFontSize);
                    var centerX = textAreaLeft + textAreaWidth / 2;
                    var courtX = centerX - courtWidth / 2;
                    if (courtX < textAreaLeft) courtX = textAreaLeft;

                    var courtY = pageHeight - marginTop - (currentLine * captionLineHeight) - 3;
                    page.drawText(courtText, {
                        x: courtX,
                        y: courtY,
                        size: captionFontSize,
                        font: boldFont,
                        color: PDFLib.rgb(0, 0, 0)
                    });
                    currentLine++;

                    // County/department line separator
                    var sepY = pageHeight - marginTop - (currentLine * captionLineHeight) - 3;
                    page.drawLine({
                        start: { x: textAreaLeft, y: sepY + 8 },
                        end: { x: pageWidth - marginRight, y: sepY + 8 },
                        thickness: 0.5,
                        color: PDFLib.rgb(0, 0, 0)
                    });
                    currentLine++;
                }

                // Case caption (left column) and case number (right column)
                if (caption.caseCaption || caption.caseNumber) {
                    var captionLines = caption.caseCaption ? caption.caseCaption.split('\n') : [];
                    var halfWidth = textAreaWidth / 2;

                    // Draw a vertical separator between caption and case info
                    var captionBlockStart = pageHeight - marginTop - (currentLine * captionLineHeight);
                    var captionBlockLines = Math.max(captionLines.length, 4);
                    var captionBlockEnd = pageHeight - marginTop - ((currentLine + captionBlockLines + 1) * captionLineHeight);
                    var dividerX = textAreaLeft + halfWidth;

                    page.drawLine({
                        start: { x: dividerX, y: captionBlockEnd },
                        end: { x: dividerX, y: captionBlockStart },
                        thickness: 0.5,
                        color: PDFLib.rgb(0, 0, 0)
                    });

                    // Left column: case caption
                    for (var cl = 0; cl < captionLines.length; cl++) {
                        var clText = captionLines[cl].trim();
                        if (!clText) { currentLine++; continue; }
                        var clY = pageHeight - marginTop - (currentLine * captionLineHeight) - 3;
                        page.drawText(clText, {
                            x: textAreaLeft + 4,
                            y: clY,
                            size: captionFontSize,
                            font: font,
                            color: PDFLib.rgb(0, 0, 0),
                            maxWidth: halfWidth - 8
                        });
                        currentLine++;
                    }

                    // Right column: case number and document title
                    if (caption.caseNumber) {
                        var cnLineY = pageHeight - marginTop - ((currentLine - captionLines.length + 1) * captionLineHeight) - 3;
                        page.drawText('Case No.: ' + caption.caseNumber, {
                            x: dividerX + 8,
                            y: cnLineY,
                            size: captionFontSize,
                            font: font,
                            color: PDFLib.rgb(0, 0, 0),
                            maxWidth: halfWidth - 16
                        });
                    }

                    currentLine++;
                }

                // Document title — centered, bold, uppercase
                if (caption.documentTitle) {
                    // Skip a line then draw title
                    currentLine++;
                    var titleText = caption.documentTitle.toUpperCase();
                    var titleWidth = boldFont.widthOfTextAtSize(titleText, captionFontSize);
                    var titleX = textAreaLeft + textAreaWidth / 2 - titleWidth / 2;
                    if (titleX < textAreaLeft) titleX = textAreaLeft;
                    var titleY = pageHeight - marginTop - (currentLine * captionLineHeight) - 3;
                    page.drawText(titleText, {
                        x: titleX,
                        y: titleY,
                        size: captionFontSize,
                        font: boldFont,
                        color: PDFLib.rgb(0, 0, 0),
                        maxWidth: textAreaWidth
                    });
                }
            }

            // Page number at bottom center (if multiple pages)
            if (pageCount > 1) {
                var pageNumStr = String(p + 1);
                var pageNumWidth = font.widthOfTextAtSize(pageNumStr, 10);
                page.drawText(pageNumStr, {
                    x: (pageWidth - pageNumWidth) / 2,
                    y: marginBottom / 2,
                    size: 10,
                    font: font,
                    color: PDFLib.rgb(0, 0, 0)
                });
            }
        }

        var pdfBytes = await pdfDoc.save();
        var formatName = getCurrentFormatName();
        downloadPdf(pdfBytes, 'pleading_paper_' + formatName + '.pdf');

        statusEl.className = 'status status-success';
        statusEl.textContent = pageCount + ' page' + (pageCount !== 1 ? 's' : '') + ' of ' + formatName + ' pleading paper generated and downloaded.';

    } catch (err) {
        statusEl.className = 'status status-error';
        statusEl.textContent = 'Error generating PDF: ' + err.message;
        console.error(err);
    } finally {
        btn.disabled = false;
    }
}
