import type { AuthResponse, User } from '@cardvault/shared';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public issues: Array<{ path: string; message: string }> = [],
  ) {
    super(message);
  }
}

/** The request never reached the server (offline, DNS, timeout). */
export class NetworkError extends Error {
  constructor() {
    super('Connessione assente. Riprova quando sei online.');
  }
}

type SessionListener = (user: User | null) => void;

export interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Raw body (image/vcard); sent as-is with `contentType`. */
  raw?: Blob | string;
  contentType?: string;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Return the Response instead of parsed JSON (downloads). */
  response?: boolean;
  signal?: AbortSignal;
}

const BASE = '/api';

class Api {
  private accessToken: string | null = null;
  private refreshing: Promise<AuthResponse | null> | null = null;
  private listeners = new Set<SessionListener>();

  onSession(fn: SessionListener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(user: User | null) {
    for (const fn of this.listeners) fn(user);
  }

  setSession(res: AuthResponse | null) {
    this.accessToken = res?.accessToken ?? null;
    this.emit(res?.user ?? null);
  }

  get hasToken() {
    return !!this.accessToken;
  }

  /**
   * One refresh at a time — across tabs too when Web Locks exist (Safari ≥ 15.4),
   * because the refresh cookie rotates on every call.
   */
  refresh(): Promise<AuthResponse | null> {
    if (this.refreshing) return this.refreshing;
    const run = async () => {
      const res = await fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'same-origin' }).catch(() => {
        throw new NetworkError();
      });
      if (!res.ok) {
        if (res.status === 401) {
          this.setSession(null);
          return null;
        }
        throw await toError(res);
      }
      const body = (await res.json()) as AuthResponse;
      this.setSession(body);
      return body;
    };
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    this.refreshing = (locks ? locks.request('cardvault-refresh', run) : run()).finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  async request<T>(path: string, opts: RequestOptions = {}, retried = false): Promise<T> {
    const url = new URL(BASE + path, window.location.origin);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
    const headers: Record<string, string> = {};
    if (this.accessToken) headers.authorization = `Bearer ${this.accessToken}`;
    let body: BodyInit | undefined;
    if (opts.raw !== undefined) {
      body = opts.raw;
      if (opts.contentType) headers['content-type'] = opts.contentType;
    } else if (opts.body !== undefined) {
      body = JSON.stringify(opts.body);
      headers['content-type'] = 'application/json';
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method: opts.method ?? (body ? 'POST' : 'GET'),
        headers,
        body,
        credentials: 'same-origin',
        signal: opts.signal,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err;
      throw new NetworkError();
    }

    if (res.status === 401 && !retried && !path.startsWith('/auth/')) {
      const session = await this.refresh();
      if (session) return this.request<T>(path, opts, true);
    }
    if (!res.ok) throw await toError(res);
    if (opts.response) return res as unknown as T;
    if (res.status === 204) return undefined as T;
    const type = res.headers.get('content-type') ?? '';
    return (type.includes('json') ? res.json() : res.text()) as Promise<T>;
  }

  get<T>(path: string, query?: RequestOptions['query']) {
    return this.request<T>(path, { query });
  }
  post<T>(path: string, body?: unknown) {
    return this.request<T>(path, { method: 'POST', body: body ?? {} });
  }
  put<T>(path: string, body: unknown) {
    return this.request<T>(path, { method: 'PUT', body });
  }
  patch<T>(path: string, body: unknown) {
    return this.request<T>(path, { method: 'PATCH', body });
  }
  delete<T>(path: string, body?: unknown) {
    return this.request<T>(path, { method: 'DELETE', body });
  }
}

async function toError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as { message?: string; code?: string; issues?: ApiError['issues'] };
    return new ApiError(res.status, body.message ?? res.statusText, body.code, body.issues);
  } catch {
    return new ApiError(res.status, res.status >= 500 ? 'Il server non risponde. Riprova tra poco.' : res.statusText);
  }
}

export const api = new Api();

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError || err instanceof NetworkError) return err.message;
  return 'Qualcosa è andato storto. Riprova.';
}

/** Field → message map for forms. */
export function fieldErrors(err: unknown): Record<string, string> {
  if (!(err instanceof ApiError)) return {};
  return Object.fromEntries(err.issues.map((i) => [i.path, i.message]));
}

/** Saves a Response as a file (desktop/Android). */
export async function saveResponse(res: Response, fallbackName: string) {
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') ?? '';
  const name = /filename\*=UTF-8''([^;]+)/.exec(cd)?.[1];
  saveBlob(blob, name ? decodeURIComponent(name) : fallbackName);
}

export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
