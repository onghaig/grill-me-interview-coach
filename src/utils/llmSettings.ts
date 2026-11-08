export type Provider = 'gemini' | 'openai' | 'anthropic';
export const PROVIDERS: Provider[] = ['gemini', 'openai', 'anthropic'];
export const PROVIDER_LABEL: Record<Provider, string> = { gemini: 'Gemini', openai: 'OpenAI', anthropic: 'Anthropic' };

/** The jobs that can each run on their own model. */
export type Job = 'questions' | 'behavioral' | 'grading';
export const JOBS: Job[] = ['questions', 'behavioral', 'grading'];
export const JOB_LABEL: Record<Job, string> = {
  questions: 'Writing questions and rubrics',
  behavioral: 'Planning behavioral interviews from a resume',
  grading: 'Grading interviews',
};

export interface Choice {
  provider: Provider;
  /** Empty means the provider's default model. */
  model: string;
}

export interface LlmSettings {
  /** Used for every job that has no override of its own. */
  default: Choice;
  overrides: Partial<Record<Job, Choice>>;
  /** Gemini live model for the spoken interview. Empty means automatic. */
  voiceModel: string;
}

export const DEFAULT_SETTINGS: LlmSettings = { default: { provider: 'gemini', model: '' }, overrides: {}, voiceModel: '' };

/** The live models that worked in testing, newest first. The server tries the chosen one first, then the rest. */
export const VOICE_MODELS = [
  { id: '', label: 'Automatic (recommended)' },
  { id: 'gemini-3.1-flash-live-preview', label: 'gemini-3.1-flash-live-preview' },
  { id: 'gemini-3.8-live', label: 'gemini-3.8-live' },
  { id: 'gemini-2.5-flash-native-audio-latest', label: 'gemini-2.5-flash-native-audio-latest' },
];

export const MODEL_HINT: Record<Provider, string> = {
  gemini: 'Automatic (newest Flash model)',
  openai: 'gpt-4.1',
  anthropic: 'claude-opus-5-5',
};

/** The model that runs a given job. */
export function choiceFor(s: LlmSettings, job: Job): Choice {
  return s.overrides[job] ?? s.default;
}

/** Every provider the current settings need a key for. Gemini is always needed for live voice. */
export function usedProviders(s: LlmSettings): Provider[] {
  const set = new Set<Provider>(['gemini', s.default.provider]);
  for (const job of JOBS) set.add(choiceFor(s, job).provider);
  return PROVIDERS.filter((p) => set.has(p));
}

/** Which jobs use a provider, for error messages and for picking the model to test a key with. */
export function jobsUsing(s: LlmSettings, provider: Provider): Job[] {
  return JOBS.filter((j) => choiceFor(s, j).provider === provider);
}

/** Read stored settings defensively; anything malformed falls back to defaults. Also accepts the older single-choice shape. */
export function parseSettings(raw: unknown): LlmSettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as any;
  const choice = (c: any): Choice | null =>
    c && PROVIDERS.includes(c.provider) ? { provider: c.provider, model: typeof c.model === 'string' ? c.model : '' } : null;

  // Old shape: { provider, model }
  const legacy = choice(o);
  const def = choice(o.default) ?? legacy ?? DEFAULT_SETTINGS.default;
  const overrides: LlmSettings['overrides'] = {};
  for (const job of JOBS) {
    const c = choice(o.overrides?.[job]);
    if (c) overrides[job] = c;
  }
  const voiceModel = VOICE_MODELS.some((m) => m.id === o.voiceModel) ? o.voiceModel : '';
  return { default: def, overrides, voiceModel };
}
