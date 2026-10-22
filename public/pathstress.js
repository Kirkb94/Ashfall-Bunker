// PathStress: 100-crew mass re-path stress test for BunkerGraph (toggle with the 'Path stress' toolbar button).
// Builds a synthetic multi-floor graph (does not touch game state). Each frame it invalidates the graph
// (flips one random edge, bumping graph.version) and re-paths every crew member, then reports timing.
// Works as a browser global (window.PathStress) and as a CommonJS module for tests.
(function (root) {
  'use strict';
  var BG = (typeof module !== 'undefined' && module.exports) ? require('./bunkergraph.js').BunkerGraph : root.BunkerGraph;
  var now = (typeof performance !== 'undefined' && performance.now) ? function () { return performance.now(); } : function () { return Date.now(); };

  // Small deterministic RNG so runs are repeatable.
  function rng(seed) { var s = seed >>> 0 || 1; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

  // floors x cols rooms; walk edges along each floor, ladders at both ends and the middle between floors.
  function buildGraph(floors, cols) {
    var g = new BG();
    var id = function (f, c) { return f + ',' + c; };
    for (var f = 0; f < floors; f++) for (var c = 0; c < cols; c++) g.addNode(id(f, c), { x: c * 10, y: f * 6 });
    var ladders = [0, cols >> 1, cols - 1];
    for (f = 0; f < floors; f++) {
      for (c = 0; c < cols; c++) {
        if (c + 1 < cols) g.addEdge(id(f, c), id(f, c + 1), 10, { kind: 'walk' });
        if (f + 1 < floors && ladders.indexOf(c) >= 0) g.addEdge(id(f, c), id(f + 1, c), 14, { kind: 'ladder', cap: 2 });
      }
    }
    return g;
  }

  function create(opts) {
    opts = opts || {};
    var floors = opts.floors || 8, cols = opts.cols || 14, crewN = opts.crew || 100;
    var r = rng(opts.seed || 1234);
    var g = buildGraph(floors, cols);
    var ids = Array.from(g.nodes.keys());
    var edges = [];
    for (var e of g.adj) for (var b of e[1].keys()) if (e[0] < b) edges.push([e[0], b]);
    var crew = [];
    for (var i = 0; i < crewN; i++) crew.push({ from: ids[(r() * ids.length) | 0], to: ids[(r() * ids.length) | 0], path: [] });
    var closed = []; // edges currently blocked by the test
    var st = { frames: 0, lastMs: 0, maxMs: 0, avgMs: 0, lastExp: 0, failed: 0, truncated: 0, stale: 0, version: 0, crew: crewN, nodes: ids.length };

    // One stress step: churn the graph, then re-path everyone.
    function step() {
      var t0 = now();
      // invalidate: block one random edge, and re-open the oldest blocked ones so the graph stays connected-ish
      var ed = edges[(r() * edges.length) | 0];
      g.updateEdge(ed[0], ed[1], { blocked: true });
      closed.push(ed);
      while (closed.length > 6) { var o = closed.shift(); g.updateEdge(o[0], o[1], { blocked: false }); }
      var exp = 0, failed = 0, trunc = 0, stale = 0;
      var budget = opts.maxExpansions || 0;
      for (var i = 0; i < crew.length; i++) {
        var c = crew[i];
        if (c.from === c.to || r() < 0.05) { c.from = ids[(r() * ids.length) | 0]; c.to = ids[(r() * ids.length) | 0]; }
        var res = g.findPath(c.from, c.to, budget ? { maxExpansions: budget } : undefined);
        exp += res.expansions;
        if (res.version !== g.version) stale++;
        if (res.truncated) trunc++;
        if (!res.found) failed++;
        c.path = res.path;
      }
      var ms = now() - t0;
      st.frames++; st.lastMs = ms; st.maxMs = Math.max(st.maxMs, ms);
      st.avgMs += (ms - st.avgMs) / Math.min(st.frames, 120);
      st.lastExp = exp; st.failed = failed; st.truncated = trunc; st.stale = stale; st.version = g.version;
      return st;
    }
    return { graph: g, crew: crew, stats: st, step: step, reset: function () { st.frames = 0; st.maxMs = 0; st.avgMs = 0; } };
  }

  function format(s) {
    return 'PATH STRESS  ' + s.crew + ' crew / ' + s.nodes + ' rooms\n' +
      'frame ' + s.lastMs.toFixed(2) + ' ms  avg ' + s.avgMs.toFixed(2) + '  max ' + s.maxMs.toFixed(2) + '\n' +
      'expansions ' + s.lastExp + '  no-route ' + s.failed + '  truncated ' + s.truncated + '\n' +
      'graph.version ' + s.version + '  frames ' + s.frames;
  }

  var api = { create: create, buildGraph: buildGraph, format: format };

  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }

  // ---- browser wiring ----
  var run = null, box = null, raf = 0, textT = 0, KEY = 'ab_path_stress';
  function applyBtn() {
    var b = document.getElementById('tPathStress');
    if (b) { b.classList.toggle('on', !!run); b.setAttribute('aria-pressed', run ? 'true' : 'false'); }
  }
  function loop(t) {
    if (!run) return;
    try {
      run.step();
      if (t - textT > 250) { textT = t; box.textContent = format(run.stats); }
    } catch (e) { stop(); if (box) { box.hidden = false; box.textContent = 'PathStress error: ' + (e && e.message || e); } return; }
    raf = requestAnimationFrame(loop);
  }
  function start() {
    if (run) return;
    run = create();
    if (!box) {
      box = document.createElement('pre');
      box.id = 'pathStressBox';
      box.setAttribute('role', 'status');
      box.style.cssText = 'position:fixed;left:8px;top:8px;z-index:50;margin:0;padding:6px 8px;background:rgba(0,0,0,.75);color:#7fffa8;font:11px/1.35 monospace;border:1px solid #2a5a3a;pointer-events:none;white-space:pre';
      document.body.appendChild(box);
    }
    box.hidden = false; box.textContent = 'starting...';
    applyBtn();
    raf = requestAnimationFrame(loop);
  }
  function stop() {
    run = null; cancelAnimationFrame(raf);
    if (box) box.hidden = true;
    applyBtn();
  }
  function toggle() { if (run) stop(); else start(); try { localStorage.setItem(KEY, run ? '1' : '0'); } catch (e) {} }
  api.start = start; api.stop = stop; api.toggle = toggle;
  root.PathStress = api;
  var btn = document.getElementById('tPathStress');
  var devOn = false;
  try { devOn = /(^|[?&])dev(=|&|$)/.test(root.location ? root.location.search : ''); } catch (e) {}
  if (btn && devOn) btn.hidden = false;
  if (btn && devOn) btn.onclick = function (e) { toggle(); e.currentTarget.blur(); };
  applyBtn();
})(typeof window !== 'undefined' ? window : this);
