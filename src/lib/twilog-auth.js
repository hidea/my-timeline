import { createHash } from 'node:crypto';
import { mkdir, readdir, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const defaultTwilogUrl = 'https://twilog-mcp.togetter.dev/mcp';
export function defaultMcpAuthDir() { return process.env.MCP_REMOTE_CONFIG_DIR ?? join(homedir(), '.mcp-auth'); }

export async function twilogAuthFiles({ baseDir = defaultMcpAuthDir(), serverUrl = defaultTwilogUrl } = {}) {
  const prefix = `${createHash('md5').update(serverUrl).digest('hex')}_`, files = [];
  let entries = []; try { entries = await readdir(baseDir, { withFileTypes: true }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const entry of entries.filter(item => item.isDirectory() && item.name.startsWith('mcp-remote-'))) {
    for (const name of await readdir(join(baseDir, entry.name))) if (name.startsWith(prefix)) files.push({ folder: entry.name, name });
  }
  return files;
}

export async function resetTwilogAuth({ baseDir = defaultMcpAuthDir(), serverUrl = defaultTwilogUrl } = {}) {
  const files = await twilogAuthFiles({ baseDir, serverUrl });
  if (!files.length) return { moved: 0, backup: null };
  const backup = join(baseDir, `backup-twilog-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`);
  for (const file of files) { await mkdir(join(backup, file.folder), { recursive: true }); await rename(join(baseDir, file.folder, file.name), join(backup, file.folder, file.name)); }
  return { moved: files.length, backup };
}
