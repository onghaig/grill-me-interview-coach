import { FormEvent, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api, getApiKey, setApiKey, getProviderKey, setProviderKey, getSettings, saveSettings } from '../utils/api';
import {
  Provider,
  Job,
  Choice,
  LlmSettings,
  PROVIDERS,
  PROVIDER_LABEL,
  JOBS,
  JOB_LABEL,
  MODEL_HINT,
  VOICE_MODELS,
  usedProviders,
  jobsUsing,
  choiceFor,
} from '../utils/llmSettings';

interface KeySetupProps {
  onSaved: () => void;
  /** Present when changing existing settings; omitted on first-time setup. */
  onCancel?: () => void;
}

const KEY_HELP: Record<Provider, { label: string; url: string }> = {
  gemini: { label: 'Google AI Studio', url: 'https://aistudio.google.com/apikey' },
  openai: { label: 'the OpenAI dashboard', url: 'https://platform.openai.com/api-keys' },
  anthropic: { label: 'the Anthropic Console', url: 'https://console.anthropic.com/settings/keys' },
};

const field = 'w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm font-mono outline-none focus:border-slate-500';

export function KeySetup({ onSaved, onCancel }: KeySetupProps) {
  const saved = getSettings();
  const [def, setDef] = useState<Choice>(saved.default);
  const [over, setOver] = useState<LlmSettings['overrides']>(saved.overrides);
  const [voiceModel, setVoiceModel] = useState(saved.voiceModel);
  const [typed, setTyped] = useState<Record<Provider, string>>({ gemini: '', openai: '', anthropic: '' });
  const [showAdvanced, setShowAdvanced] = useState(Object.keys(saved.overrides).length > 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const current: LlmSettings = { default: def, overrides: over, voiceModel };
  const used = usedProviders(current);
  const otherProviders = used.filter((p) => p !== 'gemini');

  const setOverride = (job: Job, value: Provider | 'same') => {
    setError(null);
    setOver((prev) => {
      const next = { ...prev };
      if (value === 'same') delete next[job];
      else next[job] = { provider: value, model: prev[job]?.provider === value ? prev[job]!.model : '' };
      return next;
    });
  };

  /** The model a provider's key is tested with: the first job that uses it. */
  const modelToTest = (p: Provider): string => {
    const job = jobsUsing(current, p)[0];
    return (job ? choiceFor(current, job) : def).model.trim();
  };

  const check = (provider: Provider, apiKey: string, model: string) =>
    api<{ ok: boolean; warning?: string }>('/api/key/check', { body: { provider, apiKey, model: model || undefined } });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;

    const geminiKey = typed.gemini.trim() || getApiKey();
    if (!geminiKey) return setError('Add your Gemini API key. Live voice runs on Gemini.');
    for (const p of otherProviders) {
      if (!typed[p].trim() && !getProviderKey(p)) {
        const jobs = jobsUsing(current, p).map((j) => JOB_LABEL[j].toLowerCase());
        return setError(`Add your ${PROVIDER_LABEL[p]} API key${jobs.length ? ` (used for ${jobs.join(', ')})` : ''}, or switch those jobs to another provider.`);
      }
    }

    setBusy(true);
    setError(null);
    setWarning(null);
    try {
      const warnings: string[] = [];
      // Only keys or models that changed need checking; saved ones were checked when they were saved
      if (typed.gemini.trim()) {
        const r = await check('gemini', geminiKey, modelToTest('gemini'));
        if (r.warning) warnings.push(r.warning);
      }
      for (const p of otherProviders) {
        const key = typed[p].trim() || getProviderKey(p);
        const before = jobsUsing(saved, p)[0] ? choiceFor(saved, jobsUsing(saved, p)[0]).model.trim() : '';
        if (typed[p].trim() || modelToTest(p) !== before) {
          const r = await check(p, key, modelToTest(p));
          if (r.warning) warnings.push(r.warning);
        }
      }
      setApiKey(geminiKey);
      for (const p of otherProviders) setProviderKey(p, typed[p].trim() || getProviderKey(p));
      saveSettings({
        default: { provider: def.provider, model: def.model.trim() },
        overrides: Object.fromEntries(Object.entries(over).map(([j, c]) => [j, { provider: c!.provider, model: c!.model.trim() }])),
        voiceModel,
      });
      if (warnings.length) {
        setWarning(warnings.join(' '));
        setTimeout(onSaved, 2200);
      } else {
        onSaved();
      }
    } catch (err: any) {
      setError(err?.message || 'Could not check the key.');
    } finally {
      setBusy(false);
    }
  };

  const providerButtons = (value: Provider, onPick: (p: Provider) => void, label: string) => (
    <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={label}>
      {PROVIDERS.map((p) => (
        <button
          key={p}
          type="button"
          role="radio"
          aria-checked={value === p}
          onClick={() => onPick(p)}
          className={`py-2 rounded-md border text-sm font-medium ${
            value === p ? 'border-indigo-400 bg-indigo-950/40 text-slate-50' : 'border-slate-700 text-slate-400 hover:text-slate-200'
          }`}
        >
          {PROVIDER_LABEL[p]}
        </button>
      ))}
    </div>
  );

  return (
    <div className="h-screen w-screen overflow-y-auto bg-slate-950 text-slate-100">
      <div className="min-h-full flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-lg">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
          <span className="w-2 h-2 rounded-full bg-indigo-500" />
          Bar Raiser
        </div>
        <h1 className="font-display text-[2rem] leading-tight font-medium tracking-tight mt-6 text-slate-50">Models and keys</h1>
        <p className="text-sm text-slate-400 mt-2 leading-relaxed">
          Bar Raiser runs on your own API keys, so the interviews use your quota and nobody else&apos;s.
        </p>

        <form onSubmit={save} className="mt-8 space-y-7">
          <section>
            <h2 className="text-sm font-medium text-slate-100">Live voice interview</h2>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              The spoken interview runs on Gemini Live, so a Gemini key is always needed. Get one from{' '}
              <a href={KEY_HELP.gemini.url} target="_blank" rel="noreferrer" className="text-slate-300 underline underline-offset-2">
                {KEY_HELP.gemini.label}
              </a>
              .
            </p>
            <label htmlFor="key-gemini" className="block text-xs font-medium text-slate-300 mt-3 mb-1.5">
              Gemini API key
            </label>
            <input
              id="key-gemini"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={typed.gemini}
              onChange={(e) => setTyped({ ...typed, gemini: e.target.value })}
              placeholder={getApiKey() ? 'Saved. Leave blank to keep it.' : 'Paste your key'}
              className={field}
            />
            <label htmlFor="voice-model" className="block text-xs font-medium text-slate-300 mt-3 mb-1.5">
              Voice model
            </label>
            <select id="voice-model" value={voiceModel} onChange={(e) => setVoiceModel(e.target.value)} className={field.replace('font-mono', '')}>
              {VOICE_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-slate-500 mt-1.5">If the chosen model is unavailable, the others are tried automatically.</p>
          </section>

          <section>
            <h2 className="text-sm font-medium text-slate-100">Questions, rubrics and grading</h2>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">Choose which model does this work. You can give each job its own model below.</p>
            <div className="mt-3">
              {providerButtons(def.provider, (p) => { setDef({ provider: p, model: p === saved.default.provider ? saved.default.model : '' }); setError(null); }, 'Default model provider')}
            </div>
            <label htmlFor="model-default" className="block text-xs font-medium text-slate-300 mt-3 mb-1.5">
              Model (optional)
            </label>
            <input
              id="model-default"
              value={def.model}
              onChange={(e) => setDef({ ...def, model: e.target.value })}
              placeholder={`Default: ${MODEL_HINT[def.provider]}`}
              className={field}
              maxLength={80}
            />

            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              aria-expanded={showAdvanced}
              className="mt-4 text-xs text-slate-400 hover:text-slate-200"
            >
              {showAdvanced ? 'Hide' : 'Show'} advanced: a different model for each job
            </button>

            {showAdvanced && (
              <div className="mt-3 rounded-lg border border-slate-800 bg-slate-900/50 p-4 space-y-4">
                {JOBS.map((job) => {
                  const o = over[job];
                  return (
                    <div key={job}>
                      <label htmlFor={`job-${job}`} className="block text-xs font-medium text-slate-300 mb-1.5">
                        {JOB_LABEL[job]}
                      </label>
                      <div className="flex gap-2">
                        <select
                          id={`job-${job}`}
                          value={o ? o.provider : 'same'}
                          onChange={(e) => setOverride(job, e.target.value as Provider | 'same')}
                          className="rounded-md border border-slate-700 bg-slate-900 px-2.5 py-2 text-sm outline-none focus:border-slate-500"
                        >
                          <option value="same">Same as above</option>
                          {PROVIDERS.map((p) => (
                            <option key={p} value={p}>
                              {PROVIDER_LABEL[p]}
                            </option>
                          ))}
                        </select>
                        {o && (
                          <input
                            aria-label={`${JOB_LABEL[job]}: model`}
                            value={o.model}
                            onChange={(e) => setOver({ ...over, [job]: { provider: o.provider, model: e.target.value } })}
                            placeholder={`Default: ${MODEL_HINT[o.provider]}`}
                            className={`${field} flex-1`}
                            maxLength={80}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
                <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setOver({ ...over, grading: { provider: 'anthropic', model: '' } });
                      setError(null);
                    }}
                    className="text-xs text-slate-300 hover:text-slate-50 underline underline-offset-2"
                  >
                    Suggested: Claude for grading
                  </button>
                  <button type="button" onClick={() => setOver({})} className="text-xs text-slate-500 hover:text-slate-300">
                    Use one model for everything
                  </button>
                </div>
              </div>
            )}
          </section>

          {otherProviders.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-medium text-slate-100">Other API keys</h2>
              {otherProviders.map((p) => {
                const jobs = jobsUsing(current, p);
                return (
                  <div key={p}>
                    <label htmlFor={`key-${p}`} className="block text-xs font-medium text-slate-300 mb-1.5">
                      {PROVIDER_LABEL[p]} API key
                      <span className="font-normal text-slate-500">
                        {' '}
                        {jobs.length ? `for ${jobs.map((j) => JOB_LABEL[j].toLowerCase()).join(', ')}` : '(saved as the default)'}
                      </span>
                    </label>
                    <input
                      id={`key-${p}`}
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      value={typed[p]}
                      onChange={(e) => setTyped({ ...typed, [p]: e.target.value })}
                      placeholder={getProviderKey(p) ? 'Saved. Leave blank to keep it.' : 'Paste your key'}
                      className={field}
                    />
                    <p className="text-[11px] text-slate-500 mt-1.5">
                      From{' '}
                      <a href={KEY_HELP[p].url} target="_blank" rel="noreferrer" className="text-slate-300 underline underline-offset-2">
                        {KEY_HELP[p].label}
                      </a>
                      .
                    </p>
                  </div>
                );
              })}
            </section>
          )}

          <p className="text-[11px] text-slate-500 leading-relaxed">
            Keys are saved only in this browser. They are sent to our server with each request so it can call the model for you, and are
            never stored or logged on the server. You will need to enter them again on a new device.
          </p>

          {error && (
            <p role="alert" className="text-xs text-rose-400 border border-rose-500/30 bg-rose-950/20 rounded-md p-2.5">
              {error}
            </p>
          )}
          {warning && <p className="text-xs text-amber-400">{warning}</p>}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={busy}
              className="flex-1 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold flex items-center justify-center gap-2"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              {busy ? 'Checking...' : 'Check and save'}
            </button>
            {onCancel && (
              <button type="button" onClick={onCancel} className="text-xs text-slate-400 hover:text-slate-200 px-2">
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>
      </div>
    </div>
  );
}
