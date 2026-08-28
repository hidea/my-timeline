import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichStravaPositions, formatDistance, formatDuration } from '../src/collectors/strava.js';

test('formats Strava activity metrics', () => {
  assert.equal(formatDistance(12345), '12.3 km');
  assert.equal(formatDuration(5430), '1時間30分');
  assert.equal(formatDuration(1500), '25分');
});

test('places timeline events along a Strava route by elapsed clock time', () => {
  const start = { source: 'strava', sourceId: '1:start', occurredAt: '2026-05-02T00:00:00Z', location: { latitude: 35, longitude: 139 }, _stravaRoute: { activityId: '1', activityName: 'Ride', startMs: Date.parse('2026-05-02T00:00:00Z'), endMs: Date.parse('2026-05-02T00:20:00Z'), points: [
    { seconds: 0, distanceMeters: 0, latitude: 35, longitude: 139 },
    { seconds: 600, distanceMeters: 5000, latitude: 35.1, longitude: 139.1 },
    { seconds: 1200, distanceMeters: 10000, latitude: 35.2, longitude: 139.2 },
  ] } };
  const post = { source: 'bluesky', sourceId: 'post', occurredAt: '2026-05-02T00:09:00Z', location: null };
  const photo = { source: 'flickr', sourceId: 'photo', occurredAt: '2026-05-02T00:18:00Z', location: { latitude: 36, longitude: 140 } };
  enrichStravaPositions([start, post, photo]);
  assert.equal(post.routeProgress.distanceMeters, 5000);
  assert.deepEqual(post.location, { latitude: 35.1, longitude: 139.1 });
  assert.equal(post.locationInferredFromStrava, true);
  assert.equal(photo.routeProgress.distanceMeters, 10000);
  assert.deepEqual(photo.location, { latitude: 36, longitude: 140 });
  assert.equal(start._stravaRoute, undefined);
});

test('reuses persisted sampled Strava points when materials are added later', () => {
  const start = { source: 'strava', sourceId: '2:start', occurredAt: '2026-05-02T00:00:00Z', text: '▶ スタート\nStored Ride', routeGeometry: { points: [{ seconds: 0, distanceMeters: 0, latitude: 35, longitude: 139 }, { seconds: 600, distanceMeters: 5000, latitude: 35.1, longitude: 139.1 }] } };
  const photo = { source: 'flickr', sourceId: 'later-photo', occurredAt: '2026-05-02T00:06:00Z', location: { latitude: 35.05, longitude: 139.05 } };
  enrichStravaPositions([start, photo]);
  assert.equal(photo.routeProgress.distanceMeters, 5000); assert.equal(photo.routeProgress.activityName, 'Stored Ride');
});
