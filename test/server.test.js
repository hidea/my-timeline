import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createWorkspace } from '../src/lib/workspace.js';
import { createAppServer } from '../src/server.js';

async function startServer(options = {}) {
  const opened = [], server = createAppServer({ openTarget: async target => { opened.push(target); }, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (pathname, body) => { const response = await fetch(base + pathname, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) }); return { status: response.status, body: await response.json() }; };
  return { server, opened, request, close: () => new Promise(resolve => server.close(resolve)) };
}
async function outputWorkspace(events = []) {
  const root = path.join(await mkdtemp(path.join(tmpdir(), 'server-output-')), 'custom-output');
  await createWorkspace({ output: root, title: '旅行', fromText: '2026-06-16', toText: '2026-06-17', events });
  return root;
}

test('rejects invalid input with 4xx instead of 500', async t => {
  const app = await startServer(); t.after(app.close);
  assert.equal((await app.request('/api/collect', '{broken')).status, 400);
  assert.equal((await app.request('/api/collect', { from: '2026-06-16', to: '2026-06-17', sources: ['unknown'] })).status, 400);
  assert.equal((await app.request('/api/workspace-info?root=relative/path')).status, 400);
  const missing = await app.request(`/api/workspace-info?root=${encodeURIComponent(await mkdtemp(path.join(tmpdir(), 'no-manifest-')))}`);
  assert.equal(missing.status, 400); assert.match(missing.body.error, /ワークスペースが見つかりません/);
  const root = await outputWorkspace();
  assert.equal((await app.request('/api/delete-event', { root, source: 'memo', sourceId: 'none' })).status, 404);
  assert.equal((await app.request('/api/manual-material', { root, occurredAt: 'invalid', text: 'x' })).status, 400);
});

test('adds and deletes materials in a workspace created with --output outside Downloads', async t => {
  const app = await startServer(); t.after(app.close);
  const root = await outputWorkspace([{ source: 'memo', sourceId: 'remove-me', occurredAt: '2026-06-16T10:00:00+09:00', text: '削除対象', media: [] }]);
  assert.deepEqual((await app.request(`/api/workspace-info?root=${encodeURIComponent(root)}`)).body, { title: '旅行', from: '2026-06-16', to: '2026-06-17' });
  assert.equal((await app.request('/api/manual-material', { root, source: 'memo', occurredAt: '2026-06-16T11:00', text: '追加メモ', files: [] })).status, 200);
  assert.equal((await app.request('/api/delete-event', { root, source: 'memo', sourceId: 'remove-me' })).status, 200);
  const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.events.map(event => event.text), ['追加メモ']);
  assert.ok(app.opened.every(target => target === path.join(root, 'timeline.html')));
});

test('serializes concurrent writes to the same workspace', async t => {
  const app = await startServer(); t.after(app.close);
  const root = await outputWorkspace();
  const results = await Promise.all(Array.from({ length: 6 }, (_, i) => app.request('/api/manual-material', { root, source: 'memo', occurredAt: `2026-06-16T1${i}:00`, text: `メモ${i}`, files: [] })));
  assert.ok(results.every(result => result.status === 200));
  const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.events.map(event => event.text), ['メモ0', 'メモ1', 'メモ2', 'メモ3', 'メモ4', 'メモ5']);
});

test('reports media repair failure without failing the collected timeline', async t => {
  const root = await outputWorkspace();
  const app = await startServer({ runCollectJob: async () => root, runRepairJob: async () => { throw new Error('補完プロセスが異常終了'); } }); t.after(app.close);
  assert.equal((await app.request('/api/collect', { from: '2026-06-16', to: '2026-06-17', sources: ['bluesky'] })).status, 202);
  let state;
  for (let i = 0; i < 50; i++) { state = (await app.request('/api/status')).body; if (state.status !== 'running' && state.status !== 'repairing') break; await new Promise(resolve => setTimeout(resolve, 20)); }
  assert.equal(state.status, 'complete'); assert.match(state.message, /原寸画像の補完に失敗しました: 補完プロセスが異常終了/); assert.equal(state.root, root);
});

test('saves Flickr settings from the screen and reports their status', async t => {
  const keys = ['FLICKR_API_KEY', 'FLICKR_API_SECRET', 'FLICKR_USER_ID', 'FLICKR_OAUTH_TOKEN', 'FLICKR_OAUTH_TOKEN_SECRET'], saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  t.after(() => { for (const key of keys) if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; });
  const envFile = path.join(await mkdtemp(path.join(tmpdir(), 'flickr-env-')), '.env'), app = await startServer({ envFile }); t.after(app.close);
  assert.deepEqual((await app.request('/api/flickr/status')).body, { configured: false, privateReady: false, connected: false });
  assert.equal((await app.request('/api/flickr/config', { apiKey: '', userId: '' })).status, 400);
  assert.equal((await app.request('/api/flickr/connect')).status, 400);
  assert.deepEqual((await app.request('/api/flickr/config', { apiKey: 'key-1', apiSecret: 'secret-1', userId: '24796462@N08' })).body, { configured: true, privateReady: true, connected: false });
  const env = await readFile(envFile, 'utf8');
  assert.match(env, /^FLICKR_API_KEY=key-1$/m); assert.match(env, /^FLICKR_API_SECRET=secret-1$/m); assert.match(env, /^FLICKR_USER_ID=24796462@N08$/m);
  assert.equal((await app.request('/api/flickr/callback?oauth_token=unknown&oauth_verifier=x')).status, 400);
});

test('moves only the cached Twilog OAuth files so authentication can be redone from the screen', async t => {
  const saved = { url: process.env.TWILOG_MCP_URL, token: process.env.TWILOG_MCP_TOKEN }; delete process.env.TWILOG_MCP_URL; delete process.env.TWILOG_MCP_TOKEN;
  t.after(() => { for (const [key, value] of [['TWILOG_MCP_URL', saved.url], ['TWILOG_MCP_TOKEN', saved.token]]) if (value === undefined) delete process.env[key]; else process.env[key] = value; });
  const mcpAuthDir = await mkdtemp(path.join(tmpdir(), 'mcp-auth-')), twilog = '493f49b253a05d2701e746a4676c00ee', other = '5b0f77c03466f239b1e1761841df4955';
  for (const folder of ['mcp-remote-0.1.36', 'mcp-remote-0.1.37']) await mkdir(path.join(mcpAuthDir, folder));
  for (const name of ['client_info.json', 'tokens.json', 'code_verifier.txt']) await writeFile(path.join(mcpAuthDir, 'mcp-remote-0.1.36', `${twilog}_${name}`), '{}');
  await writeFile(path.join(mcpAuthDir, 'mcp-remote-0.1.37', `${twilog}_client_info.json`), '{}'); await writeFile(path.join(mcpAuthDir, 'mcp-remote-0.1.37', `${other}_client_info.json`), '{}');
  const app = await startServer({ mcpAuthDir }); t.after(app.close);
  assert.deepEqual((await app.request('/api/twilog/status')).body, { authenticated: true, tokenOverride: false });
  const reset = (await app.request('/api/twilog/reset', {})).body;
  assert.equal(reset.moved, 4); assert.ok(reset.backup.startsWith(path.join(mcpAuthDir, 'backup-twilog-')));
  assert.deepEqual(await readdir(path.join(mcpAuthDir, 'mcp-remote-0.1.36')), []); assert.deepEqual(await readdir(path.join(mcpAuthDir, 'mcp-remote-0.1.37')), [`${other}_client_info.json`]);
  assert.equal((await readdir(path.join(reset.backup, 'mcp-remote-0.1.36'))).length, 3);
  assert.deepEqual((await app.request('/api/twilog/status')).body, { authenticated: false, tokenOverride: false });
  assert.deepEqual((await app.request('/api/twilog/reset', {})).body, { moved: 0, backup: null });
});

test('resumes pending original downloads from the timeline button without running twice', async t => {
  const calls = [];
  let release; const blocked = new Promise(resolve => { release = resolve; });
  const app = await startServer({ runRepairJob: async root => { calls.push(root); await blocked; } }); t.after(app.close);
  const root = await outputWorkspace(), manifestPath = path.join(root, 'manifest.json'), manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.deepEqual((await app.request('/api/repair-media', JSON.stringify({ root }))).body, { pending: 0, started: false });
  manifest.events.push({ source: 'flickr', sourceId: 'p1', occurredAt: '2026-06-16T10:00:00+09:00', text: '', markdown: 'materials/p1.md', files: ['.timeline-cache/p1_01.jpg'], previews: ['.timeline-cache/p1_01.jpg'], pendingOriginals: [{ index: 0, url: 'https://live.staticflickr.com/o.jpg', file: 'materials/p1_01.jpg' }] });
  await writeFile(manifestPath, JSON.stringify(manifest));
  assert.deepEqual((await app.request('/api/repair-media', JSON.stringify({ root }))).body, { pending: 1, started: true });
  assert.deepEqual((await app.request('/api/repair-media', JSON.stringify({ root }))).body, { pending: 1, started: true });
  await new Promise(resolve => setTimeout(resolve, 20)); assert.deepEqual(calls, [root]);
  release(); await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal((await app.request('/api/repair-media', JSON.stringify({ root: await mkdtemp(path.join(tmpdir(), 'not-workspace-')) }))).status, 400);
});

test('re-renders an outdated timeline when it is opened and lets file:// pages read the result', async t => {
  const app = await startServer(); t.after(app.close);
  const root = await outputWorkspace([{ source: 'memo', sourceId: 'm1', occurredAt: '2026-06-16T10:00:00+09:00', text: 'メモ', media: [] }]);
  const timeline = path.join(root, 'timeline.html');
  await writeFile(timeline, 'old');
  const refresh = renderVersion => fetch(`http://127.0.0.1:${app.server.address().port}/api/refresh-timeline`, { method: 'POST', headers: { 'content-type': 'text/plain', origin: 'null' }, body: JSON.stringify({ root, renderedRoot: root, renderVersion }) });
  const outdated = await refresh('old-version');
  assert.equal(outdated.headers.get('access-control-allow-origin'), 'null');
  assert.deepEqual(await outdated.json(), { updated: true });
  const html = await readFile(timeline, 'utf8'), version = html.match(/"renderVersion":"([0-9a-f]+)"/)[1];
  assert.deepEqual(await (await refresh(version)).json(), { updated: false });
  assert.equal(await readFile(timeline, 'utf8'), html);
});

test('re-renders a moved timeline with its new location and resumes repair there', async t => {
  const app = await startServer({ runRepairJob: async () => ({ total: 0, repaired: 0 }) }); t.after(app.close);
  const original = await outputWorkspace([{ source: 'memo', sourceId: 'm1', occurredAt: '2026-06-16T10:00:00+09:00', text: 'メモ', media: [] }]);
  const moved = path.join(path.dirname(original), 'moved'); await rename(original, moved);
  const post = (pathname, body) => fetch(`http://127.0.0.1:${app.server.address().port}${pathname}`, { method: 'POST', headers: { 'content-type': 'text/plain', origin: 'null' }, body: JSON.stringify(body) });
  const html = await readFile(path.join(moved, 'timeline.html'), 'utf8'), version = html.match(/"renderVersion":"([0-9a-f]+)"/)[1];
  assert.deepEqual(await (await post('/api/refresh-timeline', { root: moved, renderedRoot: original, renderVersion: version })).json(), { updated: true });
  assert.equal(JSON.parse(await readFile(path.join(moved, 'manifest.json'), 'utf8')).workspaceRoot, moved);
  assert.match(await readFile(path.join(moved, 'timeline.html'), 'utf8'), new RegExp(`"root":${JSON.stringify(moved).replaceAll('\\', '\\\\')}`));
  const repair = await post('/api/repair-media', { root: moved });
  assert.equal(repair.headers.get('access-control-allow-origin'), 'null'); assert.deepEqual(await repair.json(), { pending: 0, started: false });
  const missing = await post('/api/repair-media', { root: original });
  assert.equal(missing.status, 400); assert.equal(missing.headers.get('access-control-allow-origin'), 'null');
});

test('reports the remaining original images so the timeline can update its count', async t => {
  const app = await startServer(); t.after(app.close);
  const root = await outputWorkspace([{ source: 'memo', sourceId: 'm1', occurredAt: '2026-06-16T10:00:00+09:00', text: 'メモ', media: [] }]);
  const manifestPath = path.join(root, 'manifest.json'), manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.events[0].pendingOriginals = [{ index: 0, url: 'https://live.staticflickr.com/1/a_o.jpg', file: 'materials/a.jpg' }, { index: 1, url: 'https://live.staticflickr.com/1/b_o.jpg', file: 'materials/b.jpg' }];
  await writeFile(manifestPath, JSON.stringify(manifest));
  const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api/repair-status?root=${encodeURIComponent(root)}`, { headers: { origin: 'null' } });
  assert.equal(response.headers.get('access-control-allow-origin'), 'null');
  assert.deepEqual(await response.json(), { pending: 2, running: false });
});
