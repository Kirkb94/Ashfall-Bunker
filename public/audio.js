// Ashfall Bunker: procedural sound (WebAudio, no asset files).
// SFX.turret(type), SFX.hit(what), SFX.death(kind), SFX.update(dt, state|null), SFX.toggleMute()
(function () {
  const MASTER = 0.6, MUSIC = 0.05, HUM = 0.035, SIREN = 0.07, SIREN_SECS = 9;
  let ctx = null, master, musicBus, sfxBus, uiBus, ambBus, humGain, sirenGain, sirenOsc, noiseBuf;
  let windFade = null, subFade = null, windBuf = null, rumbleT = 12, thudT = 8, wasNight = false;
  let droneGain, droneFilt, droneK = 0, stingBus = null;
  const DRONE = 0.05;
  let muted = false;
  try { muted = localStorage.getItem('ab_mute') === '1'; } catch (e) {}
  const vol = { master: 1, music: 1, amb: 1, narr: 1, fx: 1, ui: 1 };
  try { const p = JSON.parse(localStorage.getItem('ab_vol') || '{}') || {}; for (const k in vol) if (typeof p[k] === 'number' && isFinite(p[k])) vol[k] = Math.min(1, Math.max(0, p[k])); if (typeof p.amb !== 'number' && typeof p.music === 'number') vol.amb = vol.music; } catch (e) {}
  let chordT = 0, chordI = 0, sirenT = 0, wasAlarm = false, lastShot = 0, lastHit = 0, lastRumble = 0, lastDoorWarn = 0, lastRepair = 0, lastClick = 0, lastDeath = 0, lastStep = 0, lastJump = 0, lastLand = 0, stepAlt = false;

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = muted ? 0 : MASTER * vol.master; master.connect(ctx.destination);
    musicBus = ctx.createGain(); musicBus.gain.value = MUSIC * vol.music;
    sfxBus = ctx.createGain(); sfxBus.gain.value = vol.fx; sfxBus.connect(master);
    uiBus = ctx.createGain(); uiBus.gain.value = vol.ui; uiBus.connect(master);
    ambBus = ctx.createGain(); ambBus.gain.value = vol.amb; ambBus.connect(master);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    musicBus.connect(lp); lp.connect(master);
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
    // siren
    sirenGain = ctx.createGain(); sirenGain.gain.value = 0;
    const sf = ctx.createBiquadFilter(); sf.type = 'lowpass'; sf.frequency.value = 1100;
    sirenOsc = ctx.createOscillator(); sirenOsc.type = 'square'; sirenOsc.frequency.value = 500;
    sirenOsc.connect(sf); sf.connect(sirenGain); sirenGain.connect(sfxBus);
    sirenOsc.start();
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
    ws.connect(wbp); wbp.connect(wSwell); wSwell.connect(windFade); windFade.connect(ambBus);
    ws.start(); wl1.start(); wl2.start();
    // constant sub-bass bed under the wind
    const ss = ctx.createBufferSource(); ss.buffer = windBuf; ss.loop = true;
    const slp = ctx.createBiquadFilter(); slp.type = 'lowpass'; slp.frequency.value = 70;
    subFade = ctx.createGain(); subFade.gain.value = 0;
    ss.connect(slp); slp.connect(subFade); subFade.connect(ambBus);
    ss.start();
  }
  // one distant rumble: slow swell and long decay on the ambient bus
  function distantRumble() {
    const t = ctx.currentTime, dur = 4 + Math.random() * 2.5, peak = 0.35 + Math.random() * 0.3;
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

  window.SFX = {
    // for narrator.js: the shared AudioContext (created and resumed on the first click or key press)
    unlock() { init(); return ctx; },
    get ctx() { return ctx; },
    turret(type) {
      if (!ready()) return;
      const now = ctx.currentTime; if (now - lastShot < 0.05) return; lastShot = now;
      if (type === 'rifle') { noise(0.12, 'bandpass', 2600, 500, 0.35, 0.8); tone(180, 60, 0.1, 0.3, 'triangle'); }
      else if (type === 'coil') { noise(0.18, 'bandpass', 3200, 900, 0.3, 3); tone(900, 140, 0.16, 0.2, 'sawtooth'); tone(60, 40, 0.2, 0.3, 'sine'); }
      else { noise(0.22, 'lowpass', 1800, 200, 0.5); tone(120, 40, 0.18, 0.45, 'sine'); }
    },
    hit(what) {
      if (!ready()) return;
      const now = ctx.currentTime; if (now - lastHit < 0.07) return; lastHit = now;
      if (what === 'door') { tone(95, 38, 0.3, 0.7, 'sine'); noise(0.18, 'lowpass', 500, 120, 0.4); tone(420 + Math.random() * 80, 230, 0.22, 0.14, 'square'); noise(0.14, 'bandpass', 2200, 900, 0.18, 5); }
      else { noise(0.2, 'bandpass', 1400, 600, 0.25, 6); tone(320, 200, 0.12, 0.15, 'square'); }
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
    // speed = downward speed in px/s at impact
    land(speed) {
      if (!ready()) return;
      const now = ctx.currentTime; if (now - lastLand < 0.1) return; lastLand = now;
      const k = Math.min(1, Math.max(0.15, (+speed || 0) / 700));
      noise(0.1 + 0.12 * k, 'lowpass', 900 + 400 * k, 120, (0.15 + 0.3 * k) * FOLEY.land);
      tone(110 - 30 * k, 40, 0.1 + 0.1 * k, (0.12 + 0.35 * k) * FOLEY.land, 'sine');
    },
    // ---- UI sounds (all on the UI bus) ----
    uiHover(force) {
      if (!ready()) return;
      const now = ctx.currentTime; if (!force && now - lastUiHover < 0.03) return; lastUiHover = now;
      uiTone(2200, 1900, 0.03, 0.05, 'square');
    },
    uiPlace() {
      if (!ready()) return;
      uiTone(180, 90, 0.12, 0.3, 'sine');
      uiTone(520, 520, 0.09, 0.12, 'triangle', 0.05);
      uiTone(780, 780, 0.14, 0.12, 'triangle', 0.12);
    },
    uiError() {
      if (!ready()) return;
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
    // short UI click (throttled)
    click() {
      if (!ready()) return;
      const now = ctx.currentTime; if (now - lastClick < 0.04) return; lastClick = now;
      uiTone(1400, 900, 0.04, 0.12, 'square');
      setTimeout(() => { if (ready()) uiTone(900, 700, 0.05, 0.08, 'triangle'); }, 35);
    },
    // door torn open: deep boom, metal tear, descending groan
    breach() {
      if (!ready()) return;
      tone(70, 24, 0.9, 0.9, 'sine');
      noise(0.7, 'lowpass', 900, 80, 0.6);
      noise(0.5, 'bandpass', 2400, 300, 0.3, 4);
      tone(260, 70, 0.7, 0.2, 'sawtooth');
    },
    // workshop repair clank (throttled); 'seal' = hatch sealed again chime
    repair(kind) {
      if (!ready()) return;
      const now = ctx.currentTime;
      if (kind === 'seal') { tone(520, 520, 0.14, 0.18, 'triangle'); setTimeout(() => { if (ready()) tone(780, 780, 0.22, 0.18, 'triangle'); }, 120); noise(0.12, 'bandpass', 1800, 900, 0.15, 4); return; }
      if (now - lastRepair < 0.3) return; lastRepair = now;
      tone(700 + Math.random() * 200, 420, 0.07, 0.1, 'square');
      noise(0.08, 'bandpass', 3000, 1500, 0.12, 6);
    },
    // low-HP door warning: two-tone alarm pulse plus a metal creak (throttled)
    doorWarn() {
      if (!ready()) return;
      const now = ctx.currentTime; if (now - lastDoorWarn < 1.4) return; lastDoorWarn = now;
      tone(220, 200, 0.16, 0.3, 'square');
      setTimeout(() => { if (ready()) tone(165, 150, 0.2, 0.3, 'square'); }, 170);
      noise(0.25, 'bandpass', 700, 300, 0.12, 5);
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
    toggleMute() {
      muted = !muted;
      try { localStorage.setItem('ab_mute', muted ? '1' : '0'); } catch (e) {}
      if (master) master.gain.setTargetAtTime(muted ? 0 : MASTER * vol.master, ctx.currentTime, 0.05);
      if (window.narrApplyVolume) window.narrApplyVolume();
      const b = document.getElementById('tMute'); if (b) b.firstChild.nodeValue = muted ? 'Sound off' : 'Sound on';
      return muted;
    },
    get muted() { return muted; },
    getVol(name) { return vol[name] === undefined ? 1 : vol[name]; },
    setVol(name, v) {
      if (!(name in vol)) return;
      vol[name] = Math.min(1, Math.max(0, +v || 0));
      try { localStorage.setItem('ab_vol', JSON.stringify(vol)); } catch (e) {}
      if (ctx) {
        if (musicBus) musicBus.gain.setTargetAtTime(MUSIC * vol.music, ctx.currentTime, 0.03);
        if (ambBus) ambBus.gain.setTargetAtTime(vol.amb, ctx.currentTime, 0.03);
        if (master) master.gain.setTargetAtTime(muted ? 0 : MASTER * vol.master, ctx.currentTime, 0.03);
        if (sfxBus) sfxBus.gain.setTargetAtTime(vol.fx, ctx.currentTime, 0.03);
        if (uiBus) uiBus.gain.setTargetAtTime(vol.ui, ctx.currentTime, 0.03);
      }
      if (name === 'ui') { clearTimeout(uiPrevT); uiPrevT = setTimeout(() => { if (window.SFX) window.SFX.uiHover(true); }, 120); }
      if (window.narrApplyVolume) window.narrApplyVolume();
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
        threat = (st.raid ? 0.8 : st.alarm ? 0.5 : 0) + Math.min(0.2, (st.spawns || 0) * 0.04);
        threat = Math.min(1, threat);
      }
      droneK += (threat - droneK) * Math.min(1, dt * 0.8);
      const dLevel = st ? DRONE * (0.35 + 0.65 * droneK) * (st.scene === 'scav' ? 0.25 : 1) : 0;
      droneGain.gain.setTargetAtTime(dLevel, t, 0.5);
      droneFilt.frequency.setTargetAtTime(110 + 210 * droneK, t, 0.5);
      // topside ambience: wind + sub bed fade in only in the scav scene; rumbles on a random timer (skipped while muted)
      const topside = !!(st && st.scene === 'scav');
      if (windFade) windFade.gain.setTargetAtTime(topside ? 0.16 : 0, t, topside ? 1.2 : 0.5);
      if (subFade) subFade.gain.setTargetAtTime(topside ? 0.05 : 0, t, topside ? 1.2 : 0.5);
      if (topside) {
        rumbleT -= dt;
        if (rumbleT <= 0) { rumbleT = 14 + Math.random() * 20; if (!muted && windBuf) distantRumble(); }
      } else rumbleT = Math.max(rumbleT, 8);
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
  document.addEventListener('DOMContentLoaded', () => { const b = document.getElementById('tMute'); if (b) b.firstChild.nodeValue = muted ? 'Sound off' : 'Sound on'; });
})();
