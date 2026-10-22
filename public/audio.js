// Ashfall Bunker: procedural sound (WebAudio, no asset files).
// SFX.turret(type), SFX.hit(what), SFX.death(kind), SFX.update(dt, state|null), SFX.toggleMute()
(function () {
  const MASTER = 0.6, MUSIC = 0.05, HUM = 0.035, SIREN = 0.07, SIREN_SECS = 9;
  let ctx = null, master, musicBus, sfxBus, uiBus, ambBus, humGain, sirenGain, sirenOsc, noiseBuf;
  let muted = false;
  try { muted = localStorage.getItem('ab_mute') === '1'; } catch (e) {}
  const vol = { music: 1, narr: 1, fx: 1, ui: 1 };
  try { const p = JSON.parse(localStorage.getItem('ab_vol') || '{}') || {}; for (const k in vol) if (typeof p[k] === 'number' && isFinite(p[k])) vol[k] = Math.min(1, Math.max(0, p[k])); } catch (e) {}
  let chordT = 0, chordI = 0, sirenT = 0, wasAlarm = false, lastShot = 0, lastHit = 0, lastRumble = 0, lastRepair = 0, lastClick = 0, lastDeath = 0, lastStep = 0, lastJump = 0, lastLand = 0, stepAlt = false;

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = muted ? 0 : MASTER; master.connect(ctx.destination);
    musicBus = ctx.createGain(); musicBus.gain.value = MUSIC * vol.music;
    sfxBus = ctx.createGain(); sfxBus.gain.value = vol.fx; sfxBus.connect(master);
    uiBus = ctx.createGain(); uiBus.gain.value = vol.ui; uiBus.connect(master);
    ambBus = ctx.createGain(); ambBus.gain.value = vol.music; ambBus.connect(master);
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
    // siren
    sirenGain = ctx.createGain(); sirenGain.gain.value = 0;
    const sf = ctx.createBiquadFilter(); sf.type = 'lowpass'; sf.frequency.value = 1100;
    sirenOsc = ctx.createOscillator(); sirenOsc.type = 'square'; sirenOsc.frequency.value = 500;
    sirenOsc.connect(sf); sf.connect(sirenGain); sirenGain.connect(sfxBus);
    sirenOsc.start();
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
      noise(0.07, 'bandpass', (stepAlt ? 700 : 560) + Math.random() * 200, 220, stepAlt ? 0.16 : 0.11, 1.2);
      tone(stepAlt ? 90 : 75, 45, 0.06, stepAlt ? 0.1 : 0.07, 'sine');
    },
    jump() {
      if (!ready()) return;
      const now = ctx.currentTime; if (now - lastJump < 0.08) return; lastJump = now;
      tone(220, 420, 0.1, 0.1, 'triangle');
      noise(0.09, 'bandpass', 900, 1800, 0.1, 1);
    },
    // speed = downward speed in px/s at impact
    land(speed) {
      if (!ready()) return;
      const now = ctx.currentTime; if (now - lastLand < 0.1) return; lastLand = now;
      const k = Math.min(1, Math.max(0.15, (+speed || 0) / 700));
      noise(0.1 + 0.12 * k, 'lowpass', 900 + 400 * k, 120, 0.15 + 0.3 * k);
      tone(110 - 30 * k, 40, 0.1 + 0.1 * k, 0.12 + 0.35 * k, 'sine');
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
    // low rumble for door impacts; intensity 0..1
    rumble(intensity) {
      if (!ready()) return;
      const now = ctx.currentTime; if (now - lastRumble < 0.12) return; lastRumble = now;
      const k = Math.min(1, Math.max(0.1, +intensity || 0.3));
      const dur = 0.25 + 0.5 * k;
      tone(55 + 15 * k, 26, dur, 0.25 + 0.55 * k, 'sine');
      noise(dur, 'lowpass', 140 + 100 * k, 40, 0.15 + 0.35 * k);
    },
    toggleMute() {
      muted = !muted;
      try { localStorage.setItem('ab_mute', muted ? '1' : '0'); } catch (e) {}
      if (master) master.gain.setTargetAtTime(muted ? 0 : MASTER, ctx.currentTime, 0.05);
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
        if (ambBus) ambBus.gain.setTargetAtTime(vol.music, ctx.currentTime, 0.03);
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
