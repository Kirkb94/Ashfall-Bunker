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
    pop_3: ['vo_pop_03', 2],
    help_hint: ['vo_help_hint', 2]
  };
  const INTERRUPT = /door_breach|victory|defeat/;
  const COOLDOWN_MS = 8000, VOLUME = 0.9;
  const last = {}, lastTake = {};
  let audio = null, playingUntilEnd = false, pendingClip = null;
  let token = 0, wd = null, blocked = null, blockedAt = 0;
  // ---- captions (polite aria-live strip, saved in localStorage, on by default)
  const CAP_KEY = 'ashfall.captions';
  let capEl = null, capTimer = null;
  function capsOn() {
    try { return localStorage.getItem(CAP_KEY) !== '0'; } catch (e) { return true; }
  }
  function ensureCap() {
    if (capEl || !document.body) return capEl;
    capEl = document.createElement('div');
    capEl.id = 'narrCaption';
    capEl.setAttribute('role', 'status');
    capEl.setAttribute('aria-live', 'polite');
    document.body.appendChild(capEl);
    return capEl;
  }
  function hideCap() {
    clearTimeout(capTimer); capTimer = null;
    if (capEl) {
      capEl.classList.remove('on');
      const el = capEl;
      setTimeout(() => { if (!el.classList.contains('on')) el.textContent = ''; }, 300);
    }
  }
  function showCap(clip) {
    try {
      if (typeof narrText !== 'function') return;
      showText(narrText(clip, null, ''));
    } catch (e) {}
  }
  function showText(t) {
    try {
      if (!capsOn() || !t) return;
      t = String(t);
      const el = ensureCap(); if (!el) return;
      el.textContent = t;
      el.classList.add('on');
      clearTimeout(capTimer);
      capTimer = setTimeout(hideCap, Math.max(3500, 2000 + t.length * 60));
    } catch (e) {}
  }
  window.narrShowText = showText; // caption any Lamp line, with or without a voice clip
  window.narrCaptionsOn = capsOn;
  window.narrSetCaptions = function (on) {
    try { localStorage.setItem(CAP_KEY, on ? '1' : '0'); } catch (e) {}
    if (!on) hideCap();
  };
  ensureCap();
  function armWd(ms) {
    clearTimeout(wd);
    wd = setTimeout(() => {
      if (!playingUntilEnd) return;
      hideCap();
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
        if (typeof SFX.narrMuted === 'function' && SFX.narrMuted()) return true;
        if (typeof SFX.isMuted === 'function') { if (SFX.isMuted()) return true; }
        else if (SFX.muted) return true;
      }
      const b = document.getElementById('tMute');
      if (b && /off/i.test(b.textContent || '')) return true;
    } catch (e) {}
    return false;
  }

  // Pick a specific take (1-based) for events whose takes are not interchangeable (e.g. keyboard vs touch hint).
  window.narrPickTake = function (ev, n) {
    const t = TAKES[ev];
    if (!t || !(n >= 1 && n <= t[1])) return null;
    const now = performance.now();
    if (last[ev] && now - last[ev] < COOLDOWN_MS && !INTERRUPT.test(ev)) return null;
    last[ev] = now; lastTake[ev] = n;
    return DIR + t[0] + '_' + String(n).padStart(2, '0') + '.mp3';
  };

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
    try { if (window.SFX && SFX.getVol) v = (SFX.effVol ? SFX.effVol('narr') * SFX.effVol('master') : SFX.getVol('narr') * SFX.getVol('master')); } catch (e) {}
    return VOLUME * v;
  }
  window.narrApplyVolume = function () {
    if (!audio) return;
    if (isMuted() || narrVol() <= 0) { try { audio.pause(); } catch (e) {} playingUntilEnd = false; pendingClip = null; return; }
    audio.volume = Math.min(1, Math.max(0, narrVol()));
  };

  window.narrPlay = function (clip) {
    if (!clip) return;
    if (isMuted() || narrVol() <= 0) { showCap(clip); return; } // muted: still caption every line (captions also serve deaf and hard-of-hearing players)
    const m = String(clip).match(/vo_[a-z0-9_]+?_\d+/i);
    const urgent = m ? INTERRUPT.test(m[0]) : false;
    const ambient = m ? /door_attack/.test(m[0]) : false; // low priority: never queued, never displaces a pending line
    if (!audio) {
      audio = new Audio();
      audio.addEventListener('ended', () => { clearTimeout(wd); playingUntilEnd = false; hideCap(); playPending(); });
      audio.addEventListener('error', () => { clearTimeout(wd); playingUntilEnd = false; hideCap(); playPending(); });
      audio.addEventListener('loadedmetadata', () => { if (playingUntilEnd) armWd((isFinite(audio.duration) ? audio.duration : 10) * 1000 + 3000); });
      // duck music/ambience while the voice is audible; short release hold so queued lines don't pump the mix
      let duckT = null;
      const duck = on => { try { if (window.SFX && SFX.duck) SFX.duck(on); } catch (e) {} };
      audio.addEventListener('playing', () => { clearTimeout(duckT); duckT = null; duck(true); });
      // keep the duck failsafe armed while the line is genuinely playing
      audio.addEventListener('timeupdate', () => { if (!audio.paused && !audio.ended) duck(true); });
      ['pause', 'ended', 'error'].forEach(ev => audio.addEventListener(ev, () => {
        clearTimeout(duckT); duckT = setTimeout(() => { duckT = null; duck(false); }, 250);
      }));
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
      showCap(clip);
      const p = audio.play();
      if (p && p.catch) p.catch(err => {
        if (my !== token) return; // superseded by a newer clip: ignore the AbortError
        playingUntilEnd = false; clearTimeout(wd); hideCap();
        if (err && err.name === 'NotAllowedError') { blocked = clip; blockedAt = performance.now(); }
        else playPending();
      });
    } catch (e) { playingUntilEnd = false; clearTimeout(wd); }
  };
})();
