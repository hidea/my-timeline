import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDate, safePart, validateRange } from '../src/lib/utils.js';
test('validates short writing ranges', () => { assert.doesNotThrow(() => validateRange(parseDate('2025-08-01'), parseDate('2025-08-14', true))); assert.throws(() => validateRange(parseDate('2025-01-01'), parseDate('2025-03-01', true)), /31 days/); });
test('makes Finder-safe name parts', () => assert.equal(safePart('at://did:plc/a b'), 'at-did-plc-a-b'));
