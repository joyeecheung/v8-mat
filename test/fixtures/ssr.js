'use strict';

const inspector = require('inspector');
const fs = require('fs');
const session = new inspector.Session();
session.connect();

const TIME = parseInt(process.argv[2] || 5);

function run() {
  const componentMap = new Map();
  class Component {
    constructor(id) {
      this.id = id;
      this.text = id.repeat(1e3);
    }

    render() {
      return `<p>${this.text}</p>`;
    }

    componentWillMount() {
      componentMap.set(this.id, this);
    }
  }

  const http = require('http');
  const hostname = '127.0.0.1';
  const port = 3000;

  const server = http.createServer((req, res) => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html');
    const component = new Component(req.url);
    component.componentWillMount();
    const html = component.render();
    res.end(html);
  });

  function request() {
    const req = http.get({
      hostname,
      port,
      path: '/' + Math.random().toString(16).slice(2)
    }, (res) => {
      let rawData = '';
      res.on('data', (chunk) => {
        rawData += chunk;
      });
      res.on('end', () => {
        ;
      });
      res.on('error', (e) => {
        console.error(e);
      });
    });
    req.end();
  }

  return new Promise((resolve, reject) => {
    let interval;
    server.listen(port, hostname, (err) => {
      if (err) {
        reject(err);
      }
      interval = setInterval(request, 1);
      resolve({
        componentMap, interval, server
      });
    });
  });
}

function teardown({ interval, componentMap, server }) {
  clearInterval(interval);
  setTimeout(() => {
    server.close(() => {
    });
  }, 1 * 1000);
  console.log(componentMap.size);
}

run().then((result) => {
  setTimeout(() => {
    let buf = '';
    session.on('HeapProfiler.addHeapSnapshotChunk', function(res) {
      buf += res.params.chunk;
    });
    session.post('HeapProfiler.takeHeapSnapshot', () => {
      const file = './ssr.heapsnapshot';
      fs.writeFileSync(file, buf);
      console.log(`Written snapshot to ${file}`);
      teardown(result);
    });
  }, TIME * 1000);
});
