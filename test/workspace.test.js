import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createWorkspace } from '../src/lib/workspace.js';
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
  assert.match(html, /走行ルート/); assert.match(html, /tile\.openstreetmap\.org/); assert.match(html, /L\.polyline/); assert.match(html, /10 km/);
});

test('places keyword matches outside the trip in a related materials section', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'timeline-related-test-'));
  await createWorkspace({ output: root, title: '旅行', fromText: '2026-06-16', toText: '2026-06-29', events: [
    { source: 'bluesky', sourceId: 'trip', occurredAt: '2026-06-17T09:00:00+09:00', text: '旅行中', media: [] },
    { source: 'gmail', sourceId: 'booking', occurredAt: '2026-02-01T09:00:00+09:00', text: '予約確認', media: [], related: true }
  ] });
  const html = await readFile(path.join(root, 'timeline.html'), 'utf8');
  assert.ok(html.indexOf('旅行中') < html.indexOf('関連資料（期間外）'));
  assert.match(html, /gmail · 関連資料/);
  assert.doesNotMatch(html, /<option value="2026-02-01">/);
});
