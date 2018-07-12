'use strict';

const { HeapSnapshotLoader } = require('./third_party/heap_snapshot_worker/HeapSnapshotLoader');
const { HeapSnapshotWorkerDispatcher } = require('./third_party/heap_snapshot_worker/HeapSnapshotWorkerDispatcher');
const EventEmitter = require('events');

function heapSnapshotWorkerShim(stream, debug) {
  return new Promise((resolve, reject) => {
    const self = new EventEmitter();

    function postMessage(message) {
      self.emit('message', message);
    }
  
    self.on('message', function(message) {
      debug(message);
    });
  
    // ===== Refs: HeapSnapshotWorker.js ====
    function postMessageWrapper(message) {
      postMessage(message);
    }
  
    const dispatcher = new HeapSnapshotWorkerDispatcher(this, postMessageWrapper);
  
    /**
     * @param {function(!Event)} listener
     * @suppressGlobalPropertiesCheck
     */
    function installMessageEventListener(listener) {
      self.on('message', listener);
    }
  
    installMessageEventListener(dispatcher.dispatchMessage.bind(dispatcher));
  
    // ==== endRefs: HeapSnapshotWorker.js =====
    const loader = new HeapSnapshotLoader();
  
    stream.on('error', (err) => {
      reject(err);
    });
  
    stream.on('data', (chunk) => {
      loader.write(chunk);
    });
  
    stream.on('end', () => {
      loader.close();
      const snapshot = loader.buildSnapshot();
      snapshot.updateStaticData();
      resolve(snapshot);
    });
  });
};

module.exports = heapSnapshotWorkerShim;
