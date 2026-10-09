// ---------------------------------------------------------------
// State
// ---------------------------------------------------------------
var mainDoc = null;   // { file: File, pages: number }
var exhibits = [];    // [{ file: File, pages: number, label: String, size: number }]

// ---------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------
initNav({
    title: 'Filing Assembler',
    subtitle: 'Combine motion, exhibits, and slip sheets into one filing'
});

// ---------------------------------------------------------------
// Main document drop zone
// ---------------------------------------------------------------
initFileDropZone('mainDocZone', {
    accept: ['.pdf', '.jpg', '.jpeg', '.png'],
    onFile: handleMainDoc
});

async function handleMainDoc(file) {
    var pages = 1;
    if (file.type === 'application/pdf') {
        try {
            var ab = await readFileAsArrayBuffer(file);
            var doc = await PDFLib.PDFDocument.load(ab);
            pages = doc.getPageCount();
        } catch (e) {
            pages = 1;
        }
    }
    mainDoc = { file: file, pages: pages };
    updateSummary();
    updateAssembleButton();
}

// ---------------------------------------------------------------
// Exhibit drop zone (multi-file, custom handling)
// ---------------------------------------------------------------
initFileDropZone('exhibitZone', {
    accept: ['.pdf', '.jpg', '.jpeg', '.png'],
    multiple: true,
    onFiles: function(files) {
        addExhibits(files);
    }
});

// ---------------------------------------------------------------
// SortableJS for drag-to-reorder
// ---------------------------------------------------------------
var sortable = new Sortable(document.getElementById('exhibitList'), {
    handle: '.drag-handle',
    animation: 150,
    ghostClass: 'exhibit-ghost',
    filter: '#emptyMessage',
    onEnd: function() {
        // Rebuild exhibits array to match new DOM order
        var list = document.getElementById('exhibitList');
        var items = list.querySelectorAll('.exhibit-item');
        var reordered = [];
        for (var i = 0; i < items.length; i++) {
            var idx = parseInt(items[i].getAttribute('data-index'), 10);
            reordered.push(exhibits[idx]);
        }
        exhibits = reordered;
        updateExhibitLabels(); // re-letter A/B/C to match the new order
        renderExhibitList();
        updateSummary();
    }
});

// ---------------------------------------------------------------
// Label format change
// ---------------------------------------------------------------
document.getElementById('labelFormat').addEventListener('change', function() {
    var customGroup = document.getElementById('customPrefixGroup');
    if (this.value === 'custom') {
        customGroup.classList.remove('hidden');
    } else {
        customGroup.classList.add('hidden');
    }
    updateExhibitLabels();
    renderExhibitList();
    updateSummary();
});

document.getElementById('customPrefix').addEventListener('input', function() {
    updateExhibitLabels();
    renderExhibitList();
});

// ---------------------------------------------------------------
// Label generation
// ---------------------------------------------------------------
function indexToAlpha(index) {
    var result = '';
    var n = index;
    do {
        result = String.fromCharCode(65 + (n % 26)) + result;
        n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return result;
}

function getLabel(index) {
    var format = document.getElementById('labelFormat').value;
    if (format === 'alpha') return 'Exhibit ' + indexToAlpha(index);
    if (format === 'numeric') return 'Exhibit ' + (index + 1);
    if (format === 'plaintiff-alpha') return "Plaintiff's Exhibit " + indexToAlpha(index);
    if (format === 'defendant-alpha') return "Defendant's Exhibit " + indexToAlpha(index);
    if (format === 'custom') {
        var prefix = document.getElementById('customPrefix').value.trim() || 'Exhibit';
        return prefix + ' ' + indexToAlpha(index);
    }
    return 'Exhibit ' + indexToAlpha(index);
}

function updateExhibitLabels() {
    for (var i = 0; i < exhibits.length; i++) {
        exhibits[i].label = getLabel(i);
    }
}

// ---------------------------------------------------------------
// Add exhibits
// ---------------------------------------------------------------
async function addExhibits(files) {
    for (var i = 0; i < files.length; i++) {
        var file = files[i];
        var pages = 1;

        if (file.type === 'application/pdf') {
            try {
                var ab = await readFileAsArrayBuffer(file);
                var doc = await PDFLib.PDFDocument.load(ab);
                pages = doc.getPageCount();
            } catch (e) {
                pages = 1;
            }
        }

        exhibits.push({
            file: file,
            pages: pages,
            label: getLabel(exhibits.length),
            size: file.size
        });
    }
    renderExhibitList();
    updateSummary();
    updateAssembleButton();
}

// ---------------------------------------------------------------
// Render exhibit list
// ---------------------------------------------------------------
var PDF_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
var IMG_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
var X_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
var GRIP_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>';

function renderExhibitList() {
    var list = document.getElementById('exhibitList');
    var emptyMsg = document.getElementById('emptyMessage');
    var tableWrap = document.getElementById('exhibitTableWrap');

    // Clear existing rows
    list.innerHTML = '';

    if (exhibits.length === 0) {
        emptyMsg.style.display = '';
        tableWrap.classList.add('hidden');
        return;
    }

    emptyMsg.style.display = 'none';
    tableWrap.classList.remove('hidden');
    document.getElementById('exhibitCaptionSub').textContent =
        exhibits.length + ' exhibit' + (exhibits.length === 1 ? '' : 's') + ' — drag to reorder';

    for (var i = 0; i < exhibits.length; i++) {
        var exhibit = exhibits[i];
        var isImage = exhibit.file.type !== 'application/pdf';
        var pageWord = exhibit.pages === 1 ? 'page' : 'pages';

        var row = document.createElement('tr');
        row.className = 'exhibit-item';
        row.setAttribute('data-index', i);
        row.setAttribute('role', 'listitem');

        row.innerHTML =
            '<td class="exhibit-col-drag"><span class="drag-handle" aria-hidden="true">' + GRIP_ICON + '</span></td>' +
            '<td class="exhibit-col-label">' +
                '<input type="text" class="exhibit-label" value="' + escapeAttr(exhibit.label) + '" ' +
                    'aria-label="Label for ' + escapeAttr(exhibit.file.name) + '"></td>' +
            '<td class="file-col-name">' +
                '<span class="file-col-icon">' + (isImage ? IMG_ICON : PDF_ICON) + '</span>' +
                '<span class="file-col-filename" title="' + escapeAttr(exhibit.file.name) + '">' + escapeHtml(exhibit.file.name) + '</span></td>' +
            '<td class="file-col-num">' + exhibit.pages + ' ' + pageWord + '</td>' +
            '<td class="exhibit-col-action">' +
                '<button type="button" class="file-row-remove" aria-label="Remove ' + escapeAttr(exhibit.label) + '" data-idx="' + i + '">' + X_ICON + '</button></td>';

        list.appendChild(row);
    }

    // Attach label change listeners
    var inputs = list.querySelectorAll('.exhibit-label');
    for (var j = 0; j < inputs.length; j++) {
        (function(input, idx) {
            input.addEventListener('change', function() {
                exhibits[idx].label = this.value;
            });
        })(inputs[j], j);
    }

    // Attach remove button listeners
    var removeBtns = list.querySelectorAll('.file-row-remove');
    for (var k = 0; k < removeBtns.length; k++) {
        (function(btn) {
            btn.addEventListener('click', function() {
                var removeIdx = parseInt(this.getAttribute('data-idx'), 10);
                exhibits.splice(removeIdx, 1);
                updateExhibitLabels();
                renderExhibitList();
                updateSummary();
                updateAssembleButton();
            });
        })(removeBtns[k]);
    }
}

// ---------------------------------------------------------------
// Summary
// ---------------------------------------------------------------
function updateSummary() {
    var totalPgs = 0;
    var totalBytes = 0;

    if (mainDoc) {
        totalPgs += mainDoc.pages;
        totalBytes += mainDoc.file.size;
    }

    // Each exhibit: 1 slip sheet page + exhibit pages
    for (var i = 0; i < exhibits.length; i++) {
        totalPgs += 1 + exhibits[i].pages; // slip sheet + exhibit
        totalBytes += exhibits[i].size;
    }

    document.getElementById('exhibitCount').textContent = exhibits.length;
    document.getElementById('totalPages').textContent = totalPgs;
    document.getElementById('totalSize').textContent = formatFileSize(totalBytes);
}

function updateAssembleButton() {
    var btn = document.getElementById('assembleBtn');
    btn.disabled = (exhibits.length === 0 && !mainDoc);
}

// ---------------------------------------------------------------
// Assemble button
// ---------------------------------------------------------------
document.getElementById('assembleBtn').addEventListener('click', function() {
    assembleFiling();
});

// ---------------------------------------------------------------
// Slip sheet generation
// ---------------------------------------------------------------
async function createSlipSheet(label, pageWidth, pageHeight) {
    var doc = await PDFLib.PDFDocument.create();
    var font = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);
    var page = doc.addPage([pageWidth, pageHeight]);

    var fontSize = parseInt(document.getElementById('slipFontSize').value, 10);
    var textWidth = font.widthOfTextAtSize(label, fontSize);

    // Center the main label vertically and horizontally
    page.drawText(label, {
        x: (pageWidth - textWidth) / 2,
        y: pageHeight / 2 + fontSize / 2,
        size: fontSize,
        font: font,
        color: PDFLib.rgb(0, 0, 0)
    });

    // Optional case caption (above the label)
    var caseName = document.getElementById('caseName').value.trim();
    var caseNumber = document.getElementById('caseNumber').value.trim();
    var courtName = document.getElementById('courtName').value.trim();

    if (courtName) {
        var courtFontSize = 14;
        var courtText = courtName.toUpperCase();
        var courtWidth = font.widthOfTextAtSize(courtText, courtFontSize);
        page.drawText(courtText, {
            x: (pageWidth - courtWidth) / 2,
            y: pageHeight / 2 + fontSize + 60,
            size: courtFontSize,
            font: font,
            color: PDFLib.rgb(0, 0, 0)
        });
    }

    if (caseName) {
        var nameFont = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
        var nameFontSize = 12;
        var nameWidth = nameFont.widthOfTextAtSize(caseName, nameFontSize);
        page.drawText(caseName, {
            x: (pageWidth - nameWidth) / 2,
            y: pageHeight / 2 + fontSize + 40,
            size: nameFontSize,
            font: nameFont,
            color: PDFLib.rgb(0, 0, 0)
        });
    }

    if (caseNumber) {
        var numFont = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
        var numFontSize = 12;
        var numText = 'Case No. ' + caseNumber;
        var numWidth = numFont.widthOfTextAtSize(numText, numFontSize);
        page.drawText(numText, {
            x: (pageWidth - numWidth) / 2,
            y: pageHeight / 2 + fontSize + 20,
            size: numFontSize,
            font: numFont,
            color: PDFLib.rgb(0, 0, 0)
        });
    }

    return await doc.save();
}

// ---------------------------------------------------------------
// Progress helper
// ---------------------------------------------------------------
function updateProgress(current, total) {
    var pct = Math.round((current / total) * 100);
    document.getElementById('progressBar').style.width = pct + '%';
    document.getElementById('progressText').textContent =
        'Processing exhibit ' + current + ' of ' + total + '\u2026';
}

// ---------------------------------------------------------------
// Main assembly
// ---------------------------------------------------------------
async function assembleFiling() {
    var btn = document.getElementById('assembleBtn');
    var statusEl = document.getElementById('status');
    var progressContainer = document.getElementById('progressContainer');

    btn.disabled = true;
    statusEl.className = 'status status-processing';
    statusEl.textContent = 'Assembling filing\u2026';
    progressContainer.classList.remove('hidden');
    document.getElementById('progressBar').style.width = '0%';
    document.getElementById('progressText').textContent = 'Starting\u2026';

    try {
        var outputDoc = await PDFLib.PDFDocument.create();

        // 1. Add main document if provided
        if (mainDoc) {
            var mainBytes = await readFileAsArrayBuffer(mainDoc.file);
            if (mainDoc.file.type === 'application/pdf') {
                var mainPdf = await PDFLib.PDFDocument.load(mainBytes);
                var mainPages = await outputDoc.copyPages(mainPdf, mainPdf.getPageIndices());
                mainPages.forEach(function(p) { outputDoc.addPage(p); });
            } else {
                // Image main doc
                var mainImg;
                if (mainDoc.file.type === 'image/jpeg') {
                    mainImg = await outputDoc.embedJpg(mainBytes);
                } else {
                    mainImg = await outputDoc.embedPng(mainBytes);
                }
                var mainImgPage = outputDoc.addPage([mainImg.width, mainImg.height]);
                mainImgPage.drawImage(mainImg, { x: 0, y: 0, width: mainImg.width, height: mainImg.height });
            }
            mainBytes = null;
        }

        // 2. For each exhibit: slip sheet + exhibit content
        for (var i = 0; i < exhibits.length; i++) {
            updateProgress(i + 1, exhibits.length);
            var exhibit = exhibits[i];

            var exhibitBytes = await readFileAsArrayBuffer(exhibit.file);
            var pageWidth = 612, pageHeight = 792; // US Letter default

            if (exhibit.file.type === 'application/pdf') {
                var exhibitPdf = await PDFLib.PDFDocument.load(exhibitBytes);
                var firstPage = exhibitPdf.getPages()[0];
                var size = firstPage.getSize();
                pageWidth = size.width;
                pageHeight = size.height;

                // Slip sheet
                var slipBytes = await createSlipSheet(exhibit.label, pageWidth, pageHeight);
                var slipDoc = await PDFLib.PDFDocument.load(slipBytes);
                var slipPages = await outputDoc.copyPages(slipDoc, [0]);
                outputDoc.addPage(slipPages[0]);

                // Exhibit pages
                var exhibitPages = await outputDoc.copyPages(exhibitPdf, exhibitPdf.getPageIndices());
                exhibitPages.forEach(function(p) { outputDoc.addPage(p); });

            } else {
                // Image file
                var slipBytes2 = await createSlipSheet(exhibit.label, pageWidth, pageHeight);
                var slipDoc2 = await PDFLib.PDFDocument.load(slipBytes2);
                var slipPages2 = await outputDoc.copyPages(slipDoc2, [0]);
                outputDoc.addPage(slipPages2[0]);

                var img;
                if (exhibit.file.type === 'image/jpeg') {
                    img = await outputDoc.embedJpg(exhibitBytes);
                } else {
                    img = await outputDoc.embedPng(exhibitBytes);
                }
                var imgPage = outputDoc.addPage([img.width, img.height]);
                imgPage.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
            }

            exhibitBytes = null;
        }

        document.getElementById('progressBar').style.width = '100%';
        document.getElementById('progressText').textContent = 'Saving\u2026';

        var pdfBytes = await outputDoc.save();
        downloadPdf(pdfBytes, 'filing_assembled.pdf');

        // Add to session files
        if (typeof sessionFiles !== 'undefined') {
            var blob = new Blob([pdfBytes], { type: 'application/pdf' });
            sessionFiles.add('filing_assembled.pdf', blob, 'filing-assembler');
        }

        statusEl.className = 'status status-success';
        statusEl.textContent = '\u2713 Filing assembled successfully — ' + formatFileSize(pdfBytes.byteLength) + '. Download started.';

        // Show pipeline suggestions
        showPipelineSuggestions('filing-assembler');

    } catch (err) {
        console.error('Assembly error:', err);
        statusEl.className = 'status status-error';
        statusEl.textContent = 'Error: ' + (err.message || 'Assembly failed. Please check your files and try again.');
    } finally {
        btn.disabled = false;
        progressContainer.classList.add('hidden');
    }
}

// ---------------------------------------------------------------
// HTML escape helpers
// ---------------------------------------------------------------
function escapeAttr(str) {
    return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------
// Initial render
// ---------------------------------------------------------------
updateSummary();
