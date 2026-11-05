import test from 'node:test';
import assert from 'node:assert/strict';
import { collectFlickr } from '../src/collectors/flickr.js';

test('collects Flickr photos from every result page', async t => {
  const realFetch = globalThis.fetch, requested = [];
  t.after(() => { globalThis.fetch = realFetch; });
  globalThis.fetch = async url => {
    const page = Number(new URL(url).searchParams.get('page')); requested.push(page);
    const photo = id => ({ id: String(id), owner: 'me', datetaken: `2026-06-${String(15 + id).padStart(2, '0')} 10:00:00`, title: `photo ${id}`, latitude: '45.6', longitude: '8.7', url_l: `https://live.staticflickr.com/${id}_l.jpg` });
    return { ok: true, json: async () => ({ stat: 'ok', photos: { page, pages: 3, perpage: 500, photo: [photo(page)] } }) };
  };
  const events = await collectFlickr({ fromText: '2026-06-15', toText: '2026-06-29', apiKey: 'key', userId: 'me' });
  assert.deepEqual(requested, [1, 2, 3]);
  assert.deepEqual(events.map(event => event.sourceId).sort(), ['1', '2', '3']);
});
