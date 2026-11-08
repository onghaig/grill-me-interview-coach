import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTiming, DEFAULT_TIMING, timeLimitSeconds, scaledPhaseMinutes, timingPhrase, gradingTimingNote, timerMessage, timingId, TIMING_OPTIONS } from './timing.ts';

test('valid timings are kept, anything else becomes the default', () => {
  assert.deepEqual(normalizeTiming({ mode: 'timed', minutes: 45 }), { mode: 'timed', minutes: 45 });
  assert.deepEqual(normalizeTiming({ mode: 'practice', minutes: 99 }), { mode: 'practice' });
  assert.deepEqual(normalizeTiming({ mode: 'timed', minutes: 7 }), DEFAULT_TIMING);
  assert.deepEqual(normalizeTiming({ mode: 'timed', minutes: '30' }), DEFAULT_TIMING);
  assert.deepEqual(normalizeTiming('practice'), DEFAULT_TIMING);
  assert.deepEqual(normalizeTiming(null), DEFAULT_TIMING);
});

test('practice mode has no clock', () => {
  assert.equal(timeLimitSeconds({ mode: 'practice' }), null);
  assert.equal(timeLimitSeconds({ mode: 'timed', minutes: 45 }), 2700);
  assert.equal(scaledPhaseMinutes(5, { mode: 'practice' }), null);
});

test('phase lengths scale with the interview length', () => {
  assert.equal(scaledPhaseMinutes(10, { mode: 'timed', minutes: 30 }), 10);
  assert.equal(scaledPhaseMinutes(10, { mode: 'timed', minutes: 45 }), 15);
  assert.equal(scaledPhaseMinutes(5, { mode: 'timed', minutes: 45 }), 7.5);
  const sum = [5, 5, 10, 7, 3].reduce((t, m) => t + (scaledPhaseMinutes(m, { mode: 'timed', minutes: 45 }) as number), 0);
  assert.equal(sum, 45);
});

test('what the interviewer says about time matches the mode', () => {
  assert.match(timingPhrase({ mode: 'timed', minutes: 30 }), /thirty minutes/);
  assert.match(timingPhrase({ mode: 'timed', minutes: 45 }), /forty-five minutes/);
  assert.match(timingPhrase({ mode: 'practice' }), /no time limit/);
  assert.doesNotMatch(timingPhrase({ mode: 'practice' }), /minutes/);
});

test('the grader is told not to judge pacing in practice mode', () => {
  assert.match(gradingTimingNote({ mode: 'practice' }), /Do not judge pacing/);
  assert.match(gradingTimingNote({ mode: 'timed', minutes: 45 }), /45 minute/);
});

test('timer messages fire only near the end', () => {
  assert.equal(timerMessage(900), null);
  assert.equal(timerMessage(301), null);
  assert.match(timerMessage(300) as string, /five minutes/);
  assert.match(timerMessage(60) as string, /Less than a minute/);
  assert.match(timerMessage(0) as string, /Time is up/);
});

test('options round-trip through their ids', () => {
  for (const o of TIMING_OPTIONS) assert.equal(timingId(o.timing), o.id);
});
