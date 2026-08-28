#!/usr/bin/env node
import { collectBskylog } from './collectors/bskylog.js';
import { collectTwilog } from './collectors/twilog.js';
import { collectFlickr } from './collectors/flickr.js';
import { collectGmail } from './collectors/gmail.js';
import { collectStrava, enrichStravaPositions } from './collectors/strava.js';
import { McpClient } from './lib/mcp.js';
import { createWorkspace } from './lib/workspace.js';
import { authorizeFlickr } from './lib/flickr-oauth.js';
import { parseArgs, parseDate, validateRange } from './lib/utils.js';

const [command = 'help', ...rest] = process.argv.slice(2);
try { if (command === 'collect') await collect(rest); else if (command === 'inspect-mcp') await inspect(rest); else if (command === 'flickr-auth') await flickrAuth(); else help(); }
catch (error) { console.error(`Error: ${error.message}`); process.exitCode = 1; }

async function collect(argv) {
  const a = parseArgs(argv); if (!a.from || !a.to) throw new Error('collect requires --from and --to');
  const from = parseDate(a.from), to = parseDate(a.to, true); validateRange(from, to);
  const sources = String(a.sources).split(',').map(x => x.trim()).filter(Boolean), limit = Number(a.limit), tasks = [], keywords = parseKeywords(a['related-keywords']);
  if (sources.includes('bluesky')) tasks.push(tracked('Bluesky', collectBskylog({ from, to, limit, url: a['bskylog-url'] ?? process.env.BSKYLOG_MCP_URL ?? 'http://localhost:8080/sse' })));
  if (sources.includes('x')) tasks.push(tracked('Twilog', collectTwilog({ fromText: a.from, toText: a.to, limit, url: a['twilog-url'] ?? process.env.TWILOG_MCP_URL ?? 'https://twilog-mcp.togetter.dev/mcp', token: process.env.TWILOG_MCP_TOKEN, toolName: a['twilog-tool'], bridgeCommand: process.env.MCP_REMOTE_COMMAND ?? 'npx' })));
  if (sources.includes('flickr')) tasks.push(tracked('Flickr', collectFlickr({ fromText: a.from, toText: a.to, limit, apiKey: process.env.FLICKR_API_KEY, apiSecret: process.env.FLICKR_API_SECRET, oauthToken: process.env.FLICKR_OAUTH_TOKEN, oauthTokenSecret: process.env.FLICKR_OAUTH_TOKEN_SECRET, userId: process.env.FLICKR_USER_ID })));
  if (sources.includes('strava')) tasks.push(tracked('Strava', collectStrava({ from, to, clientId: process.env.STRAVA_CLIENT_ID, clientSecret: process.env.STRAVA_CLIENT_SECRET, refreshToken: process.env.STRAVA_REFRESH_TOKEN, accessToken: process.env.STRAVA_ACCESS_TOKEN, expiresAt: process.env.STRAVA_EXPIRES_AT })));
  if (sources.includes('gmail')) {
    if (!keywords.length) throw new Error('Gmailを取得するには関連キーワードを入力してください。');
    tasks.push(tracked('Gmail（キーワード）', collectGmail({ limit, keywords, clientId: process.env.GMAIL_CLIENT_ID, clientSecret: process.env.GMAIL_CLIENT_SECRET, refreshToken: process.env.GMAIL_REFRESH_TOKEN })));
  }
  if (keywords.length && a['related-from'] && a['related-to']) {
    const relatedFrom = parseDate(a['related-from']), relatedTo = parseDate(a['related-to'], true);
    if (relatedTo < relatedFrom) throw new Error('関連資料の終了日は開始日以降にしてください。');
    if (sources.includes('bluesky')) tasks.push(tracked('Bluesky関連', markRelated(collectKeywordMatches(keywords, keyword => collectBskylog({ from: relatedFrom, to: relatedTo, limit, keyword, url: a['bskylog-url'] ?? process.env.BSKYLOG_MCP_URL ?? 'http://localhost:8080/sse' })), from, to)));
    if (sources.includes('x')) tasks.push(tracked('Twilog関連', markRelated(collectKeywordMatches(keywords, keyword => collectTwilog({ fromText: a['related-from'], toText: a['related-to'], limit, keyword, url: a['twilog-url'] ?? process.env.TWILOG_MCP_URL ?? 'https://twilog-mcp.togetter.dev/mcp', token: process.env.TWILOG_MCP_TOKEN, toolName: a['twilog-tool'], bridgeCommand: process.env.MCP_REMOTE_COMMAND ?? 'npx' })), from, to)));
  }
  const settled = await Promise.allSettled(tasks), events = [], failures = [];
  for (const result of settled) result.status === 'fulfilled' ? events.push(...result.value) : failures.push(result.reason.message);
  if (!events.length && failures.length) throw new Error(failures.join('\n'));
  const uniqueEvents = deduplicate(events); enrichStravaPositions(uniqueEvents.filter(event => !event.related));
  progress(`取得完了。${uniqueEvents.length}件の素材を書き出します`, 0, uniqueEvents.length);
  const root = await createWorkspace({ output: a.output, title: a.title ?? `${a.from}〜${a.to} 行事記録`, fromText: a.from, toText: a.to, events: uniqueEvents, keepRemote: Boolean(a['keep-remote']), onProgress: (done, total, message) => progress(`${message} (${done}/${total})`, done, total) });
  console.log(root); if (failures.length) console.error(`Warnings:\n- ${failures.join('\n- ')}`);
}
async function tracked(name, promise) { progress(`${name}から取得しています`); const events = await promise; progress(`${name}: ${events.length}件取得`); return events; }
async function markRelated(promise, from, to) { return (await promise).filter(event => { const date = new Date(event.occurredAt); return date < from || date > to; }).map(event => ({ ...event, related: true })); }
async function collectKeywordMatches(keywords, collect) { const events = []; for (const keyword of keywords) events.push(...await collect(keyword)); return events; }
function deduplicate(events) { const map = new Map(); for (const event of events) { const key = `${event.source}:${event.sourceId}`; const previous = map.get(key); if (!previous || (previous.related && !event.related)) map.set(key, event); } return [...map.values()]; }
function parseKeywords(value) { if (!value) return []; try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.map(String).map(x => x.trim()).filter(Boolean) : []; } catch { return String(value).split(/[\n,]/).map(x => x.trim()).filter(Boolean); } }
function progress(message, done, total) { if (process.env.MY_TIMELINE_PROGRESS) console.error(`MY_TIMELINE_PROGRESS ${JSON.stringify({ message, done, total })}`); }
async function inspect(argv) { const a = parseArgs(argv), client = new McpClient(a.url ?? 'http://localhost:8080/sse', { token: a.token ?? process.env.TWILOG_MCP_TOKEN }); await client.initialize(); console.log(JSON.stringify(await client.listTools(), null, 2)); }
async function flickrAuth() { if (!process.env.FLICKR_API_KEY || !process.env.FLICKR_API_SECRET) throw new Error('FLICKR_API_KEY and FLICKR_API_SECRET are required.'); const result = await authorizeFlickr({ key: process.env.FLICKR_API_KEY, secret: process.env.FLICKR_API_SECRET }); console.log(`Flickr OAuth configured${result.userId ? ` for ${result.userId}` : ''}.`); }
function help() { console.log(`my-timeline collect --from YYYY-MM-DD --to YYYY-MM-DD [options]\nmy-timeline flickr-auth\n\nOptions:\n  --title NAME\n  --sources bluesky,x,flickr,strava\n  --output DIR\n  --limit N\n  --bskylog-url URL\n  --twilog-url URL\n  --twilog-tool NAME\n  --keep-remote\n\nInspect MCP:\n  my-timeline inspect-mcp --url URL`); }
