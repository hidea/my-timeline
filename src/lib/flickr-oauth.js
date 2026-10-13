import { createHmac, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { updateEnv } from './env-file.js';

const requestTokenUrl = 'https://www.flickr.com/services/oauth/request_token';
const accessTokenUrl = 'https://www.flickr.com/services/oauth/access_token';

const enc = value => encodeURIComponent(String(value)).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export function oauthParams(key, token) {
  return { oauth_consumer_key: key, oauth_nonce: randomBytes(16).toString('hex'), oauth_signature_method: 'HMAC-SHA1', oauth_timestamp: String(Math.floor(Date.now() / 1000)), ...(token ? { oauth_token: token } : {}), oauth_version: '1.0' };
}

export function signOAuth(method, url, params, consumerSecret, tokenSecret = '') {
  const normalized = Object.entries(params).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${enc(k)}=${enc(v)}`).join('&');
  const base = [method.toUpperCase(), enc(url), enc(normalized)].join('&');
  return createHmac('sha1', `${enc(consumerSecret)}&${enc(tokenSecret)}`).update(base).digest('base64');
}

export function signedUrl(url, query, { key, secret, token, tokenSecret }) {
  const params = { ...query, ...oauthParams(key, token) };
  params.oauth_signature = signOAuth('GET', url, params, secret, tokenSecret);
  return `${url}?${new URLSearchParams(params)}`;
}

export function flickrAuthorizeUrl(token) { return `https://www.flickr.com/services/oauth/authorize?oauth_token=${enc(token)}&perms=read`; }

export async function requestFlickrToken({ key, secret, callbackUrl }) {
  const params = { ...oauthParams(key), oauth_callback: callbackUrl };
  params.oauth_signature = signOAuth('GET', requestTokenUrl, params, secret);
  const data = await fetchForm(`${requestTokenUrl}?${new URLSearchParams(params)}`);
  const token = data.get('oauth_token'), tokenSecret = data.get('oauth_token_secret');
  if (!token || !tokenSecret) throw new Error('Flickr did not return a request token.');
  return { token, tokenSecret };
}

export async function exchangeFlickrToken({ key, secret, token, tokenSecret, verifier }) {
  const params = { ...oauthParams(key, token), oauth_verifier: verifier };
  params.oauth_signature = signOAuth('GET', accessTokenUrl, params, secret, tokenSecret);
  const data = await fetchForm(`${accessTokenUrl}?${new URLSearchParams(params)}`);
  const accessToken = data.get('oauth_token'), accessSecret = data.get('oauth_token_secret'), userId = data.get('user_nsid');
  if (!accessToken || !accessSecret) throw new Error('Flickr did not return an access token.');
  return { FLICKR_OAUTH_TOKEN: accessToken, FLICKR_OAUTH_TOKEN_SECRET: accessSecret, ...(userId ? { FLICKR_USER_ID: userId } : {}) };
}

export async function authorizeFlickr({ key, secret, envFile = '.env' }) {
  const callback = await createCallback();
  try {
    const request = await requestFlickrToken({ key, secret, callbackUrl: callback.url });
    spawn('open', [flickrAuthorizeUrl(request.token)], { detached: true, stdio: 'ignore' }).unref();
    const verifier = await callback.waitForVerifier;
    const updates = await exchangeFlickrToken({ key, secret, ...request, verifier });
    await updateEnv(envFile, updates);
    return { userId: updates.FLICKR_USER_ID };
  } finally { callback.close(); }
}

async function fetchForm(url) {
  const response = await fetch(url); const text = await response.text();
  if (!response.ok) throw new Error(`Flickr OAuth failed (${response.status}): ${text}`);
  return new URLSearchParams(text);
}

async function createCallback() {
  let resolveVerifier, rejectVerifier;
  const waitForVerifier = new Promise((resolve, reject) => { resolveVerifier = resolve; rejectVerifier = reject; });
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1'); const verifier = url.searchParams.get('oauth_verifier');
    response.writeHead(verifier ? 200 : 400, { 'content-type': 'text/plain; charset=utf-8' }); response.end(verifier ? 'Flickr authentication completed. You may close this window.' : 'Flickr authentication failed.');
    verifier ? resolveVerifier(verifier) : rejectVerifier(new Error('Flickr did not return an OAuth verifier.'));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { url: `http://127.0.0.1:${port}/callback`, waitForVerifier, close: () => server.close() };
}
