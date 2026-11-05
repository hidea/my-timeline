import { execFile } from 'node:child_process';
import { copyFile } from 'node:fs/promises';
import { basename, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export const chooseFolderScript = ['activate', 'POSIX path of (choose folder with prompt "選んだ写真の保存先を選んでください")'];

export async function chooseFolder() {
  try { return (await run('osascript', chooseFolderScript.flatMap(line => ['-e', line]))).stdout.trim(); }
  catch (error) { if (String(error.stderr).includes('-128')) return null; throw error; }
}

export async function exportPicks(root, files, folder) {
  const failed = []; let saved = 0;
  for (const file of files) {
    const source = resolve(root, String(file)), top = relative(root, source).split(sep)[0];
    try {
      if (!['materials', '.timeline-cache'].includes(top)) throw new Error('outside workspace');
      await copyFile(source, join(folder, basename(source))); saved++;
    } catch { failed.push(String(file)); }
  }
  return { saved, failed, folder };
}
