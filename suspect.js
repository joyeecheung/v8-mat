'use strict';

const noop = () => {};

class LeakPathNode {
  constructor(node, edge = null) {
    this.node = node;
    this.edge = edge;
  }

  toJSON() {
    return {
      node: {
        nodeIndex: this.node.nodeIndex,
        name: this.node.name(),
        className: this.node.className(),
        edgesCount: this.node.edgesCount(),
        retainedSize: this.node.retainedSize(),
        selfSize: this.node.selfSize(),
        id: this.node.id()
      },
      edge: this.edge ? {
        edgeIndex: this.edge.edgeIndex,
        string: this.edge.toString()
      } : this.edge
    };
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
    const visited = this.visited;
    const suspect = this.suspect;
    let current = suspect;

    const result = new LeakPath(current);
    result.suspect = 0;
    visited.add(current.id());
  
    this.log(`${suspect.name()} (${suspect.className()}) @${suspect.id()} <--- Suspect`);

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
          return;
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
        return;
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
    this.log(`${child.name()} (${child.className()}) @${child.id()}${hint}`);
  }
}

module.exports = SuspectRecord;
