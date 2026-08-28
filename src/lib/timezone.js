import tzlookup from 'tz-lookup';

export function timeZoneAt(location) {
  const latitude = Number(location?.latitude), longitude = Number(location?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return 'Asia/Tokyo';
  try { return tzlookup(latitude, longitude); } catch { return 'Asia/Tokyo'; }
}

export function localDateTimeToIso(value, timeZone) {
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!match) return new Date(value).toISOString();
  const [, year, month, day, hour, minute, second] = match, wallTime = Date.UTC(+year, +month - 1, +day, +hour, +minute, +second);
  let instant = wallTime;
  for (let i = 0; i < 2; i++) instant = wallTime - offsetAt(instant, timeZone);
  return new Date(instant).toISOString();
}

export function offsetDateTimeToIso(value, offset) {
  const normalized = normalizedOffset(offset);
  if (!normalized) return null;
  return new Date(`${String(value).replace(' ', 'T').replace(/(?:Z|[+-]\d\d:?\d\d)$/, '')}${normalized}`).toISOString();
}

export function normalizedOffset(value) {
  const match = String(value ?? '').trim().match(/^([+-])(\d{2}):?(\d{2})$/);
  if (!match || +match[2] > 23 || +match[3] > 59) return null;
  return `${match[1]}${match[2]}:${match[3]}`;
}

function offsetAt(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(new Date(instant));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return Date.UTC(+values.year, +values.month - 1, +values.day, +values.hour, +values.minute, +values.second) - instant;
}
