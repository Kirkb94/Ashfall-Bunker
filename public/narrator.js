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
    help_hint: ['vo_help_hint', 2],
    maw_tremor: ['vo_maw_tremor', 2],
    maw_burst: ['vo_maw_burst', 2],
    maw_down: ['vo_maw_down', 2],
    sabotage: ['vo_sabotage', 2],
    night_attack: ['vo_night_attack', 2],
    revolt_hint: ['vo_revolt_hint', 2],
    wanderer_lost: ['vo_wanderer_lost', 2],
    workshop_done: ['vo_workshop_done', 2],
    level_up: ['vo_level_up', 2],
    grief: ['vo_grief', 2],
    sick: ['vo_sick', 2],
    sick_recover: ['vo_sick_recover', 2],
    burrower_inside: ['vo_burrower_inside', 2],
    rook: ['vo_rook', 2],
    tip_night: ['vo_tip_night', 2],
    pack_full: ['vo_pack_full', 2],
    topside_empty: ['vo_topside_empty', 2],
    topside_gas_warn: ['vo_topside_gas_warn', 1],
    topside_mask_on: ['vo_topside_mask_on', 1],
    topside_mask_off: ['vo_topside_mask_off', 2],
    debris_warn: ['vo_debris_warn', 2],
    topside_ram_spotted: ['vo_topside_ram_spotted', 2],
    topside_ram_down: ['vo_topside_ram_down', 2],
    alarm_on: ['vo_alarm_on', 2],
    room_built: ['vo_room_built', 2],
    floorsleep: ['vo_floor_sleep', 2],
    scar: ['vo_scar', 2],
    peace: ['vo_peace', 2],
    resume: ['vo_resume', 2],
    goal_choice: ['vo_goal_choice', 1]
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
  const SIZE_KEY = 'ashfall.capsize';
  function capSize() {
    try { const v = localStorage.getItem(SIZE_KEY); return (v === 's' || v === 'l') ? v : 'm'; } catch (e) { return 'm'; }
  }
  const BG_KEY = 'ashfall.capbg';
  function capBg() {
    try { const v = parseInt(localStorage.getItem(BG_KEY), 10); return (v >= 0 && v <= 100) ? v : 92; } catch (e) { return 92; }
  }
  function ensureCap() {
    if (capEl || !document.body) return capEl;
    capEl = document.createElement('div');
    capEl.id = 'narrCaption';
    capEl.dataset.size = capSize();
    capEl.style.setProperty('--capbg', String(capBg() / 100));
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
      el.textContent = '';
      const tag = document.createElement('span'); tag.className = 'ncTag'; tag.textContent = 'LAMP';
      const tx = document.createElement('span'); tx.className = 'ncTxt'; tx.textContent = t;
      el.appendChild(tag); el.appendChild(tx);
      void el.offsetWidth; // reflow: leave display:none (:empty) before .on so the fade runs
      el.classList.add('on');
      clearTimeout(capTimer);
      // voiced line: stay up until the clip ends (the 'ended'/'error' handlers and the watchdog call hideCap)
      if (!playingUntilEnd) capTimer = setTimeout(hideCap, Math.max(3500, 2000 + t.length * 60));
    } catch (e) {}
  }
  window.narrShowText = showText; // caption any Lamp line, with or without a voice clip
  window.narrCaptionsOn = capsOn;
  window.narrCapSize = capSize;
  window.narrCapBg = capBg;
  window.narrSetCapBg = function (p) {
    p = Math.max(0, Math.min(100, Math.round(Number(p) || 0)));
    try { localStorage.setItem(BG_KEY, String(p)); } catch (e) {}
    const el = ensureCap(); if (el) el.style.setProperty('--capbg', String(p / 100));
  };
  window.narrSetCapSize = function (v) {
    v = (v === 's' || v === 'l') ? v : 'm';
    try { localStorage.setItem(SIZE_KEY, v); } catch (e) {}
    const el = ensureCap(); if (el) el.dataset.size = v;
  };
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
    if (audio) audio.muted = !!document.hidden; // silence Lamp's clip while the tab is hidden (position is kept)
    if (!audio) return;
    if (isMuted() || narrVol() <= 0) { try { audio.pause(); } catch (e) {} clearTimeout(wd); playingUntilEnd = false; pendingClip = null; hideCap(); return; }
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
        playingUntilEnd = false; clearTimeout(wd);
        if (err && err.name === 'NotAllowedError') { blocked = clip; blockedAt = performance.now(); }
        else { hideCap(); playPending(); }
      });
    } catch (e) { playingUntilEnd = false; clearTimeout(wd); }
  };
})();
