const test = require('node:test');
const assert = require('node:assert');
const { generate, describe, TRAITS, PAST_JOBS } = require('../public/crewgen.js');

function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

test('generate: values stay in bounds and ids are valid', () => {
  const rng = seeded(1);
  for (let i = 0; i < 500; i++) {
    const g = generate(rng);
    for (const v of Object.values(g.stats)) assert.ok(v >= 0.2 && v <= 1.5);
    assert.ok(g.loyalty >= 0.05 && g.loyalty <= 1);
    assert.ok(g.hp >= 40);
    assert.ok(PAST_JOBS[g.past]);
    assert.ok(g.traits.length >= 1 && g.traits.length <= 2);
    g.traits.forEach(t => assert.ok(TRAITS[t]));
    assert.ok(typeof g.role === 'string');
  }
});

test('generate: no duplicate or conflicting traits', () => {
  const rng = seeded(7);
  for (let i = 0; i < 1000; i++) {
    const g = generate(rng);
    assert.strictEqual(new Set(g.traits).size, g.traits.length);
    for (const a of g.traits) for (const b of g.traits) if (a !== b) assert.ok(!TRAITS[a].excl.includes(b));
  }
});

test('generate: deterministic for the same seed', () => {
  assert.deepStrictEqual(generate(seeded(42)), generate(seeded(42)));
});

test('describe: handles old saves without traits/past', () => {
  assert.deepStrictEqual(describe({}), { past: null, traits: [] });
  const d = describe({ past: 'nurse', traits: ['brave', 'bogus'] });
  assert.strictEqual(d.past, 'Nurse');
  assert.deepStrictEqual(d.traits.map(t => t.id), ['brave']);
});
