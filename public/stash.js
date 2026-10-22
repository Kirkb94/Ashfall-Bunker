// Ashfall Bunker: the storage window. Mara walks up to a storage shelf, locker or supply crate and presses E:
// that box's slots open next to her pack, and stacks move by hand.
//   drag            move the whole stack (drop on a slot: empty = place, same item = merge, other item = swap)
//   Shift + drag    pick up half the stack          Ctrl + drag    pick up one
//   Shift + click   send half to the other side      Ctrl + click   send one to the other side
//   click           show what the item is
// Resources in boxes ARE the base stockpile (resSync/resFromBoxes in game.js keep S.res in step).
window.STASH = (() => {
  let box = null, drag = null, down = null, timer = null, lastPt = { x: innerWidth / 2, y: innerHeight / 2 };
  const $id = id => document.getElementById(id);
  const isCtrl = e => e.ctrlKey || e.metaKey;
  document.addEventListener('pointerdown', e => { lastPt = { x: e.clientX, y: e.clientY }; }, true);

  (function css() {
    const st = document.createElement('style');
    st.textContent = '#stWin{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:60;width:min(760px,calc(100vw - 32px));max-height:calc(100vh - 40px);overflow:auto;background:#1b140e;border:1px solid var(--line);box-shadow:0 12px 40px #000a;padding:12px 14px;color:#e8d9b8;user-select:none}'
      + '#stWin .stHead{display:flex;align-items:center;gap:10px;justify-content:space-between;margin-bottom:6px}#stWin .stHead b{font-size:14px}'
      + '#stWin .stCols{display:grid;grid-template-columns:1fr 1fr;gap:14px}@media (max-width:620px){#stWin .stCols{grid-template-columns:1fr}}'
      + '#stWin .islot{touch-action:none}#stWin .islot.over{border-color:#ffb347;background:#3a2a16}#stWin .islot.lift{opacity:.55}'
      + '#stGhost{position:fixed;z-index:70;pointer-events:none;width:46px;height:46px;background:#2a2016;border:1px solid #ffb347;color:#e8d9b8;display:flex;align-items:center;justify-content:center;font-size:18px;transform:translate(-50%,-50%)}#stGhost b{position:absolute;right:3px;bottom:1px;font-size:11px}'
      + '#itTip{position:fixed;z-index:80;max-width:260px;background:#120d09;border:1px solid #ffb347;color:#e8d9b8;padding:8px 10px;font-size:12px;line-height:1.4;box-shadow:0 6px 20px #000a}#itTip b{display:block;font-size:13px;margin-bottom:2px}#itTip .m{opacity:.7}';
    document.head.appendChild(st);
  })();

  // ---- item info tooltip (used here and by the Inventory panel)
  function itemInfo(id) {
    const it = ITEMS[id] || {};
    if (it.res) return 'A resource. The base totals at the top count what sits in storage boxes; building, crafting and the crew take it from there. Unloading at the hatch puts it in a box.';
    if (it.ammo) {
      const users = Object.keys(AMMO_OF).filter(k => AMMO_OF[k] === id).map(k => k === 'sidearm' ? 'Mara\'s sidearm' : (GEAR[k] ? GEAR[k].name : k));
      const tur = Object.keys(TURRET_AMMO).filter(k => TURRET_AMMO[k] === id).map(k => (k === 'hmg' ? 'heavy MG' : k) + ' turrets');
      if (id === 'am_cannon') tur.push('the roof cannon');
      const all = users.concat(tur);
      const cost = it.craft ? Object.entries(it.craft).map(([k, v]) => v + ' ' + itemName(k).toLowerCase()).join(', ') : '';
      return 'Ammo for ' + (all.length ? all.join(', ') : 'nothing yet') + '.' + (cost ? ' The workshop makes ' + it.batch + ' from ' + cost + '.' : '') + ' Turrets and crew take it from storage.';
    }
    return it.desc || '';
  }
  function tip(id, n, x, y) {
    hideTip();
    const d = document.createElement('div'); d.id = 'itTip'; d.setAttribute('role', 'tooltip');
    d.innerHTML = '<b>' + esc(itemName(id)) + '</b><span class="m">' + n + ' / ' + itemStack(id) + ' in this stack</span><br>' + esc(itemInfo(id));
    document.body.appendChild(d);
    const r = d.getBoundingClientRect();
    d.style.left = Math.max(8, Math.min(innerWidth - r.width - 8, x + 12)) + 'px';
    d.style.top = Math.max(8, Math.min(innerHeight - r.height - 8, y + 12)) + 'px';
    setTimeout(() => document.addEventListener('pointerdown', hideTip, { once: true, capture: true }), 0);
  }
  function hideTip() { const t = $id('itTip'); if (t) t.remove(); }
  // Inventory panel: 'p:i' (Mara's pack) or 'b:box:slot'
  function tipRef(ref) {
    const a = String(ref).split(':');
    const s = a[0] === 'p' ? maraInv()[+a[1]] : (storageBoxes()[+a[1]] || { inv: [] }).inv[+a[2]];
    if (s) tip(s.id, s.n, lastPt.x, lastPt.y);
  }

  // ---- which box Mara is standing at
  function boxAt() {
    if (scene !== 'bunker' || !(P.floor > 0) || P.onLadder || S.player.down) return null;
    let best = null, bd = 1e9;
    for (const b of storageBoxes()) {
      const r = ROOMS[b.room], T = ITEM_TYPES[b.type]; if (!r || r.floor !== P.floor) continue;
      const cx = ITX0 + (b.col + T.w / 2) * ITILE, d = Math.abs(P.x - cx);
      if (d < T.w * ITILE / 2 + 26 && d < bd) { bd = d; best = b; }
    }
    return best;
  }
  const boxName = b => ITEM_TYPES[b.type].name + ' in the ' + ((ROOMS[b.room] || {}).name || b.room);

  // ---- window
  const inv = side => side === 'box' ? box.inv : maraInv();
  const other = side => side === 'box' ? 'pack' : 'box';
  const resInBox = () => false;   // resources may go in boxes now
  function cell(s, side, i) {
    const it = s && (ITEMS[s.id] || {});
    return '<div class="islot' + (s ? '' : ' empty') + '" data-side="' + side + '" data-i="' + i + '" role="button" tabindex="' + (s ? 0 : -1) + '" aria-label="' + esc(s ? itemName(s.id) + ', ' + s.n : 'Empty slot') + '" title="' + esc(s ? itemName(s.id) + ' x' + s.n : 'Empty slot') + '">'
      + (s ? '<i style="color:' + (it.color || '#e8d9b8') + '">' + (it.icon || '?') + '</i><b>' + (s.n > 1 ? s.n : '') + '</b><em>' + esc(itemName(s.id)) + '</em>' : '') + '</div>';
  }
  function render() {
    const w = $id('stWin'); if (!w || !box) return;
    const p = maraInv();
    const rt = resBoxText(box);
    w.innerHTML = '<div class="stHead"><b>' + esc(boxName(box)) + (rt ? '<span class="note" style="font-weight:400;margin-left:8px">Holds ' + esc(rt) + '</span>' : '') + '</b><button class="chip" id="stX" type="button">Close (E)</button></div>'
      + '<div class="stCols"><section><div class="sec">' + esc(ITEM_TYPES[box.type].name.toUpperCase()) + ' · ' + invUsed(box.inv) + '/' + box.inv.length + '</div><div class="igrid">' + box.inv.map((s, i) => cell(s, 'box', i)).join('') + '</div></section>'
      + '<section><div class="sec">MARA\'S PACK · ' + invUsed(p) + '/' + p.length + '</div><div class="igrid">' + p.map((s, i) => cell(s, 'pack', i)).join('') + '</div></section></div>'
      + '<p class="note" style="margin:4px 0 0">Drag a stack to move it. Hold <kbd>Shift</kbd> to take half, <kbd>Ctrl</kbd> to take one. Shift-click or Ctrl-click sends half or one across. Click an item to see what it is.</p>';
    $id('stX').onclick = close;
  }
  function refreshOthers() { try { resFromBoxes(); if (!$('#drawer').hidden) renderDrawer(); renderHud(); } catch (e) {} }
  function open(b) {
    if (!b) return; if (box === b) { close(); return; } close(); box = b; hideTip();
    for (const k in keys) keys[k] = false;   // stop her walking off
    const w = document.createElement('div'); w.id = 'stWin'; w.setAttribute('role', 'dialog'); w.setAttribute('aria-label', boxName(b));
    document.body.appendChild(w); render();
    w.addEventListener('pointerdown', onDown); w.addEventListener('contextmenu', e => e.preventDefault());
    w.addEventListener('keydown', e => { const c = e.target.closest && e.target.closest('.islot'); if (c && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); const r = c.getBoundingClientRect(); clickSlot(c.dataset.side, +c.dataset.i, e.shiftKey, isCtrl(e), r.left, r.bottom); } });
    window.addEventListener('keydown', onKey, true);
    timer = setInterval(() => { if (!box || boxAt() !== box || !storageBoxes().includes(box)) close(); else if (!drag) { try { resSync(); } catch (e) {} render(); } }, 400);
  }
  function close() {
    if (drag) cancelDrag();
    const w = $id('stWin'); if (w) w.remove();
    hideTip(); box = null; down = null;
    if (timer) { clearInterval(timer); timer = null; }
    window.removeEventListener('keydown', onKey, true);
  }
  function onKey(e) {
    const k = e.key.toLowerCase();
    if (k === 'escape' || k === BIND.interact || k === 'e' || k === 'i') { e.preventDefault(); e.stopImmediatePropagation(); close(); return; }
    if (k === 'tab' || k === 'enter' || k === ' ' || k === 'shift' || k === 'control' || k === 'meta') return;
    e.stopImmediatePropagation();          // no game hotkeys behind the window
  }

  // ---- moving stacks
  function take(side, i, amt) { const a = inv(side), s = a[i]; if (!s) return null; const n = Math.min(amt, s.n); s.n -= n; const got = { id: s.id, n }; if (s.n <= 0) a[i] = null; return got; }
  function giveBack(side, i, got) {
    if (!got || got.n <= 0) return;
    const a = inv(side), s = a[i];
    if (!s) { a[i] = got; return; }
    if (s.id === got.id) { const t = Math.min(itemStack(got.id) - s.n, got.n); s.n += t; got.n -= t; }
    if (got.n > 0) { const t = invAdd(a, got.id, got.n); got.n -= t; }
    if (got.n > 0) { const o = inv(other(side)); invAdd(o, got.id, got.n); }   // never lose anything
  }
  function clickSlot(side, i, shift, ctrl, x, y) {
    const s = inv(side)[i]; if (!s) return;
    if (!shift && !ctrl) { tip(s.id, s.n, x, y); return; }
    const to = other(side);
    if (resInBox(to, s.id)) { lamp('Resources go to the stockpile: unload them at the hatch.', 'warn'); return; }
    const got = take(side, i, ctrl ? 1 : Math.ceil(s.n / 2));
    const t = invAdd(inv(to), got.id, got.n); got.n -= t;
    if (!t) lamp(to === 'box' ? 'This ' + ITEM_TYPES[box.type].name.toLowerCase() + ' is full.' : 'Mara\'s pack has no room for that.', 'warn');
    giveBack(side, i, got); try { resFromBoxes(); } catch (e) {} render(); refreshOthers();
  }
  function onDown(e) {
    const c = e.target.closest('.islot'); if (!c || e.button > 0) return;
    const side = c.dataset.side, i = +c.dataset.i; if (!inv(side)[i]) return;
    e.preventDefault(); hideTip();
    down = { side, i, x: e.clientX, y: e.clientY, shift: e.shiftKey, ctrl: isCtrl(e) };
    document.addEventListener('pointermove', onMove); document.addEventListener('pointerup', onUp, { once: true });
  }
  function onMove(e) {
    if (!down) return;
    if (!drag) {
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) return;
      const s = inv(down.side)[down.i]; if (!s) { down = null; return; }
      const amt = down.ctrl ? 1 : down.shift ? Math.ceil(s.n / 2) : s.n;
      drag = { side: down.side, i: down.i, got: take(down.side, down.i, amt) };
      const gh = document.createElement('div'); gh.id = 'stGhost'; const it = ITEMS[drag.got.id] || {};
      gh.innerHTML = '<i style="font-style:normal;color:' + (it.color || '#e8d9b8') + '">' + (it.icon || '?') + '</i><b>' + (drag.got.n > 1 ? drag.got.n : '') + '</b>';
      document.body.appendChild(gh); render();
    }
    const gh = $id('stGhost'); if (gh) { gh.style.left = e.clientX + 'px'; gh.style.top = e.clientY + 'px'; }
    document.querySelectorAll('#stWin .islot.over').forEach(x => x.classList.remove('over'));
    const t = document.elementFromPoint(e.clientX, e.clientY), c = t && t.closest && t.closest('#stWin .islot'); if (c) c.classList.add('over');
  }
  function onUp(e) {
    document.removeEventListener('pointermove', onMove);
    const d = down; down = null;
    if (!drag) { if (d) clickSlot(d.side, d.i, d.shift, d.ctrl, e.clientX, e.clientY); return; }
    const t = document.elementFromPoint(e.clientX, e.clientY), c = t && t.closest && t.closest('#stWin .islot');
    if (c) drop(c.dataset.side, +c.dataset.i); else cancelDrag();
  }
  function endDrag() { const gh = $id('stGhost'); if (gh) gh.remove(); drag = null; try { resFromBoxes(); } catch (e) {} render(); refreshOthers(); }
  function cancelDrag() { if (!drag) return; giveBack(drag.side, drag.i, drag.got); endDrag(); }
  function drop(side, i) {
    const g = drag.got, a = inv(side), dst = a[i];
    if (resInBox(side, g.id)) { lamp('Resources go to the stockpile: unload them at the hatch.', 'warn'); cancelDrag(); return; }
    if (!dst) a[i] = { id: g.id, n: g.n };
    else if (dst.id === g.id) { const t = Math.min(itemStack(g.id) - dst.n, g.n); dst.n += t; g.n -= t; giveBack(drag.side, drag.i, g); endDrag(); return; }
    else if (!inv(drag.side)[drag.i] && !resInBox(drag.side, dst.id)) { inv(drag.side)[drag.i] = dst; a[i] = { id: g.id, n: g.n }; }   // swap
    else { cancelDrag(); return; }
    drag.got = null; endDrag();
  }

  return { boxAt, open, close, isOpen: () => !!box, dragging: () => !!drag, boxName, tipRef, tip, itemInfo };
})();
