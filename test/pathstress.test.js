const test = require('node:test');
const assert = require('node:assert');
const PS = require('../public/pathstress.js');

test('stress harness re-paths 100 crew per step and bumps graph.version', () => {
  const s = PS.create({ seed: 7 });
  const v0 = s.graph.version;
  const st = s.step();
  assert.strictEqual(s.crew.length, 100);
  assert.ok(s.graph.version > v0);
  assert.ok(st.lastExp > 0);
  assert.strictEqual(st.stale, 0);
  assert.match(PS.format(st), /100 crew/);
});

test('stress harness honours maxExpansions budget', () => {
  const s = PS.create({ seed: 7, maxExpansions: 3 });
  const st = s.step();
  assert.ok(st.truncated > 0);
});
