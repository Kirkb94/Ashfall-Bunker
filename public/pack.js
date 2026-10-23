// Ashfall Bunker: Mara's pack as its own window (I, or the Inventory button). It shows her stats and level, the weapon
// she has equipped (and what she could swap to from stock), and her pack slots. Click a slot to see what it is.
// The Gear tab in the side panel keeps crafting, ammo, storage and food.
window.PACK = (() => {
  let el = null, timer = null, last = '';
  const css = '#packWin{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:58;width:min(560px,calc(100vw - 32px));max-height:calc(100vh - 40px);overflow:auto;background:#1b140e;border:1px solid var(--line);box-shadow:0 12px 40px #000a;padding:12px 14px;color:#e8d9b8}'
    + '#packWin .pkHead{display:flex;align-items:center;gap:10px;margin-bottom:8px}#packWin .pkHead b{font-size:16px}#packWin .pkHead .lv{font-weight:700;color:#ffb347;border:1px solid #6a4a28;padding:1px 6px;font-size:12px}#packWin .pkHead .sp{flex:1}'
    + '#packWin .pkStats{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px 12px;margin:4px 0 10px}#packWin .pkStats div{min-width:0}#packWin .k{opacity:.7;font-size:11px;display:block;letter-spacing:.04em}'
    + '#packWin .mb{height:7px;background:#2a2016;border:1px solid #3a2e22;margin-top:2px}#packWin .mb i{display:block;height:100%}'
    + '#packWin .pkW{border:1px solid #3a2e22;background:#22190f;padding:8px;margin-bottom:10px}#packWin .pkW b{font-size:13px}#packWin .row{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}';
  function meter(v, max, col) { const p = max > 0 ? Math.max(0, Math.min(100, v / max * 100)) : 0; return '<div class="mb" role="meter" aria-valuemin="0" aria-valuemax="' + Math.round(max) + '" aria-valuenow="' + Math.round(v) + '"><i style="width:' + p + '%;background:' + col + '"></i></div>'; }
  function wstat(w) { return w.kind === 'melee' ? 'melee, ' + w.dmg + ' damage' : w.dmg + ' damage' + (w.pellets > 1 ? ' x' + w.pellets : '') + ', ' + (1 / w.cd).toFixed(1) + ' shots/s' + (w.range ? ', range ' + w.range : '') + (w.heat ? ', overheats' : '') + (w.pierce ? ', goes through' : '') + (w.bleedP ? ', causes bleeding' : '') + (w.burn ? ', sets them on fire' : ''); }
  function html() {
    const pl = S.player, inv = maraInv(), id = maraWpnId(), w = maraWpn(), aid = AMMO_OF[id || 'sidearm'];
    const need = 50 * (pl.lvl || 1), lvlK = 1 + 0.06 * ((pl.lvl || 1) - 1), st = stock(), own = GEAR_IDS.filter(k => (st[k] || 0) > 0);
    const pack = aid ? invCount(inv, aid) : 0, home = scene === 'bunker' && aid ? storeCount(aid) : 0;
    const status = pl.down ? 'Down' : pl.hp <= 0 ? 'Dead' : 'Alive';
    const stats = [
      ['Health', Math.ceil(Math.max(0, pl.hp)) + ' / ' + pl.maxHp + meter(pl.hp, pl.maxHp, pl.hp < pl.maxHp * 0.35 ? '#d84a3a' : '#7ac25a')],
      ['Experience', Math.floor(pl.xp || 0) + ' / ' + need + ' to level ' + ((pl.lvl || 1) + 1) + meter(pl.xp || 0, need, '#ffb347')],
      ['Hunger', Math.round(pl.food ?? 100) + ' / 100' + meter(pl.food ?? 100, 100, '#c9a27a')],
      ['Status', status + (pl.revives != null ? ' · ' + (pl.revives | 0) + ' revive' + ((pl.revives | 0) === 1 ? '' : 's') + ' left' : '')],
      ['Weapon damage', '+' + Math.round((lvlK - 1) * 100) + '% from level' + (armoryMult() > 1 ? ', +' + Math.round((armoryMult() - 1) * 100) + '% armory' : '')],
      ['Pack', invUsed(inv) + ' / ' + inv.length + ' slots · backpack Lv ' + (pl.packLvl || 0) + '/4']
    ].map(([k, v]) => '<div><span class="k">' + k.toUpperCase() + '</span>' + v + '</div>').join('');
    const weapon = '<div class="pkW"><span class="k">EQUIPPED WEAPON</span><b>' + esc(id ? GEAR[id].name : 'Sidearm') + '</b> <span class="note" style="margin:0">' + esc(wstat(w)) + '</span>'
      + '<div style="margin-top:4px">Ammo: ' + (aid ? pack + ' ' + esc(AMMO[aid].name.toLowerCase()) + ' in her pack' + (scene === 'bunker' ? ', ' + home + ' in storage' : '') : 'none needed') + (w.heat ? ' · heat ' + Math.round(Math.min(1, P.heat || 0) * 100) + '%' + (P.over ? ' (overheated)' : '') : '') + '</div>'
      + '<div class="row">' + (id ? '<button class="chip" type="button" data-pk="munequip" data-g="x">Back to her sidearm</button>' : '') + own.map(k => '<button class="chip" type="button" data-pk="mequip" data-g="' + k + '" title="' + esc(wstat(GW[k] || {})) + '">Equip ' + esc(GEAR[k].name) + ' (' + st[k] + ')</button>').join('') + (own.length ? '' : '<span class="note" style="margin:0">Craft or loot weapons; they show up here to equip.</span>') + '</div></div>';
    const slots = inv.map((s, i) => slotCell(s, 'pkinfo', 'p:' + i, s ? itemName(s.id) + ' x' + s.n + ' (click for details)' : '')).join('');
    return '<div class="pkHead"><b>' + esc(pl.name || 'Mara') + '</b><span class="lv">LEVEL ' + (pl.lvl || 1) + '</span><span class="sp"></span><button class="chip" type="button" data-pk="close">Close (I)</button></div>'
      + '<div class="pkStats">' + stats + '</div>' + weapon
      + '<div class="sec">PACK · ' + invUsed(inv) + '/' + inv.length + ' SLOTS</div><div class="igrid">' + slots + '</div>'
      + '<p class="note" style="margin:4px 0 0">Unload at the hatch (E). To move items by hand, stand at a shelf, locker or crate and press E. Backpack upgrades at the hatch add 3 slots.</p>';
  }
  function render(force) { if (!el || !S) return; const h = html(); if (force || h !== last) { el.innerHTML = h; last = h; } }
  function open() {
    if (!S || S.over) return;
    if (!el) {
      if (!document.getElementById('packCss')) { const st = document.createElement('style'); st.id = 'packCss'; st.textContent = css; document.head.appendChild(st); }
      el = document.createElement('div'); el.id = 'packWin'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Mara\'s pack');
      el.addEventListener('click', e => {
        const b = e.target.closest('[data-pk]'), s = e.target.closest('[data-gear="pkinfo"]');
        if (b) { const a = b.dataset.pk; if (a === 'close') { close(); return; } gearAct(a, b.dataset.g); try { renderHud(); if (!$('#drawer').hidden) renderDrawer(); } catch (err) {} render(true); return; }
        if (s && window.STASH) STASH.tipRef(s.dataset.g);
      });
      document.body.appendChild(el);
    }
    el.hidden = false; render(true);
    if (!timer) timer = setInterval(() => { if (!S || S.over || (scene !== 'bunker' && scene !== 'scav')) close(); else render(false); }, 300);
    window.addEventListener('keydown', onKey, true);
  }
  function close() {
    if (el) el.hidden = true;
    if (timer) { clearInterval(timer); timer = null; }
    window.removeEventListener('keydown', onKey, true);
  }
  function onKey(e) {
    const k = e.key.toLowerCase();
    if ((k === 'escape' || k === 'i') && !(window.STASH && STASH.isOpen())) { e.preventDefault(); e.stopImmediatePropagation(); close(); }
  }
  const isOpen = () => !!(el && !el.hidden);
  return { open, close, toggle: () => (isOpen() ? close() : open()), isOpen };
})();
