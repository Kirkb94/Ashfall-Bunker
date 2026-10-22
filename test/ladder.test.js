const test = require('node:test');
const assert = require('node:assert');
const { createController } = require('../public/physics.js');
const { parse } = require('../public/scavlevel.js');

const DT = 1 / 60;
const LAD = [{ x: 100, y0: 200, y1: 500 }];
const body = (o) => Object.assign({ x: 100, y: 500, vy: 0, grounded: true }, o);

test('parse: H tiles become vertical ladders', () => {
  const lv = parse({ tile: 10, rows: ['.H.', '.H.', '.H.', '###'] });
  assert.deepStrictEqual(lv.ladders, [{ x: 15, y0: 0, y1: 30 }]);
});

test('ladder: Up near a ladder grabs it and snaps x', () => {
  const c = createController(), b = body({ x: 108 });
  assert.strictEqual(c.climb(b, { up: true }, DT, LAD, 120), true);
  assert.strictEqual(b.x, 100);
  assert.strictEqual(c.climbing, true);
  assert.strictEqual(b.grounded, false);
});

test('ladder: no grab when out of reach or no input', () => {
  const c = createController();
  assert.strictEqual(c.climb(body({ x: 140 }), { up: true }, DT, LAD, 120), false);
  assert.strictEqual(c.climb(body(), {}, DT, LAD, 120), false);
});

test('ladder: climbs at the given speed', () => {
  const c = createController(), b = body();
  c.climb(b, { up: true }, 1, LAD, 100);
  assert.ok(Math.abs(b.y - 400) < 1e-9);
});

test('ladder: reaching the top releases grounded on y0, and holding Up does not re-grab', () => {
  const c = createController(), b = body({ y: 205 });
  assert.strictEqual(c.climb(b, { up: true }, DT, LAD, 120), false);
  assert.strictEqual(b.y, 200);
  assert.strictEqual(b.grounded, true);
  assert.strictEqual(c.climbing, false);
  assert.strictEqual(c.climb(b, { up: true }, DT, LAD, 120), false);
});

test('ladder: Down from the top grabs and descends; bottom releases', () => {
  const c = createController(), b = body({ y: 200 });
  assert.strictEqual(c.climb(b, { down: true }, DT, LAD, 120), true);
  assert.ok(b.y > 200);
  b.y = 499;
  assert.strictEqual(c.climb(b, { down: true }, DT, LAD, 120), false);
  assert.strictEqual(b.y, 500);
  assert.strictEqual(c.climbing, false);
});

test('ladder: side input releases and the body falls', () => {
  const c = createController(), b = body({ y: 350 });
  c.climb(b, { up: true }, DT, LAD, 120);
  assert.strictEqual(c.climb(b, { right: true }, DT, LAD, 120), false);
  assert.strictEqual(c.climbing, false);
});

test('ladder: a fresh Jump press hops off; a held Jump does not dismount on grab', () => {
  const c = createController(), b = body({ y: 350 });
  c.climb(b, { up: true, jump: true }, DT, LAD, 120); // grab with jump already held
  assert.strictEqual(c.climbing, true);
  c.climb(b, { up: true, jump: false }, DT, LAD, 120);
  assert.strictEqual(c.climb(b, { jump: true }, DT, LAD, 120), false);
  assert.strictEqual(c.climbing, false);
  assert.ok(b.vy < 0);
});
