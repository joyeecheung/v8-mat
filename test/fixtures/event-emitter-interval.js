'use strict';

const inspector = require('inspector');
const fs = require('fs');
const EventEmitter = require('events');
const session = new inspector.Session();
session.connect();

const TIME = parseInt(process.argv[2] || 10);

function randomString() {
  return Math.random().toFixed(16).slice(2);
}

function run() {
  function closureFactory() {
    const hugeString = 'x'.repeat(1e6);

    function unused() {
      return hugeString;
    }

    return function createdClosure() {
      // This is a bug of the VM
      return 'I retain the hugeString even though I do not reference it';
    };
  }
  const emitter = new EventEmitter();
  const interval = setInterval(function onInterval() {
    emitter.on(randomString(), closureFactory());
  }, 2);
  return Promise.resolve({
    interval,
    emitter
  });
}

function teardown({ interval, emitter }) {
  clearInterval(interval);
  console.log(emitter.eventNames().length);
}

run().then(function onFullFilled(result) {
  setTimeout(() => {
    let buf = '';
    session.on('HeapProfiler.addHeapSnapshotChunk', function(res) {
      buf += res.params.chunk;
    });
    session.post('HeapProfiler.takeHeapSnapshot', () => {
      const file = './event-emitter-interval.heapsnapshot';
      fs.writeFileSync(file, buf);
      console.log(`Written snapshot to ${file}`);
      teardown(result);
    });
  }, TIME * 1000);
});
