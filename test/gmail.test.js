import test from 'node:test';
import assert from 'node:assert/strict';
import { gmailQuery } from '../src/collectors/gmail.js';

test('searches Gmail by keywords without applying timeline dates', () => {
  assert.equal(gmailQuery(undefined, undefined, ['ALPI4000', 'Bormio']), '{"ALPI4000" "Bormio"}');
});

test('keeps date constraints available for explicit bounded Gmail searches', () => {
  assert.match(gmailQuery('2026-06-01', '2026-06-02', ['hotel']), /^after:2026\/06\/01 before:2026\/06\/03/);
});
