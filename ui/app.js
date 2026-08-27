const form = document.querySelector('#collect-form');
const submit = document.querySelector('#submit');
const result = document.querySelector('#result');
const statusText = document.querySelector('#status-text');
const progress = document.querySelector('#progress');
const elapsed = document.querySelector('#elapsed');
const from = document.querySelector('#from');
const to = document.querySelector('#to');
const relatedFrom = document.querySelector('#related-from');
const relatedTo = document.querySelector('#related-to');
const relatedKeywords = document.querySelector('#related-keywords');
const stravaForm = document.querySelector('#strava-form');
const stravaStatus = document.querySelector('#strava-status');
const stravaMessage = document.querySelector('#strava-message');
const stravaConnect = document.querySelector('#strava-connect');
const showStravaSecrets = document.querySelector('#show-strava-secrets');
const gmailForm = document.querySelector('#gmail-form');
const gmailStatus = document.querySelector('#gmail-status');
const gmailMessage = document.querySelector('#gmail-message');
const gmailConnect = document.querySelector('#gmail-connect');
const today = new Date(); const weekAgo = new Date(today); weekAgo.setDate(today.getDate() - 7);
to.value = localDate(today); from.value = localDate(weekAgo);
const yearAgo = new Date(weekAgo); yearAgo.setFullYear(yearAgo.getFullYear() - 1); relatedFrom.value = localDate(yearAgo); relatedTo.value = localDate(today);

form.addEventListener('submit', async event => {
  event.preventDefault();
  const selected = [...form.querySelectorAll('input[name="sources"]:checked')].map(input => input.value);
  if (!selected.length) return show('取得元を1つ以上選んでください。', true);
  const days = (new Date(`${to.value}T00:00:00`) - new Date(`${from.value}T00:00:00`)) / 86_400_000 + 1;
  if (days < 1 || days > 31) return show('期間は1日以上31日以内にしてください。', true);
  const keywords = relatedKeywords.value.split(/\n/).map(value => value.trim()).filter(Boolean);
  if (keywords.length && (!relatedFrom.value || !relatedTo.value || relatedTo.value < relatedFrom.value)) return show('関連資料の検索期間を正しく指定してください。', true);
  submit.disabled = true; submit.textContent = '収集中…'; show('収集を開始します');
  try {
    const response = await fetch('/api/collect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from: from.value, to: to.value, title: form.title.value.trim(), sources: selected, relatedFrom: relatedFrom.value, relatedTo: relatedTo.value, relatedKeywords: keywords }) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || '収集に失敗しました。');
    localStorage.setItem('my-timeline-job', data.id); await monitor(data.id);
  } catch (error) { show(error.message, true); resetButton(); }
});
async function monitor(id) {
  for (;;) {
    const response = await fetch('/api/status', { cache: 'no-store' }); const state = await response.json();
    if (state.id !== id) { show('収集状態を確認できませんでした。', true); resetButton(); return; }
    show(state.message, state.status === 'error', state);
    if (state.status === 'complete') { localStorage.removeItem('my-timeline-job'); resetButton(); return; }
    if (state.status === 'error') { localStorage.removeItem('my-timeline-job'); resetButton(); return; }
    await new Promise(resolve => setTimeout(resolve, 700));
  }
}
function show(message, failed = false, state = {}) {
  result.hidden = false; result.classList.toggle('error', failed); statusText.textContent = message;
  progress.hidden = !state.total; if (state.total) { progress.max = state.total; progress.value = state.done ?? 0; }
  elapsed.textContent = state.startedAt ? `経過時間 ${formatElapsed(Date.now() - new Date(state.startedAt))}${state.root ? `\n保存先 ${state.root}` : ''}` : '';
}
function resetButton() { submit.disabled = false; submit.textContent = '収集して開く'; }
function formatElapsed(ms) { const seconds = Math.floor(ms / 1000); return `${Math.floor(seconds / 60)}分${String(seconds % 60).padStart(2, '0')}秒`; }
function localDate(date) { const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000); return shifted.toISOString().slice(0, 10); }
const previousJob = localStorage.getItem('my-timeline-job'); if (previousJob) { submit.disabled = true; submit.textContent = '収集中…'; monitor(previousJob); }

stravaForm.addEventListener('submit', async event => {
  event.preventDefault(); const button = stravaForm.querySelector('button'); button.disabled = true;
  try {
    const response = await fetch('/api/strava/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(stravaForm))) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || '保存に失敗しました。');
    stravaForm.reset(); stravaMessage.textContent = data.connected ? '保存して接続済みにしました。' : '保存しました。「Stravaに接続」を押してください。'; await updateStravaStatus();
  } catch (error) { stravaMessage.textContent = error.message; }
  finally { button.disabled = false; }
});
async function updateStravaStatus() { try { const response = await fetch('/api/strava/status', { cache: 'no-store' }); const state = await response.json(); stravaStatus.textContent = state.connected ? '接続済み' : state.configured ? '接続待ち' : '未設定'; stravaConnect.hidden = state.connected; } catch { stravaStatus.textContent = '確認失敗'; } }
showStravaSecrets.addEventListener('click', () => { const shown = showStravaSecrets.getAttribute('aria-pressed') !== 'true'; for (const input of stravaForm.querySelectorAll('input[type="password"],input[data-secret]')) { input.type = shown ? 'text' : 'password'; input.toggleAttribute('data-secret', shown); } showStravaSecrets.setAttribute('aria-pressed', String(shown)); showStravaSecrets.textContent = shown ? '入力内容を隠す' : '入力内容を表示'; });
window.addEventListener('focus', updateStravaStatus); updateStravaStatus();

gmailForm.addEventListener('submit', async event => {
  event.preventDefault(); const button = gmailForm.querySelector('button'); button.disabled = true;
  try {
    const response = await fetch('/api/gmail/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(gmailForm))) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || '保存に失敗しました。');
    gmailForm.reset(); gmailMessage.textContent = data.connected ? '保存して接続済みにしました。' : '保存しました。「Gmailに接続」を押してください。'; await updateGmailStatus();
  } catch (error) { gmailMessage.textContent = error.message; }
  finally { button.disabled = false; }
});
async function updateGmailStatus() { try { const response = await fetch('/api/gmail/status', { cache: 'no-store' }); const state = await response.json(); gmailStatus.textContent = state.connected ? '接続済み' : state.configured ? '接続待ち' : '未設定'; gmailConnect.hidden = state.connected; } catch { gmailStatus.textContent = '確認失敗'; } }
window.addEventListener('focus', updateGmailStatus); updateGmailStatus();
