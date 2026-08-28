import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import { copyTimelineIcons, renderHtml } from './lib/workspace.js';
import { safePart } from './lib/utils.js';

export async function eventInfo(root, source, sourceId) {
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')), event = manifest.events.find(item => item.source === source && item.sourceId === sourceId);
  if (!event) throw new Error('対象のカードが見つかりません。'); return { source: event.source, sourceId: event.sourceId, occurredAt: event.occurredAt, text: event.text };
}
export async function deleteTimelineEvent(root, source, sourceId) {
  const manifestPath = join(root, 'manifest.json'), manifest = JSON.parse(await readFile(manifestPath, 'utf8')), index = manifest.events.findIndex(event => event.source === source && event.sourceId === sourceId);
  if (index < 0) throw new Error('対象のカードが見つかりません。');
  const [event] = manifest.events.splice(index, 1), trash = join(root, '.timeline-trash', `${Date.now()}_${safePart(sourceId, 'item')}`); await mkdir(trash, { recursive: true });
  await writeFile(join(trash, 'event.json'), `${JSON.stringify(event, null, 2)}\n`);
  const paths = [...new Set([event.markdown, ...(event.files ?? []), ...(event.previews ?? [])].filter(path => path && !String(path).startsWith('http')))];
  for (const item of paths) { const sourcePath = resolve(root, item); if (relative(root, sourcePath).startsWith('..')) continue; try { await rename(sourcePath, join(trash, basename(sourcePath))); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  await copyTimelineIcons(root); await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`); const timeline = join(root, 'timeline.html'); await writeFile(timeline, renderHtml(manifest)); return { timeline, trash };
}
