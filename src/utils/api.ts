export type Provider = 'gemini' | 'openai' | 'anthropic';
export const PROVIDER_LABEL: Record<Provider, string> = { gemini: 'Gemini', openai: 'OpenAI', anthropic: 'Anthropic' };
export const DEFAULT_MODEL_HINT: Record<Exclude<Provider, 'gemini'>, string> = { openai: 'gpt-4.1', anthropic: 'claude-opus-5-5' };

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

/** Which provider and model write questions and rubrics and grade interviews. */
export function getLlmSettings(): { provider: Provider; model: string } {
  try {
    const raw = JSON.parse(read(SETTINGS_STORE) || '{}');
    const provider: Provider = ['gemini', 'openai', 'anthropic'].includes(raw.provider) ? raw.provider : 'gemini';
    return { provider, model: typeof raw.model === 'string' ? raw.model : '' };
  } catch {
    return { provider: 'gemini', model: '' };
  }
}
export const setLlmSettings = (s: { provider: Provider; model: string }) => write(SETTINGS_STORE, JSON.stringify(s));

/** Everything needed to run an interview: a Gemini key, plus a key for the chosen provider if it is not Gemini. */
export function isConfigured(): boolean {
  const { provider } = getLlmSettings();
  return !!getApiKey() && (provider === 'gemini' || !!getProviderKey(provider));
}

/** The text-provider choice, in the shape the live-interview WebSocket expects. */
export function llmForSocket(): { provider: Provider; key?: string; model?: string } {
  const { provider, model } = getLlmSettings();
  return { provider, key: provider === 'gemini' ? undefined : getProviderKey(provider), model: model || undefined };
}

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
  /** Send the user's Gemini key with this request. */
  withKey?: boolean;
}

const AUTH_PATHS = ['/api/auth/login', '/api/auth/signup', '/api/auth/me'];

export async function api<T = any>(path: string, opts: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.withKey) {
    const { provider, model } = getLlmSettings();
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
