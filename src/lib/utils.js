import { createHash } from 'node:crypto';
import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export function parseDate(value, end = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) throw new Error(`Invalid date: ${value}. Use YYYY-MM-DD.`);
  const date = new Date(value + (end ? 'T23:59:59.999+09:00' : 'T00:00:00.000+09:00'));
  if (Number.isNaN(date.valueOf())) throw new Error(`Invalid date: ${value}`);
  return date;
}
export function validateRange(from, to) {
  if (to < from) throw new Error('--to must not be earlier than --from');
  if ((to - from) / 86_400_000 > 31) throw new Error('A writing workspace is limited to 31 days.');
}
export function safePart(value, fallback = 'item') {
  return String(value ?? '').normalize('NFKC').replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 48) || fallback;
}
export function shortId(value) { return createHash('sha256').update(String(value)).digest('hex').slice(0, 10); }
export function timestampName(value) {
  const p = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(new Date(value)).reduce((a, x) => ({ ...a, [x.type]: x.value }), {});
  return `${p.year}${p.month}${p.day}-${p.hour}${p.minute}${p.second}`;
}
export function httpError(status, message) { return Object.assign(new Error(message), { status }); }
export function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
export async function ensureDir(dir) { await mkdir(dir, { recursive: true }); }
export async function writeJson(file, data) { await writeFile(file, JSON.stringify(data, null, 2) + '\n'); }
export async function download(url, destination, attempts = 1) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(60_000) });
    if (response.ok) { const partial = `${destination}.part`; await writeFile(partial, Buffer.from(await response.arrayBuffer())); await rename(partial, destination); return; }
    if (response.status !== 429 || attempt === attempts) throw new Error(`Download failed (${response.status}): ${url}`);
    const retryAfter = Number(response.headers.get('retry-after'));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 15_000 * 2 ** (attempt - 1);
    await new Promise(resolve => setTimeout(resolve, delay));
  }
}
export async function hasNonemptyFile(file) { try { return (await stat(file)).size > 0; } catch { return false; } }
export function extFromUrl(url, fallback = '.jpg') {
  try { const ext = path.extname(new URL(url).pathname).toLowerCase(); return /^\.[a-z0-9]{2,5}$/.test(ext) ? ext : fallback; } catch { return fallback; }
}
export function parseArgs(argv) {
  const args = { sources: 'bluesky,x,flickr', limit: '1000' };
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) { const [key, inline] = argv[i].slice(2).split('=', 2); args[key] = inline ?? (argv[i + 1]?.startsWith('--') ? true : argv[++i]); }
  return args;
}
export function sourceSummary(sources, events) { return sources.map(source => { const matched = events.filter(event => event.source === source); return { source, total: matched.length, related: matched.filter(event => event.related).length }; }); }
