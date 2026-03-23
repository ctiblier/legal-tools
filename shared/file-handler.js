// Shared file handler — drag-and-drop upload, validation, and download utilities
// Exposes globals: initFileDropZone, formatFileSize, downloadPdf, readFileAsArrayBuffer
// No ES modules — loaded via <script> tag.

(function () {
  'use strict';

  var uploadSvg =
    '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>' +
    '<polyline points="14 2 14 8 20 8"/>' +
    '<line x1="12" y1="18" x2="12" y2="12"/>' +
    '<polyline points="9 15 12 12 15 15"/>' +
    '</svg>';

  var checkSvg =
    '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>' +
    '<polyline points="22 4 12 14.01 9 11.01"/>' +
    '</svg>';

  // -------------------------------------------------------------------------
  // formatFileSize(bytes) → human-readable string
  // -------------------------------------------------------------------------
  window.formatFileSize = function formatFileSize(bytes) {
    if (bytes < 1024) {
      return bytes + ' B';
    } else if (bytes < 1024 * 1024) {
      return (bytes / 1024).toFixed(1) + ' KB';
    } else if (bytes < 1024 * 1024 * 1024) {
      return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    } else {
      return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
    }
  };

  // -------------------------------------------------------------------------
  // downloadPdf(pdfBytes, filename) — triggers a browser download
  // pdfBytes: Uint8Array
  // -------------------------------------------------------------------------
  window.downloadPdf = function downloadPdf(pdfBytes, filename) {
    var blob = new Blob([pdfBytes], { type: 'application/pdf' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoke after a tick so the download can start
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 100);
  };

  // -------------------------------------------------------------------------
  // readFileAsArrayBuffer(file) → Promise<ArrayBuffer>
  // -------------------------------------------------------------------------
  window.readFileAsArrayBuffer = function readFileAsArrayBuffer(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function (e) {
        resolve(e.target.result);
      };
      reader.onerror = function () {
        reject(new Error('Failed to read file: ' + file.name));
      };
      reader.readAsArrayBuffer(file);
    });
  };

  // -------------------------------------------------------------------------
  // initFileDropZone(dropZoneId, options)
  //
  // options: {
  //   accept:    ['.pdf']           // allowed extensions (lower-case, with dot)
  //   multiple:  false              // allow multiple files
  //   maxSizeMB: 100                // max size per file, in MB
  //   onFile:    (file) => {}       // called in single-file mode
  //   onFiles:   (files) => {}      // called in multiple-file mode
  // }
  // -------------------------------------------------------------------------
  window.initFileDropZone = function initFileDropZone(dropZoneId, options) {
    options = options || {};

    var accept    = options.accept    || [];
    var multiple  = !!options.multiple;
    var maxSizeMB = (options.maxSizeMB != null) ? options.maxSizeMB : 100;
    var onFile    = options.onFile    || null;
    var onFiles   = options.onFiles   || null;

    var dropZone = document.getElementById(dropZoneId);
    if (!dropZone) {
      console.warn('initFileDropZone: element not found: #' + dropZoneId);
      return;
    }

    // Find child elements by class — supports multiple drop zones on one page
    var fileInput = dropZone.querySelector('input[type="file"]');
    var iconEl    = dropZone.querySelector('.drop-zone-icon');
    var textEl    = dropZone.querySelector('.drop-zone-text');
    var hintEl    = dropZone.querySelector('.drop-zone-hint');

    // Persist the original hint text so reset can restore it
    var originalText = textEl ? textEl.textContent : '';
    var originalHint = hintEl ? hintEl.textContent : '';

    // ------------------------------------------------------------------
    // Validation
    // ------------------------------------------------------------------

    /**
     * Returns null if the file passes all checks, or an error string.
     */
    function validate(file) {
      if (accept.length > 0) {
        var ext = '.' + file.name.split('.').pop().toLowerCase();
        var ok = accept.some(function (a) {
          return a.toLowerCase() === ext;
        });
        if (!ok) {
          return 'Invalid file type. Accepted: ' + accept.join(', ');
        }
      }

      if (maxSizeMB > 0 && file.size > maxSizeMB * 1024 * 1024) {
        return (
          'File is too large (' +
          window.formatFileSize(file.size) +
          '). Maximum allowed: ' + maxSizeMB + ' MB.'
        );
      }

      return null;
    }

    // ------------------------------------------------------------------
    // Error display
    // ------------------------------------------------------------------

    function showError(message) {
      if (textEl) {
        textEl.textContent = message;
        textEl.style.color = 'var(--error, #c53030)';
      }
      if (hintEl) {
        hintEl.textContent = '';
      }
      // Remove any success state
      dropZone.classList.remove('has-file');
      if (iconEl) {
        iconEl.innerHTML = uploadSvg;
        iconEl.style.color = 'var(--error, #c53030)';
      }
    }

    function clearError() {
      if (textEl) {
        textEl.style.color = '';
      }
      if (iconEl) {
        iconEl.style.color = '';
      }
    }

    // ------------------------------------------------------------------
    // UI update after successful file selection
    // ------------------------------------------------------------------

    function showSuccess(files) {
      dropZone.classList.add('has-file');
      clearError();
      if (iconEl) {
        iconEl.innerHTML = checkSvg;
        iconEl.style.color = '';
      }

      if (!multiple || files.length === 1) {
        // Single-file display: name on text line, size as hint
        var file = files[0];
        if (textEl) textEl.textContent = file.name;
        if (hintEl) hintEl.textContent = window.formatFileSize(file.size);
      } else {
        // Multiple-file display: count and total size
        var totalBytes = 0;
        for (var i = 0; i < files.length; i++) {
          totalBytes += files[i].size;
        }
        if (textEl) textEl.textContent = files.length + ' files selected';
        if (hintEl) hintEl.textContent = 'Total: ' + window.formatFileSize(totalBytes);
      }
    }

    function resetDisplay() {
      dropZone.classList.remove('has-file');
      clearError();
      if (iconEl) iconEl.innerHTML = uploadSvg;
      if (textEl) textEl.textContent = originalText;
      if (hintEl) hintEl.textContent = originalHint;
    }

    // ------------------------------------------------------------------
    // Process a FileList (from drop or input change)
    // ------------------------------------------------------------------

    function processFiles(fileList) {
      if (!fileList || fileList.length === 0) {
        resetDisplay();
        return;
      }

      // Validate every file
      for (var i = 0; i < fileList.length; i++) {
        var err = validate(fileList[i]);
        if (err) {
          showError(err);
          return;
        }
      }

      // Convert FileList to plain array for convenience
      var filesArray = Array.prototype.slice.call(fileList);

      showSuccess(filesArray);

      if (!multiple && onFile) {
        onFile(filesArray[0]);
      } else if (multiple && onFiles) {
        onFiles(filesArray);
      } else if (!multiple && onFiles) {
        // Caller passed onFiles even in single-file mode — support it
        onFiles(filesArray);
      } else if (multiple && onFile) {
        // Caller passed onFile in multiple mode — call for first file
        onFile(filesArray[0]);
      }
    }

    // ------------------------------------------------------------------
    // Configure the hidden file input
    // ------------------------------------------------------------------

    if (fileInput) {
      if (accept.length > 0) {
        fileInput.setAttribute('accept', accept.join(','));
      }
      if (multiple) {
        fileInput.setAttribute('multiple', '');
      }

      fileInput.addEventListener('change', function () {
        processFiles(this.files);
      });
    }

    // ------------------------------------------------------------------
    // Click-to-browse: clicking the drop zone triggers the file input.
    // The input itself is position:absolute/inset:0 and covers the zone,
    // so native click passthrough handles most cases, but we add an explicit
    // click listener as a belt-and-suspenders measure for elements that
    // might sit on top.
    // ------------------------------------------------------------------

    dropZone.addEventListener('click', function (e) {
      // Only trigger if not clicking directly on the input (avoid double open)
      if (fileInput && e.target !== fileInput) {
        fileInput.click();
      }
    });

    // ------------------------------------------------------------------
    // Drag-and-drop events
    // ------------------------------------------------------------------

    ['dragenter', 'dragover'].forEach(function (evt) {
      dropZone.addEventListener(evt, function (e) {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.add('drag-over');
      });
    });

    ['dragleave', 'drop'].forEach(function (evt) {
      dropZone.addEventListener(evt, function (e) {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove('drag-over');
      });
    });

    dropZone.addEventListener('drop', function (e) {
      var files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length > 0) {
        processFiles(files);
      }
    });
  };

}());

// -------------------------------------------------------------------------
// escapeHtml(str) — XSS-safe HTML entity encoding
// Escapes &, <, >, ", and ' (5 characters).
// Exposed as a global so all tool pages and session-files.js can share it.
// -------------------------------------------------------------------------
window.escapeHtml = function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};
