const TAU = Math.PI * 2;
const QUARTER = Math.PI / 2;
const SEAM = Math.PI * 1.75;
const DIRECTION_TIMES = [2, 3.875, 5.375, 7];
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const smoothstep = (value) => value * value * (3 - 2 * value);
const frontPose = () => ({ angle: null, time: 0, strength: 0 });

export function normalizeAngle(angle) {
  if (!Number.isFinite(angle)) return 0;
  const wrapped = angle % TAU;
  return wrapped < 0 ? wrapped + TAU : wrapped;
}

export function shortestAngleDelta(from, to) {
  return normalizeAngle(to - from + Math.PI) - Math.PI;
}

export function angleToPose(angle) {
  const normalized = normalizeAngle(angle);
  if (normalized >= QUARTER * 3) {
    // The approved clip returns to front after down; it contains no down→right arc.
    // Keep the nearest real pose and conceal its narrow seam with the front poster.
    const seamStrength = smoothstep(clamp(Math.abs(normalized - SEAM) / 0.14, 0, 1));
    return { time: normalized < SEAM ? 7 : 2, seamStrength };
  }
  const segment = Math.floor(normalized / QUARTER);
  const progress = (normalized - segment * QUARTER) / QUARTER;
  const time = DIRECTION_TIMES[segment]
    + (DIRECTION_TIMES[segment + 1] - DIRECTION_TIMES[segment]) * progress;
  return { time, seamStrength: 1 };
}

export function pointerToPose(clientX, clientY, rect) {
  const values = [clientX, clientY, rect?.left, rect?.top, rect?.width, rect?.height];
  if (!values.every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) return frontPose();
  const x = (clientX - rect.left - rect.width * 0.49) / (rect.width * 0.5);
  const y = (clientY - rect.top - rect.height * 0.45) / (rect.height * 0.5);
  const radius = Math.hypot(x, y);
  const deadZone = 0.12;
  if (radius <= deadZone) return frontPose();
  // Screen Y grows downward; the approved sequence runs right, up, left, down.
  const angle = normalizeAngle(Math.atan2(-y, x));
  const pose = angleToPose(angle);
  const strength = smoothstep(clamp((radius - deadZone) / (0.7 - deadZone), 0, 1));
  return { angle, time: pose.time, strength: strength * pose.seamStrength };
}

export function needsPoseReset(from, to) {
  const start = normalizeAngle(from);
  const delta = shortestAngleDelta(start, to);
  if (Math.abs(delta) > Math.PI * 2 / 3) return true;
  const end = start + delta;
  for (const offset of [-TAU, 0, TAU]) {
    const seam = SEAM + offset;
    if (Math.abs(delta) > 1e-6 && seam >= Math.min(start, end) && seam <= Math.max(start, end)) return true;
  }
  return false;
}

export function frameTime(time, duration, fps = 24) {
  if (!Number.isFinite(time) || !Number.isFinite(duration) || duration <= 0 || fps <= 0) return 0;
  const lastFrame = Math.max(0, Math.floor(duration * fps - 1 + 1e-4));
  return clamp(Math.round(time * fps), 0, lastFrame) / fps;
}

export function smoothToward(current, target, elapsedMs, timeConstant = 110) {
  const step = 1 - Math.exp(-clamp(elapsedMs, 0, 50) / timeConstant);
  const next = current + (target - current) * step;
  return Math.abs(target - next) < 0.001 ? target : next;
}

export function stepAngle(current, target, elapsedMs) {
  const delta = shortestAngleDelta(current, target);
  return normalizeAngle(current + smoothToward(0, delta, elapsedMs, 95));
}
