function buildPetMenu(config, state, callbacks) {
  const { animations } = config;
  const actionItems = (names, kind, noMirror = false) => names.map((name) => ({
    id: `action:${name}`, label: name,
    click: () => callbacks.play({ kind, name, noMirror }),
  }));
  const categoryLabels = { 小动作: '小動作', 玩耍: '玩耍', 吃什么: '吃東西', 时节: '節慶', 文字: '文字' };
  return [
    { label: '藍髮小女僕', enabled: false },
    { id: 'visibility', label: state.visible ? '隱藏桌寵' : '顯示桌寵', click: callbacks.toggleVisibility },
    { id: 'roaming', label: '自動漫遊', type: 'checkbox', checked: state.roaming, click: (item) => callbacks.setRoaming(item.checked) },
    { id: 'chat', label: '聊天', click: callbacks.chat },
    { type: 'separator' },
    { label: '基本互動', submenu: [
      ...actionItems(animations.idle, 'idle'),
      ...actionItems(animations.turn, 'turn'),
      ...actionItems(animations.clicks, 'click'),
    ] },
    { label: '移動', submenu: actionItems(animations.moves.actions.map((action) => action.name), 'move') },
    ...animations.categories.map((category) => ({
      label: categoryLabels[category.id] || category.id,
      submenu: actionItems(category.actions, 'action', !!category.noMirror),
    })),
    { type: 'separator' },
    { id: 'settings', label: '桌寵設定…', click: callbacks.settings },
    { id: 'quit', label: '結束程式', click: callbacks.quit },
  ];
}

module.exports = { buildPetMenu };
