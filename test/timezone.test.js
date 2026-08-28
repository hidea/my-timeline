import test from 'node:test';
import assert from 'node:assert/strict';
import { localDateTimeToIso, normalizedOffset, offsetDateTimeToIso, timeZoneAt } from '../src/lib/timezone.js';
import { inheritPreviousTimeZone } from '../src/collectors/flickr.js';

test('interprets a Flickr taken date as local time at its GPS location', () => {
  const zone = timeZoneAt({ latitude: 46.18113, longitude: 10.1146 });
  assert.equal(zone, 'Europe/Rome');
  assert.equal(localDateTimeToIso('2026-06-17 13:47:47', zone), '2026-06-17T11:47:47.000Z');
});

test('uses an EXIF offset when a Flickr photo has no GPS', () => {
  assert.equal(normalizedOffset('+0200'), '+02:00');
  assert.equal(offsetDateTimeToIso('2026-06-17 13:03:23', '+02:00'), '2026-06-17T11:03:23.000Z');
});

test('inherits the preceding Flickr timezone when GPS and EXIF offset are absent', () => {
  const events = [{ sourceId: 'known', flickrTakenLocal: '2026-06-17T13:00:00', flickrTakenOffset: '+02:00', occurredAt: '2026-06-17T11:00:00.000Z' }, { sourceId: 'unknown', flickrTakenLocal: '2026-06-17T13:05:00', flickrTimeAssumedJapan: true, occurredAt: '2026-06-17T04:05:00.000Z' }];
  inheritPreviousTimeZone(events);
  assert.equal(events[1].occurredAt, '2026-06-17T11:05:00.000Z'); assert.equal(events[1].flickrTakenOffset, '+02:00'); assert.equal(events[1].flickrTimeInheritedFrom, 'known');
});
