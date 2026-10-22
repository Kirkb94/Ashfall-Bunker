/* systems.js - Ashfall Bunker: wear and maintenance, research tree, crew expeditions, refined combat.
   Loaded before game.js. Everything here is only called at run time, so it can use game.js globals
   (S, lamp, hitEnemy, living, ...) freely. State lives on the save object S:
     S.cond  { gen, stove, planter, t0, t1, door, wall }  condition 0-100
     S.rsch  { done:{}, cur:null, prog:{} }                research tree
     S.exp   { teams:[], log:[], seq:0 }                   expeditions
*/

// ====================================================================== WEAR AND MAINTENANCE
const COND_NAMES = { gen: 'Generator', stove: 'Stove', planter: 'Planters', t0: 'Turret 1', t1: 'Turret 2', door: 'Hatch', wall: 'Outer wall' };
const cond = k => (S && S.cond && S.cond[k] != null) ? S.cond[k] : 100;
// 100% = full speed, 0% = half speed (or 2x damage taken for the hatch and wall)
const wearF = k => 0.5 + 0.5 * cond(k) / 100;
function wearBy(k, amt) {
  if (!S) return;
  if (!S.cond || typeof S.cond !== 'object') S.cond = {};
  S.cond[k] = Math.max(0, cond(k) - amt * (tech('svc1') ? 0.75 : 1));
  const w = S.wearWarn || (S.wearWarn = {});
  if (S.cond[k] < 25 && !w[k]) { w[k] = 1; lamp((COND_NAMES[k] || k) + ' is badly worn. Put someone on the Workshop job to service it.', 'warn'); }
  else if (S.cond[k] > 60) w[k] = 0;
}
function condKeys() {
  const L = [];
  if (S.rooms.generator) L.push('gen');
  L.push('stove', 'planter');
  S.turrets.forEach((t, i) => { if (t && t.type !== 'coil') L.push('t' + i); });
  L.push('door', 'wall');
  return L;
}
// Workshop crew spend leftover work on the worst-worn item. 1 work = 1.2 condition points, 25 points per scrap.
function maintTick(work) {
  if (work <= 0) return work;
  const keys = condKeys().filter(k => cond(k) < 97).sort((a, z) => cond(a) - cond(z));
  if (!keys.length) return work;
  const k = keys[0];
  let pts = Math.min(100 - cond(k), work * 1.2);
  const scrapCost = pts / 25;
  if (S.res.scrap < scrapCost) pts = Math.max(0, S.res.scrap * 25);
  if (pts <= 0) return work;
  S.res.scrap -= pts / 25; S.cond[k] = Math.min(100, cond(k) + pts);
  if (cond(k) > 60 && S.wearWarn) S.wearWarn[k] = 0;
  return work - pts / 1.2;
}
function structDmgMul(what) {
  if (what !== 'door' && what !== 'wall') return 1;
  wearBy(what, 0.12);
  return (2 - wearF(what)) * (tech('wall1') ? 0.85 : 1);
}
function maintHTML() {
  const rows = condKeys().map(k => {
    const v = Math.round(cond(k));
    return `<div class="card"><div class="ch"><b>${COND_NAMES[k]}</b><span class="lvl">${v}%</span></div>${bar(v, v < 30 ? '#ff5a4e' : v < 60 ? '#ffb347' : '#7ddc6f', v < 30 ? 'low' : v < 60 ? 'rest' : 'hp', COND_NAMES[k])}${v < 30 ? '<div class="note" style="margin:2px 0 0"><span aria-hidden="true">\u26A0\uFE0E</span> Low</div>' : ''}</div>`;
  }).join('');
  const crew = living().filter(c => c.job === 'workshop').length;
  return `<div class="sec">MAINTENANCE</div><p class="note">Use wears things down. Worn machines work slower, worn turrets fire slower and jam, a worn hatch or wall takes more damage. Workshop crew service the worst one when nothing needs repairing, for a little scrap.${S.rooms.workshop && !crew ? ' <span style="color:var(--red)">Nobody is on the Workshop job.</span>' : ''}</p>${rows}`;
}

// ====================================================================== RESEARCH TREE
const TECH = {
  hydro1: { branch: 'Farming',     name: 'Better seeds',          cost: 30, req: [], desc: 'Hydroponics grows 15% more food.' },
  hydro2: { branch: 'Farming',     name: 'Grow lamps II',         cost: 60, req: ['hydro1'], desc: 'Hydroponics grows another 20% more.' },
  cook1:  { branch: 'Farming',     name: 'Smoke curing',          cost: 35, req: [], desc: 'Cooks make meals 15% faster.' },
  wall1:  { branch: 'Defense',     name: 'Poured concrete',       cost: 40, req: [], desc: 'The hatch and wall take 15% less damage.' },
  gun1:   { branch: 'Defense',     name: 'Hardened barrels',      cost: 40, req: [], desc: 'Turrets and guards hit 15% harder.' },
  gun2:   { branch: 'Defense',     name: 'Armor-piercing rounds', cost: 70, req: ['gun1'], desc: 'Bullets ignore half of an enemy\'s armor.' },
  gun3:   { branch: 'Defense',     name: 'Fast loaders',          cost: 50, req: ['gun1'], desc: 'Turrets reload 30% faster.' },
  pow1:   { branch: 'Engineering', name: 'Efficient wiring',      cost: 40, req: [], desc: 'The generator burns 20% less scrap.' },
  svc1:   { branch: 'Engineering', name: 'Preventive care',       cost: 35, req: [], desc: 'Machines and defences wear out 25% slower.' },
  med1:   { branch: 'Field',       name: 'Antiseptics',           cost: 40, req: [], desc: 'Wounds get infected half as often. The med bay heals 15% faster.' },
  exp1:   { branch: 'Field',       name: 'Field kits',            cost: 45, req: ['med1'], desc: 'Expeditions: fewer injuries and 10% more loot.' },
};
const rs = () => (S.rsch && S.rsch.done) ? S.rsch : (S.rsch = { done: {}, cur: null, prog: {} });
const tech = k => !!(S && S.rsch && S.rsch.done && S.rsch.done[k]);
const hydroMul = () => (tech('hydro1') ? 1.15 : 1) * (tech('hydro2') ? 1.2 : 1);
function researchWork(a) {
  const R = rs(); if (!R.cur || !TECH[R.cur]) return;
  const T = TECH[R.cur];
  R.prog[R.cur] = (R.prog[R.cur] || 0) + a;
  if (R.prog[R.cur] >= T.cost) { R.done[R.cur] = 1; lamp('Research complete: ' + T.name + '. ' + T.desc, 'good'); R.cur = null; }
}
function rsAction(a) {
  const R = rs();
  if (a.startsWith('start_')) {
    const k = a.slice(6), T = TECH[k]; if (!T || R.done[k] || !T.req.every(r => R.done[r])) return;
    R.cur = k; lamp('Research started: ' + T.name + '. Crew on the Research job will work on it.');
  } else if (a === 'stop') R.cur = null;
}
function researchHTML() {
  const R = rs(), out = [];
  const crew = living().filter(c => c.job === 'research' && c.state === 'work').length;
  if (!hasB('lab')) out.push('<p class="note bad">No research bench yet. Build the Research bench below first, then give crew the Research job.</p>');
  else out.push(`<p class="note">Crew on the Research job (Tech stat) work on one project at a time. ${crew ? crew + ' working now.' : 'Nobody is working on it right now.'}</p>`);
  if (R.cur) {
    const T = TECH[R.cur], p = R.prog[R.cur] || 0;
    out.push(`<div class="card"><div class="ch"><b>${T.name}</b><span class="lvl">${Math.floor(p)} / ${T.cost}</span></div>${bar(p / T.cost * 100, '#7fc8ff')}<div class="row" style="margin-top:6px"><button class="chip" data-build="rs_stop">Pause project</button></div></div>`);
  }
  for (const br of ['Farming', 'Defense', 'Engineering', 'Field']) {
    out.push(`<div class="sec">${br.toUpperCase()}</div>`);
    for (const [k, T] of Object.entries(TECH)) if (T.branch === br) {
      const done = R.done[k], locked = !T.req.every(r => R.done[r]), cur = R.cur === k, p = Math.floor(R.prog[k] || 0);
      const label = done ? 'Done' : cur ? 'Researching' : locked ? 'Locked' : (p ? 'Resume' : 'Start');
      const need = locked ? ' Needs ' + T.req.filter(r => !R.done[r]).map(r => TECH[r].name).join(', ') + '.' : '';
      out.push(`<div class="card bitem" ${done ? 'style="opacity:.65"' : ''}><div><b>${T.name}</b><p>${T.desc}${need}</p><span class="cost">${T.cost} research${p && !done ? ' · ' + p + ' done' : ''}</span></div><button class="btn" data-build="rs_start_${k}" ${done || locked || cur ? 'disabled' : ''}>${label}</button></div>`);
    }
  }
  return out;
}

// ====================================================================== CREW EXPEDITIONS
const DESTS = {
  farm:       { name: 'Abandoned farm',    days: 1, risk: 0.15, loot: { food: [15, 30], scrap: [3, 8] }, minDay: 1,
                foes: ['Feral dogs', 'A scavenger gang'], finds: ['A root cellar nobody emptied.', 'Dry grain in a silo.'], quiet: ['Empty fields. The wind does the talking.', 'They picked the orchard clean and moved on.'] },
  pharmacy:   { name: 'Looted pharmacy',   days: 1, risk: 0.25, loot: { elec: [1, 3], parts: [2, 5], scrap: [4, 10] }, minDay: 1,
                foes: ['Ash ghouls', 'A trap rigged by someone else'], finds: ['A sealed cabinet behind the counter.', 'Intact circuit boards in a back office.'], quiet: ['Shelves stripped to the studs.', 'Broken glass and a cold draught.'] },
  depot:      { name: 'Supply depot',      days: 2, risk: 0.35, loot: { scrap: [20, 40], mat: [5, 12] }, minDay: 2,
                foes: ['Raiders on lookout', 'A brute guarding the gate'], finds: ['Pallets of building material under tarp.', 'A forklift full of salvage.'], quiet: ['Rows of rusted shelving.', 'The loading dock is silent.'] },
  relay:      { name: 'Radio relay',       days: 2, risk: 0.40, loot: { elec: [3, 7], parts: [3, 6] }, minDay: 2,
                foes: ['Burrowers under the mast', 'Raiders camped in the shed'], finds: ['A working transformer.', 'Racks of old electronics, mostly intact.'], quiet: ['The mast hums in the wind.', 'Cables everywhere, most of them dead.'] },
  checkpoint: { name: 'Fallen checkpoint', days: 3, risk: 0.55, loot: { parts: [6, 12], scrap: [20, 35] }, gear: true, minDay: 3,
                foes: ['Cinder’s stragglers', 'An armed patrol', 'A booby-trapped barrier'], finds: ['An armoury nobody got to.', 'A locked footlocker with real ammunition.'], quiet: ['Sandbags and burned vehicles.', 'Boot prints, none of them fresh.'] },
};
const expPlan = { dest: 'farm', ids: [] };
const expState = () => (S.exp && Array.isArray(S.exp.teams)) ? S.exp : (S.exp = { teams: [], log: [], seq: 0 });
const expEligible = c => c.alive && !c.exp && !c.patient && c.hp >= c.maxHp * 0.5 && !c.sick;
function expRiskText(d, team) {
  const acc = team.length ? team.reduce((a, c) => a + c.stats.acc, 0) / team.length : 0.5;
  const armed = team.length ? team.filter(c => c.held).length / team.length : 0;
  const r = Math.min(0.9, Math.max(0.05, d.risk * (1.25 - 0.5 * acc) * (1 - 0.2 * armed) * (tech('exp1') ? 0.75 : 1)));
  return { r, label: r < 0.2 ? 'Low' : r < 0.35 ? 'Moderate' : r < 0.5 ? 'High' : 'Deadly' };
}
function expAction(a) {
  const E = expState();
  if (a.startsWith('dest_')) { if (DESTS[a.slice(5)]) expPlan.dest = a.slice(5); }
  else if (a.startsWith('crew_')) { const id = a.slice(5), i = expPlan.ids.indexOf(id); if (i >= 0) expPlan.ids.splice(i, 1); else if (expPlan.ids.length < 3) expPlan.ids.push(id); }
  else if (a === 'send') {
    const d = DESTS[expPlan.dest];
    const team = expPlan.ids.map(id => S.crew.find(c => c.id === id)).filter(c => c && expEligible(c));
    if (!d || team.length < 2) { lamp('An expedition needs two or three healthy crew.', 'warn'); return; }
    if (E.teams.length >= 2) { lamp('Two teams are already out.', 'warn'); return; }
    if (S.raidActive) { lamp('Not during a raid. Wait until the wave is cleared.', 'warn'); return; }
    if (day() < d.minDay) { lamp(d.name + ' is not reachable yet.', 'warn'); return; }
    const t = { id: ++E.seq, dest: expPlan.dest, ids: team.map(c => c.id), from: S.t, back: S.t + d.days * 1440 };
    for (const c of team) { dropCarry(c); if (c.plate) dropPlate(c); leaveState(c, 'left'); c.exp = t.id; c.dig = null; }
    E.teams.push(t); expPlan.ids = [];
    lamp(team.map(c => c.name).join(', ') + ' set out for the ' + d.name.toLowerCase() + '. Back in about ' + d.days + ' day' + (d.days > 1 ? 's' : '') + '.', 'good');
  }
}
function resolveExp(t) {
  const d = DESTS[t.dest];
  const team = t.ids.map(id => S.crew.find(c => c.id === id)).filter(c => c && c.alive);
  const lines = [];
  const risk = expRiskText(d, team).r;
  let lootMul = 1, lost = 0, hurt = 0;
  for (let i = 0; i < d.days + 1; i++) {
    const alive = team.filter(c => c.alive); if (!alive.length) break;
    const r = Math.random();
    if (r < risk) {
      const v = pick(alive), foe = pick(d.foes), dmg = Math.round(rnd(15, 40) * (tech('exp1') ? 0.8 : 1));
      v.hp -= dmg; lootMul *= 0.85;
      if (v.hp <= 0 && Math.random() < 0.6) { lines.push(foe + ' caught the team. ' + v.name + ' did not make it.'); lost++; v.exp = null; kill(v, 'expedition'); }
      else { v.hp = Math.max(5, v.hp); hurt++; lines.push(foe + ' jumped the team. ' + v.name + ' took ' + dmg + ' damage.'); }
    } else if (r > 0.78) { lines.push(pick(d.finds)); lootMul *= 1.25; }
    else lines.push(pick(d.quiet));
  }
  const got = [];
  const surv = team.filter(c => c.alive);
  if (surv.length) {
    for (const [k, [lo, hi]] of Object.entries(d.loot)) {
      const n = Math.max(0, Math.round(rnd(lo, hi) * lootMul * (tech('exp1') ? 1.1 : 1) * (0.7 + 0.15 * surv.length)));
      if (n) { S.res[k] = (S.res[k] || 0) + n; got.push(n + ' ' + k); }
    }
    if (d.gear && Math.random() < 0.6) { const id = pick(['smg', 'rifle', 'shotgun', 'machete']); addStock(id, 1); got.push('a ' + gearName(id)); }
  }
  for (const c of surv) { c.exp = null; c.x = 300; c.floor = 0; c.y = FLOORS[0]; c.state = 'walk'; c.food = Math.max(25, c.food - 15); c.climbing = false; }
  const head = surv.length ? (lost ? 'Team back from the ' : 'Team back from the ') + d.name.toLowerCase() + (got.length ? ' with ' + got.join(', ') : ' empty-handed') + (lost ? '. ' + lost + ' lost.' : hurt ? '. ' + hurt + ' hurt.' : '.') : 'Nobody came back from the ' + d.name.toLowerCase() + '.';
  expState().log.unshift({ t: S.t, dest: t.dest, head, lines }); expState().log.length = Math.min(expState().log.length, 8);
  lamp(head, lost || !surv.length ? 'warn' : 'good');
}
function expHour() {
  const E = expState();
  for (const t of E.teams.slice()) if (S.t >= t.back) { E.teams.splice(E.teams.indexOf(t), 1); resolveExp(t); }
}
function expHTML() {
  const E = expState(), out = [];
  out.push('<p class="note">Send two or three crew out for a day or more. Better shots, armed crew and Field kits lower the risk. Their jobs, beds and meals wait for them. Mara stays home.</p>');
  for (const t of E.teams) {
    const d = DESTS[t.dest], left = Math.max(0, t.back - S.t), names = t.ids.map(id => { const c = S.crew.find(x => x.id === id); return c ? esc(c.name) : '?'; }).join(', ');
    out.push(`<div class="card"><div class="ch"><b>${d.name}</b><span class="lvl">${Math.floor(left / 1440)}d ${Math.floor(left % 1440 / 60)}h left</span></div><p class="note" style="margin:4px 0">${names}</p>${bar((1 - left / (t.back - t.from)) * 100, '#7fc8ff')}</div>`);
  }
  out.push('<div class="sec">PLAN A TRIP</div><div class="row">' + Object.entries(DESTS).map(([k, d]) => `<button class="chip ${expPlan.dest === k ? 'on' : ''}" data-build="x_dest_${k}" ${day() < d.minDay ? 'disabled' : ''}>${d.name}</button>`).join('') + '</div>');
  const d = DESTS[expPlan.dest];
  const crew = living().filter(expEligible);
  expPlan.ids = expPlan.ids.filter(id => crew.some(c => c.id === id));
  const team = expPlan.ids.map(id => crew.find(c => c.id === id));
  const rk = expRiskText(d, team);
  out.push(`<p class="note">${d.days} day${d.days > 1 ? 's' : ''} · risk <b style="color:${rk.r < 0.2 ? 'var(--green)' : rk.r < 0.35 ? 'var(--amber)' : 'var(--red)'}">${rk.label}</b> · brings back ${Object.keys(d.loot).join(', ')}${d.gear ? ' and sometimes a weapon' : ''}.</p>`);
  out.push('<div class="sec">TEAM (' + expPlan.ids.length + '/3)</div><div class="row">' + (crew.length ? crew.map(c => `<button class="chip ${expPlan.ids.includes(c.id) ? 'on' : ''}" data-build="x_crew_${c.id}">${esc(c.name)}</button>`).join('') : '<span class="note">Nobody healthy is free.</span>') + '</div>');
  const can = expPlan.ids.length >= 2 && E.teams.length < 2 && !S.raidActive;
  out.push(`<div><button class="btn" data-build="x_send" ${can ? '' : 'disabled'}>Send team</button>${S.raidActive ? ' <span class="note bad">Not during a raid.</span>' : ''}</div>`);
  if (E.log.length) {
    out.push('<div class="sec">REPORTS</div>');
    for (const l of E.log.slice(0, 5)) out.push(`<div class="card"><b>${esc(l.head)}</b><p class="note" style="margin:4px 0 0">${l.lines.map(esc).join('<br>')}</p></div>`);
  }
  return out;
}

// ====================================================================== REFINED COMBAT
// damage types: pierce (rifle, pistol, machete), blunt (shotgun, pipe), shock (slow-field coil), bleed (damage over time)
const DMG_RES = {
  hound:    { blunt: 1.15 },
  ghoul:    { bleed: 0.6 },
  brute:    { pierce: 0.55, blunt: 1.25 },
  ram:      { pierce: 0.4, blunt: 0.85, shock: 1.3 },
  cinder:   { pierce: 0.8, shock: 1.3, bleed: 0.5 },
  burrower: { blunt: 1.2 },
  maw:      { pierce: 0.7, bleed: 0.3 },
};
function resMul(e, dtype) {
  let m = (DMG_RES[e.type] || {})[dtype]; if (m == null) m = 1;
  if (m < 1 && dtype === 'pierce' && tech('gun2')) m = (1 + m) / 2;
  return m * ((dtype === 'bleed' || dtype === 'shock') ? 1 : (tech('gun1') ? 1.15 : 1));
}
// status effects: bleed ticks damage, stun freezes the enemy. Returns true if the enemy loses its turn.
function statusTick(e, dt) {
  if (e.bleed) {
    e.bleed.t -= dt; e.bleedAcc = (e.bleedAcc || 0) + e.bleed.dps * dt;
    if (e.bleedAcc >= 1) { const n = Math.floor(e.bleedAcc); e.bleedAcc -= n; hitEnemy(e, n, null, 'bleed'); }
    if (e.bleed.t <= 0) e.bleed = null;
    if (e.hp <= 0) return true;
  }
  if (e.stun > 0) { e.stun -= dt; return true; }
  return false;
}
// raiders at a quarter health may break and run; the rest act normally
function tactics(e, b, dt) {
  if (e.type === 'raider' && !e.inside && !e.fleeChecked && e.hp < e.max * 0.25) { e.fleeChecked = true; if (Math.random() < 0.5) e.fleeing = true; }
  if (e.fleeing) {
    e.x += b.spd * 1.1 * dt; e.facing = 1;
    if (e.x > W + 40) { e.hp = 0; lamp('A raider broke and ran into the ash.'); }
    return true;
  }
  return false;
}
// ranged enemies shoot turrets that are within reach of a spot still outside the wall; everything else hits what is nearest
function pickTarget(e, b) {
  const L = structureList();
  if (b.ranged) {
    const reach = S.wall.hp > 0 ? WALL_X + 6 : 0;
    const tur = L.filter(t => t.name === 'turret' && t.x + b.ranged >= reach && t.x < e.x + 4);
    if (tur.length) return tur.sort((a, z) => a.s.hp - z.s.hp)[0];
  }
  return L.find(t => t.x < e.x + 4);
}
const coverMul = c => (c && c.floor === 0 && (c.job === 'door' || c.job === 'turretA' || c.job === 'turretB') && S.door.hp > 0) ? 0.8 : 1;
// weapons now change guard and melee combat
const GW = {
  none:    { kind: 'gun',   dmg: 11, range: 140, cd: 0.8,  pellets: 1, type: 'pierce', base: 0.4,  accK: 0.5 },
  pipe:    { kind: 'melee', dmg: 15, range: 28,  cd: 0.9,  type: 'blunt' },
  machete: { kind: 'melee', dmg: 19, range: 28,  cd: 0.7,  type: 'pierce', bleed: 0.3 },
  pistol:  { kind: 'gun',   dmg: 11, range: 140, cd: 0.8,  pellets: 1, type: 'pierce', base: 0.4,  accK: 0.5 },
  smg:     { kind: 'gun',   dmg: 6,  range: 130, cd: 0.28, pellets: 1, type: 'pierce', base: 0.3,  accK: 0.45 },
  shotgun: { kind: 'gun',   dmg: 9,  range: 90,  cd: 1.3,  pellets: 3, type: 'blunt',  base: 0.45, accK: 0.35 },
  rifle:   { kind: 'gun',   dmg: 24, range: 240, cd: 1.5,  pellets: 1, type: 'pierce', base: 0.35, accK: 0.55 },
};
const wpn = c => GW[c && c.held] || GW.none;
function crewShoot(c, foe) {
  const w = wpn(c); c.cd = w.cd;
  if (w.kind === 'melee') {
    hitEnemy(foe, w.dmg * eff(c) * armoryMult(), c, w.type);
    if (w.bleed && Math.random() < w.bleed) foe.bleed = { t: 4, dps: 2 };
    return;
  }
  for (let k = 0; k < w.pellets; k++) {
    tracer(c.x + c.facing * 8, c.y - 20, foe.x + rnd(-4, 4), foe.y - 14 + rnd(-5, 5), '#ffd27a');
    if (Math.random() < w.base + w.accK * c.stats.acc) hitEnemy(foe, w.dmg * eff(c) * armoryMult(), c, w.type);
  }
}
const meleeDmg = c => { const w = wpn(c); return w.kind === 'melee' ? w.dmg : 8 + c.stats.acc * 8; };
const meleeType = c => { const w = wpn(c); return w.kind === 'melee' ? w.type : 'blunt'; };

// ---- turrets: ammo, reloading, heat, target priority, wear ----
const TURRET_EXTRA = { rifle: { mag: 10, reload: 2.4, heat: 16 }, shotgun: { mag: 6, reload: 2.8, heat: 24 } };
const PRIOS = [['near', 'Nearest'], ['strong', 'Strongest'], ['weak', 'Weakest'], ['ranged', 'Ranged first']];
function pickFoe(t, i, spec) {
  const c = S.enemies.filter(e => !e.inside && !e.hidden && e.hp > 0 && e.x > SLOT_X[i] && e.x - SLOT_X[i] < spec.range && e.x < W + 10);
  if (!c.length) return null;
  const p = t.prio || 'near';
  if (p === 'strong') return c.sort((a, z) => z.hp - a.hp)[0];
  if (p === 'weak') return c.sort((a, z) => a.hp - z.hp)[0];
  if (p === 'ranged') return c.sort((a, z) => (!!ENEMIES[z.type].ranged - !!ENEMIES[a.type].ranged) || a.x - z.x)[0];
  return c.sort((a, z) => a.x - z.x)[0];
}
function turretTick(dt) {
  S.turrets.forEach((t, i) => {
    if (!t) return;
    if (t.cd > 0) t.cd -= dt;
    const spec = TURRETS[t.type];
    if (t.type === 'coil') {
      t.manned = !!S.powered;
      if (S.powered) {
        t.zap = (t.zap || 0) - dt;
        if (t.zap <= 0) {
          const foe = pickFoe(t, i, spec);
          if (foe) { t.zap = 2.6; if (window.SFX) SFX.turret('coil'); hitEnemy(foe, 9, null, 'shock'); foe.stun = Math.max(foe.stun || 0, 0.5); tracer(SLOT_X[i] + 16, FLOORS[0] - 48, foe.x, foe.y - 14, '#7fc8ff'); fxSparks(foe.x, foe.y - 14, 3, 1); }
          else t.zap = 0.5;
        }
      }
      return;
    }
    const ex = TURRET_EXTRA[t.type]; if (!ex) return;
    if (t.ammo == null) t.ammo = ex.mag;
    t.heat = Math.max(0, (t.heat || 0) - 14 * dt);
    if (t.over) { if (t.heat < 35) t.over = false; else return; }
    const gunner = living().find(c => c.state === 'work' && targetJob(c) === (i ? 'turretB' : 'turretA'));
    t.manned = !!gunner;
    if (!gunner) return;
    if (t.ammo <= 0 && !(t.reload > 0)) {
      if (S.res.scrap >= 1) { S.res.scrap -= 1; t.reload = ex.reload; }
      else { if (!t.dry) { t.dry = true; lamp('Turret ' + (i + 1) + ' is out of ammo and there is no scrap to reload it.', 'warn'); } return; }
    }
    if (t.reload > 0) {
      t.reload -= dt * (0.6 + gunner.stats.acc) * (tech('gun3') ? 1.3 : 1);
      if (t.reload <= 0) { t.reload = 0; t.ammo = ex.mag; t.dry = false; }
      return;
    }
    if (t.cd > 0) return;
    const target = pickFoe(t, i, spec); if (!target) return;
    const k = 't' + i;
    if (cond(k) < 30 && Math.random() < 0.12) { t.cd = 0.6; fxSparks(SLOT_X[i] + 16, FLOORS[0] - 30, 2, 1); return; }   // jam
    t.cd = spec.cd / wearF(k); t.flash = 0.08;
    const fxOn = typeof prefs === 'undefined' || (!prefs.ps && prefs.fx > 0), fxK = typeof prefs === 'undefined' ? 1 : prefs.fx;
    if (fxOn) { fxCasing(SLOT_X[i] + 14, FLOORS[0] - 28); if (t.type !== 'rifle') fxCasing(SLOT_X[i] + 14, FLOORS[0] - 28); }
    if (window.SFX) SFX.turret(t.type);
    if (fxOn && (typeof prefs === 'undefined' || !prefs.rm)) {
      fxSparks(SLOT_X[i] + 18, FLOORS[0] - 30, Math.max(1, Math.round(3 * Math.min(1, fxK))), 1);
      fxDust(SLOT_X[i] + 14, FLOORS[0] - 24, 2);
    }
    if (scene === 'bunker') addShake(t.type === 'rifle' ? 0.05 : 0.09);
    const e = eff(gunner), dtype = t.type === 'rifle' ? 'pierce' : 'blunt';
    for (let p = 0; p < spec.pellets; p++) {
      const ty = target.y - ENEMIES[target.type].h / 2 + rnd(-8, 8);
      if (typeof prefs === 'undefined' || !prefs.rm) tracer(SLOT_X[i] + 16, FLOORS[0] - 30, target.x + rnd(-6, 6), ty, t.type === 'rifle' ? '#ffe08a' : '#ffb060');
      if (Math.random() < (spec.base + spec.accK * gunner.stats.acc) * e) {
        const crit = Math.random() < 0.06 + 0.12 * gunner.stats.acc;
        hitEnemy(target, spec.dmg * (t.lvl > 1 ? 1.4 : 1) * armoryMult() * (crit ? 1.8 : 1), gunner, dtype, crit);
        if (crit && dtype === 'pierce') target.bleed = { t: 4, dps: 2 + (t.lvl > 1 ? 1 : 0) };
        if (dtype === 'blunt' && Math.random() < 0.25) target.stun = Math.max(target.stun || 0, 0.35);
      }
    }
    t.ammo--; t.heat += ex.heat; wearBy(k, 0.1);
    if (t.heat >= 100) { t.over = true; lamp('Turret ' + (i + 1) + ' overheated and is cooling down.', 'warn'); }
  });
}
function cyclePrio(i) {
  const t = S.turrets[i]; if (!t) return;
  const j = PRIOS.findIndex(p => p[0] === (t.prio || 'near'));
  t.prio = PRIOS[(j + 1) % PRIOS.length][0];
}
function turretStatusHTML(i) {
  const t = S.turrets[i]; if (!t || t.type === 'coil') return '';
  const ex = TURRET_EXTRA[t.type], pr = PRIOS.find(p => p[0] === (t.prio || 'near'));
  const ammo = t.ammo == null ? ex.mag : t.ammo, state = t.over ? ' · <span style="color:var(--red)">OVERHEATED</span>' : t.reload > 0 ? ' · reloading' : t.dry ? ' · <span style="color:var(--red)">NO AMMO</span>' : '';
  return `<div class="card"><div class="ch"><b>Turret ${i + 1} controls</b><span class="lvl">${ammo}/${ex.mag} ammo</span></div>${bar(Math.min(100, t.heat || 0), '#ff8c2a')}<p class="note" style="margin:4px 0">Heat ${Math.round(t.heat || 0)}% · condition ${Math.round(cond('t' + i))}%${state}. Each reload costs 1 scrap.</p><div class="row"><button class="chip on" data-build="prio_${i}">Target: ${pr[1]}</button></div></div>`;
}
