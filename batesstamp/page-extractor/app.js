pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs-3.11.174/pdf.worker.min.js';

// ---------------------------------------------------------------
// State
// ---------------------------------------------------------------
var selectedFile = null;
var selectedPages = new Set(); // 0-indexed page numbers
var totalPages = 0;

// ---------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------
initNav({
    title: 'PDF Page Extractor',
    subtitle: 'Pull specific pages from any PDF'
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
    loadPdf(file);
}

// ---------------------------------------------------------------
// Load PDF and render thumbnails
// ---------------------------------------------------------------
async function loadPdf(file) {
    var statusEl = document.getElementById('status');
    statusEl.className = 'status status-processing';
    statusEl.textContent = 'Loading PDF and rendering thumbnails...';

    // Reset state
    selectedPages = new Set();
    totalPages = 0;
    document.getElementById('selectionArea').classList.add('hidden');
    document.getElementById('extractBtn').disabled = true;
    document.getElementById('pageRange').value = '';

    try {
        var arrayBuffer = await readFileAsArrayBuffer(file);

        // Load with pdf.js for thumbnail rendering
        var pdfJsDoc = await pdfjsLib.getDocument({ data: arrayBuffer.slice(0), isEvalSupported: false }).promise;
        totalPages = pdfJsDoc.numPages;

        // Render thumbnails
        var grid = document.getElementById('thumbnailGrid');
        grid.innerHTML = '';

        for (var i = 1; i <= totalPages; i++) {
            var page = await pdfJsDoc.getPage(i);
            var viewport = page.getViewport({ scale: 0.3 });

            var container = document.createElement('div');
            container.className = 'page-thumbnail';
            container.dataset.pageIndex = i - 1;
            container.setAttribute('role', 'listitem');
            container.setAttribute('aria-label', 'Page ' + i);
            container.setAttribute('tabindex', '0');

            var canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            var ctx = canvas.getContext('2d');
            await page.render({ canvasContext: ctx, viewport: viewport }).promise;

            var label = document.createElement('span');
            label.className = 'page-label';
            label.textContent = 'Page ' + i;

            container.appendChild(canvas);
            container.appendChild(label);
            container.addEventListener('click', togglePage);
            container.addEventListener('keydown', function(e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    togglePage({ currentTarget: e.currentTarget });
                }
            });
            grid.appendChild(container);
        }

        // Show selection area
        document.getElementById('selectionArea').classList.remove('hidden');
        updateSelectionCount();

        statusEl.className = 'status status-success';
        statusEl.textContent = 'PDF loaded — ' + totalPages + ' page' + (totalPages !== 1 ? 's' : '') + '. Select pages to extract.';

    } catch (err) {
        statusEl.className = 'status status-error';
        statusEl.textContent = 'Error loading PDF: ' + err.message;
    }
}

// ---------------------------------------------------------------
// Toggle page selection (thumbnail click)
// ---------------------------------------------------------------
function togglePage(e) {
    var container = e.currentTarget;
    var index = parseInt(container.dataset.pageIndex);
    if (selectedPages.has(index)) {
        selectedPages.delete(index);
        container.classList.remove('selected');
        container.setAttribute('aria-pressed', 'false');
    } else {
        selectedPages.add(index);
        container.classList.add('selected');
        container.setAttribute('aria-pressed', 'true');
    }
    updateSelectionCount();
    syncRangeInput();
}

// ---------------------------------------------------------------
// Update selection count display and extract button state
// ---------------------------------------------------------------
function updateSelectionCount() {
    document.getElementById('selectionCount').textContent =
        selectedPages.size + ' of ' + totalPages + ' pages selected';
    document.getElementById('extractBtn').disabled = selectedPages.size === 0;
}

// ---------------------------------------------------------------
// Parse page range input: "1-3, 7, 12-15" → Set of 0-indexed page numbers
// ---------------------------------------------------------------
function parsePageRange(rangeStr) {
    var result = new Set();
    var parts = rangeStr.split(',');
    for (var i = 0; i < parts.length; i++) {
        var part = parts[i].trim();
        if (!part) continue;
        var rangeParts = part.split('-');
        if (rangeParts.length === 2) {
            var start = parseInt(rangeParts[0]) - 1;
            var end = parseInt(rangeParts[1]) - 1;
            if (isNaN(start) || isNaN(end)) continue;
            for (var j = start; j <= end && j < totalPages; j++) {
                if (j >= 0) result.add(j);
            }
        } else {
            var num = parseInt(part) - 1;
            if (!isNaN(num) && num >= 0 && num < totalPages) result.add(num);
        }
    }
    return result;
}

// ---------------------------------------------------------------
// Sync range input text → selectedPages and thumbnails
// ---------------------------------------------------------------
function applyRangeInput() {
    if (!totalPages) return;
    var rangeStr = document.getElementById('pageRange').value;
    var parsed = parsePageRange(rangeStr);

    selectedPages = parsed;

    // Update thumbnail visual states
    var thumbnails = document.querySelectorAll('.page-thumbnail');
    for (var i = 0; i < thumbnails.length; i++) {
        var idx = parseInt(thumbnails[i].dataset.pageIndex);
        if (selectedPages.has(idx)) {
            thumbnails[i].classList.add('selected');
            thumbnails[i].setAttribute('aria-pressed', 'true');
        } else {
            thumbnails[i].classList.remove('selected');
            thumbnails[i].setAttribute('aria-pressed', 'false');
        }
    }
    updateSelectionCount();
}

// ---------------------------------------------------------------
// Sync selectedPages → range input text
// ---------------------------------------------------------------
function syncRangeInput() {
    if (selectedPages.size === 0) {
        document.getElementById('pageRange').value = '';
        return;
    }

    var sorted = Array.from(selectedPages).sort(function(a, b) { return a - b; });
    var parts = [];
    var rangeStart = sorted[0];
    var rangeEnd = sorted[0];

    for (var i = 1; i < sorted.length; i++) {
        if (sorted[i] === rangeEnd + 1) {
            rangeEnd = sorted[i];
        } else {
            if (rangeStart === rangeEnd) {
                parts.push(rangeStart + 1);
            } else {
                parts.push((rangeStart + 1) + '-' + (rangeEnd + 1));
            }
            rangeStart = sorted[i];
            rangeEnd = sorted[i];
        }
    }
    // Push last range
    if (rangeStart === rangeEnd) {
        parts.push(rangeStart + 1);
    } else {
        parts.push((rangeStart + 1) + '-' + (rangeEnd + 1));
    }

    document.getElementById('pageRange').value = parts.join(', ');
}

// ---------------------------------------------------------------
// Select all / deselect all
// ---------------------------------------------------------------
document.getElementById('selectAllBtn').addEventListener('click', function() {
    selectedPages = new Set();
    for (var i = 0; i < totalPages; i++) {
        selectedPages.add(i);
    }
    var thumbnails = document.querySelectorAll('.page-thumbnail');
    for (var i = 0; i < thumbnails.length; i++) {
        thumbnails[i].classList.add('selected');
        thumbnails[i].setAttribute('aria-pressed', 'true');
    }
    updateSelectionCount();
    syncRangeInput();
});

document.getElementById('deselectAllBtn').addEventListener('click', function() {
    selectedPages = new Set();
    var thumbnails = document.querySelectorAll('.page-thumbnail');
    for (var i = 0; i < thumbnails.length; i++) {
        thumbnails[i].classList.remove('selected');
        thumbnails[i].setAttribute('aria-pressed', 'false');
    }
    updateSelectionCount();
    syncRangeInput();
});

// ---------------------------------------------------------------
// Page range input — sync to thumbnails on input
// ---------------------------------------------------------------
document.getElementById('pageRange').addEventListener('input', applyRangeInput);

// ---------------------------------------------------------------
// Extract button
// ---------------------------------------------------------------
document.getElementById('extractBtn').addEventListener('click', extractPages);

// ---------------------------------------------------------------
// Extract selected pages
// ---------------------------------------------------------------
async function extractPages() {
    var statusEl = document.getElementById('status');
    var btn = document.getElementById('extractBtn');

    statusEl.className = 'status status-processing';
    statusEl.textContent = 'Extracting pages...';
    btn.disabled = true;

    try {
        var arrayBuffer = await readFileAsArrayBuffer(selectedFile);
        var srcDoc = await PDFLib.PDFDocument.load(arrayBuffer);
        var newDoc = await PDFLib.PDFDocument.create();

        var sortedPages = Array.from(selectedPages).sort(function(a, b) { return a - b; });
        var copiedPages = await newDoc.copyPages(srcDoc, sortedPages);
        for (var i = 0; i < copiedPages.length; i++) {
            newDoc.addPage(copiedPages[i]);
        }

        var pdfBytes = await newDoc.save();
        var filename = selectedFile.name.replace(/\.pdf$/i, '') + '_extracted.pdf';
        downloadPdf(pdfBytes, filename);

        // Add to session files
        if (typeof sessionFiles !== 'undefined') {
            var blob = new Blob([pdfBytes], { type: 'application/pdf' });
            sessionFiles.add(filename, blob, 'page-extractor');
        }

        statusEl.className = 'status status-success';
        statusEl.textContent = 'Extracted ' + sortedPages.length + ' page' + (sortedPages.length !== 1 ? 's' : '') + '! Your file has been downloaded.';

        // Show pipeline suggestions
        showPipelineSuggestions('page-extractor');
    } catch (err) {
        statusEl.className = 'status status-error';
        statusEl.textContent = 'Error: ' + err.message;
    } finally {
        btn.disabled = selectedPages.size === 0;
    }
}
