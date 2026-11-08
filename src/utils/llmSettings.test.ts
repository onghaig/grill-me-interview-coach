import { test } from 'node:test';
import assert from 'node:assert/strict';
import { choiceFor, usedProviders, jobsUsing, parseSettings, DEFAULT_SETTINGS } from './llmSettings.ts';

test('every job uses the default when nothing is overridden', () => {
  const s = parseSettings({ default: { provider: 'openai', model: 'gpt-4.1' } });
  assert.equal(choiceFor(s, 'grading').provider, 'openai');
  assert.equal(choiceFor(s, 'questions').model, 'gpt-4.1');
});

test('an override applies to its job only', () => {
  const s = parseSettings({ default: { provider: 'gemini', model: '' }, overrides: { grading: { provider: 'anthropic', model: 'claude-opus-5-5' } } });
  assert.equal(choiceFor(s, 'grading').provider, 'anthropic');
  assert.equal(choiceFor(s, 'questions').provider, 'gemini');
  assert.equal(choiceFor(s, 'behavioral').provider, 'gemini');
});

test('Gemini is always a used provider, plus whatever the jobs need', () => {
  const s = parseSettings({ default: { provider: 'openai', model: '' }, overrides: { grading: { provider: 'anthropic', model: '' } } });
  assert.deepEqual(usedProviders(s), ['gemini', 'openai', 'anthropic']);
  assert.deepEqual(usedProviders(DEFAULT_SETTINGS), ['gemini']);
});

test('a provider that is overridden away everywhere still counts as the default', () => {
  const s = parseSettings({ default: { provider: 'openai', model: '' }, overrides: { questions: { provider: 'gemini', model: '' }, behavioral: { provider: 'gemini', model: '' }, grading: { provider: 'gemini', model: '' } } });
  // The default is not used by any job, but it is still saved, so its key is still asked for
  assert.ok(usedProviders(s).includes('openai'));
  assert.deepEqual(jobsUsing(s, 'openai'), []);
});

test('jobsUsing lists the jobs on a provider', () => {
  const s = parseSettings({ default: { provider: 'gemini', model: '' }, overrides: { grading: { provider: 'anthropic', model: '' }, behavioral: { provider: 'anthropic', model: '' } } });
  assert.deepEqual(jobsUsing(s, 'anthropic'), ['behavioral', 'grading']);
});

test('the older single-choice settings still load', () => {
  const s = parseSettings({ provider: 'anthropic', model: 'claude-sonnet-5-5' });
  assert.equal(s.default.provider, 'anthropic');
  assert.equal(s.default.model, 'claude-sonnet-5-5');
  assert.deepEqual(s.overrides, {});
});

test('garbage falls back to defaults', () => {
  assert.deepEqual(parseSettings('nope'), DEFAULT_SETTINGS);
  assert.deepEqual(parseSettings({ default: { provider: 'mistral' }, overrides: { grading: { provider: 'x' } }, voiceModel: 'rm -rf' }), DEFAULT_SETTINGS);
  assert.deepEqual(parseSettings(null), DEFAULT_SETTINGS);
});

test('only known voice models are accepted', () => {
  assert.equal(parseSettings({ voiceModel: 'gemini-3.8-live' }).voiceModel, 'gemini-3.8-live');
  assert.equal(parseSettings({ voiceModel: 'something-else' }).voiceModel, '');
});
