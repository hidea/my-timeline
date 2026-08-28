import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getFlickrExifOffset } from './collectors/flickr.js';
import { localDateTimeToIso, offsetDateTimeToIso, timeZoneAt } from './lib/timezone.js';
import { renderHtml } from './lib/workspace.js';

const root = path.resolve(process.argv[2] ?? '');
if (!path.basename(root).startsWith('My Timeline ')) throw new Error('My Timelineの出力フォルダを指定してください。');
const manifestPath = path.join(root, 'manifest.json'), originalManifest = await readFile(manifestPath, 'utf8'), manifest = JSON.parse(originalManifest);
await writeFile(path.join(root, '.timeline-cache', 'manifest-before-flickr-timezone-fix.json'), originalManifest, { flag: 'wx' }).catch(error => { if (error.code !== 'EEXIST') throw error; });
let corrected = 0;
for (const event of manifest.events) {
  if (event.source !== 'flickr' || event.flickrTakenTimeZone || !event.location || !/[+]09:00$/.test(event.occurredAt)) continue;
  const timeZone = timeZoneAt(event.location), previous = event.occurredAt;
  event.flickrTakenTimeZone = timeZone;
  event.occurredAt = localDateTimeToIso(previous, timeZone);
  if (event.occurredAt !== new Date(previous).toISOString()) corrected++;
  if (event.markdown && !event.markdown.startsWith('http')) {
    const markdownPath = path.join(root, event.markdown), markdown = await readFile(markdownPath, 'utf8');
    await writeFile(markdownPath, markdown.replace(/^occurred_at:.*$/m, `occurred_at: ${event.occurredAt}`));
  }
}
for (const event of manifest.events) {
  if (event.source !== 'flickr' || event.location || event.flickrTakenOffset || !/[+]09:00$/.test(event.occurredAt)) continue;
  const offset = await getFlickrExifOffset({ id: event.sourceId }, { apiKey: process.env.FLICKR_API_KEY, apiSecret: process.env.FLICKR_API_SECRET, oauthToken: process.env.FLICKR_OAUTH_TOKEN, oauthTokenSecret: process.env.FLICKR_OAUTH_TOKEN_SECRET, restUrl: 'https://www.flickr.com/services/rest/' });
  if (!offset) { event.flickrTimeAssumedJapan = true; continue; }
  event.flickrTakenOffset = offset; event.flickrTimeAssumedJapan = false; event.occurredAt = offsetDateTimeToIso(event.occurredAt, offset); corrected++;
  if (event.markdown && !event.markdown.startsWith('http')) {
    const markdownPath = path.join(root, event.markdown), markdown = await readFile(markdownPath, 'utf8');
    await writeFile(markdownPath, markdown.replace(/^occurred_at:.*$/m, `occurred_at: ${event.occurredAt}`));
  }
}
let previousFlickrZone = null;
for (const event of manifest.events.filter(event => event.source === 'flickr').map(event => ({ event, local: existingFlickrLocalTime(event) })).sort((a, b) => a.local.localeCompare(b.local))) {
  const item = event.event;
  if (item.flickrTakenTimeZone) { previousFlickrZone = { type: 'zone', value: item.flickrTakenTimeZone, sourceId: item.sourceId }; continue; }
  if (item.flickrTakenOffset) { previousFlickrZone = { type: 'offset', value: item.flickrTakenOffset, sourceId: item.sourceId }; continue; }
  if (!previousFlickrZone || !item.flickrTimeAssumedJapan) continue;
  item.flickrTakenLocal = event.local;
  if (previousFlickrZone.type === 'zone') { item.flickrTakenTimeZone = previousFlickrZone.value; item.occurredAt = localDateTimeToIso(event.local, previousFlickrZone.value); }
  else { item.flickrTakenOffset = previousFlickrZone.value; item.occurredAt = offsetDateTimeToIso(event.local, previousFlickrZone.value); }
  item.flickrTimeInheritedFrom = previousFlickrZone.sourceId; item.flickrTimeAssumedJapan = false; corrected++;
  if (item.markdown && !item.markdown.startsWith('http')) {
    const markdownPath = path.join(root, item.markdown), markdown = await readFile(markdownPath, 'utf8');
    await writeFile(markdownPath, markdown.replace(/^occurred_at:.*$/m, `occurred_at: ${item.occurredAt}`));
  }
}
manifest.events.sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt));
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(path.join(root, 'timeline.html'), renderHtml(manifest));
console.log(`${corrected}件のFlickr撮影時刻を補正しました`);

function existingFlickrLocalTime(event) {
  if (event.flickrTakenLocal) return event.flickrTakenLocal;
  const match = path.basename(event.markdown ?? '').match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}` : event.occurredAt.slice(0, 19);
}
