import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeAngle, shortestAngleDelta, angleToPose, pointerToPose,
  frameTime, smoothToward, stepAngle, needsPoseReset,
} from '../gaze-math.mjs';
import { initGaze } from '../gaze.mjs';

const PI = Math.PI;
const close = (actual, expected, epsilon = 1e-6) =>
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} should equal ${expected}`);
const rect = { left: 100, top: 50, width: 1000, height: 600 };
const center = { x: 590, y: 320 };

test('angles wrap without accumulating full revolutions', () => {
  close(normalizeAngle(PI * 10 + 0.1), 0.1);
  close(normalizeAngle(-PI / 2), PI * 1.5);
  close(shortestAngleDelta(PI * 1.9, PI * 0.1), PI * 0.2);
  close(shortestAngleDelta(PI * 0.1, PI * 1.9), -PI * 0.2);
});

test('screen right, up, left and down select the approved video poses', () => {
  for (const [x, y, expectedTime] of [
    [center.x + 500, center.y, 2],
    [center.x, center.y - 300, 3.875],
    [center.x - 500, center.y, 5.375],
    [center.x, center.y + 300, 7],
  ]) {
    const pose = pointerToPose(x, y, rect);
    close(pose?.time, expectedTime);
    close(pose?.strength, 1);
  }
});

test('the face center and small pointer movement stay on the front poster', () => {
  for (const [x, y] of [[center.x, center.y], [center.x + 20, center.y - 10]]) {
    const pose = pointerToPose(x, y, rect);
    assert.deepEqual(pose, { angle: null, time: 0, strength: 0 });
  }
});

test('gaze strength grows continuously outside the center dead zone and is bounded', () => {
  const strengths = [0, 0.06, 0.12, 0.18, 0.3, 0.5, 0.8, 2]
    .map((radius) => pointerToPose(center.x + radius * 500, center.y, rect)?.strength);
  for (let index = 0; index < strengths.length; index += 1) {
    assert.ok(strengths[index] >= 0 && strengths[index] <= 1);
    if (index) assert.ok(strengths[index] >= strengths[index - 1]);
  }
  assert.equal(strengths[0], 0);
  assert.equal(strengths.at(-1), 1);
});

test('the three recorded direction transitions interpolate their actual timing', () => {
  close(angleToPose(PI / 4)?.time, 2.9375);
  close(angleToPose(PI * 0.75)?.time, 4.625);
  close(angleToPose(PI * 1.25)?.time, 6.1875);
});

test('the missing down-to-right transition never seeks through the left or up pose', () => {
  for (let angle = PI * 1.5; angle < PI * 2; angle += 0.01) {
    const pose = angleToPose(angle);
    assert.ok(pose?.time === 7 || pose?.time === 2, `invalid seam pose at ${angle}`);
    assert.ok(pose?.seamStrength >= 0 && pose?.seamStrength <= 1);
  }
  assert.equal(angleToPose(PI * 1.75)?.seamStrength, 0);
});

test('opposite poses and the missing transition return through the poster', () => {
  assert.equal(needsPoseReset(0, PI), true);
  assert.equal(needsPoseReset(0, PI * 1.5), true);
  assert.equal(needsPoseReset(PI * 1.7, PI * 1.8), true);
  assert.equal(needsPoseReset(0, PI / 2), false);
  assert.equal(needsPoseReset(PI / 2, PI), false);
  assert.equal(needsPoseReset(PI, PI * 1.5), false);
});

test('angle smoothing takes the shortest path and settles without rotations', () => {
  let current = PI * 1.9;
  const target = PI * 0.1;
  let totalTravel = 0;
  for (let index = 0; index < 120; index += 1) {
    const next = stepAngle(current, target, 16);
    totalTravel += Math.abs(shortestAngleDelta(current, next));
    current = next;
  }
  assert.ok(totalTravel <= PI * 0.2 + 1e-6);
  close(current, target);
});

test('opacity smoothing remains bounded after a long suspended animation frame', () => {
  const next = smoothToward(0, 1, 5000);
  assert.ok(next > 0 && next < 0.6);
  let current = next;
  for (let index = 0; index < 120; index += 1) current = smoothToward(current, 0, 16);
  assert.equal(current, 0);
});

test('seek times land on a valid frame and never reach the duration boundary', () => {
  close(frameTime(3.875, 10.041667), 3.875);
  assert.equal(frameTime(-4, 10.041667), 0);
  assert.equal(frameTime(Infinity, 10.041667), 0);
  assert.ok(frameTime(99, 10.041667) < 10.041667);
  assert.ok(frameTime(0.5, 0.02) >= 0 && frameTime(0.5, 0.02) < 0.02);
});

test('invalid pointer geometry falls back to a finite front pose', () => {
  for (const badRect of [{ ...rect, width: 0 }, { ...rect, height: NaN }]) {
    assert.deepEqual(pointerToPose(center.x, center.y, badRect), { angle: null, time: 0, strength: 0 });
  }
  assert.deepEqual(pointerToPose(NaN, 30, rect), { angle: null, time: 0, strength: 0 });
});

// A small browser boundary: the production controller owns all decisions, while
// this media element deliberately waits for an explicit seek-complete event.
class Element extends EventTarget {
  dataset = {};
  attributes = new Map();
  textContent = '';
  disabled = false;
  style = { values: new Map(), setProperty: (key, value) => this.style.values.set(key, value) };
  setAttribute(key, value) { this.attributes.set(key, value); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 1000, height: 600, bottom: 600 }; }
  querySelector() { return null; }
  emit(type, fields = {}) { this.dispatchEvent(Object.assign(new Event(type), fields)); }
}

class MediaElement extends Element {
  readyState = 2;
  duration = 10.041667;
  seeking = false;
  paused = true;
  writes = [];
  time = 0;
  rejectPlay = false;
  seekLandsAt = null;
  get currentTime() { return this.time; }
  set currentTime(value) { this.time = value; this.writes.push(value); this.seeking = true; }
  pause() { this.paused = true; this.emit('pause'); }
  play() {
    if (this.rejectPlay) return Promise.reject(new Error('Playback unavailable'));
    this.paused = false;
    this.emit('playing');
    return Promise.resolve();
  }
  completeSeek() {
    if (this.seekLandsAt !== null) this.time = this.seekLandsAt;
    this.seeking = false;
    this.emit('seeked');
  }
}

function browser({ fine = true, reduced = false } = {}) {
  const hero = new Element();
  const video = new MediaElement();
  const source = new Element();
  video.querySelector = (selector) => selector === 'source' ? source : null;
  const poster = new Element();
  const toggle = new Element();
  const hint = new Element();
  const elements = new Map([
    ['#hero', hero], ['#hero-video', video], ['#hero-poster', poster],
    ['#motion-toggle', toggle], ['#gaze-hint', hint],
  ]);
  const win = new Element();
  const doc = new Element();
  const fineQuery = Object.assign(new Element(), { matches: fine });
  const reducedQuery = Object.assign(new Element(), { matches: reduced });
  let now = 0;
  let nextId = 0;
  const callbacks = new Map();
  const timers = new Map();
  win.innerHeight = 600;
  win.scrollY = 0;
  win.performance = { now: () => now };
  win.matchMedia = (query) => query.includes('reduced-motion') ? reducedQuery : fineQuery;
  win.requestAnimationFrame = (callback) => { callbacks.set(++nextId, callback); return nextId; };
  win.cancelAnimationFrame = (id) => callbacks.delete(id);
  win.setTimeout = (callback) => { timers.set(++nextId, callback); return nextId; };
  win.clearTimeout = (id) => timers.delete(id);
  doc.defaultView = win;
  doc.hidden = false;
  doc.querySelector = (selector) => elements.get(selector);
  const tick = (count = 1) => {
    for (let index = 0; index < count; index += 1) {
      now += 16;
      const queued = [...callbacks.values()];
      callbacks.clear();
      for (const callback of queued) callback(now);
    }
  };
  const settle = (count = 120) => {
    for (let index = 0; index < count; index += 1) {
      tick();
      if (video.seeking) video.completeSeek();
    }
  };
  const flushTimers = () => {
    const queued = [...timers.values()];
    timers.clear();
    for (const callback of queued) callback();
  };
  const move = (clientX, clientY) => hero.emit('pointermove', { clientX, clientY, pointerType: 'mouse' });
  initGaze(doc);
  return { hero, video, source, poster, toggle, hint, win, doc, move, tick, settle, flushTimers, callbacks, reducedQuery };
}

test('the controller serializes seeks and discards superseded pointer targets', () => {
  const b = browser();
  b.move(990, 270);
  b.tick();
  assert.equal(b.video.writes.length, 1);
  for (let index = 0; index < 50; index += 1) {
    b.move(index % 2 ? 490 : 0, index % 2 ? 0 : 270);
    b.tick();
  }
  assert.equal(b.video.writes.length, 1, 'only one seek may be in flight');
  b.video.completeSeek();
  b.settle();
  close(b.video.currentTime, 3.875);
  assert.equal(b.hero.dataset.motion, 'tracking');
  assert.equal(b.win.heroDiagnostics?.seekPending, false);
});

test('seeks that report completion at the wrong time stop after three failed attempts', () => {
  const b = browser();
  b.video.seekLandsAt = 0;
  b.move(990, 270);
  for (let index = 0; index < 30; index += 1) {
    b.settle(10);
    b.flushTimers();
  }
  assert.equal(b.video.writes.length, 3);
  assert.equal(b.hero.dataset.motion, 'error');
  assert.equal(b.win.heroDiagnostics.strength, 0);
  assert.equal(b.win.heroDiagnostics.seekFailures, 3);
  assert.equal(b.win.heroDiagnostics.failureReason, 'seek-unavailable');
  assert.equal(b.callbacks.size, 0);
  b.move(490, 0);
  b.video.emit('canplay');
  b.settle();
  b.flushTimers();
  assert.equal(b.video.writes.length, 3, 'events cannot restart an unavailable seek loop');
});

test('a successful retry clears the failure streak and resumes tracking', () => {
  const b = browser();
  b.video.seekLandsAt = 0;
  b.move(990, 270);
  b.tick();
  b.video.completeSeek();
  assert.equal(b.win.heroDiagnostics.seekFailures, 1);
  b.video.seekLandsAt = null;
  b.flushTimers();
  b.settle();
  assert.equal(b.hero.dataset.motion, 'tracking');
  assert.equal(b.win.heroDiagnostics.seekFailures, 0);
  close(b.video.currentTime, 2);
});

test('a seek that never completes falls back without writing a second seek', () => {
  const b = browser();
  b.move(990, 270);
  b.tick();
  b.flushTimers();
  b.tick(20);
  assert.equal(b.video.writes.length, 1);
  assert.equal(b.hero.dataset.motion, 'error');
  assert.equal(b.win.heroDiagnostics.strength, 0);
  assert.equal(b.win.heroDiagnostics.failureReason, 'seek-timeout');
  assert.equal(b.callbacks.size, 0);
});

test('crossing to an opposite pose is hidden until the direct seek completes', () => {
  const b = browser();
  b.move(990, 270);
  b.settle();
  const startWrites = b.video.writes.length;
  b.move(0, 270);
  b.tick(80);
  close(b.win.heroDiagnostics?.strength, 0);
  assert.deepEqual(b.video.writes.slice(startWrites), [5.375]);
  b.video.completeSeek();
  b.settle();
  close(b.win.heroDiagnostics?.strength, 1);
});

test('a pointer near the center uses one clear pose instead of a permanent double exposure', () => {
  const b = browser();
  b.move(620, 210);
  b.settle();
  assert.equal(b.hero.dataset.motion, 'tracking');
  assert.equal(b.win.heroDiagnostics.strength, 1);
});

test('leaving the stage returns to the front and stops scheduling frames', () => {
  const b = browser();
  b.move(990, 270);
  b.settle();
  b.hero.emit('pointerleave');
  b.settle();
  assert.equal(b.hero.dataset.motion, 'idle');
  assert.equal(b.win.heroDiagnostics?.strength, 0);
  assert.equal(b.video.currentTime, 0);
  assert.equal(b.callbacks.size, 0);
});

test('pausing desktop tracking prevents pointer seeks until explicitly resumed', () => {
  const b = browser();
  b.toggle.emit('click');
  b.move(990, 270);
  b.settle();
  assert.equal(b.hero.dataset.motion, 'paused');
  assert.equal(b.video.writes.length, 0);
  b.toggle.emit('click');
  b.move(990, 270);
  b.settle();
  assert.equal(b.hero.dataset.motion, 'tracking');
});

test('touch and reduced-motion users start static and can opt into a natural loop', async () => {
  for (const preferences of [{ fine: false }, { reduced: true }]) {
    const b = browser(preferences);
    b.move(990, 270);
    b.settle();
    assert.equal(b.video.writes.length, 0);
    assert.equal(b.hero.dataset.motion, 'paused');
    b.toggle.emit('click');
    await Promise.resolve();
    assert.equal(b.hero.dataset.motion, 'playing');
    assert.equal(b.video.paused, false);
    assert.equal(b.video.loop, true);
    b.toggle.emit('click');
    b.settle();
    assert.equal(b.video.paused, true);
    assert.equal(b.hero.dataset.motion, 'paused');
    assert.equal(b.win.heroDiagnostics?.strength, 0);
  }
});

test('a touch user may play after scrolling to a still-visible hero control', async () => {
  const b = browser({ fine: false });
  b.win.scrollY = 150;
  b.hero.getBoundingClientRect = () => ({ left: 0, top: -150, width: 1000, height: 600, bottom: 450 });
  b.win.emit('scroll');
  b.flushTimers();
  b.toggle.emit('click');
  await Promise.resolve();
  assert.equal(b.hero.dataset.motion, 'playing');
});

test('scrolling returns front and tracking becomes available when the hero returns', () => {
  const b = browser();
  b.move(990, 270);
  b.settle();
  b.win.scrollY = 200;
  b.win.emit('scroll');
  b.flushTimers();
  b.move(0, 270);
  b.settle();
  assert.equal(b.hero.dataset.motion, 'paused');
  assert.equal(b.video.currentTime, 0);
  b.win.scrollY = 0;
  b.win.emit('scroll');
  b.flushTimers();
  b.move(490, 0);
  b.settle();
  assert.equal(b.hero.dataset.motion, 'tracking');
  close(b.video.currentTime, 3.875);
});

test('a hidden tab pauses an opted-in loop and does not restart it automatically', async () => {
  const b = browser({ fine: false });
  b.toggle.emit('click');
  await Promise.resolve();
  b.doc.hidden = true;
  b.doc.emit('visibilitychange');
  assert.equal(b.video.paused, true);
  assert.equal(b.win.heroDiagnostics?.strength, 0);
  b.doc.hidden = false;
  b.doc.emit('visibilitychange');
  b.settle();
  assert.equal(b.hero.dataset.motion, 'paused');
  assert.equal(b.video.paused, true);
});

test('a video error immediately keeps the poster visible and disables motion', () => {
  const b = browser();
  b.move(990, 270);
  b.settle();
  b.video.emit('error');
  b.move(0, 270);
  b.settle();
  assert.equal(b.hero.dataset.motion, 'error');
  assert.equal(b.win.heroDiagnostics?.strength, 0);
  assert.equal(b.toggle.disabled, true);
});

test('an unavailable source also keeps the poster when the video never emits an error', () => {
  const b = browser();
  b.source.emit('error');
  b.settle();
  assert.equal(b.hero.dataset.motion, 'error');
  assert.equal(b.win.heroDiagnostics?.strength, 0);
  assert.equal(b.toggle.disabled, true);
});

test('enabling reduced motion during tracking immediately switches to a static poster', () => {
  const b = browser();
  b.move(990, 270);
  b.settle();
  b.reducedQuery.matches = true;
  b.reducedQuery.emit('change');
  b.settle();
  assert.equal(b.hero.dataset.motion, 'paused');
  assert.equal(b.win.heroDiagnostics?.strength, 0);
  assert.equal(b.toggle.textContent, '播放动态');
});

test('a rejected user play request returns to a retryable static state', async () => {
  const b = browser({ fine: false });
  b.video.rejectPlay = true;
  b.toggle.emit('click');
  await Promise.resolve();
  await Promise.resolve();
  b.settle();
  assert.equal(b.hero.dataset.motion, 'paused');
  assert.equal(b.win.heroDiagnostics?.strength, 0);
  assert.equal(b.toggle.disabled, false);
});

test('diagnostic properties expose state but cannot modify normal behavior', () => {
  const b = browser();
  assert.ok(Object.isFrozen(b.win.heroDiagnostics));
  assert.throws(() => { b.win.heroDiagnostics.strength = 1; }, TypeError);
  assert.throws(() => { b.win.heroDiagnostics = {}; }, TypeError);
});
