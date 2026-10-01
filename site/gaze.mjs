import {
  angleToPose, frameTime, needsPoseReset, pointerToPose,
  shortestAngleDelta, smoothToward, stepAngle,
} from './gaze-math.mjs';

const instances = new WeakMap();
const FRONT = Object.freeze({ angle: null, time: 0, strength: 0 });
const FRAME_EPSILON = 1 / 48;

export function initGaze(doc = globalThis.document) {
  const hero = doc?.querySelector('#hero');
  const video = doc?.querySelector('#hero-video');
  const poster = doc?.querySelector('#hero-poster');
  if (!hero || !video || !poster) return null;
  if (instances.has(hero)) return instances.get(hero);

  const win = doc.defaultView;
  const toggle = doc.querySelector('#motion-toggle');
  const label = toggle?.querySelector('[data-motion-label]') || toggle;
  const hint = doc.querySelector('#gaze-hint');
  const finePointer = win.matchMedia('(hover: hover) and (pointer: fine)');
  const reducedMotion = win.matchMedia('(prefers-reduced-motion: reduce)');
  const heroTop = hero.getBoundingClientRect().top + win.scrollY;
  let desired = FRONT;
  let currentAngle = null;
  let strength = 0;
  let targetTime = 0;
  let state = 'idle';
  let userPaused = false;
  let naturalPlaying = false;
  let startingPlayback = false;
  let playRequest = 0;
  let failed = false;
  let focused = true;
  let scrolling = false;
  let scrollTimer = 0;
  let resetPose = false;
  let awaitingPose = false;
  let seekPending = false;
  let seekCount = 0;
  let completedSeeks = 0;
  let pendingTime = 0;
  let seekFailures = 0;
  let failureReason = null;
  let seekTimeout = 0;
  let retryTimer = 0;
  let pointerUpdates = 0;
  let lastReason = 'initial';
  let frame = 0;
  let previousFrame = 0;

  const supportsTracking = () => finePointer.matches && !reducedMotion.matches;
  const heroVisible = () => {
    const rect = hero.getBoundingClientRect();
    return rect.bottom > 80 && rect.top < win.innerHeight;
  };
  const atHero = () => win.scrollY <= heroTop + 12
    && hero.getBoundingClientRect().bottom > win.innerHeight * 0.5;
  const canTrack = () => supportsTracking() && !userPaused && !scrolling
    && !doc.hidden && focused && atHero() && !failed;

  function publish() {
    hero.dataset.motion = state;
    hero.style.setProperty('--gaze-strength', strength.toFixed(4));
    if (toggle) {
      toggle.disabled = failed;
      const active = supportsTracking() ? !userPaused : naturalPlaying;
      const text = failed ? '静态肖像' : supportsTracking()
        ? (userPaused ? '恢复追视' : '暂停追视')
        : (naturalPlaying ? '暂停动态' : '播放动态');
      if (label.textContent !== text) label.textContent = text;
      toggle.setAttribute('aria-pressed', String(active && !failed));
      toggle.setAttribute('aria-label', text);
    }
    if (hint) {
      const text = failed ? '先用这张正面照向你问好。'
        : naturalPlaying ? '动态播放中。'
        : !supportsTracking() ? '点击播放，看看我的小动作。'
        : userPaused ? '追视已暂停。' : '移动鼠标，目光随你。';
      if (hint.textContent !== text) hint.textContent = text;
    }
  }

  function schedule() {
    if (!frame && !doc.hidden && !failed) frame = win.requestAnimationFrame(update);
  }

  function seekTo(time) {
    if (failed || naturalPlaying || video.readyState < 1 || seekPending || video.seeking || retryTimer) return false;
    const next = frameTime(time, video.duration);
    if (Math.abs(video.currentTime - next) <= FRAME_EPSILON) return true;
    // One seek is in flight; pointer updates only replace `desired`, never enqueue work.
    seekPending = true;
    pendingTime = next;
    seekTimeout = win.setTimeout(() => {
      if (seekPending) mediaError('seek-timeout');
    }, 5000);
    try {
      video.currentTime = next;
      seekCount += 1;
    } catch {
      seekPending = false;
      mediaError();
    }
    return false;
  }

  function update(now) {
    frame = 0;
    const elapsed = previousFrame ? now - previousFrame : 16;
    previousFrame = now;
    if (failed || doc.hidden || naturalPlaying) return;

    const tracking = canTrack() && desired.angle !== null && desired.strength > 0;
    targetTime = tracking ? frameTime(desired.time, video.duration) : 0;
    if (!tracking) {
      resetPose = false;
      awaitingPose = false;
      strength = smoothToward(strength, 0, elapsed);
      if (strength === 0) {
        currentAngle = null;
        seekTo(0);
      }
      if (failed) return;
      state = strength > 0 ? 'returning' : canTrack() ? 'idle' : 'paused';
      publish();
      if (strength > 0) schedule();
      return;
    }

    if (currentAngle === null) {
      currentAngle = desired.angle;
      awaitingPose = true;
    }
    if (!awaitingPose && needsPoseReset(currentAngle, desired.angle)) resetPose = true;

    if (resetPose) {
      // Hide the old direction before a far jump; never scrub through unrelated poses.
      strength = smoothToward(strength, 0, elapsed, 55);
      if (strength === 0) {
        currentAngle = desired.angle;
        resetPose = false;
        awaitingPose = true;
      }
    }

    if (!resetPose) {
      currentAngle = awaitingPose ? desired.angle : stepAngle(currentAngle, desired.angle, elapsed);
      const poseTime = frameTime(angleToPose(currentAngle).time, video.duration);
      const atPose = seekTo(poseTime);
      if (atPose && video.readyState >= 2) awaitingPose = false;
      // Partial opacity cannot simulate a smaller turn: it leaves two faces visible.
      // Keep one clear recorded pose once it is decoded; fade only during transitions.
      const nextStrength = awaitingPose || video.readyState < 2 ? 0 : 1;
      strength = smoothToward(strength, nextStrength, elapsed, 40);
    }
    if (failed) return;
    state = resetPose ? 'returning' : 'tracking';
    publish();
    const finalStrength = resetPose || awaitingPose ? 0 : 1;
    if (resetPose || Math.abs(strength - finalStrength) > 0.001
      || Math.abs(shortestAngleDelta(currentAngle, desired.angle)) > 0.001) schedule();
    // When a frame is still decoding, `seeked` wakes us. There is no busy RAF loop.
  }

  function returnFront(reason, immediate = false) {
    lastReason = reason;
    desired = FRONT;
    targetTime = 0;
    resetPose = false;
    awaitingPose = false;
    naturalPlaying = false;
    startingPlayback = false;
    playRequest += 1;
    video.pause();
    video.loop = false;
    if (immediate) {
      strength = 0;
      currentAngle = null;
      seekTo(0);
    }
    state = failed ? 'error' : strength > 0 ? 'returning' : canTrack() ? 'idle' : 'paused';
    publish();
    schedule();
  }

  function mediaError(reason = 'media-error') {
    failed = true;
    failureReason = typeof reason === 'string' ? reason : 'media-error';
    seekPending = false;
    win.clearTimeout(seekTimeout);
    win.clearTimeout(retryTimer);
    seekTimeout = 0;
    retryTimer = 0;
    if (frame) win.cancelAnimationFrame(frame);
    frame = 0;
    returnFront(failureReason, true);
  }

  function beginNaturalPlayback() {
    if (doc.hidden || !heroVisible()) return;
    lastReason = 'user-play';
    desired = FRONT;
    targetTime = 0;
    naturalPlaying = true;
    startingPlayback = true;
    const request = ++playRequest;
    video.loop = true;
    publish();
    const rejected = () => {
      if (request !== playRequest) return;
      returnFront('play-unavailable', true);
    };
    try {
      Promise.resolve(video.play()).then(() => {
        if (request !== playRequest || doc.hidden) {
          if (!naturalPlaying) video.pause();
          return;
        }
        startingPlayback = false;
        strength = 1;
        state = 'playing';
        publish();
      }, rejected);
    } catch {
      rejected();
    }
  }

  video.muted = true;
  video.playsInline = true;
  video.loop = false;
  video.pause();
  video.addEventListener('error', mediaError);
  video.querySelector('source')?.addEventListener('error', mediaError);
  video.addEventListener('seeked', () => {
    if (failed) return;
    win.clearTimeout(seekTimeout);
    seekTimeout = 0;
    const completedRequest = seekPending;
    seekPending = false;
    if (completedRequest) {
      completedSeeks += 1;
      if (Math.abs(video.currentTime - pendingTime) > FRAME_EPSILON) {
        seekFailures += 1;
        if (seekFailures >= 3) {
          mediaError('seek-unavailable');
          return;
        }
        retryTimer = win.setTimeout(() => { retryTimer = 0; schedule(); }, 250 * seekFailures);
        return;
      }
      seekFailures = 0;
    }
    schedule();
  });
  video.addEventListener('loadedmetadata', schedule);
  video.addEventListener('loadeddata', schedule);
  video.addEventListener('canplay', schedule);
  video.addEventListener('playing', () => {
    if (!naturalPlaying || doc.hidden || !heroVisible()) {
      video.pause();
      return;
    }
    startingPlayback = false;
    strength = 1;
    state = 'playing';
    publish();
  });
  video.addEventListener('pause', () => {
    if (naturalPlaying && !startingPlayback) returnFront('media-paused', true);
  });

  hero.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch' || !canTrack() || naturalPlaying) return;
    desired = pointerToPose(event.clientX, event.clientY, video.getBoundingClientRect());
    pointerUpdates += 1;
    lastReason = 'pointer';
    schedule();
  }, { passive: true });
  hero.addEventListener('pointerleave', () => {
    if (!naturalPlaying) returnFront('pointer-leave');
  });
  hero.addEventListener('pointercancel', () => {
    if (!naturalPlaying) returnFront('pointer-cancel');
  });
  toggle?.addEventListener('click', () => {
    if (failed) return;
    if (supportsTracking()) {
      userPaused = !userPaused;
      returnFront(userPaused ? 'user-pause' : 'user-resume');
    } else if (naturalPlaying) {
      returnFront('user-pause', true);
    } else {
      beginNaturalPlayback();
    }
  });
  win.addEventListener('scroll', () => {
    scrolling = true;
    win.clearTimeout(scrollTimer);
    returnFront('scroll');
    scrollTimer = win.setTimeout(() => {
      scrolling = false;
      schedule();
    }, 160);
  }, { passive: true });
  win.addEventListener('resize', () => returnFront('resize'));
  win.addEventListener('blur', () => { focused = false; returnFront('window-blur', true); });
  win.addEventListener('focus', () => { focused = true; schedule(); });
  doc.addEventListener('visibilitychange', () => {
    previousFrame = 0;
    if (doc.hidden) {
      if (frame) win.cancelAnimationFrame(frame);
      frame = 0;
      returnFront('tab-hidden', true);
    } else {
      schedule();
    }
  });
  for (const query of [finePointer, reducedMotion]) {
    query.addEventListener('change', () => returnFront('motion-preference', true));
  }

  const diagnostics = Object.freeze({
    get state() { return state; },
    get targetTime() { return targetTime; },
    get currentTime() { return video.currentTime; },
    get strength() { return strength; },
    get targetAngle() { return desired.angle; },
    get currentAngle() { return currentAngle; },
    get seekPending() { return seekPending || video.seeking; },
    get seekCount() { return seekCount; },
    get completedSeeks() { return completedSeeks; },
    get seekFailures() { return seekFailures; },
    get failureReason() { return failureReason; },
    get pointerUpdates() { return pointerUpdates; },
    get trackingAvailable() { return canTrack(); },
    get reducedMotion() { return reducedMotion.matches; },
    get naturalPlaying() { return naturalPlaying; },
    get readyState() { return video.readyState; },
    get lastReason() { return lastReason; },
  });
  Object.defineProperty(win, 'heroDiagnostics', { value: diagnostics, writable: false, configurable: false });
  instances.set(hero, diagnostics);
  if (video.error) mediaError();
  else returnFront('initial', true);
  return diagnostics;
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => initGaze(), { once: true });
  else initGaze();
}
