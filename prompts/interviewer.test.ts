import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getInterviewerSystemInstruction, SYSTEM_DESIGN_QUESTIONS, SystemDesignQuestion } from './interviewer.ts';

const q = SYSTEM_DESIGN_QUESTIONS[0];
const behavioral: SystemDesignQuestion = {
  ...q,
  type: 'behavioral',
  plannedQuestions: [{ competency: 'Ownership', question: 'Tell me about a time you owned an outage.', followUps: ['what did you do'] }],
};

test('a timed interview states its length and keeps to the clock', () => {
  const text = getInterviewerSystemInstruction(q, { mode: 'timed', minutes: 45 });
  assert.match(text, /45-minute interview/);
  assert.match(text, /Keep to the clock/);
  assert.doesNotMatch(text, /no time limit/i);
});

test('practice mode never tells the interviewer to hurry', () => {
  const text = getInterviewerSystemInstruction(q, { mode: 'practice' });
  assert.match(text, /untimed practice session/);
  assert.match(text, /There is no time limit/);
  assert.doesNotMatch(text, /Keep to the clock/);
  assert.doesNotMatch(text, /minute interview/);
});

test('no fixed 30 minute wording is left in any mode or question type', () => {
  for (const question of [q, behavioral, { ...q, type: 'coding' as const }, { ...q, type: 'low_level_design' as const }]) {
    const practice = getInterviewerSystemInstruction(question, { mode: 'practice' });
    assert.doesNotMatch(practice, /30-minute|thirty minutes/, `practice, ${question.type}`);
    const long = getInterviewerSystemInstruction(question, { mode: 'timed', minutes: 45 });
    assert.doesNotMatch(long, /30-minute|thirty minutes/, `45 min, ${question.type}`);
    assert.doesNotMatch(long, /\{PACING\}/);
  }
});

test('behavioral pacing follows the timing', () => {
  assert.match(getInterviewerSystemInstruction(behavioral, { mode: 'timed', minutes: 30 }), /six to eight stories in 30 minutes/);
  assert.match(getInterviewerSystemInstruction(behavioral, { mode: 'timed', minutes: 45 }), /eight to ten stories in 45 minutes/);
  assert.match(getInterviewerSystemInstruction(behavioral, { mode: 'practice' }), /at the candidate's pace/);
});

test('the default is the normal 30 minute interview', () => {
  assert.match(getInterviewerSystemInstruction(q), /30-minute interview/);
});
