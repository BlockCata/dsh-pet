const AMBIENT_COOLDOWN_MS = 15_000;

function createActionCatalog(animations) {
  const categoryFor = (name) => animations.categories.find((category) => category.actions.includes(name));
  const action = (kind, name, { explicitOnly = false } = {}) => {
    const exists = kind === 'click'
      ? animations.clicks.includes(name)
      : kind === 'move'
        ? animations.moves.actions.some((entry) => entry.name === name)
        : !!categoryFor(name);
    if (!exists) throw new Error(`對話動作沒有對應的既有動畫：${name}`);
    return { kind, name, noMirror: !!categoryFor(name)?.noMirror, ...(explicitOnly ? { explicitOnly: true } : {}) };
  };
  const catalog = {
    dance: action('action', '优雅女仆舞'),
    happy: action('click', '点击回应-开心跃动'),
    shy: action('click', '点击回应-害羞惊讶'),
    wave: action('click', '点击回应-元气挥手'),
    surprised: action('action', '被吓一跳'),
  };
  const register = (id, kind, name, options) => {
    if (Object.values(catalog).some((entry) => entry?.name === name)) return;
    catalog[id] = action(kind, name, options);
  };

  animations.clicks.forEach((name, index) => register(`click-${index.toString().padStart(2, '0')}`, 'click', name, { explicitOnly: true }));
  animations.moves.actions.forEach(({ name }, index) => register(index === 0 ? 'crab_walk' : `move-${index.toString().padStart(2, '0')}`, 'move', name, { explicitOnly: true }));
  animations.categories.forEach((category, categoryIndex) => {
    category.actions.forEach((name, actionIndex) => {
      register(`category-${categoryIndex}-${actionIndex.toString().padStart(2, '0')}`, 'action', name, { explicitOnly: true });
    });
  });
  catalog.none = null;
  return catalog;
}

function createActionChoices(catalog) {
  return Object.entries(catalog)
    .filter(([, action]) => action)
    .map(([id, action]) => ({ id, name: action.name, kind: action.kind, explicitOnly: action.explicitOnly === true }));
}

function createActionDirector({ catalog, now = () => Date.now(), sendToPet }) {
  const seenRequests = new Set();
  const lastAmbient = new Map();

  function request(petId, proposal, state) {
    if (typeof petId !== 'string' || !petId || typeof proposal?.requestId !== 'string' || !proposal.requestId) {
      return { status: 'rejected', reason: 'invalid-request' };
    }
    const requestKey = `${petId}\u0000${proposal.requestId}`;
    if (seenRequests.has(requestKey)) return { status: 'skipped', reason: 'duplicate' };
    seenRequests.add(requestKey);
    const action = catalog?.[proposal.actionId];
    if (action === null) return { status: 'skipped', reason: 'none' };
    if (!action || !['explicit', 'ambient'].includes(proposal.trigger)) return { status: 'rejected', reason: 'invalid-action' };
    if (proposal.trigger === 'ambient' && action.explicitOnly) return { status: 'skipped', reason: 'explicit-only' };
    if (!state?.visible) return { status: 'skipped', reason: 'hidden' };
    if (state.pointerHeld || state.dragging || state.manualActionPlaying) return { status: 'skipped', reason: 'busy' };
    if (proposal.trigger === 'ambient') {
      if (!state.ambientEnabled) return { status: 'skipped', reason: 'ambient-disabled' };
      const previous = lastAmbient.get(petId);
      if (previous !== undefined && now() - previous < AMBIENT_COOLDOWN_MS) return { status: 'skipped', reason: 'cooldown' };
      lastAmbient.set(petId, now());
    }
    const { explicitOnly, ...playableAction } = action;
    sendToPet(petId, { type: 'chat-action', requestId: proposal.requestId, action: playableAction, trigger: proposal.trigger });
    return { status: 'sent' };
  }

  function dispose(petId) {
    lastAmbient.delete(petId);
    for (const requestKey of seenRequests) if (requestKey.startsWith(`${petId}\u0000`)) seenRequests.delete(requestKey);
  }

  return { request, dispose };
}

module.exports = { AMBIENT_COOLDOWN_MS, createActionCatalog, createActionChoices, createActionDirector };
