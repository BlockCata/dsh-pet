(async () => {
  const video = document.getElementById('pet-video');
  const canvas = document.getElementById('pet-canvas');
  const stage = document.getElementById('pet-stage');
  const error = document.getElementById('pet-error');
  const api = window.petAPI;
  const animation = window.PetAnimation;
  let current = null;
  let direction = -1;
  let roaming = true;
  let dragState = null;
  let frame = null;
  let generation = 0;
  let chatActionRequestId = null;

  function showError(message) {
    error.textContent = message;
    error.classList.add('visible');
  }

  let config;
  try { config = await api.getConfig(); }
  catch { showError('無法讀取動畫設定，請重新啟動程式。'); return; }
  const { animations } = config;
  roaming = config.preferences?.roaming ?? true;
  let visible = config.preferences?.visible ?? true;
  function setCanvasSize(size) {
    const scale = (size || 100) / 100;
    canvas.width = Math.round(640 * scale);
    canvas.height = Math.round(360 * scale);
  }
  setCanvasSize(config.preferences?.size);
  const visualContext = canvas.getContext('2d');
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = 320;
  maskCanvas.height = 180;
  const maskContext = maskCanvas.getContext('2d', { willReadFrequently: true });

  function publishMask() {
    try {
      visualContext.clearRect(0, 0, canvas.width, canvas.height);
      visualContext.drawImage(video, 0, 0, canvas.width, canvas.height);
      maskContext.clearRect(0, 0, 320, 180);
      maskContext.drawImage(video, 0, 0, 320, 180);
      const pixels = maskContext.getImageData(0, 0, 320, 180).data;
      const alpha = new Uint8Array(320 * 180);
      for (let index = 0; index < alpha.length; index++) alpha[index] = pixels[index * 4 + 3];
      api.updateMask({ width: 320, height: 180, alpha, mirrored: direction === 1 && !current?.noMirror });
    } catch (reason) {
      api.updateMask(null);
      showError('無法讀取角色透明度，請從系統匣重新啟動桌寵。');
      console.error('[desktop-pet] alpha mask failed:', reason);
      return;
    }
    video.requestVideoFrameCallback(publishMask);
  }
  video.requestVideoFrameCallback(publishMask);

  function stopWalk() {
    cancelAnimationFrame(frame);
    frame = null;
    api.stopWalk();
  }

  function finishChatAction(state) {
    if (!chatActionRequestId) return;
    const requestId = chatActionRequestId;
    chatActionRequestId = null;
    api.actionStatus({ requestId, state });
  }

  function play(action) {
    const token = ++generation;
    stopWalk();
    current = action;
    api.updateMask(null);
    error.classList.remove('visible');
    video.loop = action.kind === 'drag';
    const transform = direction === 1 && !action.noMirror ? 'scaleX(-1)' : 'scaleX(1)';
    video.style.transform = transform;
    canvas.style.transform = transform;
    video.src = `./assets/${encodeURIComponent(action.name)}.webm`;
    if (!visible) { video.pause(); return; }
    video.play().then(() => {
      if (token === generation && action.chatRequestId === chatActionRequestId) api.actionStatus({ requestId: action.chatRequestId, state: 'started' });
    }).catch((reason) => {
      if (token === generation && action.chatRequestId === chatActionRequestId) finishChatAction('failed');
      if (token === generation && reason.name !== 'AbortError') showError(`無法播放動畫：${action.name}`);
    });
    if (action.kind === 'move') {
      const entry = animations.moves.actions.find((item) => item.name === action.name);
      const params = { ...animations.moves.default, ...entry.params };
      api.beginWalk(action.name, direction).then((plan) => {
        if (token !== generation || !plan) return;
        direction = plan.direction;
        const transform = direction === 1 ? 'scaleX(-1)' : 'scaleX(1)';
        video.style.transform = transform;
        canvas.style.transform = transform;
        function tick() {
          if (!video.paused) api.walkProgress(animation.walkProgress(video.currentTime, video.duration, params));
          frame = requestAnimationFrame(tick);
        }
        frame = requestAnimationFrame(tick);
      }).catch(() => { if (token === generation) showError('目前無法移動桌寵。'); });
    }
  }

  function idle() { play({ kind: 'idle', name: animations.idle[0] }); }

  video.addEventListener('ended', () => {
    if (dragState) return;
    if (current.chatRequestId === chatActionRequestId) { finishChatAction('ended'); idle(); return; }
    if (current.kind === 'turn') direction *= -1;
    if (current.kind === 'click' || current.kind === 'drag') { idle(); return; }
    play(animation.selectNext(config, current.name, direction === 1, roaming));
  });
  video.addEventListener('error', () => {
    if (current?.chatRequestId === chatActionRequestId) finishChatAction('failed');
    showError(`找不到或無法解碼動畫：${current?.name}`);
  });

  stage.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || dragState) return;
    finishChatAction('interrupted');
    stopWalk();
    dragState = { pointerId: event.pointerId };
    stage.setPointerCapture(event.pointerId);
    api.beginDrag();
  });

  function releasePointer() {
    const previous = dragState;
    dragState = null;
    stage.classList.remove('dragging');
    if (previous && stage.hasPointerCapture(previous.pointerId)) stage.releasePointerCapture(previous.pointerId);
    return previous;
  }

  stage.addEventListener('pointerup', (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    releasePointer();
    api.endDrag(false);
  });
  for (const eventName of ['pointercancel', 'lostpointercapture']) {
    stage.addEventListener(eventName, () => { if (releasePointer()) api.endDrag(true); });
  }
  stage.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    api.showMenu();
  });

  api.onCommand((command) => {
    if (command.type === 'drag-start') {
      stage.classList.add('dragging');
      play({ kind: 'drag', name: animation.pickNextAnimation(animations.drag, current.name) });
    }
    if (command.type === 'drag-end') {
      releasePointer();
      if (command.moved || command.cancelled) idle();
      else play({ kind: 'click', name: animation.pickNextAnimation(animations.clicks, current.name) });
    }
    if (command.type === 'action') { finishChatAction('interrupted'); releasePointer(); play(command.action); }
    if (command.type === 'chat-action') {
      if (dragState) { api.actionStatus({ requestId: command.requestId, state: 'interrupted' }); return; }
      finishChatAction('interrupted');
      chatActionRequestId = command.requestId;
      play({ ...command.action, chatRequestId: command.requestId });
    }
    if (command.type === 'roaming') {
      roaming = command.enabled;
      if (!roaming && current.kind === 'move') idle();
    }
    if (command.type === 'visibility') {
      visible = command.visible;
      releasePointer();
      if (command.visible) idle();
      else { finishChatAction('interrupted'); generation++; stopWalk(); video.pause(); }
    }
    if (command.type === 'preferences') {
      roaming = command.pet.roaming;
      visible = command.pet.visible;
      setCanvasSize(command.pet.size);
      if (!visible) { finishChatAction('interrupted'); releasePointer(); generation++; stopWalk(); video.pause(); }
      else if (current.kind === 'move' || video.paused) idle();
    }
  });
  idle();
})().catch((error) => console.error('[desktop-pet] renderer failed:', error));
