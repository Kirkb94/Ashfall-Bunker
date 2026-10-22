const test = require('node:test');
const assert = require('node:assert');
const { parse } = require('../public/scavlevel.js');
const { moveBody } = require('../public/physics.js');

const DT = 1 / 60, GRAV = 1500;
const floorsOf = (plats) => plats.map((p, i) => ({ id: 'p' + i, y: p.y, x0: p.x, x1: p.x + p.w }));

test('parse: merges horizontal one-way runs and uses tile top as y', () => {
  const lv = parse({ tile: 10, rows: ['..', '.==.=', '#####'] });
  assert.deepStrictEqual(lv.plats, [{ x: 10, y: 10, w: 20 }, { x: 40, y: 10, w: 10 }]);
  assert.deepStrictEqual(lv.solids, [{ x: 0, y: 20, w: 50, h: 10 }]);
  assert.strictEqual(lv.len, 50);
});

test('parse: rows split runs separately and bad input throws', () => {
  const lv = parse({ tile: 8, rows: ['==', '==', '.='] });
  assert.strictEqual(lv.plats.length, 3);
  assert.throws(() => parse({}));
});

test('parsed one-way tiles catch from above but not from below', () => {
  const { plats } = parse({ tile: 50, rows: ['', '', '==='] }); // top at y=100, x 0..150
  const f = floorsOf(plats);
  const down = { x: 75, y: 50, vy: 0, grounded: false };
  for (let i = 0; i < 120 && !down.grounded; i++) moveBody(down, DT, GRAV, { floors: f });
  assert.strictEqual(down.y, 100);
  const up = { x: 75, y: 130, vy: -400, grounded: false };
  moveBody(up, DT, GRAV, { floors: f });
  assert.ok(!up.grounded && up.y < 130);
});
