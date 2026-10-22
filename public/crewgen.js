// Trait and past-job tables for generated crew. Browser global (window.CrewGen) and CommonJS module.
// Effects are one-time offsets applied at generation: stats {acc,build,cook,med,tech}, hp, loyalty.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CrewGen = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  const PAST_JOBS = {
    mechanic: { label: 'Mechanic', stats: { build: 0.2, tech: 0.15 } },
    nurse: { label: 'Nurse', stats: { med: 0.3, cook: 0.05 } },
    soldier: { label: 'Soldier', stats: { acc: 0.3 }, hp: 8 },
    cook: { label: 'Cook', stats: { cook: 0.3 } },
    courier: { label: 'Courier', stats: { acc: 0.05, tech: 0.05 }, hp: 5 },
    teacher: { label: 'Teacher', stats: { med: 0.1, tech: 0.1 }, loyalty: 0.1 },
    engineer: { label: 'Engineer', stats: { tech: 0.3, build: 0.1 } },
    farmhand: { label: 'Farmhand', stats: { cook: 0.15, build: 0.1 }, hp: 5 },
    scavenger: { label: 'Scavenger', stats: { build: 0.1, acc: 0.1 }, hp: 3 },
    clerk: { label: 'Clerk', stats: { tech: 0.1 }, loyalty: 0.05 },
  };

  // excl: trait ids that cannot be rolled together with this one.
  const TRAITS = {
    steady: { label: 'Steady Hands', desc: '+aim, +medic', stats: { acc: 0.12, med: 0.08 }, excl: ['nervous'] },
    quick: { label: 'Quick Learner', desc: '+build, +tech', stats: { build: 0.08, tech: 0.08 }, excl: [] },
    nervous: { label: 'Nervous', desc: '-aim, -loyalty', stats: { acc: -0.12 }, loyalty: -0.1, excl: ['steady', 'brave'] },
    loyal: { label: 'Loyal', desc: '+loyalty', loyalty: 0.2, excl: ['cynic', 'restless'] },
    restless: { label: 'Restless', desc: '-loyalty, +build', stats: { build: 0.1 }, loyalty: -0.15, excl: ['loyal'] },
    brave: { label: 'Brave', desc: '+aim, +health', stats: { acc: 0.08 }, hp: 8, excl: ['nervous'] },
    frail: { label: 'Frail', desc: '-health', hp: -15, excl: ['hardy'] },
    hardy: { label: 'Hardy', desc: '+health', hp: 15, excl: ['frail'] },
    glutton: { label: 'Glutton', desc: 'flavour for now: eats a lot', excl: [] },
    cynic: { label: 'Cynic', desc: '-loyalty, +tech', stats: { tech: 0.08 }, loyalty: -0.15, excl: ['loyal'] },
  };

  const STATS = ['acc', 'build', 'cook', 'med', 'tech'];
  const ROLE = { acc: 'Shooter', build: 'Builder', cook: 'Cook', med: 'Medic', tech: 'Tinkerer' };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const r2 = v => Math.round(v * 100) / 100;
  const pickKey = (rng, obj, exclude) => {
    const keys = Object.keys(obj).filter(k => !exclude(k));
    return keys.length ? keys[Math.floor(rng() * keys.length)] : null;
  };

  // rng: function returning [0,1). Returns { stats, hp, loyalty, traits: [ids], past: id, role }.
  function generate(rng) {
    rng = rng || Math.random;
    const stats = {};
    for (const k of STATS) stats[k] = 0.4 + rng() * 0.75;
    let hp = Math.round(80 + rng() * 25);
    let loyalty = 0.25 + rng() * 0.65;
    const past = pickKey(rng, PAST_JOBS, () => false);
    const traits = [];
    const want = rng() < 0.35 ? 2 : 1;
    while (traits.length < want) {
      const t = pickKey(rng, TRAITS, k => traits.includes(k) || traits.some(o => TRAITS[o].excl.includes(k) || TRAITS[k].excl.includes(o)));
      if (!t) break;
      traits.push(t);
    }
    const apply = d => {
      if (d.stats) for (const k in d.stats) stats[k] += d.stats[k];
      hp += d.hp || 0; loyalty += d.loyalty || 0;
    };
    apply(PAST_JOBS[past]);
    traits.forEach(t => apply(TRAITS[t]));
    for (const k of STATS) stats[k] = r2(clamp(stats[k], 0.2, 1.5));
    const best = STATS.slice().sort((a, b) => stats[b] - stats[a])[0];
    return { stats, hp: Math.max(40, Math.round(hp)), loyalty: r2(clamp(loyalty, 0.05, 1)), traits, past, role: ROLE[best] };
  }

  // Display info for a crew member (safe on old saves with no traits/past).
  function describe(c) {
    const p = c && PAST_JOBS[c.past];
    const ts = ((c && c.traits) || []).filter(t => TRAITS[t]).map(t => ({ id: t, label: TRAITS[t].label, desc: TRAITS[t].desc }));
    return { past: p ? p.label : null, traits: ts };
  }

  return { PAST_JOBS, TRAITS, generate, describe };
});
