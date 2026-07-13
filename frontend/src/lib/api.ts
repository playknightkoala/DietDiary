import type { DayData, Entry, Food, Goals, MealKey, TrendPoint } from '../types';

const TOKEN_KEY = 'diet-token';
const USER_KEY = 'diet-username';
const REMEMBER_ACCOUNT_KEY = 'diet-remember-account';

export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY) ?? localStorage.getItem(TOKEN_KEY);
}

export function getUsername(): string | null {
  return sessionStorage.getItem(USER_KEY) ?? localStorage.getItem(USER_KEY);
}

// persist=true（自動登入）存 localStorage 跨瀏覽器工作階段；否則存 sessionStorage 關閉即登出
export function saveAuth(token: string, username: string, persist: boolean) {
  clearAuth();
  const store = persist ? localStorage : sessionStorage;
  store.setItem(TOKEN_KEY, token);
  store.setItem(USER_KEY, username);
}

export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
}

export function getRememberedAccount(): string {
  return localStorage.getItem(REMEMBER_ACCOUNT_KEY) ?? '';
}

export function setRememberedAccount(account: string | null) {
  if (account) localStorage.setItem(REMEMBER_ACCOUNT_KEY, account);
  else localStorage.removeItem(REMEMBER_ACCOUNT_KEY);
}

let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(options.headers as Record<string, string>) };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(path, { ...options, headers });
  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    clearAuth();
    onUnauthorized();
    throw new ApiError(401, 'unauthorized');
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch { /* keep default */ }
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  getCaptcha: () => request<{ id: string; svg: string }>('/api/auth/captcha'),
  verifyCaptcha: (captchaId: string, captchaAnswer: string) =>
    request<{ ok: true }>('/api/auth/verify-captcha', {
      method: 'POST',
      body: JSON.stringify({ captchaId, captchaAnswer }),
    }),
  sendCode: (email: string, captchaId: string) =>
    request<{ ok: true }>('/api/auth/send-code', {
      method: 'POST',
      body: JSON.stringify({ email, captchaId }),
    }),
  register: (username: string, password: string, confirmPassword: string, code: string) =>
    request<{ pending: true; message: string }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password, confirmPassword, code }),
    }),
  login: (username: string, password: string, remember: boolean) =>
    request<{ token: string; username: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password, remember }),
    }),

  getDay: (date: string) => request<DayData>(`/api/days/${date}`),
  patchDay: (date: string, patch: { water?: number; ex?: DayData['ex']; body?: DayData['body'] }) =>
    request<DayData>(`/api/days/${date}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  getMarks: (from: string, to: string) =>
    request<{ dates: string[] }>(`/api/days/marks?from=${from}&to=${to}`),

  createEntry: (date: string, meal: MealKey) =>
    request<Entry>(`/api/days/${date}/entries`, { method: 'POST', body: JSON.stringify({ meal }) }),
  patchEntry: (id: number, patch: { desc?: string; food?: Food; photo?: '' }) =>
    request<Entry>(`/api/entries/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteEntry: (id: number) => request<void>(`/api/entries/${id}`, { method: 'DELETE' }),
  uploadPhoto: (id: number, blob: Blob) => {
    const form = new FormData();
    form.append('photo', blob, 'photo.jpg');
    return request<{ photo: string }>(`/api/entries/${id}/photo`, { method: 'POST', body: form });
  },

  getGoals: () => request<Goals | null>('/api/goals'),
  putGoals: (goals: Goals) =>
    request<Goals>('/api/goals', { method: 'PUT', body: JSON.stringify(goals) }),
  deleteGoals: () => request<void>('/api/goals', { method: 'DELETE' }),

  getTrend: (field: string, limit = 30) =>
    request<{ points: TrendPoint[] }>(`/api/body-trend?field=${field}&limit=${limit}`),
};
