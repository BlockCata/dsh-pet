(() => {
  const api = window.diaryAPI; const select = document.getElementById('diary-select'); const text = document.getElementById('diary-text'); const status = document.getElementById('diary-status'); let diaries = [];
  const render = () => { select.replaceChildren(...diaries.map((diary) => { const option = document.createElement('option'); option.value = diary.id; option.textContent = `${new Date(diary.createdAt).toLocaleDateString('zh-Hant')}｜${(diary.text || '').slice(0, 24)}`; return option; })); const current = diaries.find((diary) => diary.id === select.value) || diaries.at(-1); if (current) { select.value = current.id; text.value = current.text || ''; } else text.value = ''; };
  select.addEventListener('change', render);
  document.getElementById('diary-save').addEventListener('click', async () => { const id = select.value; if (!id || !text.value.trim()) return; diaries = await api.edit(id, text.value.trim()); render(); status.textContent = '已儲存。'; });
  document.getElementById('diary-delete').addEventListener('click', async () => { const id = select.value; if (!id || !window.confirm('確定刪除這篇日記？')) return; diaries = await api.delete(id); render(); status.textContent = '已刪除。'; });
  document.getElementById('diary-close').addEventListener('click', () => api.close());
  api.get().then((data) => { document.getElementById('diary-title').textContent = `${data.name}的日記`; diaries = data.diaries || []; render(); }).catch((error) => { status.textContent = error.message || '無法讀取日記。'; });
})();
