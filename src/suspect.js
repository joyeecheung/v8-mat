'use strict';

const { JSHeapSnapshotNode, JSHeapSnapshotEdge } = require('./third_party/heap_snapshot_worker/HeapSnapshot');

const noop = () => {};

JSHeapSnapshotNode.prototype.toJSON = function() {
  return {
    nodeIndex: this.nodeIndex,
    name: this.name(),
    type: this.type(),
    description: describeNode(this),
    edgesCount: this.edgesCount(),
    retainedSize: this.retainedSize(),
    selfSize: this.selfSize(),
    id: this.id()
  }
}

JSHeapSnapshotEdge.prototype.toJSON = function() {
  return {
    type: this.type(),
    edgeIndex: this.edgeIndex,
    description: this.toString()
  }
}

class LeakPathNode {
  constructor(node, edge = null) {
    this.node = node;
    this.edge = edge ? edge.clone() : null;
  }
}

class LeakPath {
  constructor(head) {
    this.current = 0;
    this.path = [ new LeakPathNode(head) ];
    this.suspect = 0;
    this.accumulationPoint = 0;
    this.reachedMaxDepth = false;
  }

  add(edge, child) {
    this.path[this.current].edge = edge;
    this.path.push(new LeakPathNode(child));
    this.current++;
  }

  end() {
    this.accumulationPoint = this.current;
  }
}

const CONTEXT_CLASS = 'system / Context';

function isContextNode(node) {
  return node.name() === CONTEXT_CLASS;
}

function findChildByEdgeName(node, name) {
  for (let iter = node.edges(); iter.hasNext(); iter.next()) {
    const edge = iter.edge;
    if (edge.name() === name) {
      return edge.node();
    }
  }
  return null;
}

function isClosureNode(node) {
  return node.type() === CLOSURE_TYPE;
}

class JSHeapSnapshotContextNode extends JSHeapSnapshotNode {
  constructor(original) {
    if (!isContextNode(original)) {
      throw new Error('Not a context node');
    }
    super(original._snapshot, original.nodeIndex);
  }

  closure() {
    // TODO: in V8 6.8+ the closure slot is removed.
    // The replacement, scope_info, only contains the
    // function name for now.
    const result = findChildByEdgeName(this, 'closure');
    if (result && isClosureNode(result)) {
      return new JSHeapSnapshotClosureNode(result);
    }
    return null;
  }

  shared() {
    const closure = this.closure();
    if (!closure) { return null; }
    return closure.shared();
  }

  functionName() {
    const closure = this.closure();
    if (!closure) { return ''; }
    return closure.functionName();
  }

  functionScript() {
    const closure = this.closure();
    if (!closure) { return ''; }
    return closure.functionScript();
  }
}

const CLOSURE_TYPE = 'closure';

class JSHeapSnapshotClosureNode extends JSHeapSnapshotNode {
  constructor(original) {
    if (!isClosureNode(original)) {
      throw new Error(`Not a closure node: (${original.type()})`);
    }
    super(original._snapshot, original.nodeIndex);
  }

  shared() {
    return findChildByEdgeName(this, 'shared');
  }

  functionName() {
    const name = this.name();
    return `${name ? name : '<anonymous>' }()`;
  }

  functionScript() {
    const shared = this.shared();
    if (!shared) { return ''; }
    const script = findChildByEdgeName(shared, 'script');
    return script.name();
  }
}

function formatSize(num, precision = 4) {
  if (num < 1024) {
    return `${(num).toFixed(precision)}B`;
  } else if (num < 1024 ** 2) {
    return `${(num / 1024).toFixed(precision)}KB`;
  } else if (num < 1024 ** 3) {
    return `${(num / (1024 ** 2)).toFixed(precision)}MB`;
  } else {
    return `${(num / (1024 ** 3)).toFixed(precision)}GB`;
  }
}

function describeNode(node) {
  let result = `${formatSize(node.retainedSize())} ${node.name()}`;
  if (isContextNode(node)) {
    const context = new JSHeapSnapshotContextNode(node);
    result += `@${node.id()}\n(context of ${context.functionName()} ${context.functionScript()})`;
  } else if (isClosureNode(node)) {
    const closure = new JSHeapSnapshotClosureNode(node);
    result += `@${node.id()}\n(closure of ${closure.functionName()} ${closure.functionScript()})`;
  } else {
    result += `(${node.className()}) @${node.id()}`;
  }
  return result;
}

class SuspectRecord {
  /**
   * @param {!HeapSnapshotWorker.JSHeapSnapshotNode} suspect 
   * @param {!number} suspectRetained 
   * @param {!AccumulationPoint} accumulationPoint 
   */
  constructor(suspect, suspectRetained, accumulationPoint) {
    this.suspect = suspect;
    this.suspectRetained = suspectRetained;
    this.accumulationPoint = accumulationPoint;
    this.visited = new Set();
    this.log = noop;
  }

  setLog(log) {
    this.log = log;
  }

  getPath() {
    const visited = this.visited = new Set();
    const suspect = this.suspect;
    let current = suspect;

    const result = new LeakPath(current);
    result.suspect = 0;
    visited.add(current.id());
  
    this.log(`${describeNode(suspect)} <--- Suspect`);

    let accHint = ' <--- Accumulation Point';
    if (this.accumulationPoint.reachedMaxDepth) {
      result.reachedMaxDepth = true;
      accHint += ` (reached maximum depth)`;
    }

    const dest = this.accumulationPoint.object;
    if (suspect.id() === dest.id()) {
      this.log(`^`);
      this.log(`|`);
      this.log(`Accumulation Point`);
    } else {
      while (current.id() !== dest.id() && current.edgesCount() > 0) {
        const { edge, child } = this.findBiggestChild(current);
        if (!child) {
          this.log('...end...');
          return result;
        }
        visited.add(child.id());
        result.add(edge.clone(), child);
        this.showPath(edge, child, child.id() === dest.id() ? accHint : '');
        current = child;
      }
    }
    result.end();

    // Show one more child beyond the accumulation point, if it has any
    if (dest.edgesCount() > 0) {
      const { edge, child } = this.findBiggestChild(current);
      if (!child) {
        this.log('...end...');
        return result;
      }
      visited.add(child.id());
      result.add(edge.clone(), child);
      this.showPath(edge, child);
      this.log('............')
    }

    return result;
  }

  findBiggestChild(node) {
    let maxRetainedSize = 0;
    let result = {};
    const visited = this.visited;
    for (let iter = node.edges(); iter.hasNext(); iter.next()) {
      const edge = iter.edge;
      const child = edge.node();
      if (visited.has(child.id())) {
        continue;
      }
      const retainedSize = child.retainedSize();
      if (retainedSize > maxRetainedSize) {
        maxRetainedSize = retainedSize;
        result = { edge: edge.clone(), child };
      }
    }
    return result;
  }

  showPath(edge, child, hint = '') {
    this.log(`  |`);
    this.log(`  | ${edge.toString()}`);
    this.log(`  v`);
    this.log(`${describeNode(child)}${hint}`);
  }

  toJSON() {
    const originalLog = this.log;
    this.setLog(noop);
    const leakPath = this.getPath();
    this.setLog(originalLog);
    return {
      path: leakPath
    };
  }
}

module.exports = SuspectRecord;
