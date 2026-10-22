// Regression test for the prototype-day bunker layout. game.js is a browser script with no exports,
// so we pull the constants out of it and evaluate them in isolation (same approach as restday.test.js).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'game.js'), 'utf8');

function grab(re, name) {
  const m = src.match(re);
  assert.ok(m, 'could not find ' + name + ' in game.js (renamed or moved?)');
  return m[0];
}

const body = [
  grab(/const FLOORS = [^\n]*/, 'FLOORS'),
  grab(/const LADDER_X = [^\n]*/, 'LADDER_X'),
  grab(/const IN_L = [^\n]*/, 'IN_L / IN_R'),
  grab(/const DOOR_X = [^\n]*/, 'DOOR_X / WALL_X'),
  grab(/const ROOMS = \{[\s\S]*?\n\};/, 'ROOMS'),
  'return { FLOORS, LADDER_X, IN_L, IN_R, DOOR_X, ROOMS };'
].join('\n');
const G = new Function(body)();

const core = Object.entries(G.ROOMS).filter(([, r]) => !r.build); // rooms that exist from the start

test('bunker has at least 3 core rooms on bunker floors', () => {
  assert.ok(core.length >= 3, 'expected 3+ core rooms, got ' + core.length);
  for (const [k, r] of core) {
    assert.ok(Number.isInteger(r.floor) && r.floor >= 1 && r.floor < G.FLOORS.length, k + ' has an invalid floor');
  }
});

test('every room sits inside the bunker walls and has positive width', () => {
  for (const [k, r] of Object.entries(G.ROOMS)) {
    assert.ok(r.x0 >= G.IN_L && r.x1 <= G.IN_R, k + ' pokes outside the bunker walls');
    assert.ok(r.x1 > r.x0, k + ' has no width');
  }
});

test('core rooms on the same floor do not overlap', () => {
  const byFloor = {};
  for (const [k, r] of core) (byFloor[r.floor] = byFloor[r.floor] || []).push([k, r]);
  for (const list of Object.values(byFloor)) {
    list.sort((a, b) => a[1].x0 - b[1].x0);
    for (let i = 1; i < list.length; i++) {
      assert.ok(list[i][1].x0 >= list[i - 1][1].x1, list[i][0] + ' overlaps ' + list[i - 1][0]);
    }
  }
});

test('the door sits on the surface above the shaft', () => {
  assert.strictEqual(G.DOOR_X, G.LADDER_X);
  assert.ok(G.DOOR_X > 0);
  assert.ok(G.FLOORS[0] < G.FLOORS[1], 'floor 0 must be the surface (smallest y)');
});
