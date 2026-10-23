// Ashfall Bunker: tiles, stage 2. The topside wasteland is a tile world on a 24 px grid (lined up with SC_GROUND).
// - Ground: rows of ash, dirt and rock under the surface line (SC_GROUND); always solid, drawn as tiles.
// - Structures above ground: rubble mounds, ruined walls, wrecks, pillars and timber, generated per chunk from the run's
//   seed, so every run's wasteland is different. Fixed areas (the hatch yard, Dead Town, Radio Mast) use a fixed seed,
//   and the landmarks (the signal mast, the farm silo, the supply depot, the checkpoint) are stamped from fixed
//   layouts at fixed places: they look the same every run.
// - Every structure tile has HP: exposed tiles wear slowly (ground-type tiles 70% slower), bullets chip them, blocked
//   enemies smash them. Damage persists for the run in S.top.tmod. Hover near a damaged tile to see its bar.
// - Bodies: Mara and topside hostiles walk on tiles, step up one tile, and are blocked by taller ones. Hostiles jump
//   up to four tiles to keep chasing (pathfinding jumps); taller walls they try to break.
window.TW = (() => {
  const CS = 24, ROWS = 14, CHUNK = 32, G = 1500;
  const GY = () => SC_GROUND;
  const MAT = {
    rubble:   { name: 'Rubble',       max: 60,  ground: true, c: [[78, 64, 52], [92, 76, 60]] },
    ash:      { name: 'Packed ash',   max: 40,  ground: true, c: [[96, 78, 60], [84, 68, 52]] },
    sandbag:  { name: 'Sandbags',     max: 90,  ground: true, c: [[122, 106, 74], [106, 92, 62]] },
    concrete: { name: 'Concrete',     max: 180, c: [[106, 102, 96], [92, 88, 82]] },
    brick:    { name: 'Brick',        max: 120, c: [[122, 74, 54], [106, 62, 46]] },
    rsteel:   { name: 'Rusted steel', max: 150, wear: 4, c: [[106, 68, 46], [92, 56, 38]] },
    steel:    { name: 'Steel',        max: 300, c: [[90, 94, 100], [76, 80, 86]] },
    wood:     { name: 'Old timber',   max: 50,  c: [[90, 66, 40], [76, 54, 32]] },
    plank:    { name: 'Plank',        max: 40,  plank: true, c: [[120, 92, 58], [104, 78, 48]] }
  };
  const CH = { C: 'concrete', B: 'brick', R: 'rsteel', S: 'steel', W: 'wood', P: 'plank', G: 'sandbag', U: 'rubble', A: 'ash' };
  const WEAR = 0.022;   // HP per game hour for an average exposed structure tile (rusted steel 4x; ground types x0.3 of rusted)
  const FIXED = { 'Hatch Yard': 1, 'Dead Town': 1, 'Radio Mast': 1 };
  const DENS = { 'Hatch Yard': 0, 'Dead Town': 0.04, 'Ash Fields': 0.07, 'Rust Flats': 0.07, 'Dead Highway': 0.08, 'Gas Marshes': 0.06, 'Collapsed Overpass': 0.14, 'Old Farms': 0.07, 'Ruined Suburb': 0.11, 'Quarantine Zone': 0.1, 'Scrapyard': 0.13, 'Radio Mast': 0.08, 'Far West': 0.12, 'Far Reach': 0.12 };
  // landmarks: [side east?, area, label, rows top->bottom]
  const LANDMARKS = [
    [true, 'Radio Mast', 'SIGNAL MAST', ['PPPPP', '.S.S.', '.SPS.', '.S.S.', '.S.S.', '.SPS.', '.S.S.', '.S.S.', '.SPS.', '.S.S.', '.S.S.', 'SSSSS', 'CCCCC']],
    [false, 'Old Farms', 'FARM SILO', ['..RR.......', '.RRRR......', '.RRRR......', '.RRRR......', '.RRRR..W..W', '.RRRR..WWWW', '.RRRR..W..W']],
    [true, 'Scrapyard', 'SUPPLY DEPOT', ['....RRRR...', '....RRRR...', 'RRRRRRRRRR.', 'RRRR..RRRR.', 'RRRR..RRRRU']],
    [false, 'Quarantine Zone', 'CHECKPOINT', ['WWW.........', 'W.W.........', 'PPP.........', 'W.W.........', 'W.W.....CC..', 'W.W.GG..CC.G', 'W.W.GG..CC.G']]
  ];
  let world = null, chunks = new Map(), lmCells = new Map(), lmSpans = [], clear = [], seed = 0, labels = [];
  const key = (cx, r) => cx * ROWS + r;
  const rowOf = y => Math.floor((GY() - y) / CS);          // row of a point above ground (0 = just above the surface)
  const topOf = r => GY() - (r + 1) * CS, botOf = r => GY() - r * CS;
  const hh = (a, b) => { let h = (a * 374761393 + b * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const on = () => !!(world && typeof scav !== 'undefined' && scav === world);

  // ---- building the world (after buildTopside: same seed, same result)
  function blocked(x0, x1) { for (const s of clear) if (x0 < s[1] && x1 > s[0]) return true; for (const s of lmSpans) if (x0 < s[1] + 48 && x1 > s[0] - 48) return true; return false; }
  function build(w) {
    world = w; chunks = new Map(); lmCells = new Map(); lmSpans = []; labels = [];
    seed = (topState().seed >>> 0) || 1;
    // landmarks first (fixed spots), then move anything that would stand inside them
    for (const [east, area, label, rows] of LANDMARKS) {
      const sd = topSide(east); let lo = 0, a = null;
      for (const q of sd.list) { if (q.name === area) { a = q; break; } lo = q.to; }
      if (!a) continue;
      const d = sd.len * (lo + Math.min(1, a.to)) / 2, x = sd.toX(d), wc = Math.max(...rows.map(s => s.length));
      const c0 = Math.floor(x / CS) - (wc >> 1);
      rows.forEach((s, i) => { const r = rows.length - 1 - i; for (let j = 0; j < s.length; j++) { const m = CH[s[j]]; if (m) lmCells.set(key(c0 + j, r), mk(m, 1, hh(c0 + j, r))); } });
      expose(lmCells, c0, c0 + wc);
      lmSpans.push([c0 * CS, (c0 + wc) * CS]); labels.push({ x: (c0 + wc / 2) * CS, y: topOf(rows.length - 1) - 10, t: label });
    }
    const inLm = x => lmSpans.some(s => x > s[0] - 40 && x < s[1] + 40);
    for (const c of w.crates) if (c.y < GY() - 1) c._p = w.plats.find(p => c.x >= p.x - 4 && c.x <= p.x + p.w + 4) || null;   // crates sitting on a platform
    w.bldgs = (w.bldgs || []).filter(b => !lmSpans.some(s => b.x < s[1] + 40 && b.x + b.w > s[0] - 40));
    w.plats = w.plats.filter(p => !lmSpans.some(s => p.x < s[1] + 30 && p.x + p.w > s[0] - 30));
    for (const c of w.crates) if (inLm(c.x)) { const s = lmSpans.find(q => c.x > q[0] - 40 && c.x < q[1] + 40); c.x = s[0] - 70; }
    for (const m of w.hz.masks) if (inLm(m.x)) { const s = lmSpans.find(q => m.x > q[0] - 40 && m.x < q[1] + 40); m.x = s[1] + 70; }
    // platforms snap to the grid (they are plank tiles now)
    for (const p of w.plats) { p.x = Math.round(p.x / CS) * CS; p.w = Math.max(CS * 3, Math.round(p.w / CS) * CS); p.y = GY() - Math.max(3, Math.round((GY() - p.y) / CS)) * CS; }
    for (const c of w.crates) if ('_p' in c) { c.y = c._p && w.plats.includes(c._p) ? c._p.y : GY(); if (c._p) c.x = Math.min(Math.max(c.x, c._p.x + 14), c._p.x + c._p.w - 14); delete c._p; }
    // ground that must stay open: the bunker yard, building fronts, platforms, crates and masks on the ground
    clear = [[TOP_B0 - TOP_CLEAR, TOP_B0 + W + TOP_CLEAR]];
    for (const b of w.bldgs) clear.push([b.x - 40, b.x + b.w + 40]);
    for (const c of w.crates) if (c.y >= GY() - 1) clear.push([c.x - 44, c.x + 44]);
    for (const m of w.hz.masks) clear.push([m.x - 30, m.x + 30]);
  }
  // the row a platform sits in above this x (its plank row), or null
  function platRow(x) { if (!world) return null; let best = null; for (const p of world.plats) if (x >= p.x - 4 && x <= p.x + p.w + 4) { const r = rowOf(p.y + 1); if (best === null || r < best) best = r; } return best; }
  function mk(m, start, r) { return { m, h0: Math.round(MAT[m].max * start), r: 0.5 + r * 1.6, exp: true }; }
  function expose(map, c0, c1) {   // a tile buried on all four sides doesn't wear
    for (let c = c0; c <= c1; c++) for (let r = 0; r < ROWS; r++) {
      const t = map.get(key(c, r)); if (!t) continue;
      const s = (cc, rr) => rr < 0 || (map.get(key(cc, rr)) && !MAT[map.get(key(cc, rr)).m].plank);
      t.exp = !(s(c - 1, r) && s(c + 1, r) && s(c, r + 1) && s(c, r - 1));
    }
  }
  // one chunk of generated structures (deterministic from the seed and the chunk number)
  function chunk(ci) {
    let map = chunks.get(ci); if (map) return map;
    map = new Map(); chunks.set(ci, map);
    if (!world) return map;
    const c0 = ci * CHUNK, mid = (c0 + CHUNK / 2) * CS;
    if (mid < 0 || mid > world.len) return map;
    const ar = topAreaAt(mid).a, dens = DENS[ar.name] != null ? DENS[ar.name] : 0.08;
    if (!dens) return map;
    const rng = seededRand(((FIXED[ar.name] ? 0x5EED1 : seed) ^ Math.imul(ci + 7, 2654435761)) >>> 0);
    const old = () => 0.6 + rng() * 0.4;   // ruins are old: they start worn
    let cap = ROWS;
    const put = (c, r, m) => { if (r >= 0 && r < ROWS && r < cap) map.set(key(c, r), mk(m, old(), rng())); };
    let c = c0;
    while (c < c0 + CHUNK) {
      if (rng() > dens * 3) { c++; continue; }
      const kinds = ['mound', 'mound', 'wall', 'wreck', 'pillars', 'timber'], kind = kinds[Math.floor(rng() * kinds.length)];
      const w = kind === 'mound' ? 3 + Math.floor(rng() * 5) : kind === 'wall' ? 1 + Math.floor(rng() * 2) : kind === 'wreck' ? 3 : kind === 'pillars' ? 5 + Math.floor(rng() * 3) : 2 + Math.floor(rng() * 3);
      if (c + w > c0 + CHUNK || blocked(c * CS, (c + w) * CS)) { c++; continue; }
      cap = ROWS; for (let i = -1; i <= w; i++) { const pr = platRow((c + i) * CS + CS / 2); if (pr != null) cap = Math.min(cap, pr - 1); }   // stay under platforms
      if (cap < 1) { c++; continue; }
      const deep = ar.danger || 1;
      if (kind === 'mound') { const peak = 1 + Math.floor(rng() * Math.min(3, 1 + deep)); for (let i = 0; i < w; i++) { const t = 1 - Math.abs((i + 0.5) / w * 2 - 1), h = Math.max(1, Math.round(peak * t + rng() * 0.6)); for (let r = 0; r < h; r++) put(c + i, r, r === h - 1 && rng() < 0.5 ? 'ash' : 'rubble'); } }
      else if (kind === 'wall') { const h = 2 + Math.floor(rng() * Math.min(4, 1 + deep * 1.5)), m = rng() < 0.5 ? 'concrete' : 'brick'; for (let i = 0; i < w; i++) { const hi = h - (rng() < 0.4 ? 1 : 0); for (let r = 0; r < hi; r++) put(c + i, r, m); } }
      else if (kind === 'wreck') { put(c, 0, 'rsteel'); put(c + 1, 0, 'rsteel'); put(c + 2, 0, 'rsteel'); put(c + 1, 1, 'rsteel'); }
      else if (kind === 'pillars') { const h = 3 + Math.floor(rng() * 3); for (let r = 0; r < h; r++) { put(c, r, 'concrete'); put(c + w - 1, r, 'concrete'); } for (let i = 0; i < w; i++) if (rng() < 0.8) put(c + i, h, i === 0 || i === w - 1 ? 'concrete' : 'plank'); }
      else { const h = 1 + Math.floor(rng() * 2); for (let i = 0; i < w; i++) for (let r = 0; r < h; r++) if (rng() < 0.8) put(c + i, r, 'wood'); }
      c += w + 2 + Math.floor(rng() * 5);
    }
    expose(map, c0, c0 + CHUNK);
    return map;
  }
  // the tile at a column/row, with its current HP (damage and wear included), or null
  function cell(cx, r) {
    if (r < 0 || r >= ROWS || !world) return null;
    const k = key(cx, r), t = lmCells.get(k) || chunk(Math.floor(cx / CHUNK)).get(k);
    if (!t) return null;
    const st = topState(), mod = st.tmod && st.tmod[k], hrs = (S.t || 0) / 60, M = MAT[t.m];
    const rate = t.exp ? WEAR * t.r * (M.ground ? 4 * 0.3 : (M.wear || 1)) : 0;
    const hp = mod ? mod.hp - rate * Math.max(0, hrs - mod.t) : t.h0 - rate * hrs;
    return { m: t.m, hp, max: M.max, k };
  }
  const solidAt = (cx, r) => { const t = cell(cx, r); return !!(t && t.hp > 0 && !MAT[t.m].plank); };
  const plankAt = (cx, r) => { const t = cell(cx, r); return !!(t && t.hp > 0 && MAT[t.m].plank); };
  function damage(cx, r, n) {
    const t = cell(cx, r); if (!t || t.hp <= 0 || !(n > 0)) return false;
    const st = topState(); st.tmod = st.tmod || {};
    const hp = Math.max(0, t.hp - n); st.tmod[t.k] = { hp, t: (S.t || 0) / 60 };
    if (hp <= 0) { const x = cx * CS + CS / 2, y = topOf(r) + CS / 2; try { burst(x, y, 'rgb(' + MAT[t.m].c[0].join(',') + ')', 8, true); } catch (e) {} }
    return true;
  }
  // the highest tile top in a column below a height (for snapping things that spawn inside a structure)
  function topAt(x) { const cx = Math.floor(x / CS); let r = 0; while (r < ROWS && solidAt(cx, r)) r++; return r ? topOf(r - 1) : GY(); }

  // ---- bodies
  function overlap(x, y, hw, h) {
    const c0 = Math.floor((x - hw) / CS), c1 = Math.floor((x + hw - 0.01) / CS), r0 = Math.max(0, rowOf(y - 0.5)), r1 = Math.min(ROWS - 1, rowOf(y - h));
    let top = null;
    for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) if (solidAt(c, r)) { const t = topOf(r); if (top === null || t < top) top = t; }
    return top;   // y of the highest overlapping tile top, or null
  }
  // walking sideways: step up one tile, or stop at anything taller. Returns { blocked, h (tiles above the feet) }
  function walk(b, x0, hw, h, grounded) {
    const top = overlap(b.x, b.y, hw, h);
    if (top === null) return { blocked: false };
    if (grounded && top >= b.y - CS - 1 && overlap(b.x, top, hw, h) === null) { b.y = top; return { blocked: false, stepped: true }; }
    const dir = Math.sign(b.x - x0) || 1;
    b.x = x0;
    // how tall is the obstacle in front (in tiles above the feet)?
    const cx = Math.floor((b.x + dir * (hw + 2)) / CS), r0 = Math.max(0, rowOf(b.y - 0.5));
    let r = r0; while (r < ROWS && solidAt(cx, r)) r++;
    return { blocked: true, h: r - r0, cx, r: r0, dir };
  }
  // falling and landing on tile tops (and planks), bumping into tile bottoms
  function vertical(b, oy, hw, h, allowPlank) {
    const c0 = Math.floor((b.x - hw) / CS), c1 = Math.floor((b.x + hw - 0.01) / CS);
    if (b.vy >= 0) {
      let land = null;
      for (let c = c0; c <= c1; c++) for (let r = 0; r < ROWS; r++) {
        const s = solidAt(c, r), p = allowPlank && plankAt(c, r); if (!s && !p) continue;
        if (solidAt(c, r + 1)) continue;   // not a top surface
        const t = topOf(r); if (oy <= t + 0.5 && b.y >= t && (land === null || t < land)) land = t;
      }
      if (land !== null) { b.y = land; b.vy = 0; return 'land'; }
    } else {
      const head = b.y - h, ohead = oy - h;
      for (let c = c0; c <= c1; c++) for (let r = 0; r < ROWS; r++) {
        if (!solidAt(c, r)) continue;
        const bt = botOf(r); if (ohead >= bt - 0.5 && head < bt) { b.y = bt + h; b.vy = 0; return 'bump'; }
      }
    }
    return null;
  }
  // Mara (scavPlayerTick): sideways first, then after Physics.moveBody fix landings/bumps on tiles
  function playerWalk(x0) { if (!on()) return; walk(P, x0, 7, 34, !!P.grounded); }
  function playerFix(oy) {
    if (!on()) return;
    const v = vertical(P, oy, 7, 34, !kd('down'));
    if (v === 'land') { P.grounded = true; P.landedOn = 'tile'; }
  }
  // extra one-way floors for Physics.moveBody: plank tiles near Mara (drop through with down, like platforms)
  function planks(b) {
    const out = []; if (!on()) return out;
    const c0 = Math.floor(b.x / CS) - 1, c1 = c0 + 2;
    for (let c = c0; c <= c1; c++) for (let r = 0; r < ROWS; r++) if (plankAt(c, r)) out.push({ id: 'plank', y: topOf(r), x0: c * CS, x1: c * CS + CS });
    return out;
  }
  // topside hostiles: call after the enemy loop moved e.x (x0 = where it was)
  function enemyMove(e, x0, b, dt) {
    if (!on()) return null;
    const spec = ENEMIES[e.type] || {}, hw = Math.min(11, (spec.w || 20) / 2), h = Math.min(60, spec.h || 30);
    if (e.vy == null) e.vy = 0;
    if (overlap(x0, e.y, hw, h) !== null) { e.y = topAt(x0); e.vy = 0; }   // stuck inside a ruin (spawned there): stand on top of it
    const res = walk(e, x0, hw, h, !!e.grounded);
    if (res.blocked) {
      if (e.type === 'ram') { if (e.st === 'charge') { e.st = 'stun'; e.t = 1.6; damage(res.cx, res.r, 40); } }
      else if (e.grounded && res.h <= 4) { e.vy = -Math.sqrt(2 * G * (res.h * CS + 14)); e.grounded = false; }   // jump it
      else if (e.grounded && e.cd <= 0 && (b.dmg || 0) > 0 && Math.abs(P.x - e.x) < 420) { e.cd = b.rate || 1; damage(res.cx, res.r, (b.dmg || 4) * 0.8); }   // too tall: smash through
    }
    const oy = e.y; e.vy += G * dt; e.y += e.vy * dt;
    const v = vertical(e, oy, hw, h, true);
    if (e.y >= GY()) { e.y = GY(); e.vy = 0; e.grounded = true; }
    else e.grounded = v === 'land';
    return res;
  }
  // snap things that spawned inside a structure onto it (daily hostiles, the wanderer)
  function snap(w) {
    if (!w) return;
    for (const e of w.enemies) { const spec = ENEMIES[e.type] || {}; if (overlap(e.x, e.y, Math.min(11, (spec.w || 20) / 2), Math.min(60, spec.h || 30)) !== null) e.y = topAt(e.x); }
    if (w.wanderer && overlap(w.wanderer.x, w.wanderer.y, 8, 34) !== null) w.wanderer.y = topAt(w.wanderer.x);
  }
  // projectiles stop at structures and chip them
  function hookBullets() {
    if (typeof bulletStep !== 'function' || bulletStep._tw) return;
    const o = bulletStep;
    const f = function (b, list) {
      if (b.world === 'scav' && on()) {
        const r = rowOf(b.y), cx = Math.floor(b.x / CS);
        if (r >= 0 && r < ROWS && solidAt(cx, r)) {
          b.life = 0; damage(cx, r, (b.dmg || 4) * 0.4);
          try { burst(b.x, b.y, '#9a8a74', 2, true); } catch (e) {}
          return true;
        }
      }
      return o(b, list);
    };
    f._tw = 1; window.bulletStep = f;
  }

  // ---- drawing (strip coordinates; ox = camera x)
  function shade(c, k) { return 'rgb(' + (c[0] * k | 0) + ',' + (c[1] * k | 0) + ',' + (c[2] * k | 0) + ')'; }
  function drawGround(ox) {
    const c0 = Math.floor(ox / CS) - 1, c1 = Math.ceil((ox + W) / CS) + 1, gy = GY();
    for (let c = c0; c <= c1; c++) {
      const x = c * CS - ox;
      for (let d = 0; d < 6; d++) {
        const y = gy + d * CS, v = hh(c, d + 99);
        const col = d === 0 ? [92, 70, 50] : d < 3 ? [58, 44, 32] : v < 0.25 ? [70, 66, 62] : [44, 33, 24];
        g.fillStyle = shade(col, 0.88 + v * 0.22); g.fillRect(x, y, CS, CS);
        if (d === 0) { g.fillStyle = 'rgba(200,180,150,.14)'; g.fillRect(x, y, CS, 2); g.fillStyle = 'rgba(160,140,120,.25)'; g.fillRect(x + (v * 18 | 0), y + 5, 3, 2); }
        else if (v > 0.7) { g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x + (v * 16 | 0), y + 8, 4, 3); }
        g.fillStyle = 'rgba(0,0,0,.22)'; g.fillRect(x + CS - 1, y, 1, CS); g.fillRect(x, y + CS - 1, CS, 1);
      }
    }
  }
  function drawCells(ox) {
    if (!world) return;
    const c0 = Math.floor(ox / CS) - 1, c1 = Math.ceil((ox + W) / CS) + 1;
    for (let c = c0; c <= c1; c++) for (let r = 0; r < ROWS; r++) {
      const t = cell(c, r); if (!t || t.hp <= 0) continue;
      const M = MAT[t.m], x = c * CS - ox, y = topOf(r), v = hh(c, r), p = Math.max(0, t.hp / t.max), dk = 0.55 + 0.45 * p;
      if (M.plank) {
        g.fillStyle = shade(M.c[v < 0.5 ? 0 : 1], dk); g.fillRect(x, y, CS, 6);
        g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x, y + 5, CS, 1); g.fillRect(x + CS - 1, y, 1, 6);
        g.fillStyle = 'rgba(255,230,190,.12)'; g.fillRect(x, y, CS, 1);
        continue;
      }
      g.fillStyle = shade(M.c[v < 0.5 ? 0 : 1], dk); g.fillRect(x, y, CS, CS);
      g.fillStyle = 'rgba(255,230,200,.10)'; g.fillRect(x, y, CS, 1);
      g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(x, y + CS - 1, CS, 1); g.fillRect(x + CS - 1, y, 1, CS);
      if (t.m === 'brick') { g.fillStyle = 'rgba(0,0,0,.22)'; g.fillRect(x, y + 8, CS, 1); g.fillRect(x, y + 16, CS, 1); g.fillRect(x + (r % 2 ? 6 : 14), y, 1, 8); g.fillRect(x + (r % 2 ? 14 : 6), y + 8, 1, 8); }
      else if (t.m === 'concrete') { g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(x + (v * 16 | 0), y + 6, 3, 2); g.fillRect(x + 4, y + (v * 14 | 0) + 4, 2, 2); }
      else if (t.m === 'rsteel' || t.m === 'steel') { g.fillStyle = 'rgba(210,180,150,.3)'; g.fillRect(x + 2, y + 2, 1, 1); g.fillRect(x + CS - 3, y + 2, 1, 1); g.fillRect(x + 2, y + CS - 3, 1, 1); g.fillRect(x + CS - 3, y + CS - 3, 1, 1); if (t.m === 'rsteel') { g.fillStyle = 'rgba(170,82,30,.35)'; g.fillRect(x + (v * 18 | 0), y + 1, 2, CS - 6); } }
      else if (t.m === 'wood') { g.fillStyle = 'rgba(0,0,0,.2)'; g.fillRect(x, y + 7, CS, 1); g.fillRect(x, y + 15, CS, 1); }
      else if (t.m === 'sandbag') { g.fillStyle = 'rgba(0,0,0,.2)'; g.fillRect(x, y + 11, CS, 1); g.fillRect(x + 11, y, 1, 11); g.fillRect(x + 5, y + 12, 1, 11); g.fillRect(x + 17, y + 12, 1, 11); }
      else { g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(x + (v * 15 | 0), y + 5, 4, 3); g.fillRect(x + 3, y + (v * 12 | 0) + 8, 3, 3); }
      if (p < 0.6) { g.strokeStyle = 'rgba(10,6,4,' + (0.45 + 0.4 * (1 - p)).toFixed(2) + ')'; g.lineWidth = 1; g.beginPath(); g.moveTo(x + CS * v, y + 3); g.lineTo(x + CS * 0.5, y + CS * 0.55); g.lineTo(x + CS * (1 - v), y + CS - 3); g.stroke(); }
    }
    g.font = '700 10px "Chakra Petch", sans-serif'; g.textAlign = 'center';
    for (const l of labels) { const x = l.x - ox; if (x < -80 || x > W + 80) continue; const tw = g.measureText(l.t).width + 10; g.fillStyle = 'rgba(20,14,10,.75)'; g.fillRect(x - tw / 2, l.y - 12, tw, 15); g.fillStyle = '#e8c070'; g.fillText(l.t, x, l.y - 1); }
    g.textAlign = 'left';
  }
  function drawPlats(ox) {
    for (const p of world.plats) {
      const x0 = p.x - ox; if (x0 > W || x0 + p.w < 0) continue;
      for (let x = 0; x < p.w; x += CS) { const v = hh(p.x + x, p.y); g.fillStyle = shade(MAT.plank.c[v < 0.5 ? 0 : 1], 1); g.fillRect(x0 + x, p.y, CS, 8); g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x0 + x + CS - 1, p.y, 1, 8); g.fillRect(x0 + x, p.y + 7, CS, 1); g.fillStyle = 'rgba(255,230,190,.12)'; g.fillRect(x0 + x, p.y, CS, 1); }
      // posts down to the ground at both ends
      for (const px of [p.x + 4, p.x + p.w - 12]) { g.fillStyle = '#3d3226'; g.fillRect(px - ox, p.y + 8, 8, GY() - p.y - 8); g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(px - ox + 6, p.y + 8, 2, GY() - p.y - 8); }
    }
  }
  // hover health bars for damaged tiles near the mouse (strip coordinates)
  function drawBars(ox) {
    if (!on() || !mouse.inCv) return;
    const mx = mouse.wx, my = mouse.wy, R = 120;
    const c0 = Math.floor((mx - R) / CS), c1 = Math.floor((mx + R) / CS);
    for (let c = c0; c <= c1; c++) for (let r = 0; r < ROWS; r++) {
      const t = cell(c, r); if (!t || t.hp <= 0) continue;
      const p = t.hp / t.max; if (p >= 0.9) continue;
      const x = c * CS, y = topOf(r); if (Math.hypot(x + CS / 2 - mx, y + CS / 2 - my) > R) continue;
      const col = window.TILES ? TILES.rgb(p) : [255 * (1 - p), 255 * p, 40];
      g.fillStyle = 'rgba(0,0,0,.7)'; g.fillRect(x - ox + 1, y + 1, CS - 2, 5);
      g.fillStyle = 'rgb(' + col.join(',') + ')'; g.fillRect(x - ox + 2, y + 2, Math.max(1, (CS - 4) * p), 3);
    }
  }
  return { CS, ROWS, MAT, build, cell, solidAt, damage, topAt, on, walk, vertical, playerWalk, playerFix, planks, enemyMove, snap, hookBullets, drawGround, drawCells, drawPlats, drawBars, cur: () => world };
})();
