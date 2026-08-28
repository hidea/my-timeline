import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import { copyTimelineIcons, renderHtml } from './lib/workspace.js';
import { safePart, timestampName } from './lib/utils.js';

const run = promisify(execFile);
export async function addManualMaterial(root, input) {
  const manifestPath = join(root, 'manifest.json'), manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (!basename(root).startsWith('My Timeline ')) throw new Error('My Timelineの出力フォルダではありません。');
  const occurredAt = new Date(String(input.occurredAt).match(/[zZ]|[+-]\d\d:?\d\d$/) ? input.occurredAt : `${input.occurredAt}:00+09:00`);
  if (Number.isNaN(occurredAt.valueOf())) throw new Error('日時を指定してください。');
  const source = ['memo', 'place', 'gmail'].includes(input.source) ? input.source : 'memo', id = randomUUID(), base = `${timestampName(occurredAt)}_${source}_${id.slice(0, 10)}`;
  await mkdir(join(root, 'materials'), { recursive: true }); await mkdir(join(root, '.timeline-cache'), { recursive: true });
  const files = [], previews = [], attachments = [];
  for (const [index, file] of (input.files ?? []).slice(0, 50).entries()) {
    const extension = String(file.name).match(/\.[a-zA-Z0-9]{1,10}$/)?.[0]?.toLowerCase() ?? '', name = `${base}_${String(index + 1).padStart(2, '0')}${extension}`;
    const original = join(root, 'materials', name); await writeFile(original, Buffer.from(file.data, 'base64'));
    if (String(file.type).startsWith('image/')) {
      const preview = join(root, '.timeline-cache', name); files.push(`materials/${name}`);
      try { await run('/usr/bin/sips', ['-Z', '900', original, '--out', preview]); previews.push(`.timeline-cache/${name}`); } catch { previews.push(`materials/${name}`); }
    } else attachments.push({ name: String(file.name || name), path: `materials/${name}`, type: String(file.type ?? '') });
  }
  const latitude = optionalNumber(input.latitude), longitude = optionalNumber(input.longitude), location = latitude !== null && longitude !== null ? { latitude, longitude } : null;
  const event = { source, sourceId: `manual:${id}`, occurredAt: occurredAt.toISOString(), text: String(input.text ?? '').trim(), originalUrl: validUrl(input.url), location, media: [], files, previews, attachments, manual: true };
  const markdown = `---\nsource: ${source}\nsource_id: ${JSON.stringify(event.sourceId)}\noccurred_at: ${event.occurredAt}\noriginal_url: ${event.originalUrl}\n---\n\n${event.text}\n`;
  const markdownName = `${base}.md`; await writeFile(join(root, 'materials', markdownName), markdown); event.markdown = `materials/${markdownName}`;
  manifest.workspaceRoot = root; manifest.events.push(event); manifest.events.sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt));
  await copyTimelineIcons(root); await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`); await writeFile(join(root, 'timeline.html'), renderHtml(manifest)); return join(root, 'timeline.html');
}
function validUrl(value) { try { const url = new URL(String(value ?? '')); return ['http:', 'https:'].includes(url.protocol) ? url.toString() : ''; } catch { return ''; } }
function optionalNumber(value) { if (String(value ?? '').trim() === '') return null; const number = Number(value); return Number.isFinite(number) ? number : null; }
