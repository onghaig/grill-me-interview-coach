import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildResumeTurns, resumeInstruction, ResumeContext } from './resume.ts';

const base: ResumeContext = {
  transcript: [
    { role: 'interviewer', text: 'Welcome. What are your requirements?' },
    { role: 'user', text: 'Read heavy, ten billion reads a month.' },
    { role: 'interviewer', text: 'Good. How would you generate the short codes?' },
  ],
  code: '',
  codeLanguage: 'Python',
  diagramText: '',
  elapsedSeconds: 600,
  timing: { mode: 'timed', minutes: 30 },
  minutesAway: 12,
};

test('turns alternate roles and start and end with the user', () => {
  const { turns } = buildResumeTurns(base);
  assert.equal(turns[0].role, 'user');
  assert.equal(turns[turns.length - 1].role, 'user');
  for (let i = 1; i < turns.length; i++) assert.notEqual(turns[i].role, turns[i - 1].role);
});

test('the earlier conversation is carried over as text', () => {
  const text = JSON.stringify(buildResumeTurns(base).turns);
  assert.match(text, /Read heavy, ten billion reads/);
  assert.match(text, /How would you generate the short codes/);
});

test('the final turn tells the interviewer to welcome them back and not to start over', () => {
  const { turns } = buildResumeTurns(base);
  const last = turns[turns.length - 1].parts[0].text;
  assert.match(last, /\[RESUME\]/);
  assert.match(last, /welcome them back/);
  assert.match(last, /Do not repeat your opening/);
  assert.match(last, /after about 12 minutes away/);
});

test('a candidate who spoke last gets an answer', () => {
  const ctx = { ...base, transcript: base.transcript.slice(0, 2) };
  const { turns, unanswered } = buildResumeTurns(ctx);
  assert.equal(unanswered, true);
  assert.equal(turns[turns.length - 1].role, 'user');
  assert.match(turns[turns.length - 1].parts[0].text, /Read heavy/);
  assert.match(turns[turns.length - 1].parts[0].text, /respond to what they said last/);
});

test('code and whiteboard are included when present', () => {
  const { turns } = buildResumeTurns({ ...base, code: 'def f(): pass', diagramText: '[Client] -> [LB]' });
  const last = turns[turns.length - 1].parts[0].text;
  assert.match(last, /\[CODE UPDATE\] \(Python\)\ndef f\(\): pass/);
  assert.match(last, /\[DIAGRAM UPDATE\]\n\[Client\] -> \[LB\]/);
});

test('a model-first transcript still starts with a user turn', () => {
  const { turns } = buildResumeTurns({ ...base, transcript: [{ role: 'interviewer', text: 'Hello' }] });
  assert.equal(turns[0].role, 'user');
});

test('an empty transcript still produces a valid single turn', () => {
  const { turns } = buildResumeTurns({ ...base, transcript: [] });
  assert.equal(turns.length, 1);
  assert.equal(turns[0].role, 'user');
});

test('long conversations are trimmed to the recent part', () => {
  const transcript = Array.from({ length: 200 }, (_, i) => ({ role: i % 2 ? 'user' : 'interviewer', text: `line ${i}` }));
  const text = JSON.stringify(buildResumeTurns({ ...base, transcript }).turns);
  assert.doesNotMatch(text, /line 10"/);
  assert.match(text, /line 199/);
});

test('time information follows the timing mode', () => {
  assert.match(resumeInstruction(base, false), /About 20 minutes remain/);
  assert.match(resumeInstruction({ ...base, timing: { mode: 'practice' } }, false), /no time limit/);
  assert.doesNotMatch(resumeInstruction({ ...base, timing: { mode: 'practice' } }, false), /minutes remain/);
  assert.match(resumeInstruction({ ...base, elapsedSeconds: 1800 }, false), /time is up/);
});

test('a short break is not mentioned', () => {
  assert.doesNotMatch(resumeInstruction({ ...base, minutesAway: 1 }, false), /away/);
});

test('historyBlock puts the earlier conversation, code and board into the instructions', async () => {
  const { historyBlock } = await import('./resume.ts');
  const block = historyBlock({
    transcript: [{ role: 'interviewer', text: 'Welcome' }, { role: 'user', text: 'Hi there' }],
    code: 'x = 1', codeLanguage: 'Python', diagramText: 'A->B', elapsedSeconds: 60, timing: { mode: 'normal' } as any, minutesAway: 3,
  });
  assert.match(block, /Interviewer: Welcome\nCandidate: Hi there/);
  assert.match(block, /x = 1/);
  assert.match(block, /A->B/);
});
