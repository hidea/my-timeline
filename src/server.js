#!/usr/bin/env node
import { createServer } from 'node:http';
import { access, readFile, realpath } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { updateEnv } from './lib/env-file.js';
import { exchangeFlickrToken, flickrAuthorizeUrl, requestFlickrToken } from './lib/flickr-oauth.js';
import { httpError } from './lib/utils.js';
import { defaultMcpAuthDir, defaultTwilogUrl, resetTwilogAuth, twilogAuthFiles } from './lib/twilog-auth.js';
import { exchangeGmailCode } from './collectors/gmail.js';
import { addManualMaterial } from './manual-material.js';
import { appendSources } from './append-sources.js';
import { bulkDeleteInfo, deleteTimelineEvent, deleteTimelineEvents, eventInfo } from './delete-event.js';
import { importEmlFiles } from './import-eml.js';
import { repairTasks, repairWorkspaceMedia } from './lib/repair.js';
import { RENDER_VERSION, refreshOutdatedTimelines, rerenderWorkspace } from './lib/workspace.js';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const uiRoot = join(projectRoot, 'ui');
const host = '127.0.0.1';
const FILE_PAGE_ROUTES = new Set(['/api/refresh-timeline', '/api/repair-media', '/api/repair-status']), fileOrigin = { 'access-control-allow-origin': 'null' };
const SOURCES = ['bluesky', 'x', 'flickr', 'strava', 'gmail'];
const assets = new Map([['/', ['index.html', 'text/html; charset=utf-8']], ['/add', ['add.html', 'text/html; charset=utf-8']], ['/delete', ['delete.html', 'text/html; charset=utf-8']], ['/delete-bulk', ['delete-bulk.html', 'text/html; charset=utf-8']], ['/app.js', ['app.js', 'text/javascript; charset=utf-8']], ['/add.js', ['add.js', 'text/javascript; charset=utf-8']], ['/delete.js', ['delete.js', 'text/javascript; charset=utf-8']], ['/delete-bulk.js', ['delete-bulk.js', 'text/javascript; charset=utf-8']], ['/style.css', ['style.css', 'text/css; charset=utf-8']]]);

export function createAppServer({ openTarget = open, envFile = join(projectRoot, '.env'), runCollectJob = runCollect, runRepairJob = null, mcpAuthDir = defaultMcpAuthDir() } = {}) {
  let job = null, stravaState = null, gmailState = null;
  const pendingDeletes = new Map(), flickrRequests = new Map(), locks = new Map();
  const twilogAuth = () => ({ baseDir: mcpAuthDir, serverUrl: process.env.TWILOG_MCP_URL ?? defaultTwilogUrl });
  const callbackUrl = name => `http://${host}:${server.address().port}/api/${name}/callback`;
  const saveEnv = async updates => { Object.assign(process.env, Object.fromEntries(Object.entries(updates).map(([key, value]) => [key, String(value)]))); await updateEnv(envFile, updates); };
  const withWorkspaceLock = (root, task) => {
    const run = (locks.get(root) ?? Promise.resolve()).then(() => task()), tail = run.catch(() => {});
    locks.set(root, tail); tail.then(() => { if (locks.get(root) === tail) locks.delete(root); });
    return run;
  };
  const repairs = new Map(), repairJob = runRepairJob ?? ((root, onProgress) => repairWorkspaceMedia(root, { onProgress, withLock: task => withWorkspaceLock(root, task) }));
  const startRepair = (root, onProgress = () => {}) => {
    if (!repairs.has(root)) repairs.set(root, Promise.resolve().then(() => repairJob(root, onProgress)).finally(() => repairs.delete(root)));
    return repairs.get(root);
  };
  const pendingRepairs = async root => repairTasks(JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'))).length;

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${host}`), route = `${request.method} ${url.pathname}`;
      if (request.method === 'GET' && assets.has(url.pathname)) {
        const [name, type] = assets.get(url.pathname);
        response.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
        response.end(await readFile(join(uiRoot, name))); return;
      }
      if (route === 'POST /delete-bulk') {
        const body = await readForm(request, 2 * 1024 * 1024), root = await workspaceRoot(body.root), ids = parseJson(body.ids ?? '[]');
        if (!Array.isArray(ids) || !ids.length) throw httpError(400, '削除するカードを選択してください。');
        const token = randomBytes(24).toString('hex'); pendingDeletes.set(token, { root, ids, createdAt: Date.now() });
        response.writeHead(303, { location: `/delete-bulk?token=${token}` }); response.end(); return;
      }
      if (route === 'POST /api/manual-material') {
        const body = await readJson(request, 100 * 1024 * 1024), root = await workspaceRoot(body.root);
        const timeline = await withWorkspaceLock(root, () => addManualMaterial(root, body)); await openTarget(timeline); json(response, 200, { saved: true }); return;
      }
      if (route === 'POST /api/import-eml') {
        const body = await readJson(request, 150 * 1024 * 1024), root = await workspaceRoot(body.root);
        const result = await withWorkspaceLock(root, () => importEmlFiles(root, body.files)); await openTarget(result.timeline); json(response, 200, result); return;
      }
      if (route === 'POST /api/open-timeline') { const body = await readJson(request), root = await workspaceRoot(body.root); await openTarget(join(root, 'timeline.html')); json(response, 200, { opened: true }); return; }
      if (route === 'GET /api/workspace-info') {
        const root = await workspaceRoot(url.searchParams.get('root')), manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
        json(response, 200, { title: manifest.title, from: manifest.from, to: manifest.to }); return;
      }
      if (route === 'GET /api/event-info') { const root = await workspaceRoot(url.searchParams.get('root')); json(response, 200, await eventInfo(root, url.searchParams.get('source'), url.searchParams.get('sourceId'))); return; }
      if (route === 'POST /api/delete-event') {
        const body = await readJson(request), root = await workspaceRoot(body.root);
        const result = await withWorkspaceLock(root, () => deleteTimelineEvent(root, body.source, body.sourceId)); await openTarget(result.timeline); json(response, 200, { deleted: true }); return;
      }
      if (route === 'GET /api/bulk-delete-info') { const pending = pendingDelete(url.searchParams.get('token'), '一括削除の確認期限が切れました。タイムラインから選択し直してください。'); json(response, 200, await bulkDeleteInfo(pending.root, pending.ids)); return; }
      if (route === 'POST /api/delete-events') {
        const body = await readJson(request), pending = pendingDelete(body.token, '一括削除の確認期限が切れました。');
        const result = await withWorkspaceLock(pending.root, () => deleteTimelineEvents(pending.root, pending.ids)); pendingDeletes.delete(body.token); await openTarget(result.timeline); json(response, 200, { deleted: result.deleted }); return;
      }
      if (route === 'POST /api/append-sources') {
        const body = await readJson(request), root = await workspaceRoot(body.root);
        if (!Array.isArray(body.sources) || !body.sources.length || body.sources.some(source => !SOURCES.includes(source))) throw httpError(400, '追加する取得元を選んでください。');
        const result = await withWorkspaceLock(root, async () => appendSources(root, JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')), body)); await openTarget(result.timeline);
        const pending = await pendingRepairs(root); if (pending) startRepair(root).catch(() => {});
        json(response, 200, { ...result, pendingOriginals: pending }); return;
      }
      if (route === 'POST /api/refresh-timeline') {
        const body = await readJson(request), root = await workspaceRoot(body.root), updated = body.renderVersion !== RENDER_VERSION || body.renderedRoot !== root;
        if (updated) await withWorkspaceLock(root, () => rerenderWorkspace(root));
        json(response, 200, { updated }, fileOrigin); return;
      }
      if (route === 'GET /api/repair-status') { const root = await workspaceRoot(url.searchParams.get('root')); json(response, 200, { pending: await pendingRepairs(root), running: repairs.has(root) }, fileOrigin); return; }
      if (route === 'POST /api/repair-media') {
        const body = await readJson(request), root = await workspaceRoot(body.root), pending = await pendingRepairs(root);
        if (pending) startRepair(root).catch(() => {});
        json(response, 200, { pending, started: pending > 0 }, fileOrigin); return;
      }
      if (route === 'POST /api/collect') {
        if (job?.status === 'running') return json(response, 409, { error: '現在、収集中です。', job });
        const body = await readJson(request); validate(body);
        job = { id: crypto.randomUUID(), status: 'running', message: '収集を開始します', startedAt: new Date().toISOString() };
        runCollectJob(body, update => { job = { ...job, ...update }; }).then(async root => {
          await Promise.allSettled([openTarget(join(root, 'timeline.html')), openTarget(root)]);
          job = { ...job, status: 'repairing', message: 'タイムラインは閲覧できます。取得できなかった原寸画像を補完しています', root };
          try {
            await startRepair(root, update => { job = { ...job, ...update, message: `タイムラインは閲覧できます。原寸画像を補完しています (${update.done}/${update.total}、成功 ${update.repaired})` }; });
            job = { ...job, status: 'complete', message: job.warnings?.length ? '完了しました（取得できなかった取得元があります）' : '完了しました', finishedAt: new Date().toISOString() };
          } catch (error) { job = { ...job, status: 'complete', message: `タイムラインは作成済みです。原寸画像の補完に失敗しました: ${error.message}`, finishedAt: new Date().toISOString() }; }
        }).catch(error => { job = { ...job, status: 'error', message: error.message, finishedAt: new Date().toISOString() }; });
        json(response, 202, job); return;
      }
      if (route === 'GET /api/status') { json(response, 200, job ?? { status: 'idle' }); return; }
      if (route === 'GET /api/strava/status') { json(response, 200, { configured: Boolean(process.env.STRAVA_CLIENT_ID && process.env.STRAVA_CLIENT_SECRET), connected: Boolean(process.env.STRAVA_REFRESH_TOKEN) }); return; }
      if (route === 'GET /api/gmail/status') { json(response, 200, { configured: Boolean(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET), connected: Boolean(process.env.GMAIL_REFRESH_TOKEN) }); return; }
      if (route === 'GET /api/twilog/status') { const files = await twilogAuthFiles(twilogAuth()); json(response, 200, { authenticated: files.some(file => file.name.endsWith('_tokens.json')), tokenOverride: Boolean(process.env.TWILOG_MCP_TOKEN) }); return; }
      if (route === 'POST /api/twilog/reset') { if (job?.status === 'running') throw httpError(409, '収集中は認証をやり直せません。収集が終わってから押してください。'); json(response, 200, await resetTwilogAuth(twilogAuth())); return; }
      if (route === 'GET /api/flickr/status') { json(response, 200, flickrStatus()); return; }
      if (route === 'POST /api/gmail/config') {
        const body = await readJson(request), clientId = String(body.clientId ?? '').trim(), clientSecret = String(body.clientSecret ?? '').trim();
        if (!clientId || !clientSecret) throw httpError(400, 'GmailのClient IDとClient Secretを入力してください。');
        await saveEnv({ GMAIL_CLIENT_ID: clientId, GMAIL_CLIENT_SECRET: clientSecret });
        json(response, 200, { configured: true, connected: Boolean(process.env.GMAIL_REFRESH_TOKEN) }); return;
      }
      if (route === 'POST /api/strava/config') {
        const body = await readJson(request), clientId = String(body.clientId ?? '').trim(), clientSecret = String(body.clientSecret ?? '').trim(), accessToken = String(body.accessToken ?? '').trim(), refreshToken = String(body.refreshToken ?? '').trim();
        if (!/^\d+$/.test(clientId) || !clientSecret) throw httpError(400, 'StravaのClient IDとClient Secretを入力してください。');
        await saveEnv({ STRAVA_CLIENT_ID: clientId, STRAVA_CLIENT_SECRET: clientSecret, ...(accessToken ? { STRAVA_ACCESS_TOKEN: accessToken } : {}), ...(refreshToken ? { STRAVA_REFRESH_TOKEN: refreshToken, STRAVA_EXPIRES_AT: '0' } : {}) });
        json(response, 200, { configured: true, connected: Boolean(process.env.STRAVA_REFRESH_TOKEN) }); return;
      }
      if (route === 'POST /api/flickr/config') {
        const body = await readJson(request), apiKey = String(body.apiKey ?? '').trim(), apiSecret = String(body.apiSecret ?? '').trim(), userId = String(body.userId ?? '').trim();
        if (!apiKey || !userId) throw httpError(400, 'FlickrのAPI KeyとユーザーIDを入力してください。');
        await saveEnv({ FLICKR_API_KEY: apiKey, FLICKR_USER_ID: userId, ...(apiSecret ? { FLICKR_API_SECRET: apiSecret } : {}) });
        json(response, 200, flickrStatus()); return;
      }
      if (route === 'GET /api/gmail/connect') {
        if (!process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_CLIENT_SECRET) throw httpError(400, '先にGmailのClient IDとClient Secretを保存してください。');
        gmailState = randomBytes(24).toString('hex');
        redirect(response, 'https://accounts.google.com/o/oauth2/v2/auth', { client_id: process.env.GMAIL_CLIENT_ID, redirect_uri: callbackUrl('gmail'), response_type: 'code', access_type: 'offline', prompt: 'consent', scope: 'https://www.googleapis.com/auth/gmail.readonly', state: gmailState }); return;
      }
      if (route === 'GET /api/strava/connect') {
        if (!process.env.STRAVA_CLIENT_ID || !process.env.STRAVA_CLIENT_SECRET) throw httpError(400, '先にClient IDとClient Secretを保存してください。');
        stravaState = randomBytes(24).toString('hex');
        redirect(response, 'https://www.strava.com/oauth/authorize', { client_id: process.env.STRAVA_CLIENT_ID, redirect_uri: callbackUrl('strava'), response_type: 'code', approval_prompt: 'auto', scope: 'read,activity:read_all', state: stravaState }); return;
      }
      if (route === 'GET /api/flickr/connect') {
        if (!process.env.FLICKR_API_KEY || !process.env.FLICKR_API_SECRET) throw httpError(400, '先にFlickrのAPI KeyとSecretを保存してください。');
        const requested = await requestFlickrToken({ key: process.env.FLICKR_API_KEY, secret: process.env.FLICKR_API_SECRET, callbackUrl: callbackUrl('flickr') });
        flickrRequests.set(requested.token, requested.tokenSecret);
        response.writeHead(302, { location: flickrAuthorizeUrl(requested.token) }); response.end(); return;
      }
      if (route === 'GET /api/gmail/callback') {
        const code = oauthCode(url, gmailState, 'Gmail', 'Google');
        const tokens = await exchangeGmailCode({ code, clientId: process.env.GMAIL_CLIENT_ID, clientSecret: process.env.GMAIL_CLIENT_SECRET, redirectUri: callbackUrl('gmail') }); gmailState = null;
        await saveEnv({ GMAIL_REFRESH_TOKEN: tokens.refresh_token }); oauthDone(response, 'Gmail'); return;
      }
      if (route === 'GET /api/strava/callback') {
        const code = oauthCode(url, stravaState, 'Strava', 'Strava');
        const tokens = await exchangeStravaCode(code, callbackUrl('strava')); stravaState = null;
        await saveEnv({ STRAVA_ACCESS_TOKEN: tokens.access_token, STRAVA_REFRESH_TOKEN: tokens.refresh_token, STRAVA_EXPIRES_AT: tokens.expires_at }); oauthDone(response, 'Strava'); return;
      }
      if (route === 'GET /api/flickr/callback') {
        const token = url.searchParams.get('oauth_token'), verifier = url.searchParams.get('oauth_verifier'), tokenSecret = flickrRequests.get(token);
        if (!token || !tokenSecret) throw httpError(400, 'Flickrの認証要求が見つかりません。もう一度「Flickrに接続」を押してください。');
        if (!verifier) throw httpError(400, 'Flickrへの接続がキャンセルされました。');
        flickrRequests.delete(token);
        await saveEnv(await exchangeFlickrToken({ key: process.env.FLICKR_API_KEY, secret: process.env.FLICKR_API_SECRET, token, tokenSecret, verifier })); oauthDone(response, 'Flickr'); return;
      }
      json(response, 404, { error: 'Not found' });
    } catch (error) { json(response, error.status ?? 500, { error: error.message }, FILE_PAGE_ROUTES.has(new URL(request.url, `http://${host}`).pathname) ? fileOrigin : {}); }
  });

  function pendingDelete(token, expiredMessage) {
    const pending = pendingDeletes.get(token);
    if (!pending || Date.now() - pending.createdAt > 30 * 60_000) throw httpError(410, expiredMessage);
    return pending;
  }
  return server;
}

function flickrStatus() { return { configured: Boolean(process.env.FLICKR_API_KEY && process.env.FLICKR_USER_ID), privateReady: Boolean(process.env.FLICKR_API_SECRET), connected: Boolean(process.env.FLICKR_OAUTH_TOKEN && process.env.FLICKR_OAUTH_TOKEN_SECRET) }; }

function validate(body) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.from) || !/^\d{4}-\d{2}-\d{2}$/.test(body.to)) throw httpError(400, '開始日と終了日を指定してください。');
  if (!Array.isArray(body.sources) || !body.sources.length) throw httpError(400, '取得元を1つ以上選んでください。');
  if (body.sources.some(source => !SOURCES.includes(source))) throw httpError(400, '不明な取得元です。');
  if (body.sources.includes('gmail') && !body.relatedKeywords?.length) throw httpError(400, 'Gmailを取得するには検索キーワードを入力してください。');
  if (body.relatedKeywords?.length && body.sources.some(source => ['bluesky', 'x', 'gmail'].includes(source))) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.relatedFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(body.relatedTo)) throw httpError(400, '関連資料の検索期間を指定してください。');
    if (body.relatedTo < body.relatedFrom) throw httpError(400, '関連資料の終了日は開始日以降にしてください。');
  }
}

async function exchangeStravaCode(code, redirectUri) {
  const response = await fetch('https://www.strava.com/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: process.env.STRAVA_CLIENT_ID, client_secret: process.env.STRAVA_CLIENT_SECRET, code, grant_type: 'authorization_code', redirect_uri: redirectUri }), signal: AbortSignal.timeout(30_000) });
  const data = await response.json(); if (!response.ok) throw new Error(`Strava OAuthに失敗しました (${response.status})。`); return data;
}

function runCollect(body, onProgress) {
  const args = ['--env-file-if-exists=.env', 'src/cli.js', 'collect', '--from', body.from, '--to', body.to, '--sources', body.sources.join(','), '--title', body.title || `${body.from}〜${body.to} 行事記録`];
  if (body.relatedKeywords?.length) args.push('--related-from', body.relatedFrom, '--related-to', body.relatedTo, '--related-keywords', JSON.stringify(body.relatedKeywords));
  if (body.output) args.push('--output', body.output);
  return new Promise((resolve, reject) => {
    const childEnv = { ...process.env, MY_TIMELINE_PROGRESS: '1' };
    delete childEnv.STRAVA_ACCESS_TOKEN; delete childEnv.STRAVA_REFRESH_TOKEN; delete childEnv.STRAVA_EXPIRES_AT;
    const child = spawn(process.execPath, args, { cwd: projectRoot, env: childEnv }); let stdout = '', stderr = '', pending = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => {
      pending += chunk;
      const lines = pending.split(/\r?\n/); pending = lines.pop();
      for (const line of lines) {
        if (line.startsWith('MY_TIMELINE_PROGRESS ')) { try { onProgress(JSON.parse(line.slice(21))); } catch {} }
        else stderr += `${line}\n`;
      }
    }); child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) return reject(new Error(stderr.replace(/^Error:\s*/m, '').trim() || '収集に失敗しました。'));
      const root = stdout.trim().split(/\r?\n/).at(-1); root ? resolve(root) : reject(new Error('結果フォルダを取得できませんでした。'));
    });
  });
}

function oauthCode(url, expectedState, name, provider) {
  if (!expectedState || url.searchParams.get('state') !== expectedState) throw httpError(400, `${name} OAuthのstateが一致しません。`);
  if (url.searchParams.get('error')) throw httpError(400, `${name}への接続がキャンセルされました。`);
  const code = url.searchParams.get('code'); if (!code) throw httpError(400, `${provider}から認証コードが返されませんでした。`);
  return code;
}
function oauthDone(response, name) { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(`<!doctype html><html lang="ja"><meta charset="utf-8"><title>${name}接続完了</title><body><h1>${name}に接続しました</h1><p>この画面を閉じてMy Timelineへ戻ってください。</p></body></html>`); }
function redirect(response, base, params) { const target = new URL(base); target.search = new URLSearchParams(params); response.writeHead(302, { location: target.toString() }); response.end(); }
function open(target) { return new Promise((resolve, reject) => { const child = spawn('open', [target], { stdio: 'ignore' }); child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error(`${target} を開けませんでした。`))); }); }
async function readBody(request, limit) { let raw = ''; for await (const chunk of request) { raw += chunk; if (raw.length > limit) throw httpError(413, '入力が大きすぎます。'); } return raw; }
async function readJson(request, limit = 16_384) { return parseJson((await readBody(request, limit)) || '{}'); }
async function readForm(request, limit = 16_384) { return Object.fromEntries(new URLSearchParams(await readBody(request, limit))); }
function parseJson(text) { try { return JSON.parse(text); } catch { throw httpError(400, '入力を読み取れませんでした。'); } }
async function workspaceRoot(value) {
  const text = String(value ?? '').trim();
  if (!text || !isAbsolute(text)) throw httpError(400, 'ワークスペースのパスが不正です。');
  const root = resolve(text);
  try { await access(join(root, 'manifest.json')); } catch { throw httpError(400, 'My Timelineのワークスペースが見つかりません。'); }
  return root;
}
function json(response, status, value, headers = {}) { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }); response.end(JSON.stringify(value)); }

if (process.argv[1] && await realpath(process.argv[1]).catch(() => '') === fileURLToPath(import.meta.url)) {
  const server = createAppServer();
  server.listen(Number(process.env.MY_TIMELINE_PORT ?? 4177), host, () => {
    const url = `http://${host}:${server.address().port}`;
    console.log(`My Timeline: ${url}`); open(url).catch(() => {});
    refreshOutdatedTimelines().then(roots => { if (roots.length) console.log(`タイムラインを最新の表示に更新しました: ${roots.length}件`); }).catch(() => {});
  });
}
