import path from 'node:path';
import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { promisify } from 'node:util';
import { download, ensureDir, escapeHtml, extFromUrl, hasNonemptyFile, safePart, shortId, timestampName, writeJson } from './utils.js';
const execFileAsync = promisify(execFile);

export async function createWorkspace({ output, title, fromText, toText, events, keepRemote = false, onProgress = () => {} }) {
  const root = output ? path.resolve(output) : await persistentWorkspace(fromText, toText, title);
  const materials = path.join(root, 'materials'), cache = path.join(root, '.timeline-cache'); await ensureDir(materials); await ensureDir(cache); await ensureDir(path.join(root, 'selected')); await copyTimelineIcons(root);
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
  const manifest = { schemaVersion: 1, workspaceRoot: root, title, from: fromText, to: toText, generatedAt: new Date().toISOString(), events: normalized };
  await writeJson(path.join(root, 'manifest.json'), manifest); await writeFile(path.join(root, 'timeline.html'), renderHtml(manifest));
  await writeFile(path.join(root, 'itinerary.md'), `# ${title} 行程\n\n<!-- 記録から確認できた出来事を、出典ファイル付きで整理する -->\n`); await writeFile(path.join(root, 'outline.md'), `# ${title} 構成案\n\n`); await writeFile(path.join(root, 'draft.md'), `# ${title}\n\n`);
  return root;
}
export async function appendEventsToWorkspace(root, events, { keepRemote = false, onProgress = () => {} } = {}) {
  const manifestPath = path.join(root, 'manifest.json'), manifest = JSON.parse(await readFile(manifestPath, 'utf8')), existingByKey = new Map(manifest.events.map(event => [`${event.source}:${event.sourceId}`, event])), existing = new Set(existingByKey.keys());
  const ordered = events.filter(event => !existing.has(`${event.source}:${event.sourceId}`)).sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt));
  const materials = path.join(root, 'materials'), cache = path.join(root, '.timeline-cache'); await ensureDir(materials); await ensureDir(cache); await copyTimelineIcons(root);
  let completed = 0, repaired = 0;
  const missingExisting = events.filter(event => { const saved = existingByKey.get(`${event.source}:${event.sourceId}`); return saved && !saved.files?.length && event.media?.length; });
  const totalWork = missingExisting.length + ordered.length;
  for (const fresh of missingExisting) {
    const saved = existingByKey.get(`${fresh.source}:${fresh.sourceId}`), base = `${timestampName(saved.occurredAt)}_${saved.source}_${safePart(saved.sourceId, 'item')}_${shortId(saved.sourceId)}`, mediaFiles = [], previewFiles = [];
    let index = 0;
    onProgress(completed, totalWork, `${fresh.source}の未保存画像を再取得しています`);
    for (const media of fresh.media) {
      const name = `${base}_${String(++index).padStart(2, '0')}${extFromUrl(media.url)}`;
      try { const original = path.join(materials, name), preview = path.join(cache, name); await downloadWithFallback(media, original); mediaFiles.push(`materials/${name}`); previewFiles.push(await makePreview(original, preview) ? `.timeline-cache/${name}` : `materials/${name}`); }
      catch (error) { saved.mediaError = error.message; }
    }
    if (mediaFiles.length) { saved.media = fresh.media; saved.files = mediaFiles; saved.previews = previewFiles; delete saved.mediaError; repaired++; const markdownPath = path.join(root, saved.markdown), markdown = await readFile(markdownPath, 'utf8'); const additions = mediaFiles.map((file, i) => `![画像${i + 1}](${path.basename(file)})`).filter(line => !markdown.includes(line)); if (additions.length) await writeFile(markdownPath, `${markdown.trimEnd()}\n\n${additions.join('\n')}\n`); }
    completed++; onProgress(completed, totalWork, `${fresh.source}の未保存画像を再取得しています`);
  }
  const normalized = await mapLimit(ordered, 4, async event => {
    onProgress(completed, totalWork, progressMessage(event));
    const base = `${timestampName(event.occurredAt)}_${event.source}_${safePart(event.sourceId, 'item')}_${shortId(event.sourceId)}`, mdName = `${base}.md`, mediaFiles = [], previewFiles = [];
    let index = 0;
    for (const media of event.media ?? []) { const name = `${base}_${String(++index).padStart(2, '0')}${extFromUrl(media.url)}`; try { const original = path.join(materials, name), preview = path.join(cache, name); if (!await hasNonemptyFile(original)) await downloadWithFallback(media, original); mediaFiles.push(name); previewFiles.push(await hasNonemptyFile(preview) || await makePreview(original, preview) ? `.timeline-cache/${name}` : `materials/${name}`); } catch (error) { if (keepRemote) mediaFiles.push(media.url); else event.mediaError = error.message; } }
    await writeFile(path.join(materials, mdName), markdownFor(event, mediaFiles)); onProgress(++completed, totalWork, progressMessage(event));
    return { ...event, raw: undefined, markdown: `materials/${mdName}`, files: mediaFiles.map(name => name.startsWith('http') ? name : `materials/${name}`), previews: previewFiles };
  });
  manifest.workspaceRoot = root; manifest.events.push(...normalized); manifest.events.sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt)); await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`); await writeFile(path.join(root, 'timeline.html'), renderHtml(manifest)); return { added: normalized.length, repaired, events: normalized, manifest, timeline: path.join(root, 'timeline.html') };
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
  return mkdtemp(path.join(downloads, `My Timeline ${fromText}〜${toText} ${safePart(title, '行事記録')}-`));
}
function markdownFor(event, mediaFiles) { return ['---', `source: ${event.source}`, `source_id: ${JSON.stringify(event.sourceId)}`, `occurred_at: ${event.occurredAt}`, `original_url: ${event.originalUrl ?? ''}`, '---', '', event.text ?? '', '', ...mediaFiles.map((f, i) => f.startsWith('http') ? `[画像${i + 1}](${f})` : `![画像${i + 1}](${f})`), event.originalUrl ? `\n[元の記録](${event.originalUrl})` : '', ''].join('\n'); }
function renderHtmlBase(m) {
  const orderedEvents = [...m.events].sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt));
  const cards = orderedEvents.map((e, i) => { const day = localDay(e.occurredAt), files = e.files ?? [], hasVisual = files.length || e.routeGeometry?.coordinates?.length, addLink = i === 0 && m.workspaceRoot ? `<p><a href="http://127.0.0.1:4177/add?root=${encodeURIComponent(m.workspaceRoot)}" style="display:inline-block;padding:10px 14px;border:1px solid currentColor;border-radius:8px;font-weight:700;text-decoration:none">＋ 素材を追加</a></p>` : '', colors = sourceColors(e.source), icon = sourceIcon(e.source); return `${addLink}<article tabindex="-1" class="event ${hasVisual ? 'has-media' : 'text-only'} ${i > 4 ? 'deferred' : ''}" style="background:${colors.light};background:light-dark(${colors.light},${colors.dark})" data-date="${day}" data-source="${escapeHtml(e.source)}" data-search="${escapeHtml((e.text ?? '').toLowerCase())}"><header><span>${icon ? `<img src=".timeline-cache/icons/${icon}" alt="" width="24" height="24" style="display:inline-block;width:24px;height:24px;margin-inline-end:7px;vertical-align:middle;object-fit:contain">` : ''}${escapeHtml(e.source)}</span></header><div class="body">${eventTextFor(e)}${routeProgressFor(e)}${e.routeGeometry ? '' : mapFor(e.location)}</div><div class="media">${routePlotFor(e)}${files.map((f, j) => f.startsWith('http') ? `<a href="${escapeHtml(f)}">画像を開く</a>` : `<a class="image-link" href="${escapeHtml(f)}" aria-label="元の大きさで画像を開く"><img src="${escapeHtml(e.previews?.[j] ?? f)}" alt="" ${i === 0 && j === 0 ? 'fetchpriority="high"' : 'loading="lazy"'}></a>`).join('')}</div><footer>${e.markdown ? `<a href="${escapeHtml(e.markdown)}">記録</a>` : ''}${e.originalUrl ? ` · <a href="${escapeHtml(e.originalUrl)}">元ページ</a>` : ''}${deleteLinkFor(m, e)}</footer><time class="event-time" datetime="${escapeHtml(e.occurredAt)}">${escapeHtml(new Date(e.occurredAt).toLocaleString('ja-JP'))}</time></article>`; }).join('\n');
  const options = [...new Set(m.events.map(e => e.source))].map(s => `<option>${escapeHtml(s)}</option>`).join('');
  const days = [...new Set(orderedEvents.map(e => localDay(e.occurredAt)))].map(day => `<option value="${day}">${day}</option>`).join('');
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(m.title)}</title><style>:root{color-scheme:light dark;font-family:system-ui,sans-serif}body{max-width:1180px;margin:auto;padding:24px;background:#f4f1ea;color:#24211c}h1{margin-bottom:4px}.controls{position:sticky;top:0;z-index:2;display:flex;flex-wrap:wrap;gap:8px;padding:12px 0;background:#f4f1eadd;backdrop-filter:blur(10px)}input,select,button{font:inherit;padding:10px;border:1px solid #aaa;border-radius:8px;background:white;color:#222}input{flex:1;min-width:180px}main{container-type:inline-size}.event{display:grid;grid-template-columns:132px minmax(220px,1fr) minmax(260px,420px);grid-template-areas:"meta text media" "meta links media" "time time time";align-items:start;gap:10px 18px;background:#fff;color:#222;margin:12px 0;padding:16px;border-radius:12px;box-shadow:0 2px 10px #0001;scroll-margin-top:84px}.event.text-only{grid-template-columns:132px minmax(0,1fr);grid-template-areas:"meta text" "meta links" "time time"}.event header{grid-area:meta;display:grid;gap:6px;color:#675f53;font-size:.86rem}.event .body{grid-area:text;min-width:0}.event p{margin:0;line-height:1.65;overflow-wrap:anywhere}.event footer{grid-area:links;align-self:end}.event-time{grid-area:time;justify-self:end;color:#675f53;font-size:.86rem}.map{margin-top:12px}.map summary{cursor:pointer;color:#065fd4}.map iframe{display:block;width:100%;height:240px;margin-top:8px;border:1px solid #aaa;border-radius:8px}.map>a{display:inline-block;margin-top:6px}.media{grid-area:media;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(150px,100%),1fr));gap:4px;max-width:420px}.image-link{display:flex;justify-content:center;align-items:center;overflow:hidden;border-radius:12px;background:#eee}.media img{display:block;width:auto;max-width:100%;height:auto;max-height:420px;object-fit:contain}.large-images .event.has-media{grid-template-columns:132px minmax(0,1fr);grid-template-areas:"meta text" "meta media" "meta links" "time time"}.large-images .media{max-width:none;grid-template-columns:1fr}.large-images .media img{width:100%;max-height:none;object-fit:contain}.deferred{content-visibility:auto;contain-intrinsic-size:auto none auto 420px}[hidden]{display:none}@container (max-width:760px){.event,.event.text-only,.large-images .event.has-media{grid-template-columns:1fr;grid-template-areas:"meta" "text" "media" "links" "time"}.event header{display:flex;justify-content:space-between}.media{max-width:506px}.media img{max-height:506px}}@media(prefers-color-scheme:dark){body{background:#171614;color:#eee}.event{background:#26231f;color:#eee}.controls{background:#171614dd}.image-link{background:#111}}</style></head><body><h1>${escapeHtml(m.title)}</h1><p>${escapeHtml(m.from)}〜${escapeHtml(m.to)} · ${m.events.length}件</p><div class="controls"><input id="q" type="search" placeholder="素材を検索"><select id="source"><option value="">すべて</option>${options}</select><select id="day"><option value="">日付へ移動</option>${days}</select><button id="image-size" type="button" aria-pressed="false">画像を大きく表示</button></div><main>${cards || '<p>該当する素材はありません。</p>'}</main><script>const q=document.querySelector('#q'),s=document.querySelector('#source'),day=document.querySelector('#day'),size=document.querySelector('#image-size'),cards=[...document.querySelectorAll('.event')];function filter(){const n=q.value.toLowerCase();for(const c of cards)c.hidden=!!((n&&!c.dataset.search.includes(n))||(s.value&&c.dataset.source!==s.value))}q.addEventListener('input',filter);s.addEventListener('change',filter);day.addEventListener('change',()=>{const target=cards.find(card=>card.dataset.date===day.value);if(target){target.scrollIntoView({block:'start'});target.focus({preventScroll:true})}});for(const map of document.querySelectorAll('.map'))map.addEventListener('toggle',()=>{if(map.open){const frame=map.querySelector('iframe[data-src]');if(frame){frame.src=frame.dataset.src;frame.removeAttribute('data-src')}}});size.addEventListener('click',()=>{const large=document.body.classList.toggle('large-images');size.setAttribute('aria-pressed',String(large));size.textContent=large?'画像を小さく表示':'画像を大きく表示'})</script></body></html>`;
}
export function renderHtml(m) {
  let html = renderHtmlBase(m);
  if (!m.workspaceRoot || !m.events.length) return html;
  let previousDay = '';
  html = html.replace(/(<article\b(?=[^>]*\bdata-date="([^"]+)")[^>]*>)/g, (_, tag, day) => {
    if (day === previousDay) return tag;
    previousDay = day;
    const label = new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }).format(new Date(`${day}T00:00:00+09:00`));
    return `<h2 class="date-bar" data-date="${day}">${escapeHtml(label)}</h2>${tag}`;
  });
  html = html.replace(/<\/footer>(<time class="event-time"[\s\S]*?<\/time>)/g, '$1</footer>');
  const materialIcon = name => `<span class="material-symbols-rounded" aria-hidden="true">${name}</span>`, icons = { record: materialIcon('description'), original: materialIcon('open_in_new'), remove: materialIcon('delete') };
  html = html.replace(/<footer>([\s\S]*?)<\/footer>/g, (_, links) => `<footer>${links.replaceAll(' · ', '').replace('>記録</a>', `>${icons.record}記録</a>`).replace('>元ページ</a>', `>${icons.original}元ページ</a>`).replace('>削除</a>', `>${icons.remove}削除</a>`)}</footer>`);
  const extraStyles = `@font-face{font-family:'Material Symbols Rounded';font-style:normal;font-weight:400;src:url('.timeline-cache/material-symbols-rounded.woff2') format('woff2')}.date-bar{margin:2rem 0 .75rem;padding:.65rem 1rem;border-block:1px solid light-dark(#c9c1b4,#514b43);background:light-dark(#e8e2d7,#292622);font-size:1.05rem;line-height:1.3;scroll-margin-top:84px}.selection-controls{display:inline-flex;flex-wrap:wrap;gap:2px;padding:3px;border:1px solid light-dark(#aaa397,#5d574e);border-radius:10px;background:light-dark(#e5dfd4,#302c27)}.selection-controls button{border:0;border-radius:6px;padding:.45rem .65rem}.date-bar+*{}.event-shell{position:relative}.event-shell:has(>.event[hidden]){display:none}.event{margin-inline-start:2rem;grid-template-areas:"meta text media" "meta links links";row-gap:.35rem;padding-inline-end:.5rem;padding-block-end:.5rem}.event.text-only{grid-template-areas:"meta text" "meta links"}.event.text-only .media:empty{display:none}.large-images .event.has-media{grid-template-areas:"meta text" "meta media" "meta links"}.event.text-only.deferred{content-visibility:visible;contain-intrinsic-size:none}.event header>span{order:-1}.event footer{display:flex;flex-wrap:wrap;align-items:center;gap:.2rem .55rem;align-self:start;min-inline-size:0}.event-time{margin-inline-start:auto}.event footer a{display:inline-flex;align-items:center;gap:.3rem;padding:.2rem .32rem;border-radius:.35rem;text-decoration:none}.event footer a:hover{background:light-dark(#0000000b,#ffffff12)}.event footer a:focus-visible{outline:2px solid currentColor;outline-offset:2px}.material-symbols-rounded{font-family:'Material Symbols Rounded';font-weight:400;font-style:normal;font-size:1.15rem;line-height:1;letter-spacing:normal;text-transform:none;display:inline-block;white-space:nowrap;word-wrap:normal;direction:ltr;font-feature-settings:'liga';-webkit-font-feature-settings:'liga';-webkit-font-smoothing:antialiased}.card-select{position:absolute;z-index:1;inset-inline-start:0;top:50%;translate:0 -50%;opacity:0;transition:opacity .12s}.event-shell:hover .card-select,.event-shell:focus-within .card-select,.card-select:checked,.card-select:focus-visible{opacity:1}@media(hover:none){.card-select{opacity:1}}@container (max-width:760px){.event,.event.text-only,.large-images .event.has-media{grid-template-areas:"meta" "text" "media" "links"}.event.text-only{grid-template-areas:"meta" "text" "links"}}@media(max-width:600px){.event{margin-inline-start:1.7rem}}`;
  html = html.replace('</style>', `${extraStyles}</style>`);
  const controls = '<div class="selection-controls" role="group" aria-label="カードの一括選択と削除"><button id="select-visible" type="button">表示中をすべて選択</button><button id="clear-selection" type="button">すべて外す</button><button id="delete-selection" type="button" disabled style="color:#a32121">選択したカードを削除</button></div>';
  const root = JSON.stringify(m.workspaceRoot).replaceAll('<', '\\u003c');
  const selectionScript = `const selectedButton=document.querySelector('#select-visible'),clearButton=document.querySelector('#clear-selection'),deleteButton=document.querySelector('#delete-selection'),dateBars=[...document.querySelectorAll('.date-bar')];for(const c of cards){const link=c.querySelector('footer a[href*="/delete?"]');if(!link)continue;const url=new URL(link.href),shell=document.createElement('div'),box=document.createElement('input');shell.className='event-shell';c.before(shell);shell.append(c);box.type='checkbox';box.className='card-select';box.dataset.id=url.searchParams.get('source')+':'+url.searchParams.get('sourceId');box.setAttribute('aria-label','このカードを選択');box.style.cssText='width:22px;height:22px;min-width:22px;padding:0;accent-color:#a32121';shell.append(box);box.addEventListener('change',updateSelected)}function updateSelected(){const count=document.querySelectorAll('.card-select:checked').length;deleteButton.disabled=!count;deleteButton.textContent=count?count+'件を削除…':'選択したカードを削除'}function updateDateBars(){for(const bar of dateBars)bar.hidden=!cards.some(card=>!card.hidden&&card.dataset.date===bar.dataset.date)}q.addEventListener('input',updateDateBars);s.addEventListener('change',updateDateBars);selectedButton.addEventListener('click',()=>{for(const c of cards)if(!c.hidden)c.closest('.event-shell').querySelector('.card-select').checked=true;updateSelected()});clearButton.addEventListener('click',()=>{for(const box of document.querySelectorAll('.card-select'))box.checked=false;updateSelected()});deleteButton.addEventListener('click',()=>{const ids=[...document.querySelectorAll('.card-select:checked')].map(box=>box.dataset.id),form=document.createElement('form');form.method='post';form.action='http://127.0.0.1:4177/delete-bulk';for(const [name,value] of [['root',${root}],['ids',JSON.stringify(ids)]]){const input=document.createElement('input');input.type='hidden';input.name=name;input.value=value;form.append(input)}document.body.append(form);form.submit()});`;
  html = html.replace('<button id="image-size"', `${controls}<button id="image-size"`);
  return html.replace("size.addEventListener('click'", `${selectionScript}size.addEventListener('click'`);
}
const iconFiles = ['bluesky.png', 'email.png', 'flickr.png', 'place.png', 'strava.png', 'whatsapp.png', 'x.png'];
export async function copyTimelineIcons(root) { const cache = path.join(root, '.timeline-cache'), destination = path.join(cache, 'icons'); await ensureDir(destination); await Promise.all([...iconFiles.map(name => copyFile(new URL(`../../resources/${name}`, import.meta.url), path.join(destination, name))), copyFile(new URL('../../node_modules/material-symbols/material-symbols-rounded.woff2', import.meta.url), path.join(cache, 'material-symbols-rounded.woff2'))]); }
function sourceIcon(source) { return ({ bluesky: 'bluesky.png', x: 'x.png', flickr: 'flickr.png', strava: 'strava.png', gmail: 'email.png', eml: 'email.png', place: 'place.png', whatsapp: 'whatsapp.png' })[source] ?? ''; }
function sourceColors(source) { return ({ bluesky: { light: '#f1f8ff', dark: '#202b35' }, x: { light: '#f4f4f4', dark: '#242424' }, flickr: { light: '#fff3fa', dark: '#32242d' }, strava: { light: '#fff5ef', dark: '#352821' }, gmail: { light: '#fff8ed', dark: '#332e25' }, eml: { light: '#f5f2ff', dark: '#2b2738' }, memo: { light: '#fffdf2', dark: '#302f25' }, place: { light: '#f1faf3', dark: '#223027' }, whatsapp: { light: '#f0fbf4', dark: '#203128' } })[source] ?? { light: '#ffffff', dark: '#26231f' }; }
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
function routeProgressFor(event) { if (!event.routeProgress) return ''; const km = (Number(event.routeProgress.distanceMeters) / 1000).toLocaleString('ja-JP', { maximumFractionDigits: 1 }); return `<p class="route-progress"><strong>${escapeHtml(event.routeProgress.activityName)} · スタートから ${km} km</strong>${event.locationInferredFromStrava ? '<br>時刻から推定した位置' : ''}</p>`; }
function routePlotFor(event) {
  const coordinates = event.routeGeometry?.coordinates;
  if (!coordinates?.length) return '';
  const route = JSON.stringify(coordinates.map(([lat, lon]) => [Number(lat), Number(lon)])).replaceAll('<', '\\u003c');
  const distance = (Number(event.routeGeometry.totalDistanceMeters) / 1000).toLocaleString('ja-JP', { maximumFractionDigits: 1 });
  const document = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin=""><style>html,body,#map{height:100%;margin:0}body{background:#edf1eb}.leaflet-container{font-family:system-ui,sans-serif}.legend{position:absolute;z-index:500;left:8px;bottom:20px;padding:5px 8px;border-radius:6px;background:#fffd;color:#222;font:12px system-ui,sans-serif;box-shadow:0 1px 5px #0004}</style></head><body><div id="map" aria-label="${escapeHtml(distance)} kmの走行ルート"></div><div class="legend"><span style="color:#17624a">●</span> スタート　<span style="color:#a32121">●</span> ゴール　${escapeHtml(distance)} km</div><script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script><script>const route=${route};const mapElement=document.querySelector('#map'),map=L.map(mapElement,{scrollWheelZoom:false});L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap<\/a>'}).addTo(map);const line=L.polyline(route,{color:'#fc4c02',weight:5,opacity:.95,lineCap:'round',lineJoin:'round'}).addTo(map);L.circleMarker(route[0],{radius:7,color:'#fff',weight:2,fillColor:'#17624a',fillOpacity:1}).addTo(map).bindTooltip('スタート');L.circleMarker(route.at(-1),{radius:7,color:'#fff',weight:2,fillColor:'#a32121',fillOpacity:1}).addTo(map).bindTooltip('ゴール');let fittedWidth=0,fittedHeight=0;function fitRoute(){const {width,height}=mapElement.getBoundingClientRect();if(width<1||height<1||width===fittedWidth&&height===fittedHeight)return;fittedWidth=width;fittedHeight=height;requestAnimationFrame(()=>{map.invalidateSize();map.fitBounds(line.getBounds(),{padding:[40,40],maxZoom:15})})}new ResizeObserver(fitRoute).observe(mapElement);window.addEventListener('pageshow',fitRoute);fitRoute();</script></body></html>`;
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
