import test from 'node:test';
import assert from 'node:assert/strict';
import { keywordPattern } from '../src/collectors/bskylog.js';

test('builds a case-insensitive keyword pattern that ignores matches inside alphanumeric ids', () => {
  const pattern = new RegExp(keywordPattern('LRM'), 'u');
  for (const text of ['LRM502に参加', 'lrm', '#LRM502', '千葉LRM']) assert.match(text, pattern);
  assert.doesNotMatch('bafkreigy4fxaxcgyjbtcq54tsq6blkvhktdv4lrm3e3aydeb2gwcpjbmzq', pattern);
  assert.equal(keywordPattern('千葉1300'), '千葉1300');
  assert.match('a.b(c)', new RegExp(keywordPattern('a.b(c)'), 'u')); assert.doesNotMatch('axb(c)', new RegExp(keywordPattern('a.b(c)'), 'u'));
});
