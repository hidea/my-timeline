#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { relative, resolve } from 'node:path';
import { updateEnv } from './lib/env-file.js';
import { exchangeGmailCode } from './collectors/gmail.js';
import { addManualMaterial } from './manual-material.js';
import { appendSources } from './append-sources.js';
import { deleteTimelineEvent, eventInfo } from './delete-event.js';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const uiRoot = join(projectRoot, 'ui');
const host = '127.0.0.1';
const requestedPort = Number(process.env.MY_TIMELINE_PORT ?? 4177);
let job = null;
let stravaState = null;
let gmailState = null;
const mime = new Map([['/', ['index.html', 'text/html; charset=utf-8']], ['/app.js', ['app.js', 'text/javascript; charset=utf-8']], ['/add.js', ['add.js', 'text/javascript; charset=utf-8']], ['/delete.js', ['delete.js', 'text/javascript; charset=utf-8']], ['/style.css', ['style.css', 'text/css; charset=utf-8']]]);

const server = createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && mime.has(request.url)) {
      const [name, type] = mime.get(request.url);
      response.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
      response.end(await readFile(join(uiRoot, name))); return;
    }
    if (request.method === 'GET' && request.url.startsWith('/add?')) { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); response.end(await readFile(join(uiRoot, 'add.html'))); return; }
    if (request.method === 'GET' && request.url.startsWith('/delete?')) { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); response.end(await readFile(join(uiRoot, 'delete.html'))); return; }
    if (request.method === 'POST' && request.url === '/api/manual-material') {
      const body = await readJson(request, 100 * 1024 * 1024), root = resolve(String(body.root ?? '')), downloads = resolve(homedir(), 'Downloads'), pathFromDownloads = relative(downloads, root);
      if (!root || pathFromDownloads.startsWith('..') || pathFromDownloads.includes('../')) throw new Error('追加先が不正です。');
      const timeline = await addManualMaterial(root, body); await open(timeline); json(response, 200, { saved: true }); return;
    }
    if (request.method === 'GET' && request.url.startsWith('/api/workspace-info?')) {
      const root = workspaceRoot(new URL(request.url, `http://${host}`).searchParams.get('root')), manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')); json(response, 200, { title: manifest.title, from: manifest.from, to: manifest.to }); return;
    }
    if (request.method === 'GET' && request.url.startsWith('/api/event-info?')) { const url = new URL(request.url, `http://${host}`), root = workspaceRoot(url.searchParams.get('root')); json(response, 200, await eventInfo(root, url.searchParams.get('source'), url.searchParams.get('sourceId'))); return; }
    if (request.method === 'POST' && request.url === '/api/delete-event') { const body = await readJson(request), root = workspaceRoot(body.root), result = await deleteTimelineEvent(root, body.source, body.sourceId); await open(result.timeline); json(response, 200, { deleted: true }); return; }
    if (request.method === 'POST' && request.url === '/api/append-sources') {
      const body = await readJson(request), root = workspaceRoot(body.root), manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
      if (!Array.isArray(body.sources) || !body.sources.length || body.sources.some(source => !['bluesky', 'x', 'flickr', 'strava', 'gmail'].includes(source))) throw new Error('追加する取得元を選んでください。');
      const result = await appendSources(root, manifest, body); await open(result.timeline); json(response, 200, result); return;
    }
    if (request.method === 'POST' && request.url === '/api/collect') {
      if (job?.status === 'running') return json(response, 409, { error: '現在、収集中です。', job });
      const body = await readJson(request); validate(body);
      job = { id: crypto.randomUUID(), status: 'running', message: '収集を開始します', startedAt: new Date().toISOString() };
      runCollect(body, update => { job = { ...job, ...update }; }).then(async root => {
        await Promise.allSettled([open(join(root, 'timeline.html')), open(root)]);
        job = { ...job, status: 'repairing', message: 'タイムラインは閲覧できます。取得できなかった原寸画像を補完しています', root };
        await runMediaRepair(root, update => { job = { ...job, ...update, message: `タイムラインは閲覧できます。原寸画像を補完しています (${update.done}/${update.total}、成功 ${update.repaired})` }; });
        job = { ...job, status: 'complete', message: '完了しました', root, finishedAt: new Date().toISOString() };
      }).catch(error => { job = { ...job, status: 'error', message: error.message, finishedAt: new Date().toISOString() }; });
      json(response, 202, job);
      return;
    }
    if (request.method === 'GET' && request.url === '/api/status') { json(response, 200, job ?? { status: 'idle' }); return; }
    if (request.method === 'GET' && request.url === '/api/strava/status') { json(response, 200, { configured: Boolean(process.env.STRAVA_CLIENT_ID && process.env.STRAVA_CLIENT_SECRET), connected: Boolean(process.env.STRAVA_REFRESH_TOKEN) }); return; }
    if (request.method === 'GET' && request.url === '/api/gmail/status') { json(response, 200, { configured: Boolean(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET), connected: Boolean(process.env.GMAIL_REFRESH_TOKEN) }); return; }
    if (request.method === 'POST' && request.url === '/api/gmail/config') {
      const body = await readJson(request);
      if (!String(body.clientId ?? '').trim() || !String(body.clientSecret ?? '').trim()) throw new Error('GmailのClient IDとClient Secretを入力してください。');
      const updates = { GMAIL_CLIENT_ID: body.clientId.trim(), GMAIL_CLIENT_SECRET: body.clientSecret.trim() }; Object.assign(process.env, updates); await updateEnv(join(projectRoot, '.env'), updates);
      json(response, 200, { configured: true, connected: Boolean(process.env.GMAIL_REFRESH_TOKEN) }); return;
    }
    if (request.method === 'GET' && request.url === '/api/gmail/connect') {
      if (!process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_CLIENT_SECRET) throw new Error('先にGmailのClient IDとClient Secretを保存してください。');
      gmailState = randomBytes(24).toString('hex'); const redirectUri = `http://${host}:${server.address().port}/api/gmail/callback`;
      const authorize = new URL('https://accounts.google.com/o/oauth2/v2/auth'); authorize.search = new URLSearchParams({ client_id: process.env.GMAIL_CLIENT_ID, redirect_uri: redirectUri, response_type: 'code', access_type: 'offline', prompt: 'consent', scope: 'https://www.googleapis.com/auth/gmail.readonly', state: gmailState });
      response.writeHead(302, { location: authorize.toString() }); response.end(); return;
    }
    if (request.method === 'GET' && request.url.startsWith('/api/gmail/callback')) {
      const callback = new URL(request.url, `http://${host}`);
      if (!gmailState || callback.searchParams.get('state') !== gmailState) throw new Error('Gmail OAuthのstateが一致しません。');
      if (callback.searchParams.get('error')) throw new Error('Gmailへの接続がキャンセルされました。');
      const code = callback.searchParams.get('code'); if (!code) throw new Error('Googleから認証コードが返されませんでした。');
      const tokens = await exchangeGmailCode({ code, clientId: process.env.GMAIL_CLIENT_ID, clientSecret: process.env.GMAIL_CLIENT_SECRET, redirectUri: `http://${host}:${server.address().port}/api/gmail/callback` }); gmailState = null;
      process.env.GMAIL_REFRESH_TOKEN = tokens.refresh_token; await updateEnv(join(projectRoot, '.env'), { GMAIL_REFRESH_TOKEN: tokens.refresh_token });
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end('<!doctype html><html lang="ja"><meta charset="utf-8"><title>Gmail接続完了</title><body><h1>Gmailに接続しました</h1><p>この画面を閉じてMy Timelineへ戻ってください。</p></body></html>'); return;
    }
    if (request.method === 'POST' && request.url === '/api/strava/config') {
      const body = await readJson(request);
      if (!/^\d+$/.test(body.clientId ?? '') || !String(body.clientSecret ?? '').trim()) throw new Error('StravaのClient IDとClient Secretを入力してください。');
      const updates = { STRAVA_CLIENT_ID: body.clientId, STRAVA_CLIENT_SECRET: body.clientSecret.trim(), ...(String(body.accessToken ?? '').trim() ? { STRAVA_ACCESS_TOKEN: body.accessToken.trim() } : {}), ...(String(body.refreshToken ?? '').trim() ? { STRAVA_REFRESH_TOKEN: body.refreshToken.trim(), STRAVA_EXPIRES_AT: '0' } : {}) };
      Object.assign(process.env, updates);
      await updateEnv(join(projectRoot, '.env'), updates);
      json(response, 200, { configured: true, connected: Boolean(process.env.STRAVA_REFRESH_TOKEN) }); return;
    }
    if (request.method === 'GET' && request.url === '/api/strava/connect') {
      if (!process.env.STRAVA_CLIENT_ID || !process.env.STRAVA_CLIENT_SECRET) throw new Error('先にClient IDとClient Secretを保存してください。');
      stravaState = randomBytes(24).toString('hex');
      const redirectUri = `http://${host}:${server.address().port}/api/strava/callback`;
      const authorize = new URL('https://www.strava.com/oauth/authorize');
      authorize.search = new URLSearchParams({ client_id: process.env.STRAVA_CLIENT_ID, redirect_uri: redirectUri, response_type: 'code', approval_prompt: 'auto', scope: 'read,activity:read_all', state: stravaState });
      response.writeHead(302, { location: authorize.toString() }); response.end(); return;
    }
    if (request.method === 'GET' && request.url.startsWith('/api/strava/callback')) {
      const callback = new URL(request.url, `http://${host}`);
      if (!stravaState || callback.searchParams.get('state') !== stravaState) throw new Error('Strava OAuthのstateが一致しません。');
      if (callback.searchParams.get('error')) throw new Error('Stravaへの接続がキャンセルされました。');
      const code = callback.searchParams.get('code'); if (!code) throw new Error('Stravaから認証コードが返されませんでした。');
      const tokens = await exchangeStravaCode(code, `http://${host}:${server.address().port}/api/strava/callback`); stravaState = null;
      Object.assign(process.env, { STRAVA_ACCESS_TOKEN: tokens.access_token, STRAVA_REFRESH_TOKEN: tokens.refresh_token, STRAVA_EXPIRES_AT: String(tokens.expires_at) });
      await updateEnv(join(projectRoot, '.env'), { STRAVA_ACCESS_TOKEN: tokens.access_token, STRAVA_REFRESH_TOKEN: tokens.refresh_token, STRAVA_EXPIRES_AT: tokens.expires_at });
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end('<!doctype html><html lang="ja"><meta charset="utf-8"><title>Strava接続完了</title><body><h1>Stravaに接続しました</h1><p>この画面を閉じてMy Timelineへ戻ってください。</p></body></html>'); return;
    }
    json(response, 404, { error: 'Not found' });
  } catch (error) { json(response, 500, { error: error.message }); }
});

server.listen(requestedPort, host, () => {
  const url = `http://${host}:${server.address().port}`;
  console.log(`My Timeline: ${url}`); open(url).catch(() => {});
});

function validate(body) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.from) || !/^\d{4}-\d{2}-\d{2}$/.test(body.to)) throw new Error('開始日と終了日を指定してください。');
  if (!Array.isArray(body.sources) || !body.sources.length) throw new Error('取得元を1つ以上選んでください。');
  if (body.sources.some(source => !['bluesky', 'x', 'flickr', 'strava', 'gmail'].includes(source))) throw new Error('不明な取得元です。');
  if (body.relatedKeywords?.length) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.relatedFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(body.relatedTo)) throw new Error('関連資料の検索期間を指定してください。');
    if (body.relatedTo < body.relatedFrom) throw new Error('関連資料の終了日は開始日以降にしてください。');
  }
}

function runMediaRepair(root, onProgress) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['--env-file-if-exists=.env', 'src/repair-media.js', root], { cwd: projectRoot, env: process.env }); let pending = '';
    child.stdout.on('data', chunk => { pending += chunk; const lines = pending.split(/\r?\n/); pending = lines.pop(); for (const line of lines) try { onProgress(JSON.parse(line)); } catch {} });
    child.on('error', () => resolve()); child.on('close', () => resolve());
  });
}

async function exchangeStravaCode(code, redirectUri) {
  const response = await fetch('https://www.strava.com/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: process.env.STRAVA_CLIENT_ID, client_secret: process.env.STRAVA_CLIENT_SECRET, code, grant_type: 'authorization_code', redirect_uri: redirectUri }), signal: AbortSignal.timeout(30_000) });
  const data = await response.json(); if (!response.ok) throw new Error(`Strava OAuthに失敗しました (${response.status})。`); return data;
}

function runCollect(body, onProgress) {
  const args = ['--env-file-if-exists=.env', 'src/cli.js', 'collect', '--from', body.from, '--to', body.to, '--sources', body.sources.join(','), '--title', body.title || `${body.from}〜${body.to} 旅行記`];
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

function open(target) { return new Promise((resolve, reject) => { const child = spawn('open', [target], { stdio: 'ignore' }); child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error(`${target} を開けませんでした。`))); }); }
async function readJson(request, limit = 16_384) { let raw = ''; for await (const chunk of request) { raw += chunk; if (raw.length > limit) throw new Error('入力が大きすぎます。'); } return JSON.parse(raw || '{}'); }
function workspaceRoot(value) { const root = resolve(String(value ?? '')), downloads = resolve(homedir(), 'Downloads'), pathFromDownloads = relative(downloads, root); if (!root || pathFromDownloads.startsWith('..') || pathFromDownloads.includes('../')) throw new Error('追加先が不正です。'); return root; }
function json(response, status, value) { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(JSON.stringify(value)); }
