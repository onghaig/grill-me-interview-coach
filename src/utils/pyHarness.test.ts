import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { PY_HARNESS } from './pyHarness.ts';

/** Runs the harness under the machine's own Python, the same code Pyodide runs in the browser. */
function run(code: string, spec: object | null, mode: 'exec' | 'tests') {
  const script = PY_HARNESS + `\nimport sys, json\nd = json.load(sys.stdin)\nprint(__br_run(d["code"], json.dumps(d["spec"]), d["mode"]))\n`;
  const out = execFileSync('python3', ['-I', '-c', script], { input: JSON.stringify({ code, spec, mode }) }).toString();
  return JSON.parse(out.trim().split('\n').pop()!);
}

const two = {
  mode: 'function', entry: 'two_sum', argKinds: ['plain', 'plain'], returnKind: 'plain', unordered: true,
  tests: [{ input: '[2, 7, 11, 15], 9', expected: '[0, 1]' }, { input: '[3, 3], 6', expected: '[1, 0]' }, { input: '[1, 2], 99', expected: '[5]' }],
};

test('exec mode captures output and errors', () => {
  assert.equal(run('print("hi")', null, 'exec').stdout, 'hi\n');
  assert.match(run('1/0', null, 'exec').error, /ZeroDivisionError/);
});

test('function tests pass, fail, and ignore order when allowed', () => {
  const code = 'def two_sum(nums, target):\n    seen = {}\n    for i, n in enumerate(nums):\n        if target - n in seen: return [seen[target - n], i]\n        seen[n] = i\n';
  const r = run(code, two, 'tests').tests;
  assert.deepEqual(r.map((t: any) => t.ok), [true, true, false]);
});

test('a class Solution with the method name also works, and a missing function is reported', () => {
  const r = run('class Solution:\n    def two_sum(self, a, t): return [0, 1]\n', two, 'tests').tests;
  assert.equal(r[0].ok, true);
  assert.match(run('x = 1', two, 'tests').tests[0].error, /Define two_sum/);
});

test('linked lists, trees and in-place answers are converted', () => {
  const rev = { mode: 'function', entry: 'reverse', argKinds: ['list'], returnKind: 'list', tests: [{ input: '[1, 2, 3]', expected: '[3, 2, 1]' }] };
  const code = 'def reverse(h):\n    p = None\n    while h:\n        h.next, p, h = p, h, h.next\n    return p\n';
  assert.equal(run(code, rev, 'tests').tests[0].ok, true);
  const inv = { mode: 'function', entry: 'invert', argKinds: ['tree'], returnKind: 'tree', tests: [{ input: '[4, 2, 7]', expected: '[4, 7, 2]' }] };
  const icode = 'def invert(r):\n    if r: r.left, r.right = invert(r.right), invert(r.left)\n    return r\n';
  assert.equal(run(icode, inv, 'tests').tests[0].ok, true);
  const inplace = { mode: 'function', entry: 'rev', argKinds: ['plain'], returnKind: 'arg0', tests: [{ input: '[1, 2, 3]', expected: '[3, 2, 1]' }] };
  assert.equal(run('def rev(a):\n    a.reverse()\n', inplace, 'tests').tests[0].ok, true);
});

test('design questions replay operations', () => {
  const spec = { mode: 'design', entry: 'Counter', argKinds: [], returnKind: 'plain', tests: [{ input: '["Counter", "add", "get"], [[], [5], []]', expected: '[None, None, 5]' }] };
  const code = 'class Counter:\n    def __init__(self): self.n = 0\n    def add(self, k): self.n += k\n    def get(self): return self.n\n';
  assert.equal(run(code, spec, 'tests').tests[0].ok, true);
});
