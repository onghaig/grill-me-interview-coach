import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanSvg, cleanCoding } from './library.ts';

const svg = '<svg viewBox="0 0 10 10"><rect width="5" height="5" stroke="#94a3b8" fill="none"/></svg>';

test('plain SVG is kept and given a namespace', () => {
  assert.match(cleanSvg(svg)!, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
});

test('SVG with scripts, handlers, links, styles or no viewBox is dropped', () => {
  for (const bad of [
    '<svg viewBox="0 0 1 1"><script>alert(1)</script></svg>',
    '<svg viewBox="0 0 1 1"><rect onclick="x()"/></svg>',
    '<svg viewBox="0 0 1 1"><a href="https://x"><rect/></a></svg>',
    '<svg viewBox="0 0 1 1"><style>*{}</style></svg>',
    '<svg><rect/></svg>',
    'not svg',
    undefined,
  ]) assert.equal(cleanSvg(bad), undefined);
});

test('coding spec needs a valid entry and at least two tests', () => {
  const ok = { mode: 'function', entry: 'two_sum', argKinds: ['plain', 'weird'], returnKind: 'plain', starterCode: 'def two_sum(): pass', tests: [{ input: '1', expected: '2' }, { input: '3', expected: '4', hidden: true }] };
  const c = cleanCoding(ok)!;
  assert.equal(c.mode, 'function');
  assert.deepEqual(c.argKinds, ['plain', 'plain']);
  assert.equal(cleanCoding({ ...ok, entry: 'a b; import os' })!.mode, 'none');
  assert.equal(cleanCoding({ ...ok, tests: [ok.tests[0]] })!.mode, 'none');
  assert.equal(cleanCoding(null), undefined);
});
