#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { copyTimelineIcons, renderHtml } from './lib/workspace.js';

if (!process.argv[2]) throw new Error('Workspace path is required.');
const root = resolve(process.argv[2]);
const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
manifest.workspaceRoot = root;
await copyTimelineIcons(root);
await writeFile(join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(join(root, 'timeline.html'), renderHtml(manifest));
console.log(join(root, 'timeline.html'));
