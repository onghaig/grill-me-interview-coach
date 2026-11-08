import { FormEvent, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api, getApiKey, setApiKey, clearApiKey } from '../utils/api';

interface KeySetupProps {
  onSaved: () => void;
  /** Present when changing an existing key; omitted on first-time setup. */
  onCancel?: () => void;
}

export function KeySetup({ onSaved, onCancel }: KeySetupProps) {
  const hasKey = !!getApiKey();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = key.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    setWarning(null);
    try {
      const res = await api<{ ok: boolean; warning?: string }>('/api/key/check', { body: { apiKey: trimmed } });
      setApiKey(trimmed);
      if (res.warning) {
        setWarning(res.warning);
        setTimeout(onSaved, 1800);
      } else {
        onSaved();
      }
    } catch (err: any) {
      setError(err?.message || 'Could not check the key.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen w-screen overflow-y-auto bg-slate-950 text-slate-100 flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
          <span className="w-2 h-2 rounded-full bg-indigo-500" />
          Bar Raiser
        </div>
        <h1 className="font-display text-[2rem] leading-tight font-medium tracking-tight mt-6 text-slate-50">
          {hasKey ? 'Change your Gemini key' : 'Add your Gemini API key'}
        </h1>
        <p className="text-sm text-slate-400 mt-2 leading-relaxed">
          Bar Raiser runs on your own Google Gemini key, so the interviews use your quota and nobody else&apos;s. Get a
          free key from{' '}
          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noreferrer"
            className="text-slate-200 underline underline-offset-2"
          >
            Google AI Studio
          </a>
          .
        </p>

        <form onSubmit={save} className="mt-8 space-y-4">
          <div>
            <label htmlFor="gemini-key" className="block text-xs font-medium text-slate-300 mb-1.5">
              Gemini API key
            </label>
            <input
              id="gemini-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="Paste your key"
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm font-mono outline-none focus:border-slate-500"
            />
            <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">
              The key is saved only in this browser. It is sent to our server with each request so it can call Gemini
              for you, and it is never stored or logged on the server. You will need to enter it again on a new
              device.
            </p>
          </div>
          {error && (
            <p role="alert" className="text-xs text-rose-400 border border-rose-500/30 bg-rose-950/20 rounded-md p-2.5">
              {error}
            </p>
          )}
          {warning && <p className="text-xs text-amber-400">{warning}</p>}
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={busy || !key.trim()}
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
          {hasKey && (
            <button
              type="button"
              onClick={() => {
                clearApiKey();
                onSaved();
              }}
              className="text-xs text-slate-500 hover:text-rose-400"
            >
              Remove the saved key from this browser
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
