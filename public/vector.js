// Vector art for Ashfall Bunker, matching the concept sheet: flat rounded shapes, a darker right-hand half for volume,
// a soft ground shadow, and the same palette. Same call shapes as sprites.js (origin = bottom centre, faces right).
// If this file fails to load the game falls back to the pixel sprites.
const VEC = (function () {
  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const c = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
    return '#' + ((1 << 24) | (c((n >> 16) & 255) << 16) | (c((n >> 8) & 255) << 8) | c(n & 255)).toString(16).slice(1);
  }
  function rr(g, x, y, w, h, r, c) {
    g.fillStyle = c; g.beginPath();
    if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h);
    g.fill();
  }
  function circ(g, x, y, r, c) { g.fillStyle = c; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
  function ell(g, x, y, rx, ry, c) { g.fillStyle = c; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, 7); g.fill(); }
  function line(g, x1, y1, x2, y2, w, c) { g.strokeStyle = c; g.lineWidth = w; g.lineCap = 'round'; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); }
  function poly(g, pts, c) { g.fillStyle = c; g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); g.fill(); }
  // darker right half, the sheet's volume trick
  function half(g, x, y, w, h, r) { rr(g, x + w / 2, y, w / 2, h, [0, r, r, 0], 'rgba(0,0,0,.18)'); }
  function shadow(g, rx) { g.globalAlpha = 0.38; ell(g, 0, 0, rx, 2.4, '#000'); g.globalAlpha = 1; }
  function begin(g, flip) { g.save(); if (flip) g.scale(-1, 1); }
  // walk poses: 0 stand, 1 left foot forward, 2 right foot forward
  function legs(g, frame, lw, lh, gap, col, boot) {
    const dxL = frame === 1 ? 2 : frame === 2 ? -2 : 0, dxR = -dxL;
    const liftL = frame === 2 ? 1.4 : 0, liftR = frame === 1 ? 1.4 : 0;
    const xl = -gap - lw + dxL, xr = gap + dxR;
    rr(g, xl, -lh - liftL, lw, lh - 0 + 0, lw / 2.2, col); rr(g, xr, -lh - liftR, lw, lh, lw / 2.2, shade(col, 0.85));
    rr(g, xl - 0.6, -3.4 - liftL, lw + 1.6, 3.4, 1.6, boot); rr(g, xr - 0.6, -3.4 - liftR, lw + 1.6, 3.4, 1.6, boot);
  }

  // ---- data-driven characters and enemies (shapes live in vector-models.js) ----
  function resolve(c, o) {
    if (Array.isArray(c) && (c[0] === 'color' || c[0] === 'accent')) return shade(c[0] === 'accent' ? o.accent : o.color, c[1]);
    return c;
  }
  function drawPart(g, p, o, fr) {
    const col = o.hi ? 'rgba(255,43,214,.9)' : null;
    const c = col || resolve(p.c, o);
    if (p.k === 'rr') {
      const open = p.open ? 2 + 1.5 * Math.sin((o.t || 0) * 3) : 0;
      rr(g, p.x, p.y - open / 2, p.w, p.h + open, p.r, c);
      if (p.half && !o.hi) half(g, p.x, p.y, p.w, p.h, p.r);
    } else if (p.k === 'circ') circ(g, p.x, p.y, p.r, c);
    else if (p.k === 'ell') ell(g, p.x, p.y, p.rx, p.ry, c);
    else if (p.k === 'line') {
      const sw = fr === 1 ? 1.2 : fr === 2 ? -1.2 : 0;
      line(g, p.x1 + (p.sx1 || 0) * sw, p.y1, p.x2 + (p.sx2 || 0) * sw, p.y2 + (fr && p.fy2 ? p.fy2 : 0), p.w, c);
    } else if (p.k === 'poly') poly(g, p.pts, c);
    else if (p.k === 'cap') { g.fillStyle = c; g.beginPath(); g.arc(p.x, p.y, p.r, Math.PI, 0); g.lineTo(p.x + p.r, p.y + p.drop); g.lineTo(p.x - p.r, p.y + p.drop); g.closePath(); g.fill(); }
    else if (p.k === 'legs') legs(g, fr, p.lw, p.lh, p.gap, col || p.c, col || p.boot);
    else if (p.k === 'hlegs') {
      const a = fr === 1 ? 2 : fr === 2 ? -2 : 0;
      p.xs.forEach((x, i) => rr(g, x + p.signs[i] * a, -p.h, p.w, p.h, 1.6, col || p.c[i]));
    } else if (p.k === 'mound') {
      g.fillStyle = c; g.beginPath(); g.moveTo(-p.hw, 0); g.quadraticCurveTo(-p.hw - 1, p.top + 2, 0, p.top); g.quadraticCurveTo(p.hw + 1, p.top + 2, p.hw, 0); g.closePath(); g.fill();
      if (!o.hi) { g.fillStyle = 'rgba(0,0,0,.18)'; g.beginPath(); g.moveTo(0, p.top); g.quadraticCurveTo(p.hw + 1, p.top + 2, p.hw, 0); g.lineTo(0, 0); g.closePath(); g.fill(); }
    } else if (p.k === 'teeth') {
      const open = 2 + 1.5 * Math.sin((o.t || 0) * 3);
      for (let i = 0; i < p.n; i++) { const x = p.x0 + i * p.step; poly(g, [[x, -27 - open / 2], [x + 3, -27 - open / 2], [x + 1.5, -20 - open / 2]], col || p.c); poly(g, [[x + 1, -5 + open / 2], [x + 4, -5 + open / 2], [x + 2.5, -12 + open / 2]], col || p.c); }
    }
  }

  // ---- surface detail: outline, rim light, rust, scratches, grime (deterministic, baked once per look) ----
  const WEAR = { on: true, rust: 1 };
  function hashStr(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  // marks laid over a region (x, y, w, h in the current coordinates) with the current clip or source-atop
  function marks(g, x, y, w, h, seed, rust, grime) {
    const r = rng(seed);
    for (let i = 0, n = Math.round(rust * (2 + r() * 3)); i < n; i++) {
      const cx = x + r() * w, cy = y + (0.25 + r() * 0.75) * h, k = 3 + Math.floor(r() * 4);
      for (let j = 0; j < k; j++) {
        const a = 0.14 + r() * 0.26;
        g.fillStyle = 'rgba(' + (140 + Math.floor(r() * 40)) + ',' + (60 + Math.floor(r() * 25)) + ',24,' + a + ')';
        g.beginPath(); g.ellipse(cx + (r() - 0.5) * 5, cy + (r() - 0.5) * 4, 0.8 + r() * 2.2, 0.6 + r() * 1.6, r() * 3, 0, 7); g.fill();
      }
    }
    for (let i = 0, n = 2 + Math.floor(r() * 3); i < n; i++) {
      const cx = x + r() * w, cy = y + r() * h, L = 3 + r() * 6, an = (r() - 0.5) * 1.4 + (r() < 0.5 ? 0 : 1.57);
      g.strokeStyle = 'rgba(240,222,190,' + (0.18 + r() * 0.2) + ')'; g.lineWidth = 0.45; g.lineCap = 'round';
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(an) * L, cy + Math.sin(an) * L); g.stroke();
    }
    for (let i = 0; i < grime; i++) {
      g.fillStyle = 'rgba(18,11,6,' + (0.07 + r() * 0.08) + ')';
      g.beginPath(); g.ellipse(x + r() * w, y + (0.55 + r() * 0.45) * h, 2 + r() * 5, 1 + r() * 2.4, 0, 0, 7); g.fill();
    }
    for (let i = 0; i < 6; i++) { g.fillStyle = 'rgba(20,10,5,' + (0.2 + r() * 0.25) + ')'; g.fillRect(x + r() * w, y + r() * h, 0.7, 0.7); }
  }
  function rrPath(g, x, y, w, h, r) { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h); }
  // call right after drawing a prop body
  function weathered(g, x, y, w, h, r, seed, rust) {
    if (!WEAR.on) return;
    g.save(); rrPath(g, x, y, w, h, r); g.clip();
    marks(g, x, y, w, h, seed, rust * WEAR.rust, 1);
    g.fillStyle = 'rgba(255,235,200,.10)'; g.fillRect(x, y, w, 0.9); g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(x, y + h - 0.9, w, 0.9);
    g.restore();
    g.save(); g.strokeStyle = 'rgba(8,5,3,.55)'; g.lineWidth = 0.8; rrPath(g, x, y, w, h, r); g.stroke(); g.restore();
  }
  const SCALE = 3, BW = 170, BH = 120, OX = 85, OY = 112;
  const bakeCache = new Map();
  function mk(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function bakeModel(m, id, o, parts, fr, S) {
    const W = BW * S, H = BH * S;
    const base = mk(W, H), bg = base.getContext('2d');
    bg.setTransform(S, 0, 0, S, OX * S, OY * S);
    parts.forEach((p) => drawPart(bg, p, Object.assign({ hi: false }, o), fr));
    bg.setTransform(1, 0, 0, 1, 0, 0);
    const out = mk(W, H), og = out.getContext('2d');
    // outline: the sprite stamped in a dark colour on 8 sides
    const dark = mk(W, H), dg = dark.getContext('2d'); dg.drawImage(base, 0, 0); dg.globalCompositeOperation = 'source-in'; dg.fillStyle = '#0b0705'; dg.fillRect(0, 0, W, H);
    const d = 1.1 * S; [[-d, 0], [d, 0], [0, -d], [0, d], [-d, -d], [d, -d], [-d, d], [d, d]].forEach((v) => og.drawImage(dark, v[0], v[1]));
    // work copy: base + rim light + shade + marks
    const wk = mk(W, H), wg = wk.getContext('2d'); wg.drawImage(base, 0, 0);
    const rim = (dx, dy, col) => { const t = mk(W, H), tg = t.getContext('2d'); tg.drawImage(base, 0, 0); tg.globalCompositeOperation = 'destination-out'; tg.drawImage(base, dx, dy); tg.globalCompositeOperation = 'source-in'; tg.fillStyle = col; tg.fillRect(0, 0, W, H); wg.drawImage(t, 0, 0); };
    rim(1.4 * S, 1.4 * S, 'rgba(255,236,205,.42)'); rim(-1.4 * S, -1.4 * S, 'rgba(0,0,0,.32)');
    wg.globalCompositeOperation = 'source-atop'; wg.setTransform(S, 0, 0, S, OX * S, OY * S);
    const enemy = m.kind !== 'crew' && m.kind !== 'player';
    marks(wg, -42, -78, 84, 78, hashStr(id + '|' + (o.color || '')), (enemy ? 1 : 0) * WEAR.rust, 3);
    wg.setTransform(1, 0, 0, 1, 0, 0); wg.globalCompositeOperation = 'source-over';
    og.drawImage(wk, 0, 0);
    return out;
  }
  // opts: color, accent (the game's colours), frame, t (seconds), flip, hi (part index to highlight), parts (override list)
  function drawModel(g, id, opts) {
    const m = (typeof VEC_MODELS !== 'undefined') && VEC_MODELS[id]; if (!m) return;
    const o = { color: opts.color || m.color, accent: opts.accent || m.accent || '#d8cfbf', t: opts.t || 0 };
    const parts = opts.parts || m.parts, fr = opts.frame || 0;
    begin(g, opts.flip); shadow(g, m.shadow);
    if (WEAR.on && opts.hi == null && typeof document !== 'undefined') {
      const animated = parts.some((p) => p.open || p.k === 'teeth');
      const ph = animated ? Math.floor((((o.t * 3) % 6.2832) / 6.2832) * 8) % 8 : 0;
      const res = opts.res || SCALE;
      const key = [id, o.color, o.accent, fr, ph, res, opts.parts ? hashStr(JSON.stringify(opts.parts)) : ''].join('|');
      let img = bakeCache.get(key);
      if (!img) { if (bakeCache.size > 300) bakeCache.clear(); o.t = animated ? (ph / 8) * 6.2832 / 3 : 0; img = bakeModel(m, id, o, parts, fr, res); bakeCache.set(key, img); }
      g.imageSmoothingEnabled = true; g.drawImage(img, -OX, -OY, BW, BH);
    } else parts.forEach((p, i) => drawPart(g, p, Object.assign({ hi: opts.hi === i }, o), fr));
    g.restore();
  }
  function person(g, color, accent, frame, flip) { drawModel(g, 'person', { color, accent, frame, flip }); }
  function mara(g, frame, flip) { drawModel(g, 'mara', { frame, flip }); }
  const hasModel = (type) => typeof VEC_MODELS !== 'undefined' && !!VEC_MODELS[type] && type !== 'person' && type !== 'mara';

  // ---- furniture (grid items) ----
  function item(g, type, x, yb, w, T, o) {
    o = o || {};
    const c = T.color, hi = 'rgba(255,255,255,.14)';
    if (type === 'bench') {
      rr(g, x + 3, yb - 18, 5, 18, 2, shade(c, 0.7)); rr(g, x + w - 8, yb - 18, 5, 18, 2, shade(c, 0.7));
      rr(g, x + 1, yb - 26, w - 2, 8, 3, c); rr(g, x + 1, yb - 26, w - 2, 2.4, 1.2, hi);
      line(g, x + 10, yb - 27, x + 16, yb - 35, 3, '#a8a8b0'); rr(g, x + 20, yb - 31, 10, 5, 2, '#9a8a70');
      rr(g, x + w - 18, yb - 31, 7, 5, 2.5, '#ffb347');
      weathered(g, x + 1, yb - 26, w - 2, 8, 3, 11 + w, 1);
    } else if (type === 'stove') {
      rr(g, x + 1, yb - 26, w - 2, 26, 5, c); half(g, x + 1, yb - 26, w - 2, 26, 5);
      rr(g, x + 1, yb - 28, w - 2, 4, 2, '#a58458');
      circ(g, x + 14, yb - 12, 4, '#2a2018'); circ(g, x + 14, yb - 12, 2.4, '#ff9a3a');
      for (let i = 0, n = Math.min(8, Math.floor(o.cooked || 0)); i < n; i++) rr(g, x + 4 + i * 6, yb - 35, 4.4, 6, 2, '#e8b86a');
      weathered(g, x + 1, yb - 26, w - 2, 26, 5, 23 + w, 1);
    } else if (type === 'planter') {
      rr(g, x + 1, yb - 11, w - 2, 11, 3.5, c); rr(g, x + 1, yb - 11, w - 2, 2.4, 1.2, hi);
      for (let j = 0; j < 4; j++) { const px = x + 10 + j * 12, ph = 12 + (j % 2) * 4; ell(g, px, yb - 11 - ph / 2, 3.6, ph / 2, '#7ddc6f'); ell(g, px + 1.4, yb - 11 - ph / 2, 1.8, ph / 2, '#5fb454'); }
    } else if (type === 'cot') {
      rr(g, x + 3, yb - 9, 4, 9, 1.6, '#777'); rr(g, x + w - 7, yb - 9, 4, 9, 1.6, '#777');
      rr(g, x + 1, yb - 17, w - 2, 9, 4, c); half(g, x + 1, yb - 17, w - 2, 9, 4);
      rr(g, x + 4, yb - 23, 17, 7, 3.5, '#eee8dc');
      rr(g, x + w - 16, yb - 15, 10, 2, 1, '#e04848');
      weathered(g, x + 1, yb - 17, w - 2, 9, 4, 31 + w, 0.4);
    } else if (type === 'bunk') {
      rr(g, x + 1, yb - 36, 4, 36, 1.6, '#4a3d2e'); rr(g, x + w - 5, yb - 36, 4, 36, 1.6, '#4a3d2e');
      rr(g, x + 2, yb - 14, w - 4, 8, 3, c); rr(g, x + 2, yb - 36, w - 4, 8, 3, c);
      rr(g, x + 5, yb - 18, 14, 5, 2.5, '#b8a78a'); rr(g, x + 5, yb - 40, 14, 5, 2.5, '#b8a78a');
    } else if (type === 'table') {
      rr(g, x + 7, yb - 18, 6, 18, 2, '#5a3d28'); rr(g, x + w - 13, yb - 18, 6, 18, 2, '#5a3d28');
      rr(g, x + 1, yb - 26, w - 2, 8, 3, c); rr(g, x + 1, yb - 26, w - 2, 2.4, 1.2, hi);
      ell(g, x + 14, yb - 28, 5, 1.6, '#d8cfbf'); ell(g, x + w - 16, yb - 28, 5, 1.6, '#d8cfbf');
      weathered(g, x + 1, yb - 26, w - 2, 8, 3, 41 + w, 0.5);
    } else if (type === 'console') {
      rr(g, x + 1, yb - 30, w - 2, 30, 5, c); half(g, x + 1, yb - 30, w - 2, 30, 5);
      rr(g, x + 5, yb - 26, w - 10, 13, 3, o.powered ? '#2f7fa8' : '#222');
      if (o.powered) { g.globalAlpha = 0.35; rr(g, x + 5, yb - 26, w - 10, 13, 3, '#7fc8ff'); g.globalAlpha = 1; }
      circ(g, x + 10, yb - 7, 2, '#ffb347'); circ(g, x + 18, yb - 7, 2, '#ffb347');
      weathered(g, x + 1, yb - 30, w - 2, 30, 5, 53 + w, 0.7);
    } else { rr(g, x + 1, yb - 28, w - 2, 28, 5, c); half(g, x + 1, yb - 28, w - 2, 28, 5); }
  }

  // ---- surface pieces ----
  function door(g, X, y, dp) {
    rr(g, X - 31, y - 48, 62, 48, 7, '#4a4740'); half(g, X - 31, y - 48, 62, 48, 7);
    rr(g, X - 35, y - 54, 70, 9, 4, '#3a3832');
    const open = dp > 0;
    rr(g, X - 17, y - 39, 34, 39, 5, open ? '#' + [90 + (120 - 90) * dp, 40 + (118 - 40) * dp, 30 + (110 - 30) * dp].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('') : '#140c08');
    if (open) { line(g, X - 12, y - 28, X + 12, y - 28, 2, 'rgba(0,0,0,.35)'); line(g, X - 12, y - 18, X + 12, y - 18, 2, 'rgba(0,0,0,.35)'); circ(g, X + 11, y - 20, 2.2, '#ffb347'); }
    weathered(g, X - 31, y - 48, 62, 48, 7, 7, 1.2);
  }
  function wall(g, X, y, h, lvl) {
    const n = 5;
    for (let i = 0; i < n; i++) rr(g, X - 11 + (i % 2) * 3, y - h + i * (h / n), 24, h / n - 1.2, 3, i % 2 ? '#6a5640' : '#7a6650');
    rr(g, X + 5, y - h, 8, h, [0, 3, 3, 0], 'rgba(0,0,0,.18)');
    if (lvl > 1) for (let i = 0; i < 4; i++) line(g, X - 12 + i * 8, y - h - 7, X - 8 + i * 8, y - h, 1.4, '#a8a8b0');
    weathered(g, X - 11, y - h, 24, h, 3, 19 + Math.round(h), 1);
  }
  function turret(g, x, y, t, o) {
    rr(g, x - 15, y - 19, 30, 19, 5, '#4f4a40'); half(g, x - 15, y - 19, 30, 19, 5);
    weathered(g, x - 15, y - 19, 30, 19, 5, 61, 1);
    rr(g, x - 9, y - 33, 18, 15, 6, t.manned ? '#6a6a5a' : '#45433b');
    weathered(g, x - 9, y - 33, 18, 15, 6, 67, 0.6);
    if (t.type === 'coil') {
      rr(g, x - 2, y - 45, 4, 13, 2, '#2a2a26');
      const on = !!o.powered, pulse = on ? 0.5 + 0.5 * Math.sin(o.now / 200) : 0;
      circ(g, x, y - 47, 5.4, on ? '#7fc8ff' : '#553'); if (on) circ(g, x, y - 47, 2.2, '#e6f6ff');
      if (on) { g.strokeStyle = 'rgba(127,200,255,' + (0.25 + 0.4 * pulse) + ')'; g.lineWidth = 2; g.beginPath(); g.arc(x, y - 47, 9 + pulse * 6, 0, 7); g.stroke(); }
    } else {
      const rif = t.type === 'rifle';
      rr(g, x + 3, y - 29.5, rif ? 31 : 21, rif ? 4.4 : 8, 2.4, '#2a2f36');
      if (rif) rr(g, x + 3, y - 29, 31, 1.6, 0.8, '#8a8a92');
      circ(g, x, y - 26, 2.6, '#ffb347');
    }
    if (t.lvl > 1) for (let i = 0; i < t.lvl - 1; i++) circ(g, x - 11 + i * 6, y - 14, 2, '#ffb347');
  }
  // fixed room props (positions are in room-floor coordinates, y = 0 at the floor)
  function roomProp(g, k, powered, now) {
    if (k === 'armory') {
      rr(g, 832, -58, 120, 6, 3, '#4a4a44'); rr(g, 832, -32, 120, 6, 3, '#4a4a44');
      for (let i = 0; i < 5; i++) { line(g, 842 + i * 22, -58, 842 + i * 22, -30, 4, '#8a8a92'); line(g, 842 + i * 22, -42, 842 + i * 22, -30, 4, '#4a3a22'); }
      rr(g, 850, -20, 80, 20, 5, '#5a4a32'); circ(g, 943, -67, 3, powered ? '#7fc8ff' : '#553');
    } else if (k === 'storage') {
      rr(g, 975, -62, 110, 6, 3, '#5a4a38'); rr(g, 975, -32, 110, 6, 3, '#5a4a38');
      for (let i = 0; i < 4; i++) { rr(g, 980 + i * 26, -50, 21, 18, 3, '#8a6a42'); rr(g, 980 + i * 26, -20, 21, 18, 3, '#7a5c38'); line(g, 982 + i * 26, -41, 999 + i * 26, -41, 1.2, 'rgba(0,0,0,.3)'); }
    } else if (k === 'generator') {
      rr(g, 1130, -46, 92, 46, 8, '#3d4650'); rr(g, 1130, -46, 92, 6, 3, 'rgba(255,255,255,.12)');
      rr(g, 1140, -60, 16, 15, 4, '#2a2a26');
      circ(g, 1166, -22, 12, '#2a3038'); circ(g, 1166, -22, 6, '#4d5560'); circ(g, 1166, -22, 2.4, '#ffb347');
      rr(g, 1190, -38, 22, 16, 3, '#2a3038');
      circ(g, 1200, -30, 3.4, powered ? ((Math.floor(now / 250) % 2) ? '#7fc8ff' : '#3a6a8a') : '#553');
    }
  }

  return {
    person, mara, drawModel, shade,
    hasEnemy(type) { return hasModel(type); },
    enemy(g, type, color, frame, flip, t) { drawModel(g, type, { color, frame, flip, t }); },
    item, door, wall, turret, roomProp, WEAR,
    // a held item model (g_pipe, g_rifle, g_meal ...), grip at x 0 / y -12, pointing right; flip mirrors it
    gear(g, id, flip) { drawModel(g, id, { flip }); },
    hasGear: (id) => typeof VEC_MODELS !== 'undefined' && !!VEC_MODELS[id],
    // on/off and rust strength (0 to 1.5); rebakes everything
    setWear(on, rust) { WEAR.on = !!on; WEAR.rust = rust == null ? 1 : rust; bakeCache.clear(); }
  };
})();
