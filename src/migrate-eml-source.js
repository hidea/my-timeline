#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { renderHtml } from './lib/workspace.js';

const root = resolve(process.argv[2] ?? ''), manifestPath = join(root, 'manifest.json'), manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
let changed = 0;
for (const event of manifest.events) {
  const isImportedEml = event.source === 'gmail' && event.manual && event.attachments?.some(attachment => attachment.type === 'message/rfc822' || /\.eml$/i.test(attachment.name ?? ''));
  if (!isImportedEml) continue;
  event.source = 'eml'; changed++;
  if (event.markdown) { const markdownPath = join(root, event.markdown); try { const markdown = await readFile(markdownPath, 'utf8'); await writeFile(markdownPath, markdown.replace(/^source: gmail$/m, 'source: eml')); } catch {} }
}
if (changed) { await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`); await writeFile(join(root, 'timeline.html'), renderHtml(manifest)); }
console.log(`${root}: ${changed}件をemlへ変更`);
