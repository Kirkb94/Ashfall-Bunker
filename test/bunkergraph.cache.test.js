const test = require('node:test');
const assert = require('node:assert');
const { BunkerGraph } = require('../public/bunkergraph.js');

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

test('roomCost matches findPath for all pairs', () => {
  const g = mk();
  const ids = ['A', 'B', 'C', 'D'];
  for (const a of ids) for (const b of ids) {
    assert.strictEqual(g.roomCost(a, b), g.findPath(a, b).cost, a + '->' + b);
  }
});

test('rows are cached and repeat lookups hit', () => {
  const g = mk();
  g.roomCost('A', 'C');
  const s1 = g.cacheStats();
  assert.strictEqual(s1.misses, 1);
  g.roomCost('A', 'B');
  g.roomCost('A', 'D');
  const s2 = g.cacheStats();
  assert.strictEqual(s2.misses, 1);
  assert.strictEqual(s2.hits, 2);
});

test('cache invalidates on cost change, block, and node removal', () => {
  const g = mk();
  assert.strictEqual(g.roomCost('A', 'C'), 20);
  g.updateEdge('B', 'C', { cost: 100 });
  assert.strictEqual(g.roomCost('A', 'C'), 50); // via D
  assert.strictEqual(g.cacheStats().rebuilds, 1);

  g.setBlocked('D', true);
  assert.strictEqual(g.roomCost('A', 'C'), 110);
  assert.strictEqual(g.roomCost('A', 'D'), Infinity);

  g.removeNode('B');
  assert.strictEqual(g.roomCost('A', 'C'), Infinity);
});

test('no-op updates do not invalidate', () => {
  const g = mk();
  g.roomCost('A', 'C');
  g.updateEdge('A', 'B', { cost: 10 });
  g.setBlocked('A', false);
  g.roomCost('A', 'B');
  assert.strictEqual(g.cacheStats().rebuilds, 0);
  assert.strictEqual(g.cacheStats().misses, 1);
});

test('unknown and blocked endpoints are Infinity; self cost is 0', () => {
  const g = mk();
  assert.strictEqual(g.roomCost('A', 'A'), 0);
  assert.strictEqual(g.roomCost('A', 'nope'), Infinity);
  assert.strictEqual(g.roomCost('nope', 'A'), Infinity);
  g.setBlocked('A', true);
  assert.strictEqual(g.roomCost('A', 'B'), Infinity);
});

test('allPairs fills every row', () => {
  const g = mk();
  const all = g.allPairs();
  assert.strictEqual(all.size, 4);
  assert.strictEqual(all.get('D').get('B'), 20);
});
