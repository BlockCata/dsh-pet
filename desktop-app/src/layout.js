function petDimensions(size) {
  return { width: Math.round(420 * size / 100), height: Math.round(300 * size / 100) };
}

function videoRectangle(bounds) {
  return { x: bounds.width / 14, y: bounds.height * 0.16, width: bounds.width * 6 / 7, height: bounds.width * 6 / 7 * 9 / 16 };
}

function anchoredPosition(area, size, anchor) {
  const { width, height } = petDimensions(size);
  const right = Math.max(area.x, area.x + area.width - width - 32);
  const bottom = Math.max(area.y, area.y + area.height - height - 32);
  if (anchor === 'center') return { x: Math.round(area.x + (area.width - width) / 2), y: Math.round(area.y + (area.height - height) / 2) };
  return { x: anchor.endsWith('left') ? area.x + 32 : right, y: anchor.startsWith('top') ? area.y + 32 : bottom };
}

function dragPosition(cursor, offset) {
  // Electron screen.getCursorScreenPoint 與 BrowserWindow 皆使用 DIP，不再換算 renderer 的 screenX。
  return { x: Math.round(cursor.x - offset.x), y: Math.round(cursor.y - offset.y) };
}

function recoverPet(pet, displays) {
  const target = displays.find((display) => display.id === pet.displayId) || displays[0];
  const dimensions = petDimensions(pet.size);
  // 用角色中心而非整個透明視窗判斷可見性，保留橫跨兩個螢幕接縫的位置。
  const center = { x: pet.x + dimensions.width / 2, y: pet.y + dimensions.height / 2 };
  const visibleDisplay = displays.find(({ workArea: area }) => center.x >= area.x && center.x < area.x + area.width && center.y >= area.y && center.y < area.y + area.height);
  if (visibleDisplay) return { ...pet, displayId: visibleDisplay.id };
  return { ...pet, ...anchoredPosition(target.workArea, pet.size, 'bottom-right'), displayId: target.id };
}

module.exports = { petDimensions, videoRectangle, anchoredPosition, dragPosition, recoverPet };
