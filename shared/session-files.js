// Session File Manager
// Manages a session-scoped list of files the user has processed.
// Enables the cross-tool pipeline: output from one tool can be opened in another.
//
// Globals exposed: window.sessionFiles
// Depends on: formatFileSize (from file-handler.js, must be loaded first)
// No ES modules — loaded via <script> tag.
//
// Cross-page strategy:
//   Primary:  SharedWorker at /shared/session-worker.js holds blob references
//             across page navigations within the same origin.
//   Fallback: In-page only (blobs survive within a single page session).
//             When the user navigates away, files are lost; the UI shows a
//             "Re-upload to continue" message instead.

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // SharedWorker connection (best-effort)
  // ---------------------------------------------------------------------------

  var worker = null;          // SharedWorker instance
  var workerPort = null;      // MessagePort
  var workerReady = false;    // true once port is started
  var workerCallbacks = {};   // pending request callbacks keyed by a correlation id
  var workerCallbackId = 0;

  /**
   * Try to connect to the SharedWorker. Sets workerPort / workerReady.
   * Fails silently if SharedWorker is unsupported or the script is unavailable.
   */
  function connectWorker() {
    if (typeof SharedWorker === 'undefined') return;

    try {
      // Resolve the worker path relative to the origin so this works regardless
      // of which tool page loads this script.
      worker = new SharedWorker('/shared/session-worker.js');
      workerPort = worker.port;

      workerPort.addEventListener('message', function (evt) {
        var msg = evt.data;
        if (!msg) return;

        // Route responses to waiting callbacks
        if (msg._cbId !== undefined && workerCallbacks[msg._cbId]) {
          var cb = workerCallbacks[msg._cbId];
          delete workerCallbacks[msg._cbId];
          cb(msg);
          return;
        }

        // Unsolicited messages (add confirmation without a callback, etc.)
        // — nothing to do.
      });

      workerPort.addEventListener('messageerror', function () {
        // Serialisation error — blob transfer may have failed; mark worker gone.
        workerReady = false;
      });

      worker.addEventListener('error', function () {
        workerReady = false;
        worker = null;
        workerPort = null;
      });

      workerPort.start();
      workerReady = true;
    } catch (e) {
      // SharedWorker constructor threw (e.g. cross-origin script, CSP block)
      workerReady = false;
      worker = null;
      workerPort = null;
    }
  }

  /**
   * Send a message to the worker and receive the response via a callback.
   * @param {Object} msg
   * @param {Function} cb  called with the response message object
   */
  function workerSend(msg, cb) {
    if (!workerReady || !workerPort) {
      if (cb) cb(null);
      return;
    }
    var cbId = ++workerCallbackId;
    if (cb) workerCallbacks[cbId] = cb;
    msg._cbId = cbId;
    try {
      // Blob is cloneable via structured clone (not transferable), so no
      // transfer list is needed — postMessage handles it correctly.
      workerPort.postMessage(msg);
    } catch (e) {
      // postMessage failed (e.g. blob too large, browser limit)
      if (cb) {
        delete workerCallbacks[cbId];
        cb(null);
      }
    }
  }

  // Attempt connection immediately
  connectWorker();

  // ---------------------------------------------------------------------------
  // In-page store (authoritative for single-page use and fallback)
  // ---------------------------------------------------------------------------

  var inPageFiles = []; // Array of { name, blob, size, addedFrom, timestamp, workerId }
  var MAX_FILES = 10;

  // ---------------------------------------------------------------------------
  // Helper: read #session-file=N from the URL hash on page load
  // ---------------------------------------------------------------------------

  function readHashRequest() {
    var hash = window.location.hash; // e.g. "#session-file=3"
    var match = hash.match(/[#&]?session-file=(\d+)/);
    if (!match) return;

    var workerId = parseInt(match[1], 10);

    if (!workerReady) {
      // Worker unavailable — show re-upload message via a custom event
      document.dispatchEvent(new CustomEvent('session-file-unavailable'));
      return;
    }

    workerSend({ op: 'get', id: workerId }, function (msg) {
      if (!msg || !msg.entry) {
        document.dispatchEvent(new CustomEvent('session-file-unavailable'));
        return;
      }
      var entry = msg.entry;
      inPageFiles.push({
        name: entry.name,
        blob: entry.blob,
        size: entry.size,
        addedFrom: entry.addedFrom,
        timestamp: entry.timestamp,
        workerId: entry.id
      });
      document.dispatchEvent(new CustomEvent('session-file-ready', {
        detail: { blob: entry.blob, name: entry.name, index: inPageFiles.length - 1 }
      }));
      // Clean the hash so refresh doesn't re-trigger
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    });
  }

  // Run once DOM is interactive
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', readHashRequest);
  } else {
    readHashRequest();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  var sessionFiles = {

    /**
     * All files in the current session (in-page store).
     * Array of { name, blob, size, addedFrom, timestamp }
     */
    files: inPageFiles,

    /**
     * Add a processed file to the session list.
     * Enforces a maximum of MAX_FILES entries (FIFO — oldest drops when 11th added).
     *
     * @param {string} name      - File name (e.g. "document-stamped.pdf")
     * @param {Blob}   blob      - The file Blob
     * @param {string} fromTool  - Tool id that produced this file (e.g. "bates-stamp")
     */
    add: function (name, blob, fromTool) {
      var entry = {
        name: name,
        blob: blob,
        size: blob.size,
        addedFrom: fromTool,
        timestamp: Date.now(),
        workerId: null
      };

      inPageFiles.push(entry);

      // Enforce max
      while (inPageFiles.length > MAX_FILES) {
        inPageFiles.shift();
      }

      // Persist to SharedWorker asynchronously
      if (workerReady) {
        workerSend({
          op: 'add',
          name: name,
          blob: blob,
          size: blob.size,
          addedFrom: fromTool,
          timestamp: entry.timestamp
        }, function (msg) {
          if (msg && msg.op === 'added') {
            entry.workerId = msg.id;
          }
        });
      }
    },

    /**
     * Remove a file by its index in the in-page list.
     * @param {number} index
     */
    remove: function (index) {
      if (index < 0 || index >= inPageFiles.length) return;
      var removed = inPageFiles.splice(index, 1)[0];

      // Also remove from worker store if we have the id
      if (workerReady && removed.workerId !== null) {
        workerSend({ op: 'remove', id: removed.workerId }, null);
      }
    },

    /**
     * Return all files in the session list.
     * @returns {Array}
     */
    getAll: function () {
      return inPageFiles.slice();
    },

    /**
     * Remove all files.
     */
    clear: function () {
      inPageFiles.length = 0;
      if (workerReady) {
        workerSend({ op: 'clear' }, null);
      }
    },

    /**
     * Return a single file entry by index, or null.
     * @param {number} index
     * @returns {Object|null}
     */
    getFile: function (index) {
      if (index < 0 || index >= inPageFiles.length) return null;
      return inPageFiles[index];
    },

    /**
     * Navigate the current page to a target tool, passing the file at `index`
     * via the SharedWorker + URL hash.
     *
     * If the worker is unavailable, sets window.location directly without the
     * hash so the target tool shows "Re-upload to continue".
     *
     * @param {number} index     - Index in inPageFiles
     * @param {string} toolPath  - e.g. "/compressor/"
     */
    openInTool: function (index, toolPath) {
      var entry = this.getFile(index);
      if (!entry) return;

      if (workerReady && entry.workerId !== null) {
        window.location.href = toolPath + '#session-file=' + entry.workerId;
      } else if (workerReady && entry.workerId === null) {
        // Worker is up but add() hasn't resolved yet — add now, then navigate.
        workerSend({
          op: 'add',
          name: entry.name,
          blob: entry.blob,
          size: entry.size,
          addedFrom: entry.addedFrom,
          timestamp: entry.timestamp
        }, function (msg) {
          if (msg && msg.op === 'added') {
            entry.workerId = msg.id;
            window.location.href = toolPath + '#session-file=' + entry.workerId;
          } else {
            window.location.href = toolPath;
          }
        });
      } else {
        // No worker — navigate without hash; target tool will prompt re-upload
        window.location.href = toolPath;
      }
    },

    /**
     * Render a compact dropdown UI into a container element.
     *
     * @param {string}   containerId  - ID of the wrapper element
     * @param {Function} onSelect     - callback(blob, name) when user picks a file
     *
     * The container is hidden when there are no files.
     * Call this again after add/remove to refresh the UI.
     */
    renderDropdown: function (containerId, onSelect) {
      var container = document.getElementById(containerId);
      if (!container) return;

      var files = inPageFiles;

      if (files.length === 0) {
        container.style.display = 'none';
        container.innerHTML = '';
        return;
      }

      container.style.display = '';

      // Build item HTML
      var itemsHtml = files.map(function (f, i) {
        var sizeStr = (typeof window.formatFileSize === 'function')
          ? window.formatFileSize(f.size)
          : (f.size ? Math.round(f.size / 1024) + ' KB' : '');

        var fromLabel = f.addedFrom ? 'from ' + f.addedFrom : '';

        // Escape user-provided strings to avoid XSS
        var safeName = escapeHtml(f.name);
        var safeFrom = escapeHtml(fromLabel);

        return (
          '<div class="session-file-item" data-index="' + i + '" role="button" tabindex="0" ' +
          'aria-label="Use ' + safeName + '">' +
          '<span class="session-file-name" title="' + safeName + '">' + safeName + '</span>' +
          '<span class="session-file-size">' + sizeStr + '</span>' +
          (safeFrom ? '<span class="session-file-from">' + safeFrom + '</span>' : '') +
          '</div>'
        );
      }).join('');

      var label = files.length === 1 ? 'Recent File (1)' : 'Recent Files (' + files.length + ')';

      var html = (
        '<div class="session-files-dropdown">' +
        '<button class="session-files-toggle" aria-expanded="false" aria-haspopup="listbox">' +
        label + ' \u25be' +
        '</button>' +
        '<div class="session-files-list" role="listbox" aria-label="Recent files">' +
        itemsHtml +
        '</div>' +
        '</div>'
      );

      container.innerHTML = html;

      // Wire up toggle
      var toggle = container.querySelector('.session-files-toggle');
      var list = container.querySelector('.session-files-list');

      toggle.addEventListener('click', function (e) {
        e.stopPropagation();
        var open = list.classList.contains('open');
        list.classList.toggle('open', !open);
        toggle.setAttribute('aria-expanded', String(!open));
      });

      // Close on outside click
      function closeOnOutside(e) {
        if (!container.contains(e.target)) {
          list.classList.remove('open');
          toggle.setAttribute('aria-expanded', 'false');
        }
      }
      document.addEventListener('click', closeOnOutside);

      // Close on Escape
      container.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          list.classList.remove('open');
          toggle.setAttribute('aria-expanded', 'false');
          toggle.focus();
        }
      });

      // Handle item clicks (and keyboard Enter/Space)
      list.addEventListener('click', function (e) {
        var item = e.target.closest('.session-file-item');
        if (!item) return;
        var idx = parseInt(item.getAttribute('data-index'), 10);
        var entry = files[idx];
        if (entry && typeof onSelect === 'function') {
          list.classList.remove('open');
          toggle.setAttribute('aria-expanded', 'false');
          onSelect(entry.blob, entry.name);
        }
      });

      list.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        var item = e.target.closest('.session-file-item');
        if (!item) return;
        e.preventDefault();
        var idx = parseInt(item.getAttribute('data-index'), 10);
        var entry = files[idx];
        if (entry && typeof onSelect === 'function') {
          list.classList.remove('open');
          toggle.setAttribute('aria-expanded', 'false');
          onSelect(entry.blob, entry.name);
        }
      });
    }
  };

  // ---------------------------------------------------------------------------
  // XSS escape helper
  // ---------------------------------------------------------------------------

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ---------------------------------------------------------------------------
  // Expose global
  // ---------------------------------------------------------------------------

  window.sessionFiles = sessionFiles;

}());
