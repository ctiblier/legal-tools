// Initialize shared navigation
if (typeof initNav === 'function') {
    initNav({
        title: 'Free Bates Stamping Tool',
        subtitle: 'Add Bates Numbers to PDFs Online'
    });
}

// Selected files (source of truth for batch processing)
var selectedFiles = [];
var UPLOAD_SVG = '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><polyline points="9 15 12 12 15 15"/></svg>';
var CHECK_SVG = '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';

function fileKey(f) { return f.name + '|' + f.size + '|' + (f.lastModified || 0); }

async function addFiles(newFiles) {
    var existing = {};
    selectedFiles.forEach(function(e) { existing[fileKey(e.file)] = true; });

    var toAdd = [];
    var rejectedNonPdf = 0;
    for (var i = 0; i < newFiles.length; i++) {
        var f = newFiles[i];
        if (f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) { rejectedNonPdf++; continue; }
        if (existing[fileKey(f)]) continue;
        toAdd.push({ file: f, pageCount: null, error: null });
    }

    if (toAdd.length === 0) {
        if (rejectedNonPdf > 0) setStatus('Only PDF files are accepted.', 'error');
        return;
    }

    if (selectedFiles.length + toAdd.length > 100) {
        setStatus('Maximum 100 files per batch. You already have ' + selectedFiles.length + '; tried to add ' + toAdd.length + '.', 'error');
        return;
    }

    selectedFiles = selectedFiles.concat(toAdd);
    renderFileList();

    // Read page counts sequentially so the preview populates progressively
    for (var j = 0; j < toAdd.length; j++) {
        var entry = toAdd[j];
        try {
            var buf = await entry.file.arrayBuffer();
            var doc = await PDFLib.PDFDocument.load(buf, { updateMetadata: false });
            entry.pageCount = doc.getPageCount();
        } catch (err) {
            entry.pageCount = 0;
            entry.error = (err && err.message && err.message.indexOf('encrypt') !== -1)
                ? 'password-protected'
                : 'unreadable';
        }
        renderFileList();
    }
}

function removeFileAt(index) {
    selectedFiles.splice(index, 1);
    renderFileList();
}

function clearAllFiles() {
    selectedFiles = [];
    renderFileList();
}

function updateDropSummary() {
    var dropZone = document.getElementById('dropZone');
    var dropIcon = document.getElementById('dropIcon');
    var dropText = document.getElementById('dropText');
    var dropHint = document.getElementById('dropHint');
    var count = selectedFiles.length;

    if (count === 0) {
        dropZone.classList.remove('has-file');
        dropIcon.innerHTML = UPLOAD_SVG;
        dropText.textContent = 'Choose PDF files or drag them here';
        dropHint.textContent = 'Select one file — or several for batch stamping with continuous numbering (up to 100). Your documents never leave your browser.';
        return;
    }

    var totalBytes = 0;
    for (var i = 0; i < selectedFiles.length; i++) totalBytes += selectedFiles[i].file.size;
    var totalMB = (totalBytes / (1024 * 1024)).toFixed(1);
    dropZone.classList.add('has-file');
    dropIcon.innerHTML = CHECK_SVG;
    if (count === 1) {
        dropText.textContent = selectedFiles[0].file.name;
        dropHint.textContent = totalMB + ' MB — click or drop again to add more files';
    } else {
        dropText.textContent = count + ' files selected';
        dropHint.textContent = totalMB + ' MB total — click or drop again to add more files';
    }
}

function renderFileList() {
    var list = document.getElementById('fileList');
    var clearBtn = document.getElementById('clearFilesBtn');
    var batesHint = document.getElementById('batesBatchHint');
    var exhibitHint = document.getElementById('exhibitBatchHint');
    var isBatch = selectedFiles.length > 1;

    if (batesHint) batesHint.classList.toggle('hidden', !isBatch);
    if (exhibitHint) exhibitHint.classList.toggle('hidden', !isBatch);
    clearBtn.classList.toggle('hidden', selectedFiles.length === 0);

    updateDropSummary();

    list.innerHTML = '';
    if (selectedFiles.length === 0) return;

    var addBates = document.getElementById('addBates').checked;
    var addExhibit = document.getElementById('addExhibit').checked;
    var prefix = document.getElementById('prefix').value;
    var suffix = document.getElementById('suffix').value;
    var startNumber = parseInt(document.getElementById('startNumber').value) || 1;
    var padding = parseInt(document.getElementById('padding').value) || 4;
    var baseExhibit = document.getElementById('exhibitValue').value;

    var PDF_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
    var X_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

    var wrap = document.createElement('div');
    wrap.className = 'file-table-wrap';

    var caption = document.createElement('div');
    caption.className = 'file-table-caption';
    var captionTitle = document.createElement('span');
    captionTitle.className = 'file-table-caption-title';
    captionTitle.textContent = 'Preview';
    var captionSub = document.createElement('span');
    captionSub.className = 'file-table-caption-sub';
    captionSub.textContent = selectedFiles.length + ' file' + (selectedFiles.length === 1 ? '' : 's') + ' — what will be stamped';
    caption.appendChild(captionTitle);
    caption.appendChild(captionSub);
    wrap.appendChild(caption);

    var table = document.createElement('table');
    table.className = 'file-table';

    var thead = document.createElement('thead');
    var headRow = document.createElement('tr');
    var headers = ['File', 'Size', 'Pages'];
    if (addBates) headers.push('Bates Range');
    if (addExhibit) headers.push('Exhibit');
    headers.push('');
    headers.forEach(function(h) {
        var th = document.createElement('th');
        th.textContent = h;
        headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    var counter = startNumber;

    selectedFiles.forEach(function(entry, idx) {
        var tr = document.createElement('tr');
        if (entry.error) tr.className = 'file-row-error';

        // File cell (icon + filename)
        var tdFile = document.createElement('td');
        tdFile.className = 'file-col-name';
        var icon = document.createElement('span');
        icon.className = 'file-col-icon';
        icon.innerHTML = PDF_ICON;
        var nameSpan = document.createElement('span');
        nameSpan.className = 'file-col-filename';
        nameSpan.textContent = entry.file.name;
        nameSpan.title = entry.file.name;
        tdFile.appendChild(icon);
        tdFile.appendChild(nameSpan);
        tr.appendChild(tdFile);

        // Size cell
        var tdSize = document.createElement('td');
        tdSize.className = 'file-col-num';
        tdSize.textContent = (entry.file.size / (1024 * 1024)).toFixed(1) + ' MB';
        tr.appendChild(tdSize);

        // Pages cell (or status)
        var tdPages = document.createElement('td');
        tdPages.className = 'file-col-num';
        if (entry.error === 'password-protected') {
            tdPages.textContent = 'password-protected';
            tdPages.classList.add('file-col-error');
            tdPages.colSpan = headers.length - 2;
        } else if (entry.error === 'unreadable') {
            tdPages.textContent = 'unreadable';
            tdPages.classList.add('file-col-error');
            tdPages.colSpan = headers.length - 2;
        } else if (entry.pageCount === null) {
            tdPages.textContent = '…';
            tdPages.classList.add('file-col-pending');
        } else {
            tdPages.textContent = entry.pageCount;
        }
        tr.appendChild(tdPages);

        // Only add subsequent cells if no error (else colspan covered them)
        if (!entry.error) {
            if (addBates) {
                var tdBates = document.createElement('td');
                tdBates.className = 'file-col-bates';
                if (entry.pageCount !== null) {
                    var startPad = counter.toString().padStart(padding, '0');
                    var endPad = (counter + entry.pageCount - 1).toString().padStart(padding, '0');
                    tdBates.textContent = prefix + startPad + suffix + '–' + prefix + endPad + suffix;
                }
                tr.appendChild(tdBates);
            }
            if (addExhibit) {
                var tdEx = document.createElement('td');
                tdEx.className = 'file-col-exhibit';
                if (entry.pageCount !== null) {
                    var badge = document.createElement('span');
                    badge.className = 'file-exhibit-badge';
                    badge.textContent = incrementExhibitValue(baseExhibit || 'A', idx);
                    tdEx.appendChild(badge);
                }
                tr.appendChild(tdEx);
            }
            if (entry.pageCount !== null) counter += entry.pageCount;
        }

        // Remove button cell
        var tdRemove = document.createElement('td');
        tdRemove.className = 'file-col-action';
        var removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'file-row-remove';
        removeBtn.setAttribute('aria-label', 'Remove ' + entry.file.name);
        removeBtn.innerHTML = X_ICON;
        removeBtn.addEventListener('click', function() { removeFileAt(idx); });
        tdRemove.appendChild(removeBtn);
        tr.appendChild(tdRemove);

        tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    wrap.appendChild(table);
    list.appendChild(wrap);
}

// Drag-and-drop file upload
(function() {
    var dropZone = document.getElementById('dropZone');
    var fileInput = document.getElementById('pdfFile');

    fileInput.addEventListener('change', function() {
        if (fileInput.files && fileInput.files.length > 0) {
            addFiles(Array.from(fileInput.files));
            fileInput.value = ''; // reset so the same file can be re-selected later
        }
    });

    ['dragenter', 'dragover'].forEach(function(evt) {
        dropZone.addEventListener(evt, function(e) {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.add('drag-over');
        });
    });

    ['dragleave', 'drop'].forEach(function(evt) {
        dropZone.addEventListener(evt, function(e) {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove('drag-over');
        });
    });

    dropZone.addEventListener('drop', function(e) {
        var files = e.dataTransfer.files;
        if (!files || files.length === 0) return;
        addFiles(Array.from(files));
    });

    document.getElementById('clearFilesBtn').addEventListener('click', clearAllFiles);

    // Re-render preview when Bates/exhibit settings change
    ['addBates', 'addExhibit', 'prefix', 'suffix', 'startNumber', 'padding', 'exhibitValue'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.addEventListener('input', renderFileList);
        if (el && (el.type === 'checkbox' || el.tagName === 'SELECT')) el.addEventListener('change', renderFileList);
    });

    renderFileList();
})();

// Event listeners (W11: no inline handlers)
document.getElementById('addBates').addEventListener('change', toggleBatesOptions);
document.getElementById('addExhibit').addEventListener('change', toggleExhibitOptions);
document.getElementById('addConfidentiality').addEventListener('change', toggleConfidentialityOptions);
document.getElementById('addWhitespaceBorder').addEventListener('change', toggleWhitespaceBorderOptions);
document.getElementById('confidentialityText').addEventListener('change', updateConfidentialityPreview);
document.getElementById('stampBtn').addEventListener('click', stampPDF);

function toggleBatesOptions() {
    const checkbox = document.getElementById('addBates');
    document.getElementById('batesOptions').classList.toggle('hidden', !checkbox.checked);
}

function toggleExhibitOptions() {
    const checkbox = document.getElementById('addExhibit');
    document.getElementById('exhibitOptions').classList.toggle('hidden', !checkbox.checked);
}

function toggleConfidentialityOptions() {
    const checkbox = document.getElementById('addConfidentiality');
    document.getElementById('confidentialityOptions').classList.toggle('hidden', !checkbox.checked);
}

function toggleWhitespaceBorderOptions() {
    const checkbox = document.getElementById('addWhitespaceBorder');
    const options = document.getElementById('whitespaceBorderOptions');
    options.classList.toggle('hidden', !checkbox.checked);
}

function updateConfidentialityPreview() {
    const select = document.getElementById('confidentialityText');
    const customGroup = document.getElementById('customConfidentialityGroup');
    customGroup.classList.toggle('hidden', select.value !== 'custom');
}

function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16) / 255,
        g: parseInt(result[2], 16) / 255,
        b: parseInt(result[3], 16) / 255
    } : { r: 0, g: 0, b: 0 };
}

function setStatus(message, type) {
    const statusDiv = document.getElementById('status');
    statusDiv.textContent = '';
    statusDiv.className = 'status';
    if (type === 'processing') {
        statusDiv.classList.add('status-processing');
        var spinner = document.createElement('span');
        spinner.className = 'spinner';
        statusDiv.appendChild(spinner);
        var text = document.createTextNode(message);
        statusDiv.appendChild(text);
    } else if (type) {
        statusDiv.classList.add('status-' + type);
        var span = document.createElement('span');
        span.className = type;
        span.textContent = message;
        statusDiv.appendChild(span);
    } else {
        statusDiv.textContent = message;
    }
}

// Increment an exhibit value: "A" -> "B", "Z" -> "AA", "1" -> "2", "EX-1" -> "EX-2".
function incrementExhibitValue(base, offset) {
    if (offset === 0) return base;
    const trailing = base.match(/^(.*?)(\d+)$/);
    if (trailing) {
        const num = parseInt(trailing[2], 10) + offset;
        return trailing[1] + num.toString().padStart(trailing[2].length, '0');
    }
    if (/^[A-Za-z]+$/.test(base)) {
        const upper = base === base.toUpperCase();
        let n = 0;
        for (const c of base.toUpperCase()) n = n * 26 + (c.charCodeAt(0) - 64);
        n += offset;
        let s = '';
        while (n > 0) {
            const r = (n - 1) % 26;
            s = String.fromCharCode(65 + r) + s;
            n = Math.floor((n - r) / 26);
        }
        return upper ? s : s.toLowerCase();
    }
    return base + '-' + (offset + 1);
}

async function stampPDF() {
    const addBates = document.getElementById('addBates').checked;
    const prefix = document.getElementById('prefix').value;
    const startNumber = parseInt(document.getElementById('startNumber').value);
    const suffix = document.getElementById('suffix').value;
    const padding = parseInt(document.getElementById('padding').value);
    const position = document.getElementById('position').value;
    const fontSize = parseInt(document.getElementById('fontSize').value);
    const textColor = document.getElementById('textColor').value;
    const addExhibit = document.getElementById('addExhibit').checked;
    const addConfidentiality = document.getElementById('addConfidentiality').checked;
    const stampBtn = document.getElementById('stampBtn');

    // Validation
    if (selectedFiles.length === 0) {
        setStatus('Please select a PDF file first.', 'error');
        return;
    }

    const badFiles = selectedFiles.filter(function(e) { return e.error; });
    if (badFiles.length > 0) {
        setStatus('Remove or replace unreadable/password-protected files before stamping: ' + badFiles[0].file.name, 'error');
        return;
    }

    const files = selectedFiles.map(function(e) { return e.file; });

    if (files.length > 100) {
        setStatus('Maximum 100 files per batch. You selected ' + files.length + '.', 'error');
        return;
    }

    const oversized = files.filter(function(f) { return f.size / (1024 * 1024) > 100; });
    if (oversized.length > 0) {
        setStatus('File too large for browser processing (max 100MB): ' + oversized[0].name + ' (' + (oversized[0].size / (1024 * 1024)).toFixed(1) + ' MB).', 'error');
        return;
    }

    // Check that at least one stamp type is selected
    if (!addBates && !addExhibit && !addConfidentiality) {
        setStatus('Please select at least one stamp type (Bates Numbers, Exhibit Stamp, or Confidentiality Notice).', 'error');
        return;
    }

    const isBatch = files.length > 1;
    const baseExhibitValue = addExhibit ? document.getElementById('exhibitValue').value : '';

    try {
        stampBtn.disabled = true;
        setStatus(isBatch ? ('Processing ' + files.length + ' files...') : 'Processing PDF...', 'processing');

        const zip = isBatch ? new JSZip() : null;
        const stampedResults = [];
        let batesCounter = startNumber;

        for (let fileIdx = 0; fileIdx < files.length; fileIdx++) {
            const file = files[fileIdx];
            if (isBatch) {
                setStatus('Processing file ' + (fileIdx + 1) + ' of ' + files.length + ': ' + file.name, 'processing');
            }

            const arrayBuffer = await readFileAsArrayBuffer(file);

            let pdfDoc;
            try {
                pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer);
            } catch (loadError) {
                if (loadError.message && loadError.message.includes('encrypt')) {
                    setStatus('Password-protected PDF (' + file.name + '). Remove protection and try again.', 'error');
                } else {
                    setStatus('Unable to read PDF: ' + file.name + '. It may be corrupted or in an unsupported format.', 'error');
                }
                return;
            }

            const pages = pdfDoc.getPages();
            const totalPages = pages.length;
            const font = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);
            const fileStartBates = batesCounter;
            const fileExhibitValue = addExhibit ? incrementExhibitValue(baseExhibitValue, fileIdx) : '';

        // Get opacity setting (convert from 0-100 to 0-1)
        // Convert hex color to RGB for Bates numbers
        let textColorRgb;
        if (addBates) {
            const rgb = hexToRgb(textColor);
            textColorRgb = PDFLib.rgb(rgb.r, rgb.g, rgb.b);
        }

        // Get exhibit settings if enabled
        let exhibitRgb;
        if (addExhibit) {
            const exhibitColorHex = document.getElementById('exhibitColor').value;
            const exhibitRgbValues = hexToRgb(exhibitColorHex);
            exhibitRgb = PDFLib.rgb(exhibitRgbValues.r, exhibitRgbValues.g, exhibitRgbValues.b);
        }

        // Get confidentiality settings if enabled
        let confidentialityRgb;
        if (addConfidentiality) {
            const confidentialityColorHex = document.getElementById('confidentialityColor').value;
            const confidentialityRgbValues = hexToRgb(confidentialityColorHex);
            confidentialityRgb = PDFLib.rgb(confidentialityRgbValues.r, confidentialityRgbValues.g, confidentialityRgbValues.b);
        }

        // Whitespace border settings
        const addWhitespaceBorder = document.getElementById('addWhitespaceBorder').checked;
        const whitespaceBorderSize = addWhitespaceBorder
            ? Math.max(0, parseInt(document.getElementById('whitespaceBorderSize').value) || 0)
            : 0;

        // Stamp each page
        for (let i = 0; i < totalPages; i++) {
            const page = pages[i];
            const { width, height } = page.getSize();

            // Shrink page content to create a whitespace band around the edges
            if (addWhitespaceBorder && whitespaceBorderSize > 0) {
                const sx = (width - 2 * whitespaceBorderSize) / width;
                const sy = (height - 2 * whitespaceBorderSize) / height;
                const s = Math.min(sx, sy);
                if (s > 0 && s < 1) {
                    page.scaleContent(s, s);
                    page.translateContent((width - width * s) / 2, (height - height * s) / 2);
                }
            }

            // Add Bates number if enabled
            if (addBates) {
                // Calculate the Bates number for this page (continuous across batch)
                const pageNumber = fileStartBates + i;
                const paddedNumber = pageNumber.toString().padStart(padding, '0');
                const batesNumber = prefix + paddedNumber + suffix;

                // Calculate position
                let x, y;
                const margin = parseInt(document.getElementById("stampMargin").value) || 25;
                const batesWidth = font.widthOfTextAtSize(batesNumber, fontSize);

                switch(position) {
                    case 'bottom-right':
                        x = width - margin - batesWidth;
                        y = margin;
                        break;
                    case 'bottom-center':
                        x = (width - batesWidth) / 2;
                        y = margin;
                        break;
                    case 'bottom-left':
                        x = margin;
                        y = margin;
                        break;
                    case 'top-right':
                        x = width - margin - batesWidth;
                        y = height - margin - fontSize;
                        break;
                    case 'top-center':
                        x = (width - batesWidth) / 2;
                        y = height - margin - fontSize;
                        break;
                    case 'top-left':
                        x = margin;
                        y = height - margin - fontSize;
                        break;
                }

                // Draw the Bates number
                page.drawText(batesNumber, {
                    x: x,
                    y: y,
                    size: fontSize,
                    font: font,
                    color: textColorRgb,
                });
            }

            // Add exhibit stamp if enabled
            if (addExhibit) {
                const exhibitPages = document.getElementById('exhibitPages').value;
                const shouldStampExhibit = exhibitPages === 'all' || (exhibitPages === 'first' && i === 0);

                if (shouldStampExhibit) {
                    const exhibitLabel = document.getElementById('exhibitLabel').value;
                    const exhibitText = exhibitLabel + ' ' + fileExhibitValue;
                    const exhibitFontSize = parseInt(document.getElementById('exhibitFontSize').value);
                    const exhibitWidth = font.widthOfTextAtSize(exhibitText, exhibitFontSize);
                    const exhibitPosition = document.getElementById('exhibitPosition').value;

                    let exhibitX, exhibitY;
                    const exhibitMargin = parseInt(document.getElementById("stampMargin").value) || 25;

                    switch(exhibitPosition) {
                        case 'bottom-center':
                            exhibitX = (width - exhibitWidth) / 2;
                            exhibitY = exhibitMargin + (addBates ? fontSize + 20 : 0);
                            break;
                        case 'bottom-right':
                            exhibitX = width - exhibitMargin - exhibitWidth;
                            exhibitY = exhibitMargin + (addBates ? fontSize + 20 : 0);
                            break;
                        case 'bottom-left':
                            exhibitX = exhibitMargin;
                            exhibitY = exhibitMargin + (addBates ? fontSize + 20 : 0);
                            break;
                        case 'top-center':
                            exhibitX = (width - exhibitWidth) / 2;
                            exhibitY = height - exhibitMargin - exhibitFontSize;
                            break;
                        case 'top-right':
                            exhibitX = width - exhibitMargin - exhibitWidth;
                            exhibitY = height - exhibitMargin - exhibitFontSize;
                            break;
                        case 'top-left':
                            exhibitX = exhibitMargin;
                            exhibitY = height - exhibitMargin - exhibitFontSize;
                            break;
                        case 'center':
                            exhibitX = (width - exhibitWidth) / 2;
                            exhibitY = (height - exhibitFontSize) / 2;
                            break;
                    }

                    page.drawText(exhibitText, {
                        x: exhibitX,
                        y: exhibitY,
                        size: exhibitFontSize,
                        font: font,
                        color: exhibitRgb,
                        });
                }
            }

            // Add confidentiality notice if enabled
            if (addConfidentiality) {
                const confidentialityPages = document.getElementById('confidentialityPages').value;
                const shouldStampConfidentiality = confidentialityPages === 'all' || (confidentialityPages === 'first' && i === 0);

                if (shouldStampConfidentiality) {
                    const confidentialitySelect = document.getElementById('confidentialityText').value;
                    let confidentialityText;

                    if (confidentialitySelect === 'custom') {
                        confidentialityText = document.getElementById('customConfidentialityText').value || 'CONFIDENTIAL';
                    } else {
                        confidentialityText = confidentialitySelect;
                    }

                    const confidentialityFontSize = parseInt(document.getElementById('confidentialityFontSize').value);
                    const confidentialityWidth = font.widthOfTextAtSize(confidentialityText, confidentialityFontSize);
                    const confidentialityPosition = document.getElementById('confidentialityPosition').value;

                    let confidentialityX, confidentialityY;
                    const confidentialityMargin = parseInt(document.getElementById("stampMargin").value) || 25;

                    switch(confidentialityPosition) {
                        case 'top-center':
                            confidentialityX = (width - confidentialityWidth) / 2;
                            confidentialityY = height - confidentialityMargin;
                            break;
                        case 'top-right':
                            confidentialityX = width - confidentialityMargin - confidentialityWidth;
                            confidentialityY = height - confidentialityMargin;
                            break;
                        case 'top-left':
                            confidentialityX = confidentialityMargin;
                            confidentialityY = height - confidentialityMargin;
                            break;
                        case 'bottom-center':
                            confidentialityX = (width - confidentialityWidth) / 2;
                            confidentialityY = confidentialityMargin;
                            break;
                        case 'bottom-right':
                            confidentialityX = width - confidentialityMargin - confidentialityWidth;
                            confidentialityY = confidentialityMargin;
                            break;
                        case 'bottom-left':
                            confidentialityX = confidentialityMargin;
                            confidentialityY = confidentialityMargin;
                            break;
                        case 'center':
                            confidentialityX = (width - confidentialityWidth) / 2;
                            confidentialityY = (height - confidentialityFontSize) / 2;
                            break;
                    }

                    page.drawText(confidentialityText, {
                        x: confidentialityX,
                        y: confidentialityY,
                        size: confidentialityFontSize,
                        font: font,
                        color: confidentialityRgb,
                        });
                }
            }
        }

            // Save the modified PDF
            const pdfBytes = await pdfDoc.save();
            const originalName = file.name.replace(/\.pdf$/i, '');
            const outputFilename = originalName + '_stamped.pdf';
            stampedResults.push({ name: outputFilename, bytes: pdfBytes, pageCount: totalPages });

            if (isBatch) {
                zip.file(outputFilename, pdfBytes);
            }

            batesCounter += totalPages;
        }
        // End of file loop

        if (!isBatch) {
            const single = stampedResults[0];
            const blob = new Blob([single.bytes], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = single.name;
            link.click();
            setTimeout(function() { URL.revokeObjectURL(url); }, 1000);

            if (typeof sessionFiles !== 'undefined') {
                var sessionBlob = new Blob([single.bytes], { type: 'application/pdf' });
                sessionFiles.add(single.name, sessionBlob, 'bates-stamp');
            }

            setStatus('Stamped ' + single.pageCount + ' page(s) — saved as ' + single.name, 'success');
        } else {
            setStatus('Building ZIP of ' + stampedResults.length + ' files...', 'processing');
            const zipBlob = await zip.generateAsync({ type: 'blob' });
            const zipName = 'bates-stamped-' + new Date().toISOString().slice(0, 10) + '.zip';
            const url = URL.createObjectURL(zipBlob);
            const link = document.createElement('a');
            link.href = url;
            link.download = zipName;
            link.click();
            setTimeout(function() { URL.revokeObjectURL(url); }, 1000);

            if (typeof sessionFiles !== 'undefined') {
                sessionFiles.add(zipName, zipBlob, 'bates-stamp');
            }

            const totalPagesAll = stampedResults.reduce(function(s, r) { return s + r.pageCount; }, 0);
            setStatus('Stamped ' + stampedResults.length + ' files (' + totalPagesAll + ' pages) — saved as ' + zipName, 'success');
        }

        showPipelineSuggestions('bates-stamp');

    } catch (error) {
        console.error('Error:', error);
        setStatus('An error occurred while processing the PDF. Please try a different file or check the browser console for details.', 'error');
    } finally {
        stampBtn.disabled = false;
    }
}
