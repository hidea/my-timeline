import { updateEnv } from '../lib/env-file.js';

const apiBase = process.env.STRAVA_API_BASE_URL ?? 'https://www.strava.com/api/v3';

export async function collectStrava({ from, to, clientId, clientSecret, refreshToken, accessToken, expiresAt, envFile = '.env' }) {
  if (!clientId || !clientSecret || !refreshToken) throw new Error('Stravaが未接続です。画面の「Strava設定」から接続してください。');
  const token = await validToken({ clientId, clientSecret, refreshToken, accessToken, expiresAt, envFile });
  const params = new URLSearchParams({ after: String(Math.floor(from.getTime() / 1000)), before: String(Math.ceil(to.getTime() / 1000)), per_page: '200', page: '1' });
  const response = await fetch(`${apiBase}/athlete/activities?${params}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Stravaの取得に失敗しました (${response.status})。`);
  const activities = await response.json();
  const routes = await mapLimit(activities, 3, activity => fetchRoute(activity, token));
  return activities.flatMap((activity, index) => activityEvents(activity, routes[index]));
}

async function fetchRoute(activity, token) {
  const params = new URLSearchParams({ keys: 'time,distance,latlng', key_by_type: 'true' });
  const response = await fetch(`${apiBase}/activities/${activity.id}/streams?${params}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Stravaルートの取得に失敗しました (${response.status})。`);
  const body = await response.json(), streams = Array.isArray(body) ? Object.fromEntries(body.map(stream => [stream.type, stream])) : body;
  const times = streams.time?.data ?? [], distances = streams.distance?.data ?? [], coordinates = streams.latlng?.data ?? [], length = Math.min(times.length, distances.length, coordinates.length);
  return Array.from({ length }, (_, i) => ({ seconds: Number(times[i]), distanceMeters: Number(distances[i]), latitude: Number(coordinates[i][0]), longitude: Number(coordinates[i][1]) })).filter(point => Object.values(point).every(Number.isFinite));
}

function activityEvents(activity, points) {
  const start = new Date(activity.start_date), endSeconds = points.at(-1)?.seconds ?? Number(activity.elapsed_time ?? 0), end = new Date(start.getTime() + endSeconds * 1000), url = `https://www.strava.com/activities/${activity.id}`;
  const route = { activityId: String(activity.id), activityName: activity.name ?? 'Stravaアクティビティ', startMs: start.getTime(), endMs: end.getTime(), points };
  const startPoint = points[0], endPoint = points.at(-1), summary = activityText(activity), routeGeometry = geometryFor(points);
  return [
    { source: 'strava', sourceId: `${activity.id}:start`, occurredAt: start.toISOString(), text: `▶ スタート\n${summary}`, originalUrl: url, location: pointLocation(startPoint, activity.start_latlng), routeGeometry, media: [], _stravaRoute: route, raw: activity },
    { source: 'strava', sourceId: `${activity.id}:end`, occurredAt: end.toISOString(), text: `■ ゴール\n${summary}`, originalUrl: url, location: pointLocation(endPoint, activity.end_latlng), routeGeometry, media: [], raw: activity },
  ];
}

function geometryFor(points) { const step = Math.max(1, Math.ceil(points.length / 500)), sampled = points.filter((_, index) => index % step === 0); if (points.length && sampled.at(-1) !== points.at(-1)) sampled.push(points.at(-1)); return { coordinates: sampled.map(point => [point.latitude, point.longitude]), points: sampled, totalDistanceMeters: points.at(-1)?.distanceMeters ?? 0 }; }

function pointLocation(point, fallback) { if (point) return { latitude: point.latitude, longitude: point.longitude }; return Array.isArray(fallback) && fallback.length === 2 ? { latitude: fallback[0], longitude: fallback[1] } : null; }

export function enrichStravaPositions(events) {
  const routes = events.map(event => event._stravaRoute ?? storedRoute(event)).filter(Boolean);
  for (const event of events) {
    const timestamp = new Date(event.occurredAt).getTime(), route = routes.find(candidate => timestamp >= candidate.startMs && timestamp <= candidate.endMs);
    if (route?.points.length) {
      const point = nearestPoint(route.points, (timestamp - route.startMs) / 1000);
      event.routeProgress = { activityId: route.activityId, activityName: route.activityName, distanceMeters: point.distanceMeters };
      if (!event.location) { event.location = { latitude: point.latitude, longitude: point.longitude }; event.locationInferredFromStrava = true; }
    }
    delete event._stravaRoute;
  }
  return events;
}

function storedRoute(event) {
  const points = event.routeGeometry?.points;
  if (event.source !== 'strava' || !String(event.sourceId).endsWith(':start') || !points?.length) return null;
  const startMs = new Date(event.occurredAt).getTime();
  return { activityId: String(event.sourceId).replace(/:start$/, ''), activityName: String(event.text ?? '').split('\n')[1] || 'Stravaアクティビティ', startMs, endMs: startMs + Number(points.at(-1).seconds) * 1000, points };
}

function nearestPoint(points, seconds) {
  let low = 0, high = points.length - 1;
  while (low < high) { const mid = Math.floor((low + high) / 2); points[mid].seconds < seconds ? low = mid + 1 : high = mid; }
  if (low > 0 && Math.abs(points[low - 1].seconds - seconds) <= Math.abs(points[low].seconds - seconds)) return points[low - 1];
  return points[low];
}

async function mapLimit(items, concurrency, work) { const results = new Array(items.length); let cursor = 0; async function worker() { while (cursor < items.length) { const index = cursor++; results[index] = await work(items[index], index); } } await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker)); return results; }

async function validToken({ clientId, clientSecret, refreshToken, accessToken, expiresAt, envFile }) {
  if (accessToken && Number(expiresAt) > Date.now() / 1000 + 3600) return accessToken;
  const response = await fetch('https://www.strava.com/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token', refresh_token: refreshToken }), signal: AbortSignal.timeout(30_000) });
  const data = await response.json(); if (!response.ok) throw new Error(`Stravaトークンの更新に失敗しました (${response.status})。`);
  await updateEnv(envFile, { STRAVA_ACCESS_TOKEN: data.access_token, STRAVA_REFRESH_TOKEN: data.refresh_token, STRAVA_EXPIRES_AT: data.expires_at });
  return data.access_token;
}

function activityText(a) {
  const details = [a.sport_type ?? a.type, a.distance != null ? `距離 ${formatDistance(a.distance)}` : '', a.moving_time != null ? `移動 ${formatDuration(a.moving_time)}` : '', a.elapsed_time != null ? `経過 ${formatDuration(a.elapsed_time)}` : '', a.total_elevation_gain != null ? `獲得標高 ${Math.round(a.total_elevation_gain).toLocaleString('ja-JP')} m` : ''].filter(Boolean);
  return [`${a.name ?? 'Stravaアクティビティ'}`, details.join(' · ')].join('\n');
}
export function formatDistance(meters) { return `${(Number(meters) / 1000).toLocaleString('ja-JP', { maximumFractionDigits: 1 })} km`; }
export function formatDuration(seconds) { const value = Number(seconds); const h = Math.floor(value / 3600), m = Math.floor(value % 3600 / 60); return h ? `${h}時間${m}分` : `${m}分`; }
