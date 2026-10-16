import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { copyFile, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { promisify } from 'node:util';
import tzlookup from 'tz-lookup';
import { download, ensureDir, escapeHtml, extFromUrl, hasNonemptyFile, safePart, shortId, timestampName, writeJson } from './utils.js';
const execFileAsync = promisify(execFile);
const mapLibraryStyles = `<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin=""><link rel="stylesheet" href="https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.css" integrity="sha256-qx5w1Z7EBGW65+cDDaLzzPKBM/1QLmK9WY7vut/XpzI=" crossorigin="">`;
const mapLibraryScripts = `<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script><script src="https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js" integrity="sha256-RamwepGJzlYFTGIKlHzPQeKR5YyV6bYVM7dAqqZe5cs=" crossorigin=""></script><script src="https://unpkg.com/@maplibre/maplibre-gl-leaflet@0.1.4/leaflet-maplibre-gl.js" integrity="sha256-Hmz4yz61/ZCYeaob82o4P7UGyaWy27+rq85lopTdH8s=" crossorigin=""></script>`;
const mapBaseLayer = `L.maplibreGL({style:'https://tiles.openfreemap.org/styles/liberty',attributionControl:{customAttribution:'<a href="https://openfreemap.org">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}}).addTo(map);`;
export const RENDER_VERSION = ['./workspace.js', './utils.js', './timeline/timeline.js', './timeline/timeline.css'].reduce((hash, file) => hash.update(readFileSync(new URL(file, import.meta.url))), createHash('sha256')).digest('hex').slice(0, 16);
const timelineStyles = readFileSync(new URL('./timeline/timeline.css', import.meta.url), 'utf8'), timelineScript = readFileSync(new URL('./timeline/timeline.js', import.meta.url), 'utf8').replaceAll('</script', '<\\/script');

export async function createWorkspace({ output, title, fromText, toText, events, collection, keepRemote = false, onProgress = () => {} }) {
  const root = output ? path.resolve(output) : await persistentWorkspace(fromText, toText, title);
  await ensureDir(path.join(root, 'materials')); await ensureDir(path.join(root, '.timeline-cache')); await copyTimelineIcons(root);
  const ordered = events.sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt));
  let completed = 0;
  const normalized = await mapLimit(ordered, 4, async event => {
    onProgress(completed, ordered.length, progressMessage(event));
    const normalizedEvent = await writeEventMaterials(root, event, keepRemote);
    onProgress(++completed, ordered.length, progressMessage(event));
    return normalizedEvent;
  });
  const manifest = { schemaVersion: 1, workspaceRoot: root, title, from: fromText, to: toText, generatedAt: new Date().toISOString(), ...(collection ? { collections: [collection] } : {}), events: normalized };
  await writeJson(path.join(root, 'manifest.json'), manifest); await writeFile(path.join(root, 'timeline.html'), renderHtml(manifest));
  return root;
}
export async function appendEventsToWorkspace(root, events, { keepRemote = false, onProgress = () => {} } = {}) {
  const manifestPath = path.join(root, 'manifest.json'), manifest = JSON.parse(await readFile(manifestPath, 'utf8')), existingByKey = new Map(manifest.events.map(event => [`${event.source}:${event.sourceId}`, event])), existing = new Set(existingByKey.keys());
  const ordered = events.filter(event => !existing.has(`${event.source}:${event.sourceId}`)).sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt));
  await ensureDir(path.join(root, 'materials')); await ensureDir(path.join(root, '.timeline-cache')); await copyTimelineIcons(root);
  let completed = 0, repaired = 0;
  const missingExisting = events.filter(event => { const saved = existingByKey.get(`${event.source}:${event.sourceId}`); return saved && !saved.files?.length && event.media?.length; });
  const totalWork = missingExisting.length + ordered.length;
  for (const fresh of missingExisting) {
    const saved = existingByKey.get(`${fresh.source}:${fresh.sourceId}`), probe = { ...fresh };
    onProgress(completed, totalWork, `${fresh.source}の未保存画像を再取得しています`);
    const result = await saveEventMedia(root, materialBase(saved), probe, false);
    if (result.files.length) {
      Object.assign(saved, { media: fresh.media, files: result.files, previews: result.previews }); delete saved.mediaError; delete saved.pendingOriginals; if (result.pendingOriginals.length) saved.pendingOriginals = result.pendingOriginals; repaired++;
      const markdownPath = path.join(root, saved.markdown), markdown = await readFile(markdownPath, 'utf8'), additions = markdownImageLines(result).filter(line => !markdown.includes(line));
      if (additions.length) await writeFile(markdownPath, `${markdown.trimEnd()}\n\n${additions.join('\n')}\n`);
    } else if (probe.mediaError) saved.mediaError = probe.mediaError;
    completed++; onProgress(completed, totalWork, `${fresh.source}の未保存画像を再取得しています`);
  }
  const normalized = await mapLimit(ordered, 4, async event => {
    onProgress(completed, totalWork, progressMessage(event));
    const normalizedEvent = await writeEventMaterials(root, event, keepRemote); onProgress(++completed, totalWork, progressMessage(event));
    return normalizedEvent;
  });
  manifest.workspaceRoot = root; manifest.events.push(...normalized); manifest.events.sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt)); await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`); await writeFile(path.join(root, 'timeline.html'), renderHtml(manifest)); return { added: normalized.length, repaired, events: normalized, manifest, timeline: path.join(root, 'timeline.html') };
}
function materialBase(event) { return `${timestampName(event.occurredAt)}_${event.source}_${safePart(event.sourceId, 'item')}_${shortId(event.sourceId)}`; }
async function writeEventMaterials(root, event, keepRemote) {
  const base = materialBase(event), mdName = `${base}.md`, media = await saveEventMedia(root, base, event, keepRemote);
  await writeFile(path.join(root, 'materials', mdName), markdownFor(event, markdownImageTargets(media)));
  return { ...event, raw: undefined, markdown: `materials/${mdName}`, files: media.files, previews: media.previews, ...(media.pendingOriginals.length ? { pendingOriginals: media.pendingOriginals } : {}) };
}
async function saveEventMedia(root, base, event, keepRemote) {
  const files = [], previews = [], pendingOriginals = [];
  let index = 0;
  for (const media of event.media ?? []) {
    const name = `${base}_${String(++index).padStart(2, '0')}${extFromUrl(media.url)}`, original = path.join(root, 'materials', name), preview = path.join(root, '.timeline-cache', name);
    try {
      if (media.deferOriginal && media.previewUrl && !await hasNonemptyFile(original)) {
        if (!await hasNonemptyFile(preview)) await download(media.previewUrl, preview, 3);
        pendingOriginals.push({ index: files.length, url: media.url, file: `materials/${name}` }); files.push(`.timeline-cache/${name}`); previews.push(`.timeline-cache/${name}`); continue;
      }
      if (!await hasNonemptyFile(original)) await downloadWithFallback(media, original);
      files.push(`materials/${name}`); previews.push(await hasNonemptyFile(preview) || await makePreview(original, preview) ? `.timeline-cache/${name}` : `materials/${name}`);
    } catch (error) { if (keepRemote) { files.push(media.url); previews.push(media.url); } else event.mediaError = error.message; }
  }
  return { files, previews, pendingOriginals };
}
function markdownImageTargets({ files, pendingOriginals }) { const pending = new Set(pendingOriginals.map(item => item.index)); return files.map((file, i) => pending.has(i) ? null : file.startsWith('http') ? file : path.basename(file)); }
function markdownImageLines(media) { return markdownImageTargets(media).map((target, i) => target && !target.startsWith('http') ? `![画像${i + 1}](${target})` : null).filter(Boolean); }
export async function rerenderWorkspace(root) {
  const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
  manifest.workspaceRoot = root;
  await copyTimelineIcons(root);
  await writeFile(path.join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(path.join(root, 'timeline.html'), renderHtml(manifest));
  return path.join(root, 'timeline.html');
}
export async function refreshOutdatedTimelines(dir = path.join(homedir(), 'Downloads')) {
  const refreshed = [];
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory() || !entry.name.startsWith('My Timeline ')) continue;
    const root = path.join(dir, entry.name), html = await readFile(path.join(root, 'timeline.html'), 'utf8').catch(() => null);
    if (html === null || html.includes(`"renderVersion":"${RENDER_VERSION}"`)) continue;
    try { await rerenderWorkspace(root); refreshed.push(root); } catch {}
  }
  return refreshed;
}
export function pendingOriginalCount(manifest) { return manifest.events.reduce((sum, event) => sum + (event.pendingOriginals?.length ?? 0), 0); }
function progressMessage(event) { if (event.source === 'flickr') return 'Flickrの表示用画像を保存しています（原寸画像はタイムライン作成後に取得します）'; if (event.source === 'strava') return 'Stravaのスタート・ゴールとルートを書き出しています'; if (event.media?.length) return `${event.source}の画像と投稿を書き出しています`; return `${event.source}の投稿を書き出しています`; }
async function makePreview(source, destination) {
  try { await execFileAsync('/usr/bin/sips', ['-Z', '900', source, '--out', destination]); return true; }
  catch { return false; }
}
async function downloadWithFallback(media, destination) {
  let lastError;
  for (const url of [...new Set([media.url, ...(media.fallbackUrls ?? [])])]) {
    try { await downloadQueued(url, destination); return; } catch (error) { lastError = error; }
  }
  throw lastError;
}
let flickrQueue = Promise.resolve();
export async function downloadQueued(url, destination) {
  if (new URL(url).hostname !== 'live.staticflickr.com') return download(url, destination);
  const task = flickrQueue.then(async () => {
    try { return await download(url, destination, 3); }
    finally { await new Promise(resolve => setTimeout(resolve, 1_000)); }
  });
  flickrQueue = task.catch(() => {});
  return task;
}
async function mapLimit(items, concurrency, work) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await work(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}
async function persistentWorkspace(fromText, toText, title) {
  const downloads = path.join(homedir(), 'Downloads');
  await ensureDir(downloads);
  return mkdtemp(path.join(downloads, `My Timeline ${fromText}〜${toText} ${safePart(title, '行事記録')}-`));
}
function markdownFor(event, mediaTargets) { return ['---', `source: ${event.source}`, `source_id: ${JSON.stringify(event.sourceId)}`, `occurred_at: ${event.occurredAt}`, `original_url: ${event.originalUrl ?? ''}`, '---', '', event.text ?? '', '', ...mediaTargets.map((f, i) => !f ? null : f.startsWith('http') ? `[画像${i + 1}](${f})` : `![画像${i + 1}](${f})`).filter(Boolean), event.originalUrl ? `\n[元の記録](${event.originalUrl})` : '', ''].join('\n'); }
export function renderHtml(m) {
  const orderedEvents = inferDisplayTimeZones([...m.events].sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt)), m.from, m.to);
  const addLink = m.workspaceRoot ? `<a class="add-link" href="http://127.0.0.1:4177/add?root=${encodeURIComponent(m.workspaceRoot)}">＋ 素材を追加</a>` : '';
  const head = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(m.title)}</title><style>${timelineStyles}</style></head><body><header class="page-header"><div><h1>${escapeHtml(m.title)}</h1><p>${escapeHtml(m.from)}〜${escapeHtml(m.to)} · ${m.events.length}件</p></div>${addLink}</header>`;
  if (!orderedEvents.length) return `${head}<main><p>該当する素材はありません。</p></main></body></html>`;
  let previousDay = '';
  const cards = orderedEvents.map((e, i) => { const day = localDay(e.occurredAt), bar = day === previousDay ? '' : dateBarFor(day); previousDay = day; return `${bar}${cardFor(m, e, i)}`; }).join('\n');
  const sources = [...new Set(m.events.map(e => e.source))].map(s => `<label><input type="checkbox" value="${escapeHtml(s)}" checked>${sourceIconImage(s)}${escapeHtml(s)}</label>`).join('');
  const days = [...new Set(orderedEvents.map(e => localDay(e.occurredAt)))].map(day => `<option value="${day}">${escapeHtml(dayLabel(day))}</option>`).join('');
  const selection = m.workspaceRoot ? '<button id="select-visible" type="button">表示中をすべて選択</button><button id="clear-selection" type="button">すべて外す</button>' : '', deleteSelection = m.workspaceRoot ? '<button id="delete-selection" class="danger" type="button" hidden>選択したカードを削除</button>' : '';
  const controls = `<div class="controls"><div class="day-navigation" role="group" aria-label="表示する日を切り替え"><button id="previous-day" type="button" aria-label="前の日" title="前の日">${svgIcon('chevron_left')}</button><select id="day" aria-label="表示する日"><option value="" hidden>検索結果</option>${days}</select><button id="next-day" type="button" aria-label="次の日" title="次の日">${svgIcon('chevron_right')}</button></div><input id="q" type="search" placeholder="検索" aria-label="素材を検索"><details class="menu source-menu"><summary>取得元<span id="source-count" class="menu-count"></span></summary><fieldset class="source-filter menu-panel"><legend>表示する取得元</legend>${sources}</fieldset></details><details class="menu more-menu"><summary aria-label="その他の操作" title="その他の操作">${svgIcon('more_horiz')}</summary><div class="menu-panel">${selection}<button id="image-size" type="button" aria-pressed="false">画像を大きく表示</button></div></details>${deleteSelection}</div>`;
  const map = overviewMapData(orderedEvents), mapPanel = map.points.length || map.routes.length ? `<details id="overview-map" class="overview-map"><summary>地図</summary><div class="overview-map-modes" role="group" aria-label="地図の表示範囲"><button type="button" data-scope="day" aria-pressed="true">この日</button><button type="button" data-scope="all" aria-pressed="false">全期間</button></div><iframe id="overview-map-frame" class="overview-map-frame" src="about:blank" data-srcdoc="${escapeHtml(overviewMapDocument())}" title="全体地図"></iframe></details>` : '';
  const pending = pendingOriginalCount(m), repairBanner = m.workspaceRoot && pending ? `<div class="repair-banner" role="status"><span>原寸画像 未取得 <strong>${pending}</strong>件（表示中は縮小画像です）</span><button id="resume-repair" type="button">補完を再開</button><span id="repair-message" aria-live="polite"></span></div>` : '';
  const initialDay = orderedEvents.some(event => localDay(event.occurredAt) === m.from) ? m.from : localDay(orderedEvents[0].occurredAt);
  const data = JSON.stringify({ root: m.workspaceRoot ?? null, renderVersion: RENDER_VERSION, initialDay, map }).replaceAll('<', '\\u003c');
  return `${head}${controls}${repairBanner}${mapPanel}<main>${cards}</main><script type="application/json" id="timeline-data">${data}</script><script>${timelineScript}</script></body></html>`;
}
function dayLabel(day) { return new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }).format(new Date(`${day}T00:00:00+09:00`)); }
function dateBarFor(day) { return `<h2 class="date-bar" data-date="${day}">${escapeHtml(dayLabel(day))}</h2>`; }
function cardFor(m, e, i) {
  const textOnly = e.source === 'eml', goal = isStravaGoal(e), files = textOnly ? [] : e.files ?? [], hasVisual = files.length || (!textOnly && !goal && e.routeGeometry?.coordinates?.length);
  const media = textOnly ? '' : `${goal ? '' : routePlotFor(e)}${files.map((f, j) => f.startsWith('http') ? `<a href="${escapeHtml(f)}">画像を開く</a>` : `<a class="image-link" href="${escapeHtml(f)}" aria-label="元の大きさで画像を開く"><img src="${escapeHtml(e.previews?.[j] ?? f)}" alt="" ${i === 0 && j === 0 ? 'fetchpriority="high"' : 'loading="lazy"'}></a>`).join('')}`;
  return `<article tabindex="-1" class="event ${hasVisual ? 'has-media' : 'text-only'}${goal ? ' goal' : ''} ${i > 4 ? 'deferred' : ''}" style="--source-color:${sourceAccent(e.source)}" data-date="${localDay(e.occurredAt)}" data-source="${escapeHtml(e.source)}" data-key="${escapeHtml(eventKey(e))}" data-search="${escapeHtml((e.text ?? '').toLowerCase())}"><header>${sourceIcon(e.source) ? `<img class="source-icon" src=".timeline-cache/icons/${sourceIcon(e.source)}" alt="${escapeHtml(e.source)}" title="${escapeHtml(e.source)}" width="30" height="30">` : `<span>${escapeHtml(e.source)}</span>`}</header><div class="body">${eventTextFor(e)}${routeProgressFor(e)}${goal ? goalLinkFor(m, e) : ''}${e.routeGeometry ? '' : mapFor(e.location)}</div><div class="media">${media}</div><footer>${footerLinksFor(m, e)}${eventTimeFor(e)}</footer></article>`;
}
function eventKey(event) { return `${event.source}:${event.sourceId}`; }
function isStravaGoal(event) { return event.source === 'strava' && String(event.sourceId).endsWith(':end'); }
function goalLinkFor(m, event) {
  const startId = String(event.sourceId).replace(/:end$/, ':start'), start = m.events.find(item => item.source === 'strava' && item.sourceId === startId);
  return start ? `<p class="goal-link"><a class="jump-start" href="#" data-key="${escapeHtml(eventKey(start))}" data-date="${localDay(start.occurredAt)}">▶ スタートへ</a></p>` : '';
}
const iconShapes = {
  chevron_left: '<path d="M15 6l-6 6 6 6"/>',
  chevron_right: '<path d="M9 6l6 6-6 6"/>',
  more_horiz: '<circle cx="5" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.7" fill="currentColor" stroke="none"/>',
  description: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M10 12h5M10 16h5"/>',
  open_in_new: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  delete: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/>',
  location_on: '<path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/>'
};
function svgIcon(name) { return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${iconShapes[name]}</svg>`; }
function footerLinksFor(m, e) {
  const links = [];
  if (e.markdown) links.push(`<a href="${escapeHtml(e.markdown)}" aria-label="記録" title="記録">${svgIcon('description')}</a>`);
  if (e.originalUrl) links.push(`<a href="${escapeHtml(e.originalUrl)}" aria-label="元ページ" title="元ページ">${svgIcon('open_in_new')}</a>`);
  if (m.workspaceRoot) links.push(`<a class="danger" href="http://127.0.0.1:4177/delete?${escapeHtml(new URLSearchParams({ root: m.workspaceRoot, source: e.source, sourceId: e.sourceId }))}" aria-label="削除" title="削除">${svgIcon('delete')}</a>`);
  return links.join('');
}
function overviewMapDocument() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${mapLibraryStyles}<style>html,body,#map{height:100%;margin:0}body{background:#edf1eb}.leaflet-container{font-family:system-ui,sans-serif}.empty{position:absolute;inset:0;z-index:500;display:grid;place-items:center;color:#675f53;font:14px system-ui,sans-serif;pointer-events:none}.empty[hidden]{display:none}</style></head><body><div id="map"></div><div class="empty" hidden>この日には位置情報のあるカードがありません</div>${mapLibraryScripts}<script>const colors={strava:'#fc4c02',flickr:'#d6006f',bluesky:'#1185fe',x:'#222222',place:'#17624a',memo:'#8a6d00'},mapElement=document.querySelector('#map'),empty=document.querySelector('.empty'),map=L.map(mapElement,{scrollWheelZoom:false});${mapBaseLayer}const layer=L.featureGroup().addTo(map),show=(key,date)=>parent.postMessage({type:'overview-show',key,date},'*');function draw({routes,points}){map.invalidateSize();layer.clearLayers();for(const route of routes)L.polyline(route.coords,{color:'#fc4c02',weight:4,opacity:.9}).addTo(layer).on('click',()=>show(route.key,route.date));for(const point of points)L.circleMarker([point.lat,point.lon],{radius:7,color:'#fff',weight:2,fillColor:colors[point.source]??'#555555',fillOpacity:1}).addTo(layer).bindTooltip(point.label).on('click',()=>show(point.key,point.date));empty.hidden=layer.getLayers().length>0;if(layer.getLayers().length)map.fitBounds(layer.getBounds(),{padding:[30,30],maxZoom:15});else if(map.getZoom()===undefined)map.setView([35.68,139.76],5)}window.addEventListener('message',event=>{if(event.data?.type==='overview')draw(event.data)});new ResizeObserver(()=>map.invalidateSize()).observe(mapElement);parent.postMessage({type:'overview-ready'},'*');<\/script></body></html>`;
}
function overviewMapData(events) {
  const points = [], routes = [], routeKeys = new Set();
  for (const event of events) {
    const coordinates = event.routeGeometry?.coordinates, routeId = event.originalUrl ?? eventKey(event);
    if (coordinates?.length && !routeKeys.has(routeId)) { routeKeys.add(routeId); routes.push({ key: eventKey(event), date: localDay(event.occurredAt), coords: coordinates.map(([lat, lon]) => [Number(lat), Number(lon)]) }); }
    if (event.source === 'strava') continue;
    const lat = Number(event.location?.latitude), lon = Number(event.location?.longitude);
    if (event.location && Number.isFinite(lat) && Number.isFinite(lon)) points.push({ key: eventKey(event), date: localDay(event.occurredAt), source: event.source, lat, lon, label: `${event.source} ${String(event.text ?? '').split('\n')[0].slice(0, 40)}` });
  }
  return { points, routes };
}
const iconFiles = ['bluesky.png', 'email.png', 'flickr.png', 'place.png', 'strava.png', 'whatsapp.png', 'x.png'];
export async function copyTimelineIcons(root) { const cache = path.join(root, '.timeline-cache'), destination = path.join(cache, 'icons'); await ensureDir(destination); await Promise.all(iconFiles.map(name => copyFile(new URL(`../../resources/${name}`, import.meta.url), path.join(destination, name)))); }
function sourceIcon(source) { return ({ bluesky: 'bluesky.png', x: 'x.png', flickr: 'flickr.png', strava: 'strava.png', gmail: 'email.png', eml: 'email.png', place: 'place.png', whatsapp: 'whatsapp.png' })[source] ?? ''; }
function sourceAccent(source) { return ({ bluesky: '#1185fe', x: '#555555', flickr: '#d6006f', strava: '#fc4c02', gmail: '#c5221f', eml: '#7b61c9', memo: '#b08900', place: '#17624a', whatsapp: '#1fa855' })[source] ?? '#9c9384'; }
function sourceIconImage(source) { const icon = sourceIcon(source); return icon ? `<img class="source-icon" src=".timeline-cache/icons/${icon}" alt="" width="20" height="20">` : ''; }
function eventTextFor(event) {
  const text = String(event.text ?? ''), full = escapeHtml(text).replaceAll('\n', '<br>');
  if (!['gmail', 'eml', 'memo'].includes(event.source)) return `<p>${full}</p>`;
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean),
    previewText = event.source === 'gmail' ? lines.slice(0, 3).join('\n') : `${lines[0]?.slice(0, 180) ?? ''}${(lines[0]?.length ?? 0) > 180 || lines.length > 1 ? '…' : ''}`,
    preview = escapeHtml(previewText).replaceAll('\n', '<br>');
  return `<div class="collapsible-text"><p>${preview}</p><details><summary style="cursor:pointer;margin-block:.55rem;color:#065fd4;font-weight:700">全文を表示／閉じる</summary><div class="markdown-body">${renderSafeMarkdown(text)}</div></details>${attachmentLinksFor(event)}</div>`;
}
function attachmentLinksFor(event) {
  if (!event.attachments?.length) return '';
  return `<p style="margin-top:.7rem">${event.attachments.map(attachment => `<a href="${escapeHtml(attachment.path)}" download>${escapeHtml(attachment.name)}</a>`).join(' · ')}</p>`;
}
function renderSafeMarkdown(markdown) {
  const lines = String(markdown).replaceAll('\r\n', '\n').split('\n'), blocks = [];
  let paragraph = [], list = null, quote = [], code = null;
  const flushParagraph = () => { if (paragraph.length) blocks.push(`<p>${paragraph.map(renderMarkdownInline).join('<br>')}</p>`); paragraph = []; };
  const flushList = () => { if (list) blocks.push(`<${list.type}>${list.items.map(item => `<li>${renderMarkdownInline(item)}</li>`).join('')}</${list.type}>`); list = null; };
  const flushQuote = () => { if (quote.length) blocks.push(`<blockquote>${quote.map(renderMarkdownInline).join('<br>')}</blockquote>`); quote = []; };
  const flush = () => { flushParagraph(); flushList(); flushQuote(); };
  for (const line of lines) {
    if (code) { if (/^```/.test(line)) { blocks.push(`<pre tabindex="0"><code>${escapeHtml(code.join('\n'))}</code></pre>`); code = null; } else code.push(line); continue; }
    if (/^```/.test(line)) { flush(); code = []; continue; }
    if (!line.trim()) { flush(); continue; }
    const heading = line.match(/^(#{1,3})\s+(.+)$/), setext = line.match(/^\s*(=+|-+)\s*$/), unordered = line.match(/^\s*[-*+]\s+(.+)$/), ordered = line.match(/^\s*\d+[.)]\s+(.+)$/), quoted = line.match(/^>\s?(.*)$/);
    if (setext && paragraph.length) { const title = paragraph.pop(); flush(); const level = setext[1][0] === '=' ? 3 : 4; blocks.push(`<h${level}>${renderMarkdownInline(title)}</h${level}>`); }
    else if (heading) { flush(); blocks.push(`<h${heading[1].length + 2}>${renderMarkdownInline(heading[2])}</h${heading[1].length + 2}>`); }
    else if (unordered || ordered) { flushParagraph(); flushQuote(); const type = unordered ? 'ul' : 'ol'; if (list?.type !== type) { flushList(); list = { type, items: [] }; } list.items.push((unordered ?? ordered)[1]); }
    else if (quoted) { flushParagraph(); flushList(); quote.push(quoted[1]); }
    else if (/^\s*(?:---+|___+|\*\*\*+)\s*$/.test(line)) { flush(); blocks.push('<hr>'); }
    else { flushList(); flushQuote(); paragraph.push(line); }
  }
  if (code) blocks.push(`<pre tabindex="0"><code>${escapeHtml(code.join('\n'))}</code></pre>`);
  flush();
  return blocks.join('');
}
function renderMarkdownInline(value) {
  const tokens = [];
  const token = html => { tokens.push(html); return `\u0000${tokens.length - 1}\u0000`; };
  let text = String(value)
    .replace(/`([^`\n]+)`/g, (_, code) => token(`<code>${escapeHtml(code)}</code>`))
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)(?:\s+(?:"[^"]*"|'[^']*'))?\)/g, (_, label, url) => token(`<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${renderMarkdownLabel(label)}</a>`));
  text = escapeHtml(text)
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>')
    .replace(/(?<!_)_([^_\n]+)_(?!_)/g, '<em>$1</em>');
  return text.replace(/\u0000(\d+)\u0000/g, (_, index) => tokens[Number(index)]);
}
function renderMarkdownLabel(value) {
  return escapeHtml(value).replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
}
function deleteLinkFor(manifest, event) { if (!manifest.workspaceRoot) return ''; const query = new URLSearchParams({ root: manifest.workspaceRoot, source: event.source, sourceId: event.sourceId }); return ` · <a href="http://127.0.0.1:4177/delete?${escapeHtml(query)}" style="color:#a32121">削除</a>`; }
function localDay(value) { return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value)); }
function eventTimeFor(event) {
  const date = new Date(event.occurredAt), japanZone = 'Asia/Tokyo', japan = formatEventTime(date, japanZone), lat = Number(event.location?.latitude), lon = Number(event.location?.longitude), offset = event.flickrTakenOffset ?? event.displayTimeOffset, inferred = Boolean(event.displayTimeInheritedFrom), timeAttrs = inferred ? ` class="event-time event-time-inferred" datetime="${escapeHtml(event.occurredAt)}" data-time-inherited-from="${escapeHtml(event.displayTimeInheritedFrom)}" title="直前の位置情報があるカードから時差を推定"` : ` class="event-time" datetime="${escapeHtml(event.occurredAt)}"`;
  if (offset && offset !== '+09:00') return `<time${timeAttrs}><span>(${escapeHtml(japan)})</span><span>${escapeHtml(formatOffsetTime(date, offset))}</span></time>`;
  let localZone = event.displayTimeZone ?? event.flickrTakenTimeZone ?? japanZone;
  if (Number.isFinite(lat) && Number.isFinite(lon)) { try { localZone = tzlookup(lat, lon); } catch {} }
  if (localZone === japanZone) return `<time${timeAttrs}>${escapeHtml(japan)}</time>`;
  return `<time${timeAttrs}><span>(${escapeHtml(japan)})</span><span>${escapeHtml(formatEventTime(date, localZone))}</span></time>`;
}
export function inferDisplayTimeZones(events, from, to) {
  const start = Date.parse(`${from}T00:00:00+09:00`), end = Date.parse(`${to}T23:59:59.999+09:00`); let previous = null;
  return events.map(original => {
    const event = { ...original }, timestamp = new Date(event.occurredAt).getTime(), inRange = timestamp >= start && timestamp <= end, basis = eventTimeBasis(event);
    if (!inRange) return event;
    if (basis) previous = { ...basis, sourceId: event.sourceId };
    else if (event.source !== 'flickr' && previous) { if (previous.type === 'offset') event.displayTimeOffset = previous.value; else event.displayTimeZone = previous.value; event.displayTimeInheritedFrom = previous.sourceId; }
    return event;
  });
}
function eventTimeBasis(event) { if (event.flickrTakenOffset) return { type: 'offset', value: event.flickrTakenOffset }; if (event.flickrTakenTimeZone) return { type: 'zone', value: event.flickrTakenTimeZone }; const lat = Number(event.location?.latitude), lon = Number(event.location?.longitude); if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null; try { return { type: 'zone', value: tzlookup(lat, lon) }; } catch { return null; } }
function formatEventTime(date, timeZone) { return new Intl.DateTimeFormat('ja-JP', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZoneName: 'short' }).format(date); }
function formatOffsetTime(date, offset) { const sign = offset.startsWith('-') ? -1 : 1, [hours, minutes] = offset.slice(1).split(':').map(Number), shifted = new Date(date.getTime() + sign * (hours * 60 + minutes) * 60_000), label = `GMT${offset.replace(/:00$/, '').replace(/^\+0?/, '+').replace(/^-0?/, '-')}`; return `${new Intl.DateTimeFormat('ja-JP', { timeZone: 'UTC', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(shifted)} ${label}`; }
function routeProgressFor(event) { if (!event.routeProgress) return ''; const km = (Number(event.routeProgress.distanceMeters) / 1000).toLocaleString('ja-JP', { maximumFractionDigits: 1 }); return `<p class="route-progress"><strong>${escapeHtml(event.routeProgress.activityName)} · スタートから ${km} km</strong>${event.locationInferredFromStrava ? '<br>時刻から推定した位置' : ''}</p>`; }
function routePlotFor(event) {
  const coordinates = event.routeGeometry?.coordinates;
  if (!coordinates?.length) return '';
  const route = JSON.stringify(coordinates.map(([lat, lon]) => [Number(lat), Number(lon)])).replaceAll('<', '\\u003c');
  const distance = (Number(event.routeGeometry.totalDistanceMeters) / 1000).toLocaleString('ja-JP', { maximumFractionDigits: 1 });
  const document = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${mapLibraryStyles}<style>html,body,#map{height:100%;margin:0}body{background:#edf1eb}.leaflet-container{font-family:system-ui,sans-serif}.legend{position:absolute;z-index:500;left:8px;bottom:20px;padding:5px 8px;border-radius:6px;background:#fffd;color:#222;font:12px system-ui,sans-serif;box-shadow:0 1px 5px #0004}</style></head><body><div id="map" aria-label="${escapeHtml(distance)} kmの走行ルート"></div><div class="legend"><span style="color:#17624a">●</span> スタート　<span style="color:#a32121">●</span> ゴール　${escapeHtml(distance)} km</div>${mapLibraryScripts}<script>const route=${route};const mapElement=document.querySelector('#map'),map=L.map(mapElement,{scrollWheelZoom:false});${mapBaseLayer}const line=L.polyline(route,{color:'#fc4c02',weight:5,opacity:.95,lineCap:'round',lineJoin:'round'}).addTo(map);L.circleMarker(route[0],{radius:7,color:'#fff',weight:2,fillColor:'#17624a',fillOpacity:1}).addTo(map).bindTooltip('スタート');L.circleMarker(route.at(-1),{radius:7,color:'#fff',weight:2,fillColor:'#a32121',fillOpacity:1}).addTo(map).bindTooltip('ゴール');let fittedWidth=0,fittedHeight=0;function fitRoute(){const {width,height}=mapElement.getBoundingClientRect();if(width<1||height<1||width===fittedWidth&&height===fittedHeight)return;fittedWidth=width;fittedHeight=height;requestAnimationFrame(()=>{map.invalidateSize();map.fitBounds(line.getBounds(),{padding:[40,40],maxZoom:15})})}new ResizeObserver(fitRoute).observe(mapElement);window.addEventListener('pageshow',fitRoute);fitRoute();</script></body></html>`;
  return `<div class="route-map"><iframe src="about:blank" data-srcdoc="${escapeHtml(document)}" loading="lazy" title="Strava走行ルート（${escapeHtml(distance)} km）"></iframe></div>`;
}
function mapFor(location) {
  const lat = Number(location?.latitude), lon = Number(location?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '';
  const delta = 0.048, bbox = `${lon - delta},${lat - delta},${lon + delta},${lat + delta}`;
  const embed = `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${encodeURIComponent(`${lat},${lon}`)}`;
  const osmLink = `https://www.openstreetmap.org/?mlat=${encodeURIComponent(lat)}&mlon=${encodeURIComponent(lon)}#map=13/${encodeURIComponent(lat)}/${encodeURIComponent(lon)}`;
  const googleLink = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lon}`)}`;
  return `<details class="map"><summary>${svgIcon('location_on')}地図</summary><iframe src="about:blank" data-src="${escapeHtml(embed)}" loading="lazy" title="この記録の撮影場所"></iframe><p class="map-links"><a href="${escapeHtml(osmLink)}">OpenStreetMapで開く</a> · <a href="${escapeHtml(googleLink)}">Google Mapsで開く</a></p></details>`;
}
