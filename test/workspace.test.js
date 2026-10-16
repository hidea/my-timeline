import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { appendEventsToWorkspace, createWorkspace, RENDER_VERSION, refreshOutdatedTimelines } from '../src/lib/workspace.js';
import { addManualMaterial } from '../src/manual-material.js';
import { deleteTimelineEvent, deleteTimelineEvents } from '../src/delete-event.js';
import { importEmlFiles } from '../src/import-eml.js';
test('creates a disposable writing workspace', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'timeline-test-'));
  await createWorkspace({ output: root, title: '京都旅行', fromText: '2025-08-01', toText: '2025-08-02', events: [{ source: 'bluesky', sourceId: 'abc', occurredAt: '2025-08-01T09:00:00+09:00', text: '京都に着いた', media: [] }] });
  const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'))), html = await readFile(path.join(root, 'timeline.html'), 'utf8');
  assert.equal(manifest.events.length, 1); assert.match(html, /京都に着いた/); assert.match(html, /content-visibility:auto/); assert.match(html, /icons\/bluesky\.png/); assert.match(html, /style="--source-color:#1185fe"/); assert.doesNotMatch(html, /light-dark\(#f1f8ff/);
  assert.ok((await readFile(path.join(root, '.timeline-cache', 'icons', 'bluesky.png'))).length > 0);
  for (const name of ['itinerary.md', 'outline.md', 'draft.md', 'selected']) await assert.rejects(access(path.join(root, name)), { code: 'ENOENT' });
});

test('renders a Strava route beside ride details', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'timeline-route-test-'));
  await createWorkspace({ output: root, title: 'ライド', fromText: '2026-05-02', toText: '2026-05-02', events: [{ source: 'strava', sourceId: '1:start', occurredAt: '2026-05-02T00:00:00Z', text: '▶ スタート\n距離 10 km', originalUrl: 'https://www.strava.com/activities/1', media: [], routeGeometry: { coordinates: [[35, 139], [35.1, 139.2]], totalDistanceMeters: 10000 } }] });
  const html = await readFile(path.join(root, 'timeline.html'), 'utf8');
  assert.match(html, /走行ルート/); assert.match(html, /tiles\.openfreemap\.org/); assert.match(html, /L\.polyline/); assert.match(html, /new ResizeObserver\(fitRoute\)/); assert.match(html, /invalidateSize\(\)/); assert.match(html, /padding:\[40,40\]/); assert.doesNotMatch(html, /zoomOut/); assert.match(html, /10 km/);
  assert.match(html, /<iframe src="about:blank" data-srcdoc=/); assert.doesNotMatch(html, /<iframe srcdoc=/); assert.match(html, /new IntersectionObserver/); assert.match(html, /frame\.src='about:blank'/);
});

test('renders date bars, time at bottom right, icon links, and outside card selectors', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'timeline-design-test-'));
  await createWorkspace({ output: root, title: '行事', fromText: '2026-05-02', toText: '2026-05-03', events: [
    { source: 'bluesky', sourceId: 'one', occurredAt: '2026-05-02T09:00:00+09:00', text: '一日目', originalUrl: 'https://example.com/one', media: [] },
    { source: 'bluesky', sourceId: 'two', occurredAt: '2026-05-03T09:00:00+09:00', text: '二日目', media: [] }
  ] });
  const html = await readFile(path.join(root, 'timeline.html'), 'utf8'), footer = html.match(/<footer>[\s\S]*?<\/footer>/)?.[0] ?? '';
  assert.equal((html.match(/class="date-bar"/g) ?? []).length, 2); assert.match(html, /2026年5月2日\(土\)/); assert.match(html, /<option value="2026-05-02">2026年5月2日\(土\)<\/option>/); assert.match(html, /c\.querySelector\('footer'\)\.prepend\(box\)/); assert.doesNotMatch(html, /shell\.append\(box\)/); assert.match(html, /\.event-shell\{position:relative\}/); assert.doesNotMatch(html, /\.card-select\{position:absolute/); assert.match(html, /<header><img class="source-icon" src="\.timeline-cache\/icons\/bluesky\.png" alt="bluesky" title="bluesky" width="30" height="30"><\/header>/); assert.equal((footer.match(/<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"/g) ?? []).length, 3); assert.doesNotMatch(html, /material-symbols|>description<|>open_in_new<|>delete<|>chevron_left<|>more_horiz</); for (const label of ['記録', '元ページ', '削除']) assert.match(footer, new RegExp(`aria-label="${label}" title="${label}"><svg`)); assert.doesNotMatch(footer, /<\/svg>(記録|元ページ|削除)</); assert.doesNotMatch(footer, /📝|↗|🗑| · /); assert.match(html, /footer a\{[^}]*text-decoration:none/);
  assert.match(footer, /<time class="event-time"/); assert.match(html, /\.event\.text-only\.deferred\{content-visibility:visible;contain-intrinsic-size:none\}/);
  assert.match(html, /class="day-navigation" role="group"/); assert.match(html, /id="previous-day" type="button" aria-label="前の日"/); assert.match(html, /id="next-day" type="button" aria-label="次の日"/); assert.match(html, /function renderDayView\(\)/); assert.match(html, /new DocumentFragment\(\)/);
  const more = html.match(/<details class="menu more-menu">[\s\S]*?<\/details>/)?.[0] ?? '';
  for (const id of ['select-visible', 'clear-selection', 'image-size']) assert.match(more, new RegExp(`id="${id}"`));
  assert.match(html, /<button id="delete-selection" class="danger" type="button" hidden>/); assert.doesNotMatch(more, /delete-selection/);
});

test('shows local time from card location together with Japan time', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'timeline-timezone-test-'));
  await createWorkspace({ output: root, title: '行事', fromText: '2026-06-16', toText: '2026-06-17', events: [
    { source: 'flickr', sourceId: 'nyc', occurredAt: '2026-06-16T12:00:00Z', text: 'ニューヨーク', location: { latitude: 40.7128, longitude: -74.006 }, media: [] },
    { source: 'memo', sourceId: 'japan', occurredAt: '2026-06-16T13:00:00Z', text: '位置なし', media: [] }
  ] });
  const html = await readFile(path.join(root, 'timeline.html'), 'utf8');
  assert.match(html, /\(2026\/6\/16 21:00:00 JST\)<\/span><span>2026\/6\/16 0?8:00:00 (?:EDT|GMT-4)/); assert.match(html, /class="event-time event-time-inferred" datetime="2026-06-16T13:00:00Z" data-time-inherited-from="nyc"/); assert.match(html, /\(2026\/6\/16 22:00:00 JST\)<\/span><span>2026\/6\/16 0?9:00:00 (?:EDT|GMT-4)/); assert.doesNotMatch(html, /現地 |日本時間 /);
});

test('places keyword matches in complete chronological order', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'timeline-related-test-'));
  await createWorkspace({ output: root, title: '旅行', fromText: '2026-06-16', toText: '2026-06-29', events: [
    { source: 'bluesky', sourceId: 'trip', occurredAt: '2026-06-17T09:00:00+09:00', text: '旅行中', media: [] },
    { source: 'gmail', sourceId: 'booking', occurredAt: '2026-02-01T09:00:00+09:00', text: '予約確認', media: [], related: true }
  ] });
  const html = await readFile(path.join(root, 'timeline.html'), 'utf8');
  assert.ok(html.indexOf('予約確認') < html.indexOf('旅行中'));
  assert.doesNotMatch(html, /関連資料/);
  assert.match(html, /<option value="2026-02-01">/);
});

test('adds a manual material and inserts it by time', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'manual-parent-')), root = path.join(parent, 'My Timeline test');
  await createWorkspace({ output: root, title: '旅行', fromText: '2026-06-16', toText: '2026-06-17', events: [{ source: 'bluesky', sourceId: 'later', occurredAt: '2026-06-17T12:00:00+09:00', text: '後', media: [] }] });
  await addManualMaterial(root, { source: 'place', occurredAt: '2026-06-16T10:00', text: '立ち寄り', latitude: '35', longitude: '139', files: [] });
  const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8')), html = await readFile(path.join(root, 'timeline.html'), 'utf8');
  assert.equal(manifest.events[0].source, 'place'); assert.match(html, /立ち寄り/); assert.match(html, /素材を追加/); assert.match(html, /icons\/place\.png/);
});

test('does not add a map when manual location fields are blank', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'manual-no-location-')), root = path.join(parent, 'My Timeline test');
  await createWorkspace({ output: root, title: '旅行', fromText: '2026-06-16', toText: '2026-06-17', events: [] });
  await addManualMaterial(root, { source: 'memo', occurredAt: '2026-06-16T10:00', text: '位置なし', latitude: '', longitude: '', files: [] });
  const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8')), html = await readFile(path.join(root, 'timeline.html'), 'utf8');
  assert.equal(manifest.events[0].location, null); assert.doesNotMatch(html, /撮影場所/); assert.match(html, /全文を表示／閉じる/);
});

test('renders Gmail and memo Markdown without allowing raw HTML or unsafe links', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'timeline-markdown-test-'));
  await createWorkspace({ output: root, title: '旅行', fromText: '2026-06-16', toText: '2026-06-17', events: [{
    source: 'gmail', sourceId: 'markdown-mail', occurredAt: '2026-06-16T10:00:00+09:00', media: [],
    text: '# 予約内容\n\n**重要**です。 [予約ページ](https://example.com/booking)\n\n- 往路\n- 復路\n\n<script>alert(1)</script>\n\n[危険](javascript:alert(1))'
  }] });
  const html = await readFile(path.join(root, 'timeline.html'), 'utf8');
  assert.match(html, /<h3>予約内容<\/h3>/);
  assert.match(html, /<strong>重要<\/strong>/);
  assert.match(html, /<a href="https:\/\/example\.com\/booking" target="_blank" rel="noreferrer">予約ページ<\/a>/);
  assert.match(html, /<ul><li>往路<\/li><li>復路<\/li><\/ul>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(html, /href="javascript:/);
});

test('imports EML using its sent date and preserves attachments', async () => {
  const root = path.join(await mkdtemp(path.join(tmpdir(), 'eml-parent-')), 'My Timeline EML test');
  await createWorkspace({ output: root, title: '旅行', fromText: '2026-06-16', toText: '2026-06-17', events: [] });
  const eml = ['From: sender@example.com', 'To: reader@example.com', 'Subject: =?UTF-8?B?5LqI57SE56K66KqN?=', 'Date: Tue, 16 Jun 2026 10:30:00 +0900', 'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="test-boundary"', '', '--test-boundary', 'Content-Type: text/plain; charset=UTF-8', '', '**予約番号** ABC123', '--test-boundary', 'Content-Type: text/plain; name="ticket.txt"', 'Content-Disposition: attachment; filename="ticket.txt"', '', 'ticket body', '--test-boundary', 'Content-Type: image/png; name="map.png"', 'Content-Disposition: attachment; filename="map.png"', 'Content-Transfer-Encoding: base64', '', 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', '--test-boundary--', ''].join('\r\n');
  const result = await importEmlFiles(root, [{ name: 'booking.eml', type: 'message/rfc822', data: Buffer.from(eml).toString('base64') }]);
  const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8')), html = await readFile(path.join(root, 'timeline.html'), 'utf8');
  assert.equal(result.imported, 1); assert.equal(manifest.events[0].source, 'eml'); assert.equal(manifest.events[0].occurredAt, '2026-06-16T01:30:00.000Z');
  assert.match(html, /予約確認/); assert.match(html, /<strong>予約番号<\/strong>/); assert.match(html, />booking\.eml<\/a>/); assert.match(html, />ticket\.txt<\/a>/); assert.match(html, />map\.png<\/a>/); assert.doesNotMatch(html, /class="image-link"/);
});

test('appends only new source events without rewriting existing materials', async () => {
  const root = path.join(await mkdtemp(path.join(tmpdir(), 'append-source-')), 'My Timeline test');
  await createWorkspace({ output: root, title: '旅行', fromText: '2026-06-16', toText: '2026-06-17', events: [{ source: 'flickr', sourceId: 'photo-1', occurredAt: '2026-06-16T10:00:00+09:00', text: '既存写真', media: [] }] });
  const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const result = await appendEventsToWorkspace(root, [{ source: 'flickr', sourceId: 'photo-1', occurredAt: '2026-06-16T10:00:00+09:00', text: '重複', media: [{ url: image }] }, { source: 'gmail', sourceId: 'mail-1', occurredAt: '2026-06-16T11:00:00+09:00', text: '新規メール', media: [] }]);
  const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
  assert.equal(result.added, 1); assert.equal(result.repaired, 1); assert.equal(manifest.events.length, 2); assert.equal(manifest.events.filter(event => event.sourceId === 'photo-1').length, 1); assert.equal(manifest.events.find(event => event.sourceId === 'photo-1').files.length, 1);
});

test('deletes a card and moves its material to recoverable timeline trash', async () => {
  const root = path.join(await mkdtemp(path.join(tmpdir(), 'delete-card-')), 'My Timeline test');
  await createWorkspace({ output: root, title: '旅行', fromText: '2026-06-16', toText: '2026-06-17', events: [{ source: 'memo', sourceId: 'remove-me', occurredAt: '2026-06-16T10:00:00+09:00', text: '削除対象', media: [] }] });
  const result = await deleteTimelineEvent(root, 'memo', 'remove-me'), manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8')), html = await readFile(path.join(root, 'timeline.html'), 'utf8');
  assert.equal(manifest.events.length, 0); assert.doesNotMatch(html, /削除対象/); assert.match(await readFile(path.join(result.trash, 'event.json'), 'utf8'), /remove-me/);
});

test('bulk deletes only checked card ids and keeps the rest', async () => {
  const root = path.join(await mkdtemp(path.join(tmpdir(), 'bulk-delete-')), 'My Timeline test');
  await createWorkspace({ output: root, title: '旅行', fromText: '2026-06-16', toText: '2026-06-17', events: [
    { source: 'gmail', sourceId: 'mail-1', occurredAt: '2026-06-16T10:00:00+09:00', text: '削除するメール', media: [] },
    { source: 'gmail', sourceId: 'mail-2', occurredAt: '2026-06-16T11:00:00+09:00', text: '残すメール', media: [] }
  ] });
  let html = await readFile(path.join(root, 'timeline.html'), 'utf8'); assert.match(html, /表示中をすべて選択/); assert.match(html, /すべて外す/);
  const result = await deleteTimelineEvents(root, ['gmail:mail-1']), manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
  assert.equal(result.deleted, 1); assert.deepEqual(manifest.events.map(event => event.sourceId), ['mail-2']); assert.match(await readFile(path.join(result.trash, '0001', 'event.json'), 'utf8'), /mail-1/);
});

test('renders multi-select source filters, card keys, and an overview map with day/all scopes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'timeline-overview-test-'));
  await createWorkspace({ output: root, title: '行事', fromText: '2026-05-02', toText: '2026-05-03', events: [
    { source: 'strava', sourceId: '1:start', occurredAt: '2026-05-02T08:00:00+09:00', text: '▶ スタート', originalUrl: 'https://www.strava.com/activities/1', location: { latitude: 35, longitude: 139 }, media: [], routeGeometry: { coordinates: [[35, 139], [35.1, 139.2]], totalDistanceMeters: 10000 } },
    { source: 'strava', sourceId: '1:end', occurredAt: '2026-05-02T10:00:00+09:00', text: '■ ゴール', originalUrl: 'https://www.strava.com/activities/1', location: { latitude: 35.1, longitude: 139.2 }, media: [], routeGeometry: { coordinates: [[35, 139], [35.1, 139.2]], totalDistanceMeters: 10000 } },
    { source: 'flickr', sourceId: 'photo<1>', occurredAt: '2026-05-03T09:00:00+09:00', text: '写真</script>', location: { latitude: '35.5', longitude: '139.5' }, media: [] },
    { source: 'bluesky', sourceId: 'post', occurredAt: '2026-05-03T10:00:00+09:00', text: '位置なし', media: [] }
  ] });
  const html = await readFile(path.join(root, 'timeline.html'), 'utf8'), data = JSON.parse(html.match(/<script type="application\/json" id="timeline-data">([\s\S]*?)<\/script>/)[1]);
  assert.match(html, /<details class="menu source-menu"><summary>取得元<span id="source-count"/); assert.match(html, /<fieldset class="source-filter menu-panel">/); for (const source of ['strava', 'flickr', 'bluesky']) assert.match(html, new RegExp(`<input type="checkbox" value="${source}" checked>`)); assert.doesNotMatch(html, /<select id="source">/);
  assert.match(html, /data-key="flickr:photo&lt;1&gt;"/);
  const card = key => html.match(new RegExp(`<article[^>]*data-key="${key}"[\\s\\S]*?</article>`))?.[0] ?? '', goal = card('strava:1:end');
  assert.match(goal, /class="event text-only goal/); assert.doesNotMatch(goal, /route-map|<iframe/); assert.match(goal, /<a class="jump-start" href="#" data-key="strava:1:start" data-date="2026-05-02">▶ スタートへ<\/a>/);
  assert.match(card('strava:1:start'), /class="route-map"/); assert.doesNotMatch(card('strava:1:start'), /Stravaで開く/);
  assert.match(card('flickr:photo&lt;1&gt;'), /<details class="map"><summary>/); assert.doesNotMatch(card('flickr:photo&lt;1&gt;'), /<details class="map" open/);
  assert.match(html, /<details id="overview-map" class="overview-map">/); assert.match(html, /data-scope="day" aria-pressed="true">この日/); assert.match(html, /<iframe id="overview-map-frame"[^>]*data-srcdoc="[^"]*tiles\.openfreemap\.org/); assert.match(html, /data-scope="all" aria-pressed="false">全期間/);
  assert.equal(data.root, root); assert.equal(data.initialDay, '2026-05-02');
  assert.equal(data.map.routes.length, 1); assert.deepEqual(data.map.routes[0], { key: 'strava:1:start', date: '2026-05-02', coords: [[35, 139], [35.1, 139.2]] });
  assert.deepEqual(data.map.points.map(point => [point.key, point.date, point.lat, point.lon]), [['flickr:photo<1>', '2026-05-03', 35.5, 139.5]]);
  assert.doesNotMatch(html.match(/id="timeline-data">[\s\S]*?<\/script>/)[0].slice(0, -9), /<\/script/);
});

test('omits the overview map without locations and keeps an empty timeline usable', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'timeline-no-map-test-'));
  await createWorkspace({ output: root, title: '行事', fromText: '2026-05-02', toText: '2026-05-02', events: [{ source: 'bluesky', sourceId: 'post', occurredAt: '2026-05-02T10:00:00+09:00', text: '位置なし', media: [] }] });
  assert.doesNotMatch(await readFile(path.join(root, 'timeline.html'), 'utf8'), /id="overview-map"/);
  const empty = await mkdtemp(path.join(tmpdir(), 'timeline-empty-test-'));
  await createWorkspace({ output: empty, title: '行事', fromText: '2026-05-02', toText: '2026-05-02', events: [] });
  const html = await readFile(path.join(empty, 'timeline.html'), 'utf8');
  assert.match(html, /該当する素材はありません/); assert.match(html, /素材を追加/);
});

test('builds the timeline from Flickr preview images first and fetches originals afterwards with resume', async t => {
  const { createServer } = await import('node:http'), { repairWorkspaceMedia } = await import('../src/lib/repair.js');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'), hits = [];
  const server = createServer((request, response) => { hits.push(request.url); if (request.url === '/o/broken.png') { response.statusCode = 404; response.end(); return; } response.end(Buffer.concat([png, Buffer.from(request.url)])); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`, root = await mkdtemp(path.join(tmpdir(), 'timeline-deferred-test-'));
  await createWorkspace({ output: root, title: '行事', fromText: '2026-05-02', toText: '2026-05-02', events: [
    { source: 'flickr', sourceId: 'p1', occurredAt: '2026-05-02T09:00:00+09:00', text: '一枚目', media: [{ url: `${base}/o/one.png`, previewUrl: `${base}/l/one.png`, deferOriginal: true }] },
    { source: 'flickr', sourceId: 'p2', occurredAt: '2026-05-02T10:00:00+09:00', text: '二枚目', media: [{ url: `${base}/o/broken.png`, previewUrl: `${base}/l/two.png`, deferOriginal: true }] }
  ] });
  assert.deepEqual(hits.sort(), ['/l/one.png', '/l/two.png']);
  let manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8')), html = await readFile(path.join(root, 'timeline.html'), 'utf8');
  const first = manifest.events[0];
  assert.deepEqual(first.files, [first.previews[0]]); assert.match(first.files[0], /^\.timeline-cache\//); assert.equal(first.pendingOriginals.length, 1); assert.equal(first.pendingOriginals[0].file, `materials/${path.basename(first.files[0])}`);
  assert.doesNotMatch(await readFile(path.join(root, first.markdown), 'utf8'), /!\[画像/); assert.match(html, /原寸画像 未取得 <strong>2<\/strong>件/); assert.match(html, /id="resume-repair"/);
  const progress = [], result = await repairWorkspaceMedia(root, { onProgress: update => progress.push(update) });
  assert.deepEqual(result, { total: 2, repaired: 1 }); assert.deepEqual(progress.at(-1), { done: 2, total: 2, repaired: 1 });
  manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8')); html = await readFile(path.join(root, 'timeline.html'), 'utf8');
  const [repairedEvent, failedEvent] = manifest.events;
  assert.equal(repairedEvent.pendingOriginals, undefined); assert.match(repairedEvent.files[0], /^materials\//); assert.match((await readFile(path.join(root, repairedEvent.files[0]))).toString(), /\/o\/one\.png$/);
  assert.match(await readFile(path.join(root, repairedEvent.markdown), 'utf8'), new RegExp(`!\\[画像1\\]\\(${path.basename(repairedEvent.files[0]).replace('.', '\\.')}\\)`));
  assert.equal(failedEvent.pendingOriginals.length, 1); assert.match(failedEvent.files[0], /^\.timeline-cache\//); assert.match(html, /原寸画像 未取得 <strong>1<\/strong>件/);
  hits.length = 0; await createWorkspace({ output: root, title: '行事', fromText: '2026-05-02', toText: '2026-05-02', events: [{ source: 'flickr', sourceId: 'p1', occurredAt: '2026-05-02T09:00:00+09:00', text: '一枚目', media: [{ url: `${base}/o/one.png`, previewUrl: `${base}/l/one.png`, deferOriginal: true }] }] });
  assert.deepEqual(hits, []); assert.equal(JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8')).events[0].pendingOriginals, undefined);
});

test('refreshes only outdated My Timeline workspaces in a directory', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'refresh-scan-')), events = [{ source: 'memo', sourceId: 'm1', occurredAt: '2026-06-16T10:00:00+09:00', text: 'メモ', media: [] }];
  const make = async name => { const root = path.join(dir, name); await createWorkspace({ output: root, title: '旅行', fromText: '2026-06-16', toText: '2026-06-17', events }); return root; };
  const outdated = await make('My Timeline 古い'), current = await make('My Timeline 新しい'), other = await make('別のフォルダ');
  await writeFile(path.join(outdated, 'timeline.html'), 'old'); await writeFile(path.join(other, 'timeline.html'), 'old');
  const currentHtml = await readFile(path.join(current, 'timeline.html'), 'utf8');
  assert.deepEqual(await refreshOutdatedTimelines(dir), [outdated]);
  assert.match(await readFile(path.join(outdated, 'timeline.html'), 'utf8'), new RegExp(`"renderVersion":"${RENDER_VERSION}"`));
  assert.equal(await readFile(path.join(current, 'timeline.html'), 'utf8'), currentHtml);
  assert.equal(await readFile(path.join(other, 'timeline.html'), 'utf8'), 'old');
});

test('keeps a Strava goal card without a start link when the start card is gone', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'timeline-goal-test-'));
  await createWorkspace({ output: root, title: 'ライド', fromText: '2026-05-02', toText: '2026-05-02', events: [{ source: 'strava', sourceId: '1:end', occurredAt: '2026-05-02T10:00:00+09:00', text: '■ ゴール', originalUrl: 'https://www.strava.com/activities/1', media: [], routeGeometry: { coordinates: [[35, 139], [35.1, 139.2]], totalDistanceMeters: 10000 } }] });
  const html = await readFile(path.join(root, 'timeline.html'), 'utf8');
  assert.match(html, /class="event text-only goal/); assert.doesNotMatch(html, /class="jump-start"/); assert.doesNotMatch(html, /class="route-map"/);
});
