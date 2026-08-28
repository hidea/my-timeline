const form = document.querySelector('#manual-form'), result = document.querySelector('#manual-result'), save = document.querySelector('#save-material'), occurredAt = document.querySelector('#occurred-at');
const gmailForm = document.querySelector('#gmail-append-form'), gmailButton = document.querySelector('#append-gmail'), root = new URLSearchParams(location.search).get('root');
const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000); occurredAt.value = now.toISOString().slice(0, 16);
document.querySelector('#current-location').addEventListener('click', () => navigator.geolocation.getCurrentPosition(position => { form.latitude.value = position.coords.latitude; form.longitude.value = position.coords.longitude; }, error => show(`現在地を取得できませんでした: ${error.message}`, true)));
form.addEventListener('submit', async event => {
  event.preventDefault(); const files = [...form.files.files]; if (files.length > 10) return show('写真は10枚までです。', true); save.disabled = true; save.textContent = '保存しています…'; show('写真を読み込み、タイムラインを更新しています');
  try {
    const encoded = await Promise.all(files.map(file => encodeFile(file))), data = Object.fromEntries(new FormData(form)); data.root = root; data.files = encoded;
    const response = await fetch('/api/manual-material', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }), body = await response.json(); if (!response.ok) throw new Error(body.error || '追加できませんでした。'); show('追加しました。更新したタイムラインを開きます。'); form.reset();
  } catch (error) { show(error.message, true); } finally { save.disabled = false; save.textContent = 'タイムラインに追加'; }
});
function encodeFile(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve({ name: file.name, type: file.type, data: String(reader.result).split(',')[1] }); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); }); }
function show(message, failed = false) { result.hidden = false; result.classList.toggle('error', failed); result.textContent = message; }
gmailForm.addEventListener('submit', async event => {
  event.preventDefault(); const sources = [...gmailForm.querySelectorAll('input[name="sources"]:checked')].map(input => input.value); if (!sources.length) return show('追加する取得元を選んでください。', true); gmailButton.disabled = true; gmailButton.textContent = '取得しています…'; show(`${sources.join('、')}から新しい項目を取得しています。保存済み素材は再取得しません。`);
  try {
    const values = Object.fromEntries(new FormData(gmailForm)); values.root = root; values.sources = sources; values.keywords = String(values.keywords ?? '').split(/\n/).map(value => value.trim()).filter(Boolean);
    const response = await fetch('/api/append-sources', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(values) }), body = await response.json(); if (!response.ok) throw new Error(body.error || '追加できませんでした。'); const details = (body.breakdown ?? []).map(item => `${item.source} ${item.total}件${item.related ? `（期間外 ${item.related}件）` : ''}`).join('、'); show(`${body.added}件追加しました${details ? `：${details}` : ''}。更新したタイムラインを開きます。${body.warnings?.length ? `\n警告: ${body.warnings.join(' / ')}` : ''}`);
  } catch (error) { show(error.message, true); } finally { gmailButton.disabled = false; gmailButton.textContent = '選んだ取得元から追加'; }
});
fetch(`/api/workspace-info?root=${encodeURIComponent(root)}`).then(response => response.json()).then(info => { document.title = `${info.title}へ素材を追加 | My Timeline`; const from = new Date(`${info.from}T00:00:00`); from.setFullYear(from.getFullYear() - 1); gmailForm.relatedFrom.value = from.toISOString().slice(0, 10); gmailForm.relatedTo.value = info.to; }).catch(() => {});
