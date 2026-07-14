import { create } from 'zustand';
import { api, clearAuth, getRole, getToken, getUsername, saveAuth, saveRole, setUnauthorizedHandler } from './lib/api';
import { addDays, dstr, emptyDay, weekOf } from './lib/domain';
import type { BodyKey, DayData, Goal, Role, TrendPoint } from './types';

export type ModalKey =
  | 'add' | 'logFood' | 'logWater' | 'logEx' | 'logBody'
  | 'calendar' | 'goals' | 'account' | null;

// diary＝個人日記；admin＝管理者後台；pro＝營養師頁面
export type ViewKey = 'diary' | 'admin' | 'pro';

interface AppState {
  token: string | null;
  username: string | null;
  role: Role;
  view: ViewKey;

  selected: string;
  weekAnchor: string;
  modal: ModalKey;
  editingId: number | null;
  calMonth: { y: number; m: number } | null;
  // 指南為獨立疊加層（不佔 modal 狀態），可蓋在任何視窗或畫面上
  guideOpen: boolean;
  guideTab: number;
  trendOpen: boolean;
  trendField: BodyKey;

  day: DayData;
  marks: Record<string, true>;
  goals: Goal[];
  trendPoints: TrendPoint[];

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
  refresh: () => Promise<void>;
  loadGoals: () => Promise<void>;
  loadTrend: () => Promise<void>;
  loadMe: () => Promise<void>;
  loadAll: () => Promise<void>;

  setModal: (modal: ModalKey) => void;
  openLogFood: (entryId: number) => void;
  openCalendar: () => void;
  closeModal: () => void;
  openGuide: (tab?: number) => void;
  closeGuide: () => void;
  setGuideTab: (i: number) => void;
  setTrendOpen: (open: boolean) => void;
  setTrendField: (f: BodyKey) => void;
  setCalMonth: (cm: { y: number; m: number }) => void;
}

export const useStore = create<AppState>((set, get) => ({
  token: getToken(),
  username: getUsername(),
  role: getRole(),
  view: 'diary',

  selected: dstr(new Date()),
  weekAnchor: dstr(new Date()),
  modal: null,
  editingId: null,
  calMonth: null,
  guideOpen: false,
  guideTab: 0,
  trendOpen: false,
  trendField: 'weight',

  day: emptyDay(),
  marks: {},
  goals: [],
  trendPoints: [],

  loginSuccess: (token, username, role, persist) => {
    saveAuth(token, username, role, persist);
    set({ token, username, role, view: 'diary' });
    void get().loadAll();
  },
  logout: () => {
    clearAuth();
    set({
      token: null, username: null, role: 'member', view: 'diary', modal: null, editingId: null,
      day: emptyDay(), marks: {}, goals: [], trendPoints: [],
      trendOpen: false, guideOpen: false, selected: dstr(new Date()), weekAnchor: dstr(new Date()),
    });
  },
  setView: (view) => set({ view, modal: null, editingId: null, calMonth: null, guideOpen: false }),

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
  refresh: async () => {
    await Promise.all([get().loadDay(), get().loadWeekMarks()]);
  },
  loadGoals: async () => {
    const goals = await api.getGoals();
    set({ goals });
  },
  loadTrend: async () => {
    const { points } = await api.getTrend(get().trendField);
    set({ trendPoints: points });
  },
  // 同步最新角色（管理者可能事後調整角色）
  loadMe: async () => {
    try {
      const me = await api.me();
      saveRole(me.role);
      set({ role: me.role, username: me.username });
    } catch { /* 401 由共用 handler 處理 */ }
  },
  loadAll: async () => {
    await Promise.all([get().loadDay(), get().loadWeekMarks(), get().loadGoals(), get().loadMe()]);
  },

  setModal: (modal) => set({ modal }),
  openLogFood: (entryId) => set({ modal: 'logFood', editingId: entryId }),
  openCalendar: () => {
    const sel = get().selected;
    const [y, m] = sel.split('-').map(Number);
    set({ modal: 'calendar', calMonth: { y, m: m - 1 } });
    void get().loadMonthMarks(y, m - 1);
  },
  closeModal: () => set({ modal: null, editingId: null, calMonth: null }),
  openGuide: (tab = 0) => set({ guideOpen: true, guideTab: tab }),
  closeGuide: () => set({ guideOpen: false }),
  setGuideTab: (guideTab) => set({ guideTab }),
  setTrendOpen: (trendOpen) => {
    set({ trendOpen });
    if (trendOpen) void get().loadTrend();
  },
  setTrendField: (trendField) => {
    set({ trendField });
    void get().loadTrend();
  },
  setCalMonth: (calMonth) => {
    set({ calMonth });
    void get().loadMonthMarks(calMonth.y, calMonth.m);
  },
}));

setUnauthorizedHandler(() => {
  useStore.getState().logout();
});
