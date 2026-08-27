import { McpClient, StdioMcpClient, contentTexts } from '../lib/mcp.js';
import { shortId } from '../lib/utils.js';

export async function collectTwilog({ fromText, toText, limit, url, token, toolName, bridgeCommand = 'npx' }) {
  const client = token ? new McpClient(url, { token }) : new StdioMcpClient(bridgeCommand, ['-y', 'mcp-remote@0.1.37', url]);
  try {
    await client.initialize();
    const listed = await client.listTools();
    const tool = toolName ? listed.tools?.find(t => t.name === toolName) : chooseSearchTool(listed.tools ?? []);
    if (!tool) throw new Error(`No Twilog search tool found. Available: ${(listed.tools ?? []).map(t => t.name).join(', ')}`);
    const baseArgs = buildArgs(tool.inputSchema, fromText, toText, limit), events = [];
    let page = 1, maxPage = 1;
    do {
      const result = await client.callTool(tool.name, { ...baseArgs, ...(tool.inputSchema?.properties?.page ? { page } : {}) });
      const normalized = normalizeResult(result, fromText); events.push(...normalized.events);
      maxPage = normalized.maxPage ?? 1; page++;
    } while (page <= maxPage && events.length < limit);
    return events.slice(0, limit);
  } finally { client.close?.(); }
}
function chooseSearchTool(tools) { return tools.find(t => /search|timeline|post|tweet/i.test(`${t.name} ${t.description ?? ''}`) && /startDate|start_date/.test(JSON.stringify(t.inputSchema ?? {}))); }
function buildArgs(schema, from, to, limit) {
  const args = {}, props = schema?.properties ?? {};
  for (const key of Object.keys(props)) {
    if (/^start_?date$/i.test(key)) args[key] = from.replaceAll('-', '');
    else if (/^end_?date$/i.test(key)) args[key] = to.replaceAll('-', '');
    else if (/timeline_?filter/i.test(key)) args[key] = props[key]?.type === 'array' ? ['tweets'] : 'tweets';
    else if (/include_?retweet/i.test(key)) args[key] = false;
    else if (/limit|count|max/i.test(key)) args[key] = limit;
    else if (/keyword/i.test(key)) args[key] = props[key]?.type === 'array' ? [] : '';
  }
  return args;
}
function normalizeResult(result, fallbackDate) {
  const structured = result?.structuredContent;
  const candidates = Array.isArray(structured) ? structured : structured?.logs ?? structured?.posts ?? structured?.items;
  if (Array.isArray(candidates)) return { events: candidates.map((item, i) => fromObject(item, i, fallbackDate)), maxPage: structured?.meta?.maxPage };
  const events = []; let maxPage;
  for (const [i, text] of contentTexts(result).entries()) {
    try {
      const parsed = JSON.parse(text), rows = Array.isArray(parsed) ? parsed : parsed.logs ?? parsed.posts ?? parsed.items;
      if (Array.isArray(rows)) { events.push(...rows.map((x, j) => fromObject(x, `${i}-${j}`, fallbackDate))); maxPage = parsed.meta?.maxPage ?? maxPage; continue; }
    } catch {}
    if (text.trim()) events.push(fromText(text, i, fallbackDate));
  }
  return { events, maxPage };
}
function fromObject(item, index, fallbackDate) {
  const occurredAt = item.created_at ?? item.createdAt ?? item.date ?? item.datetime ?? `${fallbackDate}T12:00:00+09:00`;
  const text = item.text ?? item.content ?? item.full_text ?? JSON.stringify(item, null, 2), originalUrl = item.url ?? item.contentUrl ?? item.permalink ?? '';
  return { source: 'x', sourceId: String(item.id ?? item.tweet_id ?? (originalUrl || shortId(`${index}${text}`))), occurredAt, author: item.authorName ?? item.authorId, text, originalUrl, media: extractMedia(item), raw: item };
}
function fromText(text, index, fallbackDate) {
  const occurredAt = text.match(/\b(20\d\d[-/]\d\d[-/]\d\d(?:[T ]\d\d:\d\d(?::\d\d)?(?:Z|[+-]\d\d:?\d\d)?)?)/)?.[1]?.replaceAll('/', '-') ?? `${fallbackDate}T12:00:00+09:00`;
  const originalUrl = text.match(/https:\/\/(?:x|twitter)\.com\/[^\s)]+/i)?.[0] ?? '';
  return { source: 'x', sourceId: originalUrl || shortId(`${index}${text}`), occurredAt, text, originalUrl, media: [], raw: text };
}
function extractMedia(item) { const values = item.media ?? item.images ?? item.photos ?? []; return (Array.isArray(values) ? values : [values]).map(x => ({ url: typeof x === 'string' ? x : x?.url ?? x?.media_url_https })).filter(x => x.url); }
