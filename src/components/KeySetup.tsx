import { FormEvent, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  api,
  Provider,
  PROVIDER_LABEL,
  DEFAULT_MODEL_HINT,
  getApiKey,
  setApiKey,
  getProviderKey,
  setProviderKey,
  getLlmSettings,
  setLlmSettings,
} from '../utils/api';

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

export function KeySetup({ onSaved, onCancel }: KeySetupProps) {
  const initial = getLlmSettings();
  const [provider, setProvider] = useState<Provider>(initial.provider);
  const [model, setModel] = useState(initial.model);
  const [geminiKey, setGeminiKey] = useState('');
  const [otherKey, setOtherKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const hasGemini = !!getApiKey();
  const hasOther = provider !== 'gemini' && !!getProviderKey(provider);

  const check = async (p: Provider, apiKey: string, m?: string) =>
    api<{ ok: boolean; warning?: string }>('/api/key/check', { body: { provider: p, apiKey, model: m || undefined } });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const gKey = geminiKey.trim() || getApiKey();
    const oKey = otherKey.trim() || (provider === 'gemini' ? '' : getProviderKey(provider));
    if (!gKey) return setError('Add your Gemini API key. Live voice runs on Gemini.');
    if (provider !== 'gemini' && !oKey) return setError(`Add your ${PROVIDER_LABEL[provider]} API key, or switch the provider back to Gemini.`);

    setBusy(true);
    setError(null);
    setWarning(null);
    try {
      const warnings: string[] = [];
      // Only keys that were typed now need checking; saved ones were checked when they were saved
      if (geminiKey.trim()) {
        const r = await check('gemini', gKey);
        if (r.warning) warnings.push(r.warning);
      }
      if (provider !== 'gemini' && (otherKey.trim() || model.trim() !== initial.model)) {
        const r = await check(provider, oKey, model.trim());
        if (r.warning) warnings.push(r.warning);
      }
      setApiKey(gKey);
      if (provider !== 'gemini') setProviderKey(provider, oKey);
      setLlmSettings({ provider, model: provider === 'gemini' ? '' : model.trim() });
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

  const input = 'w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm font-mono outline-none focus:border-slate-500';

  return (
    <div className="min-h-screen w-screen overflow-y-auto bg-slate-950 text-slate-100 flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-lg">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
          <span className="w-2 h-2 rounded-full bg-indigo-500" />
          Bar Raiser
        </div>
        <h1 className="font-display text-[2rem] leading-tight font-medium tracking-tight mt-6 text-slate-50">
          Models and keys
        </h1>
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
            <label htmlFor="gemini-key" className="block text-xs font-medium text-slate-300 mt-3 mb-1.5">
              Gemini API key
            </label>
            <input
              id="gemini-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={geminiKey}
              onChange={(e) => setGeminiKey(e.target.value)}
              placeholder={hasGemini ? 'Saved. Leave blank to keep it.' : 'Paste your key'}
              className={input}
            />
          </section>

          <section>
            <h2 className="text-sm font-medium text-slate-100">Questions, rubrics and grading</h2>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">Choose which model writes the questions and grades your interviews.</p>
            <div className="grid grid-cols-3 gap-2 mt-3" role="radiogroup" aria-label="Model provider">
              {(['gemini', 'openai', 'anthropic'] as Provider[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={provider === p}
                  onClick={() => {
                    setProvider(p);
                    setOtherKey('');
                    setModel(p === initial.provider ? initial.model : '');
                    setError(null);
                  }}
                  className={`py-2 rounded-md border text-sm font-medium ${
                    provider === p ? 'border-indigo-400 bg-indigo-950/40 text-slate-50' : 'border-slate-700 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {PROVIDER_LABEL[p]}
                </button>
              ))}
            </div>
            {provider === 'gemini' ? (
              <p className="text-xs text-slate-500 mt-3">Uses the Gemini key above, so there is nothing more to add.</p>
            ) : (
              <div className="mt-3 space-y-3">
                <div>
                  <label htmlFor="other-key" className="block text-xs font-medium text-slate-300 mb-1.5">
                    {PROVIDER_LABEL[provider]} API key
                  </label>
                  <input
                    id="other-key"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={otherKey}
                    onChange={(e) => setOtherKey(e.target.value)}
                    placeholder={hasOther ? 'Saved. Leave blank to keep it.' : 'Paste your key'}
                    className={input}
                  />
                  <p className="text-[11px] text-slate-500 mt-1.5">
                    From{' '}
                    <a href={KEY_HELP[provider].url} target="_blank" rel="noreferrer" className="text-slate-300 underline underline-offset-2">
                      {KEY_HELP[provider].label}
                    </a>
                    .
                  </p>
                </div>
                <div>
                  <label htmlFor="model-name" className="block text-xs font-medium text-slate-300 mb-1.5">
                    Model (optional)
                  </label>
                  <input
                    id="model-name"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder={`Default: ${DEFAULT_MODEL_HINT[provider as Exclude<Provider, 'gemini'>]}`}
                    className={input}
                    maxLength={80}
                  />
                </div>
              </div>
            )}
          </section>

          <p className="text-[11px] text-slate-500 leading-relaxed">
            Keys are saved only in this browser. They are sent to our server with each request so it can call the model
            for you, and are never stored or logged on the server. You will need to enter them again on a new device.
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
  );
}
