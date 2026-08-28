#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { copyTimelineIcons, renderHtml } from './lib/workspace.js';

if (!process.argv[2]) throw new Error('Workspace path is required.');
const root = resolve(process.argv[2]), manifestPath = join(root, 'manifest.json'), manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
let fixed = 0;
for (const event of manifest.events) {
  if (event.manual && Number(event.location?.latitude) === 0 && Number(event.location?.longitude) === 0) { event.location = null; fixed++; }
}
if (fixed) {
  await copyTimelineIcons(root); await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`); await writeFile(join(root, 'timeline.html'), renderHtml(manifest));
}
console.log(JSON.stringify({ fixed, timeline: join(root, 'timeline.html') }));
