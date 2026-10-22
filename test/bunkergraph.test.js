const test = require('node:test');
const assert = require('node:assert');
const { BunkerGraph } = require('../public/bunkergraph.js');

// Three floors: A -- B -- C along the top, plus a slow ladder shortcut A -- C.
function mk() {
  const g = new BunkerGraph();
  g.addNode('A', { x: 0, y: 0 });
  g.addNode('B', { x: 10, y: 0 });
  g.addNode('C', { x: 20, y: 0 });
  g.addNode('D', { x: 0, y: 10 });
  g.addEdge('A', 'B', 10);
  g.addEdge('B', 'C', 10);
  g.addEdge('A', 'D', 10, { kind: 'ladder', cap: 1 });
  g.addEdge('D', 'C', 40);
  return g;
}

test('version bumps on every real change and not on no-ops', () => {
  const g = new BunkerGraph();
  assert.strictEqual(g.version, 0);
  g.addNode('A'); g.addNode('B');
  const v = g.version;
  g.addEdge('A', 'B', 5);
  assert.ok(g.version > v);
  const v2 = g.version;
  assert.strictEqual(g.updateEdge('A', 'B', { cost: 5 }), false);
  assert.strictEqual(g.setBlocked('A', false), false);
  assert.strictEqual(g.version, v2);
  assert.strictEqual(g.updateEdge('A', 'B', { cost: 7 }), true);
  assert.ok(g.version > v2);
  const v3 = g.version;
  g.setBlocked('B', true);
  assert.ok(g.version > v3);
  g.removeNode('B');
  assert.ok(!g.hasNode('B'));
  assert.strictEqual(g.neighbors('A').length, 0);
});

test('findPath returns optimal path, cost, expansions and version', () => {
  const g = mk();
  const r = g.findPath('A', 'C');
  assert.strictEqual(r.found, true);
  assert.deepStrictEqual(r.path, ['A', 'B', 'C']);
  assert.strictEqual(r.cost, 20);
  assert.ok(Number.isInteger(r.expansions) && r.expansions > 0);
  assert.strictEqual(r.version, g.version);
});

test('result version goes stale after a graph change', () => {
  const g = mk();
  const r = g.findPath('A', 'C');
  g.updateEdge('A', 'B', { cost: 100 });
  assert.notStrictEqual(r.version, g.version);
  const r2 = g.findPath('A', 'C');
  assert.deepStrictEqual(r2.path, ['A', 'D', 'C']);
  assert.strictEqual(r2.cost, 50);
});

test('blocked node and blocked edge are avoided', () => {
  const g = mk();
  g.setBlocked('B', true);
  assert.deepStrictEqual(g.findPath('A', 'C').path, ['A', 'D', 'C']);
  g.setBlocked('B', false);
  g.updateEdge('A', 'B', { blocked: true });
  assert.deepStrictEqual(g.findPath('A', 'C').path, ['A', 'D', 'C']);
});

test('no path returns found:false with expansions and version', () => {
  const g = mk();
  g.setBlocked('B', true);
  g.setBlocked('D', true);
  const r = g.findPath('A', 'C');
  assert.strictEqual(r.found, false);
  assert.deepStrictEqual(r.path, []);
  assert.strictEqual(r.cost, Infinity);
  assert.ok(r.expansions >= 1);
  assert.strictEqual(r.version, g.version);
  assert.strictEqual(g.findPath('A', 'nope').found, false);
  g.setBlocked('C', true);
  assert.strictEqual(g.findPath('A', 'C').expansions, 0);
});

test('from === to is a zero-cost path', () => {
  const r = mk().findPath('B', 'B');
  assert.deepStrictEqual(r, { found: true, path: ['B'], cost: 0, expansions: 0, version: r.version, truncated: false });
});

test('maxExpansions truncates the search', () => {
  const g = mk();
  const r = g.findPath('A', 'C', { maxExpansions: 1 });
  assert.strictEqual(r.found, false);
  assert.strictEqual(r.truncated, true);
  assert.strictEqual(r.expansions, 1);
});

test('A* with coordinates matches Dijkstra and expands no more nodes', () => {
  const withXY = new BunkerGraph();
  const noXY = new BunkerGraph();
  const N = 8;
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    withXY.addNode(r + ',' + c, { x: c * 10, y: r * 10 });
    noXY.addNode(r + ',' + c);
  }
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    for (const [dr, dc] of [[0, 1], [1, 0]]) {
      const r2 = r + dr, c2 = c + dc;
      if (r2 >= N || c2 >= N) continue;
      const cost = 10 + ((r * 7 + c * 3) % 5);
      withXY.addEdge(r + ',' + c, r2 + ',' + c2, cost);
      noXY.addEdge(r + ',' + c, r2 + ',' + c2, cost);
    }
  }
  const a = withXY.findPath('0,0', '7,7');
  const d = noXY.findPath('0,0', '7,7');
  assert.strictEqual(a.cost, d.cost);
  assert.ok(a.expansions <= d.expansions);
});

test('edge kind and capacity are stored for portals', () => {
  const e = mk().getEdge('A', 'D');
  assert.strictEqual(e.kind, 'ladder');
  assert.strictEqual(e.cap, 1);
});

test('addEdge validates input', () => {
  const g = mk();
  assert.throws(() => g.addEdge('A', 'Z', 1));
  assert.throws(() => g.addEdge('A', 'B', -1));
});
