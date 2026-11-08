const KEY_STORE = 'br-gemini-key';

/** The Gemini key lives only in this browser and is sent with each request that needs it. */
export function getApiKey(): string {
  try {
    return localStorage.getItem(KEY_STORE) || '';
  } catch {
    return '';
  }
}
export function setApiKey(key: string): void {
  try {
    localStorage.setItem(KEY_STORE, key);
  } catch {
    /* storage unavailable: the key will need re-entering next visit */
  }
}
export function clearApiKey(): void {
  try {
    localStorage.removeItem(KEY_STORE);
  } catch {
    /* ignore */
  }
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
  if (opts.withKey) headers['x-gemini-key'] = getApiKey();
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
