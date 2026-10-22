// Narrator (Lamp) voice playback.
// narrPick(ev) -> clip path (random take, no immediate repeat) or null if unknown/cooling down.
// narrPlay(clip) -> plays through one shared Audio element (no overlap).
(function () {
  const DIR = 'audio/narrator/';
  // event -> [file base name, number of takes]
  const TAKES = {
    match_start: ['vo_match_start', 2],
    new_day: ['vo_new_day', 2],
    raid_warn: ['vo_raid_warn', 2],
    wave_start: ['vo_wave_start', 2],
    wave_stronger: ['vo_wave_stronger', 2],
    wave_clear: ['vo_wave_clear', 2],
    probe: ['vo_probe', 2],
    boss_warn: ['vo_boss_warn', 2],
    boss_arrive: ['vo_boss_arrive', 2],
    boss_down: ['vo_boss_down', 2],
    door_attack: ['vo_door_attack', 2],
    door_low: ['vo_door_low', 2],
    door_breach: ['vo_door_breach', 2],
    door_repair: ['vo_door_repair', 2],
    wall_down: ['vo_wall_down', 2],
    turret_lost: ['vo_turret_lost', 2],
    power_out: ['vo_power_out', 2],
    power_back: ['vo_power_back', 2],
    topside_exit: ['vo_topside_exit', 2],
    topside_return: ['vo_topside_return', 2],
    topside_danger: ['vo_topside_danger', 2],
    survivor_lost: ['vo_survivor_lost', 2],
    survivor_lost_many: ['vo_survivor_lost_many', 2],
    survivor_down: ['vo_survivor_down', 2],
    survivor_revive: ['vo_survivor_revive', 2],
    hungry: ['vo_hungry', 2],
    newcomer: ['vo_newcomer', 2],
    deserter: ['vo_deserter', 2],
    exit_build_start: ['vo_exit_build_start', 2],
    exit_half: ['vo_exit_half', 2],
    exit_almost: ['vo_exit_almost', 2],
    exit_resources: ['vo_exit_resources', 2],
    victory: ['vo_victory', 2],
    defeat: ['vo_defeat', 2],
    pop_50: ['vo_pop_50', 2],
    pop_10: ['vo_pop_10', 2],
    pop_3: ['vo_pop_03', 2]
  };
  const INTERRUPT = /door_breach|victory|defeat/;
  const COOLDOWN_MS = 8000, VOLUME = 0.9;
  const last = {}, lastTake = {};
  let audio = null, playingUntilEnd = false, pendingClip = null;
  let token = 0, wd = null, blocked = null, blockedAt = 0;
  function armWd(ms) {
    clearTimeout(wd);
    wd = setTimeout(() => {
      if (!playingUntilEnd) return;
      playingUntilEnd = false;
      try { if (audio) audio.pause(); } catch (e) {}
      playPending();
    }, ms);
  }
  // autoplay policy: retry a blocked clip on the next user gesture
  ['pointerdown', 'keydown'].forEach(evName => window.addEventListener(evName, () => {
    if (!blocked) return;
    const c = blocked; blocked = null;
    if (performance.now() - blockedAt < 15000) window.narrPlay(c);
  }, true));
  function playPending() {
    if (!pendingClip) return;
    const c = pendingClip; pendingClip = null;
    window.narrPlay(c);
  }

  function isMuted() {
    try {
      if (window.SFX) {
        if (typeof SFX.isMuted === 'function') { if (SFX.isMuted()) return true; }
        else if (SFX.muted) return true;
      }
      const b = document.getElementById('tMute');
      if (b && /off/i.test(b.textContent || '')) return true;
    } catch (e) {}
    return false;
  }

  window.narrPick = function (ev) {
    const t = TAKES[ev];
    if (!t) return null;
    const now = performance.now();
    if (last[ev] && now - last[ev] < COOLDOWN_MS && !INTERRUPT.test(ev)) return null;
    let n = 1 + Math.floor(Math.random() * t[1]);
    if (t[1] > 1 && n === lastTake[ev]) n = (n % t[1]) + 1;
    lastTake[ev] = n;
    last[ev] = now;
    return DIR + t[0] + '_' + String(n).padStart(2, '0') + '.mp3';
  };

  function narrVol() {
    let v = 1;
    try { if (window.SFX && SFX.getVol) v = SFX.getVol('narr'); } catch (e) {}
    return VOLUME * v;
  }
  window.narrApplyVolume = function () {
    if (!audio) return;
    if (isMuted() || narrVol() <= 0) { try { audio.pause(); } catch (e) {} playingUntilEnd = false; pendingClip = null; return; }
    audio.volume = Math.min(1, Math.max(0, narrVol()));
  };

  window.narrPlay = function (clip) {
    if (!clip || isMuted() || narrVol() <= 0) return;
    const m = String(clip).match(/vo_[a-z0-9_]+?_\d+/i);
    const urgent = m ? INTERRUPT.test(m[0]) : false;
    const ambient = m ? /door_attack/.test(m[0]) : false; // low priority: never queued, never displaces a pending line
    if (!audio) {
      audio = new Audio();
      audio.addEventListener('ended', () => { clearTimeout(wd); playingUntilEnd = false; playPending(); });
      audio.addEventListener('error', () => { clearTimeout(wd); playingUntilEnd = false; playPending(); });
      audio.addEventListener('loadedmetadata', () => { if (playingUntilEnd) armWd((isFinite(audio.duration) ? audio.duration : 10) * 1000 + 3000); });
    }
    if (playingUntilEnd && !audio.paused && !audio.ended) {
      if (ambient) return;
      if (!urgent) { pendingClip = clip; return; } // never overlap: hold the latest and play it when this one ends
      pendingClip = null;
      audio.pause();
    }
    try {
      audio.src = clip.indexOf('/') === 0 || /^https?:/.test(clip) ? clip : (clip.indexOf(DIR) === 0 ? clip : DIR + clip);
      audio.volume = Math.min(1, Math.max(0, narrVol()));
      const my = ++token;
      playingUntilEnd = true;
      armWd(10000);
      const p = audio.play();
      if (p && p.catch) p.catch(err => {
        if (my !== token) return; // superseded by a newer clip: ignore the AbortError
        playingUntilEnd = false; clearTimeout(wd);
        if (err && err.name === 'NotAllowedError') { blocked = clip; blockedAt = performance.now(); }
        else playPending();
      });
    } catch (e) { playingUntilEnd = false; clearTimeout(wd); }
  };
})();
