'use strict';

const heapSnapshotWorkerShim = require('./shim');
const SuspectRecord = require('./suspect');
const util = require('util');

const noop = () => {};

function format(obj) {
  return util.inspect(obj, {
    maxArrayLength: 10,
    colors: true,
    breakLength: 150
  });
}

function debug(...args) {
  if (process.env.DEBUG && process.env.DEBUG === 'v8-mat') {
    console.log(...args);
  }
}

class AccumulationPoint {
  /**
   * @param {!HeapSnapshotWorker.JSHeapSnapshotNode} object
   */
  constructor(object, reachedMaxDepth) {
    this.object = object;
    this.reachedMaxDepth = reachedMaxDepth;
  }
}

class HeapSnapshotAnalyzer {
  constructor(options) {
    Object.assign(this, {
      threshold_percent: 20,
      max_depth: 20,
      max_paths: 10000,
      big_drop_ratio: 0.5
    }, options);

    this.snapshot = null;
    this.suspects = [];
  }

  loadStream(stream, debug = noop) {
    return heapSnapshotWorkerShim(stream, debug).then((snapshot) => {
      this.snapshot = snapshot;
    });
  }

  /**
   * @returns {SuspectRecord[]}
   */
  analyze() {
    const nodeFieldCount = this.snapshot._nodeFieldCount;
    const topDominators = this.getTopDominators();
    const totalHeap = this.snapshot.totalSize;

    const threshold = this.threshold_percent * totalHeap / 100;
    const suspiciousObjects = [];
    const suspectNames = new Set();

    debug(`Finding suspicious objects...`);
    for (let i = 0; i < topDominators.length; ++i) {
      const node = this.snapshot.createNode(topDominators[i] * nodeFieldCount);
      if (node.retainedSize() > threshold) {
        suspiciousObjects.push(topDominators[i]);
        suspectNames.add(node.className());
      } else {
        break;
      }
    }

    debug(`Found ${suspiciousObjects.length} suspicious objects`);

    let suspiciousClasses = [];
    // const aggregatesByClassName = this.snapshot.aggregates(false, 'allObjects');
    // for (const className in aggregatesByClassName) {
    //   const aggregate = aggregatesByClassName[className];
    //   const retainedSize = aggregate.maxRet;
    //   // avoid showing class-suspect for s.th. which was found on object
    //   // level
    //   if (retainedSize > threshold && !suspectNames.has(className)) {
    //     suspiciousClasses.push(aggregate);
    //   }
    // }

    // // sort suspiciousClasses by retained size
    // suspiciousClasses = suspiciousClasses.sort((a, b) => {
    //   const sizeA = a.maxRet;
    //   const sizeB = b.maxRet;
    //   return sizeA > sizeB ? -1 : 1;
    // });

    return this.buildResult(suspiciousObjects, suspiciousClasses, totalHeap);
  }

  getRoots() {
    // ==== A ====
    // const nodeFieldCount = this.snapshot._nodeFieldCount;
    // const rootNodeOrdinal = this.snapshot._rootNodeIndex / nodeFieldCount;
    // const roots = this.getImmediateDominatedIds(rootNodeOrdinal);

    // ==== B ====
    let roots = [];
    for (let iter = this.snapshot.rootNode().edges(); iter.hasNext(); iter.next()) {
      roots.push(iter.edge.node().ordinal());
    }
    roots = roots.sort((a, b) => {
      const sizeA = this.getRetainedSize(a);
      const sizeB = this.getRetainedSize(b);
      return sizeA > sizeB ? -1 : 1;
    });
    return roots;
  }

  getTopDominators() {
    const nodeFieldCount = this.snapshot._nodeFieldCount;
    const rootNodeOrdinal = this.snapshot._rootNodeIndex / nodeFieldCount;
    let topDominators = [];

    debug(`Finding roots for root node ${rootNodeOrdinal}...`);
    const roots = this.getRoots();
    debug(`Finding top dominators for ${roots.length} roots...`);
    debug(format(roots, { maxArrayLength: 10, colors: true }));

    // ===== A =====
    // topDominators = roots;
    // ===== B ====
    for (const userRoot of roots) {
      topDominators = topDominators.concat(this.getImmediateDominatedIds(userRoot));
    }
    // ====== C ====
    // const nodeCount = this.snapshot.nodeCount;
    // const dominatorsTree = this.snapshot._dominatorsTree;
    // for (let nodeOrdinal = 0; nodeOrdinal < nodeCount; ++nodeOrdinal) {
    //   if (dominatorsTree[nodeOrdinal] === rootNodeOrdinal) {
    //     topDominators.push(nodeOrdinal);
    //   } else {
    //     break;  // No need to search further since we are now in the second layer
    //   }
    // }

    debug(`Found ${topDominators.length} top dominators`);
    debug(format(topDominators, { maxArrayLength: 10, colors: true }));

    return topDominators;
  }

  /**
   *
   * @param {number[]} suspiciousObjects ordinals
   * @param {!HeapSnapshotModel.Aggregate[]} suspiciousClasses
   * @param {number} totalHeap total retained size
   * @return {SuspectRecord[]}
   */
  buildResult(suspiciousObjects, suspiciousClasses, totalHeap) {
    const nodeFieldCount = this.snapshot._nodeFieldCount;
    const suspects = [];
    for (const nodeOrdinal of suspiciousObjects) {
      const suspectObject = this.snapshot.createNode(nodeOrdinal * nodeFieldCount);
      debug(`Finding accumulation point for ${suspectObject.name()}...`);
      const accPoint = this.findAccumulationPoint(nodeOrdinal);
      if (accPoint !== null) {
        debug(`Found accumulation point for ${suspectObject.name()}: ${accPoint.object.name()}...`);
        suspects.push(new SuspectRecord(suspectObject, suspectObject.retainedSize(), accPoint));
      } else {
        debug(`No accumulation point`);
        suspects.push(new SuspectRecord(suspectObject, suspectObject.retainedSize(), null));
      }
    }

    // for (const aggregate of suspiciousClasses) {
    //     const record = this.buildSuspectRecordGroupOfObjects(aggregate);
    //     suspects.push(record);
    // }

    return suspects;
  }

  getObjectWithTheMostReferencedObjects(nodeIndexes) {
    let maxEdges = 0;
    let result = nodeIndexes[0];
    for (const nodeIndex of nodeIndexes) {
      const node = this.snapshot.createNode(nodeIndex);
      const edgesCount = node.edgesCount();
      if (edgesCount > maxEdges) {
        maxEdges = edgesCount;
        result = nodeIndex;
      }
    }
    return this.snapshot.createNode(result);
  }

  getImmediateDominatedIds(nodeOrdinal) {
    const dominatedNodes = this.snapshot._dominatedNodes;
    const firstDominatedNodeIndex = this.snapshot._firstDominatedNodeIndex;
    const nodeFieldCount = this.snapshot._nodeFieldCount;

    const dominatedIndexFrom = firstDominatedNodeIndex[nodeOrdinal];
    const dominatedIndexTo = firstDominatedNodeIndex[nodeOrdinal + 1];

    debug(`${nodeOrdinal}: [${dominatedIndexFrom} ... ${dominatedIndexTo}]`);
    const dominated = [];
    for (let i = dominatedIndexFrom; i < dominatedIndexTo; i++) {
      dominated.push(dominatedNodes[i] / nodeFieldCount);
    }
    return dominated.sort((a, b) => {
      const sizeA = this.getRetainedSize(a);
      const sizeB = this.getRetainedSize(b);
      return sizeA > sizeB ? -1 : 1;
    });
  }

  /**
   * @param {number} nodeOrdinal
   * @return {number} retained size
   */
  getRetainedSize(nodeOrdinal) {
    const nodeFieldCount = this.snapshot._nodeFieldCount;
    const dominator = this.snapshot.createNode(nodeOrdinal * nodeFieldCount);
    return dominator.retainedSize();
  }

  findAccumulationPoint(nodeOrdinal) {
    const nodeFieldCount = this.snapshot._nodeFieldCount;
    let dominated = this.getImmediateDominatedIds(nodeOrdinal);
    let dominatorRetainedSize = this.getRetainedSize(nodeOrdinal);
    let dominator = nodeOrdinal;
    let depth = 0;
    const big_drop_ratio = this.big_drop_ratio;
    const max_depth = this.max_depth;

    // The dominated is supposed to be sorted by retained size in descending order
    while (dominated.length !== 0 && depth < max_depth) {
      const dominatedRetainedSize = this.getRetainedSize(dominated[0]);
      if (dominatedRetainedSize / dominatorRetainedSize < big_drop_ratio) {
        return new AccumulationPoint(this.snapshot.createNode(dominator * nodeFieldCount), false);
      }

      dominatorRetainedSize = dominatedRetainedSize;
      dominator = dominated[0];
      dominated = this.getImmediateDominatedIds(dominator);
      depth++;
    }

    // if (dominated.length === 0)
    return new AccumulationPoint(this.snapshot.createNode(dominator * nodeFieldCount), true);
    // return null;
  }
}

module.exports = HeapSnapshotAnalyzer;
