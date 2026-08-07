import type { AdminUser, BodyTrendRow, CommentTarget, CustomItem, DayData, Entry, EntryComment, EntryFoodItem, Food, Goal, GoalInput, HistoryMeal, InbodyResult, MealKey, MemberInfo, NotificationItem, PhotoRating, Profile, Role } from '../types';

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
  return r === 'admin' || r === 'dietitian' || r === 'citizen' ? r : 'member';
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
  // 目前部署的版號（供強制更新機制比對）
  getVersion: () => request<{ version: string }>('/api/version'),

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
  verifyCode: (email: string, code: string) =>
    request<{ ok: true }>('/api/auth/verify-code', {
      method: 'POST',
      body: JSON.stringify({ email, code }),
    }),
  // 忘記密碼：寄重設認證碼（帳號不存在／未開通時後端靜默回成功）→ 驗證後重設
  forgotSendCode: (email: string, captchaId: string) =>
    request<{ ok: true }>('/api/auth/forgot/send-code', {
      method: 'POST',
      body: JSON.stringify({ email, captchaId }),
    }),
  forgotReset: (email: string, code: string, newPassword: string, confirmPassword: string) =>
    request<{ ok: true }>('/api/auth/forgot/reset', {
      method: 'POST',
      body: JSON.stringify({ email, code, newPassword, confirmPassword }),
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
  me: () => request<{ username: string; role: Role; nickname: string; aiEnabled: boolean; createdAt: string }>('/api/auth/me'),
  // 照片存取 cookie：/uploads 需驗證（<img> 無法帶 header）。登入回應會設，
  // 啟動時再補呼叫一次，讓「升級前已登入」的 session 也拿得到
  refreshPhotoCookie: () => request<void>('/api/auth/photo-cookie', { method: 'POST' }),
  // 登出時清照片 cookie（token 由前端自行丟棄）
  serverLogout: () => request<void>('/api/auth/logout', { method: 'POST' }),
  setNickname: (nickname: string) =>
    request<{ ok: true; nickname: string }>('/api/auth/nickname', { method: 'POST', body: JSON.stringify({ nickname }) }),
  changePassword: (oldPassword: string, newPassword: string, confirmPassword: string) =>
    request<{ ok: true }>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ oldPassword, newPassword, confirmPassword }),
    }),

  getDay: (date: string) => request<DayData>(`/api/days/${date}`),
  patchDay: (
    date: string,
    patch: { body?: DayData['body']; bodyTime?: string }
  ) => request<DayData>(`/api/days/${date}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  // 逐筆喝水紀錄：新增一筆／刪除一筆／整天歸零
  addWater: (date: string, ml: number, time: string) =>
    request<DayData>(`/api/days/${date}/water`, { method: 'POST', body: JSON.stringify({ ml, time }) }),
  deleteWaterLog: (date: string, id: number) =>
    request<DayData>(`/api/days/${date}/water/${id}`, { method: 'DELETE' }),
  resetWater: (date: string) => request<DayData>(`/api/days/${date}/water`, { method: 'DELETE' }),
  // 逐筆運動紀錄：新增一筆／刪除一筆（連同留言）
  addEx: (date: string, log: { min: string; desc: string; time: string }) =>
    request<DayData>(`/api/days/${date}/ex`, { method: 'POST', body: JSON.stringify(log) }),
  deleteExLog: (date: string, id: number) =>
    request<DayData>(`/api/days/${date}/ex/${id}`, { method: 'DELETE' }),
  getMarks: (from: string, to: string) =>
    request<{ dates: string[] }>(`/api/days/marks?from=${from}&to=${to}`),

  createEntry: (date: string, meal: MealKey, eatTime?: string) =>
    request<Entry>(`/api/days/${date}/entries`, { method: 'POST', body: JSON.stringify({ meal, eatTime }) }),
  patchEntry: (id: number, patch: { desc?: string; food?: Food; photoFoods?: Record<string, Food>; photoCustoms?: Record<string, CustomItem[]>; items?: EntryFoodItem[]; photos?: string[]; date?: string; eatTime?: string }) =>
    request<Entry>(`/api/entries/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteEntry: (id: number) => request<void>(`/api/entries/${id}`, { method: 'DELETE' }),
  uploadPhotos: (id: number, blobs: Blob[]) => {
    const form = new FormData();
    blobs.forEach((b, i) => form.append('photos', b, `photo-${i}.jpg`));
    return request<{ photos: string[] }>(`/api/entries/${id}/photos`, { method: 'POST', body: form });
  },
  // 從歷史加入：最近記過的餐（新→舊，以原始紀錄分組）；limit 為每餐別的餐卡上限
  entryHistory: (excludeId?: number, limit = 30) =>
    request<HistoryMeal[]>(`/api/entries/history?limit=${limit}${excludeId ? `&exclude=${excludeId}` : ''}`),
  // 最近記過的「自訂名稱＋大卡」自定義項目（快速再次加入）
  customItemHistory: () => request<{ name: string; kcal: number }[]>('/api/entries/custom-history'),
  // 把一張歷史照片複製到目前這筆紀錄，回傳更新後的照片清單與新照片 URL
  copyPhoto: (id: number, photo: string) =>
    request<{ photos: string[]; photo: string }>(`/api/entries/${id}/photos/copy`, {
      method: 'POST',
      body: JSON.stringify({ photo }),
    }),

  // 留言（會員對自己的紀錄）
  getComments: (target: CommentTarget) =>
    request<EntryComment[]>(`/api/comments?target=${encodeURIComponent(target)}`),
  postComment: (target: CommentTarget, body: string) =>
    request<EntryComment[]>('/api/comments', { method: 'POST', body: JSON.stringify({ target, body }) }),
  editComment: (id: number, body: string) =>
    request<EntryComment[]>(`/api/comments/${id}`, { method: 'PATCH', body: JSON.stringify({ body }) }),
  deleteComment: (id: number) => request<void>(`/api/comments/${id}`, { method: 'DELETE' }),

  // 通知（營養師留言／照片評分／調整份數）
  getNotifications: () => request<{ unread: number; items: NotificationItem[] }>('/api/notifications'),
  markNotificationsRead: (ids?: number[]) =>
    request<{ ok: true }>('/api/notifications/read', { method: 'POST', body: JSON.stringify(ids ? { ids } : {}) }),

  getGoals: () => request<Goal[]>('/api/goals'),
  createGoal: (goal: GoalInput) =>
    request<Goal>('/api/goals', { method: 'POST', body: JSON.stringify(goal) }),
  updateGoal: (id: number, goal: GoalInput) =>
    request<Goal>(`/api/goals/${id}`, { method: 'PUT', body: JSON.stringify(goal) }),
  deleteGoal: (id: number) => request<void>(`/api/goals/${id}`, { method: 'DELETE' }),

  // TDEE 基本資料（身高／出生年／性別／活動量）＋最近一次體重
  getProfile: () => request<Profile>('/api/profile'),
  putProfile: (p: Omit<Profile, 'weight'>) =>
    request<Profile>('/api/profile', { method: 'PUT', body: JSON.stringify(p) }),

  // 身體數據歷程紀錄：所有指標一次取回、以量測日對齊（舊→新）
  getBodyTrend: (limit = 30) =>
    request<{ rows: BodyTrendRow[] }>(`/api/body-trend?field=all&limit=${limit}`),

  // 管理者後台
  adminUsers: () => request<AdminUser[]>('/api/admin/users'),
  adminApprove: (id: number) => request<AdminUser>(`/api/admin/users/${id}/approve`, { method: 'POST' }),
  adminPatchUser: (id: number, patch: { role?: Role; status?: 'pending' | 'active'; aiEnabled?: boolean }) =>
    request<AdminUser>(`/api/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  // AI 功能（需管理者開放）：判斷單張照片的營養素份數、對貼文產生 AI 評語
  aiOcr: (entryId: number, photo: string) =>
    request<{
      food: Food;
      caption: string;
      model: string;
      // 共用知識庫命中的相似菜色（未啟用或未命中為 null）
      kb: { dishId: number; caption: string; food: Record<string, number>; up: number; down: number } | null;
      // 品牌品項且 KB 未命中時，份數已依網路營養資訊校正（未觸發為 null）
      web: { query: string; sources: { title: string; url: string }[] } | null;
    }>('/api/ai/ocr', { method: 'POST', body: JSON.stringify({ entryId, photo }) }),
  // 辨識 InBody 報告照片（照片僅供辨識、不儲存），回傳數值與前次量測供比較
  aiInbody: (image: string) =>
    request<InbodyResult>('/api/ai/inbody', { method: 'POST', body: JSON.stringify({ image }) }),
  // 營養師查詢輔助：問題 → 網路搜尋 → AI 整理成含來源的摘要（營養師／管理者）
  aiResearch: (question: string) =>
    request<{ answer: string; sources: { title: string; url: string }[]; model: string }>('/api/ai/research', {
      method: 'POST',
      body: JSON.stringify({ question }),
    }),
  aiComment: (target: CommentTarget) =>
    request<EntryComment[]>('/api/ai/comment', { method: 'POST', body: JSON.stringify({ target }) }),
  // AI 今日總評：針對某天產生整天綜合評語，存為當天一則 AI 動態，回傳更新後的當日資料
  aiDaily: (date: string) =>
    request<DayData>('/api/ai/daily', { method: 'POST', body: JSON.stringify({ date }) }),
  // AI 評價：對某則 AI 產出按讚(1)／倒讚(-1)／取消(0)。
  // kind：comment(ref=留言id)｜daily(ref=日期)｜ocr_caption/ocr_food(ref=照片url，body 帶內容快照)
  // ocr_food 若對應知識庫某道菜，帶 dishId 以累計該菜的讚/倒讚
  aiFeedback: (
    kind: 'comment' | 'daily' | 'ocr_caption' | 'ocr_food',
    ref: string,
    vote: 1 | 0 | -1,
    opts?: { body?: string; dishId?: number }
  ) =>
    request<{ vote: number }>('/api/ai/feedback', {
      method: 'POST',
      body: JSON.stringify({ kind, ref, vote, ...opts }),
    }),
  adminResetPassword: (id: number, password: string) =>
    request<{ ok: true }>(`/api/admin/users/${id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),
  adminDeleteUser: (id: number) => request<void>(`/api/admin/users/${id}`, { method: 'DELETE' }),

  // 營養師
  proMembers: () => request<MemberInfo[]>('/api/pro/members'),
  proSetAlias: (memberId: number, alias: string) =>
    request<{ ok: true; alias: string }>(`/api/pro/members/${memberId}/alias`, { method: 'PUT', body: JSON.stringify({ alias }) }),
  proSetFollow: (memberId: number, follow: boolean) =>
    request<{ ok: true; followed: boolean }>(`/api/pro/members/${memberId}/follow`, { method: 'PUT', body: JSON.stringify({ follow }) }),
  proDay: (memberId: number, date: string) => request<DayData>(`/api/pro/members/${memberId}/days/${date}`),
  proMarks: (memberId: number, from: string, to: string) =>
    request<{ dates: string[] }>(`/api/pro/members/${memberId}/marks?from=${from}&to=${to}`),
  proEditFood: (memberId: number, entryId: number, payload: { food?: Food; photoFoods?: Record<string, Food>; photoCustoms?: Record<string, CustomItem[]>; items?: EntryFoodItem[] }) =>
    request<Entry>(`/api/pro/members/${memberId}/entries/${entryId}/food`, {
      method: 'PUT',
      body: JSON.stringify(payload),
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
  proEditComment: (memberId: number, id: number, body: string) =>
    request<EntryComment[]>(`/api/pro/members/${memberId}/comments/${id}`, { method: 'PATCH', body: JSON.stringify({ body }) }),
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
