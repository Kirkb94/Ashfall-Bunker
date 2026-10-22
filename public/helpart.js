/* helpart.js - tutorial illustrations drawn with the game's own vector models (VEC) so they match the art board.
   helpArt(key) returns an <img> tag (canvas data URL) or '' when VEC is missing. Called when the help screen opens. */
const helpArtCache = {};
function helpArt(key) {
  if (typeof VEC === 'undefined' || !VEC.person || !VEC.enemy) return '';
  if (helpArtCache[key]) return helpArtCache[key];
  const SC = 2.5, W = 480, H = 110, GY = 88;
  const cv = document.createElement('canvas'); cv.width = W * SC; cv.height = H * SC;
  const g = cv.getContext('2d'); g.scale(SC, SC);
  const FONT = '"Chakra Petch","IBM Plex Sans",sans-serif';
  const A = '#ffb347', R = '#ff5a4e', GRN = '#7ddc6f', BLU = '#7fc8ff', MUT = '#b8a78a';
  const col = t => (typeof ENEMIES !== 'undefined' && ENEMIES[t] ? ENEMIES[t].color : '#888');
  const at = (x, y, s, fn) => { g.save(); g.translate(x, y); g.scale(s, s); fn(); g.restore(); };
  const text = (t, x, y, size, color, align, w) => { g.font = (w || 700) + ' ' + size + 'px ' + FONT; g.fillStyle = color || MUT; g.textAlign = align || 'center'; g.fillText(t, x, y); };
  const ell = (x, y, rx, ry, c) => { g.fillStyle = c; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, 7); g.fill(); };
  const rect = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
  const person = (x, s, color, accent, gear, flip, y) => at(x, y == null ? GY : y, s, () => {
    VEC.person(g, color, accent, 0, !!flip);
    if (gear && VEC.hasGear(gear)) { g.save(); g.translate(flip ? -7 : 7, -8); VEC.gear(g, gear, !!flip); g.restore(); }
  });
  const foe = (type, x, s, flip, y) => at(x, y == null ? GY : y, s, () => VEC.enemy(g, type, col(type), 0, flip !== false, 0));
  const star = (x, y, r, c) => { g.fillStyle = c; g.beginPath(); for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8, rr = i % 2 ? r * 0.45 : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } g.closePath(); g.fill(); };
  const bolt = (x1, y1, x2, y2, c, w) => { g.strokeStyle = c; g.lineWidth = w || 1.6; g.lineJoin = 'round'; g.beginPath(); g.moveTo(x1, y1); const n = 6; for (let i = 1; i < n; i++) { const t = i / n; g.lineTo(x1 + (x2 - x1) * t + (i % 2 ? -3 : 3), y1 + (y2 - y1) * t + (i % 2 ? 3 : -3)); } g.lineTo(x2, y2); g.stroke(); };
  const tracer = (x1, y1, x2, y2, c) => { g.strokeStyle = c; g.lineWidth = 1.5; g.lineCap = 'round'; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 0.6; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); };
  const drops = (x, y, n) => { g.fillStyle = R; for (let i = 0; i < n; i++) { const dy = y + i * 7, dx = x + (i % 2 ? 2 : -2); g.beginPath(); g.moveTo(dx, dy - 3); g.quadraticCurveTo(dx + 2.6, dy + 1, dx, dy + 2.6); g.quadraticCurveTo(dx - 2.6, dy + 1, dx, dy - 3); g.fill(); } };
  const turret = (x, type, manned, lvl) => at(x, GY, 1.2, () => VEC.turret(g, 0, 0, { type, manned, lvl: lvl || 1 }, { powered: true, now: 1500 }));
  const keycap = (x, y, t, on) => { g.fillStyle = '#1a120a'; g.fillRect(x, y + 3, 24, 22); g.fillStyle = on ? A : '#3a2c18'; g.fillRect(x, y, 24, 22); g.fillStyle = on ? '#ffd27a' : '#4a3a22'; g.fillRect(x + 2, y + 2, 20, 18); text(t, x + 12, y + 16, 12, on ? '#1a0f02' : '#e6d6b8'); };
  const label = (t, x, y, c) => text(t, x, y, 8, c || MUT);

  // ---- backdrop: dusky surface with a ground band
  const sky = (a, b, night) => {
    const gr = g.createLinearGradient(0, 0, 0, GY); gr.addColorStop(0, a); gr.addColorStop(1, b); g.fillStyle = gr; g.fillRect(0, 0, W, GY);
    g.fillStyle = 'rgba(0,0,0,.25)'; for (let i = 0; i < 9; i++) { const bx = 20 + i * 55, bh = 14 + (i * 37) % 26; g.fillRect(bx, GY - bh, 16 + (i * 13) % 18, bh); }   // ruined skyline
    if (night) { g.fillStyle = 'rgba(255,255,255,.7)'; for (let i = 0; i < 24; i++) g.fillRect((i * 83) % W, (i * 47) % 40, 1, 1); }
  };
  const ground = () => {
    const gr = g.createLinearGradient(0, GY, 0, H); gr.addColorStop(0, '#4a3a28'); gr.addColorStop(1, '#241a10'); g.fillStyle = gr; g.fillRect(0, GY, W, H - GY);
    g.fillStyle = 'rgba(255,255,255,.07)'; g.fillRect(0, GY, W, 1);
  };
  const frame = () => { g.strokeStyle = '#4a3a22'; g.lineWidth = 1; g.strokeRect(0.5, 0.5, W - 1, H - 1); };
  const panel = (x, w) => { g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(x, 0, w, H); g.strokeStyle = 'rgba(255,179,71,.25)'; g.strokeRect(x + 0.5, 0.5, w - 1, H - 1); };

  const S = {
    'THE LOOP'() {
      sky('#b8743a', '#5a3a28'); g.fillStyle = 'rgba(8,10,28,.0)';
      const gn = g.createLinearGradient(240, 0, W, 0); gn.addColorStop(0, 'rgba(10,14,40,0)'); gn.addColorStop(0.6, 'rgba(10,14,40,.85)'); gn.addColorStop(1, 'rgba(6,8,26,.95)'); g.fillStyle = gn; g.fillRect(0, 0, W, GY);
      g.fillStyle = 'rgba(255,255,255,.7)'; for (let i = 0; i < 22; i++) g.fillRect(250 + (i * 71) % 220, (i * 43) % 44, 1, 1);
      ell(205, 26, 12, 12, '#ffd27a'); ell(205, 26, 19, 19, 'rgba(255,200,100,.22)');
      ell(432, 24, 11, 11, '#dfe6f4'); ell(437, 21, 10, 10, '#101636');
      ground();
      at(8, GY, 1, () => VEC.wall(g, 0, 0, 60, 1)); turret(44, 'rifle', true);
      person(110, 1.3, '#c98a4a', '#ffb347', 'g_rifle'); tracer(130, 64, 236, 72, '#ffe08a');
      foe('hound', 252, 1.05); foe('raider', 322, 1.1); foe('brute', 390, 1.1); foe('raider', 448, 1.0);
      text('NIGHT RAID', 440, 70, 8, '#f1e6d2');
      g.strokeStyle = 'rgba(255,255,255,.35)'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(16, 8); g.lineTo(72, 8); g.moveTo(208, 8); g.lineTo(236, 8); g.moveTo(290, 8); g.lineTo(396, 8); g.stroke(); g.setLineDash([]);
      text('WORK, BUILD, SCAVENGE', 140, 12, 8, '#ffe0a8'); text('HOLD THE DOOR', 343, 12, 8, '#cfd6e6');
    },
    'THE CREW'() {
      sky('#6a4a30', '#3a2a1c'); ground();
      const crew = [['TURRET', '#c98a4a', '#ffb347', 'g_rifle'], ['DOOR GUARD', '#4f8fd0', '#7fc8ff', 'g_pistol'], ['COOK', '#6fae5a', '#b6e6a0', 'g_meal'], ['MEDIC', '#e8e2d2', '#ff5a4e', null]];
      crew.forEach((c, i) => { const x = 70 + i * 113; person(x, 1.8, c[1], c[2], c[3]); g.fillStyle = 'rgba(14,10,6,.85)'; g.fillRect(x - 33, 96, 66, 11); g.strokeStyle = c[2]; g.strokeRect(x - 32.5, 96.5, 65, 10); text(c[0], x, 104.5, 7.5, '#f1e6d2'); });
      // job badge above each head
      crew.forEach((c, i) => { const x = 70 + i * 113; g.fillStyle = '#1a120a'; g.fillRect(x - 7, 14, 14, 14); g.strokeStyle = c[2]; g.strokeRect(x - 6.5, 14.5, 13, 13); g.fillStyle = c[2]; g.fillRect(x - 3, 18, 6, 6); });
      // hunger and sleep hints
      text('z z', 24, 24, 9, '#cfd6e6'); text('MEAL', 456, 24, 8, GRN);
    },
    'CONTROLS'() {
      sky('#5a3e2a', '#2e2016'); ground();
      // the shaft ladder and Mara
      rect(20, 18, 4, 70, '#6a5a44'); rect(46, 18, 4, 70, '#6a5a44'); for (let y = 24; y < 88; y += 8) rect(24, y, 22, 2, '#8a7a60');
      at(86, GY, 1.7, () => VEC.mara(g, 0, false)); at(86, GY, 1.7, () => { g.save(); g.translate(7, -8); VEC.gear(g, 'g_pistol', false); g.restore(); });
      // WASD
      keycap(150, 12, 'W', true); keycap(122, 40, 'A', true); keycap(150, 40, 'S', true); keycap(178, 40, 'D', true);
      text('MOVE · CLIMB', 164, 82, 7.5, MUT); text('JUMP', 252, 82, 7.5, MUT);
      g.fillStyle = '#1a120a'; g.fillRect(222, 42, 62, 22); g.fillStyle = '#3a2c18'; g.fillRect(222, 39, 62, 22); text('SPACE', 253, 54, 9, '#e6d6b8');
      // mouse
      g.fillStyle = '#1a120a'; g.beginPath(); g.ellipse(344, 52, 17, 26, 0, 0, 7); g.fill(); g.fillStyle = '#3a2c18'; g.beginPath(); g.ellipse(344, 50, 17, 26, 0, 0, 7); g.fill();
      g.fillStyle = A; g.beginPath(); g.moveTo(344, 24); g.lineTo(344, 44); g.lineTo(327.5, 44); g.quadraticCurveTo(328, 28, 344, 24); g.fill(); g.strokeStyle = '#1a120a'; g.beginPath(); g.moveTo(344, 24); g.lineTo(344, 44); g.moveTo(327, 44); g.lineTo(361, 44); g.stroke();
      text('CLICK', 344, 88, 7.5, MUT);
      // target
      foe('hound', 436, 1.4); g.strokeStyle = R; g.lineWidth = 1.2; g.beginPath(); g.arc(436, 70, 13, 0, 7); g.moveTo(420, 70); g.lineTo(452, 70); g.moveTo(436, 54); g.lineTo(436, 86); g.stroke();
      tracer(372, 56, 420, 68, '#ffd27a');
    },
    'DAMAGE TYPES'() {
      sky('#4a3626', '#2a1e14'); ground();
      const W4 = 120;
      for (let i = 0; i < 4; i++) panel(i * W4, W4);
      // pierce: rifle shot punching through a brute
      person(22, 1.35, '#c98a4a', '#ffb347', 'g_rifle'); foe('brute', 96, 1.15); tracer(36, 62, 96, 56, '#ffe08a'); g.fillStyle = '#ffe08a'; g.fillRect(106, 53, 8, 1.4); star(94, 56, 6, 'rgba(255,224,138,.9)');
      label('PIERCE', 60, 104, A);
      // blunt: pipe smash on a hound
      person(138, 1.35, '#6fae5a', '#b6e6a0', 'g_pipe'); foe('hound', 205, 1.5); star(188, 66, 11, 'rgba(255,255,255,.85)'); star(188, 66, 6, '#ffd27a'); g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = 1; g.beginPath(); g.arc(156, 64, 11, -1.1, 0.7); g.stroke();
      label('BLUNT', 180, 104, '#d8cfbf');
      // shock: coil arcs onto a raider
      turret(270, 'coil', true); foe('raider', 335, 1.2); bolt(274, 38, 334, 58, '#e6f6ff', 1.8); bolt(274, 38, 334, 58, BLU, 1); ell(335, 58, 12, 20, 'rgba(127,200,255,.18)');
      label('SHOCK', 300, 104, BLU);
      // bleed: a cut ghoul dripping
      foe('ghoul', 420, 1.3); drops(414, 54, 3); drops(430, 66, 2); g.strokeStyle = R; g.lineWidth = 1.5; g.beginPath(); g.moveTo(407, 50); g.lineTo(424, 62); g.stroke();
      label('BLEED', 420, 104, R);
    },
    'WHO TAKES WHAT'() {
      sky('#4a3626', '#2a1e14'); ground();
      const L = [['hound', 'HOUND', 36, 1.2], ['ghoul', 'GHOUL', 94, 1.2], ['raider', 'RAIDER', 150, 1.2], ['brute', 'BRUTE', 214, 1.15], ['cinder', 'CINDER', 282, 1.1], ['maw', 'MAW', 440, 1.1]];
      L.forEach(([t, n, x, s]) => { foe(t, x, s); label(n, x, 103, '#e6d6b8'); });
      // pike's ram rig, built from plates like the in-game version
      at(356, GY, 0.9, () => { rect(-36, -26, 72, 18, '#6a4a3a'); rect(-26, -40, 30, 14, '#4a3a30'); rect(30, -22, 20, 6, '#3a2e24'); rect(-32, -22, 64, 3, 'rgba(255,255,255,.12)'); ell(-22, -4, 8, 8, '#1a120a'); ell(20, -4, 8, 8, '#1a120a'); ell(-22, -4, 3, 3, '#6a5a44'); ell(20, -4, 3, 3, '#6a5a44'); });
      label('RAM RIG', 356, 103, '#e6d6b8');
      // tiny weakness markers
      g.font = '700 7px ' + FONT; g.textAlign = 'center';
      text('+BLUNT', 36, 56, 7, GRN); text('-BLEED', 94, 52, 7, R); text('FLEES', 150, 50, 7, A); text('-PIERCE', 214, 40, 7, R); text('+BLUNT', 214, 32, 7, GRN); text('+SHOCK', 282, 40, 7, BLU); text('-PIERCE', 356, 36, 7, R); text('+SHOCK', 356, 28, 7, BLU); text('-BLEED', 440, 40, 7, R);
    },
    'CRITS AND STATUS'() {
      sky('#4a3626', '#2a1e14'); ground();
      // a crit on a raider
      person(40, 1.5, '#c98a4a', '#ffb347', 'g_rifle'); foe('raider', 168, 1.5); tracer(60, 60, 166, 54, '#ffe08a'); star(166, 52, 15, 'rgba(255,200,80,.9)'); star(166, 52, 8, '#fff6d8');
      text('CRIT!', 196, 28, 13, A); text('-43', 196, 44, 11, '#fff');
      drops(180, 66, 3);
      // a stunned hound
      foe('hound', 330, 1.7); const cx = 330, cy = 56; for (let i = 0; i < 3; i++) { const a = i * 2.1 + 0.4; star(cx + Math.cos(a) * 16, cy - 8 + Math.sin(a) * 5, 4, '#ffd24a'); }
      text('STUNNED', 330, 100, 8, '#ffd24a'); text('BLEEDING', 190, 100, 8, R);
      // a fleeing raider
      foe('raider', 438, 1.3, false); text('RUNS OFF', 438, 100, 8, A); g.strokeStyle = 'rgba(255,255,255,.4)'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(410, 28); g.lineTo(470, 28); g.stroke(); g.setLineDash([]);
    },
    'TURRETS'() {
      sky('#4a3626', '#2a1e14'); ground();
      turret(60, 'rifle', true); turret(160, 'shotgun', true); turret(260, 'coil', true);
      tracer(86, 60, 130, 60, '#ffe08a');
      label('RIFLE', 60, 104, '#e6d6b8'); label('SHOTGUN', 160, 104, '#e6d6b8'); label('COIL', 260, 104, BLU);
      // magazine and heat card
      g.fillStyle = 'rgba(14,10,6,.9)'; g.fillRect(318, 8, 150, 94); g.strokeStyle = '#4a3a22'; g.strokeRect(318.5, 8.5, 149, 93);
      text('TURRET 1', 326, 22, 8.5, '#f1e6d2', 'left'); text('7/10', 462, 22, 8.5, A, 'right');
      for (let i = 0; i < 10; i++) rect(326 + i * 13, 28, 9, 9, i < 7 ? A : '#2d2215');
      rect(326, 44, 134, 6, '#2d2215'); rect(326, 44, 86, 6, '#ff8c2a'); text('HEAT', 326, 60, 7, MUT, 'left'); text('OVERHEAT AT 100%', 460, 60, 7, R, 'right');
      rect(326, 66, 134, 6, '#2d2215'); rect(326, 66, 112, 6, GRN); text('CONDITION', 326, 80, 7, MUT, 'left');
      g.fillStyle = A; g.fillRect(326, 85, 134, 13); text('TARGET: NEAREST', 393, 94.5, 8, '#1a0f02');
    },
    'CREW AND ARMS'() {
      sky('#4a3626', '#2a1e14'); ground();
      const L = [['PIPE', 'g_pipe', '#6fae5a', '#b6e6a0'], ['MACHETE', 'g_machete', '#c98a4a', '#ffb347'], ['PISTOL', 'g_pistol', '#4f8fd0', '#7fc8ff'], ['SMG', 'g_smg', '#b06a9a', '#e6b0d6'], ['SHOTGUN', 'g_shotgun', '#c9a04a', '#ffd27a'], ['RIFLE', 'g_rifle', '#e8e2d2', '#ff5a4e']];
      L.forEach(([n, gear, c, ac], i) => { const x = 40 + i * 80; person(x, 1.6, c, ac, gear); label(n, x, 104, '#e6d6b8'); });
      // cover bonus note
      g.strokeStyle = GRN; g.setLineDash([2, 2]); g.strokeRect(2.5, 8.5, 475, 74); g.setLineDash([]);
    },
  };
  const draw = S[key]; if (!draw) return '';
  try { draw(); frame(); } catch (e) { return ''; }
  return (helpArtCache[key] = '<img class="hpic" alt="" src="' + cv.toDataURL('image/png') + '" style="display:block;width:100%;height:auto;margin:6px 0 8px;border:1px solid #3a2c18;image-rendering:auto">');
}
