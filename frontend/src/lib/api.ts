import type { AdminUser, CommentTarget, DayData, Entry, EntryComment, Food, Goal, GoalInput, MealKey, MemberInfo, PhotoRating, Role, TrendPoint } from '../types';

const TOKEN_KEY = 'diet-token';
const USER_KEY = 'diet-username';
const ROLE_KEY = 'diet-role';
const REMEMBER_ACCOUNT_KEY = 'diet-remember-account';

export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY) ?? localStorage.getItem(TOKEN_KEY);
}

export function getUsername(): string | null {
  return sessionStorage.getItem(USER_KEY) ?? localStorage.getItem(USER_KEY);
}

export function getRole(): Role {
  const r = sessionStorage.getItem(ROLE_KEY) ?? localStorage.getItem(ROLE_KEY);
  return r === 'admin' || r === 'dietitian' ? r : 'member';
}

// persist=true（自動登入）存 localStorage 跨瀏覽器工作階段；否則存 sessionStorage 關閉即登出
export function saveAuth(token: string, username: string, role: Role, persist: boolean) {
  clearAuth();
  const store = persist ? localStorage : sessionStorage;
  store.setItem(TOKEN_KEY, token);
  store.setItem(USER_KEY, username);
  store.setItem(ROLE_KEY, role);
}

export function saveRole(role: Role) {
  const store = localStorage.getItem(TOKEN_KEY) ? localStorage : sessionStorage;
  store.setItem(ROLE_KEY, role);
}

export function clearAuth() {
  for (const store of [localStorage, sessionStorage]) {
    store.removeItem(TOKEN_KEY);
    store.removeItem(USER_KEY);
    store.removeItem(ROLE_KEY);
  }
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
    request<{ token: string; username: string; role: Role }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password, remember }),
    }),
  me: () => request<{ username: string; role: Role; createdAt: string }>('/api/auth/me'),
  changePassword: (oldPassword: string, newPassword: string, confirmPassword: string) =>
    request<{ ok: true }>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ oldPassword, newPassword, confirmPassword }),
    }),

  getDay: (date: string) => request<DayData>(`/api/days/${date}`),
  patchDay: (
    date: string,
    patch: { water?: number; waterTime?: string; ex?: DayData['ex']; exTime?: string; body?: DayData['body']; bodyTime?: string }
  ) => request<DayData>(`/api/days/${date}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  getMarks: (from: string, to: string) =>
    request<{ dates: string[] }>(`/api/days/marks?from=${from}&to=${to}`),

  createEntry: (date: string, meal: MealKey, eatTime?: string) =>
    request<Entry>(`/api/days/${date}/entries`, { method: 'POST', body: JSON.stringify({ meal, eatTime }) }),
  patchEntry: (id: number, patch: { desc?: string; food?: Food; photos?: string[]; date?: string; eatTime?: string }) =>
    request<Entry>(`/api/entries/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteEntry: (id: number) => request<void>(`/api/entries/${id}`, { method: 'DELETE' }),
  uploadPhotos: (id: number, blobs: Blob[]) => {
    const form = new FormData();
    blobs.forEach((b, i) => form.append('photos', b, `photo-${i}.jpg`));
    return request<{ photos: string[] }>(`/api/entries/${id}/photos`, { method: 'POST', body: form });
  },

  // 留言（會員對自己的紀錄）
  getComments: (target: CommentTarget) =>
    request<EntryComment[]>(`/api/comments?target=${encodeURIComponent(target)}`),
  postComment: (target: CommentTarget, body: string) =>
    request<EntryComment[]>('/api/comments', { method: 'POST', body: JSON.stringify({ target, body }) }),
  deleteComment: (id: number) => request<void>(`/api/comments/${id}`, { method: 'DELETE' }),

  getGoals: () => request<Goal[]>('/api/goals'),
  createGoal: (goal: GoalInput) =>
    request<Goal>('/api/goals', { method: 'POST', body: JSON.stringify(goal) }),
  updateGoal: (id: number, goal: GoalInput) =>
    request<Goal>(`/api/goals/${id}`, { method: 'PUT', body: JSON.stringify(goal) }),
  deleteGoal: (id: number) => request<void>(`/api/goals/${id}`, { method: 'DELETE' }),

  getTrend: (field: string, limit = 30) =>
    request<{ points: TrendPoint[] }>(`/api/body-trend?field=${field}&limit=${limit}`),

  // 管理者後台
  adminUsers: () => request<AdminUser[]>('/api/admin/users'),
  adminApprove: (id: number) => request<AdminUser>(`/api/admin/users/${id}/approve`, { method: 'POST' }),
  adminPatchUser: (id: number, patch: { role?: Role; status?: 'pending' | 'active' }) =>
    request<AdminUser>(`/api/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  adminDeleteUser: (id: number) => request<void>(`/api/admin/users/${id}`, { method: 'DELETE' }),

  // 營養師
  proMembers: () => request<MemberInfo[]>('/api/pro/members'),
  proDay: (memberId: number, date: string) => request<DayData>(`/api/pro/members/${memberId}/days/${date}`),
  proMarks: (memberId: number, from: string, to: string) =>
    request<{ dates: string[] }>(`/api/pro/members/${memberId}/marks?from=${from}&to=${to}`),
  proEditFood: (memberId: number, entryId: number, food: Food) =>
    request<Entry>(`/api/pro/members/${memberId}/entries/${entryId}/food`, {
      method: 'PUT',
      body: JSON.stringify({ food }),
    }),
  proRatePhoto: (memberId: number, entryId: number, photo: string, rating: PhotoRating | null) =>
    request<{ ratings: Partial<Record<string, PhotoRating>> }>(`/api/pro/members/${memberId}/entries/${entryId}/photo-rating`, {
      method: 'PUT',
      body: JSON.stringify({ photo, rating }),
    }),
  proComments: (memberId: number, target: CommentTarget) =>
    request<EntryComment[]>(`/api/pro/members/${memberId}/comments?target=${encodeURIComponent(target)}`),
  proPostComment: (memberId: number, target: CommentTarget, body: string) =>
    request<EntryComment[]>(`/api/pro/members/${memberId}/comments`, { method: 'POST', body: JSON.stringify({ target, body }) }),
  proDeleteComment: (memberId: number, id: number) =>
    request<void>(`/api/pro/members/${memberId}/comments/${id}`, { method: 'DELETE' }),
  proGoals: (memberId: number) => request<Goal[]>(`/api/pro/members/${memberId}/goals`),
  proCreateGoal: (memberId: number, goal: GoalInput) =>
    request<Goal>(`/api/pro/members/${memberId}/goals`, { method: 'POST', body: JSON.stringify(goal) }),
  proUpdateGoal: (memberId: number, goalId: number, goal: GoalInput) =>
    request<Goal>(`/api/pro/members/${memberId}/goals/${goalId}`, { method: 'PUT', body: JSON.stringify(goal) }),
  proDeleteGoal: (memberId: number, goalId: number) =>
    request<void>(`/api/pro/members/${memberId}/goals/${goalId}`, { method: 'DELETE' }),
};
