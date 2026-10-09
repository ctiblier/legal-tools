// ---------------------------------------------------------------
// State
// ---------------------------------------------------------------
var selectedFile = null;
var currentMetadata = null;

// ---------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------
initNav({
    title: 'PDF Metadata Stripper',
    subtitle: 'Remove hidden data from PDFs before filing'
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
    analyzeMetadata(file);
}

// ---------------------------------------------------------------
// Analyze metadata on file selection
// ---------------------------------------------------------------
async function analyzeMetadata(file) {
    var statusEl = document.getElementById('status');
    statusEl.className = 'status status-processing';
    statusEl.textContent = 'Analyzing metadata...';

    try {
        var arrayBuffer = await readFileAsArrayBuffer(file);
        var pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer, { ignoreEncryption: true });

        // Read all standard metadata fields
        var metadata = {
            title: pdfDoc.getTitle() || null,
            author: pdfDoc.getAuthor() || null,
            subject: pdfDoc.getSubject() || null,
            keywords: pdfDoc.getKeywords() || null,
            creator: pdfDoc.getCreator() || null,
            producer: pdfDoc.getProducer() || null,
            creationDate: pdfDoc.getCreationDate() || null,
            modificationDate: pdfDoc.getModificationDate() || null,
        };

        // Check for XMP metadata
        var catalog = pdfDoc.catalog;
        var hasXmp = catalog.has(PDFLib.PDFName.of('Metadata'));

        // Count annotations across all pages
        var annotationCount = 0;
        var pages = pdfDoc.getPages();
        for (var i = 0; i < pages.length; i++) {
            var annots = pages[i].node.lookup(PDFLib.PDFName.of('Annots'));
            if (annots) {
                try {
                    annotationCount += annots.size();
                } catch (e) {
                    // Some PDFs have annots that aren't arrays — skip gracefully
                }
            }
        }

        currentMetadata = metadata;
        displayMetadata(metadata, hasXmp, annotationCount);

        document.getElementById('metadataSection').classList.remove('hidden');
        document.getElementById('optionsSection').classList.remove('hidden');
        document.getElementById('stripBtn').disabled = false;

        statusEl.className = 'status status-success';
        statusEl.textContent = 'Metadata loaded. Configure options and click Strip Metadata to clean the file.';

    } catch (err) {
        statusEl.className = 'status status-error';
        statusEl.textContent = 'Error reading PDF: ' + err.message;
    }
}

// ---------------------------------------------------------------
// Display metadata in the table
// ---------------------------------------------------------------
var FIELD_LABELS = [
    { key: 'title',            label: 'Title' },
    { key: 'author',           label: 'Author' },
    { key: 'subject',          label: 'Subject' },
    { key: 'keywords',         label: 'Keywords' },
    { key: 'creator',          label: 'Creator (Application)' },
    { key: 'producer',         label: 'Producer (PDF Engine)' },
    { key: 'creationDate',     label: 'Creation Date' },
    { key: 'modificationDate', label: 'Modification Date' },
];

function formatMetadataValue(value) {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) {
        // Format as readable date + time
        if (isNaN(value.getTime())) return null;
        return value.toLocaleString(undefined, {
            year: 'numeric', month: 'long', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    }
    var str = String(value).trim();
    return str.length > 0 ? str : null;
}

function displayMetadata(metadata, hasXmp, annotationCount) {
    var tbody = document.getElementById('metadataTableBody');
    tbody.innerHTML = '';

    FIELD_LABELS.forEach(function (field) {
        var raw = metadata[field.key];
        var formatted = formatMetadataValue(raw);
        var hasValue = formatted !== null;

        var tr = document.createElement('tr');

        // Checkbox cell
        var tdCheck = document.createElement('td');
        tdCheck.className = 'col-checkbox';
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.id = 'field-' + field.key;
        cb.checked = hasValue; // pre-check fields that have data
        cb.setAttribute('aria-label', 'Strip ' + field.label);
        if (!hasValue) cb.disabled = true;
        tdCheck.appendChild(cb);
        tr.appendChild(tdCheck);

        // Field name cell
        var tdName = document.createElement('td');
        tdName.className = 'metadata-field-name';
        tdName.textContent = field.label;
        tr.appendChild(tdName);

        // Value cell
        var tdVal = document.createElement('td');
        tdVal.className = 'metadata-value' + (hasValue ? ' has-value' : ' not-set');
        tdVal.textContent = hasValue ? formatted : 'Not set';
        tr.appendChild(tdVal);

        tbody.appendChild(tr);
    });

    // XMP indicator
    var xmpRow = document.getElementById('xmpRow');
    var xmpAbsent = document.getElementById('xmpAbsentRow');
    if (hasXmp) {
        xmpRow.classList.remove('hidden');
        xmpAbsent.classList.add('hidden');
    } else {
        xmpRow.classList.add('hidden');
        xmpAbsent.classList.remove('hidden');
    }

    // Annotation count
    var annotInfo = document.getElementById('annotationInfo');
    var annotCount = document.getElementById('annotationCount');
    if (annotationCount > 0) {
        annotInfo.classList.remove('hidden');
        annotCount.textContent = 'Annotations: ' + annotationCount + ' found across all pages';
    } else {
        annotInfo.classList.add('hidden');
    }
}

// ---------------------------------------------------------------
// "Strip all" checkbox — toggles individual field checkboxes
// ---------------------------------------------------------------
document.getElementById('stripAll').addEventListener('change', function () {
    var allChecked = this.checked;
    FIELD_LABELS.forEach(function (field) {
        var cb = document.getElementById('field-' + field.key);
        if (cb) {
            cb.disabled = allChecked || !cb.getAttribute('data-has-value');
            if (allChecked && currentMetadata) {
                var raw = currentMetadata[field.key];
                var formatted = formatMetadataValue(raw);
                cb.checked = formatted !== null;
            }
        }
    });
});

// Mark which checkboxes have actual values after display
// (done after displayMetadata runs, by re-reading from state)
function updateCheckboxDataAttributes() {
    FIELD_LABELS.forEach(function (field) {
        var cb = document.getElementById('field-' + field.key);
        if (!cb || !currentMetadata) return;
        var raw = currentMetadata[field.key];
        var formatted = formatMetadataValue(raw);
        if (formatted !== null) {
            cb.setAttribute('data-has-value', '1');
        }
    });
}

// ---------------------------------------------------------------
// Strip button
// ---------------------------------------------------------------
document.getElementById('stripBtn').addEventListener('click', stripMetadata);

async function stripMetadata() {
    var statusEl = document.getElementById('status');
    var btn = document.getElementById('stripBtn');

    statusEl.className = 'status status-processing';
    statusEl.textContent = 'Stripping metadata...';
    btn.disabled = true;

    try {
        var arrayBuffer = await readFileAsArrayBuffer(selectedFile);
        var pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer, { ignoreEncryption: true });

        var stripAll = document.getElementById('stripAll').checked;
        var stripped = [];

        // Helper: check if a field should be stripped
        function shouldStrip(key) {
            if (stripAll) return true;
            var cb = document.getElementById('field-' + key);
            return cb ? cb.checked : false;
        }

        // Strip standard document info fields
        if (shouldStrip('title')) {
            if (currentMetadata && currentMetadata.title) {
                stripped.push({ field: 'Title', was: formatMetadataValue(currentMetadata.title) });
            }
            pdfDoc.setTitle('');
        }
        if (shouldStrip('author')) {
            if (currentMetadata && currentMetadata.author) {
                stripped.push({ field: 'Author', was: formatMetadataValue(currentMetadata.author) });
            }
            pdfDoc.setAuthor('');
        }
        if (shouldStrip('subject')) {
            if (currentMetadata && currentMetadata.subject) {
                stripped.push({ field: 'Subject', was: formatMetadataValue(currentMetadata.subject) });
            }
            pdfDoc.setSubject('');
        }
        if (shouldStrip('keywords')) {
            if (currentMetadata && currentMetadata.keywords) {
                stripped.push({ field: 'Keywords', was: formatMetadataValue(currentMetadata.keywords) });
            }
            pdfDoc.setKeywords([]);
        }
        if (shouldStrip('creator')) {
            if (currentMetadata && currentMetadata.creator) {
                stripped.push({ field: 'Creator (Application)', was: formatMetadataValue(currentMetadata.creator) });
            }
            pdfDoc.setCreator('');
        }
        if (shouldStrip('producer')) {
            if (currentMetadata && currentMetadata.producer) {
                stripped.push({ field: 'Producer (PDF Engine)', was: formatMetadataValue(currentMetadata.producer) });
            }
            pdfDoc.setProducer('');
        }
        if (shouldStrip('creationDate')) {
            if (currentMetadata && currentMetadata.creationDate) {
                stripped.push({ field: 'Creation Date', was: formatMetadataValue(currentMetadata.creationDate) });
            }
            pdfDoc.setCreationDate(new Date(0));
        }
        if (shouldStrip('modificationDate')) {
            if (currentMetadata && currentMetadata.modificationDate) {
                stripped.push({ field: 'Modification Date', was: formatMetadataValue(currentMetadata.modificationDate) });
            }
            pdfDoc.setModificationDate(new Date(0));
        }

        // Strip XMP metadata
        var catalog = pdfDoc.catalog;
        if (catalog.has(PDFLib.PDFName.of('Metadata'))) {
            catalog.delete(PDFLib.PDFName.of('Metadata'));
            stripped.push({ field: 'XMP Metadata Stream', was: 'Present' });
        }

        // Optionally remove annotations
        if (document.getElementById('removeAnnotations').checked) {
            var pages = pdfDoc.getPages();
            var removedAnnotPages = 0;
            for (var i = 0; i < pages.length; i++) {
                var pageDict = pages[i].node;
                if (pageDict.has(PDFLib.PDFName.of('Annots'))) {
                    pageDict.delete(PDFLib.PDFName.of('Annots'));
                    removedAnnotPages++;
                }
            }
            if (removedAnnotPages > 0) {
                stripped.push({ field: 'Annotations', was: 'Removed from ' + removedAnnotPages + ' page(s)' });
            }
        }

        var pdfBytes = await pdfDoc.save();
        var filename = selectedFile.name.replace(/\.pdf$/i, '') + '_cleaned.pdf';
        downloadPdf(pdfBytes, filename);

        // Add to session files
        if (typeof sessionFiles !== 'undefined') {
            var blob = new Blob([pdfBytes], { type: 'application/pdf' });
            sessionFiles.add(filename, blob, 'metadata-stripper');
        }

        showResults(stripped);

        statusEl.className = 'status status-success';
        statusEl.textContent = 'Done! Cleaned PDF downloaded as "' + filename + '".';

        // Show pipeline suggestions
        showPipelineSuggestions('metadata-stripper');

    } catch (err) {
        statusEl.className = 'status status-error';
        statusEl.textContent = 'Error: ' + err.message;
    } finally {
        btn.disabled = false;
    }
}

// ---------------------------------------------------------------
// Show results summary
// ---------------------------------------------------------------
function showResults(stripped) {
    var section = document.getElementById('resultsSection');
    var list = document.getElementById('resultsList');
    list.innerHTML = '';

    if (stripped.length === 0) {
        var li = document.createElement('li');
        li.textContent = 'No metadata fields had values to remove.';
        li.style.color = 'var(--text-muted)';
        list.appendChild(li);
    } else {
        stripped.forEach(function (item) {
            var li = document.createElement('li');

            var check = document.createElement('span');
            check.className = 'result-check';
            check.textContent = '✓';
            check.setAttribute('aria-hidden', 'true');

            var fieldSpan = document.createElement('span');
            fieldSpan.className = 'result-field';
            fieldSpan.textContent = item.field;

            var wasSpan = document.createElement('span');
            wasSpan.className = 'result-was';
            wasSpan.textContent = 'was: ' + (item.was || '(empty)');

            li.appendChild(check);
            li.appendChild(fieldSpan);
            li.appendChild(wasSpan);
            list.appendChild(li);
        });
    }

    section.classList.remove('hidden');
    section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ---------------------------------------------------------------
// Init: update data attributes once the page is ready
// ---------------------------------------------------------------
// (called after analyzeMetadata populates currentMetadata)
var _origDisplay = displayMetadata;
displayMetadata = function (metadata, hasXmp, annotationCount) {
    _origDisplay(metadata, hasXmp, annotationCount);
    updateCheckboxDataAttributes();

    // Enforce initial stripAll state on individual checkboxes
    var stripAll = document.getElementById('stripAll').checked;
    if (stripAll) {
        FIELD_LABELS.forEach(function (field) {
            var cb = document.getElementById('field-' + field.key);
            if (cb) cb.disabled = true;
        });
    }
};
