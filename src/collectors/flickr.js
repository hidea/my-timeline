import { signedUrl } from '../lib/flickr-oauth.js';

export async function collectFlickr({ fromText, toText, limit, apiKey, apiSecret, oauthToken, oauthTokenSecret, userId }) {
  if (!apiKey || !userId) throw new Error('FLICKR_API_KEY and FLICKR_USER_ID are required for the Flickr source.');
  const params = new URLSearchParams({ method: 'flickr.people.getPhotos', api_key: apiKey, user_id: userId, min_taken_date: `${fromText} 00:00:00`, max_taken_date: `${toText} 23:59:59`, extras: 'date_taken,date_upload,description,tags,geo,url_o,url_l,url_c,url_m,media', per_page: String(Math.min(limit, 500)), page: '1', format: 'json', nojsoncallback: '1' });
  const restUrl = 'https://www.flickr.com/services/rest/';
  const requestUrl = oauthToken && apiSecret && oauthTokenSecret
    ? signedUrl(restUrl, Object.fromEntries(params), { key: apiKey, secret: apiSecret, token: oauthToken, tokenSecret: oauthTokenSecret })
    : `${restUrl}?${params}`;
  const response = await fetch(requestUrl); if (!response.ok) throw new Error(`Flickr request failed: ${response.status}`);
  const data = await response.json(); if (data.stat !== 'ok') throw new Error(`Flickr: ${data.message ?? 'unknown error'}`);
  return (data.photos?.photo ?? []).map(photo => ({ source: 'flickr', sourceId: String(photo.id), occurredAt: `${photo.datetaken.replace(' ', 'T')}+09:00`, text: [photo.title, photo.description?._content].filter(Boolean).join('\n\n'), originalUrl: `https://www.flickr.com/photos/${photo.owner}/${photo.id}`, tags: String(photo.tags ?? '').split(' ').filter(Boolean), location: photo.latitude && photo.longitude ? { latitude: photo.latitude, longitude: photo.longitude } : null, media: [{ url: photo.url_o }].filter(x => x.url), raw: photo }));
}
