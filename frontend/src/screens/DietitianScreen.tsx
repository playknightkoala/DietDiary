import { useCallback, useEffect, useRef, useState, type CSSProperties, type Dispatch, type SetStateAction } from 'react';
import { api } from '../lib/api';
import { useStore } from '../store';
import { BODY_DEFS, FOOD_KEYS, MEALS, WD_NAMES, addDays, bmrTdeeOf, clampPortion, customDraftsKcal, customDraftsToItems, customItemLabel, customItemsKcal, customItemsToDrafts, dayCustomKcal, dayFoodTotals, dstr, emptyFood, entryAllCustoms, entryHasData, entryKcal, entryMacros, fmtCommentTime, foodSummary, goalsFor, kcalOfFood, photoFoodOf, round1, sortEntriesNewestFirst, sumFoods, type CustomDraft } from '../lib/domain';
import { DietitianBadge, GoalManager } from '../components/GoalManager';
import { PhotoRatingBadge, RATING_DEFS, RATING_KEYS } from '../components/PhotoRatingBadge';
import { CommentsThread } from '../components/CommentsThread';
import { CustomItemsEditor, CustomItemsSummary, FoodFields, FoodSummaryGrid, MacroSummaryRow, OrigSummary } from '../components/FoodFields';
import { MacroPanel } from '../components/OverviewCards';
import { Lightbox } from '../components/Lightbox';
import { PickerInput } from '../components/PickerInput';
import { CloseButton, ModalShell } from '../components/modals/ModalShell';
import { NotificationsModal } from '../components/modals/NotificationsModal';
import type { CommentTarget, CustomItem, DayData, Entry, Food, FoodKey, Goal, GoalKey, MemberInfo, PhotoRating, Profile } from '../types';

const cardStyle: CSSProperties = {
  background: '#FFFFFF', borderRadius: 20, border: '1.5px solid #E4DFD2', padding: 18,
  display: 'flex', flexDirection: 'column', gap: 12,
};

const GROUP_ROWS: { name: string; gkey: GoalKey; keys: FoodKey[]; color: string }[] = [
  { name: '蛋豆魚肉', gkey: 'meat', keys: ['meatLow', 'meatMed', 'meatHigh', 'meatXHigh'], color: '#C0564A' },
  { name: '蔬菜', gkey: 'veg', keys: ['veg'], color: '#4A7C59' },
  { name: '全穀雜糧', gkey: 'grain', keys: ['grain'], color: '#A8842E' },
  { name: '油脂堅果', gkey: 'oil', keys: ['oil'], color: '#C77B4A' },
  { name: '水果', gkey: 'fruit', keys: ['fruit'], color: '#B5537A' },
  { name: '乳品', gkey: 'milk', keys: ['milkSkim', 'milkLow', 'milkFull'], color: '#5B8DB8' },
];

export function DietitianScreen() {
  const setView = useStore((s) => s.setView);
  const role = useStore((s) => s.role);
  const modal = useStore((s) => s.modal);
  const setModal = useStore((s) => s.setModal);
  const unreadCount = useStore((s) => s.unreadCount);
  const proFocus = useStore((s) => s.proFocus);
  const clearProFocus = useStore((s) => s.clearProFocus);

  const todayStr = dstr(new Date());
  const [members, setMembers] = useState<MemberInfo[]>([]);
  const [memberId, setMemberId] = useState<number | ''>('');
  const [date, setDate] = useState(todayStr);
  const [day, setDay] = useState<DayData | null>(null);
  // 選定會員的 TDEE 基本資料＋最近體重（BMR/TDEE 顯示與熱量目標比對）
  const [memberProfile, setMemberProfile] = useState<Profile | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [marks, setMarks] = useState<Record<string, true>>({});
  const [calMonth, setCalMonth] = useState<{ y: number; m: number }>(() => {
    const [y, m] = todayStr.split('-').map(Number);
    return { y, m: m - 1 };
  });
  const [error, setError] = useState('');

  useEffect(() => {
    api.proMembers().then(setMembers).catch((e) => setError(e instanceof Error ? e.message : '載入會員清單失敗'));
  }, []);

  // 由通知跳轉而來：選定會員與日期，並記下要聚焦的貼文
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  useEffect(() => {
    if (!proFocus) return;
    setMemberId(proFocus.memberId);
    setDate(proFocus.date);
    const [y, m] = proFocus.date.split('-').map(Number);
    setCalMonth({ y, m: m - 1 });
    setFocusTarget(proFocus.target);
    clearProFocus();
  }, [proFocus, clearProFocus]);

  // 當日資料載入後捲動到聚焦的貼文
  useEffect(() => {
    if (!focusTarget || !day) return;
    const el = document.getElementById(`pro-post-${focusTarget}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // day 更新時執行一次即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day]);

  const loadGoals = useCallback(async (mid: number) => {
    setGoals(await api.proGoals(mid));
  }, []);

  const loadMarks = useCallback(async (mid: number, y: number, m: number) => {
    const from = dstr(new Date(y, m, 1));
    const to = dstr(new Date(y, m + 1, 0));
    const { dates } = await api.proMarks(mid, from, to);
    const next: Record<string, true> = {};
    dates.forEach((d) => (next[d] = true));
    setMarks(next);
  }, []);

  // 選定會員後載入其目標與當月標記
  useEffect(() => {
    if (memberId === '') return;
    setError('');
    Promise.all([loadGoals(memberId), loadMarks(memberId, calMonth.y, calMonth.m)]).catch((e) =>
      setError(e instanceof Error ? e.message : '載入會員資料失敗')
    );
  }, [memberId, calMonth, loadGoals, loadMarks]);

  // 選定會員後載入其 TDEE 基本資料（換會員先清空，避免顯示到上一位的 BMR/TDEE）
  useEffect(() => {
    setMemberProfile(null);
    if (memberId === '') return;
    let cancelled = false;
    api.proProfile(memberId)
      .then((p) => { if (!cancelled) setMemberProfile(p); })
      .catch(() => { /* 載入失敗就不顯示 BMR/TDEE，不擋其他資料 */ });
    return () => { cancelled = true; };
  }, [memberId]);

  // 選定會員＋日期後載入當日紀錄
  useEffect(() => {
    if (memberId === '') { setDay(null); return; }
    let cancelled = false;
    api.proDay(memberId, date)
      .then((d) => { if (!cancelled) setDay(d); })
      .catch((e) => setError(e instanceof Error ? e.message : '載入當日紀錄失敗'));
    return () => { cancelled = true; };
  }, [memberId, date]);

  // 照片評分：點同色再點一次＝取消
  const ratePhoto = async (entryId: number, photo: string, rating: PhotoRating, current: PhotoRating | undefined) => {
    if (memberId === '') return;
    try {
      const { ratings } = await api.proRatePhoto(memberId, entryId, photo, current === rating ? null : rating);
      setDay((d) => (d ? { ...d, entries: d.entries.map((en) => (en.id === entryId ? { ...en, ratings } : en)) } : d));
    } catch (e) {
      setError(e instanceof Error ? e.message : '評分失敗，請再試一次');
    }
  };

  const [lightbox, setLightbox] = useState<{ entryId: number; photos: string[]; index: number } | null>(null);
  const lightboxEntry = lightbox ? (day?.entries ?? []).find((en) => en.id === lightbox.entryId) : null;

  // 編輯會員某筆紀錄的份數與自定義項目（會標記「營養師調整」；只改自定義後端不會蓋章）。
  // 與記錄視窗相同的頁面模型：照片頁在前、無照片項目頁在後，每頁＝六大類份數＋自定義項目
  const [foodEditing, setFoodEditing] = useState<Entry | null>(null);
  const [pfStr, setPfStr] = useState<Record<string, Record<FoodKey, string>>>({});
  const [pcDrafts, setPcDrafts] = useState<Record<string, CustomDraft[]>>({});
  const itemSeq = useRef(0);
  const [itemState, setItemState] = useState<{ order: string[]; drafts: Record<string, { foodStr: Record<FoodKey, string>; customs: CustomDraft[] }> }>({ order: [], drafts: {} });
  const [editTab, setEditTab] = useState<'portions' | 'custom'>('portions');
  const [foodPage, setFoodPage] = useState(0);
  const [savingFood, setSavingFood] = useState(false);

  const toFoodStr = (f: Food): Record<FoodKey, string> => {
    const s = {} as Record<FoodKey, string>;
    FOOD_KEYS.forEach((k) => (s[k] = f[k] ? String(f[k]) : ''));
    return s;
  };
  const strToFood = (s: Record<FoodKey, string> | undefined) => {
    const f = emptyFood();
    if (s) FOOD_KEYS.forEach((k) => (f[k] = clampPortion(s[k] ?? '')));
    return f;
  };

  const openFoodEditor = (e: Entry) => {
    const pfInit: Record<string, Record<FoodKey, string>> = {};
    e.photos.forEach((url) => (pfInit[url] = toFoodStr(e.photoFoods[url] ?? emptyFood())));
    // 舊資料（有照片但沒逐張份數、也沒有 items）：把整筆份數先放到第一張，總和不變
    const hasAny = e.photos.some((url) => FOOD_KEYS.some((k) => (e.photoFoods[url]?.[k] ?? 0) > 0));
    if (e.photos.length && !hasAny && !e.items.length && FOOD_KEYS.some((k) => e.food[k] > 0)) {
      pfInit[e.photos[0]] = toFoodStr(e.food);
    }
    setPfStr(pfInit);
    const pcInit: Record<string, CustomDraft[]> = {};
    e.photos.forEach((url) => {
      const list = e.photoCustoms[url];
      if (list?.length) pcInit[url] = customItemsToDrafts(list);
    });
    setPcDrafts(pcInit);
    // 無照片項目頁；legacy（無照片、無 items、有整筆份數）視為一個項目
    const order: string[] = [];
    const drafts: Record<string, { foodStr: Record<FoodKey, string>; customs: CustomDraft[] }> = {};
    const addItem = (food: Food, customs: CustomDraft[]) => {
      const key = `i${itemSeq.current++}`;
      order.push(key);
      drafts[key] = { foodStr: toFoodStr(food), customs };
    };
    if (e.items.length) e.items.forEach((it) => addItem(it.food, customItemsToDrafts(it.customItems)));
    else if (!e.photos.length && FOOD_KEYS.some((k) => e.food[k] > 0)) addItem(e.food, []);
    setItemState({ order, drafts });
    setEditTab('portions');
    setFoodPage(0);
    setFoodEditing(e);
  };

  // 編輯器頁面：照片頁＋無照片項目頁
  type EditPage = { kind: 'photo'; url: string } | { kind: 'item'; key: string };
  const editPages: EditPage[] = foodEditing
    ? [
        ...foodEditing.photos.map((url): EditPage => ({ kind: 'photo', url })),
        ...itemState.order.map((key): EditPage => ({ kind: 'item', key })),
      ]
    : [];
  const editCur: EditPage | undefined = editPages[Math.min(foodPage, editPages.length - 1)];
  const editCurIdx = editPages.length ? Math.min(foodPage, editPages.length - 1) : 0;
  const editPageFood = (p: EditPage): Food =>
    p.kind === 'photo' ? strToFood(pfStr[p.url]) : strToFood(itemState.drafts[p.key]?.foodStr);
  const editPageCustoms = (p: EditPage): CustomDraft[] =>
    p.kind === 'photo' ? pcDrafts[p.url] ?? [] : itemState.drafts[p.key]?.customs ?? [];
  const addEditItemPage = () => {
    if (itemState.order.length >= 20) return;
    const key = `i${itemSeq.current++}`;
    setItemState((s) => ({ order: [...s.order, key], drafts: { ...s.drafts, [key]: { foodStr: toFoodStr(emptyFood()), customs: [] } } }));
    setFoodPage((foodEditing?.photos.length ?? 0) + itemState.order.length);
  };
  const removeEditItemPage = (key: string) => {
    setItemState((s) => {
      const drafts = { ...s.drafts };
      delete drafts[key];
      return { order: s.order.filter((k) => k !== key), drafts };
    });
    setFoodPage((p) => Math.max(0, Math.min(p, editPages.length - 2)));
  };
  const editPcSetter = (url: string): Dispatch<SetStateAction<CustomDraft[]>> => (action) =>
    setPcDrafts((s) => ({ ...s, [url]: typeof action === 'function' ? (action as (p: CustomDraft[]) => CustomDraft[])(s[url] ?? []) : action }));
  const editItemSetter = (key: string): Dispatch<SetStateAction<CustomDraft[]>> => (action) =>
    setItemState((s) => ({
      ...s,
      drafts: {
        ...s.drafts,
        [key]: {
          ...(s.drafts[key] ?? { foodStr: toFoodStr(emptyFood()), customs: [] }),
          customs: typeof action === 'function' ? (action as (p: CustomDraft[]) => CustomDraft[])(s.drafts[key]?.customs ?? []) : action,
        },
      },
    }));

  // 調整後總熱量＝所有頁面份數＋自定義項目
  const draftTotal = () => sumFoods(editPages.map(editPageFood));
  const draftCustomKcal = () => editPages.reduce((a, p) => a + customDraftsKcal(editPageCustoms(p)), 0);

  const saveFood = async () => {
    if (!foodEditing || memberId === '' || savingFood) return;
    setSavingFood(true);
    try {
      // 三份資料一律帶上：清空也要存回（不帶＝後端保留原值）
      const photoFoods = Object.fromEntries(foodEditing.photos.map((url) => [url, strToFood(pfStr[url])]));
      const photoCustoms: Record<string, CustomItem[]> = {};
      foodEditing.photos.forEach((url) => {
        const list = customDraftsToItems(pcDrafts[url] ?? []);
        if (list.length) photoCustoms[url] = list;
      });
      const items = itemState.order
        .map((key) => ({ food: strToFood(itemState.drafts[key]?.foodStr), customItems: customDraftsToItems(itemState.drafts[key]?.customs ?? []) }))
        .filter((it) => FOOD_KEYS.some((k) => it.food[k] > 0) || it.customItems.length);
      const updated = await api.proEditFood(memberId, foodEditing.id, { photoFoods, photoCustoms, items });
      setDay((d) => (d ? { ...d, entries: d.entries.map((en) => (en.id === updated.id ? updated : en)) } : d));
      setFoodEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '儲存份數失敗，請再試一次');
    } finally {
      setSavingFood(false);
    }
  };

  // 會員顯示名稱：私人暱稱（僅自己可見）＞會員自訂暱稱＞帳號
  const memberLabel = (m: MemberInfo) => m.alias || m.nickname || m.username;

  // 營養查詢助手：問題 → 網路搜尋 → AI 整理成含來源的摘要（需後端設定 TAVILY_API_KEY，未設定時後端會回覆說明）
  const [researchQ, setResearchQ] = useState('');
  const [researchBusy, setResearchBusy] = useState(false);
  const [researchErr, setResearchErr] = useState('');
  const [research, setResearch] = useState<{ question: string; answer: string; sources: { title: string; url: string }[]; model: string } | null>(null);

  const runResearch = async () => {
    const q = researchQ.trim();
    if (q.length < 2 || researchBusy) return;
    setResearchBusy(true);
    setResearchErr('');
    try {
      const r = await api.aiResearch(q);
      setResearch({ question: q, ...r });
    } catch (e) {
      setResearchErr(e instanceof Error ? e.message : '查詢失敗，請再試一次');
    } finally {
      setResearchBusy(false);
    }
  };

  // 編輯私人暱稱（僅該營養師可見）
  const [aliasEditing, setAliasEditing] = useState(false);
  const [aliasInput, setAliasInput] = useState('');
  const [aliasBusy, setAliasBusy] = useState(false);

  const saveAlias = async (value: string) => {
    if (memberId === '' || aliasBusy) return;
    setAliasBusy(true);
    try {
      await api.proSetAlias(memberId, value.trim());
      setMembers(await api.proMembers());
      setAliasEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : '儲存暱稱失敗，請再試一次');
    } finally {
      setAliasBusy(false);
    }
  };

  // 追蹤／取消追蹤：追蹤中的會員發布新貼文（飲食／喝水／運動）會收到通知
  const [followBusy, setFollowBusy] = useState(false);
  const toggleFollow = async (m: MemberInfo) => {
    if (followBusy) return;
    setFollowBusy(true);
    try {
      await api.proSetFollow(m.id, !m.followed);
      setMembers(await api.proMembers());
    } catch (e) {
      setError(e instanceof Error ? e.message : '更新追蹤狀態失敗，請再試一次');
    } finally {
      setFollowBusy(false);
    }
  };

  // 留言串（營養師身分）：綁定目前選擇的會員
  const commentProps = (target: CommentTarget, count: number) => ({
    count,
    load: () => api.proComments(memberId as number, target),
    post: (body: string) => api.proPostComment(memberId as number, target, body),
    edit: (id: number, body: string) => api.proEditComment(memberId as number, id, body),
    remove: (id: number) => api.proDeleteComment(memberId as number, id),
  });

  const selectDate = (d: string) => {
    setDate(d);
    const [y, m] = d.split('-').map(Number);
    if (y !== calMonth.y || m - 1 !== calMonth.m) setCalMonth({ y, m: m - 1 });
  };

  // 月曆格子
  const first = new Date(calMonth.y, calMonth.m, 1);
  const lead = (first.getDay() + 6) % 7;
  const dim = new Date(calMonth.y, calMonth.m + 1, 0).getDate();
  const cells: { num: number | ''; key?: string }[] = [];
  for (let i = 0; i < lead; i++) cells.push({ num: '' });
  for (let n = 1; n <= dim; n++) cells.push({ num: n, key: dstr(new Date(calMonth.y, calMonth.m, n)) });
  const prevMonth = () => setCalMonth(calMonth.m === 0 ? { y: calMonth.y - 1, m: 11 } : { y: calMonth.y, m: calMonth.m - 1 });
  const nextMonth = () => setCalMonth(calMonth.m === 11 ? { y: calMonth.y + 1, m: 0 } : { y: calMonth.y, m: calMonth.m + 1 });

  const entries = sortEntriesNewestFirst((day?.entries ?? []).filter(entryHasData));
  const totals = dayFoodTotals(entries);
  const gInfo = goalsFor(date, goals);
  // 六大類份數熱量＋自定義熱量項目
  const totalKcal = kcalOfFood(totals) + dayCustomKcal(entries);
  // BMR/TDEE：與會員主頁同一套（基本資料＋最近體重；資料不齊為 null 就不顯示）
  const { bmr, tdee } = bmrTdeeOf(memberProfile);
  const kcalOver = tdee !== null && totalKcal > tdee;
  const totalExMin = Math.round((day?.exLogs ?? []).reduce((a, l) => a + (Number(l.min) || 0), 0) * 10) / 10;
  const bodyItems = day ? BODY_DEFS.filter((b) => day.body[b.k] !== '') : [];
  const member = members.find((m) => m.id === memberId);

  const dateD = new Date(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10));
  const dateLabel = `${dateD.getFullYear()} 年 ${dateD.getMonth() + 1} 月 ${dateD.getDate()} 日（週${WD_NAMES[(dateD.getDay() + 6) % 7]}）${date === todayStr ? '・今天' : ''}`;

  return (
    <div style={{ minHeight: '100vh', maxWidth: 1100, margin: '0 auto', padding: '0 16px 40px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 4px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 11, background: '#5B8DB8', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#F4F1EA" strokeWidth="2" strokeLinecap="round"><path d="M8 3v5a4 4 0 0 0 8 0V3" /><path d="M12 12v3a5 5 0 0 1-5 5" /><circle cx="19" cy="17" r="2.5" /></svg>
          </div>
          <div style={{ fontFamily: 'Outfit', fontSize: 19, fontWeight: 800, color: '#2D3B2D' }}>營養師頁面{role === 'admin' ? '（管理者檢視）' : ''}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ position: 'relative' }}>
            <button title="通知" onClick={() => setModal('notify')} className="hv-cream" style={{ width: 38, height: 38, border: '1.5px solid #DDD8CA', borderRadius: 12, background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4A5A4A" strokeWidth="2" strokeLinecap="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>
            </button>
            {unreadCount > 0 && (
              <span style={{ position: 'absolute', top: -5, right: -5, minWidth: 18, height: 18, borderRadius: 99, background: '#C0564A', color: '#fff', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px', pointerEvents: 'none' }}>
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </div>
          <button onClick={() => setView('diary')} className="hv-cream" style={{ height: 38, padding: '0 14px', border: '1.5px solid #DDD8CA', borderRadius: 12, background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5, fontWeight: 700, color: '#4A5A4A' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
            回到日記
          </button>
        </div>
      </div>

      {/* 會員與日期選擇 */}
      <div style={{ ...cardStyle, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
        <label style={{ fontSize: 13.5, fontWeight: 700, color: '#4A5A4A' }}>會員</label>
        <select
          value={memberId}
          onChange={(e) => setMemberId(e.target.value === '' ? '' : Number(e.target.value))}
          style={{ height: 40, minWidth: 200, border: '1.5px solid #DDD8CA', borderRadius: 11, background: '#FBFAF6', fontSize: 14, padding: '0 10px', color: '#2D3B2D', cursor: 'pointer' }}
        >
          <option value="">— 請選擇會員 —</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {`${m.followed ? '★ ' : ''}${memberLabel(m) === m.username ? m.username : `${memberLabel(m)}（${m.username}）`}`}
            </option>
          ))}
        </select>
        {member && (
          <>
            <button
              onClick={() => void toggleFollow(member)}
              disabled={followBusy}
              title={member.followed ? '取消追蹤後將不再收到新貼文通知' : '追蹤後，這位會員發布新貼文（飲食／喝水／運動）會通知你'}
              className="hv-cream"
              style={{
                border: `1px solid ${member.followed ? '#C77B4A' : '#DDD8CA'}`,
                color: member.followed ? '#C77B4A' : '#6B7565',
                background: member.followed ? '#FDF3E7' : 'transparent',
                borderRadius: 99, fontSize: 12, padding: '4px 12px', cursor: 'pointer', fontWeight: 700,
                opacity: followBusy ? 0.6 : 1,
              }}
            >
              {member.followed ? '★ 追蹤中' : '☆ 追蹤'}
            </button>
            <button
              onClick={() => { setAliasInput(member.alias ?? ''); setAliasEditing(true); }}
              className="hv-cream"
              style={{ border: '1px solid #5B8DB8', color: '#5B8DB8', background: 'transparent', borderRadius: 99, fontSize: 12, padding: '4px 12px', cursor: 'pointer', fontWeight: 700 }}
            >
              私人暱稱
            </button>
          </>
        )}
        <label style={{ fontSize: 13.5, fontWeight: 700, color: '#4A5A4A', marginLeft: 6 }}>日期</label>
        <button onClick={() => selectDate(addDays(date, -1))} className="hv-sand" style={{ width: 34, height: 40, border: '1.5px solid #DDD8CA', borderRadius: 10, background: '#fff', cursor: 'pointer', color: '#4A5A4A' }}>‹</button>
        <PickerInput
          type="date"
          value={date}
          onChange={(e) => { if (e.target.value) selectDate(e.target.value); }}
          style={{ height: 40, border: '1.5px solid #DDD8CA', borderRadius: 11, padding: '0 10px', fontSize: 14, outline: 'none', background: '#FBFAF6' }}
        />
        <button onClick={() => selectDate(addDays(date, 1))} className="hv-sand" style={{ width: 34, height: 40, border: '1.5px solid #DDD8CA', borderRadius: 10, background: '#fff', cursor: 'pointer', color: '#4A5A4A' }}>›</button>
        {date !== todayStr && (
          <button onClick={() => selectDate(todayStr)} className="hv-cream" style={{ border: '1px solid #4A7C59', color: '#4A7C59', background: 'transparent', borderRadius: 99, fontSize: 12, padding: '4px 12px', cursor: 'pointer', fontWeight: 700 }}>
            回到今天
          </button>
        )}
      </div>

      {/* 營養查詢助手：不依賴會員選擇，輸入問題由 AI 搜尋網路並整理成含來源的摘要 */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 15 }}>🔎</span>
          <span style={{ fontSize: 15, fontWeight: 900 }}>營養查詢助手</span>
          <span style={{ fontSize: 11.5, color: '#8A9284' }}>AI 搜尋網路並整理重點（含資料來源）</span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            type="text"
            maxLength={200}
            placeholder="例：奇亞籽的營養成分與每日建議攝取量"
            value={researchQ}
            onChange={(e) => setResearchQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void runResearch(); }}
            style={{ flex: 1, minWidth: 220, height: 42, border: '1.5px solid #DDD8CA', borderRadius: 11, padding: '0 12px', fontSize: 14, outline: 'none', background: '#FBFAF6' }}
          />
          <button
            onClick={() => void runResearch()}
            disabled={researchBusy || researchQ.trim().length < 2}
            className="hv-green"
            style={{ height: 42, padding: '0 18px', border: 'none', borderRadius: 11, background: '#4A7C59', color: '#fff', fontSize: 14, fontWeight: 700, cursor: researchBusy ? 'default' : 'pointer', opacity: researchBusy || researchQ.trim().length < 2 ? 0.6 : 1 }}
          >
            {researchBusy ? '查詢中…' : '查詢'}
          </button>
        </div>
        {researchErr && <div style={{ fontSize: 12.5, color: '#C0564A', fontWeight: 700 }}>{researchErr}</div>}
        {research && !researchBusy && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, background: '#FBFAF6', border: '1px solid #EEEAE0', borderRadius: 12, padding: '10px 12px' }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: '#4A5A4A' }}>{research.question}</div>
            <div style={{ fontSize: 13.5, color: '#2D3B2D', lineHeight: 1.8, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{research.answer}</div>
            {research.sources.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, borderTop: '1px solid #EEEAE0', paddingTop: 8 }}>
                {research.sources.map((s, i) => (
                  <a key={s.url + i} href={s.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#5B8DB8', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    來源{i + 1}：{s.title || s.url}
                  </a>
                ))}
              </div>
            )}
            <div style={{ fontSize: 11, color: '#8A9284' }}>由 {research.model} 依網路搜尋結果整理，僅供參考，請以專業判斷為準。</div>
          </div>
        )}
      </div>

      {error && <div style={{ fontSize: 13, color: '#C0564A', fontWeight: 700 }}>{error}</div>}

      {memberId === '' ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#8A9284', fontSize: 14 }}>請先選擇要檢視的會員。</div>
      ) : (
        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
          {/* 左欄：月曆＋目標管理 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            <div style={cardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <button onClick={prevMonth} className="hv-sand" style={{ width: 34, height: 34, border: '1.5px solid #DDD8CA', borderRadius: 10, background: '#fff', cursor: 'pointer', color: '#4A5A4A' }}>‹</button>
                <div style={{ fontFamily: 'Outfit', fontSize: 16, fontWeight: 700 }}>{calMonth.y} 年 {calMonth.m + 1} 月</div>
                <button onClick={nextMonth} className="hv-sand" style={{ width: 34, height: 34, border: '1.5px solid #DDD8CA', borderRadius: 10, background: '#fff', cursor: 'pointer', color: '#4A5A4A' }}>›</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4 }}>
                {WD_NAMES.map((w) => (
                  <div key={w} style={{ textAlign: 'center', fontSize: 12, color: '#8A9284', fontWeight: 700 }}>{w}</div>
                ))}
                {cells.map((c, i) => {
                  if (!c.key) return <div key={`e${i}`} style={{ height: 40 }} />;
                  const isSel = c.key === date;
                  const isMarked = !!marks[c.key];
                  return (
                    <button
                      key={c.key}
                      onClick={() => selectDate(c.key!)}
                      title={isMarked ? '這天有紀錄' : undefined}
                      style={{
                        height: 40, borderRadius: 10, cursor: 'pointer',
                        border: isMarked && !isSel ? '1.5px solid #E8C49A' : '1.5px solid transparent',
                        background: isSel ? '#4A7C59' : isMarked ? '#FDF3E7' : '#FBFAF6',
                        color: isSel ? '#fff' : '#4A5A4A',
                        fontFamily: 'Outfit', fontSize: 13.5, fontWeight: 600,
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
                      }}
                    >
                      <span>{c.num}</span>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: isMarked ? (isSel ? '#F4F1EA' : '#C77B4A') : 'transparent' }} />
                    </button>
                  );
                })}
              </div>
              <div style={{ fontSize: 11.5, color: '#8A9284' }}>亮燈的日期表示該會員當天有紀錄。</div>
            </div>

            <div style={cardStyle}>
              <div style={{ fontSize: 16, fontWeight: 900 }}>{member ? memberLabel(member) : ''} 的階段目標</div>
              <div style={{ fontSize: 12.5, color: '#6B7565' }}>在此新增或編輯的目標會標示為「營養師設定」，會員無法自行修改。</div>
              <GoalManager
                goals={goals}
                memberView={false}
                onCreate={async (input) => { await api.proCreateGoal(memberId, input); await loadGoals(memberId); }}
                onUpdate={async (id, input) => { await api.proUpdateGoal(memberId, id, input); await loadGoals(memberId); }}
                onDelete={async (id) => { await api.proDeleteGoal(memberId, id); await loadGoals(memberId); }}
              />
            </div>
          </div>

          {/* 右欄：當日紀錄 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            <div style={cardStyle}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                <div style={{ fontSize: 16, fontWeight: 900 }}>{dateLabel}</div>
                {/* 與會員主頁同一套機制：有 TDEE 顯示「攝取 / TDEE」與剩餘或超過；沒有就只顯示攝取熱量 */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
                  <div style={{ fontFamily: 'Outfit', fontSize: 20, fontWeight: 800, color: kcalOver ? '#C0564A' : '#4A7C59' }}>
                    {totalKcal} <span style={{ fontSize: 12, fontWeight: 500, color: '#8A9284' }}>{tdee !== null ? `/ ${tdee} kcal` : 'kcal'}</span>
                  </div>
                  {tdee !== null && (
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: kcalOver ? '#C0564A' : '#8A9284' }}>
                      {kcalOver ? `超過目標 ${totalKcal - tdee} kcal` : `距離目標還可吃 ${tdee - totalKcal} kcal`}
                    </div>
                  )}
                </div>
              </div>

              {/* 六大類 vs 目標 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#4A5A4A' }}>六大類份數</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#6B7565' }}>
                    目標：{gInfo.custom ? '自訂區間' : '預設'}
                    {gInfo.setBy === 'dietitian' && <DietitianBadge />}
                  </span>
                </div>
                {GROUP_ROWS.map((row) => {
                  const total = round1(row.keys.reduce((a, k) => a + totals[k], 0));
                  const goal = gInfo.vals[row.gkey];
                  // 目標為 0 時吃任何份數都算超標：跑條全滿＋紅字
                  const over = goal > 0 ? total > goal * 1.2 : total > 0;
                  const pct = Math.min(100, goal > 0 ? (total / goal) * 100 : total > 0 ? 100 : 0) + '%';
                  return (
                    <div key={row.gkey} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ width: 62, flex: 'none', fontSize: 12.5, fontWeight: 700 }}>{row.name}</span>
                      <div style={{ flex: 1, height: 7, borderRadius: 99, background: '#F0EDE3', overflow: 'hidden' }}>
                        <div style={{ height: '100%', borderRadius: 99, background: over ? '#C0564A' : row.color, width: pct }} />
                      </div>
                      <span style={{ width: 76, flex: 'none', textAlign: 'right', fontSize: 12.5, color: over ? '#C0564A' : '#2D3B2D', fontWeight: over ? 900 : 700 }}>
                        {total} / {goal} 份
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* 喝水／運動／身體數據（喝水與運動可留言） */}
              <div style={{ borderTop: '1px solid #F0EDE3', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13, color: '#4A5A4A', lineHeight: 1.7 }}>
                <div>喝水：{day?.water ?? 0} / {gInfo.water} ml{day?.waterTime ? `（最後 ${day.waterTime}）` : ''}</div>
                {/* 逐筆喝水紀錄：一筆一則貼文，各自可留言 */}
                {(day?.waterLogs ?? []).map((w) => (
                  <div key={w.id} id={`pro-post-water:${w.id}`} style={{ border: '1px solid #EEEAE0', background: '#FBFAF6', borderRadius: 11, padding: '6px 10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 12.5, color: '#8A9284', flex: 'none' }}>{w.time || '未填時間'}</span>
                      <span style={{ fontFamily: 'Outfit', fontSize: 13, fontWeight: 700, color: '#5B8DB8' }}>{w.ml} ml</span>
                    </div>
                    <CommentsThread
                      key={`w-${memberId}-${w.id}${focusTarget === `water:${w.id}` ? '-f' : ''}`}
                      {...commentProps(`water:${w.id}`, w.commentCount)}
                      initialOpen={focusTarget === `water:${w.id}`}
                    />
                  </div>
                ))}
                <div>運動：{(day?.exLogs.length ?? 0) > 0 ? `共 ${day!.exLogs.length} 筆${totalExMin > 0 ? `・合計 ${totalExMin} 分鐘` : ''}` : '未記錄'}</div>
                {/* 逐筆運動紀錄：一筆一則貼文，各自可留言 */}
                {(day?.exLogs ?? []).map((x) => (
                  <div key={x.id} id={`pro-post-ex:${x.id}`} style={{ border: '1px solid #EEEAE0', background: '#FBFAF6', borderRadius: 11, padding: '6px 10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 12.5, color: '#8A9284', flex: 'none' }}>{x.time || '未填時間'}</span>
                      {x.min && Number(x.min) > 0 && <span style={{ fontFamily: 'Outfit', fontSize: 13, fontWeight: 700, color: '#C77B4A', flex: 'none' }}>{x.min} 分鐘</span>}
                      {x.desc && <span style={{ fontSize: 13, color: '#4A5A4A' }}>{x.desc}</span>}
                    </div>
                    <CommentsThread
                      key={`x-${memberId}-${x.id}${focusTarget === `ex:${x.id}` ? '-f' : ''}`}
                      {...commentProps(`ex:${x.id}`, x.commentCount)}
                      initialOpen={focusTarget === `ex:${x.id}`}
                    />
                  </div>
                ))}
                <div>
                  身體數據：{bodyItems.length
                    ? bodyItems.map((b) => `${b.name} ${day!.body[b.k]} ${b.unit}`).join('、') + (day!.bodyTime ? `（${day!.bodyTime}）` : '')
                    : '未記錄'}
                </div>
                {/* BMR/TDEE：依會員基本資料與最近體重計算，資料不齊就不顯示 */}
                {(bmr !== null || tdee !== null) && (
                  <div>
                    代謝估算：{[bmr !== null ? `BMR ${bmr} kcal` : '', tdee !== null ? `TDEE ${tdee} kcal` : ''].filter(Boolean).join('、')}
                    <span style={{ fontSize: 11.5, color: '#8A9284' }}>（依基本資料與最近體重）</span>
                  </div>
                )}
              </div>
            </div>

            {/* 熱量及三大營養素（與會員主頁同一張卡） */}
            <MacroPanel entries={entries} />

            {/* AI 今日總評（會員按鈕產生，營養師唯讀檢視） */}
            {day?.aiSummary && (
              <div style={{ ...cardStyle, border: '1.5px solid #E0D6F0', background: '#FBF9FE' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <div style={{ width: 34, height: 34, flex: 'none', borderRadius: 10, background: '#EFE8FA', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>✨</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 900 }}>AI 今日總評</div>
                    <div style={{ fontSize: 11.5, color: '#8A9284' }}>{day.aiSummary.model}・{fmtCommentTime(day.aiSummary.createdAt)}</div>
                  </div>
                </div>
                <div style={{ fontSize: 13, color: '#4A5A4A', lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{day.aiSummary.body}</div>
              </div>
            )}

            <div style={cardStyle}>
              <div style={{ fontSize: 16, fontWeight: 900 }}>當日飲食（{entries.length} 筆）</div>
              <div style={{ fontSize: 11.5, color: '#8A9284', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                點照片下方的燈號替該張照片評分（再點一次取消）：
                {RATING_KEYS.map((r) => (
                  <span key={r} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: RATING_DEFS[r].color, display: 'inline-block' }} />
                    {RATING_DEFS[r].name.slice(3)}
                  </span>
                ))}
              </div>
              {entries.length === 0 && (
                <div style={{ padding: '14px 0', textAlign: 'center', color: '#8A9284', fontSize: 13.5 }}>這天沒有飲食紀錄。</div>
              )}
              {entries.map((e) => {
                const m = MEALS.find((mm) => mm.k === e.meal) || MEALS[0];
                return (
                  <div key={e.id} id={`pro-post-entry:${e.id}`} style={{ border: '1px solid #EEEAE0', background: '#FBFAF6', borderRadius: 14, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {/* 標題列：左側資訊可換行，「編輯份數」固定右上不被擠到下一行 */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
                      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                        <div style={{ width: 30, height: 30, flex: 'none', borderRadius: 9, background: m.tint, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: m.color, fontWeight: 900 }}>{m.glyph}</div>
                        <span style={{ fontSize: 14, fontWeight: 700 }}>{m.name}</span>
                        <span style={{ fontSize: 12, color: '#8A9284' }}>{e.eatTime || '未填時間'}</span>
                        <span style={{ fontFamily: 'Outfit', fontSize: 13.5, fontWeight: 700, color: '#4A7C59' }}>{entryKcal(e)} kcal</span>
                        {e.foodEditedAt > 0 && (
                          <span title={`已於 ${fmtCommentTime(e.foodEditedAt)} 調整`} style={{ fontSize: 10.5, fontWeight: 700, color: '#5B8DB8', background: '#E5EBF1', borderRadius: 99, padding: '2px 8px' }}>
                            已調整份數
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => openFoodEditor(e)}
                        style={{ border: '1px solid #5B8DB8', color: '#5B8DB8', background: 'transparent', borderRadius: 99, fontSize: 12, padding: '3px 12px', cursor: 'pointer', fontWeight: 700, flex: 'none', whiteSpace: 'nowrap' }}
                      >
                        編輯份數
                      </button>
                    </div>
                    {e.desc && <div style={{ fontSize: 13, color: '#4A5A4A', lineHeight: 1.6 }}>{e.desc}</div>}
                    {e.photos.length > 0 && (
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        {e.photos.map((url, pi) => {
                          const current = e.ratings[url];
                          return (
                            <div key={url} style={{ display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'center' }}>
                              <button onClick={() => setLightbox({ entryId: e.id, photos: e.photos, index: pi })} title="放大檢視" style={{ position: 'relative', display: 'block', border: 'none', background: 'transparent', padding: 0, cursor: 'zoom-in' }}>
                                <div style={{ width: 72, height: 72, borderRadius: 10, border: current ? `2.5px solid ${RATING_DEFS[current].color}` : '1px solid #E4DFD2', backgroundColor: '#F0EDE3', backgroundSize: 'cover', backgroundPosition: 'center', backgroundImage: `url('${url}')` }} />
                                <PhotoRatingBadge rating={current} size={14} />
                              </button>
                              <div style={{ display: 'flex', gap: 5 }}>
                                {RATING_KEYS.map((r) => {
                                  const active = current === r;
                                  return (
                                    <button
                                      key={r}
                                      onClick={() => void ratePhoto(e.id, url, r, current)}
                                      title={RATING_DEFS[r].name + (active ? '（再點一次取消）' : '')}
                                      style={{
                                        width: 20, height: 20, borderRadius: '50%', cursor: 'pointer',
                                        background: RATING_DEFS[r].color,
                                        border: active ? '2.5px solid #2D3B2D' : '2px solid #fff',
                                        boxShadow: '0 1px 3px rgba(45,59,45,.25)',
                                        opacity: current && !active ? 0.35 : 1,
                                      }}
                                    />
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {/* 這餐的六大類份數、自定義熱量項目與三大營養素（唯讀，彙總所有照片與項目；調整請按「編輯份數」） */}
                    <FoodSummaryGrid food={e.food} />
                    <CustomItemsSummary items={entryAllCustoms(e)} />
                    <MacroSummaryRow macros={entryMacros(e)} />
                    {/* 已調整過的紀錄：主要顯示調整後數值，逐頁附上會員原本記的內容與調整對照 */}
                    {e.orig && <OrigSummary orig={e.orig} current={e} label="會員原本記的（調整前）" />}
                    <CommentsThread
                      key={`e-${e.id}${focusTarget === `entry:${e.id}` ? '-f' : ''}`}
                      {...commentProps(`entry:${e.id}`, e.commentCount)}
                      initialOpen={focusTarget === `entry:${e.id}`}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 編輯份數視窗 */}
      {foodEditing && (
        <ModalShell maxWidth={520} cardStyle={{ maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '18px 20px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 17, fontWeight: 900 }}>
              調整份數 — {(MEALS.find((mm) => mm.k === foodEditing.meal) || MEALS[0]).name}
              <span style={{ fontSize: 12, fontWeight: 400, color: '#8A9284', marginLeft: 8 }}>{member ? memberLabel(member) : ''}</span>
            </div>
            <CloseButton onClick={() => setFoodEditing(null)} />
          </div>
          <div style={{ padding: '14px 20px 20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ background: '#E5EBF1', borderRadius: 16, padding: '12px 16px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: '#5B8DB8' }}>
                調整後熱量{editPages.length > 1 ? '（總和）' : ''}
                {draftCustomKcal() > 0 && (
                  <span style={{ fontSize: 11.5, fontWeight: 500, color: '#8A9284' }}>・含自定義 {draftCustomKcal()} kcal</span>
                )}
              </span>
              <span style={{ fontFamily: 'Outfit', fontSize: 24, fontWeight: 800, color: '#2D3B2D' }}>
                {kcalOfFood(draftTotal()) + draftCustomKcal()} <span style={{ fontSize: 13, fontWeight: 500, color: '#8A9284' }}>kcal</span>
              </span>
            </div>
            <div style={{ fontSize: 12.5, color: '#6B7565' }}>
              儲存後會員端會標示「營養師調整份數」（只調整自定義項目不會標示）；會員若自行再修改份數，標示會移除。
            </div>
            {/* 會員原始紀錄對照（逐頁）：已調整過用第一次調整前的快照；尚未調整過＝目前內容即原始 */}
            <OrigSummary orig={foodEditing.orig ?? foodEditing} current={foodEditing} label="會員原本記的" />
            {editCur ? (
              <>
                {/* 逐頁編輯：照片頁或無照片項目頁 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 900 }}>
                    第 {editCurIdx + 1} / {editPages.length} 頁{editCur.kind === 'item' ? '・無照片項目' : ''}
                  </span>
                  <span style={{ fontFamily: 'Outfit', fontSize: 13, fontWeight: 700, color: '#4A7C59' }}>
                    {kcalOfFood(editPageFood(editCur)) + customDraftsKcal(editPageCustoms(editCur))} kcal
                  </span>
                  <span style={{ flex: 1 }} />
                  {editCur.kind === 'item' && (
                    <button onClick={() => removeEditItemPage(editCur.key)} style={{ flex: 'none', border: '1px solid #E4C9C2', color: '#C0564A', background: 'transparent', borderRadius: 99, fontSize: 12, padding: '4px 12px', cursor: 'pointer', fontWeight: 700 }}>
                      移除此項目
                    </button>
                  )}
                </div>
                {editCur.kind === 'photo' && (
                  <button
                    onClick={() => setLightbox({ entryId: foodEditing.id, photos: foodEditing.photos, index: editCurIdx })}
                    title="點擊放大檢視"
                    style={{ display: 'block', width: '100%', flex: 'none', height: 170, borderRadius: 14, border: '1.5px solid #E4DFD2', backgroundColor: '#F0EDE3', backgroundSize: 'contain', backgroundRepeat: 'no-repeat', backgroundPosition: 'center', backgroundImage: `url('${editCur.url}')`, cursor: 'zoom-in', padding: 0 }}
                  />
                )}
                <div style={{ flex: 'none', display: 'flex', gap: 7, overflowX: 'auto', paddingBottom: 2 }}>
                  {editPages.map((p, i) =>
                    p.kind === 'photo' ? (
                      <button
                        key={p.url}
                        onClick={() => setFoodPage(i)}
                        style={{ flex: 'none', width: 58, height: 58, borderRadius: 12, border: i === editCurIdx ? '2.5px solid #4A7C59' : '1.5px solid #E4DFD2', backgroundColor: '#F0EDE3', backgroundSize: 'cover', backgroundPosition: 'center', backgroundImage: `url('${p.url}')`, cursor: 'pointer', padding: 0 }}
                      />
                    ) : (
                      <button
                        key={p.key}
                        onClick={() => setFoodPage(i)}
                        title="無照片的食物項目"
                        style={{ flex: 'none', width: 58, height: 58, borderRadius: 12, border: i === editCurIdx ? '2.5px solid #4A7C59' : '1.5px solid #E4DFD2', background: '#F0EDE3', color: '#8A9284', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', padding: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, lineHeight: 1 }}
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 20h16" /><path d="M6 20a6 6 0 0 1 12 0" /><circle cx="12" cy="9" r="1.2" /></svg>
                        無照片
                      </button>
                    )
                  )}
                  {itemState.order.length < 20 && (
                    <button
                      onClick={addEditItemPage}
                      title="新增無照片的食物項目"
                      style={{ flex: 'none', width: 58, height: 58, border: '1.5px dashed #C9C2B2', borderRadius: 12, background: '#FBFAF6', color: '#8A9284', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, padding: 0, lineHeight: 1 }}
                    >
                      <span style={{ fontSize: 16, lineHeight: 1 }}>＋</span>
                      無照片
                    </button>
                  )}
                </div>
                {/* 這一頁的份數／自定義分頁 */}
                <div style={{ display: 'flex', gap: 6, flex: 'none' }}>
                  {([
                    ['portions', '六大類份數', 0],
                    ['custom', '自定義', editPageCustoms(editCur).length],
                  ] as const).map(([k, label, count]) => {
                    const on = editTab === k;
                    return (
                      <button
                        key={k}
                        onClick={() => setEditTab(k)}
                        style={{
                          flex: 'none', display: 'flex', alignItems: 'center', gap: 5, height: 34, padding: '0 13px', borderRadius: 99,
                          border: on ? '1.5px solid #4A7C59' : '1.5px solid #E4DFD2',
                          background: on ? '#4A7C59' : '#fff', color: on ? '#fff' : '#4A5A4A',
                          fontSize: 13, fontWeight: 800, cursor: 'pointer',
                        }}
                      >
                        <span>{label}</span>
                        {count > 0 && <span style={{ fontFamily: 'Outfit', fontSize: 11.5, opacity: 0.85 }}>{count}</span>}
                      </button>
                    );
                  })}
                </div>
                {editTab === 'portions' ? (
                  editCur.kind === 'photo' ? (
                    <FoodFields
                      key={editCur.url}
                      foodStr={pfStr[editCur.url] ?? ({} as Record<FoodKey, string>)}
                      onChange={(key, raw) => editCur.kind === 'photo' && setPfStr((s) => ({ ...s, [editCur.url]: { ...s[editCur.url], [key]: raw } }))}
                      onBlur={(key) => editCur.kind === 'photo' && setPfStr((s) => {
                        const v = clampPortion(s[editCur.url]?.[key] ?? '');
                        return { ...s, [editCur.url]: { ...s[editCur.url], [key]: v ? String(v) : '' } };
                      })}
                    />
                  ) : (
                    <FoodFields
                      key={editCur.key}
                      foodStr={itemState.drafts[editCur.key]?.foodStr ?? ({} as Record<FoodKey, string>)}
                      onChange={(key, raw) => editCur.kind === 'item' && setItemState((s) => ({
                        ...s,
                        drafts: { ...s.drafts, [editCur.key]: { ...(s.drafts[editCur.key] ?? { foodStr: toFoodStr(emptyFood()), customs: [] }), foodStr: { ...(s.drafts[editCur.key]?.foodStr ?? toFoodStr(emptyFood())), [key]: raw } } },
                      }))}
                      onBlur={(key) => editCur.kind === 'item' && setItemState((s) => {
                        const v = clampPortion(s.drafts[editCur.key]?.foodStr[key] ?? '');
                        return {
                          ...s,
                          drafts: { ...s.drafts, [editCur.key]: { ...(s.drafts[editCur.key] ?? { foodStr: toFoodStr(emptyFood()), customs: [] }), foodStr: { ...(s.drafts[editCur.key]?.foodStr ?? toFoodStr(emptyFood())), [key]: v ? String(v) : '' } } },
                        };
                      })}
                    />
                  )
                ) : (
                  <CustomItemsEditor
                    key={editCur.kind === 'photo' ? editCur.url : editCur.key}
                    drafts={editPageCustoms(editCur)}
                    setDrafts={editCur.kind === 'photo' ? editPcSetter(editCur.url) : editItemSetter(editCur.key)}
                  />
                )}
                <div style={{ display: 'flex', gap: 10 }}>
                  {editCurIdx > 0 && (
                    <button onClick={() => setFoodPage(editCurIdx - 1)} className="hv-sand" style={{ flex: 1, height: 46, border: '1.5px solid #DDD8CA', borderRadius: 13, background: '#fff', fontSize: 15, fontWeight: 700, color: '#4A5A4A', cursor: 'pointer' }}>上一頁</button>
                  )}
                  {editCurIdx < editPages.length - 1 ? (
                    <button onClick={() => setFoodPage(editCurIdx + 1)} className="hv-green" style={{ flex: 2, height: 46, border: 'none', borderRadius: 13, background: '#4A7C59', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>下一頁</button>
                  ) : (
                    <button onClick={() => void saveFood()} disabled={savingFood} className="hv-green" style={{ flex: 2, height: 46, border: 'none', borderRadius: 13, background: '#4A7C59', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer', opacity: savingFood ? 0.7 : 1 }}>儲存份數</button>
                  )}
                </div>
                <button onClick={() => setFoodEditing(null)} className="hv-sand" style={{ height: 40, border: 'none', background: 'transparent', fontSize: 13.5, fontWeight: 700, color: '#8A9284', cursor: 'pointer' }}>取消</button>
              </>
            ) : (
              <>
                {/* 沒有任何頁（會員清空了項目）：可新增項目頁調整 */}
                <button onClick={addEditItemPage} className="hv-sand" style={{ height: 44, flex: 'none', border: '1.5px solid #DDD8CA', borderRadius: 12, background: '#fff', color: '#4A5A4A', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                  ＋新增無照片的食物項目
                </button>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={() => setFoodEditing(null)} className="hv-sand" style={{ flex: 1, height: 46, border: '1.5px solid #DDD8CA', borderRadius: 13, background: '#fff', fontSize: 15, fontWeight: 700, color: '#4A5A4A', cursor: 'pointer' }}>取消</button>
                  <button onClick={() => void saveFood()} disabled={savingFood} className="hv-green" style={{ flex: 2, height: 46, border: 'none', borderRadius: 13, background: '#4A7C59', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer', opacity: savingFood ? 0.7 : 1 }}>儲存份數</button>
                </div>
              </>
            )}
          </div>
        </ModalShell>
      )}

      {/* 私人暱稱視窗：只有這位營養師自己看得到，其他營養師／管理者／會員皆不可見 */}
      {aliasEditing && member && (
        <ModalShell maxWidth={400} cardStyle={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 17, fontWeight: 900 }}>私人暱稱</div>
            <CloseButton onClick={() => setAliasEditing(false)} />
          </div>
          <div style={{ fontSize: 13, color: '#6B7565', lineHeight: 1.7 }}>
            替這位會員取一個只有你自己看得到的暱稱（最多 20 字），方便辨識；其他營養師、管理者與會員本人都不會看到。
          </div>
          <div style={{ background: '#FBFAF6', border: '1px solid #EEEAE0', borderRadius: 12, padding: '9px 12px', fontSize: 12.5, color: '#8A9284', wordBreak: 'break-all' }}>
            會員：{member.nickname ? `${member.nickname}（${member.username}）` : member.username}
          </div>
          <input
            type="text"
            maxLength={20}
            placeholder="例：週三團班的小美"
            value={aliasInput}
            onChange={(e) => setAliasInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void saveAlias(aliasInput); }}
            style={{ height: 46, border: '1.5px solid #DDD8CA', borderRadius: 12, padding: '0 12px', fontSize: 15, outline: 'none', background: '#FBFAF6' }}
          />
          <div style={{ display: 'flex', gap: 10 }}>
            {member.alias && (
              <button onClick={() => void saveAlias('')} disabled={aliasBusy} className="hv-red-tint" style={{ flex: 1, height: 46, border: '1.5px solid #E4C9C4', borderRadius: 13, background: '#fff', fontSize: 14, fontWeight: 700, color: '#C0564A', cursor: 'pointer', opacity: aliasBusy ? 0.7 : 1 }}>
                清除暱稱
              </button>
            )}
            <button onClick={() => void saveAlias(aliasInput)} disabled={aliasBusy} className="hv-green" style={{ flex: 2, height: 46, border: 'none', borderRadius: 13, background: '#4A7C59', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer', opacity: aliasBusy ? 0.7 : 1 }}>
                儲存
            </button>
          </div>
        </ModalShell>
      )}

      {modal === 'notify' && <NotificationsModal />}
      {lightbox && (
        <Lightbox
          photos={lightbox.photos}
          index={lightbox.index}
          onClose={() => setLightbox(null)}
          caption={(url) => {
            const f = lightboxEntry ? photoFoodOf(lightboxEntry, url) : null;
            const customs = lightboxEntry?.photoCustoms[url] ?? [];
            const summary = f ? foodSummary(f) : '';
            const customText = customs.map((c) => `${customItemLabel(c)}・${c.kcal} kcal`).join('、');
            const pageKcal = (f ? kcalOfFood(f) : 0) + customItemsKcal(customs);
            const current = lightboxEntry?.ratings[url];
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: '#B8CDBB' }}>
                  這張照片的份數{pageKcal ? `・${pageKcal} kcal` : ''}
                </div>
                <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>{[summary, customText].filter(Boolean).join('；') || '尚未記錄這張照片的份數'}</div>
                {lightboxEntry && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 4, borderTop: '1px solid rgba(244,241,234,.18)' }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#B8CDBB' }}>評分</span>
                    {RATING_KEYS.map((r) => {
                      const active = current === r;
                      return (
                        <button
                          key={r}
                          onClick={() => void ratePhoto(lightboxEntry.id, url, r, current)}
                          title={RATING_DEFS[r].name + (active ? '（再點一次取消）' : '')}
                          style={{
                            width: 22, height: 22, borderRadius: '50%', cursor: 'pointer',
                            background: RATING_DEFS[r].color,
                            border: active ? '2.5px solid #fff' : '2px solid rgba(255,255,255,.35)',
                            opacity: current && !active ? 0.4 : 1,
                          }}
                        />
                      );
                    })}
                    <span style={{ fontSize: 12, color: '#DDD8CA' }}>{current ? RATING_DEFS[current].name : '未評分'}</span>
                  </div>
                )}
              </div>
            );
          }}
        />
      )}
    </div>
  );
}
