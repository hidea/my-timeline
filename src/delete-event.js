import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import { copyTimelineIcons, renderHtml } from './lib/workspace.js';
import { safePart } from './lib/utils.js';

export async function eventInfo(root, source, sourceId) {
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')), event = manifest.events.find(item => item.source === source && item.sourceId === sourceId);
  if (!event) throw new Error('対象のカードが見つかりません。'); return { source: event.source, sourceId: event.sourceId, occurredAt: event.occurredAt, text: event.text };
}
export async function bulkDeleteInfo(root, selectedIds = []) {
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')), events = selectedEvents(manifest.events, selectedIds);
  return { count: events.length, sources: [...new Set(events.map(event => event.source))], first: events[0]?.occurredAt, last: events.at(-1)?.occurredAt };
}
export async function deleteTimelineEvent(root, source, sourceId) {
  const manifestPath = join(root, 'manifest.json'), manifest = JSON.parse(await readFile(manifestPath, 'utf8')), index = manifest.events.findIndex(event => event.source === source && event.sourceId === sourceId);
  if (index < 0) throw new Error('対象のカードが見つかりません。');
  const [event] = manifest.events.splice(index, 1), trash = join(root, '.timeline-trash', `${Date.now()}_${safePart(sourceId, 'item')}`); await mkdir(trash, { recursive: true });
  await writeFile(join(trash, 'event.json'), `${JSON.stringify(event, null, 2)}\n`);
  const paths = eventPaths(event);
  for (const item of paths) { const sourcePath = resolve(root, item); if (relative(root, sourcePath).startsWith('..')) continue; try { await rename(sourcePath, join(trash, basename(sourcePath))); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  await copyTimelineIcons(root); await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`); const timeline = join(root, 'timeline.html'); await writeFile(timeline, renderHtml(manifest)); return { timeline, trash };
}
export async function deleteTimelineEvents(root, selectedIds = []) {
  const manifestPath = join(root, 'manifest.json'), manifest = JSON.parse(await readFile(manifestPath, 'utf8')), events = selectedEvents(manifest.events, selectedIds);
  if (!events.length) throw new Error('削除対象のカードが見つかりません。');
  const ids = new Set(events.map(event => `${event.source}:${event.sourceId}`)), trash = join(root, '.timeline-trash', `${Date.now()}_一括削除`); await mkdir(trash, { recursive: true });
  for (const [index, event] of events.entries()) {
    const eventTrash = join(trash, String(index + 1).padStart(4, '0')); await mkdir(eventTrash, { recursive: true }); await writeFile(join(eventTrash, 'event.json'), `${JSON.stringify(event, null, 2)}\n`);
    for (const item of eventPaths(event)) { const sourcePath = resolve(root, item); if (relative(root, sourcePath).startsWith('..')) continue; try { await rename(sourcePath, join(eventTrash, basename(sourcePath))); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  }
  manifest.events = manifest.events.filter(event => !ids.has(`${event.source}:${event.sourceId}`)); await copyTimelineIcons(root); await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`); const timeline = join(root, 'timeline.html'); await writeFile(timeline, renderHtml(manifest)); return { timeline, trash, deleted: events.length };
}
function selectedEvents(events, selectedIds) { const ids = new Set((selectedIds ?? []).map(String)); return events.filter(event => ids.has(`${event.source}:${event.sourceId}`)); }
function eventPaths(event) { return [...new Set([event.markdown, ...(event.files ?? []), ...(event.previews ?? []), ...(event.attachments ?? []).map(item => item.path)].filter(path => path && !String(path).startsWith('http')))]; }
