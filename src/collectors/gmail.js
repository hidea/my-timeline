function tokenEndpoint() { return 'https://oauth2.googleapis.com/token'; }

export async function collectGmail({ fromText, toText, limit, keywords = [], clientId, clientSecret, refreshToken }) {
  if (!clientId || !clientSecret || !refreshToken) throw new Error('Gmailに接続してください。');
  const accessToken = await refreshAccessToken({ clientId, clientSecret, refreshToken });
  const query = gmailQuery(fromText, toText, keywords);
  const ids = await listMessages(accessToken, query, limit);
  return mapLimit(ids, 5, id => getMessage(accessToken, id));
}

export async function exchangeGmailCode({ code, clientId, clientSecret, redirectUri }) {
  const response = await fetch(tokenEndpoint(), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }), signal: AbortSignal.timeout(30_000) });
  const data = await response.json();
  if (!response.ok || !data.refresh_token) throw new Error(`Gmail OAuthに失敗しました (${response.status})。再接続時は同意画面で許可してください。`);
  return data;
}

async function refreshAccessToken({ clientId, clientSecret, refreshToken }) {
  const response = await fetch(tokenEndpoint(), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }), signal: AbortSignal.timeout(30_000) });
  const data = await response.json(); if (!response.ok) throw new Error(`Gmailトークンの更新に失敗しました (${response.status})。`); return data.access_token;
}

async function listMessages(token, query, limit) {
  const ids = []; let pageToken;
  do {
    const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
    url.search = new URLSearchParams({ q: query, maxResults: String(Math.min(500, limit - ids.length)), ...(pageToken ? { pageToken } : {}) });
    const response = await gmailFetch(url, token), data = await response.json();
    ids.push(...(data.messages ?? []).map(message => message.id)); pageToken = data.nextPageToken;
  } while (pageToken && ids.length < limit);
  return ids.slice(0, limit);
}

async function getMessage(token, id) {
  const response = await gmailFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, token), message = await response.json();
  const headers = Object.fromEntries((message.payload?.headers ?? []).map(header => [header.name.toLowerCase(), decodeHeader(header.value)]));
  const body = extractText(message.payload).trim();
  return { source: 'gmail', sourceId: id, occurredAt: new Date(Number(message.internalDate)).toISOString(), author: headers.from, text: [`件名: ${headers.subject ?? '(件名なし)'}`, `差出人: ${headers.from ?? ''}`, headers.to ? `宛先: ${headers.to}` : '', '', body || message.snippet || ''].filter(value => value !== '').join('\n'), originalUrl: `https://mail.google.com/mail/u/0/#all/${id}`, media: [], raw: { threadId: message.threadId, labelIds: message.labelIds } };
}

async function gmailFetch(url, token) {
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Gmail APIの取得に失敗しました (${response.status})。`); return response;
}

function gmailQuery(from, to, keywords) {
  const next = new Date(`${to}T00:00:00+09:00`); next.setDate(next.getDate() + 1);
  const end = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(next).replaceAll('-', '/');
  const terms = keywords.map(keyword => `"${String(keyword).replaceAll('"', '')}"`).join(' ');
  return `after:${from.replaceAll('-', '/')} before:${end}${terms ? ` {${terms}}` : ''}`;
}
function extractText(part) {
  if (!part) return '';
  if (part.mimeType === 'text/plain' && part.body?.data) return decodeBase64Url(part.body.data);
  if (part.mimeType === 'text/html' && part.body?.data) return stripHtml(decodeBase64Url(part.body.data));
  const values = (part.parts ?? []).map(extractText).filter(Boolean);
  return values.find((_, index) => part.parts?.[index]?.mimeType === 'text/plain') ?? values.join('\n');
}
function decodeBase64Url(value) { return Buffer.from(value.replaceAll('-', '+').replaceAll('_', '/'), 'base64').toString('utf8'); }
function stripHtml(value) { return value.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, '').replace(/<br\s*\/?>|<\/p>|<\/div>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"'); }
function decodeHeader(value = '') { return value.replace(/=\?UTF-8\?([BQ])\?([^?]+)\?=/gi, (_, kind, encoded) => kind.toUpperCase() === 'B' ? Buffer.from(encoded, 'base64').toString('utf8') : Buffer.from(encoded.replaceAll('_', ' ').replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16))), 'binary').toString('utf8')); }
async function mapLimit(items, concurrency, work) {
  const results = new Array(items.length); let cursor = 0;
  async function worker() { while (cursor < items.length) { const index = cursor++; results[index] = await work(items[index]); } }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker)); return results;
}
