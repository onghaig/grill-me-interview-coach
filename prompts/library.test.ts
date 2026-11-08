import test from 'node:test';
import assert from 'node:assert/strict';
import { LIBRARY, LIBRARY_BY_ID } from './library.ts';

test('the catalog has the NeetCode 150 and unique ids', () => {
  assert.equal(LIBRARY.filter((e) => e.list === 'neetcode150').length, 150);
  assert.equal(new Set(LIBRARY.map((e) => e.id)).size, LIBRARY.length);
  assert.equal(LIBRARY_BY_ID['nc-two-sum'].difficulty, 'Easy');
  assert.ok(LIBRARY.filter((e) => e.list === 'system_design').length >= 40);
  assert.ok(LIBRARY.filter((e) => e.list === 'low_level_design').length >= 30);
});
