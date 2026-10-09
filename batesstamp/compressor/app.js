pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs-3.11.174/pdf.worker.min.js';

// ---------------------------------------------------------------
// State
// ---------------------------------------------------------------
var selectedFile = null;

// ---------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------
initNav({
    title: 'PDF Compressor',
    subtitle: 'Reduce PDF file size for e-filing'
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
    document.getElementById('compressBtn').disabled = false;
    document.getElementById('warningNotice').classList.remove('hidden');
    document.getElementById('status').className = 'status status-success';
    document.getElementById('status').textContent =
        'Ready — ' + formatFileSize(file.size) + '. Choose a compression level and click Compress PDF.';
    // Hide stale results
    document.getElementById('resultsSection').classList.add('hidden');
    document.getElementById('progressContainer').classList.add('hidden');
    var bar = document.getElementById('progressBar');
    bar.style.width = '0%';
}

// ---------------------------------------------------------------
// Compress button
// ---------------------------------------------------------------
document.getElementById('compressBtn').addEventListener('click', compressPdf);

// ---------------------------------------------------------------
// Helper: convert data URL to Uint8Array
// ---------------------------------------------------------------
function dataUrlToUint8Array(dataUrl) {
    var base64 = dataUrl.split(',')[1];
    var binaryString = atob(base64);
    var bytes = new Uint8Array(binaryString.length);
    for (var i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

// ---------------------------------------------------------------
// Main compression function
// ---------------------------------------------------------------
async function compressPdf() {
    var btn = document.getElementById('compressBtn');
    var statusEl = document.getElementById('status');
    var progressContainer = document.getElementById('progressContainer');
    var progressBar = document.getElementById('progressBar');
    var progressText = document.getElementById('progressText');

    var level = document.querySelector('input[name="compression"]:checked').value;
    var dpiMap    = { light: 200, medium: 150, heavy: 100 };
    var qualityMap = { light: 0.85, medium: 0.75, heavy: 0.65 };
    var targetDpi  = dpiMap[level];
    var jpegQuality = qualityMap[level];
    // pdf.js renders at 72 DPI by default; scale factor achieves the target DPI
    var scale = targetDpi / 72;

    btn.disabled = true;
    statusEl.className = 'status status-processing';
    statusEl.textContent = 'Compressing...';
    progressContainer.classList.remove('hidden');
    progressBar.style.width = '0%';
    progressText.textContent = 'Starting...';
    document.getElementById('resultsSection').classList.add('hidden');

    try {
        var arrayBuffer = await readFileAsArrayBuffer(selectedFile);
        var originalSize = arrayBuffer.byteLength;

        // Load the PDF with pdf.js for rendering
        var pdfJsDoc = await pdfjsLib.getDocument({ data: arrayBuffer, isEvalSupported: false }).promise;
        var totalPages = pdfJsDoc.numPages;

        // Build a new PDF document with pdf-lib
        var newDoc = await PDFLib.PDFDocument.create();

        for (var i = 1; i <= totalPages; i++) {
            // Update progress
            var percent = Math.round(((i - 1) / totalPages) * 100);
            progressBar.style.width = percent + '%';
            progressText.textContent = 'Compressing page ' + i + ' of ' + totalPages + '...';

            var page = await pdfJsDoc.getPage(i);

            // Original page dimensions (in PDF points at scale 1)
            var origViewport = page.getViewport({ scale: 1 });

            // High-resolution render viewport
            var renderViewport = page.getViewport({ scale: scale });

            // Render to canvas at target DPI
            var canvas = document.createElement('canvas');
            canvas.width  = Math.floor(renderViewport.width);
            canvas.height = Math.floor(renderViewport.height);
            var ctx = canvas.getContext('2d');
            await page.render({ canvasContext: ctx, viewport: renderViewport }).promise;

            // Convert canvas to JPEG bytes
            var jpegDataUrl = canvas.toDataURL('image/jpeg', jpegQuality);
            var jpegBytes = dataUrlToUint8Array(jpegDataUrl);

            // Embed JPEG into the new PDF
            var jpegImage = await newDoc.embedJpg(jpegBytes);

            // Add a page at the original dimensions (PDF points), draw the image to fill it
            var newPage = newDoc.addPage([origViewport.width, origViewport.height]);
            newPage.drawImage(jpegImage, {
                x: 0,
                y: 0,
                width: origViewport.width,
                height: origViewport.height
            });
        }

        // Finalize progress
        progressBar.style.width = '100%';
        progressText.textContent = 'Saving PDF...';

        var pdfBytes = await newDoc.save();
        var compressedSize = pdfBytes.length;

        var filename = selectedFile.name.replace(/\.pdf$/i, '') + '_compressed.pdf';
        downloadPdf(pdfBytes, filename);

        // Add to session files
        if (typeof sessionFiles !== 'undefined') {
            var blob = new Blob([pdfBytes], { type: 'application/pdf' });
            sessionFiles.add(filename, blob, 'compressor');
        }

        // Complete
        progressBar.style.width = '100%';
        progressText.textContent = 'Done!';

        statusEl.className = 'status status-success';
        statusEl.textContent = 'Compressed PDF downloaded as "' + filename + '".';

        showCompressionResults(originalSize, compressedSize);

        // Show pipeline suggestions (compressor has none, but call for consistency)
        showPipelineSuggestions('compressor');

    } catch (err) {
        statusEl.className = 'status status-error';
        statusEl.textContent = 'Error: ' + err.message;
        progressContainer.classList.add('hidden');
    } finally {
        btn.disabled = false;
    }
}

// ---------------------------------------------------------------
// Show compression result stats
// ---------------------------------------------------------------
function showCompressionResults(originalSize, compressedSize) {
    var reduction = ((1 - compressedSize / originalSize) * 100).toFixed(1);
    var reductionNum = parseFloat(reduction);

    var resultsEl = document.getElementById('compressionResults');
    resultsEl.innerHTML =
        '<div class="result-stat">' +
            '<div class="value">' + formatFileSize(originalSize) + '</div>' +
            '<div class="label">Original Size</div>' +
        '</div>' +
        '<div class="result-stat">' +
            '<div class="value">' + formatFileSize(compressedSize) + '</div>' +
            '<div class="label">Compressed Size</div>' +
        '</div>' +
        '<div class="result-stat highlight">' +
            '<div class="value">' + (reductionNum > 0 ? '-' : '') + Math.abs(reductionNum) + '%</div>' +
            '<div class="label">Size Reduction</div>' +
        '</div>';

    document.getElementById('resultsSection').classList.remove('hidden');
    document.getElementById('resultsSection').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
