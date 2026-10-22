// Pure platformer physics shared by the game and the tests.
// Works as a browser global (window.Physics) and as a CommonJS module.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Physics = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  // Integrate gravity and resolve floors/ceilings.
  //   body: { x, y, vy, grounded }   (y is the feet position)
  //   o.floors:   [{ id, y, x0, x1, solid }]  landing lines. Non-solid ones are one-way (land only when
  //               crossing from above). Solid ones catch the body anywhere at or below the line.
  //   o.ceilings: [{ y, x0, x1 }]  bump the head (headH above the feet) when rising through them.
  //   o.dropThrough: ignore one-way floors this step (holding down).
  // Sets body.grounded and body.landedOn (the id of the floor landed on this step, or null).
  function moveBody(b, dt, grav, o) {
    o = o || {};
    const floors = o.floors || [], ceilings = o.ceilings || [];
    const headH = o.headH == null ? 34 : o.headH;
    const oy = b.y;
    b.vy += grav * dt;
    b.y += b.vy * dt;
    b.grounded = false;
    b.landedOn = null;
    for (const f of floors) {
      if (!(b.x > f.x0 && b.x < f.x1)) continue;
      if (b.vy < 0) continue;
      const hit = f.solid ? b.y >= f.y : (!o.dropThrough && oy <= f.y && b.y >= f.y);
      if (hit) { b.y = f.y; b.vy = 0; b.grounded = true; b.landedOn = f.id == null ? null : f.id; }
    }
    for (const c of ceilings) {
      if (!(b.x > c.x0 && b.x < c.x1)) continue;
      if (b.vy < 0 && oy - headH >= c.y && b.y - headH < c.y) { b.y = c.y + headH; b.vy = 0; }
    }
    return b;
  }

  // Jump feel: coyote time, jump buffer, variable jump height.
  // Call update() once per tick BEFORE moveBody, with last tick's body.grounded.
  function createController(cfg) {
    cfg = Object.assign({ coyote: 0.10, buffer: 0.12, cutFrac: 0.4 }, cfg || {});
    const c = {
      cfg, coyoteT: 0, bufferT: 0, prevHeld: false, jumping: false, climbing: false, ladder: null, ladderJumpHeld: false, lastJumpSpeed: 400,
      update(body, jumpHeld, dt, jumpSpeed) {
        c.lastJumpSpeed = jumpSpeed;
        const held = !!jumpHeld;
        const pressed = held && !c.prevHeld;
        if (body.grounded) { c.coyoteT = cfg.coyote; c.jumping = false; }
        else c.coyoteT = Math.max(0, c.coyoteT - dt);
        c.bufferT = pressed ? cfg.buffer : Math.max(0, c.bufferT - dt);
        let jumped = false;
        if (c.bufferT > 0 && c.coyoteT > 0) {
          body.vy = -jumpSpeed; body.grounded = false;
          c.coyoteT = 0; c.bufferT = 0; c.jumping = true; jumped = true;
        }
        // variable height: releasing early caps the upward speed
        if (!held && c.jumping && body.vy < -jumpSpeed * cfg.cutFrac) body.vy = -jumpSpeed * cfg.cutFrac;
        if (body.vy >= 0) c.jumping = false;
        c.prevHeld = held;
        return jumped;
      },
      // Ladder state. ladders: [{ x, y0, y1 }] (y0 = top/platform surface, y1 = bottom, feet coords).
      // input: { up, down, left, right, jump }. Returns true while on a ladder: the caller must then skip
      // horizontal walking, c.update and moveBody. On release (top, bottom, side, jump) it returns false.
      climb(body, input, dt, ladders, speed) {
        const inp = input || {};
        const reach = cfg.ladderReach == null ? 14 : cfg.ladderReach;
        const find = () => {
          for (const l of ladders || []) if (Math.abs(body.x - l.x) <= reach) {
            if (inp.up && body.y > l.y0 + 1 && body.y <= l.y1 + 1) return l;
            if (inp.down && body.y >= l.y0 - 1 && body.y < l.y1 - 1) return l;
          }
          return null;
        };
        const release = () => { c.climbing = false; c.ladder = null; c.prevHeld = true; };
        if (!c.climbing) {
          const l = find();
          if (!l) return false;
          c.climbing = true; c.ladder = l; c.coyoteT = 0; c.bufferT = 0; c.jumping = false;
          c.ladderJumpHeld = !!inp.jump;
          body.x = l.x; body.vy = 0; body.grounded = false;
        }
        const l = c.ladder;
        const pressed = !!inp.jump && !c.ladderJumpHeld;
        c.ladderJumpHeld = !!inp.jump;
        if (pressed) {
          release(); body.vy = -(cfg.ladderHop == null ? 0.5 : cfg.ladderHop) * (c.lastJumpSpeed || 400);
          return false;
        }
        if (inp.left || inp.right) { release(); body.vy = 0; return false; }
        body.vy = 0; body.grounded = false;
        body.y += ((inp.down ? 1 : 0) - (inp.up ? 1 : 0)) * speed * dt;
        if (body.y <= l.y0) { body.y = l.y0; release(); body.grounded = true; body.landedOn = null; return false; }
        if (body.y >= l.y1) { body.y = l.y1; release(); return false; }
        return true;
      },
      reset() { c.coyoteT = 0; c.bufferT = 0; c.prevHeld = false; c.jumping = false; c.climbing = false; c.ladder = null; }
    };
    return c;
  }

  return { moveBody, createController };
});
