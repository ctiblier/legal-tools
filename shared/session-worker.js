// SharedWorker script — minimal blob store for cross-page file passing
// Operations: add, get, getAll, clear
// Messages are passed via port.postMessage({ op, ... })

'use strict';

var store = {}; // key (index string) → { name, blob, size, addedFrom, timestamp }
var nextId = 0;

self.addEventListener('connect', function (e) {
  var port = e.ports[0];

  port.addEventListener('message', function (evt) {
    var msg = evt.data;
    if (!msg || !msg.op) return;

    switch (msg.op) {
      case 'add': {
        var id = nextId++;
        store[id] = {
          id: id,
          name: msg.name,
          blob: msg.blob,
          size: msg.size,
          addedFrom: msg.addedFrom,
          timestamp: msg.timestamp || Date.now()
        };
        // Enforce max 10 entries — evict oldest by id
        var ids = Object.keys(store).map(Number).sort(function (a, b) { return a - b; });
        while (ids.length > 10) {
          delete store[ids.shift()];
        }
        port.postMessage({ op: 'added', id: id });
        break;
      }

      case 'get': {
        var entry = store[msg.id] || null;
        port.postMessage({ op: 'got', id: msg.id, entry: entry });
        break;
      }

      case 'getAll': {
        var all = Object.keys(store).map(Number).sort(function (a, b) { return a - b; }).map(function (id) {
          return store[id];
        });
        port.postMessage({ op: 'gotAll', entries: all });
        break;
      }

      case 'remove': {
        delete store[msg.id];
        port.postMessage({ op: 'removed', id: msg.id });
        break;
      }

      case 'clear': {
        store = {};
        port.postMessage({ op: 'cleared' });
        break;
      }

      default:
        port.postMessage({ op: 'error', message: 'Unknown op: ' + msg.op });
    }
  });

  port.start();
});
