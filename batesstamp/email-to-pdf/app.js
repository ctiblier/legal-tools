import { parseEml } from '/shared/eml/parse.js';
import { convertEmail, convertBatchCombined, DEFAULT_OPTIONS } from '/shared/eml/assemble.js';
import { sanitizeHtml } from '/shared/eml/sanitize.js';
import { htmlToBlocks } from '/shared/eml/html-to-blocks.js';
import { textToBlocks } from '/shared/eml/text-to-blocks.js';
import { blocksToHtml } from '/shared/eml/blocks-to-html.js';
import { outputFilename } from '/shared/eml/filename.js';
import { sizeCheck } from '/shared/eml/size-check.js';

const MAX_WARN_MB = 25;
const MAX_HARD_MB = 100;

const statusEl = document.getElementById('status');
const convertBtn = document.getElementById('convertBtn');
const resultsEl = document.getElementById('resultsSection');
const progressContainer = document.getElementById('progressContainer');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');

let selectedFiles = [];
let previewRecord = null;
let previewBlobUrls = [];

function readOptions() {
    return Object.assign({}, DEFAULT_OPTIONS, {
        theme: document.querySelector('input[name="theme"]:checked').value,
        appendAttachments: document.getElementById('optAppend').checked,
        zipOtherAttachments: document.getElementById('optZip').checked,
        certificate: document.getElementById('optCertificate').checked,
        rawHeaderAppendix: document.getElementById('optHeaders').checked,
        hashes: document.getElementById('optHashes').checked,
        embedSource: document.getElementById('optEmbed').checked
    });
}

function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderPreview(record) {
    // Revoke the previous render's blob URLs before creating a fresh set —
    // switching the style radio re-renders the preview, and without this
    // each switch would leak another set of object URLs for the tab's life.
    for (const url of previewBlobUrls) URL.revokeObjectURL(url);
    previewBlobUrls = [];

    const source = record.bodyPartUsed === 'html'
        ? htmlToBlocks(sanitizeHtml(record.bodyHtml, record.inlineImages).body)
        : record.bodyPartUsed === 'text'
            ? textToBlocks(record.bodyText)
            : [];

    const addr = (list) => (list || [])
        .map((a) => a.name ? a.name + ' <' + a.address + '>' : a.address).join(', ');

    const header =
        '<div class="eml-preview-header">' +
          '<div class="eml-preview-subject">' +
            escapeHtml(record.subject || '(no subject)') + '</div>' +
          '<div class="eml-preview-from">' +
            escapeHtml(record.from ? (record.from.name || record.from.address)
                                   : '(unknown sender)') + '</div>' +
          '<div class="eml-preview-meta">' +
            escapeHtml(record.from ? record.from.address : '') + '</div>' +
          '<div class="eml-preview-meta">to ' +
            escapeHtml(addr(record.to) || '(undisclosed recipients)') + '</div>' +
          (record.cc.length
            ? '<div class="eml-preview-meta">cc ' + escapeHtml(addr(record.cc)) + '</div>'
            : '') +
          '<div class="eml-preview-meta">' +
            escapeHtml(record.date.raw || '(no date header)') + '</div>' +
        '</div>';

    document.getElementById('preview').innerHTML =
        header + blocksToHtml(source, { images: record.inlineImages, createdUrls: previewBlobUrls });
    document.getElementById('previewNote').textContent =
        selectedFiles.length > 1
            ? 'Showing the first of ' + selectedFiles.length + ' emails.'
            : '';
    document.getElementById('previewSection').classList.remove('hidden');
}

async function onFilesSelected(files, zone) {
    selectedFiles = Array.from(files);
    convertBtn.disabled = selectedFiles.length === 0;
    resultsEl.classList.add('hidden');
    resultsEl.innerHTML = '';

    const sizes = sizeCheck(selectedFiles, MAX_WARN_MB, MAX_HARD_MB);
    // A refusal stays on the status line when the rest of the batch is
    // ready, so the user is not left wondering where a file went.
    let refusedNote = '';
    if (sizes.refused.length) {
        statusEl.className = 'status status-error';
        statusEl.textContent = sizes.refused.length + ' file(s) exceed the ' +
            MAX_HARD_MB + ' MB limit and cannot be converted in a browser tab.';
        refusedNote = statusEl.textContent + ' ';
        selectedFiles = sizes.accepted;
        convertBtn.disabled = selectedFiles.length === 0;
        // The drop zone accepted the whole selection (it has no cap of
        // its own, see initFileDropZone below); without this its check
        // mark and total would vouch for the files just refused.
        const tooLarge = sizes.refused.length + ' file(s) too large to convert';
        if (!selectedFiles.length) zone.showError(tooLarge);
        else zone.showWarning(selectedFiles.length + ' ready · ' + tooLarge);
    }

    if (!selectedFiles.length) {
        // Nothing left to convert: drop the previous email's preview too.
        previewRecord = null;
        for (const url of previewBlobUrls) URL.revokeObjectURL(url);
        previewBlobUrls = [];
        document.getElementById('previewSection').classList.add('hidden');
        return;
    }

    try {
        const first = selectedFiles[0];
        const bytes = new Uint8Array(await first.arrayBuffer());
        previewRecord = await parseEml(bytes, { filename: first.name });
        renderPreview(previewRecord);
        const ready = selectedFiles.length === 1
            ? 'Ready to convert 1 email.'
            : 'Ready to convert ' + selectedFiles.length + ' emails.';
        if (sizes.large.length) {
            // A refusal outranks the warning; keep its red.
            statusEl.className = refusedNote ? 'status status-error' : 'status status-warning';
            statusEl.textContent = refusedNote + ready + ' ' + sizes.large.length +
                ' file(s) are over ' + MAX_WARN_MB +
                ' MB and may take a while to convert in the browser.';
        } else if (refusedNote) {
            statusEl.textContent = refusedNote + ready;
        } else {
            statusEl.className = 'status';
            statusEl.textContent = ready;
        }
    } catch (err) {
        statusEl.className = 'status status-error';
        statusEl.textContent = refusedNote + 'Could not read that file: ' + err.message;
    }
}

// Re-render the preview when the style changes so the choice is visible
// before committing to a conversion.
for (const radio of document.querySelectorAll('input[name="theme"]')) {
    radio.addEventListener('change', () => { if (previewRecord) renderPreview(previewRecord); });
}

initFileDropZone('dropZone', {
    accept: ['.eml'],
    multiple: true,
    // No cap here: the drop zone would refuse the whole selection with a
    // generic message before onFilesSelected could drop just the oversize
    // files and say why. Its 2 GB browser limit still applies.
    maxSizeMB: 0,
    sizeWarnings: false,
    onFiles: onFilesSelected
});

function addResultRow({ name, note, state }) {
    const row = document.createElement('div');
    row.className = 'eml-result-row' +
        (state === 'error' ? ' is-error' : state === 'defect' ? ' is-defect' : '');
    row.innerHTML = '<span class="eml-result-name">' + escapeHtml(name) + '</span>' +
                    '<span class="eml-result-note">' + escapeHtml(note) + '</span>';
    resultsEl.appendChild(row);
    resultsEl.classList.remove('hidden');
}

convertBtn.addEventListener('click', async () => {
    const options = readOptions();
    convertBtn.disabled = true;
    resultsEl.innerHTML = '';
    progressContainer.classList.remove('hidden');
    progressBar.style.width = '0%';

    const taken = new Set();
    const zipEntries = [];
    const pdfEntries = [];
    let successCount = 0;

    const combined = document.querySelector('input[name="output"]:checked').value === 'combined';

    if (combined) {
        const records = [];
        for (let i = 0; i < selectedFiles.length; i++) {
            const file = selectedFiles[i];
            progressText.textContent = 'Reading ' + (i + 1) + ' of ' + selectedFiles.length;
            progressBar.style.width = Math.round((i / selectedFiles.length) * 50) + '%';
            try {
                records.push(await parseEml(
                    new Uint8Array(await file.arrayBuffer()), { filename: file.name }));
            } catch (err) {
                // A file that cannot be parsed is reported and skipped; the
                // remaining messages still produce a usable combined exhibit.
                addResultRow({ name: file.name, note: 'failed — ' + err.message, state: 'error' });
            }
        }

        if (!records.length) {
            progressContainer.classList.add('hidden');
            statusEl.className = 'status status-error';
            statusEl.textContent =
                'No files could be converted. See the errors above.';
            convertBtn.disabled = false;
            return;
        }

        progressText.textContent = 'Building combined PDF';
        progressBar.style.width = '75%';

        // The parse loop above isolates each file, but a throw while
        // DRAWING rejected this call and left the progress bar frozen
        // at 75% with Convert still disabled — no path forward but a
        // reload. Spec §7: one malformed .eml must never kill a batch.
        let out;
        try {
            out = await convertBatchCombined(records, options);
        } catch (err) {
            progressContainer.classList.add('hidden');
            statusEl.className = 'status status-error';
            statusEl.textContent =
                'The combined PDF could not be built: ' + err.message +
                ' Converting to one PDF per email may still work.';
            addResultRow({ name: 'combined-emails.pdf',
                           note: 'failed — ' + err.message, state: 'error' });
            convertBtn.disabled = false;
            return;
        }

        const name = 'combined-emails.pdf';
        downloadPdf(out.bytes, name);
        if (typeof sessionFiles !== 'undefined') {
            sessionFiles.add(name,
                new Blob([out.bytes], { type: 'application/pdf' }), 'email-to-pdf');
        }
        addResultRow({ name, note: out.pageCount + ' pages · ' +
            out.perEmail.length + ' messages', state: 'ok' });
        // Already namespaced per message by convertBatchCombined, in
        // folders unique across the batch, so entries from two messages
        // attaching the same filename — even two inputs that share a
        // filename — no longer overwrite each other in the ZIP.
        for (const entry of out.zipFiles) zipEntries.push(entry);

        if (options.zipOtherAttachments && zipEntries.length) {
            const zip = new JSZip();
            for (const entry of zipEntries) zip.file(entry.name, entry.bytes);
            const blob = await zip.generateAsync({ type: 'blob' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'email-attachments.zip';
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            addResultRow({ name: 'email-attachments.zip',
                           note: zipEntries.length + ' attachment(s)', state: 'ok' });
        }

        progressBar.style.width = '100%';
        progressText.textContent = 'Done';
        statusEl.className = 'status status-success';
        statusEl.textContent = 'Conversion complete.';
        showPipelineSuggestions('email-to-pdf');
        convertBtn.disabled = false;
        return;
    }

    for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        progressText.textContent = 'Converting ' + (i + 1) + ' of ' + selectedFiles.length;
        progressBar.style.width = Math.round((i / selectedFiles.length) * 100) + '%';

        try {
            const bytes = new Uint8Array(await file.arrayBuffer());
            const record = await parseEml(bytes, { filename: file.name });
            const out = await convertEmail(record, options);
            const name = outputFilename(record, taken);

            // Browsers block a page that starts several downloads in a
            // row, so a batch is delivered as one ZIP. A single file
            // downloads directly, which is what a one-off conversion wants.
            if (selectedFiles.length === 1) {
                downloadPdf(out.bytes, name);
            } else {
                pdfEntries.push({ name, bytes: out.bytes });
            }
            if (typeof sessionFiles !== 'undefined') {
                sessionFiles.add(name,
                    new Blob([out.bytes], { type: 'application/pdf' }), 'email-to-pdf');
            }

            for (const entry of out.zipFiles) {
                zipEntries.push({ name: name.replace(/\.pdf$/, '') + '/' + entry.name,
                                  bytes: entry.bytes });
            }

            const defectCount = out.summary.defects.length;
            addResultRow({
                name,
                note: out.pageCount + ' pages' +
                      (defectCount ? ' · ' + defectCount + ' defect(s) noted on the certificate' : ''),
                state: defectCount ? 'defect' : 'ok'
            });
            successCount++;
        } catch (err) {
            // One bad file never stops the batch.
            addResultRow({ name: file.name, note: 'failed — ' + err.message, state: 'error' });
        }
    }

    if (!successCount) {
        progressContainer.classList.add('hidden');
        statusEl.className = 'status status-error';
        statusEl.textContent = 'No files could be converted. See the errors above.';
        convertBtn.disabled = false;
        return;
    }

    if (pdfEntries.length) {
        const zip = new JSZip();
        for (const entry of pdfEntries) zip.file(entry.name, entry.bytes);
        const blob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'converted-emails.zip';
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        addResultRow({ name: 'converted-emails.zip',
                       note: pdfEntries.length + ' PDF(s)', state: 'ok' });
    }

    if (options.zipOtherAttachments && zipEntries.length) {
        const zip = new JSZip();
        for (const entry of zipEntries) zip.file(entry.name, entry.bytes);
        const blob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'email-attachments.zip';
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        addResultRow({ name: 'email-attachments.zip',
                       note: zipEntries.length + ' attachment(s)', state: 'ok' });
    }

    progressBar.style.width = '100%';
    progressText.textContent = 'Done';
    statusEl.className = 'status status-success';
    statusEl.textContent = 'Conversion complete.';
    showPipelineSuggestions('email-to-pdf');
    convertBtn.disabled = false;
});
