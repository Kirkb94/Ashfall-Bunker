// Pixel-art sprites defined as character grids, baked once to small canvases and drawn at 2x with no smoothing.
// All sprites face right; callers flip for left. Origin = bottom centre (feet).
const SPR = (function () {
  const SCALE = 2;
  const cache = {};
  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const c = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
    const r = c((n >> 16) & 255), gg = c((n >> 8) & 255), b = c(n & 255);
    return '#' + ((1 << 24) | (r << 16) | (gg << 8) | b).toString(16).slice(1);
  }
  function legRows(def, frame) {
    const pat = def.legs[frame], rows = [];
    for (let i = 0; i < def.legN; i++) rows.push(i === def.legN - 1 ? pat.replace(/L/g, 'K') : pat);
    return rows;
  }
  function bake(def, frame, pal, key) {
    if (cache[key]) return cache[key];
    const rows = def.top.concat(legRows(def, frame));
    const w = rows[0].length, h = rows.length;
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const c = cv.getContext('2d');
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const ch = rows[y][x];
      if (ch === '.' || !pal[ch]) continue;
      c.fillStyle = pal[ch]; c.fillRect(x, y, 1, 1);
    }
    return (cache[key] = cv);
  }
  function blit(ctx, cv, flip) {
    const w = cv.width * SCALE, h = cv.height * SCALE;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    if (flip) ctx.scale(-1, 1);
    ctx.drawImage(cv, -w / 2, -h, w, h);
    ctx.restore();
  }

  const PERSON = {
    name: 'person', legN: 6,
    top: [
      '...HHHH...',
      '..HHHHHH..',
      '..HSSSSS..',
      '..HSSSES..',
      '...SSSSs..',
      '....ss....',
      '..BBBBBB..',
      '.sBBBBBBs.',
      '.SBbBBbBS.',
      '.SBBBBBBS.',
      '..BBBBBB..',
      '..bbbbbb..'
    ],
    legs: { 0: '..LL..LL..', 1: '.LL...LL..', 2: '...LLLL...' }
  };
  const MARA = {
    name: 'mara', legN: 7,
    top: [
      '...DDDDDD...',
      '..GGGGGGGG..',
      '..DGGSGGSD..',
      '..DSSSSSSD..',
      '...SSSSSS...',
      '....SSSS....',
      '..JJJJJJJJ..',
      '.JJJJJJJJJJ.',
      '.SJJjJJjJJS.',
      '.SJJJJJJJJS.',
      '..JJJJJJJJ..',
      '..bbbbbbbb..',
      '..LLLLLLLL..'
    ],
    legs: { 0: '..LLL..LLL..', 1: '.LLL....LLL.', 2: '...LLLLLL...' }
  };
  const HOUND = {
    name: 'hound', legN: 3,
    top: [
      '..........HH.',
      '.BBBBBBB.HHHH',
      'BBBBBBBBBHHEH',
      'BBBBBBBBBBHHH',
      'bBBBBBBBBB.HH',
      '.bbbbbbbbb...'
    ],
    legs: { 0: 'LL.LL...LL.LL', 1: '.LL.LL.LL.LL.', 2: 'LL..LL.LL..LL' }
  };
  const GHOUL = {
    name: 'ghoul', legN: 4,
    top: [
      '...GGGG...',
      '..GGGGGG..',
      '..GEGGEG..',
      '..GGGGGG..',
      '...GmmG...',
      '..BBBBBB..',
      '.BBbBBbBB.',
      'GBBBBBBBBG',
      'G.BBbBBB.G',
      'G.BBBBBB.G',
      'G..bbbb..G'
    ],
    legs: { 0: '...LL.LL..', 1: '..LL...LL.', 2: '.LL...LL..' }
  };
  const RAIDER = {
    name: 'raider', legN: 4,
    top: [
      '....RR....',
      '...RRRR...',
      '..SSSSSS..',
      '..SSSSES..',
      '..MMMMMM..',
      '..BBBBBB..',
      '.BbBBBBBB.',
      '.SBbBBBBS.',
      '.SBBbBBBS.',
      '..BBBbBB..',
      '..kkkkkk..'
    ],
    legs: { 0: '..LL..LL..', 1: '.LL...LL..', 2: '...LLLL...' }
  };
  const CINDER = {
    name: 'cinder', legN: 4,
    top: [
      '...WWWWWW...',
      '..WWWWWWWW..',
      '..WSSSSSSW..',
      '..WSRSSRSW..',
      '...SSMMSS...',
      '....SSSS....',
      '..CCCCCCCC..',
      '.CCCCCCCCCC.',
      '.CCbCCCCbCC.',
      '.SCCCCCCCCS.',
      '.SCCCCCCCCS.',
      '..CCCCCCCC..',
      '..bbbbbbbb..',
      '..CCCCCCCC..'
    ],
    legs: { 0: '...LL..LL...', 1: '..LL....LL..', 2: '....LLLL....' }
  };
  const BRUTE = {
    name: 'brute', legN: 5,
    top: [
      '...HHHHHHH...',
      '...HHHHHHH...',
      '...HEHHHEH...',
      '...HHhhhHH...',
      '....HHHHH....',
      'SSBBBBBBBBBSS',
      'SSBBBBBBBBBSS',
      'SSBBbBBBbBBSS',
      'SSBBBBBBBBBSS',
      'SSBBBBBBBBBSS',
      '.SSBBBBBBBSS.',
      '..bbbbbbbbb..',
      '...BBBBBBB...',
      '...BBBBBBB...',
      '...BBBBBBB...'
    ],
    legs: { 0: '...LLL.LLL...', 1: '..LLL...LLL..', 2: '....LLLLL....' }
  };
  const ENEMY_DEFS = { hound: HOUND, ghoul: GHOUL, raider: RAIDER, cinder: CINDER, brute: BRUTE };

  function enemyPal(type, color) {
    const base = { L: '#2a2018', K: '#16100a', E: '#1a1a10' };
    if (type === 'hound') return Object.assign(base, { B: color, b: shade(color, 0.7), H: shade(color, 0.85), E: '#ff4030', L: '#3a2818', K: '#241810' });
    if (type === 'ghoul') return Object.assign(base, { G: '#a9ae88', B: color, b: shade(color, 0.7), m: '#3a2a22', L: '#3a3a30', K: '#22221c' });
    if (type === 'raider') return Object.assign(base, { R: '#c03a2a', S: '#d8b89a', E: '#222222', M: '#2a2a2a', B: color, b: '#5a3020', k: '#2a2018' });
    if (type === 'cinder') return Object.assign(base, { W: '#f4f4ee', S: '#b9a898', R: '#cc2222', M: '#7a3a22', C: color, b: '#7a3a22', L: '#3a2a22', K: '#1c1410' });
    if (type === 'brute') return Object.assign(base, { H: shade(color, 1.3), h: shade(color, 0.8), E: '#ff4030', S: shade(color, 1.15), B: color, b: shade(color, 0.7), L: '#2a2030', K: '#18101e' });
    return base;
  }

  return {
    // crew / wanderer: shirt colour + hair colour
    person(ctx, color, accent, frame, flip) {
      const key = 'p|' + color + '|' + accent + '|' + frame;
      const pal = { H: accent || '#2b1d12', S: '#e2c29a', s: '#c9a77e', E: '#222222', B: color, b: shade(color, 0.7), L: '#2a2018', K: '#16100a' };
      blit(ctx, bake(PERSON, frame, pal, key), flip);
    },
    mara(ctx, frame, flip) {
      const pal = { D: '#2b1d12', G: '#ffb347', S: '#e2c29a', J: '#7a5a3a', j: '#5a4028', b: '#3a2a1a', L: '#2a2018', K: '#16100a' };
      blit(ctx, bake(MARA, frame, pal, 'mara|' + frame), flip);
    },
    hasEnemy(type) { return !!ENEMY_DEFS[type]; },
    enemy(ctx, type, color, frame, flip) {
      const def = ENEMY_DEFS[type];
      blit(ctx, bake(def, frame, enemyPal(type, color), 'e|' + type + '|' + color + '|' + frame), flip);
    }
  };
})();
