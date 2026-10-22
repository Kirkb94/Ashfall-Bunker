// PathService: budgeted path request queue on top of BunkerGraph.
// Emits events so crew states can react:
//   'PathFound'  { id, owner, from, to, path, cost, expansions, version }
//   'PathFailed' { id, owner, from, to, reason, expansions, version }
//     reason: 'unknown-node' | 'blocked-endpoint' | 'no-route' | 'budget'
// Stranded hook: svc.on('PathFailed', e => crew[e.owner].enterStranded(e.reason))
// Works as a browser global (window.PathService) and as a CommonJS module for tests.
(function (root) {
  'use strict';

  class PathService {
    // opts: { budget: total A* expansions per tick, maxExpansions: cap for one request }
    constructor(graph, opts) {
      const o = opts || {};
      this.graph = graph;
      this.budget = o.budget > 0 ? o.budget : 400;
      this.maxExpansions = o.maxExpansions > 0 ? o.maxExpansions : 2000;
      // aging: priority points gained per tick spent waiting (0 disables). Prevents starvation.
      this.aging = o.aging >= 0 ? o.aging : 0.1;
      this.queue = [];
      this.listeners = {};
      this._seq = 0;
      this.tickNo = 0;
    }

    on(type, fn) {
      (this.listeners[type] = this.listeners[type] || []).push(fn);
      return () => this.off(type, fn);
    }

    off(type, fn) {
      const l = this.listeners[type];
      if (!l) return;
      const i = l.indexOf(fn);
      if (i >= 0) l.splice(i, 1);
    }

    _emit(type, payload) {
      const l = this.listeners[type];
      if (!l) return;
      for (const fn of l.slice()) {
        try { fn(payload); } catch (e) { if (typeof console !== 'undefined') console.error('PathService listener error', e); }
      }
    }

    // Queue a request. opts: { owner, priority (higher first, default 0) }. Returns request id.
    // A new request from the same owner replaces the older pending one (silently).
    request(from, to, opts) {
      const o = opts || {};
      if (o.owner != null) this.cancelOwner(o.owner);
      const id = ++this._seq;
      this.queue.push({ id, owner: o.owner == null ? null : o.owner, from, to, priority: o.priority || 0, queuedAt: this.tickNo });
      return id;
    }

    cancel(id) {
      const i = this.queue.findIndex((r) => r.id === id);
      if (i < 0) return false;
      this.queue.splice(i, 1);
      return true;
    }

    cancelOwner(owner) {
      const before = this.queue.length;
      this.queue = this.queue.filter((r) => r.owner !== owner);
      return before - this.queue.length;
    }

    get pending() { return this.queue.length; }

    _reason(from, to) {
      const nf = this.graph.getNode(from), nt = this.graph.getNode(to);
      if (!nf || !nt) return 'unknown-node';
      if (nf.blocked || nt.blocked) return 'blocked-endpoint';
      return 'no-route';
    }

    // Process queued requests within the per-tick expansion budget.
    // Order: effective priority (priority + aging * ticks waited) desc, then oldest first.
    // At least one request runs per tick.
    tick() {
      this.tickNo++;
      const eff = (r) => r.priority + (this.tickNo - r.queuedAt) * this.aging;
      this.queue.sort((a, b) => (eff(b) - eff(a)) || (a.id - b.id));
      let left = this.budget;
      let ran = 0;
      while (this.queue.length && (left > 0 || ran === 0)) {
        const req = this.queue[0];
        const cap = Math.max(1, Math.min(this.maxExpansions, left));
        const res = this.graph.findPath(req.from, req.to, { maxExpansions: cap });
        left -= res.expansions;
        ran++;
        if (res.truncated && cap < this.maxExpansions) break; // out of tick budget: keep queued, retry next tick
        this.queue.shift();
        const base = { id: req.id, owner: req.owner, from: req.from, to: req.to, expansions: res.expansions, version: res.version };
        if (res.found) {
          this._emit('PathFound', Object.assign(base, { path: res.path, cost: res.cost }));
        } else {
          this._emit('PathFailed', Object.assign(base, { reason: res.truncated ? 'budget' : this._reason(req.from, req.to) }));
        }
      }
      return ran;
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { PathService };
  else root.PathService = PathService;
})(typeof window !== 'undefined' ? window : this);
