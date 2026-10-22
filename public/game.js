'use strict';
// Ashfall Bunker: web prototype (stage 1 of the design brief).
// Run a side-view bunker: keep the crew fed and rested, man the turrets, hold the door through nightly raids,
// scavenge the surface yourself for parts and electronics, and finish the signal tower to win.
//
// Layout of this file
//   1. constants and data (layout, enemies, crew, costs)
//   2. game state (new run, save / load)
//   3. simulation: clock and events, crew, structures, enemies, waves
//   4. the player (Mara) in the bunker and on scavenging trips
//   5. drawing
//   6. UI panels (DOM) and input
//   7. main loop

// ---------------------------------------------------------------- 1. constants and data
const W = 1280, H = 720;
const FLOORS = [200, 350, 500, 650];          // y of each walkable floor line: 0 = surface, 1-3 = bunker floors
const LADDER_X = 232;                          // the shaft from the hatch down to floor 3
const IN_L = 186, IN_R = 1250;                 // inside walls of the bunker
const DOOR_X = 232, WALL_X = 520;
const SLOT_X = [340, 430];                     // turret slots between the door and the wall
const FOOD_DRAIN = (100 / 21) / 6;               // hunger lost per game hour (6x slower than the original 100/21)
const GAME_MIN_PER_SEC = 5;                    // 1 real second = 5 game minutes at 1x (an hour is 12 s)
const SAVE_KEY = 'ashfall-bunker-save-v2';        // v2: Hydroponics/Kitchen split, pit-built Workshop, ladders (old saves start fresh)

const ROOMS = {
  hydro:    { name: 'Hydroponics', floor: 1, x0: 262, x1: 700, job: 'hydro' },
  signal:   { name: 'Signal Room', floor: 1, x0: 700, x1: IN_R, job: 'signal' },
  kitchen:  { name: 'Kitchen', floor: 2, x0: 262, x1: 700, job: 'kitchen' },
  med:      { name: 'Med Bay', floor: 2, x0: 700, x1: IN_R, job: 'med' },
  bunks:    { name: 'Bunks', floor: 3, x0: 262, x1: 820, job: 'sleep' },
  common:   { name: 'Common Room', floor: 3, x0: 820, x1: IN_R, job: 'idle' },
  workshop:  { name: 'Workshop', floor: 3, x0: 820, x1: 963, build: true, job: 'workshop' },   // built on the pit grid, not on a bunker floor
  armory:    { name: 'Armory', floor: 3, x0: 820, x1: 963, build: true },
  storage:   { name: 'Storage', floor: 3, x0: 963, x1: 1106, build: true },
  generator: { name: 'Generator', floor: 3, x0: 1106, x1: IN_R, build: true },
};
// Buildable annex rooms and their effects. All tuning for them lives here.
const ROOM_FX = Object.assign({ powerBoost: 1.25, fuelPerHour: 0.25, armoryDmg: 1.2, storageTheft: 0.1, storageLoot: 1.1 }, (window.TUNING && TUNING.roomFx) || {});
const POWERED_JOBS = ['kitchen', 'hydro', 'workshop', 'signal', 'research'];
const BUILD_ROOMS = {
  workshop:  { cost: { scrap: 25, parts: 6, mat: 8 }, desc: 'Crew here repair the hatch, wall and turrets, turn scrap into parts and build weapons. Nothing gets repaired or crafted without one.', done: 'Old Bram can get to work.' },
  generator: { cost: { scrap: 30, parts: 12, elec: 4 }, desc: 'Burns a little scrap each hour to power the bunker: kitchen, workshop, signal and med bay work 25% faster. Armory needs it.', done: 'It will burn about 6 scrap a day to keep the lights on.' },
  armory:    { cost: { scrap: 25, parts: 10, mat: 8 }, desc: 'Turrets, door guards and Mara hit 20% harder. Needs the generator running.', done: 'It needs power from the generator to charge the racks.' },
  storage:   { cost: { scrap: 20, mat: 15 }, desc: 'Locked shelving: night thieves take far less, and loot from scavenging trips is sorted for 10% more.', done: 'Everything is counted and locked now.' },
};
// Simple installable buildings (flags in S.builds), grouped by build-menu category.
const BUILD_CATS = [['expedition', 'Expeditions'], ['structure', 'Structure'], ['energy', 'Energy'], ['crafting', 'Crafting'], ['research', 'Research'], ['food', 'Food'], ['water', 'Water'], ['defenses', 'Defenses'], ['medical', 'Medical'], ['furniture', 'Furniture'], ['decor', 'Decor']];
const BUILDS = {
  solar:    { cat: 'energy',   name: 'Solar panels',    cost: { scrap: 20, parts: 8, elec: 6 }, req: 'generator', desc: 'Cuts the generator\'s scrap burn by 40%.', done: 'Panels on the hatch roof are feeding the generator.' },
  battery:  { cat: 'energy',   name: 'Battery bank',    cost: { parts: 10, elec: 5, mat: 6 },   req: 'generator', desc: 'Stores 12 hours of power: the lights stay on after the generator runs out of scrap.', done: 'The batteries will charge while the generator runs.' },
  toolrack: { cat: 'crafting', name: 'Tool rack',       cost: { scrap: 15, mat: 6 },            req: 'workshop',  desc: 'Repairs and weapon crafting go 25% faster.', done: 'Everything is within reach now.' },
  lab:      { cat: 'research', name: 'Research bench',  cost: { scrap: 25, parts: 8, elec: 4 }, desc: 'Signal tower work goes 15% faster.', done: 'The tower crew have a proper bench now.' },
  maps:     { cat: 'research', name: 'Survey maps',     cost: { scrap: 10, parts: 4, mat: 4 },  desc: 'Scavenging trips bring back 10% more loot.', done: 'Scavengers know where to look.' },
  rain:     { cat: 'water',    name: 'Rain collector',  cost: { scrap: 12, mat: 6 },            desc: 'Hydroponics grows 25% more food.', done: 'Ash-water filters into the hydroponics tanks.' },
  medkit:   { cat: 'medical',  name: 'First-aid cabinet', cost: { scrap: 10, parts: 4, elec: 2 }, req: 'med', desc: 'Patients in the med bay heal 25% faster.', done: 'Bandages and splints are on the wall.' },
  purifier: { cat: 'water',    name: 'Water purifier',  cost: { parts: 6, elec: 3, mat: 4 },    desc: 'Clean water keeps everyone fed: hunger drains 15% slower.', done: 'Clean water at last.' },
};
let buildCat = 'structure';
function hasB(k) { return !!(S && S.builds && S.builds[k]); }
const foodDrain = () => FOOD_DRAIN * (hasB('purifier') ? 0.85 : 1);
function buyBuild(k) {
  const b = BUILDS[k]; if (!b || hasB(k) || (b.req && !S.rooms[b.req]) || !canPay(b.cost)) return;
  pay(b.cost); S.builds = S.builds || {}; S.builds[k] = 1; lamp(b.name + ' built. ' + b.done, 'good');
}
function buyItem(type) {
  const T = ITEM_TYPES[type]; if (!T || !canPay(T.cost)) return;
  const r = ROOMS[T.room]; if (!r || typeof r.x0 !== 'number') return;
  const lo = Math.ceil((r.x0 + 4 - ITX0) / ITILE), hi = Math.floor((r.x1 - 4 - ITX0) / ITILE);
  let col = -1;
  for (const gap of [1, 0]) { for (let c = lo; c <= hi - T.w && col < 0; c++) if (itemSpotOk(T.room, r, c, T.w + gap)) col = c; if (col >= 0) break; }
  if (col < 0) { lamp('No free space left in the ' + r.name + '.', 'warn'); return; }
  pay(T.cost); S.itemSeq = (S.itemSeq || 0) + 1; itemList().push({ id: S.itemSeq, type, room: T.room, col, lvl: 1 });
  lamp(T.name + ' built in the ' + r.name + '.', 'good');
}
const armoryMult = () => (S.rooms.armory && S.powered ? ROOM_FX.armoryDmg : 1);
function powerTick(h) {
  if (!S.rooms.generator) { S.powered = false; return; }
  const need = (ROOM_FX.fuelPerHour + S.turrets.reduce((a, t) => a + (t && t.type === 'coil' && t.hp > 0 ? TURRETS.coil.fuel : 0), 0)) * h * (hasB('solar') ? 0.6 : 1) * (2 - wearF('gen')) * (tech('pow1') ? 0.8 : 1), was = !!S.powered;
  wearBy('gen', 0.3 * h);
  const bcap = hasB('battery') ? 12 : 0; S.batt = Math.min(S.batt || 0, bcap);
  S.onBatt = false;
  if (S.res.scrap >= need) { S.res.scrap -= need; S.powered = true; S.batt = Math.min(bcap, S.batt + 2 * h); }
  else if (S.batt > 0) { S.batt = Math.max(0, S.batt - h); S.powered = true; S.onBatt = true; }
  else S.powered = false;
  if (was && !S.powered) { S.powerOut = true; if (window.SFX && SFX.powerOut) SFX.powerOut(); lampEv('power_out', 'The generator has run out of scrap and gone dark. Rooms are back to manual.', 'warn'); }
  if (S.powered && S.powerOut) { S.powerOut = false; if (window.SFX && SFX.powerBack) SFX.powerBack(); lampEv('power_back', 'Generator is running again. Power is back.', 'good'); }
}
const JOBS = {
  turretA:  { label: 'Turret', short: 'Turret' },   // one Turret job: the game picks the slot (turretA / turretB are the slots behind it)
  turretB:  { label: 'Turret', short: 'Turret', hidden: true },
  door:     { label: 'Guard door', short: 'Door' },
  workshop: { label: 'Workshop', short: 'Shop' },
  signal:   { label: 'Signal tower', short: 'Tower' },
  kitchen:  { label: 'Kitchen', short: 'Food' },
  hydro:    { label: 'Hydroponics', short: 'Hydro' },
  med:      { label: 'Med bay', short: 'Med' },
  research: { label: 'Research', short: 'Lab' },
  mine:     { label: 'Miner', short: 'Mine' },
  idle:     { label: 'Rest', short: 'Rest' },
};
// Station tuning: public/stations.config.json overrides these fallbacks. capacity null = unlimited.
const STATIONS_FALLBACK = { capacity: null, ttlMin: 30, blockTicks: 120 };
const STATIONS = {};
for (const k of Object.keys(JOBS)) STATIONS[k] = Object.assign({}, STATIONS_FALLBACK);
for (const [k, cap] of Object.entries({ turretA: 1, turretB: 1, door: 6, workshop: 4, research: 2, signal: 3, kitchen: 4, hydro: 3, med: 3, sleep: 20 })) if (STATIONS[k]) STATIONS[k].capacity = cap; // 'sleep' is not a job, so it has no entry
function loadStationsConfig() {
  const okVal = (key, v) => key === 'capacity' ? (v === null || (Number.isInteger(v) && v >= 0)) : (Number.isInteger(v) && v >= 0);
  const apply = (target, src, where) => {
    if (!src || typeof src !== 'object') return;
    for (const key of ['capacity', 'ttlMin', 'blockTicks']) {
      if (!(key in src)) continue;
      if (okVal(key, src[key])) target[key] = src[key];
      else console.warn('stations.config.json: bad value for ' + where + '.' + key + ', using fallback');
    }
  };
  return fetch('stations.config.json?v=' + Date.now()).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(cfg => {
    const next = {};
    for (const k of Object.keys(JOBS)) next[k] = Object.assign({}, STATIONS[k]);
    const defs = {};
    apply(defs, cfg && cfg.defaults, 'defaults');
    for (const k of Object.keys(next)) Object.assign(next[k], defs);
    const st = (cfg && cfg.stations) || {};
    for (const k of Object.keys(next)) apply(next[k], st[k], k);
    next.door.capacity = next.door.capacity === null ? null : Math.max(1, next.door.capacity);
    for (const k of Object.keys(next)) Object.assign(STATIONS[k], next[k]);
  }).catch(e => console.warn('stations.config.json not loaded, using built-in defaults:', e && e.message || e));
}
loadStationsConfig();
const SHIFTS = { day: { label: 'Day shift', sleep: [23, 7] }, night: { label: 'Night shift', sleep: [11, 19] }, none: { label: 'No sleep', sleep: null } };

const RES = [
  { k: 'food', name: 'Food', color: '#7ddc6f' }, { k: 'scrap', name: 'Scrap', color: '#c9a27a' }, { k: 'parts', name: 'Parts', color: '#ffb347' },
  { k: 'elec', name: 'Electronics', color: '#7fc8ff' }, { k: 'mat', name: 'Materials', color: '#d0c6b4' },
];

const ENEMIES = {
  hound:  { name: 'Mutant hound', hp: 32, spd: 74, dmg: 6, rate: 0.75, w: 26, h: 18, color: '#9b6a4a', xp: 4 },
  ghoul:  { name: 'Ash ghoul', hp: 62, spd: 38, dmg: 11, rate: 1.0, w: 16, h: 30, color: '#8a8f6a', xp: 6 },
  raider: { name: 'Raider', hp: 52, spd: 50, dmg: 8, rate: 1.3, w: 14, h: 30, color: '#b0553a', xp: 8, ranged: 210 },
  ram:    { name: "Pike's ram rig", hp: 420, spd: 55, dmg: 24, rate: 1, w: 72, h: 40, color: '#6a4a3a', xp: 60 },
  brute:  { name: 'Brute', hp: 240, spd: 26, dmg: 32, rate: 1.6, w: 26, h: 40, color: '#6d5a7a', xp: 22 },
  cinder: { name: 'Cinder', hp: 520, spd: 34, dmg: 16, rate: 0.9, w: 20, h: 36, color: '#e0e0d6', xp: 120, ranged: 240, boss: true },
  burrower: { name: 'Burrower', hp: 70, spd: 44, dmg: 10, rate: 1.1, w: 22, h: 20, color: '#7a6048', xp: 12, tunnel: true },
  maw:    { name: 'The Maw', hp: 900, spd: 30, dmg: 26, rate: 1.4, w: 44, h: 34, color: '#5b4a3a', xp: 150, boss: true, burrow: true },
};

const TURRETS = {
  rifle:   { name: 'Rifle turret', range: 620, cd: 1.15, dmg: 19, pellets: 1, base: 0.35, accK: 0.55, hp: 130, cost: { scrap: 20, parts: 6 } },
  shotgun: { name: 'Shotgun turret', range: 240, cd: 1.35, dmg: 8, pellets: 4, base: 0.42, accK: 0.40, hp: 160, cost: { scrap: 15, parts: 8 } },
  // Slow-field coil: no gunner needed, but only works while the generator runs. slow = enemy speed multiplier, fuel = scrap per game hour.
  coil:    { name: 'Slow-field coil', range: 300, cd: 0, dmg: 0, pellets: 0, base: 0, accK: 0, hp: 110, cost: { scrap: 25, parts: 10, elec: 4 }, slow: 0.45, fuel: 0.15, desc: 'Needs the generator running (burns extra scrap). Slows every enemy in range to under half speed. No crew needed, deals no damage.' },
};

// ---------------------------------------------------------------- held items
// Each crew member holds up to one weapon (c.held) and can carry food (c.carry = { id: 'crate' | 'meal', n }).
// Weapons are crafted at the workshop (S.craft queue), looted from enemies that carried them (e.gear), kept in S.stock,
// and dismantled back into scrap and parts. They are for show for now: they do not change combat numbers.
// cost = what crafting spends, back = what dismantling returns, work = workshop work units to build one.
const GEAR = {
  pipe:    { name: 'Pipe club', kind: 'melee', cost: { scrap: 6 },            back: { scrap: 3 },           work: 15 },
  machete: { name: 'Machete',   kind: 'melee', cost: { scrap: 10, parts: 1 }, back: { scrap: 5, parts: 1 },  work: 25 },
  pistol:  { name: 'Pistol',    kind: 'gun',   cost: { scrap: 12, parts: 4 }, back: { scrap: 6, parts: 2 },  work: 40 },
  smg:     { name: 'SMG',       kind: 'gun',   cost: { scrap: 18, parts: 8 }, back: { scrap: 9, parts: 4 },  work: 70 },
  shotgun: { name: 'Shotgun',   kind: 'gun',   cost: { scrap: 16, parts: 6 }, back: { scrap: 8, parts: 3 },  work: 55 },
  rifle:   { name: 'Rifle',     kind: 'gun',   cost: { scrap: 20, parts: 8 }, back: { scrap: 10, parts: 4 }, work: 80 },
};
const GEAR_IDS = Object.keys(GEAR);
const GEAR_PREF = ['rifle', 'shotgun', 'smg', 'pistol', 'machete', 'pipe'];   // who gets what first when arming the crew
const CRAFT_MAX = 6;
// what each enemy type may be carrying: [gear id or null, weight]
const ENEMY_GEAR = {
  raider: [['pistol', 3], ['shotgun', 2], ['rifle', 1], ['machete', 1]],
  brute:  [['pipe', 1]],
  ghoul:  [['pipe', 1], [null, 3]],
  cinder: [['smg', 1]],
};
function rollGear(type) {
  const t = ENEMY_GEAR[type]; if (!t) return null;
  let r = Math.random() * t.reduce((a, x) => a + x[1], 0);
  for (const [id, w] of t) { r -= w; if (r < 0) return id; }
  return null;
}
const stock = () => S.stock || (S.stock = {});
function addStock(id, n = 1) { if (GEAR[id]) stock()[id] = (stock()[id] || 0) + n; }
const gearName = id => (GEAR[id] ? GEAR[id].name : String(id)).toLowerCase();
function refundGear(id) {
  const g = GEAR[id]; if (!g) return;
  for (const [k, v] of Object.entries(g.back)) S.res[k] = (S.res[k] || 0) + v;
  lamp('Dismantled a ' + gearName(id) + ' for ' + fmtCost(g.back) + '.', 'good');
}
function craftGear(id) {
  const g = GEAR[id]; if (!g || !canPay(g.cost)) return;
  if (!Array.isArray(S.craft)) S.craft = [];
  if (S.craft.length >= CRAFT_MAX) return;
  pay(g.cost); S.craft.push({ id, left: g.work, max: g.work });
}
function dismantleGear(id) { if (!GEAR[id] || !(stock()[id] > 0)) return; stock()[id]--; refundGear(id); }
function equipGear(c, id) {
  if (!c || !GEAR[id] || !(stock()[id] > 0)) return;
  if (c.held) addStock(c.held, 1);
  stock()[id]--; c.held = id; c.noArm = false;
}
function unequipGear(c) { if (c && c.held) { addStock(c.held, 1); c.held = null; c.noArm = true; } }
function dismantleHeld(c) { if (c && c.held) { const id = c.held; c.held = null; c.noArm = true; refundGear(id); } }
// food a worker is carrying goes back where it came from
function dropCarry(c) {
  const cr = c.carry; if (!cr) return;
  if (cr.id === 'crate') S.res.food += cr.n; else kit().cooked += cr.n;
  c.carry = null;
}
// unarmed crew take weapons out of stock each hour: turret and door guards first, then the best shots
function autoArm() {
  if (!S.stock) return;
  const guard = c => (c.job === 'turretA' || c.job === 'turretB' || c.job === 'door') ? 1 : 0;
  const want = living().filter(c => !c.held && !c.noArm && !c.patient).sort((a, b) => (guard(b) - guard(a)) || (b.stats.acc - a.stats.acc));
  for (const c of want) { const id = GEAR_PREF.find(x => stock()[x] > 0); if (!id) break; equipGear(c, id); }
}
function gearAct(act, id, crewId) {
  const c = crewId ? S.crew.find(x => x.id === crewId) : null;
  if (act === 'craft') craftGear(id);
  else if (act === 'dis') dismantleGear(id);
  else if (act === 'equip') equipGear(c, id);
  else if (act === 'unequip') unequipGear(c);
  else if (act === 'disheld') dismantleHeld(c);
}

// Goal choice: 'tower' (signal tower) or 'vehicle' (escape vehicle). Both reuse the TOWER stage pipeline; setGoal swaps the stages in place.
let GOAL_KIND = 'tower';
const VEHICLE = [
  { name: 'Chassis frame', cost: { scrap: 50, mat: 25 }, work: 45, line: 'The frame is welded. It is ugly, and it is ours.' },
  { name: 'Engine and drivetrain', cost: { parts: 24, elec: 6 }, work: 60, line: 'The engine coughs, catches, and holds an idle.' },
  { name: 'Armor and fuel', cost: { scrap: 45, mat: 20, parts: 10 }, work: 70, line: 'Plated and fueled. It might survive the ash roads.' },
  { name: 'Ignition and loading', cost: { parts: 20, elec: 10, mat: 15 }, work: 85, line: '' },
];
function setGoal(kind) {
  if (!setGoal.base) setGoal.base = TOWER.slice();
  GOAL_KIND = kind === 'vehicle' ? 'vehicle' : 'tower';
  const src = GOAL_KIND === 'vehicle' ? VEHICLE : setGoal.base;
  TOWER.length = 0; TOWER.push(...src);
}
// Signal tower: pay for a stage, then crew on the Signal tower job put work into it (Tech skill).
const TOWER = [
  { name: 'Antenna mast', cost: { scrap: 40, mat: 20 }, work: 40, line: 'The mast is up. Topside will see it, so expect company.' },
  { name: 'Power coupling', cost: { parts: 20, elec: 8 }, work: 55, line: 'Coupling live. The old beacon network is answering with noise.' },
  { name: 'Signal array', cost: { scrap: 40, elec: 14 }, work: 70, line: 'Array aligned. There is a carrier wave under the noise. Priya would call it a voice.' },
  { name: 'Decode the carrier', cost: { parts: 20, elec: 12, mat: 15 }, work: 85, line: '' },
];

const NAMED = [
  { id: 'bram', name: 'Old Bram', role: 'Engineer', color: '#8c8f96', accent: '#d9d4c8', stats: { acc: 0.45, build: 1.6, cook: 0.7, med: 0.5, tech: 1.1 }, bonds: ['reed', 'tick'], job: 'workshop', shift: 'day', hp: 120 },
  { id: 'juno', name: 'Juno Park', role: 'Sharpshooter', color: '#3f5f8f', accent: '#f2c14e', stats: { acc: 0.92, build: 0.6, cook: 0.5, med: 0.4, tech: 0.6 }, bonds: [], job: 'turretA', shift: 'night', hp: 100 },
  { id: 'reed', name: 'Doc Reed', role: 'Medic', color: '#e8e4da', accent: '#6b8fb0', stats: { acc: 0.35, build: 0.5, cook: 0.9, med: 1.8, tech: 0.8 }, bonds: ['bram'], job: 'med', shift: 'day', hp: 90 },
  { id: 'tick', name: 'Tick', role: 'Runner', color: '#a86b3c', accent: '#59d0c4', stats: { acc: 0.55, build: 0.9, cook: 0.6, med: 0.4, tech: 0.9 }, bonds: ['bram'], job: 'kitchen', shift: 'day', hp: 85 },
  // Arrive later through recruit events (arrives: true), not part of the starting crew.
  { id: 'dorrow', name: 'Sgt. Hale Dorrow', role: 'Drill Sergeant', color: '#7d8a70', accent: '#d9d4c8', stats: { acc: 0.8, build: 0.7, cook: 0.3, med: 0.5, tech: 0.4 }, bonds: ['juno'], job: 'idle', shift: 'day', hp: 130, loyalty: 1, arrives: true,
    relationships: { rook: 'wary' },
    history: [
      { with: 'juno', kind: 'mentor', text: 'Trained her at the checkpoint; both were wounded the night it fell.' },
      { with: 'vesper', kind: 'rival', text: 'She served under him before she defected.' },
      { with: 'warden', kind: 'guilt', text: 'The Warden was his unit\u2019s guardian robot; he carries the guilt of its fall.' },
      { with: 'rook', kind: 'mentor', text: 'Rook was among the raiders at his checkpoint; he offers him a second chance.' } ] },
  { id: 'rook', name: 'Rook', role: 'Defector', color: '#b0553a', accent: '#d9d4c8', stats: { acc: 0.75, build: 0.7, cook: 0.4, med: 0.3, tech: 0.5 }, bonds: ['dorrow'], job: 'idle', shift: 'day', hp: 110, loyalty: 1, arrives: true,
    relationships: { dorrow: 'wary' },
    history: [
      { with: 'cinder', kind: 'rival', text: 'Raised by Cinder as a raider.' },
      { with: 'vesper', kind: 'rival', text: 'Shaped by her; she recruited his loyalty.' },
      { with: 'juno', kind: 'tension', text: 'Present at the checkpoint attack that wounded her and Dorrow.' },
      { with: 'dorrow', kind: 'mentor', text: 'Dorrow gives him a second chance.' } ] },
];
// Named recruits kept separate from the generic generator. history.checkpoint is shared by Dorrow and Rook.
const NAMED_RECRUITS = {
  dorrow: NAMED.find(n => n.id === 'dorrow'),
  rook: NAMED.find(n => n.id === 'rook')
};
const PAIR_HISTORY = { checkpoint: 'Dorrow commanded the checkpoint that fell. Rook was among the raiders who attacked it, the night Juno and Dorrow were wounded.' };
function ensurePair(s) {
  if (!s.pair || typeof s.pair !== 'object') s.pair = {};
  const p = s.pair;
  p.v = 1;
  if (typeof p.dorrowDone !== 'boolean') p.dorrowDone = false;
  if (typeof p.trust !== 'number') p.trust = 0;
  if (typeof p.checkpointRevealed !== 'boolean') p.checkpointRevealed = false;
  if (typeof p.reconciled !== 'boolean') p.reconciled = false;
}
function pairOnJoin(id) {
  const other = id === 'dorrow' ? 'rook' : 'dorrow';
  if (!S.crew.some(c => c.id === other && c.alive)) return;
  if (id === 'dorrow') lampEv('newcomer', 'Sergeant Dorrow has seen Rook across the bunker. He says nothing, but his hand rests on the riot shield. Give them time, Mara.', 'warn');
  else lampEv('newcomer', 'Sergeant Dorrow recognises Rook at once. The room goes quiet. Rook looks at the floor.', 'warn');
}
function recruitDorrow() {
  ensurePair(S);
  if (S.pair.dorrowDone || S.crew.some(c => c.id === 'dorrow')) return;
  S.pair.dorrowDone = true;
  const c = makeCrew({ ...NAMED_RECRUITS.dorrow, named: true });
  c.x = 300; c.floor = 0; c.y = FLOORS[0];
  S.crew.push(c);
  moment('Sergeant Dorrow joined');
  lampEv('newcomer', 'Sergeant Hale Dorrow, formerly of the checkpoint, stands at the hatch in a faded armor vest. He offers to train the crew for breach fights. He does not say what happened at his checkpoint.', 'good');
  pairOnJoin('dorrow');
}
function pairTick(mins) {
  ensurePair(S);
  const d = S.crew.find(c => c.id === 'dorrow' && c.alive), r = S.crew.find(c => c.id === 'rook' && c.alive);
  if (!d || !r) return;
  const h = mins / 60;
  S.pair.trust += h;
  if (S.pair.trust < 24) { d.mor = clamp((d.mor ?? 70) - 1.5 * h, 0, 100); r.mor = clamp((r.mor ?? 70) - 1.5 * h, 0, 100); return; }
  if (!S.pair.checkpointRevealed) { S.pair.checkpointRevealed = true; lampEv('newcomer', PAIR_HISTORY.checkpoint + ' Today Dorrow asked Rook to join breach drills. Rook said yes.', 'good'); }
  if (!S.pair.reconciled) { S.pair.reconciled = true; moment('Dorrow and Rook made peace'); }
  d.mor = clamp((d.mor ?? 70) + 1 * h, 0, 100); r.mor = clamp((r.mor ?? 70) + 1 * h, 0, 100);
}
const FIRST = ['Ada', 'Moss', 'Ike', 'Rena', 'Cole', 'Vee', 'Hollis', 'Sana', 'Dax', 'Lio', 'Petra', 'Gus', 'Imani', 'Teo', 'Wynn', 'Brin', 'Ozzie', 'Kara'];
const LAST = ['Hart', 'Ruiz', 'Mbeki', 'Cole', 'Vance', 'Oduya', 'Kim', 'Shaw', 'Ferro', 'Lund', 'Nakai', 'Bishop'];
const SURV_COLORS = ['#6f7d5a', '#7a5f8f', '#8f6f4a', '#4f7f7a', '#94604e', '#5a6f94', '#8a8a5a'];

// ---------------------------------------------------------------- helpers
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtCost = c => Object.entries(c).map(([k, v]) => v + ' ' + (k === 'parts' && v === 1 ? 'part' : RES.find(r => r.k === k).name.toLowerCase())).join(', ');
let uid = 1;

// Lamp's voice: several variants per event so repeated raids do not read the same. lampSay(key, kind) picks one.
const LAMP_LINES = {
  raidWarn: ['Forgive the interruption. The scanner reports movement on the ridge. I estimate one hour until a raid.', 'Heat signatures to the east, Mara. One hour remains. Perhaps the turret crews could be reminded.', 'Maintenance log, year one: "Perimeter wire tested, found adequate." I hope the log is still right. Raid in one hour.'],
  raidNow: ['The raid has arrived. I count {n} hostiles approaching from the east. You have held the door before.', 'I regret to report {n} contacts at the wire. The crew is ready, and so am I.', 'Maintenance log, hatch seal: "Rated for sustained assault." Let us see if it is. {n} hostiles are closing.'],
  probe: ['A few hounds are investigating the outer wall before dawn. Nothing to worry about, I think.', 'There is scratching on the outer wall. Hounds, by the sound of it. They will tire eventually.', 'Early visitors at the wire. Hounds again. They are persistent, if nothing else.'],
  breach: ['The hatch has been breached. Hostiles are in the shaft. All hands to battle stations, please. I know you can hold them.', 'Breach. I am sorry, Mara. The hatch has failed. Everyone to the floors, and look after one another.', 'Maintenance log, hatch: "Do not rely on the hatch alone." The builders were wise. The hatch is open. Please defend the shaft.'],
  towerHalf: ['The {name} is half complete. Well done, everyone. Please keep the crew on it.', 'Halfway through the {name}. I can hear the tower beginning to hum, and I find it encouraging.', 'Maintenance log, signal room: "Beacon dormant, awaiting a steady hand." The {name} is half done. Many steady hands, I think.'],
  towerLeft: ['{n} stage(s) remain. We are closer than we have ever been.', 'We are {n} stage(s) from a signal. Nell will be pleased.', 'Only {n} stage(s) lie between us and the surface. I have begun to hope.'],
  breachClue: ['Maintenance log, hatch: "Seal integrity ▒▒▒▒▒▒▒. Cause ▒▒▒▒▒▒▒▒, see entry ▒▒▒." The rest is unreadable. I am sorry, Mara. I will keep looking.'],
  breachCause: ['I have recovered the hatch log, Mara. "Seal fatigue, flagged and left unrepaired." The first breach was not the wasteland alone. It was a warning we never answered. With the tower rising, I wanted you to know.'],
  towerWin: ['The carrier is decoded, Mara. That is a voice, and it is answering us. I believe we are going home.', 'Maintenance log, final entry: "Signal received. Open the hatch." Decode complete. Someone is calling back. Thank you, all of you.']
};
// Exact narrator script text, one entry per recorded take (no [tags]). Popups show the take that plays.
const VO_TEXT = {
  vo_goal_tracker_01: "Goals are listed on the right. Assign a gunner, scavenge topside, then start and finish tower stage 1. The next step is highlighted.",
  vo_help_hint_01: "First time? Press H for controls.",
  vo_help_hint_02: "First time? Tap Help for controls.",
  vo_match_start_01: "Bunker systems online. Survivors present. Optimism, pending.",
  vo_match_start_02: "Welcome back. The apocalypse is outside. The snacks are inside.",
  vo_new_day_01: "Good morning. Everyone is alive, which is a pleasant surprise.",
  vo_new_day_02: "Another dawn. Stores counted. Please try not to look at them.",
  vo_raid_warn_01: "Movement on the ridge. One hour. Wake your gunners.",
  vo_raid_warn_02: "Heat signatures approaching. Raid in one hour. Man the turrets.",
  vo_wave_start_01: "Incoming wave. It looks hungry and rude.",
  vo_wave_start_02: "New threats detected. Please act surprised, then act fast.",
  vo_wave_stronger_01: "Threat level rising. Your sandbags are looking optimistic.",
  vo_wave_stronger_02: "They've gotten bigger. I did warn you. Quietly.",
  vo_wave_clear_01: "Wave cleared. Enjoy the silence. It won't last.",
  vo_wave_clear_02: "All clear. Nicely done, squishy ones.",
  vo_probe_01: "Hounds at the outer wall. They're mostly curious. Mostly.",
  vo_probe_02: "Scratching outside. Early visitors. Terrible manners.",
  vo_boss_warn_01: "A convoy with a painted grin. That's Cinder. One hour.",
  vo_boss_warn_02: "Scanner shows Cinder's convoy. Do tidy up. He's the judgmental type.",
  vo_boss_arrive_01: "Cinder is here. Hold the door. Please.",
  vo_boss_arrive_02: "Big threat at the gate! Everyone to your posts!",
  vo_boss_down_01: "Cinder is down! His raiders are scattering. Well, that was rude of him.",
  vo_boss_down_02: "Cinder has fallen. I'd say he's out of the leader category.",
  vo_door_attack_01: "Something is knocking. It did not bring snacks.",
  vo_door_attack_02: "Door under attack. Please respond with enthusiasm.",
  vo_door_low_01: "Door integrity critical. It's more of a suggestion now.",
  vo_door_low_02: "That door is failing! Reinforce it or wave goodbye!",
  vo_door_breach_01: "Door breached. Well. That's one way to get fresh air.",
  vo_door_breach_02: "Breach! We now have an open-plan bunker.",
  vo_door_repair_01: "Door restored. Almost as good as new. Almost.",
  vo_door_repair_02: "Reinforced. The monsters are mildly inconvenienced.",
  vo_wall_down_01: "The outer wall is down. The door is now the plan.",
  vo_wall_down_02: "Wall gone. That was our first line. Now it's the only line.",
  vo_turret_lost_01: "Turret destroyed. It died doing what it loved. Shooting.",
  vo_turret_lost_02: "We've lost a turret. Scrap is available, if you're feeling brave.",
  vo_power_out_01: "Generator's dry. We're back to elbow grease.",
  vo_power_out_02: "Power's out. Feed the generator some scrap. It's very polite about it.",
  vo_power_back_01: "Lights are back. I missed having opinions about them.",
  vo_power_back_02: "Power restored. The rooms are working properly again.",
  vo_topside_exit_01: "Heading topside. Remember: the radiation is not a tan.",
  vo_topside_exit_02: "Scavenger on the surface. Please bring back something useful.",
  vo_topside_return_01: "Supplies acquired. The scavenger lives. Everyone's pleasantly surprised.",
  vo_topside_return_02: "Loot secured. I'd call that a successful errand.",
  vo_topside_danger_01: "Scavenger in trouble. Run first, loot later.",
  vo_topside_danger_02: "Your scavenger is being chased. Cardio time.",
  vo_survivor_lost_01: "We've lost a survivor. Moment of silence. Brief one.",
  vo_survivor_lost_02: "One fewer survivor. The bunker feels roomier. Sorry.",
  vo_survivor_lost_many_01: "Multiple casualties. This is going badly. I'm being polite.",
  vo_survivor_lost_many_02: "Casualties are mounting. So is my concern.",
  vo_survivor_down_01: "Survivor down. Medical attention, please. Any attention, really.",
  vo_survivor_down_02: "Someone's hurt. Please help. Gently.",
  vo_survivor_revive_01: "Back on their feet. Resilient little things, aren't you?",
  vo_survivor_revive_02: "Survivor recovered. Medicine works. Who knew?",
  vo_hungry_01: "Some of us skipped a meal. Hydroponics needs hands.",
  vo_hungry_02: "Food is short. Please farm, or go foraging. Preferably before grumbling.",
  vo_newcomer_01: "A new survivor. Please be nice. They're not sure about us yet.",
  vo_newcomer_02: "Someone knocked and I opened. Give them a job. And a pillow.",
  vo_deserter_01: "Someone left in the night. They took supplies. Morale matters, apparently.",
  vo_deserter_02: "A survivor has quit. With luggage. I'd call that a review.",
  vo_exit_build_start_01: "Construction started. Escape is now a project, not a dream.",
  vo_exit_build_start_02: "Exit build underway. Hammers up. Panic optional.",
  vo_exit_half_01: "Halfway there. The future looks structurally plausible.",
  vo_exit_half_02: "Fifty percent complete. Do not lean on it.",
  vo_exit_almost_01: "Almost done! Keep the doors shut a little longer.",
  vo_exit_almost_02: "Nearly finished. Don't die now. It'd be embarrassing.",
  vo_exit_resources_01: "Insufficient materials. Someone should go shopping topside.",
  vo_exit_resources_02: "We're short on parts. Duct tape is not a plan.",
  vo_victory_01: "Escape successful! Everyone out. Please enjoy the sun responsibly.",
  vo_victory_02: "Signal sent, help is coming. I knew you could do it. Mostly.",
  vo_defeat_01: "The bunker has fallen. I'll file this under learning experiences.",
  vo_defeat_02: "All survivors lost. Shall we try again? I'll tidy up.",
  vo_pop_50_01: "Population halved. Fewer queues for the showers.",
  vo_pop_50_02: "Half the survivors are gone. That's concerning. Mathematically.",
  vo_pop_10_01: "Ten survivors left. Everyone gets a bunk now.",
  vo_pop_10_02: "Ten remain. Please stop losing people.",
  vo_pop_03_01: "Three survivors. A very exclusive club.",
  vo_pop_03_02: "Three left. Please don't make it two."
};
// Text for the take that plays (clip may be an id or a file path); else a random take for the event; else the old text.
function narrText(clip, ev, fallback) {
  if (clip) { const m = String(clip).match(/(vo_[a-z0-9_]+?_\d+)(?:\.\w+)?$/i); if (m && VO_TEXT[m[1]]) return VO_TEXT[m[1]]; }
  if (ev) {
    const base = 'vo_' + (ev === 'pop_3' ? 'pop_03' : ev) + '_';
    const ids = Object.keys(VO_TEXT).filter(k => k.startsWith(base) && /^\d+$/.test(k.slice(base.length)));
    if (ids.length) return VO_TEXT[pick(ids)];
  }
  return fallback;
}
// True if the lamp popup log already shows this exact line (captions hide to avoid a duplicate).
function narrPopupShowing(t) {
  try {
    if (!logs.some(l => l.text === t)) return false;
    const el = document.getElementById('log');
    if (!el || !el.isConnected) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return false;
    if (r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth) return false;
    for (let p = el.parentElement; p; p = p.parentElement) {
      const ps = getComputedStyle(p);
      if (ps.display === 'none' || ps.visibility === 'hidden' || parseFloat(ps.opacity) < 0.05) return false;
    }
    return true;
  } catch (e) { return false; }
}
let doorLowSaid = false;
let doorHitAt = -9999;   // performance.now() of the last enemy hit on the door (drives the flash)
// Crack polylines in door-local coords (x from centre, y up from the ground), revealed as HP drops.
const DOOR_CRACKS = [
  [[-4, -38], [-1, -30], [-5, -24], [-2, -17]],
  [[6, -38], [3, -31], [8, -25], [5, -19], [9, -12]],
  [[-12, -20], [-6, -16], [-9, -9], [-3, -4]],
  [[10, -8], [4, -11], [6, -3]],
  [[-14, -34], [-9, -29], [-13, -23]],
  [[1, -17], [-1, -10], [3, -5], [0, 0]]
];
const LAMP_CLIPS = { raidNow: 'wave_start', breach: 'door_breach', towerHalf: 'exit_half', towerLeft: 'exit_almost', towerWin: 'victory', raidWarn: 'raid_warn', probe: 'probe' };
function lampSay(key, kind, vars) {
  let ev = LAMP_CLIPS[key];
  if (key === 'towerLeft' && vars && vars.n > 1) ev = null; // exit_almost only fits the last stage
  if (key === 'raidNow' && vars && vars.strong) ev = 'wave_stronger';
  const clip = ev ? narrPick(ev) : null;
  let t = narrText(clip, ev, pick(LAMP_LINES[key]));
  if (vars) for (const k in vars) t = t.split('{' + k + '}').join(vars[k]);
  lamp(t, kind, 0, clip);
}
// One-off line with a narrator clip: NARR_TEXT (if filled in) replaces the fallback text.
// ---- toast notifications (visual only; srSay already announces the same text via lamp())
const TOAST_EVENTS = { newcomer: 'Arrival', survivor_lost: 'Survivor lost', survivor_lost_many: 'Survivors lost', power_out: 'Power out', power_back: 'Power restored' };
function lampEv(ev, text, kind, delayMs) {
  if (quiet) return;   // the silent title-screen run must not use up clips (narrPick starts an 8 s repeat cooldown)
  if (TOAST_EVENTS[ev] && !quiet) {
    const t = () => toast(TOAST_EVENTS[ev] + ': ' + String(text || '').split(/(?<=[.!?])\s/)[0].slice(0, 110), kind);
    delayMs ? setTimeout(t, delayMs) : t();
  }
  const clip = narrPick(ev);
  lamp(narrText(clip, ev, text), kind, delayMs, clip);
}

// ---------------------------------------------------------------- 2. game state
const RAID_HOUR = 21;   // hour of day (0-23) when the nightly raid hits
const RAID_CLOCK = String(RAID_HOUR).padStart(2, '0') + ':00';
let S = null;          // the whole run (saved)
let P = null;          // Mara, the player
let scene = 'menu';    // menu | bunker | scav | over
let speed = 1, paused = false;
const fx = { tracers: [], parts: [], nums: [], bullets: [], casings: [], sprk: [] };
let scav = null;       // the current scavenging trip (not saved)

function makeCrew(base) {
  return {
    id: base.id || ('s' + (uid++)), name: base.name, role: base.role || 'Survivor', named: !!base.named, color: base.color, accent: base.accent || '#cfcfcf',
    stats: { ...base.stats }, bonds: base.bonds || [], job: base.job || 'idle', shift: base.shift || 'day',
    maxHp: base.hp || 100, hp: base.hp || 100, food: 80, awake: 2, xp: 0, lvl: 1, loyalty: base.loyalty ?? 1, grief: 0, mor: 70, alive: true,
    x: 300 + Math.random() * 300, y: FLOORS[3], floor: 3, climbing: false, state: 'walk', cd: 0, facing: 1, anim: Math.random() * 10, kills: 0, traits: base.traits || [], past: base.past || null, history: base.history || null,
  };
}
function randomSurvivor() {
  if (typeof CrewGen !== 'undefined') {
    const g = CrewGen.generate(Math.random);
    return { name: pick(FIRST) + ' ' + pick(LAST), role: g.role, color: pick(SURV_COLORS), accent: '#d8cfbf', stats: g.stats, hp: g.hp, loyalty: g.loyalty, traits: g.traits, past: g.past, job: 'idle', shift: Math.random() < 0.5 ? 'day' : 'night' };
  }
  const s = () => +rnd(0.4, 1.15).toFixed(2);
  const stats = { acc: s(), build: s(), cook: s(), med: s(), tech: s() };
  const best = Object.entries(stats).sort((a, b) => b[1] - a[1])[0][0];
  const role = { acc: 'Shooter', build: 'Builder', cook: 'Cook', med: 'Medic', tech: 'Tinkerer' }[best];
  return { name: pick(FIRST) + ' ' + pick(LAST), role, color: pick(SURV_COLORS), accent: '#d8cfbf', stats, hp: Math.round(rnd(80, 105)), loyalty: +rnd(0.25, 0.9).toFixed(2), job: 'idle', shift: Math.random() < 0.5 ? 'day' : 'night' };
}
function newRun(goal) {
  doorLowSaid = false;
  setGoal(goal === 'vehicle' ? 'vehicle' : 'tower');
  scav = null;
  S = {
    v: 1, rid: Math.random(), t: 8 * 60, lastHour: 8, res: { food: 40, scrap: 40, parts: 6, elec: 2, mat: 10 },
    door: { hp: 400, max: 400 }, wall: { hp: 300, max: 300, lvl: 1 }, breached: false,
    turrets: [{ type: 'rifle', hp: 130, max: 130, lvl: 1, cd: 0 }, null],
    rooms: { kitchen: 1, hydro: 1, med: 1, bunks: 1 }, makeParts: true, ladders: [], builds: {}, batt: 0, cond: {}, rsch: { done: {}, cur: null, prog: {} }, exp: { teams: [], log: [], seq: 0 },
    goalKind: GOAL_KIND, tower: { done: 0, paid: false, work: 0 }, kit: { cooked: 8, cap: 16, prog: 0, raw: 6 }, stock: { pipe: 1, pistol: 1 }, craft: [],
    crew: [], enemies: [], spawns: [], alarm: false, stats: { kills: 0, trips: 0, raids: 0, lost: [], repelled: 0, scav: {}, moments: [] }, won: false, hint: 0,
    player: { hp: 100, maxHp: 100, food: 80, xp: 0, lvl: 1, down: 0, revives: maxRevives() },
  };
  ensurePair(S);
  for (const n of NAMED) if (!n.arrives) S.crew.push(makeCrew({ ...n, named: true }));
  const a = makeCrew(randomSurvivor()); a.job = 'turretA'; a.shift = 'day'; a.loyalty = 1; S.crew.push(a);
  const b = makeCrew(randomSurvivor()); b.job = 'hydro'; b.shift = 'day'; b.loyalty = 1; S.crew.push(b);
  // Juno takes the turret at night; the day-shift survivor covers it in daytime.
  placePlayer('bunker');
  fx.tracers = []; fx.parts = []; fx.nums = []; fx.bullets = []; fx.sprk = [];
  logs.length = 0;
  lampEv('match_start', 'Lamp online. Good morning, Mara. It is day 1, 08:00. The first raid is due at ' + RAID_CLOCK + '.');
  lamp('Someone has to sit at a turret or it will not fire. Open Crew (C) to give people jobs and shifts.', '', 900);
  lamp('The signal tower needs electronics we do not have. Walk right across the surface to scavenge. Time keeps running while you are out.', '', 1800);
  // First-run controls hint (voice + caption), once per browser. Take 02 = touch wording, 01 = keyboard.
  let helpSeen = quiet;   // the silent title-screen run doesn't count as having heard the hint
  if (!quiet) { try { helpSeen = localStorage.getItem('ashfall.helpHint') === '1'; localStorage.setItem('ashfall.helpHint', '1'); } catch (e) {} }
  if (!helpSeen) {
    const touchUI = document.body.classList.contains('touch');
    const hClip = narrPickTake('help_hint', touchUI ? 2 : 1);
    lamp(narrText(hClip, null, touchUI ? 'First time? Tap Help for controls.' : 'First time? Press H for controls.'), '', 2700, hClip);
  }
}
function save() {
  if (!S || S.over) return;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(scene === 'scav' ? { S } : { S, P: { x: P.x, y: P.y } })); } catch {}
}
function loadSave() {
  try { const d = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); if (d && d.S && d.S.v === 1 && !d.S.over) return d; } catch {}
  return null;
}
function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch {} }
// fill in fields that older saves lack; throws if the save is unusable
function migrateSave(sv) {
  const s = sv.S;
  if (!s || !Array.isArray(s.crew) || !s.res || !s.door || !s.turrets) throw new Error('bad save');
  if (!Array.isArray(s.enemies)) s.enemies = [];
  if (!Array.isArray(s.spawns)) s.spawns = [];
  if (!s.stats || typeof s.stats !== 'object') s.stats = {};
  const st = s.stats;
  for (const k of ['kills', 'trips', 'raids', 'repelled']) if (typeof st[k] !== 'number') st[k] = 0;
  if (!Array.isArray(st.lost)) st.lost = [];
  if (!Array.isArray(st.moments)) st.moments = [];
  if (!st.scav || typeof st.scav !== 'object') st.scav = {};
  if (!s.player || typeof s.player !== 'object') s.player = { hp: 100, maxHp: 100, food: 80, xp: 0, lvl: 1, down: 0 };
  if (!s.player.carried || typeof s.player.carried !== 'object') delete s.player.carried;
  if (typeof s.player.revives !== 'number') s.player.revives = maxRevives();
  if (typeof s.player.packLvl !== 'number') s.player.packLvl = 0;
  for (const k of ['food', 'scrap', 'parts', 'elec', 'mat']) if (typeof s.res[k] !== 'number') s.res[k] = 0;
  // the dig grid is rebuilt on first use when missing; drop anything malformed
  if (s.dig !== undefined && (!s.dig || typeof s.dig !== 'object')) delete s.dig;
  if (s.dig && (!s.dig.lad || typeof s.dig.lad !== 'object')) s.dig.lad = {};
  if (!Array.isArray(s.ladders)) s.ladders = [];
  if (!s.builds || typeof s.builds !== 'object') s.builds = {};
  if (!s.cond || typeof s.cond !== 'object') s.cond = {};
  if (!s.rsch || typeof s.rsch !== 'object' || !s.rsch.done || typeof s.rsch.prog !== 'object') s.rsch = { done: {}, cur: null, prog: {} };
  if (!s.exp || !Array.isArray(s.exp.teams)) s.exp = { teams: [], log: [], seq: 0 };
  if (!Array.isArray(s.exp.log)) s.exp.log = [];
  s.exp.teams = s.exp.teams.filter(t => t && DESTS[t.dest] && Array.isArray(t.ids) && typeof t.back === 'number');
  for (const c of s.crew) if (c && c.exp && !s.exp.teams.some(t => t.id === c.exp)) c.exp = null;
  if (!Array.isArray(s.drops)) s.drops = [];
  s.ladders = s.ladders.filter(l => l && (l.g === 1 || l.g === 2) && typeof l.x === 'number');
  for (const c of s.crew) { if (c && c.sched !== undefined && typeof c.sched !== 'string') delete c.sched; }
  if (!s.stock || typeof s.stock !== 'object') s.stock = {};
  if (!Array.isArray(s.craft)) s.craft = [];
  s.craft = s.craft.filter(j => j && GEAR[j.id] && typeof j.left === 'number' && typeof j.max === 'number');
  for (const c of s.crew) { if (!c) continue; if (c.held && !GEAR[c.held]) c.held = null; if (c.carry && !(c.carry.n > 0 && (c.carry.id === 'crate' || c.carry.id === 'meal'))) c.carry = null; }
  if (s.kit && typeof s.kit.raw !== 'number') s.kit.raw = 0;
  ensurePair(s);
}
// show a startup/runtime error on screen instead of a dead page
let fatalShown = false;
function fatal(e) {
  try { console.error(e); } catch {}
  if (fatalShown) return;
  fatalShown = true;
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:99999;background:#400;color:#fff;font:13px monospace;padding:10px;white-space:pre-wrap';
  d.textContent = 'Ashfall Bunker error: ' + (e && e.stack ? e.stack : String(e)).slice(0, 900) + '\n';
  const b = document.createElement('button');
  b.textContent = 'Reset save and reload';
  b.onclick = () => { clearSave(); location.reload(); };
  d.appendChild(b);
  document.body.appendChild(d);
}

// ---------------------------------------------------------------- 3. simulation
const day = () => Math.floor(S.t / 1440) + 1;
// key moments for the post-run summary (old saves may lack the list)
function moment(text) {
  const m = S.stats.moments || (S.stats.moments = []);
  if (m.length < 40) m.push('Day ' + day() + ' · ' + text);
}
const hourF = () => (S.t % 1440) / 60;
const clockText = () => { const h = Math.floor(hourF()), m = Math.floor(S.t % 60); return 'DAY ' + day() + ' · ' + String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0'); };
const isNight = () => { const h = hourF(); return h >= 20 || h < 6; };
const living = () => S.crew.filter(c => c.alive && !c.exp);   // crew out on an expedition are not in the bunker
// Schedule: 24 chars, one per hour. S = sleep, W = work (assigned job), M = meal.
let schedBrush = 'S';
function defaultSched(shift) {
  const sh = SHIFTS[shift], s = sh && sh.sleep;
  const a = [];
  for (let h = 0; h < 24; h++) a.push(s && (s[0] > s[1] ? (h >= s[0] || h < s[1]) : (h >= s[0] && h < s[1])) ? 'S' : 'W');
  const wake = s ? s[1] % 24 : 7;
  for (const k of [0, 6, 12]) a[(wake + k) % 24] = 'M';
  return a.join('');
}
const REST_BOOST = 20, REST_HOLD_MS = 700;
let restHold = null;
function restActive(c) { return !!c.restUntil && S && S.t < c.restUntil; }
function startRestDay(c) {
  if (!restActive(c)) { c.restPrev = { sched: c.sched, shift: c.shift }; }
  const a = [];
  for (let h = 0; h < 24; h++) a.push('S');
  for (const h of [7, 12, 18]) a[h] = 'M';
  c.sched = a.join(''); c.shift = 'custom'; c.restUntil = S.t + 1440;
}
function ensureSched(c) {
  if (c.restUntil && S && S.t >= c.restUntil) { const p = c.restPrev; c.restUntil = 0; c.restPrev = null; if (p) { c.sched = p.sched; c.shift = p.shift; } }
  if (typeof c.sched !== 'string' || c.sched.length !== 24) c.sched = defaultSched(c.shift);
  return c.sched;
}
function schedHTML(c) {
  const sc = ensureSched(c), hr = Math.floor(hourF()) % 24;
  const names = { S: 'Sleep', W: 'Work', M: 'Meal' };
  const meals = sc.split('M').length - 1;
  return `<div class="row" style="margin-top:5px"><span class="note" style="margin:0 4px 0 0">Schedule</span>${Object.entries(names).map(([k, n]) => `<button class="chip ${schedBrush === k ? 'on' : ''}" data-brush="${k}">${n}</button>`).join('')}</div>`
    + `<div class="sched">${sc.split('').map((ch, i) => `<i class="sc sc${ch} ${i === hr ? 'now' : ''}" data-cell="${i}" data-id="${c.id}" title="${String(i).padStart(2, '0')}:00 ${names[ch]}"></i>`).join('')}</div>`
    + (meals ? '' : '<div class="note bad">No meal block: will go hungry</div>');
}
function inSleepHours(c, h = hourF()) {
  return ensureSched(c)[Math.floor(h) % 24] === 'S';
}
function sleepFactor(awake) { return awake <= 16 ? 1 : Math.max(0.12, Math.exp(-0.2 * (awake - 16))); }
function eff(c) {
  let e = sleepFactor(c.awake);
  if (c.food < 15) e *= 0.6;
  if (c.grief > 0) e *= 0.7;
  if (c.sick) e *= 0.6;
  { const m = morale(c); if (m < 50) e *= 0.7 + 0.3 * m / 50; }
  if (c.state === 'work') e *= itemBoost(c);
  // Bonds: two people with shared history working the same room do better.
  if (c.state === 'work' && c.bonds.some(id => { const o = S.crew.find(x => x.id === id); return o && o.alive && o.state === 'work' && o.job === c.job; })) e *= 1.15;
  return e;
}
const restPct = c => clamp(100 - Math.max(0, c.awake - 4) / 16 * 100, 0, 100);
// Shared shift (morale): two survivors assigned to the same job station. Unassigned (idle) share with no one.
function sharesShift(a, b) {
  if (!a || !b || a === b || !a.alive || !b.alive) return false;
  if (!a.job || a.job === 'idle' || !b.job || b.job === 'idle') return false;
  return a.job === b.job;
}
function morale(c) { return clamp((c.mor ?? 70) + (restActive(c) ? REST_BOOST : 0), 0, 100); }
// Stored morale drifts with needs each tick (h = in-game hours).
function moraleTick(c, h) {
  let d = 0;
  if (c.food <= 0) d -= 8; else if (c.food < 25) d -= 4;
  if (c.patient) d -= 3;
  if (c.sick) d -= 3;
  if (restPct(c) < 30) d -= 2;
  if (c.grief > 0) d -= 2;
  if (c.state === 'sleep') d += c.bed === false ? floorPenalty(c) : 3;
  if (restActive(c)) d += 6;
  d += Math.min(DECO_CAP, decoCount() * 0.25);
  if (d === 0 && c.food > 50 && restPct(c) > 50) d += 1;
  c.mor = clamp((c.mor ?? 70) + d * h, 0, 100);
}

// Where a job puts someone: floor + x. People on the same job spread out.
function jobSpot(c, job) {
  if (job === 'turretA' || job === 'turretB') { const i = job === 'turretA' ? 0 : 1; return { floor: 0, x: SLOT_X[i] - 4 }; }
  if (job === 'door') { const same = living().filter(o => o.job === 'door'); return { floor: 0, x: 278 + same.indexOf(c) * 14 }; }
  const room = job === 'research' ? ROOMS.signal : (Object.values(ROOMS).find(r => r.job === job) || ROOMS.common);
  const same = living().filter(o => targetJob(o) === job);
  const i = Math.max(0, same.indexOf(c));
  const pk = pitRoomFor(job);
  if (pk) { // the job's room is a pit room: stand inside it, spread along the bottom row
    const rm = dg().rooms[pk], span2 = rm.w * DIG.cell - 30, x = dCenterX(rm.c) - DIG.cell / 2 + 15 + ((i * 37) % span2);
    return { floor: 3, pit: true, rk: pk, x, cell: dIdx(clamp(Math.floor((x - DIG.x0) / DIG.cell), rm.c, rm.c + rm.w - 1), rm.r + rm.h - 1) };
  }
  const span = room.x1 - room.x0 - 90;
  const its = roomItems(job);
  if (its.length) { const it = its[i % its.length], slot = Math.floor(i / its.length); return { floor: room.floor, x: ITX0 + (it.col + ITEM_TYPES[it.type].w / 2) * ITILE + ((slot % 3) - 1) * 14 }; }
  return { floor: room.floor, x: room.x0 + 50 + ((i * 67) % span) };
}
// What someone should be doing right now.
// Applies station capacity on top of baseJob. Door and turrets are never capped (battle stations).
const CAPPED_JOBS = ['workshop', 'research', 'signal', 'kitchen', 'hydro', 'med', 'idle'];
function targetJob(c) {
  const job = baseJob(c);
  if (c.patient || S.alarm || !CAPPED_JOBS.includes(job)) return job;
  const st = STATIONS[job], cap = st && st.capacity;
  if (cap === null || cap === undefined) return job;
  let rank = 0;
  for (const o of living()) {
    if (o === c) break;
    if (!o.patient && baseJob(o) === job) rank++;
  }
  return rank < cap ? job : 'idle';
}
function baseJob(c) {
  if (c.patient) return 'med';
  if (S.alarm) { // battle stations: turrets first, then the door
    if (c.alarmSlot != null && S.turrets[c.alarmSlot]) return c.alarmSlot ? 'turretB' : 'turretA';
    if ((c.job === 'turretA' || c.job === 'turretB') && turretFor(c.job)) return c.job;
    return 'door';
  }
  if (inSleepHours(c)) return 'sleep';
  if (ensureSched(c)[Math.floor(hourF()) % 24] === 'M') return 'meal';
  if (c.plate || hungryNow(c)) return 'meal';   // hungry: fetch food, eat it at the table, then go back to work
  if ((c.job === 'turretA' || c.job === 'turretB') && !turretFor(c.job)) return 'door';
  if (c.job === 'workshop' && !S.rooms.workshop) return 'idle';   // no workshop built yet
  if (c.job === 'research' && !(S.builds && S.builds.lab)) return 'idle';   // no research bench yet
  return c.job;
}
const turretFor = job => S.turrets[job === 'turretB' ? 1 : 0];
// Gunners just take the Turret job: this picks the built gun with the fewest gunners (never a coil, which needs nobody).
function autoTurret(c) {
  const slots = [0, 1].filter(i => S.turrets[i] && S.turrets[i].type !== 'coil');
  if (!slots.length) return 'turretA';
  const load = i => S.crew.filter(o => o.alive && o !== c && o.job === (i ? 'turretB' : 'turretA')).length;
  let best = slots[0]; for (const i of slots) if (load(i) < load(best)) best = i;
  return best ? 'turretB' : 'turretA';
}
// Re-spread gunners: off a missing or coil slot, or off a crowded gun when another gun has fewer.
function balanceTurrets() {
  if (!S) return;
  for (const c of S.crew) {
    if (!c.alive || (c.job !== 'turretA' && c.job !== 'turretB')) continue;
    const mine = S.turrets[c.job === 'turretB' ? 1 : 0], n = autoTurret(c);
    if (n === c.job) continue;
    const cnt = j => S.crew.filter(o => o.alive && o !== c && o.job === j).length;
    if (!mine || mine.type === 'coil' || cnt(n) < cnt(c.job)) { c.job = n; c.alarmSlot = null; }
  }
}
// hungry enough to stop work and eat, and there is something to eat
function hungryNow(c) { return c.food < 30 && (kit().cooked >= 1 || S.res.food >= 1); }
// a plate in hand is dropped where the person stands (battle stations, med bay, sleep) and left on the floor for a while
function dropPlate(c) {
  (S.drops || (S.drops = [])).push({ x: c.x, y: c.y, t: S.t });
  c.plate = false; c.rawPlate = false; c.eatT = 0; c.queued = 0;
}
// ---- task icons: a small badge above each survivor showing what they are doing right now ----
const TASK_ICON = {
  turret: '#ff9a5a', door: '#9ab0c8', workshop: '#ffb347', signal: '#7fc8ff', kitchen: '#ff8a4a', hydro: '#7ddc6f',
  med: '#ff6a6a', mine: '#c9a27a', meal: '#e8d8a8', sleep: '#a8b4ff', fight: '#ff4a4a', haul: '#d8b070', wait: '#b8b8b8', idle: '#9a9a9a'
};
function taskKey(c) {
  if (c.state === 'fight') return 'fight';
  if (c.state === 'sleep') return 'sleep';
  if (c.state === 'eat' || c.state === 'queue' || c.plate) return 'meal';
  if (c.carry) return 'haul';
  if (c.state === 'patient' || c.patient) return 'med';
  const j = targetJob(c);
  if (j === 'turretA' || j === 'turretB') return 'turret';
  if (j === 'meal') return 'meal';
  if (j === 'sleep') return 'sleep';
  if (j === 'idle' && c.wait) return 'wait';
  return TASK_ICON[j] ? j : 'idle';
}
function drawTaskIcon(c) {
  const k = taskKey(c), col = TASK_ICON[k], x = c.x, y = c.y - 56;
  g.save(); g.translate(x, y);
  const sq = () => { g.beginPath(); g.moveTo(-6, -10); g.lineTo(6, -10); g.lineTo(10, -6); g.lineTo(10, 6); g.lineTo(6, 10); g.lineTo(-6, 10); g.lineTo(-10, 6); g.lineTo(-10, -6); g.closePath(); };
  g.fillStyle = 'rgba(20,16,12,.92)'; sq(); g.fill();
  g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 1.6; g.lineCap = 'round'; g.lineJoin = 'round';
  sq(); g.stroke();
  g.beginPath();
  if (k === 'turret') { g.arc(0, 0, 4, 0, 7); g.moveTo(-6, 0); g.lineTo(-2, 0); g.moveTo(2, 0); g.lineTo(6, 0); g.moveTo(0, -6); g.lineTo(0, -2); g.moveTo(0, 2); g.lineTo(0, 6); g.stroke(); }
  else if (k === 'door') { g.rect(-4, -5, 8, 10); g.moveTo(-4, -1); g.lineTo(4, -1); g.stroke(); }
  else if (k === 'workshop') { g.moveTo(-5, 5); g.lineTo(2, -2); g.stroke(); g.beginPath(); g.arc(3, -3, 3.2, 0, 7); g.stroke(); }
  else if (k === 'signal') { g.moveTo(0, 5); g.lineTo(0, -2); g.stroke(); g.beginPath(); g.arc(0, -2, 3.5, Math.PI * 1.15, Math.PI * 1.85); g.stroke(); g.beginPath(); g.arc(0, -2, 6, Math.PI * 1.2, Math.PI * 1.8); g.stroke(); }
  else if (k === 'kitchen') { g.moveTo(-4, -1); g.lineTo(4, -1); g.lineTo(3, 4); g.lineTo(-3, 4); g.closePath(); g.stroke(); g.beginPath(); g.moveTo(0, -3); g.quadraticCurveTo(2, -5, 0, -7); g.stroke(); }
  else if (k === 'hydro') { g.moveTo(-4, 4); g.quadraticCurveTo(-5, -4, 4, -5); g.quadraticCurveTo(5, 3, -4, 4); g.stroke(); }
  else if (k === 'med') { g.fillRect(-1.6, -5, 3.2, 10); g.fillRect(-5, -1.6, 10, 3.2); }
  else if (k === 'mine') { g.moveTo(-5, 4); g.lineTo(4, -4); g.stroke(); g.beginPath(); g.moveTo(-2, -5); g.quadraticCurveTo(4, -6, 6, 0); g.stroke(); }
  else if (k === 'meal') { g.ellipse(0, 2, 5, 2, 0, 0, 7); g.stroke(); g.beginPath(); g.arc(0, 0, 3.4, Math.PI, 0); g.stroke(); }
  else if (k === 'sleep') { g.moveTo(-3, -4); g.lineTo(3, -4); g.lineTo(-3, 3); g.lineTo(3, 3); g.stroke(); }
  else if (k === 'fight') { g.moveTo(-4, -4); g.lineTo(4, 4); g.moveTo(4, -4); g.lineTo(-4, 4); g.stroke(); }
  else if (k === 'haul') { g.rect(-4, -3, 8, 7); g.moveTo(-4, 0); g.lineTo(4, 0); g.stroke(); }
  else { g.arc(-4, 0, 1.2, 0, 7); g.arc(0, 0, 1.2, 0, 7); g.arc(4, 0, 1.2, 0, 7); g.fill(); }
  g.restore();
}
function drawDrops() {
  if (!S.drops || !S.drops.length) return;
  S.drops = S.drops.filter(d => S.t - d.t < 180);
  for (const d of S.drops) { g.save(); g.translate(d.x, d.y); if (typeof VEC !== 'undefined' && VEC.gear) VEC.gear(g, 'g_meal', false); else { g.fillStyle = '#d8cfbf'; g.fillRect(-6, -4, 12, 3); } g.restore(); }
}
// Retry delay (game minutes) for a crew member waiting on a full station: exponential backoff, capped, with jitter.
function waitDelay(tries) { const base = Math.min(30, 4 * Math.pow(2, Math.min(tries, 4))); return base + Math.random() * base * 0.4; }
// Releases everything a crew member holds on a station: bed claim, wait/retry timer, meal queue counter.
// why: 'job' (normal per-tick release, keeps the wait timer), 'fight', 'dead', 'left'.
function leaveState(c, why) {
  c.bed = null;
  if (why !== 'job') { c.wait = null; c.queued = 0; }
}

// Moving along floors and the shaft (crew and enemies inside).
// Ladders: the main shaft at LADDER_X runs from the hatch to floor 3. Extra one-tile ladders (S.ladders, placed from the Build tab)
// each join two neighbouring bunker floors: g = 1 joins floors 1 and 2, g = 2 joins floors 2 and 3. Only the shaft reaches the hatch.
function ladderSpans() {
  const out = [{ x: LADDER_X, y0: FLOORS[0], y1: FLOORS[3] }];
  if (S && S.ladders) for (const l of S.ladders) out.push({ x: l.x, y0: FLOORS[l.g], y1: FLOORS[l.g + 1] });
  return out;
}
function ladderXs(gap) {
  const xs = [LADDER_X];
  if (S && S.ladders) for (const l of S.ladders) if (l.g === gap) xs.push(l.x);
  return xs;
}
// ladder rung sounds: one tick per few px climbed (player louder, crew quieter, enemies silent, bunker scene only)
function rungSfx(m, dy) {
  return; // ladder ticks are played by footFoley() (correct volumes, no double tick)
}
function moveTo(m, floor, x, dt, spd) {
  if (m.floor === floor && !m.climbing) {
    const d = x - m.x; if (Math.abs(d) < 3) { m.x = x; return true; }
    m.facing = Math.sign(d); m.x += Math.sign(d) * Math.min(Math.abs(d), spd * dt); return false;
  }
  if (!m.climbing) {
    const dir = Math.sign(floor - m.floor) || 1, gap = dir > 0 ? m.floor : m.floor - 1;
    // pick the ladder that costs the least walking, counting a little for the walk afterwards
    const xs = ladderXs(gap); let lx = xs[0], best = Infinity;
    for (const v of xs) { const cost = Math.abs(v - m.x) + Math.abs(v - x) * 0.3; if (cost < best) { best = cost; lx = v; } }
    const d = lx - m.x;
    if (Math.abs(d) > 2) { m.facing = Math.sign(d); m.x += Math.sign(d) * Math.min(Math.abs(d), spd * dt); return false; }
    // Enemies cannot pass a closed hatch; crew can.
    if (m.enemy && !m.burrow && !S.breached && (m.floor === 0 || floor === 0)) return false;
    m.x = lx; m.climbing = true;
    m.ltf = lx === LADDER_X ? floor : (dir > 0 ? gap + 1 : gap);   // the floor this climb ends on (extra ladders span one gap)
  }
  const tf = m.ltf == null ? floor : m.ltf;
  const ty = FLOORS[tf], dy = ty - m.y;
  if (Math.abs(dy) < 2) { m.y = ty; m.floor = tf; m.climbing = false; m.ltf = null; return false; }
  const stepY = Math.min(Math.abs(dy), spd * 0.8 * dt);
  m.y += Math.sign(dy) * stepY; rungSfx(m, stepY);
  // passing a floor on the way
  for (let f = 0; f < FLOORS.length; f++) if (Math.abs(m.y - FLOORS[f]) < 1) m.floor = f;
  return false;
}

// ---- Boss-failure scars ----
const SCAR_MAX = 3, SCAR_PENALTY = 0.15, WORSE_MUL = 0.85;
const isBoss = e => e.type === 'cinder' || e.type === 'maw';
function bossReachTick() {
  for (const e of S.enemies) if (e.hp > 0 && isBoss(e) && e.inside) e.reach = Math.max(e.reach || 0, e.floor || 0);
}
function breachState() {
  if (!S.breachState) S.breachState = { scars: [] };
  if (S.scars) { S.breachState.scars = S.breachState.scars.concat(S.scars); delete S.scars; }
  if (!Array.isArray(S.breachState.scars)) S.breachState.scars = [];
  return S.breachState;
}
function scarName(k) { return k === 'door' ? 'Hatch' : ROOMS[k].name; }
function scarCost(sc) { return { scrap: 15 * sc.severity, parts: 4 * sc.severity, mat: 8 * sc.severity }; }
function roomMul(job) {
  const k = Object.keys(ROOMS).find(r => ROOMS[r].job === job);
  if (!k) return 1;
  let m = Math.pow(WORSE_MUL, (S.worse && S.worse[k]) || 0);
  for (const sc of breachState().scars) if (sc.room === k) m *= Math.max(0.3, 1 - SCAR_PENALTY * sc.severity);
  return m;
}
function bossFailCheck() {
  for (const e of S.enemies) {
    if (e.hp <= 0 || !isBoss(e) || e.scarred) continue;
    if (!e.inside && !S.breached && !e.failed) continue;
    scarBoss(e);
  }
}
function scarBoss(e) {
  if (!e || e.scarred) return; // one scar per failed boss fight, ever
  {
    const reach = e.reach || 0;
    const cand = Object.keys(ROOMS).filter(k => S.rooms[k] && ROOMS[k].floor >= 1 && ROOMS[k].floor <= reach);
    const sev = Math.max(1, Math.min(SCAR_MAX, cand.length));
    let room = 'door';
    if (cand.length) {
      const deep = Math.max(...cand.map(k => ROOMS[k].floor));
      const pool = cand.filter(k => ROOMS[k].floor === deep);
      const fresh = pool.filter(k => !breachState().scars.some(s => s.room === k));
      room = pick(fresh.length ? fresh : pool);
    }
    breachState().scars.push({ room, severity: sev, d: day() - 1 });
    e.scarred = true;
    moment('The bunker was scarred');
    lampEv('scar_' + e.id, 'The ' + e.type[0].toUpperCase() + e.type.slice(1) + ' reached ' + sev + (sev === 1 ? ' room' : ' rooms') + ' deep. ' + scarName(room) + ' is scarred. It can be rebuilt, at a cost, and it will not be as good as it was.', 'warn');
  }
}
// Full-screen 'Day N survived' card: non-blocking, fades in/out; reduced motion = plain static banner (body.rm kills transitions)
let dayCardT1 = 0, dayCardT2 = 0;
function showDayCard(n) {
  if (typeof document === 'undefined') return;
  try {
    let el = document.getElementById('dayCard');
    if (!el) {
      el = document.createElement('div'); el.id = 'dayCard'; el.setAttribute('aria-hidden', 'true');
      el.innerHTML = '<div class="dcBox"><div class="dcTitle"></div><div class="dcSub"></div></div>';
      document.body.appendChild(el);
    }
    el.querySelector('.dcTitle').textContent = 'DAY ' + n + ' SURVIVED';
    let sub = ''; try { sub = String(summaryLine() || ''); } catch (e) {}
    el.querySelector('.dcSub').textContent = sub;
    clearTimeout(dayCardT1); clearTimeout(dayCardT2);
    el.classList.remove('show'); void el.offsetWidth;
    el.classList.add('on');
    requestAnimationFrame(() => el.classList.add('show'));
    if (window.SFX && SFX.dayStinger) SFX.dayStinger();
    const hold = prefs.rm ? 2000 : 2600;
    dayCardT1 = setTimeout(() => el.classList.remove('show'), hold);
    dayCardT2 = setTimeout(() => el.classList.remove('on'), hold + (prefs.rm ? 0 : 1000));
  } catch (e) {}
}
function hourEvents(h) {
  const d = day();
  meal(h);
  if (h === 8) bossFailCheck();
  if (h === 8) { if (S.alarm) toggleAlarm(); S.alarmAuto = false; if (d > 1) { lampEv('new_day', 'Day ' + d + '. ' + summaryLine()); showDayCard(d - 1); } }
  if (h === 20) { if (d === 3) lampEv('boss_warn', 'Long-range scanner: a convoy with a painted-grin banner. That is Cinder. Raid in one hour.', 'warn'); else lampSay('raidWarn', 'warn'); }
  if (h === 8 && S.tower && !S.tower.paid && TOWER[S.tower.done] && !canPay(TOWER[S.tower.done].cost)) lampEv('exit_resources', 'Not enough materials for the next tower stage. Someone should scavenge topside.', 'warn');
  if (h === RAID_HOUR) queueRaid(d);
  if (h === 5 && d >= 2) queueProbe(d);
  if (h === 2) revoltCheck();
  if (h === 15 && d === 5 && !S.maw) { S.maw = { at: S.t + 120, done: false }; lamp('The floor is trembling. Something big is moving under the bunker. Get everyone armed and away from the lower floor.', 'warn'); addShake(0.3); }
  if (h === 12 && d >= 3 && !(S.pair && S.pair.dorrowDone)) recruitDorrow();
  else if (h === 12 && d >= 2 && Math.random() < 0.55) wandererAtDoor();
  expHour();
  autoArm();
  balanceTurrets();
  lowResCheck();
  if (h % 1 === 0) save();
}
function summaryLine() {
  const low = RES.filter(r => S.res[r.k] < (r.k === 'food' ? living().length * 2 : 5)).map(r => r.name.toLowerCase());
  return (low.length ? 'Running low on ' + low.join(', ') + '.' : 'Stores are holding.') + ' ' + living().length + ' crew alive.';
}
// Crew now fetch prepared meals from the serving station (see mealTick); only Mara eats automatically here.
function meal(h) {
  const p = S.player;
  if (!p || p.down || (h !== 7 && h !== 13 && h !== 19)) return;
  const k = kit();
  if (k.cooked >= 1) { k.cooked -= 1; p.food = Math.min(100, p.food + 42); }
  else lampEv('hungry', 'The serving station is empty. Mara went without a meal. Put a cook in the kitchen, or bring food back from topside.', 'warn');
}
// Raid tuning (balance pass for a ~1 hour run). Edit these to retune.
// Burrower: stops BURROW_STOP px right of the hatch, digs for BURROW_DIG_TIME seconds, then surfaces inside.
const _TB = (window.TUNING && TUNING.burrower) || {}, _TR = (window.TUNING && TUNING.raid) || {};
const BURROW_DIG_TIME = _TB.digTime ?? 4, BURROW_STOP = _TB.stopPx ?? 140;
const RAID_BASE = _TR.base ?? 3, RAID_PER_DAY = _TR.perDay ?? 1.25, RAID_CAP = _TR.cap ?? 20, CINDER_ESCORT = _TR.cinderEscort ?? 3, ENEMY_HP_PER_DAY = _TR.enemyHpPerDay ?? 0.08;
function raidPlan(d) {
  if (S.plan && S.plan.d === d) return S.plan.list;
  const n = Math.min(RAID_CAP, RAID_BASE + Math.round(d * RAID_PER_DAY));
  const types = d === 1 ? ['hound', 'ghoul', 'ghoul'] : d === 2 ? ['hound', 'ghoul', 'raider'] : ['hound', 'ghoul', 'raider', 'raider', 'brute'];
  const list = [];
  for (let i = 0; i < n; i++) list.push(pick(types));
  if (d >= 3 && d % 2 === 1) list.push('brute');
  if (d === 3) { for (let i = 0; i < CINDER_ESCORT; i++) list.push('raider'); list.push('cinder'); }
  if (d >= 4) for (let i = 0; i < Math.min(3, Math.floor((d - 2) / 2)); i++) list.push('burrower');
  if (d >= 6) for (let i = 0; i < Math.floor((d - 4) / 2); i++) list.push(pick(['raider', 'brute', 'hound']));
  S.plan = { d, list };
  return list;
}
function queueRaid(d) {
  S.stats.raids++;
  const list = raidPlan(d).slice(); S.plan = null;
  let at = S.t; list.forEach(type => { S.spawns.push({ type, at }); at += rnd(7, 15); });
  S.raidActive = true;
  atLoc({ x: DOOR_X, y: FLOORS[0] });
  if (d === 3) lampEv('wave_stronger', 'Cinder’s raiders are at the wire. Hold the door.', 'warn'); else lampSay('raidNow', 'warn', { n: list.length, strong: d >= 3 });
  if (speed > 1) setSpeed(1);
}
function queueProbe(d) {
  const n = 1 + Math.floor(d / 2);
  for (let i = 0; i < n; i++) S.spawns.push({ type: 'hound', at: S.t + i * 9 });
  lampSay('probe', 'warn');
}
function spawnEnemy(type) {
  const b = ENEMIES[type], scale = 1 + (day() - 1) * ENEMY_HP_PER_DAY;
  S.enemies.push({ id: uid++, type, enemy: true, x: W + 30 + rnd(0, 60), y: FLOORS[0], floor: 0, climbing: false, hp: Math.round(b.hp * scale), max: Math.round(b.hp * scale), cd: rnd(0, 0.5), facing: -1, anim: Math.random() * 10, inside: false, gear: rollGear(type) });
  if (type === 'cinder') S.cinderRaid = true; if (type === 'cinder') lampEv('boss_arrive', 'Cinder is here. Hold the door.', 'warn'); if (type === 'cinder') lamp('Cinder (over a loudspeaker): “Open up, little mole. Only the strong get to leave the ground.”', 'warn');
}
function spawnMaw() {
  const b = ENEMIES.maw, scale = 1 + (day() - 1) * 0.1;
  S.enemies.push({ id: uid++, type: 'maw', enemy: true, burrow: true, reach: { 3: true }, x: LADDER_X + rnd(-60, 60), y: FLOORS[3], floor: 3, climbing: false, hp: Math.round(b.hp * scale), max: Math.round(b.hp * scale), cd: 1, facing: -1, anim: 0, inside: true });
  if (!S.alarm && !S.alarmAuto) { S.alarmAuto = true; toggleAlarm(); }
  addShake(0.6); screenFlash(0.7, '200,170,120'); if (window.SFX && SFX.rumble) SFX.rumble(1);
  burst(LADDER_X, FLOORS[3] - 10, '#8a7a66', 24);
  fxRubble(LADDER_X, FLOORS[3] - 40, 10, FLOORS[3] - 2);
  lamp('The Maw has broken through the bottom floor!', 'warn');
  if (speed > 1) setSpeed(1);
}
function mawTick(dt) {
  const m = S.maw; if (!m || m.done) return;
  const left = m.at - S.t;
  if (left > 0) {
    const k = 1 - clamp(left / 120, 0, 1);
    if (Math.random() < dt * (0.4 + 1.2 * k)) { addShake(0.12 + 0.3 * k); fxGrit(LADDER_X, FLOORS[3] - 100, 4 + Math.round(6 * k), 160); if (window.SFX && SFX.rumble) SFX.rumble(0.2 + 0.4 * k); }
  } else { m.done = true; spawnMaw(); }
}
const REVOLT_MORALE = 38, REVOLT_CAP_STEP = 4, REVOLT_CAP_CEIL = 60;
const REVOLT_SPREAD_P = 0.5, REVOLT_SPREAD_DECAY = 0.5;   // spread chance per attempt: 0.5, 0.25, 0.125...
function revoltThreshold(c, capLoss) {
  if (c.bed !== false) return REVOLT_MORALE;   // uncapped: unchanged
  return Math.min(REVOLT_CAP_CEIL, REVOLT_MORALE + REVOLT_CAP_STEP * capLoss);
}
function revoltCheck() {
  const capLoss = living().filter(o => o.bed === false).length + capLostToDeaths();   // total cap lost: bed shortfall + deaths
  const act = (c) => {
    {
      const turs = S.turrets.filter(t => t && t.hp > 0);
      const victims = living().filter(o => o !== c && !o.down);
      const roll = Math.random();
      if (roll < 0.4 && turs.length) {
        // night sabotage: wreck a turret before leaving
        const t = pick(turs); t.hp = Math.max(1, Math.round(t.hp * 0.25));
        c.alive = false; c.left = true;
        addShake(0.3);
        lamp(c.name + ' sabotaged a turret in the night and slipped out. It is nearly wrecked, so repair it before the raid.', 'warn');
      } else if (roll < 0.7 && victims.length) {
        // night attack: ambush a crew member
        const v = pick(victims); const dmg = Math.round(rnd(35, 60));
        c.alive = false; c.left = true;
        if (v.hp - dmg <= 0 && !v.named) { v.hp = 0; kill(v, 'killed'); lamp(c.name + ' attacked ' + v.name + ' in the dark and fled. ' + v.name + ' did not survive.', 'warn'); }
        else { v.hp = Math.max(1, v.hp - dmg); v.mor = Math.max(0, (v.mor ?? 70) - 10); lamp(c.name + ' attacked ' + v.name + ' in the dark and fled. ' + v.name + ' is badly hurt.', 'warn'); }
      } else {
        const k = pick(['food', 'scrap', 'parts', 'elec']); const took = Math.ceil(S.res[k] * (S.rooms.storage ? ROOM_FX.storageTheft : 0.3));
        S.res[k] -= took; c.alive = false; c.left = true; leaveState(c, 'left');
        lampEv('deserter', c.name + ' slipped out in the night with ' + took + ' ' + RES.find(r => r.k === k).name.toLowerCase() + '. Morale was too low to hold them.', 'warn');
      }
    }
  };
  const d = day();
  if (!S.revoltNight || S.revoltNight.night !== d) S.revoltNight = { night: d, started: false, spreads: 0 };
  const R = S.revoltNight;
  let startedNow = false;
  if (!R.started) {
    for (const c of living()) {
      if (c.named || c.loyalty >= 1) continue;
      if (morale(c) < revoltThreshold(c, capLoss) && Math.random() > c.loyalty) {
        R.started = true; startedNow = true;
        act(c);
        break; // only one independent revolt per night
      }
    }
  }
  if (startedNow) {
    let p = REVOLT_SPREAD_P;
    while (Math.random() < p) {
      const cands = living().filter(o => !o.named && o.loyalty < 1 && !o.left);
      if (!cands.length) break;
      act(pick(cands));
      R.spreads++;
      p *= REVOLT_SPREAD_DECAY;
    }
  }
  revoltHints();
}
// Lamp's spoken revolt-risk hints: one per crew (same job station) per night, vague first, then naming the shift and survivors.
const HINT_MORALE = 50;
function revoltHints() {
  const n = day();
  S.revoltHints = S.revoltHints || { night: n, hinted: {}, lvl: {} };
  const H = S.revoltHints;
  if (!H.hinted) H.hinted = {};
  if (!H.crew) H.crew = {};
  if (H.night !== n) { H.night = n; H.hinted = {}; H.crew = {}; }   // new night: every crew member is hint-eligible again (escalation level persists)
  const groups = {};
  for (const c of living()) {
    if (c.named || c.loyalty >= 1 || morale(c) >= HINT_MORALE) continue;
    if (H.hinted[c.id]) continue;   // already hinted this night: skip, no text or audio
    const g = c.job || 'none';
    (groups[g] = groups[g] || []).push(c);
  }
  const lowMor = g => Math.min(...groups[g].map(c => morale(c)));
  const open = Object.keys(groups).filter(g => !H.crew[g]).sort((a, z) => lowMor(a) - lowMor(z));
  for (const g of open.slice(0, 1)) {   // one crew per night: the one with the lowest-morale member
    H.crew[g] = true;   // at most one hint per crew per night
    for (const c of groups[g]) H.hinted[c.id] = true;   // each member gets at most one hint per night
    const lvl = Math.min(H.lvl[g] || 0, 2); H.lvl[g] = lvl + 1;   // 0 vague, 1 crew, 2+ crew and names; never goes back down
    const risk = groups[g], names = risk.map(c => c.name);
    const shift = (JOBS[g] && JOBS[g].label ? JOBS[g].label : 'unassigned').toLowerCase();
    const list = names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0];
    if (lvl === 0) lamp('Some of the crew are restless. Nothing I would call dangerous. Yet.', 'warn');
    else if (lvl === 1) lamp('The ' + shift + ' shift is fraying at the edges. I would keep an eye on it.', 'warn');
    else lamp('The ' + shift + ' shift: ' + list + (names.length > 1 ? ' are' : ' is') + ' close to walking out. Morale is the only thing holding ' + (names.length > 1 ? 'them' : 'them') + '.', 'warn');
  }
}
function wandererAtDoor() {
  const w = makeCrew(randomSurvivor()); w.x = 300; w.floor = 0; w.y = FLOORS[0];
  if (living().length >= bedCount() || living().length >= crewCap()) {
    // bed capacity full: not admitted, left waiting outside the hatch where raids can kill them
    S.waiting = S.waiting || [];
    w.x = DOOR_X + 50 + S.waiting.length * 22;
    S.waiting.push(w);
    lamp(w.name + ' (' + w.role.toLowerCase() + ') is at the hatch asking to stay, but every bed is taken. They are waiting outside.', 'warn');
    return;
  }
  S.crew.push(w);
  lampEv('newcomer', w.name + ' (' + w.role.toLowerCase() + ') knocked at the hatch and asked to stay. I let them in. Keep morale up: newcomers are not always loyal.', 'good');
  toast(w.name + ' arrived at the bunker', 'good');
}

// Wanderers left outside the hatch (no bed free). Enemies near them hurt them; they die at 0 HP.
const WAIT_RAID_DEATH = 0.008;   // per-second chance a wanderer left outside dies while a raid is active
function waitingTick(dt) {
  if (!S.waiting || !S.waiting.length) return;
  // admit the first waiting wanderer when a bed is free (not mid-raid)
  if (!S.raidActive && living().length < bedCount() && living().length < crewCap()) {
    const a = S.waiting.shift();
    a.x = 300; a.floor = 0; a.y = FLOORS[0];
    S.crew.push(a);
    lampEv('newcomer', a.name + ' (' + a.role.toLowerCase() + ') was waiting outside the hatch. A bed has opened up, so I let them in.', 'good');
    toast(a.name + ' arrived at the bunker', 'good');
    S.waiting.forEach((q, i) => { q.x = DOOR_X + 50 + i * 22; });
    if (!S.waiting.length) return;
  }
  for (const w of S.waiting) {
    w.anim += dt * 2;
    if (S.raidActive && Math.random() < WAIT_RAID_DEATH * dt) w.hp = 0;   // raid exposure
    for (const e of S.enemies) if (e.hp > 0 && !e.inside && !e.hidden && Math.abs(e.x - w.x) < 40) w.hp -= 15 * dt;
    if (w.hp <= 0) {
      w.dead = true; burst(w.x, w.y - 14, '#a33', 14);
      lamp(w.name + ' was caught outside the hatch and did not survive.', 'warn');
    }
  }
  S.waiting = S.waiting.filter(w => !w.dead);
}
// Keeps bed assignments in line with the actual bed count. Never removes crew: the excess floor-sleeps.
let bedSyncT = null;
function reconcileBeds() {
  if (bedSyncT === S.t) return;
  bedSyncT = S.t;
  const n = bedCount(), all = living();
  const holders = all.filter(o => o.bed === true);
  if (typeof S.lastBedN === 'number' && n < S.lastBedN && window.SFX && SFX.bedCrack) SFX.bedCrack();
  S.lastBedN = n;
  if (holders.length > n) {
    if (window.SFX && SFX.floorSigh) setTimeout(() => SFX.floorSigh(), 350);
    for (let i = n; i < holders.length; i++) holders[i].bed = false;   // lost bed: floor-sleep, stay in the bunker
    const day = Math.floor(S.t / 1440);
    if (S.floorNoteDay !== day) { S.floorNoteDay = day; lampEv('floorsleep', 'Not enough beds. Some of the crew are sleeping on the floor and resting worse. Upgrade the bunks or thin the crew.', 'warn'); }
  } else if (holders.length < n) {
    let free = n - holders.length;
    for (const o of all) { if (free <= 0) break; if (o.bed === false) { o.bed = true; free--; } }   // restored/free bed goes to a floor-sleeper
  }
}
function crewTick(c, dt, mins) {
  reconcileBeds();
  const h = mins / 60;
  c.anim += dt * 6;
  if (c.cd > 0) c.cd -= dt;
  if (c.grief > 0) c.grief -= h;
  moraleTick(c, h);
  // needs
  c.food = Math.max(0, c.food - foodDrain() * h);
  if (c.food <= 0) { c.hp -= 3 * h; if (c.hp <= 0) return kill(c, 'starved'); }
  if (c.state === 'sleep') { trackFloorNights(c); c.awake = Math.max(0, c.awake - h * (16 / (S.rooms.bunks > 1 ? 5 : 7)) * (c.bed === false ? FLOOR_REST_MULT : 1)); }
  else c.awake += h;
  // illness: infected wounds, slow HP drain (never lethal on its own), forces a med bay visit
  if (!c.sick && c.hp < c.maxHp * 0.5 && Math.random() < 0.08 * h) sicken(c, 'an infected wound');
  if (c.sick && c.hp > c.maxHp * 0.2) c.hp = Math.max(c.maxHp * 0.2, c.hp - 1.5 * h);
  if ((c.hp < c.maxHp * 0.35 || c.sick) && !c.patient) { c.patient = true; }
  if (c.patient && !c.sick && c.hp >= c.maxHp * 0.85) c.patient = false;

  // fight anything that reaches them
  const foe = c.pit ? null : S.enemies.find(e => !e.hidden && e.floor === c.floor && !e.climbing && !c.climbing && Math.abs(e.x - c.x) < 26 && e.hp > 0);
  if (foe) { leaveState(c, 'fight'); c.state = 'fight'; c.facing = Math.sign(foe.x - c.x) || 1; if (c.cd <= 0) { c.cd = 0.7; hitEnemy(foe, meleeDmg(c) * eff(c), c, meleeType(c)); } return; }
  // guards hunt enemies that got inside
  let job = targetJob(c);
  if (c.plate && job !== 'meal') dropPlate(c);
  // WaitingForStation: denied a capped station -> wait, retry on a jittered, backing-off timer (game minutes)
  { const want = baseJob(c);
    if (c.wait && c.wait.job !== want) c.wait = null;
    if (job === 'idle' && want !== 'idle' && CAPPED_JOBS.includes(want) && !c.patient && !S.alarm) {
      if (!c.wait) c.wait = { job: want, tries: 0, until: S.t + waitDelay(0) };
      else if (S.t >= c.wait.until) { c.wait.tries++; c.wait.until = S.t + waitDelay(c.wait.tries); }
    } else if (c.wait) {
      if (job !== 'idle' && S.t < c.wait.until) job = 'idle'; // slot is free, but hold until the retry time
      else c.wait = null;
    }
  }
  if (job === 'sleep') claimBed(c); else leaveState(c, 'job');
  if (job !== 'mine') c.dig = null;
  if (c.pit && job !== 'mine' && !pitRoomFor(job)) { c.state = 'walk'; if (!pitLeave(c, dt, true)) return; }
  if (job === 'mine') { mineTick(c, dt, h); return; }
  if (job === 'door' && (S.breached || S.enemies.some(e => e.inside && e.hp > 0))) {
    const inside = S.enemies.filter(e => e.inside && e.hp > 0).sort((a, b) => (Math.abs(a.floor - c.floor) * 500 + Math.abs(a.x - c.x)) - (Math.abs(b.floor - c.floor) * 500 + Math.abs(b.x - c.x)))[0];
    if (inside) {
      // guards carry pistols: shoot when on the same floor and close enough, otherwise close in
      if (inside.floor === c.floor && !c.climbing && !inside.climbing && Math.abs(inside.x - c.x) < wpn(c).range) {
        c.state = 'fight'; c.facing = Math.sign(inside.x - c.x) || 1;
        if (c.cd <= 0) crewShoot(c, inside);
        return;
      }
      c.state = 'walk'; moveTo(c, inside.floor, inside.x, dt, 80); return;
    }
  }
  // food in hand goes back if the job changes; cooks haul raw food from the pantry and plates to the serving station
  if (c.carry && job !== 'kitchen') dropCarry(c);
  if (job === 'kitchen' && kitchenHaul(c, dt)) return;
  if (job === 'meal') { mealTick(c, dt, mins); return; }
  const spot = job === 'sleep' ? sleepSpot(c) : jobSpot(c, job);
  const arrived = spot.pit ? pitGoto(c, spot, dt, 70) : moveTo(c, spot.floor, spot.x, dt, 70);
  if (!arrived) { c.state = 'walk'; return; }
  c.state = job === 'sleep' ? 'sleep' : c.patient ? 'patient' : (c.wait && job === 'idle') ? 'waiting' : 'work';
  if (c.state !== 'work') return;
  const e = eff(c) * (S.powered && POWERED_JOBS.includes(job) ? ROOM_FX.powerBoost : 1) * roomMul(job);
  const gain = x => { c.xp += x * h; const need = 60 * c.lvl; if (c.xp >= need) { c.xp -= need; levelUp(c); } };
  switch (job) {
    case 'hydro': S.res.food += 1.3 * c.stats.cook * e * h * (S.rooms.hydro > 1 ? 1.5 : 1) * (hasB('rain') ? 1.25 : 1) * wearF('planter') * hydroMul(); wearBy('planter', 0.4 * h); gain(3); break;   // hydroponics: raw food into the pantry
    case 'kitchen': {
      const k = kit(); if (k.raw == null) k.raw = 0;
      // cook from the raw food the kitchen already has (hauled in by kitchenHaul); finished meals go into the cook's hands
      const held = () => (c.carry && c.carry.id === 'meal' ? c.carry.n : 0);
      if (k.cooked + held() < k.cap && k.raw >= 1) {
        k.prog += 4 * c.stats.cook * e * h * wearF('stove') * (tech('cook1') ? 1.15 : 1); wearBy('stove', 0.5 * h);
        while (k.prog >= 1 && k.raw >= 1 && k.cooked + held() < k.cap) {
          k.prog -= 1; k.raw -= 1;
          if (!c.carry) c.carry = { id: 'meal', n: 0 };
          c.carry.n += 1;
        }
        if (k.prog > 1) k.prog = 1;
      }
      gain(4); break;
    }
    case 'workshop': workshopTick(c, e, h); gain(4); break;
    case 'research': researchWork(3 * c.stats.tech * e * h); gain(4); break;
    case 'signal': if (S.tower.paid) { S.tower.work += 2 * c.stats.tech * e * h * (hasB('lab') ? 1.15 : 1); gain(5); } break;
    case 'med': gain(2); break;
    case 'door': guardShoot(c, e); break;
    case 'idle': c.awake = Math.max(0, c.awake - h * 0.3); break;
  }
}
// ---- food: raw food -> cooked at the kitchen -> serving station -> eaten in the common room ----
const kit = () => S.kit || (S.kit = { cooked: 8, cap: 16, prog: 0, raw: 0 });
const SERVE_X = 396, PANTRY_X = 850;   // serving station (floor 2) and the pantry shelves (floor 3, common room)
// A cook's trips: pantry -> kitchen with a crate of raw food, then stove -> serving station with plates.
// Returns true while the cook is walking or handing something over (the normal kitchen work waits).
function kitchenHaul(c, dt) {
  const k = kit(); if (k.raw == null) k.raw = 0;
  const cr = c.carry;
  if (cr && cr.id === 'meal' && (cr.n >= 3 || k.raw < 1 || k.cooked + cr.n >= k.cap)) {
    if (!moveTo(c, 2, SERVE_X, dt, 70)) { c.state = 'walk'; return true; }
    k.cooked = Math.min(k.cap, k.cooked + cr.n); c.carry = null; return true;
  }
  if (cr && cr.id === 'crate') {
    const sp = jobSpot(c, 'kitchen');
    if (!moveTo(c, sp.floor, sp.x, dt, 70)) { c.state = 'walk'; return true; }
    k.raw += cr.n; c.carry = null; return true;
  }
  if (!cr && k.raw < 1 && k.cooked < k.cap && S.res.food >= 1) {
    if (!moveTo(c, 3, PANTRY_X, dt, 70)) { c.state = 'walk'; return true; }
    const n = Math.min(8, Math.floor(S.res.food)); S.res.food -= n; c.carry = { id: 'crate', n }; return true;
  }
  return false;
}
const TABLE_X = 990;
function mealId(c) {
  const sc = ensureSched(c); let h = Math.floor(S.t / 60), n = 0;
  while (n < 24 && sc[(h - 1 + 24) % 24] === 'M') { h--; n++; }
  return h;
}
function mealTick(c, dt, mins) {
  const id = mealId(c), k = kit(), idx = Math.max(0, S.crew.indexOf(c));
  if (c.ate === id && !c.plate && !hungryNow(c)) { const sp = jobSpot(c, 'meal'); c.state = moveTo(c, sp.floor, sp.x, dt, 70) ? 'work' : 'walk'; c.queued = 0; return; }
  if (!c.plate) {
    if (!moveTo(c, 2, 396 + (idx * 7) % 36 - 18, dt, 70)) { c.state = 'walk'; return; }
    if (k.cooked >= 1) { k.cooked -= 1; c.plate = true; c.queued = 0; }
    else {
      c.state = 'queue'; c.queued = (c.queued || 0) + mins;
      if (c.queued >= 45) {
        if (S.res.food >= 1) { S.res.food -= 1; c.plate = true; c.queued = 0; c.rawPlate = true; }
        else if (S.hungryId !== id) { S.hungryId = id; lampEv('hungry', 'Nothing at the serving station and no raw food left. Put a cook in the kitchen, or bring food back from topside.', 'warn'); }
      }
      if (!c.plate) return;
    }
  }
  if (!moveTo(c, 3, TABLE_X - 50 + (idx * 11) % 100, dt, 70)) { c.state = 'walk'; return; }
  c.state = 'eat'; c.eatT = (c.eatT || 0) + mins;
  if (c.eatT >= 20) { c.eatT = 0; c.plate = false; c.ate = id; c.food = Math.min(100, c.food + 42); if (Math.random() < (c.rawPlate ? 0.3 : 0.02)) sicken(c, 'bad food'); c.rawPlate = false; c.mor = Math.min(100, (c.mor ?? 70) + 8); }
}
// ---- beds: limited; people without one sleep on the floor (slower rest, morale loss) ----
const FLOOR_REST_MULT = 0.6, FLOOR_MORALE = -1;
const FLOOR_PENALTY_MAX_NIGHTS = 5;   // floor-sleep morale penalty grows each consecutive night, then plateaus here
function floorPenalty(c) { return FLOOR_MORALE * Math.min(Math.max(c.floorNights || 0, 1), FLOOR_PENALTY_MAX_NIGHTS); }
// call while sleeping: counts one floor night per night, resets once they sleep in a bed
function trackFloorNights(c) {
  if (c.bed === true) { c.floorNights = 0; c.floorNightKey = null; return; }
  if (c.bed !== false) return;
  const key = Math.floor((S.t + 60) / 1440);   // a night runs from 23:00 to the next 22:59
  if (c.floorNightKey !== key) { c.floorNightKey = key; c.floorNights = (c.floorNights || 0) + 1; }
}
const BED_REPAIR_COST = 8;   // scrap to repair one damaged bunk (two beds) at the workshop
function bedCount() { return itemList().filter(it => it.type === 'bunk' && !it.damaged).length * 2; }
// test hook only (not called by the game): crackBunk(n) damages the nth bunk, crackBunk(n, false) restores it
window.crackBunk = function (n, state) {
  const bunks = itemList().filter(it => it.type === 'bunk');
  const it = bunks[n | 0];
  if (!it) return 'no bunk at index ' + (n | 0) + ' (' + bunks.length + ' bunks)';
  it.damaged = state !== false;
  if (it.damaged && typeof bedSfx === 'function') { try { bedSfx('bedCrack'); } catch (e) {} }
  return 'bunk ' + (n | 0) + (it.damaged ? ' cracked' : ' restored');
};   // damaged bunks do not count
// crew capacity is exactly the number of beds; every 'can we take more survivors' check uses this
const CREW_CAP_FLOOR = 4;   // minimum crew cap; deaths can never push the cap below this
const CREW_CAP_MAX = 100;   // hard ceiling on survivors, however many beds exist
const CAP_LOSS_PER_DEATH = 1;   // cap lost per crew death; stacks across the run
function capLostToDeaths() { return ((S.stats && S.stats.lost) || []).length * CAP_LOSS_PER_DEATH; }
function crewCap() { return Math.min(CREW_CAP_MAX, Math.max(CREW_CAP_FLOOR, bedCount() - capLostToDeaths())); }   // each bunk is two beds, bought one at a time
function claimBed(c) {
  if (c.bed === true || c.bed === false) return;
  const used = living().filter(o => o !== c && o.bed === true).length;
  c.bed = used < bedCount();
  if (!c.bed) {
    const day = Math.floor(S.t / 1440);
    if (S.floorNoteDay !== day) { S.floorNoteDay = day; lampEv('floorsleep', 'Not enough beds. Some of the crew are sleeping on the floor and resting worse. Upgrade the bunks or thin the crew.', 'warn'); }
  }
}
function sleepSpot(c) { const i = Math.max(0, living().indexOf(c)); if (c.bed === false) return { floor: 3, x: ROOMS.bunks.x0 + 20 + (i * 23) % (ROOMS.bunks.x1 - ROOMS.bunks.x0 - 40) }; return { floor: 3, x: ROOMS.bunks.x0 + 40 + (i * 41) % (ROOMS.bunks.x1 - ROOMS.bunks.x0 - 80) }; }
// ---- digging: one big grid of square cells under the bunker (Oxygen Not Included style) ----
const DIG = {
  cell: 24, cols: 44, rows: 16, x0: 190, y0: 660,   // grid sits under floor 3; row 0 touches the floor-3 slab
  rate: 40,                                          // hardness removed per game hour by a miner with Build 1.0
  mats: [null,
    { name: 'Dirt', hard: 30, color: '#6e4d30', fx: { mat: 0.1 } },
    { name: 'Clay', hard: 70, color: '#a5714a', fx: { mat: 0.3 } },
    { name: 'Rock', hard: 150, color: '#74747a', fx: { scrap: 0.6, mat: 0.4 } },
    { name: 'Hard stone', hard: 320, color: '#3f4553', fx: { scrap: 1.2, parts: 0.25 } },
  ],
};
const WH = DIG.y0 + DIG.rows * DIG.cell + 20;     // full world height (bunker + pit)
const ROOM_CELLS = { workshop: { w: 6, h: 4 }, generator: { w: 6, h: 4 }, armory: { w: 6, h: 4 }, storage: { w: 6, h: 4 } };
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
let digTool = false, digDrag = null;
const dIdx = (c, r) => r * DIG.cols + c;
const dIn = (c, r) => c >= 0 && c < DIG.cols && r >= 0 && r < DIG.rows;
const dCenterX = c => DIG.x0 + c * DIG.cell + DIG.cell / 2;
const dFeetY = r => DIG.y0 + (r + 1) * DIG.cell - 2;
const dCellAt = w => { const c = Math.floor((w.x - DIG.x0) / DIG.cell), r = Math.floor((w.y - DIG.y0) / DIG.cell); return dIn(c, r) ? { c, r } : null; };
const dCellClamp = w => ({ c: clamp(Math.floor((w.x - DIG.x0) / DIG.cell), 0, DIG.cols - 1), r: clamp(Math.floor((w.y - DIG.y0) / DIG.cell), 0, DIG.rows - 1) });
const curCell = m => ({ c: clamp(Math.floor((m.x - DIG.x0) / DIG.cell), 0, DIG.cols - 1), r: clamp(Math.floor((m.y - 4 - DIG.y0) / DIG.cell), 0, DIG.rows - 1) });
function genDig() {
  const n = DIG.cols * DIG.rows, m = new Array(n), hp = new Array(n), mark = new Array(n).fill(0), ph = Math.random() * 6;
  for (let r = 0; r < DIG.rows; r++) for (let c = 0; c < DIG.cols; c++) {
    const v = r / DIG.rows + (Math.random() - 0.5) * 0.3 + 0.12 * Math.sin(c * 0.5 + ph + r * 0.4);
    const t = r < 2 ? 1 : v < 0.2 ? 1 : v < 0.5 ? 2 : v < 0.78 ? 3 : 4;
    m[dIdx(c, r)] = t; hp[dIdx(c, r)] = DIG.mats[t].hard;
  }
  const d = { m, hp, mark, rooms: {}, lad: {}, ver: 0 };
  // old saves that already own annex rooms get a cleared chamber for each
  let off = 1;
  for (const k of Object.keys(ROOM_CELLS)) if (S && S.rooms && S.rooms[k]) {
    const sz = ROOM_CELLS[k];
    for (let r = 0; r < sz.h; r++) for (let c = 0; c < sz.w; c++) m[dIdx(off + c, r)] = 0;
    d.rooms[k] = { c: off, r: 0, w: sz.w, h: sz.h }; off += sz.w + 1;
  }
  // every new pit starts with one cleared 6x4 chamber under the bunker, ready for the first room
  if (off === 1) for (let r = 0; r < 4; r++) for (let c = 2; c < 8; c++) m[dIdx(c, r)] = 0;
  return d;
}
const dg = () => S.dig || (S.dig = genDig());
// brief highlight pulses on tiles (marked, dug, built); cell coords, drawn in drawDig
const tilePulses = [];
let digMarkN = 0;
// compatibility shim for build/dig call sites: forwards to pulseTile, skipping a rect that was just pulsed
function tilePulse(c, r, w, h, kind) {
  const now = performance.now();
  for (const p of tilePulses) if (p.c === c && p.r === r && p.w === w && p.h === h && now - p.t < 80) return;
  pulseTile(c, r, w, h, kind === 'dig' ? 'rgba(255,230,170,' : 'rgba(120,255,160,');
}
function pulseTile(c, r, w, h, col) {
  tilePulses.push({ c, r, w, h, col, t: performance.now() });
  if (tilePulses.length > 80) tilePulses.shift();
}
function drawTilePulses(cs) {
  if (!tilePulses.length) return;
  const now = performance.now(), rm = !!(typeof prefs !== 'undefined' && prefs && prefs.rm), dur = rm ? 280 : 520;
  for (let i = tilePulses.length - 1; i >= 0; i--) {
    const p = tilePulses[i], a = (now - p.t) / dur;
    if (a >= 1) { tilePulses.splice(i, 1); continue; }
    // reduced motion: plain fade in place, no growing outline
    const e = rm ? 0 : a * 5, al = (rm ? 0.35 : 0.65) * (1 - a);
    const x = DIG.x0 + p.c * cs - e, y = DIG.y0 + p.r * cs - e, w = p.w * cs + 2 * e, h = p.h * cs + 2 * e;
    g.fillStyle = p.col + (al * 0.5) + ')'; g.fillRect(x, y, w, h);
    g.strokeStyle = p.col + al + ')'; g.lineWidth = 2; g.strokeRect(x + 1, y + 1, w - 2, h - 2);
  }
}
function digMark(a, b, erase) {
  digMarkN = 0;
  const d = dg();
  for (let r = Math.min(a.r, b.r); r <= Math.max(a.r, b.r); r++) for (let c = Math.min(a.c, b.c); c <= Math.max(a.c, b.c); c++) {
    const i = dIdx(c, r); if (!d.m[i]) continue;
    if (!!d.mark[i] !== !erase) { digMarkN++; pulseTile(c, r, 1, 1, erase ? 'rgba(255,90,80,' : 'rgba(255,210,60,'); }
    d.mark[i] = erase ? 0 : 1;
  }
}
function digStart(w, shift) { const a = dCellClamp(w), d = dg(); digDrag = { a, b: a, erase: !!shift || !!d.mark[dIdx(a.c, a.r)] }; }
window.addEventListener('pointermove', e => { if (digDrag) digDrag.b = dCellClamp(bcamToWorld(toCanvas(e))); });
window.addEventListener('pointerup', () => { if (!digDrag) return; const er = digDrag.erase; digMark(digDrag.a, digDrag.b, er); if (digMarkN) uiSfx(er ? 'DigUnmark' : 'DigMark'); digDrag = null; });
window.addEventListener('pointercancel', () => { digDrag = null; });
function toggleDig() {
  digTool = !digTool; digDrag = null; if (digTool) placing = null;
  const b = document.getElementById('tDig'); if (b) { b.classList.toggle('on', digTool); b.setAttribute('aria-pressed', digTool ? 'true' : 'false'); }
  if (digTool && S) { bcam.follow = null; bcam.cy = 640; } else bcam.cy = H / 2;
  srSay('Dig tool ' + (digTool ? 'on. Drag a box over the pit to mark cells.' : 'off.'));
}
{ const b = document.getElementById('tDig'); if (b) b.onclick = e => { toggleDig(); if (e.detail) e.currentTarget.blur(); }; }
// breadth-first search over cleared cells from the given source cells
// strict = how crew (not miners) move: sideways freely, but a change of row needs a ladder or the inside of a room.
function digBfs(d, src, strict) {
  const n = DIG.cols * DIG.rows, dist = new Array(n).fill(-1), par = new Array(n).fill(-1), q = [];
  const lad = d.lad || {}, rmap = strict ? roomMap(d) : null;
  for (const s of src) { dist[s] = 0; q.push(s); }
  for (let k = 0; k < q.length; k++) {
    const i = q[k], c = i % DIG.cols, r = (i / DIG.cols) | 0;
    for (const [dc, dr] of DIRS) {
      const cc = c + dc, rr = r + dr; if (!dIn(cc, rr)) continue;
      const j = dIdx(cc, rr);
      if (strict && dr !== 0 && !(lad[i] || lad[j] || (rmap[i] && rmap[i] === rmap[j]))) continue;
      if (d.m[j] === 0 && dist[j] < 0) { dist[j] = dist[i] + 1; par[j] = i; q.push(j); }
    }
  }
  return { dist, par };
}
// choose the nearest marked cell this miner can reach; returns { i, path } (path = cells to walk through, in order)
function digPick(c, d) {
  const N = DIG.cols * DIG.rows, cur = c.pit ? curCell(c) : null, i0 = cur ? dIdx(cur.c, cur.r) : -2;
  let src = [];
  if (cur) src = [i0]; else for (let k = 0; k < DIG.cols; k++) if (d.m[dIdx(k, 0)] === 0) src.push(dIdx(k, 0));
  const { dist, par } = digBfs(d, src);
  let best = null;
  for (let i = 0; i < N; i++) {
    if (!d.m[i] || !d.mark[i]) continue;
    if (S.crew.some(o => o !== c && o.alive && o.dig === i)) continue;
    const col = i % DIG.cols, row = (i / DIG.cols) | 0, opts = [];
    if (row === 0 && !cur) opts.push(-1);
    for (const [dc, dr] of DIRS) { const cc = col + dc, rr = row + dr; if (!dIn(cc, rr)) continue; const j = dIdx(cc, rr); if (d.m[j] === 0 && dist[j] >= 0) opts.push(j); }
    for (const s of opts) {
      const cost = (s < 0 ? 0 : dist[s] + 1) * DIG.cell + Math.abs(dCenterX(s < 0 ? col : s % DIG.cols) - c.x) * 0.5 + row * 3;
      if (!best || cost < best.cost) best = { i, s, cost };
    }
  }
  if (!best) return null;
  const path = [];
  if (best.s >= 0) for (let k = best.s; k >= 0 && k !== i0; k = par[k]) path.push(k);
  path.reverse();
  return { i: best.i, path };
}
function stepTo(c, tx, ty, dt, spd) {
  const dx = tx - c.x, dy = ty - c.y, dist = Math.hypot(dx, dy);
  if (dist < 1.5) { c.x = tx; c.y = ty; return true; }
  const s = Math.min(dist, spd * dt); c.x += dx / dist * s; c.y += dy / dist * s;
  if (Math.abs(dx) > 0.5) c.facing = Math.sign(dx);
  return false;
}
// climb back up through cleared cells to floor 3; true once out
// strict: walk out the way ordinary crew do (ladders and rooms only); falls back to the miner's route if that is cut off
function pitLeave(c, dt, strict) {
  const d = dg(), cur = curCell(c), i0 = dIdx(cur.c, cur.r), { dist, par } = digBfs(d, [i0], !!strict);
  const exits = strict ? pitEntries(d, true) : null;
  let j = -1;
  for (let k = 0; k < DIG.cols; k++) { const i = dIdx(k, 0); if (dist[i] >= 0 && (!strict || exits.includes(i)) && (j < 0 || dist[i] < dist[j])) j = i; }
  if (j < 0 && strict) return pitLeave(c, dt, false);
  if (j < 0) { c.pit = false; c.y = FLOORS[3]; c.pp = null; c.climbing = false; return true; }
  const chain = [];
  for (let k = j; k >= 0 && k !== i0; k = par[k]) chain.push(k);
  chain.reverse();
  const wp = chain.map(k => ({ x: dCenterX(k % DIG.cols), y: dFeetY((k / DIG.cols) | 0) }));
  wp.push({ x: dCenterX(j % DIG.cols), y: FLOORS[3] });
  c.climbing = Math.abs(wp[0].x - c.x) < 1.5;
  if (!stepTo(c, wp[0].x, wp[0].y, dt, 60)) return false;
  if (wp.length === 1) { c.pit = false; c.y = FLOORS[3]; c.floor = 3; c.climbing = false; c.pp = null; return true; }
  return false;
}
function mineTick(c, dt, h) {
  const d = dg();
  if (c.dig != null && (!d.m[c.dig] || !d.mark[c.dig])) c.dig = null;
  if (c.dig == null) { const t = digPick(c, d); if (t) { c.dig = t.i; c.dpath = t.path; c.dstep = 0; } }
  if (c.dig == null) { // nothing reachable is marked: climb out and rest
    if (c.pit) { c.state = 'walk'; pitLeave(c, dt); return; }
    const sp = jobSpot(c, 'mine'), ok = moveTo(c, sp.floor, sp.x, dt, 70);
    c.state = ok ? 'work' : 'walk';
    if (ok) c.awake = Math.max(0, c.awake - h * 0.3);
    return;
  }
  const col = c.dig % DIG.cols, row = (c.dig / DIG.cols) | 0, path = c.dpath || [];
  if (!c.pit) {
    if (!moveTo(c, 3, path.length ? dCenterX(path[0] % DIG.cols) : dCenterX(col), dt, 70)) { c.state = 'walk'; return; }
    if (path.length) { c.pit = true; c.y = FLOORS[3]; c.dstep = 0; }
  }
  while (c.dstep < path.length) {
    const k = path[c.dstep];
    if (!stepTo(c, dCenterX(k % DIG.cols), dFeetY((k / DIG.cols) | 0), dt, 60)) { c.state = 'walk'; return; }
    c.dstep++;
  }
  const t = DIG.mats[d.m[c.dig]];
  c.state = 'work'; c.facing = Math.sign(dCenterX(col) - c.x) || 1;
  d.hp[c.dig] -= DIG.rate * c.stats.build * eff(c) * h;
  c.xp += 3 * h; if (c.xp >= 60 * c.lvl) { c.xp -= 60 * c.lvl; levelUp(c); }
  if (d.hp[c.dig] <= 0) {
    d.m[c.dig] = 0; d.mark[c.dig] = 0;
    for (const k in t.fx) S.res[k] += t.fx[k];
    burst(dCenterX(col), dFeetY(row) - 10, t.color, 6);
    pulseTile(col, row, 1, 1, 'rgba(255,230,170,');
    if (scene === 'bunker') uiSfx('Dig');
    c.dig = null;
  }
}
function roomFree(d, c0, r0, w, h) {
  for (let r = r0; r < r0 + h; r++) for (let c = c0; c < c0 + w; c++) if (d.m[dIdx(c, r)] !== 0) return false;
  for (const rm of Object.values(d.rooms)) if (rm.c < c0 + w && c0 < rm.c + rm.w && rm.r < r0 + h && r0 < rm.r + rm.h) return false;
  return true;
}
function findRoomSpot(k) {
  const sz = ROOM_CELLS[k]; if (!sz) return null;
  const d = dg();
  for (let r = 0; r <= DIG.rows - sz.h; r++) for (let c = 0; c <= DIG.cols - sz.w; c++) if (roomFree(d, c, r, sz.w, sz.h)) return { c, r };
  return null;
}
function claimRoom(k, s) { const sz = ROOM_CELLS[k], d = dg(); d.rooms[k] = { c: s.c, r: s.r, w: sz.w, h: sz.h }; d.ver = (d.ver | 0) + 1; }

// ---- building on the tile grid: rooms and one-tile ladder segments ----
// The pit grid (24 px tiles) is where the bunker grows. Rooms go on cleared tiles. Crew walk sideways through cleared tiles freely but
// need a ladder segment (or the inside of a room) to change rows; miners climb on their own. Extra ladders can also join two bunker floors.
const LADDER_COST = { pit: { scrap: 3 }, bunker: { scrap: 12, mat: 3 } };
let placing = null;                       // { kind: 'room', k } or { kind: 'ladder' } while the Build tool is held
const roomMapCache = new WeakMap();
function roomMap(d) {                     // tile index -> room key (or null)
  const sig = JSON.stringify(d.rooms), hit = roomMapCache.get(d);
  if (hit && hit.sig === sig) return hit.map;
  const map = new Array(DIG.cols * DIG.rows).fill(null);
  for (const [k, rm] of Object.entries(d.rooms)) for (let r = rm.r; r < rm.r + rm.h; r++) for (let c = rm.c; c < rm.c + rm.w; c++) map[dIdx(c, r)] = k;
  roomMapCache.set(d, { sig, map });
  return map;
}
// the job's room, when it is a built pit room
function pitRoomFor(job) {
  if (!S) return null;
  const k = Object.keys(ROOMS).find(x => ROOMS[x].build && ROOMS[x].job === job);
  return k && S.rooms[k] && S.dig && S.dig.rooms[k] ? k : null;
}
// row-0 tiles that open onto floor 3 (a ladder or the top of a room)
function pitEntries(d, strict) {
  const rmap = roomMap(d), lad = d.lad || {}, out = [];
  for (let k = 0; k < DIG.cols; k++) { const i = dIdx(k, 0); if (d.m[i] === 0 && (!strict || lad[i] || rmap[i])) out.push(i); }
  return out;
}
// walkable route (crew rules) from the floor-3 openings, or from tile `from`, to tile `goal`; null when cut off
function pitRoute(d, from, goal) {
  const src = from == null ? pitEntries(d, true) : [from];
  if (!src.length) return null;
  const { dist, par } = digBfs(d, src, true);
  if (dist[goal] < 0) return null;
  const path = []; let k = goal;
  while (k >= 0) { if (dist[k] === 0) { if (from == null) path.push(k); break; } path.push(k); k = par[k]; }
  path.reverse();
  return { path };
}
// Walk someone through the pit to a spot in a room: floor 3, down through an opening, then tile to tile. True once there.
function pitGoto(c, spot, dt, spd) {
  const d = dg(), goal = spot.cell, v = d.ver | 0;
  if (!c.pp || c.pp.goal !== goal || c.pp.v !== v || (!c.pit && c.pp.fromPit)) {
    const cur = c.pit ? curCell(c) : null, route = pitRoute(d, cur ? dIdx(cur.c, cur.r) : null, goal);
    c.pp = { goal, v, fromPit: !!c.pit, path: route ? route.path : null, i: 0 };
  }
  const pp = c.pp;
  if (!pp.path) {            // no ladder route: wait above the room instead of freezing mid-air
    c.noRoute = true;
    if (c.pit) { pitLeave(c, dt, true); return false; }
    moveTo(c, 3, spot.x, dt, spd); return false;
  }
  c.noRoute = false;
  if (!c.pit) {
    if (!moveTo(c, 3, dCenterX(pp.path[0] % DIG.cols), dt, spd)) return false;
    c.pit = true; c.y = FLOORS[3]; c.floor = 3; c.climbing = false;
  }
  while (pp.i < pp.path.length) {
    const k = pp.path[pp.i], tx = dCenterX(k % DIG.cols), ty = dFeetY((k / DIG.cols) | 0);
    c.climbing = Math.abs(tx - c.x) < 1.5 && Math.abs(ty - c.y) > 1.5;
    if (!stepTo(c, tx, ty, dt, spd * 0.85)) return false;
    pp.i++;
  }
  c.climbing = false;
  return stepTo(c, spot.x, dFeetY((goal / DIG.cols) | 0), dt, spd * 0.85);
}
// can crew reach this room by ladders right now?
function pitRoomReachable(k) {
  const d = dg(), rm = d.rooms[k]; if (!rm) return false;
  return !!pitRoute(d, null, dIdx(rm.c, rm.r + rm.h - 1));
}
// Where may a room's top-left tile go? Every tile must be cleared, free of other rooms and ladders, and the chamber must connect to the bunker.
function roomPlaceCheck(k, c0, r0) {
  const sz = ROOM_CELLS[k], d = dg();
  if (c0 < 0 || r0 < 0 || c0 + sz.w > DIG.cols || r0 + sz.h > DIG.rows) return { ok: false, why: 'Outside the grid' };
  for (let r = r0; r < r0 + sz.h; r++) for (let c = c0; c < c0 + sz.w; c++) {
    const i = dIdx(c, r);
    if (d.m[i] !== 0) return { ok: false, why: 'Dig these tiles out first' };
    if (d.lad && d.lad[i]) return { ok: false, why: 'A ladder is in the way' };
  }
  for (const rm of Object.values(d.rooms)) if (rm.c < c0 + sz.w && c0 < rm.c + rm.w && rm.r < r0 + sz.h && r0 < rm.r + rm.h) return { ok: false, why: 'Another room is there' };
  const { dist } = digBfs(d, pitEntries(d, false), false);
  let linked = false;
  for (let r = r0; r < r0 + sz.h && !linked; r++) for (let c = c0; c < c0 + sz.w; c++) if (dist[dIdx(c, r)] >= 0) { linked = true; break; }
  if (!linked) return { ok: false, why: 'Not connected: dig a tunnel to it from the top' };
  return { ok: true, why: '' };
}
// Ladder spot under the cursor: a pit tile (cleared, touching the walkable network) or a bunker floor gap (one tile wide, from floor to floor).
function ladderCheck(w) {
  const d = dg();
  if (w.y >= FLOORS[1] && w.y < FLOORS[3] && w.x >= IN_L + 16 && w.x <= IN_R - 16) {
    const g = w.y < FLOORS[2] ? 1 : 2, x = DIG.x0 + Math.floor((w.x - DIG.x0) / DIG.cell) * DIG.cell + DIG.cell / 2;
    if (ladderXs(g).some(v => Math.abs(v - x) < DIG.cell + 6)) return { kind: 'bunker', g, x, ok: false, why: 'Too close to another ladder', cost: LADDER_COST.bunker };
    return { kind: 'bunker', g, x, ok: true, why: '', cost: LADDER_COST.bunker };
  }
  const cc = dCellAt(w);
  if (!cc) return null;
  const i = dIdx(cc.c, cc.r), res = { kind: 'pit', c: cc.c, r: cc.r, cost: LADDER_COST.pit };
  if (d.m[i] !== 0) return Object.assign(res, { ok: false, why: 'Dig this tile out first' });
  if (d.lad[i]) return Object.assign(res, { ok: false, why: 'Already a ladder' });
  if (roomMap(d)[i]) return Object.assign(res, { ok: false, why: 'Rooms have their own stairs' });
  if (cc.r === 0) return Object.assign(res, { ok: true, why: '' });          // opens onto floor 3
  const { dist } = digBfs(d, pitEntries(d, true), true);
  for (const [dc, dr] of DIRS) { const a = cc.c + dc, b = cc.r + dr; if (dIn(a, b) && dist[dIdx(a, b)] >= 0) return Object.assign(res, { ok: true, why: '' }); }
  return Object.assign(res, { ok: false, why: 'Must join a ladder, a room or a floor' });
}
let uiSfxN = 0, payN = 0;
// bed cue hook: call bedSfx('bedCrack') when a bed becomes damaged, bedSfx('bunkRepair') when the workshop repairs one
function bedSfx(n) { try { if (window.SFX && SFX[n]) SFX[n](); } catch (e) {} }
function uiSfx(n) { uiSfxN++; try { if (window.SFX && SFX['ui' + n]) SFX['ui' + n](); } catch (e) {} }
function uiConfirm() { uiSfxN++; try { if (window.SFX && SFX.click) SFX.click(); } catch (e) {} }
function startPlace(p) {
  if (digTool) toggleDig();
  if (typeof itemTool !== 'undefined' && itemTool) { itemTool = false; renderItemUI(); }
  placing = p;
  if (S && scene === 'bunker') { bcam.follow = null; bcam.cy = 640; }
  const b = document.getElementById('tDig'); if (b) b.classList.remove('on');
  renderDrawer();
}
function cancelPlace() { if (!placing) return; placing = null; if (S && !digTool) bcam.cy = H / 2; renderDrawer(); }
function placeClick(w) {
  if (!placing) return;
  const d = dg();
  if (placing.kind === 'room') {
    const k = placing.k, r = BUILD_ROOMS[k], sz = ROOM_CELLS[k], s = placeRoomOrigin(w, sz), chk = roomPlaceCheck(k, s.c, s.r);
    if (!chk.ok) { uiSfx('Error'); lamp(chk.why + '.', 'warn'); return; }
    if (!canPay(r.cost)) { uiSfx('Error'); lamp('The ' + ROOMS[k].name + ' needs ' + fmtCost(r.cost) + '.', 'warn'); return; }
    pay(r.cost); claimRoom(k, s); S.rooms[k] = 1; placing = null; bcam.cy = H / 2; uiSfx('Build'); tilePulse(s.c, s.r, sz.w, sz.h, 'build'); pulseTile(s.c, s.r, sz.w, sz.h, 'rgba(120,255,160,');
    lamp(ROOMS[k].name + ' built in the pit. ' + r.done + (pitRoomReachable(k) ? '' : ' No ladder reaches it yet: crew cannot get there until a ladder does.'), 'good');
    renderDrawer(); return;
  }
  const l = ladderCheck(w);
  if (!l) return;
  if (!l.ok) { uiSfx('Error'); lamp(l.why + '.', 'warn'); return; }
  if (!canPay(l.cost)) { uiSfx('Error'); lamp('A ladder segment needs ' + fmtCost(l.cost) + '.', 'warn'); return; }
  pay(l.cost);
  if (l.kind === 'bunker') S.ladders.push({ g: l.g, x: l.x }); else { d.lad[dIdx(l.c, l.r)] = 1; pulseTile(l.c, l.r, 1, 1, 'rgba(120,255,160,'); }
  d.ver = (d.ver | 0) + 1;
  burst(l.kind === 'bunker' ? l.x : dCenterX(l.c), l.kind === 'bunker' ? FLOORS[l.g + 1] - 20 : dFeetY(l.r) - 10, '#a8906a', 5); uiSfx('Build'); if (l.kind !== 'bunker') tilePulse(l.c, l.r, 1, 1, 'build');
}
// top-left tile for a room of this size centred on the cursor, kept inside the grid
function placeRoomOrigin(w, sz) {
  const cc = dCellClamp(w);
  return { c: clamp(cc.c - (sz.w >> 1), 0, DIG.cols - sz.w), r: clamp(cc.r - (sz.h >> 1), 0, DIG.rows - sz.h) };
}
function drawDig() {
  const d = dg(), cs = DIG.cell, gw = DIG.cols * cs, gh = DIG.rows * cs;
  const claimed = new Set(S.crew.filter(o => o.alive && o.dig != null).map(o => o.dig));
  g.save();
  g.fillStyle = '#3a2d1f'; g.fillRect(IN_L - 14, DIG.y0, 14 + (DIG.x0 - IN_L), gh); g.fillRect(DIG.x0 + gw, DIG.y0, IN_R + 14 - DIG.x0 - gw, gh);
  g.fillStyle = '#120d09'; g.fillRect(DIG.x0, DIG.y0, gw, gh);
  for (let r = 0; r < DIG.rows; r++) for (let c = 0; c < DIG.cols; c++) {
    const i = dIdx(c, r), v = d.m[i], x = DIG.x0 + c * cs, y = DIG.y0 + r * cs;
    if (v === 0) { if (r === 0) { g.fillStyle = '#0e0a07'; g.fillRect(x, FLOORS[3], cs, 10); } continue; }
    g.fillStyle = DIG.mats[v].color; g.fillRect(x, y, cs, cs); tex(v >= 3 ? 'stone' : 'soil', x, y, cs, cs, 1);
    g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, cs - 1, cs - 1);
    g.fillStyle = 'rgba(0,0,0,.28)'; g.strokeStyle = 'rgba(0,0,0,.3)';
    if (v === 1) { g.fillRect(x + 6, y + 7, 3, 3); g.fillRect(x + 15, y + 15, 3, 3); }
    else if (v === 2) { g.beginPath(); g.moveTo(x + 4, y + 8); g.lineTo(x + cs - 4, y + 8); g.moveTo(x + 4, y + 16); g.lineTo(x + cs - 4, y + 16); g.stroke(); }
    else if (v === 3) { g.beginPath(); g.moveTo(x + 4, y + cs - 5); g.lineTo(x + cs - 5, y + 4); g.stroke(); }
    else { g.beginPath(); g.moveTo(x + 4, y + 4); g.lineTo(x + cs - 4, y + cs - 4); g.moveTo(x + cs - 4, y + 4); g.lineTo(x + 4, y + cs - 4); g.stroke(); }
    const dmg = 1 - d.hp[i] / DIG.mats[v].hard;
    if (dmg > 0.02) { g.fillStyle = 'rgba(0,0,0,' + (0.5 * dmg) + ')'; g.fillRect(x + 1, y + 1, cs - 2, cs - 2); }
    if (d.mark[i]) {
      g.fillStyle = 'rgba(255,210,60,.26)'; g.fillRect(x, y, cs, cs);
      g.strokeStyle = '#ffd23c'; g.lineWidth = 2; g.setLineDash([5, 3]); g.strokeRect(x + 2, y + 2, cs - 4, cs - 4); g.setLineDash([]);
      if (claimed.has(i)) { g.fillStyle = '#fff'; g.fillRect(x + 10, y + 10, 4, 4); }
    }
  }
  // rooms built in cleared chambers
  for (const [k, rm] of Object.entries(d.rooms)) {
    const rx = DIG.x0 + rm.c * cs, ry = DIG.y0 + rm.r * cs, rw = rm.w * cs, rh = rm.h * cs;
    const gr = g.createLinearGradient(0, ry, 0, ry + rh); gr.addColorStop(0, '#2a1d12'); gr.addColorStop(1, '#4a3018');
    g.fillStyle = gr; g.fillRect(rx, ry, rw, rh); tex('stone', rx, ry, rw, rh, 0.9);
    g.strokeStyle = '#5a4428'; g.lineWidth = 2; g.strokeRect(rx + 1, ry + 1, rw - 2, rh - 2);
    g.fillStyle = '#ffcf7a'; g.fillRect(rx + rw / 2 - 6, ry + 2, 12, 4);
    g.fillStyle = 'rgba(255,214,150,.85)'; g.font = '600 12px sans-serif'; g.fillText(ROOMS[k].name.toUpperCase(), rx + 8, ry + 18);
    if (k === 'generator') { box(rx + 10, ry + rh - 44, 70, 44, '#3d4650'); box(rx + 18, ry + rh - 58, 14, 14, '#2a2a26'); g.fillStyle = S.powered ? ((Math.floor(performance.now() / 250) % 2) ? '#7fc8ff' : '#3a6a8a') : '#553'; g.fillRect(rx + 90, ry + rh - 36, 8, 8); }
    else if (k === 'armory') { box(rx + 8, ry + rh - 46, 110, 5, '#4a4a44'); for (let q = 0; q < 5; q++) box(rx + 14 + q * 20, ry + rh - 46, 4, 26, '#2a2a26'); box(rx + 20, ry + rh - 18, 80, 18, '#5a4a32'); g.fillStyle = S.powered ? '#7fc8ff' : '#553'; g.fillRect(rx + rw - 14, ry + 24, 6, 6); }
    else if (k === 'workshop') {
      for (const bx of [8, 84]) { box(rx + bx, ry + rh - 30, 56, 6, '#7a6a55'); box(rx + bx + 4, ry + rh - 24, 5, 24, '#5a4d3c'); box(rx + bx + 47, ry + rh - 24, 5, 24, '#5a4d3c'); }
      box(rx + 20, ry + rh - 40, 14, 10, '#9a8a70'); g.fillStyle = '#ffb347'; g.fillRect(rx + 100, ry + rh - 38, 6, 8);
      box(rx + 8, ry + 30, 128, 3, '#4a3d2e'); for (let q = 0; q < 6; q++) box(rx + 14 + q * 20, ry + 33, 3, 12, '#8a8a92');
    }
    else { for (let q = 0; q < 4; q++) { box(rx + 10 + q * 32, ry + rh - 24, 26, 22, '#8a6a42'); box(rx + 10 + q * 32, ry + rh - 50, 26, 22, '#7a5c38'); } }
    if (!pitRoomReachable(k)) { g.fillStyle = '#ff6a5a'; g.font = '600 10px sans-serif'; g.fillText('NO LADDER ROUTE', rx + 8, ry + 32); }
  }
  // ladder segments (one tile wide)
  for (const key of Object.keys(d.lad || {})) {
    const i = +key, lc = i % DIG.cols, lr = (i / DIG.cols) | 0, lx = DIG.x0 + lc * cs, ly = DIG.y0 + lr * cs;
    if (lr === 0) { g.fillStyle = '#0e0a07'; g.fillRect(lx, FLOORS[3], cs, 10); }   // hatch cut in the floor-3 slab
    g.fillStyle = 'rgba(14,10,7,.5)'; g.fillRect(lx + 2, ly, cs - 4, cs);
    g.strokeStyle = '#8a7650'; g.lineWidth = 2; g.beginPath(); g.moveTo(lx + 6, ly - (lr === 0 ? 10 : 0)); g.lineTo(lx + 6, ly + cs); g.moveTo(lx + cs - 6, ly - (lr === 0 ? 10 : 0)); g.lineTo(lx + cs - 6, ly + cs); g.stroke();
    g.lineWidth = 1.6; for (let y = ly + 5; y < ly + cs; y += 8) { g.beginPath(); g.moveTo(lx + 6, y); g.lineTo(lx + cs - 6, y); g.stroke(); }
  }
  drawTilePulses(cs);
  if (digDrag) {
    const a = digDrag.a, b = digDrag.b, x = DIG.x0 + Math.min(a.c, b.c) * cs, y = DIG.y0 + Math.min(a.r, b.r) * cs;
    const w = (Math.abs(a.c - b.c) + 1) * cs, h = (Math.abs(a.r - b.r) + 1) * cs;
    g.fillStyle = digDrag.erase ? 'rgba(255,80,70,.22)' : 'rgba(90,220,255,.2)'; g.fillRect(x, y, w, h);
    g.strokeStyle = digDrag.erase ? '#ff5a4e' : '#5adcff'; g.lineWidth = 2; g.strokeRect(x, y, w, h);
  }
  if (digTool) {
    const cc = dCellAt(bcamToWorld({ x: mouse.x, y: mouse.y }));
    if (cc) {
      const i = dIdx(cc.c, cc.r), v = d.m[i], x = DIG.x0 + cc.c * cs, y = DIG.y0 + cc.r * cs;
      if (!gridOn) {
        const dhc = !!prefs.hc, dcb = !!prefs.cb, dok = v !== 0;
        const dgood = dcb ? '74,163,255' : '90,220,110', dbad = dcb ? '255,160,46' : '230,70,70';
        g.fillStyle = 'rgba(' + (dok ? dgood : dbad) + ',' + (dhc ? '.5' : '.28') + ')'; g.fillRect(x, y, cs, cs);
        g.strokeStyle = dhc ? '#fff' : 'rgba(' + (dok ? dgood : dbad) + ',.95)'; g.lineWidth = 2;
        if (dhc && !dok) g.setLineDash([5, 3]);
        g.strokeRect(x + 1, y + 1, cs - 2, cs - 2); g.setLineDash([]);
      }
      g.strokeStyle = '#fff'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, cs - 1, cs - 1);
      const txt = v ? DIG.mats[v].name + ' (hardness ' + DIG.mats[v].hard + ', ' + Math.round(d.hp[i] / DIG.mats[v].hard * 100) + '% left)' : 'Open';
      g.font = '600 12px sans-serif'; const tw = g.measureText(txt).width + 12, tx = clamp(x - tw / 2 + cs / 2, DIG.x0, DIG.x0 + gw - tw), ty = Math.max(DIG.y0 + 2, y - 22);
      g.fillStyle = 'rgba(20,10,8,.9)'; g.fillRect(tx, ty, tw, 18); g.fillStyle = '#ffe0a8'; g.fillText(txt, tx + 6, ty + 13);
    }
  }
  g.restore();
}
// bunker ladders (S.ladders): a one-tile shaft between two floors with a hatch cut in the slab above
function drawBunkerLadders() {
  if (!S || !S.ladders) return;
  for (const l of S.ladders) {
    const y0 = FLOORS[l.g], y1 = FLOORS[l.g + 1];
    g.fillStyle = '#0e0a07'; g.fillRect(l.x - 12, y0, 24, 10);
    g.fillStyle = 'rgba(14,10,7,.55)'; g.fillRect(l.x - 11, y0 + 10, 22, y1 - y0 - 10);
    g.strokeStyle = '#8a7650'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(l.x - 7, y0); g.lineTo(l.x - 7, y1); g.moveTo(l.x + 7, y0); g.lineTo(l.x + 7, y1); g.stroke();
    g.lineWidth = 1.6; for (let y = y0 + 8; y < y1; y += 12) { g.beginPath(); g.moveTo(l.x - 7, y); g.lineTo(l.x + 7, y); g.stroke(); }
  }
}
// build-mode tile grid overlay (toggle with N): pit grid lines plus a hover cell tinted valid / invalid
let gridOn = true;
try { gridOn = localStorage.getItem('ab_grid') !== '0'; } catch (e) {}
function toggleBuildGrid() {
  gridOn = !gridOn;
  try { localStorage.setItem('ab_grid', gridOn ? '1' : '0'); } catch (e) {}
  lamp('Build grid ' + (gridOn ? 'on.' : 'off.'));
}
function drawBuildGrid() {
  if (!gridOn || !S || scene !== 'bunker' || !(placing || digTool)) return;
  const cs = DIG.cell, hc = !!prefs.hc, cbm = !!prefs.cb;
  const x1 = DIG.x0 + DIG.cols * cs, y1 = DIG.y0 + DIG.rows * cs;
  g.save();
  g.strokeStyle = hc ? 'rgba(255,255,255,.35)' : 'rgba(255,214,150,.14)'; g.lineWidth = 1;
  g.beginPath();
  for (let c = 0; c <= DIG.cols; c++) { const x = DIG.x0 + c * cs + 0.5; g.moveTo(x, DIG.y0); g.lineTo(x, y1); }
  for (let r = 0; r <= DIG.rows; r++) { const y = DIG.y0 + r * cs + 0.5; g.moveTo(DIG.x0, y); g.lineTo(x1, y); }
  g.stroke();
  const cc = dCellAt(bcamToWorld({ x: mouse.x, y: mouse.y }));
  if (cc) {
    let ok = true;
    if (placing && placing.kind === 'ladder') { const l = ladderCheck({ x: DIG.x0 + (cc.c + 0.5) * cs, y: DIG.y0 + (cc.r + 0.5) * cs }); ok = !!(l && l.ok); }
    else if (digTool) ok = dg().m[dIdx(cc.c, cc.r)] !== 0;
    const x = DIG.x0 + cc.c * cs, y = DIG.y0 + cc.r * cs;
    const good = cbm ? '74,163,255' : '90,220,110', bad = cbm ? '255,160,46' : '230,70,70';
    g.fillStyle = 'rgba(' + (ok ? good : bad) + ',' + (hc ? '.5' : '.28') + ')';
    g.fillRect(x, y, cs, cs);
    g.strokeStyle = hc ? '#fff' : 'rgba(' + (ok ? good : bad) + ',.95)'; g.lineWidth = 2;
    if (hc && !ok) g.setLineDash([5, 3]);
    g.strokeRect(x + 1, y + 1, cs - 2, cs - 2); g.setLineDash([]);
  }
  g.restore();
}
// green / red preview of the room or ladder segment under the cursor while the Build tool is held
function drawPlaceGhost() {
  if (!placing || !S || scene !== 'bunker') return;
  const w = bcamToWorld({ x: mouse.x, y: mouse.y }), cs = DIG.cell;
  let chk, x, y, bw, bh, label;
  if (placing.kind === 'room') {
    const k = placing.k, sz = ROOM_CELLS[k], s = placeRoomOrigin(w, sz);
    chk = roomPlaceCheck(k, s.c, s.r); x = DIG.x0 + s.c * cs; y = DIG.y0 + s.r * cs; bw = sz.w * cs; bh = sz.h * cs; label = ROOMS[k].name.toUpperCase();
    if (chk.ok && !canPay(BUILD_ROOMS[k].cost)) chk = { ok: false, why: 'Needs ' + fmtCost(BUILD_ROOMS[k].cost) };
  } else {
    const l = ladderCheck(w); if (!l) return;
    chk = l; label = 'LADDER';
    if (l.kind === 'bunker') { x = l.x - cs / 2; y = FLOORS[l.g]; bw = cs; bh = FLOORS[l.g + 1] - FLOORS[l.g]; }
    else { x = DIG.x0 + l.c * cs; y = DIG.y0 + l.r * cs; bw = cs; bh = cs; }
    if (chk.ok && !canPay(l.cost)) chk = { ok: false, why: 'Needs ' + fmtCost(l.cost) };
  }
  g.save(); g.font = '600 12px sans-serif';
  const hc = !!prefs.hc, cbm = !!prefs.cb;
  const okCol = cbm ? '#4aa3ff' : '#5adc6e', badCol = cbm ? '#ffa02e' : '#ff5a4e';
  const col = chk.ok ? okCol : badCol;
  g.fillStyle = chk.ok ? (cbm ? 'rgba(74,163,255,.32)' : 'rgba(90,220,110,.32)') : (cbm ? 'rgba(255,160,46,.34)' : 'rgba(230,70,70,.34)');
  if (hc) g.fillStyle = chk.ok ? (cbm ? 'rgba(74,163,255,.55)' : 'rgba(60,230,100,.55)') : (cbm ? 'rgba(255,160,46,.55)' : 'rgba(255,50,50,.55)');
  g.fillRect(x, y, bw, bh);
  if (hc) {
    // shape cues so the state never depends on colour alone: invalid is hatched, valid is plain
    if (!chk.ok) {
      g.save(); g.beginPath(); g.rect(x, y, bw, bh); g.clip();
      g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath();
      for (let o = -bh; o < bw; o += 12) { g.moveTo(x + o, y + bh); g.lineTo(x + o + bh, y); }
      g.stroke(); g.restore();
    }
    g.strokeStyle = '#000'; g.lineWidth = 6; g.strokeRect(x + 3, y + 3, bw - 6, bh - 6);
    g.strokeStyle = '#fff'; g.lineWidth = 3; if (!chk.ok) g.setLineDash([8, 5]); g.strokeRect(x + 3, y + 3, bw - 6, bh - 6); g.setLineDash([]);
  } else {
    g.strokeStyle = col; g.lineWidth = 2; g.strokeRect(x + 1, y + 1, bw - 2, bh - 2);
  }
  const costTxt = placing.kind === 'room' ? fmtCost(BUILD_ROOMS[placing.k].cost) : (chk.cost ? fmtCost(chk.cost) : '');
  const txt = (hc ? (chk.ok ? 'OK  ' : 'NO  ') : '') + label + (costTxt ? ' (' + costTxt + ')' : '') + (chk.ok ? '' : ': ' + chk.why), tw = g.measureText(txt).width + 12;
  const tx = clamp(x, IN_L, IN_R - tw), ty = Math.max(FLOORS[0] + 20, y - 22);
  if (hc) {
    g.fillStyle = '#000'; g.fillRect(tx, ty, tw, 18); g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.strokeRect(tx + 0.75, ty + 0.75, tw - 1.5, 16.5);
    g.fillStyle = '#fff';
  } else {
    g.fillStyle = 'rgba(20,10,8,.9)'; g.fillRect(tx, ty, tw, 18);
    g.fillStyle = chk.ok ? (cbm ? '#d6eaff' : '#d6ffd9') : (cbm ? '#ffe3c2' : '#ffd0cc');
  }
  g.fillText(txt, tx + 6, ty + 13);
  g.restore();
}
function drawPlaceHint() {
  if (!placing || !S || scene !== 'bunker') return;
  const t = placing.kind === 'room'
    ? 'PLACE ' + ROOMS[placing.k].name.toUpperCase() + ' (' + fmtCost(BUILD_ROOMS[placing.k].cost) + '): click cleared pit tiles that connect to the bunker. Right-drag pans. Esc cancels.'
    : 'LADDER TOOL (' + fmtCost(LADDER_COST.pit) + ' per pit tile, ' + fmtCost(LADDER_COST.bunker) + ' per floor gap): click to add one segment. Right-drag pans. Esc or L stops.';
  g.save(); g.font = '600 13px sans-serif';
  const w = g.measureText(t).width + 24;
  g.fillStyle = 'rgba(20,10,8,.85)'; g.fillRect((W - w) / 2, H - 44, w, 28); g.fillStyle = '#9af0a6'; g.fillText(t, (W - w) / 2 + 12, H - 25);
  g.restore();
}
function drawDigHint() {
  if (!digTool || !S) return;
  const marked = dg().mark.reduce((a, v) => a + v, 0);
  g.save(); g.font = '600 13px sans-serif';
  const t = 'DIG TOOL: drag a box to mark cells. Shift-drag (or start on a marked cell) cancels. Right-drag pans. ' + marked + ' marked. X to exit.';
  const w = g.measureText(t).width + 24;
  g.fillStyle = 'rgba(20,10,8,.85)'; g.fillRect((W - w) / 2, H - 44, w, 28); g.fillStyle = '#ffd23c'; g.fillText(t, (W - w) / 2 + 12, H - 25);
  g.restore();
}
function workshopTick(c, e, h) {
  // Repairs first (1 scrap per 10 hp), then parts from scrap.
  let work = 10 * c.stats.build * e * h * (hasB('toolrack') ? 1.25 : 1);
  for (const s of [S.door, S.wall, ...S.turrets.filter(Boolean)]) {
    if (work <= 0) break;
    if (s === S.door && S.enemies.some(en => en.inside)) continue;
    const miss = s.max - s.hp; if (miss <= 0) continue;
    const amt = Math.min(miss, work, S.res.scrap * 10); if (amt <= 0) break;
    s.hp += amt; S.res.scrap -= amt / 10; work -= amt;
    if (window.SFX && SFX.repair) SFX.repair();
    if (s === S.door && S.breached && S.door.hp > 40) { S.breached = false; if (window.SFX && SFX.repair) SFX.repair('seal'); lampEv('door_repair', 'The hatch is sealed again.', 'good'); }
  }
  work = maintTick(work);   // leftover work services worn machines
  // then the craft queue (weapons paid for up front in the Gear tab)
  while (work > 0 && S.craft && S.craft.length) {
    const j = S.craft[0], use = Math.min(work, j.left);
    j.left -= use; work -= use;
    if (j.left > 0.001) break;
    S.craft.shift(); addStock(j.id, 1); lamp('The workshop finished a ' + gearName(j.id) + '. It is in the Gear tab.', 'good');
  }
  if (work > 0 && S.makeParts && S.res.scrap >= 2) { const n = Math.min(work / 30, S.res.scrap / 2); S.res.parts += n; S.res.scrap -= n * 2; }
}
function guardShoot(c, e) {
  if (c.cd > 0) return;
  const t = S.enemies.filter(en => !en.inside && !en.hidden && en.hp > 0 && en.x > c.x && en.x - c.x < 260).sort((a, b) => a.x - b.x)[0];
  if (!t) return;
  c.cd = 0.9; c.facing = 1;
  tracer(c.x + 8, c.y - 20, t.x, t.y - 14, '#ffd27a');
  if (Math.random() < (0.3 + 0.5 * c.stats.acc) * e) hitEnemy(t, 10 * armoryMult(), c);
}
function levelUp(c) {
  c.lvl++; for (const k in c.stats) c.stats[k] = +(c.stats[k] * 1.06).toFixed(2); c.maxHp += 8; c.hp += 8;
  lamp(c.name + ' is now level ' + c.lvl + '.', 'good');
}
function kill(c, how) {
  c.alive = false; c.hp = 0; S.stats.lost.push(c.name); leaveState(c, 'dead');
  if (c.held) { addStock(c.held, 1); c.held = null; }
  dropCarry(c);
  for (const o of living()) o.mor = Math.max(0, (o.mor ?? 70) - 6);
  if (c.named || S.stats.lost.length === 1) moment(c.name + (how === 'starved' ? ' starved' : ' was killed'));
  for (const o of living()) if (o.bonds.includes(c.id) || c.bonds.includes(o.id)) { o.grief = 24; lamp(o.name + ' is grieving ' + c.name + '. They will work slower for a day.', 'warn'); }
  const lostTxt = c.name + (how === 'starved' ? ' starved.' : ' was killed.') + (c.named ? ' We will not forget them.' : '');
  const left = living().length;
  { const nowSr = performance.now(); if (!(nowSr - (window._srKillAt || 0) < 1500)) { window._srKillAt = nowSr; srSay(c.name + (how === 'starved' ? ' starved. ' : ' was killed. ') + left + ' survivors remain.', 'warn'); } }
  S.lostT = (S.lostT || []).filter(t => S.t - t < 60); S.lostT.push(S.t);
  atLoc({ x: c.x, y: c.y });
  if (left === 49) lampEv('pop_50', lostTxt + ' Fewer than fifty survivors remain.', 'warn');
  else if (left === 10) lampEv('pop_10', lostTxt + ' Ten survivors remain.', 'warn');
  else if (left === 3) lampEv('pop_3', lostTxt + ' Three survivors remain.', 'warn');
  else if (S.lostT.length >= 3) lampEv('survivor_lost_many', lostTxt, 'warn');
  else lampEv('survivor_lost', lostTxt, 'warn');
  burst(c.x, c.y - 14, '#a33', 14);
  if (window.SFX && SFX.survivorLost) SFX.survivorLost(S.lostT.length >= 3);
  toastFeed('lost', lostTxt, { x: c.x, y: c.y });
  if (!anyoneAlive() && S.player.down) gameOver(false);
}
// true if any crew member survives, including those out on an expedition (living() excludes them)
function anyoneAlive() { return S.crew.some(c => c.alive); }
function sicken(c, why) {
  if (c.sick || !c.alive) return;
  c.sick = true; c.cure = 0; c.patient = true;
  lamp(c.name + ' is sick from ' + why + '. Send them to the med bay.', 'warn');
}
function medTick(h) {
  const medics = living().filter(c => c.job === 'med' && c.state === 'work');
  const rate = medics.length ? medics.reduce((a, c) => a + 10 * c.stats.med * eff(c), 0) : 2;
  const mult = (S.rooms.med > 1 ? 1.5 : 1) * (hasB('medkit') ? 1.25 : 1) * (S.powered ? ROOM_FX.powerBoost : 1);
  for (const c of living()) if (c.state === 'patient' || (c.floor === 2 && c.x > ROOMS.med.x0 && c.state !== 'walk')) c.hp = Math.min(c.maxHp, c.hp + rate * mult * h);
  // cure illness: patients in the med bay recover, much faster with a medic on duty
  const cureRate = (medics.length ? medics.reduce((a, c) => a + 0.5 * c.stats.med * eff(c), 0) : 0.1) * mult;
  for (const c of living()) if (c.sick && c.state === 'patient') {
    c.cure = (c.cure || 0) + cureRate * h;
    if (c.cure >= 1) { c.sick = false; c.cure = 0; lamp(c.name + ' has recovered from their illness.', 'good'); }
  }
  if (P.inMed) S.player.hp = Math.min(S.player.maxHp, S.player.hp + rate * mult * h);
}

function structureList() {
  // In order from the outside in. Enemies have to get through each to reach the door.
  const L = [];
  if (S.wall.hp > 0) L.push({ s: S.wall, x: WALL_X, name: 'wall' });
  for (let i = 1; i >= 0; i--) if (S.turrets[i] && S.turrets[i].hp > 0) L.push({ s: S.turrets[i], x: SLOT_X[i], name: 'turret', i });
  L.push({ s: S.door, x: DOOR_X, name: 'door' });
  return L;
}
// Speed multiplier from powered slow-field coils (strongest one applies, they do not stack).
function coilSlow(e) {
  if (!S.powered || e.inside) return 1;
  for (let i = 0; i < 2; i++) { const t = S.turrets[i]; if (t && t.type === 'coil' && t.hp > 0 && e.x > SLOT_X[i] - 20 && e.x - SLOT_X[i] < TURRETS.coil.range) return TURRETS.coil.slow; }
  return 1;
}
function burrowerEmerge(e) {
  const fl = 1 + Math.floor(Math.random() * (FLOORS.length - 1));
  e.hidden = false; e.dig = null; e.inside = true; e.burrow = true;
  e.floor = fl; e.y = FLOORS[fl]; e.x = clamp(LADDER_X + rnd(-120, 120), 40, W - 40); e.climbing = false;
  if (!S.alarm && !S.alarmAuto) { S.alarmAuto = true; toggleAlarm(); }
  addShake(0.35); if (window.SFX && SFX.rumble) SFX.rumble(0.6);
  burst(e.x, e.y - 8, '#8a7a66', 16);
  lamp('A Burrower tunnelled past the door and surfaced inside the bunker!', 'warn');
  if (speed > 1) setSpeed(1);
}
function enemyTick(e, dt) {
  const b = ENEMIES[e.type];
  e.anim += dt * 8; if (e.cd > 0) e.cd -= dt;
  if (statusTick(e, dt) || tactics(e, b, dt)) return;
  if (b.tunnel && !e.inside) {
    if (!e.dig) {
      if (e.x > DOOR_X + BURROW_STOP) { e.x -= b.spd * coilSlow(e) * dt; e.facing = -1; return; }
      e.dig = { t: BURROW_DIG_TIME, warned: false }; e.hidden = true; burst(e.x, FLOORS[0] - 4, '#8a7a66', 10);
      addShake(0.12); if (window.SFX && SFX.rumble) SFX.rumble(0.3);
      return;
    }
    e.dig.t -= dt;
    if (Math.random() < dt * 6) burst(e.x, FLOORS[0] - 4, '#8a7a66', 2);
    if (!e.dig.warned && e.dig.t <= BURROW_DIG_TIME / 2) { e.dig.warned = true; if (!prefs.rm) addShake(0.08); if (window.SFX && SFX.rumble) SFX.rumble(0.4); }
    if (e.dig.t <= 0) burrowerEmerge(e);
    return;
  }
  if (!e.inside) {
    // anyone standing on the surface in its way?
    const people = [...living().filter(c => c.floor === 0 && !c.climbing), ...(scene === 'bunker' && P.floor === 0 && !S.player.down ? [P] : [])];
    const near = people.filter(p => p.x < e.x + 4 && e.x - p.x < (b.ranged || 24)).sort((a, z) => z.x - a.x)[0];
    const target = pickTarget(e, b);
    const tx = target ? target.x + (b.ranged || 22) : DOOR_X;
    if (near && (!target || near.x > target.x)) return attack(e, b, near, near.x);
    if (!target) { e.x += b.spd * dt; return; }   // somehow left of the hatch: walk back to it
    if (target.name === 'door' && S.door.hp <= 0) {
      if (e.x > DOOR_X + 6) { e.x -= b.spd * coilSlow(e) * dt; e.facing = -1; return; }
      breach(); e.inside = true; return;
    }
    if (e.x > tx + 1) { e.x -= b.spd * coilSlow(e) * dt; e.facing = -1; return; }
    if (target) attack(e, b, target.s, target.x, target.name);
    return;
  }
  // inside the bunker: go for the nearest person
  if (e.type === 'maw' && !e.climbing) { if (!e.reach) e.reach = {}; e.reach[e.floor] = true; }   // rooms the breach has reached
  const people = [...living(), ...(scene === 'bunker' && !S.player.down ? [P] : [])];
  const t = people.sort((a, z) => (Math.abs(a.floor - e.floor) * 500 + Math.abs(a.x - e.x)) - (Math.abs(z.floor - e.floor) * 500 + Math.abs(z.x - e.x)))[0];
  if (!t) { moveTo(e, 3, 900, dt, b.spd); return; }
  if (t.floor === e.floor && !e.climbing && Math.abs(t.x - e.x) < (b.ranged ? 160 : 22)) return attack(e, b, t, t.x);
  moveTo(e, t.climbing ? e.floor : t.floor, t.x, dt, b.spd);
}
const MAW_ROOM_DMG_STEP = 0.5;   // +50% Maw damage per extra room reached
function mawDmgMul(e) {
  if (e.type !== 'maw') return 1;
  const rooms = Math.max(1, e.reach ? Object.keys(e.reach).length : 1);
  return 1 + MAW_ROOM_DMG_STEP * (rooms - 1);
}
function attack(e, b, target, tx, what) {
  e.facing = Math.sign(tx - e.x) || -1;
  if (e.cd > 0) return;
  e.cd = b.rate;
  if (b.ranged) { tracer(e.x - 6, e.y - b.h + 8, tx, (target.y || FLOORS[0]) - 16, '#ff7a5a'); if (Math.random() > 0.65) return; }
  if (target === P) return hurtPlayer(b.dmg * mawDmgMul(e));
  if (target.stats) { const cd = b.dmg * mawDmgMul(e) * coverMul(target); dmgNum(target.x, (target.y || FLOORS[0]) - 40, cd); target.hp -= cd; burst(target.x, target.y - 16, '#c33', 4); if (target.hp <= 0) kill(target); return; }
  target.hp = Math.max(0, target.hp - b.dmg * structDmgMul(what)); burst(tx + 6, FLOORS[0] - 20, '#bbb', 3);
  if (window.SFX && !(what === 'door' && SFX.doorHit)) SFX.hit(what);
  if (what === 'door') {
    doorHitAt = performance.now();
    if (window.SFX && SFX.doorHit) SFX.doorHit(clamp((b.dmg || 1) * structDmgMul(what) / 20, 0.1, 1), target.hp <= 0); spawnCeilMotes(tx, b.dmg || 1);
    doorVigKick(clamp(0.3 + (b.dmg || 1) * 0.02, 0.3, 0.8)); doorHitN++; doorHitPow = clamp((b.dmg || 1) / 12, 0.4, 1);
    if (!prefs.rm) {
      fxDust(tx + 6, FLOORS[0] - 14, 4 + Math.floor(Math.random() * 3));
      fxRubble(tx + 6, FLOORS[0] - 40, 1 + Math.floor(Math.random() * 3));
    }
    fxGrit(tx + 6, FLOORS[0] - 100, 5 + Math.floor(Math.random() * 4), 140);
    fxSparks(tx + 6, FLOORS[0] - 20, 3 + Math.floor(Math.random() * 3), 1);
    const dm = b.dmg || 1;
    if (scene === 'bunker') addShake(clamp(0.08 + dm * 0.015, 0.08, 0.45));
    if (window.SFX && !SFX.doorHit) { const hk = clamp(dm / 20, 0.15, 1); if (SFX.doorThud) SFX.doorThud(hk); else if (SFX.rumble) SFX.rumble(hk); }
  }
  if (what === 'door') {
    if (target.hp > 0 && target.hp < target.max * 0.25) { if (window.SFX && SFX.doorWarn) SFX.doorWarn(); if (!doorLowSaid) { doorLowSaid = true; lampEv('door_low', 'Door integrity critical.', 'warn'); } }
    else { if (target.hp > target.max * 0.5) doorLowSaid = false; narrPlay(narrPick('door_attack')); const nowSr = performance.now(); if (!(nowSr - (window._srDoorAt || 0) < 8000)) { window._srDoorAt = nowSr; srSay('The hatch is under attack. Door at ' + Math.max(0, Math.round(target.hp / target.max * 100)) + ' percent.', 'warn'); } }
  }
  if (what === 'wall' && target.hp <= 0) lampEv('wall_down', 'The outer wall is down!', 'warn');
  if (what === 'turret' && target.hp <= 0) { lampEv('turret_lost', 'A turret was destroyed.', 'warn'); const i = S.turrets.indexOf(target); S.turrets[i] = null; }
}
function breach() {
  // Called each time something gets in. The alarm sounds once per night, so the player can still stand people down.
  if (!S.alarm && !S.alarmAuto) { S.alarmAuto = true; toggleAlarm(); }
  if (S.breached) return;
  for (const e of S.enemies) if (e.hp > 0 && isBoss(e) && e.type !== 'maw') e.failed = true; // door fell with a boss alive: this fight is failed
  S.breached = true; doorHitAt = performance.now(); doorHitPow = 1; doorVigKick(1); addShake(0.5); screenFlash(1); if (window.SFX && SFX.rumble) SFX.rumble(1);
  fxRubble(DOOR_X, FLOORS[0] - 50, 8); fxGrit(DOOR_X, FLOORS[0] - 100, 14, 180);
  fxDust(DOOR_X, FLOORS[0] - 14, 8); spawnCeilMotes(DOOR_X, 30); spawnCeilMotes(DOOR_X, 30);
  if (window.SFX && SFX.breach) SFX.breach();
  atLoc({ x: DOOR_X, y: FLOORS[0] }); lampSay('breach', 'warn'); moment('The door was breached');
  if (!S.breachLog) {
    if (S.tower.done >= 1) { S.breachLog = 2; lamp(pick(LAMP_LINES.breachCause), 'warn', 2500); }
    else { S.breachLog = 1; lamp(pick(LAMP_LINES.breachClue), 'warn', 2500); }
  }
  if (speed > 1) setSpeed(1);
}
function hitEnemy(e, dmg, by, dtype, crit) {
  if (e.hp <= 0 || e.hidden) return;
  dmg *= resMul(e, dtype || 'pierce');
  e.hp -= dmg; if (fx.nums.length > 60) fx.nums.shift(); fx.nums.push({ x: e.x, y: e.y - ENEMIES[e.type].h - 6, t: 0.7, s: Math.round(dmg) + (crit ? '!' : ''), still: !!prefs.rm, col: crit ? '#ffd24a' : undefined, big: !!crit });
  burst(e.x, e.y - ENEMIES[e.type].h / 2, '#7a2', 3);
  e.hitAt = performance.now(); e.hitCrit = !!crit;
  fxHit(e.x, e.y - ENEMIES[e.type].h / 2, !!crit);
  if (e.hp > 0 && window.SFX && SFX.enemyHit) SFX.enemyHit(!!crit, dtype);
  if (e.hp <= 0) {
    S.stats.kills++;
    const xp = ENEMIES[e.type].xp;
    if (by && by.stats) { by.xp += xp; by.kills++; if (by.xp >= 60 * by.lvl) { by.xp -= 60 * by.lvl; levelUp(by); } }
    else if (by === P) { S.player.xp += xp; if (S.player.xp >= 50 * S.player.lvl) { S.player.xp -= 50 * S.player.lvl; S.player.lvl++; S.player.maxHp += 10; S.player.hp += 10; lamp('Mara is now level ' + S.player.lvl + ': more health and a harder-hitting pistol.', 'good'); } }
    if (Math.random() < 0.35) S.res.scrap += e.type === 'raider' ? 3 : 1;
    if (e.gear && GEAR[e.gear]) {
      // the weapon it was carrying: usually still in one piece, otherwise a few scrap
      if (Math.random() < 0.75 || e.type === 'cinder') { addStock(e.gear, 1); lamp('Looted a ' + gearName(e.gear) + ' off the ' + ENEMIES[e.type].name.toLowerCase() + '.', 'good'); }
      else S.res.scrap += 2;
    }
    if (e.failed && !e.scarred) scarBoss(e);
    if (e.type === 'cinder') { lampEv('boss_down', 'Cinder is down. His raiders scatter into the ash. Rook will want to hear about this.', 'good'); S.res.parts += 8; S.res.elec += 3; }
    if (e.type === 'maw') { lamp('The Maw is dead. Its tunnel is full of salvage.', 'good'); S.res.parts += 12; S.res.elec += 5; S.res.mat += 10; }
    burst(e.x, e.y - 10, '#5a3', 12);
    if (window.SFX && SFX.death) SFX.death(e.type === 'cinder' || e.type === 'maw' || e.type === 'ram' ? 'big' : '');
  }
}
// 'none' = nobody holds the job, 'walking' = assigned but not at the gun yet, 'manned' = gun is staffed
function turretStatus(t) {
  if (!t || t.type === 'coil') return 'manned';
  if (!turretCrewed(t)) return 'none';
  return t.manned ? 'manned' : 'walking';
}
function turretCrewed(t) {
  if (!t) return false;
  if (t.type === 'coil') return !!t.manned;
  const i = S.turrets.indexOf(t);
  if (i < 0) return false;
  const job = i ? 'turretB' : 'turretA';
  return living().some(c => c.job === job || (S.alarm && c.alarmSlot === i));
}
// bunker foley: watches how far someone moved since the last tick, so it works for every movement routine
const footMem = new WeakMap();
function footFoley(o, isPlayer) {
  if (!window.SFX || scene !== 'bunker') return;
  const cl = !!(o.climbing || o.onLadder), m = footMem.get(o);
  if (!m) { footMem.set(o, { x: o.x, y: o.y, cl, acc: 0 }); return; }
  const dx = Math.abs(o.x - m.x), dy = Math.abs(o.y - m.y), q = isPlayer ? 0.8 : 0.3;
  if (dx > 60 || dy > 200) m.acc = 0;          // teleport or respawn: stay silent
  else if (cl) {
    m.acc += dy;
    if (m.acc >= 22) { m.acc = 0; SFX.rung(q); }
  } else {
    if (m.cl) { SFX.drop(q); m.acc = 0; }
    m.acc += dx;
    if (m.acc >= 34) { m.acc = 0; if (!isPlayer) SFX.foot(q); } // Mara's steps come from SFX.step
  }
  m.x = o.x; m.y = o.y; m.cl = cl;
}
function simTick(dt) {
  if (S.over) return;
  const mins = dt * GAME_MIN_PER_SEC;
  const before = S.t; S.t += mins;
  resRateSample();
  // whole-hour events
  const h0 = Math.floor(before / 60), h1 = Math.floor(S.t / 60);
  for (let hh = h0 + 1; hh <= h1; hh++) hourEvents(hh % 24);
  // spawns
  for (let i = S.spawns.length - 1; i >= 0; i--) if (S.t >= S.spawns[i].at) { spawnEnemy(S.spawns[i].type); S.spawns.splice(i, 1); }
  mawTick(dt);
  for (const c of S.crew) if (c.alive && !c.exp) { crewTick(c, dt, mins); footFoley(c, false); }
  if (S.player && !S.player.down) footFoley(P, true);
  maraWorkTick(mins);
  pairTick(mins);
  powerTick(mins / 60);
  medTick(mins / 60);
  turretTick(dt);
  for (const e of S.enemies) if (e.hp > 0) enemyTick(e, dt);
  bossReachTick();
  S.enemies = S.enemies.filter(e => e.hp > 0);
  waitingTick(dt);
  if (S.raidActive && !S.spawns.length && !S.enemies.length) { S.raidActive = false; S.stats.repelled = (S.stats.repelled || 0) + 1; moment('Raid repelled'); lampEv('wave_clear', 'Wave cleared.', 'good');
    if (S.cinderRaid && !S.rookDone && S.rookAt == null) { S.rookAt = S.t + 45; lamp('Lamp: Movement at the hatch. One person, no weapon raised. Hold your fire.', 'warn'); } }
  if (!S.dorrowDone && !S.raidActive && (S.stats.repelled || 0) >= 2) {
    S.dorrowDone = true;
    if (!S.crew.some(c => c.id === 'dorrow')) {
      const d = makeCrew({ ...NAMED_RECRUITS.dorrow, named: true });
      d.x = 300; d.floor = 0; d.y = FLOORS[0]; d.hp = Math.round(d.maxHp * 0.8);
      S.crew.push(d);
      moment('Sgt. Dorrow arrived');
      lampEv('newcomer', 'A stiff-backed man in a checkpoint jacket knocks at the hatch. Sergeant Hale Dorrow, late of the checkpoint that fell. Juno snapped to attention before I could say anything. He offers to train the crew. I let him in.', 'good');
    }
  }
  if (S.rookAt != null && !S.rookDone && S.t >= S.rookAt) {
    S.rookDone = true; S.rookAt = null;
    if (!S.crew.some(c => c.id === 'rook')) {
      const r = makeCrew({ ...NAMED_RECRUITS.rook, named: true, bonds: S.crew.some(c => c.id === 'dorrow') ? ['dorrow'] : [] });
      r.x = 300; r.floor = 0; r.y = FLOORS[0]; r.hp = Math.round(r.maxHp * 0.6);
      S.crew.push(r);
      moment('Rook defected'); pairOnJoin('rook');
      lampEv('newcomer', 'Rook, one of Cinder’s raiders, stands at the hatch with his hands open. He says he is done with the wasteland’s hunger and wants to fight for the bunker. I let him in. He is hurt, and some of the crew will not trust him yet.', 'good');
    }
  }
  if (S.breached && !S.enemies.some(e => e.inside) && S.door.hp > 40) { S.breached = false; if (window.SFX && SFX.repair) SFX.repair('seal'); }
  // Mara's needs
  const pl = S.player;
  pl.food = Math.max(0, pl.food - foodDrain() * mins / 60);
  if (pl.food <= 0 && !pl.down) hurtPlayer(3 * mins / 60, true);
  // tower
  if (S.tower.paid && !S.tower.half && S.tower.work >= TOWER[S.tower.done].work / 2 && S.tower.work < TOWER[S.tower.done].work) { S.tower.half = true; lampSay('towerHalf', 'good', { name: TOWER[S.tower.done].name }); }
  if (S.tower.paid && S.tower.work >= TOWER[S.tower.done].work) {
    const st = TOWER[S.tower.done]; moment('Signal tower: ' + st.name + ' complete'); S.tower.done++; S.tower.paid = false; S.tower.work = 0; S.tower.half = false;
    if (S.tower.done >= TOWER.length) { return gameOver(true); }
    lamp('Signal tower: ' + st.name + ' complete. ' + st.line, 'good'); lampSay('towerLeft', 'good', { n: TOWER.length - S.tower.done });
    if (S.breachLog === 1) { S.breachLog = 2; lamp(pick(LAMP_LINES.breachCause), 'good', 3000); }
  }
  // tutorial nudges
  if (S.hint === 0 && S.t > 9.5 * 60) { S.hint = 1; lamp(S.rooms.workshop ? 'Tip: Old Bram in the Workshop repairs the door, wall and turrets with scrap, and turns spare scrap into parts.' : 'Tip: Build a Workshop (Build tab, then place it in the pit) so someone can repair the door and turrets.'); }
  if (S.hint === 1 && S.t > 17 * 60) { S.hint = 2; lamp('Night is coming. Check who is on the turrets after dark: day-shift crew go to bed at 23:00. Battle stations (G) wakes everyone up.', 'warn'); }
}

// ---------------------------------------------------------------- 4. the player
const keys = {};
const PC = Physics.createController({ coyote: 0.10, buffer: 0.12 }); // jump feel (see physics.js)
function bunkerSurfaces() {
  return {
    floors: FLOORS.map((y, f) => f === 0 ? { id: f, y, x0: -Infinity, x1: Infinity } : { id: f, y, x0: IN_L, x1: IN_R }),
    ceilings: FLOORS.slice(0, -1).map(y => ({ y, x0: IN_L, x1: IN_R })),
    headH: 34
  };
}
function scavSurfaces() {
  return { floors: [{ id: 'ground', y: SC_GROUND, x0: -Infinity, x1: Infinity, solid: true }].concat(scav.plats.map(p => ({ id: p.id, y: p.y, x0: p.x, x1: p.x + p.w, solid: !!p.solid }))), dropThrough: kd('down') };
}
function placePlayer(where) {
  P = P || {};
  Object.assign(P, { x: where === 'surface-right' ? W - 50 : 600, y: where === 'surface-right' ? FLOORS[0] : FLOORS[1], vx: 0, vy: 0, floor: where === 'surface-right' ? 0 : 1, climbing: false, onLadder: false, facing: -1, cd: 0, anim: 0, inMed: false, grounded: true });
}
function maxRevives() { return 2; } // starting revive count for each run
function dmgNum(x, y, d) {
  if (!(d >= 1)) return;
  if (fx.nums.length > 60) fx.nums.shift();
  fx.nums.push({ x, y, t: 0.8, s: Math.round(d), col: '#ff5a4a', still: !!prefs.rm });
}
function hurtPlayer(d, quiet) {
  const pl = S.player; if (pl.down) return;
  if (!quiet && scene !== 'scav') dmgNum(P.x, P.y - 44, d);
  pl.hp -= d; if (!quiet) { burst(P.x, P.y - 18, '#c33', 5); P.hurt = 0.2; if (d > 0) addShake(scene === 'scav' ? Math.min(0.3, 0.12 + d * 0.01) : Math.min(0.2, 0.08 + d * 0.006)); if (d > 0) hurtVig = Math.max(hurtVig, Math.min(0.45, 0.25 + d * 0.01)); }
  if (scene === 'scav' && pl.hp > 0 && pl.hp < pl.maxHp * 0.3 && pl.hp + d >= pl.maxHp * 0.3) lampEv('topside_danger', 'Mara is in trouble on the surface. Run first, loot later.', 'warn');
  if (pl.hp <= 0) {
    pl.hp = 0;
    if (!(pl.revives > 0)) { pl.revives = 0; pl.down = 0; downedFx('Mara is down.'); lampEv('survivor_down', 'Mara is down, and nobody is coming to get her up.', 'warn'); gameOver(false); return; }
    pl.down = 8; downedFx('Mara is down.');
    if (scene === 'scav') { lampEv('survivor_down', 'Mara is down out there. Tick dragged you home, but the pack was lost.', 'warn'); endScav(false); }
    else lampEv('survivor_down', 'Mara is down! Doc will patch you up in the med bay.', 'warn');
    if (!anyoneAlive()) gameOver(false);
  }
}
function playerTick(dt) {
  const pl = S.player;
  if (pl.down) {
    pl.down -= dt;
    if (pl.down <= 0) { pl.revives = Math.max(0, (pl.revives || 0) - 1); lampEv('survivor_revive', 'Mara is back on her feet. Revives left: ' + pl.revives + '.', 'good'); pl.down = 0; pl.hp = Math.round(pl.maxHp * 0.5); scene = 'bunker'; P.x = 900; P.y = FLOORS[2]; P.floor = 2; P.climbing = P.onLadder = false; P.vy = 0; }
    return;
  }
  if (scene === 'scav') { P.auto = false; return scavPlayerTick(dt); }
  if (P.auto) { maraAuto(dt); if (P.cd > 0) P.cd -= dt; if (P.hurt > 0) P.hurt -= dt; return; }
  const L = kd('left'), R = kd('right'), U = kd('up'), D = kd('down');
  const lad = ladderSpans().find(s => Math.abs(P.x - s.x) < 22 && ((U && P.y > s.y0 + 2 && P.y <= s.y1 + 2) || (D && P.y < s.y1 - 2 && P.y >= s.y0 - 2)));
  if (!P.onLadder && lad) { P.onLadder = true; P.x = lad.x; P.vy = 0; }
  if (P.onLadder) {
    const ls = ladderSpans().find(s => Math.abs(P.x - s.x) < 3 && P.y >= s.y0 - 12 && P.y <= s.y1 + 12) || ladderSpans()[0];
    const yBefore = P.y;
    if (U) P.y -= TUNE.ladder * dt; if (D) P.y += TUNE.ladder * dt;
    rungSfx(P, Math.abs(P.y - yBefore));
    bunWasGround = true; bunStepAcc = 0;
    P.y = clamp(P.y, ls.y0, ls.y1);
    const f = FLOORS.findIndex(y => Math.abs(P.y - y) < 10);
    if ((L || R) && f >= 0) { P.onLadder = false; P.y = FLOORS[f]; P.floor = f; P.vy = 0; }
    else if (!(L || R)) { if (f >= 0 && !U && !D) { P.y = FLOORS[f]; P.floor = f; } }
    P.anim += (U || D) ? dt * 8 : 0;
  } else {
    P.vx = (R ? 1 : 0) - (L ? 1 : 0);
    if (P.vx) P.facing = P.vx;
    P.x += P.vx * TUNE.walk * dt; P.anim += P.vx ? dt * 10 : 0;
    const bJumped = PC.update(P, kd('jump'), dt, TUNE.jump);
    const bPreVy = P.vy;
    // land on a floor line, bump the ceiling of the floor above
    Physics.moveBody(P, dt, TUNE.grav, bunkerSurfaces());
    if (window.SFX) {
      try {
        if (bJumped) { SFX.jump(); bunStepAcc = 0; }
        else if (P.grounded && !bunWasGround && bPreVy > 120) { SFX.land(bPreVy); bunStepAcc = 0; }
        if (P.grounded && !bJumped) {
          if (P.vx) { bunStepAcc += TUNE.walk * dt; if (bunStepAcc >= 38) { bunStepAcc -= 38; SFX.step(); } }
          else bunStepAcc = 0;
        }
      } catch (e) {}
    }
    bunWasGround = !!P.grounded;
    if (P.landedOn != null) P.floor = P.landedOn;
    if (P.floor === 0) P.x = clamp(P.x, 20, W - 12); else P.x = clamp(P.x, IN_L + 8, IN_R - 8);
  }
  P.inMed = P.floor === 2 && P.x > ROOMS.med.x0 && !P.onLadder;
  if (P.cd > 0) P.cd -= dt;
  if ((kd('shoot') || mouse.down) && P.cd <= 0) shoot();
  if (P.hurt > 0) P.hurt -= dt;
}
let walkHint = '', walkHoldT = 0, walkHoldX = 0, scavGoalWas = false, scavGoalT = 0;
function scavGoalActive() {
  const g = goalSteps().find(s => !s[2]);
  return !!g && g[0] === 'scav';
}
function walkHintTick(dt) {
  scavGoalT -= dt;
  if (scavGoalT <= 0) {
    scavGoalT = 0.25;
    const a = scavGoalActive();
    if (a && !scavGoalWas && sel) { sel = null; renderDrawer(); }
    scavGoalWas = a;
  }
  if (scene !== 'bunker' || P.auto || S.player.down || P.onLadder || !kd('right')) { walkHoldT = 0; walkHoldX = P.x; walkHint = ''; return; }
  if (Math.abs(P.x - walkHoldX) > 1) { walkHoldX = P.x; walkHoldT = 0; walkHint = ''; return; }
  walkHoldT += dt;
  if (walkHoldT < 0.4) return;
  if (P.floor > 0) walkHint = 'Mara is still inside the bunker. Take the ladder up to the surface first.';
  else if (sel) { sel = null; renderDrawer(); walkHint = 'Mara was not selected. Selecting her now, hold D again.'; }
  else if (P.x >= W - 13) walkHint = 'Blocked: you are at the edge of the map.';
  else walkHint = 'Blocked: something is in Mara\'s way.';
}
// Aim assist: Mara only fires at an enemy within AIM_SNAP px (3 tiles) of the cursor. Touch with no cursor target picks the nearest enemy she faces.
const AIM_SNAP = 90, AIM_TOUCH = 420;
function aimTarget() {
  if ((scene !== 'bunker' && scene !== 'scav') || !S) return null;
  const sc = scene === 'scav', list = sc ? (scav ? scav.enemies : []) : S.enemies;
  const ok = e => e.hp > 0 && !e.hidden && ENEMIES[e.type] && (sc || ((e.floor || 0) === (P.floor || 0) && !e.climbing && !P.climbing));
  const aimY = e => e.y - ENEMIES[e.type].h * 0.55;
  let best = null, bd = AIM_SNAP;
  if (mouse.inCv) for (const e of list) { if (!ok(e)) continue; const d = Math.hypot(e.x - mouse.wx, aimY(e) - mouse.wy); if (d < bd) { bd = d; best = e; } }
  if (!best && document.body.classList.contains('touch')) { bd = AIM_TOUCH; for (const e of list) { if (!ok(e)) continue; const dx = (e.x - P.x) * P.facing; if (dx > 0 && dx < bd) { bd = dx; best = e; } } }
  return best ? { e: best, x: best.x, y: aimY(best), sc } : null;
}
function shoot() {
  const t = aimTarget(); if (!t) return;
  P.cd = 0.34;
  const sx = P.x, sy = P.y - 20, dir = Math.sign(t.x - sx) || P.facing; P.facing = dir;
  const dx = t.x - (sx + dir * 12), dy = t.y - sy, d = Math.hypot(dx, dy) || 1;
  muzzle(sx + dir * 14, sy, dir, scene === 'scav');
  fx.bullets.push({ x: sx + dir * 12, y: sy, vx: dx / d * 900, vy: dy / d * 900, life: Math.min(1.2, d / 900 + 0.12), dmg: Math.round((13 + S.player.lvl * 2) * armoryMult()), world: scene });
}
function bulletsTick(dt) {
  for (const b of fx.bullets) {
    b.x += b.vx * dt; b.y += (b.vy || 0) * dt; b.life -= dt;
    const list = b.world === 'scav' ? (scav ? scav.enemies : []) : S.enemies;
    for (const e of list) {
      const spec = ENEMIES[e.type];
      if (e.hp > 0 && !e.hidden && Math.abs(e.x - b.x) < spec.w / 2 + 4 && b.y > e.y - spec.h - 4 && b.y < e.y + 2) {
        if (b.world === 'scav') scavHit(e, b.dmg); else hitEnemy(e, b.dmg, P);
        b.life = 0; break;
      }
    }
  }
  fx.bullets = fx.bullets.filter(b => b.life > 0);
}

// Scavenging trips: a side-scrolling stretch of wasteland, rebuilt each trip.
let CARRY_LIMIT = 30;
function carriedOf() { const p = S.player; return p.carried || (p.carried = { food: 0, scrap: 0, parts: 0, elec: 0, mat: 0 }); }
function takeCarried() { const c = carriedOf(), out = { food: 0, scrap: 0, parts: 0, elec: 0, mat: 0 }; for (const k in out) { out[k] = c[k] || 0; c[k] = 0; } return out; }
function packCap() { return 30 + 12 * (S.player.packLvl || 0); }
function packCost() { const l = S.player.packLvl || 0; return l >= 4 ? null : { scrap: 30 + 20 * l, parts: 2 + 2 * l }; }
function dropOff() {
  const c = carriedOf(), got = Object.entries(c).filter(([, v]) => v > 0);
  if (!got.length) return;
  for (const e of got) { if (S.rooms.storage) e[1] = Math.ceil(e[1] * ROOM_FX.storageLoot); if (hasB('maps')) e[1] = Math.ceil(e[1] * 1.1); S.res[e[0]] += e[1]; c[e[0]] = 0; }
  { const sc = S.stats.scav || (S.stats.scav = {}); for (const [k, v] of got) sc[k] = (sc[k] || 0) + v; }
  moment('Scavenging trip: ' + got.map(([k, v]) => v + ' ' + k).join(', '));
  lamp('Unloaded: ' + got.map(([k, v]) => v + ' ' + RES.find(r => r.k === k).name.toLowerCase()).join(', ') + '.', 'good');
}
function upgradePack() {
  const cost = packCost(); if (!cost) return;
  if (S.res.scrap < cost.scrap || S.res.parts < cost.parts) { lamp('Not enough for a bigger pack: need ' + cost.scrap + ' scrap and ' + cost.parts + ' parts.', 'warn'); return; }
  S.res.scrap -= cost.scrap; S.res.parts -= cost.parts; S.player.packLvl = (S.player.packLvl || 0) + 1;
  lamp('Backpack upgraded: it now holds ' + packCap() + '.', 'good');
}
function packCount() { return scav ? Object.values(scav.pack).reduce((a, b) => a + b, 0) : 0; }
function packAdd(k, n) { const t = Math.min(n, Math.max(0, CARRY_LIMIT - packCount())); if (t > 0) scav.pack[k] += t; return t; }
function packFullNote(x, y) {
  fx.nums.push({ x, y: y - 50, t: 1.2, s: 'Pack full', scav: true, wide: true });
  const now = performance.now();
  if (!scav.fullAt || now - scav.fullAt > 4000) { scav.fullAt = now; lamp('Your pack is full (' + CARRY_LIMIT + '/' + CARRY_LIMIT + '). Head back to the hatch to unload.', 'warn'); }
}
function carryBar() {
  const n = packCount(), f = n >= CARRY_LIMIT;
  return `<span style="display:inline-block;width:80px;height:8px;border:1px solid #888;vertical-align:middle;margin-right:6px"><i style="display:block;height:100%;width:${Math.round(100 * Math.min(1, n / CARRY_LIMIT))}%;background:${f ? '#d44' : '#e0a040'}"></i></span>${n}/${CARRY_LIMIT}${f ? ' FULL' : ''}`;
}
const WASTE_SCALE = 25;
// Key areas of the wasteland by fraction of the distance from the hatch. The hatch is at the RIGHT end; the map runs left.
const WASTE_AREAS = [
  { name: 'Hatch Yard', to: 0.04, danger: 0.2, loot: 1, note: 'Quiet ground near the hatch.' },
  { name: 'Rust Flats', to: 0.20, danger: 0.6, loot: 1, note: 'Open flats, scattered wrecks.' },
  { name: 'Dead Highway', to: 0.40, danger: 1.0, loot: 1.2, note: 'Abandoned cars line the road.' },
  { name: 'Gas Marshes', to: 0.55, danger: 1.2, loot: 0.8, note: 'Toxic pockets. Find a mask.' },
  { name: 'Ruined Suburb', to: 0.72, danger: 1.4, loot: 1.5, note: 'Collapsed homes, good loot, more hostiles.' },
  { name: 'Scrapyard', to: 0.88, danger: 1.7, loot: 1.8, note: 'Heaps of scrap and parts. Heavily infested.' },
  { name: 'Radio Mast', to: 0.96, danger: 2.0, loot: 2.0, note: 'Dangerous ground under the old mast.' },
  { name: 'Far Reach', to: 1.01, danger: 2.2, loot: 2.4, note: 'The edge of the map. Best loot, worst enemies.' }
];
function areaAtDist(d, len) { const f = d / len; return WASTE_AREAS.find(a => f < a.to) || WASTE_AREAS[WASTE_AREAS.length - 1]; }
// random x in [lo,hi] (distance from hatch) weighted by an area weight ('danger' or 'loot')
function rndByArea(lo, hi, key, len) {
  const mx = Math.max(...WASTE_AREAS.map(a => a[key]));
  let x = rnd(lo, hi);
  for (let i = 0; i < 30; i++) { x = rnd(lo, hi); if (Math.random() < areaAtDist(x, len)[key] / mx) break; }
  return x;
}
// Mirror a scav level generated in distance-from-hatch space so the hatch is at the right end.
function flipScav(s) {
  const L = s.len;
  s.flip = true; s.home = L; s.seenAreas = {};
  s.plats.forEach(p => { p.x = L - p.x - p.w; });
  s.crates.forEach(c => { c.x = L - c.x; });
  s.enemies.forEach(e => { e.x = L - e.x; e.home = L - e.home; e.facing = 1; });
  if (s.wanderer) s.wanderer.x = L - s.wanderer.x;
  const hz = s.hz;
  hz.gas.forEach(q => { q.x = L - q.x - q.w; });
  hz.debris.forEach(z => { z.x = L - z.x - z.w; });
  hz.masks.forEach(m => { m.x = L - m.x; });
}
function areaTick() {
  const s = scav; if (!s || !s.flip) return;
  const a = areaAtDist(s.len - P.x, s.len);
  if (s.curArea === a) return;
  s.curArea = a;
  if (s.seenAreas[a.name]) return;
  s.seenAreas[a.name] = 1;
  if (a.name !== 'Hatch Yard') lamp(a.name + '. ' + a.note, a.danger >= 1.4 ? 'warn' : undefined);
}
function drawScavMap() {
  const s = scav; if (!s || !s.flip) return;
  const mw = 320, mx = Math.round((W - mw) / 2), my = 8, mh = 10;
  g.save();
  g.fillStyle = 'rgba(10,8,6,.7)'; g.fillRect(mx - 4, my - 4, mw + 8, mh + 26);
  let prev = 0;
  for (const a of WASTE_AREAS) {
    const to = Math.min(1, a.to);
    g.fillStyle = 'hsl(' + Math.round(45 - a.danger * 18) + ',45%,' + Math.round(34 - a.danger * 4) + '%)';
    g.fillRect(mx + (1 - to) * mw, my, (to - prev) * mw, mh);
    prev = to;
  }
  g.fillStyle = '#ffd59a'; g.fillRect(mx + mw - 2, my - 3, 3, mh + 6);
  g.fillStyle = '#fff'; g.fillRect(mx + clamp(P.x / s.len, 0, 1) * mw - 2, my - 3, 4, mh + 6);
  const a = areaAtDist(s.len - P.x, s.len);
  g.fillStyle = '#ffe0a8'; g.font = '600 11px "Chakra Petch", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.fillText(a.name + ' · ' + Math.round((s.len - P.x) / 10) + 'm from hatch', W / 2, my + mh + 13);
  g.restore();
}
function startScav(area) {
  S.stats.trips++;
  const town = area === 'town';
  const len = town ? 3000 : 3600 * WASTE_SCALE;
  const rx = (lo, hi, key) => town ? rnd(lo, hi) : rndByArea(lo, hi, key, len);
  CARRY_LIMIT = packCap();
  const plats = [], crates = [], enemies = [];
  for (let x = 500; x < len - 300; x += rnd(260, 420)) plats.push({ x, y: rnd(470, 540), w: rnd(120, 220) });
  for (let i = 0; i < (town ? 12 : 9 * WASTE_SCALE); i++) {
    const onPlat = Math.random() < 0.45 && plats.length;
    const p = onPlat ? pick(plats) : null;
    crates.push({ x: p ? p.x + rnd(16, p.w - 16) : rx(300, len - 100, 'loot'), y: p ? p.y : 620, open: false, kind: town ? pick(['shelf', 'shelf', 'till', 'locker', 'car']) : pick(['crate', 'crate', 'locker', 'car']) });
  }
  const tier = Math.min(4, day());
  for (let i = 0; i < (4 + tier) * (town ? 1 : WASTE_SCALE); i++) {
    const type = Math.random() < 0.5 ? 'hound' : (tier >= 2 && Math.random() < 0.3 ? 'raider' : 'ghoul');
    const b = ENEMIES[type];
    enemies.push({ id: uid++, type, x: rx(700, len - 150, 'danger'), y: 620, hp: b.hp, max: b.hp, cd: 0, facing: -1, anim: 0, home: 0, vy: 0 });
  }
  enemies.forEach(e => e.home = e.x);
  if (town) enemies.push({ id: uid++, type: 'ram', x: len - 450, y: 620, hp: ENEMIES.ram.hp, max: ENEMIES.ram.hp, cd: 0, facing: -1, anim: 0, home: len - 450, vy: 0, st: 'patrol', t: 0, dir: -1, hit: false, warned: false });
  const wanderer = Math.random() < 0.7 && living().length < crewCap() ? { x: rnd(1600, len - 300), y: 620, s: randomSurvivor(), talked: false } : null;
  scav = { area: town ? 'town' : 'wasteland', len, plats, crates, enemies, wanderer, pack: takeCarried(), cam: 0, ruins: Array.from({ length: town ? 40 : 400 }, () => ({ x: rnd(0, town ? len : len * 0.4 + W), w: rnd(60, 180), h: rnd(60, 260), c: rnd(0, 1) })) };
  scav.hz = makeHazards(len);
  scav.home = 0;
  if (!town) flipScav(scav);
  scene = 'scav';
  hideHint(); showHint('top');
  Object.assign(P, { x: scav.flip ? scav.home - 80 : 80, y: 620, vx: 0, vy: 0, onLadder: false, grounded: true, facing: 1 });
  lampEv('topside_exit', 'You are topside. The bunker keeps running without you: I will call if the door is in trouble. Walk back to the ' + (scav.flip ? 'right' : 'left') + ' edge to come home.' + (scav.flip ? ' The wasteland stretches far to the left: watch the map at the top of the screen.' : ''));
  if (town) lamp('The dead town. Shelves and tills hold food, materials and parts, but little electronics. Something heavy patrols the streets: jump its charge.', 'warn');
}
function endScav(keep) {
  if (keep && scav) {
    const got = Object.entries(scav.pack).filter(([, v]) => v > 0);
    
    { const cr = carriedOf(); for (const [k, v] of got) cr[k] = (cr[k] || 0) + v; }
    dropOff();
    if (scav.recruit) { const c = makeCrew(scav.recruit); c.x = 300; c.floor = 0; c.y = FLOORS[0]; S.crew.push(c); lampEv('newcomer', c.name + ' joins the bunker. Give them a job in the Crew panel.', 'good'); toast(c.name + ' arrived at the bunker', 'good'); }
    if (!got.length) lampEv('topside_return', 'Welcome back. Nothing useful this time.', 'good');
  }
  scav = null; scene = 'bunker'; hideHint();
  placePlayer('surface-right');
  if (pendingFocus) { const pf = pendingFocus; pendingFocus = null; if (S && S.crew.some(x => x.id === pf)) { focusFx = { id: pf, t: performance.now() }; try { bcamFocus(pf); } catch (_) {} } }
  fx.bullets = [];
}
const SC_GROUND = 620;
// ---- scav hazards: toxic gas pockets, falling debris, gas mask pickups
const GAS_DPS = 3, MASK_SECS = 40, DEBRIS_DMG = 10, GAS_H = 80;
function makeHazards(len) {
  const gas = [], debris = [];
  for (let x = 700; x < len - 400; x += rnd(500, 750)) gas.push({ x, w: rnd(150, 230), ph: rnd(0, 6) });
  for (let x = 900; x < len - 300; x += rnd(600, 900)) debris.push({ x, w: rnd(260, 360), next: rnd(1, 3) });
  const masks = [{ x: rnd(300, 600), taken: false }, { x: rnd(1500, 2200), taken: false }];
  for (let x = 4000; x < len - 600; x += rnd(3500, 5000)) masks.push({ x, taken: false });
  return { gas, debris, masks, drops: [], gasAcc: 0, mask: 0, inGas: false, told: {} };
}
function hazardTick(dt) {
  const hz = scav && scav.hz; if (!hz) return;
  areaTick();
  // gas
  const low = P.y > SC_GROUND - GAS_H + 10;
  hz.inGas = low && hz.gas.some(q => P.x > q.x && P.x < q.x + q.w);
  if (!hz.told.gas && hz.gas.some(q => Math.abs(q.x + q.w / 2 - P.x) < 300)) { hz.told.gas = 1; lamp('Toxic gas ahead. Jump it, go around, or find a gas mask first.', 'warn'); }
  if (hz.inGas) {
    if (hz.mask > 0) { hz.mask = Math.max(0, hz.mask - dt); if (hz.mask === 0) lamp('Your mask filter is spent. Get out of the gas.', 'warn'); }
    else {
      hz.gasAcc += GAS_DPS * dt;
      if (hz.gasAcc >= 1) { const n = Math.floor(hz.gasAcc); hz.gasAcc -= n; burst(P.x, P.y - 20, '#9d4', 3, true); hurtPlayer(n, true); if (!scav) return; }
    }
  }
  // mask pickups
  for (const m of hz.masks) if (!m.taken && Math.abs(P.x - m.x) < 22 && P.y > SC_GROUND - 50) {
    m.taken = true; hz.mask = MASK_SECS;
    if (window.SFX && SFX.pickup) SFX.pickup('mask');
    fx.nums.push({ x: m.x, y: P.y - 40, t: 1.4, s: '+gas mask', scav: true, wide: true });
    lamp('Gas mask on: ' + MASK_SECS + ' seconds of filter, only used while you are in gas.', 'good');
  }
  // debris
  const inZone = hz.debris.filter(z => P.x > z.x - 250 && P.x < z.x + z.w + 250);
  if (inZone.length && !hz.told.debris) { hz.told.debris = 1; lamp('Unstable ceiling here. Watch for red shadows on the ground and move.', 'warn'); }
  for (const z of inZone) {
    z.next -= dt;
    if (z.next <= 0) { z.next = rnd(2.2, 4.5); hz.drops.push({ x: clamp(P.x + rnd(-140, 140), z.x, z.x + z.w), t: 1.3 }); }
  }
  for (const d of hz.drops) {
    d.t -= dt;
    if (d.t <= 0) {
      burst(d.x, SC_GROUND - 6, '#8a7a66', 10, true);
      if (Math.abs(P.x - d.x) < 30 && P.y > 540) { hurtPlayer(DEBRIS_DMG); if (!scav) return; }
    }
  }
  hz.drops = hz.drops.filter(d => d.t > 0);
}
function hazardHud() {
  const hz = scav && scav.hz; if (!hz) return '';
  let s = '<span>Mask: ' + (hz.mask > 0 ? Math.ceil(hz.mask) + 's' : 'none') + '</span>';
  const gasNear = hz.gas.some(q => q.x - P.x > 0 && q.x - P.x < 260);
  if (hz.inGas) s += hz.mask > 0 ? "<span style='color:#9d6'>☣ GAS: mask filtering</span>" : "<span style='color:var(--red)'>☣ TOXIC GAS: losing health</span>";
  else if (gasNear) s += "<span style='color:#e0c040'>☣ Gas ahead</span>";
  if (hz.drops.length) s += "<span style='color:var(--red)'>⚠ FALLING DEBRIS</span>";
  else if (hz.debris.some(z => P.x > z.x - 60 && P.x < z.x + z.w + 60)) s += "<span style='color:#e0c040'>⚠ Unstable ceiling</span>";
  return s;
}
function drawHazards(ox) {
  const hz = scav.hz; if (!hz) return;
  const now = performance.now() / 1000;
  for (const q of hz.gas) {
    const x = q.x - ox; if (x > W || x + q.w < 0) continue;
    g.fillStyle = 'rgba(120,190,60,0.22)'; g.fillRect(x, SC_GROUND - GAS_H, q.w, GAS_H);
    for (let i = 0; i < 6; i++) {
      const px = x + (i + 0.5) / 6 * q.w, py = SC_GROUND - 15 - ((now * 14 + i * 17 + q.ph * 10) % 60);
      g.fillStyle = 'rgba(150,220,80,0.18)'; g.beginPath(); g.arc(px, py, 16 + (i % 3) * 5, 0, 7); g.fill();
    }
    g.fillStyle = '#c8e04a'; g.font = '600 14px "Chakra Petch"'; g.fillText('☣', x - 14, SC_GROUND - 8);
  }
  for (const m of hz.masks) if (!m.taken) {
    const x = m.x - ox; if (x < -30 || x > W + 30) continue;
    box(x - 8, SC_GROUND - 15, 16, 13, '#3a4a3a'); box(x - 5, SC_GROUND - 12, 10, 4, '#9d6');
    g.fillStyle = '#c8e04a'; g.font = '600 10px "Chakra Petch"'; g.fillText('MASK', x - 14, SC_GROUND - 20);
  }
  for (const d of hz.drops) {
    const x = d.x - ox, a = clamp(1 - d.t / 1.3, 0, 1);
    g.fillStyle = 'rgba(220,50,40,' + (0.25 + 0.5 * a) + ')'; g.beginPath(); g.ellipse(x, SC_GROUND + 3, 12 + 18 * a, 4, 0, 0, 7); g.fill();
    if (d.t < 0.35) { const y = -20 + (SC_GROUND - 10 + 20) * (1 - d.t / 0.35); box(x - 9, y - 9, 18, 18, '#7a6a58'); }
  }
}
// ---- debug tuning for controller constants (toggle with ` ; dev only: localhost or ?dev) ----
const TUNE_DEF = { walk: 175, jump: 470, scavWalk: 185, scavJump: 560, grav: 1500, ladder: 170 };
const TUNE_RANGE = { walk: [60, 400, 5], jump: [200, 900, 10], scavWalk: [60, 400, 5], scavJump: [200, 900, 10], grav: [600, 3000, 50], ladder: [60, 400, 5] };
const TUNE_LABEL = { walk: 'Bunker walk', jump: 'Bunker jump', scavWalk: 'Scav walk', scavJump: 'Scav jump', grav: 'Gravity', ladder: 'Ladder speed' };
const TUNE = Object.assign({}, TUNE_DEF);
try { const sv = JSON.parse(localStorage.getItem('ashfall_tune') || 'null'); if (sv) for (const k in TUNE_DEF) if (typeof sv[k] === 'number' && isFinite(sv[k])) TUNE[k] = sv[k]; } catch (e) {}
function tuneSave() { try { localStorage.setItem('ashfall_tune', JSON.stringify(TUNE)); } catch (e) {} }
function tuneDevOK() { return /^(localhost|127\.|\[::1\])/.test(location.hostname) || /[?&]dev\b/.test(location.search); }
function toggleTunePanel() {
  if (!tuneDevOK()) return;
  let el = document.getElementById('tunePanel');
  if (el) { el.remove(); return; }
  el = document.createElement('div'); el.id = 'tunePanel';
  el.style.cssText = 'position:fixed;top:8px;right:8px;z-index:9999;background:rgba(10,10,10,0.88);color:#ddd;font:12px monospace;padding:8px 10px;border:1px solid #666;width:230px';
  const rows = Object.keys(TUNE_DEF).map(k => { const r = TUNE_RANGE[k]; return '<div style="margin:4px 0"><label>' + TUNE_LABEL[k] + ': <b id="tv_' + k + '">' + TUNE[k] + '</b><br><input type="range" data-tk="' + k + '" min="' + r[0] + '" max="' + r[1] + '" step="' + r[2] + '" value="' + TUNE[k] + '" style="width:100%"></label></div>'; }).join('');
  el.innerHTML = '<b>Controller tuning</b> (` to close)' + rows + '<button id="tuneReset">Reset</button> <button id="tuneCopy">Copy JSON</button>';
  document.body.appendChild(el);
  el.addEventListener('input', ev => {
    const k = ev.target.dataset && ev.target.dataset.tk; if (!k) return;
    TUNE[k] = +ev.target.value; document.getElementById('tv_' + k).textContent = TUNE[k]; tuneSave();
  });
  el.addEventListener('click', ev => {
    ev.stopPropagation();
    if (ev.target.id === 'tuneReset') { Object.assign(TUNE, TUNE_DEF); tuneSave(); el.remove(); toggleTunePanel(); }
    if (ev.target.id === 'tuneCopy') { const t = JSON.stringify(TUNE); if (navigator.clipboard) navigator.clipboard.writeText(t).catch(() => {}); }
  });
  el.addEventListener('mousedown', ev => ev.stopPropagation());
}
let scavWasGround = true, scavStepAcc = 0, scavLadY = null, bunWasGround = true, bunStepAcc = 0;
let scavLadY2 = 0, scavRg = 0;
function scavPlayerTick(dt) {
  const L = kd('left'), R = kd('right');
  const lads = scav.ladders || [];
  PC.lastJumpSpeed = TUNE.scavJump;
  if (lads.length && PC.climb(P, { up: kd('up'), down: kd('down'), left: L, right: R, jump: kd('jump') }, dt, lads, TUNE.ladder)) {
    P.vx = 0; P.anim += (kd('up') || kd('down')) ? dt * 8 : 0;
    if (window.SFX && SFX.rung) { if (scavLadY !== null) { scavLadY2 = Math.abs(P.y - scavLadY); if (scavLadY2 > 0) { scavRg += scavLadY2; if (scavRg >= 14) { scavRg = 0; try { SFX.rung(false); } catch (e) {} } } } scavLadY = P.y; }
    scavWasGround = true; scavStepAcc = 0;
  } else {
    scavLadY = null; scavRg = 0;
    P.vx = (R ? 1 : 0) - (L ? 1 : 0); if (P.vx) P.facing = P.vx;
    P.x = clamp(P.x + P.vx * TUNE.scavWalk * dt, 10, scav.len - 10); P.anim += P.vx ? dt * 10 : 0;
    const jumped = PC.update(P, kd('jump') || kd('up'), dt, TUNE.scavJump);
    const preVy = P.vy;
    Physics.moveBody(P, dt, TUNE.grav, scavSurfaces());
    if (window.SFX) {
      if (jumped) { try { SFX.jump && SFX.jump(); } catch (e) {} scavStepAcc = 0; }
      else if (P.grounded && !scavWasGround && preVy > 120) { try { SFX.land && SFX.land(preVy); } catch (e) {} scavStepAcc = 0; }
      if (P.grounded && !jumped) {
        if (P.vx) { scavStepAcc += TUNE.scavWalk * dt; if (scavStepAcc >= 38) { scavStepAcc -= 38; try { SFX.step && SFX.step(); } catch (e) {} } }
        else scavStepAcc = 0;
      }
    }
    scavWasGround = !!P.grounded;
  }
  if (P.cd > 0) P.cd -= dt;
  if ((kd('shoot') || mouse.down) && P.cd <= 0) shoot();
  if (P.hurt > 0) P.hurt -= dt;
  scav.cam = clamp(P.x - W / 2, 0, scav.len - W);
  // enemies chase when close
  for (const e of scav.enemies) {
    if (e.hp <= 0) continue;
    const b = ENEMIES[e.type]; e.anim += dt * 8; if (e.cd > 0) e.cd -= dt;
    if (e.type === 'ram') { ramTick(e, dt, b); if (!scav) return; continue; }
    const d = P.x - e.x, near = Math.abs(d) < 420;
    const tx = near ? P.x - Math.sign(d) * (b.ranged ? 170 : 18) : e.home + Math.sin(performance.now() / 1500 + e.id) * 120;
    const md = tx - e.x; if (Math.abs(md) > 3) { e.x += Math.sign(md) * Math.min(Math.abs(md), b.spd * (near ? 1.15 : 0.5) * dt); }
    e.facing = Math.sign(d) || 1;
    const reach = b.ranged ? 230 : 26;
    if (near && Math.abs(d) < reach && Math.abs(P.y - e.y) < 60 && e.cd <= 0) {
      e.cd = b.rate;
      if (b.ranged) { tracer(e.x, e.y - 22, P.x, P.y - 18, '#ff7a5a', true); if (Math.random() < 0.55) hurtPlayer(b.dmg); }
      else hurtPlayer(b.dmg);
    }
  }
  if (!scav) return;
  scav.enemies = scav.enemies.filter(e => e.hp > 0);
  hazardTick(dt);
}
// Pike's ram rig: patrols, winds up when it sees you on the ground, charges, then stalls. Jump to dodge.
function ramTick(e, dt, b) {
  const d = P.x - e.x, ad = Math.abs(d);
  e.t -= dt;
  if (e.st === 'patrol') {
    e.facing = e.dir; e.x += e.dir * b.spd * dt;
    if (e.x < 450) e.dir = 1;
    if (e.x > scav.len - 120) e.dir = -1;
    if (ad < 520 && P.y > e.y - 40 && !S.player.down) {
      e.st = 'wind'; e.t = 0.9; e.facing = Math.sign(d) || 1;
      if (!e.warned) { e.warned = true; lamp("Pike's ram rig has spotted you. Jump the charge, shoot it while it stalls.", 'warn'); }
    }
  } else if (e.st === 'wind') {
    e.facing = Math.sign(d) || e.facing;
    if (e.t <= 0) { e.st = 'charge'; e.t = 1.3; e.dir = e.facing; e.hit = false; }
  } else if (e.st === 'charge') {
    e.x += e.dir * 230 * dt;
    if (!e.hit && Math.abs(P.x - e.x) < 44 && P.y > e.y - 38 && !S.player.down) {
      e.hit = true; P.x = clamp(P.x + e.dir * 60, 10, scav.len - 10);
      hurtPlayer(b.dmg); if (!scav) return;
    }
    if (e.t <= 0 || e.x < 450 || e.x > scav.len - 60) { e.x = clamp(e.x, 450, scav.len - 60); e.st = 'stun'; e.t = 1.6; }
  } else if (e.t <= 0) { e.st = 'patrol'; e.dir = e.facing || -1; }
}
function scavHit(e, dmg) {
  if (e.type === 'ram' && e.hp > 0 && e.hp - dmg <= 0) { packAdd('parts', 4); packAdd('scrap', 6); lamp("Pike's ram rig is wrecked. You salvage what you can carry.", 'good'); }
  e.hp -= dmg; fx.nums.push({ x: e.x, y: e.y - ENEMIES[e.type].h - 6, t: 0.7, s: Math.round(dmg), scav: true });
  burst(e.x, e.y - 12, '#7a2', 3, true);
  if (e.hp > 0 && window.SFX && SFX.enemyHit) SFX.enemyHit(false, undefined);
  if (e.hp <= 0) { S.stats.kills++; S.player.xp += ENEMIES[e.type].xp; if (Math.random() < 0.5) { const got = packAdd('scrap', 2); if (got === 0) packFullNote(e.x, e.y - 20); else lootPop(e.x, e.y - 20, [['+' + got + ' scrap', 'scrap']]); } burst(e.x, e.y - 10, '#5a3', 10, true); if (window.SFX && SFX.death) SFX.death(e.type === 'cinder' || e.type === 'maw' || e.type === 'ram' ? 'big' : ''); }
}
function openCrate(c) {
  if (packCount() >= CARRY_LIMIT) { packFullNote(c.x, c.y); return; }
  c.open = true;
  const roll = () => {
    const g = { food: 0, scrap: 0, parts: 0, elec: 0, mat: 0 };
    g.scrap += Math.floor(rnd(2, 8)); if (Math.random() < 0.55) g.parts += Math.floor(rnd(1, 4));
    if (Math.random() < (c.kind === 'car' ? 0.75 : 0.4)) g.elec += Math.floor(rnd(1, c.kind === 'car' ? 4 : 3));
    if (Math.random() < 0.5) g.mat += Math.floor(rnd(2, 6)); if (Math.random() < (c.kind === 'locker' ? 0.7 : 0.4)) g.food += Math.floor(rnd(2, 7));
    if (scav.area === 'town') {
      g.elec = Math.random() < 0.15 ? 1 : 0;
      if (c.kind === 'shelf') { g.food += Math.floor(rnd(3, 8)); g.mat += Math.floor(rnd(1, 4)); }
      else if (c.kind === 'till') { g.scrap += Math.floor(rnd(4, 9)); g.parts += Math.floor(rnd(1, 3)); }
      else if (Math.random() < 0.5) g.food += Math.floor(rnd(1, 4));
    }
    return g;
  };
  const g = c.loot || roll(), txt = [], left = {}, items = []; c.loot = null;
  for (const k in g) if (g[k]) { const t = packAdd(k, g[k]); if (t < g[k]) left[k] = g[k] - t; if (t) { const nm = '+' + t + ' ' + RES.find(r => r.k === k).name.toLowerCase(); txt.push(nm); items.push([nm, k]); } }
  if (items.length) lootPop(c.x, c.y - 30, items); else fx.nums.push({ x: c.x, y: c.y - 30, t: 1.4, s: 'empty', scav: true, wide: true, still: prefs.rm });
  if (txt.length && window.SFX && SFX.pickup) SFX.pickup();
  if (Object.keys(left).length) { c.open = false; c.loot = left; packFullNote(c.x, c.y); }
}

// ---------------------------------------------------------------- 5. drawing
const cv = $('#c'), g = cv.getContext('2d');
let CANVAS_TS = 1;
(function () {
  const fd = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'font');
  if (!fd || !fd.set) return;
  let raw = g.font;
  Object.defineProperty(g, 'font', {
    configurable: true,
    get() { return raw; },
    set(v) {
      raw = v;
      const s = CANVAS_TS === 1 ? String(v) : String(v).replace(/(\d+(?:\.\d+)?)px/, (m, n) => (parseFloat(n) * CANVAS_TS).toFixed(1) + 'px');
      fd.set.call(g, s);
    }
  });
})();
const rock = Array.from({ length: 260 }, () => ({ x: rnd(0, W), y: rnd(216, H), r: rnd(1, 3.5), a: rnd(0.05, 0.18) }));
const stars = Array.from({ length: 90 }, () => ({ x: rnd(0, W), y: rnd(0, 180), r: rnd(0.5, 1.6) }));
function skyColors() {
  const h = hourF();
  const dayAmt = clamp(Math.min((h - 5) / 2, (21 - h) / 2), 0, 1);
  const top = mix([12, 10, 22], [150, 118, 84], dayAmt), bot = mix([28, 18, 20], [214, 160, 104], dayAmt);
  return { top, bot, dayAmt };
}
function mix(a, b, t) { return 'rgb(' + a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',') + ')'; }
// ---- accessibility prefs (colorblind, reduced motion), saved in localStorage
const PREF_KEY = 'ab_access';
const prefs = (() => {
  let p = {};
  try { p = JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {}; } catch (e) { p = {}; }
  let osRm = false; try { osRm = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) {}
  let osHc = false; try { osHc = !!(window.matchMedia && matchMedia('(prefers-contrast: more)').matches); } catch (e) {}
  return { cb: !!p.cb, hc: typeof p.hc === 'boolean' ? p.hc : osHc, rm: typeof p.rm === 'boolean' ? p.rm : osRm, ta: !!p.ta, nl: p.nl !== false, le: !!p.le, sr: p.sr !== false, fx: (typeof p.fx === 'number' && p.fx >= 0 && p.fx <= 1) ? p.fx : 1, ps: !!p.ps };
})();
let shakeT = 0;
let heartT = 0;
// Heartbeat while the hatch is under 25% or the player is under 30% HP. Faster as it gets worse. Silent under reduced motion.
function heartbeatTick(dt) {
  if (!S || S.over || scene !== 'bunker' || prefs.rm || !window.SFX || !SFX.heartbeat) { heartT = 0; return; }
  const dk = S.door && S.door.max ? S.door.hp / S.door.max : 1;
  const pl = S.player, pk = pl && pl.maxHp && !pl.down ? pl.hp / pl.maxHp : 1;
  const doorLow = S.door && S.door.hp > 0 && dk < 0.25;
  const plLow = pl && !pl.down && pl.hp > 0 && pk < 0.3;
  if (!doorLow && !plLow) { heartT = 0; return; }
  const sev = Math.max(doorLow ? 1 - dk / 0.25 : 0, plLow ? 1 - pk / 0.3 : 0);
  heartT -= dt;
  if (heartT <= 0) { heartT = 1.1 - 0.5 * sev; SFX.heartbeat(0.4 + 0.6 * sev); }
}
let hurtVig = 0; // player-hit edge flash, seconds remaining (0..0.45)
let doorVigAt = -9999, doorVigK = 0; // door hit/breach red edge vignette: start time (performance.now) and strength 0..1
function doorVigKick(k) { const now = performance.now(); doorVigK = Math.max(k, (now - doorVigAt < 500) ? doorVigK : 0); doorVigAt = now; }
// Red edge vignette for door hits and breaches (bunker view only). Reduced motion: dimmer, slower smooth fade. Low effects: weaker.
function drawDoorHitVignette() {
  if (scene === 'scav' || !(doorVigK > 0)) return;
  const dur = prefs.rm ? 800 : 450, age = performance.now() - doorVigAt;
  if (age < 0 || age >= dur) return;
  const fxMul = prefs.le ? 0.4 : 1;
  const t = 1 - age / dur;
  let a = (prefs.rm ? 0.2 : 0.45) * fxMul * doorVigK * t * t * prefs.fx;
  if (prefs.ps) a = Math.min(a, 0.18);
  if (a < 0.005) return;
  const w = cv.width, h = cv.height;
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  const rg = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.hypot(w, h) / 2);
  rg.addColorStop(0, 'rgba(170,12,8,0)');
  rg.addColorStop(1, 'rgba(170,12,8,' + a.toFixed(3) + ')');
  g.fillStyle = rg; g.fillRect(0, 0, w, h);
  g.restore();
}
function addShake(s) { if (!prefs.rm && !prefs.ps && prefs.fx > 0) shakeT = Math.max(shakeT, s * prefs.fx); }
// Brief full-screen flash for breaches and large attack arrivals (bunker view). Skipped under reduced motion / photosensitive mode.
let scrFlashAt = -9999, scrFlashK = 0, scrFlashCol = '255,150,90';
function screenFlash(k, col) { if (prefs.rm || prefs.ps || !(prefs.fx > 0)) return; scrFlashAt = performance.now(); scrFlashK = k; scrFlashCol = col || '255,150,90'; }
function drawScreenFlash() {
  if (scene === 'scav' || prefs.rm || prefs.ps || !(scrFlashK > 0)) return;
  const dur = 260, age = performance.now() - scrFlashAt;
  if (age < 0 || age >= dur) return;
  const t = 1 - age / dur;
  const a = Math.min(0.4, 0.4 * scrFlashK * t * t * prefs.fx * (prefs.le ? 0.5 : 1));
  if (a < 0.01) return;
  g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = 'rgba(' + scrFlashCol + ',' + a.toFixed(3) + ')'; g.fillRect(0, 0, cv.width, cv.height);
  g.restore();
}
function applyPrefs() {
  document.body.classList.toggle('cb', prefs.cb);
  document.body.classList.toggle('rm', prefs.rm);
  document.body.classList.toggle('hc', prefs.hc);
  const h = document.getElementById('tHc');
  if (h) { h.firstChild.nodeValue = 'High contrast: ' + (prefs.hc ? 'on' : 'off'); h.setAttribute('aria-pressed', prefs.hc ? 'true' : 'false'); }
  const a = document.getElementById('tCb'), b = document.getElementById('tRm');
  if (a) { a.firstChild.nodeValue = 'Colorblind: ' + (prefs.cb ? 'on' : 'off'); a.setAttribute('aria-pressed', prefs.cb ? 'true' : 'false'); }
  if (b) { b.firstChild.nodeValue = 'Reduced motion: ' + (prefs.rm ? 'on' : 'off'); b.setAttribute('aria-pressed', prefs.rm ? 'true' : 'false'); }
  if (prefs.rm) { shakeT = 0; hurtVig = Math.min(hurtVig, 0.25); }
  const rmBox2 = document.getElementById('sRm');
  if (rmBox2) rmBox2.checked = !!prefs.rm;
  const nlb = document.getElementById('tNl');
  if (nlb) { nlb.firstChild.nodeValue = 'Night lighting: ' + (prefs.nl ? 'on' : 'off'); nlb.setAttribute('aria-pressed', prefs.nl ? 'true' : 'false'); }
  const leb = document.getElementById('tLe');
  if (leb) { leb.firstChild.nodeValue = 'Low effects: ' + (prefs.le ? 'on' : 'off'); leb.setAttribute('aria-pressed', prefs.le ? 'true' : 'false'); }
  const srb = document.getElementById('tSr');
  if (srb) { srb.firstChild.nodeValue = 'Screen reader: ' + (prefs.sr ? 'on' : 'off'); srb.setAttribute('aria-pressed', prefs.sr ? 'true' : 'false'); }
  const t = document.getElementById('tTa');
  if (t) { t.firstChild.nodeValue = 'Touch aim: ' + (prefs.ta ? 'on' : 'off'); t.setAttribute('aria-pressed', prefs.ta ? 'true' : 'false'); }
  cv.style.touchAction = prefs.ta ? 'none' : '';
  document.querySelectorAll('button[data-pref]').forEach(btn => {
    const k = btn.dataset.pref, on = !!prefs[k];
    btn.textContent = (k === 'hc' ? 'High contrast: ' : 'Colorblind: ') + (on ? 'on' : 'off');
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}
function savePrefs() { try { localStorage.setItem(PREF_KEY, JSON.stringify({ cb: prefs.cb, hc: prefs.hc, rm: prefs.rm, ta: prefs.ta, nl: prefs.nl, le: prefs.le, sr: prefs.sr, fx: prefs.fx, ps: prefs.ps })); } catch (e) {} applyPrefs(); if (typeof renderHud === 'function') { renderHud(); renderDrawer(); } }
{ const a = document.getElementById('tCb'), b = document.getElementById('tRm');
  const prefLamp = (name, on) => { try { lamp(name + ' mode ' + (on ? 'on' : 'off')); } catch (err) {} };
  if (a) a.onclick = e => { prefs.cb = !prefs.cb; savePrefs(); prefLamp('Colorblind', prefs.cb); e.currentTarget.blur(); };
  if (b) b.onclick = e => { prefs.rm = !prefs.rm; savePrefs(); prefLamp('Reduced motion', prefs.rm); e.currentTarget.blur(); };
  const tab = document.getElementById('tTa');
  if (tab) tab.onclick = e => { prefs.ta = !prefs.ta; savePrefs(); prefLamp('Touch aim', prefs.ta); e.currentTarget.blur(); };
  const srt = document.getElementById('tSr');
  if (srt) srt.onclick = e => { prefs.sr = !prefs.sr; savePrefs(); srSay('Screen reader announcements ' + (prefs.sr ? 'on' : 'off'), '', true); e.currentTarget.blur(); };
  const nlt = document.getElementById('tNl');
  if (nlt) nlt.onclick = e => { prefs.nl = !prefs.nl; savePrefs(); prefLamp('Night lighting', prefs.nl); e.currentTarget.blur(); };
  const leb2 = document.getElementById('tLe');
  if (leb2) leb2.onclick = e => { prefs.le = !prefs.le; savePrefs(); prefLamp('Low effects', prefs.le); e.currentTarget.blur(); };
  const hcb = document.getElementById('tHc');
  if (hcb) hcb.onclick = e => { prefs.hc = !prefs.hc; savePrefs(); prefLamp('High contrast', prefs.hc); try { srSay('High contrast mode ' + (prefs.hc ? 'on' : 'off'), '', true); } catch (err) {} e.currentTarget.blur(); };
  // Follow live OS reduced-motion changes until the player has chosen a value themselves
  try {
    const mq = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)');
    if (mq && mq.addEventListener) mq.addEventListener('change', ev => {
      let saved = {}; try { saved = JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {}; } catch (e2) {}
      if (typeof saved.rm === 'boolean') return;
      prefs.rm = !!ev.matches; applyPrefs();
    });
  } catch (e) {}
  applyPrefs(); }
function draw() {
  g.save();
  if (shakeT > 0 && !prefs.rm) { const amp = Math.min(1, shakeT / 0.4) * 6; g.translate((Math.random() - 0.5) * 2 * amp, (Math.random() - 0.5) * 2 * amp); }
  if (scene === 'scav' && scav) drawScav(); else drawBunker();
  g.restore();
  drawNightLight();
  drawMinimap();
  drawDuskGlow();
  drawDoorVignette();
  drawDoorHitVignette();
  drawLossVignette();
  drawHurtVignette();
}
// Dusk warning gradient: warm red-orange glow building from ~17:00, peaking ~20:00, gone by ~21:30 (weaker dawn glow 4:30-6:30).
// Honors the Night lighting toggle (prefs.nl). Reduced motion / Low effects: steady, no pulse. Topside gets a ground-up glow, bunker a sky-down one.
function drawDuskGlow() {
  if (prefs.rm || !prefs.nl || typeof S === 'undefined' || !S) return;
  const h = hourF();
  const ramp = (x, a, b) => clamp((x - a) / (b - a), 0, 1);
  const dusk = Math.min(ramp(h, 17, 20), 1 - ramp(h, 20, 21.5));
  const dawn = 0.5 * Math.min(ramp(h, 4.5, 5.5), 1 - ramp(h, 5.5, 6.5));
  let k = Math.max(dusk, dawn);
  if (k < 0.01) return;
  if (!prefs.rm && !prefs.le && dusk > 0.01) k *= 0.9 + 0.1 * Math.sin(performance.now() / 1000 * 1.2);
  const top = scene === 'scav' && scav;
  const w = cv.width, hh = cv.height;
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  const gr = top ? g.createLinearGradient(0, hh, 0, 0) : g.createLinearGradient(0, 0, 0, hh * 0.45);
  const a = k * (top ? 0.30 : 0.26);
  gr.addColorStop(0, 'rgba(255,90,40,' + a.toFixed(3) + ')');
  gr.addColorStop(top ? 0.6 : 1, 'rgba(160,40,40,' + (a * 0.45).toFixed(3) + ')');
  gr.addColorStop(1, 'rgba(160,40,40,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, w, top ? hh : hh * 0.45);
  g.restore();
}
// Subtle night tint over the whole view, driven by the clock (hourF via skyColors). Static, so safe for reduced motion.
// Time-of-day tint: warm red at dusk/dawn, deepening to dark blue-black at full night. Returns null by day or when dim effects are off.
function todTint(strength) {
  if (prefs.rm || !prefs.nl || typeof S === 'undefined' || !S) return null;
  const day = skyColors().dayAmt, night = 1 - day;
  if (night < 0.01) return null;
  const dusk = 1 - Math.abs(2 * day - 1); // peaks mid-transition
  const c = [140, 40, 18].map((v, i) => v + ([14, 8, 34][i] - v) * Math.pow(day < 0.5 ? 1 - day * 2 : 1, 1) * 0 + 0);
  const k = clamp((night - 0.5) * 2, 0, 1); // 0 at dusk, 1 at deep night
  const rgb = [140, 40, 18].map((v, i) => Math.round(v + ([14, 8, 34][i] - v) * k));
  const a = Math.max(night * strength, dusk * strength * 0.9);
  return { rgb: rgb.join(','), a, night, dusk };
}
function drawNightLight() {
  const tt = todTint(scene === 'scav' && scav ? 0.30 : 0.14);
  if (!tt) return;
  const a = tt.a;
  const w = cv.width, h = cv.height;
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = 'rgba(' + tt.rgb + ',' + (a * 0.6).toFixed(3) + ')';
  g.fillRect(0, 0, w, h);
  const rg = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.hypot(w, h) / 2);
  rg.addColorStop(0, 'rgba(' + tt.rgb + ',0)');
  rg.addColorStop(1, 'rgba(' + tt.rgb + ',' + (a * 0.8).toFixed(3) + ')');
  g.fillStyle = rg; g.fillRect(0, 0, w, h);
  g.restore();
}
// Red screen-edge flash when the player is hit. Reduced motion: dimmer and shorter, smooth fade, no sudden flash.
function drawHurtVignette() {
  if (prefs.rm || !(hurtVig > 0)) return;
  const k = Math.min(1, hurtVig / 0.45);
  let a = (prefs.rm ? 0.22 : 0.5) * k * k * prefs.fx;
  if (prefs.ps) a = Math.min(a, 0.18);
  if (a < 0.005) return;
  const w = cv.width, h = cv.height;
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  const rg = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.hypot(w, h) / 2);
  rg.addColorStop(0, 'rgba(180,10,10,0)');
  rg.addColorStop(1, 'rgba(180,10,10,' + a.toFixed(3) + ')');
  g.fillStyle = rg; g.fillRect(0, 0, w, h);
  g.restore();
}
// Red screen-edge warning when the door is below 25% HP. Pulses unless Reduced motion is on.
function drawDoorVignette() {
  if (prefs.rm || typeof S === 'undefined' || !S || !S.door || S.over || !(S.door.max > 0)) return;
  const frac = S.door.hp / S.door.max;
  if (!(frac < 0.25)) return;
  const sev = 1 - Math.max(0, frac) / 0.25;             // 0 at 25% HP .. 1 at 0 HP
  let a = (0.28 + 0.22 * sev) * prefs.fx;
  if (prefs.ps) a = Math.min(a, 0.18);
  if (a < 0.005) return;
  if (!prefs.rm && !prefs.ps) {
    const hz = 1 + sev * 1.2;                            // faster pulse as the door gets worse
    a *= 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(performance.now() / 1000 * hz * Math.PI * 2));
  }
  const w = cv.width, h = cv.height;
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  const rg = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.38, w / 2, h / 2, Math.hypot(w, h) / 2);
  rg.addColorStop(0, 'rgba(200,20,20,0)');
  rg.addColorStop(1, 'rgba(200,20,20,' + a.toFixed(3) + ')');
  g.fillStyle = rg; g.fillRect(0, 0, w, h);
  g.restore();
}
// Floating resource popups: render-only, derived from per-frame diffs of the stock (nothing saved or synced).
const POPUP_RES = [
  { k: 'food', name: 'Food', color: '#7ddc6f', min: 1, get: s => s.res.food },
  { k: 'scrap', name: 'Scrap', color: '#c9a27a', min: 1, get: s => s.res.scrap },
  { k: 'power', name: 'Power', color: '#7fc8ff', min: 2, get: s => s.batt || 0 },
];
const resPop = { s: null, last: null, acc: {}, t0: 0, list: [] };
function resPopUpdate(now) {
  if (prefs.rm || !S) { resPop.list.length = 0; resPop.s = null; return; }
  if (resPop.s !== S) { resPop.s = S; resPop.last = null; resPop.acc = {}; resPop.t0 = now; resPop.list.length = 0; }
  const cur = {};
  for (const r of POPUP_RES) cur[r.k] = +r.get(S) || 0;
  if (resPop.last) for (const r of POPUP_RES) resPop.acc[r.k] = (resPop.acc[r.k] || 0) + cur[r.k] - resPop.last[r.k];
  resPop.last = cur;
  if (now - resPop.t0 >= 1200) {
    POPUP_RES.forEach((r, i) => {
      const d = resPop.acc[r.k] || 0;
      if (Math.abs(d) >= r.min && resPop.list.length < 12) resPop.list.push({ i, d: Math.round(d), c: r.color, name: r.name, t: now });
      resPop.acc[r.k] = 0;
    });
    resPop.t0 = now;
  }
  resPop.list = resPop.list.filter(p => now - p.t < 1600);
}
function drawResPopups(now) {
  if (prefs.rm || !resPop.list.length) return;
  g.save();
  g.font = '700 13px "IBM Plex Sans"';
  g.lineWidth = 3; g.strokeStyle = 'rgba(10,6,4,.85)';
  for (const p of resPop.list) {
    const u = (now - p.t) / 1600, txt = (p.d > 0 ? '+' : '\u2212') + Math.abs(p.d) + ' ' + p.name;
    const x = LADDER_X + 40 + p.i * 80 - g.measureText(txt).width / 2, y = FLOORS[0] - 40 - u * 40;
    g.globalAlpha = Math.max(0, Math.min(1, (1 - u) * 1.6));
    g.strokeText(txt, x, y);
    g.fillStyle = p.d > 0 ? '#8fe67f' : '#ff7a6e';
    g.fillText(txt, x, y);
  }
  g.restore();
}
function drawBunker() {
  bcamBegin();
  const sky = skyColors();
  let gr = g.createLinearGradient(0, 0, 0, FLOORS[0]); gr.addColorStop(0, sky.top); gr.addColorStop(1, sky.bot);
  g.fillStyle = gr; g.fillRect(0, 0, W, FLOORS[0]);
  if (sky.dayAmt < 0.6) { g.fillStyle = 'rgba(255,240,220,' + (0.6 - sky.dayAmt) + ')'; for (const s of stars) { g.beginPath(); g.arc(s.x, s.y, s.r, 0, 7); g.fill(); } }
  // distant ruins
  g.fillStyle = 'rgba(40,28,22,.55)';
  for (let i = 0; i < 14; i++) { const x = i * 97 + 600, h = 30 + ((i * 53) % 70); if (x < W) g.fillRect(x, FLOORS[0] - h, 46, h); }
  { const tt = todTint(0.5); if (tt) { g.fillStyle = 'rgba(' + tt.rgb + ',' + tt.a.toFixed(3) + ')'; g.fillRect(0, 0, W, FLOORS[0]); } }
  // ground and underground
  g.fillStyle = '#4b3a2a'; g.fillRect(0, FLOORS[0], W, 16); tex('soil', 0, FLOORS[0], W, 16, 1.2);
  g.fillStyle = '#1a130d'; g.fillRect(0, FLOORS[0] + 16, W, WH); tex('soil', 0, FLOORS[0] + 16, W, WH, 0.8);
  for (const r of rock) { g.fillStyle = 'rgba(120,90,60,' + r.a + ')'; g.fillRect(r.x, r.y, r.r * 2, r.r); }
  // rooms
  lampTick();
  for (const [k, r] of Object.entries(ROOMS)) if (!r.build) drawRoom(k, r);
  drawBunkerDust();
  drawBunkerPower();
  // shaft
  g.fillStyle = '#0e0a07'; g.fillRect(LADDER_X - 18, FLOORS[0], 36, FLOORS[3] - FLOORS[0] + 4);
  g.strokeStyle = '#6b5a40'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(LADDER_X - 10, FLOORS[0]); g.lineTo(LADDER_X - 10, FLOORS[3]); g.moveTo(LADDER_X + 10, FLOORS[0]); g.lineTo(LADDER_X + 10, FLOORS[3]); g.stroke();
  for (let y = FLOORS[0] + 10; y < FLOORS[3]; y += 16) { g.beginPath(); g.moveTo(LADDER_X - 10, y); g.lineTo(LADDER_X + 10, y); g.stroke(); }
  // floor slabs
  g.fillStyle = '#3a2d1f';
  for (let f = 1; f < 4; f++) { g.fillRect(IN_L - 6, FLOORS[f], IN_R - IN_L + 12, 10); tex('tread', IN_L - 6, FLOORS[f], IN_R - IN_L + 12, 10, 1.4); }
  g.fillRect(IN_L - 14, FLOORS[0] + 16, 10, FLOORS[3] - FLOORS[0]); g.fillRect(IN_R + 4, FLOORS[0] + 16, 10, FLOORS[3] - FLOORS[0]);
  drawBunkerLadders();
  drawDig();
  drawBuildGrid();
  drawPlaceGhost();
  drawSurface(sky);
  // night over the surface only: the bunker keeps its lamps
  if (sky.dayAmt < 1) { g.fillStyle = 'rgba(5,6,18,' + (0.55 * (1 - sky.dayAmt)) + ')'; g.fillRect(0, 0, W, FLOORS[0] + 16); }
  drawDrops();
  for (const c of S.crew) if (c.alive && !c.exp) drawPerson(c.x, c.y, c.color, c.accent, c, c.anim, c.facing, c.state === 'sleep', c.climbing);
  for (const c of S.crew) if (c.alive && !c.exp && !c.left) drawTaskIcon(c);
  drawFocus();
  drawCrewDebug();
  for (const w of S.waiting || []) drawPerson(w.x, w.y, w.color, w.accent, w, w.anim, -1, false, false);
  for (const e of S.enemies) drawEnemy(e);
  if (!S.player.down) drawMara();
  drawPowerLight();
  drawFx(0);
  { const now = performance.now(); resPopUpdate(now); drawResPopups(now); }
  drawTipHighlight();
  bcamEnd();
  drawInfoTip();
  drawRaidForecast();
  drawMinimap();
  drawDigHint();
  drawPlaceHint();
  if (S.breached && prefs.cb) { g.save(); g.strokeStyle = '#fff'; g.lineWidth = 6; g.setLineDash([22, 14]); g.strokeRect(3, 3, W - 6, H - 6); g.restore(); }
  if (S.breached) { g.fillStyle = 'rgba(255,40,30,' + (prefs.rm ? 0.09 : 0.06 + 0.05 * Math.sin(performance.now() / 150)) + ')'; g.fillRect(0, 0, W, H); }
  drawScreenFlash();
}
// Low-power dimming + flickering emergency lamps. Underground only; time-based so nothing to save or sync.
// Honors Night lighting (dim effects), and skips flicker under Reduced motion / Low effects (static dim instead).
let pwrK = 0;
function drawPowerLight() {
  const out = !!(S.rooms && S.rooms.generator && !S.powered);
  pwrK += ((out && prefs.nl ? 1 : 0) - pwrK) * 0.05;
  if (pwrK < 0.01) return;
  const calm = prefs.rm || prefs.le, t = performance.now();
  let a = 0.34;
  if (!calm) {
    // ~6Hz slots, small amplitude, with occasional deeper dips
    const n = Math.floor(t / 160), r1 = Math.abs(Math.sin(n * 12.9898) * 43758.5) % 1, r2 = Math.abs(Math.sin(Math.floor(t / 2200) * 78.233) * 12345.6) % 1;
    a += (r1 - 0.5) * 0.10 + (r2 > 0.7 && r1 > 0.6 ? 0.08 : 0);
  }
  const x0 = IN_L - 14, x1 = IN_R + 14, y0 = FLOORS[0] + 16, y1 = FLOORS[3] + 10;
  g.save();
  g.fillStyle = 'rgba(4,3,8,' + (a * pwrK).toFixed(3) + ')';
  g.fillRect(x0, y0, x1 - x0, y1 - y0);
  const pulse = calm ? 0.5 : 0.5 + 0.5 * Math.sin(t / 1000 * 4.4);
  for (const r of Object.values(ROOMS)) {
    if (r.build) continue;
    const cy = FLOORS[r.floor - 1] + (r.floor === 1 ? 16 : 10), cx = (r.x0 + r.x1) / 2, rad = Math.max(60, (r.x1 - r.x0) * 0.6);
    const rg = g.createRadialGradient(cx, cy + 6, 2, cx, cy + 6, rad);
    const ga = (0.10 + 0.12 * pulse) * pwrK;
    rg.addColorStop(0, 'rgba(255,50,30,' + ga.toFixed(3) + ')');
    rg.addColorStop(1, 'rgba(255,50,30,0)');
    g.fillStyle = rg; g.fillRect(r.x0, cy, r.x1 - r.x0, FLOORS[r.floor] - cy);
    g.fillStyle = 'rgba(255,90,60,' + (0.5 + 0.5 * pulse).toFixed(2) + ')';
    g.fillRect(cx - 4, cy + 2, 8, 4);
  }
  g.restore();
}
function drawRaidForecast() {
  let list = null, label = '', urgent = false;
  if (S.spawns.length) { list = S.spawns.map(s => s.type); label = 'INCOMING'; urgent = true; }
  else if (!S.enemies.length) {
    const to21 = (RAID_HOUR - hourF() + 24) % 24;
    if (to21 <= 6) { list = raidPlan(day()); const m = Math.round(to21 * 60); label = 'RAID IN ' + Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0'); urgent = to21 < 1; }
  }
  if (!list || !list.length) return;
  const tally = {};
  for (const t of list) tally[t] = (tally[t] || 0) + 1;
  const rows = Object.entries(tally);
  const txt = rows.map(([t, n]) => n + '\u00d7 ' + ENEMIES[t].name).join('  \u00b7  ');
  g.save();
  g.font = '600 13px "IBM Plex Sans"';
  const w = Math.max(g.measureText(txt).width, g.measureText(label).width) + 28, x = (W - w) / 2, y = 10;
  g.fillStyle = 'rgba(20,10,8,.82)'; g.fillRect(x, y, w, 44);
  g.strokeStyle = urgent ? '#ff5a4e' : '#c9a27a'; g.lineWidth = 2;
  if (prefs.cb) g.setLineDash([8, 5]);
  g.strokeRect(x, y, w, 44); g.setLineDash([]);
  g.fillStyle = urgent ? '#ff8a7e' : '#ffe0a8';
  g.fillText(label, W / 2 - g.measureText(label).width / 2, y + 18);
  g.fillStyle = '#e8dfd0';
  g.fillText(txt, W / 2 - g.measureText(txt).width / 2, y + 36);
  // door-side chips: one per enemy type
  rows.forEach(([t, n], i) => {
    const cx = DOOR_X + 44 + i * 44, cy = FLOORS[0] - 96;
    g.fillStyle = ENEMIES[t].color; g.fillRect(cx, cy, 14, 14);
    g.strokeStyle = '#000'; g.lineWidth = 1; g.strokeRect(cx, cy, 14, 14);
    g.fillStyle = '#ffe0a8'; g.fillText('\u00d7' + n, cx + 17, cy + 12);
  });
  if (urgent) { g.fillStyle = '#ff5a4e'; g.fillText('\u25c0', W - 30, FLOORS[0] - 30); }
  g.restore();
}
// Lamp flicker + dust. Stateless (time-based) so nothing to save or sync.
let lampK = 0;
function lampTick() {
  const target = (S.raidActive || S.alarm || (S.spawns && S.spawns.length)) ? 1 : 0;
  lampK += (target - lampK) * 0.04;
}
function lampFlick(seed) {
  const t = performance.now() / 1000;
  if (prefs.rm) return 1 - 0.06 * (0.5 + 0.5 * Math.sin(t * 1.3 + seed)) * (0.4 + lampK);
  const k = 0.2 + 0.8 * lampK;
  const n = Math.sin(t * (6 + 8 * lampK) + seed) * Math.sin(t * 3.7 + seed * 2.1) + 0.5 * Math.sin(t * (17 + 20 * lampK) + seed * 0.7);
  let f = 1 - k * 0.22 * Math.max(0, n);
  if (lampK > 0.3 && Math.sin(t * 2.3 + seed * 5) > 0.92) f *= 1 - 0.5 * lampK;
  return Math.max(0.25, Math.min(1, f));
}
function drawDustBox(x0, y0, w, h, n, seed, lit) {
  const t = performance.now() / 1000, sp = prefs.rm ? 0.25 : 1 + lampK * 1.5;
  for (let i = 0; i < n; i++) {
    const s = seed * 13.7 + i * 7.31;
    const px = x0 + (((Math.sin(s) * 0.5 + 0.5) * w + t * sp * (4 + (i % 5) * 2) + Math.sin(t * 0.6 + s) * 6) % w + w) % w;
    const py = y0 + (((Math.sin(s * 1.9) * 0.5 + 0.5) * h + t * sp * (1.5 + (i % 3)) * (i % 2 ? 1 : -1)) % h + h) % h;
    const tw = 0.5 + 0.5 * Math.sin(t * 1.5 + s);
    g.fillStyle = 'rgba(255,214,150,' + (0.12 + 0.22 * tw * lit) + ')';
    g.fillRect(px, py, 1.6, 1.6);
  }
}
// Ambient drips and sparks per room: stateless (time-driven), so nothing to save or cap. Off with Low effects.
const drippedC = {};
function drawBunkerDripsSparks() {
  const t = performance.now() / 1000;
  const fr = v => v - Math.floor(v);
  for (const [k, r] of Object.entries(ROOMS)) {
    if (r.build) continue;
    const y0 = FLOORS[r.floor - 1] + (r.floor === 1 ? 16 : 10), y1 = FLOORS[r.floor];
    const w = r.x1 - r.x0, sd = r.x0 * 0.013 + r.floor * 3.1;
    // drip: bead forms at the ceiling, falls, ripples on the floor
    const dx = r.x0 + 30 + fr(Math.sin(sd * 7.7) * 4375.5) * (w - 60);
    const per = 4 + fr(Math.sin(sd * 3.3) * 999.1) * 3.5, ph = ((t * (prefs.rm ? 0.6 : 1) + sd * 5) % per + per) % per / per;
    const fy = y1 - 8;
    // drip sound hook: fire once per cycle as the drop lands (skip the first sighting so nothing plays on load)
    const dripC = Math.floor((t * (prefs.rm ? 0.6 : 1) + sd * 5) / per);
    if (ph >= 0.9 && drippedC[k] !== dripC) {
      if (drippedC[k] !== undefined && window.SFX && SFX.drip) SFX.drip();
      drippedC[k] = dripC;
    } else if (ph < 0.9 && drippedC[k] === undefined) drippedC[k] = dripC;
    if (ph < 0.72) {
      const grow = ph / 0.72;
      g.fillStyle = 'rgba(150,185,210,' + (0.25 + 0.4 * grow) + ')';
      g.beginPath(); g.arc(dx, y0 + 3 + grow * 1.5, 0.8 + grow * 1.2, 0, 7); g.fill();
    } else if (ph < 0.9) {
      const u = (ph - 0.72) / 0.18, y = y0 + 5 + (fy - y0 - 5) * u * u;
      g.fillStyle = 'rgba(170,200,225,0.75)'; g.fillRect(dx - 0.8, y, 1.6, 3.5);
    } else {
      const u = (ph - 0.9) / 0.1;
      g.strokeStyle = 'rgba(170,200,225,' + (0.5 * (1 - u)) + ')'; g.lineWidth = 1;
      g.beginPath(); g.ellipse(dx, fy + 2, 2 + u * 6, 1 + u * 1.5, 0, 0, 7); g.stroke();
    }
    // sparks from the lamp fixture: generator room while powered, any room during raids/alarms
    if (prefs.rm) continue;
    const chance = (k === 'generator' && S.powered ? 0.45 : 0) + lampK * 0.5;
    if (chance < 0.05) continue;
    const sp = 2.4 + fr(Math.sin(sd * 5.1) * 77.7) * 2, c = Math.floor((t + sd) / sp), u = (t + sd) - c * sp;
    if (u > 0.4 || fr(Math.sin(c * 12.9898 + sd) * 43758.5) > chance) continue;
    const sx = (r.x0 + r.x1) / 2 + (fr(Math.sin(c * 4.1 + sd) * 311.7) - 0.5) * 30, sy = y0 + 6;
    for (let i = 0; i < 6; i++) {
      const a = fr(Math.sin(c * 7.3 + i * 2.9 + sd) * 911.3), vx = (a - 0.5) * 140, vy = -20 + fr(a * 31.7) * 90;
      g.fillStyle = i % 2 ? 'rgba(255,210,122,' + (1 - u / 0.4) + ')' : 'rgba(255,138,58,' + (1 - u / 0.4) + ')';
      g.fillRect(sx + vx * u, Math.min(fy, sy + vy * u + 200 * u * u), 2, 2);
    }
  }
}
// Grit shaken loose from the ceiling by door hits: stateless, derived from the last hit time/count. Never drawn under reduced motion.
let doorHitN = 0, doorHitPow = 0.5;
function drawDoorGrit() {
  if (prefs.rm || prefs.le) return;
  const age = (performance.now() - doorHitAt) / 1000;
  if (age < 0 || age > 1.3) return;
  const fr = v => v - Math.floor(v);
  const top = FLOORS[0] + 18, bot = FLOORS[1] - 6;
  const n = Math.round(10 + 14 * doorHitPow);
  for (let i = 0; i < n; i++) {
    const s = doorHitN * 17.13 + i * 3.77;
    const delay = fr(Math.sin(s * 1.7) * 4375.5) * 0.25;
    const u = (age - delay) / 0.9;
    if (u <= 0 || u >= 1) continue;
    const x = clamp(DOOR_X + (fr(Math.sin(s) * 9301.3) - 0.5) * 320, IN_L + 4, IN_R - 4);
    const y = Math.min(bot, top + 30 * u + 230 * u * u * (0.7 + fr(Math.sin(s * 2.9) * 77.7) * 0.6));
    const sz = 1 + fr(Math.sin(s * 5.3) * 311.7) * 1.6;
    g.fillStyle = 'rgba(170,140,105,' + (0.75 * (1 - u * u)).toFixed(3) + ')';
    g.fillRect(x + Math.sin(u * 9 + s) * 1.5, y, sz, sz);
  }
}
// ---- ceiling dust motes (door hits) and loss vignette. Both skipped under reduced motion.
const ceilMotes = [];
let ceilMoteT = 0, lossVig = 0;
function spawnCeilMotes(x, dmg) {
  if (prefs.rm || prefs.le || scene !== 'bunker') return;
  const n = Math.min(14, 5 + Math.round(dmg * 0.4));
  const y0 = FLOORS[0] + 18;
  for (let i = 0; i < n && ceilMotes.length < 120; i++) {
    ceilMotes.push({ x: clamp(x + (Math.random() - 0.3) * 300, IN_L + 4, IN_R - 4), y: y0 + Math.random() * 6, vy: 14 + Math.random() * 22, ph: Math.random() * 6.28, a: 0.35 + Math.random() * 0.35, life: 0, max: 1.6 + Math.random() * 1.6, s: 1 + Math.random() * 1.4 });
  }
}
function drawCeilMotes() {
  const now = performance.now(), dt = Math.min(0.05, Math.max(0, (now - ceilMoteT) / 1000)); ceilMoteT = now;
  if (prefs.rm) { ceilMotes.length = 0; return; }
  const floorY = FLOORS[1] - 6;
  for (let i = ceilMotes.length - 1; i >= 0; i--) {
    const m = ceilMotes[i];
    m.life += dt; m.y += m.vy * dt; m.x += Math.sin(m.life * 3 + m.ph) * 6 * dt;
    if (m.life >= m.max || m.y >= floorY) { ceilMotes.splice(i, 1); continue; }
    const f = Math.min(1, (m.max - m.life) / 0.6);
    g.fillStyle = 'rgba(200,175,140,' + (m.a * f).toFixed(3) + ')';
    g.fillRect(m.x, m.y, m.s, m.s);
  }
}
// Dark edge vignette that deepens with the share of survivors lost. Eases in, so no sudden flash.
function drawLossVignette() {
  if (prefs.rm || scene !== 'bunker' || !S || !S.stats) { lossVig = 0; return; }
  const lost = (S.stats.lost || []).length, total = lost + living().length;
  const target = total > 0 ? Math.min(0.5, (lost / total) * 1.25) : 0;
  lossVig += (target - lossVig) * 0.03;
  if (lossVig < 0.01) return;
  const w = cv.width, h = cv.height;
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  const rg = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.hypot(w, h) / 2);
  rg.addColorStop(0, 'rgba(6,3,3,0)');
  rg.addColorStop(1, 'rgba(6,3,3,' + lossVig.toFixed(3) + ')');
  g.fillStyle = rg; g.fillRect(0, 0, w, h);
  g.restore();
}
// Power lighting: dims rooms when the generator is built but dark; emergency red pulse; amber flicker on battery.
// Low effects keeps the (static) dimming but drops all flicker and pulsing. Reduced motion: slow pulse, no flicker.
let powerDim = 0, powerBatt = 0;
function drawBunkerPower() {
  const out = !!(S.rooms && S.rooms.generator && !S.powered);
  const onB = !!(S.rooms && S.rooms.generator && S.powered && S.onBatt);
  powerDim += ((out ? 1 : 0) - powerDim) * 0.05;
  powerBatt += ((onB ? 1 : 0) - powerBatt) * 0.05;
  if (powerDim < 0.01 && powerBatt < 0.01) return;
  const t = performance.now() / 1000, calm = prefs.le || prefs.rm;
  for (const [k, r] of Object.entries(ROOMS)) {
    if (r.build) continue;
    const y0 = FLOORS[r.floor - 1] + (r.floor === 1 ? 16 : 10), y1 = FLOORS[r.floor];
    const x = r.x0 + 2, w = r.x1 - r.x0 - 4, h = y1 - y0 - 4;
    const sd = r.x0 * 0.013 + r.floor * 3.1;
    let a = 0.5 * powerDim;
    if (powerBatt > 0.01) {
      let f = 0;
      if (!calm) { f = Math.max(0, Math.sin(t * 9 + sd) * Math.sin(t * 3.1 + sd * 2) ); if (Math.sin(t * 1.7 + sd * 4) > 0.9) f = 1; }
      a += 0.18 * powerBatt + 0.25 * powerBatt * f;
    }
    g.fillStyle = 'rgba(4,5,12,' + a.toFixed(3) + ')';
    g.fillRect(x, y0 + 2, w, h);
    if (powerDim > 0.05) {
      // emergency strip light at the ceiling
      const p = prefs.le ? 0.5 : prefs.rm ? 0.5 + 0.2 * Math.sin(t * 1.2 + sd) : 0.5 + 0.5 * Math.sin(t * 3 + sd);
      g.save(); g.globalCompositeOperation = 'lighter';
      const cx = x + w / 2, cy = y0 + 6;
      const rg = g.createRadialGradient(cx, cy, 4, cx, cy, Math.max(w, h) * 0.55);
      rg.addColorStop(0, 'rgba(255,40,30,' + (0.28 * powerDim * p).toFixed(3) + ')');
      rg.addColorStop(1, 'rgba(255,40,30,0)');
      g.beginPath(); g.rect(x, y0 + 2, w, h); g.clip();
      g.fillStyle = rg; g.fillRect(x, y0 + 2, w, h);
      g.restore();
      g.fillStyle = 'rgba(255,70,50,' + (0.5 + 0.5 * p * powerDim).toFixed(3) + ')';
      g.fillRect(cx - 10, y0 + 3, 20, 3);
    }
  }
}
function drawBunkerDust() {
  if (prefs.le) return;
  drawBunkerDripsSparks();
  drawCeilMotes();
  if (prefs.rm) return;
  for (const [k, r] of Object.entries(ROOMS)) {
    if (r.build) continue;
    const y0 = FLOORS[r.floor - 1] + (r.floor === 1 ? 16 : 10), y1 = FLOORS[r.floor];
    drawDustBox(r.x0 + 2, y0 + 2, r.x1 - r.x0 - 4, y1 - y0 - 4, 14, r.x0, lampFlick(r.x0 * 0.01));
  }
  drawDoorGrit();
}
function drawScavLantern(ox) {
  const f = lampFlick(3.3), px = P.x - ox, py = P.y - 30;
  g.save(); g.globalCompositeOperation = 'lighter';
  const rg = g.createRadialGradient(px, py, 4, px, py, 170);
  rg.addColorStop(0, 'rgba(255,170,70,' + (0.30 * f) + ')'); rg.addColorStop(1, 'rgba(255,170,70,0)');
  g.fillStyle = rg; g.fillRect(px - 175, py - 175, 350, 350);
  g.restore();
  const t = performance.now() / 1000, sp = prefs.rm ? 0.3 : 1 + lampK * 2.5;
  for (let i = 0; i < 40; i++) {
    const s = i * 9.13;
    const x = (((Math.sin(s) * 0.5 + 0.5) * W - t * sp * (10 + (i % 6) * 5) - ox * 0.15) % W + W) % W;
    const y = (((Math.sin(s * 2.3) * 0.5 + 0.5) * H + Math.sin(t * 0.8 + s) * 12 + t * sp * 2) % H + H) % H;
    const near = Math.max(0, 1 - Math.hypot(x - px, y - py) / 190);
    g.fillStyle = 'rgba(230,200,160,' + (0.10 + 0.30 * near * f) + ')';
    g.fillRect(x, y, 1.6, 1.6);
  }
}
function tex(kind, x, y, w, h, a) { if (typeof VEC !== 'undefined' && VEC.texFill) VEC.texFill(g, kind, x, y, w, h, a); }
function drawRoom(k, r) {
  const y0 = FLOORS[r.floor - 1] + (r.floor === 1 ? 16 : 10), y1 = FLOORS[r.floor];
  const gr = g.createLinearGradient(0, y0, 0, y1); gr.addColorStop(0, '#2a1d12'); gr.addColorStop(1, '#4a3018');
  g.fillStyle = gr; g.fillRect(r.x0, y0, r.x1 - r.x0, y1 - y0);
  tex('stone', r.x0, y0, r.x1 - r.x0, y1 - y0, 0.9);
  g.fillStyle = 'rgba(60,40,22,.9)'; g.fillRect(r.x0, y1 - 6, r.x1 - r.x0, 6); tex('wood', r.x0, y1 - 6, r.x1 - r.x0, 6, 1.4);
  // lamplight
  const lx = (r.x0 + r.x1) / 2, rg = g.createRadialGradient(lx, y0 + 18, 4, lx, y0 + 40, (r.x1 - r.x0) * 0.6);
  const lf = lampFlick(r.x0 * 0.01);
  rg.addColorStop(0, 'rgba(255,170,70,' + (0.32 * lf) + ')'); rg.addColorStop(1, 'rgba(255,170,70,0)'); g.fillStyle = rg; g.fillRect(r.x0, y0, r.x1 - r.x0, y1 - y0);
  g.fillStyle = lf < 0.6 ? '#b8883f' : '#ffcf7a'; g.fillRect(lx - 6, y0 + 2, 12, 4);
  g.strokeStyle = '#5a4428'; g.lineWidth = 2.5; g.beginPath(); if (g.roundRect) g.roundRect(r.x0 + 1, y0 + 1, r.x1 - r.x0 - 2, y1 - y0 - 2, 6); else g.rect(r.x0 + 1, y0 + 1, r.x1 - r.x0 - 2, y1 - y0 - 2); g.stroke();
  g.fillStyle = 'rgba(255,214,150,.8)'; g.font = '600 12px "Chakra Petch", sans-serif';
  const lvl = S.rooms[k] > 1 ? ' II' : '';
  g.fillText(r.name.toUpperCase() + lvl, r.x0 + 10, y0 + 16);
  g.save(); g.translate(0, y1);
  // furniture, very simple
  // furniture now comes from grid items (see defaultItems / drawItems)
  if (k === 'med') { g.fillStyle = '#e04848'; g.fillRect(1180, -80, 24, 8); g.fillRect(1188, -88, 8, 24); }
  if (k === 'signal') drawTowerRoom();
  if (typeof VEC !== 'undefined') VEC.roomProp(g, k, !!S.powered, performance.now());
  if (typeof VEC === 'undefined' && k === 'armory') { box(832, -56, 120, 6, '#4a4a44'); box(832, -30, 120, 6, '#4a4a44'); for (let i = 0; i < 5; i++) box(840 + i * 22, -56, 4, 26, '#2a2a26'); box(850, -18, 80, 18, '#5a4a32'); g.fillStyle = S.powered ? '#7fc8ff' : '#553'; g.fillRect(940, -70, 6, 6); }
  if (typeof VEC === 'undefined' && k === 'storage') { box(975, -60, 110, 6, '#5a4a38'); box(975, -30, 110, 6, '#5a4a38'); for (let i = 0; i < 4; i++) { box(980 + i * 26, -48, 20, 18, '#8a6a42'); box(980 + i * 26, -18, 20, 18, '#7a5c38'); } }
  if (typeof VEC === 'undefined' && k === 'generator') { box(1130, -44, 90, 44, '#3d4650'); box(1140, -58, 16, 14, '#2a2a26'); box(1150, -30, 30, 20, '#2a3038'); g.fillStyle = S.powered ? ((Math.floor(performance.now() / 250) % 2) ? '#7fc8ff' : '#3a6a8a') : '#553'; g.fillRect(1196, -36, 8, 8); }
  g.restore();
  drawItems(k, r);
}
function box(x, y, w, h, c) { g.fillStyle = c; g.fillRect(x, y, w, h); }
// ---- crew debug overlay: need bars + state label per survivor (V or the Crew debug button)
let dbgCrew = false;
try { dbgCrew = localStorage.getItem('ab_dbg_crew') === '1'; } catch (e) {}
function applyDbgCrew() {
  const b = document.getElementById('tDbg');
  if (b) { b.classList.toggle('on', dbgCrew); b.setAttribute('aria-pressed', dbgCrew ? 'true' : 'false'); }
}
function toggleDbgCrew() {
  dbgCrew = !dbgCrew;
  try { localStorage.setItem('ab_dbg_crew', dbgCrew ? '1' : '0'); } catch (e) {}
  applyDbgCrew();
}
{ const b = document.getElementById('tDbg'); if (b) b.onclick = e => { toggleDbgCrew(); e.currentTarget.blur(); }; applyDbgCrew(); }
function drawCrewDebug() {
  if (!dbgCrew || !S) return;
  g.save();
  const rows = [['F', c => c.food, '#c9a27a'], ['R', c => restPct(c), '#7fc8ff'], ['H', c => c.hp / c.maxHp * 100, '#7ddc6f']];
  for (const c of S.crew) {
    if (!c.alive || c.exp) continue;
    const x = Math.round(c.x) - 12, y0 = Math.round(c.y) - 84;
    const label = String(c.state || '?');
    g.font = '600 9px "IBM Plex Sans", sans-serif';
    const w = g.measureText(label).width;
    g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(x + 12 - w / 2 - 2, y0 - 11, w + 4, 11);
    g.fillStyle = '#ffe0a8'; g.fillText(label, x + 12 - w / 2, y0 - 2);
    g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(x - 10, y0 + 1, 36, 20);
    rows.forEach(([ch, fn, col], i) => {
      const v = clamp(fn(c), 0, 100), y = y0 + 3 + i * 6, low = v < 25;
      g.fillStyle = '#ddd'; g.font = '700 6px sans-serif'; g.fillText(ch, x - 8, y + 4);
      g.fillStyle = 'rgba(255,255,255,.15)'; g.fillRect(x, y, 24, 4);
      const cbm = !!prefs.cb;
      g.fillStyle = low ? (cbm ? '#D55E00' : '#ff5a4e') : (cbm && col === '#7ddc6f' ? '#56B4E9' : col); g.fillRect(x, y, 24 * v / 100, 4);
      if (low && cbm) {
        g.fillStyle = '#fff';
        for (let o = 1; o < 24 * v / 100; o += 3) g.fillRect(x + o, y, 1, 4);
        g.font = '700 7px sans-serif'; g.fillText('\u26A0\uFE0E', x + 26, y + 5);
      }
    });
  }
  g.restore();
}
function drawTowerRoom() {
  // Lamp, the bunker AI
  box(740, -88, 54, 40, '#2b2116'); g.fillStyle = 'rgba(255,170,60,' + (0.7 + 0.2 * Math.sin(performance.now() / 700)) + ')'; g.fillRect(746, -82, 42, 28);
  g.fillStyle = '#2b1606'; g.fillRect(756, -74, 5, 5); g.fillRect(773, -74, 5, 5); g.fillRect(760, -63, 14, 3);
  box(762, -48, 10, 48, '#2b2116');
  // tower base grows with progress
  const st = S.tower.done, x = 980;
  g.strokeStyle = st > 0 ? '#9aa6b0' : '#4a3a28'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(x - 50, 0); g.lineTo(x, -110); g.lineTo(x + 50, 0); g.moveTo(x - 30, -40); g.lineTo(x + 30, -40); g.moveTo(x - 16, -80); g.lineTo(x + 16, -80); g.stroke();
  if (st > 1) { box(x + 80, -60, 70, 60, '#3d4650'); for (let i = 0; i < 5; i++) { g.fillStyle = (Math.floor(performance.now() / 300) + i) % 3 ? '#7fc8ff' : '#2a4a66'; g.fillRect(x + 88 + i * 12, -50, 6, 6); } }
  if (st > 2) { g.fillStyle = 'rgba(127,200,255,.25)'; g.beginPath(); g.arc(x, -110, 16 + 4 * Math.sin(performance.now() / 300), 0, 7); g.fill(); }
  if (S.tower.paid) {
    const need = TOWER[st].work, pct = clamp(S.tower.work / need, 0, 1);
    box(x - 60, -128, 120, 6, '#2d2215'); g.fillStyle = '#7fc8ff'; g.fillRect(x - 60, -128, 120 * pct, 6);
  }
}
function drawSurface(sky) {
  const y = FLOORS[0];
  const _v = typeof VEC !== 'undefined';
  // the hatch house
  if (!_v) { box(DOOR_X - 30, y - 46, 60, 46, '#4a4740'); box(DOOR_X - 34, y - 52, 68, 8, '#3a3832'); }
  const dp = S.door.hp / S.door.max;
  // brief door shake after a hit or breach (skipped under reduced motion / photosensitive mode / zero effects)
  g.save();
  if (!prefs.rm && !prefs.ps && prefs.fx > 0) {
    const shAge = performance.now() - doorHitAt;
    if (shAge >= 0 && shAge < 240) {
      const shAmp = (1 - shAge / 240) * 2.5 * prefs.fx * clamp(doorHitPow || 0.5, 0.4, 1) * (S.breached ? 1.4 : 1);
      g.translate(Math.sin(shAge * 0.11) * shAmp, Math.cos(shAge * 0.17) * shAmp * 0.4);
    }
  }
  if (_v) VEC.door(g, DOOR_X, y, dp); else box(DOOR_X - 16, y - 38, 32, 38, dp > 0 ? mix([90, 40, 30], [120, 118, 110], dp) : '#140c08');
  // damage cue: cracks grow as HP drops, flash on hit, red pulse when critical
  if (dp < 0.75) {
    const nC = dp <= 0 ? DOOR_CRACKS.length : dp < 0.25 ? 5 : dp < 0.5 ? 3 : 2;
    g.save(); g.strokeStyle = 'rgba(10,6,4,.85)'; g.lineWidth = 1.3; g.lineJoin = 'round';
    for (let i = 0; i < nC; i++) { const pl = DOOR_CRACKS[i]; g.beginPath(); g.moveTo(DOOR_X + pl[0][0], y + pl[0][1]); for (let j = 1; j < pl.length; j++) g.lineTo(DOOR_X + pl[j][0], y + pl[j][1]); g.stroke(); }
    g.restore();
  }
  // dents (static, so they stay under reduced motion): more and deeper as HP drops
  if (dp < 0.9) {
    const DENTS = [[-7, -28, 6, 4], [8, -14, 5, 6], [-9, -10, 5, 4], [5, -32, 6, 3]];
    const nD = dp < 0.25 ? 4 : dp < 0.5 ? 3 : dp < 0.75 ? 2 : 1;
    g.save();
    for (let i = 0; i < nD; i++) {
      const d = DENTS[i];
      g.fillStyle = 'rgba(8,5,3,.38)'; g.beginPath(); g.ellipse(DOOR_X + d[0], y + d[1], d[2], d[3], 0, 0, 7); g.fill();
      g.strokeStyle = 'rgba(210,200,185,.3)'; g.lineWidth = 1; g.beginPath(); g.ellipse(DOOR_X + d[0], y + d[1], d[2], d[3], 0, 0.2, Math.PI * 0.9); g.stroke();
    }
    g.restore();
  }
  if (!prefs.rm && dp < 1) {
    const now = performance.now(), hitAge = now - doorHitAt;
    g.save();
    // dust burst on each hit
    if (hitAge >= 0 && hitAge < 900) {
      const k = hitAge / 900;
      for (let i = 0; i < 9; i++) {
        const sx = DOOR_X + ((i * 37) % 31) - 15, vx = (((i * 53) % 11) - 5) * 0.5;
        const py = y - 36 + k * (30 + (i % 3) * 6), px = sx + vx * k * 10;
        g.fillStyle = 'rgba(170,155,130,' + (0.55 * (1 - k)).toFixed(3) + ')';
        g.fillRect(px, Math.min(py, y - 1), 1.5 + (i % 2), 1.5 + (i % 2));
      }
    }
    // ambient grit trickling from the frame once damaged
    if (dp < 0.6) {
      const n = dp < 0.3 ? 4 : 2;
      for (let i = 0; i < n; i++) {
        const per = 1400 + i * 370, k = ((now + i * 530) % per) / per;
        const sx = DOOR_X - 12 + ((i * 29) % 25);
        g.fillStyle = 'rgba(150,135,112,' + (0.5 * (1 - k)).toFixed(3) + ')';
        g.fillRect(sx, y - 38 + k * 36, 1.5, 1.5);
      }
    }
    // sparks from the cracks when nearly broken (small, brief, intermittent)
    if (dp > 0 && dp < 0.35) {
      const cyc = Math.floor(now / 650), ph = now % 650;
      if (ph < 130) {
        const pl = DOOR_CRACKS[(cyc * 7) % DOOR_CRACKS.length], pt = pl[(cyc * 3) % pl.length];
        const f = ph / 130;
        g.strokeStyle = 'rgba(255,' + (190 + Math.floor(40 * (1 - f))) + ',90,' + (0.9 * (1 - f)).toFixed(3) + ')'; g.lineWidth = 1;
        for (let s = 0; s < 4; s++) {
          const a = (s * 1.7 + cyc) % 6.283, r0 = 1 + f * 3, r1 = r0 + 2 + f * 3;
          g.beginPath(); g.moveTo(DOOR_X + pt[0] + Math.cos(a) * r0, y + pt[1] + Math.sin(a) * r0 + f * 3);
          g.lineTo(DOOR_X + pt[0] + Math.cos(a) * r1, y + pt[1] + Math.sin(a) * r1 + f * 5); g.stroke();
        }
      }
    }
    g.restore();
  }
  if (dp > 0 && dp < 0.25) {
    const pu = prefs.rm ? 0.6 : 0.5 + 0.5 * Math.sin(performance.now() / 1000 * (2 + (1 - dp / 0.25) * 2.4) * Math.PI * 2);
    g.fillStyle = 'rgba(255,40,30,' + (0.12 + 0.28 * pu).toFixed(3) + ')'; g.fillRect(DOOR_X - 17, y - 39, 34, 39);
  }
  if (!prefs.rm && !prefs.ps && prefs.fx > 0) {
    const age = performance.now() - doorHitAt;
    if (age >= 0 && age < 180) { g.fillStyle = 'rgba(255,235,210,' + (0.5 * prefs.fx * (1 - age / 180)).toFixed(3) + ')'; g.fillRect(DOOR_X - 17, y - 39, 34, 39); }
  }
  if (dp <= 0) { g.strokeStyle = '#ff5a4e'; g.lineWidth = 2; g.strokeRect(DOOR_X - 16, y - 38, 32, 38); }
  g.restore(); // end door shake
  const hatchHurt = dp < 1 || S.breached;
  if (hatchHurt) {
    const hcb = !!prefs.cb, hbr = S.breached || dp <= 0;
    const hcol = hbr || dp < 0.25 ? (hcb ? '#D55E00' : '#ff5a4e') : dp < 0.5 ? (hcb ? '#E69F00' : '#ff8c2a') : dp < 0.75 ? '#ffb347' : (hcb ? '#56B4E9' : '#c8d6a0');
    hpBar(DOOR_X - 24, y - 62, 48, dp, hcol);
    g.fillStyle = hcol; g.fillRect(DOOR_X - 24, y - 62, Math.round(48 * Math.max(0, Math.min(1, dp))), 4);
    // shape marker above the fill end: circle >=75%, triangle <75%, diamond <50%, X <25% or breached
    const mx2 = DOOR_X - 24 + Math.round(48 * Math.max(0, Math.min(1, dp))), my2 = y - 69;
    g.save(); g.fillStyle = hcol; g.strokeStyle = hcol; g.lineWidth = 2; g.beginPath();
    if (hbr || dp < 0.25) { g.moveTo(mx2 - 3, my2 - 3); g.lineTo(mx2 + 3, my2 + 3); g.moveTo(mx2 + 3, my2 - 3); g.lineTo(mx2 - 3, my2 + 3); g.stroke(); }
    else if (dp < 0.5) { g.moveTo(mx2, my2 - 4); g.lineTo(mx2 + 4, my2); g.lineTo(mx2, my2 + 4); g.lineTo(mx2 - 4, my2); g.closePath(); g.fill(); }
    else if (dp < 0.75) { g.moveTo(mx2, my2 - 4); g.lineTo(mx2 + 4, my2 + 3); g.lineTo(mx2 - 4, my2 + 3); g.closePath(); g.fill(); }
    else { g.arc(mx2, my2, 3, 0, 7); g.fill(); }
    g.restore();
  }
  if (hatchHurt) {
    // threshold ticks at 25/50/75% and a pulse on the bar when critical or breached (steady under reduced motion)
    g.fillStyle = 'rgba(255,255,255,.55)';
    for (const f of [0.25, 0.5, 0.75]) g.fillRect(DOOR_X - 24 + Math.round(48 * f), y - 63, 1, 6);
    if (dp < 0.25 || S.breached) {
      const pu = prefs.rm ? 0.5 : 0.5 + 0.5 * Math.sin(performance.now() / 1000 * 6);
      g.fillStyle = 'rgba(255,60,50,' + (0.15 + 0.3 * pu).toFixed(3) + ')'; g.fillRect(DOOR_X - 25, y - 63, 50, 6);
    }
  }
  if (hatchHurt) {
    const cbm = !!prefs.cb;
    const br = S.breached || dp <= 0;
    const lab = br ? 'BREACHED' : dp < 0.25 ? 'CRITICAL' : dp < 0.5 ? 'FAILING' : dp < 0.75 ? 'DAMAGED' : 'SEALED';
    const gl = br ? '\u2620' : dp < 0.25 ? '\u2716' : dp < 0.5 ? '\u25C6' : dp < 0.75 ? '\u25B2' : '\u25CF';
    const lc = br || dp < 0.25 ? (cbm ? '#D55E00' : '#ff5a4e') : dp < 0.5 ? (cbm ? '#E69F00' : '#ff8c2a') : dp < 0.75 ? '#ffb347' : (cbm ? '#56B4E9' : '#c8d6a0');
    g.save();
    g.font = '600 10px "IBM Plex Sans"'; g.textAlign = 'center';
    g.fillStyle = 'rgba(0,0,0,.7)';
    const txt = gl + ' HATCH ' + Math.max(0, Math.ceil(S.door.hp)) + '/' + Math.ceil(S.door.max) + ' \u00B7 ' + lab;
    g.fillText(txt, DOOR_X + 1, y - 66 + 1);
    g.fillStyle = lc; g.fillText(txt, DOOR_X, y - 66);
    g.restore();
  }
  // tower mast topside
  const st = S.tower.done;
  if (st > 0) { g.strokeStyle = '#8a96a0'; g.lineWidth = 3; const mx = 1000, top = y - 40 - st * 28; g.beginPath(); g.moveTo(mx - 14, y); g.lineTo(mx, top); g.lineTo(mx + 14, y); g.stroke(); g.fillStyle = st > 2 ? '#7fc8ff' : '#ff5a4e'; g.beginPath(); g.arc(mx, top, 4, 0, 7); g.fill(); }
  // turrets
  S.turrets.forEach((t, i) => {
    const x = SLOT_X[i];
    if (!t) { g.strokeStyle = 'rgba(255,200,120,.35)'; g.setLineDash([4, 4]); g.strokeRect(x - 14, y - 24, 28, 24); g.setLineDash([]); return; }
    if (_v) VEC.turret(g, x, y, t, { powered: !!S.powered, now: performance.now() }); else { box(x - 14, y - 18, 28, 18, '#4f4a40'); box(x - 8, y - 32, 16, 14, t.manned ? '#6a6a5a' : '#45433b'); }
    if (_v) {} else if (t.type === 'coil') {
      g.fillStyle = '#2a2a26'; g.fillRect(x - 2, y - 44, 4, 12);
      const on = !!S.powered, pulse = on ? (prefs.rm ? 0.5 : 0.5 + 0.5 * Math.sin(performance.now() / 200)) : 0;
      g.fillStyle = on ? '#7fc8ff' : '#553'; g.beginPath(); g.arc(x, y - 46, 5, 0, 7); g.fill();
      if (on) { g.strokeStyle = 'rgba(127,200,255,' + (0.25 + 0.4 * pulse) + ')'; g.lineWidth = 2; g.beginPath(); g.arc(x, y - 46, 8 + pulse * 6, 0, 7); g.stroke(); }
    } else { g.fillStyle = '#2a2a26'; g.fillRect(x + 4, y - 28, t.type === 'rifle' ? 30 : 20, t.type === 'rifle' ? 4 : 7); }
    if (t.flash > 0) {
      t.flash -= 1 / 60;
      const fa = clamp(t.flash / 0.08, 0, 1), mx = x + (t.type === 'rifle' ? 36 : 26), my = y - 26, big = t.type === 'rifle' ? 1 : 0.8;
      if (prefs.rm || prefs.ps || prefs.fx <= 0) { /* muzzle flash skipped under reduced motion / photosensitive-safe / 0% intensity */ }
      else {
        g.globalAlpha = (0.35 + 0.65 * fa) * prefs.fx;
        g.fillStyle = '#ff9a3a'; g.beginPath(); g.moveTo(mx - 2, my - 5 * big); g.lineTo(mx + 16 * big, my); g.lineTo(mx - 2, my + 5 * big); g.closePath(); g.fill();
        g.fillStyle = '#ffe08a'; g.beginPath(); g.arc(mx, my, 5, 0, 7); g.fill();
        g.fillStyle = '#fff'; g.beginPath(); g.arc(mx, my, 2.2, 0, 7); g.fill();
        g.globalAlpha = 1;
      }
    }
    if (!_v && t.lvl > 1) { g.fillStyle = '#ffb347'; g.fillRect(x - 12, y - 16, 4, 4); }
    hpBar(x - 16, y - 44, 32, t.hp / t.max, '#ffb347');
    const ts = t.type === 'coil' ? (turretCrewed(t) ? 'manned' : 'nopower') : turretStatus(t);
    if (ts !== 'manned') {
      g.fillStyle = ts === 'walking' ? 'rgba(255,200,120,.95)' : 'rgba(255,90,78,.9)';
      g.font = '600 10px "IBM Plex Sans"';
      g.textAlign = 'center';
      g.fillText(ts === 'nopower' ? 'NO POWER' : ts === 'walking' ? 'Manning...' : 'NO GUNNER - press C', x, y - 48);
      g.textAlign = 'left';
    }
  });
  // wall
  if (S.wall.hp > 0) {
    const h = S.wall.lvl > 1 ? 58 : 44;
    if (_v) VEC.wall(g, WALL_X, y, h, S.wall.lvl); else for (let i = 0; i < 5; i++) box(WALL_X - 10 + (i % 2) * 3, y - h + i * (h / 5), 22, h / 5 - 1, i % 2 ? '#6a5640' : '#7a6650');
    if (!_v && S.wall.lvl > 1) { g.strokeStyle = '#999'; g.lineWidth = 1; for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(WALL_X - 12 + i * 8, y - h - 6); g.lineTo(WALL_X - 8 + i * 8, y - h); g.stroke(); } }
    hpBar(WALL_X - 18, y - h - 14, 36, S.wall.hp / S.wall.max, '#ffb347');
  } else { box(WALL_X - 14, y - 8, 30, 8, '#3d3226'); }
  // scavenging exit
  g.fillStyle = 'rgba(255,214,150,.55)'; g.font = '600 11px "Chakra Petch"'; g.fillText('WASTELAND →', W - 96, y - 10);
}
function hpBar(x, y, w, pct, c) {
  g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(x, y, w, 4);
  const cbm = !!prefs.cb;
  if (cbm && c === '#7ddc6f') c = '#56B4E9';
  g.fillStyle = pct > 0.5 ? c : pct > 0.25 ? (cbm ? '#E69F00' : '#ff8c2a') : (cbm ? '#D55E00' : '#ff5a4e');
  const fw = w * clamp(pct, 0, 1);
  g.fillRect(x, y, fw, 4);
  if (cbm && pct > 0.5) { g.fillStyle = '#fff'; g.fillRect(x, y, fw, 1); }   // shape cue: healthy = solid white edge line
  if (cbm && pct <= 0.5) {
    // shape cue: mid = sparse white ticks, low = dense white stripes
    g.fillStyle = '#fff'; const step = pct > 0.25 ? 6 : 3;
    for (let o = 1; o < fw; o += step) g.fillRect(x + o, y, 1, 4);
  }
}
// Floating status icon: injured (cross) > hungry (triangle) > tired (diamond) > floor-sleeping (square).
// Shapes are always distinct so colour is never the only cue; colorblind mode swaps the palette and adds outlines.
function drawStatusIcon(c, sleeping) {
  let kind = null;
  if (c.hp < c.maxHp * 0.5 || c.sick) kind = 'injured';
  else if (c.food < 30) kind = 'hungry';
  else if (!sleeping && sleepFactor(c.awake) < 0.6) kind = 'tired';
  else if (sleeping && c.bed === false) kind = 'floor';
  if (!kind) return;
  const cb = !!prefs.cb;
  const col = cb ? { injured: '#ffffff', hungry: '#e69f00', tired: '#56b4e9', floor: '#f0e442' }[kind]
                  : { injured: '#e04848', hungry: '#ff8c2a', tired: '#c8b6ff', floor: '#e2c29a' }[kind];
  const cx = 0, cy = sleeping ? -30 : -64, r = 6;
  g.save();
  g.fillStyle = 'rgba(0,0,0,.6)'; g.beginPath(); g.arc(cx, cy, r + 3, 0, Math.PI * 2); g.fill();
  g.fillStyle = col; g.strokeStyle = cb ? '#000' : 'rgba(0,0,0,.7)'; g.lineWidth = cb ? 1.5 : 1;
  g.beginPath();
  if (kind === 'injured') {
    const a = 2.2;
    g.moveTo(cx - a, cy - r); g.lineTo(cx + a, cy - r); g.lineTo(cx + a, cy - a); g.lineTo(cx + r, cy - a);
    g.lineTo(cx + r, cy + a); g.lineTo(cx + a, cy + a); g.lineTo(cx + a, cy + r); g.lineTo(cx - a, cy + r);
    g.lineTo(cx - a, cy + a); g.lineTo(cx - r, cy + a); g.lineTo(cx - r, cy - a); g.lineTo(cx - a, cy - a);
  } else if (kind === 'hungry') {
    g.moveTo(cx, cy - r); g.lineTo(cx + r, cy + r - 1); g.lineTo(cx - r, cy + r - 1);
  } else if (kind === 'tired') {
    g.moveTo(cx, cy - r); g.lineTo(cx + r, cy); g.lineTo(cx, cy + r); g.lineTo(cx - r, cy);
  } else {
    g.rect(cx - r + 1, cy - r + 1, 2 * r - 2, 2 * r - 2);
  }
  g.closePath(); g.fill(); g.stroke();
  g.restore();
}
function drawPerson(x, y, color, accent, c, anim, facing, sleeping, climbing) {
  g.save(); g.translate(Math.round(x), Math.round(y));
  // subtle life: walk hop, idle sway, sleep breathing (skipped under reduced motion)
  let bobY = 0, breath = 1;
  if (!prefs.rm) {
    const tt = performance.now() / 1000;
    let ph = 0; const k = (c && c.id) ? String(c.id) : '';
    for (let i = 0; i < k.length; i++) ph += k.charCodeAt(i);
    if (c) {
      const moved = c._bx !== undefined && (Math.abs(c.x - c._bx) > 0.01 || Math.abs(c.y - c._by) > 0.01);
      c._bx = c.x; c._by = c.y;
      if (sleeping) breath = 1 + 0.025 * Math.sin(tt * 1.6 + ph);
      else if (!climbing) bobY = moved ? -Math.abs(Math.sin(anim)) * 1.5 : Math.sin(tt * 2 + ph) * 0.7;
    } else if (!sleeping && !climbing) bobY = -Math.abs(Math.sin(anim)) * 1.2;
  }
  if (sleeping) {
    g.save(); g.scale(1, breath);
    let lay = false;
    const sleepSid = c && crewSheetId(c);
    if (sleepSid) { g.save(); g.translate(0, -8); g.rotate(-Math.PI / 2); try { lay = sheetDraw(sleepSid, 'idle', 1, 0); } catch (e) { lay = false; } g.restore(); }
    if (!lay) { box(-12, -10, 24, 8, color); g.fillStyle = '#e2c29a'; g.fillRect(-16, -12, 7, 7); }
    g.restore();
    g.save(); g.font = '600 10px "IBM Plex Sans"';
    if (prefs.rm) { g.fillStyle = 'rgba(220,220,255,.8)'; g.fillText('z', 6, -16); }
    else {
      const zt = performance.now() / 1000;
      for (let zi = 0; zi < 3; zi++) {
        const zp = ((zt * 0.35 + zi / 3) % 1);
        g.globalAlpha = Math.sin(zp * Math.PI) * 0.85;
        g.fillStyle = 'rgb(220,220,255)';
        g.font = '600 ' + (7 + zp * 5).toFixed(1) + 'px "IBM Plex Sans"';
        g.fillText('z', 6 + Math.sin(zt * 2 + zi * 2.1) * 3 + zp * 6, -14 - zp * 18);
      }
    }
    g.restore();
  } else {
    g.save(); g.translate(0, bobY);
    const step = Math.sin(anim) * 3;
    if (!(c && (c.id || c.name) && sheetDrawCrew(c, anim, facing, climbing))) (typeof VEC !== 'undefined' ? VEC : SPR).person(g, color, accent, (climbing || Math.abs(step) < 0.8) ? 0 : (step > 0 ? 1 : 2), facing < 0);
    if (typeof VEC === 'undefined' && c && c.id === 'bram') { g.fillStyle = '#c9c4b8'; g.fillRect(-4, -28, 8, 3); }
    if (c && c.id === 'juno' && !c.held && !sheetDrawn('juno')) { g.fillStyle = '#222'; g.fillRect(facing > 0 ? 2 : -18, typeof VEC !== 'undefined' ? -17 : -22, 16, 3); }
    if (typeof VEC === 'undefined' && c && c.id === 'reed') { g.fillStyle = '#b0b8c0'; g.fillRect(-4, -31, 8, 2); }
    if (typeof VEC === 'undefined' && c && c.id === 'tick') { g.fillStyle = '#59d0c4'; g.fillRect(-5, -33, 10, 3); }
    if (c && c.state === 'patient') { g.fillStyle = '#e04848'; g.fillRect(-2, -44, 4, 10); g.fillRect(-5, -41, 10, 4); }
    if (c) drawCrewHeld(c, facing);
    g.restore();
  }
  if (c) {
    if (c.hp < c.maxHp) hpBar(-10, -42, 20, c.hp / c.maxHp, '#7ddc6f');
    if (sel === c.id || hover === c) { g.fillStyle = '#ffe0a8'; g.font = '600 11px "IBM Plex Sans"'; const w = g.measureText(c.name).width; g.fillText(c.name, -w / 2, -48); }
    if (sel === c.id) { g.strokeStyle = '#ffb347'; g.lineWidth = 1.5; g.strokeRect(-10, -38, 20, 40); }
    drawStatusIcon(c, sleeping);
  }
  g.restore();
}
// held items: the model's grip is moved onto the hand (hx, hy) and mirrored when facing left
function heldAt(id, f, hx, hy) {
  if (typeof VEC === 'undefined' || !VEC.gear || !VEC.hasGear(id)) return;
  g.save(); g.translate(hx, hy + 12); VEC.gear(g, id, f < 0); g.restore();
}
function drawCrewHeld(c, facing) {
  const f = facing < 0 ? -1 : 1;
  if (c.held) heldAt('g_' + c.held, f, 9 * f, -12.5);
  const cr = c.carry;
  if (cr) {
    heldAt(cr.id === 'crate' ? 'g_crate' : 'g_meal', f, c.held ? 2 * f : 8 * f, c.held ? -19 : -12.5);
    if (cr.n > 1) { g.fillStyle = '#ffe0a8'; g.font = '700 10px "IBM Plex Sans"'; g.fillText('x' + cr.n, f > 0 ? 10 : -22, -26); }
  } else if (c.plate) heldAt('g_meal', f, 8 * f, -12.5);
}
function enemyGearDraw(e, b) {
  if (!e.gear) return;
  const f = e.facing < 0 ? -1 : 1;
  heldAt('g_' + e.gear, f, 9 * f, -b.h + 14);
}
// ---- Generic Sprite Forge sheet registry (renegade-sprite/1) ----
const SHEET_FILES = { mara: 'mara-voss', reed: 'doc-tobias-reed', juno: 'juno-park', bram: 'old-bram', cinder: 'cinder', wren: 'wren', warden: 'the-warden-unit-9', odalys: 'sister-odalys-crane', tick: 'tick', anand: 'dr', dorrow: 'sergeant-hale-dorrow', fenn: 'fenn-whitlock', vesper: 'vesper', maw: 'maw', lamp: 'lamp', finch: 'reverend-calloway-finch', pike: 'pike', echo: 'echo', rook: 'rook', mags: 'marguerite-mags-oyelaran', nell: 'nell' };
// Survivors who aren't story characters (random names like Ada Bishop, wanderers at the hatch or out on trips)
// get one of the Sprite Forge wanderer sprites, picked from their name so a person keeps the same look across saves.
const POOL_SHEETS = ['wanderer-ex-soldier', 'wanderer-field-nurse', 'wanderer-old-farmhand', 'wanderer-scrap-picker', 'wanderer-tarp-poncho', 'wanderer-young-courier'];
POOL_SHEETS.forEach(f => { SHEET_FILES['pool:' + f] = f; });
function crewSheetId(c) {
  if (!c) return null;
  if (c.id && SHEET_FILES[c.id] && !String(c.id).startsWith('pool:')) return c.id;
  if (c.named) return null;   // a story character without a sheet keeps its drawn look
  const key = String(c.name || c.id || ''); if (!key) return null;
  let h = 0; for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return 'pool:' + POOL_SHEETS[h % POOL_SHEETS.length];
}
const SHEETS = {};
const SHEET_MOVE = {};
const SHEET_ATK = {};
function sheetGet(id) {
  const file = SHEET_FILES[id]; if (!file) return null;
  let s = SHEETS[id];
  if (!s) {
    s = SHEETS[id] = { meta: null, img: null, ready: false };
    try {
      const img = new Image();
      img.onload = () => { s.img = img; s.ready = !!s.meta; };
      img.onerror = () => { s.ready = false; s.failed = true; };
      img.src = 'sprites/' + file + '.png';
      fetch('sprites/' + file + '.json').then(r => r.json()).then(m => {
        if (m && m.format === 'renegade-sprite/1' && m.animations && m.pivot) { s.meta = m; s.ready = !!s.img; }
      }).catch(() => { s.failed = true; });
    } catch (e) { s.failed = true; }
  }
  return s;
}
function sheetDrawn(id) { const s = SHEETS[id]; return !!(s && s.ready); }
// draws sheet `id` at the current origin (feet). want: idle|walk|attack|hurt|death|interact. Returns false if not ready.
function sheetDraw(id, want, facing, seed, prog) {
  const s = sheetGet(id);
  if (!s || !s.ready) return false;
  const m = s.meta, A = m.animations;
  const an = A[want] || (want === 'walk' ? A.idle : null) || A.idle || A.walk;
  if (!an || !an.frames || !an.frames.length) return false;
  const fr = an.frames;
  const total = fr.reduce((a, f) => a + (f.duration || 100), 0) || 1;
  let t = prog != null ? Math.max(0, Math.min(0.999, prog)) * total : (performance.now() + (seed || 0)) % total;
  let f = fr[fr.length - 1];
  for (let i = 0; i < fr.length; i++) { const d = fr[i].duration || 100; if (t < d) { f = fr[i]; break; } t -= d; }
  const k = 1 / (m.scale || 1);
  const smooth = g.imageSmoothingEnabled;
  g.imageSmoothingEnabled = false;
  g.save();
  if (facing < 0) g.scale(-1, 1);
  g.drawImage(s.img, f.x, f.y, f.w, f.h, -m.pivot.x * k, -m.pivot.y * k, f.w * k, f.h * k);
  g.restore();
  g.imageSmoothingEnabled = smooth;
  return true;
}
function sheetMoving(key, val) {
  const r = SHEET_MOVE[key] || (SHEET_MOVE[key] = { v: val, until: 0 });
  const now = performance.now();
  if (r.v !== val) { r.v = val; r.until = now + 150; }
  return now < r.until;
}
function sheetDrawCrew(c, anim, facing, climbing) {
  try {
    const sid = crewSheetId(c); if (!sid) return false;
    const ck = c.id || c.name;
    const moving = sheetMoving('c:' + ck, anim) && !climbing;
    const now = performance.now();
    const a = SHEET_ATK[ck] || (SHEET_ATK[ck] = { cd: 0, start: -1e9 });
    const cd = c.cd || 0;
    if (cd > a.cd + 0.05) a.start = now;
    a.cd = cd;
    const sh = SHEETS[sid], an = sh && sh.ready && sh.meta.animations.attack;
    if (an && !(c.hurt > 0)) {
      const dur = an.frames.reduce((s, f) => s + (f.duration || 100), 0) || 1;
      if (now - a.start < dur) return sheetDraw(sid, 'attack', facing, 0, (now - a.start) / dur);
    }
    return sheetDraw(sid, (c.hurt > 0 ? 'hurt' : moving ? 'walk' : 'idle'), facing, (String(ck).length * 97) % 400);
  } catch (e) { return false; }
}
function sheetDrawEnemy(e) {
  try {
    const moving = sheetMoving('e:' + e.type + ':' + (e.id != null ? e.id : ''), Math.round(e.x * 4));
    return sheetDraw(e.type, moving ? 'walk' : 'idle', e.facing, 0);
  } catch (err) { return false; }
}
// ---- Mara Voss sprite sheet (Sprite Forge, renegade-sprite/1) ----
const MARA_SHEET = { meta: null, img: null, started: false, ready: false, lastAnim: null };
function maraSheetLoad() {
  if (MARA_SHEET.started) return;
  MARA_SHEET.started = true;
  try {
    const img = new Image();
    img.onload = () => { MARA_SHEET.img = img; MARA_SHEET.ready = !!MARA_SHEET.meta; };
    img.onerror = () => { MARA_SHEET.ready = false; };
    img.src = 'sprites/mara-voss.png';
    fetch('sprites/mara-voss.json').then(r => r.json()).then(m => {
      if (m && m.format === 'renegade-sprite/1' && m.animations) { MARA_SHEET.meta = m; MARA_SHEET.ready = !!MARA_SHEET.img; }
    }).catch(() => {});
  } catch (e) { /* keep vector fallback */ }
}
// pick a frame: looping anims use wall-clock time, one-shot anims use progress 0..1
function maraSheetFrame(an, progress) {
  const fr = an.frames; if (!fr || !fr.length) return null;
  const durs = fr.map(f => f.duration || 100);
  const total = durs.reduce((a, b) => a + b, 0);
  let t = progress == null ? (performance.now() % total) : Math.max(0, Math.min(0.999, progress)) * total;
  for (let i = 0; i < fr.length; i++) { if (t < durs[i]) return fr[i]; t -= durs[i]; }
  return fr[fr.length - 1];
}
function drawMaraSheet() {
  maraSheetLoad();
  if (!MARA_SHEET.ready) return false;
  const m = MARA_SHEET.meta, A = m.animations;
  const moving = MARA_SHEET.lastAnim !== null && P.anim !== MARA_SHEET.lastAnim;
  MARA_SHEET.lastAnim = P.anim;
  let an, prog = null;
  if (P.hurt > 0 && A.hurt) { an = A.hurt; prog = (0.2 - P.hurt) / 0.2; }
  else if (P.cd > 0 && A.attack) { an = A.attack; prog = (0.34 - P.cd) / 0.34; }
  else if (moving && A.walk) an = A.walk;
  else an = A.idle || A.walk;
  if (!an) return false;
  const f = maraSheetFrame(an, prog);
  if (!f) return false;
  const k = 1 / (m.scale || 1);
  const px = m.pivot.x, py = m.pivot.y;
  const smooth = g.imageSmoothingEnabled;
  g.imageSmoothingEnabled = false;
  g.save();
  if (P.facing < 0) g.scale(-1, 1);
  g.drawImage(MARA_SHEET.img, f.x, f.y, f.w, f.h, -px * k, -py * k, f.w * k, f.h * k);
  g.restore();
  g.imageSmoothingEnabled = smooth;
  return true;
}
function drawMara() {
  g.save(); g.translate(Math.round(P.x), Math.round(P.y));
  const step = Math.sin(P.anim) * 3;
  if (P.hurt > 0) g.globalAlpha = 0.6;
  let drewSheet = false;
  try { drewSheet = drawMaraSheet(); } catch (e) { drewSheet = false; }
  if (!drewSheet) {
    (typeof VEC !== 'undefined' ? VEC : SPR).mara(g, Math.abs(step) < 0.8 ? 0 : (step > 0 ? 1 : 2), P.facing < 0);
    g.fillStyle = '#222'; g.fillRect(P.facing > 0 ? 5 : -15, typeof VEC !== 'undefined' ? -19 : -24, 10, 3);
  }
  g.restore();
  g.fillStyle = '#ffb347'; g.font = '700 10px "Chakra Petch"'; g.fillText('MARA', P.x - 13, P.y - 46);
}
function drawEnemy(e, ox = 0) {
  const b = ENEMIES[e.type];
  g.save(); g.translate(Math.round(e.x - ox), Math.round(e.y));
  const bob = Math.sin(e.anim) * 2;
  if (e.hidden) { box(-14, -6, 28, 6, '#5a4a38'); box(-8, -10, 16, 4, '#6e5a44'); g.restore(); return; }
  const ART = typeof VEC !== 'undefined' ? VEC : SPR;
  if ((e.type === 'maw' || e.type === 'cinder') && sheetDrawEnemy(e)) { /* drawn from Sprite Forge sheet */ }
  else if (e.type === 'burrower') { box(-14, -18 + bob * 0.5, 28, 14, b.color); box(e.facing < 0 ? -20 : 10, -20 + bob * 0.5, 10, 10, '#4a3a2c'); g.fillStyle = '#e8e0d0'; g.fillRect(e.facing < 0 ? -22 : 18, -16, 2, 5); g.fillStyle = '#ff4030'; g.fillRect(e.facing < 0 ? -16 : 12, -18, 2, 2); }
  else if (ART.hasEnemy(e.type)) {
    ART.enemy(g, e.type, b.color, Math.abs(bob) < 0.7 ? 0 : (bob > 0 ? 1 : 2), e.facing < 0, performance.now() / 1000);
    if ((e.type === 'raider' || e.type === 'cinder') && !e.gear) { g.fillStyle = '#222'; g.fillRect(e.facing < 0 ? -18 : 4, -b.h + 12, 14, 3); }
  }
  else if (e.type === 'hound') { box(-13, -16 + bob * 0.5, 26, 10, b.color); box(e.facing < 0 ? -18 : 10, -20 + bob * 0.5, 8, 8, '#7a4f36'); g.fillStyle = '#ff4030'; g.fillRect(e.facing < 0 ? -16 : 15, -18, 2, 2); g.fillStyle = '#3a2818'; for (let i = 0; i < 4; i++) g.fillRect(-11 + i * 6, -6, 3, 6 + (i % 2 ? bob : -bob) * 0.5); }
  else if (e.type === 'maw') { box(-22, -34, 44, 34, b.color); box(-18, -30, 36, 26, '#3a2e24'); g.fillStyle = '#e8e0d0'; for (let i = 0; i < 6; i++) g.fillRect(-16 + i * 6, -30 + (i % 2) * 3, 3, 8); g.fillStyle = '#ff4030'; g.fillRect(-10, -36, 4, 3); g.fillRect(6, -36, 4, 3); }
  else if (e.type === 'ram') { const f = e.facing < 0 ? -1 : 1; g.save(); g.scale(f, 1); if (e.st === 'wind') g.translate(Math.sin(performance.now() / 30) * 1.5, 0); box(-36, -26, 72, 18, '#6a4a3a'); box(-26, -40, 30, 14, '#4a3a30'); box(30, -32, 12, 24, '#8a8a8a'); box(40, -36, 10, 32, '#b0b0a8'); g.fillStyle = '#1a1410'; g.beginPath(); g.arc(-22, -6, 7, 0, 7); g.arc(20, -6, 7, 0, 7); g.fill(); if (e.st === 'charge') { g.fillStyle = '#ff4030'; g.fillRect(44, -30, 4, 4); } else if (e.st === 'stun') { g.fillStyle = '#ffe08a'; g.fillRect(-4, -48, 8, 4); } g.restore(); }
  else if (e.type === 'brute') { box(-13, -40, 26, 30, b.color); box(-9, -48, 18, 10, '#8a7a96'); g.fillStyle = '#2a2030'; g.fillRect(-12, -10, 9, 10); g.fillRect(3, -10, 9, 10); g.fillStyle = '#ff4030'; g.fillRect(e.facing < 0 ? -6 : 2, -45, 3, 3); }
  else {
    g.fillStyle = '#2a2018'; g.fillRect(-5, -10, 4, 10 + bob); g.fillRect(1, -10, 4, 10 - bob);
    box(-7, -b.h + 6, 14, b.h - 16, b.color); g.fillStyle = e.type === 'ghoul' ? '#a9ae88' : '#d8b89a'; g.fillRect(-4, -b.h - 2, 8, 8);
    if ((e.type === 'raider' || e.type === 'cinder') && !e.gear) { g.fillStyle = '#222'; g.fillRect(e.facing < 0 ? -18 : 4, -b.h + 12, 14, 3); }
    if (e.type === 'cinder') { g.fillStyle = '#fff'; g.fillRect(-4, -b.h - 2, 8, 8); g.fillStyle = '#c22'; g.fillRect(-3, -b.h + 3, 6, 2); g.fillStyle = '#7a3a22'; g.fillRect(-10, -b.h + 8, 20, 4); }
  }
  enemyGearDraw(e, b);
  if (!prefs.rm && e.hitAt && e.hp > 0) {
    const hf = 1 - (performance.now() - e.hitAt) / 110;
    if (hf > 0) { g.globalCompositeOperation = 'lighter'; g.globalAlpha = hf * (e.hitCrit ? 0.55 : 0.35) * (prefs.ps ? 0 : Math.min(1, prefs.fx)); g.fillStyle = '#fff'; g.fillRect(-b.w / 2, -b.h, b.w, b.h); }
  }
  g.restore();
  hpBar(e.x - ox - 12, e.y - b.h - 10, 24, e.hp / e.max, '#ff5a4e');
  if (b.boss) { g.fillStyle = '#ff5a4e'; g.font = '700 11px "Chakra Petch"'; g.fillText(b.name.toUpperCase(), e.x - ox - 20, e.y - b.h - 16); }
}
// Mara's muzzle flash: short-lived starburst in world space; skipped under reduced motion, photosensitive mode or 0% flash intensity; capped at 8
function muzzle(x, y, dir, sc) {
  if (prefs.rm || prefs.ps || prefs.fx <= 0) return;
  fx.muz = fx.muz || [];
  if (fx.muz.length >= 8) fx.muz.shift();
  fx.muz.push({ x, y, dir: dir || 1, t: 0.07, sc: !!sc });
}
function tracer(x1, y1, x2, y2, c, sc) { if (prefs.rm) return; if (fx.tracers.length >= 60) fx.tracers.shift(); fx.tracers.push({ x1, y1, x2, y2, c, t: 0.09, sc: !!sc }); }
// Shared particle budget: 300 normally, 120 under Reduced motion / Low effects. Returns how many more may be spawned.
function partRoom(n) { const cap = (prefs.rm || prefs.le) ? 120 : 300; return Math.max(0, Math.min(n, cap - fx.parts.length)); }
function burst(x, y, c, n, sc) { n = partRoom(n); for (let i = 0; i < n; i++) fx.parts.push({ x, y, vx: rnd(-90, 90), vy: rnd(-140, 10), t: rnd(0.3, 0.7), c, sc: !!sc }); }
// Rubble chunks: heavier, bigger, land on the given floor line and skid. Half as many under Reduced motion, no spray.
function fxRubble(x, y, n, floorY) {
  if (prefs.rm) n = Math.ceil(n / 2);
  n = partRoom(n);
  const fl = typeof floorY === 'number' ? floorY : FLOORS[0] - 2;
  const sp = prefs.rm ? 0.4 : 1;
  for (let i = 0; i < n; i++) fx.parts.push({ x: x + rnd(-10, 10), y: y + rnd(-6, 6), vx: rnd(-70, 70) * sp, vy: rnd(-120, -10) * sp, t: rnd(0.9, 1.6), c: i % 3 ? '#6b5f52' : '#8a7a66', s: Math.round(rnd(3, 6)), fl, sc: false });
}
// Falling grit from the ceiling: tiny specks. Skipped entirely under Reduced motion.
function fxGrit(cx, cy, n, spread) {
  if (prefs.rm) return;
  n = partRoom(n);
  for (let i = 0; i < n; i++) fx.parts.push({ x: cx + rnd(-spread, spread), y: cy + rnd(-6, 6), vx: rnd(-6, 6), vy: rnd(0, 30), t: rnd(0.7, 1.4), c: i % 2 ? '#6f6254' : '#9a8a74', s: 2, sc: false });
}
// Topside loot pickup feedback: one coloured floating line per resource + a sparkle.
// Reduced motion: text stays put (no drift) and sparkles are skipped. Low effects: sparkles skipped.
const LOOT_COL = { food: '#9fdc7a', scrap: '#d8d2c4', parts: '#8fc4ff', elec: '#ffe46b', mat: '#e0a46a' };
function lootPop(x, y, items) {
  items.forEach((it, i) => {
    if (fx.nums.length > 60) fx.nums.shift();
    fx.nums.push({ x, y: y - i * 14, t: 1.5, s: it[0], scav: true, wide: true, col: LOOT_COL[it[1]] || '#ffd696', still: !!prefs.rm });
  });
  if (prefs.rm || prefs.le) return;
  for (let i = 0; i < 7; i++) {
    if (fx.sprk.length >= 60) fx.sprk.shift();
    const a = Math.random() * Math.PI * 2, sp = rnd(25, 80);
    fx.sprk.push({ x: x + rnd(-10, 10), y: y + 24 + rnd(-8, 8), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 30, t: rnd(0.4, 0.8), t0: 0.8, ph: rnd(0, 6), sc: true });
  }
}
// Dust puff and sparks (fewer in Reduced motion; particle list capped)
function fxDust(x, y, n) { if (prefs.rm) n = Math.ceil(n / 2); n = partRoom(n); for (let i = 0; i < n; i++) fx.parts.push({ x: x + rnd(-6, 6), y: y + rnd(-4, 4), vx: rnd(-45, 45), vy: rnd(-90, -20), t: rnd(0.4, 0.9), c: i % 2 ? '#a8957a' : '#7d6c58', sc: false }); }
function fxSparks(x, y, n, dir) { if (prefs.rm) n = Math.ceil(n / 2); n = partRoom(n); for (let i = 0; i < n; i++) fx.parts.push({ x, y, vx: (dir || 0) * rnd(60, 200) + rnd(-80, 80), vy: rnd(-170, -30), t: rnd(0.15, 0.4), c: i % 2 ? '#ffd27a' : '#ff8a3a', sc: false }); }
// Shell casing: capped at 40 (oldest dropped); skipped in Reduced motion
function fxCasing(x, y) {
  if (prefs.rm) return;
  if (fx.casings.length >= 40) fx.casings.shift();
  fx.casings.push({ x, y, vx: rnd(-70, -20), vy: rnd(-150, -80), r: rnd(0, 6), vr: rnd(-12, 12), t: rnd(1.2, 2), b: 0 });
}
// Enemy hit sparks: fly back toward the turrets; more on a crit; skipped if the particle list is busy
function fxHit(x, y, crit) {
  if (prefs.rm || prefs.ps || prefs.fx <= 0 || scene !== 'bunker' || fx.parts.length > 250) return;
  let n = Math.max(1, Math.round((crit ? 7 : 3) * Math.min(1, prefs.fx))); if (prefs.rm) n = Math.ceil(n / 2);
  n = partRoom(n);
  for (let i = 0; i < n; i++) fx.parts.push({ x, y: y + rnd(-6, 6), vx: -rnd(40, 190), vy: rnd(-150, -10), t: rnd(0.12, 0.32), c: crit ? (i % 2 ? '#ffffff' : '#ffe08a') : (i % 2 ? '#ffd27a' : '#ff8a3a'), sc: false });
}
function drawFx(ox, scOnly) {
  const sc = !!scOnly;
  if (fx.muz && !prefs.rm && !prefs.ps && prefs.fx > 0) for (const m of fx.muz) if (m.sc === sc) {
    const a = clamp(m.t / 0.07, 0, 1), mx = m.x - ox;
    g.globalAlpha = (0.4 + 0.6 * a) * Math.min(1, prefs.fx);
    g.fillStyle = '#ff9a3a'; g.beginPath(); g.moveTo(mx, m.y - 4); g.lineTo(mx + m.dir * 14, m.y); g.lineTo(mx, m.y + 4); g.closePath(); g.fill();
    g.fillStyle = '#ffe08a'; g.beginPath(); g.arc(mx, m.y, 4, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(mx, m.y, 1.8, 0, 7); g.fill();
    g.globalAlpha = 1;
  }
  for (const t of fx.tracers) if (t.sc === sc) { g.strokeStyle = t.c; g.globalAlpha = clamp(t.t / 0.09, 0, 1); g.lineWidth = 1.5; g.beginPath(); g.moveTo(t.x1 - ox, t.y1); g.lineTo(t.x2 - ox, t.y2); g.stroke(); }
  g.globalAlpha = 1;
  for (const p of fx.parts) if (p.sc === sc) { g.fillStyle = p.c; const ps = p.s || 3; g.fillRect(p.x - ox, p.y, ps, ps); }
  if (!sc) for (const c of fx.casings) { g.save(); g.translate(c.x - ox, c.y); g.rotate(c.r); g.globalAlpha = clamp(c.t / 0.5, 0, 1); g.fillStyle = '#d9a441'; g.fillRect(-2, -1, 4, 2); g.restore(); }
  g.globalAlpha = 1;
  for (const b of fx.bullets) if ((b.world === 'scav') === sc) { const sp = Math.hypot(b.vx, b.vy || 0) || 1, ux = b.vx / sp, uy = (b.vy || 0) / sp; g.strokeStyle = '#ffe08a'; g.lineWidth = 2; g.beginPath(); g.moveTo(b.x - ox - ux * 5, b.y - uy * 5); g.lineTo(b.x - ox + ux * 5, b.y + uy * 5); g.stroke(); }
  // lock-on reticle around the enemy Mara would shoot
  if ((scene === 'scav') === sc && !placing && !itemTool && !digTool && !bcam.overview && !P.auto) { const t = aimTarget(); if (t) { const e = t.e, h = ENEMIES[e.type].h, w = ENEMIES[e.type].w, x = e.x - ox, y = e.y - h / 2, r = Math.max(w, h) / 2 + 6, q = r * 0.45; g.strokeStyle = '#ff5a4e'; g.lineWidth = 2; g.beginPath(); for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { g.moveTo(x + sx * r, y + sy * (r - q)); g.lineTo(x + sx * r, y + sy * r); g.lineTo(x + sx * (r - q), y + sy * r); } g.stroke(); g.fillStyle = '#ff5a4e'; g.fillRect(x - 1.5, y - 1.5, 3, 3); } }
  if (!prefs.rm && !prefs.le) for (const s of fx.sprk) if (s.sc === sc) {
    const tw = 0.5 + 0.5 * Math.sin(s.ph + s.t * 30), r = 1 + 2.5 * tw;
    g.globalAlpha = clamp(s.t / 0.3, 0, 1) * (0.5 + 0.5 * tw); g.fillStyle = '#fff3b0';
    const px = s.x - ox; g.fillRect(px - r, s.y - 0.5, r * 2, 1); g.fillRect(px - 0.5, s.y - r, 1, r * 2);
  }
  g.globalAlpha = 1;
  g.font = '700 12px "IBM Plex Sans"';
  for (const n of fx.nums) if (n.col && !!n.scav === sc) { g.font = n.big ? '700 16px "IBM Plex Sans"' : '700 12px "IBM Plex Sans"'; g.globalAlpha = clamp(n.t / 0.6, 0, 1); g.fillStyle = '#000'; const w = g.measureText(String(n.s)).width; g.fillText(n.s, n.x - ox - w / 2 + 1, n.y + 1); g.fillStyle = n.col; g.fillText(n.s, n.x - ox - w / 2, n.y); g.globalAlpha = 1; }
  g.font = '700 12px "IBM Plex Sans"'; for (const n of fx.nums) if (!n.col && !!n.scav === sc) { g.fillStyle = n.wide ? 'rgba(255,214,150,' + clamp(n.t, 0, 1) + ')' : 'rgba(255,240,200,' + clamp(n.t / 0.7, 0, 1) + ')'; const w = g.measureText(String(n.s)).width; g.fillText(n.s, n.x - ox - w / 2, n.y); }
}
function fxTick(dt) {
  for (const t of fx.tracers) t.t -= dt; fx.tracers = fx.tracers.filter(t => t.t > 0);
  if (fx.muz) { for (const m of fx.muz) m.t -= dt; fx.muz = fx.muz.filter(m => m.t > 0); }
  for (const p of fx.parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 400 * dt; p.t -= dt; if (p.fl !== undefined && p.y >= p.fl) { p.y = p.fl; p.vy = 0; p.vx *= 0.5; if (p.t > 0.3) p.t = 0.3; } } fx.parts = fx.parts.filter(p => p.t > 0);
  for (const c of fx.casings) {
    c.x += c.vx * dt; c.y += c.vy * dt; c.vy += 600 * dt; c.r += c.vr * dt; c.t -= dt;
    const fl = FLOORS[0] - 2;
    if (c.y > fl) { c.y = fl; if (c.b < 1 && c.vy > 60) { c.vy *= -0.35; c.vx *= 0.5; c.b++; if (scene === 'bunker' && window.SFX && SFX.shell) SFX.shell(); } else { c.vy = 0; c.vx = 0; c.vr = 0; } }
  }
  fx.casings = fx.casings.filter(c => c.t > 0);
  for (const n of fx.nums) { if (!n.still) n.y -= 24 * dt; n.t -= dt; } fx.nums = fx.nums.filter(n => n.t > 0);
  for (const s of fx.sprk) { s.x += s.vx * dt; s.y += s.vy * dt; s.vx *= 0.96; s.vy = s.vy * 0.96 + 20 * dt; s.t -= dt; } fx.sprk = fx.sprk.filter(s => s.t > 0);
}
// Parallax ridge silhouettes: depth is the camera-scroll factor, base is the ridge's mean y.
function drawScavRidge(ox, depth, base, amp, step, color) {
  const sh = ox * depth;
  g.fillStyle = color; g.beginPath(); g.moveTo(0, SC_GROUND);
  for (let x = 0; x <= W + step; x += step) {
    const wx = x + sh;
    const y = base - amp * (0.55 * Math.sin(wx * 0.004 + depth * 20) + 0.3 * Math.sin(wx * 0.011 + depth * 7) + 0.15 * Math.sin(wx * 0.027));
    g.lineTo(x, y);
  }
  g.lineTo(W + step, SC_GROUND); g.closePath(); g.fill();
}
// Drifting ash: computed from the clock, no state. Static and thinner with reduced motion.
function drawScavAsh(ox) {
  const t = performance.now() / 1000, n = prefs.rm ? 24 : 70;
  g.fillStyle = 'rgba(205,195,185,0.5)';
  for (let i = 0; i < n; i++) {
    const r1 = (Math.sin(i * 127.1 + 1.3) * 43758.5453) % 1, r2 = (Math.sin(i * 311.7 + 7.1) * 12543.123) % 1;
    const a = Math.abs(r1), b = Math.abs(r2), near = i % 3 === 0, depth = near ? 0.9 : 0.5;
    const speed = prefs.rm ? 0 : (near ? 38 : 20) * (0.6 + b), fall = prefs.rm ? 0 : (near ? 26 : 14) * (0.5 + a);
    let x = (a * (W + 200) - ox * depth - t * speed) % (W + 200); if (x < 0) x += W + 200;
    let y = (b * H + t * fall + (prefs.rm ? 0 : Math.sin(t * 0.8 + i) * 8)) % H;
    const s = near ? 2.2 : 1.4;
    g.globalAlpha = near ? 0.55 : 0.35;
    g.fillRect(x - 100, y, s, s);
  }
  g.globalAlpha = 1;
}
// Far ruined skyline: tiled, deterministic, parallax plus slow self-drift (no drift with reduced motion).
function drawScavSkyline(ox) {
  const t = (prefs.rm || prefs.le) ? 0 : performance.now() / 1000, TILE = 1800, N = 22;
  const off = ox * 0.18 + t * 6;
  g.fillStyle = 'rgba(38,29,30,.55)';
  for (let i = 0; i < N; i++) {
    const h1 = Math.abs((Math.sin(i * 12.9898 + 3.1) * 43758.5453) % 1), h2 = Math.abs((Math.sin(i * 78.233 + 1.7) * 24634.6345) % 1), h3 = Math.abs((Math.sin(i * 39.346 + 5.2) * 9631.1234) % 1);
    const bx = i * (TILE / N), w = 46 + h1 * 60, bh = 110 + h2 * 170, top = SC_GROUND - bh;
    const sx = (((bx - off) % TILE) + TILE) % TILE;
    for (const x of [sx - TILE, sx, sx + TILE]) {
      if (x > W || x + w < 0) continue;
      g.beginPath(); g.moveTo(x, SC_GROUND); g.lineTo(x, top + h3 * 24); g.lineTo(x + w * 0.35, top - h3 * 18); g.lineTo(x + w * 0.6, top + 14 + h1 * 20); g.lineTo(x + w, top + h2 * 16); g.lineTo(x + w, SC_GROUND); g.closePath(); g.fill();
    }
  }
}
// Dust haze: a horizon band plus big soft drifting blobs. front=true is the fainter near layer.
function drawScavHaze(ox, front) {
  const t = (prefs.rm || prefs.le) ? 0 : performance.now() / 1000, span = W + 600;
  const a = front ? 0.07 : 0.12;
  const gr = g.createLinearGradient(0, SC_GROUND - 170, 0, SC_GROUND);
  gr.addColorStop(0, 'rgba(160,125,90,0)'); gr.addColorStop(1, 'rgba(160,125,90,' + (a * 1.6) + ')');
  g.fillStyle = gr; g.fillRect(0, SC_GROUND - 170, W, 170);
  g.fillStyle = 'rgba(175,140,100,' + a + ')';
  const n = front ? 3 : 4, depth = front ? 0.55 : 0.3;
  for (let i = 0; i < n; i++) {
    let x = (i * (span / n) + (front ? 120 : 0) - ox * depth - t * (front ? 22 : 12) * (1 + i * 0.3)) % span; if (x < 0) x += span;
    g.beginPath(); g.ellipse(x - 300, SC_GROUND - (front ? 40 : 90) - i * 14, 260 + i * 40, front ? 34 : 46, 0, 0, 7); g.fill();
  }
}
// Foreground debris: deterministic rubble silhouettes in the ground strip, scrolling faster than the camera (1.35x).
function drawScavDebris(ox) {
  const TILE = 2600, N = 16, off = ox * 1.35;
  g.save();
  for (let i = 0; i < N; i++) {
    const h1 = Math.abs((Math.sin(i * 17.31 + 2.2) * 43758.5453) % 1), h2 = Math.abs((Math.sin(i * 59.17 + 0.9) * 24634.6345) % 1), h3 = Math.abs((Math.sin(i * 91.7 + 4.4) * 9631.1234) % 1);
    const bx = i * (TILE / N) + h1 * 60, sx = (((bx - off) % TILE) + TILE) % TILE;
    const kind = i % 3, w = 40 + h2 * 90, y0 = SC_GROUND + 14 + h3 * 70;
    for (const x of [sx - TILE, sx, sx + TILE]) {
      if (x > W + 40 || x + w < -40) continue;
      g.fillStyle = 'rgba(14,10,8,.92)';
      if (kind === 0) { // broken slab
        g.beginPath(); g.moveTo(x, y0 + 26); g.lineTo(x + w * 0.2, y0 - 8 - h1 * 14); g.lineTo(x + w * 0.75, y0 - 2); g.lineTo(x + w, y0 + 26); g.closePath(); g.fill();
      } else if (kind === 1) { // tilted rebar
        g.strokeStyle = 'rgba(14,10,8,.92)'; g.lineWidth = 3;
        for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(x + k * 14, y0 + 24); g.lineTo(x + k * 14 + 8 + h2 * 10, y0 - 22 - h1 * 20 + k * 4); g.stroke(); }
        g.fillRect(x - 4, y0 + 20, 48, 8);
      } else { // rubble pile
        g.beginPath(); g.ellipse(x + w * 0.5, y0 + 22, w * 0.5, 14 + h1 * 8, 0, Math.PI, 0); g.fill();
        g.fillRect(x + w * 0.3, y0 + 14, 14, 12);
      }
    }
  }
  g.restore();
}
// Dusk glow strength 0..1: builds from 16:00, peaks 20:00-21:00 (raid hour), gone by 22:30. Off under reduced motion.
function duskGlow() {
  const h = hourF();
  let a = 0;
  if (h >= 16 && h < 20) a = (h - 16) / 4;
  else if (h >= 20 && h <= RAID_HOUR) a = 1;
  else if (h > RAID_HOUR && h < 22.5) a = 1 - (h - RAID_HOUR) / 1.5;
  return a * a * (3 - 2 * a) * (prefs.rm ? 0.6 : 1); // static (dimmer) under reduced motion; the tint never animates
}
function drawScavDuskGlow(dusk) {
  if (dusk <= 0) return;
  const top = SC_GROUND - 330;
  const gr = g.createLinearGradient(0, top, 0, SC_GROUND);
  gr.addColorStop(0, 'rgba(255,90,40,0)');
  gr.addColorStop(0.6, 'rgba(255,110,50,' + (0.28 * dusk) + ')');
  gr.addColorStop(1, 'rgba(255,170,80,' + (0.5 * dusk) + ')');
  g.fillStyle = gr; g.fillRect(0, top, W, SC_GROUND - top);
  const sg = g.createRadialGradient(W * 0.72, SC_GROUND, 10, W * 0.72, SC_GROUND, 380);
  sg.addColorStop(0, 'rgba(255,150,70,' + (0.35 * dusk) + ')'); sg.addColorStop(1, 'rgba(255,150,70,0)');
  g.fillStyle = sg; g.fillRect(0, SC_GROUND - 380, W, 380);
}
function drawScav() {
  const ox = scav.cam, sky = skyColors();
  let gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, sky.top); gr.addColorStop(1, sky.bot);
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  if (sky.dayAmt < 0.6) { g.fillStyle = 'rgba(255,240,220,' + (0.6 - sky.dayAmt) + ')'; for (const s of stars) { g.beginPath(); g.arc(s.x, s.y, s.r, 0, 7); g.fill(); } }
  const dusk = duskGlow();
  drawScavDuskGlow(dusk);
  if (!prefs.hc) { drawScavRidge(ox, 0.12, 470, 70, 24, 'rgba(58,44,40,.55)'); drawScavRidge(ox, 0.25, 520, 55, 20, 'rgba(46,35,31,.65)'); }
  if (!prefs.hc) { drawScavSkyline(ox); drawScavHaze(ox, false); }
  // far ruins (parallax), the broken highway, near ruins
  for (const r of scav.ruins) { const x = r.x - ox * 0.4; if (x < -200 || x > W + 200) continue; g.fillStyle = r.c > 0.5 ? 'rgba(52,38,30,.8)' : 'rgba(44,32,26,.7)'; g.fillRect(x, SC_GROUND - r.h - 40, r.w, r.h + 40); g.fillStyle = 'rgba(255,190,110,.08)'; for (let wy = SC_GROUND - r.h; wy < SC_GROUND - 30; wy += 26) g.fillRect(x + 8, wy, 8, 10); }
  g.fillStyle = '#3e3026'; for (let x = -((ox * 0.7) % 220); x < W; x += 220) { g.fillRect(x, 420, 160, 14); g.fillRect(x + 60, 434, 16, 186); }
  if (!prefs.hc) drawScavHaze(ox, true);
  // dusk wash over the parallax layers only (drawn before ground and gameplay objects)
  if (dusk > 0 && !prefs.hc) { g.fillStyle = 'rgba(190,70,40,' + (0.14 * dusk) + ')'; g.fillRect(0, 0, W, SC_GROUND); }
  // ground
  g.fillStyle = '#5a4532'; g.fillRect(0, SC_GROUND, W, 8); g.fillStyle = '#2c2118'; g.fillRect(0, SC_GROUND + 8, W, H);
  // platforms
  for (const p of scav.plats) { const x = p.x - ox; if (x > W || x + p.w < 0) continue; box(x, p.y, p.w, 10, '#6a5640'); box(x + 6, p.y + 10, 8, SC_GROUND - p.y - 10, '#3d3226'); box(x + p.w - 14, p.y + 10, 8, SC_GROUND - p.y - 10, '#3d3226'); }
  // crates
  for (const c of scav.crates) {
    const x = c.x - ox; if (x < -40 || x > W + 40) continue;
    if (c.kind === 'car') { box(x - 30, c.y - 20, 60, 16, c.open ? '#3a3028' : '#6a4a3a'); box(x - 18, c.y - 30, 32, 10, c.open ? '#30281f' : '#5a3d30'); g.fillStyle = '#1a1410'; g.beginPath(); g.arc(x - 18, c.y - 4, 5, 0, 7); g.arc(x + 18, c.y - 4, 5, 0, 7); g.fill(); }
    else if (c.kind === 'locker') box(x - 10, c.y - 34, 20, 34, c.open ? '#3a3a3a' : '#5f6a70');
    else if (c.kind === 'shelf') { box(x - 14, c.y - 36, 28, 36, c.open ? '#2e2a24' : '#7a6a50'); box(x - 12, c.y - 26, 24, 3, '#3a3226'); box(x - 12, c.y - 14, 24, 3, '#3a3226'); }
    else if (c.kind === 'till') { box(x - 16, c.y - 22, 32, 22, c.open ? '#2c2c30' : '#56606a'); box(x - 8, c.y - 30, 16, 8, c.open ? '#26262a' : '#7a8a96'); }
    else box(x - 12, c.y - 20, 24, 20, c.open ? '#3a2e22' : '#8a6a42');
    if (!c.open) { g.fillStyle = '#ffb347'; g.fillRect(x - 2, c.y - (c.kind === 'locker' ? 46 : c.kind === 'car' ? 40 : 30), 4, 4); }
  }
  // the way home
  { const hx = scav.flip ? scav.home - 68 : 8; box(hx + (scav.flip ? 48 : 12) - ox, SC_GROUND - 60, 6, 60, '#7a6650'); box(hx - ox, SC_GROUND - 66, 60, 16, '#4a3a28'); }
  g.fillStyle = '#ffd59a'; g.font = '600 11px "Chakra Petch"'; g.fillText(scav.flip ? 'BUNKER →' : '← BUNKER', (scav.flip ? scav.home - 62 : 12) - ox, SC_GROUND - 54);
  if (scav.wanderer && !scav.wanderer.gone) { const w = scav.wanderer; drawPerson(w.x - ox, w.y, w.s.color, w.s.accent, null, performance.now() / 300, -1, false, false); g.fillStyle = '#ffe0a8'; g.font = '600 11px "IBM Plex Sans"'; g.fillText('?', w.x - ox - 3, w.y - 44); }
  drawHazards(ox);
  for (const e of scav.enemies) drawEnemy(e, ox);
  if (!S.player.down) { g.save(); g.translate(-ox, 0); drawMara(); g.restore(); }
  drawFx(ox, true);
  if (!prefs.hc) drawScavDebris(ox);
  if (!prefs.hc && !prefs.rm && !prefs.le) drawScavAsh(ox);
  if (sky.dayAmt < 1) { g.fillStyle = 'rgba(5,6,18,' + (0.5 * (1 - sky.dayAmt)) + ')'; g.fillRect(0, 0, W, H); }
  lampTick();
  drawScavLantern(ox);
  drawScavCompass(ox);
  drawScavMap();
  drawScavPrompt(ox);
  drawHurtVignette();
}

// World-space interact prompt: floats above the lootable crate (or above Mara) when interactable() has something to offer.
function drawScavPrompt(ox) {
  if (!scav || !S || S.player.down) return;
  const it = interactable(); if (!it) return;
  const c = scav.crates.find(c => !c.open && Math.abs(c.x - P.x) < 30 && Math.abs(c.y - P.y) < 30);
  const ax = (c ? c.x : P.x) - ox, ay = c ? c.y - 62 : P.y - 74;
  const txt = it.act ? it.text.replace(/^E · /, '') : it.text;
  g.save();
  g.font = '600 12px "Chakra Petch", sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'left';
  const key = it.act ? keyLabel(BIND.interact) : '';
  const kw = key ? g.measureText(key).width + 12 : 0, tw = g.measureText(txt).width;
  const bw = kw + tw + 16, bx = clamp(ax - bw / 2, 6, W - bw - 6);
  g.fillStyle = 'rgba(10,8,6,.82)'; g.fillRect(bx, ay - 12, bw, 24);
  g.strokeStyle = it.act ? '#ffd59a' : '#c66'; g.lineWidth = 1; g.strokeRect(bx + 0.5, ay - 11.5, bw - 1, 23);
  let tx = bx + 8;
  if (key) { g.fillStyle = '#ffd59a'; g.fillRect(tx, ay - 9, kw, 18); g.fillStyle = '#1a1208'; g.fillText(key, tx + 6, ay); tx += kw + 6; }
  g.fillStyle = '#ffe0a8'; g.fillText(txt, tx, ay);
  g.restore();
}
// Edge-of-screen arrows to the bunker door and the level exit (if any), with distance in metres.
function drawScavCompass(ox) {
  const targets = [{ x: scav.home + (scav.flip ? -40 : 40), label: 'BUNKER', color: '#ffd59a' }];
  if (scav.exit && typeof scav.exit.x === 'number') targets.push({ x: scav.exit.x, label: 'EXIT', color: '#9fe8a0' });
  const rowY = { BUNKER: SC_GROUND - 130, EXIT: SC_GROUND - 170 };
  g.save();
  g.font = '600 12px "Chakra Petch", sans-serif';
  g.textBaseline = 'middle';
  for (const t of targets) {
    const sx = t.x - ox;
    if (sx >= 0 && sx <= W) continue; // on screen: no arrow needed
    const dir = sx < 0 ? -1 : 1;
    const dist = Math.round(Math.abs(t.x - P.x) / 10);
    const txt = t.label + ' ' + dist + 'm';
    const tw = g.measureText(txt).width;
    const y = rowY[t.label] || SC_GROUND - 130;
    const ax = dir < 0 ? 14 : W - 14;
    const bx = dir < 0 ? ax + 14 : ax - 14 - tw - 12;
    g.fillStyle = 'rgba(10,8,6,.7)';
    g.fillRect(bx - 2, y - 12, tw + 16, 24);
    g.fillStyle = t.color;
    g.beginPath();
    g.moveTo(ax + dir * 10, y); g.lineTo(ax - dir * 8, y - 10); g.lineTo(ax - dir * 8, y + 10);
    g.closePath(); g.fill();
    g.fillText(txt, bx + 4, y);
  }
  g.restore();
}

// ---------------------------------------------------------------- 6. UI panels and input
const logs = [];
let quiet = false;
// ---- event log: persistent history (per run) with optional camera locations ----
let events = [], evRid = null, evSeq = 0, lampLoc = null;
const EV_MAX = 100;
function atLoc(loc) { lampLoc = loc; }
// (toast is a top-level function in a classic script, so it is already window.toast; wrapping it here made it call itself forever)
// lost/downed survivors share the one toast stack
function toastFeed(kind, text, loc) {
  if (quiet) return;
  toast(text, kind === 'down' ? 'warn' : 'bad', loc);
}
function downedFx(text) {
  if (window.SFX && SFX.survivorDowned) SFX.survivorDowned();
  if (text) toastFeed('down', text, null);
}
function logEvent(kind, text, loc) {
  if (!S) return null;
  if (evRid !== S.rid) { evRid = S.rid; events = []; }
  const m = Math.floor(S.t) % 1440, hh = String(Math.floor(m / 60)).padStart(2, '0'), mm = String(m % 60).padStart(2, '0');
  const ev = { id: ++evSeq, kind: kind || '', text, loc: loc || null, when: 'D' + (Math.floor(S.t / 1440) + 1) + ' ' + hh + ':' + mm };
  events.push(ev); if (events.length > EV_MAX) events.shift();
  if (tab === 'log') renderDrawer();
  return ev;
}
function jumpTo(loc) {
  if (!loc || scene !== 'bunker') return;
  if (loc.reset) { bcamReset(); return; }
  if (loc.id) { bcamFocus(loc.id); return; }
  bcam.follow = null; bcam.cx = loc.x; bcam.cy = loc.y; bcam.tz = Math.max(bcam.tz, 1.8);
}
function sickEvent(c) { atLoc({ x: c.x, y: c.y }); lamp(c.name + ' has fallen sick.', 'warn'); }
// Single source of truth for 'low' so the HUD and the one-time Lamp warning agree.
function resLim(k) { return k === 'food' ? living().length * 2 : 5; }
function resLow(k) { return S.res[k] < resLim(k); }
// Power is not a stock: it is low when the generator is dark or about to run on battery only.
function powerLow() { return !!S.rooms.generator && (!S.powered || S.res.scrap < ROOM_FX.fuelPerHour * 2); }
function powerHud() {
  if (!S.rooms.generator) return '';
  const low = powerLow(), out = !S.powered;
  const tip = out ? 'Power is out: the generator needs scrap' : low ? 'Power is low: generator fuel (scrap) is nearly gone' : 'Generator running';
  return `<span class="${low ? 'lowres' : ''}" title="${tip}"><i style="background:#ffe066"></i>${low ? '<em class="lowico" aria-hidden="true">&#9888;</em>' : ''}Power <b class="${low ? 'low' : ''}">${out ? 'OFF' : (S.batt > 0 && S.res.scrap < ROOM_FX.fuelPerHour * 2 ? 'BATT' : 'ON')}</b>${low ? '<em class="lowtag">LOW</em>' : ''}</span>`;
}
function elecHint(full) {
  const have = Math.floor(S.res.elec);
  let t = null;
  for (let i = S.tower.paid ? S.tower.done + 1 : S.tower.done; i < TOWER.length; i++) if (TOWER[i].cost.elec) { t = TOWER[i]; break; }
  const need = t ? t.cost.elec : 0;
  let raid;
  if (S.enemies.length || S.spawns.length) raid = 'A raid is underway now.';
  else { const m = Math.round(((RAID_HOUR - hourF() + 24) % 24) * 60); raid = 'Next raid in ' + (m >= 60 ? Math.floor(m / 60) + 'h ' : '') + (m % 60) + 'm.'; }
  const tower = t ? ' The ' + t.name + ' needs ' + need + ' electronics; you have ' + have + (have >= need ? ' (enough).' : ' (' + (need - have) + ' short).') : ' The tower needs no more electronics.';
  return (full ? 'Electronics are running low. ' : '') + 'Electronics only come from scavenging topside.' + tower + ' ' + raid;
}
function lowResCheck() {
  S.lowFlag = S.lowFlag || {};
  for (const r of RES) {
    const lim = r.k === 'food' ? living().length * 2 : 5;
    const low = S.res[r.k] < lim;
    if (low && !S.lowFlag[r.k]) { S.lowFlag[r.k] = true; toast('Low on ' + r.name.toLowerCase() + ': ' + Math.floor(S.res[r.k]) + ' left', 'warn'); atLoc({ reset: true }); lamp(r.k === 'elec' ? elecHint(true) : 'Low on ' + r.name.toLowerCase() + ': ' + Math.floor(S.res[r.k]) + ' left.', 'warn'); }
    else if (!low && S.lowFlag[r.k] && S.res[r.k] >= lim * 1.25) S.lowFlag[r.k] = false;
  }
}
let evOpen = true, evFilter = 'all';
try { const p = JSON.parse(localStorage.getItem('ab_evlog') || '{}') || {}; if (p.open === false) evOpen = false; if (['all', 'raid', 'death', 'arrival', 'revolt'].includes(p.filter)) evFilter = p.filter; } catch (e) {}
function evSave() { try { localStorage.setItem('ab_evlog', JSON.stringify({ open: evOpen, filter: evFilter })); } catch (e) {} }
const EV_CATS = { raid: 'RAID', death: 'DEATH', arrival: 'ARRIVAL', revolt: 'REVOLT', info: 'INFO' };
function evCat(e) {
  if (EV_CATS[e.kind]) return e.kind;
  const t = String(e.text || '').toLowerCase();
  if (/revolt|mutin|desert|sabotag|rebel|slipped out/.test(t)) return 'revolt';
  if (/died|dead|death|killed|has fallen|is lost|were lost|perish|downed|slain/.test(t)) return 'death';
  if (/arriv|wanderer|newcomer|joined|recruit|survivors? (?:at|outside)/.test(t)) return 'arrival';
  if (/raid|wave|hostile|breach|hatch|door|turret|attack|raider/.test(t)) return 'raid';
  return 'info';
}
function logHTML() {
  const cats = events.map(evCat), cnt = { all: events.length };
  for (const c of cats) cnt[c] = (cnt[c] || 0) + 1;
  const chip = (k, label) => `<button type="button" class="evchip${evFilter === k ? ' on' : ''}" data-evf="${k}" aria-pressed="${evFilter === k}">${label} ${cnt[k] || 0}</button>`;
  let h = `<div class="evhead"><button type="button" class="evtoggle" data-evtoggle="1" aria-expanded="${evOpen}" aria-controls="evlist">${evOpen ? '\u25BE' : '\u25B8'} Event log (${events.length})</button></div>`;
  if (!evOpen) return h;
  h += '<div class="evchips" role="group" aria-label="Filter events">' + chip('all', 'All') + chip('raid', 'Raid') + chip('death', 'Death') + chip('arrival', 'Arrival') + chip('revolt', 'Revolt') + '</div>';
  const rows = events.map((e, i) => ({ e, c: cats[i] })).filter(r => evFilter === 'all' || r.c === evFilter).reverse();
  if (!rows.length) return h + '<p class="note">' + (events.length ? 'No events in this category.' : 'Nothing has happened yet.') + '</p>';
  return h + '<div class="evlog" id="evlist" role="log" aria-live="off" aria-label="Event log, newest first">' + rows.map(({ e, c }) => `<div class="ev ${e.kind}${e.loc ? ' go' : ''}" data-cat="${c}"${e.loc ? ` data-ev="${e.id}" tabindex="0" role="button" title="Click to jump"` : ''}><span class="evt">${e.when}</span><span class="evtag">${EV_CATS[c]}</span> ${esc(e.text)}${e.loc ? ' <em aria-hidden="true">\u2197</em>' : ''}</div>`).join('') + '</div>';
}
$('#dbody').addEventListener('click', e => {
  const t = e.target.closest('[data-evtoggle]'), f = e.target.closest('[data-evf]');
  if (t) { evOpen = !evOpen; evSave(); renderDrawer(); const b = $('#dbody').querySelector('[data-evtoggle]'); if (b) b.focus(); }
  else if (f) { evFilter = f.dataset.evf; evSave(); renderDrawer(); const b = $('#dbody').querySelector('[data-evf="' + evFilter + '"]'); if (b) b.focus(); }
});
$('#dbody').addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.ev[data-ev]')) { e.preventDefault(); e.target.click(); }
});
// Lamp messages are staggered: each one holds the queue long enough to be read and spoken.
const LAMP_BASE_MS = 1200, LAMP_PER_CHAR_MS = 65, LAMP_MIN_MS = 3000, LAMP_QUEUE_MAX = 5;
const LAMP_URGENT = /door_breach|victory|defeat/;
let lampQ = [], lampBusyUntil = 0, lampTimer = null, lampRid = null, lampCurVoiced = false;
// Show a queued line right away without holding the queue (used when plain text overflows it).
function lampShowNow(it) { lampHistAdd(it.text, it.kind); logs.push({ text: it.text, kind: it.kind, at: performance.now(), ev: it.ev }); if (logs.length > LOG_MAX) logs.shift(); renderLog(); }
function lampPump() {
  lampTimer = null;
  while (lampQ.length && S && S.rid !== lampQ[0].rid) lampQ.shift();
  if (!lampQ.length) return;
  const now = performance.now();
  if (now < lampBusyUntil) { lampTimer = setTimeout(lampPump, lampBusyUntil - now); return; }
  const it = lampQ.shift();
  lampHistAdd(it.text, it.kind); logs.push({ text: it.text, kind: it.kind, at: now, ev: it.ev }); if (logs.length > LOG_MAX) logs.shift(); renderLog();
  if (typeof narrShowText === 'function') narrShowText(it.text);
  if (it.clip) narrPlay(it.clip);
  lampCurVoiced = !!it.clip;
  lampBusyUntil = now + Math.max(LAMP_MIN_MS, LAMP_BASE_MS + it.text.length * LAMP_PER_CHAR_MS);
  if (lampQ.length) lampTimer = setTimeout(lampPump, lampBusyUntil - now);
}
function lamp(text, kind = '', delayMs = 0, clip = null) {
  const loc = lampLoc; lampLoc = null;
  if (quiet) return;
  const ev = logEvent(kind, text, loc);
  if ((kind === 'warn' && S && !S.over) || TOAST_RE.test(text)) toast(text, kind, loc);
  const rid = S && S.rid;
  const add = () => {
    if (S && S.rid !== rid) return;
    if (S && S.rid !== lampRid) { lampRid = S.rid; lampQ = []; lampBusyUntil = 0; }
    if (clip && LAMP_URGENT.test(String(clip))) { lampQ = []; lampBusyUntil = 0; }
    srSay(text, kind);
    // Voiced lines go ahead of plain text and are never the ones dropped: plain chatter used to push them out of
    // the queue, so Lamp went silent in busy moments. Plain lines that overflow still show in the log at once.
    const item = { text, kind, clip, rid, ev };
    if (clip) {
      const i = lampQ.findIndex(x => !x.clip);
      if (i < 0) lampQ.push(item); else lampQ.splice(i, 0, item);
      if (!lampCurVoiced) lampBusyUntil = Math.min(lampBusyUntil, performance.now() + 1500);   // don't make a voice wait long behind plain text
    } else lampQ.push(item);
    while (lampQ.length > LAMP_QUEUE_MAX) {
      const i = lampQ.findIndex(x => !x.clip);
      if (i >= 0) lampShowNow(lampQ.splice(i, 1)[0]); else lampQ.shift();
    }
    if (lampTimer) { clearTimeout(lampTimer); lampTimer = null; }
    lampPump();
  };
  delayMs ? setTimeout(add, delayMs) : add();
}
// ---- toast notifications: stacking, capped, auto-dismiss ----
const TOAST_RE = /did not survive|killed|died|has fallen|asking to stay|follow you home|repaired|rebuilt|recovered|sabotaged|grieving|was caught outside|is now level|downed/i;
const TOAST_MAX = 4, TOAST_MS = 6000, TOAST_FADE_MS = 300;
function toast(text, kind = '', loc = null) {
  let box = document.getElementById('toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts';
    box.setAttribute('aria-hidden', 'true'); // screen readers already get these via srSay
    document.body.appendChild(box);
  }
  const same = Array.from(box.children).find(el => el._txt === text && !el._gone);
  if (same) {
    same._n = (same._n || 1) + 1;
    same.querySelector('.tn').textContent = ' \u00d7' + same._n;
    clearTimeout(same._timer);
    same._timer = setTimeout(() => toastClose(same), TOAST_MS);
    return;
  }
  const el = document.createElement('div');
  el.className = 'toast ' + (kind === 'good' || kind === 'warn' || kind === 'bad' ? kind : '');
  el._txt = text;
  const s = document.createElement('span');
  s.textContent = (kind === 'warn' ? '\u25B2 ' : kind === 'good' ? '\u25CF ' : kind === 'bad' ? '\u25C6 ' : '\u25A0 ') + text + (loc ? ' \u2197' : '');
  const n = document.createElement('span'); n.className = 'tn';
  el.appendChild(s); el.appendChild(n);
  if (loc) { el.title = 'Click to jump'; el.style.cursor = 'pointer'; }
  el.onclick = () => { if (loc) { try { jumpTo(loc); } catch (e) {} } toastClose(el); };
  box.appendChild(el);
  const live = Array.from(box.children).filter(x => !x._gone);
  for (let i = 0; i < live.length - TOAST_MAX; i++) toastClose(live[i], true);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
  el._timer = setTimeout(() => toastClose(el), TOAST_MS);
}
function toastClose(el, now) {
  if (!el || el._gone) return;
  el._gone = true;
  clearTimeout(el._timer);
  el.classList.remove('in');
  el.classList.add('out');
  setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, now ? 0 : TOAST_FADE_MS + 50);
}
const LOG_MAX = 5, LOG_LIFE_MS = 16000;
function renderLog() {
  const box = $('#log'), now = performance.now();
  box.setAttribute('role', 'log'); box.setAttribute('aria-label', 'Event feed'); box.setAttribute('aria-live', 'off');
  box.innerHTML = logs.map(l => `<div class="lg ${esc(l.kind || '')}" style="animation-delay:-${Math.max(0, Math.round(now - l.at))}ms"${l.ev && l.ev.loc ? ` data-ev="${l.ev.id}" title="Click to jump"` : ''}><b>LAMP</b>${esc(l.text)}</div>`).join('')
    + (logs.length ? '<button type="button" class="logclear" data-clear="1" aria-label="Clear event feed">Clear</button>' : '');
}
$('#log').addEventListener('click', e => {
  if (e.target.closest('[data-clear]')) { logs.length = 0; lampQ = []; renderLog(); return; }
  const el = e.target.closest('[data-ev]'); if (!el) return;
  const ev = events.find(x => String(x.id) === el.dataset.ev); if (ev) jumpTo(ev.loc);
});
// ---- Lamp history: scrollable log of every line Lamp has said this run
const lampHist = []; let lampHistRid = null;
function lampHistAdd(text, kind) {
  if (S && S.rid !== lampHistRid) { lampHistRid = S.rid; lampHist.length = 0; }
  let when = '';
  try { const m = Math.floor(S.t % 1440); when = 'Day ' + day() + ' ' + String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); } catch (e) {}
  lampHist.push({ text, kind, when });
  if (lampHist.length > 200) lampHist.shift();
  if (lampHistEl && lampHistEl.classList.contains('on')) lampHistRender();
}
let lampHistEl = null, lampHistBtn = null, lampHistList = null;
function lampHistRender() {
  if (S && S.rid !== lampHistRid) { lampHistRid = S.rid; lampHist.length = 0; }
  lampHistList.innerHTML = lampHist.length ? lampHist.map(h => `<div class="lh ${esc(h.kind || '')}"><span class="lht">${esc(h.when)}</span>${esc(h.text)}</div>`).join('') : '<div class="lh">Lamp has said nothing yet.</div>';
  lampHistList.scrollTop = lampHistList.scrollHeight;
}
function lampHistToggle(open) {
  if (open === undefined) open = !lampHistEl.classList.contains('on');
  if (open) { lampHistRender(); lampHistEl.hidden = false; void lampHistEl.offsetWidth; lampHistEl.classList.add('on'); lampHistList.focus(); }
  else { lampHistEl.classList.remove('on'); setTimeout(() => { if (!lampHistEl.classList.contains('on')) lampHistEl.hidden = true; }, 250); lampHistBtn.focus(); }
  lampHistBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
}
(function initLampHist() {
  lampHistBtn = document.createElement('button');
  lampHistBtn.id = 'lampHistBtn'; lampHistBtn.type = 'button';
  lampHistBtn.textContent = 'Lamp log'; lampHistBtn.title = 'History of Lamp\'s messages';
  lampHistBtn.setAttribute('aria-expanded', 'false'); lampHistBtn.setAttribute('aria-controls', 'lampHist');
  lampHistEl = document.createElement('div');
  lampHistEl.id = 'lampHist'; lampHistEl.hidden = true;
  lampHistEl.setAttribute('role', 'dialog'); lampHistEl.setAttribute('aria-label', 'Lamp message history');
  lampHistEl.innerHTML = '<div class="lhhead"><b>LAMP</b> message history</div><div class="lhlist" role="log" tabindex="0" aria-label="Past Lamp messages"></div>';
  lampHistList = lampHistEl.querySelector('.lhlist');
  document.body.appendChild(lampHistEl); document.body.appendChild(lampHistBtn);
  lampHistBtn.addEventListener('click', () => lampHistToggle());
  setInterval(() => {   // only during play, not over the title or menus
    const on = !!S && (scene === 'bunker' || scene === 'scav');
    lampHistBtn.style.display = on ? '' : 'none';
    if (!on && lampHistEl.classList.contains('on')) { lampHistEl.classList.remove('on'); lampHistEl.hidden = true; lampHistBtn.setAttribute('aria-expanded', 'false'); }
  }, 300);
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && lampHistEl.classList.contains('on')) { e.preventDefault(); e.stopImmediatePropagation(); lampHistToggle(false); return; }
  }, true);
})();
setInterval(() => { const now = performance.now(); const before = logs.length; while (logs.length && now - logs[0].at > 16000) logs.shift(); if (logs.length !== before) renderLog(); }, 1000);

function setSpeed(s) { speed = s; paused = false; renderHud(); }
function nextThreat() {
  if (S.enemies.length) return { hot: true, text: S.enemies.length + ' hostiles' + (S.breached ? ' · HATCH BREACHED' : '') };
  if (S.spawns.length) return { hot: true, text: 'Raid incoming · ' + S.spawns.length + ' to come' };
  const h = hourF(); const to21 = (RAID_HOUR - h + 24) % 24; const m = Math.round(to21 * 60);
  const fc = to21 <= 6 ? raidPlan(day()) : null;
  return { hot: to21 < 1.5, text: 'Next raid in ' + (m >= 60 ? Math.floor(m / 60) + 'h ' : '') + (m % 60) + 'm (' + RAID_CLOCK + ')' + (fc ? ' · ' + fc.length + ' hostiles' : '') };
}
function goalSteps() {
  const d = S.goalDone || (S.goalDone = {});
  const gun = living().some(c => (c.job === 'turretA' || c.job === 'turretB') && turretFor(c.job) && turretFor(c.job).type !== 'coil');
  const t = S.tower || { done: 0, paid: false };
  const defs = [
    ['gun', 'Assign a gunner to a turret (C)', gun],
    ['scav', 'Scavenge topside (walk right)', S.stats.trips > 0],
    ['pay', 'Start tower stage 1 (T)', t.paid || t.done >= 1],
    ['t1', 'Finish tower stage 1', t.done >= 1]
  ];
  return defs.map(([k, text, ok]) => { if (ok) d[k] = true; return { text, done: !!d[k] }; });
}
function renderGoals() {
  const el = $('#goals'); if (!el) return;
  if (!S || scav) { el.hidden = true; return; }
  const steps = goalSteps();
  if (steps.every(s => s.done)) { el.hidden = true; return; }
  const nextI = steps.findIndex(s => !s.done);
  el.hidden = false;
  el.innerHTML = '<b>Goals</b><br>' + steps.map((s, i) => `<div style="${s.done ? 'opacity:.55;text-decoration:line-through' : i === nextI ? 'color:#ffd27a;font-weight:bold' : 'opacity:.8'}">${s.done ? '&#10003;' : i === nextI ? '&#9658;' : '&#9744;'} ${esc(s.text)}</div>`).join('');
}
let raidOpen = false;
function raidPopHTML() {
  const cnt = {}; let comp = null;
  if (S.spawns.length) comp = S.spawns.map(s => s.type);
  else if (!S.enemies.length && (RAID_HOUR - hourF() + 24) % 24 <= 6) comp = raidPlan(day());
  if (comp) comp.forEach(t => { cnt[t] = (cnt[t] || 0) + 1; });
  const compTxt = comp ? Object.keys(cnt).map(t => cnt[t] + ' × ' + (ENEMIES[t] ? ENEMIES[t].name : t)).join(', ') : 'Not scouted yet (shows within 6h of the raid)';
  const dp = S.door.hp >= S.door.max;
  const door = S.breached ? '<span style="color:var(--red)">BREACHED</span>' : dp ? 'repaired' : '<span style="color:var(--red)">damaged, needs repair</span>';
  const tur = S.turrets.map((t, i) => {
    if (!t) return 'Slot ' + (i + 1) + ': <i>empty</i>';
    const def = TURRETS[t.type] || { name: t.type };
    const job = i === 1 ? 'turretB' : 'turretA';
    const crew = living().filter(c => c.job === job).length;
    const st = t.type === 'coil' ? 'no crew needed' : crew ? 'manned (' + crew + ')' : '<span style="color:var(--red)">UNMANNED</span>';
    return 'Slot ' + (i + 1) + ': ' + esc(def.name) + ' · HP ' + Math.ceil(t.hp) + '/' + (t.max || def.hp) + ' · ' + st;
  }).join('<br>');
  return '<b>Raid details</b><br>Hostiles: ' + compTxt + '<br>Will hit: hatch ' + Math.ceil(S.door.hp) + '/' + S.door.max + ' (' + door + '), then outer wall ' + Math.ceil(S.wall.hp) + '<br>' + tur;
}
function raidPopUpdate() {
  let p = document.getElementById('raidPop');
  if (!raidOpen || !S) { if (p) p.hidden = true; return; }
  const anchor = document.querySelector('[data-raid]'); if (!anchor) return;
  if (!p) {
    p = document.createElement('div'); p.id = 'raidPop';
    p.style.cssText = 'position:fixed;z-index:50;max-width:380px;background:rgba(14,10,6,.95);border:1px solid #5a4630;border-radius:6px;padding:8px 10px;font-size:12.5px;line-height:1.5;color:#e8d9bf';
    document.body.appendChild(p);
  }
  const r = anchor.getBoundingClientRect();
  p.hidden = false; p.style.left = Math.max(4, Math.min(r.left, innerWidth - 390)) + 'px'; p.style.top = (r.bottom + 6) + 'px';
  p.innerHTML = raidPopHTML();
}
document.addEventListener('click', e => {
  if (e.target.closest('[data-raid]')) raidOpen = !raidOpen;
  else if (raidOpen && !e.target.closest('#raidPop')) raidOpen = false;
  else return;
  raidPopUpdate();
});
// ---- HUD tooltips (hover + keyboard focus, screen-reader labelled) ----
const tipEsc = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
function tipAttrs(key, text, label) { return `tabindex="0" role="group" data-tipk="${tipEsc(key)}" data-tip="${tipEsc(text)}" aria-label="${tipEsc(label + '. ' + text)}"`; }
// Rolling net-rate tracker for HUD tooltips (game minutes).
const resHist = { owner: null, s: [] };
function resRateSample() {
  if (resHist.owner !== S) { resHist.owner = S; resHist.s = []; }
  const a = resHist.s, last = a[a.length - 1];
  if (last && S.t < last.t) a.length = 0;
  if (!a.length || S.t - a[a.length - 1].t >= 5) {
    a.push({ t: S.t, v: Object.assign({}, S.res) });
    while (a.length > 2 && S.t - a[0].t > 180) a.shift();
  }
}
function fmtMins(m) { m = Math.round(m); return (m >= 60 ? Math.floor(m / 60) + 'h ' : '') + (m % 60) + 'm'; }
function resRateText(k) {
  const have = Math.floor(S.res[k]);
  let t = 'Stock: ' + have + '.';
  const a = resHist.s;
  const o = resHist.owner === S && a.length ? a[0] : null;
  const span = o ? S.t - o.t : 0;
  if (!o || span < 10) return t + ' Measuring rate\u2026';
  const rate = (S.res[k] - o.v[k]) / span;
  if (Math.abs(rate) < 0.005) return t + ' Steady (no net change).';
  if (rate > 0) return t + ' Gaining ' + rate.toFixed(2) + '/min.';
  t += ' Using ' + (-rate).toFixed(2) + '/min';
  return t + (have > 0 ? ', empty in about ' + fmtMins(S.res[k] / -rate) + '.' : ', empty.');
}
function resTip(r, low) {
  const d = { food: 'Raw rations the crew eat. Cooked into meals at the serving station.', scrap: 'Spent on building and repairs.', parts: 'Spent on turrets and machinery.', mat: 'Structural material for building.' };
  if (r.k === 'elec') return elecHint() + ' ' + resRateText('elec');
  return (d[r.k] || r.name) + (low ? ' Running low.' : '') + ' ' + resRateText(r.k);
}
let lastHud = '', hudTipKey = null;
function hudTipEl() {
  let t = document.getElementById('hudTip');
  if (!t) { t = document.createElement('div'); t.id = 'hudTip'; t.setAttribute('role', 'tooltip'); t.hidden = true; document.body.appendChild(t); }
  return t;
}
function hudTipShow(el) {
  const t = hudTipEl();
  t.textContent = el.dataset.tip; t.hidden = false; hudTipKey = el.dataset.tipk;
  el.setAttribute('aria-describedby', 'hudTip');
  const r = el.getBoundingClientRect();
  t.style.left = Math.max(4, Math.min(r.left, window.innerWidth - t.offsetWidth - 4)) + 'px';
  t.style.top = (r.bottom + 6) + 'px';
}
function hudTipHide() { const t = hudTipEl(); t.hidden = true; hudTipKey = null; }
// The top bar is one row at a fixed 1280px: if it overflows, tighten spacing, then let the threat text shorten, so nothing is pushed off-screen.
function fitHud(hud) {
  hud.classList.remove('tight', 'tighter');
  if (hud.scrollWidth <= hud.clientWidth + 1) return;
  hud.classList.add('tight');
  if (hud.scrollWidth <= hud.clientWidth + 1) return;
  hud.classList.add('tighter');
}
function hudSet(html) {
  const hud = $('#hud');
  if (html === lastHud) return;
  lastHud = html;
  const ae = document.activeElement;
  const fk = ae && hud.contains(ae) && ae.dataset ? ae.dataset.tipk : null;
  hud.innerHTML = html;
  try { fitHud(hud); } catch (_) {}
  if (fk) { const n = hud.querySelector('[data-tipk="' + fk + '"]'); if (n) n.focus({ preventScroll: true }); }
  if (hudTipKey) {
    const n = hud.querySelector('[data-tipk="' + hudTipKey + '"]');
    if (n && (n === document.activeElement || n.matches(':hover'))) hudTipShow(n); else hudTipHide();
  }
}
document.addEventListener('mouseover', e => { const n = e.target.closest && e.target.closest('#hud [data-tip]'); if (n) hudTipShow(n); });
document.addEventListener('mouseout', e => { const n = e.target.closest && e.target.closest('#hud [data-tip]'); if (n && n !== document.activeElement) hudTipHide(); });
document.addEventListener('focusin', e => { const n = e.target.closest && e.target.closest('#hud [data-tip]'); if (n) hudTipShow(n); });
document.addEventListener('focusout', e => { const n = e.target.closest && e.target.closest('#hud [data-tip]'); if (n) hudTipHide(); });
// Floating +/- popups over the food/scrap/parts HUD counters. Net change is batched over 700ms.
const RESPOP = { S: null, prev: {}, pend: {}, timer: null, keys: ['food', 'scrap', 'parts'] };
function resDeltaCheck() {
  if (RESPOP.S !== S) { RESPOP.S = S; RESPOP.pend = {}; RESPOP.prev = {}; for (const k of RESPOP.keys) RESPOP.prev[k] = Math.floor(S.res[k] || 0); return; }
  let any = false;
  for (const k of RESPOP.keys) {
    const v = Math.floor(S.res[k] || 0), d = v - RESPOP.prev[k];
    RESPOP.prev[k] = v;
    if (d) { RESPOP.pend[k] = (RESPOP.pend[k] || 0) + d; any = true; }
  }
  if (any && !RESPOP.timer) RESPOP.timer = setTimeout(resPopFlush, 700);
}
function resPopFlush() {
  RESPOP.timer = null;
  const row = document.querySelector('#hud .res');
  const pend = RESPOP.pend; RESPOP.pend = {};
  if (!row) return;
  RESPOP.keys.forEach(k => {
    const d = pend[k]; if (!d) return;
    const idx = RES.findIndex(r => r.k === k), cell = row.children[idx]; if (!cell) return;
    const rc = cell.getBoundingClientRect();
    if (!rc.width) return;
    const el = document.createElement('div');
    el.className = 'respop ' + (d > 0 ? 'up' : 'down');
    el.setAttribute('aria-hidden', 'true');
    el.textContent = (d > 0 ? '\u25B2 +' : '\u25BC \u2212') + Math.abs(d);
    el.style.left = Math.round(rc.left + rc.width / 2) + 'px';
    el.style.top = Math.round(rc.bottom + 2) + 'px';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), prefs.rm ? 1200 : 1400);
  });
}
function hatchHudHTML() {
  const d = S.door, max = Math.max(1, d.max), hp = Math.max(0, d.hp);
  const pct = Math.round(hp / max * 100);
  const breached = !!S.breached || hp <= 0;
  const st = breached ? 'breach' : pct < 30 ? 'crit' : pct < 60 ? 'warn' : 'ok';
  const mark = { ok: '&#9632;', warn: '&#9650;', crit: '&#9888;', breach: '&#10005;' }[st];
  const tag = { ok: '', warn: 'WORN', crit: 'CRITICAL', breach: 'BREACHED' }[st];
  const pulse = (st === 'crit' || st === 'breach') && !(prefs && prefs.rm) ? ' pulse' : '';
  let lvl = 'quiet', lvlTxt = 'QUIET', lvlGlyph = '&#9675;';
  if (S.breached) { lvl = 'breach'; lvlTxt = 'BREACH'; lvlGlyph = '&#10005;'; }
  else if (S.enemies.length || S.spawns.length) { lvl = 'raid'; lvlTxt = 'RAID'; lvlGlyph = '&#9650;'; }
  else if (((RAID_HOUR - hourF() + 24) % 24) < 1.5) { lvl = 'dusk'; lvlTxt = 'DUSK'; lvlGlyph = '&#9680;'; }
  return `<span class="hatchhud ${st}${pulse}" role="meter" aria-label="Hatch integrity" aria-valuemin="0" aria-valuemax="${max}" aria-valuenow="${Math.ceil(hp)}" title="Hatch integrity. Repair it at the workshop."><em aria-hidden="true">${mark}</em>Hatch <span class="hbar"><i style="width:${pct}%"></i></span> <b>${Math.ceil(hp)}/${max} &middot; ${pct}%</b>${tag ? ' <u>' + tag + '</u>' : ''}</span><span class="thlvl ${lvl}" title="Threat level"><em aria-hidden="true">${lvlGlyph}</em>${lvlTxt}</span>`;
}
// ---- night-warning banner + countdown chip, with a one-shot alarm sting
const NIGHT_WARN_H = 2;       // game hours before the raid when the banner appears
const NIGHT_URGENT_MIN = 30;  // game minutes: banner turns urgent
let nwArmed = true, nwRid = null, nwShown = '', nwRaidPrev = false;
function nightWarnUpdate() {
  const el = document.getElementById('nightWarn'); if (!el) return;
  let show = false, text = '', urgent = false, raidNow = false;
  try {
    if (S && !S.over && (scene === 'bunker' || scene === 'scav')) {
      if (nwRid !== S.rid) { nwRid = S.rid; nwArmed = true; }
      const raid = !!((S.enemies && S.enemies.length) || (S.spawns && S.spawns.length));
      raidNow = raid;
      const to = (RAID_HOUR - hourF() + 24) % 24;
      if (to > NIGHT_WARN_H + 0.5) nwArmed = true;
      if (!raid && to <= NIGHT_WARN_H) {
        show = true;
        const m = Math.max(0, Math.ceil(to * 60));
        urgent = m <= NIGHT_URGENT_MIN;
        text = RAID_CLOCK + ' in ' + (m >= 60 ? Math.floor(m / 60) + 'h ' : '') + (m % 60) + 'm';
        if (nwArmed) {
          nwArmed = false;
          if (window.SFX && SFX.nightSting) SFX.nightSting();
          srSay('Night raid warning. The raid hits at ' + RAID_CLOCK + ', in ' + m + ' minutes.', 'warn');
        }
      }
    }
  } catch (_) { show = false; }
  try {
    let edge = document.getElementById('raidEdge');
    if (!edge) { edge = document.createElement('div'); edge.id = 'raidEdge'; edge.setAttribute('aria-hidden', 'true'); document.body.appendChild(edge); }
    const mode = raidNow ? 'raid' : (show && urgent ? 'dusk' : '');
    if (edge.dataset.mode !== mode) edge.dataset.mode = mode;
    if (raidNow && !nwRaidPrev && window.SFX && SFX.raidSiren) SFX.raidSiren();
    nwRaidPrev = raidNow;
  } catch (_) {}
  const key = show ? text + '|' + urgent : '';
  if (key === nwShown) return;
  nwShown = key;
  el.hidden = !show;
  el.classList.toggle('urgent', show && urgent);
  if (show) {
    document.getElementById('nwTitle').textContent = urgent ? '\u26A0 NIGHT RAID SOON' : 'NIGHT RAID';
    document.getElementById('nwChip').textContent = text;
  }
}
setInterval(nightWarnUpdate, 250);
function renderHud() {
  if (!S) { $('#hud').innerHTML = ''; const g = $('#goals'); if (g) g.hidden = true; return; }
  renderGoals();
  resDeltaCheck();
  const th = nextThreat(), pl = S.player;
  requestAnimationFrame(raidPopUpdate);
  const raidLeft = (RAID_HOUR - hourF() + 24) % 24, clockWarn = raidLeft > 0 && raidLeft < 2, clockMin = Math.max(1, Math.ceil(raidLeft * 60));
  const clockCls = 'clock' + (clockWarn ? ' dusk' : '') + (isNight() ? ' night' : '');
  const clockDelay = clockWarn && !prefs.rm ? ' style="animation-delay:-' + ((performance.now() / 1000) % 1.6).toFixed(2) + 's"' : '';
  const clockSuffix = raidLeft > 0 ? ' <small class="clockcd">raid ' + (clockMin >= 60 ? Math.floor(clockMin / 60) + 'h ' : '') + (clockMin % 60) + 'm</small>' : '';
  hudSet(`<span class="${clockCls}"${clockDelay} ${tipAttrs('clock', 'Day number and time of day. Crew sleep shifts and the nightly raid follow this clock.', 'Clock ' + clockText() + (clockWarn ? ', night approaching, raid in ' + clockMin + ' minutes' : ''))}><span aria-hidden="true">${isNight() ? '&#9790; ' : clockWarn ? '&#9680; ' : '&#9728; '}</span>${clockText()}${clockSuffix}</span>
    <span class="res">${RES.map(r => { const v = Math.floor(S.res[r.k]); const low = resLow(r.k); return `<span class="${low ? 'lowres' : ''}" ${tipAttrs('res-' + r.k, resTip(r, low), r.name + ' ' + v + (low ? ', low' : ''))}><i style="background:${r.color}"></i>${low ? '<em class="lowico" aria-hidden="true">&#9888;</em>' : ''}${({ elec: 'Elec', mat: 'Mat' })[r.k] || r.name} <b class="${low ? 'low' : ''}">${v}</b>${low ? '<em class="lowtag">LOW</em>' : ''}</span>`; }).join('') + powerHud()}</span>
    <span class="res"><span class="${kit().cooked < 2 ? 'lowres' : ''}" ${tipAttrs('meals', 'Prepared meals at the serving station. Crew eat these.' + (kit().cooked < 2 ? ' Running low.' : ''), 'Meals ' + Math.floor(kit().cooked) + (kit().cooked < 2 ? ', low' : ''))}><i style="background:#e8b86a"></i>${kit().cooked < 2 ? '<em class="lowico" aria-hidden="true">&#9888;</em>' : ''}Meals <b class="${kit().cooked < 2 ? 'low' : ''}">${Math.floor(kit().cooked)}</b></span></span>
    ${bedHudHtml()}
    ${hatchHudHTML()}
    <span class="threat ${th.hot ? 'hot' : ''}" data-raid="1" style="cursor:pointer" title="Click for raid details">${esc(th.text)} ${raidOpen ? '&#9662;' : '&#9656;'}</span>
    <span class="threat" title="Mara">Mara ${Math.ceil(pl.hp)}/${pl.maxHp}${pl.down ? ' · down' : ''} · revives ${pl.revives | 0}</span>
    <span class="spd">${[0, 1, 2, 3].map(s => `<button data-spd="${s}" class="${(s === 0 ? paused : (!paused && speed === s)) ? 'on' : ''}" aria-label="${s ? s + 'x speed' : 'Pause'}" title="${s ? s + 'x speed (key ' + s + ')' : 'Pause (key P)'}">${s ? s + 'x' : 'II'}<small style="display:block;font-size:9px;opacity:.7;line-height:1">${s ? s : 'P'}</small></button>`).join('')}</span>`);
}
document.addEventListener('click', e => { if (e.target.closest('#tPause')) { const o = $('#overlay'); if (S && scene !== 'menu' && scene !== 'over' && o && o.hidden) showPauseMenu(); return; } });
document.addEventListener('click', e => { const b = e.target.closest('[data-spd]'); if (!b) return; const s = +b.dataset.spd; if (s === 0) paused = !paused; else setSpeed(s); renderHud(); });

let tab = 'crew', sel = null, hover = null;
const crewView = { sort: 'default', need: 'all', job: 'all', state: 'all', mood: 'all', q: '', compact: null }; // compact: null = auto (on above 24 living crew)
function compactOn() { return crewView.compact === null ? living().length > 24 : !!crewView.compact; }
let focusFx = null; // { id, t } ring drawn on a crew member after clicking their card
function crewStateKey(c) { return c.state === 'sleep' ? 'sleep' : c.state === 'patient' ? 'patient' : c.state === 'fight' ? 'fight' : c.state === 'walk' ? 'walk' : 'work'; }
function crewNeeds(c) { return { hp: c.hp / c.maxHp * 100, food: c.food, rest: restPct(c) }; }
function crewFilterActive() { return crewView.need !== 'all' || crewView.job !== 'all' || crewView.state !== 'all' || crewView.mood !== 'all' || !!crewView.q.trim(); }
function crewPass(c) {
  const q = crewView.q.trim().toLowerCase();
  if (q && !(c.name + ' ' + (JOBS[c.job] ? JOBS[c.job].label : '') + ' ' + crewStateKey(c)).toLowerCase().includes(q)) return false;
  if (crewView.mood === 'low' && !(morale(c) < 50)) return false;
  const n = crewNeeds(c);
  if (crewView.need === 'hp' && !(n.hp < 50)) return false;
  if (crewView.need === 'food' && !(n.food < 35)) return false;
  if (crewView.need === 'rest' && !(n.rest < 40)) return false;
  if (crewView.need === 'any' && !(n.hp < 50 || n.food < 35 || n.rest < 40)) return false;
  if (crewView.job !== 'all' && !(c.job === crewView.job || (crewView.job === 'turretA' && c.job === 'turretB'))) return false;
  if (crewView.state !== 'all' && crewStateKey(c) !== crewView.state) return false;
  return true;
}
function crewCmp(a, b) {
  const s = crewView.sort;
  if (s === 'urgent') { const u = (c) => { const n = crewNeeds(c); return Math.min(n.hp / 50, n.food / 35, n.rest / 40); }; return (u(a) - u(b)) || a.name.localeCompare(b.name); }
  if (s === 'name') return a.name.localeCompare(b.name);
  if (s === 'hp') return crewNeeds(a).hp - crewNeeds(b).hp;
  if (s === 'food') return crewNeeds(a).food - crewNeeds(b).food;
  if (s === 'rest') return crewNeeds(a).rest - crewNeeds(b).rest;
  if (s === 'lvl') return b.lvl - a.lvl;
  if (s === 'mood') return morale(a) - morale(b);
  if (s === 'job') return ((JOBS[a.job] && JOBS[a.job].label) || '~').localeCompare((JOBS[b.job] && JOBS[b.job].label) || '~');
  return b.named - a.named;
}
function crewControls() {
  const lbl = { sort: 'Sort crew', need: 'Filter by need', job: 'Filter by job', state: 'Filter by state' };
  const sel2 = (key, opts) => `<select data-view="${key}" aria-label="${lbl[key] || key}" style="min-height:44px;font-size:14px">${opts.map(([v, l]) => `<option value="${v}" ${crewView[key] === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  return `<div class="row" role="group" aria-label="Crew sort and filter" style="margin:6px 0;gap:4px;flex-wrap:wrap">
    <input type="search" data-q="1" value="${esc(crewView.q)}" placeholder="Search crew ( / )" aria-label="Search crew by name, job or state" autocomplete="off" style="min-height:44px;font-size:14px;flex:1 1 120px;min-width:0">
    ${sel2('sort', [['default', 'Sort: default'], ['urgent', 'Sort: most urgent'], ['name', 'Sort: name'], ['hp', 'Sort: health'], ['food', 'Sort: food'], ['rest', 'Sort: rest'], ['lvl', 'Sort: level'], ['mood', 'Sort: mood'], ['job', 'Sort: job']])}
    ${sel2('need', [['all', 'Need: all'], ['any', 'Any need'], ['hp', 'Low health'], ['food', 'Hungry'], ['rest', 'Tired']])}
    ${sel2('job', [['all', 'Job: all'], ...Object.entries(JOBS).filter(([k, j]) => !j.hidden).map(([k, j]) => [k, j.label])])}
    ${sel2('state', [['all', 'State: all'], ['work', 'Working'], ['walk', 'Walking'], ['sleep', 'Sleeping'], ['patient', 'Med bay'], ['fight', 'Fighting']])}
    <span class="row" role="group" aria-label="Quick filters" style="gap:4px;flex-wrap:wrap;width:100%">${[['need:any', 'Any need'], ['need:hp', 'Low health'], ['need:food', 'Hungry'], ['need:rest', 'Tired'], ['mood:low', 'Unhappy']].map(([id, l]) => { const [k, v] = id.split(':'); const on = crewView[k] === v; return `<button class="chip ${on ? 'on' : ''}" data-chip="${id}" aria-pressed="${on}" style="min-height:44px">${l}</button>`; }).join('')}</span>
  </div>`;
}
function drawFocus() {
  if (!focusFx || !S) return;
  const age = (performance.now() - focusFx.t) / 1000, c = S.crew.find(x => x.id === focusFx.id);
  if (age > 3 || !c || !c.alive) { focusFx = null; return; }
  const pulse = prefs.rm ? 0 : Math.sin(age * 8) * 3;
  g.save(); g.globalAlpha = Math.min(1, (3 - age) / 1);
  g.strokeStyle = '#ffd24a'; g.lineWidth = 3;
  g.beginPath(); g.arc(c.x, c.y - 12, 18 + pulse, 0, 7); g.stroke();
  g.restore();
}
function syncDrawerButtons() {
  const open = !$('#drawer').hidden;
  [['tCrew', 'crew'], ['tBuild', 'build'], ['tTower', 'tower']].forEach(([id, t]) => {
    const b = document.getElementById(id); if (!b) return;
    const lit = open && tab === t;
    b.classList.toggle('on', lit); b.setAttribute('aria-pressed', lit ? 'true' : 'false');
  });
}
function openDrawer(t) { uiSfx('Open'); srSay(String(t).charAt(0).toUpperCase() + String(t).slice(1) + ' panel open.'); tab = t; $('#drawer').hidden = false; $('#wrap').classList.add('dopen'); renderDrawer(); syncDrawerButtons(); }
function setDrawerCollapsed(on) {
  $('#drawer').classList.toggle('collapsed', on); $('#wrap').classList.toggle('dcol', on);
  const b = $('#dCollapse'); if (b) { b.textContent = on ? '«' : '»'; b.setAttribute('aria-expanded', on ? 'false' : 'true'); b.setAttribute('aria-label', on ? 'Expand panel' : 'Collapse panel'); }
}
function closeDrawer() { uiSfx('Close'); srSay('Panel closed.'); setDrawerCollapsed(false); $('#drawer').hidden = true; $('#wrap').classList.remove('dopen'); syncDrawerButtons(); }
function toggleDrawer(t) { if (!$('#drawer').hidden && $('#drawer').classList.contains('collapsed')) { setDrawerCollapsed(false); openDrawer(t); } else if (!$('#drawer').hidden && tab === t) closeDrawer(); else openDrawer(t); }
let pendingFocus = null;
function bar(pct, c, kind, label) { const v = Math.round(clamp(pct, 0, 100)); const a = label ? ` role="progressbar" aria-label="${label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${v}"` : ' aria-hidden="true"'; return `<div class="bar"${a}><i class="${kind ? 'p-' + kind : ''}" style="width:${clamp(pct, 0, 100)}%;background:${c}"></i></div>`; }
function needBar(icon, name, pct, color, kind, low) { const v = Math.round(clamp(pct, 0, 100)); const lo = low === undefined ? v < 30 : low; return `<span style="white-space:nowrap"><span aria-hidden="true">${icon}</span> ${name} ${v}${lo ? ' <span aria-hidden="true">\u26A0\uFE0E</span>' : ''}</span>` + bar(pct, color, lo ? 'low' : kind, name).replace('class="bar"', 'class="bar tick"'); }
function canPay(c) { return Object.entries(c).every(([k, v]) => S.res[k] >= v); }
function pay(c) { payN++; for (const [k, v] of Object.entries(c)) S.res[k] -= v; }
// build menu: hotkey badges (1-9), greyed unaffordable entries, focusable cards, focus restore
function decorateBuild(body, prev) {
  const cards = Array.from(body.querySelectorAll('.bitem'));
  let hk = 0, restore = null;
  cards.forEach((c, i) => {
    const b = c.querySelector('button[data-build]');
    c.tabIndex = 0; c.dataset.bi = i; c.dataset.bk = b ? b.dataset.build : 'i' + i;
    if (prev && prev.dataset.bk === c.dataset.bk) restore = c;
    if (!b) return;
    const dis = b.disabled;
    c.classList.toggle('unaff', dis); c.setAttribute('aria-disabled', dis ? 'true' : 'false');
    if (++hk <= 9) {
      c.dataset.hk = hk; c.setAttribute('aria-keyshortcuts', String(hk));
      const kb = document.createElement('kbd'); kb.className = 'bkey'; kb.setAttribute('aria-hidden', 'true'); kb.textContent = hk;
      c.insertBefore(kb, c.firstChild);
    }
  });
  const main = body.querySelector('.bmain');
  if (main && cards.length) {
    const sec = main.querySelector('.sec'), p = document.createElement('p');
    p.className = 'note bhint'; p.textContent = 'Up/Down select \u00B7 Enter build \u00B7 1-9 quick build \u00B7 Left/Right category';
    if (sec) sec.insertAdjacentElement('afterend', p);
  }
  if (prev && !restore && cards.length) restore = cards[Math.min(+prev.dataset.bi || 0, cards.length - 1)];
  if (restore) restore.focus({ preventScroll: true });
}
// build menu keyboard handling (digits only act while focus is inside the build panel, so 1-3 still set speed elsewhere)
$('#dbody').addEventListener('keydown', e => {
  if (tab !== 'build' || !S || e.ctrlKey || e.altKey || e.metaKey) return;
  const t = e.target; if (!t || !t.closest || t.tagName === 'INPUT') return;
  const body = $('#dbody'), cards = Array.from(body.querySelectorAll('.bitem'));
  const act = c => { const b = c && c.querySelector('button[data-build]'); if (b && !b.disabled) b.click(); else uiSfx('Error'); };
  if (/^[1-9]$/.test(e.key)) {
    const c = body.querySelector('.bitem[data-hk="' + e.key + '"]');
    e.preventDefault(); e.stopPropagation(); if (c) act(c); return;
  }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault(); e.stopPropagation();
    const cur = t.closest('.bitem'), i = cards.indexOf(cur);
    const n = cards[i < 0 ? 0 : clamp(i + (e.key === 'ArrowDown' ? 1 : -1), 0, cards.length - 1)];
    if (n) n.focus(); return;
  }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    if (!t.closest('.bitem') && !t.closest('.brail')) return;
    e.preventDefault(); e.stopPropagation();
    const i = BUILD_CATS.findIndex(c => c[0] === buildCat), d = e.key === 'ArrowRight' ? 1 : -1;
    buildCat = BUILD_CATS[(Math.max(i, 0) + d + BUILD_CATS.length) % BUILD_CATS.length][0];
    renderDrawer();
    const f = $('#dbody').querySelector('.bitem'); if (f) f.focus();
    return;
  }
  if ((e.key === 'Enter' || e.key === ' ') && t.classList && t.classList.contains('bitem')) {
    e.preventDefault(); e.stopPropagation(); act(t);
  }
});
var sbDrag = null, sbGrab = null; // stations board: id being dragged / id grabbed by keyboard or tap
function renderDrawer() {
  if (sbDrag) return;
  if ($('#drawer').hidden || !S) return;
  document.querySelectorAll('.tabs [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  const body = $('#dbody'); const keep = body.scrollTop; const fk = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.view : null;
  const ae = document.activeElement, fc = ae && ae.dataset && ae.dataset.fk ? ae.dataset.fk : null;
  const fq = ae && ae.dataset && ae.dataset.q !== undefined && ae.selectionStart !== undefined ? [ae.selectionStart, ae.selectionEnd] : null;
  const fb = ae && ae.closest && ae.dataset && ae.closest('#dbody') ? (ae.dataset.build ? ['build', ae.dataset.build] : ae.dataset.bcat ? ['bcat', ae.dataset.bcat] : ae.dataset.brush ? ['brush', ae.dataset.brush] : null) : null;
  const bi = tab === 'build' && ae && ae.classList && ae.classList.contains('bitem') ? Array.from(body.querySelectorAll('.bitem')).indexOf(ae) : -1;
  body.innerHTML = tab === 'crew' ? crewHTML() : tab === 'build' ? buildHTML() : tab === 'rel' ? relHTML() : tab === 'log' ? logHTML() : tab === 'gear' ? gearHTML() : towerHTML();
  if (tab === 'build') decorateBuild(body, ae && ae.classList && ae.classList.contains('bitem') ? ae : null);
  body.scrollTop = keep;
  if (tab === 'build') { enhanceBuildCards(body); if (bi >= 0) { const bel = body.querySelectorAll('.bitem')[bi]; if (bel) bel.focus({ preventScroll: true }); } } else hideBuildTip();
  if (fk) { const el = body.querySelector(`[data-view="${fk}"]`); if (el) el.focus(); }
  if (fb) { const el = body.querySelector(`[data-${fb[0]}="${CSS.escape(fb[1])}"]:not([disabled])`); if (el) el.focus({ preventScroll: true }); else { const tb = document.querySelector('.tabs [data-tab].on'); if (tb) tb.focus({ preventScroll: true }); } }
  if (fq) { const el = body.querySelector('[data-q]'); if (el) { el.focus({ preventScroll: true }); try { el.setSelectionRange(fq[0], fq[1]); } catch (_) {} } }
  if (fc) { const el = body.querySelector(`[data-fk="${fc}"]`) || body.querySelector(`[data-fk="${(fc[0] === 'c' ? 'n' : 'c') + fc.slice(1)}"]`); if (el) el.focus({ preventScroll: true }); }
}
function gearRow(c) {
  const st = stock(), have = GEAR_IDS.filter(id => st[id] > 0);
  return `<div class="row" style="margin-top:5px"><span class="note" style="margin:0 4px 0 0">Holding</span>${c.held ? `<b>${esc(GEAR[c.held].name)}</b> <button class="chip" data-gear="unequip" data-id="${c.id}">Put away</button><button class="chip" data-gear="disheld" data-id="${c.id}" title="Break it down for scrap and parts">Dismantle</button>` : '<span class="note" style="margin:0">nothing</span>'}${have.map(id => `<button class="chip" data-gear="equip" data-g="${id}" data-id="${c.id}">Take ${esc(GEAR[id].name)} (${st[id]})</button>`).join('')}${c.carry ? `<span class="note" style="margin:0 0 0 6px">Carrying ${c.carry.n} ${c.carry.id === 'crate' ? 'raw food' : 'cooked meal' + (c.carry.n > 1 ? 's' : '')}</span>` : ''}</div>`;
}
function gearHTML() {
  const st = stock(), k = kit(), q = S.craft || [];
  const rows = GEAR_IDS.map(id => {
    const g = GEAR[id], n = st[id] || 0, can = canPay(g.cost) && q.length < CRAFT_MAX;
    return `<div class="card bitem"><div><b>${esc(g.name)}</b> <span class="tag">${g.kind}</span><p>In stock: ${n} · Craft: ${fmtCost(g.cost)} · ${g.work} work · Dismantling returns ${fmtCost(g.back)}</p></div><div><button class="btn" data-gear="craft" data-g="${id}" ${can ? '' : 'disabled'}>Craft</button> <button class="btn ghost" data-gear="dis" data-g="${id}" ${n ? '' : 'disabled'}>Dismantle</button></div></div>`;
  }).join('');
  const queue = q.length ? q.map((j, i) => `<div class="note" style="margin:2px 0">${i === 0 ? 'Building' : 'Queued'}: ${esc(GEAR[j.id].name)}<div style="margin-top:3px">${bar((1 - j.left / j.max) * 100, '#7fc8ff')}</div></div>`).join('') : '<p class="note">Nothing queued.</p>';
  const workers = living().filter(c => c.job === 'workshop').length;
  return `<p class="note" style="margin:0">Craft weapons here: the cost is paid now and workshop crew build them after repairs. Enemies that carried a weapon may drop it when they die. Crew hold one each, shown in their hand; unarmed guards are armed from stock every hour. Dismantling turns a weapon back into scrap and parts. Weapons are for show for now.</p>`
    + `<div class="sec">WEAPONS</div>${rows}<div class="sec">WORKSHOP QUEUE</div>${queue}${workers ? '' : '<p class="note bad">Nobody is on the Workshop job, so nothing gets built.</p>'}`
    + `<div class="sec">FOOD</div><p class="note">Pantry: ${Math.floor(S.res.food)} raw food<br>Kitchen: ${Math.floor(k.raw || 0)} raw, ${Math.floor(k.prog * 100)}% of the next meal<br>Serving station: ${k.cooked} / ${k.cap} meals<br>Cooks carry crates from the pantry to the kitchen and plates to the serving station.</p>`;
}
function crewHTML() {
  const filtering = crewFilterActive();
  const list = S.crew.filter(c => c.alive ? crewPass(c) : !filtering).sort((a, b) => (b.alive - a.alive) || (a.alive ? crewCmp(a, b) : 0));
  const total = S.crew.filter(c => c.alive).length, shown = list.filter(c => c.alive).length;
  const gunners = j => living().filter(c => c.job === j).length;
  return `<p class="note" style="margin:0">Jobs decide where people go when they are awake. Shifts decide when they sleep: after about 16 hours awake they slow down fast. Turrets only fire with someone on them. Click a person to find them in the bunker.</p>
  ${stationBoard()}${crewControls()}<button class="chip" data-act="clearview" style="min-height:44px" title="Default sort, no filters">Reset</button> <button class="chip ${compactOn() ? 'on' : ''}" style="min-height:44px" data-act="compact" title="One-line rows for big crews">Compact</button> <button class="chip" data-act="resetcam" title="Zoom out and stop following">Reset view</button><p class="note" style="margin:0">Showing ${shown} of ${total}</p>${shown === 0 && total > 0 ? '<p class="note">Nobody matches these filters.</p>' : ''}
  ${maraCard()}
  ${[0, 1].map(i => !S.turrets[i] || S.turrets[i].type === 'coil' ? '' : turretStatus(S.turrets[i]) === 'none' ? `<p class="note bad" style="margin:0">Turret ${i + 1}: NO GUNNER - press C.</p>` : turretStatus(S.turrets[i]) === 'walking' ? `<p class="note" style="margin:0">Turret ${i + 1}: Manning...</p>` : '').join('')}
  ${list.map(c => {
    if (!c.alive) return `<div class="card dead"><div class="ch"><span class="sw" style="background:${c.color}"></span><b>${esc(c.name)}</b><span class="tag">${c.left ? 'left the bunker' : 'lost'}</span></div></div>`;
    if (compactOn() && sel !== c.id) {
      const cs = c.state === 'sleep' ? 'zzz' : c.state === 'patient' ? 'med' : c.state === 'fight' ? 'fight' : c.state === 'walk' ? 'walk' : 'work';
      const sfc = sleepFactor(c.awake), mb = (pct, col) => `<div style="width:44px">${bar(pct, col)}</div>`;
      return `<div class="card" data-crew="${c.id}" data-fk="c:${c.id}" tabindex="0" role="button" aria-label="${esc(c.name)}, ${cs}. Focus camera" style="padding:4px 8px;cursor:pointer"><div class="row" style="gap:6px;align-items:center;flex-wrap:nowrap"><span class="sw" style="background:${c.color}"></span><span aria-hidden="true">${stateIcon(c)}</span><b style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.name)}</b><span class="note" style="margin:0;white-space:nowrap">${cs}${c.sick ? ' · sick' : ''} · ${JOBS[c.job] ? JOBS[c.job].label : '-'}</span>${mb(c.hp / c.maxHp * 100, '#7ddc6f')}${mb(c.food, '#c9a27a')}${mb(restPct(c), sfc < 0.6 ? '#ff5a4e' : '#7fc8ff')}</div></div>`;
    }
    const sf = sleepFactor(c.awake), rest = restPct(c);
    let alarmDest = '';
    if (S.alarm && !c.patient) {
      if (c.alarmSlot != null && S.turrets[c.alarmSlot]) alarmDest = 'Turret ' + (c.alarmSlot + 1);
      else if ((c.job === 'turretA' || c.job === 'turretB') && turretFor(c.job)) alarmDest = c.job === 'turretB' ? 'Turret 2' : 'Turret 1';
      else alarmDest = 'the door';
    }
    const alarmNow = alarmDest && c.state !== 'sleep' && c.state !== 'patient' && c.state !== 'fight';
    const state = c.state === 'sleep' ? (c.bed === false ? 'sleeping (floor)' : 'sleeping') : c.state === 'patient' ? 'in the med bay' : c.state === 'fight' ? 'fighting!' : alarmNow ? (c.state === 'walk' ? 'on the way to ' + alarmDest : (alarmDest === 'the door' ? 'guarding the door' : 'manning ' + alarmDest)) : c.state === 'walk' ? 'on the way' : c.state === 'eat' ? 'eating' : c.state === 'queue' ? 'waiting for food' : (c.wait && c.wait.job) ? 'waiting for ' + ((JOBS[c.wait.job] && JOBS[c.wait.job].label) || c.wait.job) + ' (full), retry in ' + Math.max(1, Math.ceil(c.wait.until - S.t)) + 'm' : 'working';
    const bondNames = c.bonds.map(id => S.crew.find(o => o.id === id)).filter(o => o && o.alive).map(o => o.name);
    return `<div class="card ${sel === c.id ? 'sel' : ''}" data-crew="${c.id}">
      <div class="ch"><span class="sw" style="background:${c.color}"></span><span aria-hidden="true">${stateIcon(c)}</span><button type="button" data-fk="n:${c.id}" aria-label="Focus camera on ${esc(c.name)}" style="background:none;border:0;color:inherit;font:inherit;font-weight:bold;padding:0;cursor:pointer;text-align:left">${esc(c.name)}</button><span class="tag">${esc(c.role)} · ${state}${c.sick ? ' · SICK' : ''}</span><span class="lvl">LV ${c.lvl}</span></div>
      <div class="bars">${needBar('\u2665', 'HP', c.hp / c.maxHp * 100, '#7ddc6f', 'hp')}${needBar('\uD83C\uDF74', 'Food', c.food, '#c9a27a', 'food')}${needBar('\u263E', 'Rest', rest, sf < 0.6 ? '#ff5a4e' : '#7fc8ff', 'rest', sf < 0.6)}</div>
      <div class="row">${Object.entries(JOBS).filter(([k, j]) => !j.hidden).map(([k, j]) => { const dis = k === 'turretA' && !S.turrets.some(t => t && t.type !== 'coil'); return `<button class="chip ${c.job === k || (k === 'turretA' && c.job === 'turretB') ? 'on' : ''}" data-job="${k}" data-id="${c.id}" ${dis ? 'disabled title="Build a gun turret first"' : (k === 'turretA' ? 'title="Picks a gun turret automatically"' : '')}>${j.label}</button>`; }).join('')}</div>
      <div class="row" style="margin-top:5px">${Object.entries(SHIFTS).map(([k, s]) => { const p = n => String(n % 24).padStart(2, '0') + ':00', h = Math.floor(hourF()), awake = !s.sleep || !(s.sleep[0] > s.sleep[1] ? (h >= s.sleep[0] || h < s.sleep[1]) : (h >= s.sleep[0] && h < s.sleep[1])); return `<button class="chip ${c.shift === k ? 'on' : ''}" data-shift="${k}" data-id="${c.id}" title="${awake ? 'Awake right now' : 'Asleep right now'}">${awake ? '● ' : ''}${s.sleep ? 'Sleeps ' + p(s.sleep[0]) + '-' + p(s.sleep[1]) : s.label}</button>`; }).join('')}</div>
      ${gearRow(c)}
      ${schedHTML(c)}
      <div class="row" style="margin-top:5px"><button class="chip" data-rest="${c.id}" title="Hold to give a rest day: sleep and meals for 24h, morale boost" style="${restHold && restHold.id === c.id ? 'background:linear-gradient(90deg,#3a7a4a ' + Math.min(100, (performance.now() - restHold.t0) / REST_HOLD_MS * 100) + '%,transparent 0)' : ''}">${restActive(c) ? 'Resting (hold to renew)' : 'Hold: Rest day'}</button>${restActive(c) ? '<span class="note" style="margin:0 0 0 6px">Rest day: schedule is sleep and meals, morale +' + REST_BOOST + '</span>' : ''}</div>
      ${bgHTML(c)}<div class="note">Aim ${pctS(c.stats.acc)} · Build ${pctS(c.stats.build)} · Cook ${pctS(c.stats.cook)} · Medic ${pctS(c.stats.med)} · Tech ${pctS(c.stats.tech)}${sf < 1 ? ` · <span style="color:var(--red)">working at ${Math.round(sf * 100)}% (tired)</span>` : ''}${c.grief > 0 ? ' · grieving' : ''}${bondNames.length ? `<br>Works better beside ${esc(bondNames.join(', '))}` : ''}<br>Morale ${Math.round(morale(c))}${morale(c) < 40 ? ' <span style="color:var(--red)">· slow</span>' : ''}</div>
    </div>`;
  }).join('')}`;
}
const pctS = v => Math.round(v * 100);
function stateIcon(c) {
  if (c.state === 'sleep') return '\u{1F4A4}';
  if (c.state === 'patient') return '\u271A';
  if (c.state === 'fight') return '\u2694';
  if (c.state === 'walk') return '\u{1F6B6}';
  if (c.state === 'eat') return '\u{1F372}';
  if (c.state === 'queue' || (c.wait && c.wait.job)) return '\u23F3';
  return '\u{1F527}';
}
function bgHTML(c) {
  if (typeof CrewGen === 'undefined') return '';
  const d = CrewGen.describe(c);
  if (!d.past && !d.traits.length) return '';
  const tr = d.traits.map(t => `<span title="${esc(t.desc)}">${esc(t.label)}</span>`).join(', ');
  return `<div class="note">${d.past ? 'Past: ' + esc(d.past) : ''}${d.past && tr ? ' · ' : ''}${tr ? 'Traits: ' + tr : ''}</div>`;
}
$('#dbody').addEventListener('change', e => {
  const v = e.target.closest ? e.target.closest('[data-view]') : null;
  if (!v) return;
  crewView[v.dataset.view] = v.value; renderDrawer();
});
$('#dbody').addEventListener('click', e => {
  if (!e.target.closest || !e.target.closest('[data-act="clearview"]')) return;
  crewView.sort = 'default'; crewView.need = 'all'; crewView.job = 'all'; crewView.state = 'all'; crewView.mood = 'all'; crewView.q = ''; renderDrawer();
});

// Roster search input and quick filter chips
$('#dbody').addEventListener('input', e => {
  const t = e.target;
  if (!t || !t.matches || !t.matches('[data-q]') || e.isComposing) return;
  crewView.q = t.value; renderDrawer();
});
$('#dbody').addEventListener('click', e => {
  const b = e.target.closest ? e.target.closest('[data-chip]') : null;
  if (!b) return;
  const [k, v] = b.dataset.chip.split(':');
  crewView[k] = crewView[k] === v ? 'all' : v; renderDrawer();
});

// Relationship screen: links come from design/brief.md. Add a person here and they show up automatically.
const REL_NAMES = { mara: 'Mara Voss', lamp: 'Lamp', dorrow: 'Sgt. Hale Dorrow', rook: 'Rook', juno: 'Juno Park', vesper: 'Vesper', warden: 'The Warden', cinder: 'Cinder', bram: 'Old Bram', anand: 'Dr. Priya Anand', nell: 'Nell', tick: 'Tick', reed: 'Doc Reed', builders: 'The original builders' };
const REL = {
  mara: { role: 'Bunker leader (you)', color: '#d9a441', links: [
    { to: 'bram', kind: 'ally', text: 'Built the first door together.' },
    { to: 'tick', kind: 'family', text: 'Pulled him from the wreckage; treats him like a younger sibling.' },
    { to: 'cinder', kind: 'rival', text: 'His raiders killed her brother on the highway.' },
    { to: 'rook', kind: 'tension', text: 'Cinder raised him, so he is tied to her brother\u2019s loss.' },
    { to: 'dorrow', kind: 'none', text: 'No shared history yet.' },
    { to: 'lamp', kind: 'ally', text: 'Lamp addresses her as the bunker\u2019s leader and reports to her.' } ] },
  lamp: { role: 'Bunker AI and narrator', color: '#ffb347', links: [
    { to: 'builders', kind: 'ally', text: 'Installed by the bunker\u2019s original builders. Maintained since by Old Bram and Dr. Anand.' },
    { to: 'bram', kind: 'ally', text: 'Maintained by Bram.' },
    { to: 'anand', kind: 'ally', text: 'Maintained by Dr. Anand.' },
    { to: 'nell', kind: 'friend', text: 'Nell reads it her drawings.' },
    { to: 'mara', kind: 'ally', text: 'Hopes she can lead everyone out.' } ] },
  dorrow: { role: 'Former checkpoint guard', color: '#7d8a70', links: [
    { to: 'juno', kind: 'mentor', text: 'Trained her at the checkpoint.' },
    { to: 'vesper', kind: 'rival', text: 'She served under him before leaving.' },
    { to: 'warden', kind: 'guilt', text: 'The Warden was his unit\u2019s guardian robot; he carries the guilt of its fall.' },
    { to: 'rook', kind: 'mentor', text: 'Willing to train him: the start of Rook\u2019s redemption.' } ] },
  rook: { role: 'Defector, former raider', color: '#b0553a', links: [
    { to: 'cinder', kind: 'rival', text: 'Raised by Cinder as a raider.' },
    { to: 'vesper', kind: 'rival', text: 'Shaped by her; she recruited his loyalty.' },
    { to: 'juno', kind: 'tension', text: 'His raiders were in the attack that destroyed her checkpoint.' },
    { to: 'dorrow', kind: 'mentor', text: 'Dorrow gives him a second chance.' } ] }
};
const REL_KIND = { ally: ['Ally', '#7ddc6f'], family: ['Family', '#7ddc6f'], friend: ['Friend', '#7ddc6f'], mentor: ['Mentor', '#7fc8ff'], tension: ['Tension', '#ffb347'], guilt: ['Guilt', '#ffb347'], rival: ['Rival', '#ff5a4e'], none: ['None', '#b8a78a'] };
function relStatus(id) {
  if (id === 'mara') return S.player.down ? 'down' : 'in the bunker';
  if (id === 'lamp') return 'online';
  const c = S.crew.find(x => x.id === id);
  if (!c) return REL[id] ? 'not in the bunker yet' : '';
  if (!c.alive) return c.left ? 'left the bunker' : 'lost';
  return c.grief > 0 ? 'grieving' : 'in the bunker';
}
function relHTML() {
  return `<p class="note" style="margin:0">Shared history shapes who works well together, who grieves, and who sides with whom in a revolt.</p>`
    + Object.entries(REL).map(([id, r]) => {
      const st = relStatus(id);
      return `<div class="card"><div class="ch"><span class="sw" style="background:${r.color}"></span><b>${esc(REL_NAMES[id])}</b><span class="tag">${esc(r.role)} · ${esc(st)}</span></div>`
        + r.links.map(l => { const k = REL_KIND[l.kind], os = relStatus(l.to); return `<div class="note"><b style="color:${k[1]}">${k[0]}</b> · ${esc(REL_NAMES[l.to] || l.to)}${os && os !== 'in the bunker' && os !== 'online' ? ' <span class="tag">(' + esc(os) + ')</span>' : ''}<br>${esc(l.text)}</div>`; }).join('')
        + `</div>`;
    }).join('');
}
function buildHTML() {
  const item = (title, desc, cost, act, ok = true, label = 'Build') => `<div class="card bitem"><div><b>${title}</b><p>${desc}</p>${cost ? `<span class="cost">${fmtCost(cost)}</span>` : ''}</div><button class="btn" data-build="${act}" ${ok && (!cost || canPay(cost)) ? '' : 'disabled'}>${label}</button></div>`;
  const repCost = s => ({ scrap: Math.ceil((s.max - s.hp) / 10) });
  const CATS = { structure: [], energy: [], crafting: [], research: [], food: [], water: [], defenses: [], medical: [], furniture: [], decor: [] };
  const RC = { workshop: CATS.crafting, generator: CATS.energy, armory: CATS.defenses, storage: CATS.structure };
  let out = CATS.defenses;
  out.push(item('Repair the hatch', `${Math.ceil(S.door.hp)} / ${S.door.max}. The workshop also repairs it slowly.`, S.door.hp < S.door.max ? repCost(S.door) : null, 'repDoor', S.door.hp < S.door.max && !S.enemies.some(e => e.inside), 'Repair'));
  out.push(item(S.wall.hp > 0 ? 'Repair the wall' : 'Rebuild the wall', `${Math.ceil(S.wall.hp)} / ${S.wall.max}. Enemies have to break it before they reach the turrets.`, S.wall.hp < S.wall.max ? repCost(S.wall) : null, 'repWall', S.wall.hp < S.wall.max, 'Repair'));
  if (S.wall.lvl < 2) out.push(item('Reinforce the wall', 'Double its strength and add spikes.', { scrap: 30, mat: 12 }, 'upWall'));
  for (const i of [0, 1]) {
    const t = S.turrets[i];
    if (!t) { for (const [k, sp] of Object.entries(TURRETS)) out.push(item(`${sp.name} in slot ${i + 1}`, sp.desc || (k === 'rifle' ? 'Long range, one accurate shot. Best with a good shot like Juno.' : 'Short range, four pellets. Shreds anything at the wall.'), sp.cost, 'turret' + i + k)); }
    else {
      if (t.hp < t.max) out.push(item(`Repair turret ${i + 1}`, `${Math.ceil(t.hp)} / ${t.max}`, repCost(t), 'repT' + i, true, 'Repair'));
      if (t.lvl < 2 && t.type !== 'coil') out.push(item(`Upgrade turret ${i + 1} (${TURRETS[t.type].name.toLowerCase()})`, '40% more damage per hit.', { parts: 8, elec: 2 }, 'upT' + i, true, 'Upgrade'));
    }
  }
  for (const i of [0, 1]) if (S.turrets[i]) CATS.defenses.push(turretStatusHTML(i));
  out = CATS.structure;
  breachState().scars.forEach((sc, i) => out.push(item('Rebuild scarred ' + scarName(sc.room) + ' <span class="tag">severity ' + sc.severity + '</span>', sc.room === 'door' ? 'Rebuilt hatch has 15% less max HP, permanently.' : 'Removes the scar, but the room is permanently 15% less effective. Until then it runs at ' + Math.round(SCAR_PENALTY * sc.severity * 100) + '% less.', scarCost(sc), 'rescar_' + i, true, 'Rebuild')));
  if ((S.rooms.hydro || 1) < 2) CATS.food.push(item('Hydroponics: grow lamps', 'Hydroponics grows 50% more food.', { elec: 3, mat: 8 }, 'upHydro', true, 'Upgrade'));
  if (S.rooms.med < 2) CATS.medical.push(item('Med bay: proper beds', 'Patients heal 50% faster.', { elec: 3, mat: 6 }, 'upMed', true, 'Upgrade'));
  if (S.rooms.bunks < 2) CATS.furniture.push(item('Bunks: real mattresses', 'A full rest takes 5 hours instead of 7.', { scrap: 10, mat: 10 }, 'upBunks', true, 'Upgrade'));
  out.push(`<div class="card bitem"><div><b>Dig tool (X)</b><p>Drag a box over the pit under the bunker to mark cells. Crew on the Miner job clear them: dirt is quick, clay slower, rock slow, hard stone very slow. Annex rooms are built in cleared chambers.</p></div><button class="btn ghost" data-build="toggleDig">${digTool ? 'On' : 'Off'}</button></div>`);
  for (const [k, r] of Object.entries(BUILD_ROOMS)) if (!S.rooms[k]) { const sz = ROOM_CELLS[k]; RC[k].push(item('Build ' + ROOMS[k].name, r.desc + ' A ' + sz.w + 'x' + sz.h + ' tile room: you choose the spot on the pit grid, on cleared tiles that connect to the bunker.', r.cost, 'room_' + k, true, 'Place')); }
  out.push(`<div class="card bitem"><div><b>Ladder segments (L)</b><p>One tile wide. In the pit, put one on a cleared tile that touches the floor above, a room or another ladder: crew only change rows on ladders and inside rooms. In the bunker, put one between two floors for a second route.</p><span class="cost">${fmtCost(LADDER_COST.pit)} per pit tile · ${fmtCost(LADDER_COST.bunker)} per floor gap</span></div><button class="btn ghost" data-build="toggleLadder">${placing && placing.kind === 'ladder' ? 'On' : 'Off'}</button></div>`);
  for (const k of Object.keys(BUILD_ROOMS)) if (S.rooms[k] && dg().rooms[k] && !pitRoomReachable(k)) out.push(`<p class="note bad">${ROOMS[k].name}: no ladder route from the bunker yet. Dig and ladder a way down to it.</p>`);
  if (!S.rooms.workshop) CATS.crafting.push('<p class="note bad">No workshop yet: nothing is repaired and nobody makes parts or weapons. Place one above.</p>');
  if (S.rooms.generator) CATS.energy.push(`<p class="note">Generator: ${S.powered ? 'running, burning about ' + Math.round(ROOM_FX.fuelPerHour * 24) + ' scrap a day' : '<span style="color:var(--red)">OFF: out of scrap</span>'}</p>`);
  if (S.rooms.workshop) CATS.crafting.push(`<div class="card bitem"><div><b>Workshop makes parts</b><p>When nothing needs repairing, workshop crew turn 2 scrap into 1 part.</p></div><button class="btn ghost" data-build="toggleParts">${S.makeParts ? 'On' : 'Off'}</button></div>`);
  // workshop bed repair: one entry per damaged bunk (index = position in itemList)
  const dmgBunks = [];
  itemList().forEach((it, i) => { if (it.type === 'bunk' && it.damaged) dmgBunks.push(i); });
  if (dmgBunks.length && !S.rooms.workshop) CATS.crafting.push('<p class="note bad">' + dmgBunks.length + ' damaged bunk(s). Repairing beds needs a workshop.</p>');
  else if (S.rooms.workshop) dmgBunks.forEach((i, n) => CATS.crafting.push(item('Repair damaged bunk ' + (n + 1), 'Cracked bunk: its two beds do not count toward capacity until repaired.', { scrap: BED_REPAIR_COST }, 'rep_bed_' + i, true, 'Repair')));
  // furniture bought one piece at a time (auto-placed in the next free spot) and installable buildings
  const own = t => itemList().filter(it => it.type === t).length;
  const buy = (t, cat, desc, top) => { const T = ITEM_TYPES[t]; const h = item(T.name + ' <span class="tag">' + own(t) + ' built</span>', desc, T.cost, 'buy_' + t, !!ROOMS[T.room], 'Build'); if (top) CATS[cat].unshift(h); else CATS[cat].push(h); };
  const beds = bedCount(), crewN = living().length;
  buy('bunk', 'furniture', 'Each bunk gives two crew a bed. Beds: ' + beds + ' for ' + crewN + ' crew (capacity ' + crewCap() + '). People without one sleep on the floor and rest worse.', true);
  buy('cot', 'medical', 'Another cot for the med bay.');
  buy('table', 'furniture', 'A table in the common room, where meals are eaten.');
  buy('poster', 'decor', 'Faded pre-ash poster. Small morale boost for everyone.');
  buy('rug', 'decor', 'A worn rug for the common room. Small morale boost for everyone.');
  buy('plant', 'decor', 'A potted plant that somehow survived. Small morale boost for everyone.');
  buy('lantern', 'decor', 'Warm light for the bunks. Small morale boost for everyone.');
  CATS.decor.push(`<p class="note">Decorations raise morale a little for everyone (${decoCount()} placed, up to +${(DECO_CAP).toFixed(1)} an hour).</p>`);
  buy('console', 'research', 'Another signal console.');
  buy('planter', 'food', 'Another hydroponics planter. More planters, more crew can grow food at once.');
  buy('stove', 'food', 'Another stove for the kitchen.');
  for (const [k, b] of Object.entries(BUILDS)) {
    const done = hasB(k), ok = !b.req || S.rooms[b.req];
    CATS[b.cat].push(done ? `<div class="card bitem"><div><b>${b.name}</b><p>${b.desc}</p></div><span class="tag">BUILT</span></div>` : item(b.name, b.desc + (ok ? '' : ' Needs the ' + ROOMS[b.req].name + ' first.'), b.cost, 'bld_' + k, !!ok));
  }
  CATS.crafting.push(maintHTML()); CATS.research.unshift(...researchHTML()); CATS.expedition = expHTML();
  const cat = CATS[buildCat] ? buildCat : 'structure';
  const rail = BUILD_CATS.map(([k, n]) => `<button class="bcat ${k === cat ? 'on' : ''}" data-bcat="${k}" title="${n}" aria-label="${n}"><span class="bi bi-${k}"></span><em>${n}</em></button>`).join('');
  return `<div class="brow"><nav class="brail" aria-label="Build categories">${rail}</nav><div class="bmain"><div class="sec">${BUILD_CATS.find(c => c[0] === cat)[1].toUpperCase()}</div>${CATS[cat].join('') || '<p class="note">Nothing to build here yet.</p>'}</div></div>`;
}
function towerShort(c) { return Object.entries(c).filter(([k, v]) => (S.res[k] || 0) < v).map(([k, v]) => ({ k, need: v - Math.floor(S.res[k] || 0) })); }
function towerCostHTML(c, live) {
  return Object.entries(c).map(([k, v]) => {
    const txt = fmtCost({ [k]: v }), have = Math.floor(S.res[k] || 0);
    return live && have < v ? `<span style="color:var(--red)">${txt} (need ${v - have} more)</span>` : txt;
  }).join(', ');
}
function towerNote(c) {
  const miss = towerShort(c);
  return miss.length ? `<p class="note bad" style="margin:4px 0 0">Gather ${miss.map(m => m.need + ' more ' + RES.find(r => r.k === m.k).name.toLowerCase()).join(', ')} to start this stage.</p>` : '';
}
function towerHTML() {
  const st = S.tower.done, cur = TOWER[st], need = cur ? cur.work : 0;
  const workers = living().filter(c => c.job === 'signal');
  return `<p class="note" style="margin:0">${GOAL_KIND === 'vehicle' ? 'Finish all four stages to build the escape vehicle and drive everyone out.' : 'Finish all four stages to send the signal and win.'} Pay for a stage here, then give crew the Signal tower job. People with high Tech work faster.</p>
  <div class="stages">${TOWER.map((t, i) => `<div class="card stage ${i < st ? 'done' : i === st ? 'cur' : ''}"><span class="n">${i < st ? '✓' : i + 1}</span><div style="flex:1"><b>${t.name}</b><p class="note" style="margin:2px 0 0">${towerCostHTML(t.cost, i === st && !S.tower.paid)} · ${t.work} work</p>
    ${i === st ? (S.tower.paid ? `<div style="margin-top:6px">${bar(S.tower.work / need * 100, '#7fc8ff')}</div><p class="note">${Math.floor(S.tower.work)} / ${need} work · ${workers.length ? workers.map(w => esc(w.name)).join(', ') + ' on it' : '<span style="color:var(--red)">nobody is on the Signal tower job</span>'}</p>` : `<button class="btn" style="margin-top:6px" data-build="tower" ${canPay(t.cost) ? '' : 'disabled'}>Start this stage</button>${canPay(t.cost) ? '' : towerNote(t.cost)}`) : ''}</div></div>`).join('')}</div>`;
}
function stationBoard() {
  const grabbed = sbGrab ? S.crew.find(x => x.id === sbGrab && x.alive) : null;
  if (sbGrab && !grabbed) sbGrab = null;
  const hasGun = S.turrets.some(t => t && t.type !== 'coil');
  const zones = Object.entries(JOBS).filter(([k, j]) => !j.hidden).map(([k, j]) => {
    const members = living().filter(c => c.job === k || (k === 'turretA' && c.job === 'turretB'));
    const cap = STATIONS[k] && STATIONS[k].capacity;
    const dis = k === 'turretA' && !hasGun;
    const chips = members.map(c => `<button type="button" class="sbchip ${sbGrab === c.id ? 'grab' : ''}" draggable="true" data-sbc="${c.id}" aria-pressed="${sbGrab === c.id}" title="Drag to another station, or press Enter to pick up">${esc(c.name)}</button>`).join('');
    return `<div class="sbzone" role="group" data-sbz="${k}" aria-label="${esc(j.label)} station, ${members.length}${cap ? ' of ' + cap : ''} assigned"><button type="button" class="sbhead" data-sbzbtn="${k}" ${dis ? 'disabled title="Build a gun turret first"' : ''}>${esc(j.label)} <span class="tag">${members.length}${cap ? '/' + cap : ''}</span>${grabbed ? ' \u2190 place ' + esc(grabbed.name) + ' here' : ''}</button><div class="sbchips">${chips || '<span class="note" style="margin:0">empty</span>'}</div></div>`;
  }).join('');
  return `<div class="sec">STATIONS</div><p class="note" style="margin:0">Drag a name onto a station, or press Enter on a name to pick it up, then press a station's button.</p><div class="sbstatus" aria-live="polite">${grabbed ? 'Picked up ' + esc(grabbed.name) + '. Choose a station, or press Esc to cancel.' : ''}${grabbed ? ' <button type="button" class="chip" data-sbcancel="1">Cancel</button>' : ''}</div><div class="sbboard">${zones}</div>`;
}
function sbAssign(id, job) {
  const c = S.crew.find(x => x.id === id && x.alive); if (!c) return;
  if (job === 'turretA' && !S.turrets.some(t => t && t.type !== 'coil')) { lamp('Build a gun turret first.', 'warn'); return; }
  if (c.job === job || (job === 'turretA' && c.job === 'turretB')) return;
  c.job = job; if (c.job === 'turretA' || c.job === 'turretB') c.job = autoTurret(c);
  if (tut) tut.job = true; c.alarmSlot = null; sel = c.id;
  renderDrawer(); jobChipFeedback(c.id, c.job, c.name, true);
}
function sbFocus(id) { const el = document.querySelector('#dbody [data-sbc="' + id + '"]'); if (el) el.focus({ preventScroll: true }); }
(function () {
  const body = $('#dbody');
  body.addEventListener('dragstart', e => {
    const ch = e.target.closest && e.target.closest('[data-sbc]'); if (!ch) return;
    sbDrag = ch.dataset.sbc; sbGrab = null;
    if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', sbDrag); }
  });
  body.addEventListener('dragover', e => {
    const z = e.target.closest && e.target.closest('[data-sbz]'); if (!z || !sbDrag) return;
    e.preventDefault(); z.classList.add('over');
  });
  body.addEventListener('dragleave', e => { const z = e.target.closest && e.target.closest('[data-sbz]'); if (z && !z.contains(e.relatedTarget)) z.classList.remove('over'); });
  body.addEventListener('drop', e => {
    const z = e.target.closest && e.target.closest('[data-sbz]'); if (!z || !sbDrag) return;
    e.preventDefault(); const id = sbDrag; sbDrag = null; sbAssign(id, z.dataset.sbz); renderDrawer(); sbFocus(id);
  });
  body.addEventListener('dragend', () => { if (sbDrag) { sbDrag = null; renderDrawer(); } });
  body.addEventListener('click', e => {
    if (e.target.closest('[data-sbcancel]')) { sbGrab = null; renderDrawer(); return; }
    const ch = e.target.closest('[data-sbc]');
    if (ch) { const id = ch.dataset.sbc; sbGrab = sbGrab === id ? null : id; renderDrawer(); sbFocus(id); return; }
    const zb = e.target.closest('[data-sbzbtn]');
    if (zb && sbGrab) { const id = sbGrab; sbGrab = null; sbAssign(id, zb.dataset.sbzbtn); renderDrawer(); sbFocus(id); }
  });
  body.addEventListener('keydown', e => {
    if (e.key === 'Escape' && sbGrab) { e.stopPropagation(); e.preventDefault(); const id = sbGrab; sbGrab = null; renderDrawer(); sbFocus(id); }
  });
})();
function jobChipFeedback(id, job, name, walking) {
  const label = (JOBS[job] && JOBS[job].label) || job;
  lamp(walking ? name + ' assigned to ' + label + ' \u2013 walking there now.' : name + ' set to ' + label + '.', 'good');
  if (window.SFX && SFX.click) SFX.click();
  const chip = document.querySelector('#dbody [data-job="' + (job === 'turretB' ? 'turretA' : job) + '"][data-id="' + id + '"]');
  if (chip && chip.animate && !prefs.rm) {
    chip.animate([{ transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(255,200,90,.9)' }, { transform: 'scale(1.18)', boxShadow: '0 0 0 6px rgba(255,200,90,0)' }, { transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(255,200,90,0)' }], { duration: 450, easing: 'ease-out' });
  }
}
// Build-menu tooltips: one shared element, driven by hover and keyboard focus on .bitem cards.
var buildTipEl = null, buildTipFor = null;
function hideBuildTip() {
  if (buildTipEl) buildTipEl.hidden = true;
  if (buildTipFor) buildTipFor.removeAttribute('aria-describedby');
  buildTipFor = null;
}
function enhanceBuildCards(body) {
  body.querySelectorAll('.bitem').forEach(c => {
    c.tabIndex = 0;
    const b = c.querySelector('[data-build]'), a = b ? b.dataset.build : '';
    if (a === 'toggleDig') c.dataset.hotkey = 'X';
    else if (a === 'toggleLadder') c.dataset.hotkey = 'L';
  });
  if (buildTipFor && !body.contains(buildTipFor)) hideBuildTip();
}
function showBuildTip(card) {
  if (card === buildTipFor) return;
  hideBuildTip();
  if (!buildTipEl) { buildTipEl = document.createElement('div'); buildTipEl.id = 'btip'; buildTipEl.className = 'btip'; buildTipEl.setAttribute('role', 'tooltip'); document.body.appendChild(buildTipEl); }
  const t = buildTipEl, nm = card.querySelector('b'), ds = card.querySelector('p'), cs = card.querySelector('.cost'), btn = card.querySelector('.btn:disabled:not(.ghost)');
  t.textContent = '';
  const line = (cls, txt) => { const d = document.createElement('div'); d.className = cls; d.textContent = txt; t.appendChild(d); };
  line('bt-name', nm ? nm.textContent : 'Build');
  if (ds && ds.textContent) line('bt-desc', ds.textContent);
  line('bt-cost', 'Cost: ' + (cs && cs.textContent ? cs.textContent : 'none'));
  line('bt-key', 'Hotkey: ' + (card.dataset.hotkey || 'none'));
  if (btn) line('bt-warn', 'Unavailable right now: missing resources or a requirement.');
  t.hidden = false; t.style.left = '0px'; t.style.top = '0px';
  const r = card.getBoundingClientRect(), w = t.offsetWidth, h = t.offsetHeight;
  let left = r.left - w - 8;
  if (left < 8) left = Math.min(r.right + 8, window.innerWidth - w - 8);
  left = Math.max(8, left);
  const top = Math.max(8, Math.min(r.top, window.innerHeight - h - 8));
  t.style.left = left + 'px'; t.style.top = top + 'px';
  card.setAttribute('aria-describedby', 'btip');
  buildTipFor = card;
}
$('#dbody').addEventListener('mouseover', e => { const c = e.target.closest ? e.target.closest('.bitem') : null; if (c) showBuildTip(c); else hideBuildTip(); });
$('#dbody').addEventListener('mouseleave', hideBuildTip);
$('#dbody').addEventListener('focusin', e => { const c = e.target.closest ? e.target.closest('.bitem') : null; if (c) showBuildTip(c); else hideBuildTip(); });
$('#dbody').addEventListener('focusout', hideBuildTip);
$('#dbody').addEventListener('keydown', e => { if (e.key === 'Escape') hideBuildTip(); });
$('#dbody').addEventListener('click', e => {
  const j = e.target.closest('[data-job]'), s = e.target.closest('[data-shift]'), b = e.target.closest('[data-build]'), card = e.target.closest('[data-crew]');
  if (e.target.closest('[data-act="compact"]')) { crewView.compact = !compactOn(); renderDrawer(); return; }
  const bc = e.target.closest('[data-bcat]'); if (bc) { buildCat = bc.dataset.bcat; uiConfirm(); renderDrawer(); return; }
  const gb = e.target.closest('[data-gear]');
  if (gb) { gearAct(gb.dataset.gear, gb.dataset.g, gb.dataset.id); uiConfirm(); renderDrawer(); renderHud(); return; }
  const br = e.target.closest('[data-brush]'), cell = e.target.closest('[data-cell]');
  if (br) { schedBrush = br.dataset.brush; uiConfirm(); renderDrawer(); return; }
  if (cell) { const c = S.crew.find(x => x.id === cell.dataset.id); if (c) { const a = ensureSched(c).split(''); a[+cell.dataset.cell] = schedBrush; c.sched = a.join(''); c.shift = 'custom'; c.restUntil = 0; c.restPrev = null; sel = c.id; uiConfirm(); } renderDrawer(); return; }
  if (j) { if (j.dataset.id === 'player') { S.player.job = j.dataset.job; renderDrawer(); jobChipFeedback('player', S.player.job, S.player.name || 'Mara', false); return; } const c = S.crew.find(x => x.id === j.dataset.id); c.job = j.dataset.job; if (c.job === 'turretA' || c.job === 'turretB') c.job = autoTurret(c); if (tut) tut.job = true; c.alarmSlot = null; sel = c.id; renderDrawer(); jobChipFeedback(c.id, c.job, c.name, true); return; }
  if (s) { const c = S.crew.find(x => x.id === s.dataset.id); c.shift = s.dataset.shift; c.sched = defaultSched(c.shift); c.restUntil = 0; c.restPrev = null; sel = c.id; uiConfirm(); renderDrawer(); return; }
  if (b) {
    const s0 = uiSfxN, p0 = payN, bid = b.dataset.build, bcard = b.closest('.card'), bt = bcard && bcard.querySelector('b'), nm = bt ? bt.textContent : 'Build action';
    doBuild(bid); if (uiSfxN === s0) { if (payN !== p0) uiSfx('Place'); else uiConfirm(); } renderDrawer(); renderHud();
    const nb = document.querySelector(`#dbody [data-build="${CSS.escape(bid)}"]`), st = nb ? nb.textContent.trim() : '';
    srSay(payN !== p0 ? nm + ': done, resources spent.' : placing ? nm + ': placement mode. Click the bunker to place, Escape or right-click to cancel.' : /^(On|Off)$/.test(st) ? nm + ' ' + st.toLowerCase() + '.' : nm + ': not available right now.');
    return;
  }
  const evEl = e.target.closest('[data-ev]');
  if (evEl) { const ev = events.find(x => String(x.id) === evEl.dataset.ev); if (ev) jumpTo(ev.loc); return; }
  if (card) {
    sel = card.dataset.crew;
    if (scene === 'bunker') { focusFx = { id: sel, t: performance.now() }; bcamFocus(sel); pendingFocus = null; }
    else { pendingFocus = sel; try { lamp('Selected. The camera will find them when you are back in the bunker.'); } catch (_) {} }
    renderDrawer();
  }
});
$('#dbody').addEventListener('pointerdown', e => {
  const r = e.target.closest && e.target.closest('[data-rest]');
  if (!r || !S) return;
  const id = r.dataset.rest;
  if (restHold && restHold.timer) clearTimeout(restHold.timer);
  r.style.touchAction = 'none'; r.style.userSelect = 'none'; r.style.webkitUserSelect = 'none';
  const hold = restHold = { id, t0: performance.now(), timer: setTimeout(() => {
    const c = S.crew.find(x => x.id === id);
    restHold = null;
    if (c && c.alive) { startRestDay(c); sel = c.id; }
    renderDrawer();
  }, REST_HOLD_MS) };
  const tickFill = () => {
    if (restHold !== hold) return;
    if (r.isConnected) r.style.background = 'linear-gradient(90deg,#3a7a4a ' + Math.min(100, (performance.now() - hold.t0) / REST_HOLD_MS * 100) + '%,transparent 0)';
    requestAnimationFrame(tickFill);
  };
  requestAnimationFrame(tickFill);
});
$('#dbody').addEventListener('contextmenu', e => { if (e.target.closest && e.target.closest('[data-rest]')) e.preventDefault(); });
// keyboard: Enter/Space on a focused compact crew row acts like a click (name buttons handle this natively)
$('#dbody').addEventListener('keydown', e => {
  const t = e.target;
  if ((e.key === 'Enter' || e.key === ' ') && t && t.matches && t.matches('[data-crew][tabindex]')) { e.preventDefault(); t.click(); }
  if (t && t.matches && t.matches('[data-q]') && e.key === 'Escape' && crewView.q) { e.preventDefault(); e.stopPropagation(); crewView.q = ''; renderDrawer(); return; }
  if (t && t.matches && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key) && (t.matches('[data-crew][tabindex],[data-fk^="n:"]') || (t.matches('[data-q]') && e.key === 'ArrowDown'))) {
    const rows = [...$('#dbody').querySelectorAll('[data-crew][tabindex],[data-fk^="n:"]')];
    if (!rows.length) return;
    e.preventDefault(); e.stopPropagation();
    const i = rows.indexOf(t);
    if (i < 0) { rows[0].focus(); return; }
    if (e.key === 'ArrowUp' && i === 0) { const q = $('#dbody [data-q]'); if (q) q.focus(); return; }
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
    rows[n].focus(); rows[n].scrollIntoView({ block: 'nearest' });
  }
});
function cancelRestHold() { if (restHold) { clearTimeout(restHold.timer); restHold = null; renderDrawer(); } }
window.addEventListener('pointerup', cancelRestHold);
window.addEventListener('pointercancel', cancelRestHold);
// ---- room items on a 30px tile grid (snap-to-grid build mode) ----
const ITILE = 30, ITX0 = 180;
const ITEM_TYPES = {
  stove:   { name: 'Stove',     room: 'kitchen',  w: 2, cost: { scrap: 12 }, color: '#8a6a42' },
  planter: { name: 'Planter',   room: 'hydro',    w: 2, cost: { scrap: 10 }, color: '#3a5a2a' },
  cot:     { name: 'Med cot',   room: 'med',      w: 3, cost: { scrap: 14 }, color: '#d8d2c4' },
  bunk:    { name: 'Bunk',      room: 'bunks',    w: 2, cost: { scrap: 10 }, color: '#6a5a48' },
  table:   { name: 'Table',     room: 'common',   w: 3, cost: { scrap: 8 },  color: '#6b4b33' },
  console: { name: 'Console',   room: 'signal',   w: 2, cost: { scrap: 20 }, color: '#3d4650' },
  poster:  { name: 'Poster',    room: 'common',   w: 1, cost: { scrap: 4 },  color: '#b08a5a', deco: true },
  rug:     { name: 'Rug',       room: 'common',   w: 3, cost: { scrap: 6 },  color: '#8a3a2a', deco: true },
  plant:   { name: 'Plant',     room: 'common',   w: 1, cost: { scrap: 5 },  color: '#4a6a3a', deco: true },
  lantern: { name: 'Lantern',   room: 'bunks',    w: 1, cost: { scrap: 4, parts: 1 }, color: '#3a2a18', deco: true }
};
const DECO_CAP = 1.5;   // max morale per hour from decorations
const decoCount = () => itemList().filter(it => ITEM_TYPES[it.type] && ITEM_TYPES[it.type].deco).length;
const ITEM_MAX_LVL = 3;
// Starter furniture, all snapped to the 30px grid (col = (x - ITX0) / ITILE). Seeded lazily so old saves without items get it too.
const DEFAULT_ITEM_LAYOUT = [
  ['hydro', 'planter', 3], ['hydro', 'planter', 6], ['hydro', 'planter', 9], ['hydro', 'planter', 12], ['hydro', 'planter', 15],
  ['kitchen', 'stove', 3],
  ['med', 'cot', 19], ['med', 'cot', 24], ['med', 'cot', 29],
  ['common', 'table', 26],
  ['signal', 'console', 33]
];
function defaultItems() {
  S.itemSeq = S.itemSeq || 0;
  return DEFAULT_ITEM_LAYOUT.map(([room, type, col]) => ({ id: ++S.itemSeq, type, room, col, lvl: 1 }));
}
function itemList() { if (!S.items) S.items = defaultItems(); return S.items; }
function roomItems(job) {
  if (!S) return [];
  const k = Object.keys(ROOMS).find(x => ROOMS[x].job === job);
  return k ? itemList().filter(it => it.room === k).sort((a, b) => a.col - b.col) : [];
}
function itemBoost(c) {
  const job = targetJob(c), its = roomItems(job);
  if (!its.length) return 1;
  const i = Math.max(0, living().filter(o => targetJob(o) === job).indexOf(c));
  return 1 + 0.25 * ((its[i % its.length].lvl || 1) - 1);
}
function itemCellAt(w) {
  for (const k of Object.keys(ROOMS)) {
    const r = ROOMS[k];
    if (typeof r.x0 !== 'number' || !(r.floor > 0)) continue;
    if (w.x >= r.x0 && w.x < r.x1 && w.y >= FLOORS[r.floor - 1] && w.y < FLOORS[r.floor]) return { k, r, col: Math.floor((w.x - ITX0) / ITILE) };
  }
  return null;
}
function itemHit(k, col) { return itemList().find(it => it.room === k && col >= it.col && col < it.col + ITEM_TYPES[it.type].w); }
function itemSpotOk(k, r, col, w) {
  const lo = Math.ceil((r.x0 + 4 - ITX0) / ITILE), hi = Math.floor((r.x1 - 4 - ITX0) / ITILE) - w;
  if (col < lo || col > hi) return false;
  return !itemList().some(it => it.room === k && col < it.col + ITEM_TYPES[it.type].w && it.col < col + w);
}
function placeItem(w, shift) {
  const c = itemCellAt(w); if (!c) return;
  const hit = itemHit(c.k, c.col);
  if (hit) {
    if (shift) { S.items = itemList().filter(x => x !== hit); lamp(ITEM_TYPES[hit.type].name + ' removed.', 'warn'); return; }
    if ((hit.lvl || 1) >= ITEM_MAX_LVL) { lamp(ITEM_TYPES[hit.type].name + ' is fully upgraded.'); return; }
    const cost = { scrap: 15 * (hit.lvl || 1) };
    if (!canPay(cost)) { lamp('Upgrading needs ' + fmtCost(cost) + '.', 'warn'); return; }
    pay(cost); hit.lvl = (hit.lvl || 1) + 1; lamp(ITEM_TYPES[hit.type].name + ' upgraded to level ' + hit.lvl + '.', 'good'); return;
  }
  const T = ITEM_TYPES[itemSel];
  if (T.room !== c.k) { lamp('A ' + T.name.toLowerCase() + ' belongs in the ' + ROOMS[T.room].name + '.', 'warn'); return; }
  if (!itemSpotOk(c.k, c.r, c.col, T.w)) { lamp('No room for that there.', 'warn'); return; }
  if (!canPay(T.cost)) { lamp('Building needs ' + fmtCost(T.cost) + '.', 'warn'); return; }
  pay(T.cost);
  S.itemSeq = (S.itemSeq || 0) + 1;
  itemList().push({ id: S.itemSeq, type: itemSel, room: c.k, col: c.col, lvl: 1 });
}
function drawItemSprite(type, x, yb, w, T) {
  const c = T.color;
  if (typeof VEC !== 'undefined') { VEC.item(g, type, x, yb, w, T, { powered: !!(S && S.powered), cooked: type === 'stove' ? kit().cooked : 0 }); return; }
  if (type === 'bench') {
    box(x + 2, yb - 26, w - 4, 8, '#7a6a55'); box(x + 4, yb - 18, 5, 18, c); box(x + w - 9, yb - 18, 5, 18, c);
    box(x + 8, yb - 32, 12, 6, '#9a8a70'); g.fillStyle = '#ffb347'; g.fillRect(x + w - 18, yb - 31, 6, 5);
  } else if (type === 'stove') {
    box(x + 2, yb - 26, w - 4, 26, c); box(x + 2, yb - 28, w - 4, 3, '#a58458');
    g.fillStyle = '#ff9a3a'; g.fillRect(x + 8, yb - 14, 10, 6);
    for (let i = 0, n = Math.min(8, Math.floor(kit().cooked)); i < n; i++) box(x + 4 + i * 6, yb - 34, 4, 6, '#e8b86a');
  } else if (type === 'planter') {
    box(x + 2, yb - 10, w - 4, 10, c);
    g.fillStyle = '#7ddc6f';
    for (let j = 0; j < 4; j++) g.fillRect(x + 6 + j * 12, yb - 22 - (j % 2) * 4, 5, 12);
  } else if (type === 'cot') {
    box(x + 2, yb - 16, w - 4, 8, c); box(x + 2, yb - 10, 5, 10, '#777'); box(x + w - 7, yb - 10, 5, 10, '#777');
    box(x + 4, yb - 22, 16, 6, '#eee8dc');
  } else if (type === 'bunk') {
    box(x + 2, yb - 14, w - 4, 8, c); box(x + 2, yb - 36, w - 4, 8, c);
    box(x + 2, yb - 36, 4, 36, '#4a3d2e'); box(x + w - 6, yb - 36, 4, 36, '#4a3d2e');
  } else if (type === 'table') {
    box(x + 2, yb - 26, w - 4, 8, c); box(x + 8, yb - 18, 8, 18, '#5a3d28'); box(x + w - 16, yb - 18, 8, 18, '#5a3d28');
  } else if (type === 'console') {
    box(x + 2, yb - 30, w - 4, 30, c); box(x + 6, yb - 26, w - 12, 12, S && S.powered ? '#2f7fa8' : '#222');
    g.fillStyle = '#ffb347'; g.fillRect(x + 8, yb - 8, 4, 4); g.fillRect(x + 16, yb - 8, 4, 4);
  } else {
    box(x + 1, yb - 28, w - 2, 28, c);
  }
  g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 1; g.strokeRect(x + 1.5, yb - 27.5, w - 3, 27);
}
// the pantry shelves where raw food is stored (cooks fetch crates from here)
function drawPantry(yb) {
  const x = PANTRY_X, n = Math.max(0, Math.min(6, Math.ceil(S.res.food / 10)));
  box(x - 24, yb - 4, 48, 4, '#4a3a2a');
  const spots = [[-22, 0], [-2, 0], [18, 0], [-12, -14], [8, -14], [-2, -28]];
  for (let i = 0; i < n; i++) { const [dx, dy] = spots[i]; box(x + dx, yb - 18 + dy, 18, 14, i % 2 ? '#7a5c38' : '#8a6a42'); g.fillStyle = '#5a4228'; g.fillRect(x + dx, yb - 12 + dy, 18, 1.5); g.fillStyle = '#7ddc6f'; g.fillRect(x + dx + 4, yb - 20 + dy, 5, 3); }
  g.fillStyle = 'rgba(255,214,150,.6)'; g.font = '600 10px "Chakra Petch"'; g.fillText('PANTRY', x - 18, yb - 48);
}
// bed ownership for display only: holders (c.bed === true) fill undamaged bunks' beds in order
function bedOwners() {
  const m = new Map(), holders = living().filter(o => o.bed === true);
  let i = 0;
  for (const it of itemList()) if (it.type === 'bunk' && !it.damaged) { const a = holders[i++] || null, b = holders[i++] || null; m.set(it.id, [a, b]); }
  return m;
}
function bedHudHtml() {
  const beds = bedCount(), crew = living().length, floor = living().filter(o => o.bed === false).length;
  const cracked = itemList().filter(it => it.type === 'bunk' && it.damaged).length;
  const warn = floor > 0 || crew > beds;
  const used = Math.min(crew, beds);
  const txt = 'Beds ' + used + '/' + beds + (floor ? ', ' + floor + ' on the floor' : '') + (cracked ? ', ' + cracked + ' cracked bunk(s)' : '');
  return `<span class="res"><span class="${warn ? 'lowres' : ''}" ${tipAttrs('beds', 'Beds used / total. Only undamaged bunks count. Crew without a bed sleep on the floor and rest worse.' + (cracked ? ' Cracked bunks can be repaired at the workshop.' : ''), txt)}><i style="background:#b8a78a"></i>${warn ? '<em class="lowico" aria-hidden="true">&#9888;</em>' : ''}Beds <b class="${warn ? 'low' : ''}">${used}/${beds}</b>${floor ? '<em class="lowtag">+' + floor + ' floor</em>' : ''}${cracked ? '<em class="lowtag">' + cracked + ' cracked</em>' : ''}</span></span>`;
}
function drawItems(k, r) {
  if (!S || typeof r.x0 !== 'number') return;
  const yb = FLOORS[r.floor];
  if (itemTool) {
    g.strokeStyle = 'rgba(255,214,150,.15)'; g.lineWidth = 1;
    for (let x = Math.ceil((r.x0 - ITX0) / ITILE) * ITILE + ITX0; x < r.x1; x += ITILE) { g.beginPath(); g.moveTo(x, yb - ITILE * 4); g.lineTo(x, yb); g.stroke(); }
    for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(r.x0, yb - i * ITILE); g.lineTo(r.x1, yb - i * ITILE); g.stroke(); }
  }
  const hcell = scene === 'bunker' ? itemCellAt(bcamToWorld({ x: mouse.x, y: mouse.y })) : null;
  const hoverIt = hcell && hcell.k === k ? itemHit(k, hcell.col) : null;
  const bedOwn = k === 'bunks' ? bedOwners() : null;
  const bedMw = (scene === 'bunker' && !itemTool) ? bcamToWorld({ x: mouse.x, y: mouse.y }) : null;
  let bedTag = null;
  for (const it of itemList()) {
    if (it.room !== k) continue;
    const T = ITEM_TYPES[it.type], x = ITX0 + it.col * ITILE;
    drawItemSprite(it.type, x, yb, T.w * ITILE, T);
    if (it.type === 'bunk' && bedOwn) {
      const bw = T.w * ITILE;
      if (it.damaged) {
        g.save();
        g.strokeStyle = '#e05a4a'; g.lineWidth = 2; g.beginPath();
        g.moveTo(x + bw / 2 - 8, yb - 38); g.lineTo(x + bw / 2 - 1, yb - 28); g.lineTo(x + bw / 2 - 6, yb - 20); g.lineTo(x + bw / 2 + 2, yb - 10); g.lineTo(x + bw / 2 - 2, yb - 2); g.stroke();
        g.fillStyle = '#ff9a8a'; g.font = '600 10px "Chakra Petch"'; g.textAlign = 'center';
        g.fillText(BED_REPAIR_COST + ' scrap', x + bw / 2, yb - 46);
        g.restore();
        if (bedMw && bedMw.x >= x && bedMw.x <= x + bw && bedMw.y >= yb - 42 && bedMw.y <= yb) bedTag = { x: x + bw / 2, y: yb - 54, text: 'Cracked bunk: repair ' + BED_REPAIR_COST + ' scrap at the workshop' };
      } else {
        const own = bedOwn.get(it.id) || [null, null];
        for (let s = 0; s < 2; s++) {
          const cy = s === 0 ? yb - 10 : yb - 32, o = own[s];
          const hov = !!(bedMw && bedMw.x >= x && bedMw.x <= x + bw && bedMw.y >= cy - 12 && bedMw.y <= cy + 8);
          g.beginPath(); g.arc(x + bw - 12, cy, hov ? 4.5 : 3.5, 0, Math.PI * 2);
          if (o) { g.fillStyle = '#ffd24a'; g.fill(); } else { g.strokeStyle = '#a89a80'; g.lineWidth = 1.5; g.stroke(); }
          if (hov || (o && sel === o.id)) bedTag = { x: x + bw / 2, y: cy - 16, text: o ? o.name : 'Empty bed' };
        }
      }
    }
    g.fillStyle = '#ffd24a';
    for (let i = 0; i < (it.lvl || 1); i++) g.fillRect(x + 4 + i * 7, yb - 40, 5, 5);
  }
  if (bedTag) {
    g.save(); g.font = '600 11px "Chakra Petch"'; g.textAlign = 'center';
    const tw = g.measureText(bedTag.text).width + 10;
    g.fillStyle = 'rgba(20,14,8,.92)'; g.fillRect(bedTag.x - tw / 2, bedTag.y - 11, tw, 15);
    g.strokeStyle = '#5a4428'; g.lineWidth = 1; g.strokeRect(bedTag.x - tw / 2 + 0.5, bedTag.y - 10.5, tw - 1, 14);
    g.fillStyle = '#ffe0a8'; g.fillText(bedTag.text, bedTag.x, bedTag.y);
    g.restore();
  }
  if (k === 'common') drawPantry(yb);
  if (itemTool && scene === 'bunker') {
    const c = itemCellAt(bcamToWorld({ x: mouse.x, y: mouse.y }));
    if (c && c.k === k) {
      const T = ITEM_TYPES[itemSel], hit = itemHit(k, c.col);
      if (hit) {
        const HT = ITEM_TYPES[hit.type], lv = hit.lvl || 1, up = { scrap: 15 * lv };
        let msg, good = false;
        if (lv >= ITEM_MAX_LVL) msg = HT.name + ': max level';
        else if (!canPay(up)) msg = HT.name + ': upgrade needs ' + fmtCost(up);
        else { msg = HT.name + ': upgrade ' + fmtCost(up); good = true; }
        drawItemGhostBox(ITX0 + hit.col * ITILE, yb, HT.w * ITILE, good, msg + '  (Shift+click removes)', true);
      } else {
        let ok = true, why = '';
        if (T.room !== k) { ok = false; why = 'belongs in the ' + ROOMS[T.room].name; }
        else if (!itemSpotOk(k, r, c.col, T.w)) { ok = false; why = 'no room here'; }
        else if (!canPay(T.cost)) { ok = false; why = 'needs ' + fmtCost(T.cost); }
        drawItemGhostBox(ITX0 + c.col * ITILE, yb, T.w * ITILE, ok, T.name + (ok ? ': ' + fmtCost(T.cost) : ': ' + why), false);
      }
    }
  }
}
let itemTool = false, itemSel = 'stove';
// ghost footprint + cost tooltip for the item build tool (world coordinates, called inside the bunker camera transform)
function drawItemGhostBox(x, yb, bw, ok, txt, upgrade) {
  const hc = !!prefs.hc, cbm = !!prefs.cb, bh = 28, y = yb - bh;
  g.save(); g.font = '600 12px sans-serif';
  if (upgrade) g.fillStyle = ok ? 'rgba(255,210,74,.35)' : 'rgba(150,150,150,.35)';
  else if (ok) g.fillStyle = cbm ? 'rgba(74,163,255,' + (hc ? '.55)' : '.4)') : 'rgba(90,220,110,' + (hc ? '.55)' : '.4)');
  else g.fillStyle = cbm ? 'rgba(255,160,46,' + (hc ? '.55)' : '.42)') : 'rgba(230,70,70,' + (hc ? '.55)' : '.4)');
  g.fillRect(x, y, bw, bh);
  if (!ok && !upgrade) {
    // hatch so blocked never depends on colour alone
    g.save(); g.beginPath(); g.rect(x, y, bw, bh); g.clip();
    g.strokeStyle = hc ? '#fff' : 'rgba(255,255,255,.45)'; g.lineWidth = 1.5; g.beginPath();
    for (let o = -bh; o < bw; o += 10) { g.moveTo(x + o, y + bh); g.lineTo(x + o + bh, y); }
    g.stroke(); g.restore();
  }
  g.strokeStyle = hc ? '#fff' : (upgrade ? '#ffd24a' : ok ? (cbm ? '#4aa3ff' : '#5adc6e') : (cbm ? '#ffa02e' : '#ff5a4e'));
  g.lineWidth = hc ? 3 : 2; if (!ok && !upgrade) g.setLineDash([6, 4]); g.strokeRect(x + 1, y + 1, bw - 2, bh - 2); g.setLineDash([]);
  const label = (hc && !upgrade ? (ok ? 'OK  ' : 'NO  ') : '') + txt, tw = g.measureText(label).width + 12;
  const tx = clamp(x, IN_L, IN_R - tw), ty = y - 24;
  g.fillStyle = hc ? '#000' : 'rgba(20,10,8,.9)'; g.fillRect(tx, ty, tw, 18);
  if (hc) { g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.strokeRect(tx + 0.75, ty + 0.75, tw - 1.5, 16.5); }
  g.fillStyle = hc ? '#fff' : (upgrade || ok ? '#ffe9b8' : '#ffd0cc');
  g.fillText(label, tx + 6, ty + 13);
  g.restore();
}
const itemUI = document.createElement('div');
itemUI.style.cssText = 'position:fixed;left:10px;bottom:100px;z-index:40;display:none;font:600 12px "Chakra Petch",sans-serif;color:#ffd9a0;background:rgba(20,14,8,.9);border:1px solid #5a4428;padding:6px;border-radius:6px;max-width:220px';
document.body.appendChild(itemUI);
function renderItemUI() {
  itemUI.innerHTML = `<button class="btn ghost" data-it="toggle">Build items: ${itemTool ? 'On' : 'Off'}</button>` + (itemTool ? Object.keys(ITEM_TYPES).map(t => `<div><button class="btn ${t === itemSel ? '' : 'ghost'}" data-it="${t}" style="margin-top:4px;width:100%">${ITEM_TYPES[t].name} · ${fmtCost(ITEM_TYPES[t].cost)}</button></div>`).join('') + '<p style="margin:6px 0 0;font-weight:400">Click a tile in the matching room to place. Click an item to upgrade it. Shift+click removes it (no refund).</p>' : '');
}
itemUI.addEventListener('click', e => {
  const b = e.target.closest('[data-it]'); if (!b) return;
  if (b.dataset.it === 'toggle') itemTool = !itemTool; else itemSel = b.dataset.it;
  if (itemTool) placing = null;
  renderItemUI();
});
setInterval(() => {
  const show = scene === 'bunker' && !!S && !S.over && (itemTool || hotbarLive());   // only while building
  if (!show && itemTool) { itemTool = false; renderItemUI(); }
  itemUI.style.display = show ? 'block' : 'none';
}, 500);
renderItemUI();
function doBuild(a) {
  const rep = s => { const c = { scrap: Math.ceil((s.max - s.hp) / 10) }; if (!canPay(c)) { uiSfx('Error'); return false; } pay(c); s.hp = s.max; return true; };
  if (a === 'repDoor') { if (S.enemies.some(e => e.inside) || !rep(S.door)) return; S.breached = false; if (window.SFX && SFX.repair) { SFX.repair('clank'); } lampEv('door_repair', 'Hatch repaired.', 'good'); }
  else if (a === 'repWall') { if (rep(S.wall)) lamp('Wall repaired.', 'good'); }
  else if (a === 'upWall') { const c = { scrap: 30, mat: 12 }; if (!canPay(c)) { uiSfx('Error'); return; } pay(c); S.wall.lvl = 2; S.wall.max = 600; S.wall.hp = 600; lamp('The wall is reinforced.', 'good'); }
  else if (/^turret\d/.test(a)) { const i = +a[6], k = a.slice(7), sp = TURRETS[k]; if (!canPay(sp.cost) || S.turrets[i]) return; pay(sp.cost); S.turrets[i] = { type: k, hp: sp.hp, max: sp.hp, lvl: 1, cd: 0 }; uiSfx('Place'); lamp(sp.name + ' built in slot ' + (i + 1) + (k === 'coil' ? '. It runs on generator power, no crew needed.' : '. Give someone the Turret job in Crew.'), 'good'); balanceTurrets(); }
  else if (/^repT/.test(a)) rep(S.turrets[+a[4]]);
  else if (/^upT/.test(a)) { const c = { parts: 8, elec: 2 }; if (!canPay(c)) { uiSfx('Error'); return; } pay(c); S.turrets[+a[3]].lvl = 2; lamp('Turret ' + (+a[3] + 1) + ' upgraded.', 'good'); }
  else if (a === 'upHydro' || a === 'upMed' || a === 'upBunks') { const k = a.slice(2).toLowerCase(); const c = { hydro: { elec: 3, mat: 8 }, med: { elec: 3, mat: 6 }, bunks: { scrap: 10, mat: 10 } }[k]; if (!canPay(c)) { uiSfx('Error'); return; } pay(c); S.rooms[k] = 2; lamp(ROOMS[k].name + ' upgraded.', 'good'); }
  else if (/^room_/.test(a)) { const k = a.slice(5), r = BUILD_ROOMS[k]; if (!r || S.rooms[k]) return; if (!canPay(r.cost)) { uiSfx('Error'); lamp('The ' + ROOMS[k].name + ' needs ' + fmtCost(r.cost) + '.', 'warn'); return; } startPlace({ kind: 'room', k }); }
  else if (/^rep_bed_/.test(a)) {
    const it = itemList()[+a.slice(8)];
    if (!S.rooms.workshop || !it || it.type !== 'bunk' || !it.damaged) return;
    const c = { scrap: BED_REPAIR_COST };
    if (!canPay(c)) { uiSfx('Error'); lamp('Repairing a bunk needs ' + fmtCost(c) + '.', 'warn'); return; }
    pay(c); it.damaged = false;
    lamp('Bunk repaired. Its two beds count toward capacity again.', 'good');
  }
  else if (/^rescar_/.test(a)) {
    const i = +a.slice(7), sc = breachState().scars[i];
    if (!sc || S.enemies.some(e => e.inside)) return;
    const c = scarCost(sc); if (!canPay(c)) { uiSfx('Error'); lamp('Rebuilding the ' + scarName(sc.room) + ' needs ' + fmtCost(c) + '.', 'warn'); return; }
    pay(c); breachState().scars.splice(i, 1);
    if (sc.room === 'door') { S.door.max = Math.max(50, Math.round(S.door.max * WORSE_MUL)); S.door.hp = S.door.max; }
    else { if (!S.worse) S.worse = {}; S.worse[sc.room] = (S.worse[sc.room] || 0) + 1; }
    lamp(scarName(sc.room) + ' rebuilt. It works, but not like it used to.', 'good');
  }
  else if (a === 'toggleLadder') { if (placing && placing.kind === 'ladder') cancelPlace(); else startPlace({ kind: 'ladder' }); }
  else if (/^buy_/.test(a)) buyItem(a.slice(4));
  else if (/^bld_/.test(a)) buyBuild(a.slice(4));
  else if (/^rs_/.test(a)) rsAction(a.slice(3));
  else if (/^x_/.test(a)) expAction(a.slice(2));
  else if (/^prio_/.test(a)) cyclePrio(+a.slice(5));
  else if (a === 'toggleParts') S.makeParts = !S.makeParts;
  else if (a === 'toggleDig') toggleDig();
  else if (a === 'tower') { const t = TOWER[S.tower.done]; if (!t || S.tower.paid || !canPay(t.cost)) return; pay(t.cost); S.tower.paid = true; S.tower.work = 0; lampEv('exit_build_start', 'Signal tower: work on the ' + t.name.toLowerCase() + ' can begin. Put people with Tech on the Signal tower job.', 'good'); }
}
function toggleAlarm() {
  S.alarm = !S.alarm;
  if (S.alarm) {
    // fill empty turrets first, then everyone else guards the door
    const free = [0, 1].filter(i => S.turrets[i] && S.turrets[i].type !== 'coil');
    const crew = living().filter(c => !c.patient).sort((a, b) => b.stats.acc - a.stats.acc);
    for (const c of crew) c.alarmSlot = null;
    for (const i of free) {
      const job = i ? 'turretB' : 'turretA';
      const c = crew.find(c => c.job === job && c.alarmSlot == null) || crew.find(c => c.alarmSlot == null && c.job !== 'turretA' && c.job !== 'turretB');
      if (c) c.alarmSlot = i;
    }
    lamp('Battle stations! Everyone up: turrets first, the rest on the door.', 'warn');
  } else { for (const c of S.crew) c.alarmSlot = null; lamp('Stand down. Back to your shifts.'); }
  $('#tAlarm').classList.toggle('on', S.alarm);
}

// prompt text and E to interact
function interactable() {
  if (scene === 'bunker' && P.floor === 0 && Math.abs(P.x - DOOR_X) < 70 && !S.player.down) {
    const car = carriedOf(), has = Object.values(car).some(v => v > 0);
    if (has) return { text: 'E · Drop off loot: ' + Object.entries(car).filter(([, v]) => v > 0).map(([k, v]) => v + ' ' + k).join(', ') + ' (pack cap ' + packCap() + ')', act: () => dropOff() };
    const pc = packCost();
    if (pc) { const ok = S.res.scrap >= pc.scrap && S.res.parts >= pc.parts; return { text: 'E · Upgrade backpack (Lv ' + (S.player.packLvl || 0) + '/4, holds ' + packCap() + ') to ' + (packCap() + 12) + ': ' + pc.scrap + ' scrap, ' + pc.parts + ' parts' + (ok ? '' : ' (not enough)'), act: () => upgradePack() }; }
  }
  if (scene === 'bunker' && P.floor === 0 && P.x > W - 60 && !S.player.down) return { text: 'E · Go scavenging in the wasteland (time keeps running)', act: () => startScav('wasteland') };
  if (scene === 'bunker' && P.floor === 0 && P.x > W - 180 && P.x <= W - 60 && !S.player.down) return { text: 'E · Go to the dead town (food, materials, Pike\'s ram rig patrols)', act: () => startScav('town') };
  if (scene === 'scav' && scav) {
    if (scav.flip ? P.x > scav.home - 70 : P.x < 70) return { text: 'E · Return to the bunker', act: () => endScav(true) };
    const c = scav.crates.find(c => !c.open && Math.abs(c.x - P.x) < 30 && Math.abs(c.y - P.y) < 30);
    if (c) return { text: 'E · Search the ' + (c.kind === 'car' ? 'wreck' : c.kind), act: () => openCrate(c) };
    const w = scav.wanderer;
    if (w && !w.gone && Math.abs(w.x - P.x) < 40) {
      if (scav.enemies.some(e => Math.abs(e.x - w.x) < 300)) return { text: 'Clear the hostiles first: the wanderer won’t talk while they’re near' };
      return { text: `E · Invite ${w.s.name} (${w.s.role.toLowerCase()}) to the bunker`, act: () => { scav.recruit = w.s; w.gone = true; lamp(w.s.name + ' will follow you home. They are bringing nothing but themselves, and maybe trouble.', 'good'); } };
    }
  }
  return null;
}
const mouse = { x: 0, y: 0, wx: 0, wy: 0, down: false };
// ---- hover / keyboard focus / long-press info tooltip (bunker view) ----
var hoverRoom = null, hoverItem = null, hoverCell = null, focusT = null, lpTimer = null, lpStart = null, tipSR = null;
const ROOM_UP_COST = { hydro: { elec: 3, mat: 8 }, med: { elec: 3, mat: 6 }, bunks: { scrap: 10, mat: 10 } };
function tipItemAt(x, y) { const c = itemCellAt({ x, y }); return c ? itemHit(c.k, c.col) || null : null; }
cv.tabIndex = 0;
(function () {
  const st = document.createElement('style');
  st.textContent = '#cv:focus-visible,canvas:focus-visible{outline:2px solid #ffc857;outline-offset:-2px}.tip-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}';
  document.head.appendChild(st);
  tipSR = document.createElement('div'); tipSR.className = 'tip-sr'; tipSR.setAttribute('aria-live', 'polite');
  document.body.appendChild(tipSR);
})();
function roomBox(k) { const r = ROOMS[k]; return { x: r.x0, y: FLOORS[r.floor - 1] + (r.floor === 1 ? 16 : 10), w: r.x1 - r.x0, h: FLOORS[r.floor] - (FLOORS[r.floor - 1] + (r.floor === 1 ? 16 : 10)) }; }
function roomAt(x, y) {
  for (const k in ROOMS) { if (ROOMS[k].build) continue; const b = roomBox(k); if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) return k; }
  return null;
}
function tipTargets() {
  const crew = S.crew.filter(c => c.alive && !c.left && !c.exp).sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true })).map(c => ({ type: 'crew', id: c.id }));
  const rooms = Object.keys(ROOMS).filter(k => !ROOMS[k].build).map(k => ({ type: 'room', k }));
  const items = itemList().map(it => ({ type: 'item', id: it.id }));
  return crew.concat(rooms, items);
}
function tipInfo(t) {
  if (!t || !S) return null;
  if (t.type === 'crew') {
    const c = S.crew.find(x => x.id === t.id);
    if (!c || !c.alive || c.left || c.exp) return null;
    const n = crewNeeds(c);
    return { box: { x: c.x - 12, y: c.y - 42, w: 24, h: 44 }, ax: c.x, ay: c.y - 46, lines: [String(c.name), (JOBS[c.job] ? JOBS[c.job].label : '-') + ' · ' + c.state + (c.sick ? ' · sick' : ''), 'HP ' + Math.round(n.hp) + '  Food ' + Math.round(n.food) + '  Rest ' + Math.round(n.rest)] };
  }
  if (t.type === 'item') {
    const it = itemList().find(x => x.id === t.id), T = it && ITEM_TYPES[it.type], rm = it && ROOMS[it.room];
    if (!it || !T || !rm) return null;
    const lvl = it.lvl || 1, x = ITX0 + it.col * ITILE, w = T.w * ITILE, yb = FLOORS[rm.floor];
    return { box: { x, y: yb - ITILE * 2, w, h: ITILE * 2 }, ax: x + w / 2, ay: yb - ITILE * 2, lines: [T.name, 'Level ' + lvl + '/' + ITEM_MAX_LVL + ' · ' + rm.name, lvl >= ITEM_MAX_LVL ? 'Fully upgraded' : 'Upgrade: ' + fmtCost({ scrap: 15 * lvl })] };
  }
  if (t.type === 'cell') {
    const d = dg(); if (!dIn(t.c, t.r)) return null;
    const i = dIdx(t.c, t.r), m = d.m[i], x = DIG.x0 + t.c * DIG.cell, y = DIG.y0 + t.r * DIG.cell;
    let lines;
    if (!m) {
      const pk = Object.keys(d.rooms || {}).find(k => { const q = d.rooms[k]; return t.c >= q.c && t.c < q.c + q.w && t.r >= q.r && t.r < q.r + q.h; });
      lines = ['Cleared tile', pk ? ROOMS[pk].name + ' (built)' : 'Open space'];
    } else {
      const M = DIG.mats[m];
      lines = [M.name, 'Hardness ' + Math.ceil(d.hp[i]) + '/' + M.hard, (d.mark[i] ? 'Marked for digging' : 'Not marked') + ' · ~' + (d.hp[i] / DIG.rate).toFixed(1) + ' miner-hrs'];
    }
    return { box: { x, y, w: DIG.cell, h: DIG.cell }, ax: x + DIG.cell / 2, ay: y, lines };
  }
  const r = ROOMS[t.k]; if (!r) return null;
  const b = roomBox(t.k), lv = S.rooms && S.rooms[t.k];
  const crewIn = r.job ? living().filter(c => c.job === r.job) : [];
  const meIn = !!(r.job && P && P.job === r.job && !crewIn.includes(P));
  const staff = crewIn.length + (meIn ? 1 : 0);
  const lines = [r.name + (typeof lv === 'number' ? ' (level ' + lv + ')' : '')];
  if (r.job) lines.push((JOBS[r.job] ? JOBS[r.job].label : r.job) + ' · staff ' + staff);
  if (r.job && staff) {
    const nm = crewIn.map(c => String(c.name));
    if (meIn) nm.unshift('Mara (you)');
    lines.push(nm.slice(0, 4).join(', ') + (nm.length > 4 ? ' +' + (nm.length - 4) + ' more' : ''));
  }
  if (r.job === 'sleep' || r.job === 'idle') lines.push('Status: ' + staff + (staff === 1 ? ' occupant' : ' occupants'));
  else if (r.build && !lv) lines.push('Status: Offline');
  else if (r.job) lines.push('Status: ' + (!staff ? 'Unstaffed' : (POWERED_JOBS.includes(r.job) && !S.powered) ? 'Unpowered' : 'Operating'));
  const sc = breachState().scars.find(s => s.room === t.k);
  if (sc) lines.push('Scarred: rebuild ' + fmtCost(scarCost(sc)));
  if (ROOM_UP_COST[t.k] && typeof lv === 'number') lines.push(lv >= 2 ? 'Fully upgraded' : 'Upgrade: ' + fmtCost(ROOM_UP_COST[t.k]));
  return { box: b, ax: b.x + b.w / 2, ay: b.y + 4, lines };
}
function curTipTarget() {
  if (scene !== 'bunker' || !S) return null;
  if (focusT && focusT.until && performance.now() > focusT.until) focusT = null;
  if (mouse.inCv && hover) return { type: 'crew', id: hover.id };
  if (mouse.inCv && hoverItem) return { type: 'item', id: hoverItem.id };
  if (mouse.inCv && hoverRoom) return { type: 'room', k: hoverRoom };
  if (mouse.inCv && hoverCell) return { type: 'cell', c: hoverCell.c, r: hoverCell.r };
  return focusT;
}
function setFocusT(t, ms) {
  focusT = t ? Object.assign({}, t, ms ? { until: performance.now() + ms } : {}) : null;
  const i = focusT && tipInfo(focusT);
  if (tipSR) tipSR.textContent = i ? i.lines.join('. ') : '';
}
function drawTipHighlight() {
  const i = tipInfo(curTipTarget()); if (!i) return;
  g.save(); g.strokeStyle = prefs.hc ? '#ffffff' : '#ffc857'; g.lineWidth = prefs.hc ? 4 : 2; if (prefs.cb) g.setLineDash([8, 5]);
  g.strokeRect(i.box.x, i.box.y, i.box.w, i.box.h); g.restore();
}
function drawInfoTip() {
  const i = tipInfo(curTipTarget()); if (!i) return;
  const v = bcamView();
  const hcT = !!prefs.hc, fs = hcT ? 14 : 12;
  g.save(); g.font = (hcT ? 'bold ' : '') + fs + 'px sans-serif'; g.textBaseline = 'top';
  const pad = hcT ? 8 : 6, lh = hcT ? 18 : 15, w = Math.max(...i.lines.map(s => g.measureText(s).width)) + pad * 2, h = i.lines.length * lh + pad * 2;
  let x = (i.ax - v.ox) * v.z - w / 2, y = (i.ay - v.oy) * v.z - h - 6;
  if (y < 4) y = (i.ay - v.oy) * v.z + 24;
  x = clamp(x, 4, W - w - 4); y = clamp(y, 4, H - h - 4);
  g.fillStyle = hcT ? '#000' : 'rgba(14,10,7,.92)'; g.fillRect(x, y, w, h);
  g.strokeStyle = hcT ? '#fff' : '#ffc857'; g.lineWidth = hcT ? 3 : 1; if (prefs.cb) g.setLineDash([5, 3]); g.strokeRect(x + .5, y + .5, w - 1, h - 1); g.setLineDash([]);
  g.fillStyle = hcT ? '#fff' : '#f2e6d0';
  i.lines.forEach((s, n) => { g.font = ((n === 0 || hcT) ? 'bold ' : '') + fs + 'px sans-serif'; g.fillText(s, x + pad, y + pad + n * lh); });
  g.restore();
}
function lpCancel() { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } lpStart = null; }
cv.addEventListener('focus', () => {
  if (scene !== 'bunker' || !S || !cv.matches(':focus-visible')) return;
  const t = tipTargets(); if (t.length && !focusT) setFocusT(t[0]);
});
cv.addEventListener('blur', () => { if (focusT && !focusT.until) setFocusT(null); });
cv.addEventListener('keydown', e => {
  if (scene !== 'bunker' || !S) return;
  if (e.key === 'Tab') {
    const list = tipTargets(); if (!list.length) return;
    const same = (a, b) => a && b && a.type === b.type && (a.id === b.id) && (a.k === b.k) && (a.c === b.c) && (a.r === b.r);
    let i = list.findIndex(t => same(t, focusT));
    i = i < 0 ? (e.shiftKey ? list.length - 1 : 0) : i + (e.shiftKey ? -1 : 1);
    if (i < 0 || i >= list.length) { setFocusT(null); return; }
    e.preventDefault(); e.stopPropagation(); setFocusT(list[i]);
  } else if (e.key === 'Enter' && focusT && focusT.type === 'crew') {
    e.preventDefault(); e.stopPropagation();
    sel = focusT.id; openDrawer('crew');
  } else if (e.shiftKey && /^Arrow(Left|Right|Up|Down)$/.test(e.key)) {
    e.preventDefault(); e.stopPropagation();
    const cur = focusT && focusT.type === 'cell' ? focusT : { c: Math.floor(DIG.cols / 2), r: 0 };
    const dx = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0, dy = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    const moved = focusT && focusT.type === 'cell';
    setFocusT({ type: 'cell', c: clamp(cur.c + (moved ? dx : 0), 0, DIG.cols - 1), r: clamp(cur.r + (moved ? dy : 0), 0, DIG.rows - 1) });
    if (!bcam.pan) { bcam.follow = null; bcam.tz = Math.max(bcam.tz, 1); bcam.cy = DIG.y0 + cur.r * DIG.cell; }
  } else if (e.key === 'Escape' && focusT) {
    e.stopPropagation(); setFocusT(null);
  }
});
function toCanvas(e) { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H }; }
cv.addEventListener('pointermove', e => {
  if (e.pointerType === 'touch' && aimId !== null && e.pointerId !== aimId) return;
  const p = toCanvas(e); mouse.x = p.x; mouse.y = p.y; mouse.inCv = true;
  if (bcam.pan) { bcam.cx -= (p.x - bcam.pan.x) / bcam.z; bcam.cy -= (p.y - bcam.pan.y) / bcam.z; bcam.pan = { x: p.x, y: p.y }; bcam.follow = null; const v = bcamView(); bcam.cx = v.ox + W / v.z / 2; bcam.cy = v.oy + H / v.z / 2; }
  const bp = scene === 'bunker' ? bcamToWorld(p) : p;
  mouse.wx = bp.x + (scene === 'scav' && scav ? scav.cam : 0); mouse.wy = bp.y; hover = scene === 'bunker' && S ? personAt(bp.x, bp.y) : null;
  hoverRoom = scene === 'bunker' && S ? roomAt(bp.x, bp.y) : null;
  hoverItem = scene === 'bunker' && S ? tipItemAt(bp.x, bp.y) : null;
  hoverCell = scene === 'bunker' && S && !hoverRoom && !hoverItem ? dCellAt(bp) : null;
  if (lpStart && Math.hypot(p.x - lpStart.x, p.y - lpStart.y) > 10) lpCancel();
});
cv.addEventListener('pointerdown', e => {
  if (scene !== 'bunker' && scene !== 'scav') return;
  const p = toCanvas(e);
  if (e.pointerType === 'touch' && scene === 'bunker' && S) {
    lpCancel(); lpStart = { x: p.x, y: p.y };
    lpTimer = setTimeout(() => {
      lpTimer = null; if (!lpStart) return;
      const w = bcamToWorld(lpStart), c = personAt(w.x, w.y), ih = c ? null : tipItemAt(w.x, w.y), rk = c || ih ? null : roomAt(w.x, w.y), dc = c || ih || rk ? null : dCellAt(w);
      if (c) setFocusT({ type: 'crew', id: c.id }, 4000); else if (ih) setFocusT({ type: 'item', id: ih.id }, 4000); else if (rk) setFocusT({ type: 'room', k: rk }, 4000); else if (dc) setFocusT({ type: 'cell', c: dc.c, r: dc.r }, 4000);
    }, 450);
  }
  if (e.button === 1 && scene === 'bunker') { e.preventDefault(); bcam.pan = { x: p.x, y: p.y }; return; }
  if (e.button === 2 && scene === 'bunker') { rcDown = { x: e.clientX, y: e.clientY }; bcam.pan = { x: p.x, y: p.y }; return; }
  if (e.button === 0 && placing && scene === 'bunker' && S) { placeClick(bcamToWorld(p)); return; }
  if (e.button === 0 && itemTool && scene === 'bunker' && S) { placeItem(bcamToWorld(p), e.shiftKey); return; }
  if (e.button === 0 && digTool && scene === 'bunker' && S) { digStart(bcamToWorld(p), e.shiftKey); return; }
  const bp = scene === 'bunker' ? bcamToWorld(p) : p;
  const c = scene === 'bunker' ? personAt(bp.x, bp.y) : null;
  if (c) { sel = c.id; openDrawer('crew'); setTimeout(() => document.querySelector(`[data-crew="${c.id}"]`)?.scrollIntoView({ block: 'nearest' }), 0); return; }
  if (e.pointerType === 'touch') {
    markTouch();
    // touch aim: in scav, tap/drag on the canvas sets shoot direction; otherwise touch shoots via the FIRE button
    if (!(prefs.ta && scene === 'scav' && scav)) return;
    aimId = e.pointerId; mouse.wx = p.x + scav.cam; mouse.wy = p.y; mouse.inCv = true;
  }
  mouse.down = true;
});
// (a second, canvas-drawn bunker minimap was here; it redeclared MM and drawMinimap and stopped the game from starting. The #minimap below is the one minimap.)
let aimId = null;
cv.addEventListener('pointerleave', e => { if (e.pointerType !== 'touch') mouse.inCv = false; });
function aimRelease(e) {
  if (e.pointerType === 'touch' && aimId !== null) { if (e.pointerId === aimId) { aimId = null; mouse.down = false; } return; }
  mouse.down = false;
}
window.addEventListener('pointerup', aimRelease);
window.addEventListener('pointerup', lpCancel);
window.addEventListener('pointercancel', lpCancel);
window.addEventListener('pointercancel', aimRelease);
// ---- bunker camera: zoom, pan, follow (roster click centers on a survivor) ----
const bcam = { z: 1, tz: 1, cx: W / 2, cy: H / 2, follow: null, pan: null, anchor: null, overview: false };
function bcamView() { const z = bcam.z, vw = W / z, vh = H / z; return { z, ox: clamp(bcam.cx - vw / 2, 0, Math.max(0, W - vw)), oy: clamp(bcam.cy - vh / 2, 0, Math.max(0, WH - vh)) }; }
function bcamToWorld(p) { const v = bcamView(); return { x: p.x / v.z + v.ox, y: p.y / v.z + v.oy }; }
function bcamBegin() { const v = bcamView(); g.save(); g.scale(v.z, v.z); g.translate(-v.ox, -v.oy); }
function bcamEnd() { g.restore(); }
// ---- bunker minimap: rooms, hatch, crew dots, click/drag to pan ----
const MM = { el: null, cv: null, g: null, w: 176, h: 0, last: 0, on: true, drag: false };
function mmInit() {
  if (MM.el) return;
  const wrap = document.getElementById('wrap'); if (!wrap) return;
  try { MM.on = localStorage.getItem('ashfall-minimap') !== '0'; } catch (e) {}
  MM.h = Math.round(MM.w * WH / W);
  const el = document.createElement('div'); el.id = 'minimap'; el.hidden = true;
  const bar = document.createElement('button'); bar.type = 'button'; bar.id = 'minimapBtn'; bar.setAttribute('aria-pressed', 'true'); bar.setAttribute('aria-label', 'Toggle bunker minimap'); bar.textContent = 'Map';
  const cvs = document.createElement('canvas'); cvs.width = MM.w; cvs.height = MM.h; cvs.setAttribute('aria-label', 'Bunker minimap. Click to move the camera.');
  el.appendChild(bar); el.appendChild(cvs); wrap.appendChild(el);
  MM.el = el; MM.cv = cvs; MM.g = cvs.getContext('2d');
  const sync = () => { el.classList.toggle('off', !MM.on); bar.setAttribute('aria-pressed', MM.on ? 'true' : 'false'); };
  sync();
  bar.addEventListener('click', e => { e.stopPropagation(); MM.on = !MM.on; try { localStorage.setItem('ashfall-minimap', MM.on ? '1' : '0'); } catch (err) {} sync(); });
  const pan = e => {
    const r = cvs.getBoundingClientRect(); if (!r.width) return;
    const wx = (e.clientX - r.left) / r.width * W, wy = (e.clientY - r.top) / r.height * WH;
    bcam.follow = null; bcam.anchor = null; bcam.tz = Math.max(bcam.tz, 1.8);
    bcam.cx = wx; bcam.cy = wy;
  };
  cvs.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); MM.drag = true; try { cvs.setPointerCapture(e.pointerId); } catch (err) {} pan(e); });
  cvs.addEventListener('pointermove', e => { if (MM.drag) pan(e); });
  cvs.addEventListener('pointerup', () => { MM.drag = false; });
  cvs.addEventListener('pointercancel', () => { MM.drag = false; });
  setInterval(() => { if (MM.el && performance.now() - MM.last > 400) MM.el.hidden = true; }, 300);
}
function drawMinimap() {
  // Only during play: not behind the title/menus, a pause screen or an open side panel.
  if (!S || scene !== 'bunker' || !$('#overlay').hidden || !$('#drawer').hidden) { if (MM.el) MM.el.hidden = true; return; }
  mmInit(); if (!MM.el) return;
  MM.last = performance.now(); MM.el.hidden = false;
  if (!MM.on) return;
  const m = MM.g, s = MM.w / W;
  m.clearRect(0, 0, MM.w, MM.h);
  m.fillStyle = 'rgba(14,10,7,.88)'; m.fillRect(0, 0, MM.w, MM.h);
  m.fillStyle = 'rgba(75,58,42,.9)'; m.fillRect(0, FLOORS[0] * s, MM.w, 3);
  for (const k in ROOMS) {
    const r = ROOMS[k]; if (r.build) continue;
    const y0 = (FLOORS[r.floor - 1] + 10) * s, y1 = FLOORS[r.floor] * s;
    m.fillStyle = 'rgba(90,72,52,.75)'; m.fillRect(r.x0 * s, y0, (r.x1 - r.x0) * s - 1, y1 - y0);
    m.strokeStyle = 'rgba(160,130,90,.6)'; m.lineWidth = 1; m.strokeRect(r.x0 * s + .5, y0 + .5, (r.x1 - r.x0) * s - 2, y1 - y0 - 1);
  }
  m.fillStyle = '#0e0a07'; m.fillRect((LADDER_X - 18) * s, FLOORS[0] * s, 36 * s, (FLOORS[3] - FLOORS[0]) * s);
  const hx = DOOR_X * s, hy = FLOORS[0] * s, br = !!S.breached;
  m.fillStyle = br ? '#ff3a2a' : '#e0b040'; m.fillRect(hx - 5, hy - 5, 10, 6);
  if (br) { m.strokeStyle = '#fff'; m.lineWidth = 1.5; m.strokeRect(hx - 6.5, hy - 6.5, 13, 9); }
  m.fillStyle = '#9fd4ff';
  for (const c of S.crew) if (c.alive && !c.exp && !c.left) m.fillRect(c.x * s - 1, c.y * s - 3, 2.5, 3);
  if (S.player && !S.player.down && typeof P !== 'undefined') { m.fillStyle = '#fff'; m.fillRect(P.x * s - 2, P.y * s - 5, 4, 5); }
  const v = bcamView();
  m.strokeStyle = '#fff'; m.lineWidth = 1; m.strokeRect(v.ox * s + .5, v.oy * s + .5, W / v.z * s, H / v.z * s);
}
function bcamFocus(id) { bcam.follow = id; bcam.tz = Math.max(bcam.tz, 1.8); }
function bcamReset() { bcam.follow = null; bcam.anchor = null; bcam.tz = 1; bcam.cx = W / 2; bcam.cy = H / 2; }
// ---- overview mode + Mara autopilot ----
const MARA_STATS = { cook: 0.7, tech: 0.7, build: 0.7, acc: 0.7 };
const MARA_JOBS = ['workshop', 'research', 'signal', 'kitchen', 'hydro', 'idle'];
function toggleOverview() {
  if (scene !== 'bunker' || !S || S.over || S.player.down) return;
  bcam.overview = !bcam.overview;
  if (bcam.overview) {
    for (const k in keys) keys[k] = false;
    mouse.down = false;
    bcam.follow = null; bcam.tz = Math.max(bcam.tz, 1.8);
    P.auto = true; P.autoWork = null; P.climbing = !!P.onLadder; P.vy = 0;
    if (!P.onLadder) { P.y = FLOORS[P.floor]; P.grounded = true; }
  } else endOverview();
}
function endOverview() {
  bcam.overview = false; P.auto = false; P.autoWork = null;
  if (P.pit) { P.pit = false; P.pp = null; P.floor = 3; P.climbing = false; P.x = clamp(P.x, IN_L + 8, IN_R - 8); }   // Mara pops back up to floor 3
  P.onLadder = !!P.climbing;
  if (!P.onLadder) { P.climbing = false; P.y = FLOORS[P.floor]; P.vy = 0; P.grounded = true; }
  bcamReset();
}
function maraAuto(dt) {
  let floor, x, work = null, pitSpot = null;
  if (S.alarm) { floor = 0; x = 290; }
  else { work = (S.player.job && MARA_JOBS.includes(S.player.job)) ? S.player.job : 'idle'; if (work === 'workshop' && !S.rooms.workshop) work = 'idle'; if (work === 'research' && !(S.builds && S.builds.lab)) work = 'idle'; const sp = jobSpot(P, work); floor = sp.floor; x = sp.x; if (sp.pit) pitSpot = sp; }
  let arrived;
  if (pitSpot) arrived = pitGoto(P, pitSpot, dt, 175);
  else if (P.pit) { arrived = false; if (pitLeave(P, dt, true)) arrived = moveTo(P, floor, x, dt, 175); }
  else arrived = moveTo(P, floor, x, dt, 175);
  P.onLadder = !!P.climbing;
  P.anim += arrived ? 0 : dt * 10;
  P.autoWork = arrived && !S.alarm ? work : null;
  if (arrived && S.alarm && P.cd <= 0) {
    const t = S.enemies.find(en => !en.inside && !en.hidden && en.hp > 0 && en.x > P.x && en.x - P.x < 320);
    if (t) { P.facing = 1; P.cd = 0.34; muzzle(P.x + 14, P.y - 20, 1, scene === 'scav'); fx.bullets.push({ x: P.x + 12, y: P.y - 20, vx: 900, life: 0.55, dmg: Math.round((13 + S.player.lvl * 2) * armoryMult()), world: scene }); }
  }
  P.inMed = P.floor === 2 && P.x > ROOMS.med.x0 && !P.climbing;
}
function maraWorkTick(mins) {
  if (!P.auto || !P.autoWork || S.player.down) return;
  const h = mins / 60, job = P.autoWork;
  const m = { stats: MARA_STATS, food: 100, awake: 0, grief: 0, bonds: [], state: 'work', job, xp: 0, lvl: 1, cd: 0 };
  const e = eff(m) * (S.powered && POWERED_JOBS.includes(job) ? ROOM_FX.powerBoost : 1) * roomMul(job);
  switch (job) {
    case 'hydro': S.res.food += 1.3 * m.stats.cook * e * h * (S.rooms.hydro > 1 ? 1.5 : 1) * (hasB('rain') ? 1.25 : 1) * wearF('planter') * hydroMul(); break;
    case 'kitchen': {
      const k = kit();
      if (k.cooked < k.cap) {
        k.prog += 4 * m.stats.cook * e * h * wearF('stove') * (tech('cook1') ? 1.15 : 1); wearBy('stove', 0.5 * h);
        while (k.prog >= 1 && S.res.food >= 1 && k.cooked < k.cap) { k.prog -= 1; S.res.food -= 1; k.cooked += 1; }
        if (k.prog > 1) k.prog = 1;
      }
      break;
    }
    case 'workshop': workshopTick(m, e, h); break;
    case 'research': researchWork(3 * m.stats.tech * e * h); break;
    case 'signal': if (S.tower.paid) S.tower.work += 2 * m.stats.tech * e * h * (hasB('lab') ? 1.15 : 1); break;
  }
}
function maraCard() {
  const job = (S.player.job && MARA_JOBS.includes(S.player.job)) ? S.player.job : 'idle';
  return `<div class="card"><div class="ch"><b>Mara (you)</b><span class="tag">${bcam.overview ? 'autopilot' : 'manual'}</span></div><div class="row">${MARA_JOBS.map(k => `<button class="chip ${job === k ? 'on' : ''}" data-job="${k}" data-id="player">${JOBS[k].label}</button>`).join('')}</div><div class="note">Press O for overview mode: Mara does this job on her own while you scroll the bunker with the mouse at the screen edges. During an alarm she holds the door.</div></div>`;
}
function bcamTick(dt) {
  const c = bcam.follow && S ? S.crew.find(x => x.id === bcam.follow) : null;
  if (bcam.follow && (!c || !c.alive)) bcam.follow = null;
  if (bcam.overview && (scene !== 'bunker' || !S || S.over)) { bcam.overview = false; P.auto = false; P.autoWork = null; }
  const k = prefs.rm ? 1 : Math.min(1, dt * 6);
  bcam.z += (bcam.tz - bcam.z) * k; if (Math.abs(bcam.tz - bcam.z) < 0.001) bcam.z = bcam.tz;
  if (c) { bcam.cx += (c.x - bcam.cx) * k; bcam.cy += (c.y - 20 - bcam.cy) * k; bcam.anchor = null; }
  else if (bcam.anchor && !bcam.pan) {
    const a = bcam.anchor;
    bcam.cx = a.wx - a.sx / bcam.z + W / bcam.z / 2; bcam.cy = a.wy - a.sy / bcam.z + H / bcam.z / 2;
    const v = bcamView(); bcam.cx = v.ox + W / v.z / 2; bcam.cy = v.oy + H / v.z / 2;
    if (bcam.z === bcam.tz) bcam.anchor = null;
  }
  if ((bcam.overview || bcam.z > 1.01 || bcam.tz > 1.01) && scene === 'bunker' && mouse.inCv && !bcam.pan && !mouse.down) {
    const m = 40, sp = 700 / bcam.z; let dx = 0, dy = 0;
    if (mouse.x < m) dx = -1; else if (mouse.x > W - m) dx = 1;
    if (mouse.y < m) dy = -1; else if (mouse.y > H - m) dy = 1;
    if (dx || dy) { bcam.follow = null; bcam.anchor = null; bcam.cx += dx * sp * dt; bcam.cy += dy * sp * dt; const v = bcamView(); bcam.cx = v.ox + W / v.z / 2; bcam.cy = v.oy + H / v.z / 2; }
  }
}
cv.addEventListener('wheel', e => { if (scene !== 'bunker') return; e.preventDefault(); const p = toCanvas(e), w = bcamToWorld(p); bcam.tz = clamp(bcam.tz * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 1, 3); if (bcam.tz < 1.02) bcam.tz = 1; if (!bcam.follow) bcam.anchor = { wx: w.x, wy: w.y, sx: p.x, sy: p.y }; }, { passive: false });
cv.addEventListener('pointerleave', () => { mouse.inCv = false; });
cv.addEventListener('contextmenu', e => { if (scene === 'bunker') e.preventDefault(); });
let rcDown = null;
// cancel whichever build tool is active; returns true if something was cancelled
function cancelBuildTools() {
  let did = false;
  if (placing) { cancelPlace(); did = true; }
  if (digTool) { toggleDig(); did = true; }
  if (itemTool) { itemTool = false; renderItemUI(); did = true; }
  return did;
}
window.addEventListener('pointerup', e => {
  bcam.pan = null;
  if (e.button === 2 && rcDown) {
    const moved = Math.hypot(e.clientX - rcDown.x, e.clientY - rcDown.y);
    rcDown = null;
    if (moved < 6 && scene === 'bunker' && S) cancelBuildTools();
  }
});
// build-mode legend strip: tools, hotkeys, costs, right-click cancel hint
const legendUI = document.createElement('div');
legendUI.setAttribute('aria-hidden', 'true');
legendUI.id = 'buildLegend';
legendUI.className = 'buildlegend';
document.body.appendChild(legendUI);
let legendHtml = '';
function legendChip(label, on) {
  return '<span class="lchip' + (on ? ' on' : '') + '">' + label + '</span>';
}
function renderLegend() {
  const active = scene === 'bunker' && !!S && !S.over && (placing || digTool || itemTool);
  if (!active) { if (legendHtml) { legendHtml = ''; legendUI.innerHTML = ''; } legendUI.style.display = 'none'; return; }
  const parts = [];
  parts.push(legendChip('<b>X</b> Dig', !!digTool));
  parts.push(legendChip('<b>L</b> Ladder · pit ' + fmtCost(LADDER_COST.pit) + ' / bunker ' + fmtCost(LADDER_COST.bunker), !!(placing && placing.kind === 'ladder')));
  for (const k in BUILD_ROOMS) parts.push(legendChip(k + ' · ' + fmtCost(BUILD_ROOMS[k].cost), !!(placing && placing.kind === 'room' && placing.k === k)));
  for (const t in ITEM_TYPES) parts.push(legendChip(ITEM_TYPES[t].name + ' · ' + fmtCost(ITEM_TYPES[t].cost), !!(itemTool && itemSel === t)));
  let ctx;
  if (digTool) ctx = '<b>Click/drag</b>: dig tiles';
  else if (placing && placing.kind === 'ladder') ctx = '<b>Click</b>: place ladder';
  else if (placing && placing.kind === 'room') ctx = '<b>Click</b>: place ' + placing.k + ' (needs ' + fmtCost((BUILD_ROOMS[placing.k] || {}).cost || {}) + ')';
  else if (itemTool) ctx = '<b>Click</b>: place ' + ((ITEM_TYPES[itemSel] || {}).name || 'item') + ' · <b>Click existing</b>: upgrade · <b>Shift+click</b>: remove';
  else ctx = '';
  const undoHint = '<span style="opacity:.7"><b>Undo/Redo</b>: not available, builds are final' + (itemTool ? ' (Shift+click removes an item)' : '') + '</span>';
  const html = parts.join('') + '<br>' + (ctx ? ctx + ' · ' : '') + '<b>Right-click</b>: cancel · <b>Right-drag</b>: pan · <b>Esc</b>: cancel<br>' + undoHint;
  if (html !== legendHtml) { legendHtml = html; legendUI.innerHTML = html; }
  legendUI.style.display = 'block';
}
setInterval(renderLegend, 200);
$('#dbody').addEventListener('click', e => { if (e.target.closest && e.target.closest('[data-act="resetcam"]')) bcamReset(); });
function personAt(x, y) { return living().find(c => Math.abs(c.x - x) < 11 && y < c.y + 2 && y > c.y - 40) || null; }
// remappable keys (movement, jump, shoot, interact); arrows always work for movement
const BIND_DEF = { left: 'a', right: 'd', up: 'w', down: 's', jump: ' ', shoot: 'j', interact: 'e' };
const BIND_LABELS = [['left', 'Move left'], ['right', 'Move right'], ['up', 'Climb up / jump'], ['down', 'Climb down / drop'], ['jump', 'Jump'], ['shoot', 'Shoot'], ['interact', 'Interact']];
const BIND_ARROWS = { left: 'arrowleft', right: 'arrowright', up: 'arrowup', down: 'arrowdown' };
const BIND_RESERVED = ['c', 'b', 't', 'r', 'g', 'm', 'h', 'v', 'x', 'n', 'p', 'o', 'l', '[', ']', '`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '/', '?', 'escape'];
let bindNote = '';
function bindLabel(a) { const f = BIND_LABELS.find(x => x[0] === a); return f ? f[1] : a; }
const BIND = Object.assign({}, BIND_DEF);
try {
  const sv = JSON.parse(localStorage.getItem('ashfall.binds') || '{}');
  const used = {};
  for (const a in BIND_DEF) if (typeof sv[a] === 'string' && sv[a].length && !BIND_RESERVED.includes(sv[a]) && !used[sv[a]]) { BIND[a] = sv[a]; used[sv[a]] = 1; }
  // actions whose saved key was invalid or duplicated fall back to their default; if that default is already taken, reset everything to defaults so no two actions share a key
  const ok = {};
  for (const a in BIND_DEF) if (typeof sv[a] === 'string' && BIND[a] === sv[a]) ok[a] = 1;
  const seen = {};
  let clash = false;
  for (const a in BIND_DEF) { if (seen[BIND[a]]) clash = true; seen[BIND[a]] = 1; }
  if (clash) Object.assign(BIND, BIND_DEF);
} catch (_) {}
function saveBinds() { try { localStorage.setItem('ashfall.binds', JSON.stringify(BIND)); } catch (_) {} }
function kd(a) { return !!(keys[BIND[a]] || keys['g:' + a] || keys['t:' + BIND_DEF[a]] || (BIND_ARROWS[a] && keys[BIND_ARROWS[a]])); }
function keyLabel(k) { return k === ' ' ? 'Space' : k.startsWith('arrow') ? k.slice(5).toUpperCase() : k.length === 1 ? k.toUpperCase() : k; }
function setBind(a, k) {
  const other = Object.keys(BIND).find(x => x !== a && BIND[x] === k);
  if (other) { const old = BIND[a]; BIND[other] = old; bindNote = '\u26A0 ' + keyLabel(k) + ' was already used by "' + bindLabel(other) + '". Swapped: "' + bindLabel(other) + '" now uses ' + keyLabel(old) + '.'; }
  else bindNote = bindLabel(a) + ' set to ' + keyLabel(k) + '.';
  BIND[a] = k; saveBinds();
  for (const kk in keys) keys[kk] = false; // avoid stuck keys after rebinding
}
function startRebind(a, btn, done) {
  btn.textContent = 'Press a key…';
  const h = e => {
    e.preventDefault(); e.stopImmediatePropagation();
    const k = e.key.toLowerCase();
    if (['shift', 'control', 'alt', 'meta', 'tab', 'capslock', 'dead'].includes(k)) return;
    window.removeEventListener('keydown', h, true);
    if (k === 'escape') bindNote = 'Rebind cancelled.';
    else if (BIND_RESERVED.includes(k)) bindNote = '\u26A0 ' + keyLabel(k) + ' is reserved for a fixed hotkey and can\'t be used. Pick another key.';
    else setBind(a, k);
    done();
  };
  window.addEventListener('keydown', h, true);
}
window.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (overlayKey(e, k)) return;
  if ($('#sBack')) { if (k === 'escape') { e.preventDefault(); $('#sBack').click(); } return; }
  if (e.target.tagName === 'INPUT') return;
  if (k === '/' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !$('#drawer').hidden && tab === 'crew') { const q = $('#dbody [data-q]'); if (q) { e.preventDefault(); q.focus(); q.select(); return; } }
  if (document.querySelector('#overlay .help')) { helpKey(e, k); return; }
  if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', BIND.jump].includes(k)) e.preventDefault();
  if (scene === 'menu' || scene === 'over') return;
  if ($('#pRes') || $('#pRestartNo')) return; // pause menu open: ignore game hotkeys (P / 1-3 would unpause behind it)
  keys[k] = true;
  if (k === BIND.interact) { const it = interactable(); if (it && it.act) it.act(); }
  if (k === 'c') toggleDrawer('crew');
  if (k === 'o') toggleOverview();
  if (k === 'b') toggleDrawer('build');
  if (k === 't') toggleDrawer('tower');
  if (k === 'r') toggleDrawer('rel');
  if (k === 'g') toggleAlarm();
  if (k === 'm' && window.SFX) SFX.toggleMute();
  if (k === 'h') showHelp(true);
  if (k === 'v') toggleDbgCrew();
  if (k === '`') toggleTunePanel();
  if (k === 'home' && scene === 'bunker' && S) { e.preventDefault(); bcamReset(); }
  if (k === 'x' && scene === 'bunker' && S) toggleDig();
  if (k === 'n' && scene === 'bunker' && S) toggleBuildGrid();
  if (k === 'l' && scene === 'bunker' && S) { if (placing && placing.kind === 'ladder') cancelPlace(); else startPlace({ kind: 'ladder' }); }
  // number keys in build mode go to the hotbar (hotbarKey below); the old tile toolbar no longer takes 4-9, which double-fired
  if (k === 'p') { paused = !paused; renderHud(); }
  if (hotbarKey(k)) { e.preventDefault(); }
  else if (k === '1' || k === '2' || k === '3') setSpeed(+k);
  if ((k === '[' || k === ']') && scene === 'bunker' && S) cycleCrew(k === ']' ? 1 : -1);
  if (k === 'escape') { if (scene === 'bunker' && S && cancelBuildTools()) { /* tool cancelled */ } else if (!$('#drawer').hidden) closeDrawer(); else showPauseMenu(); }
});
window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
// ---- gamepad layer: feeds the same action flags as touch (keys['t:'+default]) so remapped keys keep working ----
const GP = { prev: [], active: false, lastIn: 0, curT: 0, rep: 0, wait: false, set: {}, hint: null, cur: null };
function gpPad() {
  try { const l = navigator.getGamepads ? navigator.getGamepads() : []; for (const p of l) if (p && p.connected) return p; } catch (_) {}
  return null;
}
function gpSetAct(a, on) {
  const k = 't:' + BIND_DEF[a];
  if (!!GP.set[a] === !!on) return;
  GP.set[a] = !!on; keys[k] = !!on;
}
function gpReleaseAll() { for (const a in BIND_DEF) gpSetAct(a, false); }
(function gpUi() {
  const st = document.createElement('style');
  st.textContent = '#gphint{position:absolute;left:6px;bottom:30px;padding:3px 8px;background:#120d08cc;border:1px solid var(--line);font-size:12px;line-height:1.4;color:#cdb99a;pointer-events:none;z-index:3;max-width:60%}#gphint b{display:inline-block;min-width:16px;margin-right:3px;padding:0 4px;border:1px solid var(--line);border-radius:8px;text-align:center;color:#ffc857}#gphint span{margin-right:8px;white-space:nowrap}#gpcur{position:fixed;width:18px;height:18px;margin:-9px 0 0 -9px;border:2px solid #ffc857;border-radius:50%;pointer-events:none;z-index:50;box-shadow:0 0 0 1px #000}#gpcur::after{content:"";position:absolute;left:6px;top:6px;width:2px;height:2px;background:#ffc857}';
  document.head.appendChild(st);
  const h = document.createElement('div'); h.id = 'gphint'; h.hidden = true; h.setAttribute('aria-hidden', 'true');
  const w = document.getElementById('wrap'); (w || document.body).appendChild(h); GP.hint = h;
  const c = document.createElement('div'); c.id = 'gpcur'; c.hidden = true; c.setAttribute('aria-hidden', 'true'); document.body.appendChild(c); GP.cur = c;
  window.addEventListener('gamepaddisconnected', () => { gpReleaseAll(); GP.active = false; });
})();
function gpHintHtml() {
  const b = (x, t) => '<span><b>' + x + '</b>' + t + '</span>';
  const inBunker = scene === 'bunker';
  return b('L', 'Move') + b('A', 'Jump') + b('X', 'Interact') + b('RT', inBunker && (placing || itemTool || digTool) ? 'Place' : 'Shoot') + b('R', 'Aim cursor') + b('Y', 'Crew') + b('Sel', 'Build') + (inBunker ? b('LB/RB', 'Survivor') : '') + b('B', 'Cancel') + b('Start', 'Pause');
}
function gpMenuNav(p, dt, pressed, edge) {
  const items = [...document.querySelectorAll('#overlay button, #overlay input, #overlay select')].filter(el => !el.disabled && el.offsetParent !== null);
  const ax = p.axes || [], ly = ax[1] || 0, lx = ax[0] || 0;
  const up = pressed(12) || ly < -0.6, dn = pressed(13) || ly > 0.6, lf = pressed(14) || lx < -0.6, rt = pressed(15) || lx > 0.6;
  GP.rep -= dt;
  let dir = 0, hdir = 0;
  if (up || dn || lf || rt) { if (GP.rep <= 0) { GP.rep = 0.18; dir = up ? -1 : dn ? 1 : 0; hdir = lf ? -1 : rt ? 1 : 0; } } else GP.rep = 0;
  const cur = items.indexOf(document.activeElement);
  if (items.length && cur < 0) { items[0].focus(); return; }
  if (dir && items.length) items[(cur + dir + items.length) % items.length].focus();
  const el = document.activeElement;
  if (hdir && el && el.tagName === 'INPUT' && el.type === 'range') {
    const step = +el.step || 1, mn = el.min === '' ? 0 : +el.min, mx = el.max === '' ? 100 : +el.max;
    el.value = Math.max(mn, Math.min(mx, (+el.value || 0) + hdir * step * Math.max(1, Math.round((mx - mn) / 20 / step))));
    el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  if (edge(0) && el && items.includes(el) && (el.tagName === 'BUTTON' || (el.tagName === 'INPUT' && el.type !== 'range'))) el.click();
  if (edge(1)) { const b = $('#sBack') || $('#pRes'); if (b) b.click(); }
  if (edge(9)) { const r = $('#pRes'); if (r) r.click(); }
}
function gamepadTick(dt) {
  const p = gpPad();
  if (!p) { if (GP.active) { gpReleaseAll(); GP.active = false; } if (GP.hint) GP.hint.hidden = true; if (GP.cur) GP.cur.hidden = true; return; }
  const pressed = i => !!(p.buttons[i] && (p.buttons[i].pressed || p.buttons[i].value > 0.5));
  const edge = i => pressed(i) && !GP.prev[i];
  const ax = p.axes || [];
  const anyIn = p.buttons.some((b, i) => pressed(i)) || Math.abs(ax[0] || 0) > 0.4 || Math.abs(ax[1] || 0) > 0.4;
  if (anyIn) { GP.active = true; GP.lastIn = performance.now(); }
  const menuOpen = !!($('#overlay') && !$('#overlay').hidden);
  const live = (scene === 'bunker' || scene === 'scav') && S && !S.over && !menuOpen;
  if (menuOpen) {
    gpReleaseAll(); GP.wait = true;
    if (GP.cur) GP.cur.hidden = true;
    if (GP.active) gpMenuNav(p, dt, pressed, edge);
  } else if (!live) {
    gpReleaseAll();
  } else {
    if (GP.wait) { if (!pressed(0) && !pressed(1) && !pressed(9)) GP.wait = false; }
    const DZ = 0.35, lx = ax[0] || 0, ly = ax[1] || 0;
    const tool = scene === 'bunker' && (placing || itemTool || digTool);
    if (!GP.wait) {
      gpSetAct('left', pressed(14) || lx < -DZ);
      gpSetAct('right', pressed(15) || lx > DZ);
      gpSetAct('up', pressed(12) || ly < -DZ);
      gpSetAct('down', pressed(13) || ly > DZ);
      gpSetAct('jump', pressed(0));
      gpSetAct('shoot', pressed(7) && !tool);
      if (edge(2)) { const it = interactable(); if (it && it.act) it.act(); }
      if (edge(3)) toggleDrawer('crew');
      if (edge(8)) toggleDrawer('build');
      if (scene === 'bunker' && edge(4)) cycleCrew(-1);
      if (scene === 'bunker' && edge(5)) cycleCrew(1);
      if (edge(1)) { if (placing) cancelPlace(); else if (!$('#drawer').hidden) closeDrawer(); }
      if (edge(9)) showPauseMenu();
    } else gpReleaseAll();
    // right stick drives the shared mouse state (aim in scav, cursor/tools in bunker)
    const rx = ax[2] || 0, ry = ax[3] || 0;
    if (Math.abs(rx) > 0.2 || Math.abs(ry) > 0.2) {
      GP.curT = performance.now();
      mouse.x = clamp(mouse.x + rx * 650 * dt, 0, W); mouse.y = clamp(mouse.y + ry * 650 * dt, 0, H); mouse.inCv = true;
      const bp = scene === 'bunker' ? bcamToWorld({ x: mouse.x, y: mouse.y }) : { x: mouse.x, y: mouse.y };
      mouse.wx = bp.x + (scene === 'scav' && scav ? scav.cam : 0); mouse.wy = bp.y;
      hover = scene === 'bunker' ? personAt(bp.x, bp.y) : null;
      hoverRoom = scene === 'bunker' ? roomAt(bp.x, bp.y) : null;
    }
    if (!GP.wait && scene === 'bunker' && edge(7)) {
      const w = bcamToWorld({ x: mouse.x, y: mouse.y });
      if (placing) placeClick(w);
      else if (itemTool) placeItem(w, false);
      else if (digTool) digStart(w, false);
      else { const c = personAt(w.x, w.y); if (c) { sel = c.id; openDrawer('crew'); } }
    }
  }
  GP.prev = p.buttons.map((b, i) => pressed(i));
  // hint strip and reticle
  if (GP.hint) {
    const show = GP.active && live;
    if (show && GP.hint.dataset.k !== scene + (placing || itemTool || digTool ? 't' : '')) { GP.hint.dataset.k = scene + (placing || itemTool || digTool ? 't' : ''); GP.hint.innerHTML = gpHintHtml(); }
    GP.hint.hidden = !show;
  }
  if (GP.cur) {
    const showC = live && performance.now() - GP.curT < 3000;
    GP.cur.hidden = !showC;
    if (showC) { const r = cv.getBoundingClientRect(); GP.cur.style.left = (r.left + mouse.x / W * r.width) + 'px'; GP.cur.style.top = (r.top + mouse.y / H * r.height) + 'px'; }
  }
}
// ---- keyboard shortcuts overlay (? key): focus-trapped, pauses while open
let kbOpen = false, kbPrevFocus = null, kbWasPaused = false;
function kbRows() {
  const fixed = [
    ['Game', [['Pause', 'P'], ['Speed 1x / 2x / 3x', '1 / 2 / 3'], ['Pause menu / close panel', 'Esc'], ['Alarm', 'G'], ['Mute', 'M'], ['How to play', 'H'], ['This help', '?']]],
    ['Panels', [['Crew', 'C'], ['Build', 'B'], ['Tower', 'T'], ['Relationships', 'R'], ['Overview', 'O'], ['Crew debug', 'V'], ['Tuning panel', '`']]],
    ['Bunker', [['Dig mode', 'X'], ['Place ladder', 'L'], ['Previous / next survivor', '[ / ]'], ['Build hotbar slots', '4 / 5 / 6 / 7 / 8 / 9'], ['Crew search (crew panel)', '/']]]
  ];
  const ctl = BIND_LABELS.map(([a, l]) => [l, keyLabel(BIND[a]) + (BIND_ARROWS[a] ? ' / ' + keyLabel(BIND_ARROWS[a]) : '')]);
  return [['Controls (remappable in Settings)', ctl]].concat(fixed);
}
function kbRender() {
  const body = document.getElementById('kbBody'); body.textContent = '';
  for (const [title, rows] of kbRows()) {
    const h = document.createElement('h3'); h.textContent = title; body.appendChild(h);
    for (const [label, keyText] of rows) {
      const r = document.createElement('div'); r.className = 'kbrow';
      const s = document.createElement('span'); s.textContent = label;
      const kb = document.createElement('span');
      String(keyText).split(' / ').forEach((t, i) => { if (i) kb.appendChild(document.createTextNode(' ')); const k = document.createElement('kbd'); k.textContent = t; kb.appendChild(k); });
      r.appendChild(s); r.appendChild(kb); body.appendChild(r);
    }
  }
}
function kbShow() {
  const el = document.getElementById('kbHelp'); if (!el || kbOpen) return;
  kbRender(); kbOpen = true; kbPrevFocus = document.activeElement;
  kbWasPaused = paused;
  if (S && !S.over && (scene === 'bunker' || scene === 'scav') && !paused) { paused = true; try { renderHud(); } catch (_) {} }
  clearInput(); el.hidden = false;
  document.getElementById('kbClose').focus();
}
function kbHide() {
  const el = document.getElementById('kbHelp'); if (!el || !kbOpen) return;
  kbOpen = false; el.hidden = true;
  const ov = document.getElementById('overlay');
  if (!kbWasPaused && paused && !(ov && !ov.hidden)) { paused = false; try { renderHud(); } catch (_) {} }
  try { if (kbPrevFocus && document.contains(kbPrevFocus)) kbPrevFocus.focus(); } catch (_) {}
  kbPrevFocus = null;
}
(function kbInit() {
  const el = document.getElementById('kbHelp'); if (!el) return;
  document.getElementById('kbClose').addEventListener('click', kbHide);
  el.addEventListener('pointerdown', e => { if (e.target === el) kbHide(); });
  window.addEventListener('keydown', e => {
    if (kbOpen) {
      const k = e.key;
      if (k === 'Escape' || k === '?') { e.preventDefault(); e.stopImmediatePropagation(); kbHide(); return; }
      if (k === 'Tab') {
        e.preventDefault(); e.stopImmediatePropagation();
        const f = [document.getElementById('kbBody'), document.getElementById('kbClose')];
        const i = f.indexOf(document.activeElement);
        f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
        return;
      }
      if (k === ' ' || k === 'Enter') { e.stopImmediatePropagation(); return; }
      if (!['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(k)) e.stopImmediatePropagation();
      return;
    }
    if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (document.getElementById('sBack')) return; // settings / rebind screen is open
    e.preventDefault(); e.stopImmediatePropagation(); kbShow();
  }, true);
})();
// cycle the selected survivor through living crew (same effect as clicking a crew card)
function cycleCrew(dir) {
  const list = S.crew.filter(c => c.alive && !c.left).sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
  if (!list.length) return;
  const i = list.findIndex(c => String(c.id) === String(sel));
  const n = list[i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length];
  sel = n.id; focusFx = { id: sel, t: performance.now() };
  try { bcamFocus(sel); } catch (_) {}
  renderDrawer();
}
// (a third bunker minimap was here; it reused id="minimap", injected styles that stretched the real one across the screen. The #minimap built by mmInit() is the one minimap.)
// visible keyboard hint bar (hidden on touch devices and outside bunker/scavenge play)
(function keyBar() {
  const st = document.createElement('style');
  st.textContent = '#keybar{position:absolute;left:50%;bottom:6px;transform:translateX(-50%);padding:3px 10px;background:#120d08cc;border:1px solid var(--line);font-size:12px;line-height:1.4;white-space:nowrap;pointer-events:none;z-index:3;color:#cdb99a}#keybar kbd{margin:0 3px 0 0;padding:0 4px;border:1px solid var(--line);border-radius:3px}#keybar span{margin-right:10px}#keybar span:last-child{margin-right:0}body.touch #keybar{display:none}';
  document.head.appendChild(st);
  const el = document.createElement('div');
  el.id = 'keybar'; el.hidden = true; el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '<span><kbd>P</kbd>Pause</span><span><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd>Speed</span><span><kbd>C</kbd>Crew</span><span><kbd>[</kbd><kbd>]</kbd>Prev/next survivor</span><span><kbd>?</kbd>Shortcuts</span>';
  const w = document.getElementById('wrap'); if (w) w.appendChild(el);
  setInterval(() => { el.hidden = !((scene === 'bunker' || scene === 'scav') && S && !S.over); }, 300);
})();
// ---- build-mode hotbar: number keys, icons, cost tooltips, greyed when unaffordable ----
function hotbarSlots() {
  const rooms = [['workshop', '\u2699\uFE0E'], ['armory', '\u2694\uFE0E'], ['storage', '\u25A6'], ['generator', '\u26A1\uFE0E']];
  const items = [['bunk', '\u25AD'], ['cot', '\u271A'], ['table', '\u25AC']];
  const out = [];
  out.push({ name: 'Dig', key: 'X', icon: '\u26CF\uFE0E', cost: null, on: !!digTool, ok: true, act: () => toggleDig() });
  const lon = !!(placing && placing.kind === 'ladder');
  out.push({ name: 'Ladder', key: 'L', icon: '\u21D5', cost: LADDER_COST.pit, on: lon, ok: lon || canPay(LADDER_COST.pit), act: () => doBuild('toggleLadder') });
  for (const [k, ic] of rooms) {
    const r = BUILD_ROOMS[k], built = !!S.rooms[k];
    out.push({ name: ROOMS[k].name, icon: ic, cost: r.cost, on: !!(placing && placing.kind === 'room' && placing.k === k), ok: !built && canPay(r.cost), why: built ? 'Already built' : '', act: () => doBuild('room_' + k) });
  }
  for (const [t, ic] of items) {
    const T = ITEM_TYPES[t];
    out.push({ name: T.name, icon: ic, cost: T.cost, on: false, ok: !!ROOMS[T.room] && canPay(T.cost), act: () => buyItem(t) });
  }
  return out;
}
function hotbarLive() { return scene === 'bunker' && !!S && !S.over && (!!placing || !!digTool || (!$('#drawer').hidden && tab === 'build')); }
function hotbarUse(i) {
  const s = hotbarSlots()[i]; if (!s) return;
  if (!s.ok) { uiSfx('Error'); return; }
  s.act(); renderDrawer(); renderHud(); hotbarRender(true);
}
function hotbarKey(k) {
  if (!/^[1-9]$/.test(k) || !hotbarLive()) return false;
  hotbarUse(+k - 1); return true;
}
let hotbarSig = '';
function hotbarRender(force) {
  const el = document.getElementById('hotbar'); if (!el) return;
  const show = hotbarLive();   // only while building (Build panel open, or a dig/place tool active)
  if (el.hidden === !show) { /* unchanged */ } else el.hidden = !show;
  if (!show) return;
  const slots = hotbarSlots();
  const sig = slots.map(s => (s.ok ? 1 : 0) + '' + (s.on ? 1 : 0)).join('') + (hotbarLive() ? 'L' : 'l');
  if (!force && sig === hotbarSig) return;
  hotbarSig = sig;
  el.classList.toggle('live', hotbarLive());
  el.innerHTML = slots.map((s, i) => {
    const cost = s.cost ? fmtCost(s.cost) : 'free';
    const tip = s.name + ' [' + (i + 1) + (s.key ? ' / ' + s.key : '') + '] \u2014 ' + cost + (s.ok ? '' : (s.why ? ' (' + s.why + ')' : ' (cannot afford)'));
    return '<button type="button" class="hb' + (s.on ? ' on' : '') + (s.ok ? '' : ' off') + '" data-hb="' + i + '" title="' + tip + '" aria-label="' + tip + '" aria-disabled="' + (s.ok ? 'false' : 'true') + '"><kbd>' + (i + 1) + '</kbd><span class="hbi" aria-hidden="true">' + s.icon + '</span><span class="hbn">' + s.name + '</span><span class="hbc">' + (s.why || cost) + '</span></button>';
  }).join('');
}
(function hotbarInit() {
  const st = document.createElement('style');
  st.textContent = '#hotbar{position:absolute;left:50%;bottom:80px;transform:translateX(-50%);display:flex;gap:4px;padding:4px;background:#120d08dd;border:1px solid var(--line);z-index:4}#hotbar[hidden]{display:none}#hotbar .hb{position:relative;width:62px;padding:2px 2px 3px;background:#2a2016;border:1px solid var(--line);color:#e8d9b8;font:inherit;font-size:10px;line-height:1.2;cursor:pointer;text-align:center}#hotbar .hb kbd{position:absolute;left:2px;top:1px;font-size:10px;opacity:.8}#hotbar .hbi{display:block;font-size:20px;line-height:24px}#hotbar .hbn,#hotbar .hbc{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#hotbar .hbc{color:#cdb99a;font-size:9px}#hotbar .hb:hover,#hotbar .hb:focus-visible{border-color:#ffb347}#hotbar .hb.on{background:#5a3f1c;border-color:#ffb347}#hotbar .hb.off{opacity:.4;filter:grayscale(1);cursor:not-allowed}#hotbar .hb.off .hbc{color:#e07a5f}#hotbar:not(.live) kbd{opacity:.35}body.touch #hotbar{bottom:4px}@media (max-width:700px){#hotbar .hb{width:44px;min-height:44px}#hotbar .hbn{display:none}}';
  document.head.appendChild(st);
  const el = document.createElement('div');
  el.id = 'hotbar'; el.hidden = true; el.setAttribute('role', 'toolbar'); el.setAttribute('aria-label', 'Build hotbar. Number keys 1 to 9 select a slot while build mode is open.');
  el.addEventListener('click', e => { const b = e.target.closest('[data-hb]'); if (b) hotbarUse(+b.dataset.hb); });
  const w = document.getElementById('wrap'); if (w) w.appendChild(el);
  setInterval(() => { try { hotbarRender(false); } catch (_) {} }, 250);
})();
// ---- toggleable build help panel: tools, hotkeys, costs; collapsed state remembered ----
(function buildHelpPanel() {
  const KEY = 'ashfall.buildHelp';
  let open = true;
  try { open = localStorage.getItem(KEY) !== 'collapsed'; } catch (_) {}
  const st = document.createElement('style');
  st.textContent = '#bhelp{position:absolute;right:8px;bottom:40px;z-index:4;max-width:230px;font-size:12px;line-height:1.35;color:#e8d9b8}#bhelp[hidden]{display:none}#bhelp .bh-t{display:block;margin-left:auto;padding:3px 8px;background:#2a2016;border:1px solid var(--line);color:#e8d9b8;font:inherit;cursor:pointer}#bhelp .bh-t:hover,#bhelp .bh-t:focus-visible{border-color:#ffb347}#bhelp .bh-p{margin-top:4px;padding:6px 8px;background:#120d08ee;border:1px solid var(--line)}#bhelp .bh-p[hidden]{display:none}#bhelp .bh-p h4{margin:0 0 4px;font-size:12px;color:#ffb347}#bhelp ul{list-style:none;margin:0;padding:0}#bhelp li{display:flex;gap:6px;align-items:baseline;padding:1px 0}#bhelp li.off{opacity:.45}#bhelp li kbd{border:1px solid var(--line);border-radius:3px;padding:0 4px;font-size:11px}#bhelp .bh-n{flex:1}#bhelp .bh-c{color:#cdb99a;font-size:11px}#bhelp li.off .bh-c{color:#e07a5f}#bhelp .bh-f{margin-top:4px;color:#cdb99a;font-size:11px}body.touch #bhelp{display:none}';
  document.head.appendChild(st);
  const el = document.createElement('div');
  el.id = 'bhelp'; el.hidden = true;
  el.innerHTML = '<button type="button" class="bh-t" aria-controls="bhelp-panel"></button><div class="bh-p" id="bhelp-panel" role="region" aria-label="Build help"></div>';
  const btn = el.querySelector('.bh-t'), panel = el.querySelector('.bh-p');
  let sig = '';
  function paint() {
    btn.textContent = (open ? '\u25BE' : '\u25B8') + ' Build help';
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    panel.hidden = !open;
  }
  function render(force) {
    const show = hotbarLive() && $('#drawer').hidden;   // while building with the side panel closed (the panel lists the same tools)
    if (el.hidden === show) el.hidden = !show;
    if (!show || !open) return;
    let slots; try { slots = hotbarSlots(); } catch (_) { return; }
    const s2 = slots.map(s => (s.ok ? 1 : 0) + (s.on ? 'o' : '')).join('');
    if (!force && s2 === sig) return;
    sig = s2;
    panel.innerHTML = '<h4>Build tools</h4><ul>' + slots.map((s, i) => '<li class="' + (s.ok ? '' : 'off') + '"><kbd>' + (i + 1) + '</kbd><span class="bh-n">' + s.name + (s.key ? ' <kbd>' + s.key + '</kbd>' : '') + '</span><span class="bh-c">' + (s.why || (s.cost ? fmtCost(s.cost) : 'free')) + '</span></li>').join('') + '</ul><div class="bh-f">Number keys pick a tool while build mode is open. Dimmed tools are unaffordable or already built.</div>';
  }
  btn.addEventListener('click', () => {
    open = !open;
    try { localStorage.setItem(KEY, open ? 'open' : 'collapsed'); } catch (_) {}
    paint(); render(true);
  });
  paint();
  const w = document.getElementById('wrap'); if (w) w.appendChild(el);
  setInterval(() => { try { render(false); } catch (_) {} }, 300);
})();
// build-mode toolbar: tile tools with hotkeys, costs, selected highlight and arrow-key navigation
(function buildToolbar() {
  const bar = document.getElementById('btools'); if (!bar) return;
  let sig = '', focusI = 0;
  function tools() {
    const list = [
      { id: 'dig', name: 'Dig', key: 'X', cost: 'Free (miners)', on: !!digTool, ok: true },
      { id: 'ladder', name: 'Ladder', key: 'L', cost: fmtCost(LADDER_COST.pit) + '/tile', tip: 'Pit tile ' + fmtCost(LADDER_COST.pit) + ', floor gap ' + fmtCost(LADDER_COST.bunker), on: !!(placing && placing.kind === 'ladder'), ok: true }
    ];
    Object.keys(BUILD_ROOMS).forEach((k, i) => {
      const built = !!S.rooms[k], c = BUILD_ROOMS[k].cost, sz = ROOM_CELLS[k];
      list.push({ id: 'room:' + k, k, name: ROOMS[k].name, key: String(i + 4), cost: built ? 'BUILT' : fmtCost(c), tip: sz ? sz.w + 'x' + sz.h + ' tiles' : '', on: !!(placing && placing.kind === 'room' && placing.k === k), ok: !built && canPay(c), built });
    });
    return list;
  }
  function activate(t) {
    if (!S || scene !== 'bunker' || S.over) return;
    if (t.built) { uiSfx('Error'); return; }
    if (t.id === 'dig') { toggleDig(); }
    else if (t.id === 'ladder') { if (placing && placing.kind === 'ladder') cancelPlace(); else startPlace({ kind: 'ladder' }); }
    else if (placing && placing.kind === 'room' && placing.k === t.k) cancelPlace();
    else {
      if (!t.ok) { uiSfx('Error'); lamp('The ' + t.name + ' needs ' + t.cost + '.', 'warn'); return; }
      startPlace({ kind: 'room', k: t.k });
    }
    refresh(true);
  }
  function refresh(force) {
    const show = false;   // superseded by #hotbar (same tools plus items, keys 1-9); showing both stacked them on top of each other
    if (!show) { if (!bar.hidden) { bar.hidden = true; sig = ''; } return; }
    const list = tools();
    const s = list.map(t => t.id + (t.on ? 1 : 0) + (t.ok ? 1 : 0) + (t.built ? 1 : 0) + t.cost).join('|');
    if (!force && s === sig && !bar.hidden) return;
    sig = s; bar.hidden = false;
    const hadFocus = bar.contains(document.activeElement);
    if (focusI >= list.length) focusI = 0;
    bar.innerHTML = list.map((t, i) => '<button type="button" class="bt' + (t.on ? ' on' : '') + (t.ok ? '' : (t.built ? ' done' : ' poor')) + '" data-i="' + i + '" tabindex="' + (i === focusI ? 0 : -1) + '" aria-pressed="' + t.on + '" aria-label="' + t.name + ', hotkey ' + t.key + ', ' + t.cost + (t.built ? '' : '') + '" title="' + t.name + ' (' + t.key + ') ' + (t.tip || t.cost) + '"><span><kbd>' + t.key + '</kbd>' + t.name + '</span><span class="bc">' + t.cost + '</span></button>').join('');
    if (hadFocus) { const b = bar.querySelector('[data-i="' + focusI + '"]'); if (b) b.focus(); }
  }
  bar.addEventListener('click', e => {
    const b = e.target.closest('.bt'); if (!b || !S) return;
    focusI = +b.dataset.i; activate(tools()[focusI]);
  });
  bar.addEventListener('keydown', e => {
    const nav = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    const n = bar.querySelectorAll('.bt').length;
    if (nav || e.key === 'Home' || e.key === 'End') {
      e.preventDefault(); e.stopPropagation();
      focusI = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (focusI + nav + n) % n;
      bar.querySelectorAll('.bt').forEach((b, i) => { b.tabIndex = i === focusI ? 0 : -1; });
      const b = bar.querySelector('[data-i="' + focusI + '"]'); if (b) b.focus();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault(); e.stopPropagation();
      if (S) activate(tools()[focusI]);
    }
  });
  window.btoolHotkey = function (k) {
    if (!S) return;
    const t = tools().find(x => x.key === k);
    if (t) { const i = tools().indexOf(t); focusI = i; activate(t); }
  };
  setInterval(() => refresh(false), 200);
})();
function clearInput() { for (const k in keys) keys[k] = false; mouse.down = false; document.querySelectorAll('#touch button.on').forEach(b => b.classList.remove('on')); }
function autoPause() {
  clearInput();
  if (!S || S.over || (scene !== 'bunker' && scene !== 'scav')) return;
  save();
  if (!$('#overlay').hidden) { paused = true; return; }
  showPauseMenu();
}
document.addEventListener('visibilitychange', () => { if (document.hidden) autoPause(); else clearInput(); });
window.addEventListener('pagehide', autoPause);
window.addEventListener('blur', autoPause);

// gamepad: sticks/buttons drive the same key state as keyboard/touch; right stick = virtual cursor; D-pad navigates overlays
(function gamepadSupport() {
  if (!navigator.getGamepads) return;
  const st = document.createElement('style');
  st.textContent = '#padhint{position:absolute;left:8px;bottom:6px;padding:3px 10px;background:#120d08cc;border:1px solid var(--line);font-size:12px;line-height:1.4;pointer-events:none;z-index:3;color:#cdb99a}#padcur{position:fixed;width:14px;height:14px;margin:-7px 0 0 -7px;border:2px solid #ffc857;border-radius:50%;pointer-events:none;z-index:50;box-shadow:0 0 0 1px #000}body.touch #padhint{display:none}';
  document.head.appendChild(st);
  const hint = document.createElement('div');
  hint.id = 'padhint'; hint.hidden = true; hint.setAttribute('aria-hidden', 'true');
  hint.textContent = '\uD83C\uDFAE Stick move \u00B7 A jump \u00B7 X interact \u00B7 RT fire \u00B7 R-stick aim/cursor \u00B7 LT click \u00B7 LB/RB crew \u00B7 Y crew panel \u00B7 Start pause';
  const wrapEl = document.getElementById('wrap'); (wrapEl || document.body).appendChild(hint);
  const curEl = document.createElement('div'); curEl.id = 'padcur'; curEl.hidden = true; document.body.appendChild(curEl);
  const GK = ['g:left', 'g:right', 'g:up', 'g:down', 'g:jump', 'g:shoot'];
  const DZ = 0.3;
  const cur = { x: W / 2, y: H / 2, shown: false };
  let prev = [], navT = 0, lastT = performance.now(), had = false;
  function getPad() { const l = navigator.getGamepads() || []; for (const p of l) if (p && p.connected) return p; return null; }
  function clearG() { GK.forEach(k => { keys[k] = false; }); }
  function client(x, y) { const r = cv.getBoundingClientRect(); return { cx: r.left + x / W * r.width, cy: r.top + y / H * r.height }; }
  function fire(type, x, y) {
    const c = client(x, y);
    try { cv.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: c.cx, clientY: c.cy, pointerType: 'mouse', pointerId: 1, isPrimary: true, button: 0, buttons: type === 'pointerdown' ? 1 : 0 })); } catch (_) {}
  }
  function showCur() { const c = client(cur.x, cur.y); curEl.style.left = c.cx + 'px'; curEl.style.top = c.cy + 'px'; curEl.hidden = false; cur.shown = true; }
  window.addEventListener('pointermove', e => { if (e.isTrusted && cur.shown) { curEl.hidden = true; cur.shown = false; } }, true);
  function focusables(o) { return [...o.querySelectorAll('button,input,select,a[href],[tabindex]:not([tabindex="-1"])')].filter(el => !el.disabled && el.offsetParent !== null); }
  function navMenu(o, dir, now) {
    const f = focusables(o); if (!f.length) return;
    const a = document.activeElement, i = f.indexOf(a);
    if (i < 0) { f[0].focus(); return; }
    f[(i + dir + f.length) % f.length].focus();
  }
  function poll(now) {
    requestAnimationFrame(poll);
    try {
      const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
      const p = getPad();
      if (!p) { if (had) { clearG(); had = false; hint.hidden = true; curEl.hidden = true; cur.shown = false; } prev = []; return; }
      had = true;
      const b = i => !!(p.buttons[i] && p.buttons[i].pressed);
      const ax = i => { const v = p.axes[i] || 0; return Math.abs(v) < DZ ? 0 : v; };
      const lx = ax(0), ly = ax(1), rx = ax(2), ry = ax(3);
      const L = lx < -0.4 || b(14), R = lx > 0.4 || b(15), U = ly < -0.5 || b(12), D = ly > 0.5 || b(13);
      const edge = i => b(i) && !prev[i];
      const any = p.buttons.some(x => x && x.pressed) || lx || ly || rx || ry;
      const ov = document.getElementById('overlay');
      const ovOpen = !!(ov && !ov.hidden && ov.firstElementChild);
      const live = (scene === 'bunker' || scene === 'scav') && S && !S.over && !ovOpen;
      hint.hidden = !live;
      if (ovOpen) {
        clearG();
        let dir = 0;
        if (U || L) dir = -1; else if (D || R) dir = 1;
        if (dir) { if (now >= navT) { navMenu(ov, dir, now); navT = now + (navT === 0 || now - navT > 600 ? 380 : 160); } } else navT = 0;
        if (edge(0)) { const a = document.activeElement; if (a && ov.contains(a) && a.click) a.click(); else { const f = focusables(ov); if (f[0]) f[0].focus(); } }
        if (edge(1) || edge(9)) window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      } else if (live) {
        keys['g:left'] = L; keys['g:right'] = R; keys['g:up'] = U; keys['g:down'] = D;
        keys['g:jump'] = b(0); keys['g:shoot'] = b(7);
        if (edge(2)) { const it = interactable(); if (it && it.act) it.act(); }
        if (edge(9)) showPauseMenu();
        if (edge(1)) { if (placing) cancelPlace(); else if (!$('#drawer').hidden) closeDrawer(); }
        if (edge(3)) toggleDrawer('crew');
        if (scene === 'bunker' && (edge(4) || edge(5))) cycleCrew(edge(5) ? 1 : -1);
        if (rx || ry || cur.shown) {
          if (rx || ry) { cur.x = clamp(cur.x + rx * 900 * dt, 0, W); cur.y = clamp(cur.y + ry * 900 * dt, 0, H); fire('pointermove', cur.x, cur.y); }
          showCur();
        }
        if (cur.shown && edge(6)) { fire('pointermove', cur.x, cur.y); fire('pointerdown', cur.x, cur.y); fire('pointerup', cur.x, cur.y); }
      } else {
        clearG();
        if (edge(9) && S && !S.over && (scene === 'bunker' || scene === 'scav')) { /* overlay closed externally */ }
      }
      if (!live && cur.shown) { curEl.hidden = true; cur.shown = false; }
      prev = p.buttons.map(x => !!(x && x.pressed));
    } catch (_) {}
  }
  requestAnimationFrame(poll);
  window.addEventListener('gamepaddisconnected', () => { clearG(); });
})();
// touch controls: buttons drive the same key state as the keyboard
const TOUCH_MODES = [['auto', 'Auto'], ['on', 'On'], ['off', 'Off']];
function getTouchMode() { try { const v = localStorage.getItem('ashfall.touch'); if (TOUCH_MODES.some(t => t[0] === v)) return v; } catch (_) {} return 'auto'; }
let touchMode = getTouchMode();
let touchSeen = false; // coarse pointer or a real touch was detected (used by Auto)
function applyTouchMode() {
  const show = touchMode === 'on' || (touchMode === 'auto' && touchSeen);
  document.body.classList.toggle('touch', show);
}
function setTouchMode(m) {
  touchMode = m;
  try { localStorage.setItem('ashfall.touch', m); } catch (_) {}
  applyTouchMode();
  clearInput();
}
function markTouch() { touchSeen = true; applyTouchMode(); }
if (window.matchMedia && matchMedia('(pointer: coarse)').matches) touchSeen = true;
applyTouchMode();
window.addEventListener('pointerdown', e => { if (e.pointerType === 'touch' && !touchSeen) markTouch(); }, true);
document.querySelectorAll('#touch button').forEach(b => {
  const k = b.dataset.k;
  const release = () => { if (k !== undefined) keys['t:' + k] = false; b.classList.remove('on'); };
  b.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (scene !== 'bunker' && scene !== 'scav') return;
    if (b.dataset.act === 'pause') { clearInput(); showPauseMenu(); return; }
    try { b.setPointerCapture(e.pointerId); } catch (_) {}
    b.classList.add('on');
    if (k !== undefined) keys['t:' + k] = true;
    else if (b.dataset.act === 'interact') { const it = interactable(); if (it && it.act) it.act(); }
  });
  b.addEventListener('pointerup', release);
  b.addEventListener('pointercancel', release);
  b.addEventListener('lostpointercapture', release);
  b.addEventListener('contextmenu', e => e.preventDefault());
});
// show the touch pad only during live play (not menu / pause / game over)
(function touchPadVisibility() {
  const tp = document.getElementById('touch'); if (!tp) return;
  setInterval(() => {
    const ov = document.getElementById('overlay');
    const live = (scene === 'bunker' || scene === 'scav') && S && !S.over && !(ov && !ov.hidden);
    const eb = tp.querySelector('[data-act="interact"]');
    if (eb) { let it = null; try { it = live ? interactable() : null; } catch (_) {} eb.classList.toggle('rdy', !!(it && it.act)); }
    if (live) { const ib = tp.querySelector('button[data-act="interact"]'); if (ib) { let ok = false; try { ok = !!interactable(); } catch (_) {} ib.classList.toggle('idle', !ok); } }
    if (tp.hidden === !live) return;
    tp.hidden = !live;
    if (!live) clearInput();
  }, 150);
})();
document.querySelectorAll('.tabs [data-tab]').forEach(b => b.onclick = () => openDrawer(b.dataset.tab));
$('#dClose').onclick = closeDrawer;
$('#dCollapse').onclick = () => setDrawerCollapsed(!$('#drawer').classList.contains('collapsed'));
// hover tick on buttons and chips (mouse/pen only, not touch)
let lastHoverEl = null;
// click tick on enabled buttons and chips (drawer tabs, toolbar toggles and drawer close already play open/close sounds)
document.addEventListener('click', e => {
  const b = e.target && e.target.closest ? e.target.closest('button:not(:disabled), .chip') : null;
  if (!b || b.hasAttribute('data-tab') || b.id === 'dClose' || b.id === 'tCrew' || b.id === 'tBuild' || b.id === 'tTower' || b.id === 'tHelp') return;
  if (window.SFX && SFX.click) SFX.click();
});
document.addEventListener('pointerover', e => {
  if (e.pointerType === 'touch') return;
  const b = e.target && e.target.closest ? e.target.closest('button:not(:disabled), .chip') : null;
  if (b && b !== lastHoverEl) { lastHoverEl = b; uiSfx('Hover'); }
  else if (!b) lastHoverEl = null;
});
// soft click on buttons; skipped where another UI sound (open/close/place/error/job chip) already plays
document.addEventListener('click', e => {
  const b = e.target && e.target.closest ? e.target.closest('button:not(:disabled), .chip') : null;
  if (!b || b.closest('.tabs [data-tab], [data-build], [data-job]') || b.id === 'dClose' || b.id === 'tCrew' || b.id === 'tBuild' || b.id === 'tTower') return;
  uiSfx('Click');
}, true);
$('#tCrew').onclick = () => toggleDrawer('crew');
$('#tBuild').onclick = () => toggleDrawer('build');
$('#tTower').onclick = () => toggleDrawer('tower');
$('#tAlarm').onclick = () => toggleAlarm();
$('#tHelp').onclick = () => showHelp(true);
$('#tPause').onclick = e => { if (S && !S.over && (scene === 'bunker' || scene === 'scav') && $('#overlay').hidden) { pauseOpener = e.currentTarget; showPauseMenu(); } };
$('#tMore').onclick = e => { const on = $('#tools').classList.toggle('more'); e.currentTarget.setAttribute('aria-pressed', on ? 'true' : 'false'); e.currentTarget.blur(); };
$('#tMute').onclick = e => { if (window.SFX) SFX.toggleMute(); e.currentTarget.blur(); };

// menus
function overlay(html) {
  const o = $('#overlay'); const wasOpen = !o.hidden; o.innerHTML = html; o.hidden = !html;
  if (!!html !== wasOpen) uiSfx(html ? 'Open' : 'Close');
  if (!html) return;
  const m = o.firstElementChild;
  if (m && m.classList.contains('menu') && !m.getAttribute('role')) {
    m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
    const h1 = m.querySelector('h1');
    if (h1 && !m.hasAttribute('aria-labelledby')) m.setAttribute('aria-label', h1.textContent.replace(/\s+/g, ' ').trim());
  }
  try {
    if (!o.contains(document.activeElement)) { const f = o.querySelector('button,[tabindex="0"]'); if (f) f.focus(); }
  } catch (_) {}
}
// Tab trap + Escape for overlay menus. Returns true when the key was handled.
function overlayKey(e, k) {
  const o = $('#overlay');
  if (!o || o.hidden || !o.firstElementChild) return false;
  if (k === 'tab') {
    const f = [...o.querySelectorAll('button,input,select,a[href],[tabindex]:not([tabindex="-1"])')].filter(el => !el.disabled && el.offsetParent !== null);
    e.preventDefault();
    if (!f.length) return true;
    const first = f[0], last = f[f.length - 1], a = document.activeElement;
    if (!o.contains(a)) first.focus();
    else if (e.shiftKey && a === first) last.focus();
    else if (!e.shiftKey && a === last) first.focus();
    else { const i = f.indexOf(a); (f[i + (e.shiftKey ? -1 : 1)] || first).focus(); }
    return true;
  }
  if (k === 'escape' && $('#pRestartNo')) { e.preventDefault(); $('#pRestartNo').click(); return true; }
  if (k === 'escape' && $('#pRes')) { e.preventDefault(); $('#pRes').click(); return true; }
  if (k === 'escape' && $('#gBack')) { e.preventDefault(); $('#gBack').click(); return true; }
  if ((k === 'arrowdown' || k === 'arrowup') && e.target && e.target.tagName === 'BUTTON' && o.contains(e.target) && !o.querySelector('.help')) {
    const bs = [...o.querySelectorAll('button')].filter(el => !el.disabled && el.offsetParent !== null);
    const i = bs.indexOf(e.target);
    if (i >= 0 && bs.length > 1) { e.preventDefault(); bs[(i + (k === 'arrowdown' ? 1 : bs.length - 1)) % bs.length].focus(); return true; }
  }
  // let focused overlay buttons activate natively with Space/Enter
  if ((k === ' ' || k === 'enter') && e.target && e.target.tagName === 'BUTTON') return true;
  return false;
}
// ---- screen-reader announcements (dedicated live regions)
let srEls = null, srLast = { text: '', at: 0 };
const srQueue = []; let srTimer = null;
function srSay(text, kind, force) {
  if (!prefs.sr && !force) return;
  if (!text) return;
  const now = performance.now();
  if (srLast.text === text && now - srLast.at < 2000) return;
  srLast = { text, at: now };
  if (!srEls) {
    const mk = (id, role, live) => { let d = document.getElementById(id); if (!d) { d = document.createElement('div'); d.id = id; d.className = 'sr-only'; d.setAttribute('role', role); d.setAttribute('aria-live', live); d.setAttribute('aria-atomic', 'true'); document.body.appendChild(d); } return d; };
    srEls = { polite: mk('srPolite', 'status', 'polite'), assertive: mk('srAlert', 'alert', 'assertive') };
  }
  // queue so back-to-back alerts are each read instead of overwriting one another
  if (srQueue.length >= 6) { const i = srQueue.findIndex(m => m.kind !== 'warn'); srQueue.splice(i < 0 ? 0 : i, 1); }
  srQueue.push({ text, kind });
  if (!srTimer) srPump();
}
function srPump() {
  const m = srQueue.shift();
  if (!m) { srTimer = null; return; }
  const el = m.kind === 'warn' ? srEls.assertive : srEls.polite;
  el.textContent = '';
  setTimeout(() => { el.textContent = m.text; }, 60);
  srTimer = setTimeout(srPump, 1200);
}
const SR_ALERT_KEY = 'ab_sr_alerts';
function srAlertsOn() { return !!prefs.sr; }
function srSetAlerts(on) { prefs.sr = !!on; savePrefs(); }
let srState = null, srCrit = null;
setInterval(() => {
  try {
    if (!S || S.over || (scene !== 'bunker' && scene !== 'scav')) { srCrit = null; return; }
    const cur = { rid: S.rid, breached: !!S.breached, powered: !!S.powered, gen: !!(S.rooms && S.rooms.generator), starving: (S.crew || []).filter(c => !c.dead && c.food <= 0).length };
    const p = srCrit;
    srCrit = cur;
    if (!p || p.rid !== cur.rid || !srAlertsOn()) return;
    if (cur.breached && !p.breached) srSay('Alert: the hatch has been breached. Hostiles are in the shaft.', 'warn');
    else if (!cur.breached && p.breached) srSay('Hatch repaired. The breach is sealed.');
    if (cur.gen && p.gen && !cur.powered && p.powered) srSay('Alert: power is out.', 'warn');
    else if (cur.gen && p.gen && cur.powered && !p.powered) srSay('Power restored.');
    if (cur.starving > p.starving) srSay('Alert: ' + cur.starving + (cur.starving === 1 ? ' survivor is' : ' survivors are') + ' starving.', 'warn');
  } catch (_) {}
}, 1000);
setInterval(() => {
  try {
    if (!S || S.over || (scene !== 'bunker' && scene !== 'scav')) return;
    const raid = !!((S.enemies && S.enemies.length) || (S.spawns && S.spawns.length));
    const low = {}; RES.forEach(r => { low[r.k] = !!resLow(r.k); });
    const meals = kit().cooked < 2;
    const night = isNight();
    if (!srState || srState.rid !== S.rid) { srState = { rid: S.rid, raid, low, meals, night }; return; }
    if (night && !srState.night) { logEvent('warn', 'Night has fallen.'); srSay('Night has fallen. Raid expected.', 'warn'); }
    else if (!night && srState.night) { logEvent('good', 'Dawn.'); srSay('Dawn. The night is over.'); }
    if (raid && !srState.raid) { const wt = 'Wave incoming. ' + nextThreat().text; logEvent('warn', wt); srSay(wt, 'warn'); }
    else if (!raid && srState.raid) { logEvent('good', 'Wave cleared.'); srSay('Wave cleared.'); }
    RES.forEach(r => { if (low[r.k] && !srState.low[r.k]) srSay(r.name + ' is low', 'warn'); });
    if (meals && !srState.meals) srSay('Meals are low', 'warn');
    srState = { rid: S.rid, raid, low, meals, night };
  } catch (_) {}
}, 1000);
const HELP = () => `<div class="help" tabindex="0" aria-label="Controls and tips. Use the arrow keys to scroll.">
  <h3>THE LOOP</h3><ul><li>Days are for work: give the crew jobs and shifts, build, and scavenge topside.</li><li>At ${RAID_CLOCK} every night something attacks from the east. Bigger every night. Cinder comes on night 3.</li><li>Finish the four stages of the <b>signal tower</b> to win. Lose if everyone dies.</li></ul>
  <h3>THE CREW</h3><ul><li>Turrets only fire with someone on them. Good shots hit more.</li><li>Shifts decide who sleeps when. Past 16 hours awake people slow down fast. Hungry or grieving people work slower.</li><li>Meals are at 07:00, 13:00 and 19:00. Kitchen crew grow raw food and cook it into meals (1 food each) at the serving station; hungry crew fetch a meal there and eat it in the common room.</li><li>Badly hurt crew go to the med bay on their own. Doc heals them faster.</li><li>Bram, Doc and Tick share history: paired on a job they work better. Lose one and the others grieve.</li><li>Newcomers may leave in the night with your supplies if morale is low.</li></ul>
  <h3>CONTROLS</h3><ul><li><kbd>${keyLabel(BIND.left)}</kbd><kbd>${keyLabel(BIND.right)}</kbd> move · <kbd>${keyLabel(BIND.up)}</kbd><kbd>${keyLabel(BIND.down)}</kbd> climb the shaft (arrow keys always work too) · <kbd>${keyLabel(BIND.jump)}</kbd> jump · <kbd>${keyLabel(BIND.shoot)}</kbd> or click to shoot the enemy under your mouse (it locks onto anything within about 3 tiles of the cursor, shown by red brackets; no target, no shot)</li><li><kbd>${keyLabel(BIND.interact)}</kbd> interact: walk off the right edge of the surface to scavenge · search crates · invite wanderers</li><li><kbd>C</kbd> crew · <kbd>B</kbd> build · <kbd>T</kbd> tower · <kbd>G</kbd> battle stations · <kbd>H</kbd> help · <kbd>P</kbd> pause · <kbd>1</kbd>–<kbd>3</kbd> speed · click a person to select them</li><li class="touchonly"><b>Touch:</b> left pad moves and climbs (▲▼), JUMP jumps, FIRE shoots the nearest enemy Mara is facing, E interacts. Tap a person to select them. Use the top buttons for Crew, Build and Tower.</li></ul>
</div>`;
// gentle drifting ash behind the title menu; the loop ends when the canvas leaves the DOM
function ashStart() {
  const o = $('#overlay'); if (!o || o.hidden) return;
  const old = o.querySelector('canvas.ashfall'); if (old) old.remove();
  const cv = document.createElement('canvas'); cv.className = 'ashfall'; cv.setAttribute('aria-hidden', 'true');
  o.insertBefore(cv, o.firstChild);
  const g = cv.getContext('2d'); if (!g) return;
  const flakes = [];
  for (let i = 0; i < 90; i++) flakes.push({ x: Math.random(), y: Math.random(), r: 0.6 + Math.random() * 1.8, v: 0.012 + Math.random() * 0.03, sw: Math.random() * 6.28, a: 0.15 + Math.random() * 0.4 });
  let last = performance.now();
  const frame = now => {
    if (!cv.isConnected) return;
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    const w = o.clientWidth || 800, h = o.clientHeight || 600;
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    g.clearRect(0, 0, w, h);
    const still = !!prefs.rm;
    for (const f of flakes) {
      if (!still) { f.y += f.v * dt * (0.6 + f.r * 0.4); f.sw += dt * 0.6; f.x += Math.sin(f.sw) * 0.006 * dt + 0.004 * dt; if (f.y > 1.02) { f.y = -0.02; f.x = Math.random(); } if (f.x > 1.02) f.x = -0.02; }
      g.globalAlpha = f.a; g.fillStyle = f.r > 1.6 ? '#b9aa94' : '#8c8174';
      g.beginPath(); g.arc(f.x * w, f.y * h, f.r, 0, 6.2832); g.fill();
    }
    g.globalAlpha = 1;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
// ---- animated title backdrop: drifting ash + Lamp idle portrait (static under reduced motion)
let titleTok = 0, lampSheet = null;
function titleFx() {
  const bg = document.querySelector('#overlay canvas.titlefx'), pt = document.querySelector('#overlay canvas.titlelamp');
  if (!bg) return;
  const tok = ++titleTok, rm = !!prefs.rm;
  const g = bg.getContext('2d'), pg = pt ? pt.getContext('2d') : null;
  const flakes = Array.from({ length: 90 }, () => ({ x: Math.random(), y: Math.random(), r: 0.6 + Math.random() * 2.2, v: 0.012 + Math.random() * 0.035, s: Math.random() * 6.28, a: 0.15 + Math.random() * 0.45 }));
  const ruins = Array.from({ length: 28 }, (_, i) => 0.04 + 0.1 * Math.abs(Math.sin(i * 12.9898) * 43758.5453 % 1) + (i % 5 === 0 ? 0.06 : 0));
  const draw = (t, dt) => {
    const w = bg.clientWidth || 800, h = bg.clientHeight || 600;
    if (bg.width !== w || bg.height !== h) { bg.width = w; bg.height = h; }
    g.clearRect(0, 0, w, h);
    const gr = g.createLinearGradient(0, h * 0.6, 0, h); gr.addColorStop(0, 'rgba(120,50,20,0)'); gr.addColorStop(1, 'rgba(150,70,25,' + (rm ? 0.18 : 0.14 + 0.05 * Math.sin(t / 1400)) + ')');
    g.fillStyle = gr; g.fillRect(0, h * 0.6, w, h * 0.4);
    // ruined skyline silhouette
    g.fillStyle = 'rgba(8,6,5,0.85)'; g.beginPath(); g.moveTo(0, h);
    for (let i = 0; i < ruins.length; i++) { const rx = i / (ruins.length - 1) * w; g.lineTo(rx, h - ruins[i] * h); g.lineTo(rx + w / (ruins.length - 1) * 0.7, h - ruins[i] * h * 0.8); }
    g.lineTo(w, h); g.closePath(); g.fill();
    // dark vignette
    const vg = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.75); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.65)');
    g.fillStyle = vg; g.fillRect(0, 0, w, h);
    for (const f of flakes) {
      if (!rm) { f.y += f.v * dt; f.x -= f.v * 0.5 * dt + Math.sin(t / 900 + f.s) * 0.00008 * dt * 60; if (f.y > 1.02) { f.y = -0.02; f.x = Math.random() * 1.2; } if (f.x < -0.02) f.x = 1.02; }
      g.fillStyle = 'rgba(190,175,155,' + f.a + ')'; g.beginPath(); g.arc(f.x * w, f.y * h, f.r, 0, 6.283); g.fill();
    }
  };
  let frames = null, tot = 0;
  const drawLamp = t => {
    if (!pg || !lampSheet || !frames) return;
    let i = 0;
    if (!rm && tot > 0) { let m = t % tot; while (i < frames.length - 1 && m >= (frames[i].duration || 100)) { m -= frames[i].duration || 100; i++; } }
    const f = frames[i];
    pg.clearRect(0, 0, pt.width, pt.height); pg.imageSmoothingEnabled = false;
    pg.drawImage(lampSheet.img, f.x, f.y, f.w, f.h, 0, 0, pt.width, pt.height);
    pt.style.opacity = '1';
  };
  const ready = () => {
    if (tok !== titleTok) return;
    const an = lampSheet.meta.animations || {}; const a = an.idle || an[Object.keys(an)[0]];
    if (a && a.frames && a.frames.length) { frames = a.frames; tot = frames.reduce((s, f) => s + (f.duration || 100), 0); if (pt) { pt.width = frames[0].w; pt.height = frames[0].h; } }
    if (rm) drawLamp(0);
  };
  if (pg) {
    if (lampSheet) ready();
    else fetch('sprites/lamp.json').then(r => r.json()).then(meta => { const img = new Image(); img.onload = () => { lampSheet = { img, meta }; ready(); }; img.src = 'sprites/' + (meta.image || 'lamp.png'); }).catch(() => {});
  }
  if (rm) { draw(0, 0); return; }
  let last = performance.now();
  const loop = now => {
    if (tok !== titleTok || !bg.isConnected) return;
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    draw(now, dt); drawLamp(now);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
function showMenu() {
  scene = 'menu'; tutHide(); const sv = loadSave();
  overlay(`<div class="menu title" role="dialog" aria-label="Ashfall Bunker main menu"><canvas class="titlefx" aria-hidden="true"></canvas><canvas class="titlelamp" aria-hidden="true" width="128" height="160" style="opacity:0"></canvas><h1>ASHFALL<br>BUNKER</h1><p class="sub">Twenty years after the bombs. A hole in the ground, a handful of people, and a dead signal tower that might be a way out.</p>
    ${sv ? `<button class="btn" id="mContinue">Continue · Day ${Math.floor(sv.S.t / 1440) + 1}</button>` : ''}<button class="btn ${sv ? 'ghost' : ''}" id="mNew">${sv ? 'New run' : 'Start'}</button><button class="btn ghost" id="mHelp">Controls</button><button class="btn ghost" id="mSet">Settings</button>
    <p class="sub" style="font-size:12.5px">Web prototype · stage 1</p></div>`);
  $('#mNew').onclick = () => {
    overlay(`<div class='menu'><h1>CHOOSE YOUR WAY OUT</h1><p class='sub'>Pick the goal for this run. The signal tower calls for rescue. The escape vehicle drives everyone out.</p><button class='btn' id='gTower'>Signal tower</button><button class='btn' id='gVehicle'>Escape vehicle</button><button class='btn ghost' id='gBack'>Back</button></div>`);
    const go = k => { clearSave(); newRun(k); start(); tutStart(); };
    $('#gTower').onclick = () => go('tower');
    $('#gVehicle').onclick = () => go('vehicle');
    $('#gBack').onclick = () => showMenu();
  };
  $('#mHelp').onclick = () => showHelp(false);
  $('#mSet').onclick = () => showSettings('menu');
  try { titleFx(); } catch (e) {}
  try {
    const menuEl = document.querySelector('#overlay .menu.title');
    const btns = () => Array.from(menuEl.querySelectorAll('button'));
    menuEl.addEventListener('keydown', e => {
      const k = e.key, b = btns(); if (!b.length) return;
      let i = b.indexOf(document.activeElement);
      if (k === 'ArrowDown' || k === 'ArrowRight') i = (i + 1) % b.length;
      else if (k === 'ArrowUp' || k === 'ArrowLeft') i = (i - 1 + b.length) % b.length;
      else if (k === 'Home') i = 0;
      else if (k === 'End') i = b.length - 1;
      else if (k === 'Tab') i = e.shiftKey ? (i <= 0 ? b.length - 1 : i - 1) : (i + 1) % b.length;
      else return;
      e.preventDefault(); e.stopPropagation(); b[i].focus();
    });
    const fb = menuEl.querySelector('.btn'); if (fb) fb.focus();
  } catch (e) {}
  if (sv) $('#mContinue').onclick = () => { try { migrateSave(sv); } catch (e) { clearSave(); newRun(); start(); return; } S = sv.S; setGoal(S.goalKind || 'tower'); uid = 1 + S.crew.length + 1000; placePlayer('bunker'); if (sv.P) { P.x = sv.P.x; P.y = sv.P.y; P.floor = Math.max(0, FLOORS.findIndex(y => Math.abs(y - P.y) < 3)); } logs.length = 0; lamp('Welcome back, Mara. ' + summaryLine()); start(); };
}
// help dialog: keyboard navigable (Esc/H close, arrows/PgUp/PgDn/Home/End scroll, Tab trapped)
function helpKey(e, k) {
  const h = document.querySelector('#overlay .help'), b = $('#hBack');
  if (!h || !b) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (k === 'escape' || k === 'h') { e.preventDefault(); b.click(); return; }
  const page = h.clientHeight * 0.9;
  const step = { arrowdown: 48, arrowup: -48, pagedown: page, pageup: -page };
  if (k in step) { e.preventDefault(); h.scrollBy({ top: step[k] }); }
  else if (k === 'home') { e.preventDefault(); h.scrollTo({ top: 0 }); }
  else if (k === 'end') { e.preventDefault(); h.scrollTo({ top: h.scrollHeight }); }
  else if (k === 'tab') {
    const a = document.activeElement;
    if (!e.shiftKey && a === b) { e.preventDefault(); h.focus(); }
    else if (e.shiftKey && a === h) { e.preventDefault(); b.focus(); }
    else if (a !== h && a !== b) { e.preventDefault(); (e.shiftKey ? b : h).focus(); }
  }
}
const HELP_KEY = 'ab_help_seen';
let hintTimer = 0, hintCtx = '', hintIdx = 0;
function hintShown() { const h = $('#hint'); return !!h && !h.hidden; }
// hint cards are dismissed only via their own buttons (Next / Got it / X) so the sequence can be read in order
function helpSeen(ctx) { try { return localStorage.getItem(HELP_KEY + '_' + ctx) === '1'; } catch (_) { return true; } }
function hideHint() { clearTimeout(hintTimer); const h = $('#hint'); if (h) h.hidden = true; }
function markHelpSeen(ctx) { try { for (const c of (ctx ? [ctx] : ['bunker', 'top'])) localStorage.setItem(HELP_KEY + '_' + c, '1'); } catch (_) {} hideHint(); }
function showHint(ctx, idx) {
  ctx = ctx || (scene === 'scav' ? 'top' : 'bunker');
  if (helpSeen(ctx)) return;
  hintCtx = ctx; hintIdx = idx || 0;
  const h = $('#hint'), touch = document.body.classList.contains('touch');
  const bunker = touch
    ? 'Tap a person to select · use the top buttons for <b>Crew</b>, <b>Build</b>, <b>Tower</b>'
    : '<kbd>C</kbd> crew · <kbd>B</kbd> build · <kbd>T</kbd> tower · <kbd>G</kbd> battle stations · <kbd>P</kbd> pause · <kbd>1</kbd>–<kbd>3</kbd> speed · click a person to select';
  const top = touch
    ? 'Left pad moves/climbs · JUMP · FIRE · E interacts'
    : '<kbd>' + keyLabel(BIND.left) + '</kbd><kbd>' + keyLabel(BIND.right) + '</kbd> move · <kbd>' + keyLabel(BIND.up) + '</kbd><kbd>' + keyLabel(BIND.down) + '</kbd> climb · <kbd>' + keyLabel(BIND.jump) + '</kbd> jump · <kbd>' + keyLabel(BIND.shoot) + '</kbd>/click shoot · <kbd>' + keyLabel(BIND.interact) + '</kbd> interact (walk off the right edge of the surface to scavenge)';
  const build = touch
    ? 'Tap <b>Build</b>, pick a room, turret or tile, then tap the bunker to place it. Each option shows its cost in scrap and parts.'
    : 'Press <kbd>B</kbd> to open <b>Build</b>, pick a room, turret or tile, then click the bunker to place it. Each option shows its cost in scrap and parts.';
  const cards = ctx === 'top'
    ? [{ t: 'Scavenging', b: top }]
    : [{ t: 'Bunker', b: bunker }, { t: 'Build mode', b: build }];
  if (hintIdx >= cards.length) { markHelpSeen(ctx); return; }
  const card = cards[hintIdx], last = hintIdx === cards.length - 1;
  h.innerHTML = `<div class="hintbody"><div><b>${card.t} ${hintIdx + 1}/${cards.length}</b> · ${card.b}</div></div><button id="hintNext">${last ? 'Got it' : 'Next'}</button><button id="hintHelp">Full help${touch ? '' : ' (H)'}</button><button id="hintX" aria-label="Dismiss hints">✕</button>`;
  $('#hintNext').onclick = () => { if (last) markHelpSeen(ctx); else showHint(ctx, hintIdx + 1); };
  h.hidden = false;
  $('#hintX').onclick = () => markHelpSeen(ctx);
  $('#hintHelp').onclick = () => showHelp(true);
  clearTimeout(hintTimer);
}
const HELP_COMBAT = `<div class="help" tabindex="0" aria-label="Combat guide. Use the arrow keys to scroll.">
  <h3>DAMAGE TYPES</h3><ul>
    <li><b>Pierce</b>: rifles, pistols, SMGs, machetes and the rifle turret. Great against soft targets, weak against armor.</li>
    <li><b>Blunt</b>: shotguns, the shotgun turret and pipe clubs. Hits armored bruisers hard and can stun for a moment.</li>
    <li><b>Shock</b>: the slow-field coil zaps the nearest enemy every few seconds and stuns it briefly. Rigs and Cinder take extra.</li>
    <li><b>Bleed</b>: damage over time from rifle crits and machete cuts. Fleshy enemies suffer, tough ones barely notice.</li>
  </ul>
  <h3>WHO TAKES WHAT</h3><ul>
    <li><b>Mutant hound</b>: weak to blunt (+15%).</li>
    <li><b>Ash ghoul</b>: resists bleed (40% less).</li>
    <li><b>Burrower</b>: weak to blunt (+20%).</li>
    <li><b>Brute</b>: resists pierce (45% less), weak to blunt (+25%). Bring shotguns.</li>
    <li><b>Pike's ram rig</b>: resists pierce (60% less) and a little blunt, weak to shock (+30%).</li>
    <li><b>Cinder</b>: resists pierce (20% less) and bleed (50% less), weak to shock (+30%).</li>
    <li><b>The Maw</b>: resists pierce (30% less) and bleed (70% less).</li>
    <li><b>Raider</b>: no resistances, but it may break and run when it drops below a quarter health. Raiders shoot turrets from range, so keep the wall up.</li>
  </ul>
  <h3>CRITS AND STATUS</h3><ul>
    <li>Good shots sometimes crit for 80% extra damage. A rifle crit also makes the target bleed.</li>
    <li>Stunned enemies stop and cannot attack until it wears off.</li>
  </ul>
  <h3>TURRETS</h3><ul>
    <li>Turrets hold a magazine. An empty one reloads for 1 scrap. Firing builds heat: at 100% it locks up until it cools.</li>
    <li>Open Build, Defenses to set each turret's target: nearest, strongest, weakest or ranged first.</li>
    <li>Worn turrets fire slower and can jam. Keep someone on the Workshop job.</li>
  </ul>
  <h3>CREW AND ARMS</h3><ul>
    <li>Guards fight with what they hold: a rifle reaches far, an SMG sprays, a shotgun is deadly up close, a machete or pipe is melee.</li>
    <li>Guards at the hatch or turrets on the surface take 20% less damage from cover.</li>
    <li>Research Hardened barrels (+15% damage) and Armor-piercing rounds (halves resistance to pierce) in the Research tab.</li>
  </ul>
</div>`;
// small illustrations for each tutorial section (inline SVG, game palette)
const HELP_PICS = (() => {
  const A = '#ffb347', R = '#ff5a4e', G = '#7ddc6f', B = '#7fc8ff', M = '#b8a78a', D = '#2d2215', W = '#f1e6d2';
  const wrap = body => `<svg class="hpic" viewBox="0 0 300 60" role="img" aria-hidden="true" style="display:block;width:100%;height:auto;margin:6px 0 8px;background:#1b140c;border:1px solid #3a2c18">${body}</svg>`;
  const person = (x, c) => `<circle cx="${x}" cy="26" r="6" fill="${W}"/><rect x="${x - 7}" y="33" width="14" height="18" fill="${c}"/>`;
  const key = (x, t) => `<rect x="${x}" y="20" width="26" height="26" fill="${D}" stroke="${A}"/><text x="${x + 13}" y="38" font-size="13" font-weight="700" text-anchor="middle" fill="${A}" font-family="sans-serif">${t}</text>`;
  return {
    'THE LOOP': wrap(`<circle cx="40" cy="30" r="12" fill="${A}"/><path d="M62 30h46" stroke="${M}" stroke-dasharray="4 3"/><rect x="120" y="28" width="60" height="24" fill="#4a3a22"/><rect x="128" y="20" width="16" height="8" fill="${M}"/><rect x="150" y="36" width="8" height="16" fill="${A}"/><path d="M192 30h30" stroke="${M}" stroke-dasharray="4 3"/><circle cx="262" cy="26" r="11" fill="#cfd6e6"/><circle cx="268" cy="23" r="10" fill="#1b140c"/><path d="M232 52l8-14 8 14z" fill="${R}"/><path d="M252 52l8-14 8 14z" fill="${R}"/>`),
    'THE CREW': wrap(`${person(60, A)}${person(110, G)}${person(160, B)}${person(210, R)}<rect x="52" y="8" width="16" height="10" fill="${D}" stroke="${A}"/><rect x="102" y="8" width="16" height="10" fill="${D}" stroke="${G}"/><rect x="152" y="8" width="16" height="10" fill="${D}" stroke="${B}"/><rect x="202" y="8" width="16" height="10" fill="${D}" stroke="${R}"/>`),
    'CONTROLS': wrap(`${key(30, 'A')}${key(60, 'D')}${key(100, 'W')}${key(130, 'S')}<rect x="190" y="12" width="26" height="38" rx="13" fill="${D}" stroke="${A}"/><path d="M203 12v16M190 28h26" stroke="${A}"/><rect x="190" y="12" width="13" height="16" fill="${A}" opacity=".6"/><rect x="236" y="22" width="44" height="22" fill="${D}" stroke="${A}"/>`),
    'DAMAGE TYPES': wrap(`<g transform="translate(16 0)"><path d="M20 30h50" stroke="${M}" stroke-width="3"/><path d="M70 30l-10-7v14z" fill="${A}"/><text x="40" y="54" font-size="9" fill="${M}" text-anchor="middle" font-family="sans-serif">PIERCE</text></g><g transform="translate(94 0)"><rect x="14" y="14" width="30" height="16" fill="${M}"/><rect x="26" y="28" width="6" height="16" fill="#7a6650"/><text x="29" y="54" font-size="9" fill="${M}" text-anchor="middle" font-family="sans-serif">BLUNT</text></g><g transform="translate(164 0)"><path d="M34 8l-14 22h10l-6 18 18-24h-10l8-16z" fill="${B}"/><text x="29" y="56" font-size="9" fill="${M}" text-anchor="middle" font-family="sans-serif">SHOCK</text></g><g transform="translate(228 0)"><path d="M30 10c8 12 12 18 12 24a12 12 0 0 1-24 0c0-6 4-12 12-24z" fill="${R}"/><text x="30" y="56" font-size="9" fill="${M}" text-anchor="middle" font-family="sans-serif">BLEED</text></g>`),
    'WHO TAKES WHAT': wrap(`<ellipse cx="46" cy="42" rx="20" ry="9" fill="#9b6a4a"/><rect x="28" y="44" width="4" height="8" fill="#9b6a4a"/><rect x="58" y="44" width="4" height="8" fill="#9b6a4a"/><rect x="104" y="14" width="26" height="38" fill="#6d5a7a"/><circle cx="117" cy="11" r="7" fill="#6d5a7a"/><rect x="176" y="22" width="14" height="30" fill="#b0553a"/><circle cx="183" cy="18" r="6" fill="#b0553a"/><rect x="190" y="28" width="14" height="3" fill="${M}"/><rect x="236" y="24" width="46" height="22" fill="#6a4a3a"/><circle cx="246" cy="48" r="6" fill="${D}" stroke="${M}"/><circle cx="272" cy="48" r="6" fill="${D}" stroke="${M}"/>`),
    'CRITS AND STATUS': wrap(`<path d="M70 8l6 16 16-6-8 14 16 6-17 3 3 17-12-12-12 12 3-17-17-3 16-6-8-14 16 6z" fill="${A}"/><text x="70" y="36" font-size="11" font-weight="700" fill="#1a0f02" text-anchor="middle" font-family="sans-serif">x1.8</text><path d="M150 12c6 10 9 15 9 20a9 9 0 0 1-18 0c0-5 3-10 9-20z" fill="${R}"/><path d="M180 20c4 7 6 10 6 14a6 6 0 0 1-12 0c0-4 2-7 6-14z" fill="${R}" opacity=".6"/><circle cx="250" cy="34" r="9" fill="#b0553a"/><g fill="${A}"><circle cx="236" cy="14" r="2.5"/><circle cx="250" cy="10" r="2.5"/><circle cx="264" cy="14" r="2.5"/></g>`),
    'TURRETS': wrap(`<rect x="30" y="40" width="44" height="12" fill="#4a3a22"/><rect x="40" y="30" width="24" height="12" fill="${M}"/><rect x="62" y="33" width="36" height="5" fill="${W}"/><g fill="${A}"><rect x="130" y="12" width="8" height="14"/><rect x="142" y="12" width="8" height="14"/><rect x="154" y="12" width="8" height="14"/><rect x="166" y="12" width="8" height="14"/></g><rect x="178" y="12" width="8" height="14" fill="${D}" stroke="${A}"/><rect x="130" y="36" width="100" height="8" fill="${D}"/><rect x="130" y="36" width="64" height="8" fill="#ff8c2a"/><text x="232" y="43" font-size="9" fill="${M}" font-family="sans-serif"> HEAT</text><path d="M262 14l12 8-12 8z" fill="${B}"/>`),
    'CREW AND ARMS': wrap(`<rect x="20" y="26" width="26" height="8" fill="${M}"/><rect x="20" y="32" width="8" height="14" fill="#7a6650"/><rect x="66" y="28" width="64" height="6" fill="${M}"/><rect x="66" y="32" width="20" height="12" fill="#7a6650"/><rect x="150" y="26" width="42" height="7" fill="${M}"/><rect x="150" y="31" width="16" height="13" fill="#7a6650"/><rect x="150" y="36" width="42" height="5" fill="${M}"/><rect x="214" y="14" width="6" height="38" transform="rotate(30 217 33)" fill="${M}"/><circle cx="262" cy="32" r="14" fill="${D}" stroke="${G}" stroke-width="2"/><path d="M255 32l5 5 9-10" stroke="${G}" stroke-width="2.5" fill="none"/>`),
  };
})();
const withPics = html => html.replace(/<h3>([^<]+)<\/h3>/g, (m, k) => { let a = ''; try { a = typeof helpArt === 'function' ? helpArt(k) : ''; } catch (e) { a = ''; } return m + (a || HELP_PICS[k] || ''); });
function helpTabs(sel) { return `<div class="row" role="tablist" style="justify-content:center;margin-bottom:8px"><button class="chip ${sel === 'basics' ? 'on' : ''}" role="tab" data-htab="basics">Basics</button><button class="chip ${sel === 'combat' ? 'on' : ''}" role="tab" data-htab="combat">Combat</button></div>`; }
function showHelp(inGame, from) {
  if (document.querySelector('#overlay .help')) return;
  if (!from && $('#pRes')) from = 'pause';
  const was = paused;
  if (inGame) { paused = true; clearInput(); }
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  markHelpSeen();
  overlay(`<div class="menu" role="dialog" aria-modal="true" aria-labelledby="hTitle" style="width:640px"><h1 id="hTitle" style="font-size:36px">HOW TO PLAY</h1><div id="hTabs">${helpTabs('basics')}</div>${withPics(HELP())}<button class="btn" id="hBack">${inGame ? 'Back to the bunker' : 'Back'}</button></div>`);
  $('#hBack').onclick = () => {
    if (from === 'pause') showPauseMenu();
    else if (inGame) { overlay(''); paused = was; renderHud(); }
    else showMenu();
  };
  $('#hTabs').addEventListener('click', e => {
    const b = e.target.closest('[data-htab]'); if (!b) return;
    const k = b.dataset.htab, cur = document.querySelector('#overlay .help'); if (!cur) return;
    cur.outerHTML = withPics(k === 'combat' ? HELP_COMBAT : HELP());
    $('#hTabs').innerHTML = helpTabs(k);
    const hp2 = document.querySelector('#overlay .help'); if (hp2) hp2.focus();
  });
  const hp = document.querySelector('#overlay .help'); if (hp) hp.focus();
}
const KEYBINDS = [
  ['Click', 'Shoot (also your shoot key)'], ['C', 'Crew panel'], ['B', 'Build panel'], ['T', 'Signal tower panel'],
  ['R', 'Relationships panel'], ['G', 'Battle stations'], ['M', 'Mute / unmute all sound'], ['H', 'How to play'],
  ['V', 'Crew debug overlay'], ['P', 'Pause'], ['1 / 2 / 3', 'Game speed'], ['[ / ]', 'Select previous / next survivor'], ['Esc', 'Close panel / pause menu']
];
const TEXT_SIZES = [['normal', '100%', 1], ['large', '125%', 1.25], ['xlarge', '150%', 1.5]];
function getTextSize() { try { const v = localStorage.getItem('ashfall.textsize'); if (TEXT_SIZES.some(t => t[0] === v)) return v; } catch (_) {} return 'normal'; }
function applyTextSize(k) {
  const t = TEXT_SIZES.find(x => x[0] === k) || TEXT_SIZES[1];
  document.documentElement.style.setProperty('--ts', String(t[2]));
  CANVAS_TS = t[2];
}
function setTextSize(k) {
  const t = TEXT_SIZES.find(x => x[0] === k) || TEXT_SIZES[0];
  try { localStorage.setItem('ashfall.textsize', t[0]); localStorage.setItem('ashfall.textscale', String(t[2])); } catch (_) {}
  applyTextSize(t[0]);
}
function getTextScale() {
  try { const n = parseFloat(localStorage.getItem('ashfall.textscale')); if (n >= 0.85 && n <= 1.6) return n; } catch (_) {}
  const t = TEXT_SIZES.find(x => x[0] === getTextSize());
  return t ? t[2] : 1;
}
function applyTextScale(n) {
  document.documentElement.style.setProperty('--ts', String(n));
  CANVAS_TS = n;
}
function setTextScale(n) { try { localStorage.setItem('ashfall.textscale', String(n)); } catch (_) {} applyTextScale(n); }
applyTextScale(getTextScale());
function showSettings(from) {
  const vols = [['master', 'Master'], ['music', 'Music'], ['amb', 'Ambience'], ['narr', 'Narrator'], ['fx', 'Effects'], ['ui', 'Interface']];
  const get = n => (window.SFX && SFX.getVol) ? SFX.getVol(n) : 1;
  const rows = vols.map(([k, label]) => { const v = Math.round(get(k) * 100); return `<label class="srow"><span>${label}</span><input type="range" min="0" max="100" step="1" value="${v}" data-vol="${k}" aria-label="${label} volume"><b>${v}%</b></label>`; }).join('');
  const keys = KEYBINDS.map(([a, b]) => `<dt><kbd>${a}</kbd></dt><dd>${b}</dd>`).join('');
  const bindRows = BIND_LABELS.map(([a, label]) => `<div class="srow"><span>${label}</span><button class="btn ghost" data-bind="${a}" style="min-width:110px" aria-label="Rebind ${label}">${keyLabel(BIND[a])}</button></div>`).join('') + '<button class="btn ghost" id="sBindReset" style="min-width:0">Reset keys</button>';
  const curTs = getTextSize();
  const tmBtns = '<div class="tsrow">' + TOUCH_MODES.map(([k, label]) => `<button class="btn ghost" data-touch="${k}" aria-pressed="${k === touchMode}">${label}</button>`).join('') + '</div>';
  const curPct = Math.round(getTextScale() * 100);
  const tsBtns = `<label class="srow"><span>Text scale</span><input type="range" id="sTs" min="85" max="160" step="5" value="${curPct}" aria-label="UI text size" aria-valuetext="${curPct} percent"><b>${curPct}%</b></label><button class="btn ghost" id="sTsReset" style="min-width:0">Reset text size</button>`;
  const muted = !!(window.SFX && SFX.muted);
  overlay(`<div class="menu" role="dialog" aria-modal="true" aria-labelledby="sTitle" style="width:640px"><h1 id="sTitle" style="font-size:36px">SETTINGS</h1><div class="setp"><h3>VOLUME</h3>${rows}<button class="btn ghost" id="sMute" style="min-width:0">${muted ? 'Sound: off' : 'Sound: on'}</button><button class="btn ghost" id="sNarrMute" style="min-width:0" aria-pressed="${!!(window.SFX && SFX.narrMuted && SFX.narrMuted())}">${(window.SFX && SFX.narrMuted && SFX.narrMuted()) ? 'Narrator: muted' : 'Narrator: on'}</button><button class="btn ghost" id="sVolReset" style="min-width:0">Reset audio</button><h3>DISPLAY</h3><div class="tsrow"><button class="btn ghost" data-pref="cb" aria-pressed="false">Colorblind: off</button><button class="btn ghost" data-pref="hc" aria-pressed="false">High contrast: off</button><button class="btn ghost" id="sCap" aria-pressed="${window.narrCaptionsOn ? narrCaptionsOn() : true}">Captions: ${(window.narrCaptionsOn ? narrCaptionsOn() : true) ? 'on' : 'off'}</button></div><h3>FLASH &amp; SHAKE</h3><label class="srow"><span>Effects intensity</span><input type="range" min="0" max="100" step="5" value="${Math.round(prefs.fx * 100)}" id="sFx" aria-label="Screen shake and flash intensity"><b>${Math.round(prefs.fx * 100)}%</b></label><div class="tsrow"><button class="btn ghost" id="sPs" aria-pressed="${prefs.ps}">Photosensitive-safe: ${prefs.ps ? 'on' : 'off'}</button><button class="btn ghost" id="sTips" aria-pressed="${!tutDone()}">Tutorial hints: ${tutDone() ? 'off' : 'on'}</button></div><h3>SCREEN READER</h3><div class="tsrow"><button class="btn ghost" id="sSrAlert" aria-pressed="${srAlertsOn()}">Critical alerts: ${srAlertsOn() ? 'on' : 'off'}</button></div><h3>HELP</h3><div class="tsrow"><button class="btn ghost" id="sReplay">Replay tips</button></div><label class=\"srow\" style=\"cursor:pointer\"><input type=\"checkbox\" id=\"sRm\" ${prefs.rm ? 'checked' : ''}><span>Reduced motion (no screen shake, still ash and bobbing)</span></label><h3>TEXT SIZE</h3>${tsBtns}<h3>TOUCH CONTROLS</h3>${tmBtns}<h3>MOVEMENT &amp; ACTION KEYS</h3><div class="binds">${bindRows}</div><div id="bindNote" role="status" aria-live="polite" style="min-height:1.4em;margin-top:6px;color:#e8b84a">${bindNote}</div><h3>OTHER KEYS</h3><dl class="keys">${keys}</dl></div><button class="btn" id="sBack">Back</button></div>`);
  document.querySelectorAll('#overlay input[data-vol]').forEach(inp => {
    const out = inp.parentNode.querySelector('b');
    inp.oninput = () => { if (window.SFX && SFX.setVol) SFX.setVol(inp.dataset.vol, inp.value / 100); out.textContent = inp.value + '%'; };
    inp.onchange = () => { if (inp.dataset.vol === 'fx' && window.SFX && SFX.preview) SFX.preview(); };
  });
  addChMutes();
  $('#sMute').onclick = e => { if (window.SFX) SFX.toggleMute(); e.currentTarget.textContent = (window.SFX && SFX.muted) ? 'Sound: off' : 'Sound: on'; };
  $('#sNarrMute').onclick = e => { const m = window.SFX && SFX.toggleNarrMute ? SFX.toggleNarrMute() : false; e.currentTarget.textContent = m ? 'Narrator: muted' : 'Narrator: on'; e.currentTarget.setAttribute('aria-pressed', String(!!m)); };
  document.querySelectorAll('#overlay button[data-bind]').forEach(b => {
    b.onclick = () => startRebind(b.dataset.bind, b, () => showSettings(from));
  });
  bindNote = '';
  $('#sVolReset').onclick = () => { if (window.SFX && SFX.resetVol) SFX.resetVol(); showSettings(from); };
  $('#sBindReset').onclick = () => { Object.assign(BIND, BIND_DEF); saveBinds(); bindNote = 'Keys reset to defaults.'; showSettings(from); };
  $('#sBack').onclick = () => { if (from === 'pause') showPauseMenu(); else showMenu(); };
  { const ts = $('#sTs'); if (ts) {
    const out = ts.parentNode.querySelector('b');
    ts.oninput = () => { out.textContent = ts.value + '%'; ts.setAttribute('aria-valuetext', ts.value + ' percent'); setTextScale(ts.value / 100); };
    ts.onchange = () => { setTextScale(ts.value / 100); try { srSay('Text size ' + ts.value + ' percent', '', true); } catch (err) {} };
  } }
  { const r = $('#sTsReset'); if (r) r.onclick = () => { setTextScale(1); try { srSay('Text size reset to 100 percent', '', true); } catch (err) {} showSettings(from); }; }
  const fxIn = $('#sFx');
  if (fxIn) {
    const fxOut = fxIn.parentNode.querySelector('b');
    fxIn.oninput = () => { prefs.fx = fxIn.value / 100; fxOut.textContent = fxIn.value + '%'; };
    fxIn.onchange = () => { prefs.fx = fxIn.value / 100; savePrefs(); };
  }
  const psBtn = $('#sPs');
  if (psBtn) psBtn.onclick = () => {
    prefs.ps = !prefs.ps; if (prefs.ps) shakeT = 0; savePrefs();
    psBtn.textContent = 'Photosensitive-safe: ' + (prefs.ps ? 'on' : 'off');
    psBtn.setAttribute('aria-pressed', String(prefs.ps));
  };
  const srBtn = $('#sSrAlert');
  if (srBtn) srBtn.onclick = () => {
    const on = !srAlertsOn();
    srSetAlerts(on);
    srBtn.textContent = 'Critical alerts: ' + (on ? 'on' : 'off');
    srBtn.setAttribute('aria-pressed', String(on));
  };
  const replayBtn = $('#sReplay');
  if (replayBtn) replayBtn.onclick = () => {
    try { for (const c of ['bunker', 'top']) localStorage.removeItem(HELP_KEY + '_' + c); localStorage.removeItem(TUT_KEY); } catch (_) {}
    replayBtn.textContent = 'Tips will show on the next run';
    replayBtn.disabled = true;
  };
  document.querySelectorAll('#overlay button[data-touch]').forEach(b => {
    b.onclick = () => { setTouchMode(b.dataset.touch); showSettings(from); };
  });
  const capBtn = $('#sCap');
  if (capBtn) capBtn.onclick = () => {
    const on = !(window.narrCaptionsOn ? narrCaptionsOn() : true);
    if (window.narrSetCaptions) narrSetCaptions(on);
    capBtn.textContent = 'Captions: ' + (on ? 'on' : 'off');
    capBtn.setAttribute('aria-pressed', String(on));
  };
  const tipsBtn = $('#sTips');
  if (tipsBtn) tipsBtn.onclick = () => {
    const on = tutDone();   // currently off -> turn on
    try {
      if (on) { localStorage.removeItem(TUT_KEY); for (const c of ['bunker', 'top']) localStorage.removeItem(HELP_KEY + '_' + c); }
      else { localStorage.setItem(TUT_KEY, '1'); for (const c of ['bunker', 'top']) localStorage.setItem(HELP_KEY + '_' + c, '1'); tutHide(); hideHint(); }
    } catch (_) {}
    tipsBtn.textContent = 'Tutorial hints: ' + (on ? 'on' : 'off');
    tipsBtn.setAttribute('aria-pressed', String(on));
  };
  document.querySelectorAll('#overlay button[data-pref]').forEach(b => {
    b.onclick = () => {
      const k = b.dataset.pref;
      prefs[k] = !prefs[k];
      savePrefs();
      try { lamp((k === 'hc' ? 'High contrast' : 'Colorblind') + ' mode ' + (prefs[k] ? 'on' : 'off')); } catch (err) {}
      try { srSay((k === 'hc' ? 'High contrast' : 'Colorblind') + ' mode ' + (prefs[k] ? 'on' : 'off'), '', true); } catch (err) {}
    };
  });
  applyPrefs();
  const rmBox = $('#sRm');
  if (rmBox) rmBox.onchange = () => { prefs.rm = rmBox.checked; savePrefs(); try { lamp('Reduced motion mode ' + (prefs.rm ? 'on' : 'off')); } catch (err) {} };
  $('#sBack').focus();
}
function pauseVolHtml() {
  const rows = [['master', 'Master'], ['music', 'Music'], ['amb', 'Ambience'], ['narr', 'Narrator'], ['fx', 'Effects'], ['ui', 'Interface']].map(([k, label]) => { const v = Math.round(((window.SFX && SFX.getVol) ? SFX.getVol(k) : 1) * 100); return `<label class="srow"><span>${label}</span><input type="range" min="0" max="100" step="1" value="${v}" data-vol="${k}" aria-label="${label} volume"><b>${v}%</b></label>`; }).join('');
  const nm = (window.SFX && SFX.narrMuted && SFX.narrMuted());
  return `<div class="setp" style="margin:10px 0"><h3>VOLUME</h3>${rows}<button class="btn ghost" id="pNarrMute" style="min-width:0">${nm ? 'Narrator: off' : 'Narrator: on'}</button></div>`;
}
function addChMutes() {
  if (!(window.SFX && SFX.setChMute)) return;
  document.querySelectorAll('#overlay input[data-vol]').forEach(inp => {
    if (inp.parentNode.querySelector('.chm')) return;
    const k = inp.dataset.vol, nm = inp.getAttribute('aria-label').replace(' volume', '');
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn ghost chm';
    b.style.cssText = 'min-width:0;padding:2px 8px;font-size:12px;margin-left:6px';
    const paint = () => { const m = SFX.getChMute(k); b.textContent = m ? 'Muted' : 'Mute'; b.setAttribute('aria-pressed', String(m)); b.setAttribute('aria-label', 'Mute ' + nm); inp.style.opacity = m ? '0.45' : ''; };
    b.onclick = e => { e.preventDefault(); SFX.setChMute(k, !SFX.getChMute(k)); paint(); };
    paint();
    inp.parentNode.appendChild(b);
  });
}
function bindPauseVol() {
  const pnm = document.getElementById('pNarrMute');
  if (pnm) pnm.onclick = e => { if (window.SFX && SFX.toggleNarrMute) SFX.toggleNarrMute(); e.currentTarget.textContent = (window.SFX && SFX.narrMuted && SFX.narrMuted()) ? 'Narrator: off' : 'Narrator: on'; };
  addChMutes();
  document.querySelectorAll('#overlay input[data-vol]').forEach(inp => {
    const out = inp.parentNode.querySelector('b');
    inp.oninput = () => { if (window.SFX && SFX.setVol) SFX.setVol(inp.dataset.vol, inp.value / 100); out.textContent = inp.value + '%'; };
    inp.onchange = () => { if (inp.dataset.vol === 'fx' && window.SFX && SFX.preview) SFX.preview(); };
  });
}
let pauseOpener = null;
function pauseDisplayHtml() {
  const curScale = getTextScale();
  const sizes = TEXT_SIZES.map(([k, label, sc]) => `<button class="btn ghost" data-ts="${k}" aria-pressed="${Math.abs(curScale - sc) < 0.01}">${label}</button>`).join('');
  return `<div class="setp" style="margin:10px 0"><h3>DISPLAY</h3><div class="tsrow"><button class="btn ghost" data-pref="hc" aria-pressed="${!!prefs.hc}">High contrast: ${prefs.hc ? 'on' : 'off'}</button></div><h3>TEXT SIZE</h3><div class="tsrow">${sizes}</div></div>`;
}
function bindPauseDisplay() {
  document.querySelectorAll('#overlay button[data-ts]').forEach(b => {
    b.onclick = () => { setTextSize(b.dataset.ts); showPauseMenu(); };
  });
  document.querySelectorAll('#overlay button[data-pref="hc"]').forEach(b => {
    b.onclick = () => { prefs.hc = !prefs.hc; savePrefs(); applyPrefs(); };
  });
}
function showPauseMenu() {
  if (!pauseOpener && document.activeElement && document.activeElement !== document.body && $('#overlay').hidden) pauseOpener = document.activeElement;
  paused = true; renderHud();
  overlay(`<div class="menu"><h1 style="font-size:40px">PAUSED</h1>${pauseVolHtml()}${pauseDisplayHtml()}<button class="btn" id="pRes">Resume</button><button class="btn ghost" id="pHelp">How to play</button><button class="btn ghost" id="pSet">Settings</button><button class="btn ghost" id="pRestart">Restart run</button><button class="btn ghost" id="pMenu">Save and quit to menu</button></div>`);
  bindPauseVol();
  bindPauseDisplay();
  $('#pRes').onclick = () => { overlay(''); paused = false; renderHud(); const o = pauseOpener; pauseOpener = null; try { if (o && o.focus && document.body.contains(o)) o.focus(); } catch (_) {} };
  $('#pRestart').onclick = () => {
    overlay(`<div class="menu"><h1 style="font-size:34px">RESTART RUN?</h1><p class="sub">This abandons the current run and its save. Everyone in the bunker is lost.</p><button class="btn" id="pRestartNo">Keep playing</button><button class="btn ghost" id="pRestartYes">Restart run</button></div>`);
    $('#pRestartNo').onclick = () => showPauseMenu();
    $('#pRestartYes').onclick = () => { pauseOpener = null; const g = (typeof GOAL_KIND !== 'undefined' && GOAL_KIND) || 'tower'; clearSave(); newRun(g); start(); tutStart(); };
  };
  $('#pHelp').onclick = () => showHelp(true);
  $('#pSet').onclick = () => showSettings('pause');
  try { $('#pRes').focus(); } catch (_) {}
  $('#pMenu').onclick = () => { save(); showMenu(); };
}
// ---- first-run guided tutorial (skippable, remembered in localStorage)
const TUT_KEY = 'ab_tut_done';
let tut = null;
function tutDone() { try { return localStorage.getItem(TUT_KEY) === '1'; } catch (_) { return true; } }
function tutHl(ids) {
  for (const id of ['tCrew', 'tBuild', 'tAlarm']) { const b = document.getElementById(id); if (b) { b.style.outline = ids.includes(id) ? '2px solid #ffd59a' : ''; b.style.outlineOffset = ids.includes(id) ? '2px' : ''; } }
}
function tutHide() { const el = document.getElementById('tut'); if (el) el.remove(); tut = null; tutHl([]); }
function tutFinish(msg) { try { localStorage.setItem(TUT_KEY, '1'); } catch (_) {} tutHide(); if (msg && S && !S.over) lamp(msg, 'good'); }
// ---- first-run tooltip tour (HUD, roster, build, hatch); runs before the task tutorial
const TOUR_KEY = 'ab_tour_done';
let tour = null;
function tourDone() { try { return localStorage.getItem(TOUR_KEY) === '1'; } catch (_) { return true; } }
function tourSteps() {
  const touch = document.body.classList.contains('touch');
  return [
    { el: 'hud', text: '<b>HUD</b> · Resources, the clock and the next raid live up here. Watch the numbers: scarcity is the enemy.' },
    { el: 'tCrew', text: '<b>Roster</b> · ' + (touch ? 'Tap Crew' : 'Press <kbd>C</kbd>') + ' to open your survivors. Assign jobs, check needs and click someone to focus the camera.' },
    { el: 'tBuild', text: '<b>Build mode</b> · ' + (touch ? 'Tap Build' : 'Press <kbd>B</kbd>') + ' to place turrets, rooms and repairs with scrap and parts.' },
    { hatch: true, text: '<b>The hatch</b> · Everything out there wants in through this door. Hold it. If it breaks, the bunker follows.' }
  ];
}
function tourEsc(e) { if (tour && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); tourFinish(); } }
function tourHide() {
  const a = document.getElementById('tour'), b = document.getElementById('tourRing');
  if (a) a.remove(); if (b) b.remove();
  window.removeEventListener('keydown', tourEsc, true);
  tour = null; tutHl([]);
  for (const id of ['hud']) { const e = document.getElementById(id); if (e) e.style.outline = ''; }
}
function tourFinish() { try { localStorage.setItem(TOUR_KEY, '1'); } catch (_) {} tourHide(); }
function tourShow() {
  if (!tour) return;
  const steps = tourSteps();
  if (tour.i >= steps.length) { tourFinish(); return; }
  const st = steps[tour.i];
  tutHl([st.el === 'hud' ? '' : st.el]);
  const hudEl = document.getElementById('hud'); if (hudEl) { hudEl.style.outline = st.el === 'hud' ? '2px solid #ffd59a' : ''; hudEl.style.outlineOffset = '2px'; }
  let r = null, ring = document.getElementById('tourRing');
  if (st.hatch) {
    const cv = document.getElementById('c'), cr = cv.getBoundingClientRect(), v = bcamView();
    const px = cr.left + (DOOR_X - v.ox) * v.z * cr.width / W, py = cr.top + ((FLOORS[0] - 20) - v.oy) * v.z * cr.height / H;
    r = { left: px - 30, right: px + 30, top: py - 30, bottom: py + 30, width: 60, height: 60 };
    if (!ring) { ring = document.createElement('div'); ring.id = 'tourRing'; document.body.appendChild(ring); }
    ring.style.cssText = 'position:fixed;pointer-events:none;z-index:59;border:2px solid #ffd59a;border-radius:50%;left:' + r.left + 'px;top:' + r.top + 'px;width:60px;height:60px';
  } else {
    if (ring) ring.remove();
    const t = document.getElementById(st.el); r = t ? t.getBoundingClientRect() : { left: 20, right: 60, top: 40, bottom: 80, width: 40, height: 40 };
  }
  let el = document.getElementById('tour');
  if (!el) { el = document.createElement('div'); el.id = 'tour'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.style.cssText = 'position:fixed;z-index:60;width:min(300px,calc(100vw - 24px));box-sizing:border-box;background:#241a10;border:1px solid #c9a27a;border-radius:8px;padding:10px 12px;font-size:14px;line-height:1.4;color:#f3e6d0;box-shadow:0 4px 16px rgba(0,0,0,.6)';
  el.innerHTML = '<div>' + st.text + '</div><div style="display:flex;gap:8px;align-items:center;margin-top:8px"><span style="flex:1;opacity:.7;font-size:12px">' + (tour.i + 1) + ' / ' + steps.length + '</span><button id="tourSkip" style="background:none;border:1px solid #6b5a44;border-radius:5px;padding:3px 8px;color:inherit;cursor:pointer">Skip tour</button><button id="tourNext" style="background:#c9a27a;border:1px solid #c9a27a;border-radius:5px;padding:3px 10px;color:#241a10;cursor:pointer">' + (tour.i === steps.length - 1 ? 'Done' : 'Next') + '</button></div>';
  const bw = Math.min(300, window.innerWidth - 24), bh = el.offsetHeight || 100;
  let top = r.bottom + 12; if (top + bh > window.innerHeight - 8) top = Math.max(8, r.top - bh - 12);
  const left = Math.max(12, Math.min(window.innerWidth - bw - 12, r.left));
  el.style.top = top + 'px'; el.style.left = left + 'px';
  $('#tourSkip').onclick = () => tourFinish();
  $('#tourNext').onclick = () => { tour.i++; tourShow(); };
  $('#tourNext').focus();
}
function tourStart() {
  tourHide();
  if (tourDone()) return;
  tour = { i: 0 };
  window.addEventListener('keydown', tourEsc, true);
  tourShow();
}
function tutStart() {
  tutHide();
  tourHide();
  if (!S) return;
  if (tutDone()) { tourStart(); return; }
  tut = { rid: S.rid, step: -1, job: false };
  tourStart();
}
function tutSteps() {
  const touch = document.body.classList.contains('touch');
  return [
    { hl: ['tCrew'], text: 'Step 1/5 · ' + (touch ? 'Tap <b>Crew</b>' : 'Press <kbd>C</kbd> (Crew)') + ' and tap a job chip to assign someone. Turrets only fire with a gunner on them.', done: () => !!tut.job || living().some(c => (c.job === 'turretA' || c.job === 'turretB') && turretFor(c.job) && turretFor(c.job).type !== 'coil') },
    { hl: ['tBuild'], text: 'Step 2/5 · ' + (touch ? 'Tap <b>Build</b>' : 'Press <kbd>B</kbd> (Build)') + ' and build a second turret. It needs scrap and parts, so scavenge topside if you are short.', done: () => !!S.turrets[1] },
    { hl: ['tCrew'], text: 'Step 3/5 · Open <b>Crew</b> and put someone on the new turret (the Turret 2 job chip). An empty turret does not fire.', done: () => !S.turrets[1] || S.turrets[1].type === 'coil' || S.crew.some(c => c.alive && c.job === 'turretB') },
    { hl: ['tAlarm'], text: 'Step 4/5 · A raid hits at ' + RAID_CLOCK + ' from the east. ' + (touch ? 'Use the battle stations button' : 'Press <kbd>G</kbd> for battle stations') + ' when it starts to wake everyone and man the turrets.', done: () => !!S.raidActive || S.stats.raids > 0 },
    { hl: [], text: 'Step 5/5 · Watch the first raid. Stay near the door and repair it from Build if it gets low.', done: () => (S.stats.repelled || 0) > 0 }
  ];
}
function tutTick() {
  if (!tut) return;
  if (tour) { if (!S || S.over || S.rid !== tut.rid) { tourHide(); tutHide(); } return; }
  if (!S || S.over || S.rid !== tut.rid) { tutHide(); return; }
  const steps = tutSteps(); let s = Math.max(tut.step, 0);
  while (s < steps.length && steps[s].done()) s++;
  if (s >= steps.length) { tutFinish('That is the basics. Press H any time for the full guide.'); return; }
  tutHl(steps[s].hl || []);
  if (s === tut.step && document.getElementById('tut')) return;
  tut.step = s;
  let el = document.getElementById('tut');
  if (!el) {
    el = document.createElement('div'); el.id = 'tut'; el.setAttribute('role', 'status');
    el.style.cssText = 'position:relative;order:-1;max-width:100%;box-sizing:border-box;pointer-events:auto;background:#241a10;border:1px solid #c9a27a;border-radius:8px;padding:8px 12px;font-size:14px;line-height:1.4;color:#f3e6d0;display:flex;gap:10px;align-items:center';
    ($('#topstack') || $('#wrap')).appendChild(el);
  }
  el.innerHTML = '<span style="flex:1">' + steps[s].text + '</span><button id="tutSkip" style="background:none;border:1px solid #6b5a44;border-radius:5px;padding:3px 8px;color:inherit;cursor:pointer">Hide for now</button> <button id="tutNever" style="background:none;border:1px solid #6b5a44;border-radius:5px;padding:3px 8px;color:inherit;cursor:pointer">Don\'t show again</button>';
  $('#tutSkip').onclick = () => tutHide();   // hide for this run only; returns on the next new run
  $('#tutNever').onclick = () => tutFinish();   // persisted: don't show again
}
function start() { overlay(''); scene = 'bunker'; paused = false; speed = 1; closeDrawer(); renderHud(); $('#tAlarm').classList.toggle('on', !!S.alarm); showHint(); }
function summaryHtml() {
  const st = S.stats, lost = st.lost || [];
  const sc = Object.entries(st.scav || {}).filter(([, v]) => v > 0).map(([k, v]) => v + ' ' + ((RES.find(r => r.k === k) || { name: k }).name.toLowerCase())).join(', ');
  const mom = (st.moments || []).map(m => '<li>' + esc(m) + '</li>').join('');
  const hauled = Object.values(st.scav || {}).reduce((a, v) => a + (v > 0 ? v : 0), 0);
  const tw = S.tower || { done: 0, paid: false, work: 0 };
  const curStage = TOWER[tw.done];
  const part = curStage && tw.paid ? clamp(tw.work / curStage.work, 0, 1) : 0;
  let goalPct = Math.round(Math.min(1, (tw.done + part) / TOWER.length) * 100);
  if (S.goal && typeof S.goal.pct === 'number') goalPct = Math.round(clamp(S.goal.pct, 0, 1) * 100);
  if (S.won) goalPct = 100;
  const goalLine = S.goal && S.goal.name ? esc(S.goal.name) : (GOAL_KIND === 'vehicle' ? 'escape vehicle' : 'signal tower') + ' stage <b>' + Math.min(tw.done, TOWER.length) + '</b> of ' + TOWER.length + ' complete';
  return `<div class="summary">`
    + `<div>Days survived: <b>${day()}</b></div>`
    + `<div>Survivors lost: <b>${lost.length}</b>${lost.length ? ' (' + esc(lost.join(', ')) + ')' : ''} · crew alive: <b>${living().length}</b></div>`
    + `<div>Raids repelled: <b>${st.repelled || 0}</b> of ${st.raids}</div>`
    + `<div>Hostiles stopped: <b>${st.kills}</b> · scavenging trips: <b>${st.trips}</b></div>`
    + `<div>Loot hauled: <b>${hauled}</b> items${sc ? ' (' + sc + ')' : ''}</div>`
    + `<div>Goal progress: <b>${goalPct}%</b> · ${goalLine}</div>`
    + `<div class="summary-title"><b>Key moments</b></div><ul class="summary-moments" tabindex="0" aria-label="Key moments">${mom || '<li>A quiet run.</li>'}</ul></div>`;
}
function gameOver(won) {
  if (S.over) return;
  S.over = true; S.won = won; clearSave(); scene = 'over';
  let winLine = '';
  try { if (window.SFX && SFX.sting) SFX.sting(won); } catch (e) {}
  if (won) { const wc = narrPick('victory'); narrPlay(wc); winLine = narrText(wc, 'victory', pick(LAMP_LINES.towerWin)); }
  else narrPlay(narrPick('defeat'));
  const alive = living().map(c => c.name);
  overlay(won
    ? `<div class="menu" role="dialog" aria-modal="true" aria-labelledby="oTitle"><h1 id="oTitle" style="font-size:46px">${S.goalKind === 'vehicle' ? 'THE WAY OUT IS OPEN' : 'THE SIGNAL IS OUT'}</h1><p class="sub">Lamp reads the reply aloud, slowly, the way it reads old maintenance logs: <i>“Bunker 12. We hear you. Hold on. We are coming.”</i> Somewhere above the ash, Nell would finally see the sky.</p>
       <p class="sub"><b>Lamp:</b> <i>“${esc(winLine)}”</i></p>${summaryHtml()}<button class="btn" id="oNew">Restart</button></div>`
    : `<div class="menu" role="dialog" aria-modal="true" aria-labelledby="oTitle"><h1 id="oTitle" style="font-size:46px">THE BUNKER IS SILENT</h1><p class="sub">Lamp keeps reading the maintenance logs to empty rooms.</p>${summaryHtml()}<button class="btn" id="oNew">Restart</button></div>`);
  $('#oNew').onclick = () => { try { if (window.SFX && SFX.stingStop) SFX.stingStop(); } catch (e) {} newRun(S && S.goalKind); start(); };
  try {
    const dlg = $('#overlay').firstElementChild, sm = dlg && dlg.querySelector('.summary');
    if (sm) { sm.id = 'oSummary'; dlg.setAttribute('aria-describedby', 'oSummary'); }
    if (typeof srSay === 'function') srSay((won ? 'Victory. ' : 'Game over. ') + 'Days survived ' + day() + '. Survivors lost ' + ((S.stats.lost || []).length) + '. Press Restart to play again.');
  } catch (_) {}
  $('#oNew').focus();
}
// focus trap for the end screen: if focus escapes the dialog (mouse click, script), pull it back to Restart
document.addEventListener('focusin', e => {
  if (scene !== 'over') return;
  const o = $('#overlay');
  if (!o || o.hidden || o.contains(e.target)) return;
  const b = $('#oNew'); if (b) b.focus();
});

// ---------------------------------------------------------------- 7. main loop
function fit() {
  const s = Math.min(innerWidth / W, innerHeight / H), w = $('#wrap');
  w.style.transform = `scale(${s})`;
  document.body.classList.toggle('small', s < 0.75);
  // on small screens the stage is scaled down a lot, so grow touch UI to keep it readable and tappable
  const portraitTouch = document.body.classList.contains('touch') && innerHeight > innerWidth;
  w.style.setProperty('--u', Math.max(1, Math.min(portraitTouch ? 3.2 : 1.7, 0.7 / s)).toFixed(2));
  // --tap = 44 real screen px expressed in stage px, used as a minimum touch target size
  w.style.setProperty('--tap', Math.round(Math.max(30, Math.min(150, 44 / s))) + 'px');
  // small windows (not just touch devices) get the compact, collapsible panel layout
  document.body.classList.toggle('narrow', s < 0.7);
  // safe-area insets (notch, rounded corners, home bar) in stage px, minus the letterbox bars that already absorb them
  let pr = document.getElementById('safeProbe');
  if (!pr) { pr = document.createElement('div'); pr.id = 'safeProbe'; pr.setAttribute('aria-hidden', 'true'); pr.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)'; document.body.appendChild(pr); }
  const cs = getComputedStyle(pr), barX = Math.max(0, (innerWidth - W * s) / 2), barY = Math.max(0, (innerHeight - H * s) / 2);
  const inset = (v, bar) => (Math.max(0, (parseFloat(v) || 0) - bar) / s).toFixed(1) + 'px';
  w.style.setProperty('--sat', inset(cs.paddingTop, barY)); w.style.setProperty('--sab', inset(cs.paddingBottom, barY));
  w.style.setProperty('--sal', inset(cs.paddingLeft, barX)); w.style.setProperty('--sar', inset(cs.paddingRight, barX));
}
addEventListener('resize', fit); fit();
{ const rot = document.getElementById('rotate'); if (rot) { rot.textContent = 'Landscape plays best. Tap to dismiss.'; rot.addEventListener('click', () => { rot.style.display = 'none'; }); } }
// phones report stale sizes right after rotation and resize when the browser toolbar collapses
addEventListener('orientationchange', () => { fit(); setTimeout(fit, 250); });
if (window.visualViewport) visualViewport.addEventListener('resize', fit);
let last = performance.now(), hudT = 0, drawerT = 0;
const SIM_STEP = 1 / 60, MAX_STEPS = 16; let simAcc = 0;
function frame(now) {
  try { frameBody(now); } catch (e) { fatal(e); }
  requestAnimationFrame(frame);
}
function frameBody(now) {
  const dtReal = Math.min(0.05, (now - last) / 1000); last = now;
  gamepadTick(dtReal);
  if (window.SFX) SFX.update(dtReal, S && !S.over && !paused && (scene === 'bunker' || scene === 'scav') ? { scene, alarm: !!S.alarm, raid: !!S.raidActive, night: isNight(), spawns: S.spawns ? S.spawns.length : 0, foes: S.enemies ? S.enemies.length : 0, raids: (S.stats && S.stats.raids) || 0, powerOut: !!(S.rooms && S.rooms.generator && !S.powered) } : null);
  if (S && (scene === 'bunker' || scene === 'scav')) {
    if (!paused) {
      // fixed 60Hz timestep: real time * speed feeds an accumulator, sim advances in equal steps
      simAcc += dtReal * speed;
      let n = 0;
      while (simAcc >= SIM_STEP && n < MAX_STEPS) { simTick(SIM_STEP); simAcc -= SIM_STEP; n++; }
      if (simAcc >= SIM_STEP) simAcc = 0; // drop backlog rather than spiral
      playerTick(dtReal); walkHintTick(dtReal); bulletsTick(dtReal); fxTick(dtReal); heartbeatTick(dtReal);
    }
    const it = interactable(); $('#prompt').textContent = it ? (document.body.classList.contains('touch') ? it.text.replace(/^E · /, 'Tap E · ') : it.text.replace(/^E · /, keyLabel(BIND.interact) + ' · ')) : walkHint;
    hudT -= dtReal; if (hudT <= 0) { hudT = 0.25; renderHud(); renderScavHud(); tutTick(); }
    drawerT -= dtReal; if (drawerT <= 0) { drawerT = living().length > 40 ? 1.5 : 0.6; const restDone = S.crew.some(c => c.restUntil && S.t >= c.restUntil); if (!restHold && (restDone || !document.querySelector('#drawer:hover')) && !(document.activeElement && document.activeElement.tagName === 'SELECT')) renderDrawer(); }
  }
  shakeT = Math.max(0, shakeT - dtReal);
  hurtVig = Math.max(0, hurtVig - dtReal * (prefs.rm ? 1.8 : 1));
  bcamTick(dtReal);
  if (S) draw(); else { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); }
}
function renderScavHud() {
  const h = $('#scavhud');
  if (scene !== 'scav' || !scav) { h.hidden = true; return; }
  h.hidden = false;
  const pk = Object.entries(scav.pack).filter(([, v]) => v > 0);
  const pl = S.player, php = Math.max(0, Math.ceil(pl.hp)), pmx = Math.max(1, pl.maxHp), pfr = Math.min(1, php / pmx);
  const plow = pl.down || pfr <= 0.3;
  const hpBar = `<span class="shp${plow ? ' low' : ''}" role="meter" aria-label="Health" aria-valuemin="0" aria-valuemax="${pmx}" aria-valuenow="${php}">HP <span class="shpb"><i style="width:${Math.round(pfr * 100)}%"></i></span> ${pl.down ? 'DOWNED' : (plow ? '! ' : '') + php + '/' + pmx}</span>`;
  h.innerHTML = `<b>TOPSIDE</b>${hpBar}<span>${carryBar()}</span><span>Pack: ${pk.length ? pk.map(([k, v]) => v + ' ' + RES.find(r => r.k === k).name.toLowerCase()).join(', ') : 'empty'}</span><span>Hatch ${Math.ceil(S.door.hp)}/${S.door.max} · Wall ${Math.ceil(S.wall.hp)}</span>${hazardHud()}${S.enemies.length ? `<span style="color:var(--red)">Bunker under attack</span>` : ''}`;
}
// a quiet backdrop behind the menu
// plain-HTML fallback if the menu overlay failed to render
function fallbackStart() {
  if (document.getElementById('abFallback')) return;
  const d = document.createElement('div');
  d.id = 'abFallback';
  d.style.cssText = 'position:fixed;inset:0;z-index:99998;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:#0b0b0d;color:#ddd;font:16px sans-serif;text-align:center';
  d.innerHTML = '<div style="font-size:28px;font-weight:bold">ASHFALL BUNKER</div><div>The menu did not load.</div>';
  const b = document.createElement('button');
  b.textContent = 'Start';
  b.style.cssText = 'font:bold 18px sans-serif;padding:12px 32px;cursor:pointer';
  b.onclick = () => {
    try { newRun(); start(); d.remove(); } catch (e) { fatal(e); }
  };
  d.appendChild(b);
  document.body.appendChild(d);
}
function menuOk() {
  const o = document.getElementById('overlay');
  return !!(o && !o.hidden && o.innerHTML.trim() && scene === 'menu');
}
function safeShowMenu() {
  try { showMenu(); } catch (e) { fatal(e); }
  if (!menuOk()) fallbackStart();
  // late check: only if still on the menu scene with an empty overlay
  setTimeout(() => {
    const o = document.getElementById('overlay');
    if (scene === 'menu' && !(o && o.innerHTML.trim())) fallbackStart();
  }, 1500);
}
// register global error hooks first so startup failures and rejections are reported
window.addEventListener('error', ev => fatal(ev.error || ev.message));
window.addEventListener('unhandledrejection', ev => fatal(ev.reason || 'Unhandled promise rejection'));
try {
  quiet = true; newRun(); quiet = false;
} catch (e) { quiet = false; fatal(e); }
safeShowMenu();
requestAnimationFrame(frame);
// UI sounds: one delegated hook for every button, including ones re-rendered into panels and overlays
(function uiSoundHooks() {
  const SEL = 'button, [role="tab"], [role="switch"], input[type="checkbox"], .btn, .chip, .bcat';
  const find = t => (t && t.closest) ? t.closest(SEL) : null;
  const off = el => el.disabled || el.getAttribute('aria-disabled') === 'true';
  document.addEventListener('pointerover', e => {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    const el = find(e.target);
    if (!el || off(el) || el === find(e.relatedTarget)) return;
    if (window.SFX && SFX.uiHover) SFX.uiHover();
  }, true);
  document.addEventListener('click', e => {
    const el = find(e.target);
    if (!el || off(el) || !window.SFX) return;
    const d = el.dataset || {};
    const id = el.id || '';
    if (id === 'tMute' || id === 'sMute') { setTimeout(() => { if (SFX.uiToggle) SFX.uiToggle(!SFX.muted); }, 0); return; }
    if (el.hasAttribute('aria-pressed') || el.type === 'checkbox' || el.getAttribute('role') === 'switch') {
      setTimeout(() => {
        const p = el.type === 'checkbox' ? el.checked : el.getAttribute('aria-pressed');
        if (SFX.uiToggle) SFX.uiToggle(p === true || p === 'true');
      }, 0);
      return;
    }
    if (/^toggle/i.test(d.build || '') || d.it === 'toggle') { if (SFX.uiToggle) SFX.uiToggle(true); return; }
    const primary = (el.classList.contains('btn') && !el.classList.contains('ghost') && el.closest('#overlay')) ||
      d.gear === 'craft' || d.build === 'tower' || d.build === 'x_send' || id === 'pRes' || id === 'mContinue' || id === 'oNew';
    if (primary) { if (SFX.uiConfirm) SFX.uiConfirm(); return; }
    if (id === 'hBack' || id === 'hintX' || id === 'tutSkip') { if (SFX.uiClose) SFX.uiClose(); return; }
    if (el.hasAttribute('aria-expanded')) {
      setTimeout(() => {
        const x = el.getAttribute('aria-expanded') === 'true';
        if (x ? SFX.uiOpen : SFX.uiClose) (x ? SFX.uiOpen : SFX.uiClose).call(SFX);
      }, 0);
      return;
    }
    const label = ((el.getAttribute('aria-label') || '') + ' ' + (el.textContent || '')).trim();
    if (/^(close|back|cancel|resume|skip|dismiss|got it|×|✕|x$)/i.test(label)) { if (SFX.uiClose) SFX.uiClose(); return; }
    if (/^(settings|how to play|controls|help|pause|shortcuts|roster|log|minimap|map)\b/i.test(label)) { if (SFX.uiOpen) SFX.uiOpen(); return; }
    if (SFX.click) SFX.click();
  }, true);
})();
// for automated tests
window.__ab = { get S() { return S; }, get P() { return P; }, get scene() { return scene; }, newRun, start, simTick, startScav, endScav, doBuild, toggleAlarm, setSpeed };
