import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { collectStrava, enrichStravaPositions } from './collectors/strava.js';
import { renderHtml } from './lib/workspace.js';
import { parseDate } from './lib/utils.js';

const root = path.resolve(process.argv[2] ?? '');
if (!path.basename(root).startsWith('My Timeline ')) throw new Error('My Timelineの出力フォルダを指定してください。');
const manifestPath = path.join(root, 'manifest.json'), original = await readFile(manifestPath, 'utf8'), manifest = JSON.parse(original);
await writeFile(path.join(root, '.timeline-cache', 'manifest-before-strava-progress-repair.json'), original, { flag: 'wx' }).catch(error => { if (error.code !== 'EEXIST') throw error; });
const fresh = await collectStrava({ from: parseDate(manifest.from), to: parseDate(manifest.to, true), clientId: process.env.STRAVA_CLIENT_ID, clientSecret: process.env.STRAVA_CLIENT_SECRET, refreshToken: process.env.STRAVA_REFRESH_TOKEN, accessToken: process.env.STRAVA_ACCESS_TOKEN, expiresAt: process.env.STRAVA_EXPIRES_AT });
const freshById = new Map(fresh.map(event => [event.sourceId, event]));
for (const event of manifest.events) {
  const freshEvent = freshById.get(event.sourceId);
  if (event.source === 'strava' && freshEvent?.routeGeometry) event.routeGeometry = freshEvent.routeGeometry;
  delete event.routeProgress;
  if (event.locationInferredFromStrava) { event.location = null; delete event.locationInferredFromStrava; }
}
enrichStravaPositions(manifest.events.filter(event => !event.related));
manifest.events.sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt));
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(path.join(root, 'timeline.html'), renderHtml(manifest));
console.log(`${manifest.events.filter(event => event.routeProgress).length}件にStrava走行距離を設定しました`);
