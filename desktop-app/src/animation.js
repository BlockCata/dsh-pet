function pickNextAnimation(animations, current, random = Math.random) {
  if (!Array.isArray(animations) || animations.length === 0) {
    throw new Error('動畫清單不可為空');
  }

  const candidates = animations.length > 1 ? animations.filter((name) => name !== current) : animations;
  const index = Math.min(candidates.length - 1, Math.floor(random() * candidates.length));
  return candidates[index];
}

function selectNext(config, current, mirrored, roaming, random = Math.random) {
  const { animations, animationWeights } = config;
  const pools = [
    { kind: 'idle', weight: animationWeights.idle, actions: animations.idle },
    { kind: 'turn', weight: animationWeights.turn, actions: animations.turn },
    ...(roaming ? [{ kind: 'move', weight: animationWeights.move, actions: animations.moves.actions.map((action) => action.name) }] : []),
    ...animations.categories.filter((category) => !mirrored || !category.noMirror)
      .map((category) => ({ ...category, kind: 'action' })),
  ];
  let roll = random() * pools.reduce((sum, pool) => sum + pool.weight, 0);
  let selected = pools[pools.length - 1];
  for (const pool of pools) {
    roll -= pool.weight;
    if (roll < 0) { selected = pool; break; }
  }
  return { kind: selected.kind, name: pickNextAnimation(selected.actions, current, random), noMirror: !!selected.noMirror };
}

function walkProgress(time, duration, params) {
  const movingSeconds = duration - params.leadSec - params.tailSec;
  if (!Number.isFinite(movingSeconds) || movingSeconds <= 0) return 0;
  return Math.max(0, Math.min(1, (time - params.leadSec) / movingSeconds));
}

function planMove(bounds, workArea, params, direction, random = Math.random, roamingRange) {
  const range = roamingRange || { left: 0, right: 100 };
  const left = workArea.x + workArea.width * range.left / 100 + params.margin;
  const right = Math.max(left, workArea.x + workArea.width * range.right / 100 - bounds.width - params.margin);
  const startX = Math.max(left, Math.min(right, bounds.x));
  const distance = (params.minDist + random() * (params.maxDist - params.minDist)) * (bounds.width / 420) * (360 / 462);
  if ((direction < 0 ? startX - left : right - startX) < distance) direction *= -1;
  return { startX, targetX: Math.max(left, Math.min(right, startX + direction * distance)), direction };
}

if (typeof module !== 'undefined') {
  module.exports = { pickNextAnimation, selectNext, walkProgress, planMove };
}

if (typeof window !== 'undefined') {
  window.PetAnimation = { pickNextAnimation, selectNext, walkProgress, planMove };
}
