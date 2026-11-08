import { FormEvent, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api } from '../utils/api';

export interface AccountUser {
  id: string;
  email: string;
}

export function AuthScreen({ onAuthed }: { onAuthed: (user: AccountUser) => void }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { user } = await api<{ user: AccountUser }>(`/api/auth/${mode}`, { body: { email, password } });
      onAuthed(user);
    } catch (err: any) {
      setError(err?.message || 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-screen w-screen overflow-y-auto bg-slate-950 text-slate-100">
      <div className="min-h-full flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
          <span className="w-2 h-2 rounded-full bg-indigo-500" />
          Bar Raiser
        </div>
        <h1 className="font-display text-[2rem] leading-tight font-medium tracking-tight mt-6 text-slate-50">
          {mode === 'login' ? 'Welcome back' : 'Create your account'}
        </h1>
        <p className="text-sm text-slate-400 mt-2 leading-relaxed">
          Your interviews and scorecards are saved to your account so you can review them later.
        </p>

        <form onSubmit={submit} className="mt-8 space-y-4">
          <div>
            <label htmlFor="email" className="block text-xs font-medium text-slate-300 mb-1.5">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm outline-none focus:border-slate-500"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-xs font-medium text-slate-300 mb-1.5">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
              minLength={mode === 'signup' ? 8 : undefined}
              maxLength={200}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm outline-none focus:border-slate-500"
            />
            {mode === 'signup' && <p className="text-[11px] text-slate-500 mt-1.5">At least 8 characters.</p>}
          </div>
          {error && (
            <p role="alert" className="text-xs text-rose-400 border border-rose-500/30 bg-rose-950/20 rounded-md p-2.5">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy || !email || !password}
            className="w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold flex items-center justify-center gap-2"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            {mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <p className="text-xs text-slate-500 mt-6">
          {mode === 'login' ? 'New here?' : 'Already have an account?'}{' '}
          <button
            onClick={() => {
              setMode(mode === 'login' ? 'signup' : 'login');
              setError(null);
            }}
            className="text-slate-200 hover:text-white underline underline-offset-2"
          >
            {mode === 'login' ? 'Create an account' : 'Sign in'}
          </button>
        </p>
      </div>
      </div>
    </div>
  );
}
