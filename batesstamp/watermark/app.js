// ---------------------------------------------------------------
// State
// ---------------------------------------------------------------
var selectedFile = null;

// ---------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------
initNav({
    title: 'Document Watermark',
    subtitle: 'Apply text watermarks to PDF pages'
});

// ---------------------------------------------------------------
// File drop zone
// ---------------------------------------------------------------
initFileDropZone('dropZone', {
    accept: ['.pdf'],
    onFile: handleFile
});

function handleFile(file) {
    selectedFile = file;
    document.getElementById('watermarkBtn').disabled = false;
}

// ---------------------------------------------------------------
// Preset select — show/hide custom text input
// ---------------------------------------------------------------
document.getElementById('watermarkPreset').addEventListener('change', function () {
    var customGroup = document.getElementById('customTextGroup');
    if (this.value === 'custom') {
        customGroup.classList.remove('hidden');
        document.getElementById('customText').focus();
    } else {
        customGroup.classList.add('hidden');
    }
});

// ---------------------------------------------------------------
// Opacity slider — update display
// ---------------------------------------------------------------
document.getElementById('opacity').addEventListener('input', function () {
    document.getElementById('opacityValue').textContent = this.value + '%';
    this.setAttribute('aria-valuenow', this.value);
});

// ---------------------------------------------------------------
// Watermark button
// ---------------------------------------------------------------
document.getElementById('watermarkBtn').addEventListener('click', watermarkPdf);

// ---------------------------------------------------------------
// Core watermark function
// ---------------------------------------------------------------
async function watermarkPdf() {
    var statusEl = document.getElementById('status');
    statusEl.className = 'status status-processing';
    statusEl.textContent = 'Applying watermark...';

    // Disable button during processing
    var btn = document.getElementById('watermarkBtn');
    btn.disabled = true;

    try {
        var arrayBuffer = await readFileAsArrayBuffer(selectedFile);
        var pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer);
        var font = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);
        var pages = pdfDoc.getPages();

        // Get watermark text
        var preset = document.getElementById('watermarkPreset').value;
        var text = preset === 'custom'
            ? document.getElementById('customText').value.trim()
            : preset;

        if (!text) {
            statusEl.className = 'status status-error';
            statusEl.textContent = 'Please enter a custom watermark text.';
            btn.disabled = false;
            return;
        }

        // Get settings
        var opacity = parseInt(document.getElementById('opacity').value) / 100;
        var colorName = document.getElementById('watermarkColor').value;
        var position = document.getElementById('position').value;
        var fontSizeSetting = document.getElementById('fontSize').value;

        // Color mapping
        var color;
        if (colorName === 'red') {
            color = PDFLib.rgb(0.8, 0, 0);
        } else if (colorName === 'black') {
            color = PDFLib.rgb(0, 0, 0);
        } else {
            color = PDFLib.rgb(0.5, 0.5, 0.5); // gray
        }

        for (var i = 0; i < pages.length; i++) {
            var page = pages[i];
            var pageSize = page.getSize();
            var width = pageSize.width;
            var height = pageSize.height;

            // Calculate font size
            var fontSize;
            if (fontSizeSetting === 'auto') {
                // Auto-scale: fit text diagonally across the page
                var diagonal = Math.sqrt(width * width + height * height);
                fontSize = diagonal / (text.length * 0.6);
                fontSize = Math.min(fontSize, 120); // cap at 120pt
                fontSize = Math.max(fontSize, 24);  // floor at 24pt
            } else {
                fontSize = parseInt(fontSizeSetting);
            }

            var textWidth = font.widthOfTextAtSize(text, fontSize);
            var textHeight = fontSize;

            if (position === 'diagonal') {
                // Draw diagonally across the page
                var angle = Math.atan2(height, width); // angle of the diagonal
                page.drawText(text, {
                    x: width / 2 - (textWidth / 2) * Math.cos(angle) + (textHeight / 2) * Math.sin(angle),
                    y: height / 2 - (textWidth / 2) * Math.sin(angle) - (textHeight / 2) * Math.cos(angle),
                    size: fontSize,
                    font: font,
                    color: color,
                    opacity: opacity,
                    rotate: PDFLib.degrees(Math.atan2(height, width) * (180 / Math.PI)),
                });
            } else if (position === 'center') {
                page.drawText(text, {
                    x: (width - textWidth) / 2,
                    y: (height - textHeight) / 2,
                    size: fontSize,
                    font: font,
                    color: color,
                    opacity: opacity,
                });
            } else if (position === 'header') {
                page.drawText(text, {
                    x: (width - textWidth) / 2,
                    y: height - 40 - textHeight,
                    size: fontSize,
                    font: font,
                    color: color,
                    opacity: opacity,
                });
            } else if (position === 'footer') {
                page.drawText(text, {
                    x: (width - textWidth) / 2,
                    y: 40,
                    size: fontSize,
                    font: font,
                    color: color,
                    opacity: opacity,
                });
            }
        }

        var pdfBytes = await pdfDoc.save();
        var filename = selectedFile.name.replace(/\.pdf$/i, '') + '_watermarked.pdf';
        downloadPdf(pdfBytes, filename);

        // Add to session files
        if (typeof sessionFiles !== 'undefined') {
            var blob = new Blob([pdfBytes], { type: 'application/pdf' });
            sessionFiles.add(filename, blob, 'watermark');
        }

        statusEl.className = 'status status-success';
        statusEl.textContent = 'Watermark applied! Your file has been downloaded.';

        // Show pipeline suggestions
        showPipelineSuggestions('watermark');
    } catch (err) {
        statusEl.className = 'status status-error';
        statusEl.textContent = 'Error: ' + err.message;
    } finally {
        btn.disabled = false;
    }
}
