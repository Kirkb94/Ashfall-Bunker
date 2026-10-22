const test = require('node:test');
const assert = require('node:assert');
const { moveBody, createController } = require('../public/physics.js');

const INF = Infinity;
const DT = 1 / 60;
const GRAV = 1500;

function ground(y) { return { id: 'g', y, x0: -INF, x1: INF, solid: true }; }

// ---------------------------------------------------------------- moveBody
test('moveBody: gravity accelerates a falling body', () => {
  const b = { x: 0, y: 0, vy: 0, grounded: false };
  moveBody(b, DT, GRAV, { floors: [] });
  assert.ok(b.vy > 0);
  assert.ok(b.y > 0);
  assert.strictEqual(b.grounded, false);
});

test('moveBody: lands on a floor, zeroes vy, sets grounded and landedOn', () => {
  const b = { x: 0, y: 499, vy: 300, grounded: false };
  moveBody(b, DT, GRAV, { floors: [{ id: 2, y: 500, x0: -INF, x1: INF }] });
  assert.strictEqual(b.y, 500);
  assert.strictEqual(b.vy, 0);
  assert.strictEqual(b.grounded, true);
  assert.strictEqual(b.landedOn, 2);
});

test('moveBody: standing on a floor stays grounded every step', () => {
  const b = { x: 0, y: 500, vy: 0, grounded: true };
  const o = { floors: [{ id: 0, y: 500, x0: -INF, x1: INF }] };
  for (let i = 0; i < 30; i++) { moveBody(b, DT, GRAV, o); assert.strictEqual(b.grounded, true); assert.strictEqual(b.y, 500); }
});

test('moveBody: floor span is respected (outside x range falls through)', () => {
  const b = { x: 900, y: 499, vy: 300, grounded: false };
  moveBody(b, DT, GRAV, { floors: [{ id: 1, y: 500, x0: 100, x1: 800 }] });
  assert.strictEqual(b.grounded, false);
  assert.ok(b.y > 500);
});

test('moveBody: one-way platform lets you rise through from below', () => {
  const b = { x: 50, y: 520, vy: -400, grounded: false };
  moveBody(b, DT, GRAV, { floors: [{ y: 500, x0: 0, x1: 100 }] });
  assert.strictEqual(b.grounded, false);
  assert.ok(b.y < 520);
});

test('moveBody: one-way platform does not catch a body that started below it while falling', () => {
  const b = { x: 50, y: 510, vy: 100, grounded: false };
  moveBody(b, DT, GRAV, { floors: [{ y: 500, x0: 0, x1: 100 }] });
  assert.strictEqual(b.grounded, false);
});

test('moveBody: dropThrough ignores one-way floors but not solid ground', () => {
  const plat = { y: 500, x0: 0, x1: 100 };
  const b = { x: 50, y: 499, vy: 300, grounded: false };
  moveBody(b, DT, GRAV, { floors: [plat], dropThrough: true });
  assert.strictEqual(b.grounded, false);
  const g = { x: 50, y: 599, vy: 300, grounded: false };
  moveBody(g, DT, GRAV, { floors: [ground(600)], dropThrough: true });
  assert.strictEqual(g.grounded, true);
  assert.strictEqual(g.y, 600);
});

test('moveBody: solid ground catches a body that sank below it', () => {
  const b = { x: 0, y: 650, vy: 0, grounded: false };
  moveBody(b, DT, GRAV, { floors: [ground(600)] });
  assert.strictEqual(b.y, 600);
  assert.strictEqual(b.grounded, true);
});

test('moveBody: ceiling bumps the head and zeroes upward speed', () => {
  const b = { x: 50, y: 400, vy: -600, grounded: false };
  moveBody(b, DT, GRAV, { floors: [], ceilings: [{ y: 370, x0: 0, x1: 100 }], headH: 34 });
  assert.strictEqual(b.y, 404);
  assert.strictEqual(b.vy, 0);
});

// ---------------------------------------------------------------- controller
const fakeBody = (grounded) => ({ vy: 0, grounded });

test('controller: grounded press jumps', () => {
  const c = createController(), b = fakeBody(true);
  assert.strictEqual(c.update(b, true, 0.01, 470), true);
  assert.strictEqual(b.vy, -470);
  assert.strictEqual(b.grounded, false);
});

test('controller: no jump in the air with no coyote time left (and no double jump)', () => {
  const c = createController(), b = fakeBody(false);
  assert.strictEqual(c.update(b, true, 0.01, 470), false);
  const g = fakeBody(true); const c2 = createController();
  c2.update(g, true, 0.01, 470);          // jump
  c2.update(g, false, 0.01, 470);
  assert.strictEqual(c2.update(g, true, 0.01, 470), false); // pressed again mid-air
});

test('controller: coyote - jump still works 0.05s after leaving a ledge', () => {
  const c = createController(), b = fakeBody(true);
  c.update(b, false, 0.01, 470);          // standing
  b.grounded = false;                     // walked off
  for (let i = 0; i < 4; i++) c.update(b, false, 0.01, 470);
  assert.strictEqual(c.update(b, true, 0.01, 470), true);
});

test('controller: coyote - jump fails 0.15s after leaving a ledge', () => {
  const c = createController(), b = fakeBody(true);
  c.update(b, false, 0.01, 470);
  b.grounded = false;
  for (let i = 0; i < 14; i++) c.update(b, false, 0.01, 470);
  assert.strictEqual(c.update(b, true, 0.01, 470), false);
});

test('controller: buffer - press 0.08s before landing jumps on landing', () => {
  const c = createController(), b = fakeBody(false);
  c.update(b, true, 0.01, 470);           // press in air, buffered
  for (let i = 0; i < 7; i++) c.update(b, false, 0.01, 470);
  b.grounded = true;
  assert.strictEqual(c.update(b, false, 0.01, 470), true);
  assert.strictEqual(b.vy, -470);
});

test('controller: buffer - press 0.20s before landing is forgotten', () => {
  const c = createController(), b = fakeBody(false);
  c.update(b, true, 0.01, 470);
  for (let i = 0; i < 19; i++) c.update(b, false, 0.01, 470);
  b.grounded = true;
  assert.strictEqual(c.update(b, false, 0.01, 470), false);
});

test('controller: holding jump through a landing does not auto re-jump', () => {
  const c = createController(), b = fakeBody(false);
  c.update(b, true, 0.01, 470);           // press
  for (let i = 0; i < 30; i++) c.update(b, true, 0.01, 470); // held, buffer expires
  b.grounded = true;
  assert.strictEqual(c.update(b, true, 0.01, 470), false);
});

// ---------------------------------------------------------------- integration
function simJump(releaseAfterFrames) {
  const c = createController();
  const b = { x: 0, y: 500, vy: 0, grounded: true, landedOn: null };
  const o = { floors: [ground(500)] };
  let top = b.y;
  for (let i = 0; i < 90; i++) {
    const held = releaseAfterFrames == null || i < releaseAfterFrames;
    c.update(b, held, DT, 470);
    moveBody(b, DT, GRAV, o);
    top = Math.min(top, b.y);
  }
  return { top, b };
}

test('variable height: a held jump rises ~73px, an early release rises much less, and both land', () => {
  const full = simJump(null), short = simJump(3);
  assert.ok(500 - full.top > 60, 'full jump height ' + (500 - full.top));
  assert.ok(500 - short.top < 30, 'short hop height ' + (500 - short.top));
  assert.ok(500 - short.top > 0);
  assert.strictEqual(full.b.grounded, true);
  assert.strictEqual(short.b.y, 500);
});
