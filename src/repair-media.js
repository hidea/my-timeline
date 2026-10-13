#!/usr/bin/env node
import { repairWorkspaceMedia } from './lib/repair.js';

const root = process.argv[2];
if (!root) throw new Error('Workspace path is required.');
await repairWorkspaceMedia(root, { onProgress: progress => console.log(JSON.stringify(progress)) });
