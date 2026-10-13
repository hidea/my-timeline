import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDate, safePart, sourceSummary, validateRange } from '../src/lib/utils.js';
test('validates short writing ranges', () => { assert.doesNotThrow(() => validateRange(parseDate('2025-08-01'), parseDate('2025-08-14', true))); assert.throws(() => validateRange(parseDate('2025-01-01'), parseDate('2025-03-01', true)), /31 days/); });
test('makes Finder-safe name parts', () => assert.equal(safePart('at://did:plc/a b'), 'at-did-plc-a-b'));

test('splits Flickr OAuth into authorize URL and signed token steps', async () => {
  const { flickrAuthorizeUrl, oauthParams, signOAuth } = await import('../src/lib/flickr-oauth.js');
  assert.equal(flickrAuthorizeUrl('tok en'), 'https://www.flickr.com/services/oauth/authorize?oauth_token=tok%20en&perms=read');
  const params = { ...oauthParams('key', 'token'), oauth_verifier: 'v' };
  assert.equal(params.oauth_token, 'token'); assert.equal(signOAuth('GET', 'https://example.com', params, 'secret', 'ts'), signOAuth('GET', 'https://example.com', { ...params }, 'secret', 'ts'));
});
test('counts every selected source including ones with no results', () => assert.deepEqual(sourceSummary(['gmail', 'flickr'], [{ source: 'flickr' }, { source: 'flickr', related: true }, { source: 'x' }]), [{ source: 'gmail', total: 0, related: 0 }, { source: 'flickr', total: 2, related: 1 }]));
