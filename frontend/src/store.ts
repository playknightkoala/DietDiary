import { create } from 'zustand';
import { api, clearAuth, getRole, getToken, getUsername, saveAuth, saveRole, setUnauthorizedHandler } from './lib/api';
import { isOutdated } from './lib/version';
import { addDays, dstr, emptyDay, weekOf } from './lib/domain';
import type { BodyTrendRow, DayData, Goal, NotificationItem, Profile, Role } from './types';

export type ModalKey =
  | 'add' | 'logFood' | 'logWater' | 'logEx' | 'logBody'
  | 'calendar' | 'goals' | 'account' | 'notify' | 'layout' | 'bodyView' | null;

// ---- 主頁總覽卡片自定義（順序＋顯示與否；存在此裝置的 localStorage）----
// 身體數據已移到獨立視窗（漢堡選單 → 身體數據），不在主頁卡片清單內
export type CardKey = 'kcal' | 'water' | 'macro' | 'groups';
export interface LayoutConfig { order: CardKey[]; hidden: CardKey[] }
export const DEFAULT_CARD_ORDER: CardKey[] = ['kcal', 'water', 'macro', 'groups'];
const LAYOUT_KEY = 'dd_layout';

// 清洗任意來源（localStorage／伺服器）的設定：只留合法卡片鍵、缺漏的補到最後（升級後新增卡片自動出現）
function sanitizeLayout(raw: unknown): LayoutConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as { order?: unknown; hidden?: unknown };
  const valid = (v: unknown): v is CardKey => typeof v === 'string' && (DEFAULT_CARD_ORDER as string[]).includes(v);
  const order = Array.isArray(r.order) ? r.order.filter(valid) : [];
  for (const k of DEFAULT_CARD_ORDER) if (!order.includes(k)) order.push(k);
  const hidden = Array.isArray(r.hidden) ? r.hidden.filter(valid) : [];
  return { order, hidden };
}

// 開機先用本地快取（登入後 loadMe 會以伺服器儲存的為準）
function loadLayout(): LayoutConfig {
  try {
    return sanitizeLayout(JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}'));
  } catch {
    return sanitizeLayout({});
  }
}

const isDefaultLayout = (l: LayoutConfig) => !l.hidden.length && l.order.join() === DEFAULT_CARD_ORDER.join();

function cacheLayout(layout: LayoutConfig) {
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch { /* 私密模式等寫入失敗：僅本次生效 */ }
}

// diary＝個人日記；admin＝管理者後台；pro＝營養師頁面
export type ViewKey = 'diary' | 'admin' | 'pro';

interface AppState {
  token: string | null;
  username: string | null;
  role: Role;
  // null＝尚未載入（loadMe 完成前不觸發強制設定暱稱）；''＝未設定
  nickname: string | null;
  // 目前登入者是否被開放 AI 功能（由 loadMe 取得）
  aiEnabled: boolean;
  view: ViewKey;

  selected: string;
  weekAnchor: string;
  modal: ModalKey;
  editingId: number | null;
  calMonth: { y: number; m: number } | null;
  // 指南為獨立疊加層（不佔 modal 狀態），可蓋在任何視窗或畫面上
  guideOpen: boolean;
  guideTab: number;
  // 營養師點通知後要聚焦的會員貼文（DietitianScreen 讀取後清除）
  proFocus: { memberId: number; date: string; target: string } | null;
  trendOpen: boolean;

  day: DayData;
  marks: Record<string, true>;
  goals: Goal[];
  // 身體數據歷程紀錄（所有指標、以量測日對齊，舊→新）
  trendRows: BodyTrendRow[];
  // TDEE 基本資料＋最近體重（null＝尚未載入）
  profile: Profile | null;
  notifications: NotificationItem[];
  unreadCount: number;

  // 改版後強制更新：伺服器版號較新時為 true，App 會蓋上不可關閉的更新視窗
  updateRequired: boolean;
  latestVersion: string | null;
  checkVersion: () => Promise<void>;

  loginSuccess: (token: string, username: string, role: Role, persist: boolean) => void;
  logout: () => void;
  setView: (view: ViewKey) => void;

  selectDate: (date: string, setAnchor?: boolean) => void;
  prevWeek: () => void;
  nextWeek: () => void;
  goToday: () => void;

  loadDay: () => Promise<void>;
  loadWeekMarks: () => Promise<void>;
  loadMonthMarks: (y: number, m: number) => Promise<void>;
  // mutation 已回傳完整 DayData 時直接寫回，省掉 refresh() 的 day＋marks 重抓
  replaceDay: (date: string, day: DayData) => void;
  markDate: (date: string, hasData: boolean) => void;
  refresh: () => Promise<void>;
  loadGoals: () => Promise<void>;
  loadTrend: () => Promise<void>;
  loadProfile: () => Promise<void>;
  setProfile: (p: Profile) => void;
  setNickname: (nickname: string) => void;
  loadNotifications: () => Promise<void>;
  readNotification: (id: number) => Promise<void>;
  readAllNotifications: () => Promise<void>;
  loadMe: () => Promise<void>;
  loadAll: () => Promise<void>;

  // 主頁卡片自定義（順序＋顯示與否）
  layout: LayoutConfig;
  setLayout: (layout: LayoutConfig) => void;

  // 從身體數據總覽開啟記錄視窗＝true：記錄視窗「上一步／完成／✕」後回到總覽，而不是直接關閉
  logBodyReturn: boolean;
  openLogBody: (fromBodyView?: boolean) => void;

  setModal: (modal: ModalKey) => void;
  openLogFood: (entryId: number) => Promise<void>;
  openCalendar: () => void;
  closeModal: () => void;
  openGuide: (tab?: number) => void;
  closeGuide: () => void;
  openProPost: (memberId: number, date: string, target: string) => void;
  clearProFocus: () => void;
  setGuideTab: (i: number) => void;
  setTrendOpen: (open: boolean) => void;
  setCalMonth: (cm: { y: number; m: number }) => void;
}

export const useStore = create<AppState>((set, get) => ({
  token: getToken(),
  username: getUsername(),
  role: getRole(),
  nickname: null,
  aiEnabled: false,
  view: 'diary',

  selected: dstr(new Date()),
  weekAnchor: dstr(new Date()),
  modal: null,
  editingId: null,
  calMonth: null,
  guideOpen: false,
  guideTab: 0,
  proFocus: null,
  trendOpen: false,

  day: emptyDay(),
  marks: {},
  goals: [],
  trendRows: [],
  profile: null,
  notifications: [],
  unreadCount: 0,

  updateRequired: false,
  latestVersion: null,
  checkVersion: async () => {
    if (get().updateRequired) return; // 已判定需更新就不再打擾
    try {
      const { version } = await api.getVersion();
      if (isOutdated(version)) set({ updateRequired: true, latestVersion: version });
    } catch { /* 靜默失敗，下次輪詢再試 */ }
  },

  loginSuccess: (token, username, role, persist) => {
    saveAuth(token, username, role, persist);
    set({ token, username, role, nickname: null, aiEnabled: false, view: 'diary' });
    void get().loadAll();
  },
  logout: () => {
    void api.serverLogout().catch(() => {}); // 清照片 cookie（失敗不擋登出）
    clearAuth();
    // 介面自定義跟帳號走：登出清掉本地快取，避免下一個登入的帳號繼承到別人的排列
    try { localStorage.removeItem(LAYOUT_KEY); } catch { /* ignore */ }
    set({
      token: null, username: null, role: 'member', nickname: null, aiEnabled: false, view: 'diary', modal: null, editingId: null,
      day: emptyDay(), marks: {}, goals: [], trendRows: [], profile: null, notifications: [], unreadCount: 0,
      trendOpen: false, guideOpen: false, proFocus: null, selected: dstr(new Date()), weekAnchor: dstr(new Date()),
      layout: { order: [...DEFAULT_CARD_ORDER], hidden: [] },
    });
  },
  setView: (view) => set({ view, modal: null, editingId: null, calMonth: null, guideOpen: false, logBodyReturn: false }),

  selectDate: (date, setAnchor = false) => {
    set(setAnchor ? { selected: date, weekAnchor: date } : { selected: date });
    void get().loadDay();
    if (setAnchor) void get().loadWeekMarks();
  },
  prevWeek: () => {
    set((s) => ({ weekAnchor: addDays(s.weekAnchor, -7) }));
    void get().loadWeekMarks();
  },
  nextWeek: () => {
    set((s) => ({ weekAnchor: addDays(s.weekAnchor, 7) }));
    void get().loadWeekMarks();
  },
  goToday: () => {
    const today = dstr(new Date());
    get().selectDate(today, true);
  },

  loadDay: async () => {
    const { selected } = get();
    const day = await api.getDay(selected);
    // 避免慢速回應覆蓋掉已切換的日期
    if (get().selected === selected) set({ day });
  },
  loadWeekMarks: async () => {
    const week = weekOf(get().weekAnchor);
    const { dates } = await api.getMarks(week[0], week[6]);
    set((s) => {
      const marks = { ...s.marks };
      week.forEach((d) => delete marks[d]);
      dates.forEach((d) => (marks[d] = true));
      return { marks };
    });
  },
  loadMonthMarks: async (y, m) => {
    const from = dstr(new Date(y, m, 1));
    const to = dstr(new Date(y, m + 1, 0));
    const { dates } = await api.getMarks(from, to);
    set((s) => {
      const marks = { ...s.marks };
      const dim = new Date(y, m + 1, 0).getDate();
      for (let n = 1; n <= dim; n++) delete marks[dstr(new Date(y, m, n))];
      dates.forEach((d) => (marks[d] = true));
      return { marks };
    });
  },
  replaceDay: (date, day) => {
    // 只在仍停留於該日期時替換，避免蓋掉已切換的畫面
    if (get().selected === date) set({ day });
  },
  markDate: (date, hasData) => {
    set((s) => {
      if (!!s.marks[date] === hasData) return s;
      const marks = { ...s.marks };
      if (hasData) marks[date] = true;
      else delete marks[date];
      return { marks };
    });
  },
  refresh: async () => {
    await Promise.all([get().loadDay(), get().loadWeekMarks()]);
  },
  loadGoals: async () => {
    const goals = await api.getGoals();
    set({ goals });
  },
  loadTrend: async () => {
    const { rows } = await api.getBodyTrend();
    set({ trendRows: rows });
  },
  loadProfile: async () => {
    const profile = await api.getProfile();
    set({ profile });
  },
  setProfile: (profile) => set({ profile }),
  loadNotifications: async () => {
    try {
      const { unread, items } = await api.getNotifications();
      set({ notifications: items, unreadCount: unread });
    } catch { /* 靜默失敗，下次輪詢再試 */ }
  },
  readNotification: async (id) => {
    set((s) => {
      const wasUnread = s.notifications.some((n) => n.id === id && !n.read);
      return {
        notifications: s.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)),
        unreadCount: wasUnread ? Math.max(0, s.unreadCount - 1) : s.unreadCount,
      };
    });
    try { await api.markNotificationsRead([id]); } catch { /* ignore */ }
  },
  readAllNotifications: async () => {
    set((s) => ({ notifications: s.notifications.map((n) => ({ ...n, read: true })), unreadCount: 0 }));
    try { await api.markNotificationsRead(); } catch { /* ignore */ }
  },
  setNickname: (nickname) => set({ nickname }),
  // 同步最新角色（管理者可能事後調整角色）
  loadMe: async () => {
    try {
      const me = await api.me();
      saveRole(me.role);
      set({ role: me.role, username: me.username, nickname: me.nickname, aiEnabled: me.aiEnabled });
      // 介面自定義跟帳號走：伺服器有存就以伺服器為準（並更新本地快取）；
      // 伺服器沒存但這台裝置有自訂（升級前的舊設定），補上傳同步
      if (me.uiLayout) {
        try {
          const layout = sanitizeLayout(JSON.parse(me.uiLayout));
          set({ layout });
          cacheLayout(layout);
        } catch { /* 壞資料忽略，維持本地設定 */ }
      } else if (!isDefaultLayout(get().layout)) {
        void api.putLayout(get().layout).catch(() => {});
      }
    } catch { /* 401 由共用 handler 處理 */ }
  },
  loadAll: async () => {
    // photo cookie 先補（照片 <img> 需要它；升級前已登入的 session 沒有），其餘並行載入
    await Promise.all([api.refreshPhotoCookie().catch(() => {}), get().loadDay(), get().loadWeekMarks(), get().loadGoals(), get().loadMe(), get().loadNotifications(), get().loadProfile()]);
  },

  layout: loadLayout(),
  setLayout: (layout) => {
    set({ layout });
    cacheLayout(layout);
    // 同步存到帳號（伺服器），換裝置登入自動帶入；失敗不擋操作（本地仍生效，下次修改再同步）
    void api.putLayout(layout).catch(() => {});
  },

  logBodyReturn: false,
  openLogBody: (fromBodyView = false) => set({ modal: 'logBody', logBodyReturn: fromBodyView }),

  setModal: (modal) => set({ modal }),
  // 開啟記餐編輯視窗前，先向伺服器抓最新當日資料再打開：
  // 編輯視窗會把 store 裡的紀錄快照成本地狀態、按「完成」時整筆寫回，
  // 若這台裝置的資料已過時（例如另一台裝置剛改過份數或敘述），舊快照會把對方的修改整筆蓋掉。
  openLogFood: async (entryId) => {
    const sel = get().selected; // await 前先固定日期：請求期間若切換日期，避免把舊日資料寫進新日
    try {
      const day = await api.getDay(sel);
      if (get().selected !== sel) return; // 已切到別天，放棄開啟
      get().replaceDay(sel, day);
      if (!day.entries.some((e) => e.id === entryId)) return; // 這筆已在別台裝置刪除
    } catch { /* 離線或暫時失敗：仍以現有資料開啟，不擋記錄 */ }
    set({ modal: 'logFood', editingId: entryId });
  },
  openCalendar: () => {
    const sel = get().selected;
    const [y, m] = sel.split('-').map(Number);
    set({ modal: 'calendar', calMonth: { y, m: m - 1 } });
    void get().loadMonthMarks(y, m - 1);
  },
  closeModal: () => set({ modal: null, editingId: null, calMonth: null, logBodyReturn: false }),
  openGuide: (tab = 0) => set({ guideOpen: true, guideTab: tab }),
  closeGuide: () => set({ guideOpen: false }),
  // 營養師點通知：切到營養師頁並聚焦該會員的該則貼文
  openProPost: (memberId, date, target) =>
    set({ view: 'pro', modal: null, editingId: null, calMonth: null, guideOpen: false, proFocus: { memberId, date, target } }),
  clearProFocus: () => set({ proFocus: null }),
  setGuideTab: (guideTab) => set({ guideTab }),
  setTrendOpen: (trendOpen) => {
    set({ trendOpen });
    if (trendOpen) void get().loadTrend();
  },
  setCalMonth: (calMonth) => {
    set({ calMonth });
    void get().loadMonthMarks(calMonth.y, calMonth.m);
  },
}));

setUnauthorizedHandler(() => {
  useStore.getState().logout();
});
