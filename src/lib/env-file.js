import { readFile, writeFile } from 'node:fs/promises';

export async function updateEnv(file, updates) {
  let content = ''; try { content = await readFile(file, 'utf8'); } catch {}
  for (const [key, rawValue] of Object.entries(updates)) {
    if (rawValue == null) continue;
    const value = String(rawValue).replace(/[\r\n]/g, ''), line = `${key}=${value}`, pattern = new RegExp(`^${key}=.*$`, 'm');
    content = pattern.test(content) ? content.replace(pattern, line) : `${content.trimEnd()}\n${line}\n`;
  }
  await writeFile(file, content);
}
