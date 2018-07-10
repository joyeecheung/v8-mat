'use strict';

const inspector = require('inspector');
const fs = require('fs');
const session = new inspector.Session();
session.connect();

const TIME = parseInt(process.argv[2] || 10);

function run() {
  function makeLeaker () {
    var HUGE_1MB = "x".repeat(1e6);
 
    function promoter () {
      // promote HUGE_1MB to be context-allocated by referencing it in an inner function
      return HUGE_1MB;
    }
 
    return function closureA () {
      return "I retain makeLeaker's context";
    };
  }
  var i = 1e4;
  var leakedArray = [];
  while (i--) {
    leakedArray[i] = makeLeaker();
  }
  return Promise.resolve({
    leakedArray
  });
}

function teardown({ leakedArray }) {
  console.log(leakedArray.length);
}

run().then((result) => {
  setTimeout(() => {
    let buf = '';
    session.on('HeapProfiler.addHeapSnapshotChunk', function(res) {
      buf += res.params.chunk;
    });
    session.post('HeapProfiler.takeHeapSnapshot', () => {
      const file = './closure.heapsnapshot';
      fs.writeFileSync(file, buf);
      console.log(`Written snapshot to ${file}`);
      teardown(result);
    });
  }, TIME * 1000);
});
