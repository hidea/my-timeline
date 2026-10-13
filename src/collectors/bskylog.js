import { McpClient, contentTexts } from '../lib/mcp.js';
export async function collectBskylog({ from, to, limit, url, keyword = '' }) {
  const client = new McpClient(url); await client.initialize();
  if (!keyword) {
    const result = await client.callTool('search_posts', { keyword, startDate: from.toISOString(), endDate: to.toISOString(), limit });
    return contentTexts(result).map(parsePost).filter(Boolean);
  }
  const pattern = keywordPattern(keyword);
  const result = await client.callTool('search_posts', { pattern, startDate: from.toISOString(), endDate: to.toISOString(), limit: 100_000 });
  return contentTexts(result).map(parsePost).filter(post => post && new Date(post.occurredAt) >= from && new Date(post.occurredAt) <= to).slice(0, limit);
}
export function keywordPattern(keyword) {
  const body = [...keyword].map(char => /[A-Za-z]/.test(char) ? `[${char.toUpperCase()}${char.toLowerCase()}]` : char.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&')).join('');
  return /^[A-Za-z0-9]/.test(keyword) ? `(?<![A-Za-z0-9])${body}` : body;
}
function parsePost(text) {
  const field = name => text.match(new RegExp(`^${name}:\\s*(.*)$`, 'mi'))?.[1]?.trim();
  const occurredAt = field('Time'), sourceId = field('URI'); if (!occurredAt || !sourceId) return null;
  const image = field('Image');
  return { source: 'bluesky', sourceId, occurredAt, author: field('Author'), text: text.match(/^Content:\s*([\s\S]*)$/mi)?.[1]?.trim() ?? '', originalUrl: blueskyUrl(sourceId), media: image ? [{ url: image }] : [], raw: text };
}
function blueskyUrl(uri) { const m = uri.match(/^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/]+)$/); return m ? `https://bsky.app/profile/${m[1]}/post/${m[2]}` : ''; }
