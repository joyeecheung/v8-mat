'use strict';

const fs = require('fs');
const promisify = require('util').promisify;
const tap = require('tap');
const path = require('path');
const readFile = promisify(fs.readFile);

const HeapSnapshotAnalyzer = require('../');

function fixturePath(...args) {
  return path.join(__dirname, 'fixtures', ...args);
}

function raw(obj) {
  return JSON.parse(JSON.stringify(obj));
}
async function assertResultMatch(t, caseName) {
  const stream = fs.createReadStream(fixturePath(`${caseName}.heapsnapshot`));
  stream.setEncoding('utf8');
  const analyzer = new HeapSnapshotAnalyzer();
  await analyzer.loadStream(stream, () => {});

  const actual = raw(analyzer.analyze());
  const expectedFile = await readFile(fixturePath(`${caseName}.json`));
  const expected = JSON.parse(expectedFile);

  t.deepEqual(actual, expected);
}

tap.test('ssr', async function (t) {
  return assertResultMatch(t, 'ssr');
});

tap.test('meteor', async function (t) {
  return assertResultMatch(t, 'meteor');
});

tap.test('event-emitter', async function (t) {
  return assertResultMatch(t, 'event-emitter');
});

tap.test('event-emitter-interval', async function (t) {
  return assertResultMatch(t, 'event-emitter-interval');
});
