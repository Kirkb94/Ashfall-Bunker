// Ashfall Bunker: small cosmetic life, in the same spirit as the bunker drips.
// Everything is driven by the clock (no state, nothing saved, nothing to cap) and never touches gameplay.
// Off with Low effects and with reduced motion. Heat lightning is also off in photosensitive mode.
window.AMB = (() => {
  const fr = v => v - Math.floor(v);
  const hsh = (a, b) => fr(Math.sin(a * 127.1 + b * 311.7) * 43758.5453);
  const now = () => performance.now() / 1000;
  const off = () => prefs.le || prefs.rm;

  // ---- sky critters (strip coordinates: ground at SC_GROUND; the bunker view shows strip y 420..620)
  function crow(x, y, s, flap, col) {
    const w = 6 * s, up = flap * 3.2 * s;
    g.strokeStyle = col; g.lineWidth = Math.max(1, 1.3 * s); g.lineCap = 'round';
    g.beginPath(); g.moveTo(x - w, y - up);
    g.quadraticCurveTo(x - w * 0.4, y - up * 0.25 - s, x, y);
    g.quadraticCurveTo(x + w * 0.4, y - up * 0.25 - s, x + w, y - up); g.stroke();
    g.fillStyle = col; g.fillRect(x - 0.8 * s, y - 0.6 * s, 1.6 * s, 1.4 * s);
  }
  function bat(x, y, s, fl, col) {
    const w = 5 * s, u = fl * 3 * s;
    g.fillStyle = col; g.beginPath(); g.moveTo(x, y - s);
    g.lineTo(x - w * 0.5, y - u - s); g.lineTo(x - w, y - u * 0.5); g.lineTo(x - w * 0.7, y + s * 0.6); g.lineTo(x - w * 0.35, y);
    g.lineTo(x, y + 1.6 * s);
    g.lineTo(x + w * 0.35, y); g.lineTo(x + w * 0.7, y + s * 0.6); g.lineTo(x + w, y - u * 0.5); g.lineTo(x + w * 0.5, y - u - s);
    g.closePath(); g.fill();
  }
  // a few lanes, each with an occasional crossing: a crow or a small flock by day, a bat or two at night
  function sky(sky) {
    if (off()) return;
    const t = now(), night = sky.dayAmt < 0.35;
    for (let lane = 0; lane < 3; lane++) {
      const per = 24 + lane * 9, tt = t + lane * 13, c = Math.floor(tt / per), u = tt - c * per;
      if (hsh(c, lane + 5) > (night ? 0.5 : 0.62)) continue;            // most slots stay empty
      const far = hsh(c, lane + 2), s = 0.85 + 0.6 * (1 - far);             // farther ones are smaller and slower
      const dur = (night ? 10 : 15) * (1 + far * 0.8);
      if (u > dur) continue;
      const p = u / dur, dir = hsh(c, lane + 9) < 0.5 ? 1 : -1;
      const x0 = dir > 0 ? -60 + p * (W + 120) : W + 60 - p * (W + 120);
      const y0 = SC_GROUND - 75 - hsh(c, lane + 4) * 110;
      const n = night ? (hsh(c, lane + 7) < 0.3 ? 2 : 1) : 1 + Math.floor(hsh(c, lane + 7) * 4);
      for (let k = 0; k < n; k++) {
        const jx = (hsh(c * 3 + k, lane) - 0.5) * 8, jy = (hsh(c * 5 + k, lane) - 0.5) * 6;
        if (night) {
          // bats: jittery, swooping flight with fast wingbeats
          const x = x0 - dir * k * 18 * s + Math.sin(t * 3.1 + k * 2) * 10 + jx;
          const y = y0 + Math.sin(t * 2.3 + k) * 9 + Math.sin(t * 5.7 + k * 3) * 3 + jy;
          bat(x, y, s * 0.85, Math.sin(t * 22 + k * 1.7), 'rgba(98,86,108,0.9)');
        } else {
          // crows: a loose V, beating then gliding
          const x = x0 - dir * k * 15 * s + jx, y = y0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 5 * s + jy + Math.sin(t * 0.7 + k) * 2;
          const glide = Math.sin(t * 0.9 + k * 1.3 + c) > -0.2 ? 1 : 0.15;
          crow(x, y, s, Math.sin(t * 7.5 + k * 1.9) * glide, 'rgba(34,24,22,0.78)');
        }
      }
    }
  }
  // faint heat lightning behind the far ridges at night: a double flicker every so often
  function horizon(sky) {
    if (off() || prefs.ps || prefs.hc || sky.dayAmt > 0.3) return;
    const t = now(), per = 21, c = Math.floor(t / per), u = t - c * per;
    if (u > 0.5 || hsh(c, 31) > 0.4) return;
    const a = Math.max(0, Math.sin(u / 0.5 * Math.PI)) * (u > 0.12 && u < 0.2 ? 0.35 : 1) * (1 - sky.dayAmt / 0.3);
    const x = 120 + hsh(c, 32) * (W - 240), y = SC_GROUND - 170;
    const gr = g.createRadialGradient(x, y, 10, x, y, 300);
    gr.addColorStop(0, 'rgba(190,200,255,' + (0.16 * a).toFixed(3) + ')'); gr.addColorStop(1, 'rgba(190,200,255,0)');
    g.fillStyle = gr; g.fillRect(x - 300, y - 300, 600, 600);
  }
  // a scrap of paper blown along the ground (the wind carries the ash west, so it goes the same way)
  function litter() {
    if (off()) return;
    const t = now();
    for (let lane = 0; lane < 2; lane++) {
      const per = 17 + lane * 8, tt = t + lane * 7, c = Math.floor(tt / per), u = tt - c * per, dur = 7 + hsh(c, lane + 40) * 3;
      if (u > dur || hsh(c, lane + 41) > 0.55) continue;
      const p = u / dur, x = W + 30 - p * (W + 60);
      const hop = Math.abs(Math.sin(p * Math.PI * (5 + lane))) * (9 - p * 4), y = SC_GROUND - 2 - hop;
      g.save(); g.translate(x, y); g.rotate(t * (4 + lane * 2)); g.scale(1, 0.4 + 0.6 * Math.abs(Math.sin(t * 6 + lane)));
      g.fillStyle = lane ? 'rgba(170,150,120,0.8)' : 'rgba(205,195,172,0.8)'; g.fillRect(-3, -2, 6, 4);
      g.restore();
    }
  }

  // ---- bunker interior (bunker coordinates)
  function rat(x, y, dir, run) {
    g.save(); g.translate(x, y); g.scale(dir, 1);
    g.fillStyle = '#241b15';
    g.beginPath(); g.ellipse(0, -2.2, 4.2, 2.2, 0, 0, 7); g.fill();                 // body
    g.beginPath(); g.ellipse(4.4, -2.4, 2, 1.5, 0, 0, 7); g.fill();                 // head
    g.fillRect(5.6, -4.4, 1.2, 1.2);                                             // ear
    g.strokeStyle = '#3a2c22'; g.lineWidth = 0.9;
    g.beginPath(); g.moveTo(-4, -2); g.quadraticCurveTo(-8, -1 + Math.sin(run * 0.7) * 1.5, -11, -3); g.stroke();   // tail
    const l = Math.sin(run) * 1.4;                                               // legs
    g.beginPath(); g.moveTo(-2, -0.5); g.lineTo(-2 - l, 0.6); g.moveTo(2, -0.5); g.lineTo(2 + l, 0.6); g.stroke();
    g.restore();
  }
  function cobweb(cx, cy, sx, t, seed) {
    const sway = Math.sin(t * 0.6 + seed) * 0.8, L = 15 + hsh(seed, 3) * 6;
    g.strokeStyle = 'rgba(210,205,195,0.13)'; g.lineWidth = 0.7;
    const ang = k => (k / 4) * (Math.PI / 2);
    g.beginPath();
    for (let k = 0; k <= 4; k++) { const a = ang(k); g.moveTo(cx, cy); g.lineTo(cx + sx * Math.cos(a) * L, cy + Math.sin(a) * L + sway * k / 4); }
    for (let r = 1; r <= 3; r++) {
      const R = L * r / 3.4;
      for (let k = 0; k < 4; k++) {
        const a0 = ang(k), a1 = ang(k + 1), mx = Math.cos((a0 + a1) / 2) * R * 0.82, my = Math.sin((a0 + a1) / 2) * R * 0.82;
        g.moveTo(cx + sx * Math.cos(a0) * R, cy + Math.sin(a0) * R + sway * k / 4);
        g.quadraticCurveTo(cx + sx * mx, cy + my + sway, cx + sx * Math.cos(a1) * R, cy + Math.sin(a1) * R + sway * (k + 1) / 4);
      }
    }
    g.stroke();
  }
  function bunker() {
    if (off()) return;
    const t = now();
    for (const [k, r] of Object.entries(ROOMS)) {
      if (r.build) continue;
      const y0 = FLOORS[r.floor - 1] + (r.floor === 1 ? 16 : 10), y1 = FLOORS[r.floor], sd = r.x0 * 0.013 + r.floor * 3.1;
      // cobweb in one upper corner of some rooms
      if (hsh(sd, 1) < 0.6) { const left = hsh(sd, 2) < 0.5; cobweb(left ? r.x0 + 3 : r.x1 - 3, y0 + 1, left ? 1 : -1, t, sd); }
      // moths circling the ceiling lamp
      const lx = (r.x0 + r.x1) / 2, ly = y0 + 12, nm = hsh(sd, 4) < 0.65 ? 1 + (hsh(sd, 5) < 0.4 ? 1 : 0) : 0;
      for (let i = 0; i < nm; i++) {
        const sp = 1.6 + i * 0.7 + hsh(sd, 6 + i), ph = sd * 3 + i * 2.4;
        const mx = lx + Math.sin(t * sp + ph) * (12 + i * 6) + Math.sin(t * 5.3 + ph) * 2;
        const my = ly + Math.cos(t * sp * 1.3 + ph) * 6 + Math.sin(t * 7.1 + ph) * 1.5 + i * 4;
        const w = Math.abs(Math.sin(t * 28 + i * 3));
        g.fillStyle = 'rgba(232,214,170,0.75)'; g.fillRect(mx - 0.6, my - 0.6, 1.2, 1.4);
        g.fillStyle = 'rgba(232,214,170,' + (0.35 + 0.3 * w).toFixed(2) + ')';
        g.fillRect(mx - 1.8 * w - 0.6, my - 0.8, 1.6 * w + 0.4, 1.1); g.fillRect(mx + 0.6, my - 0.8, 1.6 * w + 0.4, 1.1);
      }
      // now and then a rat darts along the floor, stopping once to sniff
      const per = 38 + hsh(sd, 8) * 25, tt = t + sd * 9, c = Math.floor(tt / per), u = tt - c * per, dur = 5;
      if (u < dur && hsh(c, sd) < 0.35) {
        const dir = hsh(c, sd + 1) < 0.5 ? 1 : -1, p = u / dur;
        const q = p < 0.4 ? p / 0.4 * 0.5 : p < 0.6 ? 0.5 : 0.5 + (p - 0.6) / 0.4 * 0.5;   // run, pause, run
        const span = r.x1 - r.x0 - 20, x = dir > 0 ? r.x0 + 10 + q * span : r.x1 - 10 - q * span;
        const moving = p < 0.4 || p >= 0.6;
        rat(x, y1, dir, moving ? t * 40 : 0);
      }
    }
  }
  return { sky, horizon, litter, bunker };
})();
