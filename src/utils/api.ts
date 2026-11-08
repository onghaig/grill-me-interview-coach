import { Provider, Job, LlmSettings, choiceFor, usedProviders, parseSettings } from './llmSettings';
export type { Provider, Job, LlmSettings } from './llmSettings';
export { PROVIDER_LABEL } from './llmSettings';

const SETTINGS_STORE = 'br-llm';
const keyStore = (p: Provider) => (p === 'gemini' ? 'br-gemini-key' : `br-key-${p}`);

const read = (k: string): string => {
  try {
    return localStorage.getItem(k) || '';
  } catch {
    return '';
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* storage unavailable: settings will need re-entering next visit */
  }
};
const remove = (k: string) => {
  try {
    localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
};

/** API keys live only in this browser and are sent with each request that needs them. */
export const getProviderKey = (p: Provider): string => read(keyStore(p));
export const setProviderKey = (p: Provider, key: string) => write(keyStore(p), key);
export const clearProviderKey = (p: Provider) => remove(keyStore(p));

/** The Gemini key is always needed: live voice runs on Gemini. */
export const getApiKey = (): string => getProviderKey('gemini');
export const setApiKey = (key: string) => setProviderKey('gemini', key);
export const clearApiKey = () => clearProviderKey('gemini');

/** The saved model choices: a default, optional per-job overrides, and the Gemini voice model. */
export function getSettings(): LlmSettings {
  try {
    return parseSettings(JSON.parse(read(SETTINGS_STORE) || '{}'));
  } catch {
    return parseSettings({});
  }
}
export const saveSettings = (s: LlmSettings) => write(SETTINGS_STORE, JSON.stringify(s));

/** Everything needed to run an interview: a Gemini key, plus a key for every provider the settings use. */
export function isConfigured(): boolean {
  return usedProviders(getSettings()).every((p) => !!getProviderKey(p));
}

/** The text-provider choice for the live interview's text fallback, in the shape the WebSocket expects. */
export function llmForSocket(): { provider: Provider; key?: string; model?: string } {
  const { provider, model } = getSettings().default;
  return { provider, key: provider === 'gemini' ? undefined : getProviderKey(provider), model: model || undefined };
}

/** The Gemini live model chosen for the spoken interview, if any. */
export const voiceModelForSocket = (): string | undefined => getSettings().voiceModel || undefined;

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

interface ApiOptions {
  method?: string;
  body?: unknown;
  /** Send the user's keys with this request, and use the model they chose for this job. */
  withKey?: Job;
}

const AUTH_PATHS = ['/api/auth/login', '/api/auth/signup', '/api/auth/me'];

export async function api<T = any>(path: string, opts: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.withKey) {
    const { provider, model } = choiceFor(getSettings(), opts.withKey);
    headers['x-gemini-key'] = getApiKey();
    headers['x-llm-provider'] = provider;
    if (provider !== 'gemini') headers['x-llm-key'] = getProviderKey(provider);
    if (model) headers['x-llm-model'] = model;
  }
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError('Could not reach the server. Check your connection and try again.', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !AUTH_PATHS.includes(path)) window.dispatchEvent(new Event('auth-expired'));
  if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status})`, res.status, data.code);
  return data as T;
}
