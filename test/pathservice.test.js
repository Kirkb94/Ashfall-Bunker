const test = require('node:test');
const assert = require('node:assert');
const { BunkerGraph } = require('../public/bunkergraph.js');
const { PathService } = require('../public/pathservice.js');

function mk() {
  const g = new BunkerGraph();
  for (const id of ['A', 'B', 'C', 'Z']) g.addNode(id);
  g.addEdge('A', 'B', 1);
  g.addEdge('B', 'C', 1);
  return g;
}

test('emits PathFound for a reachable target', () => {
  const s = new PathService(mk());
  const got = [];
  s.on('PathFound', (e) => got.push(e));
  s.request('A', 'C', { owner: 'crew1' });
  s.tick();
  assert.strictEqual(got.length, 1);
  assert.deepStrictEqual(got[0].path, ['A', 'B', 'C']);
  assert.strictEqual(got[0].owner, 'crew1');
});

test('emits PathFailed no-route for disconnected room', () => {
  const s = new PathService(mk());
  const fails = [];
  s.on('PathFailed', (e) => fails.push(e));
  s.request('A', 'Z', { owner: 'crew1' });
  s.tick();
  assert.strictEqual(fails.length, 1);
  assert.strictEqual(fails[0].reason, 'no-route');
  assert.strictEqual(fails[0].owner, 'crew1');
});

test('PathFailed reasons: unknown-node and blocked-endpoint', () => {
  const g = mk();
  const s = new PathService(g);
  const fails = [];
  s.on('PathFailed', (e) => fails.push(e.reason));
  s.request('A', 'nope', { owner: 1 });
  g.setBlocked('C', true);
  s.request('A', 'C', { owner: 2 });
  s.tick();
  assert.deepStrictEqual(fails, ['unknown-node', 'blocked-endpoint']);
});

test('PathFailed budget when a single request exceeds maxExpansions', () => {
  const s = new PathService(mk(), { maxExpansions: 1, budget: 10 });
  const fails = [];
  s.on('PathFailed', (e) => fails.push(e.reason));
  s.request('A', 'C');
  s.tick();
  assert.deepStrictEqual(fails, ['budget']);
});

test('tick budget defers requests without failing them', () => {
  const s = new PathService(mk(), { budget: 1, maxExpansions: 100 });
  const found = [], fails = [];
  s.on('PathFound', (e) => found.push(e.id));
  s.on('PathFailed', (e) => fails.push(e.id));
  s.request('A', 'C', { owner: 1 });
  s.request('A', 'C', { owner: 2 });
  for (let i = 0; i < 10 && s.pending; i++) s.tick();
  assert.strictEqual(found.length, 2);
  assert.strictEqual(fails.length, 0);
});

test('cancel and per-owner replacement suppress events', () => {
  const s = new PathService(mk());
  const ev = [];
  s.on('PathFound', (e) => ev.push(e.id));
  s.on('PathFailed', (e) => ev.push(e.id));
  const a = s.request('A', 'C', { owner: 'x' });
  const b = s.request('A', 'Z', { owner: 'x' }); // replaces a
  assert.strictEqual(s.cancel(a), false);
  assert.strictEqual(s.cancel(b), true);
  s.tick();
  assert.deepStrictEqual(ev, []);
});
