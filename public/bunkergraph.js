// BunkerGraph: room-level navigation graph with a version counter and A* pathfinding.
// Works as a browser global (window.BunkerGraph) and as a CommonJS module for tests.
(function (root) {
  'use strict';

  // Minimal binary min-heap keyed by f, ties broken by insertion order for determinism.
  class MinHeap {
    constructor() { this.a = []; this.n = 0; }
    get size() { return this.a.length; }
    _less(x, y) { return x.f < y.f || (x.f === y.f && x.s < y.s); }
    push(id, f) {
      const a = this.a;
      a.push({ id, f, s: this.n++ });
      let i = a.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (!this._less(a[i], a[p])) break;
        [a[i], a[p]] = [a[p], a[i]];
        i = p;
      }
    }
    pop() {
      const a = this.a;
      const top = a[0], last = a.pop();
      if (a.length) {
        a[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < a.length && this._less(a[l], a[m])) m = l;
          if (r < a.length && this._less(a[r], a[m])) m = r;
          if (m === i) break;
          [a[i], a[m]] = [a[m], a[i]];
          i = m;
        }
      }
      return top;
    }
  }

  class BunkerGraph {
    constructor() {
      this.nodes = new Map(); // id -> { id, x?, y?, blocked, ...data }
      this.adj = new Map();   // id -> Map(toId -> edge)
      this.version = 0;       // bumped on every real change; caches key off this
      this._hv = -1;          // version the heuristic scale was computed for
      this._hScale = 0;
      this._cc = { v: -1, rows: new Map(), hits: 0, misses: 0, rebuilds: 0 }; // room cost cache
    }

    _bump() { this.version++; }

    hasNode(id) { return this.nodes.has(id); }
    getNode(id) { return this.nodes.get(id) || null; }
    neighbors(id) { const m = this.adj.get(id); return m ? Array.from(m.keys()) : []; }
    getEdge(a, b) { const m = this.adj.get(a); return (m && m.get(b)) || null; }

    // data may hold x, y (for the A* heuristic) and anything else the game wants.
    addNode(id, data) {
      const old = this.nodes.get(id);
      const node = Object.assign({}, old || {}, data || {}, { id, blocked: !!((data && data.blocked) || (old && old.blocked && !(data && 'blocked' in data))) });
      this.nodes.set(id, node);
      if (!this.adj.has(id)) this.adj.set(id, new Map());
      this._bump();
      return node;
    }

    removeNode(id) {
      if (!this.nodes.has(id)) return false;
      for (const to of this.neighbors(id)) { const m = this.adj.get(to); if (m) m.delete(id); }
      this.adj.delete(id);
      this.nodes.delete(id);
      this._bump();
      return true;
    }

    // Adds an edge a->b (and b->a unless opts.oneWay). opts: { kind, cap, blocked }.
    // kind is free text such as 'door' or 'ladder'; cap is portal capacity for the queueing task.
    addEdge(a, b, cost, opts) {
      if (!this.nodes.has(a) || !this.nodes.has(b)) throw new Error('BunkerGraph.addEdge: unknown node ' + (!this.nodes.has(a) ? a : b));
      if (!(cost >= 0)) throw new Error('BunkerGraph.addEdge: cost must be >= 0');
      const o = opts || {};
      const mk = () => ({ cost, kind: o.kind || 'walk', cap: o.cap == null ? Infinity : o.cap, blocked: !!o.blocked });
      this.adj.get(a).set(b, mk());
      if (!o.oneWay) this.adj.get(b).set(a, mk());
      this._bump();
    }

    removeEdge(a, b, oneWay) {
      let changed = false;
      const ma = this.adj.get(a), mb = this.adj.get(b);
      if (ma && ma.delete(b)) changed = true;
      if (!oneWay && mb && mb.delete(a)) changed = true;
      if (changed) this._bump();
      return changed;
    }

    // Patch an existing edge (both directions unless oneWay). patch: { cost, cap, blocked }.
    // Only bumps version if a value actually changes.
    updateEdge(a, b, patch, oneWay) {
      let changed = false;
      const apply = (x, y) => {
        const e = this.getEdge(x, y);
        if (!e) return;
        for (const k of ['cost', 'cap', 'blocked']) {
          if (k in patch && e[k] !== patch[k]) { e[k] = k === 'blocked' ? !!patch[k] : patch[k]; changed = true; }
        }
      };
      apply(a, b);
      if (!oneWay) apply(b, a);
      if (changed) this._bump();
      return changed;
    }

    // Block or unblock a whole room (door destroyed, fire, enemy inside...).
    setBlocked(id, blocked) {
      const n = this.nodes.get(id);
      if (!n || n.blocked === !!blocked) return false;
      n.blocked = !!blocked;
      this._bump();
      return true;
    }

    // Smallest cost-per-distance ratio over all edges between nodes that have coordinates.
    // Scaling straight-line distance by this never overestimates, so A* stays optimal.
    _heuristicScale() {
      if (this._hv === this.version) return this._hScale;
      let best = Infinity;
      for (const [a, m] of this.adj) {
        const na = this.nodes.get(a);
        if (na.x == null || na.y == null) continue;
        for (const [b, e] of m) {
          const nb = this.nodes.get(b);
          if (nb.x == null || nb.y == null) continue;
          const d = Math.hypot(na.x - nb.x, na.y - nb.y);
          if (d > 0) best = Math.min(best, e.cost / d);
        }
      }
      this._hScale = best === Infinity ? 0 : best;
      this._hv = this.version;
      return this._hScale;
    }

    // A* from -> to. Returns { found, path, cost, expansions, version }.
    //   expansions: number of nodes expanded (popped and processed); use it for budgets and the nav debug overlay.
    //   version: graph.version the result was computed on; compare with graph.version to detect stale results.
    // opts: { maxExpansions } stops early (found:false, truncated:true) so a queue can enforce a per-tick budget.
    findPath(from, to, opts) {
      const version = this.version;
      const fail = (expansions, truncated) => ({ found: false, path: [], cost: Infinity, expansions, version, truncated: !!truncated });
      const nf = this.nodes.get(from), nt = this.nodes.get(to);
      if (!nf || !nt || nf.blocked || nt.blocked) return fail(0);
      if (from === to) return { found: true, path: [from], cost: 0, expansions: 0, version, truncated: false };

      const maxExp = opts && opts.maxExpansions > 0 ? opts.maxExpansions : Infinity;
      const scale = this._heuristicScale();
      const h = (id) => {
        if (!scale) return 0;
        const n = this.nodes.get(id);
        if (n.x == null || n.y == null || nt.x == null || nt.y == null) return 0;
        return scale * Math.hypot(n.x - nt.x, n.y - nt.y);
      };

      const g = new Map([[from, 0]]);
      const prev = new Map();
      const closed = new Set();
      const open = new MinHeap();
      open.push(from, h(from));
      let expansions = 0;

      while (open.size) {
        const { id } = open.pop();
        if (closed.has(id)) continue; // stale heap entry
        if (id === to) {
          const path = [to];
          for (let c = to; prev.has(c);) { c = prev.get(c); path.push(c); }
          path.reverse();
          return { found: true, path, cost: g.get(to), expansions, version, truncated: false };
        }
        if (expansions >= maxExp) return fail(expansions, true);
        closed.add(id);
        expansions++;
        const gi = g.get(id);
        for (const [nb, e] of this.adj.get(id)) {
          if (e.blocked || closed.has(nb)) continue;
          const nn = this.nodes.get(nb);
          if (nn.blocked) continue;
          const ng = gi + e.cost;
          if (!g.has(nb) || ng < g.get(nb)) {
            g.set(nb, ng);
            prev.set(nb, id);
            open.push(nb, ng + h(nb));
          }
        }
      }
      return fail(expansions);
    }

    // ---- All-pairs room cost cache ----
    // Rows are computed lazily (one Dijkstra per source room) and thrown away as soon as
    // graph.version changes, so a stale cost is never returned.
    _cacheSync() {
      const c = this._cc;
      if (c.v !== this.version) {
        if (c.rows.size) c.rebuilds++;
        c.rows.clear();
        c.v = this.version;
      }
      return c;
    }

    // Map(roomId -> cheapest cost) for every room reachable from `from` (includes from -> 0).
    // Empty map if `from` is unknown or blocked. The returned map is shared: do not mutate it.
    costsFrom(from) {
      const c = this._cacheSync();
      const hit = c.rows.get(from);
      if (hit) { c.hits++; return hit; }
      c.misses++;
      const dist = new Map();
      const nf = this.nodes.get(from);
      if (nf && !nf.blocked) {
        const open = new MinHeap();
        const done = new Set();
        dist.set(from, 0);
        open.push(from, 0);
        while (open.size) {
          const { id } = open.pop();
          if (done.has(id)) continue;
          done.add(id);
          const di = dist.get(id);
          for (const [nb, e] of this.adj.get(id)) {
            if (e.blocked || done.has(nb)) continue;
            if (this.nodes.get(nb).blocked) continue;
            const nd = di + e.cost;
            if (!dist.has(nb) || nd < dist.get(nb)) { dist.set(nb, nd); open.push(nb, nd); }
          }
        }
      }
      c.rows.set(from, dist);
      return dist;
    }

    // Cheapest route cost a -> b, or Infinity if unreachable / blocked / unknown.
    roomCost(a, b) {
      const d = this.costsFrom(a).get(b);
      return d === undefined ? Infinity : d;
    }

    // Fill every row and return Map(from -> Map(to -> cost)).
    allPairs() {
      for (const id of this.nodes.keys()) this.costsFrom(id);
      return this._cc.rows;
    }
    precompute() { return this.allPairs(); }

    cacheStats() {
      const c = this._cacheSync();
      return { version: c.v, rows: c.rows.size, hits: c.hits, misses: c.misses, rebuilds: c.rebuilds };
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { BunkerGraph };
  else root.BunkerGraph = BunkerGraph;
})(typeof window !== 'undefined' ? window : this);
