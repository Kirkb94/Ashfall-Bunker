// Unit tests for the Rest day feature. game.js is a browser script with no exports,
// so we pull the real function source out of it and run it against a fake S clock.
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

const parts = [
  grab(/const SHIFTS = [^\n]*/, 'SHIFTS'),
  grab(/const hourF = [^\n]*/, 'hourF'),
  grab(/function defaultSched\([\s\S]*?\n}\n/, 'defaultSched'),
  grab(/const REST_BOOST = [^\n]*/, 'REST_BOOST'),
  grab(/function restActive\([^\n]*/, 'restActive'),
  grab(/function startRestDay\([\s\S]*?\n}\n/, 'startRestDay'),
  grab(/function ensureSched\([\s\S]*?\n}\n/, 'ensureSched'),
  grab(/function morale\([^\n]*/, 'morale'),
];

function load(t) {
  const body = 'const clamp = (v, a, b) => Math.max(a, Math.min(b, v));\n'
    + 'const S = { t: ' + t + ' };\n'
    + parts.join('\n')
    + '\nreturn { S, REST_BOOST, startRestDay, ensureSched, restActive, morale, defaultSched };';
  return new Function(body)();
}

const mkCrew = (over) => Object.assign({ id: 1, shift: 'day', sched: null, mor: 70 }, over);

test('startRestDay sets sleep + 3 meals, custom shift, 24h expiry', () => {
  const g = load(1000);
  const c = mkCrew();
  c.sched = g.defaultSched('day');
  const before = { sched: c.sched, shift: c.shift };
  g.startRestDay(c);
  assert.strictEqual(c.sched.length, 24);
  assert.strictEqual(c.sched.split('M').length - 1, 3);
  for (const h of [7, 12, 18]) assert.strictEqual(c.sched[h], 'M');
  assert.ok(!c.sched.includes('W'), 'no work hours on a rest day');
  assert.strictEqual(c.shift, 'custom');
  assert.strictEqual(c.restUntil, 1000 + 1440);
  assert.deepStrictEqual(c.restPrev, before);
  assert.ok(g.restActive(c));
});

test('morale gets the boost while resting, capped at 100, and loses it after', () => {
  const g = load(0);
  const c = mkCrew({ mor: 70 });
  assert.strictEqual(g.morale(c), 70);
  g.startRestDay(c);
  assert.strictEqual(g.morale(c), 70 + g.REST_BOOST);
  c.mor = 95;
  assert.strictEqual(g.morale(c), 100);
  g.S.t = 1440;
  assert.strictEqual(g.restActive(c), false);
  assert.strictEqual(g.morale(c), 95);
});

test('ensureSched keeps rest schedule before expiry', () => {
  const g = load(0);
  const c = mkCrew();
  g.ensureSched(c);
  g.startRestDay(c);
  const rest = c.sched;
  g.S.t = 1439;
  assert.strictEqual(g.ensureSched(c), rest);
  assert.strictEqual(c.shift, 'custom');
});

test('ensureSched restores previous schedule and shift at expiry', () => {
  const g = load(500);
  const c = mkCrew({ shift: 'night' });
  g.ensureSched(c);
  const prev = c.sched;
  assert.strictEqual(prev, g.defaultSched('night'));
  g.startRestDay(c);
  g.S.t = 500 + 1440;
  assert.strictEqual(g.ensureSched(c), prev);
  assert.strictEqual(c.shift, 'night');
  assert.ok(!c.restUntil);
  assert.strictEqual(c.restPrev, null);
});

test('re-triggering during a rest day does not overwrite the saved schedule', () => {
  const g = load(0);
  const c = mkCrew();
  g.ensureSched(c);
  const prev = c.sched;
  g.startRestDay(c);
  g.S.t = 600;
  g.startRestDay(c);
  assert.strictEqual(c.restPrev.sched, prev);
  assert.strictEqual(c.restPrev.shift, 'day');
  assert.strictEqual(c.restUntil, 600 + 1440);
  g.S.t = 600 + 1440;
  assert.strictEqual(g.ensureSched(c), prev);
});

test('ensureSched falls back to defaultSched on bad data', () => {
  const g = load(0);
  const c = mkCrew({ sched: 'SSS' });
  assert.strictEqual(g.ensureSched(c), g.defaultSched('day'));
});
