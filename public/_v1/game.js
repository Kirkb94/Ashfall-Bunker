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
const GAME_MIN_PER_SEC = 5;                    // 1 real second = 5 game minutes at 1x (an hour is 12 s)
const SAVE_KEY = 'ashfall-bunker-save-v1';

const ROOMS = {
  workshop: { name: 'Workshop', floor: 1, x0: 262, x1: 700, job: 'workshop' },
  signal:   { name: 'Signal Room', floor: 1, x0: 700, x1: IN_R, job: 'signal' },
  kitchen:  { name: 'Kitchen & Hydroponics', floor: 2, x0: 262, x1: 700, job: 'kitchen' },
  med:      { name: 'Med Bay', floor: 2, x0: 700, x1: IN_R, job: 'med' },
  bunks:    { name: 'Bunks', floor: 3, x0: 262, x1: 820, job: 'sleep' },
  common:   { name: 'Common Room', floor: 3, x0: 820, x1: IN_R, job: 'idle' },
  armory:    { name: 'Armory', floor: 3, x0: 820, x1: 963, build: true },
  storage:   { name: 'Storage', floor: 3, x0: 963, x1: 1106, build: true },
  generator: { name: 'Generator', floor: 3, x0: 1106, x1: IN_R, build: true },
};
// Buildable annex rooms and their effects. All tuning for them lives here.
const ROOM_FX = { powerBoost: 1.25, fuelPerHour: 0.25, armoryDmg: 1.2, storageTheft: 0.1, storageLoot: 1.1 };
const POWERED_JOBS = ['kitchen', 'workshop', 'signal'];
const BUILD_ROOMS = {
  generator: { cost: { scrap: 30, parts: 12, elec: 4 }, desc: 'Burns a little scrap each hour to power the bunker: kitchen, workshop, signal and med bay work 25% faster. Armory needs it.', done: 'It will burn about 6 scrap a day to keep the lights on.' },
  armory:    { cost: { scrap: 25, parts: 10, mat: 8 }, desc: 'Turrets, door guards and Mara hit 20% harder. Needs the generator running.', done: 'It needs power from the generator to charge the racks.' },
  storage:   { cost: { scrap: 20, mat: 15 }, desc: 'Locked shelving: night thieves take far less, and loot from scavenging trips is sorted for 10% more.', done: 'Everything is counted and locked now.' },
};
const armoryMult = () => (S.rooms.armory && S.powered ? ROOM_FX.armoryDmg : 1);
function powerTick(h) {
  if (!S.rooms.generator) { S.powered = false; return; }
  const need = ROOM_FX.fuelPerHour * h, was = !!S.powered;
  if (S.res.scrap >= need) { S.res.scrap -= need; S.powered = true; } else S.powered = false;
  if (was && !S.powered) { S.powerOut = true; lamp('The generator has run out of scrap and gone dark. Rooms are back to manual.', 'warn'); }
  if (S.powered && S.powerOut) { S.powerOut = false; lamp('Generator is running again. Power is back.', 'good'); }
}
const JOBS = {
  turretA:  { label: 'Turret 1', short: 'T1' },
  turretB:  { label: 'Turret 2', short: 'T2' },
  door:     { label: 'Guard door', short: 'Door' },
  workshop: { label: 'Workshop', short: 'Shop' },
  signal:   { label: 'Signal tower', short: 'Tower' },
  kitchen:  { label: 'Kitchen', short: 'Food' },
  med:      { label: 'Med bay', short: 'Med' },
  idle:     { label: 'Rest', short: 'Rest' },
};
const SHIFTS = { day: { label: 'Day shift', sleep: [23, 7] }, night: { label: 'Night shift', sleep: [11, 19] }, none: { label: 'No sleep', sleep: null } };

const RES = [
  { k: 'food', name: 'Food', color: '#7ddc6f' }, { k: 'scrap', name: 'Scrap', color: '#c9a27a' }, { k: 'parts', name: 'Parts', color: '#ffb347' },
  { k: 'elec', name: 'Electronics', color: '#7fc8ff' }, { k: 'mat', name: 'Materials', color: '#d0c6b4' },
];

const ENEMIES = {
  hound:  { name: 'Mutant hound', hp: 32, spd: 74, dmg: 6, rate: 0.75, w: 26, h: 18, color: '#9b6a4a', xp: 4 },
  ghoul:  { name: 'Ash ghoul', hp: 62, spd: 38, dmg: 11, rate: 1.0, w: 16, h: 30, color: '#8a8f6a', xp: 6 },
  raider: { name: 'Raider', hp: 52, spd: 50, dmg: 8, rate: 1.3, w: 14, h: 30, color: '#b0553a', xp: 8, ranged: 210 },
  brute:  { name: 'Brute', hp: 240, spd: 26, dmg: 32, rate: 1.6, w: 26, h: 40, color: '#6d5a7a', xp: 22 },
  cinder: { name: 'Cinder', hp: 520, spd: 34, dmg: 16, rate: 0.9, w: 20, h: 36, color: '#e0e0d6', xp: 120, ranged: 240, boss: true },
};

const TURRETS = {
  rifle:   { name: 'Rifle turret', range: 620, cd: 1.15, dmg: 19, pellets: 1, base: 0.35, accK: 0.55, hp: 130, cost: { scrap: 20, parts: 6 } },
  shotgun: { name: 'Shotgun turret', range: 240, cd: 1.35, dmg: 8, pellets: 4, base: 0.42, accK: 0.40, hp: 160, cost: { scrap: 15, parts: 8 } },
};

// Signal tower: pay for a stage, then crew on the Signal tower job put work into it (Tech skill).
const TOWER = [
  { name: 'Antenna mast', cost: { scrap: 25, mat: 10 }, work: 10, line: 'The mast is up. Topside will see it, so expect company.' },
  { name: 'Power coupling', cost: { parts: 10, elec: 4 }, work: 15, line: 'Coupling live. The old beacon network is answering with noise.' },
  { name: 'Signal array', cost: { scrap: 20, elec: 8 }, work: 20, line: 'Array aligned. There is a carrier wave under the noise. Priya would call it a voice.' },
  { name: 'Decode the carrier', cost: { parts: 10, elec: 6 }, work: 25, line: '' },
];

const NAMED = [
  { id: 'bram', name: 'Old Bram', role: 'Engineer', color: '#8c8f96', accent: '#d9d4c8', stats: { acc: 0.45, build: 1.6, cook: 0.7, med: 0.5, tech: 1.1 }, bonds: ['reed', 'tick'], job: 'workshop', shift: 'day', hp: 120 },
  { id: 'juno', name: 'Juno Park', role: 'Sharpshooter', color: '#3f5f8f', accent: '#f2c14e', stats: { acc: 0.92, build: 0.6, cook: 0.5, med: 0.4, tech: 0.6 }, bonds: [], job: 'turretA', shift: 'night', hp: 100 },
  { id: 'reed', name: 'Doc Reed', role: 'Medic', color: '#e8e4da', accent: '#6b8fb0', stats: { acc: 0.35, build: 0.5, cook: 0.9, med: 1.8, tech: 0.8 }, bonds: ['bram'], job: 'med', shift: 'day', hp: 90 },
  { id: 'tick', name: 'Tick', role: 'Runner', color: '#a86b3c', accent: '#59d0c4', stats: { acc: 0.55, build: 0.9, cook: 0.6, med: 0.4, tech: 0.9 }, bonds: ['bram'], job: 'kitchen', shift: 'day', hp: 85 },
];
const FIRST = ['Ada', 'Moss', 'Ike', 'Rena', 'Cole', 'Vee', 'Hollis', 'Sana', 'Dax', 'Lio', 'Petra', 'Gus', 'Imani', 'Teo', 'Wynn', 'Brin', 'Ozzie', 'Kara'];
const LAST = ['Hart', 'Ruiz', 'Mbeki', 'Cole', 'Vance', 'Oduya', 'Kim', 'Shaw', 'Ferro', 'Lund', 'Nakai', 'Bishop'];
const SURV_COLORS = ['#6f7d5a', '#7a5f8f', '#8f6f4a', '#4f7f7a', '#94604e', '#5a6f94', '#8a8a5a'];

// ---------------------------------------------------------------- helpers
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtCost = c => Object.entries(c).map(([k, v]) => v + ' ' + RES.find(r => r.k === k).name.toLowerCase()).join(', ');
let uid = 1;

// Lamp's voice: several variants per event so repeated raids do not read the same. lampSay(key, kind) picks one.
const LAMP_LINES = {
  raidWarn: ['Forgive the interruption. The scanner reports movement on the ridge. I estimate one hour until a raid.', 'Heat signatures to the east, Mara. One hour remains. Perhaps the turret crews could be reminded.', 'Maintenance log, year one: "Perimeter wire tested, found adequate." I hope the log is still right. Raid in one hour.'],
  raidNow: ['The raid has arrived. I count {n} hostiles approaching from the east. You have held the door before.', 'I regret to report {n} contacts at the wire. The crew is ready, and so am I.', 'Maintenance log, hatch seal: "Rated for sustained assault." Let us see if it is. {n} hostiles are closing.'],
  probe: ['A few hounds are investigating the outer wall before dawn. Nothing to worry about, I think.', 'There is scratching on the outer wall. Hounds, by the sound of it. They will tire eventually.', 'Early visitors at the wire. Hounds again. They are persistent, if nothing else.'],
  breach: ['The hatch has been breached. Hostiles are in the shaft. All hands to battle stations, please. I know you can hold them.', 'Breach. I am sorry, Mara. The hatch has failed. Everyone to the floors, and look after one another.', 'Maintenance log, hatch: "Do not rely on the hatch alone." The builders were wise. The hatch is open. Please defend the shaft.'],
  towerHalf: ['The {name} is half complete. Well done, everyone. Please keep the crew on it.', 'Halfway through the {name}. I can hear the tower beginning to hum, and I find it encouraging.', 'Maintenance log, signal room: "Beacon dormant, awaiting a steady hand." The {name} is half done. Many steady hands, I think.'],
  towerLeft: ['{n} stage(s) remain. We are closer than we have ever been.', 'We are {n} stage(s) from a signal. Nell will be pleased.', 'Only {n} stage(s) lie between us and the surface. I have begun to hope.'],
  towerWin: ['The carrier is decoded, Mara. That is a voice, and it is answering us. I believe we are going home.', 'Maintenance log, final entry: "Signal received. Open the hatch." Decode complete. Someone is calling back. Thank you, all of you.']
};
function lampSay(key, kind, vars) {
  let t = pick(LAMP_LINES[key]);
  if (vars) for (const k in vars) t = t.split('{' + k + '}').join(vars[k]);
  lamp(t, kind);
}

// ---------------------------------------------------------------- 2. game state
let S = null;          // the whole run (saved)
let P = null;          // Mara, the player
let scene = 'menu';    // menu | bunker | scav | over
let speed = 1, paused = false;
const fx = { tracers: [], parts: [], nums: [], bullets: [] };
let scav = null;       // the current scavenging trip (not saved)

function makeCrew(base) {
  return {
    id: base.id || ('s' + (uid++)), name: base.name, role: base.role || 'Survivor', named: !!base.named, color: base.color, accent: base.accent || '#cfcfcf',
    stats: { ...base.stats }, bonds: base.bonds || [], job: base.job || 'idle', shift: base.shift || 'day',
    maxHp: base.hp || 100, hp: base.hp || 100, food: 80, awake: 2, xp: 0, lvl: 1, loyalty: base.loyalty ?? 1, grief: 0, alive: true,
    x: 300 + Math.random() * 300, y: FLOORS[3], floor: 3, climbing: false, state: 'walk', cd: 0, facing: 1, anim: Math.random() * 10, kills: 0,
  };
}
function randomSurvivor() {
  const s = () => +rnd(0.4, 1.15).toFixed(2);
  const stats = { acc: s(), build: s(), cook: s(), med: s(), tech: s() };
  const best = Object.entries(stats).sort((a, b) => b[1] - a[1])[0][0];
  const role = { acc: 'Shooter', build: 'Builder', cook: 'Cook', med: 'Medic', tech: 'Tinkerer' }[best];
  return { name: pick(FIRST) + ' ' + pick(LAST), role, color: pick(SURV_COLORS), accent: '#d8cfbf', stats, hp: Math.round(rnd(80, 105)), loyalty: +rnd(0.25, 0.9).toFixed(2), job: 'idle', shift: Math.random() < 0.5 ? 'day' : 'night' };
}
function newRun() {
  S = {
    v: 1, rid: Math.random(), t: 8 * 60, lastHour: 8, res: { food: 40, scrap: 40, parts: 6, elec: 2, mat: 10 },
    door: { hp: 400, max: 400 }, wall: { hp: 300, max: 300, lvl: 1 }, breached: false,
    turrets: [{ type: 'rifle', hp: 130, max: 130, lvl: 1, cd: 0 }, null],
    rooms: { kitchen: 1, med: 1, bunks: 1, workshop: 1 }, makeParts: true,
    tower: { done: 0, paid: false, work: 0 },
    crew: [], enemies: [], spawns: [], alarm: false, stats: { kills: 0, trips: 0, raids: 0, lost: [] }, won: false, hint: 0,
    player: { hp: 100, maxHp: 100, food: 80, xp: 0, lvl: 1, down: 0 },
  };
  for (const n of NAMED) S.crew.push(makeCrew({ ...n, named: true }));
  const a = makeCrew(randomSurvivor()); a.job = 'turretA'; a.shift = 'day'; a.loyalty = 1; S.crew.push(a);
  const b = makeCrew(randomSurvivor()); b.job = 'signal'; b.shift = 'day'; b.loyalty = 1; S.crew.push(b);
  // Juno takes the turret at night; the day-shift survivor covers it in daytime.
  placePlayer('bunker');
  fx.tracers = []; fx.parts = []; fx.nums = []; fx.bullets = [];
  logs.length = 0;
  lamp('Lamp online. Good morning, Mara. It is day 1, 08:00. The first raid is due at 21:00.');
  lamp('Someone has to sit at a turret or it will not fire. Open Crew (C) to give people jobs and shifts.', '', 900);
  lamp('The signal tower needs electronics we do not have. Walk right across the surface to scavenge. Time keeps running while you are out.', '', 1800);
}
function save() {
  if (!S || S.over) return;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ S, P: { x: P.x, y: P.y } })); } catch {}
}
function loadSave() {
  try { const d = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); if (d && d.S && d.S.v === 1 && !d.S.over) return d; } catch {}
  return null;
}
function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch {} }

// ---------------------------------------------------------------- 3. simulation
const day = () => Math.floor(S.t / 1440) + 1;
const hourF = () => (S.t % 1440) / 60;
const clockText = () => { const h = Math.floor(hourF()), m = Math.floor(S.t % 60); return 'DAY ' + day() + ' · ' + String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0'); };
const isNight = () => { const h = hourF(); return h >= 20 || h < 6; };
const living = () => S.crew.filter(c => c.alive);
function inSleepHours(c, h = hourF()) {
  const s = SHIFTS[c.shift].sleep; if (!s) return false;
  return s[0] > s[1] ? (h >= s[0] || h < s[1]) : (h >= s[0] && h < s[1]);
}
function sleepFactor(awake) { return awake <= 16 ? 1 : Math.max(0.12, Math.exp(-0.2 * (awake - 16))); }
function eff(c) {
  let e = sleepFactor(c.awake);
  if (c.food < 15) e *= 0.6;
  if (c.grief > 0) e *= 0.7;
  // Bonds: two people with shared history working the same room do better.
  if (c.state === 'work' && c.bonds.some(id => { const o = S.crew.find(x => x.id === id); return o && o.alive && o.state === 'work' && o.job === c.job; })) e *= 1.15;
  return e;
}
const restPct = c => clamp(100 - Math.max(0, c.awake - 4) / 16 * 100, 0, 100);
function morale(c) { return clamp((c.food + restPct(c) + c.hp / c.maxHp * 100) / 3 - (c.grief > 0 ? 25 : 0), 0, 100); }

// Where a job puts someone: floor + x. People on the same job spread out.
function jobSpot(c, job) {
  if (job === 'turretA' || job === 'turretB') { const i = job === 'turretA' ? 0 : 1; return { floor: 0, x: SLOT_X[i] - 4 }; }
  if (job === 'door') { const same = living().filter(o => o.job === 'door'); return { floor: 0, x: 278 + same.indexOf(c) * 14 }; }
  const room = Object.values(ROOMS).find(r => r.job === job) || ROOMS.common;
  const same = living().filter(o => targetJob(o) === job);
  const i = Math.max(0, same.indexOf(c));
  const span = room.x1 - room.x0 - 90;
  return { floor: room.floor, x: room.x0 + 50 + ((i * 67) % span) };
}
// What someone should be doing right now.
function targetJob(c) {
  if (c.patient) return 'med';
  if (S.alarm) { // battle stations: turrets first, then the door
    if (c.alarmSlot != null && S.turrets[c.alarmSlot]) return c.alarmSlot ? 'turretB' : 'turretA';
    if ((c.job === 'turretA' || c.job === 'turretB') && turretFor(c.job)) return c.job;
    return 'door';
  }
  if (inSleepHours(c)) return 'sleep';
  if ((c.job === 'turretA' || c.job === 'turretB') && !turretFor(c.job)) return 'door';
  return c.job;
}
const turretFor = job => S.turrets[job === 'turretB' ? 1 : 0];

// Moving along floors and the shaft (crew and enemies inside).
function moveTo(m, floor, x, dt, spd) {
  if (m.floor === floor && !m.climbing) {
    const d = x - m.x; if (Math.abs(d) < 3) { m.x = x; return true; }
    m.facing = Math.sign(d); m.x += Math.sign(d) * Math.min(Math.abs(d), spd * dt); return false;
  }
  if (!m.climbing) {
    const d = LADDER_X - m.x;
    if (Math.abs(d) > 2) { m.facing = Math.sign(d); m.x += Math.sign(d) * Math.min(Math.abs(d), spd * dt); return false; }
    // Enemies cannot pass a closed hatch; crew can.
    if (m.enemy && !S.breached && (m.floor === 0 || floor === 0)) return false;
    m.x = LADDER_X; m.climbing = true;
  }
  const ty = FLOORS[floor], dy = ty - m.y;
  if (Math.abs(dy) < 2) { m.y = ty; m.floor = floor; m.climbing = false; return false; }
  m.y += Math.sign(dy) * Math.min(Math.abs(dy), spd * 0.8 * dt);
  // passing a floor on the way
  for (let f = 0; f < FLOORS.length; f++) if (Math.abs(m.y - FLOORS[f]) < 1) m.floor = f;
  return false;
}

function hourEvents(h) {
  const d = day();
  if (h === 7 || h === 13 || h === 19) meal();
  if (h === 8) { if (S.alarm) toggleAlarm(); S.alarmAuto = false; if (d > 1) lamp('Day ' + d + '. ' + summaryLine()); }
  if (h === 20) { if (d === 3) lamp('Long-range scanner: a convoy with a painted-grin banner. That is Cinder. Raid in one hour.', 'warn'); else lampSay('raidWarn', 'warn'); }
  if (h === 21) queueRaid(d);
  if (h === 5 && d >= 2) queueProbe(d);
  if (h === 2) revoltCheck();
  if (h === 12 && d >= 2 && Math.random() < 0.55) wandererAtDoor();
  if (h % 1 === 0) save();
}
function summaryLine() {
  const low = RES.filter(r => S.res[r.k] < (r.k === 'food' ? living().length * 2 : 5)).map(r => r.name.toLowerCase());
  return (low.length ? 'Running low on ' + low.join(', ') + '.' : 'Stores are holding.') + ' ' + living().length + ' crew alive.';
}
function meal() {
  let hungry = 0;
  for (const c of [...living(), S.player]) {
    if (c.down) continue;
    if (S.res.food >= 1) { S.res.food -= 1; c.food = Math.min(100, c.food + 42); } else hungry++;
  }
  if (hungry) lamp(hungry + ' of us went without a meal. Hydroponics needs hands, or bring food back from topside.', 'warn');
}
function queueRaid(d) {
  S.stats.raids++;
  const n = 3 + d * 2;
  const types = d === 1 ? ['hound', 'ghoul', 'ghoul'] : d === 2 ? ['hound', 'ghoul', 'raider'] : ['hound', 'ghoul', 'raider', 'raider', 'brute'];
  const list = [];
  for (let i = 0; i < n; i++) list.push(pick(types));
  if (d >= 3 && d % 2 === 1) list.push('brute');
  if (d === 3) { for (let i = 0; i < 4; i++) list.push('raider'); list.push('cinder'); }
  if (d >= 6) for (let i = 0; i < d - 4; i++) list.push(pick(['raider', 'brute', 'hound']));
  let at = S.t; list.forEach(type => { S.spawns.push({ type, at }); at += rnd(7, 15); });
  if (d === 3) lamp('Cinder’s raiders are at the wire. Hold the door.', 'warn'); else lampSay('raidNow', 'warn', { n: list.length });
  if (speed > 1) setSpeed(1);
}
function queueProbe(d) {
  const n = 1 + Math.floor(d / 2);
  for (let i = 0; i < n; i++) S.spawns.push({ type: 'hound', at: S.t + i * 9 });
  lampSay('probe', 'warn');
}
function spawnEnemy(type) {
  const b = ENEMIES[type], scale = 1 + (day() - 1) * 0.1;
  S.enemies.push({ id: uid++, type, enemy: true, x: W + 30 + rnd(0, 60), y: FLOORS[0], floor: 0, climbing: false, hp: Math.round(b.hp * scale), max: Math.round(b.hp * scale), cd: rnd(0, 0.5), facing: -1, anim: Math.random() * 10, inside: false });
  if (type === 'cinder') lamp('Cinder (over a loudspeaker): “Open up, little mole. Only the strong get to leave the ground.”', 'warn');
}
function revoltCheck() {
  for (const c of living()) {
    if (c.named || c.loyalty >= 1) continue;
    if (morale(c) < 38 && Math.random() > c.loyalty) {
      const k = pick(['food', 'scrap', 'parts', 'elec']); const took = Math.ceil(S.res[k] * (S.rooms.storage ? ROOM_FX.storageTheft : 0.3));
      S.res[k] -= took; c.alive = false; c.left = true;
      lamp(c.name + ' slipped out in the night with ' + took + ' ' + RES.find(r => r.k === k).name.toLowerCase() + '. Morale was too low to hold them.', 'warn');
    }
  }
}
function wandererAtDoor() {
  if (living().length >= 14) return;
  const w = makeCrew(randomSurvivor()); w.x = 300; w.floor = 0; w.y = FLOORS[0];
  S.crew.push(w);
  lamp(w.name + ' (' + w.role.toLowerCase() + ') knocked at the hatch and asked to stay. I let them in. Keep morale up: newcomers are not always loyal.', 'good');
}

function crewTick(c, dt, mins) {
  const h = mins / 60;
  c.anim += dt * 6;
  if (c.cd > 0) c.cd -= dt;
  if (c.grief > 0) c.grief -= h;
  // needs
  c.food = Math.max(0, c.food - (100 / 21) * h);
  if (c.food <= 0) { c.hp -= 3 * h; if (c.hp <= 0) return kill(c, 'starved'); }
  if (c.state === 'sleep') c.awake = Math.max(0, c.awake - h * (16 / (S.rooms.bunks > 1 ? 5 : 7)));
  else c.awake += h;
  if (c.hp < c.maxHp * 0.35 && !c.patient) { c.patient = true; }
  if (c.patient && c.hp >= c.maxHp * 0.85) c.patient = false;

  // fight anything that reaches them
  const foe = S.enemies.find(e => e.floor === c.floor && !e.climbing && !c.climbing && Math.abs(e.x - c.x) < 26 && e.hp > 0);
  if (foe) { c.state = 'fight'; c.facing = Math.sign(foe.x - c.x) || 1; if (c.cd <= 0) { c.cd = 0.7; hitEnemy(foe, (8 + c.stats.acc * 8) * eff(c), c); } return; }
  // guards hunt enemies that got inside
  let job = targetJob(c);
  if (job === 'door' && S.breached) {
    const inside = S.enemies.filter(e => e.inside && e.hp > 0).sort((a, b) => (Math.abs(a.floor - c.floor) * 500 + Math.abs(a.x - c.x)) - (Math.abs(b.floor - c.floor) * 500 + Math.abs(b.x - c.x)))[0];
    if (inside) {
      // guards carry pistols: shoot when on the same floor and close enough, otherwise close in
      if (inside.floor === c.floor && !c.climbing && !inside.climbing && Math.abs(inside.x - c.x) < 140) {
        c.state = 'fight'; c.facing = Math.sign(inside.x - c.x) || 1;
        if (c.cd <= 0) { c.cd = 0.8; tracer(c.x + c.facing * 8, c.y - 20, inside.x, inside.y - 14, '#ffd27a'); if (Math.random() < 0.4 + 0.5 * c.stats.acc) hitEnemy(inside, 11 * eff(c) * armoryMult(), c); }
        return;
      }
      c.state = 'walk'; moveTo(c, inside.floor, inside.x, dt, 80); return;
    }
  }
  const spot = job === 'sleep' ? sleepSpot(c) : jobSpot(c, job);
  const arrived = moveTo(c, spot.floor, spot.x, dt, 70);
  if (!arrived) { c.state = 'walk'; return; }
  c.state = job === 'sleep' ? 'sleep' : c.patient ? 'patient' : 'work';
  if (c.state !== 'work') return;
  const e = eff(c) * (S.powered && POWERED_JOBS.includes(job) ? ROOM_FX.powerBoost : 1);
  const gain = x => { c.xp += x * h; const need = 60 * c.lvl; if (c.xp >= need) { c.xp -= need; levelUp(c); } };
  switch (job) {
    case 'kitchen': S.res.food += 1.3 * c.stats.cook * e * h * (S.rooms.kitchen > 1 ? 1.5 : 1); gain(4); break;
    case 'workshop': workshopTick(c, e, h); gain(4); break;
    case 'signal': if (S.tower.paid) { S.tower.work += 2 * c.stats.tech * e * h; gain(5); } break;
    case 'med': gain(2); break;
    case 'door': guardShoot(c, e); break;
    case 'idle': c.awake = Math.max(0, c.awake - h * 0.3); break;
  }
}
function sleepSpot(c) { const i = Math.max(0, living().indexOf(c)); return { floor: 3, x: ROOMS.bunks.x0 + 40 + (i * 41) % (ROOMS.bunks.x1 - ROOMS.bunks.x0 - 80) }; }
function workshopTick(c, e, h) {
  // Repairs first (1 scrap per 10 hp), then parts from scrap.
  let work = 10 * c.stats.build * e * h;
  for (const s of [S.door, S.wall, ...S.turrets.filter(Boolean)]) {
    if (work <= 0) break;
    if (s === S.door && S.enemies.some(en => en.inside)) continue;
    const miss = s.max - s.hp; if (miss <= 0) continue;
    const amt = Math.min(miss, work, S.res.scrap * 10); if (amt <= 0) break;
    s.hp += amt; S.res.scrap -= amt / 10; work -= amt;
    if (s === S.door && S.breached && S.door.hp > 40) { S.breached = false; lamp('The hatch is sealed again.', 'good'); }
  }
  if (work > 0 && S.makeParts && S.res.scrap >= 2) { const n = Math.min(work / 30, S.res.scrap / 2); S.res.parts += n; S.res.scrap -= n * 2; }
}
function guardShoot(c, e) {
  if (c.cd > 0) return;
  const t = S.enemies.filter(en => !en.inside && en.hp > 0 && en.x > c.x && en.x - c.x < 260).sort((a, b) => a.x - b.x)[0];
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
  c.alive = false; c.hp = 0; S.stats.lost.push(c.name);
  for (const o of living()) if (o.bonds.includes(c.id) || c.bonds.includes(o.id)) { o.grief = 24; lamp(o.name + ' is grieving ' + c.name + '. They will work slower for a day.', 'warn'); }
  lamp(c.name + (how === 'starved' ? ' starved.' : ' was killed.') + (c.named ? ' We will not forget them.' : ''), 'warn');
  burst(c.x, c.y - 14, '#a33', 14);
  if (!living().length && S.player.down) gameOver(false);
}
function medTick(h) {
  const medics = living().filter(c => c.job === 'med' && c.state === 'work');
  const rate = medics.length ? medics.reduce((a, c) => a + 10 * c.stats.med * eff(c), 0) : 2;
  const mult = (S.rooms.med > 1 ? 1.5 : 1) * (S.powered ? ROOM_FX.powerBoost : 1);
  for (const c of living()) if (c.state === 'patient' || (c.floor === 2 && c.x > ROOMS.med.x0 && c.state !== 'walk')) c.hp = Math.min(c.maxHp, c.hp + rate * mult * h);
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
function enemyTick(e, dt) {
  const b = ENEMIES[e.type];
  e.anim += dt * 8; if (e.cd > 0) e.cd -= dt;
  if (!e.inside) {
    // anyone standing on the surface in its way?
    const people = [...living().filter(c => c.floor === 0 && !c.climbing), ...(scene === 'bunker' && P.floor === 0 && !S.player.down ? [P] : [])];
    const near = people.filter(p => p.x < e.x + 4 && e.x - p.x < (b.ranged || 24)).sort((a, z) => z.x - a.x)[0];
    const target = structureList().find(t => t.x < e.x + 4);
    const tx = target ? target.x + (b.ranged || 22) : DOOR_X;
    if (near && (!target || near.x > target.x)) return attack(e, b, near, near.x);
    if (!target) { e.x += b.spd * dt; return; }   // somehow left of the hatch: walk back to it
    if (target.name === 'door' && S.door.hp <= 0) {
      if (e.x > DOOR_X + 6) { e.x -= b.spd * dt; e.facing = -1; return; }
      breach(); e.inside = true; return;
    }
    if (e.x > tx + 1) { e.x -= b.spd * dt; e.facing = -1; return; }
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
  if (target.stats) { target.hp -= b.dmg; burst(target.x, target.y - 16, '#c33', 4); if (target.hp <= 0) kill(target); return; }
  target.hp = Math.max(0, target.hp - b.dmg); burst(tx + 6, FLOORS[0] - 20, '#bbb', 3);
  if (what === 'wall' && target.hp <= 0) lamp('The outer wall is down!', 'warn');
  if (what === 'turret' && target.hp <= 0) { lamp('A turret was destroyed.', 'warn'); const i = S.turrets.indexOf(target); S.turrets[i] = null; }
}
function breach() {
  // Called each time something gets in. The alarm sounds once per night, so the player can still stand people down.
  if (!S.alarm && !S.alarmAuto) { S.alarmAuto = true; toggleAlarm(); }
  if (S.breached) return;
  S.breached = true;
  lampSay('breach', 'warn');
  if (speed > 1) setSpeed(1);
}
function hitEnemy(e, dmg, by) {
  if (e.hp <= 0) return;
  e.hp -= dmg; fx.nums.push({ x: e.x, y: e.y - ENEMIES[e.type].h - 6, t: 0.7, s: Math.round(dmg) });
  burst(e.x, e.y - ENEMIES[e.type].h / 2, '#7a2', 3);
  if (e.hp <= 0) {
    S.stats.kills++;
    const xp = ENEMIES[e.type].xp;
    if (by && by.stats) { by.xp += xp; by.kills++; if (by.xp >= 60 * by.lvl) { by.xp -= 60 * by.lvl; levelUp(by); } }
    else if (by === P) { S.player.xp += xp; if (S.player.xp >= 50 * S.player.lvl) { S.player.xp -= 50 * S.player.lvl; S.player.lvl++; S.player.maxHp += 10; S.player.hp += 10; lamp('Mara is now level ' + S.player.lvl + ': more health and a harder-hitting pistol.', 'good'); } }
    if (Math.random() < 0.35) S.res.scrap += e.type === 'raider' ? 3 : 1;
    if (e.type === 'cinder') { lamp('Cinder is down. His raiders scatter into the ash. Rook will want to hear about this.', 'good'); S.res.parts += 8; S.res.elec += 3; }
    burst(e.x, e.y - 10, '#5a3', 12);
  }
}
function turretTick(dt) {
  S.turrets.forEach((t, i) => {
    if (!t) return;
    if (t.cd > 0) t.cd -= dt;
    const gunner = living().find(c => c.state === 'work' && targetJob(c) === (i ? 'turretB' : 'turretA'));
    t.manned = !!gunner;
    if (!gunner || t.cd > 0) return;
    const spec = TURRETS[t.type];
    const target = S.enemies.filter(e => !e.inside && e.hp > 0 && e.x > SLOT_X[i] && e.x - SLOT_X[i] < spec.range && e.x < W + 10).sort((a, z) => a.x - z.x)[0];
    if (!target) return;
    t.cd = spec.cd; t.flash = 0.08;
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
  for (const c of S.crew) if (c.alive) crewTick(c, dt, mins);
  powerTick(mins / 60);
  medTick(mins / 60);
  turretTick(dt);
  for (const e of S.enemies) if (e.hp > 0) enemyTick(e, dt);
  S.enemies = S.enemies.filter(e => e.hp > 0);
  if (S.breached && !S.enemies.some(e => e.inside) && S.door.hp > 40) S.breached = false;
  // Mara's needs
  const pl = S.player;
  pl.food = Math.max(0, pl.food - (100 / 21) * mins / 60);
  if (pl.food <= 0 && !pl.down) hurtPlayer(3 * mins / 60, true);
  // tower
  if (S.tower.paid && !S.tower.half && S.tower.work >= TOWER[S.tower.done].work / 2 && S.tower.work < TOWER[S.tower.done].work) { S.tower.half = true; lampSay('towerHalf', 'good', { name: TOWER[S.tower.done].name }); }
  if (S.tower.paid && S.tower.work >= TOWER[S.tower.done].work) {
    const st = TOWER[S.tower.done]; S.tower.done++; S.tower.paid = false; S.tower.work = 0; S.tower.half = false;
    if (S.tower.done >= TOWER.length) { lampSay('towerWin', 'good'); return gameOver(true); }
    lamp('Signal tower: ' + st.name + ' complete. ' + st.line, 'good'); lampSay('towerLeft', 'good', { n: TOWER.length - S.tower.done });
  }
  // tutorial nudges
  if (S.hint === 0 && S.t > 9.5 * 60) { S.hint = 1; lamp('Tip: Old Bram in the Workshop repairs the door, wall and turrets with scrap, and turns spare scrap into parts.'); }
  if (S.hint === 1 && S.t > 17 * 60) { S.hint = 2; lamp('Night is coming. Check who is on the turrets after dark: day-shift crew go to bed at 23:00. Battle stations (G) wakes everyone up.', 'warn'); }
}

// ---------------------------------------------------------------- 4. the player
const keys = {};
function placePlayer(where) {
  P = P || {};
  Object.assign(P, { x: where === 'surface-right' ? W - 50 : 600, y: where === 'surface-right' ? FLOORS[0] : FLOORS[1], vx: 0, vy: 0, floor: where === 'surface-right' ? 0 : 1, climbing: false, onLadder: false, facing: -1, cd: 0, anim: 0, inMed: false, grounded: true });
}
function hurtPlayer(d, quiet) {
  const pl = S.player; if (pl.down) return;
  pl.hp -= d; if (!quiet) { burst(P.x, P.y - 18, '#c33', 5); P.hurt = 0.2; }
  if (pl.hp <= 0) {
    pl.hp = 0; pl.down = 8;
    if (scene === 'scav') { lamp('Mara is down out there. Tick dragged you home, but the pack was lost.', 'warn'); endScav(false); }
    else lamp('Mara is down! Doc will patch you up in the med bay.', 'warn');
    if (!living().length) gameOver(false);
  }
}
function playerTick(dt) {
  const pl = S.player;
  if (pl.down) {
    pl.down -= dt;
    if (pl.down <= 0) { pl.down = 0; pl.hp = Math.round(pl.maxHp * 0.5); scene = 'bunker'; P.x = 900; P.y = FLOORS[2]; P.floor = 2; P.climbing = P.onLadder = false; P.vy = 0; }
    return;
  }
  if (scene === 'scav') return scavPlayerTick(dt);
  const L = keys.a || keys.arrowleft, R = keys.d || keys.arrowright, U = keys.w || keys.arrowup, D = keys.s || keys.arrowdown;
  const nearLadder = Math.abs(P.x - LADDER_X) < 22;
  if (!P.onLadder && nearLadder && (U && P.y > FLOORS[0] + 2 || D && P.y < FLOORS[3] - 2)) { P.onLadder = true; P.x = LADDER_X; P.vy = 0; }
  if (P.onLadder) {
    if (U) P.y -= 170 * dt; if (D) P.y += 170 * dt;
    P.y = clamp(P.y, FLOORS[0], FLOORS[3]);
    const f = FLOORS.findIndex(y => Math.abs(P.y - y) < 10);
    if ((L || R) && f >= 0) { P.onLadder = false; P.y = FLOORS[f]; P.floor = f; P.vy = 0; }
    else if (!(L || R)) { if (f >= 0 && !U && !D) { P.y = FLOORS[f]; P.floor = f; } }
    P.anim += (U || D) ? dt * 8 : 0;
  } else {
    P.vx = (R ? 1 : 0) - (L ? 1 : 0);
    if (P.vx) P.facing = P.vx;
    P.x += P.vx * 175 * dt; P.anim += P.vx ? dt * 10 : 0;
    if (keys[' '] && P.grounded) { P.vy = -470; P.grounded = false; }
    P.vy += 1500 * dt; const oy = P.y; P.y += P.vy * dt;
    // land on a floor line, bump the ceiling of the floor above
    P.grounded = false;
    for (let f = 0; f < FLOORS.length; f++) {
      const fy = FLOORS[f], spanOK = f === 0 ? true : (P.x > IN_L && P.x < IN_R);
      if (spanOK && oy <= fy && P.y >= fy && P.vy >= 0) { P.y = fy; P.vy = 0; P.grounded = true; P.floor = f; }
      if (f > 0 && spanOK && oy - 34 >= FLOORS[f - 1] && P.y - 34 < FLOORS[f - 1] && P.vy < 0) { P.y = FLOORS[f - 1] + 34; P.vy = 0; }
    }
    if (P.floor === 0) P.x = clamp(P.x, 20, W - 12); else P.x = clamp(P.x, IN_L + 8, IN_R - 8);
  }
  P.inMed = P.floor === 2 && P.x > ROOMS.med.x0 && !P.onLadder;
  if (P.cd > 0) P.cd -= dt;
  if ((keys.j || mouse.down) && P.cd <= 0) shoot();
  if (P.hurt > 0) P.hurt -= dt;
}
function shoot() {
  P.cd = 0.34;
  const dir = mouse.down && scene !== 'menu' ? (Math.sign(mouse.wx - P.x) || P.facing) : P.facing; P.facing = dir;
  fx.bullets.push({ x: P.x + dir * 12, y: P.y - 20, vx: dir * 900, life: 0.55, dmg: Math.round((13 + S.player.lvl * 2) * armoryMult()), world: scene });
}
function bulletsTick(dt) {
  for (const b of fx.bullets) {
    b.x += b.vx * dt; b.life -= dt;
    const list = b.world === 'scav' ? (scav ? scav.enemies : []) : S.enemies;
    for (const e of list) {
      const spec = ENEMIES[e.type];
      if (e.hp > 0 && Math.abs(e.x - b.x) < spec.w / 2 + 4 && b.y > e.y - spec.h - 4 && b.y < e.y + 2) {
        if (b.world === 'scav') scavHit(e, b.dmg); else hitEnemy(e, b.dmg, P);
        b.life = 0; break;
      }
    }
  }
  fx.bullets = fx.bullets.filter(b => b.life > 0);
}

// Scavenging trips: a side-scrolling stretch of wasteland, rebuilt each trip.
function startScav() {
  S.stats.trips++;
  const len = 3600;
  const plats = [], crates = [], enemies = [];
  for (let x = 500; x < len - 300; x += rnd(260, 420)) plats.push({ x, y: rnd(470, 540), w: rnd(120, 220) });
  for (let i = 0; i < 9; i++) {
    const onPlat = Math.random() < 0.45 && plats.length;
    const p = onPlat ? pick(plats) : null;
    crates.push({ x: p ? p.x + rnd(16, p.w - 16) : rnd(300, len - 100), y: p ? p.y : 620, open: false, kind: pick(['crate', 'crate', 'locker', 'car']) });
  }
  const tier = Math.min(4, day());
  for (let i = 0; i < 4 + tier; i++) {
    const type = Math.random() < 0.5 ? 'hound' : (tier >= 2 && Math.random() < 0.3 ? 'raider' : 'ghoul');
    const b = ENEMIES[type];
    enemies.push({ id: uid++, type, x: rnd(700, len - 150), y: 620, hp: b.hp, max: b.hp, cd: 0, facing: -1, anim: 0, home: 0, vy: 0 });
  }
  enemies.forEach(e => e.home = e.x);
  const wanderer = Math.random() < 0.7 && living().length < 14 ? { x: rnd(1600, len - 300), y: 620, s: randomSurvivor(), talked: false } : null;
  scav = { len, plats, crates, enemies, wanderer, pack: { food: 0, scrap: 0, parts: 0, elec: 0, mat: 0 }, cam: 0, ruins: Array.from({ length: 40 }, () => ({ x: rnd(0, len), w: rnd(60, 180), h: rnd(60, 260), c: rnd(0, 1) })) };
  scene = 'scav';
  Object.assign(P, { x: 80, y: 620, vx: 0, vy: 0, onLadder: false, grounded: true, facing: 1 });
  lamp('You are topside. The bunker keeps running without you: I will call if the door is in trouble. Walk back to the left edge to come home.');
}
function endScav(keep) {
  if (keep && scav) {
    const got = Object.entries(scav.pack).filter(([, v]) => v > 0);
    if (S.rooms.storage) for (const e of got) e[1] = Math.ceil(e[1] * ROOM_FX.storageLoot);
    for (const [k, v] of got) S.res[k] += v;
    if (scav.recruit) { const c = makeCrew(scav.recruit); c.x = 300; c.floor = 0; c.y = FLOORS[0]; S.crew.push(c); lamp(c.name + ' joins the bunker. Give them a job in the Crew panel.', 'good'); }
    lamp(got.length ? 'Welcome back. You brought ' + got.map(([k, v]) => v + ' ' + RES.find(r => r.k === k).name.toLowerCase()).join(', ') + '.' : 'Welcome back. Nothing useful this time.', 'good');
  }
  scav = null; scene = 'bunker';
  placePlayer('surface-right');
  fx.bullets = [];
}
const SC_GROUND = 620;
function scavPlayerTick(dt) {
  const L = keys.a || keys.arrowleft, R = keys.d || keys.arrowright;
  P.vx = (R ? 1 : 0) - (L ? 1 : 0); if (P.vx) P.facing = P.vx;
  P.x = clamp(P.x + P.vx * 185 * dt, 10, scav.len - 10); P.anim += P.vx ? dt * 10 : 0;
  if ((keys[' '] || keys.w || keys.arrowup) && P.grounded) { P.vy = -560; P.grounded = false; }
  const oy = P.y; P.vy += 1500 * dt; P.y += P.vy * dt; P.grounded = false;
  if (P.y >= SC_GROUND) { P.y = SC_GROUND; P.vy = 0; P.grounded = true; }
  if (P.vy >= 0 && !(keys.s || keys.arrowdown)) for (const p of scav.plats) if (P.x > p.x && P.x < p.x + p.w && oy <= p.y && P.y >= p.y) { P.y = p.y; P.vy = 0; P.grounded = true; }
  if (P.cd > 0) P.cd -= dt;
  if ((keys.j || mouse.down) && P.cd <= 0) shoot();
  if (P.hurt > 0) P.hurt -= dt;
  scav.cam = clamp(P.x - W / 2, 0, scav.len - W);
  // enemies chase when close
  for (const e of scav.enemies) {
    if (e.hp <= 0) continue;
    const b = ENEMIES[e.type]; e.anim += dt * 8; if (e.cd > 0) e.cd -= dt;
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
  scav.enemies = scav.enemies.filter(e => e.hp > 0);
}
function scavHit(e, dmg) {
  e.hp -= dmg; fx.nums.push({ x: e.x, y: e.y - ENEMIES[e.type].h - 6, t: 0.7, s: Math.round(dmg), scav: true });
  burst(e.x, e.y - 12, '#7a2', 3, true);
  if (e.hp <= 0) { S.stats.kills++; S.player.xp += ENEMIES[e.type].xp; if (Math.random() < 0.5) scav.pack.scrap += 2; burst(e.x, e.y - 10, '#5a3', 10, true); }
}
function openCrate(c) {
  c.open = true;
  const roll = () => {
    const g = { food: 0, scrap: 0, parts: 0, elec: 0, mat: 0 };
    g.scrap += Math.floor(rnd(2, 8)); if (Math.random() < 0.55) g.parts += Math.floor(rnd(1, 4));
    if (Math.random() < (c.kind === 'car' ? 0.75 : 0.4)) g.elec += Math.floor(rnd(1, c.kind === 'car' ? 4 : 3));
    if (Math.random() < 0.5) g.mat += Math.floor(rnd(2, 6)); if (Math.random() < (c.kind === 'locker' ? 0.7 : 0.4)) g.food += Math.floor(rnd(2, 7));
    return g;
  };
  const g = roll(), txt = [];
  for (const k in g) if (g[k]) { scav.pack[k] += g[k]; txt.push('+' + g[k] + ' ' + RES.find(r => r.k === k).name.toLowerCase()); }
  fx.nums.push({ x: c.x, y: c.y - 30, t: 1.4, s: txt.join('  ') || 'empty', scav: true, wide: true });
}

// ---------------------------------------------------------------- 5. drawing
const cv = $('#c'), g = cv.getContext('2d');
const rock = Array.from({ length: 260 }, () => ({ x: rnd(0, W), y: rnd(216, H), r: rnd(1, 3.5), a: rnd(0.05, 0.18) }));
const stars = Array.from({ length: 90 }, () => ({ x: rnd(0, W), y: rnd(0, 180), r: rnd(0.5, 1.6) }));
function skyColors() {
  const h = hourF();
  const dayAmt = clamp(Math.min((h - 5) / 2, (21 - h) / 2), 0, 1);
  const top = mix([12, 10, 22], [150, 118, 84], dayAmt), bot = mix([28, 18, 20], [214, 160, 104], dayAmt);
  return { top, bot, dayAmt };
}
function mix(a, b, t) { return 'rgb(' + a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',') + ')'; }
function draw() {
  g.save();
  if (scene === 'scav' && scav) drawScav(); else drawBunker();
  g.restore();
}
function drawBunker() {
  const sky = skyColors();
  let gr = g.createLinearGradient(0, 0, 0, FLOORS[0]); gr.addColorStop(0, sky.top); gr.addColorStop(1, sky.bot);
  g.fillStyle = gr; g.fillRect(0, 0, W, FLOORS[0]);
  if (sky.dayAmt < 0.6) { g.fillStyle = 'rgba(255,240,220,' + (0.6 - sky.dayAmt) + ')'; for (const s of stars) { g.beginPath(); g.arc(s.x, s.y, s.r, 0, 7); g.fill(); } }
  // distant ruins
  g.fillStyle = 'rgba(40,28,22,.55)';
  for (let i = 0; i < 14; i++) { const x = i * 97 + 600, h = 30 + ((i * 53) % 70); if (x < W) g.fillRect(x, FLOORS[0] - h, 46, h); }
  // ground and underground
  g.fillStyle = '#4b3a2a'; g.fillRect(0, FLOORS[0], W, 16);
  g.fillStyle = '#1a130d'; g.fillRect(0, FLOORS[0] + 16, W, H);
  for (const r of rock) { g.fillStyle = 'rgba(120,90,60,' + r.a + ')'; g.fillRect(r.x, r.y, r.r * 2, r.r); }
  // rooms
  for (const [k, r] of Object.entries(ROOMS)) if (!r.build || S.rooms[k]) drawRoom(k, r);
  // shaft
  g.fillStyle = '#0e0a07'; g.fillRect(LADDER_X - 18, FLOORS[0], 36, FLOORS[3] - FLOORS[0] + 4);
  g.strokeStyle = '#6b5a40'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(LADDER_X - 10, FLOORS[0]); g.lineTo(LADDER_X - 10, FLOORS[3]); g.moveTo(LADDER_X + 10, FLOORS[0]); g.lineTo(LADDER_X + 10, FLOORS[3]); g.stroke();
  for (let y = FLOORS[0] + 10; y < FLOORS[3]; y += 16) { g.beginPath(); g.moveTo(LADDER_X - 10, y); g.lineTo(LADDER_X + 10, y); g.stroke(); }
  // floor slabs
  g.fillStyle = '#3a2d1f';
  for (let f = 1; f < 4; f++) { g.fillRect(IN_L - 6, FLOORS[f], IN_R - IN_L + 12, 10); }
  g.fillRect(IN_L - 14, FLOORS[0] + 16, 10, FLOORS[3] - FLOORS[0]); g.fillRect(IN_R + 4, FLOORS[0] + 16, 10, FLOORS[3] - FLOORS[0]);
  drawSurface(sky);
  // night over the surface only: the bunker keeps its lamps
  if (sky.dayAmt < 1) { g.fillStyle = 'rgba(5,6,18,' + (0.55 * (1 - sky.dayAmt)) + ')'; g.fillRect(0, 0, W, FLOORS[0] + 16); }
  for (const c of S.crew) if (c.alive) drawPerson(c.x, c.y, c.color, c.accent, c, c.anim, c.facing, c.state === 'sleep', c.climbing);
  for (const e of S.enemies) drawEnemy(e);
  if (!S.player.down) drawMara();
  drawFx(0);
  if (S.breached) { g.fillStyle = 'rgba(255,40,30,' + (0.06 + 0.05 * Math.sin(performance.now() / 150)) + ')'; g.fillRect(0, 0, W, H); }
}
function drawRoom(k, r) {
  const y0 = FLOORS[r.floor - 1] + (r.floor === 1 ? 16 : 10), y1 = FLOORS[r.floor];
  const gr = g.createLinearGradient(0, y0, 0, y1); gr.addColorStop(0, '#2a1d12'); gr.addColorStop(1, '#4a3018');
  g.fillStyle = gr; g.fillRect(r.x0, y0, r.x1 - r.x0, y1 - y0);
  // lamplight
  const lx = (r.x0 + r.x1) / 2, rg = g.createRadialGradient(lx, y0 + 18, 4, lx, y0 + 40, (r.x1 - r.x0) * 0.6);
  rg.addColorStop(0, 'rgba(255,170,70,.32)'); rg.addColorStop(1, 'rgba(255,170,70,0)'); g.fillStyle = rg; g.fillRect(r.x0, y0, r.x1 - r.x0, y1 - y0);
  g.fillStyle = '#ffcf7a'; g.fillRect(lx - 6, y0 + 2, 12, 4);
  g.strokeStyle = '#5a4428'; g.lineWidth = 2; g.strokeRect(r.x0 + 1, y0 + 1, r.x1 - r.x0 - 2, y1 - y0 - 2);
  g.fillStyle = 'rgba(255,214,150,.8)'; g.font = '600 12px "Chakra Petch", sans-serif';
  const lvl = S.rooms[k] > 1 ? ' II' : '';
  g.fillText(r.name.toUpperCase() + lvl, r.x0 + 10, y0 + 16);
  g.save(); g.translate(0, y1);
  // furniture, very simple
  if (k === 'workshop') { box(320, -34, 120, 34, '#5c4630'); box(330, -46, 40, 12, '#7a6a55'); box(520, -60, 60, 60, '#3d3a36'); g.fillStyle = '#ffb347'; g.fillRect(532, -48, 8, 8); }
  if (k === 'kitchen') { box(300, -30, 70, 30, '#6b4b33'); for (let i = 0; i < 4; i++) { box(430 + i * 62, -40, 50, 8, '#3a5a2a'); g.fillStyle = '#7ddc6f'; for (let j = 0; j < 4; j++) g.fillRect(434 + i * 62 + j * 12, -50 - (j % 2) * 4, 5, 10); } }
  if (k === 'med') { for (let i = 0; i < 3; i++) { box(760 + i * 140, -22, 90, 12, '#d8d2c4'); box(760 + i * 140, -10, 6, 10, '#777'); box(844 + i * 140, -10, 6, 10, '#777'); } g.fillStyle = '#e04848'; g.fillRect(1180, -80, 24, 8); g.fillRect(1188, -88, 8, 24); }
  if (k === 'bunks') { for (let i = 0; i < 6; i++) { box(290 + i * 88, -24, 70, 10, '#6a5a48'); box(290 + i * 88, -64, 70, 8, '#6a5a48'); } }
  if (k === 'common') { box(930, -28, 120, 8, '#6b4b33'); box(940, -20, 8, 20, '#5a3d28'); box(1030, -20, 8, 20, '#5a3d28'); }
  if (k === 'signal') drawTowerRoom();
  if (k === 'armory') { box(832, -56, 120, 6, '#4a4a44'); box(832, -30, 120, 6, '#4a4a44'); for (let i = 0; i < 5; i++) box(840 + i * 22, -56, 4, 26, '#2a2a26'); box(850, -18, 80, 18, '#5a4a32'); g.fillStyle = S.powered ? '#7fc8ff' : '#553'; g.fillRect(940, -70, 6, 6); }
  if (k === 'storage') { box(975, -60, 110, 6, '#5a4a38'); box(975, -30, 110, 6, '#5a4a38'); for (let i = 0; i < 4; i++) { box(980 + i * 26, -48, 20, 18, '#8a6a42'); box(980 + i * 26, -18, 20, 18, '#7a5c38'); } }
  if (k === 'generator') { box(1130, -44, 90, 44, '#3d4650'); box(1140, -58, 16, 14, '#2a2a26'); box(1150, -30, 30, 20, '#2a3038'); g.fillStyle = S.powered ? ((Math.floor(performance.now() / 250) % 2) ? '#7fc8ff' : '#3a6a8a') : '#553'; g.fillRect(1196, -36, 8, 8); }
  g.restore();
}
function box(x, y, w, h, c) { g.fillStyle = c; g.fillRect(x, y, w, h); }
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
  // the hatch house
  box(DOOR_X - 30, y - 46, 60, 46, '#4a4740'); box(DOOR_X - 34, y - 52, 68, 8, '#3a3832');
  const dp = S.door.hp / S.door.max;
  box(DOOR_X - 16, y - 38, 32, 38, dp > 0 ? mix([90, 40, 30], [120, 118, 110], dp) : '#140c08');
  if (dp <= 0) { g.strokeStyle = '#ff5a4e'; g.lineWidth = 2; g.strokeRect(DOOR_X - 16, y - 38, 32, 38); }
  hpBar(DOOR_X - 24, y - 62, 48, dp, '#ffb347');
  // tower mast topside
  const st = S.tower.done;
  if (st > 0) { g.strokeStyle = '#8a96a0'; g.lineWidth = 3; const mx = 1000, top = y - 40 - st * 28; g.beginPath(); g.moveTo(mx - 14, y); g.lineTo(mx, top); g.lineTo(mx + 14, y); g.stroke(); g.fillStyle = st > 2 ? '#7fc8ff' : '#ff5a4e'; g.beginPath(); g.arc(mx, top, 4, 0, 7); g.fill(); }
  // turrets
  S.turrets.forEach((t, i) => {
    const x = SLOT_X[i];
    if (!t) { g.strokeStyle = 'rgba(255,200,120,.35)'; g.setLineDash([4, 4]); g.strokeRect(x - 14, y - 24, 28, 24); g.setLineDash([]); return; }
    box(x - 14, y - 18, 28, 18, '#4f4a40'); box(x - 8, y - 32, 16, 14, t.manned ? '#6a6a5a' : '#45433b');
    g.fillStyle = '#2a2a26'; g.fillRect(x + 4, y - 28, t.type === 'rifle' ? 30 : 20, t.type === 'rifle' ? 4 : 7);
    if (t.flash > 0) { t.flash -= 1 / 60; g.fillStyle = '#ffe08a'; g.beginPath(); g.arc(x + (t.type === 'rifle' ? 36 : 26), y - 26, 5, 0, 7); g.fill(); }
    if (t.lvl > 1) { g.fillStyle = '#ffb347'; g.fillRect(x - 12, y - 16, 4, 4); }
    hpBar(x - 16, y - 44, 32, t.hp / t.max, '#ffb347');
    if (!t.manned) { g.fillStyle = 'rgba(255,90,78,.9)'; g.font = '600 10px "IBM Plex Sans"'; g.fillText('EMPTY', x - 15, y - 48); }
  });
  // wall
  if (S.wall.hp > 0) {
    const h = S.wall.lvl > 1 ? 58 : 44;
    for (let i = 0; i < 5; i++) box(WALL_X - 10 + (i % 2) * 3, y - h + i * (h / 5), 22, h / 5 - 1, i % 2 ? '#6a5640' : '#7a6650');
    if (S.wall.lvl > 1) { g.strokeStyle = '#999'; g.lineWidth = 1; for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(WALL_X - 12 + i * 8, y - h - 6); g.lineTo(WALL_X - 8 + i * 8, y - h); g.stroke(); } }
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
    g.fillStyle = '#2a2018'; g.fillRect(-5, -10, 4, 10 + (climbing ? 0 : step * 0.3)); g.fillRect(1, -10, 4, 10 - (climbing ? 0 : step * 0.3));
    box(-6, -26, 12, 16, color);
    g.fillStyle = '#e2c29a'; g.fillRect(-4, -34, 8, 8);
    g.fillStyle = accent; g.fillRect(facing > 0 ? 0 : -4, -33, 4, 2);
    if (c && c.id === 'bram') { g.fillStyle = '#c9c4b8'; g.fillRect(-4, -28, 8, 3); }
    if (c && c.id === 'juno') { g.fillStyle = '#222'; g.fillRect(facing > 0 ? 2 : -18, -22, 16, 3); }
    if (c && c.id === 'reed') { g.fillStyle = '#b0b8c0'; g.fillRect(-4, -31, 8, 2); }
    if (c && c.id === 'tick') { g.fillStyle = '#59d0c4'; g.fillRect(-5, -33, 10, 3); }
    if (c && c.state === 'patient') { g.fillStyle = '#e04848'; g.fillRect(-2, -44, 4, 10); g.fillRect(-5, -41, 10, 4); }
  }
  if (c) {
    if (c.hp < c.maxHp) hpBar(-10, -42, 20, c.hp / c.maxHp, '#7ddc6f');
    if (sel === c.id || hover === c) { g.fillStyle = '#ffe0a8'; g.font = '600 11px "IBM Plex Sans"'; const w = g.measureText(c.name).width; g.fillText(c.name, -w / 2, -48); }
    if (sel === c.id) { g.strokeStyle = '#ffb347'; g.lineWidth = 1.5; g.strokeRect(-10, -38, 20, 40); }
    if (sleepFactor(c.awake) < 0.6 && !sleeping) { g.fillStyle = '#ff8c2a'; g.font = '700 11px "IBM Plex Sans"'; g.fillText('!', 8, -30); }
  }
  g.restore();
}
function drawMara() {
  g.save(); g.translate(Math.round(P.x), Math.round(P.y));
  const step = Math.sin(P.anim) * 3;
  if (P.hurt > 0) g.globalAlpha = 0.6;
  g.fillStyle = '#2a2018'; g.fillRect(-5, -11, 4, 11 + step * 0.4); g.fillRect(1, -11, 4, 11 - step * 0.4);
  box(-7, -28, 14, 17, '#7a5a3a'); box(-7, -14, 14, 3, '#3a2a1a');
  g.fillStyle = '#e2c29a'; g.fillRect(-4, -36, 8, 8);
  g.fillStyle = '#2b1d12'; g.fillRect(-5, -38, 10, 3);
  g.fillStyle = '#ffb347'; g.fillRect(-5, -40, 10, 3); // the goggles
  g.fillStyle = '#222'; g.fillRect(P.facing > 0 ? 5 : -15, -24, 10, 3);
  g.restore();
  g.fillStyle = '#ffb347'; g.font = '700 10px "Chakra Petch"'; g.fillText('MARA', P.x - 13, P.y - 46);
}
function drawEnemy(e, ox = 0) {
  const b = ENEMIES[e.type];
  g.save(); g.translate(Math.round(e.x - ox), Math.round(e.y));
  const bob = Math.sin(e.anim) * 2;
  if (e.type === 'hound') { box(-13, -16 + bob * 0.5, 26, 10, b.color); box(e.facing < 0 ? -18 : 10, -20 + bob * 0.5, 8, 8, '#7a4f36'); g.fillStyle = '#ff4030'; g.fillRect(e.facing < 0 ? -16 : 15, -18, 2, 2); g.fillStyle = '#3a2818'; for (let i = 0; i < 4; i++) g.fillRect(-11 + i * 6, -6, 3, 6 + (i % 2 ? bob : -bob) * 0.5); }
  else if (e.type === 'brute') { box(-13, -40, 26, 30, b.color); box(-9, -48, 18, 10, '#8a7a96'); g.fillStyle = '#2a2030'; g.fillRect(-12, -10, 9, 10); g.fillRect(3, -10, 9, 10); g.fillStyle = '#ff4030'; g.fillRect(e.facing < 0 ? -6 : 2, -45, 3, 3); }
  else {
    g.fillStyle = '#2a2018'; g.fillRect(-5, -10, 4, 10 + bob); g.fillRect(1, -10, 4, 10 - bob);
    box(-7, -b.h + 6, 14, b.h - 16, b.color); g.fillStyle = e.type === 'ghoul' ? '#a9ae88' : '#d8b89a'; g.fillRect(-4, -b.h - 2, 8, 8);
    if (e.type === 'raider' || e.type === 'cinder') { g.fillStyle = '#222'; g.fillRect(e.facing < 0 ? -18 : 4, -b.h + 12, 14, 3); }
    if (e.type === 'cinder') { g.fillStyle = '#fff'; g.fillRect(-4, -b.h - 2, 8, 8); g.fillStyle = '#c22'; g.fillRect(-3, -b.h + 3, 6, 2); g.fillStyle = '#7a3a22'; g.fillRect(-10, -b.h + 8, 20, 4); }
  }
  g.restore();
  hpBar(e.x - ox - 12, e.y - b.h - 10, 24, e.hp / e.max, '#ff5a4e');
  if (b.boss) { g.fillStyle = '#ff5a4e'; g.font = '700 11px "Chakra Petch"'; g.fillText('CINDER', e.x - ox - 20, e.y - b.h - 16); }
}
function tracer(x1, y1, x2, y2, c, sc) { fx.tracers.push({ x1, y1, x2, y2, c, t: 0.09, sc: !!sc }); }
function burst(x, y, c, n, sc) { for (let i = 0; i < n; i++) fx.parts.push({ x, y, vx: rnd(-90, 90), vy: rnd(-140, 10), t: rnd(0.3, 0.7), c, sc: !!sc }); }
function drawFx(ox, scOnly) {
  const sc = !!scOnly;
  for (const t of fx.tracers) if (t.sc === sc) { g.strokeStyle = t.c; g.globalAlpha = clamp(t.t / 0.09, 0, 1); g.lineWidth = 1.5; g.beginPath(); g.moveTo(t.x1 - ox, t.y1); g.lineTo(t.x2 - ox, t.y2); g.stroke(); }
  g.globalAlpha = 1;
  for (const p of fx.parts) if (p.sc === sc) { g.fillStyle = p.c; g.fillRect(p.x - ox, p.y, 3, 3); }
  for (const b of fx.bullets) if ((b.world === 'scav') === sc) { g.fillStyle = '#ffe08a'; g.fillRect(b.x - ox - 4, b.y - 1, 8, 2); }
  g.font = '700 12px "IBM Plex Sans"';
  for (const n of fx.nums) if (!!n.scav === sc) { g.fillStyle = n.wide ? 'rgba(255,214,150,' + clamp(n.t, 0, 1) + ')' : 'rgba(255,240,200,' + clamp(n.t / 0.7, 0, 1) + ')'; const w = g.measureText(String(n.s)).width; g.fillText(n.s, n.x - ox - w / 2, n.y); }
}
function fxTick(dt) {
  for (const t of fx.tracers) t.t -= dt; fx.tracers = fx.tracers.filter(t => t.t > 0);
  for (const p of fx.parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 400 * dt; p.t -= dt; } fx.parts = fx.parts.filter(p => p.t > 0);
  for (const n of fx.nums) { n.y -= 24 * dt; n.t -= dt; } fx.nums = fx.nums.filter(n => n.t > 0);
}
function drawScav() {
  const ox = scav.cam, sky = skyColors();
  let gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, sky.top); gr.addColorStop(1, sky.bot);
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  if (sky.dayAmt < 0.6) { g.fillStyle = 'rgba(255,240,220,' + (0.6 - sky.dayAmt) + ')'; for (const s of stars) { g.beginPath(); g.arc(s.x, s.y, s.r, 0, 7); g.fill(); } }
  // far ruins (parallax), the broken highway, near ruins
  for (const r of scav.ruins) { const x = r.x - ox * 0.4; if (x < -200 || x > W + 200) continue; g.fillStyle = r.c > 0.5 ? 'rgba(52,38,30,.8)' : 'rgba(44,32,26,.7)'; g.fillRect(x, SC_GROUND - r.h - 40, r.w, r.h + 40); g.fillStyle = 'rgba(255,190,110,.08)'; for (let wy = SC_GROUND - r.h; wy < SC_GROUND - 30; wy += 26) g.fillRect(x + 8, wy, 8, 10); }
  g.fillStyle = '#3e3026'; for (let x = -((ox * 0.7) % 220); x < W; x += 220) { g.fillRect(x, 420, 160, 14); g.fillRect(x + 60, 434, 16, 186); }
  // ground
  g.fillStyle = '#5a4532'; g.fillRect(0, SC_GROUND, W, 8); g.fillStyle = '#2c2118'; g.fillRect(0, SC_GROUND + 8, W, H);
  // platforms
  for (const p of scav.plats) { const x = p.x - ox; if (x > W || x + p.w < 0) continue; box(x, p.y, p.w, 10, '#6a5640'); box(x + 6, p.y + 10, 8, SC_GROUND - p.y - 10, '#3d3226'); box(x + p.w - 14, p.y + 10, 8, SC_GROUND - p.y - 10, '#3d3226'); }
  // crates
  for (const c of scav.crates) {
    const x = c.x - ox; if (x < -40 || x > W + 40) continue;
    if (c.kind === 'car') { box(x - 30, c.y - 20, 60, 16, c.open ? '#3a3028' : '#6a4a3a'); box(x - 18, c.y - 30, 32, 10, c.open ? '#30281f' : '#5a3d30'); g.fillStyle = '#1a1410'; g.beginPath(); g.arc(x - 18, c.y - 4, 5, 0, 7); g.arc(x + 18, c.y - 4, 5, 0, 7); g.fill(); }
    else if (c.kind === 'locker') box(x - 10, c.y - 34, 20, 34, c.open ? '#3a3a3a' : '#5f6a70');
    else box(x - 12, c.y - 20, 24, 20, c.open ? '#3a2e22' : '#8a6a42');
    if (!c.open) { g.fillStyle = '#ffb347'; g.fillRect(x - 2, c.y - (c.kind === 'locker' ? 46 : c.kind === 'car' ? 40 : 30), 4, 4); }
  }
  // the way home
  box(20 - ox, SC_GROUND - 60, 6, 60, '#7a6650'); box(8 - ox, SC_GROUND - 66, 60, 16, '#4a3a28');
  g.fillStyle = '#ffd59a'; g.font = '600 11px "Chakra Petch"'; g.fillText('← BUNKER', 12 - ox, SC_GROUND - 54);
  if (scav.wanderer && !scav.wanderer.gone) { const w = scav.wanderer; drawPerson(w.x - ox, w.y, w.s.color, w.s.accent, null, performance.now() / 300, -1, false, false); g.fillStyle = '#ffe0a8'; g.font = '600 11px "IBM Plex Sans"'; g.fillText('?', w.x - ox - 3, w.y - 44); }
  for (const e of scav.enemies) drawEnemy(e, ox);
  if (!S.player.down) { g.save(); g.translate(-ox, 0); drawMara(); g.restore(); }
  drawFx(ox, true);
  if (sky.dayAmt < 1) { g.fillStyle = 'rgba(5,6,18,' + (0.5 * (1 - sky.dayAmt)) + ')'; g.fillRect(0, 0, W, H); }
}

// ---------------------------------------------------------------- 6. UI panels and input
const logs = [];
let quiet = false;
function lamp(text, kind = '', delayMs = 0) {
  if (quiet) return;
  const rid = S && S.rid;
  const add = () => { if (S && S.rid !== rid) return; logs.push({ text, kind, at: performance.now() }); if (logs.length > 3) logs.shift(); renderLog(); };
  delayMs ? setTimeout(add, delayMs) : add();
}
function renderLog() { $('#log').innerHTML = logs.map(l => `<div class="${l.kind}"><b>LAMP</b>${esc(l.text)}</div>`).join(''); }
setInterval(() => { const now = performance.now(); const before = logs.length; while (logs.length && now - logs[0].at > 16000) logs.shift(); if (logs.length !== before) renderLog(); }, 1000);

function setSpeed(s) { speed = s; paused = false; renderHud(); }
function nextThreat() {
  if (S.enemies.length) return { hot: true, text: S.enemies.length + ' hostiles' + (S.breached ? ' · HATCH BREACHED' : '') };
  if (S.spawns.length) return { hot: true, text: 'Raid incoming' };
  const h = hourF(); const to21 = (21 - h + 24) % 24; const m = Math.round(to21 * 60);
  return { hot: to21 < 1.5, text: 'Next raid in ' + (m >= 60 ? Math.floor(m / 60) + 'h ' : '') + (m % 60) + 'm' };
}
function renderHud() {
  if (!S) { $('#hud').innerHTML = ''; return; }
  const th = nextThreat(), pl = S.player;
  $('#hud').innerHTML = `<span class="clock">${clockText()}</span>
    <span class="res">${RES.map(r => { const v = Math.floor(S.res[r.k]); const low = r.k === 'food' ? v < living().length * 2 : v < 3; return `<span title="${r.name}"><i style="background:${r.color}"></i>${r.name} <b class="${low ? 'low' : ''}">${v}</b></span>`; }).join('')}</span>
    <span class="threat ${th.hot ? 'hot' : ''}">${esc(th.text)}</span>
    <span class="threat" title="Mara">Mara ${Math.ceil(pl.hp)}/${pl.maxHp}${pl.down ? ' · down' : ''}</span>
    <span class="spd">${[0, 1, 2, 3].map(s => `<button data-spd="${s}" class="${(s === 0 ? paused : (!paused && speed === s)) ? 'on' : ''}" title="${s ? s + 'x speed (' + s + ')' : 'Pause (P)'}">${s ? s + 'x' : 'II'}</button>`).join('')}</span>`;
}
document.addEventListener('click', e => { const b = e.target.closest('[data-spd]'); if (!b) return; const s = +b.dataset.spd; if (s === 0) paused = !paused; else setSpeed(s); renderHud(); });

let tab = 'crew', sel = null, hover = null;
function openDrawer(t) { tab = t; $('#drawer').hidden = false; $('#wrap').classList.add('dopen'); renderDrawer(); }
function closeDrawer() { $('#drawer').hidden = true; $('#wrap').classList.remove('dopen'); }
function toggleDrawer(t) { if (!$('#drawer').hidden && tab === t) closeDrawer(); else openDrawer(t); }
function bar(pct, c) { return `<div class="bar"><i style="width:${clamp(pct, 0, 100)}%;background:${c}"></i></div>`; }
function canPay(c) { return Object.entries(c).every(([k, v]) => S.res[k] >= v); }
function pay(c) { for (const [k, v] of Object.entries(c)) S.res[k] -= v; }
function renderDrawer() {
  if ($('#drawer').hidden || !S) return;
  document.querySelectorAll('.tabs [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  const body = $('#dbody'); const keep = body.scrollTop;
  body.innerHTML = tab === 'crew' ? crewHTML() : tab === 'build' ? buildHTML() : towerHTML();
  body.scrollTop = keep;
}
function crewHTML() {
  const list = [...S.crew].sort((a, b) => (b.alive - a.alive) || (b.named - a.named));
  const gunners = j => living().filter(c => c.job === j).length;
  return `<p class="note" style="margin:0">Jobs decide where people go when they are awake. Shifts decide when they sleep: after about 16 hours awake they slow down fast. Turrets only fire with someone on them.</p>
  ${[0, 1].map(i => !S.turrets[i] ? '' : !gunners(i ? 'turretB' : 'turretA') ? `<p class="note bad" style="margin:0">Turret ${i + 1} has nobody assigned.</p>` : '').join('')}
  ${list.map(c => {
    if (!c.alive) return `<div class="card dead"><div class="ch"><span class="sw" style="background:${c.color}"></span><b>${esc(c.name)}</b><span class="tag">${c.left ? 'left the bunker' : 'lost'}</span></div></div>`;
    const sf = sleepFactor(c.awake), rest = restPct(c);
    const state = c.state === 'sleep' ? 'sleeping' : c.state === 'patient' ? 'in the med bay' : c.state === 'fight' ? 'fighting!' : c.state === 'walk' ? 'on the way' : 'working';
    const bondNames = c.bonds.map(id => S.crew.find(o => o.id === id)).filter(o => o && o.alive).map(o => o.name);
    return `<div class="card ${sel === c.id ? 'sel' : ''}" data-crew="${c.id}">
      <div class="ch"><span class="sw" style="background:${c.color}"></span><b>${esc(c.name)}</b><span class="tag">${esc(c.role)} · ${state}</span><span class="lvl">LV ${c.lvl}</span></div>
      <div class="bars"><span>Health</span>${bar(c.hp / c.maxHp * 100, '#7ddc6f')}<span>Food</span>${bar(c.food, '#c9a27a')}<span>Rest</span>${bar(rest, sf < 0.6 ? '#ff5a4e' : '#7fc8ff')}</div>
      <div class="row">${Object.entries(JOBS).map(([k, j]) => { const dis = (k === 'turretA' && !S.turrets[0]) || (k === 'turretB' && !S.turrets[1]); return `<button class="chip ${c.job === k ? 'on' : ''}" data-job="${k}" data-id="${c.id}" ${dis ? 'disabled title="Build this turret first"' : ''}>${j.label}</button>`; }).join('')}</div>
      <div class="row" style="margin-top:5px">${Object.entries(SHIFTS).map(([k, s]) => `<button class="chip ${c.shift === k ? 'on' : ''}" data-shift="${k}" data-id="${c.id}">${s.label}${s.sleep ? ' ' + s.sleep[0] + '–' + s.sleep[1] : ''}</button>`).join('')}</div>
      <div class="note">Aim ${pctS(c.stats.acc)} · Build ${pctS(c.stats.build)} · Cook ${pctS(c.stats.cook)} · Medic ${pctS(c.stats.med)} · Tech ${pctS(c.stats.tech)}${sf < 1 ? ` · <span style="color:var(--red)">working at ${Math.round(sf * 100)}% (tired)</span>` : ''}${c.grief > 0 ? ' · grieving' : ''}${bondNames.length ? `<br>Works better beside ${esc(bondNames.join(', '))}` : ''}${!c.named && c.loyalty < 1 ? `<br>Morale ${Math.round(morale(c))}${morale(c) < 40 ? ' <span style="color:var(--red)">· might leave</span>' : ''}` : ''}</div>
    </div>`;
  }).join('')}`;
}
const pctS = v => Math.round(v * 100);
function buildHTML() {
  const item = (title, desc, cost, act, ok = true, label = 'Build') => `<div class="card bitem"><div><b>${title}</b><p>${desc}</p>${cost ? `<span class="cost">${fmtCost(cost)}</span>` : ''}</div><button class="btn" data-build="${act}" ${ok && (!cost || canPay(cost)) ? '' : 'disabled'}>${label}</button></div>`;
  const repCost = s => ({ scrap: Math.ceil((s.max - s.hp) / 10) });
  const out = ['<div class="sec">DEFENSES</div>'];
  out.push(item('Repair the hatch', `${Math.ceil(S.door.hp)} / ${S.door.max}. The workshop also repairs it slowly.`, S.door.hp < S.door.max ? repCost(S.door) : null, 'repDoor', S.door.hp < S.door.max && !S.enemies.some(e => e.inside), 'Repair'));
  out.push(item(S.wall.hp > 0 ? 'Repair the wall' : 'Rebuild the wall', `${Math.ceil(S.wall.hp)} / ${S.wall.max}. Enemies have to break it before they reach the turrets.`, S.wall.hp < S.wall.max ? repCost(S.wall) : null, 'repWall', S.wall.hp < S.wall.max, 'Repair'));
  if (S.wall.lvl < 2) out.push(item('Reinforce the wall', 'Double its strength and add spikes.', { scrap: 30, mat: 12 }, 'upWall'));
  for (const i of [0, 1]) {
    const t = S.turrets[i];
    if (!t) { for (const [k, sp] of Object.entries(TURRETS)) out.push(item(`${sp.name} in slot ${i + 1}`, k === 'rifle' ? 'Long range, one accurate shot. Best with a good shot like Juno.' : 'Short range, four pellets. Shreds anything at the wall.', sp.cost, 'turret' + i + k)); }
    else {
      if (t.hp < t.max) out.push(item(`Repair turret ${i + 1}`, `${Math.ceil(t.hp)} / ${t.max}`, repCost(t), 'repT' + i, true, 'Repair'));
      if (t.lvl < 2) out.push(item(`Upgrade turret ${i + 1} (${TURRETS[t.type].name.toLowerCase()})`, '40% more damage per hit.', { parts: 8, elec: 2 }, 'upT' + i, true, 'Upgrade'));
    }
  }
  out.push('<div class="sec">ROOMS</div>');
  if (S.rooms.kitchen < 2) out.push(item('Kitchen: grow lamps', 'Hydroponics grows 50% more food.', { elec: 3, mat: 8 }, 'upKitchen', true, 'Upgrade'));
  if (S.rooms.med < 2) out.push(item('Med bay: proper beds', 'Patients heal 50% faster.', { elec: 3, mat: 6 }, 'upMed', true, 'Upgrade'));
  if (S.rooms.bunks < 2) out.push(item('Bunks: real mattresses', 'A full rest takes 5 hours instead of 7.', { scrap: 10, mat: 10 }, 'upBunks', true, 'Upgrade'));
  for (const [k, r] of Object.entries(BUILD_ROOMS)) if (!S.rooms[k]) out.push(item('Build ' + ROOMS[k].name, r.desc, r.cost, 'room_' + k));
  if (S.rooms.generator) out.push(`<p class="note">Generator: ${S.powered ? 'running, burning about ' + Math.round(ROOM_FX.fuelPerHour * 24) + ' scrap a day' : '<span style="color:var(--red)">OFF: out of scrap</span>'}</p>`);
  out.push(`<div class="card bitem"><div><b>Workshop makes parts</b><p>When nothing needs repairing, workshop crew turn 2 scrap into 1 part.</p></div><button class="btn ghost" data-build="toggleParts">${S.makeParts ? 'On' : 'Off'}</button></div>`);
  return out.join('');
}
function towerHTML() {
  const st = S.tower.done, cur = TOWER[st], need = cur ? cur.work : 0;
  const workers = living().filter(c => c.job === 'signal');
  return `<p class="note" style="margin:0">Finish all four stages to send the signal and win. Pay for a stage here, then give crew the Signal tower job. People with high Tech work faster.</p>
  <div class="stages">${TOWER.map((t, i) => `<div class="card stage ${i < st ? 'done' : i === st ? 'cur' : ''}"><span class="n">${i < st ? '✓' : i + 1}</span><div style="flex:1"><b>${t.name}</b><p class="note" style="margin:2px 0 0">${fmtCost(t.cost)} · ${t.work} work</p>
    ${i === st ? (S.tower.paid ? `<div style="margin-top:6px">${bar(S.tower.work / need * 100, '#7fc8ff')}</div><p class="note">${Math.floor(S.tower.work)} / ${need} work · ${workers.length ? workers.map(w => esc(w.name)).join(', ') + ' on it' : '<span style="color:var(--red)">nobody is on the Signal tower job</span>'}</p>` : `<button class="btn" style="margin-top:6px" data-build="tower" ${canPay(t.cost) ? '' : 'disabled'}>Start this stage</button>`) : ''}</div></div>`).join('')}</div>`;
}
$('#dbody').addEventListener('click', e => {
  const j = e.target.closest('[data-job]'), s = e.target.closest('[data-shift]'), b = e.target.closest('[data-build]'), card = e.target.closest('[data-crew]');
  if (j) { const c = S.crew.find(x => x.id === j.dataset.id); c.job = j.dataset.job; c.alarmSlot = null; sel = c.id; renderDrawer(); return; }
  if (s) { const c = S.crew.find(x => x.id === s.dataset.id); c.shift = s.dataset.shift; sel = c.id; renderDrawer(); return; }
  if (b) { doBuild(b.dataset.build); renderDrawer(); renderHud(); return; }
  if (card) { sel = card.dataset.crew; renderDrawer(); }
});
function doBuild(a) {
  const rep = s => { const c = { scrap: Math.ceil((s.max - s.hp) / 10) }; if (!canPay(c)) return false; pay(c); s.hp = s.max; return true; };
  if (a === 'repDoor') { if (S.enemies.some(e => e.inside) || !rep(S.door)) return; S.breached = false; lamp('Hatch repaired.', 'good'); }
  else if (a === 'repWall') { if (rep(S.wall)) lamp('Wall repaired.', 'good'); }
  else if (a === 'upWall') { const c = { scrap: 30, mat: 12 }; if (!canPay(c)) return; pay(c); S.wall.lvl = 2; S.wall.max = 600; S.wall.hp = 600; lamp('The wall is reinforced.', 'good'); }
  else if (/^turret\d/.test(a)) { const i = +a[6], k = a.slice(7), sp = TURRETS[k]; if (!canPay(sp.cost) || S.turrets[i]) return; pay(sp.cost); S.turrets[i] = { type: k, hp: sp.hp, max: sp.hp, lvl: 1, cd: 0 }; lamp(sp.name + ' built in slot ' + (i + 1) + '. Assign someone to it in Crew.', 'good'); }
  else if (/^repT/.test(a)) rep(S.turrets[+a[4]]);
  else if (/^upT/.test(a)) { const c = { parts: 8, elec: 2 }; if (!canPay(c)) return; pay(c); S.turrets[+a[3]].lvl = 2; lamp('Turret ' + (+a[3] + 1) + ' upgraded.', 'good'); }
  else if (a === 'upKitchen' || a === 'upMed' || a === 'upBunks') { const k = a.slice(2).toLowerCase(); const c = { kitchen: { elec: 3, mat: 8 }, med: { elec: 3, mat: 6 }, bunks: { scrap: 10, mat: 10 } }[k]; if (!canPay(c)) return; pay(c); S.rooms[k] = 2; lamp(ROOMS[k].name + ' upgraded.', 'good'); }
  else if (/^room_/.test(a)) { const k = a.slice(5), r = BUILD_ROOMS[k]; if (!r || S.rooms[k] || !canPay(r.cost)) return; pay(r.cost); S.rooms[k] = 1; lamp(ROOMS[k].name + ' built. ' + r.done, 'good'); }
  else if (a === 'toggleParts') S.makeParts = !S.makeParts;
  else if (a === 'tower') { const t = TOWER[S.tower.done]; if (!t || S.tower.paid || !canPay(t.cost)) return; pay(t.cost); S.tower.paid = true; S.tower.work = 0; lamp('Signal tower: work on the ' + t.name.toLowerCase() + ' can begin. Put people with Tech on the Signal tower job.', 'good'); }
}
function toggleAlarm() {
  S.alarm = !S.alarm;
  if (S.alarm) {
    // fill empty turrets first, then everyone else guards the door
    const free = [0, 1].filter(i => S.turrets[i]);
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
  if (scene === 'bunker' && P.floor === 0 && P.x > W - 60 && !S.player.down) return { text: 'E · Go scavenging (time keeps running)', act: () => startScav() };
  if (scene === 'scav' && scav) {
    if (P.x < 70) return { text: 'E · Return to the bunker', act: () => endScav(true) };
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
const mouse = { x: 0, y: 0, wx: 0, down: false };
function toCanvas(e) { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H }; }
cv.addEventListener('mousemove', e => { const p = toCanvas(e); mouse.x = p.x; mouse.y = p.y; mouse.wx = p.x + (scene === 'scav' && scav ? scav.cam : 0); hover = scene === 'bunker' && S ? personAt(p.x, p.y) : null; });
cv.addEventListener('mousedown', e => {
  if (scene !== 'bunker' && scene !== 'scav') return;
  const p = toCanvas(e);
  const c = scene === 'bunker' ? personAt(p.x, p.y) : null;
  if (c) { sel = c.id; openDrawer('crew'); setTimeout(() => document.querySelector(`[data-crew="${c.id}"]`)?.scrollIntoView({ block: 'nearest' }), 0); return; }
  mouse.down = true;
});
window.addEventListener('mouseup', () => mouse.down = false);
function personAt(x, y) { return living().find(c => Math.abs(c.x - x) < 11 && y < c.y + 2 && y > c.y - 40) || null; }
window.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (e.target.tagName === 'INPUT') return;
  if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
  if (scene === 'menu' || scene === 'over') return;
  keys[k] = true;
  if (k === 'e') { const it = interactable(); if (it && it.act) it.act(); }
  if (k === 'c') toggleDrawer('crew');
  if (k === 'b') toggleDrawer('build');
  if (k === 't') toggleDrawer('tower');
  if (k === 'g') toggleAlarm();
  if (k === 'h') showHelp(true);
  if (k === 'p') { paused = !paused; renderHud(); }
  if (k === '1' || k === '2' || k === '3') setSpeed(+k);
  if (k === 'escape') { if (!$('#drawer').hidden) closeDrawer(); else showPauseMenu(); }
});
window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouse.down = false; });
document.querySelectorAll('.tabs [data-tab]').forEach(b => b.onclick = () => openDrawer(b.dataset.tab));
$('#dClose').onclick = closeDrawer;
$('#tCrew').onclick = () => toggleDrawer('crew');
$('#tBuild').onclick = () => toggleDrawer('build');
$('#tTower').onclick = () => toggleDrawer('tower');
$('#tAlarm').onclick = () => toggleAlarm();
$('#tHelp').onclick = () => showHelp(true);

// menus
function overlay(html) { const o = $('#overlay'); o.innerHTML = html; o.hidden = !html; }
const HELP = `<div class="help">
  <h3>THE LOOP</h3><ul><li>Days are for work: give the crew jobs and shifts, build, and scavenge topside.</li><li>At 21:00 every night something attacks from the east. Bigger every night. Cinder comes on night 3.</li><li>Finish the four stages of the <b>signal tower</b> to win. Lose if everyone dies.</li></ul>
  <h3>THE CREW</h3><ul><li>Turrets only fire with someone on them. Good shots hit more.</li><li>Shifts decide who sleeps when. Past 16 hours awake people slow down fast. Hungry or grieving people work slower.</li><li>Meals are at 07:00, 13:00 and 19:00 (1 food each). Kitchen crew grow food.</li><li>Badly hurt crew go to the med bay on their own. Doc heals them faster.</li><li>Bram, Doc and Tick share history: paired on a job they work better. Lose one and the others grieve.</li><li>Newcomers may leave in the night with your supplies if morale is low.</li></ul>
  <h3>CONTROLS</h3><ul><li><kbd>A</kbd><kbd>D</kbd> move · <kbd>W</kbd><kbd>S</kbd> climb the shaft · <kbd>Space</kbd> jump · <kbd>J</kbd> or click to shoot</li><li><kbd>E</kbd> interact: walk off the right edge of the surface to scavenge · search crates · invite wanderers</li><li><kbd>C</kbd> crew · <kbd>B</kbd> build · <kbd>T</kbd> tower · <kbd>G</kbd> battle stations · <kbd>P</kbd> pause · <kbd>1</kbd>–<kbd>3</kbd> speed · click a person to select them</li></ul>
</div>`;
function showMenu() {
  scene = 'menu'; const sv = loadSave();
  overlay(`<div class="menu"><h1>ASHFALL<br>BUNKER</h1><p class="sub">Twenty years after the bombs. A hole in the ground, a handful of people, and a dead signal tower that might be a way out.</p>
    ${sv ? `<button class="btn" id="mContinue">Continue · Day ${Math.floor(sv.S.t / 1440) + 1}</button>` : ''}<button class="btn ${sv ? 'ghost' : ''}" id="mNew">New run</button><button class="btn ghost" id="mHelp">How to play</button>
    <p class="sub" style="font-size:12.5px">Web prototype · stage 1</p></div>`);
  $('#mNew').onclick = () => { clearSave(); newRun(); start(); };
  $('#mHelp').onclick = () => showHelp(false);
  if (sv) $('#mContinue').onclick = () => { S = sv.S; uid = 1 + S.crew.length + 1000; placePlayer('bunker'); if (sv.P) { P.x = sv.P.x; P.y = sv.P.y; P.floor = Math.max(0, FLOORS.findIndex(y => Math.abs(y - P.y) < 3)); } logs.length = 0; lamp('Welcome back, Mara. ' + summaryLine()); start(); };
}
function showHelp(inGame) {
  const was = paused; if (inGame) paused = true;
  overlay(`<div class="menu" style="width:640px"><h1 style="font-size:36px">HOW TO PLAY</h1>${HELP}<button class="btn" id="hBack">${inGame ? 'Back to the bunker' : 'Back'}</button></div>`);
  $('#hBack').onclick = () => { if (inGame) { overlay(''); paused = was; renderHud(); } else showMenu(); };
}
function showPauseMenu() {
  paused = true; renderHud();
  overlay(`<div class="menu"><h1 style="font-size:40px">PAUSED</h1><button class="btn" id="pRes">Resume</button><button class="btn ghost" id="pHelp">How to play</button><button class="btn ghost" id="pMenu">Save and quit to menu</button></div>`);
  $('#pRes').onclick = () => { overlay(''); paused = false; renderHud(); };
  $('#pHelp').onclick = () => showHelp(true);
  $('#pMenu').onclick = () => { save(); showMenu(); };
}
function start() { overlay(''); scene = 'bunker'; paused = false; speed = 1; closeDrawer(); renderHud(); $('#tAlarm').classList.toggle('on', !!S.alarm); }
function gameOver(won) {
  S.over = true; S.won = won; clearSave(); scene = 'over';
  const alive = living().map(c => c.name);
  overlay(won
    ? `<div class="menu"><h1 style="font-size:46px">THE SIGNAL IS OUT</h1><p class="sub">Lamp reads the reply aloud, slowly, the way it reads old maintenance logs: <i>“Bunker 12. We hear you. Hold on. We are coming.”</i> Somewhere above the ash, Nell would finally see the sky.</p>
       <p class="sub">Day ${day()} · ${alive.length} survivors · ${S.stats.kills} hostiles stopped · ${S.stats.trips} scavenging trip${S.stats.trips === 1 ? '' : 's'}${S.stats.lost.length ? ' · lost: ' + esc(S.stats.lost.join(', ')) : ''}</p><button class="btn" id="oNew">Play again</button></div>`
    : `<div class="menu"><h1 style="font-size:46px">THE BUNKER IS SILENT</h1><p class="sub">Lamp keeps reading the maintenance logs to empty rooms.</p><p class="sub">You held out until day ${day()} · ${S.stats.kills} hostiles stopped</p><button class="btn" id="oNew">Try again</button></div>`);
  $('#oNew').onclick = () => { newRun(); start(); };
}

// ---------------------------------------------------------------- 7. main loop
function fit() { const s = Math.min(innerWidth / W, innerHeight / H); $('#wrap').style.transform = `scale(${s})`; }
addEventListener('resize', fit); fit();
let last = performance.now(), hudT = 0, drawerT = 0;
function frame(now) {
  const dtReal = Math.min(0.05, (now - last) / 1000); last = now;
  if (S && (scene === 'bunker' || scene === 'scav')) {
    if (!paused) {
      const dt = dtReal * speed;
      // big speed-ups are split into small steps so fights stay fair
      const steps = Math.ceil(dt / 0.034); for (let i = 0; i < steps; i++) simTick(dt / steps);
      playerTick(dtReal); bulletsTick(dtReal); fxTick(dtReal);
    }
    const it = interactable(); $('#prompt').textContent = it ? it.text : '';
    hudT -= dtReal; if (hudT <= 0) { hudT = 0.25; renderHud(); renderScavHud(); }
    drawerT -= dtReal; if (drawerT <= 0) { drawerT = 0.6; if (!document.querySelector('#drawer:hover')) renderDrawer(); }
  }
  if (S) draw(); else { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); }
  requestAnimationFrame(frame);
}
function renderScavHud() {
  const h = $('#scavhud');
  if (scene !== 'scav' || !scav) { h.hidden = true; return; }
  h.hidden = false;
  const pk = Object.entries(scav.pack).filter(([, v]) => v > 0);
  h.innerHTML = `<b>TOPSIDE</b><span>Pack: ${pk.length ? pk.map(([k, v]) => v + ' ' + RES.find(r => r.k === k).name.toLowerCase()).join(', ') : 'empty'}</span><span>Hatch ${Math.ceil(S.door.hp)}/${S.door.max} · Wall ${Math.ceil(S.wall.hp)}</span>${S.enemies.length ? `<span style="color:var(--red)">Bunker under attack</span>` : ''}`;
}
// a quiet backdrop behind the menu
quiet = true; newRun(); quiet = false; showMenu();
requestAnimationFrame(frame);
// for automated tests
window.__ab = { get S() { return S; }, get P() { return P; }, get scene() { return scene; }, newRun, start, simTick, startScav, endScav, doBuild, toggleAlarm, setSpeed };
