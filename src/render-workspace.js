#!/usr/bin/env node
import { resolve } from 'node:path';
import { rerenderWorkspace } from './lib/workspace.js';

if (!process.argv[2]) throw new Error('Workspace path is required.');
console.log(await rerenderWorkspace(resolve(process.argv[2])));
