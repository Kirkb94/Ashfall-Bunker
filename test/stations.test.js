// Tests for station capacity: the STATIONS table, loadStationsConfig(), and targetJob().
// There is no StationRegistry class yet, so this covers the current station logic.
// game.js is a browser script with no exports, so we extract the real source and run it
// against stubs (fake fetch/console, crew list, S.alarm).
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
  grab(/const JOBS = \{[\s\S]*?\n\};\n/, 'JOBS'),
  grab(/const STATIONS_FALLBACK = [^\n]*/, 'STATIONS_FALLBACK'),
  grab(/const STATIONS = \{\};/, 'STATIONS'),
  grab(/for \(const k of Object\.keys\(JOBS\)\) STATIONS\[k\] = [^\n]*/, 'STATIONS init loop'),
  grab(/for \(const \[k, cap\] of Object\.entries\(\{ turretA[^\n]*/, 'STATIONS capacity loop'),
  grab(/function loadStationsConfig\(\) \{[\s\S]*?\n\}\n/, 'loadStationsConfig'),
  grab(/const CAPPED_JOBS = [^\n]*/, 'CAPPED_JOBS'),
  grab(/function targetJob\([\s\S]*?\n\}\n/, 'targetJob'),
];

// opts.cfg: object returned by fake fetch; opts.http: status code; opts.fail: reject fetch
function load(opts) {
  opts = opts || {};
  const warnings = [];
  const state = { crew: [], S: { alarm: false } };
  const fakeFetch = () => {
    if (opts.fail) return Promise.reject(new Error('network down'));
    const status = opts.http || 200;
    return Promise.resolve({ ok: status === 200, status, json: () => Promise.resolve(opts.cfg) });
  };
  const body = 'const S = state.S;\n'
    + 'const living = () => state.crew;\n'
    + 'const baseJob = c => c.base;\n'
    + parts.join('\n')
    + '\nreturn { STATIONS, CAPPED_JOBS, loadStationsConfig, targetJob };';
  const api = new Function('fetch', 'console', 'state', body)(fakeFetch, { warn: m => warnings.push(m) }, state);
  return Object.assign(api, { warnings, state });
}

const mk = (id, base, extra) => Object.assign({ id, base, patient: false }, extra);

test('built-in capacities match the design numbers', () => {
  const g = load();
  const caps = { turretA: 1, turretB: 1, door: 6, workshop: 4, signal: 3, kitchen: 4, med: 3, sleep: 20 };
  for (const [k, v] of Object.entries(caps)) assert.strictEqual(g.STATIONS[k].capacity, v, k);
  assert.strictEqual(g.STATIONS.idle.capacity, null);
  assert.strictEqual(g.STATIONS.workshop.ttlMin, 30);
  assert.strictEqual(g.STATIONS.workshop.blockTicks, 120);
});

test('stations.config.json in public/ is valid and matches built-in capacities', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'stations.config.json'), 'utf8'));
  const g = load();
  for (const [k, v] of Object.entries(cfg.stations)) {
    assert.ok(k in g.STATIONS, 'config station not in JOBS: ' + k);
    assert.strictEqual(g.STATIONS[k].capacity, v.capacity, k);
  }
});

test('STATIONS entries are independent objects', () => {
  const g = load();
  g.STATIONS.workshop.capacity = 99;
  assert.notStrictEqual(g.STATIONS.kitchen.capacity, 99);
});

test('loadStationsConfig applies valid overrides', async () => {
  const g = load({ cfg: { stations: { workshop: { capacity: 2, ttlMin: 10, blockTicks: 60 }, med: { capacity: null } } } });
  await g.loadStationsConfig();
  assert.deepStrictEqual(g.STATIONS.workshop, { capacity: 2, ttlMin: 10, blockTicks: 60 });
  assert.strictEqual(g.STATIONS.med.capacity, null);
  assert.strictEqual(g.STATIONS.kitchen.capacity, 4);
  assert.deepStrictEqual(g.warnings, []);
});

test('loadStationsConfig rejects bad values with a warning and keeps fallbacks', async () => {
  const g = load({ cfg: { stations: { workshop: { capacity: -1 }, kitchen: { capacity: 1.5 }, med: { ttlMin: 'x' }, signal: { blockTicks: -5 } } } });
  await g.loadStationsConfig();
  assert.strictEqual(g.STATIONS.workshop.capacity, 4);
  assert.strictEqual(g.STATIONS.kitchen.capacity, 4);
  assert.strictEqual(g.STATIONS.med.ttlMin, 30);
  assert.strictEqual(g.STATIONS.signal.blockTicks, 120);
  assert.strictEqual(g.warnings.length, 4);
});

test('door capacity is clamped to at least 1 (0 would lock the door)', async () => {
  const g = load({ cfg: { stations: { door: { capacity: 0 } } } });
  await g.loadStationsConfig();
  assert.strictEqual(g.STATIONS.door.capacity, 1);
});

test('door capacity null stays unlimited', async () => {
  const g = load({ cfg: { stations: { door: { capacity: null } } } });
  await g.loadStationsConfig();
  assert.strictEqual(g.STATIONS.door.capacity, null);
});

test('config defaults apply to ttlMin/blockTicks, per-station values win', async () => {
  const g = load({ cfg: { defaults: { ttlMin: 5 }, stations: { med: { ttlMin: 9 } } } });
  await g.loadStationsConfig();
  assert.strictEqual(g.STATIONS.workshop.ttlMin, 5);
  assert.strictEqual(g.STATIONS.med.ttlMin, 9);
});

test('fetch failure or HTTP error keeps built-in defaults and warns', async () => {
  for (const opts of [{ fail: true }, { http: 404 }]) {
    const g = load(opts);
    await g.loadStationsConfig();
    assert.strictEqual(g.STATIONS.workshop.capacity, 4);
    assert.strictEqual(g.warnings.length, 1);
  }
});

test('malformed config (null / no stations) does not throw', async () => {
  for (const cfg of [null, {}, { stations: null }]) {
    const g = load({ cfg });
    await g.loadStationsConfig();
    assert.strictEqual(g.STATIONS.kitchen.capacity, 4);
  }
});

test('targetJob: crew under capacity keep their job', () => {
  const g = load();
  g.state.crew.push(mk(1, 'med'), mk(2, 'med'), mk(3, 'med'));
  for (const c of g.state.crew) assert.strictEqual(g.targetJob(c), 'med');
});

test('targetJob: overflow goes to idle, in crew-list order', () => {
  const g = load();
  g.state.crew.push(mk(1, 'med'), mk(2, 'med'), mk(3, 'med'), mk(4, 'med'), mk(5, 'med'));
  const got = g.state.crew.map(c => g.targetJob(c));
  assert.deepStrictEqual(got, ['med', 'med', 'med', 'idle', 'idle']);
});

test('targetJob: other jobs do not consume a station\'s slots', () => {
  const g = load();
  g.state.crew.push(mk(1, 'kitchen'), mk(2, 'workshop'), mk(3, 'workshop'), mk(4, 'workshop'), mk(5, 'workshop'), mk(6, 'workshop'));
  const got = g.state.crew.map(c => g.targetJob(c));
  assert.deepStrictEqual(got, ['kitchen', 'workshop', 'workshop', 'workshop', 'workshop', 'idle']);
});

test('targetJob: patients are never bumped and do not take a slot', () => {
  const g = load();
  const patient = mk(1, 'med', { patient: true });
  g.state.crew.push(patient, mk(2, 'med'), mk(3, 'med'), mk(4, 'med'));
  assert.strictEqual(g.targetJob(patient), 'med');
  assert.deepStrictEqual(g.state.crew.slice(1).map(c => g.targetJob(c)), ['med', 'med', 'med']);
});

test('targetJob: battle stations (alarm) ignore capacity', () => {
  const g = load();
  g.state.S.alarm = true;
  g.state.crew.push(mk(1, 'workshop'), mk(2, 'workshop'), mk(3, 'workshop'), mk(4, 'workshop'), mk(5, 'workshop'));
  for (const c of g.state.crew) assert.strictEqual(g.targetJob(c), 'workshop');
});

test('targetJob: door, turrets, sleep and meal are never capped', () => {
  const g = load();
  for (const job of ['door', 'turretA', 'turretB', 'sleep', 'meal']) {
    const crew = Array.from({ length: 30 }, (_, i) => mk(i, job));
    g.state.crew.length = 0; g.state.crew.push(...crew);
    assert.ok(crew.every(c => g.targetJob(c) === job), job);
  }
});

test('targetJob: null capacity means unlimited', async () => {
  const g = load({ cfg: { stations: { workshop: { capacity: null } } } });
  await g.loadStationsConfig();
  const crew = Array.from({ length: 30 }, (_, i) => mk(i, 'workshop'));
  g.state.crew.push(...crew);
  assert.ok(crew.every(c => g.targetJob(c) === 'workshop'));
});

test('targetJob: capacity 0 sends everyone to idle', async () => {
  const g = load({ cfg: { stations: { kitchen: { capacity: 0 } } } });
  await g.loadStationsConfig();
  g.state.crew.push(mk(1, 'kitchen'), mk(2, 'kitchen'));
  assert.deepStrictEqual(g.state.crew.map(c => g.targetJob(c)), ['idle', 'idle']);
});
