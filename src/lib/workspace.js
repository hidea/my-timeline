import path from 'node:path';
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { promisify } from 'node:util';
import { download, ensureDir, escapeHtml, extFromUrl, hasNonemptyFile, safePart, shortId, timestampName, writeJson } from './utils.js';
const execFileAsync = promisify(execFile);

export async function createWorkspace({ output, title, fromText, toText, events, keepRemote = false, onProgress = () => {} }) {
  const root = output ? path.resolve(output) : await persistentWorkspace(fromText, toText, title);
  const materials = path.join(root, 'materials'), cache = path.join(root, '.timeline-cache'); await ensureDir(materials); await ensureDir(cache); await ensureDir(path.join(root, 'selected'));
  const ordered = events.sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt));
  let completed = 0;
  const normalized = await mapLimit(ordered, 4, async event => {
    onProgress(completed, ordered.length, progressMessage(event));
    const base = `${timestampName(event.occurredAt)}_${event.source}_${safePart(event.sourceId, 'item')}_${shortId(event.sourceId)}`, mdName = `${base}.md`, mediaFiles = [], previewFiles = [];
    let index = 0;
    for (const media of event.media ?? []) { const name = `${base}_${String(++index).padStart(2, '0')}${extFromUrl(media.url)}`; try { const original = path.join(materials, name), preview = path.join(cache, name); if (!await hasNonemptyFile(original)) await downloadWithFallback(media, original); mediaFiles.push(name); previewFiles.push(await hasNonemptyFile(preview) || await makePreview(original, preview) ? `.timeline-cache/${name}` : `materials/${name}`); } catch (error) { if (keepRemote) mediaFiles.push(media.url); else event.mediaError = error.message; } }
    await writeFile(path.join(materials, mdName), markdownFor(event, mediaFiles));
    const normalizedEvent = { ...event, raw: undefined, markdown: `materials/${mdName}`, files: mediaFiles.map(x => x.startsWith('http') ? x : `materials/${x}`), previews: previewFiles };
    onProgress(++completed, ordered.length, progressMessage(event));
    return normalizedEvent;
  });
  const manifest = { schemaVersion: 1, title, from: fromText, to: toText, generatedAt: new Date().toISOString(), events: normalized };
  await writeJson(path.join(root, 'manifest.json'), manifest); await writeFile(path.join(root, 'timeline.html'), renderHtml(manifest));
  await writeFile(path.join(root, 'itinerary.md'), `# ${title} 行程\n\n<!-- 記録から確認できた出来事を、出典ファイル付きで整理する -->\n`); await writeFile(path.join(root, 'outline.md'), `# ${title} 構成案\n\n`); await writeFile(path.join(root, 'draft.md'), `# ${title}\n\n`);
  return root;
}
function progressMessage(event) { if (event.source === 'flickr') return 'Flickrの原寸画像を保存し、表示用画像を生成しています'; if (event.source === 'strava') return 'Stravaのスタート・ゴールとルートを書き出しています'; if (event.media?.length) return `${event.source}の画像と投稿を書き出しています`; return `${event.source}の投稿を書き出しています`; }
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
async function downloadQueued(url, destination) {
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
  return mkdtemp(path.join(downloads, `My Timeline ${fromText}〜${toText} ${safePart(title, '旅行記')}-`));
}
function markdownFor(event, mediaFiles) { return ['---', `source: ${event.source}`, `source_id: ${JSON.stringify(event.sourceId)}`, `occurred_at: ${event.occurredAt}`, `original_url: ${event.originalUrl ?? ''}`, '---', '', event.text ?? '', '', ...mediaFiles.map((f, i) => f.startsWith('http') ? `[画像${i + 1}](${f})` : `![画像${i + 1}](${f})`), event.originalUrl ? `\n[元の記録](${event.originalUrl})` : '', ''].join('\n'); }
export function renderHtml(m) {
  const cards = m.events.map((e, i) => { const day = localDay(e.occurredAt), files = e.files ?? [], hasVisual = files.length || e.routeGeometry?.coordinates?.length; return `<article tabindex="-1" class="event ${hasVisual ? 'has-media' : 'text-only'} ${i > 4 ? 'deferred' : ''}" data-date="${day}" data-source="${escapeHtml(e.source)}" data-search="${escapeHtml((e.text ?? '').toLowerCase())}"><header><time datetime="${escapeHtml(e.occurredAt)}">${escapeHtml(new Date(e.occurredAt).toLocaleString('ja-JP'))}</time><span>${escapeHtml(e.source)}</span></header><div class="body"><p>${escapeHtml(e.text ?? '').replaceAll('\n', '<br>')}</p>${routeProgressFor(e)}${e.routeGeometry ? '' : mapFor(e.location)}</div><div class="media">${routePlotFor(e)}${files.map((f, j) => f.startsWith('http') ? `<a href="${escapeHtml(f)}">画像を開く</a>` : `<a class="image-link" href="${escapeHtml(f)}" aria-label="元の大きさで画像を開く"><img src="${escapeHtml(e.previews?.[j] ?? f)}" alt="" ${i === 0 && j === 0 ? 'fetchpriority="high"' : 'loading="lazy"'}></a>`).join('')}</div><footer>${e.markdown ? `<a href="${escapeHtml(e.markdown)}">記録</a>` : ''}${e.originalUrl ? ` · <a href="${escapeHtml(e.originalUrl)}">元ページ</a>` : ''}</footer></article>`; }).join('\n');
  const options = [...new Set(m.events.map(e => e.source))].map(s => `<option>${escapeHtml(s)}</option>`).join('');
  const days = [...new Set(m.events.map(e => localDay(e.occurredAt)))].map(day => `<option value="${day}">${day}</option>`).join('');
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(m.title)}</title><style>:root{color-scheme:light dark;font-family:system-ui,sans-serif}body{max-width:1180px;margin:auto;padding:24px;background:#f4f1ea;color:#24211c}h1{margin-bottom:4px}.controls{position:sticky;top:0;z-index:2;display:flex;flex-wrap:wrap;gap:8px;padding:12px 0;background:#f4f1eadd;backdrop-filter:blur(10px)}input,select,button{font:inherit;padding:10px;border:1px solid #aaa;border-radius:8px;background:white;color:#222}input{flex:1;min-width:180px}main{container-type:inline-size}.event{display:grid;grid-template-columns:132px minmax(220px,1fr) minmax(260px,420px);grid-template-areas:"meta text media" "meta links media";align-items:start;gap:10px 18px;background:#fff;color:#222;margin:12px 0;padding:16px;border-radius:12px;box-shadow:0 2px 10px #0001;scroll-margin-top:84px}.event.text-only{grid-template-columns:132px minmax(0,1fr);grid-template-areas:"meta text" "meta links"}.event header{grid-area:meta;display:grid;gap:6px;color:#675f53;font-size:.86rem}.event .body{grid-area:text;min-width:0}.event p{margin:0;line-height:1.65;overflow-wrap:anywhere}.event footer{grid-area:links;align-self:end}.map{margin-top:12px}.map summary{cursor:pointer;color:#065fd4}.map iframe{display:block;width:100%;height:240px;margin-top:8px;border:1px solid #aaa;border-radius:8px}.map>a{display:inline-block;margin-top:6px}.media{grid-area:media;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(150px,100%),1fr));gap:4px;max-width:420px}.image-link{display:flex;justify-content:center;align-items:center;overflow:hidden;border-radius:12px;background:#eee}.media img{display:block;width:auto;max-width:100%;height:auto;max-height:420px;object-fit:contain}.large-images .event.has-media{grid-template-columns:132px minmax(0,1fr);grid-template-areas:"meta text" "meta media" "meta links"}.large-images .media{max-width:none;grid-template-columns:1fr}.large-images .media img{width:100%;max-height:none;object-fit:contain}.deferred{content-visibility:auto;contain-intrinsic-size:auto none auto 420px}[hidden]{display:none}@container (max-width:760px){.event,.event.text-only,.large-images .event.has-media{grid-template-columns:1fr;grid-template-areas:"meta" "text" "media" "links"}.event header{display:flex;justify-content:space-between}.media{max-width:506px}.media img{max-height:506px}}@media(prefers-color-scheme:dark){body{background:#171614;color:#eee}.event{background:#26231f;color:#eee}.controls{background:#171614dd}.image-link{background:#111}}</style></head><body><h1>${escapeHtml(m.title)}</h1><p>${escapeHtml(m.from)}〜${escapeHtml(m.to)} · ${m.events.length}件</p><div class="controls"><input id="q" type="search" placeholder="素材を検索"><select id="source"><option value="">すべて</option>${options}</select><select id="day"><option value="">日付へ移動</option>${days}</select><button id="image-size" type="button" aria-pressed="false">画像を大きく表示</button></div><main>${cards || '<p>該当する素材はありません。</p>'}</main><script>const q=document.querySelector('#q'),s=document.querySelector('#source'),day=document.querySelector('#day'),size=document.querySelector('#image-size'),cards=[...document.querySelectorAll('.event')];function filter(){const n=q.value.toLowerCase();for(const c of cards)c.hidden=!!((n&&!c.dataset.search.includes(n))||(s.value&&c.dataset.source!==s.value))}q.addEventListener('input',filter);s.addEventListener('change',filter);day.addEventListener('change',()=>{const target=cards.find(card=>card.dataset.date===day.value);if(target){target.scrollIntoView({block:'start'});target.focus({preventScroll:true})}});for(const map of document.querySelectorAll('.map'))map.addEventListener('toggle',()=>{if(map.open){const frame=map.querySelector('iframe[data-src]');if(frame){frame.src=frame.dataset.src;frame.removeAttribute('data-src')}}});size.addEventListener('click',()=>{const large=document.body.classList.toggle('large-images');size.setAttribute('aria-pressed',String(large));size.textContent=large?'画像を小さく表示':'画像を大きく表示'})</script></body></html>`;
}
function localDay(value) { return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value)); }
function routeProgressFor(event) { if (!event.routeProgress) return ''; const km = (Number(event.routeProgress.distanceMeters) / 1000).toLocaleString('ja-JP', { maximumFractionDigits: 1 }); return `<p class="route-progress"><strong>${escapeHtml(event.routeProgress.activityName)} · スタートから ${km} km</strong>${event.locationInferredFromStrava ? '<br>時刻から推定した位置' : ''}</p>`; }
function routePlotFor(event) {
  const coordinates = event.routeGeometry?.coordinates;
  if (!coordinates?.length) return '';
  const route = JSON.stringify(coordinates.map(([lat, lon]) => [Number(lat), Number(lon)])).replaceAll('<', '\\u003c');
  const distance = (Number(event.routeGeometry.totalDistanceMeters) / 1000).toLocaleString('ja-JP', { maximumFractionDigits: 1 });
  const document = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin=""><style>html,body,#map{height:100%;margin:0}body{background:#edf1eb}.leaflet-container{font-family:system-ui,sans-serif}.legend{position:absolute;z-index:500;left:8px;bottom:20px;padding:5px 8px;border-radius:6px;background:#fffd;color:#222;font:12px system-ui,sans-serif;box-shadow:0 1px 5px #0004}</style></head><body><div id="map" aria-label="${escapeHtml(distance)} kmの走行ルート"></div><div class="legend"><span style="color:#17624a">●</span> スタート　<span style="color:#a32121">●</span> ゴール　${escapeHtml(distance)} km</div><script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script><script>const route=${route};const map=L.map('map',{scrollWheelZoom:false});L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap<\/a>'}).addTo(map);const line=L.polyline(route,{color:'#fc4c02',weight:5,opacity:.95,lineCap:'round',lineJoin:'round'}).addTo(map);L.circleMarker(route[0],{radius:7,color:'#fff',weight:2,fillColor:'#17624a',fillOpacity:1}).addTo(map).bindTooltip('スタート');L.circleMarker(route.at(-1),{radius:7,color:'#fff',weight:2,fillColor:'#a32121',fillOpacity:1}).addTo(map).bindTooltip('ゴール');map.fitBounds(line.getBounds(),{padding:[24,24],maxZoom:15});</script></body></html>`;
  return `<div class="route-map"><iframe srcdoc="${escapeHtml(document)}" loading="lazy" title="Strava走行ルート（${escapeHtml(distance)} km）" style="display:block;box-sizing:border-box;width:100%;height:320px;border:1px solid #aaa;border-radius:12px;background:#edf1eb"></iframe><a href="${escapeHtml(event.originalUrl)}" style="display:inline-block;margin-top:6px">Stravaで開く</a></div>`;
}
function mapFor(location) {
  const lat = Number(location?.latitude), lon = Number(location?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '';
  const delta = 0.048, bbox = `${lon - delta},${lat - delta},${lon + delta},${lat + delta}`;
  const embed = `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${encodeURIComponent(`${lat},${lon}`)}`;
  const osmLink = `https://www.openstreetmap.org/?mlat=${encodeURIComponent(lat)}&mlon=${encodeURIComponent(lon)}#map=13/${encodeURIComponent(lat)}/${encodeURIComponent(lon)}`;
  const googleLink = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lon}`)}`;
  return `<div class="map"><iframe src="${escapeHtml(embed)}" loading="lazy" title="この記録の撮影場所"></iframe><a href="${escapeHtml(osmLink)}">OpenStreetMapで開く</a> · <a href="${escapeHtml(googleLink)}">Google Mapsで開く</a></div>`;
}
