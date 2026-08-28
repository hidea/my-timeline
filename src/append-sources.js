import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { collectBskylog } from './collectors/bskylog.js';
import { collectFlickr } from './collectors/flickr.js';
import { collectGmail } from './collectors/gmail.js';
import { collectStrava, enrichStravaPositions } from './collectors/strava.js';
import { collectTwilog } from './collectors/twilog.js';
import { appendEventsToWorkspace, renderHtml } from './lib/workspace.js';
import { parseDate } from './lib/utils.js';

export async function appendSources(root, manifest, options = {}) {
  const sources = options.sources ?? [], limit = 1000, from = parseDate(manifest.from), to = parseDate(manifest.to, true), tasks = [], add = (name, promise) => tasks.push(promise.catch(error => { throw new Error(`${name}: ${error.message}`); }));
  if (sources.includes('bluesky')) add('Bluesky（旅行期間）', collectBskylog({ from, to, limit, url: process.env.BSKYLOG_MCP_URL ?? 'http://localhost:8080/sse' }));
  if (sources.includes('x')) add('Twilog（旅行期間）', collectTwilog({ fromText: manifest.from, toText: manifest.to, limit, url: process.env.TWILOG_MCP_URL ?? 'https://twilog-mcp.togetter.dev/mcp', token: process.env.TWILOG_MCP_TOKEN, bridgeCommand: process.env.MCP_REMOTE_COMMAND ?? 'npx' }));
  if (sources.includes('flickr')) add('Flickr（旅行期間）', collectFlickr({ fromText: manifest.from, toText: manifest.to, limit, apiKey: process.env.FLICKR_API_KEY, apiSecret: process.env.FLICKR_API_SECRET, oauthToken: process.env.FLICKR_OAUTH_TOKEN, oauthTokenSecret: process.env.FLICKR_OAUTH_TOKEN_SECRET, userId: process.env.FLICKR_USER_ID }));
  if (sources.includes('strava')) add('Strava（旅行期間）', collectStrava({ from, to, clientId: process.env.STRAVA_CLIENT_ID, clientSecret: process.env.STRAVA_CLIENT_SECRET, refreshToken: process.env.STRAVA_REFRESH_TOKEN, accessToken: process.env.STRAVA_ACCESS_TOKEN, expiresAt: process.env.STRAVA_EXPIRES_AT }));
  if (sources.includes('gmail')) add('Gmail（旅行期間）', collectGmail({ fromText: manifest.from, toText: manifest.to, limit: 500, clientId: process.env.GMAIL_CLIENT_ID, clientSecret: process.env.GMAIL_CLIENT_SECRET, refreshToken: process.env.GMAIL_REFRESH_TOKEN }));
  const keywords = (options.keywords ?? []).map(String).map(value => value.trim()).filter(Boolean);
  if (keywords.length && options.relatedFrom && options.relatedTo) {
    const relatedFrom = parseDate(options.relatedFrom), relatedTo = parseDate(options.relatedTo, true), mark = promise => promise.then(events => events.filter(event => new Date(event.occurredAt) < from || new Date(event.occurredAt) > to).map(event => ({ ...event, related: true })));
    if (sources.includes('bluesky')) add('Bluesky（期間外キーワード）', mark(sequential(keywords, keyword => collectBskylog({ from: relatedFrom, to: relatedTo, limit, keyword, url: process.env.BSKYLOG_MCP_URL ?? 'http://localhost:8080/sse' }))));
    if (sources.includes('x')) add('Twilog（期間外キーワード）', mark(sequential(keywords, keyword => collectTwilog({ fromText: options.relatedFrom, toText: options.relatedTo, limit, keyword, url: process.env.TWILOG_MCP_URL ?? 'https://twilog-mcp.togetter.dev/mcp', token: process.env.TWILOG_MCP_TOKEN, bridgeCommand: process.env.MCP_REMOTE_COMMAND ?? 'npx' }))));
    if (sources.includes('gmail')) add('Gmail（期間外キーワード）', mark(collectGmail({ fromText: options.relatedFrom, toText: options.relatedTo, limit: 500, keywords, clientId: process.env.GMAIL_CLIENT_ID, clientSecret: process.env.GMAIL_CLIENT_SECRET, refreshToken: process.env.GMAIL_REFRESH_TOKEN })));
  }
  const settled = await Promise.allSettled(tasks), events = settled.flatMap(result => result.status === 'fulfilled' ? result.value : []), failures = settled.filter(result => result.status === 'rejected').map(result => result.reason.message);
  if (!events.length && failures.length) throw new Error(failures.join('\n'));
  const result = await appendEventsToWorkspace(root, deduplicate(events)); enrichStravaPositions(result.manifest.events.filter(event => !event.related)); await writeFile(join(root, 'manifest.json'), `${JSON.stringify(result.manifest, null, 2)}\n`); await writeFile(result.timeline, renderHtml(result.manifest)); return { added: result.added, breakdown: summarize(result.events), timeline: result.timeline, warnings: failures };
}
async function sequential(keywords, collect) { const events = []; for (const keyword of keywords) events.push(...await collect(keyword)); return events; }
function deduplicate(events) { const map = new Map(); for (const event of events) { const key = `${event.source}:${event.sourceId}`, previous = map.get(key); if (!previous || (previous.related && !event.related)) map.set(key, event); } return [...map.values()]; }
function summarize(events) { return Object.values(events.reduce((summary, event) => { const item = summary[event.source] ??= { source: event.source, total: 0, related: 0 }; item.total++; if (event.related) item.related++; return summary; }, {})); }
