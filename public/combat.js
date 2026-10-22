'use strict';
// Ashfall Bunker: combat pass (ballistics, weapons, roof cannon). Loaded before game.js; uses its globals at run time.
// ====================================================================== BALLISTICS (combat pass)
// Every gun shot is a real projectile. It leaves the muzzle with a spread that grows with recoil ("bloom": each shot adds
// some, it walks the muzzle up and recovers over time) and shrinks with the shooter's skill, then flies with speed and
// gravity and only hurts what it touches. Misses fly on and kick up dust where they land. Some weapons build heat and
// lock up when they overheat. Art: SF_DRAFT holds the Sprite Forge drafts; the game draws them from code until the
// approved sheet is added to public/sprites (then the sheet is used).
const SF_DRAFT = {"revolver":{"o":[12,11],"g":[6,8],"t":[20,4.5],"ol":true,"r":[[9,4,11,2,"#5a5a5d"],[9,4,11,1,"#7a7a7d"],[8,3,5,4,"#7a7a7d"],[9,5,3,1,"#2a2a2e"],[6,3,3,4,"#5a5a5d"],[6,2,2,1,"#2a2a2e"],[19,3,1,1,"#3b332d"],[5,7,3,3,"#6b4a2e"],[4,9,3,2,"#6b4a2e"],[8,7,2,1,"#2a2a2e"]]},"bolt-action-rifle":{"o":[12,11],"g":[8,7],"t":[24,5],"ol":true,"r":[[0,5,7,3,"#6b4a2e"],[1,8,4,1,"#86603a"],[7,4,6,3,"#5a5a5d"],[7,5,17,1,"#5a5a5d"],[13,6,7,1,"#86603a"],[11,3,1,1,"#7a7a7d"],[11,2,3,1,"#7a7a7d"],[9,7,2,1,"#2a2a2e"],[22,4,1,1,"#3b332d"],[8,3,1,1,"#3b332d"]]},"nail-gun":{"o":[12,11],"g":[10,8],"t":[21,5],"ol":true,"r":[[7,3,9,4,"#c8a23a"],[7,3,9,1,"#e0bc52"],[16,4,4,2,"#5a5a5d"],[20,4,1,2,"#2a2a2e"],[9,7,3,4,"#2a2a2e"],[12,7,7,1,"#7a7a7d"],[13,8,5,1,"#c8ccd2"],[8,5,2,1,"#3b332d"]]},"crossbow":{"o":[12,11],"g":[6,9],"t":[21,5.5],"ol":true,"r":[[2,6,13,2,"#6b4a2e"],[2,6,13,1,"#86603a"],[17,2,1,8,"#86603a"],[16,1,1,2,"#86603a"],[16,9,1,2,"#86603a"],[15,3,1,1,"#3b332d"],[14,4,1,1,"#3b332d"],[15,8,1,1,"#3b332d"],[14,7,1,1,"#3b332d"],[9,5,11,1,"#b08a3a"],[20,5,1,1,"#7a7a7d"],[7,8,1,2,"#2a2a2e"],[5,8,2,3,"#6b4a2e"]]},"lmg":{"o":[12,11],"g":[7,8],"t":[24,4.5],"ol":true,"r":[[0,4,5,3,"#2a2a2e"],[5,3,9,4,"#5a5a5d"],[5,3,9,1,"#7a7a7d"],[8,7,5,4,"#2a2a2e"],[9,8,3,2,"#5a5a5d"],[14,4,7,2,"#2a2a2e"],[15,4,1,1,"#7a7a7d"],[17,4,1,1,"#7a7a7d"],[19,4,1,1,"#7a7a7d"],[21,4,3,1,"#5a5a5d"],[18,6,1,3,"#7a7a7d"],[20,6,1,3,"#7a7a7d"],[8,2,4,1,"#7a7a7d"],[6,7,2,3,"#463b32"]]},"flamethrower":{"o":[12,11],"g":[10,8],"t":[22,5],"ol":true,"r":[[1,4,6,5,"#8a3a2a"],[1,4,6,1,"#a8503a"],[3,3,2,1,"#7a7a7d"],[7,4,10,3,"#5a5a5d"],[7,4,10,1,"#7a7a7d"],[17,4,5,2,"#2a2a2e"],[22,4,1,1,"#ffb347"],[9,7,2,3,"#463b32"],[14,7,2,2,"#463b32"],[6,8,3,1,"#2a2a2e"]]},"heavy-mg-turret":{"o":[2,5],"g":[2,5],"t":[28,3.5],"ol":true,"r":[[2,1,10,8,"#4e5440"],[2,1,10,1,"#646b52"],[12,2,14,2,"#2a2a2e"],[12,5,14,2,"#2a2a2e"],[26,2,2,2,"#5a5a5d"],[26,5,2,2,"#5a5a5d"],[14,2,1,1,"#7a7a7d"],[18,2,1,1,"#7a7a7d"],[22,2,1,1,"#7a7a7d"],[4,8,6,2,"#646b52"],[6,3,3,3,"#3b332d"]]},"roof-cannon":{"o":[6,6],"g":[6,6],"t":[36,6],"ol":true,"r":[[0,2,10,8,"#2a2a2e"],[1,3,8,6,"#5a5a5d"],[10,3,22,6,"#5a5a5d"],[10,3,22,1,"#7a7a7d"],[18,3,2,6,"#7a7a7d"],[32,2,4,8,"#7a7a7d"],[33,4,3,4,"#3b332d"]]},"round":{"o":[3,1],"g":[3,1],"t":[3,1],"ol":false,"r":[[0,0,6,2,"#ffd27a"],[4,0,2,2,"#fff3c0"]]},"slug":{"o":[3.5,1.5],"g":[3.5,1.5],"t":[3.5,1.5],"ol":false,"r":[[0,0,5,3,"#b08a3a"],[5,0,2,3,"#ffd27a"],[6,1,1,1,"#fff3c0"]]},"shotgun-pellet":{"o":[1.5,1.5],"g":[1.5,1.5],"t":[1.5,1.5],"ol":false,"r":[[0,0,3,3,"#8a8a80"],[1,0,2,2,"#c8ccd2"]]},"nail":{"o":[3.5,1],"g":[3.5,1],"t":[3.5,1],"ol":false,"r":[[0,0,1,2,"#7a7a7d"],[1,0,6,1,"#c8ccd2"],[6,1,1,1,"#c8ccd2"]]},"crossbow-bolt":{"o":[6,1.5],"g":[6,1.5],"t":[6,1.5],"ol":false,"r":[[0,1,10,1,"#86603a"],[0,0,3,1,"#c84a3a"],[0,2,3,1,"#c84a3a"],[10,0,2,3,"#7a7a7d"]]},"cannon-shell":{"o":[4.5,2.5],"g":[4.5,2.5],"t":[4.5,2.5],"ol":true,"r":[[0,0,6,5,"#6a6a62"],[6,1,3,3,"#8a8a80"],[2,0,1,5,"#b08a3a"]]},"tracer-round":{"o":[5,1],"g":[5,1],"t":[5,1],"ol":false,"r":[[0,0,10,2,"#ff9a3a"],[4,0,6,2,"#ffd27a"],[8,0,2,2,"#fff3c0"]]},"flame-burst":{"o":[3,3],"g":[3,3],"t":[3,3],"ol":false,"r":[[1,0,4,6,"#ff9a3a"],[0,1,6,4,"#ff9a3a"],[1,1,4,4,"#ffb347"],[2,2,2,2,"#fff3c0"]]}};
let combatT = 0, gunnery = null;
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 2;   // roughly normal, sd 1
const PROJ_SLUG = { round: 'round', slug: 'slug', pellet: 'shotgun-pellet', nail: 'nail', bolt: 'crossbow-bolt', shell: 'cannon-shell', tracer: 'tracer-round', flame: 'flame-burst' };
const PROJ_TRAIL = { round: '255,224,138', slug: '255,208,112', tracer: '255,170,80', pellet: '220,220,200' };
// muzzle of each held weapon relative to its grip, in game px, pointing right (new weapons are filled in from SF_DRAFT)
const GEAR_MUZZLE = { pistol: [10, -3], smg: [16, -3], shotgun: [14, -2], rifle: [11, -1.5] };
const NEW_GEAR_ART = [['revolver', 'revolver'], ['bolt', 'bolt-action-rifle'], ['nailgun', 'nail-gun'], ['crossbow', 'crossbow'], ['lmg', 'lmg'], ['flamer', 'flamethrower']];
for (const [id, slug] of NEW_GEAR_ART) { const d = SF_DRAFT[slug]; GEAR_MUZZLE[id] = [d.t[0] - d.g[0], d.t[1] - d.g[1]]; }
// a Sprite Forge draft drawn from code: the draft point `anchor` (default: its grip) lands on (px, py); f < 0 mirrors
function drawDraft(slug, f, px, py, rot, anchor) {
  const d = SF_DRAFT[slug]; if (!d) return false;
  const a = anchor || d.g;
  g.save(); g.translate(px, py); if (rot) g.rotate(rot); if (f < 0) g.scale(-1, 1);
  if (d.ol) { g.fillStyle = '#3b332d'; for (const r of d.r) g.fillRect(r[0] - a[0] - 1, r[1] - a[1] - 1, r[2] + 2, r[3] + 2); }
  for (const r of d.r) { g.fillStyle = r[4]; g.fillRect(r[0] - a[0], r[1] - a[1], r[2], r[3]); }
  g.restore(); return true;
}
// Sprite Forge art: the exported sheet once it is in public/sprites, otherwise the draft
function sfArt(slug, f, px, py, rot, anchor) {
  const d = SF_DRAFT[slug]; if (!d) return;
  const a = anchor || d.g, key = 'sf:' + slug; SHEET_FILES[key] = slug;
  const s = sheetGet(key);
  if (s && s.ready) { g.save(); g.translate(px, py); if (rot) g.rotate(rot); if (f < 0) g.scale(-1, 1); g.translate(d.o[0] - a[0], d.o[1] - a[1]); try { sheetDraw(key, 'idle', 1, 0); } catch (e) {} g.restore(); return; }
  drawDraft(slug, f, px, py, rot, a);
}
// ---- heat and firing (shooter `sh` is Mara (P), a crew member, a turret or an enemy: it keeps bloom/heat on itself)
function heatNow(sh, w) { return Math.max(0, (sh.heat || 0) - (w.cool || 30) * Math.max(0, combatT - (sh.hT || 0))); }
function gunHeatOk(sh, w) {
  if (!w.heat) return true;
  sh.heat = heatNow(sh, w); sh.hT = combatT;
  if (sh.over && sh.heat < 35) sh.over = false;
  return !sh.over;
}
// o: { x, y (muzzle), tx, ty (aim point), acc 0..1, extra spread, world, by, dmg | dmgMul, type, fl (floor line), critP, bleedOnCrit, stunP, hostile, noFlash, reachMul }
function fireShot(sh, w, o) {
  const dtS = Math.max(0, combatT - (sh.bT || 0)); sh.bT = combatT;
  sh.bloom = Math.max(0, (sh.bloom || 0) - (w.recover || 0.4) * dtS);
  // aim a little high to allow for drop over the distance (crossbow bolts and nails arc the most)
  const tFl = Math.hypot(o.tx - o.x, o.ty - o.y) / (w.speed || 900), drop = 0.5 * (w.grav || 0) * tFl * tFl;
  const base = Math.atan2(o.ty - drop - o.y, o.tx - o.x), dir = Math.cos(base) >= 0 ? 1 : -1;
  const acc = o.acc == null ? 0.5 : clamp(o.acc, 0, 1);
  const sig = (w.spread || 0.03) * (1.7 - acc) + sh.bloom * 0.5 + (o.extra || 0);
  const climb = sh.bloom * 0.3, n = w.pellets || 1, spd0 = w.speed || 900;
  const reach = w.reach || (w.range || 300) * 2.4 * (o.reachMul || 1);
  const dmg = o.dmg != null ? o.dmg : (w.dmg || 10) * (o.dmgMul || 1);
  for (let k = 0; k < n; k++) {
    const a = base + gauss() * sig + (n > 1 ? gauss() * (w.pelletSpread || 0.08) : 0) - dir * climb, sp = spd0 * (1 + gauss() * 0.03);
    fx.bullets.push({ x: o.x, y: o.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: w.grav || 0, life: reach / sp, life0: reach / sp, dmg, type: o.type || w.type || 'pierce',
      world: o.world, by: o.by || null, fl: o.fl, proj: w.proj || 'round', pierce: w.pierce || 0, hits: null, critP: o.critP || 0, bleedP: w.bleedP || 0,
      bleedOnCrit: o.bleedOnCrit || 0, stunP: o.stunP || 0, burn: w.burn || 0, fall: !!w.falloff, hostile: !!o.hostile });
  }
  sh.bloom = Math.min(w.maxBloom || 0.35, sh.bloom + (w.recoil || 0.04));
  if (w.heat) { sh.heat = (sh.heat || 0) + w.heat; sh.hT = combatT; if (sh.heat >= 100) { sh.heat = 100; sh.over = true; } }
  const fl = w.flash == null ? 1 : w.flash;
  if (!o.noFlash && fl > 0 && w.proj !== 'flame') muzzle(o.x, o.y, dir, o.world === 'scav', base - dir * climb, fl);
  return dir;
}
// ---- Mara: her sidearm, or any weapon equipped from stock (Gear tab)
const MARA_SIDEARM = { kind: 'gun', dmg: 13, cd: 0.34, range: 520, pellets: 1, type: 'pierce', spread: 0.02, recoil: 0.035, recover: 0.3, speed: 950, grav: 120, proj: 'round', mz: [6, -2] };
function maraWpnId() { const id = S && S.player && S.player.wpn; return id && GW[id] && GEAR[id] ? id : null; }
function maraWpn() { const id = maraWpnId(); return id ? GW[id] : MARA_SIDEARM; }
function maraEquip(id) {
  if (!GEAR[id] || !(stock()[id] > 0)) return;
  const was = maraWpnId(); if (was) addStock(was, 1);
  stock()[id]--; S.player.wpn = id; P.heat = 0; P.over = false; P.bloom = 0;
  lamp('Mara takes the ' + GEAR[id].name + '.', 'good');
}
function maraUnequip() { const was = maraWpnId(); if (!was) return; addStock(was, 1); S.player.wpn = null; P.heat = 0; P.over = false; lamp('Mara puts the ' + GEAR[was].name + ' back in stock and goes back to her sidearm.'); }
function shoot() {
  const sc = scene === 'scav', id = maraWpnId(), t = aimTarget(), aid = AMMO_OF[id || 'sidearm'];
  let w = maraWpn();
  if (w.kind === 'gun' && aid && !((P.aAcc || 0) > 0) && maraAmmoCount(aid) <= 0) {   // dry: she draws her knife
    if (P.dryTold !== aid) { P.dryTold = aid; lamp('Mara is out of ' + AMMO[aid].name.toLowerCase() + '. She draws her knife: get close, or find ammo.', 'warn'); }
    w = KNIFE;
  } else if (w.kind === 'gun') P.dryTold = null;
  let tx, ty;
  if (t) { tx = t.x; ty = t.y; }
  else if (sc) { if (mouse.inCv && !document.body.classList.contains('touch')) { tx = mouse.wx; ty = mouse.wy; } else { tx = P.x + P.facing * 300; ty = P.y - 22; } }
  else return;                                   // in the bunker she only fires at something
  const dir = Math.sign(tx - P.x) || P.facing; P.facing = dir;
  const lvlK = 1 + 0.06 * ((S.player.lvl || 1) - 1);
  if (w.kind === 'melee') {
    P.cd = P.cdMax = w.cd * 0.8;
    const list = sc ? (scav.connected ? scav.enemies.concat(topRaidProxies()) : scav.enemies) : S.enemies.filter(e => (e.floor || 0) === (P.floor || 0) && !e.climbing);
    const foe = list.find(e => e.hp > 0 && !e.hidden && (e.x - P.x) * dir > -8 && Math.abs(e.x - P.x) < w.range + 14 && Math.abs(e.y - P.y) < 50);
    if (w === KNIFE && !foe && !t && !sc) return;
    if (foe) { const dmg = w.dmg * lvlK * armoryMult(); if (sc && !foe.raid) scavHit(foe, dmg); else { hitEnemy(foe.raid || foe, dmg, P, w.type); if (w.bleed && Math.random() < w.bleed) (foe.raid || foe).bleed = { t: 4, dps: 2 }; } }
    return;
  }
  if (!gunHeatOk(P, w)) { P.cd = 0.2; if (P.hotTold !== id) { P.hotTold = id; lamp('The ' + (id ? GEAR[id].name : 'sidearm') + ' overheated. Let it cool: watch the bar over Mara\'s head.', 'warn'); } return; }
  if (!spendAmmo(P, id || 'sidearm', () => maraTakeAmmo(aid))) return;
  P.cd = P.cdMax = id ? w.cd * 0.75 : w.cd;
  const hu = P._hxU != null ? P._hxU : 9, hv = P._hy != null ? P._hy : -13, mz = id ? (GEAR_MUZZLE[id] || [10, -2]) : w.mz;
  const mx = P.x + dir * (hu + mz[0]), my = P.y + hv + mz[1];
  const acc = Math.min(0.9, 0.5 + 0.03 * (S.player.lvl || 1));
  const extra = (Math.abs(P.vx || 0) > 0.1 ? 0.025 : 0) + (sc && !P.grounded ? 0.05 : 0);
  const dmgMul = (id ? lvlK : (13 + (S.player.lvl || 1) * 2) / 13) * armoryMult();
  const fl = sc ? (scav && scav.interior ? (scav.floors.find(y => Math.abs(y - P.y) < 40) || P.y) : undefined) : FLOORS[P.floor || 0];
  fireShot(P, w, { x: mx, y: my, tx, ty, acc, extra, world: scene, by: P, dmgMul, fl, critP: 0.05, reachMul: 2.2 });
  if (!sc && (P.floor || 0) === 0 && !['flame', 'bolt', 'nail'].includes(w.proj)) fxCasing(mx - dir * 6, my);
}
// ---- topside hostiles with guns fire real (dodgeable) shots at Mara
const ENEMY_GUN = { spread: 0.05, recoil: 0.03, recover: 0.6, speed: 720, grav: 140, proj: 'round', range: 260, pellets: 1 };
function enemyShot(e, b) {
  useEnemyAmmo(e);
  const f = Math.sign(P.x - e.x) || 1;
  fireShot(e, ENEMY_GUN, { x: e.x + f * 10, y: e.y - (b.h || 30) * 0.65, tx: P.x, ty: P.y - 22, acc: 0.3, world: 'scav', hostile: true, dmg: b.dmg, fl: scav && scav.interior ? e.y : undefined });
}
// ---- the projectile simulation (sub-stepped so fast rounds can't skip through a target)
function bulletList(b) {
  if (b.world === 'scav') return scav ? (scav.connected ? scav.enemies.concat(topRaidProxies()) : scav.enemies) : [];
  return S.enemies;
}
function bulletsTick(dt) {
  combatT += dt;
  shellsTick(dt);
  for (const b of fx.bullets) {
    if (b.world === 'scav' && !scav) { b.life = 0; continue; }
    const sp = Math.hypot(b.vx, b.vy || 0), steps = Math.min(12, Math.max(1, Math.ceil(sp * dt / 8))), h = dt / steps;
    const list = b.hostile ? null : bulletList(b);
    for (let s = 0; s < steps && b.life > 0; s++) {
      b.vy = (b.vy || 0) + (b.g || 0) * h; b.x += b.vx * h; b.y += b.vy * h; b.life -= h;
      if (bulletStep(b, list)) break;
    }
  }
  if (fx.bullets.length > 420) fx.bullets.splice(0, fx.bullets.length - 420);
  fx.bullets = fx.bullets.filter(b => b.life > 0);
}
function bulletStep(b, list) {
  const sc = b.world === 'scav';
  const ground = b.fl != null ? b.fl : (sc ? SC_GROUND : FLOORS[0]);
  if (!sc && b.fl != null && b.fl !== FLOORS[0] && (b.x < IN_L || b.x > IN_R || b.y < b.fl - 140)) { b.life = 0; return true; }   // bunker walls and ceilings
  if (sc && scav && scav.interior && (b.x < 0 || b.x > scav.len || (b.fl != null && b.y < b.fl - 200))) { b.life = 0; return true; }
  if (b.y >= ground) { b.life = 0; if (b.proj !== 'flame') { if (sc) burst(b.x, ground - 2, '#9a8a74', 2, true); else fxDust(b.x, ground - 2, 1); } return true; }
  if (b.hostile) {
    if (sc && scene === 'scav' && !S.player.down && Math.abs(P.x - b.x) < 7 && b.y > P.y - 40 && b.y < P.y + 2) { b.life = 0; hurtPlayer(b.dmg); return true; }
    return false;
  }
  for (const e of list) {
    const spec = ENEMIES[e.type];
    if (!spec || e.hp <= 0 || e.hidden) continue;
    if (b.fl != null && Math.abs(e.y - b.fl) > 8) continue;
    if (!(Math.abs(e.x - b.x) < spec.w / 2 + 2 && b.y > e.y - spec.h && b.y < e.y + 2)) continue;
    if (b.hits && b.hits.includes(e)) continue;
    let dmg = b.dmg * (b.fall ? 0.45 + 0.55 * b.life / b.life0 : 1);
    const t = e.raid || e;
    if (b.burn) {   // fire: damage gathers on the target and lands in chunks, and it keeps burning
      t._fa = (t._fa || 0) + dmg; if (!sc || e.raid) t.burn = { t: 2.5, dps: b.burn };
      if (t._fa >= 8) { const d = t._fa; t._fa = 0; if (sc && !e.raid) scavHit(e, d); else hitEnemy(t, d, b.by, 'fire'); }
    } else {
      const crit = b.critP && Math.random() < b.critP; if (crit) dmg *= 1.8;
      if (sc && !e.raid) scavHit(e, dmg);
      else {
        hitEnemy(t, dmg, b.by, b.type, crit);
        if (crit && b.bleedOnCrit) t.bleed = { t: 4, dps: b.bleedOnCrit };
        if (b.bleedP && Math.random() < b.bleedP) t.bleed = { t: 4, dps: 3 };
        if (b.stunP && Math.random() < b.stunP) t.stun = Math.max(t.stun || 0, 0.35);
      }
    }
    if (b.pierce > 0) { b.pierce--; (b.hits || (b.hits = [])).push(e); continue; }
    b.life = 0; return true;
  }
  return false;
}
// ---- the roof cannon: built once on the hatch house, fired by Mara from Lamp's terminal in the Signal Room
const LAMP_X = 767, CANNON_COST = { scrap: 40, parts: 16, elec: 6, mat: 10 }, CANNON_SHELL = { scrap: 2, parts: 1 };
const CANNON_TURN = 9, CANNON_RELOAD = 3.2, CANNON_G = 520, CANNON_R = 72;   // degrees per second, seconds, px/s^2, blast radius px
const cannonPivot = () => ({ x: DOOR_X + 4, y: FLOORS[0] - 60 });
function buildCannon() {
  if (S.cannon) return;
  if (!canPay(CANNON_COST)) { lamp('Not enough for the roof cannon: it needs ' + fmtCost(CANNON_COST) + '.', 'warn'); return; }
  pay(CANNON_COST); S.cannon = { ang: 12, cd: 0 };
  lampEv('room_built', 'Roof cannon built on the hatch house. Fire it from my terminal in the Signal Room: A and D turn the barrel, slowly. Hold Space for power. It loads cannon shells from storage; the workshop makes them.', 'good');
}
function startGunnery() {
  if (!S.cannon) return;
  gunnery = { pow: 0, charging: false }; P.vx = 0;
  // frame the roof and the approach (the barrel, aim line and power gauge sit top-left of the normal view)
  bcam.follow = null; bcam.anchor = null; bcam.z = bcam.tz = 1.5; bcam.cx = 600; bcam.cy = 170;
  document.body.classList.add('gunnery');
  lamp('Cannon controls. A/D (or W/S) turn the barrel, slowly. Hold Space to charge, release to fire. Low and flat stops troops; high arcs are artillery. E leaves.');
}
function stopGunnery() {
  gunnery = null; document.body.classList.remove('gunnery');
  bcam.z = bcam.tz = 1; bcam.cx = W / 2; bcam.cy = H / 2;
}
(function () { const st = document.createElement('style'); st.textContent = 'body.gunnery #goals{display:none}'; document.head.appendChild(st); })();
function gunneryText() {
  const c = S.cannon;
  return 'E · Leave the cannon · barrel ' + Math.round(c.ang) + '° · ' + (c.cd > 0 ? 'reloading' : gunnery.charging ? 'power ' + Math.round(gunnery.pow * 100) + '%' : 'hold Space to charge') + ' · A/D aim · ' + storeCount('am_cannon') + ' shells in storage';
}
function gunneryTick(dt) {
  const c = S.cannon;
  if (!c || S.player.down || (P.floor || 0) !== 1 || Math.abs(P.x - LAMP_X) > 60) { stopGunnery(); return; }
  const turn = ((kd('left') || kd('up')) ? 1 : 0) - ((kd('right') || kd('down')) ? 1 : 0);
  c.ang = clamp(c.ang + turn * CANNON_TURN * dt, -8, 72);
  if (c.cd > 0) c.cd -= dt;
  const held = kd('jump');
  if (held && c.cd <= 0) { gunnery.charging = true; gunnery.pow = Math.min(1, gunnery.pow + dt / 1.3); }
  else if (!held && gunnery.charging) { gunnery.charging = false; fireCannon(gunnery.pow); gunnery.pow = 0; }
  if (P.cd > 0) P.cd -= dt;
  if (P.hurt > 0) P.hurt -= dt;
}
function cannonVel(pow) { const a = S.cannon.ang * Math.PI / 180, v = 260 + 880 * clamp(pow, 0, 1); return { vx: Math.cos(a) * v, vy: -Math.sin(a) * v, a }; }
function fireCannon(pow) {
  const c = S.cannon; if (!c || c.cd > 0) return;
  if (!storeTake('am_cannon', 1)) { lamp('No cannon shells in storage. The workshop can make them (Gear tab, Ammo).', 'warn'); c.cd = 0.6; return; }
  c.cd = CANNON_RELOAD; c.kick = 0.25;
  const p = cannonPivot(), v = cannonVel(pow), mx = p.x + Math.cos(v.a) * 30, my = p.y - Math.sin(v.a) * 30;
  (fx.shells || (fx.shells = [])).push({ x: mx, y: my, vx: v.vx, vy: v.vy, t: 0 });
  muzzle(mx, my, 1, false, -v.a, 2.6); fxDust(mx, my, 4); addShake(0.18);
  try { window.SFX && SFX.turret && SFX.turret('shotgun'); } catch (e) {}
  S.stats.shells = (S.stats.shells || 0) + 1;
}
function shellsTick(dt) {
  if (!fx.shells || !fx.shells.length) return;
  for (const s of fx.shells) {
    const steps = Math.max(1, Math.ceil(Math.hypot(s.vx, s.vy) * dt / 10)), h = dt / steps;
    for (let k = 0; k < steps && !s.done; k++) {
      s.vy += CANNON_G * h; s.x += s.vx * h; s.y += s.vy * h; s.t += h;
      const hit = S.enemies.find(e => e.hp > 0 && !e.inside && !e.hidden && (e.floor || 0) === 0 && Math.abs(e.x - s.x) < ENEMIES[e.type].w / 2 + 3 && s.y > e.y - ENEMIES[e.type].h && s.y < e.y + 2);
      if (hit || s.y >= FLOORS[0]) { s.done = true; shellBoom(s.x, Math.min(s.y, FLOORS[0])); }
      else if (s.x > W + 2600 || s.x < -200 || s.t > 12) s.done = true;
    }
  }
  fx.shells = fx.shells.filter(s => !s.done);
}
function shellBoom(x, y) {
  for (const e of S.enemies) {
    if (e.hp <= 0 || e.inside || e.hidden || (e.floor || 0) !== 0) continue;
    const d = Math.hypot(e.x - x, (e.y - ENEMIES[e.type].h / 2) - y);
    if (d > CANNON_R) continue;
    const k = 1 - d / CANNON_R * 0.7;
    hitEnemy(e, 110 * k * armoryMult(), P, 'blunt', d < 18);
    e.stun = Math.max(e.stun || 0, 0.8 * k); e.x += Math.sign(e.x - x || 1) * 22 * k;
  }
  // the blast doesn't care whose wall or turret it is
  let own = false;
  if (S.wall.hp > 0 && Math.abs(x - WALL_X) < CANNON_R) { S.wall.hp = Math.max(0, S.wall.hp - 30 * (1 - Math.abs(x - WALL_X) / CANNON_R)); own = true; }
  S.turrets.forEach((t, i) => { const d = Math.abs(SLOT_X[i] - x); if (t && d < CANNON_R * 0.8) { t.hp = Math.max(1, t.hp - 25 * (1 - d / (CANNON_R * 0.8))); own = true; } });
  if (Math.abs(x - DOOR_X) < CANNON_R) { S.door.hp = Math.max(0, S.door.hp - 20); own = true; }
  if (own) lamp('That shell landed on our own defenses.', 'warn');
  (fx.booms || (fx.booms = [])).push({ x, y, t: 0.5 });
  fxRubble(x, y - 4, 8, FLOORS[0] - 2); fxDust(x, y - 4, 8); fxSparks(x, y - 6, 6, 0); burst(x, y - 8, '#ff9a3a', 8);
  addShake(x < W ? 0.3 : 0.12);
  try { window.SFX && SFX.death && SFX.death('big'); } catch (e) {}
}
function drawCannon(gy) {
  const c = S.cannon; if (!c) return;
  const p = cannonPivot(), a = c.ang * Math.PI / 180;
  box(p.x - 18, gy - 54, 36, 6, '#3a3832'); box(p.x - 9, p.y - 2, 18, 9, '#4f4a40');
  if (c.kick > 0) c.kick -= 1 / 60;
  const kick = Math.max(0, c.kick || 0) * 16;
  sfArt('roof-cannon', 1, p.x - Math.cos(a) * kick, p.y + Math.sin(a) * kick, -a);
  if (gunnery) {
    // the first part of the shell's path at the power being charged (half power while not charging)
    const v = cannonVel(gunnery.charging ? gunnery.pow : 0.5);
    let x = p.x + Math.cos(v.a) * 30, y = p.y - Math.sin(v.a) * 30, vx = v.vx, vy = v.vy;
    g.fillStyle = 'rgba(255,214,150,.85)';
    for (let i = 0; i < 14; i++) { for (let k = 0; k < 3; k++) { vy += CANNON_G * 0.016; x += vx * 0.016; y += vy * 0.016; } if (y > gy) break; g.fillRect(x - 1.5, y - 1.5, 3, 3); }
    box(p.x - 20, p.y - 34, 40, 5, '#2d2215');
    g.fillStyle = c.cd > 0 ? '#7a6a50' : '#ffb347'; g.fillRect(p.x - 20, p.y - 34, 40 * (c.cd > 0 ? 1 - c.cd / CANNON_RELOAD : gunnery.pow), 5);
  }
  for (const s of (fx.shells || [])) {
    if (s.x > W + 10) { g.fillStyle = '#ffd59a'; const yy = clamp(s.y, 60, gy - 10); g.beginPath(); g.moveTo(W - 6, yy); g.lineTo(W - 16, yy - 6); g.lineTo(W - 16, yy + 6); g.closePath(); g.fill(); continue; }
    sfArt('cannon-shell', 1, s.x, s.y, Math.atan2(s.vy, s.vx), SF_DRAFT['cannon-shell'].o);
  }
  for (const b of (fx.booms || [])) {
    b.t -= 1 / 60; if (b.t <= 0 || b.x > W + 60 || prefs.rm || prefs.ps) continue;
    const k = b.t / 0.5; g.globalAlpha = k * 0.85 * Math.min(1, prefs.fx);
    g.fillStyle = '#ffb347'; g.beginPath(); g.arc(b.x, b.y - 6, 14 + (1 - k) * 46, 0, 7); g.fill();
    g.fillStyle = '#fff1c0'; g.beginPath(); g.arc(b.x, b.y - 6, 6 + (1 - k) * 18, 0, 7); g.fill(); g.globalAlpha = 1;
  }
  if (fx.booms) fx.booms = fx.booms.filter(b => b.t > 0);
}
// the Heavy MG turret head (Sprite Forge art) with its barrels glowing as it heats up
function drawHmgHead(x, y, t) {
  sfArt('heavy-mg-turret', 1, x - 6, y - 27, 0, [2, 5]);
  const h = t.heat || 0;
  if (h > 40) { g.fillStyle = 'rgba(255,90,30,' + Math.min(0.75, (h - 40) / 80).toFixed(2) + ')'; g.fillRect(x + 4, y - 30, 16, 2); g.fillRect(x + 4, y - 27, 16, 2); }
}
// Mara's weapon picker in the Gear tab
function maraPackAmmo() {
  const aid = AMMO_OF[maraWpnId() || 'sidearm']; if (!aid) return;
  const n = storeTake(aid, Math.min(30, invRoom(maraInv(), aid)));
  if (n) { invAdd(maraInv(), aid, n); lamp('Mara packs ' + n + ' ' + AMMO[aid].name.toLowerCase() + '.', 'good'); }
  else lamp(storeCount(aid) ? 'No room in Mara\'s pack.' : 'There are no ' + AMMO[aid].name.toLowerCase() + ' in storage.', 'warn');
}
function maraWpnHTML() {
  const id = maraWpnId(), w = maraWpn(), st = stock(), own = GEAR_IDS.filter(k => (st[k] || 0) > 0);
  const stat = w => w.kind === 'melee' ? 'melee, ' + w.dmg + ' damage' : w.dmg + ' damage' + (w.pellets > 1 ? ' x' + w.pellets : '') + ', ' + (1 / w.cd).toFixed(1) + ' shots/s, spread ' + (Math.round((w.spread || 0) * 1000) / 10) + ', recoil ' + Math.round((w.recoil || 0) * 100) + (w.heat ? ', overheats' : '') + (w.pierce ? ', goes through' : '') + (w.bleedP ? ', causes bleeding' : '') + (w.burn ? ', sets them on fire' : '');
  return `<div class="sec">MARA'S WEAPON</div><p class="note" style="margin:0"><b>${id ? esc(GEAR[id].name) : 'Her sidearm'}</b>: ${esc(stat(w))}. Ammo: ${(() => { const a = AMMO_OF[id || 'sidearm']; return a ? invCount(maraInv(), a) + ' ' + esc(AMMO[a].name.toLowerCase()) + ' in her pack, ' + storeCount(a) + ' in storage' : 'none needed'; })()}. Shots can miss: spread grows with recoil, and while she moves or jumps.</p><div class="row" style="margin:6px 0 10px">${AMMO_OF[id || 'sidearm'] && storeCount(AMMO_OF[id || 'sidearm']) ? '<button class="chip" data-gear="mammo" data-g="x">Pack 30 more from storage</button>' : ''}${id ? '<button class="chip" data-gear="munequip" data-g="x">Back to her sidearm</button>' : ''}${own.map(k => `<button class="chip" data-gear="mequip" data-g="${k}" title="${esc(stat(GW[k] || {}))}">Equip ${esc(GEAR[k].name)} (${st[k]})</button>`).join('')}${own.length ? '' : '<span class="note" style="margin:0">Craft or loot weapons; they show up here to equip.</span>'}</div>`;
}
// ====================================================================== AMMO (ammo pass)
// Every gun needs its own ammo, carried as slot items that stack to 99 (Mara's pack, crew slots, storage furniture).
// Ammo is found rarely in containers and on dead raiders, and crafted in batches at the workshop. Turrets reload and the
// roof cannon loads from storage. Crew grab a stack from storage at battle stations and when they run dry; with none
// left they (and enemies that run out) fight hand to hand. Mara draws her knife when she's out.
const AMMO = {
  am_pistol:   { name: 'Pistol rounds',      color: '#d8b070', icon: '•', craft: { scrap: 3, parts: 1 },          batch: 12, work: 10 },
  am_revolver: { name: 'Revolver rounds',    color: '#e0a050', icon: '•', craft: { scrap: 3, parts: 1 },          batch: 6,  work: 10 },
  am_smg:      { name: 'SMG rounds',         color: '#c8b080', icon: '•', craft: { scrap: 3, parts: 1 },          batch: 20, work: 12 },
  am_shell:    { name: 'Buckshot shells',    color: '#c84a3a', icon: '▮', craft: { scrap: 4, parts: 1 },          batch: 8,  work: 12 },
  am_rifle:    { name: 'Rifle rounds',       color: '#e8c070', icon: '┃', craft: { scrap: 4, parts: 2 },          batch: 10, work: 14 },
  am_bolt:     { name: 'Bolt-action rounds', color: '#f0d080', icon: '┃', craft: { scrap: 4, parts: 2 },          batch: 6,  work: 14 },
  am_nail:     { name: 'Nails',              color: '#c8ccd2', icon: '│', craft: { scrap: 2 },                    batch: 30, work: 6 },
  am_xbolt:    { name: 'Crossbow bolts',     color: '#b08a5a', icon: '→', craft: { scrap: 1, mat: 2 },            batch: 6,  work: 8 },
  am_lmg:      { name: 'LMG belt rounds',    color: '#d8c090', icon: '≡', craft: { scrap: 6, parts: 2 },          batch: 40, work: 16 },
  am_fuel:     { name: 'Flamer fuel',        color: '#ff8a2a', icon: '♨︎', craft: { scrap: 2, mat: 3, elec: 1 }, batch: 20, work: 14 },
  am_hmg:      { name: 'Heavy MG belts',     color: '#ffb347', icon: '≡', craft: { scrap: 8, parts: 3 },          batch: 60, work: 18 },
  am_cannon:   { name: 'Cannon shells',      color: '#8a8a80', icon: '◆', craft: { scrap: 4, parts: 2 },          batch: 2,  work: 20 }
};
for (const k in AMMO) Object.assign(AMMO[k], { stack: 99, ammo: true });
const AMMO_OF = { sidearm: 'am_pistol', pistol: 'am_pistol', revolver: 'am_revolver', smg: 'am_smg', shotgun: 'am_shell', rifle: 'am_rifle', bolt: 'am_bolt', nailgun: 'am_nail', crossbow: 'am_xbolt', lmg: 'am_lmg', flamer: 'am_fuel' };
const TURRET_AMMO = { rifle: 'am_rifle', shotgun: 'am_shell', hmg: 'am_hmg' };
const AMMO_PER = { flamer: 5 };          // shots per unit (one unit of fuel lasts five puffs)
const CREW_GRAB = 30;                   // what a crew member takes from storage at a time
const KNIFE = { kind: 'melee', dmg: 10, range: 26, cd: 0.5, type: 'pierce' };
// spend one unit of ammo (or the leftover of one, for weapons that use a unit over several shots)
function spendAmmo(sh, wid, take) {
  if ((sh.aAcc || 0) > 0) { sh.aAcc--; return true; }
  if (!take()) return false;
  sh.aAcc = (AMMO_PER[wid] || 1) - 1; return true;
}
// Mara: her pack first; at home she can also reach into storage
function maraAmmoCount(aid) { return invCount(maraInv(), aid) + (scene === 'bunker' ? storeCount(aid) : 0); }
function maraTakeAmmo(aid) { if (invTake(maraInv(), aid, 1)) return true; return scene === 'bunker' && storeTake(aid, 1) > 0; }
// crew: their slots first, then a stack from storage
function crewRestock(c) {
  const aid = c && AMMO_OF[c.held]; if (!aid) return 0;
  const inv = crewInv(c), want = Math.min(Math.max(0, CREW_GRAB - invCount(inv, aid)), invRoom(inv, aid));
  const n = want > 0 ? storeTake(aid, want) : 0; if (n) invAdd(inv, aid, n);
  return n;
}
function crewHasAmmo(c) { const aid = c && AMMO_OF[c.held]; return !aid || (c.aAcc || 0) > 0 || invCount(crewInv(c), aid) > 0 || storeCount(aid) > 0; }
function crewTakeAmmo(c) {
  const aid = AMMO_OF[c.held]; if (!aid) return true;
  if (invTake(crewInv(c), aid, 1)) return true;
  if (crewRestock(c)) return invTake(crewInv(c), aid, 1) > 0;
  if (!c.dryTold || S.t - c.dryTold > 240) { c.dryTold = S.t; lamp(c.name + ' is out of ' + AMMO[aid].name.toLowerCase() + ' and is fighting hand to hand.', 'warn'); }
  return false;
}
// enemies with guns carry a few rounds; when they run dry they close in and fight hand to hand
const MELEE_SPEC = {};
function enemyAmmo(e) { if (e.ammo == null) e.ammo = Math.floor(rnd(5, 13)); return e.ammo; }
function enemySpecNow(e) {
  const b = ENEMIES[e.type];
  if (!b || !b.ranged || b.boss || enemyAmmo(e) > 0) return b;
  return MELEE_SPEC[e.type] || (MELEE_SPEC[e.type] = Object.assign({}, b, { ranged: 0, rate: b.rate * 0.85 }));
}
function useEnemyAmmo(e) {
  const b = ENEMIES[e.type]; if (!b || b.boss) return;
  e.ammo = Math.max(0, enemyAmmo(e) - 1);
  if (e.ammo === 0 && (!S._dryTold || S.t - S._dryTold > 600)) { S._dryTold = S.t; lamp('A ' + b.name.toLowerCase() + ' ran out of ammo and is coming in to fight hand to hand.', 'warn'); }
}
// what dead gunmen leave behind
function enemyAmmoLoot(e) {
  const b = ENEMIES[e.type]; if (!b || !b.ranged || Math.random() > 0.5) return null;
  const n = Math.min(e.ammo == null ? 4 : e.ammo, Math.floor(rnd(2, 7))); if (n <= 0) return null;
  return [AMMO_OF[e.gear] || 'am_pistol', n];
}
function ammoDrop(e) {
  const l = enemyAmmoLoot(e); if (!l) return;
  const put = storePut(l[0], l[1]);
  if (put) lamp('Picked up ' + put + ' ' + AMMO[l[0]].name.toLowerCase() + ' off the ' + ENEMIES[e.type].name.toLowerCase() + '.', 'good');
}
function ammoDropScav(e) {
  const l = enemyAmmoLoot(e); if (!l) return;
  const got = invAdd(maraInv(), l[0], l[1]);
  if (got) lootPop(e.x, e.y - 34, [['+' + got + ' ' + AMMO[l[0]].name.toLowerCase(), 'scrap']]);
}
// rare ammo in containers (more often in buildings)
const AMMO_LOOT = [['am_pistol', 5, 4, 10], ['am_shell', 3, 2, 6], ['am_rifle', 2, 3, 8], ['am_smg', 2, 6, 15], ['am_revolver', 2, 2, 6], ['am_nail', 2, 8, 20], ['am_xbolt', 1, 2, 5], ['am_lmg', 1, 8, 20], ['am_bolt', 1, 2, 4], ['am_fuel', 1, 4, 10]];
function ammoLoot(c) {
  if (Math.random() > (c.bid ? 0.22 : 0.1)) return;
  let r = Math.random() * AMMO_LOOT.reduce((a, x) => a + x[1], 0), pick = AMMO_LOOT[0];
  for (const x of AMMO_LOOT) { r -= x[1]; if (r < 0) { pick = x; break; } }
  const n = Math.floor(rnd(pick[2], pick[3] + 1)), got = invAdd(maraInv(), pick[0], n);
  if (got) { lootPop(c.x, c.y - 52, [['+' + got + ' ' + AMMO[pick[0]].name.toLowerCase(), 'parts']]); lamp('Found ammo: ' + got + ' ' + AMMO[pick[0]].name.toLowerCase() + '.', 'good'); }
  else lamp('There is ammo in here, but your pack has no room for it.', 'warn');
}
// workshop batches (paid now, built after repairs, like weapons)
function craftAmmo(id) {
  const a = AMMO[id]; if (!a || !canPay(a.craft)) return;
  if (!Array.isArray(S.craft)) S.craft = [];
  if (S.craft.length >= CRAFT_MAX) return;
  pay(a.craft); S.craft.push({ id, left: a.work, max: a.work });
}
function storeRoomFor(id) { return storageBoxes().reduce((a, b) => a + invRoom(b.inv, id), 0); }
// called by the workshop when an ammo job is done; false = no storage room yet (the job waits)
function ammoCrafted(j) {
  const a = AMMO[j.id];
  if (storeRoomFor(j.id) < a.batch) { if (!j.told) { j.told = true; lamp('The workshop made ' + a.batch + ' ' + a.name.toLowerCase() + ' but storage is full. Build or empty a storage shelf, locker or crate.', 'warn'); } return false; }
  storePut(j.id, a.batch); lampEv('workshop_done', 'The workshop made ' + a.batch + ' ' + a.name.toLowerCase() + '. They are in storage.', 'good');
  return true;
}
// a run (or an older save) starts with a little ammo in a locker
function ensureAmmoStart() {
  if (!S || S.ammoStart) return;
  S.ammoStart = 1;
  if (!storageBoxes().length) { const T = ITEM_TYPES.lockerS; for (const k in T.cost) S.res[k] = (S.res[k] || 0) + T.cost[k]; buyItem('lockerS'); }
  const start = [['am_pistol', 36], ['am_rifle', 30], ['am_shell', 16]];
  for (const t of S.turrets) if (t && t.type === 'hmg') start.push(['am_hmg', 60]);
  let lost = 0;
  for (const [id, n] of start) { const p = storePut(id, n); if (p < n) lost += n - invAdd(maraInv(), id, n - p); }
  for (const c of living()) { const aid = AMMO_OF[c.held]; if (aid) invAdd(crewInv(c), aid, 12); }
  lamp('Every gun needs its own ammo now. I put what we have in a locker in the common room: ' + start.map(([id, n]) => n + ' ' + AMMO[id].name.toLowerCase()).join(', ') + '. The workshop can make more (Gear tab), and you may find some out there.', 'warn');
}
function ammoHTML() {
  const q = S.craft || [], ok = q.length < CRAFT_MAX;
  return `<div class="sec">AMMO</div><p class="note" style="margin:0">Each gun uses its own ammo. Stacks of 99 sit in storage, Mara's pack and crew slots. Turrets and the cannon reload from storage; crew grab ${CREW_GRAB} at battle stations or when they run dry.</p>` +
    Object.entries(AMMO).map(([id, a]) => `<div class="card bitem"><div><b style="color:${a.color}">${a.icon}</b> <b>${esc(a.name)}</b><p>Stored: ${storeCount(id)} · Mara: ${invCount(maraInv(), id)} · Craft ${a.batch} for ${fmtCost(a.craft)} · ${a.work} work</p></div><div><button class="btn" data-gear="craftammo" data-g="${id}" ${ok && canPay(a.craft) ? '' : 'disabled'}>Craft ${a.batch}</button></div></div>`).join('');
}
