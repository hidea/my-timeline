import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { appendEventsToWorkspace, createWorkspace } from '../src/lib/workspace.js';
import { addManualMaterial } from '../src/manual-material.js';
import { deleteTimelineEvent, deleteTimelineEvents } from '../src/delete-event.js';
import { importEmlFiles } from '../src/import-eml.js';
test('creates a disposable writing workspace', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'timeline-test-'));
  await createWorkspace({ output: root, title: '京都旅行', fromText: '2025-08-01', toText: '2025-08-02', events: [{ source: 'bluesky', sourceId: 'abc', occurredAt: '2025-08-01T09:00:00+09:00', text: '京都に着いた', media: [] }] });
  const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'))), html = await readFile(path.join(root, 'timeline.html'), 'utf8');
  assert.equal(manifest.events.length, 1); assert.match(html, /京都に着いた/); assert.match(html, /content-visibility:auto/); assert.match(html, /icons\/bluesky\.png/); assert.match(html, /light-dark\(#f1f8ff,#202b35\)/);
  assert.ok((await readFile(path.join(root, '.timeline-cache', 'icons', 'bluesky.png'))).length > 0);
});

test('renders a Strava route beside ride details', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'timeline-route-test-'));
  await createWorkspace({ output: root, title: 'ライド', fromText: '2026-05-02', toText: '2026-05-02', events: [{ source: 'strava', sourceId: '1:start', occurredAt: '2026-05-02T00:00:00Z', text: '▶ スタート\n距離 10 km', originalUrl: 'https://www.strava.com/activities/1', media: [], routeGeometry: { coordinates: [[35, 139], [35.1, 139.2]], totalDistanceMeters: 10000 } }] });
  const html = await readFile(path.join(root, 'timeline.html'), 'utf8');
  assert.match(html, /走行ルート/); assert.match(html, /tile\.openstreetmap\.org/); assert.match(html, /L\.polyline/); assert.match(html, /new ResizeObserver\(fitRoute\)/); assert.match(html, /invalidateSize\(\)/); assert.match(html, /padding:\[40,40\]/); assert.doesNotMatch(html, /zoomOut/); assert.match(html, /10 km/);
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
  const eml = ['From: sender@example.com', 'To: reader@example.com', 'Subject: =?UTF-8?B?5LqI57SE56K66KqN?=', 'Date: Tue, 16 Jun 2026 10:30:00 +0900', 'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="test-boundary"', '', '--test-boundary', 'Content-Type: text/plain; charset=UTF-8', '', '**予約番号** ABC123', '--test-boundary', 'Content-Type: text/plain; name="ticket.txt"', 'Content-Disposition: attachment; filename="ticket.txt"', '', 'ticket body', '--test-boundary--', ''].join('\r\n');
  const result = await importEmlFiles(root, [{ name: 'booking.eml', type: 'message/rfc822', data: Buffer.from(eml).toString('base64') }]);
  const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8')), html = await readFile(path.join(root, 'timeline.html'), 'utf8');
  assert.equal(result.imported, 1); assert.equal(manifest.events[0].source, 'eml'); assert.equal(manifest.events[0].occurredAt, '2026-06-16T01:30:00.000Z');
  assert.match(html, /予約確認/); assert.match(html, /<strong>予約番号<\/strong>/); assert.match(html, />booking\.eml<\/a>/); assert.match(html, />ticket\.txt<\/a>/);
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
