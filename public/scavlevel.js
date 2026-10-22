// Scav level tile parser. Works as a browser global (window.ScavLevel) and as a CommonJS module.
//   level: { tile: 48, rows: ['....', '.==.', '####'], len?: number }
//   '=' one-way platform tile (land from above, jump up through, hold down to drop)
//   '#' solid tile (returned in `solids`; collision for these is handled elsewhere)
//   'H' ladder tile (vertical runs become `ladders`: { x: centre, y0: top, y1: bottom }; leave a gap in a '=' row so y0 meets the platform surface)
// Returns { len, plats: [{ x, y, w }], solids: [{ x, y, w, h }] }. y is the TOP edge of the tile row.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ScavLevel = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  function runs(row, ch) {
    const out = [];
    let start = -1;
    for (let i = 0; i <= row.length; i++) {
      const on = i < row.length && row[i] === ch;
      if (on && start < 0) start = i;
      else if (!on && start >= 0) { out.push([start, i - start]); start = -1; }
    }
    return out;
  }

  function parse(level) {
    if (!level || !Array.isArray(level.rows)) throw new Error('ScavLevel: rows[] required');
    const T = level.tile > 0 ? level.tile : 48;
    const plats = [], solids = [];
    let maxCols = 0;
    level.rows.forEach((row, r) => {
      const s = String(row);
      if (s.length > maxCols) maxCols = s.length;
      for (const [c, n] of runs(s, '=')) plats.push({ x: c * T, y: r * T, w: n * T });
      for (const [c, n] of runs(s, '#')) solids.push({ x: c * T, y: r * T, w: n * T, h: T });
    });
    // 'H' ladder tiles: one ladder per vertical run in a column. y0 = top of first tile, y1 = bottom of last.
    const ladders = [];
    for (let col = 0; col < maxCols; col++) {
      let start = -1;
      for (let r = 0; r <= level.rows.length; r++) {
        const on = r < level.rows.length && String(level.rows[r])[col] === 'H';
        if (on && start < 0) start = r;
        else if (!on && start >= 0) { ladders.push({ x: col * T + T / 2, y0: start * T, y1: r * T }); start = -1; }
      }
    }
    return { len: level.len || maxCols * T, plats, solids, ladders };
  }

  return { parse };
});
