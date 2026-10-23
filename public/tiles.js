// Ashfall Bunker: tiles, stage 1. The bunker's shell (outer walls and floor slabs) is made of blocks with their own HP.
// Starting bunker: rusted steel = half the HP of steel and wears 4x faster. Blocks wear with time, get clawed by enemies
// inside, punched by burrowers and cracked by explosions. Workshop crew repair them (worst first). Hovering near a
// block under 90% shows its bar; K toggles a health view that tints every block, pit tile, machine, turret, the door
// and the wall from red to green. State: S.shell = { v, b: [{ x, y, w, h, m, hp, r }] } in bunker coordinates.
window.TILES = (() => {
  const MAT = {
    steel:  { name: 'Steel',        max: 300, wear: 1, scrap: 25 },
    rsteel: { name: 'Rusted steel', max: 150, wear: 4, scrap: 25 }   // half of steel's HP, wears 4x faster
  };
  const WEAR_PER_H = 0.022;      // HP lost per game hour by a steel block with average rust (rusted steel: 4x)
  const GROUND_WEAR = 0.3;       // ground (pit) tiles wear 70% slower than the rusted structure plates
  // Only exposed blocks wear: a block wears when at least one side touches open air (a room, the shaft, the sky,
  // a dug-out pit tile or a broken plate). Blocks buried on every side keep their HP.
  const AUTO_REPAIR = 0.9;       // crew repair blocks below this share of max HP
  const SCRAP_KEEP = 15;         // repairs never spend the last few scrap
  const BAR_R = 120;             // hover distance for health bars (world px)
  let view = false, toldView = false, broke = 0;
  const rnd = (a, b) => a + Math.random() * (b - a);

  // ---- the shell
  function gen() {
    const b = [], add = (x, y, w, h) => b.push({ x, y, w, h, m: 'rsteel', hp: Math.round(MAT.rsteel.max * rnd(0.7, 1)), r: +rnd(0.4, 2.4).toFixed(2) });
    const top = FLOORS[0] + 16, bot = FLOORS[3] + 10;
    for (const wx of [IN_L - 16, IN_R + 2]) for (let y = top; y < bot; y += 24) add(wx, y, 16, Math.min(24, bot - y));
    for (let f = 1; f < 4; f++) for (let x = IN_L - 6; x < IN_R + 6; x += 24) add(x, FLOORS[f], Math.min(24, IN_R + 6 - x), 10);
    return { v: 1, b };
  }
  function shell() {
    if (!S) return null;
    if (!S.shell || !Array.isArray(S.shell.b)) {
      S.shell = gen();
      setTimeout(() => lamp('The bunker\'s walls and floors are old rusted steel: half the strength of new steel, and it rusts four times faster. Workshop crew patch the worst plates for scrap. Press K to see what needs fixing.', 'info'), 4000);
    }
    return S.shell;
  }
  const blocks = () => { const s = shell(); return s ? s.b : []; };
  const maxOf = bl => MAT[bl.m].max;
  const pctOf = bl => bl.hp / maxOf(bl);
  const ctr = bl => ({ x: bl.x + bl.w / 2, y: bl.y + bl.h / 2 });

  // ---- wear, damage, repair
  function hurt(bl, n) {
    if (n <= 0 || bl.hp <= 0) return;
    bl.hp = Math.max(0, bl.hp - n);
    if (bl.hp <= 0) { broke++; const c = ctr(bl); try { burst(c.x, c.y, '#6a4632', 10); } catch (e) {} lampEv('plate_broken', 'A rusted plate in the bunker shell has given way. The Workshop crew can patch it with scrap.', 'warn'); }
  }
  // is this bunker-world point open air?
  function isAir(x, y, skip) {
    for (const bl of blocks()) if (bl !== skip && x >= bl.x && x < bl.x + bl.w && y >= bl.y && y < bl.y + bl.h) return bl.hp <= 0;   // a plate (a hole if broken)
    if (y < FLOORS[0]) return true;                                                   // the sky
    if (y >= DIG.y0) { const c = Math.floor((x - DIG.x0) / DIG.cell), r = Math.floor((y - DIG.y0) / DIG.cell); return dIn(c, r) ? dg().m[dIdx(c, r)] === 0 : false; }
    if (Math.abs(x - LADDER_X) < 18 && y >= FLOORS[0]) return true;                   // the hatch shaft
    if (x > IN_L && x < IN_R && y > FLOORS[0] + 16) return true;                      // inside the bunker
    return y >= FLOORS[0] && y < FLOORS[0] + 16 ? false : false;                      // soil
  }
  let expKey = '', expSet = null;
  function exposed(bl) {
    const d = dg(), key = (d.ver | 0) + ':' + blocks().reduce((a, b) => a + (b.hp <= 0 ? 1 : 0), 0);
    if (key !== expKey || !expSet) {
      expKey = key; expSet = new Set();
      for (const b of blocks()) { const cx = b.x + b.w / 2, cy = b.y + b.h / 2; if (isAir(cx, b.y - 2, b) || isAir(cx, b.y + b.h + 2, b) || isAir(b.x - 2, cy, b) || isAir(b.x + b.w + 2, cy, b)) expSet.add(b); }
    }
    return expSet.has(bl);
  }
  let crumbledAt = 0;
  function groundTick(h) {
    const d = dg(), n = DIG.cols * DIG.rows, rate = WEAR_PER_H * MAT.rsteel.wear * GROUND_WEAR * h;
    let crumbled = 0;
    for (let i = 0; i < n; i++) {
      if (!d.m[i]) continue;
      const c = i % DIG.cols, r = (i / DIG.cols) | 0;
      let open = false;
      for (const [dc, dr] of DIRS) { const a = c + dc, b = r + dr; if (dIn(a, b) && d.m[dIdx(a, b)] === 0) { open = true; break; } }
      if (!open) continue;                      // buried: no wear
      d.hp[i] -= rate;
      if (d.hp[i] <= 0) { d.m[i] = 0; d.mark[i] = 0; d.hp[i] = 0; crumbled++; }
    }
    if (crumbled) { d.ver = (d.ver | 0) + 1; if (performance.now() - crumbledAt > 60000) { crumbledAt = performance.now(); lamp('Part of a tunnel wall in the pit crumbled away. Old ground gives in, eventually.', 'info'); } }
  }
  function tick(h) {
    if (!S || !(h > 0)) return;
    let open = 0;
    for (const bl of blocks()) { if (bl.hp > 0) { if (exposed(bl)) hurt(bl, WEAR_PER_H * MAT[bl.m].wear * bl.r * h); } else open++; }
    try { groundTick(h); } catch (e) {}
    // broken plates let the ash and the cold in: everyone's morale slowly drops
    if (open) for (const c of living()) c.mor = Math.max(0, (c.mor ?? 70) - 0.04 * open * h);
  }
  function blast(x, y, r, dmg) {
    let hit = 0;
    for (const bl of blocks()) {
      const c = ctr(bl), d = Math.hypot(c.x - x, c.y - y);
      if (d < r) { hurt(bl, dmg * (1 - d / r * 0.7)); hit++; }
    }
    return hit;
  }
  // an enemy inside the bunker scrapes at the plates around it while it fights
  function claw(e, b) {
    if (!e.inside || Math.random() > 0.35) return;
    let best = null, bd = 60;
    for (const bl of blocks()) { if (bl.hp <= 0) continue; const c = ctr(bl), d = Math.hypot(c.x - e.x, c.y - (e.y - 6)); if (d < bd) { bd = d; best = bl; } }
    if (best) hurt(best, (b.dmg || 4) * 0.5);
  }
  function repair(work) {
    if (work <= 0 || !S) return work;
    const todo = blocks().filter(bl => pctOf(bl) < AUTO_REPAIR).sort((a, z) => pctOf(a) - pctOf(z));
    for (const bl of todo) {
      if (work <= 0) break;
      const spare = Math.max(0, S.res.scrap - SCRAP_KEEP); if (spare <= 0) break;
      const amt = Math.min(maxOf(bl) - bl.hp, work, spare * MAT[bl.m].scrap); if (amt <= 0) break;
      const was = bl.hp; bl.hp += amt; S.res.scrap -= amt / MAT[bl.m].scrap; work -= amt;
      bl._pop = (bl._pop || 0) + amt; if (bl._pop >= 8) { const c = ctr(bl); try { fxPop(c.x, c.y - 10, '+' + Math.round(bl._pop), '#7ddc8a'); } catch (e) {} bl._pop = 0; }
      if (was <= 0 && bl.hp > 0 && broke > 0) broke--;
    }
    return work;
  }

  // ---- drawing the plates
  const hsh = (a, b) => { const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return v - Math.floor(v); };
  function drawShell() {
    for (const bl of blocks()) {
      const { x, y, w, h } = bl, p = pctOf(bl), s = hsh(x, y);
      if (bl.hp <= 0) {   // a hole: dark, with a torn rim
        g.fillStyle = '#0b0806'; g.fillRect(x, y, w, h);
        g.fillStyle = '#5a3424'; for (let i = 0; i < w; i += 4) g.fillRect(x + i, y + (hsh(x + i, y) * 3 | 0), 3, 2);
        continue;
      }
      const base = bl.m === 'steel' ? [88, 92, 98] : [92 + s * 22, 56 + s * 10, 36];
      const dk = 0.55 + 0.45 * p;   // damaged plates darken
      g.fillStyle = 'rgb(' + (base[0] * dk | 0) + ',' + (base[1] * dk | 0) + ',' + (base[2] * dk | 0) + ')'; g.fillRect(x, y, w, h);
      g.fillStyle = 'rgba(255,220,180,.10)'; g.fillRect(x, y, w, 1);                // top edge light
      g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x, y + h - 1, w, 1); g.fillRect(x + w - 1, y, 1, h);   // seams
      if (bl.m === 'rsteel') {   // rust streaks and blooms
        g.fillStyle = 'rgba(170,82,30,' + (0.25 + 0.3 * (1 - p)).toFixed(2) + ')';
        for (let i = 0; i < 3; i++) { const rx = x + hsh(x, y + i) * (w - 3); g.fillRect(rx, y + 1, 2, Math.max(2, (h - 2) * hsh(y, x + i))); }
      }
      if (h >= 16 && w >= 12) { g.fillStyle = 'rgba(210,180,150,.35)'; g.fillRect(x + 2, y + 2, 1, 1); g.fillRect(x + w - 3, y + 2, 1, 1); g.fillRect(x + 2, y + h - 3, 1, 1); g.fillRect(x + w - 3, y + h - 3, 1, 1); }   // rivets
      else { g.fillStyle = 'rgba(210,180,150,.3)'; g.fillRect(x + 3, y + (h >> 1), 1, 1); g.fillRect(x + w - 4, y + (h >> 1), 1, 1); }
      if (p < 0.6) {   // cracks
        g.strokeStyle = 'rgba(15,8,5,' + (0.5 + 0.4 * (1 - p)).toFixed(2) + ')'; g.lineWidth = 1; g.beginPath();
        const n = p < 0.3 ? 3 : 1;
        for (let i = 0; i < n; i++) { const cx = x + w * hsh(i, x), cy = y + h * hsh(y, i); g.moveTo(cx, cy); g.lineTo(cx + (hsh(cx, cy) - 0.5) * w * 0.8, cy + (hsh(cy, cx) - 0.5) * h); g.lineTo(cx + (hsh(cx, i) - 0.5) * w, cy + (hsh(i, cy) - 0.5) * h * 1.2); }
        g.stroke();
      }
    }
  }

  // ---- health colours (an RGB scale: red 0% -> yellow 50% -> green 100%)
  function rgb(p) { p = Math.max(0, Math.min(1, p)); const r = p < 0.5 ? 255 : Math.round(255 * (1 - p) * 2), gg = p < 0.5 ? Math.round(255 * p * 2) : 255; return [r, gg, 40]; }
  const rgba = (p, a) => { const c = rgb(p); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; };
  function bar(x, y, w, p) {
    g.fillStyle = 'rgba(0,0,0,.7)'; g.fillRect(x - 1, y - 1, w + 2, 5);
    g.fillStyle = rgba(p, 1); g.fillRect(x, y, Math.max(1, w * p), 3);
  }
  // everything the base is made of, with its health 0..1 (bunker coordinates)
  function baseParts() {
    const L = [];
    for (const bl of blocks()) L.push({ x: bl.x, y: bl.y, w: bl.w, h: bl.h, p: pctOf(bl), name: MAT[bl.m].name, hp: bl.hp, max: maxOf(bl) });
    const condK = { stove: 'stove', planter: 'planter' };
    for (const it of itemList()) {
      const T = ITEM_TYPES[it.type], r = ROOMS[it.room]; if (!T || !r || !(r.floor > 0)) continue;
      const k = condK[it.type], p = k ? cond(k) / 100 : 1, x = ITX0 + it.col * ITILE, w = T.w * ITILE;
      L.push({ x, y: FLOORS[r.floor] - 40, w, h: 40, p, name: T.name });
    }
    S.turrets.forEach((t, i) => { if (t) L.push({ x: SLOT_X[i] - 16, y: FLOORS[0] - 40, w: 32, h: 40, p: t.max ? t.hp / t.max : 1, name: tName(i), hp: t.hp, max: t.max }); });
    if (S.door) L.push({ x: DOOR_X - 20, y: FLOORS[0] - 46, w: 40, h: 46, p: S.door.hp / S.door.max, name: 'Hatch', hp: S.door.hp, max: S.door.max });
    if (S.wall && S.wall.max) L.push({ x: WALL_X - 8, y: FLOORS[0] - 60, w: 16, h: 60, p: S.wall.hp / S.wall.max, name: 'Outer wall', hp: S.wall.hp, max: S.wall.max });
    // annex rooms dug into the pit (the generator wears like a machine)
    try { const d = dg(); for (const k in d.rooms) { const rm = d.rooms[k], p = k === 'generator' ? cond('gen') / 100 : 1; L.push({ x: DIG.x0 + rm.c * DIG.cell, y: DIG.y0 + rm.r * DIG.cell, w: rm.w * DIG.cell, h: rm.h * DIG.cell, p, name: (ROOMS[k] || {}).name || k }); } } catch (e) {}
    return L;
  }
  function drawOverlay() {
    if (!S || scene !== 'bunker') return;
    const mx = mouse.wx, my = mouse.wy;
    if (view) {
      g.fillStyle = 'rgba(6,5,10,.55)'; g.fillRect(-50, -50, W + 100, WH + 100);
      for (const q of baseParts()) {
        g.fillStyle = rgba(q.p, 0.6); g.fillRect(q.x, q.y, q.w, q.h);
        g.strokeStyle = rgba(q.p, 0.95); g.lineWidth = 1; g.strokeRect(q.x + 0.5, q.y + 0.5, q.w - 1, q.h - 1);
      }
      // name and % of whatever the mouse is over
      const q = mouse.inCv ? baseParts().find(o => mx >= o.x && mx <= o.x + o.w && my >= o.y && my <= o.y + o.h) : null;
      if (q) { const t = q.name + ' ' + Math.round(q.p * 100) + '%' + (q.max ? ' (' + Math.round(q.hp) + '/' + q.max + ')' : ''); g.font = '600 11px "IBM Plex Sans"'; const tw = g.measureText(t).width; g.fillStyle = 'rgba(0,0,0,.8)'; g.fillRect(mx + 10, my - 22, tw + 10, 16); g.fillStyle = '#fff'; g.fillText(t, mx + 15, my - 10); }
    }
    if (!mouse.inCv) return;
    // hover: bars on blocks under 90% near the mouse (shell plates, and pit tiles being dug)
    for (const bl of blocks()) {
      const p = pctOf(bl); if (p >= 0.9) continue;
      const c = ctr(bl); if (Math.hypot(c.x - mx, c.y - my) > BAR_R) continue;
      bar(bl.x + 1, bl.h > 12 ? bl.y + 2 : bl.y - 5, Math.max(6, bl.w - 2), p);
    }
    try {
      const d = dg(), r0 = Math.max(0, Math.floor((my - BAR_R - DIG.y0) / DIG.cell)), r1 = Math.min(DIG.rows - 1, Math.floor((my + BAR_R - DIG.y0) / DIG.cell));
      const c0 = Math.max(0, Math.floor((mx - BAR_R - DIG.x0) / DIG.cell)), c1 = Math.min(DIG.cols - 1, Math.floor((mx + BAR_R - DIG.x0) / DIG.cell));
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        const i = dIdx(c, r), t = d.m[i]; if (!t) continue;
        const p = d.hp[i] / DIG.mats[t].hard; if (p >= 0.9) continue;
        const x = DIG.x0 + c * DIG.cell, y = DIG.y0 + r * DIG.cell; if (Math.hypot(x + 12 - mx, y + 12 - my) > BAR_R) continue;
        bar(x + 2, y + 2, DIG.cell - 4, p);
      }
    } catch (e) {}
    if (view) {   // legend
      g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
      const x = W / 2 - 110, y = 60; g.fillStyle = 'rgba(0,0,0,.75)'; g.fillRect(x - 8, y - 16, 236, 36);
      for (let i = 0; i < 200; i++) { g.fillStyle = rgba(i / 199, 1); g.fillRect(x + i, y, 1, 8); }
      g.fillStyle = '#fff'; g.font = '600 11px "IBM Plex Sans"'; g.fillText('HEALTH VIEW  (K to close)', x, y - 4); g.fillText('0%', x, y + 18); g.fillText('100%', x + 176, y + 18);
      g.restore();
    }
  }
  function toggleView() {
    if (!S || scene !== 'bunker') return;
    view = !view;
    if (view && !toldView) { toldView = true; lamp('Health view: red is about to fail, green is sound. Hover anything for its exact condition.', 'info'); }
  }
  // explosions anywhere in the bunker world (the roof cannon's shells) crack the plates too
  function hookBlasts() {
    if (typeof shellBoom !== 'function' || shellBoom._tiles) return;
    const o = shellBoom; const f = function (x, y) { o(x, y); blast(x, y, (typeof CANNON_R !== 'undefined' ? CANNON_R : 72), 45); }; f._tiles = 1; window.shellBoom = f;
  }
  // ---- build grid: one 24 px lattice over the whole bunker world (lined up with the pit), fading out from the
  // mouse, plus an outline on every tile (shell plates and solid pit tiles) so you can see what's there
  const GR = 230;   // fade radius (world px)
  function drawBuildGridFx(hc) {
    const m = bcamToWorld({ x: mouse.x, y: mouse.y }), cs = DIG.cell, mx = m.x, my = m.y, on = mouse.inCv;
    const fade = (x, y) => { if (!on) return 0; const d = Math.hypot(x - mx, y - my); return d >= GR ? 0 : Math.pow(1 - d / GR, 1.6); };
    const lineRGB = hc ? '255,255,255' : '255,214,150', lineA = hc ? 0.7 : 0.45;
    g.save(); g.lineWidth = 1;
    if (on) {
      const x0 = DIG.x0 + Math.floor((mx - GR - DIG.x0) / cs) * cs, x1 = mx + GR, y0 = DIG.y0 + Math.floor((my - GR - DIG.y0) / cs) * cs, y1 = my + GR;
      for (let x = x0; x <= x1; x += cs) for (let y = y0; y < y1; y += cs) {
        const a = fade(x, y + cs / 2); if (a > 0.01) { g.strokeStyle = 'rgba(' + lineRGB + ',' + (lineA * a).toFixed(3) + ')'; g.beginPath(); g.moveTo(x + 0.5, y); g.lineTo(x + 0.5, y + cs); g.stroke(); }
        const b = fade(x + cs / 2, y); if (b > 0.01) { g.strokeStyle = 'rgba(' + lineRGB + ',' + (lineA * b).toFixed(3) + ')'; g.beginPath(); g.moveTo(x, y + 0.5); g.lineTo(x + cs, y + 0.5); g.stroke(); }
      }
    }
    // tile outlines: always faintly visible, brighter near the mouse
    const outline = (x, y, w, h, rgb) => { const a = (hc ? 0.35 : 0.16) + (hc ? 0.5 : 0.55) * fade(x + w / 2, y + h / 2); g.strokeStyle = 'rgba(' + rgb + ',' + a.toFixed(3) + ')'; g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); };
    for (const bl of blocks()) outline(bl.x, bl.y, bl.w, bl.h, bl.hp <= 0 ? '255,110,90' : '255,190,140');
    try { const d = dg(); for (let r = 0; r < DIG.rows; r++) for (let c = 0; c < DIG.cols; c++) if (d.m[dIdx(c, r)]) outline(DIG.x0 + c * cs, DIG.y0 + r * cs, cs, cs, '230,210,180'); } catch (e) {}
    g.restore();
  }
  return { MAT, shell, blocks, tick, blast, claw, repair, drawShell, drawOverlay, toggleView, isView: () => view, hookBlasts, rgb, isAir, exposed, drawBuildGridFx };
})();
