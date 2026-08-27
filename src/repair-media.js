#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { basename, join } from 'node:path';
import { download, extFromUrl } from './lib/utils.js';
import { renderHtml } from './lib/workspace.js';

const run = promisify(execFile), root = process.argv[2];
if (!root) throw new Error('Workspace path is required.');
const manifestPath = join(root, 'manifest.json'), manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const missing = manifest.events.filter(event => !event.files?.length && mediaUrl(event));
let done = 0, repaired = 0;
console.log(JSON.stringify({ done, total: missing.length, repaired }));
for (const event of missing) {
  const url = mediaUrl(event), stem = basename(event.markdown, '.md'), name = `${stem}_01${extFromUrl(url)}`, original = join(root, 'materials', name), preview = join(root, '.timeline-cache', name);
  try {
    await download(url, original, 3);
    event.files = [`materials/${name}`];
    try { await run('/usr/bin/sips', ['-Z', '900', original, '--out', preview]); event.previews = [`.timeline-cache/${name}`]; } catch { event.previews = event.files; }
    delete event.mediaError; repaired++;
    const markdownPath = join(root, event.markdown), markdown = await readFile(markdownPath, 'utf8');
    if (!markdown.includes(`![画像1](${name})`)) await writeFile(markdownPath, `${markdown.trimEnd()}\n\n![画像1](${name})\n`);
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`); await writeFile(join(root, 'timeline.html'), renderHtml(manifest));
  } catch {}
  console.log(JSON.stringify({ done: ++done, total: missing.length, repaired }));
}
function mediaUrl(event) { return event.media?.[0]?.url ?? String(event.mediaError ?? '').match(/https?:\/\/\S+/)?.[0]; }
