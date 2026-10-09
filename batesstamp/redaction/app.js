pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs-3.11.174/pdf.worker.min.js';

// ---------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------
initNav({
    title: 'Privilege Redaction',
    subtitle: 'Permanently redact sensitive content from PDFs'
});

// ---------------------------------------------------------------
// State
// ---------------------------------------------------------------
var selectedFile = null;
var currentPage = 1;
var totalPages = 0;
var pdfJsDoc = null;
var scale = 1;         // Display scale (fit to container width)
var pageData = {};     // { pageNum: { width, height } }
var redactions = {};   // { pageNum: [{ x, y, w, h, reason }] } — PDF-space coords

// ---------------------------------------------------------------
// File drop zone
// ---------------------------------------------------------------
initFileDropZone('dropZone', {
    accept: ['.pdf'],
    onFile: handleFile
});

async function handleFile(file) {
    selectedFile = file;
    var statusEl = document.getElementById('status');

    // Reset state
    currentPage = 1;
    totalPages = 0;
    pdfJsDoc = null;
    scale = 1;
    pageData = {};
    redactions = {};

    statusEl.className = 'status status-processing';
    statusEl.textContent = 'Loading PDF...';

    // Reset UI
    document.getElementById('workspaceSection').classList.add('hidden');
    document.getElementById('warningNotice').classList.add('hidden');
    document.getElementById('redactBtn').disabled = true;
    document.getElementById('progressContainer').classList.add('hidden');
    document.getElementById('progressBar').style.width = '0%';
    document.getElementById('redactionList').innerHTML = '<p class="redaction-list-empty">No redactions yet</p>';
    document.getElementById('redactionCount').textContent = '0';

    try {
        var arrayBuffer = await readFileAsArrayBuffer(file);
        pdfJsDoc = await pdfjsLib.getDocument({ data: arrayBuffer, isEvalSupported: false }).promise;
        totalPages = pdfJsDoc.numPages;

        document.getElementById('workspaceSection').classList.remove('hidden');
        document.getElementById('warningNotice').classList.remove('hidden');

        await renderPage(currentPage);

        statusEl.className = 'status status-success';
        statusEl.textContent = 'PDF loaded — ' + totalPages + ' page' + (totalPages !== 1 ? 's' : '') + '. Draw boxes on the page to mark redactions.';
    } catch (err) {
        statusEl.className = 'status status-error';
        statusEl.textContent = 'Error loading PDF: ' + err.message;
    }
}

// ---------------------------------------------------------------
// Render page
// ---------------------------------------------------------------
async function renderPage(pageNum) {
    var page = await pdfJsDoc.getPage(pageNum);
    var origViewport = page.getViewport({ scale: 1 });

    // Scale to fit container width
    var container = document.getElementById('canvasContainer');
    var containerWidth = container.clientWidth - 4;
    scale = containerWidth / origViewport.width;
    if (scale <= 0) scale = 1; // Safeguard if container has no width yet
    var viewport = page.getViewport({ scale: scale });

    // Render PDF page onto pdfCanvas
    var pdfCanvas = document.getElementById('pdfCanvas');
    pdfCanvas.width = Math.floor(viewport.width);
    pdfCanvas.height = Math.floor(viewport.height);
    var ctx = pdfCanvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport: viewport }).promise;

    // Size the drawing overlay to match
    var drawCanvas = document.getElementById('drawCanvas');
    drawCanvas.width = Math.floor(viewport.width);
    drawCanvas.height = Math.floor(viewport.height);

    // Store page dimensions (in PDF points)
    pageData[pageNum] = { width: origViewport.width, height: origViewport.height };

    // Redraw any existing redaction boxes for this page
    drawRedactionBoxes(pageNum);

    // Update page info
    document.getElementById('pageInfo').textContent = 'Page ' + pageNum + ' of ' + totalPages;

    // Update prev/next button states
    document.getElementById('prevPage').disabled = (pageNum <= 1);
    document.getElementById('nextPage').disabled = (pageNum >= totalPages);
}

// ---------------------------------------------------------------
// Draw redaction boxes onto the overlay canvas
// ---------------------------------------------------------------
function drawRedactionBoxes(pageNum) {
    var drawCanvas = document.getElementById('drawCanvas');
    var ctx = drawCanvas.getContext('2d');
    ctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);

    var boxes = redactions[pageNum] || [];
    for (var i = 0; i < boxes.length; i++) {
        var box = boxes[i];
        // Convert PDF coords back to canvas coords
        var canvasX = box.x * scale;
        var canvasY = (pageData[pageNum].height - box.y - box.h) * scale;
        var canvasW = box.w * scale;
        var canvasH = box.h * scale;

        // Black filled rectangle
        ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
        ctx.fillRect(canvasX, canvasY, canvasW, canvasH);

        // White text label (centered in the box)
        if (canvasH >= 10 && canvasW >= 20) {
            ctx.fillStyle = 'white';
            // Size label to fit: start from height-based size, shrink to fit width
            var labelText = box.reason;
            var labelSize = Math.max(7, Math.min(canvasH * 0.4, 14));
            ctx.font = labelSize + 'px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            // Shrink font until text fits, minimum 7px
            while (labelSize > 7 && ctx.measureText(labelText).width > canvasW - 6) {
                labelSize--;
                ctx.font = labelSize + 'px sans-serif';
            }
            // Truncate only if still too wide at minimum size
            if (ctx.measureText(labelText).width > canvasW - 6) {
                while (labelText.length > 3 && ctx.measureText(labelText + '…').width > canvasW - 6) {
                    labelText = labelText.slice(0, -1);
                }
                labelText = labelText + '…';
            }
            ctx.fillText(labelText, canvasX + canvasW / 2, canvasY + canvasH / 2);
            ctx.textAlign = 'start';
            ctx.textBaseline = 'alphabetic';
        }
    }
}

// ---------------------------------------------------------------
// Drawing — mouse events
// ---------------------------------------------------------------
var isDrawing = false;
var startX = 0;
var startY = 0;

var drawCanvas = document.getElementById('drawCanvas');

function getCanvasPos(e) {
    var rect = drawCanvas.getBoundingClientRect();
    // Scale from CSS pixels to canvas pixels
    var scaleX = drawCanvas.width / rect.width;
    var scaleY = drawCanvas.height / rect.height;
    return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY
    };
}

function getTouchCanvasPos(e) {
    var touch = e.touches[0];
    return getCanvasPos(touch);
}

function onDrawStart(pos) {
    isDrawing = true;
    startX = pos.x;
    startY = pos.y;
}

function onDrawMove(pos) {
    if (!isDrawing) return;
    var ctx = drawCanvas.getContext('2d');
    ctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    drawRedactionBoxes(currentPage);

    var w = pos.x - startX;
    var h = pos.y - startY;

    // Preview box while dragging
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(startX, startY, w, h);
    ctx.strokeStyle = 'rgba(200, 0, 0, 0.8)';
    ctx.lineWidth = 2;
    ctx.strokeRect(startX, startY, w, h);
}

function onDrawEnd(pos) {
    if (!isDrawing) return;
    isDrawing = false;

    var endX = pos.x;
    var endY = pos.y;

    // Minimum size check — ignore accidental clicks
    if (Math.abs(endX - startX) < 10 || Math.abs(endY - startY) < 10) {
        drawRedactionBoxes(currentPage);
        return;
    }

    // Ensure we have page data
    if (!pageData[currentPage]) return;

    // Convert canvas coordinates to PDF space (PDF Y is bottom-up)
    var pdfX = Math.min(startX, endX) / scale;
    var pdfY = pageData[currentPage].height - (Math.max(startY, endY) / scale);
    var pdfW = Math.abs(endX - startX) / scale;
    var pdfH = Math.abs(endY - startY) / scale;

    // Get the selected reason
    var reasonSelect = document.getElementById('redactionReason');
    var reason;
    if (reasonSelect.value === 'custom') {
        reason = document.getElementById('customReason').value.trim() || 'REDACTED';
    } else {
        reason = reasonSelect.value;
    }

    // Store the redaction
    if (!redactions[currentPage]) redactions[currentPage] = [];
    redactions[currentPage].push({ x: pdfX, y: pdfY, w: pdfW, h: pdfH, reason: reason });

    drawRedactionBoxes(currentPage);
    updateRedactionList();
    updateRedactButton();
}

// Mouse events
drawCanvas.addEventListener('mousedown', function(e) {
    e.preventDefault();
    onDrawStart(getCanvasPos(e));
});
drawCanvas.addEventListener('mousemove', function(e) {
    e.preventDefault();
    onDrawMove(getCanvasPos(e));
});
drawCanvas.addEventListener('mouseup', function(e) {
    e.preventDefault();
    onDrawEnd(getCanvasPos(e));
});
drawCanvas.addEventListener('mouseleave', function(e) {
    // Cancel drawing if mouse leaves canvas mid-drag
    if (isDrawing) {
        isDrawing = false;
        drawRedactionBoxes(currentPage);
    }
});

// Touch events
drawCanvas.addEventListener('touchstart', function(e) {
    e.preventDefault();
    onDrawStart(getTouchCanvasPos(e));
}, { passive: false });
drawCanvas.addEventListener('touchmove', function(e) {
    e.preventDefault();
    onDrawMove(getTouchCanvasPos(e));
}, { passive: false });
drawCanvas.addEventListener('touchend', function(e) {
    e.preventDefault();
    // touchend has no touches[0], use changedTouches
    var touch = e.changedTouches[0];
    onDrawEnd(getCanvasPos(touch));
}, { passive: false });

// ---------------------------------------------------------------
// Custom reason show/hide
// ---------------------------------------------------------------
document.getElementById('redactionReason').addEventListener('change', function() {
    var customInput = document.getElementById('customReason');
    if (this.value === 'custom') {
        customInput.classList.remove('hidden');
        customInput.focus();
    } else {
        customInput.classList.add('hidden');
    }
});

// ---------------------------------------------------------------
// Page navigation
// ---------------------------------------------------------------
document.getElementById('prevPage').addEventListener('click', async function() {
    if (currentPage > 1) {
        currentPage--;
        await renderPage(currentPage);
    }
});

document.getElementById('nextPage').addEventListener('click', async function() {
    if (currentPage < totalPages) {
        currentPage++;
        await renderPage(currentPage);
    }
});

// ---------------------------------------------------------------
// Update redaction list sidebar
// ---------------------------------------------------------------
function updateRedactionList() {
    var listEl = document.getElementById('redactionList');
    var countEl = document.getElementById('redactionCount');

    var totalCount = 0;
    var items = [];

    // Build sorted list: all pages in order, all boxes per page in order
    var pageNums = Object.keys(redactions).map(Number).sort(function(a, b) { return a - b; });
    for (var p = 0; p < pageNums.length; p++) {
        var pageNum = pageNums[p];
        var boxes = redactions[pageNum];
        for (var b = 0; b < boxes.length; b++) {
            items.push({ pageNum: pageNum, boxIndex: b, box: boxes[b] });
            totalCount++;
        }
    }

    countEl.textContent = totalCount;

    if (totalCount === 0) {
        listEl.innerHTML = '<p class="redaction-list-empty">No redactions yet</p>';
        return;
    }

    var html = '';
    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        html += '<div class="redaction-item" role="listitem">' +
            '<div class="redaction-item-info">' +
                '<div>' + escapeHtml(item.box.reason) + '</div>' +
                '<div class="redaction-item-page">Page ' + item.pageNum + '</div>' +
            '</div>' +
            '<button type="button" ' +
                'data-page="' + item.pageNum + '" ' +
                'data-index="' + item.boxIndex + '" ' +
                'aria-label="Remove redaction on page ' + item.pageNum + '"' +
                '>&#10005;</button>' +
        '</div>';
    }
    listEl.innerHTML = html;

    // Attach delete handlers
    var deleteButtons = listEl.querySelectorAll('button');
    for (var j = 0; j < deleteButtons.length; j++) {
        deleteButtons[j].addEventListener('click', function() {
            var pageNum = parseInt(this.dataset.page);
            var boxIndex = parseInt(this.dataset.index);
            deleteRedaction(pageNum, boxIndex);
        });
    }
}

function deleteRedaction(pageNum, boxIndex) {
    if (!redactions[pageNum]) return;
    redactions[pageNum].splice(boxIndex, 1);
    if (redactions[pageNum].length === 0) {
        delete redactions[pageNum];
    }
    // Re-render the overlay if we're on that page
    if (pageNum === currentPage) {
        drawRedactionBoxes(currentPage);
    }
    updateRedactionList();
    updateRedactButton();
}

function updateRedactButton() {
    var totalCount = 0;
    var pageNums = Object.keys(redactions);
    for (var p = 0; p < pageNums.length; p++) {
        totalCount += redactions[pageNums[p]].length;
    }
    document.getElementById('redactBtn').disabled = (totalCount === 0);
}

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
// Apply redactions — rasterize-and-rebuild at 300 DPI
// ---------------------------------------------------------------
document.getElementById('redactBtn').addEventListener('click', applyRedactions);

async function applyRedactions() {
    var btn = document.getElementById('redactBtn');
    var statusEl = document.getElementById('status');
    var progressContainer = document.getElementById('progressContainer');
    var progressBar = document.getElementById('progressBar');
    var progressText = document.getElementById('progressText');

    btn.disabled = true;
    statusEl.className = 'status status-processing';
    statusEl.textContent = 'Applying redactions...';
    progressContainer.classList.remove('hidden');
    progressBar.style.width = '0%';
    progressText.textContent = 'Starting...';

    try {
        var DPI = 300;
        var renderScale = DPI / 72; // pdf.js renders at 72 DPI by default

        var newDoc = await PDFLib.PDFDocument.create();

        for (var i = 1; i <= totalPages; i++) {
            var percent = Math.round(((i - 1) / totalPages) * 90);
            progressBar.style.width = percent + '%';
            progressText.textContent = 'Rasterizing page ' + i + ' of ' + totalPages + '...';

            var page = await pdfJsDoc.getPage(i);
            var origViewport = page.getViewport({ scale: 1 });
            var renderViewport = page.getViewport({ scale: renderScale });

            // Render page at 300 DPI
            var canvas = document.createElement('canvas');
            canvas.width = Math.floor(renderViewport.width);
            canvas.height = Math.floor(renderViewport.height);
            var ctx = canvas.getContext('2d');
            await page.render({ canvasContext: ctx, viewport: renderViewport }).promise;

            // Draw redaction boxes onto the rendered page image
            var boxes = redactions[i] || [];
            for (var j = 0; j < boxes.length; j++) {
                var box = boxes[j];
                // Convert PDF coords to pixel coords at render scale
                var rx = box.x * renderScale;
                var ry = (origViewport.height - box.y - box.h) * renderScale;
                var rw = box.w * renderScale;
                var rh = box.h * renderScale;

                // Black filled rectangle — covers the content
                ctx.fillStyle = 'black';
                ctx.fillRect(rx, ry, rw, rh);

                // White label text centered in the box
                ctx.fillStyle = 'white';
                var labelText = box.reason;
                var labelSize = Math.max(8, Math.min(rh * 0.4, 20));
                ctx.font = 'bold ' + labelSize + 'px Helvetica, Arial, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';

                // Shrink font until text fits, minimum 8px
                while (labelSize > 8 && ctx.measureText(labelText).width > rw - 10) {
                    labelSize--;
                    ctx.font = 'bold ' + labelSize + 'px Helvetica, Arial, sans-serif';
                }
                // Truncate only if still too wide at minimum size
                if (ctx.measureText(labelText).width > rw - 10) {
                    while (labelText.length > 3 && ctx.measureText(labelText + '…').width > rw - 10) {
                        labelText = labelText.slice(0, -1);
                    }
                    labelText = labelText + '…';
                }
                ctx.fillText(labelText, rx + rw / 2, ry + rh / 2);
                ctx.textAlign = 'start';
                ctx.textBaseline = 'alphabetic';
            }

            // Convert to JPEG at high quality
            var jpegDataUrl = canvas.toDataURL('image/jpeg', 0.92);
            var jpegBytes = dataUrlToUint8Array(jpegDataUrl);

            // Embed in new PDF at original page dimensions (PDF points)
            var jpegImage = await newDoc.embedJpg(jpegBytes);
            var newPage = newDoc.addPage([origViewport.width, origViewport.height]);
            newPage.drawImage(jpegImage, {
                x: 0,
                y: 0,
                width: origViewport.width,
                height: origViewport.height
            });
        }

        progressBar.style.width = '95%';
        progressText.textContent = 'Saving PDF...';

        // Strip metadata from output so no identifying info leaks
        newDoc.setTitle('');
        newDoc.setAuthor('');
        newDoc.setSubject('');
        newDoc.setCreator('');
        newDoc.setProducer('');

        var pdfBytes = await newDoc.save();

        progressBar.style.width = '100%';
        progressText.textContent = 'Done!';

        var filename = selectedFile.name.replace(/\.pdf$/i, '') + '_redacted.pdf';
        downloadPdf(pdfBytes, filename);

        // Add to session files
        if (typeof sessionFiles !== 'undefined') {
            var blob = new Blob([pdfBytes], { type: 'application/pdf' });
            sessionFiles.add(filename, blob, 'redaction');
        }

        statusEl.className = 'status status-success';
        statusEl.textContent = 'Redacted PDF downloaded as "' + filename + '". Verify all redaction boxes before filing.';

        // Show pipeline suggestions
        showPipelineSuggestions('redaction');

    } catch (err) {
        statusEl.className = 'status status-error';
        statusEl.textContent = 'Error applying redactions: ' + err.message;
        progressContainer.classList.add('hidden');
    } finally {
        // Re-enable button only if there are still redactions
        updateRedactButton();
    }
}

// ---------------------------------------------------------------
// Handle window resize — re-render current page to update scale
// ---------------------------------------------------------------
var resizeTimer;
window.addEventListener('resize', function() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function() {
        if (pdfJsDoc && currentPage) {
            renderPage(currentPage);
        }
    }, 200);
});
