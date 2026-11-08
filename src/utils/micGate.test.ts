import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MicGate } from './micGate.ts';

// Chunks arrive roughly every 85 ms
const run = (gate: MicGate<number>, levels: number[], speaking: boolean, startMs = 0) => {
  const sent: number[] = [];
  let ended = 0;
  levels.forEach((v, i) => {
    const r = gate.push(i, v, startMs + i * 85, speaking);
    sent.push(...r.send);
    if (r.ended) ended++;
  });
  return { sent, ended };
};

test('silence is not sent', () => {
  const g = new MicGate<number>();
  assert.equal(run(g, Array(60).fill(1), false).sent.length, 0);
});

test('speech is sent with a pre-roll so the first syllable is not clipped', () => {
  const g = new MicGate<number>();
  const levels = [...Array(20).fill(1), ...Array(10).fill(30)];
  const { sent } = run(g, levels, false);
  assert.ok(sent.includes(20), 'first loud chunk is sent');
  assert.ok(sent.includes(16), 'a few chunks before it are released too');
  assert.ok(!sent.includes(2), 'but not the whole silence');
});

test('the gate stays open through a pause, then closes and reports the end', () => {
  const g = new MicGate<number>();
  const speech = Array(10).fill(30);
  const pause = Array(40).fill(1); // 3.4 s
  const { sent, ended } = run(g, [...speech, ...pause], false);
  assert.ok(sent.includes(10 + 15), 'still streaming about 1.3 s into the pause');
  assert.ok(!sent.includes(10 + 35), 'closed after the 2 s tail');
  assert.equal(ended, 1);
});

test('quiet speech in a quiet room still gets through', () => {
  const g = new MicGate<number>();
  assert.ok(run(g, Array(10).fill(8), false).sent.length > 0);
});

test('echo of the interviewer at a steady level is NOT sent while it is speaking', () => {
  const g = new MicGate<number>();
  // 8 seconds of the interviewer talking, echo at level 25 with small wobble
  const echo = Array.from({ length: 95 }, (_, i) => 25 + (i % 5));
  assert.equal(run(g, echo, true).sent.length, 0);
});

test('quiet room noise is not sent while the interviewer is speaking', () => {
  const g = new MicGate<number>();
  assert.equal(run(g, Array(60).fill(10), true).sent.length, 0);
});

test('a real attempt to talk over the interviewer still gets through', () => {
  const g = new MicGate<number>();
  const echo = Array.from({ length: 50 }, () => 25);
  const bargeIn = Array(10).fill(90);
  const { sent } = run(g, [...echo, ...bargeIn], true);
  assert.ok(sent.includes(50), 'the loud speech is sent');
});

test('after the interviewer stops, normal sensitivity returns', () => {
  const g = new MicGate<number>();
  run(g, Array(60).fill(25), true);
  const { sent } = run(g, Array(15).fill(8), false, 60 * 85);
  assert.ok(sent.length > 0, 'level 8 is speech again once it is quiet');
});

test('the tail after the candidate stops does not carry the start of the interviewer reply back to the model', () => {
  const g = new MicGate<number>();
  const speech = run(g, Array(10).fill(30), false);
  const quiet = run(g, Array(6).fill(1), false, 10 * 85);
  // The interviewer now starts replying; its echo is at level 25
  const echo = run(g, Array(30).fill(25), true, 16 * 85);
  const echoSentAfterGrace = echo.sent.filter((i) => i > 3);
  assert.ok(speech.sent.length > 0 && quiet.sent.length > 0);
  assert.equal(echoSentAfterGrace.length, 0);
});

test('the first moments of echo are not trusted before the level is learned', () => {
  const g = new MicGate<number>();
  const { sent } = run(g, Array(6).fill(25), true);
  assert.equal(sent.length, 0);
});
