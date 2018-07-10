'use strict';

const heapSnapshotWorkerShim = require('./shim');

class HeapSnapshotAnalyzer {
  constructor() {
    this.snapshot = null;
    this.suspects = [];
  }

  loadStream(stream, debug) {
    return heapSnapshotWorkerShim(stream, debug).then((snapshot) => {
      this.snapshot = snapshot;
    });
  }

  analyze() {
    return this.suspects;
  }
}

module.exports = HeapSnapshotAnalyzer;
