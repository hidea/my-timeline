import { signedUrl } from '../lib/flickr-oauth.js';
import { localDateTimeToIso, normalizedOffset, offsetDateTimeToIso, timeZoneAt } from '../lib/timezone.js';

export async function collectFlickr({ fromText, toText, limit, apiKey, apiSecret, oauthToken, oauthTokenSecret, userId }) {
  if (!apiKey || !userId) throw new Error('FLICKR_API_KEY and FLICKR_USER_ID are required for the Flickr source.');
  const params = new URLSearchParams({ method: 'flickr.people.getPhotos', api_key: apiKey, user_id: userId, min_taken_date: `${fromText} 00:00:00`, max_taken_date: `${toText} 23:59:59`, extras: 'date_taken,date_upload,description,tags,geo,url_o,url_l,url_c,url_m,media', per_page: String(Math.min(limit, 500)), page: '1', format: 'json', nojsoncallback: '1' });
  const restUrl = 'https://www.flickr.com/services/rest/';
  const requestUrl = oauthToken && apiSecret && oauthTokenSecret
    ? signedUrl(restUrl, Object.fromEntries(params), { key: apiKey, secret: apiSecret, token: oauthToken, tokenSecret: oauthTokenSecret })
    : `${restUrl}?${params}`;
  const response = await fetch(requestUrl); if (!response.ok) throw new Error(`Flickr request failed: ${response.status}`);
  const data = await response.json(); if (data.stat !== 'ok') throw new Error(`Flickr: ${data.message ?? 'unknown error'}`);
  const events = await mapLimit(data.photos?.photo ?? [], 3, async photo => {
    const location = photo.latitude && photo.longitude ? { latitude: photo.latitude, longitude: photo.longitude } : null, flickrTakenTimeZone = location ? timeZoneAt(location) : null;
    const flickrTakenOffset = location ? null : await getFlickrExifOffset(photo, { apiKey, apiSecret, oauthToken, oauthTokenSecret, restUrl });
    const occurredAt = flickrTakenOffset ? offsetDateTimeToIso(photo.datetaken, flickrTakenOffset) : localDateTimeToIso(photo.datetaken, flickrTakenTimeZone ?? 'Asia/Tokyo');
    return { source: 'flickr', sourceId: String(photo.id), occurredAt, flickrTakenLocal: photo.datetaken.replace(' ', 'T'), flickrTakenTimeZone, flickrTakenOffset, flickrTimeAssumedJapan: !location && !flickrTakenOffset, text: [photo.title, photo.description?._content].filter(Boolean).join('\n\n'), originalUrl: `https://www.flickr.com/photos/${photo.owner}/${photo.id}`, tags: String(photo.tags ?? '').split(' ').filter(Boolean), location, media: flickrMedia(photo), raw: photo };
  });
  return inheritPreviousTimeZone(events);
}

export function flickrMedia(photo) {
  const previewUrl = photo.url_l ?? photo.url_c ?? photo.url_m;
  if (photo.url_o && previewUrl) return [{ url: photo.url_o, previewUrl, deferOriginal: true }];
  const url = photo.url_o ?? previewUrl; return url ? [{ url }] : [];
}

export function inheritPreviousTimeZone(events) {
  let previous = null;
  for (const event of [...events].sort((a, b) => String(a.flickrTakenLocal).localeCompare(String(b.flickrTakenLocal)))) {
    if (event.flickrTakenTimeZone) { previous = { type: 'zone', value: event.flickrTakenTimeZone, sourceId: event.sourceId }; continue; }
    if (event.flickrTakenOffset) { previous = { type: 'offset', value: event.flickrTakenOffset, sourceId: event.sourceId }; continue; }
    if (!previous || !event.flickrTimeAssumedJapan) continue;
    if (previous.type === 'zone') { event.flickrTakenTimeZone = previous.value; event.occurredAt = localDateTimeToIso(event.flickrTakenLocal, previous.value); }
    else { event.flickrTakenOffset = previous.value; event.occurredAt = offsetDateTimeToIso(event.flickrTakenLocal, previous.value); }
    event.flickrTimeInheritedFrom = previous.sourceId; event.flickrTimeAssumedJapan = false;
  }
  return events;
}

export async function getFlickrExifOffset(photo, credentials) {
  try {
    const params = { method: 'flickr.photos.getExif', api_key: credentials.apiKey, photo_id: String(photo.id), secret: photo.secret, format: 'json', nojsoncallback: '1' };
    const url = credentials.oauthToken && credentials.apiSecret && credentials.oauthTokenSecret ? signedUrl(credentials.restUrl, params, { key: credentials.apiKey, secret: credentials.apiSecret, token: credentials.oauthToken, tokenSecret: credentials.oauthTokenSecret }) : `${credentials.restUrl}?${new URLSearchParams(params)}`;
    const response = await fetch(url); if (!response.ok) return null;
    const data = await response.json(), tags = data.photo?.exif ?? [], tag = tags.find(item => item.tag === 'OffsetTimeOriginal') ?? tags.find(item => item.tag === 'OffsetTime');
    return normalizedOffset(tag?.raw?._content);
  } catch { return null; }
}

async function mapLimit(items, concurrency, work) { const results = new Array(items.length); let cursor = 0; async function worker() { while (cursor < items.length) { const index = cursor++; results[index] = await work(items[index], index); } } await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker)); return results; }
