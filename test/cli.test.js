import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('reports failed sources as warnings while keeping successful ones', async t => {
  const strava = createServer((request, response) => { response.setHeader('content-type', 'application/json'); response.end(request.url.startsWith('/athlete/activities') ? JSON.stringify([{ id: 1, name: 'ライド', start_date: '2026-05-01T00:00:00Z', elapsed_time: 60 }]) : '{}'); });
  await new Promise(resolve => strava.listen(0, '127.0.0.1', resolve)); t.after(() => strava.close());
  const output = path.join(await mkdtemp(path.join(tmpdir(), 'cli-warning-')), 'out');
  const env = { ...process.env, MY_TIMELINE_PROGRESS: '1', STRAVA_API_BASE_URL: `http://127.0.0.1:${strava.address().port}`, STRAVA_CLIENT_ID: '1', STRAVA_CLIENT_SECRET: 's', STRAVA_REFRESH_TOKEN: 'r', STRAVA_ACCESS_TOKEN: 'a', STRAVA_EXPIRES_AT: String(Math.floor(Date.now() / 1000) + 7200) };
  const child = spawn(process.execPath, ['src/cli.js', 'collect', '--from', '2026-05-01', '--to', '2026-05-02', '--sources', 'bluesky,strava', '--bskylog-url', 'http://127.0.0.1:9/sse', '--output', output], { env });
  let stdout = '', stderr = ''; child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
  const code = await new Promise(resolve => child.on('close', resolve));
  assert.equal(code, 0); assert.equal(stdout.trim(), output);
  const warnings = stderr.split('\n').filter(line => line.startsWith('MY_TIMELINE_PROGRESS ')).map(line => JSON.parse(line.slice(21))).find(update => update.warnings)?.warnings;
  assert.equal(warnings.length, 1); assert.match(warnings[0], /^Bluesky: /);
  const summary = stderr.split('\n').filter(line => line.startsWith('MY_TIMELINE_PROGRESS ')).map(line => JSON.parse(line.slice(21))).find(update => update.summary)?.summary;
  assert.deepEqual(summary.map(item => item.source), ['bluesky', 'strava']); assert.equal(summary[0].total, 0); assert.ok(summary[1].total > 0);
  const [collection] = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8')).collections;
  assert.deepEqual(collection.sources, ['bluesky', 'strava']); assert.deepEqual(collection.summary, summary); assert.equal(collection.warnings.length, 1);
});
