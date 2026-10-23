// Ashfall Bunker: the character panel, bottom left above the toolbar.
// It shows Mara by default: a live window on her (a crop of the game view, so it plays whatever animation she is
// doing), health, weapon, ammo, statuses and whether she is up, down or dead. Clicking a survivor (in the bunker or
// the crew list) switches it to them; the x goes back to Mara.
window.PHUD = (() => {
  let el = null, pc = null, pg = null, target = null, lastSel, lastHtml = '', hidden = false, selSeen = false;
  const PW = 104, PH = 104;
  const css = '#phud{position:fixed;left:12px;bottom:96px;z-index:45;width:300px;display:flex;gap:8px;padding:6px;background:#120d08e6;border:1px solid var(--line);color:#e8d9b8;font-size:12px;line-height:1.35;pointer-events:auto}'
    + '#phud canvas{width:' + PW + 'px;height:' + PH + 'px;flex:0 0 auto;image-rendering:pixelated;background:#0b0806;border:1px solid #3a2e22}'
    + '#phud .pi{min-width:0;flex:1;display:flex;flex-direction:column;gap:3px}#phud .ph{display:flex;align-items:center;gap:6px}#phud .ph b{font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + '#phud .st{margin-left:auto;font-size:10px;font-weight:700;letter-spacing:.06em;padding:1px 5px;border:1px solid currentColor}#phud .st.ok{color:#8fe67f}#phud .st.dn{color:#ffb347}#phud .st.dd{color:#ff6a5a}#phud .st.aw{color:#9fc4ff}'
    + '#phud .hb{height:7px;background:#2a2016;border:1px solid #3a2e22}#phud .hb i{display:block;height:100%;background:#7ac25a}#phud .hb.lo i{background:#d84a3a}#phud .hb.md i{background:#e0a040}'
    + '#phud .k{opacity:.7}#phud .chips{display:flex;flex-wrap:wrap;gap:3px}#phud .chips span{font-size:10px;padding:0 4px;border:1px solid #5a4632;background:#2a2016}#phud .chips .bad{border-color:#a04030;color:#ffb0a0}#phud .chips .warn{border-color:#9a7030;color:#ffd08a}#phud .chips .good{border-color:#4a7a3a;color:#bfe8a8}'
    + '#phud .x{background:none;border:1px solid #5a4632;color:#e8d9b8;font:inherit;font-size:11px;line-height:1;padding:2px 5px;cursor:pointer}#phud .x:focus-visible{outline:2px solid #ffb347}'
    + '#phud[hidden]{display:none}body.touch #phud{bottom:12px}body.small #phud{width:250px}body.small #phud canvas{width:80px;height:80px}';
  function init() {
    if (el) return;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    el = document.createElement('div'); el.id = 'phud'; el.setAttribute('role', 'region'); el.setAttribute('aria-label', 'Character panel'); el.hidden = true;
    pc = document.createElement('canvas'); pc.width = PW * 2; pc.height = PH * 2; pc.setAttribute('aria-hidden', 'true');
    pg = pc.getContext('2d');
    const info = document.createElement('div'); info.className = 'pi';
    el.appendChild(pc); el.appendChild(info); document.body.appendChild(el);
    el.addEventListener('click', e => { if (e.target.closest('.x')) { target = null; lastHtml = ''; update(true); } });
    requestAnimationFrame(loop);
    setInterval(() => update(false), 250);
  }
  // whose panel this is: a survivor picked by click, else Mara
  function who() {
    try { if (!selSeen && typeof sel !== 'undefined') { selSeen = true; lastSel = sel; }   // whatever was selected before doesn't count
      if (typeof sel !== 'undefined' && sel !== lastSel) { lastSel = sel; if (sel && S && S.crew.some(c => c.id === sel)) target = sel; } } catch (e) {}
    const c = target && S ? S.crew.find(x => x.id === target) : null;
    if (target && !c) target = null;
    return c;
  }
  function shown() {
    if (!S || S.over || (scene !== 'bunker' && scene !== 'scav')) return false;
    const o = document.getElementById('overlay'); if (o && !o.hidden && o.firstElementChild) return false;
    return true;
  }
  // where a world point lands on the game canvas, or null when that world isn't on screen
  function onScreen(x, y, isMara) {
    if (scene === 'bunker') { const v = bcamView(); return { x: (x - v.ox) * v.z, y: (y - v.oy) * v.z, z: v.z }; }
    if (scene === 'scav' && scav && isMara) return { x: x - scav.cam, y: y - (scav.connected ? (scav.camTop || 0) : 0), z: 1 };
    return null;
  }
  function blank(msg, dead) {
    pg.fillStyle = '#0b0806'; pg.fillRect(0, 0, pc.width, pc.height);
    pg.fillStyle = dead ? '#a04030' : '#8a7a62'; pg.font = '600 22px "IBM Plex Sans", sans-serif'; pg.textAlign = 'center';
    pg.fillText(msg, pc.width / 2, pc.height / 2 + 8);
  }
  // Draw with the game's own character drawing, redirected from the main canvas into the portrait for one call.
  // (The draw functions use the game's context g; for the call, g's methods and properties forward to pg.)
  const CTX = CanvasRenderingContext2D.prototype, CTX_KEYS = Object.getOwnPropertyNames(CTX).filter(k => k !== 'constructor' && k !== 'canvas');
  function withCtx(ctx, fn) {
    for (const k of CTX_KEYS) {
      const d = Object.getOwnPropertyDescriptor(CTX, k);
      if (typeof d.value === 'function') Object.defineProperty(g, k, { value: (...a) => ctx[k](...a), configurable: true, writable: true });
      else if (d.get) Object.defineProperty(g, k, { get: () => ctx[k], set: v => { ctx[k] = v; }, configurable: true });
    }
    try { fn(); return true; } catch (e) { return false; } finally { for (const k of CTX_KEYS) delete g[k]; }
  }
  let lastDraw = 0;
  function portrait(c) {
    const now = performance.now(); if (now - lastDraw < 50) return true; lastDraw = now;   // about 20 fps is plenty
    const x = c ? c.x : P.x, y = c ? c.y : P.y, sc = c && c.state === 'sleep' ? 2.3 : 3.1;
    pg.setTransform(1, 0, 0, 1, 0, 0); pg.imageSmoothingEnabled = false;
    const gr = pg.createLinearGradient(0, 0, 0, pc.height); gr.addColorStop(0, '#1a130d'); gr.addColorStop(1, '#2a1f15'); pg.fillStyle = gr; pg.fillRect(0, 0, pc.width, pc.height);
    pg.fillStyle = 'rgba(0,0,0,.35)'; pg.beginPath(); pg.ellipse(pc.width / 2, pc.height * 0.86, 28, 6, 0, 0, 7); pg.fill();   // floor shadow
    pg.setTransform(sc, 0, 0, sc, pc.width / 2 - x * sc, pc.height * 0.86 - y * sc);
    const ok = withCtx(pg, () => { if (c) drawPerson(c.x, c.y, c.color, c.accent, c, c.anim, c.facing, c.state === 'sleep', c.climbing); else drawMara(); });
    pg.setTransform(1, 0, 0, 1, 0, 0);
    return ok;
  }
  function loop() {
    requestAnimationFrame(loop);
    if (!el || el.hidden || hidden) return;
    const c = who(), isMara = !c;
    if (c) {
      if (!c.alive) return blank('† Dead', true);
      if (c.exp) return blank('On expedition');
      if (c.left) return blank('Gone');
    } else if (S.player.down) return blank('Down', true);
    if (portrait(c)) return;   // drawn on its own; the crop of the game view below is only a fallback
    const x = c ? c.x : P.x, y = c ? c.y : P.y, p = onScreen(x, y, isMara);
    if (!p) return blank('Not in view');
    const sz = 84 * p.z, sx = p.x - sz / 2, sy = p.y - sz * 0.72;
    if (sx + sz < 0 || sy + sz < 0 || sx > cv.width || sy > cv.height) return blank('Not in view');
    pg.imageSmoothingEnabled = false;
    pg.fillStyle = '#0b0806'; pg.fillRect(0, 0, pc.width, pc.height);
    try { pg.drawImage(cv, sx, sy, sz, sz, 0, 0, pc.width, pc.height); } catch (e) {}
  }
  const pct = (a, b) => b > 0 ? Math.max(0, Math.min(100, a / b * 100)) : 0;
  function bar(hp, max) { const v = pct(hp, max); return '<div class="hb' + (v < 30 ? ' lo' : v < 60 ? ' md' : '') + '" role="meter" aria-label="Health" aria-valuemin="0" aria-valuemax="' + Math.round(max) + '" aria-valuenow="' + Math.round(hp) + '"><i style="width:' + v + '%"></i></div>'; }
  const chip = (t, k) => '<span class="' + (k || '') + '">' + esc(t) + '</span>';
  function maraHtml() {
    const pl = S.player, id = maraWpnId(), w = maraWpn(), aid = AMMO_OF[id || 'sidearm'];
    const pack = aid ? invCount(maraInv(), aid) : 0, home = scene === 'bunker' && aid ? storeCount(aid) : 0;
    const st = pl.down ? ['Down', 'dn'] : pl.hp <= 0 ? ['Dead', 'dd'] : ['Alive', 'ok'];
    const chips = [];
    if (pl.hp > 0 && pl.hp < pl.maxHp * 0.35) chips.push(chip('Badly hurt', 'bad'));
    if ((pl.food ?? 100) < 25) chips.push(chip('Hungry', 'warn'));
    if (aid && w.kind === 'gun' && pack + home <= 0 && !((P.aAcc || 0) > 0)) chips.push(chip('Out of ammo: knife', 'bad'));
    if (P.over) chips.push(chip('Overheated', 'bad'));
    const hz = scene === 'scav' && scav && scav.hz;
    if (hz && hz.inGas) chips.push(chip(hz.mask > 0 ? 'In gas' : 'In gas, no mask', 'bad'));
    if (hz && hz.mask > 0) chips.push(chip('Gas mask ' + Math.ceil(hz.mask) + 's', 'good'));
    if (P.auto) chips.push(chip('Autopilot', ''));
    if (typeof gunnery !== 'undefined' && gunnery) chips.push(chip('On the cannon', 'good'));
    if (pl.revives != null) chips.push(chip('Revives ' + (pl.revives | 0), (pl.revives | 0) ? '' : 'warn'));
    return '<div class="ph"><b>' + esc(pl.name || 'Mara') + '</b><span class="k">Lv ' + (pl.lvl || 1) + '</span><span class="st ' + st[1] + '">' + st[0].toUpperCase() + '</span></div>'
      + bar(pl.hp, pl.maxHp) + '<div><span class="k">HP</span> ' + Math.ceil(Math.max(0, pl.hp)) + '/' + pl.maxHp + '</div>'
      + '<div><span class="k">Weapon</span> ' + esc(id ? GEAR[id].name : 'Sidearm') + (w.heat ? ' <span class="k">heat ' + Math.round(Math.min(1, P.heat || 0) * 100) + '%</span>' : '') + '</div>'
      + '<div><span class="k">Ammo</span> ' + (aid ? pack + ' ' + esc(AMMO[aid].name.toLowerCase()) + (scene === 'bunker' ? ' <span class="k">+' + home + ' stored</span>' : '') : 'none needed') + '</div>'
      + (chips.length ? '<div class="chips">' + chips.join('') + '</div>' : '');
  }
  function crewHtml(c) {
    const st = !c.alive ? ['Dead', 'dd'] : c.left ? ['Gone', 'dd'] : c.exp ? ['Away', 'aw'] : (c.hp < c.maxHp * 0.25 ? ['Critical', 'dn'] : ['Alive', 'ok']);
    const aid = c.held && AMMO_OF[c.held], ammo = aid ? invCount(crewInv(c), aid) : 0;
    const chips = [];
    if (c.alive && !c.left) {
      if (c.sick) chips.push(chip('Sick', 'bad'));
      if (c.patient) chips.push(chip('Injured', 'bad'));
      if (c.food < 30) chips.push(chip('Hungry', 'warn'));
      try { if (c.state !== 'sleep' && sleepFactor(c.awake) < 0.6) chips.push(chip('Tired', 'warn')); } catch (e) {}
      if (c.state === 'sleep') chips.push(chip('Asleep', ''));
      if (c.grief > 0) chips.push(chip('Grieving', 'warn'));
      try { const m = morale(c); if (m < 40) chips.push(chip('Low morale', 'bad')); else if (m >= 80) chips.push(chip('High morale', 'good')); } catch (e) {}
      try { if (restActive(c)) chips.push(chip('Rest day', 'good')); } catch (e) {}
      if (c.exp) chips.push(chip('On expedition', ''));
      if (aid && ammo <= 0) chips.push(chip('No ammo: fists', 'bad'));
    }
    const job = (JOBS[c.job] && JOBS[c.job].label) || c.job || '';
    return '<div class="ph"><b style="color:' + esc(c.accent || '#e8d9b8') + '">' + esc(c.name) + '</b><span class="st ' + st[1] + '">' + st[0].toUpperCase() + '</span><button type="button" class="x" aria-label="Back to Mara" title="Back to Mara">×</button></div>'
      + (c.alive ? bar(c.hp, c.maxHp) + '<div><span class="k">HP</span> ' + Math.ceil(Math.max(0, c.hp)) + '/' + Math.round(c.maxHp) + (job ? ' <span class="k">· ' + esc(job) + '</span>' : '') + '</div>' : '<div class="k">Lost to the bunker. The others remember.</div>')
      + (c.alive && handItem(c) && handItem(c).carry ? '<div><span class="k">In hand</span> ' + esc(itemName(handItem(c).id)) + (handItem(c).n > 1 ? ' x' + handItem(c).n : '') + '</div>' : '')
      + '<div><span class="k">Weapon</span> ' + esc(c.held && GEAR[c.held] ? GEAR[c.held].name : 'Unarmed') + (c.held && c.stowed ? ' <span class="k">(stowed)</span>' : '') + '</div>'
      + (c.held ? '<div><span class="k">Ammo</span> ' + (aid ? ammo + ' ' + esc(AMMO[aid].name.toLowerCase()) : 'none needed') + '</div>' : '')
      + (chips.length ? '<div class="chips">' + chips.join('') + '</div>' : '');
  }
  function update(force) {
    init();
    const on = shown(); if (el.hidden === on) el.hidden = !on;
    if (!on) return;
    let html = '';
    try { const c = who(); html = c ? crewHtml(c) : maraHtml(); } catch (e) { html = '<div class="k">…</div>'; }
    if (force || html !== lastHtml) { el.querySelector('.pi').innerHTML = html; lastHtml = html; }
  }
  return { update, show: id => { target = id || null; update(true); }, mara: () => { target = null; update(true); } };
})();
setTimeout(() => window.PHUD && PHUD.update(true), 0);
