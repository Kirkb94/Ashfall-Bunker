// Central tuning numbers. Values here match the previous hard-coded defaults.
// Dev only (localhost or ?dev): override with URL params, e.g. ?dev&t.raid.base=2&t.burrower.digTime=6
(function (root) {
  const TUNING = {
    raid: { base: 3, perDay: 1.25, cap: 20, cinderEscort: 3, enemyHpPerDay: 0.08 },
    burrower: { digTime: 4, stopPx: 140 },
    roomFx: { powerBoost: 1.25, fuelPerHour: 0.25, armoryDmg: 1.2, storageTheft: 0.1, storageLoot: 1.1 },
    playtest: { notes: [] }
  };
  try {
    const loc = root.location;
    const dev = loc && (loc.hostname === 'localhost' || loc.hostname === '127.0.0.1' || /[?&]dev(=|&|$)/.test(loc.search));
    if (dev) {
      new URLSearchParams(loc.search).forEach(function (val, key) {
        if (key.indexOf('t.') !== 0) return;
        const path = key.slice(2).split('.');
        let o = TUNING;
        for (let i = 0; i < path.length - 1; i++) { o = o && o[path[i]]; }
        const last = path[path.length - 1], n = Number(val);
        if (o && typeof o[last] === 'number' && isFinite(n)) o[last] = n;
      });
    }
  } catch (e) { /* ignore */ }
  root.TUNING = TUNING;
  if (typeof module !== 'undefined' && module.exports) module.exports = TUNING;
})(typeof window !== 'undefined' ? window : globalThis);
