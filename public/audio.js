// Ashfall Bunker: procedural sound (WebAudio, no asset files).
// SFX.turret(type), SFX.hit(what), SFX.death(kind), SFX.update(dt, state|null), SFX.toggleMute()
(function () {
  const MASTER = 0.6, MUSIC = 0.05, HUM = 0.035, SIREN = 0.07, SIREN_SECS = 9;
  let ctx = null, master, musicBus, sfxBus, uiBus, ambBus, humGain, sirenGain, sirenOsc, noiseBuf;
  let gustG = null, gustF = null, gustT = 6, windFade = null, subFade = null, windBuf = null, rumbleT = 12, thudT = 8, wasNight = false;
  let droneGain, droneFilt, droneK = 0, droneP = 0, droneOsc = [], stingBus = null, duckBus = null;
  const DUCK = 0.35; // music/ambience level while a narrator line plays
  let duckWant = false; // latest duck request, kept so it survives until the context exists
  let duckApplied = false, duckWd = null; // last level actually scheduled + failsafe timer (releases a stuck duck)
  const DRONE = 0.05, GEN = 0.05, VENT = 0.03;
  let genGain, genOsc, genOsc2, ventGain, ambFx, creakT = 8, genK = 0, ventK = 0;
  let tensGain = null, tensLfo = null, tensOsc = [];
  const TENS = 0.9; // relative to the music bus (already scaled by MUSIC and the Music slider)
  let muted = false;
  try { muted = localStorage.getItem('ab_mute') === '1'; } catch (e) {}
  let narrMuted = false;
  try { narrMuted = localStorage.getItem('ab_narr_mute') === '1'; } catch (e) {}
  const vol = { master: 1, music: 1, amb: 1, narr: 1, fx: 1, ui: 1 };
  const chMute = { master: false, music: false, amb: false, narr: false, fx: false, ui: false };
  try { const m = JSON.parse(localStorage.getItem('ab_chmute') || '{}') || {}; for (const k in chMute) chMute[k] = m[k] === true; } catch (e) {}
  const ev = n => (chMute[n] ? 0 : vol[n]);
  const masterG = () => (muted || chMute.master ? 0 : MASTER * vol.master);
  try { const p = JSON.parse(localStorage.getItem('ab_vol') || '{}') || {}; for (const k in vol) if (typeof p[k] === 'number' && isFinite(p[k])) vol[k] = Math.min(1, Math.max(0, p[k])); if (typeof p.amb !== 'number' && typeof p.music === 'number') vol.amb = vol.music; } catch (e) {}
  let chordT = 0, chordI = 0, sirenT = 0, wasAlarm = false, lastShot = 0, lastHit = 0, lastRumble = 0, lastBeat = 0, lastDoorWarn = 0, lastRepair = 0, lastClick = 0, lastDeath = 0, lastStep = 0, lastJump = 0, lastLand = 0, stepAlt = false, lastFoot = 0, lastRung = 0, lastDrop = 0;

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = masterG(); master.connect(ctx.destination);
    musicBus = ctx.createGain(); musicBus.gain.value = MUSIC * ev('music');
    sfxBus = ctx.createGain(); sfxBus.gain.value = ev('fx'); sfxBus.connect(master);
    uiBus = ctx.createGain(); uiBus.gain.value = ev('ui'); uiBus.connect(master);
    ambBus = ctx.createGain(); duckBus = ctx.createGain(); duckBus.gain.value = duckWant ? DUCK : 1; duckBus.connect(master);
    ambBus.gain.value = ev('amb'); ambBus.connect(duckBus);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    musicBus.connect(lp); lp.connect(duckBus);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // hydroponics hum: low saw + octave sine with slow tremolo
    humGain = ctx.createGain(); humGain.gain.value = 0;
    const hf = ctx.createBiquadFilter(); hf.type = 'lowpass'; hf.frequency.value = 240;
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 55;
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 110;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.35;
    const lg = ctx.createGain(); lg.gain.value = 0.25;
    lfo.connect(lg); lg.connect(humGain.gain);
    o1.connect(hf); o2.connect(hf); hf.connect(humGain); humGain.connect(ambBus);
    o1.start(); o2.start(); lfo.start();
    // threat drone: detuned low saws + sub sine, on the ambience bus (follows mute and music volume)
    droneGain = ctx.createGain(); droneGain.gain.value = 0;
    droneFilt = ctx.createBiquadFilter(); droneFilt.type = 'lowpass'; droneFilt.frequency.value = 110;
    const d1 = ctx.createOscillator(); d1.type = 'sawtooth'; d1.frequency.value = 41;
    const d2 = ctx.createOscillator(); d2.type = 'sawtooth'; d2.frequency.value = 41.7;
    const d3 = ctx.createOscillator(); d3.type = 'sine'; d3.frequency.value = 82;
    d1.connect(droneFilt); d2.connect(droneFilt); d3.connect(droneFilt);
    droneFilt.connect(droneGain); droneGain.connect(ambBus);
    d1.start(); d2.start(); d3.start();
    droneOsc = [[d1, 41], [d2, 41.7], [d3, 82]];
    // tension music layer: dissonant minor-second pair + high tritone shimmer with a quickening tremolo, on the music bus
    tensGain = ctx.createGain(); tensGain.gain.value = 0;
    const tTrem = ctx.createGain(); tTrem.gain.value = 0.6;
    tensLfo = ctx.createOscillator(); tensLfo.frequency.value = 0.5;
    const tLfoG = ctx.createGain(); tLfoG.gain.value = 0.4;
    tensLfo.connect(tLfoG); tLfoG.connect(tTrem.gain);
    const t1 = ctx.createOscillator(); t1.type = 'sine'; t1.frequency.value = 110;
    const t2 = ctx.createOscillator(); t2.type = 'sine'; t2.frequency.value = 116.5;
    const t3 = ctx.createOscillator(); t3.type = 'triangle'; t3.frequency.value = 311;
    const t3g = ctx.createGain(); t3g.gain.value = 0.25;
    t1.connect(tTrem); t2.connect(tTrem); t3.connect(t3g); t3g.connect(tTrem);
    tTrem.connect(tensGain); tensGain.connect(musicBus);
    t1.start(); t2.start(); t3.start(); tensLfo.start();
    tensOsc = [[t1, 110], [t2, 116.5], [t3, 311]];
    // siren
    sirenGain = ctx.createGain(); sirenGain.gain.value = 0;
    const sf = ctx.createBiquadFilter(); sf.type = 'lowpass'; sf.frequency.value = 1100;
    sirenOsc = ctx.createOscillator(); sirenOsc.type = 'square'; sirenOsc.frequency.value = 500;
    sirenOsc.connect(sf); sf.connect(sirenGain); sirenGain.connect(sfxBus);
    sirenOsc.start();
    // bunker machinery bus (rides the SFX bus: Effects slider and mute apply)
    ambFx = ctx.createGain(); ambFx.gain.value = 1; ambFx.connect(sfxBus);
    // generator: low saw + sub with a chugging amplitude wobble; pitch winds down when power dies
    genGain = ctx.createGain(); genGain.gain.value = 0;
    const genTrem = ctx.createGain(); genTrem.gain.value = 0.7;
    const genLfo = ctx.createOscillator(); genLfo.frequency.value = 6;
    const genLfoG = ctx.createGain(); genLfoG.gain.value = 0.3;
    genLfo.connect(genLfoG); genLfoG.connect(genTrem.gain);
    const genLp = ctx.createBiquadFilter(); genLp.type = 'lowpass'; genLp.frequency.value = 170;
    genOsc = ctx.createOscillator(); genOsc.type = 'sawtooth'; genOsc.frequency.value = 38;
    genOsc2 = ctx.createOscillator(); genOsc2.type = 'sine'; genOsc2.frequency.value = 19;
    genOsc.connect(genLp); genOsc2.connect(genLp); genLp.connect(genTrem); genTrem.connect(genGain); genGain.connect(ambFx);
    genOsc.start(); genOsc2.start(); genLfo.start();
    // ventilation: looped noise through a slowly sweeping bandpass
    ventGain = ctx.createGain(); ventGain.gain.value = 0;
    const vs = ctx.createBufferSource(); vs.buffer = noiseBuf; vs.loop = true;
    const vbp = ctx.createBiquadFilter(); vbp.type = 'bandpass'; vbp.frequency.value = 280; vbp.Q.value = 0.9;
    const vl = ctx.createOscillator(); vl.frequency.value = 0.12;
    const vlg = ctx.createGain(); vlg.gain.value = 60;
    vl.connect(vlg); vlg.connect(vbp.frequency);
    vs.connect(vbp); vbp.connect(ventGain); ventGain.connect(ambFx);
    vs.start(); vl.start();
    // topside wind: looped noise -> bandpass (slow sweep) -> swell -> fade -> ambient bus (scav scene only)
    windBuf = ctx.createBuffer(1, ctx.sampleRate * 6, ctx.sampleRate);
    const wd = windBuf.getChannelData(0);
    for (let i = 0; i < wd.length; i++) wd[i] = Math.random() * 2 - 1;
    const ws = ctx.createBufferSource(); ws.buffer = windBuf; ws.loop = true;
    const wbp = ctx.createBiquadFilter(); wbp.type = 'bandpass'; wbp.frequency.value = 420; wbp.Q.value = 0.8;
    const wSwell = ctx.createGain(); wSwell.gain.value = 0.7;
    windFade = ctx.createGain(); windFade.gain.value = 0;
    const wl1 = ctx.createOscillator(); wl1.frequency.value = 0.07;
    const wl1g = ctx.createGain(); wl1g.gain.value = 220;
    wl1.connect(wl1g); wl1g.connect(wbp.frequency);
    const wl2 = ctx.createOscillator(); wl2.frequency.value = 0.11;
    const wl2g = ctx.createGain(); wl2g.gain.value = 0.3;
    wl2.connect(wl2g); wl2g.connect(wSwell.gain);
    // random gusts: extra gain stage + filter detune, driven from update()
    gustG = ctx.createGain(); gustG.gain.value = 1; gustF = wbp;
    ws.connect(wbp); wbp.connect(wSwell); wSwell.connect(gustG); gustG.connect(windFade); windFade.connect(ambBus);
    ws.start(); wl1.start(); wl2.start();
    // constant sub-bass bed under the wind
    const ss = ctx.createBufferSource(); ss.buffer = windBuf; ss.loop = true;
    const slp = ctx.createBiquadFilter(); slp.type = 'lowpass'; slp.frequency.value = 70;
    subFade = ctx.createGain(); subFade.gain.value = 0;
    ss.connect(slp); slp.connect(subFade); subFade.connect(ambBus);
    ss.start();
  }
  // bunker drip: tiny pitched blip with a pitch bend up, plus a faint echo drop; on the ambient bus
  let dripT = 4, bunkRumbleT = 20;
  function drip() {
    const t0 = ctx.currentTime, base = 900 + Math.random() * 900;
    for (let i = 0; i < 2; i++) {
      const t = t0 + i * (0.12 + Math.random() * 0.06), k = i ? 0.25 : 1;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(base * (i ? 0.9 : 1), t); o.frequency.exponentialRampToValueAtTime(base * 1.6, t + 0.05);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.05 * k, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.12);
      o.connect(g); g.connect(ambBus); o.start(t); o.stop(t + 0.15);
    }
  }
  // one distant rumble: slow swell and long decay on the ambient bus
  function distantRumble(k) {
    const t = ctx.currentTime, dur = 4 + Math.random() * 2.5, peak = (k || 1) * (0.35 + Math.random() * 0.3) * (vol.music === undefined ? 1 : vol.music);
    const s = ctx.createBufferSource(); s.buffer = windBuf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 1;
    f.frequency.setValueAtTime(160, t); f.frequency.exponentialRampToValueAtTime(40, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + 0.8); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(ambBus);
    s.start(t, Math.random() * 3); s.stop(t + dur + 0.05);
  }
  // one muffled distant thud (night, bunker): low sine drop + lowpassed noise, quiet, on the ambient bus; sometimes a softer echo thud follows
  function distantThud(soft, delay) {
    const t = ctx.currentTime + (delay || 0), k = soft ? 0.55 : 1;
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(52 + Math.random() * 10, t); o.frequency.exponentialRampToValueAtTime(26, t + 0.7);
    og.gain.setValueAtTime(0.0001, t); og.gain.linearRampToValueAtTime(0.22 * k, t + 0.05); og.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
    o.connect(og); og.connect(ambBus); o.start(t); o.stop(t + 1);
    if (noiseBuf) {
      const s = ctx.createBufferSource(); s.buffer = noiseBuf;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 0.7;
      f.frequency.setValueAtTime(150, t); f.frequency.exponentialRampToValueAtTime(45, t + 0.6);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.18 * k, t + 0.04); g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
      s.connect(f); f.connect(g); g.connect(ambBus);
      s.start(t, Math.random() * 0.5); s.stop(t + 0.75);
    }
  }
  // one distant metal groan: detuned saws through a resonant bandpass, slow pitch sag; q scales loudness
  function creak(q) {
    const t = ctx.currentTime, dur = 0.8 + Math.random() * 1.0, f0 = 110 + Math.random() * 140;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 10;
    f.frequency.setValueAtTime(f0 * 3, t); f.frequency.exponentialRampToValueAtTime(f0 * 2, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.06 * q, t + dur * 0.35); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    for (const det of [0, 7]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 0.82, t + dur);
      o.detune.value = det; o.connect(f); o.start(t); o.stop(t + dur + 0.05);
    }
    f.connect(g); g.connect(ambFx);
  }
  ['pointerdown', 'keydown', 'click', 'touchend'].forEach(ev => window.addEventListener(ev, init));

  function noise(dur, type, f0, f1, vol, q) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q || 1;
    const g = ctx.createGain(), t = ctx.currentTime;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(sfxBus);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }
  function tone(f0, f1, dur, vol, type) {
    const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
    o.type = type || 'sine';
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(sfxBus); o.start(t); o.stop(t + dur + 0.02);
  }
  const ready = () => ctx && ctx.state === 'running' && !muted;
  let uiPrevT = 0, lastUiHover = 0;
  // UI tone on the UI bus; delay in seconds
  function uiTone(f0, f1, dur, v, type, delay) {
    const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + (delay || 0);
    o.type = type || 'sine';
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(uiBus); o.start(t); o.stop(t + dur + 0.02);
  }

  // filtered noise burst on the UI bus; delay in seconds
  function uiNoise(dur, type, f0, f1, v, q, delay) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q || 1;
    const g = ctx.createGain(), t = ctx.currentTime + (delay || 0);
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(uiBus);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }
  let lastUiDig = 0, lastUiBuild = 0;

  const CHORDS = [[110, 130.8, 164.8], [98, 123.5, 146.8], [87.3, 110, 130.8], [98, 116.5, 146.8]];
  function playChord(notes) {
    const t = ctx.currentTime, len = 10;
    for (const n of notes) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'triangle'; o.frequency.value = n * (1 + (Math.random() - 0.5) * 0.004);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(1, t + 3); g.gain.linearRampToValueAtTime(0.0001, t + len);
      o.connect(g); g.connect(musicBus); o.start(t); o.stop(t + len + 0.1);
    }
  }

  // per-sound loudness multipliers for Mara's topside foley (final level still follows the Effects slider and mute)
  const FOLEY = { step: 1.3, jump: 1.15, land: 1 };
  // per-sound rate limiter: returns true if the sound keyed `k` may play now (min gap in seconds)
  const gates = {};
  function gate(k, gap) { const n = ctx.currentTime; if (n - (gates[k] === undefined ? -1 : gates[k]) < gap) return false; gates[k] = n; return true; }
  let rungN = 0, stepN = 0;

  let lastDigSfx = 0, lastMarkSfx = 0;

  window.SFX = {
    // for narrator.js: the shared AudioContext (created and resumed on the first click or key press)
    unlock() { init(); return ctx; },
    get ctx() { return ctx; },
    // 'Day N survived' stinger: soft rising chord + airy sweep on the UI bus
    dayStinger() {
      if (!ready()) return;
      uiTone(220, 220, 1.4, 0.10, 'triangle', 0);
      uiTone(277.2, 277.2, 1.3, 0.08, 'triangle', 0.18);
      uiTone(329.6, 329.6, 1.6, 0.09, 'triangle', 0.36);
      uiTone(110, 110, 2, 0.12, 'sine', 0);
    },
    turret(type) {
      if (!ready()) return;
      if (!gate('shot:' + type, type === 'rifle' ? 0.09 : 0.14)) return;
      if (type === 'rifle') { noise(0.12, 'bandpass', 2600, 500, 0.35, 0.8); tone(180, 60, 0.1, 0.3, 'triangle'); }
      else if (type === 'coil') { noise(0.18, 'bandpass', 3200, 900, 0.3, 3); tone(900, 140, 0.16, 0.2, 'sawtooth'); tone(60, 40, 0.2, 0.3, 'sine'); }
      else { noise(0.22, 'lowpass', 1800, 200, 0.5); tone(120, 40, 0.18, 0.45, 'sine'); }
      SFX.ember(type === 'rifle' ? 0.5 : 1);
    },
    // ember crackle: a few tiny, quiet noise ticks with random gaps (rate limited, SFX bus); q 0..1 scales loudness
    ember(q) {
      if (!ready() || !noiseBuf) return;
      if (!gate('ember', 0.25)) return;
      const k = Math.min(1, Math.max(0.1, q == null ? 0.6 : +q || 0));
      const n = 2 + Math.floor(Math.random() * 3);
      let at = 0.03 + Math.random() * 0.05;
      for (let i = 0; i < n; i++) {
        const t = ctx.currentTime + at, dur = 0.012 + Math.random() * 0.02;
        const s = ctx.createBufferSource(); s.buffer = noiseBuf;
        const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 3;
        f.frequency.value = 2500 + Math.random() * 3500;
        const g = ctx.createGain();
        g.gain.setValueAtTime((0.04 + Math.random() * 0.05) * k, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        s.connect(f); f.connect(g); g.connect(sfxBus);
        s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
        at += 0.03 + Math.random() * 0.09;
      }
    },
    hit(what) {
      if (!ready()) return;
      if (!gate('hit:' + what, what === 'door' ? 0.12 : 0.08)) return;
      if (what === 'door') { const pv = 0.9 + Math.random() * 0.2; tone(95 * pv, 38 * pv, 0.3, 0.7, 'sine'); noise(0.18, 'lowpass', 500, 120, 0.4); tone(420 + Math.random() * 80, 230, 0.22, 0.14, 'square'); noise(0.14, 'bandpass', 2200, 900, 0.18, 5); }
      else { noise(0.2, 'bandpass', 1400, 600, 0.25, 6); tone(320, 200, 0.12, 0.15, 'square'); }
    },
    // ambient water drip landing: soft plink, very quiet and rate limited
    drip() {
      if (!ready()) return;
      if (!gate('drip', 0.15)) return;
      const p = 0.85 + Math.random() * 0.5;
      tone(1300 * p, 620 * p, 0.07, 0.05, 'sine');
      noise(0.04, 'bandpass', 3000, 1800, 0.025, 6);
    },
    // spent casing bouncing on the floor: tiny brass clink, quiet and rate limited
    shell() {
      if (!ready()) return;
      if (!gate('shell', 0.05)) return;
      const p = 1 + Math.random() * 0.5;
      tone(2600 * p, 1500 * p, 0.05, 0.05, 'square');
      noise(0.03, 'bandpass', 4200, 2500, 0.06, 6);
    },
    // bullet/shock lands on an enemy: short quiet thwack (crit is sharper); heavily rate limited so volleys don't stack
    enemyHit(crit, dtype) {
      if (!ready()) return;
      if (!gate('ehit', 0.07)) return;
      const k = crit ? 1.35 : 1;
      if (dtype === 'shock') { tone(1200, 300, 0.08, 0.08, 'sawtooth'); SFX.ember(0.6); return; }
      noise(0.07, 'bandpass', 1800 + Math.random() * 500, 700, 0.16 * k, 2);
      tone(260 + Math.random() * 60, 120, 0.06, 0.1 * k, 'triangle');
      if (crit) tone(1500, 900, 0.05, 0.06, 'square');
      SFX.ember(crit ? 0.8 : 0.5);
    },
    // enemy killed: wet crunch + falling thud; kind 'big' (bosses) is longer and deeper, 'far' is quieter
    death(kind) {
      if (!ready()) return;
      const now = ctx.currentTime; if (now - lastDeath < 0.06) return; lastDeath = now;
      const big = kind === 'big', q = kind === 'far' ? 0.5 : 1;
      if (big) { tone(110, 30, 0.7, 0.6, 'sine'); noise(0.6, 'lowpass', 1200, 90, 0.5); tone(300, 60, 0.5, 0.18, 'sawtooth'); }
      else { noise(0.22, 'bandpass', 1100 + Math.random() * 400, 250, 0.3 * q, 2); tone(220 + Math.random() * 60, 70, 0.2, 0.22 * q, 'triangle'); }
    },
    // scavenging player foley (throttled); all on the SFX bus
    step() {
      if (!ready()) return;
      const now = ctx.currentTime; if (now - lastStep < 0.12) return; lastStep = now;
      stepAlt = !stepAlt;
      noise(0.07, 'bandpass', (stepAlt ? 700 : 560) + Math.random() * 200, 220, (stepAlt ? 0.16 : 0.11) * FOLEY.step, 1.2);
      tone(stepAlt ? 90 : 75, 45, 0.06, (stepAlt ? 0.1 : 0.07) * FOLEY.step, 'sine');
    },
    jump() {
      if (!ready()) return;
      const now = ctx.currentTime; if (now - lastJump < 0.08) return; lastJump = now;
      tone(220, 420, 0.1, 0.1 * FOLEY.jump, 'triangle');
      noise(0.09, 'bandpass', 900, 1800, 0.1 * FOLEY.jump, 1);
    },
    // loot pickup chime on the SFX bus; kind 'mask' is a lower, single note
    pickup(kind) {
      if (!ready()) return;
      const now = ctx.currentTime; if (now - (this._lastPick || 0) < 0.12) return; this._lastPick = now;
      const note = (f, delay, dur, v) => {
        const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + delay;
        o.type = 'triangle'; o.frequency.setValueAtTime(f, t);
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        o.connect(g); g.connect(sfxBus); o.start(t); o.stop(t + dur + 0.02);
      };
      if (kind === 'mask') { note(392, 0, 0.18, 0.16); }
      else { note(660, 0, 0.12, 0.14); note(990, 0.07, 0.2, 0.12); }
    },
    // speed = downward speed in px/s at impact
    land(speed) {
      if (!ready()) return;
      const now = ctx.currentTime; if (now - lastLand < 0.1) return; lastLand = now;
      const k = Math.min(1, Math.max(0.15, (+speed || 0) / 700));
      noise(0.1 + 0.12 * k, 'lowpass', 900 + 400 * k, 120, (0.15 + 0.3 * k) * FOLEY.land);
      tone(110 - 30 * k, 40, 0.1 + 0.1 * k, (0.12 + 0.35 * k) * FOLEY.land, 'sine');
    },
    // bunker foley for crew and Mara (q = loudness scale 0..1); all on the SFX bus, throttled so a full crew cannot stack
    foot(q) {
      if (!ready()) return;
      const now = ctx.currentTime; if (now - lastFoot < 0.07) return; lastFoot = now;
      const k = Math.min(1, Math.max(0.05, +q || 0.3));
      stepAlt = !stepAlt;
      noise(0.06, 'bandpass', (stepAlt ? 650 : 520) + Math.random() * 180, 200, 0.14 * k, 1.2);
      tone(stepAlt ? 85 : 70, 42, 0.05, 0.08 * k, 'sine');
    },
    // ladder rung: short metallic tick plus a dull knock
    rung(q) {
      if (!ready()) return;
      const now = ctx.currentTime; if (now - lastRung < 0.09) return; lastRung = now;
      const k = Math.min(1, Math.max(0.05, +q || 0.3));
      tone(1100 + Math.random() * 300, 700, 0.05, 0.07 * k, 'square');
      noise(0.05, 'bandpass', 2000, 900, 0.1 * k, 5);
      tone(130, 70, 0.06, 0.08 * k, 'sine');
    },
    // stepping off a ladder: soft thud
    drop(q) {
      if (!ready()) return;
      const now = ctx.currentTime; if (now - lastDrop < 0.1) return; lastDrop = now;
      const k = Math.min(1, Math.max(0.05, +q || 0.3));
      noise(0.1, 'lowpass', 900, 120, 0.2 * k);
      tone(100, 40, 0.1, 0.2 * k, 'sine');
    },
    // ---- UI sounds (all on the UI bus) ----
    // game.js calls SFX['ui' + name], so expose click under that name too
    uiClick() { this.click(); },
    uiHover(force) {
      if (!ready()) return;
      const now = ctx.currentTime; if (!force && now - lastUiHover < 0.03) return; lastUiHover = now;
      uiTone(1900, 1700, 0.03, 0.035, 'triangle');
    },
    // dig tool: tiles marked (rising tick) / unmarked (falling tick); throttled
    uiDigMark() {
      if (!ready()) return;
      const now = ctx.currentTime; if (now - lastMarkSfx < 0.05) return; lastMarkSfx = now;
      uiTone(640, 900, 0.06, 0.1, 'triangle');
      uiTone(1100, 1400, 0.05, 0.05, 'square', 0.03);
    },
    uiDigUnmark() {
      if (!ready()) return;
      const now = ctx.currentTime; if (now - lastMarkSfx < 0.05) return; lastMarkSfx = now;
      uiTone(700, 420, 0.07, 0.09, 'triangle');
    },
    uiPlace() {
      if (!ready()) return;
      uiTone(180, 90, 0.12, 0.3, 'sine');
      uiTone(520, 520, 0.09, 0.12, 'triangle', 0.05);
      uiTone(780, 780, 0.14, 0.12, 'triangle', 0.12);
    },
    // tile build thunk (pit rooms, ladders); short and low
    uiBuild() {
      if (!ready()) return;
      const now = ctx.currentTime; if (now - lastUiBuild < 0.08) return; lastUiBuild = now;
      tone(140, 55, 0.16, 0.28, 'sine');
      noise(0.07, 'bandpass', 1400, 500, 0.12, 1.5);
      setTimeout(() => { if (ready()) tone(640, 600, 0.07, 0.06, 'triangle'); }, 45);
    },
    // tile demolished: falling-gravel crumble plus a deep thud; size 0..1 scales length and volume
    uiDemolish(size) {
      if (!ready()) return;
      const now = ctx.currentTime; if (now - (this._lastDemo || 0) < 0.15) return; this._lastDemo = now;
      const k = Math.min(1, Math.max(0.2, size == null ? 0.6 : +size || 0));
      noise(0.3 + 0.4 * k, 'lowpass', 2200, 120, 0.26 * (0.5 + k), 0.8);
      tone(90, 38, 0.2 + 0.15 * k, 0.3 * (0.5 + k), 'sine');
      for (let i = 0; i < 4; i++) setTimeout(() => { if (ready()) noise(0.05, 'bandpass', 900 + Math.random() * 1600, 300, 0.08 + 0.06 * k, 2); }, 70 + i * 70 + Math.random() * 40);
    },
    // tile dig crunch; hard = material hardness (harder = lower pitch, slightly longer)
    uiDig(hard) {
      if (!ready()) return;
      const now = ctx.currentTime; if (now - lastUiDig < 0.08) return; lastUiDig = now;
      const k = Math.min(1, Math.max(0, (+hard || 0) / 12));
      // scrape: rising-then-falling band noise, with a low thump underneath
      noise(0.1 + 0.08 * k, 'bandpass', 700 - 300 * k, 1800 - 900 * k, 0.2, 2.5);
      noise(0.09 + 0.07 * k, 'lowpass', 1600 - 700 * k, 200, 0.16);
      tone(170 - 60 * k, 60, 0.08 + 0.05 * k, 0.16, 'triangle');
    },
    _lastUiErr: 0,
    uiError() {
      if (!ready()) return;
      const nowE = ctx.currentTime; if (nowE - this._lastUiErr < 0.12) return; this._lastUiErr = nowE;
      uiTone(160, 120, 0.16, 0.16, 'sawtooth');
      uiTone(150, 100, 0.18, 0.14, 'square', 0.11);
    },
    uiOpen() {
      if (!ready()) return;
      uiTone(420, 760, 0.09, 0.1, 'triangle');
    },
    uiClose() {
      if (!ready()) return;
      uiTone(760, 420, 0.09, 0.09, 'triangle');
    },
    // toggle switch: rising blip when turned on, falling when off
    uiToggle(on) {
      if (!ready()) return;
      if (on === false) { uiTone(640, 440, 0.06, 0.1, 'triangle'); uiTone(440, 330, 0.07, 0.07, 'sine', 0.04); }
      else { uiTone(440, 640, 0.06, 0.1, 'triangle'); uiTone(660, 880, 0.07, 0.07, 'sine', 0.04); }
    },
    // short UI click (throttled)
    click() {
      if (!ready()) return;
      const now = ctx.currentTime; if (now - lastClick < 0.04) return; lastClick = now;
      uiTone(1100, 760, 0.045, 0.08, 'triangle');
      setTimeout(() => { if (ready()) uiTone(760, 600, 0.05, 0.05, 'sine'); }, 35);
    },
    // confirm: short rising two-note chirp (primary actions)
    uiConfirm() {
      if (!ready()) return;
      const now = ctx.currentTime; if (now - lastClick < 0.04) return; lastClick = now;
      uiTone(520, 640, 0.07, 0.11, 'triangle');
      uiTone(780, 940, 0.1, 0.11, 'triangle', 0.06);
    },
    // door impact: strength 0..1 scales weight, length and loudness; final = the hit that destroyed the door (adds a crack)
    _lastDoorHit: 0,
    doorHit(strength, final) {
      if (!ready()) return;
      const now = ctx.currentTime;
      if (!final && now - this._lastDoorHit < 0.06) return;
      this._lastDoorHit = now;
      const k = Math.min(1, Math.max(0.1, +strength || 0.3));
      const dur = 0.18 + 0.32 * k;
      tone(110 - 30 * k, 34, dur, 0.3 + 0.5 * k, 'sine');
      noise(dur, 'lowpass', 380 + 250 * k, 90, 0.2 + 0.3 * k);
      if (k < 0.6) tone(420 + Math.random() * 80, 230, 0.16, 0.1 * (1 - k), 'square');
      if (final) {
        noise(0.22, 'bandpass', 3000, 700, 0.4, 3);
        tone(340, 60, 0.35, 0.25, 'sawtooth');
        noise(0.5, 'lowpass', 700, 70, 0.3);
      }
    },
    // door torn open: deep boom, metal tear, descending groan
    breach() {
      if (!ready()) return;
      tone(70, 24, 0.9, 0.9, 'sine');
      noise(0.7, 'lowpass', 900, 80, 0.6);
      noise(0.5, 'bandpass', 2400, 300, 0.3, 4);
      tone(260, 70, 0.7, 0.2, 'sawtooth');
      // sharp crack of snapping metal on top
      noise(0.06, 'highpass', 3500, 2500, 0.45, 2);
      setTimeout(() => { if (ready()) { noise(0.12, 'bandpass', 1800, 600, 0.3, 5); tone(520, 140, 0.12, 0.2, 'square'); } }, 60);
    },
    // generator ran dry: descending whine with a low sag and fading hiss
    powerOut() {
      if (!ready()) return;
      tone(520, 55, 1.4, 0.22, 'sawtooth');
      tone(260, 40, 1.6, 0.18, 'sine');
      noise(1.1, 'lowpass', 1400, 120, 0.1);
    },
    // power restored: relay clunk, click, then a short rising hum
    powerBack() {
      if (!ready()) return;
      tone(110, 45, 0.16, 0.4, 'sine');
      noise(0.06, 'bandpass', 2400, 1200, 0.22, 5);
      setTimeout(() => { if (ready()) { tone(90, 180, 0.35, 0.14, 'triangle'); noise(0.04, 'bandpass', 3000, 1800, 0.12, 6); } }, 140);
    },
    // workshop repair clank (throttled); 'seal' = hatch sealed again chime
    repair(kind) {
      if (!ready()) return;
      const now = ctx.currentTime;
      if (kind === 'seal') { tone(520, 520, 0.14, 0.18, 'triangle'); setTimeout(() => { if (ready()) tone(780, 780, 0.22, 0.18, 'triangle'); }, 120); noise(0.12, 'bandpass', 1800, 900, 0.15, 4); return; }
      if (kind === 'clank') {
        // heavy hatch repair: two metallic hammer strikes, then the seal chime
        lastRepair = now;
        tone(900, 500, 0.1, 0.22, 'square'); noise(0.07, 'bandpass', 2800, 1400, 0.25, 6); tone(180, 90, 0.12, 0.25, 'sine');
        setTimeout(() => { if (ready()) { tone(760, 420, 0.1, 0.2, 'square'); noise(0.07, 'bandpass', 2400, 1200, 0.22, 6); tone(150, 80, 0.12, 0.22, 'sine'); } }, 170);
        setTimeout(() => { if (ready()) { tone(520, 520, 0.14, 0.16, 'triangle'); setTimeout(() => { if (ready()) tone(780, 780, 0.22, 0.16, 'triangle'); }, 120); } }, 380);
        return;
      }
      if (now - lastRepair < 0.3) return; lastRepair = now;
      tone(700 + Math.random() * 200, 420, 0.07, 0.1, 'square');
      noise(0.08, 'bandpass', 3000, 1500, 0.12, 6);
    },
    // floor-sleep sigh: soft breathy exhale with a falling, weary tone (throttled)
    floorSigh() {
      if (!ready()) return;
      const now = ctx.currentTime; if (now - (SFX._lastSigh || 0) < 1.5) return; SFX._lastSigh = now;
      noise(0.7, 'lowpass', 1600, 300, 0.09, 0.7);
      tone(260, 150, 0.6, 0.05, 'sine');
    },
    // bed cracked: dry wood snap + splinter burst + low creak (throttled, SFX bus)
    bedCrack() {
      if (!ready()) return;
      const now = ctx.currentTime; if (now - (this._lastBedCrack || 0) < 0.15) return; this._lastBedCrack = now;
      tone(300 + Math.random() * 80, 120, 0.06, 0.22, 'square');
      noise(0.1, 'bandpass', 2400, 900, 0.2, 5);
      tone(90, 55, 0.35, 0.16, 'sawtooth');
      setTimeout(() => { if (ready()) tone(140, 100, 0.22, 0.08, 'triangle'); }, 90);
    },
    // bunk repaired by the workshop: two hammer knocks then a small settle tone (throttled, SFX bus)
    bunkRepair() {
      if (!ready()) return;
      const now = ctx.currentTime; if (now - (this._lastBunkRepair || 0) < 0.25) return; this._lastBunkRepair = now;
      tone(520, 300, 0.06, 0.16, 'square'); noise(0.05, 'bandpass', 2800, 1400, 0.14, 6);
      setTimeout(() => { if (ready()) { tone(560, 320, 0.06, 0.16, 'square'); noise(0.05, 'bandpass', 2800, 1400, 0.14, 6); } }, 140);
      setTimeout(() => { if (ready()) { tone(392, 392, 0.18, 0.12, 'triangle'); tone(588, 588, 0.22, 0.08, 'sine'); } }, 300);
    },
    // low-HP door warning: two-tone alarm pulse plus a metal creak (throttled)
    doorWarn() {
      if (!ready()) return;
      const now = ctx.currentTime; if (now - lastDoorWarn < 1.4) return; lastDoorWarn = now;
      tone(220, 200, 0.16, 0.3, 'square');
      setTimeout(() => { if (ready()) tone(165, 150, 0.2, 0.3, 'square'); }, 170);
      noise(0.25, 'bandpass', 700, 300, 0.12, 5);
    },
    // door impact thud; strength 0..1 (heavier hits = deeper, longer, louder). Throttled.
    doorThud(strength) {
      if (!ready()) return;
      const now = ctx.currentTime; if (now - (this._lastThud || 0) < 0.08) return; this._lastThud = now;
      const k = Math.min(1, Math.max(0.1, +strength || 0.3));
      tone(95 - 35 * k, 38, 0.14 + 0.2 * k, 0.3 + 0.5 * k, 'sine');
      noise(0.08 + 0.1 * k, 'lowpass', 500 + 500 * k, 90, 0.2 + 0.3 * k);
      noise(0.06, 'bandpass', 1500 + Math.random() * 600, 700, 0.06 + 0.12 * k, 5);
      tone(210 + Math.random() * 60, 120, 0.09 + 0.06 * k, 0.05 + 0.1 * k, 'square');
    },
    // low rumble for door impacts; intensity 0..1
    rumble(intensity) {
      if (!ready()) return;
      const now = ctx.currentTime; if (now - lastRumble < 0.12) return; lastRumble = now;
      const k = Math.min(1, Math.max(0.1, +intensity || 0.3));
      const dur = 0.25 + 0.5 * k;
      tone(55 + 15 * k, 26, dur, 0.25 + 0.55 * k, 'sine');
      noise(dur, 'lowpass', 140 + 100 * k, 40, 0.15 + 0.35 * k);
    },
    // low-health heartbeat: soft lub-dub on the SFX bus (so SFX volume and mute apply); intensity 0..1
    heartbeat(intensity) {
      if (!ready()) return;
      const now = ctx.currentTime; if (now - lastBeat < 0.3) return; lastBeat = now;
      const k = Math.min(1, Math.max(0.2, +intensity || 0.5));
      tone(62, 40, 0.14, 0.3 + 0.3 * k, 'sine');
      setTimeout(() => { if (ready()) tone(52, 36, 0.12, 0.2 + 0.25 * k, 'sine'); }, 170);
    },
    // end-screen stings (procedural, on the music/ambience bus so mute and Music volume apply)
    sting(won) {
      if (!ready() || !ambBus) return;
      this.stingStop(true);
      const t0 = ctx.currentTime + 0.15;
      const bus = ctx.createGain(); bus.gain.value = 1; bus.connect(ambBus);
      stingBus = bus;
      const note = (f, at, dur, v, type, detune, wob) => {
        const o = ctx.createOscillator(), g = ctx.createGain(), t = t0 + at;
        o.type = type; o.frequency.value = f; if (detune) o.detune.value = detune;
        if (wob) { const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = wob; lg.gain.value = f * 0.004; l.connect(lg); lg.connect(o.frequency); l.start(t); l.stop(t + dur + 0.1); }
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(v, t + Math.min(0.9, dur * 0.25));
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g); g.connect(bus); o.start(t); o.stop(t + dur + 0.05);
      };
      if (!won) {
        // slow descending A minor, last note sags and never resolves
        note(220, 0, 4.5, 0.12, 'sine');
        note(164.8, 2.6, 5, 0.12, 'triangle');
        note(130.8, 5.4, 5.5, 0.11, 'sine');
        note(110, 8.2, 6, 0.1, 'triangle');
        note(55, 0.5, 12, 0.1, 'sine');
        const o = ctx.createOscillator(), g = ctx.createGain(), t = t0 + 8.2;
        o.type = 'sine'; o.frequency.setValueAtTime(98, t); o.frequency.exponentialRampToValueAtTime(70, t + 6);
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.06, t + 1.5); g.gain.exponentialRampToValueAtTime(0.0001, t + 6);
        o.connect(g); g.connect(bus); o.start(t); o.stop(t + 6.1);
      } else {
        // sparse rising Cmaj9, soft bell-like pairs with a faint wobble; ends thin and unresolved-feeling
        const seq = [[261.6, 0], [329.6, 1.5], [392, 3], [493.9, 4.6], [587.3, 6.4]];
        seq.forEach(([f, at], i) => {
          const d = 4.5 + i * 0.4;
          note(f, at, d, 0.1, 'sine', 0, 5.5);
          note(f * 2, at, d * 0.7, 0.03, 'sine', 6, 0);
        });
        note(130.8, 0, 11, 0.07, 'triangle');
        note(783.99, 8.4, 5, 0.04, 'sine', 0, 6);
      }
    },
    stingStop(quick) {
      if (!stingBus || !ctx) return;
      const b = stingBus; stingBus = null;
      try { b.gain.cancelScheduledValues(ctx.currentTime); b.gain.setTargetAtTime(0, ctx.currentTime, quick ? 0.05 : 0.3); } catch (e) {}
      setTimeout(() => { try { b.disconnect(); } catch (e) {} }, 1500);
    },
    // narrator ducking: fade music + ambience down while a voice line plays, back up after (sits on top of mute and volume)
    duck(on) {
      on = !!on; duckWant = on;
      clearTimeout(duckWd); duckWd = on ? setTimeout(() => { duckWd = null; SFX.duck(false); }, 4000) : null;
      if (on === duckApplied) return; // repeat request: watchdog re-armed, fade already in place
      duckApplied = on;
      clearTimeout(SFX._duckFail);
      if (on) SFX._duckFail = setTimeout(() => { try { SFX.duck(false); } catch (e) {} }, 30000); // failsafe: never stay ducked if a release event is lost
      if (!ctx || !duckBus) return;
      const t = ctx.currentTime;
      try { duckBus.gain.cancelScheduledValues(t); duckBus.gain.setTargetAtTime(on ? DUCK : 1, t, on ? 0.15 : 0.8); } catch (e) {}
    },
    toggleMute() {
      muted = !muted;
      try { localStorage.setItem('ab_mute', muted ? '1' : '0'); } catch (e) {}
      if (master) master.gain.setTargetAtTime(masterG(), ctx.currentTime, 0.05);
      if (window.narrApplyVolume) window.narrApplyVolume();
      const b = document.getElementById('tMute'); if (b) b.firstChild.nodeValue = muted ? 'Sound off' : 'Sound on';
      return muted;
    },
    get muted() { return muted; },
    narrMuted() { try { return localStorage.getItem('ab_narr_mute') === '1'; } catch (e) { return false; } },
    toggleNarrMute() {
      const m = !this.narrMuted();
      try { localStorage.setItem('ab_narr_mute', m ? '1' : '0'); } catch (e) {}
      if (window.narrApplyVolume) window.narrApplyVolume();
      return m;
    },
    getVol(name) { return vol[name] === undefined ? 1 : vol[name]; },
    effVol(name) { return vol[name] === undefined ? 1 : ev(name); },
    getChMute(name) { return !!chMute[name]; },
    setChMute(name, on) {
      if (!(name in chMute)) return;
      chMute[name] = !!on;
      try { localStorage.setItem('ab_chmute', JSON.stringify(chMute)); } catch (e) {}
      if (ctx) {
        const t = ctx.currentTime;
        if (musicBus) musicBus.gain.setTargetAtTime(MUSIC * ev('music'), t, 0.03);
        if (ambBus) ambBus.gain.setTargetAtTime(ev('amb'), t, 0.03);
        if (sfxBus) sfxBus.gain.setTargetAtTime(ev('fx'), t, 0.03);
        if (uiBus) uiBus.gain.setTargetAtTime(ev('ui'), t, 0.03);
        if (master) master.gain.setTargetAtTime(masterG(), t, 0.03);
      }
      if (window.narrApplyVolume) window.narrApplyVolume();
    },
    setVol(name, v) {
      if (!(name in vol)) return;
      vol[name] = Math.min(1, Math.max(0, +v || 0));
      try { localStorage.setItem('ab_vol', JSON.stringify(vol)); } catch (e) {}
      if (ctx) {
        if (musicBus) musicBus.gain.setTargetAtTime(MUSIC * ev('music'), ctx.currentTime, 0.03);
        if (ambBus) ambBus.gain.setTargetAtTime(ev('amb'), ctx.currentTime, 0.03);
        if (master) master.gain.setTargetAtTime(masterG(), ctx.currentTime, 0.03);
        if (sfxBus) sfxBus.gain.setTargetAtTime(ev('fx'), ctx.currentTime, 0.03);
        if (uiBus) uiBus.gain.setTargetAtTime(ev('ui'), ctx.currentTime, 0.03);
      }
      if (name === 'ui') { clearTimeout(uiPrevT); uiPrevT = setTimeout(() => { if (window.SFX) window.SFX.uiHover(true); }, 120); }
      if (window.narrApplyVolume) window.narrApplyVolume();
    },
    resetVol() { for (const k in vol) this.setVol(k, 1); },
    // survivor lost: slow descending minor third + low rumble; many = deeper
    survivorLost(many) {
      if (!ready()) return;
      const now = ctx.currentTime; if (now - (this._lostT || 0) < 0.5) return; this._lostT = now;
      tone(220, 110, 1.1, 0.2, 'triangle'); tone(261.6, 130.8, 1.2, 0.14, 'sine');
      noise(0.5, 'lowpass', 400, 80, many ? 0.2 : 0.12);
      if (many) tone(110, 55, 1.4, 0.2, 'sine');
    },
    // player downed: double heartbeat thump + thin falling whine
    survivorDowned() {
      if (!ready()) return;
      const now = ctx.currentTime; if (now - (this._downT || 0) < 0.5) return; this._downT = now;
      tone(70, 45, 0.14, 0.5, 'sine');
      setTimeout(() => { if (ready()) tone(60, 40, 0.18, 0.4, 'sine'); }, 180);
      tone(520, 180, 0.6, 0.08, 'sawtooth');
    },
    // night-warning alarm sting: three descending two-tone blips on the SFX bus (follows SFX volume and mute)
    nightSting() {
      if (!ready()) return;
      const now = ctx.currentTime; if (this._nsAt && now - this._nsAt < 3) return; this._nsAt = now;
      const blip = (f0, f1, d, v, delay) => {
        const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + delay;
        o.type = 'square';
        o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f1, t + d);
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + d);
        o.connect(g); g.connect(sfxBus); o.start(t); o.stop(t + d + 0.02);
      };
      for (let i = 0; i < 3; i++) { blip(740, 700, 0.22, 0.12, i * 0.5); blip(520, 480, 0.22, 0.12, i * 0.5 + 0.24); }
    },
    // raid siren: two rising/falling wail cycles on the SFX bus (follows SFX volume and mute)
    raidSiren() {
      if (!ready()) return;
      const now = ctx.currentTime; if (this._rsAt && now - this._rsAt < 5) return; this._rsAt = now;
      const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
      o.type = 'sawtooth'; o2.type = 'square'; f.type = 'lowpass'; f.frequency.value = 1400;
      const t = now, cyc = 1.2;
      o.frequency.setValueAtTime(420, t); o2.frequency.setValueAtTime(425, t);
      for (let i = 0; i < 2; i++) {
        const a = t + i * cyc;
        o.frequency.linearRampToValueAtTime(820, a + cyc / 2); o.frequency.linearRampToValueAtTime(420, a + cyc);
        o2.frequency.linearRampToValueAtTime(828, a + cyc / 2); o2.frequency.linearRampToValueAtTime(425, a + cyc);
      }
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.1, t + 0.1);
      g.gain.setValueAtTime(0.1, t + cyc * 2 - 0.3); g.gain.exponentialRampToValueAtTime(0.001, t + cyc * 2);
      o.connect(f); o2.connect(f); f.connect(g); g.connect(sfxBus);
      o.start(t); o2.start(t); o.stop(t + cyc * 2 + 0.05); o2.stop(t + cyc * 2 + 0.05);
    },
    preview() { if (ready()) this.turret('rifle'); },
    // st: { scene, alarm } while playing, or null (menu / paused / game over)
    update(dt, st) {
      if (!ctx || ctx.state !== 'running') return;
      const t = ctx.currentTime;
      // music bed
      chordT -= dt;
      if (chordT <= 0) { chordT = 8; playChord(CHORDS[chordI++ % CHORDS.length]); }
      // hum
      humGain.gain.setTargetAtTime(st ? (st.scene === 'scav' ? HUM * 0.25 : HUM) : 0, t, 0.4);
      // drone: threat 0..1 from alarm, active raid and live spawns
      let threat = 0;
      if (st) {
        threat = (st.raid ? 0.6 : st.alarm ? 0.4 : 0) + Math.min(0.2, ((st.spawns || 0) + (st.foes || 0)) * 0.04)
          + (st.night ? 0.25 : 0) + Math.min(0.15, (st.raids || 0) * 0.015);
        threat = Math.min(1, threat);
      }
      droneK += (threat - droneK) * Math.min(1, dt * 0.8);
      // power-out: pitch, gain and brightness sag while the generator is dead (slow ease in and out)
      droneP += ((st && st.powerOut ? 1 : 0) - droneP) * Math.min(1, dt * 0.5);
      const dLevel = st ? DRONE * (0.35 + 0.65 * droneK) * (1 - 0.3 * droneP) * (st.scene === 'scav' ? 0.25 : 1) : 0;
      droneGain.gain.setTargetAtTime(dLevel, t, 0.5);
      droneFilt.frequency.setTargetAtTime((110 + 210 * droneK) * (1 - 0.3 * droneP), t, 0.5);
      for (const [o, f] of droneOsc) o.frequency.setTargetAtTime(f * (1 - 0.14 * droneP), t, 0.8);
      // tension music: silent in calm, swells with raid threat and power-out, tremolo quickens, pitch sags without power
      if (tensGain) {
        const tk = Math.max(0, (droneK - 0.3) / 0.7);
        const tLevel = st ? Math.min(1, tk + 0.5 * droneP) * TENS * (st.scene === 'scav' ? 0.3 : 1) : 0;
        tensGain.gain.setTargetAtTime(tLevel, t, 1.2);
        tensLfo.frequency.setTargetAtTime(0.5 + 3.5 * tk + 1.0 * droneP, t, 0.8);
        for (const [o, f] of tensOsc) o.frequency.setTargetAtTime(f * (1 - 0.08 * droneP), t, 1.0);
      }
      // topside ambience: wind + sub bed fade in only in the scav scene; rumbles on a random timer (skipped while muted)
      const topside = !!(st && st.scene === 'scav');
      const windK = 1; // level comes from ambBus (Ambience slider); Music slider no longer scales wind
      if (windFade) windFade.gain.setTargetAtTime(topside ? 0.16 * windK : 0, t, topside ? 1.2 : 0.5);
      if (subFade) subFade.gain.setTargetAtTime(topside ? 0.05 * windK : 0, t, topside ? 1.2 : 0.5);
      if (topside) {
        rumbleT -= dt;
        if (rumbleT <= 0) { rumbleT = 14 + Math.random() * 20; if (!muted && windBuf) distantRumble(); }
      } else rumbleT = Math.max(rumbleT, 8);
      // gusts: random swell + brighter filter for 2-5s, then settle back
      if (topside && gustG) {
        gustT -= dt;
        if (gustT <= 0) {
          gustT = 4 + Math.random() * 11;
          const s = 0.4 + Math.random() * 0.6, dur = 2 + Math.random() * 3;
          gustG.gain.cancelScheduledValues(t); gustG.gain.setTargetAtTime(1 + 1.3 * s, t, dur * 0.25); gustG.gain.setTargetAtTime(1, t + dur * 0.45, dur * 0.3);
          gustF.detune.cancelScheduledValues(t); gustF.detune.setTargetAtTime(700 * s, t, dur * 0.25); gustF.detune.setTargetAtTime(0, t + dur * 0.45, dur * 0.3);
        }
      } else if (gustG) {
        gustT = Math.max(gustT, 3);
        gustG.gain.setTargetAtTime(1, t, 0.3); gustF.detune.setTargetAtTime(0, t, 0.3);
      }
      // bunker night ambience: sparse muffled thuds from far above (skipped while muted)
      const night = !!(st && st.scene === 'bunker' && st.night);
      if (night) {
        if (!wasNight) thudT = 5 + Math.random() * 8;
        thudT -= dt;
        if (thudT <= 0) {
          thudT = 11 + Math.random() * 20;
          if (!muted) { distantThud(false, 0); if (Math.random() < 0.35) distantThud(true, 0.35 + Math.random() * 0.45); }
        }
      }
      wasNight = night;
      // bunker ambience: irregular drips and rare far-off rumbles (not while muted, not topside)
      if (st && st.scene === 'bunker') {
        dripT -= dt;
        if (dripT <= 0) {
          dripT = 2.5 + Math.random() * 7;
          if (!muted && noiseBuf) drip();
          if (Math.random() < 0.25) dripT += 0.4 + Math.random() * 0.5;
        }
        bunkRumbleT -= dt;
        if (bunkRumbleT <= 0) {
          bunkRumbleT = 25 + Math.random() * 35;
          if (!muted && windBuf) distantRumble(0.45);
        }
      } else { dripT = Math.max(dripT, 2); bunkRumbleT = Math.max(bunkRumbleT, 15); }
      // bunker machinery: generator chug + vent hum follow power; creaks get rarer and softer while powered
      if (genGain) {
        const inBunker = !!(st && st.scene === 'bunker'), pw = inBunker && !!st.powered;
        genK += ((pw ? 1 : 0) - genK) * Math.min(1, dt * 1.5);
        ventK += ((pw ? 1 : 0) - ventK) * Math.min(1, dt * 1.5);
        genGain.gain.setTargetAtTime(GEN * genK, t, 0.3);
        ventGain.gain.setTargetAtTime(VENT * ventK, t, 0.4);
        const gf = 18 + 20 * genK;
        genOsc.frequency.setTargetAtTime(gf, t, 0.3); genOsc2.frequency.setTargetAtTime(gf / 2, t, 0.3);
        if (inBunker) {
          creakT -= dt;
          if (creakT <= 0) {
            creakT = pw ? 9 + Math.random() * 13 : 5 + Math.random() * 7;
            if (!muted) creak(pw ? 0.6 : 1);
          }
        } else creakT = Math.max(creakT, 6);
      }
      // siren: sounds when the alarm goes on, fades after SIREN_SECS
      const alarm = !!(st && st.alarm);
      if (alarm && !wasAlarm) sirenT = SIREN_SECS;
      wasAlarm = alarm;
      if (alarm && sirenT > 0) {
        sirenT -= dt;
        const ph = (SIREN_SECS - sirenT) * 0.9;
        sirenOsc.frequency.setTargetAtTime(480 + 320 * (0.5 + 0.5 * Math.sin(ph * Math.PI * 2 * 0.5)), t, 0.03);
        sirenGain.gain.setTargetAtTime(sirenT > 0.8 ? SIREN : 0, t, 0.15);
      } else sirenGain.gain.setTargetAtTime(0, t, 0.1);
    }
  };
  // ---- global UI sound hooks (delegated, so every current and future button/menu is covered) ----
  (function uiHooks() {
    const SEL = 'button, [role="button"], a[href], summary';
    const isOff = el => el.disabled || el.getAttribute('aria-disabled') === 'true';
    let lastErr = 0;
    const err = () => {
      const n = Date.now(); if (n - lastErr < 250) return; lastErr = n;
      if (window.SFX) window.SFX.uiError();
    };
    // first gesture creates/resumes the AudioContext so the very first click is audible
    document.addEventListener('pointerdown', e => {
      init();
      const el = e.target && e.target.closest && e.target.closest(SEL);
      if (el && isOff(el)) err();
    }, true);
    // hover/click/open/close sounds are handled by uiSoundHooks() in game.js
  })();
  document.addEventListener('DOMContentLoaded', () => { const b = document.getElementById('tMute'); if (b) b.firstChild.nodeValue = muted ? 'Sound off' : 'Sound on'; });
})();
