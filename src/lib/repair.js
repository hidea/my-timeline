import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import { extFromUrl } from './utils.js';
import { downloadQueued, renderHtml } from './workspace.js';

const run = promisify(execFile);

export function repairTasks(manifest) {
  const tasks = [];
  for (const event of manifest.events) {
    const key = `${event.source}:${event.sourceId}`;
    for (const pending of event.pendingOriginals ?? []) tasks.push({ key, url: pending.url, file: pending.file, pending });
    const url = legacyMediaUrl(event);
    if (!event.files?.length && !event.pendingOriginals?.length && url && event.markdown) tasks.push({ key, url, file: `materials/${basename(event.markdown, '.md')}_01${extFromUrl(url)}` });
  }
  return tasks;
}

export async function repairWorkspaceMedia(root, { onProgress = () => {}, withLock = task => task() } = {}) {
  const manifestPath = join(root, 'manifest.json'), load = async () => ({ ...JSON.parse(await readFile(manifestPath, 'utf8')), workspaceRoot: root });
  const tasks = repairTasks(await load());
  let done = 0, repaired = 0, unrendered = 0;
  onProgress({ done, total: tasks.length, repaired });
  for (const task of tasks) {
    try {
      await downloadQueued(task.url, join(root, task.file));
      const preview = task.pending ? null : await makePreview(root, task.file);
      await withLock(async () => {
        const manifest = await load(), event = manifest.events.find(item => `${item.source}:${item.sourceId}` === task.key);
        if (!event) return;
        if (task.pending) {
          event.files[task.pending.index] = task.file;
          event.pendingOriginals = (event.pendingOriginals ?? []).filter(item => item.file !== task.file);
          if (!event.pendingOriginals.length) delete event.pendingOriginals;
        } else { event.files = [task.file]; event.previews = [preview]; delete event.mediaError; }
        await appendMarkdownImage(root, event, task);
        await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
        if (++unrendered >= 10) { await writeFile(join(root, 'timeline.html'), renderHtml(manifest)); unrendered = 0; }
      });
      repaired++;
    } catch {}
    onProgress({ done: ++done, total: tasks.length, repaired });
  }
  if (unrendered) await withLock(async () => writeFile(join(root, 'timeline.html'), renderHtml(await load())));
  return { total: tasks.length, repaired };
}

async function makePreview(root, file) {
  const name = basename(file);
  try { await run('/usr/bin/sips', ['-Z', '900', join(root, file), '--out', join(root, '.timeline-cache', name)]); return `.timeline-cache/${name}`; } catch { return file; }
}
async function appendMarkdownImage(root, event, task) {
  if (!event.markdown) return;
  const markdownPath = join(root, event.markdown), markdown = await readFile(markdownPath, 'utf8'), line = `![画像${(task.pending?.index ?? 0) + 1}](${basename(task.file)})`;
  if (!markdown.includes(line)) await writeFile(markdownPath, `${markdown.trimEnd()}\n\n${line}\n`);
}
function legacyMediaUrl(event) { return event.media?.[0]?.url ?? String(event.mediaError ?? '').match(/https?:\/\/\S+/)?.[0]; }
