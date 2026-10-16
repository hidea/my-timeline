const data = JSON.parse(document.querySelector('#timeline-data').textContent);
const q = document.querySelector('#q'), day = document.querySelector('#day'), size = document.querySelector('#image-size');
const sourceBoxes = [...document.querySelectorAll('.source-filter input')], cards = [...document.querySelectorAll('.event')], dateBars = [...document.querySelectorAll('.date-bar')];

function isFiltering() { return !!q.value.trim() || sourceBoxes.some(box => !box.checked); }
function filter() {
  const n = q.value.toLowerCase(), sources = new Set(sourceBoxes.filter(box => box.checked).map(box => box.value));
  for (const c of cards) c.hidden = !!((n && !c.dataset.search.includes(n)) || !sources.has(c.dataset.source));
}
function updateDateBars() { for (const bar of dateBars) bar.hidden = !cards.some(card => !card.hidden && card.dataset.date === bar.dataset.date); }
q.addEventListener('input', () => { filter(); updateDateBars(); renderDayView(); });
const sourceCount = document.querySelector('#source-count');
function updateSourceCount() { const on = sourceBoxes.filter(box => box.checked).length; sourceCount.textContent = on === sourceBoxes.length ? '' : `${on}/${sourceBoxes.length}`; }
for (const box of sourceBoxes) box.addEventListener('change', () => { updateSourceCount(); filter(); updateDateBars(); renderDayView(); });
const menus = [...document.querySelectorAll('.controls details.menu')];
document.addEventListener('click', event => { for (const menu of menus) if (menu.open && !menu.contains(event.target)) menu.open = false; });
for (const button of document.querySelectorAll('.more-menu button')) button.addEventListener('click', () => { button.closest('details').open = false; });
document.addEventListener('click', event => { const link = event.target.closest?.('.jump-start'); if (!link) return; event.preventDefault(); showCard(link.dataset.key, link.dataset.date); });

const mapFrames = [...document.querySelectorAll('main iframe[data-src],main iframe[data-srcdoc]')], mapFrameObserver = new IntersectionObserver(entries => {
  for (const entry of entries) {
    const frame = entry.target;
    if (entry.isIntersecting) {
      if (frame.dataset.loaded) continue;
      if (frame.dataset.srcdoc) frame.srcdoc = frame.dataset.srcdoc; else frame.src = frame.dataset.src;
      frame.dataset.loaded = 'true';
    } else if (frame.dataset.loaded) { frame.src='about:blank'; frame.removeAttribute('srcdoc'); delete frame.dataset.loaded; }
  }
}, { rootMargin: '600px 0px' });
for (const frame of mapFrames) mapFrameObserver.observe(frame);

const selectedButton = document.querySelector('#select-visible'), clearButton = document.querySelector('#clear-selection'), deleteButton = document.querySelector('#delete-selection');
for (const c of cards) {
  const shell = document.createElement('div');
  shell.className = 'event-shell'; c.before(shell); shell.append(c);
  if (!data.root) continue;
  const box = document.createElement('input');
  box.type = 'checkbox'; box.className = 'card-select'; box.dataset.id = c.dataset.key; box.setAttribute('aria-label', 'このカードを選択');
  c.querySelector('footer').prepend(box); box.addEventListener('change', updateSelected);
}
function updateSelected() {
  const count = document.querySelectorAll('.card-select:checked').length;
  deleteButton.hidden = !count; deleteButton.textContent = `${count}件を削除…`;
}
if (data.root) {
  selectedButton.addEventListener('click', () => {
    for (const box of document.querySelectorAll('.card-select')) { const shell = box.closest('.event-shell'); if (shell.isConnected && !shell.querySelector('.event').hidden) box.checked = true; }
    updateSelected();
  });
  clearButton.addEventListener('click', () => { for (const box of document.querySelectorAll('.card-select')) box.checked = false; updateSelected(); });
  deleteButton.addEventListener('click', () => {
    rememberDayForReturn();
    const ids = [...document.querySelectorAll('.card-select:checked')].map(box => box.dataset.id), form = document.createElement('form');
    form.method = 'post'; form.action = 'http://127.0.0.1:4177/delete-bulk';
    for (const [name, value] of [['root', data.root], ['ids', JSON.stringify(ids)]]) { const input = document.createElement('input'); input.type = 'hidden'; input.name = name; input.value = value; form.append(input); }
    document.body.append(form); form.submit();
  });
}

const overview = { panel: document.querySelector('#overview-map'), frame: document.querySelector('#overview-map-frame'), scope: 'day', ready: false };
function refreshOverviewMap() {
  if (!overview.panel?.open) return;
  if (!overview.frame.srcdoc) { overview.frame.srcdoc = overview.frame.dataset.srcdoc; return; }
  if (!overview.ready) return;
  const inScope = item => overview.scope === 'all' || item.date === activeDay;
  overview.frame.contentWindow.postMessage({ type: 'overview', routes: data.map.routes.filter(inScope), points: data.map.points.filter(inScope) }, '*');
}
window.addEventListener('message', event => {
  if (!overview.frame || event.source !== overview.frame.contentWindow) return;
  if (event.data?.type === 'overview-ready') { overview.ready = true; refreshOverviewMap(); }
  else if (event.data?.type === 'overview-show') showCard(event.data.key, event.data.date);
});
function showCard(key, date) {
  if (isFiltering() || date !== activeDay) chooseDay(date);
  const card = cards.find(c => c.dataset.key === key);
  if (!card) return;
  card.scrollIntoView({ block: 'center' }); card.focus({ preventScroll: true });
  requestAnimationFrame(() => requestAnimationFrame(() => card.scrollIntoView({ block: 'center' })));
}
if (overview.panel) {
  overview.panel.addEventListener('toggle', refreshOverviewMap);
  for (const button of overview.panel.querySelectorAll('[data-scope]')) button.addEventListener('click', () => {
    overview.scope = button.dataset.scope;
    for (const other of overview.panel.querySelectorAll('[data-scope]')) other.setAttribute('aria-pressed', String(other === button));
    refreshOverviewMap();
  });
}

const mainElement = document.querySelector('main'), previousDayButton = document.querySelector('#previous-day'), nextDayButton = document.querySelector('#next-day');
const dayGroups = dateBars.map((bar, index) => {
  const nodes = [bar], nextBar = dateBars[index + 1];
  let node = bar.nextSibling;
  while (node && node !== nextBar) { const next = node.nextSibling; if (node.nodeType === 1 && node.matches('.event-shell')) nodes.push(node); node = next; }
  return { date: bar.dataset.date, nodes, fragment: new DocumentFragment() };
}), dayMount = document.createElement('div');
dayMount.className = 'day-mount'; mainElement.append(dayMount);
let activeDay = data.initialDay;
const returnDayKey = 'my-timeline-return-day';
function rememberDayForReturn() { try { localStorage.setItem(returnDayKey, JSON.stringify({ root: data.root, day: activeDay, at: Date.now() })); } catch {} }
try {
  const saved = JSON.parse(localStorage.getItem(returnDayKey) ?? 'null');
  if (saved?.root === data.root && Date.now() - saved.at < 30 * 60_000) {
    localStorage.removeItem(returnDayKey);
    activeDay = (dayGroups.find(group => group.date >= saved.day) ?? dayGroups.at(-1))?.date ?? activeDay;
  }
} catch {}
for (const link of document.querySelectorAll('a[href^="http://127.0.0.1:4177/delete?"]')) link.addEventListener('click', rememberDayForReturn);
function parkDayGroups() { for (const group of dayGroups) for (const node of group.nodes) group.fragment.append(node); }
function renderDayView() {
  parkDayGroups(); dayMount.replaceChildren();
  if (isFiltering()) {
    for (const group of dayGroups) {
      const matches = group.nodes.filter(node => node.matches?.('.event-shell') && !node.querySelector('.event').hidden);
      if (matches.length) dayMount.append(group.nodes[0], ...matches);
    }
    day.value = ''; previousDayButton.disabled = true; nextDayButton.disabled = true;
  } else {
    const index = Math.max(0, dayGroups.findIndex(group => group.date === activeDay)), group = dayGroups[index];
    activeDay = group.date; day.value = activeDay; dayMount.append(...group.nodes);
    previousDayButton.disabled = index === 0; nextDayButton.disabled = index === dayGroups.length - 1;
  }
  if (overview.scope === 'day') refreshOverviewMap();
}
function chooseDay(date) {
  activeDay = date; q.value = ''; for (const box of sourceBoxes) box.checked = true; updateSourceCount();
  filter(); updateDateBars(); renderDayView(); window.scrollTo(0, 0);
}
previousDayButton.addEventListener('click', () => { const index = dayGroups.findIndex(group => group.date === activeDay); if (index > 0) chooseDay(dayGroups[index - 1].date); });
nextDayButton.addEventListener('click', () => { const index = dayGroups.findIndex(group => group.date === activeDay); if (index < dayGroups.length - 1) chooseDay(dayGroups[index + 1].date); });
day.addEventListener('change', () => { if (day.value) chooseDay(day.value); });

const pageRoot = location.protocol === 'file:' ? decodeURIComponent(location.pathname).replace(/\/[^/]*$/, '') : data.root;
if (pageRoot) fetch('http://127.0.0.1:4177/api/refresh-timeline', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ root: pageRoot, renderedRoot: data.root, renderVersion: data.renderVersion }) })
  .then(response => response.json()).then(result => {
    if (!result.updated) return;
    const rendered = `${data.renderVersion} ${data.root}`;
    try { if (sessionStorage.getItem('my-timeline-refreshed') === rendered) return; sessionStorage.setItem('my-timeline-refreshed', rendered); } catch { return; }
    location.reload();
  }).catch(() => {});
const resumeRepairButton = document.querySelector('#resume-repair'), repairMessage = document.querySelector('#repair-message');
resumeRepairButton?.addEventListener('click', async () => {
  resumeRepairButton.disabled = true;
  try {
    const response = await fetch('http://127.0.0.1:4177/api/repair-media', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ root: pageRoot }) }), result = await response.json();
    if (!response.ok) { repairMessage.textContent = result.error ?? '補完を開始できませんでした。'; resumeRepairButton.disabled = false; return; }
    repairMessage.textContent = result.started ? '補完を開始しました。取得できた分から順にタイムラインへ反映されます（再読み込みで確認できます）。' : '未取得の原寸画像はありません。再読み込みしてください。';
  } catch { repairMessage.textContent = 'My Timelineが起動していません。My Timeline.commandで起動してから押してください。'; resumeRepairButton.disabled = false; }
});
if (resumeRepairButton) {
  const pendingCount = resumeRepairButton.parentElement.querySelector('strong');
  const pollRepair = async () => {
    try {
      const result = await (await fetch(`http://127.0.0.1:4177/api/repair-status?root=${encodeURIComponent(pageRoot)}`)).json();
      if (!Number.isInteger(result.pending)) return;
      pendingCount.textContent = result.pending;
      if (!result.pending) { resumeRepairButton.hidden = true; repairMessage.textContent = '補完が完了しました。再読み込みすると原寸画像で表示されます。'; clearInterval(repairTimer); }
    } catch {}
  };
  const repairTimer = setInterval(pollRepair, 5_000); pollRepair();
}
size.addEventListener('click', () => {
  const large = document.body.classList.toggle('large-images');
  size.setAttribute('aria-pressed', String(large)); size.textContent = large ? '画像を小さく表示' : '画像を大きく表示';
});
renderDayView();
