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
  if (S.res.scrap >= need) { S.res.scrap -= need; S.powered = true; S.batt = Math.min(bcap, S.batt + 2 * h); }
  else if (S.batt > 0) { S.batt = Math.max(0, S.batt - h); S.powered = true; }
  else S.powered = false;
  if (was && !S.powered) { S.powerOut = true; lampEv('power_out', 'The generator has run out of scrap and gone dark. Rooms are back to manual.', 'warn'); }
  if (S.powered && S.powerOut) { S.powerOut = false; lampEv('power_back', 'Generator is running again. Power is back.', 'good'); }
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
let doorLowSaid = false;
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
function lampEv(ev, text, kind, delayMs) {
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
const fx = { tracers: [], parts: [], nums: [], bullets: [], casings: [] };
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
    player: { hp: 100, maxHp: 100, food: 80, xp: 0, lvl: 1, down: 0 },
  };
  ensurePair(S);
  for (const n of NAMED) if (!n.arrives) S.crew.push(makeCrew({ ...n, named: true }));
  const a = makeCrew(randomSurvivor()); a.job = 'turretA'; a.shift = 'day'; a.loyalty = 1; S.crew.push(a);
  const b = makeCrew(randomSurvivor()); b.job = 'hydro'; b.shift = 'day'; b.loyalty = 1; S.crew.push(b);
  // Juno takes the turret at night; the day-shift survivor covers it in daytime.
  placePlayer('bunker');
  fx.tracers = []; fx.parts = []; fx.nums = []; fx.bullets = [];
  logs.length = 0;
  lampEv('match_start', 'Lamp online. Good morning, Mara. It is day 1, 08:00. The first raid is due at ' + RAID_CLOCK + '.');
  lamp('Someone has to sit at a turret or it will not fire. Open Crew (C) to give people jobs and shifts.', '', 900);
  lamp('The signal tower needs electronics we do not have. Walk right across the surface to scavenge. Time keeps running while you are out.', '', 1800);
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
function morale(c) { return clamp((c.mor ?? 70) + (restActive(c) ? REST_BOOST : 0), 0, 100); }
// Stored morale drifts with needs each tick (h = in-game hours).
function moraleTick(c, h) {
  let d = 0;
  if (c.food <= 0) d -= 8; else if (c.food < 25) d -= 4;
  if (c.patient) d -= 3;
  if (c.sick) d -= 3;
  if (restPct(c) < 30) d -= 2;
  if (c.grief > 0) d -= 2;
  if (c.state === 'sleep') d += c.bed === false ? FLOOR_MORALE : 3;
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
  m.y += Math.sign(dy) * Math.min(Math.abs(dy), spd * 0.8 * dt);
  // passing a floor on the way
  for (let f = 0; f < FLOORS.length; f++) if (Math.abs(m.y - FLOORS[f]) < 1) m.floor = f;
  return false;
}

function hourEvents(h) {
  const d = day();
  meal(h);
  if (h === 8) { if (S.alarm) toggleAlarm(); S.alarmAuto = false; if (d > 1) lampEv('new_day', 'Day ' + d + '. ' + summaryLine()); }
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
  S.enemies.push({ id: uid++, type: 'maw', enemy: true, burrow: true, x: LADDER_X + rnd(-60, 60), y: FLOORS[3], floor: 3, climbing: false, hp: Math.round(b.hp * scale), max: Math.round(b.hp * scale), cd: 1, facing: -1, anim: 0, inside: true });
  if (!S.alarm && !S.alarmAuto) { S.alarmAuto = true; toggleAlarm(); }
  addShake(0.6); if (window.SFX && SFX.rumble) SFX.rumble(1);
  burst(LADDER_X, FLOORS[3] - 10, '#8a7a66', 24);
  lamp('The Maw has broken through the bottom floor!', 'warn');
  if (speed > 1) setSpeed(1);
}
function mawTick(dt) {
  const m = S.maw; if (!m || m.done) return;
  const left = m.at - S.t;
  if (left > 0) {
    const k = 1 - clamp(left / 120, 0, 1);
    if (Math.random() < dt * (0.4 + 1.2 * k)) { addShake(0.12 + 0.3 * k); if (window.SFX && SFX.rumble) SFX.rumble(0.2 + 0.4 * k); }
  } else { m.done = true; spawnMaw(); }
}
function revoltCheck() {
  for (const c of living()) {
    if (c.named || c.loyalty >= 1) continue;
    if (morale(c) < 38 && Math.random() > c.loyalty) {
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
      break; // at most one revolt per night
    }
  }
}
function wandererAtDoor() {
  if (living().length >= 14) return;
  const w = makeCrew(randomSurvivor()); w.x = 300; w.floor = 0; w.y = FLOORS[0];
  S.crew.push(w);
  lampEv('newcomer', w.name + ' (' + w.role.toLowerCase() + ') knocked at the hatch and asked to stay. I let them in. Keep morale up: newcomers are not always loyal.', 'good');
}

function crewTick(c, dt, mins) {
  const h = mins / 60;
  c.anim += dt * 6;
  if (c.cd > 0) c.cd -= dt;
  if (c.grief > 0) c.grief -= h;
  moraleTick(c, h);
  // needs
  c.food = Math.max(0, c.food - foodDrain() * h);
  if (c.food <= 0) { c.hp -= 3 * h; if (c.hp <= 0) return kill(c, 'starved'); }
  if (c.state === 'sleep') c.awake = Math.max(0, c.awake - h * (16 / (S.rooms.bunks > 1 ? 5 : 7)) * (c.bed === false ? FLOOR_REST_MULT : 1));
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
  const e = eff(c) * (S.powered && POWERED_JOBS.includes(job) ? ROOM_FX.powerBoost : 1);
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
function bedCount() { return itemList().filter(it => it.type === 'bunk').length * 2; }   // each bunk is two beds, bought one at a time
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
function digMark(a, b, erase) {
  const d = dg();
  for (let r = Math.min(a.r, b.r); r <= Math.max(a.r, b.r); r++) for (let c = Math.min(a.c, b.c); c <= Math.max(a.c, b.c); c++) {
    const i = dIdx(c, r); if (!d.m[i]) continue;
    d.mark[i] = erase ? 0 : 1;
  }
}
function digStart(w, shift) { const a = dCellClamp(w), d = dg(); digDrag = { a, b: a, erase: !!shift || !!d.mark[dIdx(a.c, a.r)] }; }
window.addEventListener('pointermove', e => { if (digDrag) digDrag.b = dCellClamp(bcamToWorld(toCanvas(e))); });
window.addEventListener('pointerup', () => { if (!digDrag) return; digMark(digDrag.a, digDrag.b, digDrag.erase); digDrag = null; });
window.addEventListener('pointercancel', () => { digDrag = null; });
function toggleDig() {
  digTool = !digTool; digDrag = null; if (digTool) placing = null;
  const b = document.getElementById('tDig'); if (b) { b.classList.toggle('on', digTool); b.setAttribute('aria-pressed', digTool ? 'true' : 'false'); }
  if (digTool && S) { bcam.follow = null; bcam.cy = 640; } else bcam.cy = H / 2;
}
{ const b = document.getElementById('tDig'); if (b) b.onclick = e => { toggleDig(); e.currentTarget.blur(); }; }
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
function uiSfx(n) { try { if (window.SFX && SFX['ui' + n]) SFX['ui' + n](); } catch (e) {} }
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
    pay(r.cost); claimRoom(k, s); S.rooms[k] = 1; placing = null; bcam.cy = H / 2; uiSfx('Place');
    lamp(ROOMS[k].name + ' built in the pit. ' + r.done + (pitRoomReachable(k) ? '' : ' No ladder reaches it yet: crew cannot get there until a ladder does.'), 'good');
    renderDrawer(); return;
  }
  const l = ladderCheck(w);
  if (!l) return;
  if (!l.ok) { uiSfx('Error'); lamp(l.why + '.', 'warn'); return; }
  if (!canPay(l.cost)) { uiSfx('Error'); lamp('A ladder segment needs ' + fmtCost(l.cost) + '.', 'warn'); return; }
  pay(l.cost);
  if (l.kind === 'bunker') S.ladders.push({ g: l.g, x: l.x }); else d.lad[dIdx(l.c, l.r)] = 1;
  d.ver = (d.ver | 0) + 1;
  burst(l.kind === 'bunker' ? l.x : dCenterX(l.c), l.kind === 'bunker' ? FLOORS[l.g + 1] - 20 : dFeetY(l.r) - 10, '#a8906a', 5); uiSfx('Place');
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
  g.fillStyle = chk.ok ? 'rgba(90,220,110,.32)' : 'rgba(230,70,70,.34)'; g.fillRect(x, y, bw, bh);
  g.strokeStyle = chk.ok ? '#5adc6e' : '#ff5a4e'; g.lineWidth = 2; g.strokeRect(x + 1, y + 1, bw - 2, bh - 2);
  const txt = label + (chk.ok ? '' : ': ' + chk.why), tw = g.measureText(txt).width + 12;
  const tx = clamp(x, IN_L, IN_R - tw), ty = Math.max(FLOORS[0] + 20, y - 22);
  g.fillStyle = 'rgba(20,10,8,.9)'; g.fillRect(tx, ty, tw, 18); g.fillStyle = chk.ok ? '#d6ffd9' : '#ffd0cc'; g.fillText(txt, tx + 6, ty + 13);
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
  S.lostT = (S.lostT || []).filter(t => S.t - t < 60); S.lostT.push(S.t);
  atLoc({ x: c.x, y: c.y });
  if (left === 49) lampEv('pop_50', lostTxt + ' Fewer than fifty survivors remain.', 'warn');
  else if (left === 10) lampEv('pop_10', lostTxt + ' Ten survivors remain.', 'warn');
  else if (left === 3) lampEv('pop_3', lostTxt + ' Three survivors remain.', 'warn');
  else if (S.lostT.length >= 3) lampEv('survivor_lost_many', lostTxt, 'warn');
  else lampEv('survivor_lost', lostTxt, 'warn');
  burst(c.x, c.y - 14, '#a33', 14);
  if (!living().length && S.player.down) gameOver(false);
}
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
  const people = [...living(), ...(scene === 'bunker' && !S.player.down ? [P] : [])];
  const t = people.sort((a, z) => (Math.abs(a.floor - e.floor) * 500 + Math.abs(a.x - e.x)) - (Math.abs(z.floor - e.floor) * 500 + Math.abs(z.x - e.x)))[0];
  if (!t) { moveTo(e, 3, 900, dt, b.spd); return; }
  if (t.floor === e.floor && !e.climbing && Math.abs(t.x - e.x) < (b.ranged ? 160 : 22)) return attack(e, b, t, t.x);
  moveTo(e, t.climbing ? e.floor : t.floor, t.x, dt, b.spd);
}
function attack(e, b, target, tx, what) {
  e.facing = Math.sign(tx - e.x) || -1;
  if (e.cd > 0) return;
  e.cd = b.rate;
  if (b.ranged) { tracer(e.x - 6, e.y - b.h + 8, tx, (target.y || FLOORS[0]) - 16, '#ff7a5a'); if (Math.random() > 0.65) return; }
  if (target === P) return hurtPlayer(b.dmg);
  if (target.stats) { target.hp -= b.dmg * coverMul(target); burst(target.x, target.y - 16, '#c33', 4); if (target.hp <= 0) kill(target); return; }
  target.hp = Math.max(0, target.hp - b.dmg * structDmgMul(what)); burst(tx + 6, FLOORS[0] - 20, '#bbb', 3);
  if (window.SFX) SFX.hit(what);
  if (what === 'door') {
    fxDust(tx + 6, FLOORS[0] - 14, 4 + Math.floor(Math.random() * 3));
    fxSparks(tx + 6, FLOORS[0] - 20, 3 + Math.floor(Math.random() * 3), 1);
    const dm = b.dmg || 1;
    if (scene === 'bunker') addShake(clamp(0.08 + dm * 0.015, 0.08, 0.45));
    if (window.SFX && SFX.rumble) SFX.rumble(clamp(dm / 20, 0.15, 1));
  }
  if (what === 'door') {
    if (target.hp > 0 && target.hp < target.max * 0.25) { if (!doorLowSaid) { doorLowSaid = true; lampEv('door_low', 'Door integrity critical.', 'warn'); } }
    else { if (target.hp > target.max * 0.5) doorLowSaid = false; narrPlay(narrPick('door_attack')); }
  }
  if (what === 'wall' && target.hp <= 0) lampEv('wall_down', 'The outer wall is down!', 'warn');
  if (what === 'turret' && target.hp <= 0) { lampEv('turret_lost', 'A turret was destroyed.', 'warn'); const i = S.turrets.indexOf(target); S.turrets[i] = null; }
}
function breach() {
  // Called each time something gets in. The alarm sounds once per night, so the player can still stand people down.
  if (!S.alarm && !S.alarmAuto) { S.alarmAuto = true; toggleAlarm(); }
  if (S.breached) return;
  S.breached = true; addShake(0.5); if (window.SFX && SFX.rumble) SFX.rumble(1);
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
  e.hp -= dmg; fx.nums.push({ x: e.x, y: e.y - ENEMIES[e.type].h - 6, t: 0.7, s: Math.round(dmg) });
  burst(e.x, e.y - ENEMIES[e.type].h / 2, '#7a2', 3);
  fxHit(e.x, e.y - ENEMIES[e.type].h / 2, !!crit);
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
function turretTickOld(dt) {   // replaced by turretTick in systems.js
  S.turrets.forEach((t, i) => {
    if (!t) return;
    if (t.cd > 0) t.cd -= dt;
    if (t.type === 'coil') { t.manned = !!S.powered; return; }
    const gunner = living().find(c => c.state === 'work' && targetJob(c) === (i ? 'turretB' : 'turretA'));
    t.manned = !!gunner;
    if (!gunner || t.cd > 0) return;
    const spec = TURRETS[t.type];
    const target = S.enemies.filter(e => !e.inside && !e.hidden && e.hp > 0 && e.x > SLOT_X[i] && e.x - SLOT_X[i] < spec.range && e.x < W + 10).sort((a, z) => a.x - z.x)[0];
    if (!target) return;
    t.cd = spec.cd; t.flash = 0.08;
    if (window.SFX) SFX.turret(t.type);
    fxSparks(SLOT_X[i] + 18, FLOORS[0] - 30, 3, 1);
    fxDust(SLOT_X[i] + 14, FLOORS[0] - 24, 2);
    if (scene === 'bunker') addShake(t.type === 'rifle' ? 0.05 : 0.09);
    const e = eff(gunner);
    for (let k = 0; k < spec.pellets; k++) {
      const ty = target.y - ENEMIES[target.type].h / 2 + rnd(-8, 8);
      tracer(SLOT_X[i] + 16, FLOORS[0] - 30, target.x + rnd(-6, 6), ty, t.type === 'rifle' ? '#ffe08a' : '#ffb060');
      if (Math.random() < (spec.base + spec.accK * gunner.stats.acc) * e) hitEnemy(target, spec.dmg * (t.lvl > 1 ? 1.4 : 1) * armoryMult(), gunner);
    }
  });
}
function simTick(dt) {
  if (S.over) return;
  const mins = dt * GAME_MIN_PER_SEC;
  const before = S.t; S.t += mins;
  // whole-hour events
  const h0 = Math.floor(before / 60), h1 = Math.floor(S.t / 60);
  for (let hh = h0 + 1; hh <= h1; hh++) hourEvents(hh % 24);
  // spawns
  for (let i = S.spawns.length - 1; i >= 0; i--) if (S.t >= S.spawns[i].at) { spawnEnemy(S.spawns[i].type); S.spawns.splice(i, 1); }
  mawTick(dt);
  for (const c of S.crew) if (c.alive && !c.exp) crewTick(c, dt, mins);
  maraWorkTick(mins);
  pairTick(mins);
  powerTick(mins / 60);
  medTick(mins / 60);
  turretTick(dt);
  for (const e of S.enemies) if (e.hp > 0) enemyTick(e, dt);
  S.enemies = S.enemies.filter(e => e.hp > 0);
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
function hurtPlayer(d, quiet) {
  const pl = S.player; if (pl.down) return;
  pl.hp -= d; if (!quiet) { burst(P.x, P.y - 18, '#c33', 5); P.hurt = 0.2; if (d > 0) hurtVig = Math.max(hurtVig, Math.min(0.45, 0.25 + d * 0.01)); }
  if (scene === 'scav' && pl.hp > 0 && pl.hp < pl.maxHp * 0.3 && pl.hp + d >= pl.maxHp * 0.3) lampEv('topside_danger', 'Mara is in trouble on the surface. Run first, loot later.', 'warn');
  if (pl.hp <= 0) {
    pl.hp = 0; pl.down = 8;
    if (scene === 'scav') { lampEv('survivor_down', 'Mara is down out there. Tick dragged you home, but the pack was lost.', 'warn'); endScav(false); }
    else lampEv('survivor_down', 'Mara is down! Doc will patch you up in the med bay.', 'warn');
    if (!living().length) gameOver(false);
  }
}
function playerTick(dt) {
  const pl = S.player;
  if (pl.down) {
    pl.down -= dt;
    if (pl.down <= 0) { lampEv('survivor_revive', 'Mara is back on her feet.', 'good'); pl.down = 0; pl.hp = Math.round(pl.maxHp * 0.5); scene = 'bunker'; P.x = 900; P.y = FLOORS[2]; P.floor = 2; P.climbing = P.onLadder = false; P.vy = 0; }
    return;
  }
  if (scene === 'scav') { P.auto = false; return scavPlayerTick(dt); }
  if (P.auto) { maraAuto(dt); if (P.cd > 0) P.cd -= dt; if (P.hurt > 0) P.hurt -= dt; return; }
  const L = kd('left'), R = kd('right'), U = kd('up'), D = kd('down');
  const lad = ladderSpans().find(s => Math.abs(P.x - s.x) < 22 && ((U && P.y > s.y0 + 2 && P.y <= s.y1 + 2) || (D && P.y < s.y1 - 2 && P.y >= s.y0 - 2)));
  if (!P.onLadder && lad) { P.onLadder = true; P.x = lad.x; P.vy = 0; }
  if (P.onLadder) {
    const ls = ladderSpans().find(s => Math.abs(P.x - s.x) < 3 && P.y >= s.y0 - 12 && P.y <= s.y1 + 12) || ladderSpans()[0];
    if (U) P.y -= TUNE.ladder * dt; if (D) P.y += TUNE.ladder * dt;
    P.y = clamp(P.y, ls.y0, ls.y1);
    const f = FLOORS.findIndex(y => Math.abs(P.y - y) < 10);
    if ((L || R) && f >= 0) { P.onLadder = false; P.y = FLOORS[f]; P.floor = f; P.vy = 0; }
    else if (!(L || R)) { if (f >= 0 && !U && !D) { P.y = FLOORS[f]; P.floor = f; } }
    P.anim += (U || D) ? dt * 8 : 0;
  } else {
    P.vx = (R ? 1 : 0) - (L ? 1 : 0);
    if (P.vx) P.facing = P.vx;
    P.x += P.vx * TUNE.walk * dt; P.anim += P.vx ? dt * 10 : 0;
    PC.update(P, kd('jump'), dt, TUNE.jump);
    // land on a floor line, bump the ceiling of the floor above
    Physics.moveBody(P, dt, TUNE.grav, bunkerSurfaces());
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
  const wanderer = Math.random() < 0.7 && living().length < 14 ? { x: rnd(1600, len - 300), y: 620, s: randomSurvivor(), talked: false } : null;
  scav = { area: town ? 'town' : 'wasteland', len, plats, crates, enemies, wanderer, pack: takeCarried(), cam: 0, ruins: Array.from({ length: town ? 40 : 400 }, () => ({ x: rnd(0, town ? len : len * 0.4 + W), w: rnd(60, 180), h: rnd(60, 260), c: rnd(0, 1) })) };
  scav.hz = makeHazards(len);
  scav.home = 0;
  if (!town) flipScav(scav);
  scene = 'scav';
  Object.assign(P, { x: scav.flip ? scav.home - 80 : 80, y: 620, vx: 0, vy: 0, onLadder: false, grounded: true, facing: 1 });
  lampEv('topside_exit', 'You are topside. The bunker keeps running without you: I will call if the door is in trouble. Walk back to the ' + (scav.flip ? 'right' : 'left') + ' edge to come home.' + (scav.flip ? ' The wasteland stretches far to the left: watch the map at the top of the screen.' : ''));
  if (town) lamp('The dead town. Shelves and tills hold food, materials and parts, but little electronics. Something heavy patrols the streets: jump its charge.', 'warn');
}
function endScav(keep) {
  if (keep && scav) {
    const got = Object.entries(scav.pack).filter(([, v]) => v > 0);
    
    { const cr = carriedOf(); for (const [k, v] of got) cr[k] = (cr[k] || 0) + v; }
    dropOff();
    if (scav.recruit) { const c = makeCrew(scav.recruit); c.x = 300; c.floor = 0; c.y = FLOORS[0]; S.crew.push(c); lampEv('newcomer', c.name + ' joins the bunker. Give them a job in the Crew panel.', 'good'); }
    if (!got.length) lampEv('topside_return', 'Welcome back. Nothing useful this time.', 'good');
  }
  scav = null; scene = 'bunker';
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
let scavWasGround = true, scavStepAcc = 0;
function scavPlayerTick(dt) {
  const L = kd('left'), R = kd('right');
  const lads = scav.ladders || [];
  PC.lastJumpSpeed = TUNE.scavJump;
  if (lads.length && PC.climb(P, { up: kd('up'), down: kd('down'), left: L, right: R, jump: kd('jump') }, dt, lads, TUNE.ladder)) {
    P.vx = 0; P.anim += (kd('up') || kd('down')) ? dt * 8 : 0;
    scavWasGround = true; scavStepAcc = 0;
  } else {
    P.vx = (R ? 1 : 0) - (L ? 1 : 0); if (P.vx) P.facing = P.vx;
    P.x = clamp(P.x + P.vx * TUNE.scavWalk * dt, 10, scav.len - 10); P.anim += P.vx ? dt * 10 : 0;
    const jumped = PC.update(P, kd('jump') || kd('up'), dt, TUNE.scavJump);
    const preVy = P.vy;
    Physics.moveBody(P, dt, TUNE.grav, scavSurfaces());
    if (window.SFX) {
      if (jumped) { SFX.jump(); scavStepAcc = 0; }
      else if (P.grounded && !scavWasGround && preVy > 120) { SFX.land(preVy); scavStepAcc = 0; }
      if (P.grounded && !jumped) {
        if (P.vx) { scavStepAcc += TUNE.scavWalk * dt; if (scavStepAcc >= 38) { scavStepAcc -= 38; SFX.step(); } }
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
  if (e.hp <= 0) { S.stats.kills++; S.player.xp += ENEMIES[e.type].xp; if (Math.random() < 0.5 && packAdd('scrap', 2) === 0) packFullNote(e.x, e.y - 20); burst(e.x, e.y - 10, '#5a3', 10, true); if (window.SFX && SFX.death) SFX.death(e.type === 'cinder' || e.type === 'maw' || e.type === 'ram' ? 'big' : 'far'); }
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
  const g = c.loot || roll(), txt = [], left = {}; c.loot = null;
  for (const k in g) if (g[k]) { const t = packAdd(k, g[k]); if (t < g[k]) left[k] = g[k] - t; if (t) txt.push('+' + t + ' ' + RES.find(r => r.k === k).name.toLowerCase()); }
  fx.nums.push({ x: c.x, y: c.y - 30, t: 1.4, s: txt.join('  ') || 'empty', scav: true, wide: true });
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
  return { cb: !!p.cb, hc: typeof p.hc === 'boolean' ? p.hc : osHc, rm: typeof p.rm === 'boolean' ? p.rm : osRm, ta: !!p.ta };
})();
let shakeT = 0;
let hurtVig = 0; // player-hit edge flash, seconds remaining (0..0.45)
function addShake(s) { if (!prefs.rm) shakeT = Math.max(shakeT, s); }
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
  const t = document.getElementById('tTa');
  if (t) { t.firstChild.nodeValue = 'Touch aim: ' + (prefs.ta ? 'on' : 'off'); t.setAttribute('aria-pressed', prefs.ta ? 'true' : 'false'); }
  cv.style.touchAction = prefs.ta ? 'none' : '';
  document.querySelectorAll('button[data-pref]').forEach(btn => {
    const k = btn.dataset.pref, on = !!prefs[k];
    btn.textContent = (k === 'hc' ? 'High contrast: ' : 'Colorblind: ') + (on ? 'on' : 'off');
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}
function savePrefs() { try { localStorage.setItem(PREF_KEY, JSON.stringify({ cb: prefs.cb, hc: prefs.hc, rm: prefs.rm, ta: prefs.ta })); } catch (e) {} applyPrefs(); if (typeof renderHud === 'function') { renderHud(); renderDrawer(); } }
{ const a = document.getElementById('tCb'), b = document.getElementById('tRm');
  const prefLamp = (name, on) => { try { lamp(name + ' mode ' + (on ? 'on' : 'off')); } catch (err) {} };
  if (a) a.onclick = e => { prefs.cb = !prefs.cb; savePrefs(); prefLamp('Colorblind', prefs.cb); e.currentTarget.blur(); };
  if (b) b.onclick = e => { prefs.rm = !prefs.rm; savePrefs(); prefLamp('Reduced motion', prefs.rm); e.currentTarget.blur(); };
  const tab = document.getElementById('tTa');
  if (tab) tab.onclick = e => { prefs.ta = !prefs.ta; savePrefs(); prefLamp('Touch aim', prefs.ta); e.currentTarget.blur(); };
  const hcb = document.getElementById('tHc');
  if (hcb) hcb.onclick = e => { prefs.hc = !prefs.hc; savePrefs(); prefLamp('High contrast', prefs.hc); e.currentTarget.blur(); };
  applyPrefs(); }
function draw() {
  g.save();
  if (shakeT > 0 && !prefs.rm) { const amp = Math.min(1, shakeT / 0.4) * 6; g.translate((Math.random() - 0.5) * 2 * amp, (Math.random() - 0.5) * 2 * amp); }
  if (scene === 'scav' && scav) drawScav(); else drawBunker();
  g.restore();
  drawDoorVignette();
  drawHurtVignette();
}
// Red screen-edge flash when the player is hit. Reduced motion: dimmer and shorter, smooth fade, no sudden flash.
function drawHurtVignette() {
  if (!(hurtVig > 0)) return;
  const k = Math.min(1, hurtVig / 0.45);
  const a = (prefs.rm ? 0.22 : 0.5) * k * k;
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
  if (typeof S === 'undefined' || !S || !S.door || S.over || !(S.door.max > 0)) return;
  const frac = S.door.hp / S.door.max;
  if (!(frac < 0.25)) return;
  const sev = 1 - Math.max(0, frac) / 0.25;             // 0 at 25% HP .. 1 at 0 HP
  let a = 0.28 + 0.22 * sev;
  if (!prefs.rm) {
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
function drawBunker() {
  bcamBegin();
  const sky = skyColors();
  let gr = g.createLinearGradient(0, 0, 0, FLOORS[0]); gr.addColorStop(0, sky.top); gr.addColorStop(1, sky.bot);
  g.fillStyle = gr; g.fillRect(0, 0, W, FLOORS[0]);
  if (sky.dayAmt < 0.6) { g.fillStyle = 'rgba(255,240,220,' + (0.6 - sky.dayAmt) + ')'; for (const s of stars) { g.beginPath(); g.arc(s.x, s.y, s.r, 0, 7); g.fill(); } }
  // distant ruins
  g.fillStyle = 'rgba(40,28,22,.55)';
  for (let i = 0; i < 14; i++) { const x = i * 97 + 600, h = 30 + ((i * 53) % 70); if (x < W) g.fillRect(x, FLOORS[0] - h, 46, h); }
  // ground and underground
  g.fillStyle = '#4b3a2a'; g.fillRect(0, FLOORS[0], W, 16); tex('soil', 0, FLOORS[0], W, 16, 1.2);
  g.fillStyle = '#1a130d'; g.fillRect(0, FLOORS[0] + 16, W, WH); tex('soil', 0, FLOORS[0] + 16, W, WH, 0.8);
  for (const r of rock) { g.fillStyle = 'rgba(120,90,60,' + r.a + ')'; g.fillRect(r.x, r.y, r.r * 2, r.r); }
  // rooms
  lampTick();
  for (const [k, r] of Object.entries(ROOMS)) if (!r.build) drawRoom(k, r);
  drawBunkerDust();
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
  drawPlaceGhost();
  drawSurface(sky);
  // night over the surface only: the bunker keeps its lamps
  if (sky.dayAmt < 1) { g.fillStyle = 'rgba(5,6,18,' + (0.55 * (1 - sky.dayAmt)) + ')'; g.fillRect(0, 0, W, FLOORS[0] + 16); }
  drawDrops();
  for (const c of S.crew) if (c.alive && !c.exp) drawPerson(c.x, c.y, c.color, c.accent, c, c.anim, c.facing, c.state === 'sleep', c.climbing);
  for (const c of S.crew) if (c.alive && !c.exp && !c.left) drawTaskIcon(c);
  drawFocus();
  drawCrewDebug();
  for (const e of S.enemies) drawEnemy(e);
  if (!S.player.down) drawMara();
  drawFx(0);
  drawTipHighlight();
  bcamEnd();
  drawInfoTip();
  drawRaidForecast();
  drawDigHint();
  drawPlaceHint();
  if (S.breached && prefs.cb) { g.save(); g.strokeStyle = '#fff'; g.lineWidth = 6; g.setLineDash([22, 14]); g.strokeRect(3, 3, W - 6, H - 6); g.restore(); }
  if (S.breached) { g.fillStyle = 'rgba(255,40,30,' + (prefs.rm ? 0.09 : 0.06 + 0.05 * Math.sin(performance.now() / 150)) + ')'; g.fillRect(0, 0, W, H); }
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
function drawBunkerDust() {
  for (const [k, r] of Object.entries(ROOMS)) {
    if (r.build) continue;
    const y0 = FLOORS[r.floor - 1] + (r.floor === 1 ? 16 : 10), y1 = FLOORS[r.floor];
    drawDustBox(r.x0 + 2, y0 + 2, r.x1 - r.x0 - 4, y1 - y0 - 4, 14, r.x0, lampFlick(r.x0 * 0.01));
  }
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
      g.fillStyle = low ? '#ff5a4e' : col; g.fillRect(x, y, 24 * v / 100, 4);
      if (low && prefs.cb) { g.fillStyle = '#fff'; g.font = '700 7px sans-serif'; g.fillText('!', x + 26, y + 4); }
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
  if (_v) VEC.door(g, DOOR_X, y, dp); else box(DOOR_X - 16, y - 38, 32, 38, dp > 0 ? mix([90, 40, 30], [120, 118, 110], dp) : '#140c08');
  if (dp <= 0) { g.strokeStyle = '#ff5a4e'; g.lineWidth = 2; g.strokeRect(DOOR_X - 16, y - 38, 32, 38); }
  hpBar(DOOR_X - 24, y - 62, 48, dp, '#ffb347');
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
      const on = !!S.powered, pulse = on ? 0.5 + 0.5 * Math.sin(performance.now() / 200) : 0;
      g.fillStyle = on ? '#7fc8ff' : '#553'; g.beginPath(); g.arc(x, y - 46, 5, 0, 7); g.fill();
      if (on) { g.strokeStyle = 'rgba(127,200,255,' + (0.25 + 0.4 * pulse) + ')'; g.lineWidth = 2; g.beginPath(); g.arc(x, y - 46, 8 + pulse * 6, 0, 7); g.stroke(); }
    } else { g.fillStyle = '#2a2a26'; g.fillRect(x + 4, y - 28, t.type === 'rifle' ? 30 : 20, t.type === 'rifle' ? 4 : 7); }
    if (t.flash > 0) {
      t.flash -= 1 / 60;
      const fa = clamp(t.flash / 0.08, 0, 1), mx = x + (t.type === 'rifle' ? 36 : 26), my = y - 26, big = t.type === 'rifle' ? 1 : 0.8;
      if (prefs.rm) { g.globalAlpha = 0.45; g.fillStyle = '#ffe08a'; g.beginPath(); g.arc(mx, my, 3, 0, 7); g.fill(); g.globalAlpha = 1; }
      else {
        g.globalAlpha = 0.35 + 0.65 * fa;
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
function hpBar(x, y, w, pct, c) { g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(x, y, w, 4); g.fillStyle = pct > 0.5 ? c : pct > 0.25 ? '#ff8c2a' : '#ff5a4e'; g.fillRect(x, y, w * clamp(pct, 0, 1), 4); }
function drawPerson(x, y, color, accent, c, anim, facing, sleeping, climbing) {
  g.save(); g.translate(Math.round(x), Math.round(y));
  if (sleeping) {
    box(-12, -10, 24, 8, color); g.fillStyle = '#e2c29a'; g.fillRect(-16, -12, 7, 7);
    g.fillStyle = 'rgba(220,220,255,.8)'; g.font = '600 10px "IBM Plex Sans"'; g.fillText('z', 6, -16 - (Math.floor(anim) % 3) * 3);
  } else {
    const step = Math.sin(anim) * 3;
    (typeof VEC !== 'undefined' ? VEC : SPR).person(g, color, accent, (climbing || Math.abs(step) < 0.8) ? 0 : (step > 0 ? 1 : 2), facing < 0);
    if (typeof VEC === 'undefined' && c && c.id === 'bram') { g.fillStyle = '#c9c4b8'; g.fillRect(-4, -28, 8, 3); }
    if (c && c.id === 'juno' && !c.held) { g.fillStyle = '#222'; g.fillRect(facing > 0 ? 2 : -18, typeof VEC !== 'undefined' ? -17 : -22, 16, 3); }
    if (typeof VEC === 'undefined' && c && c.id === 'reed') { g.fillStyle = '#b0b8c0'; g.fillRect(-4, -31, 8, 2); }
    if (typeof VEC === 'undefined' && c && c.id === 'tick') { g.fillStyle = '#59d0c4'; g.fillRect(-5, -33, 10, 3); }
    if (c && c.state === 'patient') { g.fillStyle = '#e04848'; g.fillRect(-2, -44, 4, 10); g.fillRect(-5, -41, 10, 4); }
    if (c) drawCrewHeld(c, facing);
  }
  if (c) {
    if (c.hp < c.maxHp) hpBar(-10, -42, 20, c.hp / c.maxHp, '#7ddc6f');
    if (sel === c.id || hover === c) { g.fillStyle = '#ffe0a8'; g.font = '600 11px "IBM Plex Sans"'; const w = g.measureText(c.name).width; g.fillText(c.name, -w / 2, -48); }
    if (sel === c.id) { g.strokeStyle = '#ffb347'; g.lineWidth = 1.5; g.strokeRect(-10, -38, 20, 40); }
    if (sleepFactor(c.awake) < 0.6 && !sleeping) { g.fillStyle = '#ff8c2a'; g.font = '700 11px "IBM Plex Sans"'; g.fillText('!', 8, -30); }
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
function drawMara() {
  g.save(); g.translate(Math.round(P.x), Math.round(P.y));
  const step = Math.sin(P.anim) * 3;
  if (P.hurt > 0) g.globalAlpha = 0.6;
  (typeof VEC !== 'undefined' ? VEC : SPR).mara(g, Math.abs(step) < 0.8 ? 0 : (step > 0 ? 1 : 2), P.facing < 0);
  g.fillStyle = '#222'; g.fillRect(P.facing > 0 ? 5 : -15, typeof VEC !== 'undefined' ? -19 : -24, 10, 3);
  g.restore();
  g.fillStyle = '#ffb347'; g.font = '700 10px "Chakra Petch"'; g.fillText('MARA', P.x - 13, P.y - 46);
}
function drawEnemy(e, ox = 0) {
  const b = ENEMIES[e.type];
  g.save(); g.translate(Math.round(e.x - ox), Math.round(e.y));
  const bob = Math.sin(e.anim) * 2;
  if (e.hidden) { box(-14, -6, 28, 6, '#5a4a38'); box(-8, -10, 16, 4, '#6e5a44'); g.restore(); return; }
  const ART = typeof VEC !== 'undefined' ? VEC : SPR;
  if (e.type === 'burrower') { box(-14, -18 + bob * 0.5, 28, 14, b.color); box(e.facing < 0 ? -20 : 10, -20 + bob * 0.5, 10, 10, '#4a3a2c'); g.fillStyle = '#e8e0d0'; g.fillRect(e.facing < 0 ? -22 : 18, -16, 2, 5); g.fillStyle = '#ff4030'; g.fillRect(e.facing < 0 ? -16 : 12, -18, 2, 2); }
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
  g.restore();
  hpBar(e.x - ox - 12, e.y - b.h - 10, 24, e.hp / e.max, '#ff5a4e');
  if (b.boss) { g.fillStyle = '#ff5a4e'; g.font = '700 11px "Chakra Petch"'; g.fillText(b.name.toUpperCase(), e.x - ox - 20, e.y - b.h - 16); }
}
function tracer(x1, y1, x2, y2, c, sc) { fx.tracers.push({ x1, y1, x2, y2, c, t: 0.09, sc: !!sc }); }
function burst(x, y, c, n, sc) { for (let i = 0; i < n; i++) fx.parts.push({ x, y, vx: rnd(-90, 90), vy: rnd(-140, 10), t: rnd(0.3, 0.7), c, sc: !!sc }); }
// Dust puff and sparks (fewer in Reduced motion; particle list capped)
function fxDust(x, y, n) { if (prefs.rm) n = Math.ceil(n / 2); if (fx.parts.length > 400) return; for (let i = 0; i < n; i++) fx.parts.push({ x: x + rnd(-6, 6), y: y + rnd(-4, 4), vx: rnd(-45, 45), vy: rnd(-90, -20), t: rnd(0.4, 0.9), c: i % 2 ? '#a8957a' : '#7d6c58', sc: false }); }
function fxSparks(x, y, n, dir) { if (prefs.rm) n = Math.ceil(n / 2); if (fx.parts.length > 400) return; for (let i = 0; i < n; i++) fx.parts.push({ x, y, vx: (dir || 0) * rnd(60, 200) + rnd(-80, 80), vy: rnd(-170, -30), t: rnd(0.15, 0.4), c: i % 2 ? '#ffd27a' : '#ff8a3a', sc: false }); }
// Shell casing: capped at 40 (oldest dropped); skipped in Reduced motion
function fxCasing(x, y) {
  if (prefs.rm) return;
  if (fx.casings.length >= 40) fx.casings.shift();
  fx.casings.push({ x, y, vx: rnd(-70, -20), vy: rnd(-150, -80), r: rnd(0, 6), vr: rnd(-12, 12), t: rnd(1.2, 2), b: 0 });
}
// Enemy hit sparks: fly back toward the turrets; more on a crit; skipped if the particle list is busy
function fxHit(x, y, crit) {
  if (scene !== 'bunker' || fx.parts.length > 250) return;
  let n = crit ? 7 : 3; if (prefs.rm) n = Math.ceil(n / 2);
  for (let i = 0; i < n; i++) fx.parts.push({ x, y: y + rnd(-6, 6), vx: -rnd(40, 190), vy: rnd(-150, -10), t: rnd(0.12, 0.32), c: crit ? (i % 2 ? '#ffffff' : '#ffe08a') : (i % 2 ? '#ffd27a' : '#ff8a3a'), sc: false });
}
function drawFx(ox, scOnly) {
  const sc = !!scOnly;
  for (const t of fx.tracers) if (t.sc === sc) { g.strokeStyle = t.c; g.globalAlpha = clamp(t.t / 0.09, 0, 1); g.lineWidth = 1.5; g.beginPath(); g.moveTo(t.x1 - ox, t.y1); g.lineTo(t.x2 - ox, t.y2); g.stroke(); }
  g.globalAlpha = 1;
  for (const p of fx.parts) if (p.sc === sc) { g.fillStyle = p.c; g.fillRect(p.x - ox, p.y, 3, 3); }
  if (!sc) for (const c of fx.casings) { g.save(); g.translate(c.x - ox, c.y); g.rotate(c.r); g.globalAlpha = clamp(c.t / 0.5, 0, 1); g.fillStyle = '#d9a441'; g.fillRect(-2, -1, 4, 2); g.restore(); }
  g.globalAlpha = 1;
  for (const b of fx.bullets) if ((b.world === 'scav') === sc) { const sp = Math.hypot(b.vx, b.vy || 0) || 1, ux = b.vx / sp, uy = (b.vy || 0) / sp; g.strokeStyle = '#ffe08a'; g.lineWidth = 2; g.beginPath(); g.moveTo(b.x - ox - ux * 5, b.y - uy * 5); g.lineTo(b.x - ox + ux * 5, b.y + uy * 5); g.stroke(); }
  // lock-on reticle around the enemy Mara would shoot
  if ((scene === 'scav') === sc && !placing && !itemTool && !digTool && !bcam.overview && !P.auto) { const t = aimTarget(); if (t) { const e = t.e, h = ENEMIES[e.type].h, w = ENEMIES[e.type].w, x = e.x - ox, y = e.y - h / 2, r = Math.max(w, h) / 2 + 6, q = r * 0.45; g.strokeStyle = '#ff5a4e'; g.lineWidth = 2; g.beginPath(); for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { g.moveTo(x + sx * r, y + sy * (r - q)); g.lineTo(x + sx * r, y + sy * r); g.lineTo(x + sx * (r - q), y + sy * r); } g.stroke(); g.fillStyle = '#ff5a4e'; g.fillRect(x - 1.5, y - 1.5, 3, 3); } }
  g.font = '700 12px "IBM Plex Sans"';
  for (const n of fx.nums) if (!!n.scav === sc) { g.fillStyle = n.wide ? 'rgba(255,214,150,' + clamp(n.t, 0, 1) + ')' : 'rgba(255,240,200,' + clamp(n.t / 0.7, 0, 1) + ')'; const w = g.measureText(String(n.s)).width; g.fillText(n.s, n.x - ox - w / 2, n.y); }
}
function fxTick(dt) {
  for (const t of fx.tracers) t.t -= dt; fx.tracers = fx.tracers.filter(t => t.t > 0);
  for (const p of fx.parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 400 * dt; p.t -= dt; } fx.parts = fx.parts.filter(p => p.t > 0);
  for (const c of fx.casings) {
    c.x += c.vx * dt; c.y += c.vy * dt; c.vy += 600 * dt; c.r += c.vr * dt; c.t -= dt;
    const fl = FLOORS[0] - 2;
    if (c.y > fl) { c.y = fl; if (c.b < 1 && c.vy > 60) { c.vy *= -0.35; c.vx *= 0.5; c.b++; } else { c.vy = 0; c.vx = 0; c.vr = 0; } }
  }
  fx.casings = fx.casings.filter(c => c.t > 0);
  for (const n of fx.nums) { n.y -= 24 * dt; n.t -= dt; } fx.nums = fx.nums.filter(n => n.t > 0);
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
  const t = prefs.rm ? 0 : performance.now() / 1000, TILE = 1800, N = 22;
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
  const t = prefs.rm ? 0 : performance.now() / 1000, span = W + 600;
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
function drawScav() {
  const ox = scav.cam, sky = skyColors();
  let gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, sky.top); gr.addColorStop(1, sky.bot);
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  if (sky.dayAmt < 0.6) { g.fillStyle = 'rgba(255,240,220,' + (0.6 - sky.dayAmt) + ')'; for (const s of stars) { g.beginPath(); g.arc(s.x, s.y, s.r, 0, 7); g.fill(); } }
  if (!prefs.hc) { drawScavRidge(ox, 0.12, 470, 70, 24, 'rgba(58,44,40,.55)'); drawScavRidge(ox, 0.25, 520, 55, 20, 'rgba(46,35,31,.65)'); }
  if (!prefs.hc) { drawScavSkyline(ox); drawScavHaze(ox, false); }
  // far ruins (parallax), the broken highway, near ruins
  for (const r of scav.ruins) { const x = r.x - ox * 0.4; if (x < -200 || x > W + 200) continue; g.fillStyle = r.c > 0.5 ? 'rgba(52,38,30,.8)' : 'rgba(44,32,26,.7)'; g.fillRect(x, SC_GROUND - r.h - 40, r.w, r.h + 40); g.fillStyle = 'rgba(255,190,110,.08)'; for (let wy = SC_GROUND - r.h; wy < SC_GROUND - 30; wy += 26) g.fillRect(x + 8, wy, 8, 10); }
  g.fillStyle = '#3e3026'; for (let x = -((ox * 0.7) % 220); x < W; x += 220) { g.fillRect(x, 420, 160, 14); g.fillRect(x + 60, 434, 16, 186); }
  if (!prefs.hc) drawScavHaze(ox, true);
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
  if (!prefs.hc) drawScavAsh(ox);
  if (sky.dayAmt < 1) { g.fillStyle = 'rgba(5,6,18,' + (0.5 * (1 - sky.dayAmt)) + ')'; g.fillRect(0, 0, W, H); }
  lampTick();
  drawScavLantern(ox);
  drawScavCompass(ox);
  drawScavMap();
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
    if (low && !S.lowFlag[r.k]) { S.lowFlag[r.k] = true; atLoc({ reset: true }); lamp(r.k === 'elec' ? elecHint(true) : 'Low on ' + r.name.toLowerCase() + ': ' + Math.floor(S.res[r.k]) + ' left.', 'warn'); }
    else if (!low && S.lowFlag[r.k] && S.res[r.k] >= lim * 1.25) S.lowFlag[r.k] = false;
  }
}
function logHTML() {
  if (!events.length) return '<p class="note">Nothing has happened yet.</p>';
  return '<div class="evlog">' + events.slice().reverse().map(e => `<div class="ev ${e.kind}${e.loc ? ' go' : ''}"${e.loc ? ` data-ev="${e.id}" title="Click to jump"` : ''}><span class="evt">${e.when}</span>${esc(e.text)}${e.loc ? ' <em>↗</em>' : ''}</div>`).join('') + '</div>';
}
// Lamp messages are staggered: each one holds the queue long enough to be read and spoken.
const LAMP_BASE_MS = 1200, LAMP_PER_CHAR_MS = 65, LAMP_MIN_MS = 3000, LAMP_QUEUE_MAX = 5;
const LAMP_URGENT = /door_breach|victory|defeat/;
let lampQ = [], lampBusyUntil = 0, lampTimer = null, lampRid = null;
function lampPump() {
  lampTimer = null;
  while (lampQ.length && S && S.rid !== lampQ[0].rid) lampQ.shift();
  if (!lampQ.length) return;
  const now = performance.now();
  if (now < lampBusyUntil) { lampTimer = setTimeout(lampPump, lampBusyUntil - now); return; }
  const it = lampQ.shift();
  logs.push({ text: it.text, kind: it.kind, at: now, ev: it.ev }); if (logs.length > 3) logs.shift(); renderLog();
  if (it.clip) narrPlay(it.clip);
  lampBusyUntil = now + Math.max(LAMP_MIN_MS, LAMP_BASE_MS + it.text.length * LAMP_PER_CHAR_MS);
  if (lampQ.length) lampTimer = setTimeout(lampPump, lampBusyUntil - now);
}
function lamp(text, kind = '', delayMs = 0, clip = null) {
  const loc = lampLoc; lampLoc = null;
  if (quiet) return;
  const ev = logEvent(kind, text, loc);
  const rid = S && S.rid;
  const add = () => {
    if (S && S.rid !== rid) return;
    if (S && S.rid !== lampRid) { lampRid = S.rid; lampQ = []; lampBusyUntil = 0; }
    if (clip && LAMP_URGENT.test(String(clip))) { lampQ = []; lampBusyUntil = 0; }
    srSay(text, kind);
    lampQ.push({ text, kind, clip, rid, ev });
    while (lampQ.length > LAMP_QUEUE_MAX) lampQ.shift();
    if (lampTimer) { clearTimeout(lampTimer); lampTimer = null; }
    lampPump();
  };
  delayMs ? setTimeout(add, delayMs) : add();
}
function renderLog() { $('#log').innerHTML = logs.map(l => `<div class="${l.kind}"${l.ev && l.ev.loc ? ` data-ev="${l.ev.id}" title="Click to jump"` : ''}><b>LAMP</b>${esc(l.text)}</div>`).join(''); }
$('#log').addEventListener('click', e => {
  const el = e.target.closest('[data-ev]'); if (!el) return;
  const ev = events.find(x => String(x.id) === el.dataset.ev); if (ev) jumpTo(ev.loc);
});
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
function renderHud() {
  if (!S) { $('#hud').innerHTML = ''; const g = $('#goals'); if (g) g.hidden = true; return; }
  renderGoals();
  const th = nextThreat(), pl = S.player;
  requestAnimationFrame(raidPopUpdate);
  $('#hud').innerHTML = `<span class="clock">${clockText()}</span>
    <span class="res">${RES.map(r => { const v = Math.floor(S.res[r.k]); const low = resLow(r.k); return `<span class="${low ? 'lowres' : ''}" title="${r.k === 'elec' ? esc(elecHint()) : r.name + (low ? ' (low)' : '')}"><i style="background:${r.color}"></i>${low ? '<em class="lowico" aria-hidden="true">&#9888;</em>' : ''}${({ elec: 'Elec', mat: 'Mat' })[r.k] || r.name} <b class="${low ? 'low' : ''}">${v}</b>${low ? '<em class="lowtag">LOW</em>' : ''}</span>`; }).join('')}</span>
    <span class="res"><span class="${kit().cooked < 2 ? 'lowres' : ''}" title="Prepared meals at the serving station${kit().cooked < 2 ? ' (low)' : ''}"><i style="background:#e8b86a"></i>${kit().cooked < 2 ? '<em class="lowico" aria-hidden="true">&#9888;</em>' : ''}Meals <b class="${kit().cooked < 2 ? 'low' : ''}">${Math.floor(kit().cooked)}</b></span></span>
    <span class="threat ${th.hot ? 'hot' : ''}" data-raid="1" style="cursor:pointer" title="Click for raid details">${esc(th.text)} ${raidOpen ? '&#9662;' : '&#9656;'}</span>
    <span class="threat" title="Mara">Mara ${Math.ceil(pl.hp)}/${pl.maxHp}${pl.down ? ' · down' : ''}</span>
    <span class="spd">${[0, 1, 2, 4].map(s => `<button data-spd="${s}" class="${(s === 0 ? paused : (!paused && speed === s)) ? 'on' : ''}" title="${s ? s + 'x speed (' + (s === 4 ? 3 : s) + ')' : 'Pause (P)'}">${s ? s + 'x' : 'II'}</button>`).join('')}</span>`;
}
document.addEventListener('click', e => { const b = e.target.closest('[data-spd]'); if (!b) return; const s = +b.dataset.spd; if (s === 0) paused = !paused; else setSpeed(s); renderHud(); });

let tab = 'crew', sel = null, hover = null;
const crewView = { sort: 'default', need: 'all', job: 'all', state: 'all', compact: null }; // compact: null = auto (on above 24 living crew)
function compactOn() { return crewView.compact === null ? living().length > 24 : !!crewView.compact; }
let focusFx = null; // { id, t } ring drawn on a crew member after clicking their card
function crewStateKey(c) { return c.state === 'sleep' ? 'sleep' : c.state === 'patient' ? 'patient' : c.state === 'fight' ? 'fight' : c.state === 'walk' ? 'walk' : 'work'; }
function crewNeeds(c) { return { hp: c.hp / c.maxHp * 100, food: c.food, rest: restPct(c) }; }
function crewFilterActive() { return crewView.need !== 'all' || crewView.job !== 'all' || crewView.state !== 'all'; }
function crewPass(c) {
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
  if (s === 'name') return a.name.localeCompare(b.name);
  if (s === 'hp') return crewNeeds(a).hp - crewNeeds(b).hp;
  if (s === 'food') return crewNeeds(a).food - crewNeeds(b).food;
  if (s === 'rest') return crewNeeds(a).rest - crewNeeds(b).rest;
  if (s === 'lvl') return b.lvl - a.lvl;
  return b.named - a.named;
}
function crewControls() {
  const sel2 = (key, opts) => `<select data-view="${key}" aria-label="${key}">${opts.map(([v, l]) => `<option value="${v}" ${crewView[key] === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  return `<div class="row" style="margin:6px 0;gap:4px;flex-wrap:wrap">
    ${sel2('sort', [['default', 'Sort: default'], ['name', 'Sort: name'], ['hp', 'Sort: health'], ['food', 'Sort: food'], ['rest', 'Sort: rest'], ['lvl', 'Sort: level']])}
    ${sel2('need', [['all', 'Need: all'], ['any', 'Any need'], ['hp', 'Low health'], ['food', 'Hungry'], ['rest', 'Tired']])}
    ${sel2('job', [['all', 'Job: all'], ...Object.entries(JOBS).filter(([k, j]) => !j.hidden).map(([k, j]) => [k, j.label])])}
    ${sel2('state', [['all', 'State: all'], ['work', 'Working'], ['walk', 'Walking'], ['sleep', 'Sleeping'], ['patient', 'Med bay'], ['fight', 'Fighting']])}
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
function openDrawer(t) { uiSfx('Open'); tab = t; $('#drawer').hidden = false; $('#wrap').classList.add('dopen'); renderDrawer(); syncDrawerButtons(); }
function setDrawerCollapsed(on) {
  $('#drawer').classList.toggle('collapsed', on); $('#wrap').classList.toggle('dcol', on);
  const b = $('#dCollapse'); if (b) { b.textContent = on ? '«' : '»'; b.setAttribute('aria-expanded', on ? 'false' : 'true'); b.setAttribute('aria-label', on ? 'Expand panel' : 'Collapse panel'); }
}
function closeDrawer() { uiSfx('Close'); setDrawerCollapsed(false); $('#drawer').hidden = true; $('#wrap').classList.remove('dopen'); syncDrawerButtons(); }
function toggleDrawer(t) { if (!$('#drawer').hidden && $('#drawer').classList.contains('collapsed')) { setDrawerCollapsed(false); openDrawer(t); } else if (!$('#drawer').hidden && tab === t) closeDrawer(); else openDrawer(t); }
let pendingFocus = null;
function bar(pct, c, kind, label) { const v = Math.round(clamp(pct, 0, 100)); const a = label ? ` role="progressbar" aria-label="${label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${v}"` : ' aria-hidden="true"'; return `<div class="bar"${a}><i class="${kind ? 'p-' + kind : ''}" style="width:${clamp(pct, 0, 100)}%;background:${c}"></i></div>`; }
function canPay(c) { return Object.entries(c).every(([k, v]) => S.res[k] >= v); }
function pay(c) { for (const [k, v] of Object.entries(c)) S.res[k] -= v; }
function renderDrawer() {
  if ($('#drawer').hidden || !S) return;
  document.querySelectorAll('.tabs [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  const body = $('#dbody'); const keep = body.scrollTop; const fk = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.view : null;
  const ae = document.activeElement, fc = ae && ae.dataset && ae.dataset.fk ? ae.dataset.fk : null;
  body.innerHTML = tab === 'crew' ? crewHTML() : tab === 'build' ? buildHTML() : tab === 'rel' ? relHTML() : tab === 'log' ? logHTML() : tab === 'gear' ? gearHTML() : towerHTML();
  body.scrollTop = keep;
  if (fk) { const el = body.querySelector(`[data-view="${fk}"]`); if (el) el.focus(); }
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
  ${crewControls()}<button class="chip ${compactOn() ? 'on' : ''}" data-act="compact" title="One-line rows for big crews">Compact</button> <button class="chip" data-act="resetcam" title="Zoom out and stop following">Reset view</button><p class="note" style="margin:0">Showing ${shown} of ${total}</p>${shown === 0 && total > 0 ? '<p class="note">Nobody matches these filters.</p>' : ''}
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
      <div class="bars"><span>Health</span>${bar(c.hp / c.maxHp * 100, '#7ddc6f', 'hp', 'Health')}<span>Food</span>${bar(c.food, '#c9a27a', 'food', 'Food')}<span style="white-space:nowrap">Rest${prefs.cb && sf < 0.6 ? ' \u26A0' : ''}</span>${bar(rest, sf < 0.6 ? '#ff5a4e' : '#7fc8ff', sf < 0.6 ? 'low' : 'rest', 'Rest')}</div>
      <div class="row">${Object.entries(JOBS).filter(([k, j]) => !j.hidden).map(([k, j]) => { const dis = k === 'turretA' && !S.turrets.some(t => t && t.type !== 'coil'); return `<button class="chip ${c.job === k || (k === 'turretA' && c.job === 'turretB') ? 'on' : ''}" data-job="${k}" data-id="${c.id}" ${dis ? 'disabled title="Build a gun turret first"' : (k === 'turretA' ? 'title="Picks a gun turret automatically"' : '')}>${j.label}</button>`; }).join('')}</div>
      <div class="row" style="margin-top:5px">${Object.entries(SHIFTS).map(([k, s]) => { const p = n => String(n % 24).padStart(2, '0') + ':00', h = Math.floor(hourF()), awake = !s.sleep || !(s.sleep[0] > s.sleep[1] ? (h >= s.sleep[0] || h < s.sleep[1]) : (h >= s.sleep[0] && h < s.sleep[1])); return `<button class="chip ${c.shift === k ? 'on' : ''}" data-shift="${k}" data-id="${c.id}" title="${awake ? 'Awake right now' : 'Asleep right now'}">${awake ? '● ' : ''}${s.sleep ? 'Sleeps ' + p(s.sleep[0]) + '-' + p(s.sleep[1]) : s.label}</button>`; }).join('')}</div>
      ${gearRow(c)}
      ${schedHTML(c)}
      <div class="row" style="margin-top:5px"><button class="chip" data-rest="${c.id}" title="Hold to give a rest day: sleep and meals for 24h, morale boost" style="${restHold && restHold.id === c.id ? 'background:linear-gradient(90deg,#3a7a4a ' + Math.min(100, (performance.now() - restHold.t0) / REST_HOLD_MS * 100) + '%,transparent 0)' : ''}">${restActive(c) ? 'Resting (hold to renew)' : 'Hold: Rest day'}</button>${restActive(c) ? '<span class="note" style="margin:0 0 0 6px">Rest day: schedule is sleep and meals, morale +' + REST_BOOST + '</span>' : ''}</div>
      ${bgHTML(c)}<div class="note">Aim ${pctS(c.stats.acc)} · Build ${pctS(c.stats.build)} · Cook ${pctS(c.stats.cook)} · Medic ${pctS(c.stats.med)} · Tech ${pctS(c.stats.tech)}${sf < 1 ? ` · <span style="color:var(--red)">working at ${Math.round(sf * 100)}% (tired)</span>` : ''}${c.grief > 0 ? ' · grieving' : ''}${bondNames.length ? `<br>Works better beside ${esc(bondNames.join(', '))}` : ''}<br>Morale ${Math.round(morale(c))}${morale(c) < 40 ? ' <span style="color:var(--red)">· slow' + (!c.named && c.loyalty < 1 ? ', might leave' : '') + '</span>' : ''}</div>
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
  // furniture bought one piece at a time (auto-placed in the next free spot) and installable buildings
  const own = t => itemList().filter(it => it.type === t).length;
  const buy = (t, cat, desc, top) => { const T = ITEM_TYPES[t]; const h = item(T.name + ' <span class="tag">' + own(t) + ' built</span>', desc, T.cost, 'buy_' + t, !!ROOMS[T.room], 'Build'); if (top) CATS[cat].unshift(h); else CATS[cat].push(h); };
  const beds = bedCount(), crewN = living().length;
  buy('bunk', 'furniture', 'Each bunk gives two crew a bed. Beds: ' + beds + ' for ' + crewN + ' crew. People without one sleep on the floor and rest worse.', true);
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
function jobChipFeedback(id, job, name, walking) {
  const label = (JOBS[job] && JOBS[job].label) || job;
  lamp(walking ? name + ' assigned to ' + label + ' \u2013 walking there now.' : name + ' set to ' + label + '.', 'good');
  if (window.SFX && SFX.click) SFX.click();
  const chip = document.querySelector('#dbody [data-job="' + (job === 'turretB' ? 'turretA' : job) + '"][data-id="' + id + '"]');
  if (chip && chip.animate && !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) {
    chip.animate([{ transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(255,200,90,.9)' }, { transform: 'scale(1.18)', boxShadow: '0 0 0 6px rgba(255,200,90,0)' }, { transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(255,200,90,0)' }], { duration: 450, easing: 'ease-out' });
  }
}
$('#dbody').addEventListener('click', e => {
  const j = e.target.closest('[data-job]'), s = e.target.closest('[data-shift]'), b = e.target.closest('[data-build]'), card = e.target.closest('[data-crew]');
  if (e.target.closest('[data-act="compact"]')) { crewView.compact = !compactOn(); renderDrawer(); return; }
  const bc = e.target.closest('[data-bcat]'); if (bc) { buildCat = bc.dataset.bcat; renderDrawer(); return; }
  const gb = e.target.closest('[data-gear]');
  if (gb) { gearAct(gb.dataset.gear, gb.dataset.g, gb.dataset.id); renderDrawer(); renderHud(); return; }
  const br = e.target.closest('[data-brush]'), cell = e.target.closest('[data-cell]');
  if (br) { schedBrush = br.dataset.brush; renderDrawer(); return; }
  if (cell) { const c = S.crew.find(x => x.id === cell.dataset.id); if (c) { const a = ensureSched(c).split(''); a[+cell.dataset.cell] = schedBrush; c.sched = a.join(''); c.shift = 'custom'; c.restUntil = 0; c.restPrev = null; sel = c.id; } renderDrawer(); return; }
  if (j) { if (j.dataset.id === 'player') { S.player.job = j.dataset.job; renderDrawer(); jobChipFeedback('player', S.player.job, S.player.name || 'Mara', false); return; } const c = S.crew.find(x => x.id === j.dataset.id); c.job = j.dataset.job; if (c.job === 'turretA' || c.job === 'turretB') c.job = autoTurret(c); if (tut) tut.job = true; c.alarmSlot = null; sel = c.id; renderDrawer(); jobChipFeedback(c.id, c.job, c.name, true); return; }
  if (s) { const c = S.crew.find(x => x.id === s.dataset.id); c.shift = s.dataset.shift; c.sched = defaultSched(c.shift); c.restUntil = 0; c.restPrev = null; sel = c.id; renderDrawer(); return; }
  if (b) { doBuild(b.dataset.build); renderDrawer(); renderHud(); return; }
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
function drawItems(k, r) {
  if (!S || typeof r.x0 !== 'number') return;
  const yb = FLOORS[r.floor];
  if (itemTool) {
    g.strokeStyle = 'rgba(255,214,150,.15)'; g.lineWidth = 1;
    for (let x = Math.ceil((r.x0 - ITX0) / ITILE) * ITILE + ITX0; x < r.x1; x += ITILE) { g.beginPath(); g.moveTo(x, yb - ITILE * 4); g.lineTo(x, yb); g.stroke(); }
    for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(r.x0, yb - i * ITILE); g.lineTo(r.x1, yb - i * ITILE); g.stroke(); }
  }
  for (const it of itemList()) {
    if (it.room !== k) continue;
    const T = ITEM_TYPES[it.type], x = ITX0 + it.col * ITILE;
    drawItemSprite(it.type, x, yb, T.w * ITILE, T);
    g.fillStyle = '#ffd24a';
    for (let i = 0; i < (it.lvl || 1); i++) g.fillRect(x + 4 + i * 7, yb - 40, 5, 5);
  }
  if (k === 'common') drawPantry(yb);
  if (itemTool && scene === 'bunker') {
    const c = itemCellAt(bcamToWorld({ x: mouse.x, y: mouse.y }));
    if (c && c.k === k) {
      const T = ITEM_TYPES[itemSel], hit = itemHit(k, c.col);
      if (hit) { g.fillStyle = 'rgba(255,210,74,.3)'; g.fillRect(ITX0 + hit.col * ITILE, yb - 28, ITEM_TYPES[hit.type].w * ITILE, 28); }
      else { const ok = T.room === k && itemSpotOk(k, r, c.col, T.w); g.fillStyle = ok ? 'rgba(90,220,110,.4)' : 'rgba(230,70,70,.4)'; g.fillRect(ITX0 + c.col * ITILE, yb - 28, T.w * ITILE, 28); }
    }
  }
}
let itemTool = false, itemSel = 'stove';
const itemUI = document.createElement('div');
itemUI.style.cssText = 'position:fixed;left:10px;bottom:84px;z-index:40;display:none;font:600 12px "Chakra Petch",sans-serif;color:#ffd9a0;background:rgba(20,14,8,.9);border:1px solid #5a4428;padding:6px;border-radius:6px;max-width:220px';
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
  const show = scene === 'bunker' && !!S && !S.over;
  if (!show && itemTool) { itemTool = false; renderItemUI(); }
  itemUI.style.display = show ? 'block' : 'none';
}, 500);
renderItemUI();
function doBuild(a) {
  const rep = s => { const c = { scrap: Math.ceil((s.max - s.hp) / 10) }; if (!canPay(c)) return false; pay(c); s.hp = s.max; return true; };
  if (a === 'repDoor') { if (S.enemies.some(e => e.inside) || !rep(S.door)) return; S.breached = false; lampEv('door_repair', 'Hatch repaired.', 'good'); }
  else if (a === 'repWall') { if (rep(S.wall)) lamp('Wall repaired.', 'good'); }
  else if (a === 'upWall') { const c = { scrap: 30, mat: 12 }; if (!canPay(c)) return; pay(c); S.wall.lvl = 2; S.wall.max = 600; S.wall.hp = 600; lamp('The wall is reinforced.', 'good'); }
  else if (/^turret\d/.test(a)) { const i = +a[6], k = a.slice(7), sp = TURRETS[k]; if (!canPay(sp.cost) || S.turrets[i]) return; pay(sp.cost); S.turrets[i] = { type: k, hp: sp.hp, max: sp.hp, lvl: 1, cd: 0 }; uiSfx('Place'); lamp(sp.name + ' built in slot ' + (i + 1) + (k === 'coil' ? '. It runs on generator power, no crew needed.' : '. Give someone the Turret job in Crew.'), 'good'); balanceTurrets(); }
  else if (/^repT/.test(a)) rep(S.turrets[+a[4]]);
  else if (/^upT/.test(a)) { const c = { parts: 8, elec: 2 }; if (!canPay(c)) return; pay(c); S.turrets[+a[3]].lvl = 2; lamp('Turret ' + (+a[3] + 1) + ' upgraded.', 'good'); }
  else if (a === 'upHydro' || a === 'upMed' || a === 'upBunks') { const k = a.slice(2).toLowerCase(); const c = { hydro: { elec: 3, mat: 8 }, med: { elec: 3, mat: 6 }, bunks: { scrap: 10, mat: 10 } }[k]; if (!canPay(c)) return; pay(c); S.rooms[k] = 2; lamp(ROOMS[k].name + ' upgraded.', 'good'); }
  else if (/^room_/.test(a)) { const k = a.slice(5), r = BUILD_ROOMS[k]; if (!r || S.rooms[k]) return; if (!canPay(r.cost)) { uiSfx('Error'); lamp('The ' + ROOMS[k].name + ' needs ' + fmtCost(r.cost) + '.', 'warn'); return; } startPlace({ kind: 'room', k }); }
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
var hoverRoom = null, focusT = null, lpTimer = null, lpStart = null, tipSR = null;
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
  return crew.concat(rooms);
}
function tipInfo(t) {
  if (!t || !S) return null;
  if (t.type === 'crew') {
    const c = S.crew.find(x => x.id === t.id);
    if (!c || !c.alive || c.left || c.exp) return null;
    const n = crewNeeds(c);
    return { box: { x: c.x - 12, y: c.y - 42, w: 24, h: 44 }, ax: c.x, ay: c.y - 46, lines: [String(c.name), (JOBS[c.job] ? JOBS[c.job].label : '-') + ' · ' + c.state + (c.sick ? ' · sick' : ''), 'HP ' + Math.round(n.hp) + '  Food ' + Math.round(n.food) + '  Rest ' + Math.round(n.rest)] };
  }
  const r = ROOMS[t.k]; if (!r) return null;
  const b = roomBox(t.k), lv = S.rooms && S.rooms[t.k];
  const staff = r.job ? living().filter(c => c.job === r.job).length : 0;
  const lines = [r.name + (typeof lv === 'number' ? ' (level ' + lv + ')' : '')];
  if (r.job) lines.push((JOBS[r.job] ? JOBS[r.job].label : r.job) + ' · staff ' + staff);
  return { box: b, ax: b.x + b.w / 2, ay: b.y + 4, lines };
}
function curTipTarget() {
  if (scene !== 'bunker' || !S) return null;
  if (focusT && focusT.until && performance.now() > focusT.until) focusT = null;
  if (mouse.inCv && hover) return { type: 'crew', id: hover.id };
  if (mouse.inCv && hoverRoom) return { type: 'room', k: hoverRoom };
  return focusT;
}
function setFocusT(t, ms) {
  focusT = t ? Object.assign({}, t, ms ? { until: performance.now() + ms } : {}) : null;
  const i = focusT && tipInfo(focusT);
  if (tipSR) tipSR.textContent = i ? i.lines.join('. ') : '';
}
function drawTipHighlight() {
  const i = tipInfo(curTipTarget()); if (!i) return;
  g.save(); g.strokeStyle = '#ffc857'; g.lineWidth = 2; if (prefs.cb) g.setLineDash([8, 5]);
  g.strokeRect(i.box.x, i.box.y, i.box.w, i.box.h); g.restore();
}
function drawInfoTip() {
  const i = tipInfo(curTipTarget()); if (!i) return;
  const v = bcamView();
  g.save(); g.font = '12px sans-serif'; g.textBaseline = 'top';
  const pad = 6, lh = 15, w = Math.max(...i.lines.map(s => g.measureText(s).width)) + pad * 2, h = i.lines.length * lh + pad * 2;
  let x = (i.ax - v.ox) * v.z - w / 2, y = (i.ay - v.oy) * v.z - h - 6;
  if (y < 4) y = (i.ay - v.oy) * v.z + 24;
  x = clamp(x, 4, W - w - 4); y = clamp(y, 4, H - h - 4);
  g.fillStyle = 'rgba(14,10,7,.92)'; g.fillRect(x, y, w, h);
  g.strokeStyle = '#ffc857'; g.lineWidth = 1; if (prefs.cb) g.setLineDash([5, 3]); g.strokeRect(x + .5, y + .5, w - 1, h - 1); g.setLineDash([]);
  g.fillStyle = '#f2e6d0';
  i.lines.forEach((s, n) => { if (n === 0) g.font = 'bold 12px sans-serif'; else g.font = '12px sans-serif'; g.fillText(s, x + pad, y + pad + n * lh); });
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
    const same = (a, b) => a && b && a.type === b.type && (a.id === b.id) && (a.k === b.k);
    let i = list.findIndex(t => same(t, focusT));
    i = i < 0 ? (e.shiftKey ? list.length - 1 : 0) : i + (e.shiftKey ? -1 : 1);
    if (i < 0 || i >= list.length) { setFocusT(null); return; }
    e.preventDefault(); e.stopPropagation(); setFocusT(list[i]);
  } else if (e.key === 'Enter' && focusT && focusT.type === 'crew') {
    e.preventDefault(); e.stopPropagation();
    sel = focusT.id; openDrawer('crew');
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
  if (lpStart && Math.hypot(p.x - lpStart.x, p.y - lpStart.y) > 10) lpCancel();
});
cv.addEventListener('pointerdown', e => {
  if (scene !== 'bunker' && scene !== 'scav') return;
  const p = toCanvas(e);
  if (e.pointerType === 'touch' && scene === 'bunker' && S) {
    lpCancel(); lpStart = { x: p.x, y: p.y };
    lpTimer = setTimeout(() => {
      lpTimer = null; if (!lpStart) return;
      const w = bcamToWorld(lpStart), c = personAt(w.x, w.y), rk = c ? null : roomAt(w.x, w.y);
      if (c) setFocusT({ type: 'crew', id: c.id }, 4000); else if (rk) setFocusT({ type: 'room', k: rk }, 4000);
    }, 450);
  }
  if (e.button === 2 && scene === 'bunker') { bcam.pan = { x: p.x, y: p.y }; return; }
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
    if (t) { P.facing = 1; P.cd = 0.34; fx.bullets.push({ x: P.x + 12, y: P.y - 20, vx: 900, life: 0.55, dmg: Math.round((13 + S.player.lvl * 2) * armoryMult()), world: scene }); }
  }
  P.inMed = P.floor === 2 && P.x > ROOMS.med.x0 && !P.climbing;
}
function maraWorkTick(mins) {
  if (!P.auto || !P.autoWork || S.player.down) return;
  const h = mins / 60, job = P.autoWork;
  const m = { stats: MARA_STATS, food: 100, awake: 0, grief: 0, bonds: [], state: 'work', job, xp: 0, lvl: 1, cd: 0 };
  const e = eff(m) * (S.powered && POWERED_JOBS.includes(job) ? ROOM_FX.powerBoost : 1);
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
  if (bcam.overview && mouse.inCv && !bcam.pan) {
    const m = 40, sp = 700 / bcam.z; let dx = 0, dy = 0;
    if (mouse.x < m) dx = -1; else if (mouse.x > W - m) dx = 1;
    if (mouse.y < m) dy = -1; else if (mouse.y > H - m) dy = 1;
    if (dx || dy) { bcam.follow = null; bcam.anchor = null; bcam.cx += dx * sp * dt; bcam.cy += dy * sp * dt; const v = bcamView(); bcam.cx = v.ox + W / v.z / 2; bcam.cy = v.oy + H / v.z / 2; }
  }
}
cv.addEventListener('wheel', e => { if (scene !== 'bunker') return; e.preventDefault(); const p = toCanvas(e), w = bcamToWorld(p); bcam.tz = clamp(bcam.tz * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 1, 3); if (bcam.tz < 1.02) bcam.tz = 1; if (!bcam.follow) bcam.anchor = { wx: w.x, wy: w.y, sx: p.x, sy: p.y }; }, { passive: false });
cv.addEventListener('pointerleave', () => { mouse.inCv = false; });
cv.addEventListener('contextmenu', e => { if (scene === 'bunker') e.preventDefault(); });
window.addEventListener('pointerup', () => { bcam.pan = null; });
$('#dbody').addEventListener('click', e => { if (e.target.closest && e.target.closest('[data-act="resetcam"]')) bcamReset(); });
function personAt(x, y) { return living().find(c => Math.abs(c.x - x) < 11 && y < c.y + 2 && y > c.y - 40) || null; }
// remappable keys (movement, jump, shoot, interact); arrows always work for movement
const BIND_DEF = { left: 'a', right: 'd', up: 'w', down: 's', jump: ' ', shoot: 'j', interact: 'e' };
const BIND_LABELS = [['left', 'Move left'], ['right', 'Move right'], ['up', 'Climb up / jump'], ['down', 'Climb down / drop'], ['jump', 'Jump'], ['shoot', 'Shoot'], ['interact', 'Interact']];
const BIND_ARROWS = { left: 'arrowleft', right: 'arrowright', up: 'arrowup', down: 'arrowdown' };
const BIND_RESERVED = ['c', 'b', 't', 'r', 'g', 'm', 'h', 'v', 'x', 'p', 'o', '1', '2', '3', 'escape'];
const BIND = Object.assign({}, BIND_DEF);
try {
  const sv = JSON.parse(localStorage.getItem('ashfall.binds') || '{}');
  for (const a in BIND_DEF) if (typeof sv[a] === 'string' && sv[a].length && !BIND_RESERVED.includes(sv[a])) BIND[a] = sv[a];
} catch (_) {}
function saveBinds() { try { localStorage.setItem('ashfall.binds', JSON.stringify(BIND)); } catch (_) {} }
function kd(a) { return !!(keys[BIND[a]] || keys['t:' + BIND_DEF[a]] || (BIND_ARROWS[a] && keys[BIND_ARROWS[a]])); }
function keyLabel(k) { return k === ' ' ? 'Space' : k.startsWith('arrow') ? k.slice(5).toUpperCase() : k.length === 1 ? k.toUpperCase() : k; }
function setBind(a, k) {
  const other = Object.keys(BIND).find(x => x !== a && BIND[x] === k);
  if (other) BIND[other] = BIND[a];
  BIND[a] = k; saveBinds();
}
function startRebind(a, btn, done) {
  btn.textContent = 'Press a key…';
  const h = e => {
    e.preventDefault(); e.stopImmediatePropagation();
    const k = e.key.toLowerCase();
    if (['shift', 'control', 'alt', 'meta', 'tab', 'capslock', 'dead'].includes(k)) return;
    window.removeEventListener('keydown', h, true);
    if (k !== 'escape' && !BIND_RESERVED.includes(k)) setBind(a, k);
    done();
  };
  window.addEventListener('keydown', h, true);
}
window.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (overlayKey(e, k)) return;
  if ($('#sBack')) { if (k === 'escape') { e.preventDefault(); $('#sBack').click(); } return; }
  if (e.target.tagName === 'INPUT') return;
  if (document.querySelector('#overlay .help')) { helpKey(e, k); return; }
  if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', BIND.jump].includes(k)) e.preventDefault();
  if (scene === 'menu' || scene === 'over') return;
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
  if (k === 'x' && scene === 'bunker' && S) toggleDig();
  if (k === 'l' && scene === 'bunker' && S) { if (placing && placing.kind === 'ladder') cancelPlace(); else startPlace({ kind: 'ladder' }); }
  if (k === 'p') { paused = !paused; renderHud(); }
  if (k === '1' || k === '2' || k === '3') setSpeed(k === '3' ? 4 : +k);
  if ((k === '[' || k === ']') && scene === 'bunker' && S) cycleCrew(k === ']' ? 1 : -1);
  if (k === 'escape') { if (placing) cancelPlace(); else if (!$('#drawer').hidden) closeDrawer(); else showPauseMenu(); }
});
window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
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
// visible keyboard hint bar (hidden on touch devices and outside bunker/scavenge play)
(function keyBar() {
  const st = document.createElement('style');
  st.textContent = '#keybar{position:absolute;left:50%;bottom:6px;transform:translateX(-50%);padding:3px 10px;background:#120d08cc;border:1px solid var(--line);font-size:12px;line-height:1.4;white-space:nowrap;pointer-events:none;z-index:3;color:#cdb99a}#keybar kbd{margin:0 3px 0 0;padding:0 4px;border:1px solid var(--line);border-radius:3px}#keybar span{margin-right:10px}#keybar span:last-child{margin-right:0}body.touch #keybar{display:none}';
  document.head.appendChild(st);
  const el = document.createElement('div');
  el.id = 'keybar'; el.hidden = true; el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '<span><kbd>P</kbd>Pause</span><span><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd>Speed</span><span><kbd>C</kbd>Crew</span><span><kbd>[</kbd><kbd>]</kbd>Prev/next survivor</span>';
  const w = document.getElementById('wrap'); if (w) w.appendChild(el);
  setInterval(() => { el.hidden = !((scene === 'bunker' || scene === 'scav') && S && !S.over); }, 300);
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

// touch controls: buttons drive the same key state as the keyboard
function markTouch() { document.body.classList.add('touch'); }
if (window.matchMedia && matchMedia('(pointer: coarse)').matches) markTouch();
window.addEventListener('pointerdown', e => { if (e.pointerType === 'touch') markTouch(); }, true);
document.querySelectorAll('#touch button').forEach(b => {
  const k = b.dataset.k;
  const release = () => { if (k !== undefined) keys['t:' + k] = false; b.classList.remove('on'); };
  b.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (scene !== 'bunker' && scene !== 'scav') return;
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
document.addEventListener('pointerover', e => {
  if (e.pointerType === 'touch') return;
  const b = e.target && e.target.closest ? e.target.closest('button:not(:disabled), .chip') : null;
  if (b && b !== lastHoverEl) { lastHoverEl = b; uiSfx('Hover'); }
  else if (!b) lastHoverEl = null;
});
$('#tCrew').onclick = () => toggleDrawer('crew');
$('#tBuild').onclick = () => toggleDrawer('build');
$('#tTower').onclick = () => toggleDrawer('tower');
$('#tAlarm').onclick = () => toggleAlarm();
$('#tHelp').onclick = () => showHelp(true);
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
  if (k === 'tab' && !o.querySelector('.help')) {
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
  if (k === 'escape' && $('#pRes')) { e.preventDefault(); $('#pRes').click(); return true; }
  // let focused overlay buttons activate natively with Space/Enter
  if ((k === ' ' || k === 'enter') && e.target && e.target.tagName === 'BUTTON') return true;
  return false;
}
// ---- screen-reader announcements (dedicated live regions)
let srEls = null, srLast = { text: '', at: 0 };
function srSay(text, kind) {
  if (!text) return;
  const now = performance.now();
  if (srLast.text === text && now - srLast.at < 2000) return;
  srLast = { text, at: now };
  if (!srEls) {
    const mk = (role, live) => { const d = document.createElement('div'); d.className = 'sr-only'; d.setAttribute('role', role); d.setAttribute('aria-live', live); d.setAttribute('aria-atomic', 'true'); document.body.appendChild(d); return d; };
    srEls = { polite: mk('status', 'polite'), assertive: mk('alert', 'assertive') };
  }
  const el = kind === 'warn' ? srEls.assertive : srEls.polite;
  el.textContent = '';
  setTimeout(() => { el.textContent = text; }, 60);
}
let srState = null;
setInterval(() => {
  try {
    if (!S || S.over || (scene !== 'bunker' && scene !== 'scav')) return;
    const raid = !!((S.enemies && S.enemies.length) || (S.spawns && S.spawns.length));
    const low = {}; RES.forEach(r => { low[r.k] = !!resLow(r.k); });
    const meals = kit().cooked < 2;
    if (!srState || srState.rid !== S.rid) { srState = { rid: S.rid, raid, low, meals }; return; }
    if (raid && !srState.raid) srSay('Wave incoming. ' + nextThreat().text, 'warn');
    else if (!raid && srState.raid) srSay('Wave cleared.');
    RES.forEach(r => { if (low[r.k] && !srState.low[r.k]) srSay(r.name + ' is low', 'warn'); });
    if (meals && !srState.meals) srSay('Meals are low', 'warn');
    srState = { rid: S.rid, raid, low, meals };
  } catch (_) {}
}, 1000);
const HELP = `<div class="help" tabindex="0" aria-label="Controls and tips. Use the arrow keys to scroll.">
  <h3>THE LOOP</h3><ul><li>Days are for work: give the crew jobs and shifts, build, and scavenge topside.</li><li>At ${RAID_CLOCK} every night something attacks from the east. Bigger every night. Cinder comes on night 3.</li><li>Finish the four stages of the <b>signal tower</b> to win. Lose if everyone dies.</li></ul>
  <h3>THE CREW</h3><ul><li>Turrets only fire with someone on them. Good shots hit more.</li><li>Shifts decide who sleeps when. Past 16 hours awake people slow down fast. Hungry or grieving people work slower.</li><li>Meals are at 07:00, 13:00 and 19:00. Kitchen crew grow raw food and cook it into meals (1 food each) at the serving station; hungry crew fetch a meal there and eat it in the common room.</li><li>Badly hurt crew go to the med bay on their own. Doc heals them faster.</li><li>Bram, Doc and Tick share history: paired on a job they work better. Lose one and the others grieve.</li><li>Newcomers may leave in the night with your supplies if morale is low.</li></ul>
  <h3>CONTROLS</h3><ul><li><kbd>A</kbd><kbd>D</kbd> move · <kbd>W</kbd><kbd>S</kbd> climb the shaft · <kbd>${keyLabel(BIND.jump)}</kbd> jump · <kbd>${keyLabel(BIND.shoot)}</kbd> or click to shoot the enemy under your mouse (it locks onto anything within about 3 tiles of the cursor, shown by red brackets; no target, no shot)</li><li><kbd>${keyLabel(BIND.interact)}</kbd> interact: walk off the right edge of the surface to scavenge · search crates · invite wanderers</li><li><kbd>C</kbd> crew · <kbd>B</kbd> build · <kbd>T</kbd> tower · <kbd>G</kbd> battle stations · <kbd>H</kbd> help · <kbd>P</kbd> pause · <kbd>1</kbd>–<kbd>3</kbd> speed · click a person to select them</li><li class="touchonly"><b>Touch:</b> left pad moves and climbs (▲▼), JUMP jumps, FIRE shoots the nearest enemy Mara is facing, E interacts. Tap a person to select them. Use the top buttons for Crew, Build and Tower.</li></ul>
</div>`;
function showMenu() {
  scene = 'menu'; tutHide(); const sv = loadSave();
  overlay(`<div class="menu"><h1>ASHFALL<br>BUNKER</h1><p class="sub">Twenty years after the bombs. A hole in the ground, a handful of people, and a dead signal tower that might be a way out.</p>
    ${sv ? `<button class="btn" id="mContinue">Continue · Day ${Math.floor(sv.S.t / 1440) + 1}</button>` : ''}<button class="btn ${sv ? 'ghost' : ''}" id="mNew">New run</button><button class="btn ghost" id="mHelp">How to play</button><button class="btn ghost" id="mSet">Settings</button>
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
let hintTimer = 0;
function helpSeen() { try { return localStorage.getItem(HELP_KEY) === '1'; } catch (_) { return true; } }
function hideHint() { clearTimeout(hintTimer); const h = $('#hint'); if (h) h.hidden = true; }
function markHelpSeen() { try { localStorage.setItem(HELP_KEY, '1'); } catch (_) {} hideHint(); }
function showHint() {
  if (helpSeen()) return;
  const h = $('#hint'), touch = document.body.classList.contains('touch');
  const bunker = touch
    ? 'Tap a person to select · use the top buttons for <b>Crew</b>, <b>Build</b>, <b>Tower</b>'
    : '<kbd>C</kbd> crew · <kbd>B</kbd> build · <kbd>T</kbd> tower · <kbd>G</kbd> battle stations · <kbd>P</kbd> pause · <kbd>1</kbd>–<kbd>3</kbd> speed · click a person to select';
  const top = touch
    ? 'Left pad moves/climbs · JUMP · FIRE · E interacts'
    : '<kbd>A</kbd><kbd>D</kbd> move · <kbd>W</kbd><kbd>S</kbd> climb · <kbd>' + keyLabel(BIND.jump) + '</kbd> jump · <kbd>' + keyLabel(BIND.shoot) + '</kbd>/click shoot · <kbd>' + keyLabel(BIND.interact) + '</kbd> interact (walk off the right edge of the surface to scavenge)';
  h.innerHTML = `<div class="hintbody"><div>${touch ? VO_TEXT.vo_help_hint_02 : VO_TEXT.vo_help_hint_01}</div></div><button id="hintHelp">Full help${touch ? '' : ' (H)'}</button><button id="hintX" aria-label="Dismiss hint">✕</button>`;
  h.hidden = false;
  $('#hintX').onclick = markHelpSeen;
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
  overlay(`<div class="menu" role="dialog" aria-modal="true" aria-labelledby="hTitle" style="width:640px"><h1 id="hTitle" style="font-size:36px">HOW TO PLAY</h1><div id="hTabs">${helpTabs('basics')}</div>${withPics(HELP)}<button class="btn" id="hBack">${inGame ? 'Back to the bunker' : 'Back'}</button></div>`);
  $('#hBack').onclick = () => {
    if (from === 'pause') showPauseMenu();
    else if (inGame) { overlay(''); paused = was; renderHud(); }
    else showMenu();
  };
  $('#hTabs').addEventListener('click', e => {
    const b = e.target.closest('[data-htab]'); if (!b) return;
    const k = b.dataset.htab, cur = document.querySelector('#overlay .help'); if (!cur) return;
    cur.outerHTML = withPics(k === 'combat' ? HELP_COMBAT : HELP);
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
const TEXT_SIZES = [['normal', 'Normal', 1], ['large', 'Large', 1.2], ['xlarge', 'Extra large', 1.4]];
function getTextSize() { try { const v = localStorage.getItem('ashfall.textsize'); if (TEXT_SIZES.some(t => t[0] === v)) return v; } catch (_) {} return 'normal'; }
function applyTextSize(k) {
  const t = TEXT_SIZES.find(x => x[0] === k) || TEXT_SIZES[0];
  document.documentElement.style.setProperty('--ts', String(t[2]));
  CANVAS_TS = t[2];
}
function setTextSize(k) { try { localStorage.setItem('ashfall.textsize', k); } catch (_) {} applyTextSize(k); }
applyTextSize(getTextSize());
function showSettings(from) {
  const vols = [['music', 'Music'], ['narr', 'Narrator'], ['fx', 'Effects'], ['ui', 'Interface']];
  const get = n => (window.SFX && SFX.getVol) ? SFX.getVol(n) : 1;
  const rows = vols.map(([k, label]) => { const v = Math.round(get(k) * 100); return `<label class="srow"><span>${label}</span><input type="range" min="0" max="100" step="1" value="${v}" data-vol="${k}" aria-label="${label} volume"><b>${v}%</b></label>`; }).join('');
  const keys = KEYBINDS.map(([a, b]) => `<dt><kbd>${a}</kbd></dt><dd>${b}</dd>`).join('');
  const bindRows = BIND_LABELS.map(([a, label]) => `<div class="srow"><span>${label}</span><button class="btn ghost" data-bind="${a}" style="min-width:110px" aria-label="Rebind ${label}">${keyLabel(BIND[a])}</button></div>`).join('') + '<button class="btn ghost" id="sBindReset" style="min-width:0">Reset keys</button>';
  const curTs = getTextSize();
  const tsBtns = '<div class="tsrow">' + TEXT_SIZES.map(([k, label]) => `<button class="btn ghost" data-ts="${k}" aria-pressed="${k === curTs}">${label}</button>`).join('') + '</div>';
  const muted = !!(window.SFX && SFX.muted);
  overlay(`<div class="menu" role="dialog" aria-modal="true" aria-labelledby="sTitle" style="width:640px"><h1 id="sTitle" style="font-size:36px">SETTINGS</h1><div class="setp"><h3>VOLUME</h3>${rows}<button class="btn ghost" id="sMute" style="min-width:0">${muted ? 'Sound: off' : 'Sound: on'}</button><h3>DISPLAY</h3><div class="tsrow"><button class="btn ghost" data-pref="cb" aria-pressed="false">Colorblind: off</button><button class="btn ghost" data-pref="hc" aria-pressed="false">High contrast: off</button></div><h3>TEXT SIZE</h3>${tsBtns}<h3>MOVEMENT &amp; ACTION KEYS</h3><div class="binds">${bindRows}</div><h3>OTHER KEYS</h3><dl class="keys">${keys}</dl></div><button class="btn" id="sBack">Back</button></div>`);
  document.querySelectorAll('#overlay input[data-vol]').forEach(inp => {
    const out = inp.parentNode.querySelector('b');
    inp.oninput = () => { if (window.SFX && SFX.setVol) SFX.setVol(inp.dataset.vol, inp.value / 100); out.textContent = inp.value + '%'; };
    inp.onchange = () => { if (inp.dataset.vol === 'fx' && window.SFX && SFX.preview) SFX.preview(); };
  });
  $('#sMute').onclick = e => { if (window.SFX) SFX.toggleMute(); e.currentTarget.textContent = (window.SFX && SFX.muted) ? 'Sound: off' : 'Sound: on'; };
  document.querySelectorAll('#overlay button[data-bind]').forEach(b => {
    b.onclick = () => startRebind(b.dataset.bind, b, () => showSettings(from));
  });
  $('#sBindReset').onclick = () => { Object.assign(BIND, BIND_DEF); saveBinds(); showSettings(from); };
  $('#sBack').onclick = () => { if (from === 'pause') showPauseMenu(); else showMenu(); };
  document.querySelectorAll('#overlay button[data-ts]').forEach(b => {
    b.onclick = () => { setTextSize(b.dataset.ts); showSettings(from); };
  });
  document.querySelectorAll('#overlay button[data-pref]').forEach(b => {
    b.onclick = () => {
      const k = b.dataset.pref;
      prefs[k] = !prefs[k];
      savePrefs();
      try { lamp((k === 'hc' ? 'High contrast' : 'Colorblind') + ' mode ' + (prefs[k] ? 'on' : 'off')); } catch (err) {}
    };
  });
  applyPrefs();
  $('#sBack').focus();
}
function pauseVolHtml() {
  const rows = [['music', 'Music'], ['fx', 'Effects'], ['ui', 'Interface'], ['narr', 'Narrator']].map(([k, label]) => { const v = Math.round(((window.SFX && SFX.getVol) ? SFX.getVol(k) : 1) * 100); return `<label class="srow"><span>${label}</span><input type="range" min="0" max="100" step="1" value="${v}" data-vol="${k}" aria-label="${label} volume"><b>${v}%</b></label>`; }).join('');
  return `<div class="setp" style="margin:10px 0"><h3>VOLUME</h3>${rows}</div>`;
}
function bindPauseVol() {
  document.querySelectorAll('#overlay input[data-vol]').forEach(inp => {
    const out = inp.parentNode.querySelector('b');
    inp.oninput = () => { if (window.SFX && SFX.setVol) SFX.setVol(inp.dataset.vol, inp.value / 100); out.textContent = inp.value + '%'; };
    inp.onchange = () => { if (inp.dataset.vol === 'fx' && window.SFX && SFX.preview) SFX.preview(); };
  });
}
function showPauseMenu() {
  paused = true; renderHud();
  overlay(`<div class="menu"><h1 style="font-size:40px">PAUSED</h1>${pauseVolHtml()}<button class="btn" id="pRes">Resume</button><button class="btn ghost" id="pHelp">How to play</button><button class="btn ghost" id="pSet">Settings</button><button class="btn ghost" id="pMenu">Save and quit to menu</button></div>`);
  bindPauseVol();
  $('#pRes').onclick = () => { overlay(''); paused = false; renderHud(); };
  $('#pHelp').onclick = () => showHelp(true);
  $('#pSet').onclick = () => showSettings('pause');
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
function tutStart() {
  tutHide();
  if (tutDone() || !S) return;
  tut = { rid: S.rid, step: -1, job: false };
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
  el.innerHTML = '<span style="flex:1">' + steps[s].text + '</span><button id="tutSkip" style="background:none;border:1px solid #6b5a44;border-radius:5px;padding:3px 8px;color:inherit;cursor:pointer">Skip tutorial</button>';
  $('#tutSkip').onclick = () => tutFinish();
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
  return `<div style="text-align:left;margin:10px auto;max-width:520px;font-size:15px;line-height:1.5">`
    + `<div>Days survived: <b>${day()}</b></div>`
    + `<div>Crew alive: <b>${living().length}</b> · lost: <b>${lost.length}</b>${lost.length ? ' (' + esc(lost.join(', ')) + ')' : ''}</div>`
    + `<div>Raids repelled: <b>${st.repelled || 0}</b> of ${st.raids}</div>`
    + `<div>Hostiles stopped: <b>${st.kills}</b> · scavenging trips: <b>${st.trips}</b></div>`
    + `<div>Loot hauled: <b>${hauled}</b> items${sc ? ' (' + sc + ')' : ''}</div>`
    + `<div>Goal progress: <b>${goalPct}%</b> · ${goalLine}</div>`
    + `<div style="margin-top:8px"><b>Key moments</b></div><ul style="max-height:140px;overflow:auto;margin:4px 0 0;padding-left:20px">${mom || '<li>A quiet run.</li>'}</ul></div>`;
}
function gameOver(won) {
  if (S.over) return;
  S.over = true; S.won = won; clearSave(); scene = 'over';
  let winLine = '';
  if (won) { const wc = narrPick('victory'); narrPlay(wc); winLine = narrText(wc, 'victory', pick(LAMP_LINES.towerWin)); }
  else narrPlay(narrPick('defeat'));
  const alive = living().map(c => c.name);
  overlay(won
    ? `<div class="menu"><h1 style="font-size:46px">${S.goalKind === 'vehicle' ? 'THE WAY OUT IS OPEN' : 'THE SIGNAL IS OUT'}</h1><p class="sub">Lamp reads the reply aloud, slowly, the way it reads old maintenance logs: <i>“Bunker 12. We hear you. Hold on. We are coming.”</i> Somewhere above the ash, Nell would finally see the sky.</p>
       <p class="sub"><b>Lamp:</b> <i>“${esc(winLine)}”</i></p>${summaryHtml()}<button class="btn" id="oNew">Play again</button></div>`
    : `<div class="menu"><h1 style="font-size:46px">THE BUNKER IS SILENT</h1><p class="sub">Lamp keeps reading the maintenance logs to empty rooms.</p>${summaryHtml()}<button class="btn" id="oNew">Try again</button></div>`);
  $('#oNew').onclick = () => { newRun(S && S.goalKind); start(); };
  $('#oNew').focus();
}

// ---------------------------------------------------------------- 7. main loop
function fit() {
  const s = Math.min(innerWidth / W, innerHeight / H), w = $('#wrap');
  w.style.transform = `scale(${s})`;
  // on small screens the stage is scaled down a lot, so grow touch UI to keep it readable and tappable
  w.style.setProperty('--u', Math.max(1, Math.min(1.7, 0.7 / s)).toFixed(2));
  // --tap = 44 real screen px expressed in stage px, used as a minimum touch target size
  w.style.setProperty('--tap', Math.round(Math.max(30, Math.min(150, 44 / s))) + 'px');
  // safe-area insets (notch, rounded corners, home bar) in stage px, minus the letterbox bars that already absorb them
  let pr = document.getElementById('safeProbe');
  if (!pr) { pr = document.createElement('div'); pr.id = 'safeProbe'; pr.setAttribute('aria-hidden', 'true'); pr.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)'; document.body.appendChild(pr); }
  const cs = getComputedStyle(pr), barX = Math.max(0, (innerWidth - W * s) / 2), barY = Math.max(0, (innerHeight - H * s) / 2);
  const inset = (v, bar) => (Math.max(0, (parseFloat(v) || 0) - bar) / s).toFixed(1) + 'px';
  w.style.setProperty('--sat', inset(cs.paddingTop, barY)); w.style.setProperty('--sab', inset(cs.paddingBottom, barY));
  w.style.setProperty('--sal', inset(cs.paddingLeft, barX)); w.style.setProperty('--sar', inset(cs.paddingRight, barX));
}
addEventListener('resize', fit); fit();
let last = performance.now(), hudT = 0, drawerT = 0;
const SIM_STEP = 1 / 60, MAX_STEPS = 16; let simAcc = 0;
function frame(now) {
  try { frameBody(now); } catch (e) { fatal(e); }
  requestAnimationFrame(frame);
}
function frameBody(now) {
  const dtReal = Math.min(0.05, (now - last) / 1000); last = now;
  if (window.SFX) SFX.update(dtReal, S && !S.over && !paused && (scene === 'bunker' || scene === 'scav') ? { scene, alarm: !!S.alarm } : null);
  if (S && (scene === 'bunker' || scene === 'scav')) {
    if (!paused) {
      // fixed 60Hz timestep: real time * speed feeds an accumulator, sim advances in equal steps
      simAcc += dtReal * speed;
      let n = 0;
      while (simAcc >= SIM_STEP && n < MAX_STEPS) { simTick(SIM_STEP); simAcc -= SIM_STEP; n++; }
      if (simAcc >= SIM_STEP) simAcc = 0; // drop backlog rather than spiral
      playerTick(dtReal); walkHintTick(dtReal); bulletsTick(dtReal); fxTick(dtReal);
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
  h.innerHTML = `<b>TOPSIDE</b><span>${carryBar()}</span><span>Pack: ${pk.length ? pk.map(([k, v]) => v + ' ' + RES.find(r => r.k === k).name.toLowerCase()).join(', ') : 'empty'}</span><span>Hatch ${Math.ceil(S.door.hp)}/${S.door.max} · Wall ${Math.ceil(S.wall.hp)}</span>${hazardHud()}${S.enemies.length ? `<span style="color:var(--red)">Bunker under attack</span>` : ''}`;
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
// for automated tests
window.__ab = { get S() { return S; }, get P() { return P; }, get scene() { return scene; }, newRun, start, simTick, startScav, endScav, doBuild, toggleAlarm, setSpeed };
