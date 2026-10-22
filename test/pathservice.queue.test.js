const test = require('node:test');
const assert = require('node:assert');
const { BunkerGraph } = require('../public/bunkergraph.js');
const { PathService } = require('../public/pathservice.js');

// Chain graph N0-N1-...-N7 so a full path costs several expansions.
function chain(n) {
  const g = new BunkerGraph();
  const ids = [];
  for (let i = 0; i < (n || 8); i++) { ids.push('N' + i); g.addNode('N' + i); }
  for (let i = 0; i + 1 < ids.length; i++) g.addEdge(ids[i], ids[i + 1], 1);
  return { g, first: ids[0], last: ids[ids.length - 1] };
}

function expansionsFor(g, a, b) {
  const r = g.findPath(a, b);
  assert.ok(r.found);
  assert.ok(r.expansions > 1, 'test graph should need more than one expansion');
  return r.expansions;
}

test('budget: only as many requests as fit run in one tick', () => {
  const { g, first, last } = chain();
  const e = expansionsFor(g, first, last);
  const s = new PathService(g, { budget: e + 1, maxExpansions: 1000 });
  const found = [];
  s.on('PathFound', (ev) => found.push(ev.owner));
  s.request(first, last, { owner: 'a' });
  s.request(first, last, { owner: 'b' });
  s.request(first, last, { owner: 'c' });
  s.tick();
  assert.deepStrictEqual(found, ['a']);
  assert.strictEqual(s.pending, 2);
  for (let i = 0; i < 10 && s.pending; i++) s.tick();
  assert.deepStrictEqual(found, ['a', 'b', 'c']);
});

test('budget: a large budget drains the whole queue in one tick', () => {
  const { g, first, last } = chain();
  const e = expansionsFor(g, first, last);
  const s = new PathService(g, { budget: e * 10, maxExpansions: 1000 });
  let n = 0;
  s.on('PathFound', () => n++);
  for (let i = 0; i < 3; i++) s.request(first, last, { owner: i });
  assert.strictEqual(s.tick(), 3);
  assert.strictEqual(n, 3);
  assert.strictEqual(s.pending, 0);
});

test('budget: at least one request runs per tick even with tiny budget', () => {
  const { g, first, last } = chain();
  const s = new PathService(g, { budget: 1, maxExpansions: 1000 });
  let n = 0;
  s.on('PathFound', () => n++);
  s.request(first, last, { owner: 'x' });
  for (let i = 0; i < 50 && s.pending; i++) s.tick();
  assert.strictEqual(n, 1);
  assert.strictEqual(s.pending, 0);
});

test('priority: higher priority is served first, ties by request order', () => {
  const { g, first, last } = chain();
  const e = expansionsFor(g, first, last);
  const s = new PathService(g, { budget: e + 1, maxExpansions: 1000, aging: 0 });
  const order = [];
  s.on('PathFound', (ev) => order.push(ev.owner));
  s.request(first, last, { owner: 'low', priority: 0 });
  s.request(first, last, { owner: 'mid1', priority: 1 });
  s.request(first, last, { owner: 'high', priority: 5 });
  s.request(first, last, { owner: 'mid2', priority: 1 });
  for (let i = 0; i < 20 && s.pending; i++) s.tick();
  assert.deepStrictEqual(order, ['high', 'mid1', 'mid2', 'low']);
});

test('aging: without aging a low-priority request starves behind a stream of high ones', () => {
  const { g, first, last } = chain();
  const e = expansionsFor(g, first, last);
  const s = new PathService(g, { budget: e + 1, maxExpansions: 1000, aging: 0 });
  const served = [];
  s.on('PathFound', (ev) => served.push(ev.owner));
  s.request(first, last, { owner: 'low', priority: 0 });
  for (let i = 0; i < 15; i++) {
    s.request(first, last, { owner: 'hi' + i, priority: 5 });
    s.tick();
  }
  assert.ok(!served.includes('low'));
});

test('aging: a waiting low-priority request eventually beats fresh high-priority ones', () => {
  const { g, first, last } = chain();
  const e = expansionsFor(g, first, last);
  const s = new PathService(g, { budget: e + 1, maxExpansions: 1000, aging: 1 });
  const served = [];
  s.on('PathFound', (ev) => served.push(ev.owner));
  s.request(first, last, { owner: 'low', priority: 0 });
  let servedAt = -1;
  for (let i = 0; i < 15; i++) {
    s.request(first, last, { owner: 'hi' + i, priority: 5 });
    s.tick();
    if (servedAt < 0 && served.includes('low')) servedAt = i;
  }
  assert.ok(servedAt >= 0, 'low priority request was never served');
  assert.ok(servedAt >= 4, 'aging should not jump the queue immediately (served at tick ' + servedAt + ')');
  assert.ok(servedAt <= 8, 'aging should bound the wait (served at tick ' + servedAt + ')');
});

test('cancel: cancelling by id removes the request and emits nothing', () => {
  const { g, first, last } = chain();
  const s = new PathService(g);
  const ev = [];
  s.on('PathFound', (e) => ev.push(e.id));
  s.on('PathFailed', (e) => ev.push(e.id));
  const a = s.request(first, last, { owner: 'a' });
  const b = s.request(first, last, { owner: 'b' });
  assert.strictEqual(s.cancel(a), true);
  assert.strictEqual(s.cancel(a), false);
  assert.strictEqual(s.pending, 1);
  s.tick();
  assert.deepStrictEqual(ev, [b]);
});

test('cancel: cancelOwner returns count and a new request replaces the old one', () => {
  const { g, first, last } = chain();
  const s = new PathService(g);
  const ev = [];
  s.on('PathFound', (e) => ev.push(e.id));
  s.request(first, last, { owner: 'x' });
  const second = s.request(first, last, { owner: 'x' });
  assert.strictEqual(s.pending, 1);
  s.request(first, last, { owner: 'y' });
  assert.strictEqual(s.cancelOwner('y'), 1);
  assert.strictEqual(s.cancelOwner('y'), 0);
  s.tick();
  assert.deepStrictEqual(ev, [second]);
});

test('cancel: requests without an owner are never replaced by each other', () => {
  const { g, first, last } = chain();
  const s = new PathService(g);
  s.request(first, last);
  s.request(first, last);
  assert.strictEqual(s.pending, 2);
});
