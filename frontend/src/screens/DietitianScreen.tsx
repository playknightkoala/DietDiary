import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { api } from '../lib/api';
import { useStore } from '../store';
import { BODY_DEFS, FOOD_KEYS, MEALS, WD_NAMES, addDays, clampPortion, dayFoodTotals, dstr, emptyFood, entryHasData, fmtCommentTime, goalsFor, kcalOfFood, round1, sortEntriesNewestFirst } from '../lib/domain';
import { DietitianBadge, GoalManager } from '../components/GoalManager';
import { PhotoRatingBadge, RATING_DEFS, RATING_KEYS } from '../components/PhotoRatingBadge';
import { CommentsThread } from '../components/CommentsThread';
import { FoodFields } from '../components/FoodFields';
import { PickerInput } from '../components/PickerInput';
import { CloseButton, ModalShell } from '../components/modals/ModalShell';
import type { CommentTarget, DayData, Entry, FoodKey, Goal, GoalKey, MemberInfo, PhotoRating } from '../types';

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

  const todayStr = dstr(new Date());
  const [members, setMembers] = useState<MemberInfo[]>([]);
  const [memberId, setMemberId] = useState<number | ''>('');
  const [date, setDate] = useState(todayStr);
  const [day, setDay] = useState<DayData | null>(null);
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

  // 編輯會員某筆紀錄的六大類份數（會標記「營養師調整」）
  const [foodEditing, setFoodEditing] = useState<Entry | null>(null);
  const [foodStr, setFoodStr] = useState<Record<FoodKey, string>>({} as Record<FoodKey, string>);
  const [savingFood, setSavingFood] = useState(false);

  const openFoodEditor = (e: Entry) => {
    const init = {} as Record<FoodKey, string>;
    FOOD_KEYS.forEach((k) => (init[k] = e.food[k] ? String(e.food[k]) : ''));
    setFoodStr(init);
    setFoodEditing(e);
  };

  const draftFood = () => {
    const f = emptyFood();
    FOOD_KEYS.forEach((k) => (f[k] = clampPortion(foodStr[k] ?? '')));
    return f;
  };

  const saveFood = async () => {
    if (!foodEditing || memberId === '' || savingFood) return;
    setSavingFood(true);
    try {
      const updated = await api.proEditFood(memberId, foodEditing.id, draftFood());
      setDay((d) => (d ? { ...d, entries: d.entries.map((en) => (en.id === updated.id ? updated : en)) } : d));
      setFoodEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '儲存份數失敗，請再試一次');
    } finally {
      setSavingFood(false);
    }
  };

  // 留言串（營養師身分）：綁定目前選擇的會員
  const commentProps = (target: CommentTarget, count: number) => ({
    count,
    load: () => api.proComments(memberId as number, target),
    post: (body: string) => api.proPostComment(memberId as number, target, body),
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
  const totalKcal = kcalOfFood(totals);
  const hasEx = day && ((day.ex.min && +day.ex.min > 0) || day.ex.desc);
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
        <button onClick={() => setView('diary')} className="hv-cream" style={{ height: 38, padding: '0 14px', border: '1.5px solid #DDD8CA', borderRadius: 12, background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5, fontWeight: 700, color: '#4A5A4A' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
          回到日記
        </button>
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
            <option key={m.id} value={m.id}>{m.username}</option>
          ))}
        </select>
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
              <div style={{ fontSize: 16, fontWeight: 900 }}>{member?.username ?? ''} 的階段目標</div>
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
                <div style={{ fontFamily: 'Outfit', fontSize: 20, fontWeight: 800, color: '#4A7C59' }}>
                  {totalKcal} <span style={{ fontSize: 12, fontWeight: 500, color: '#8A9284' }}>kcal</span>
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
                  const over = goal > 0 && total > goal * 1.2;
                  const pct = Math.min(100, goal > 0 ? (total / goal) * 100 : 0) + '%';
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
                <div>喝水：{day?.water ?? 0} / {gInfo.water} ml{day?.waterTime ? `（${day.waterTime}）` : ''}</div>
                <CommentsThread key={`w-${memberId}-${date}`} {...commentProps(`water:${date}`, day?.commentCounts.water ?? 0)} />
                <div>運動：{hasEx ? `${day!.ex.min ? day!.ex.min + ' 分鐘' : ''}${day!.ex.min && day!.ex.desc ? '・' : ''}${day!.ex.desc}${day!.exTime ? `（${day!.exTime}）` : ''}` : '未記錄'}</div>
                <CommentsThread key={`x-${memberId}-${date}`} {...commentProps(`ex:${date}`, day?.commentCounts.ex ?? 0)} />
                <div>
                  身體數據：{bodyItems.length
                    ? bodyItems.map((b) => `${b.name} ${day!.body[b.k]} ${b.unit}`).join('、') + (day!.bodyTime ? `（${day!.bodyTime}）` : '')
                    : '未記錄'}
                </div>
              </div>
            </div>

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
                  <div key={e.id} style={{ border: '1px solid #EEEAE0', background: '#FBFAF6', borderRadius: 14, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                      <div style={{ width: 30, height: 30, flex: 'none', borderRadius: 9, background: m.tint, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: m.color, fontWeight: 900 }}>{m.glyph}</div>
                      <span style={{ fontSize: 14, fontWeight: 700 }}>{m.name}</span>
                      <span style={{ fontSize: 12, color: '#8A9284' }}>{e.eatTime || '未填時間'}</span>
                      <span style={{ fontFamily: 'Outfit', fontSize: 13.5, fontWeight: 700, color: '#4A7C59' }}>{kcalOfFood(e.food)} kcal</span>
                      {e.foodEditedAt > 0 && (
                        <span title={`已於 ${fmtCommentTime(e.foodEditedAt)} 調整`} style={{ fontSize: 10.5, fontWeight: 700, color: '#5B8DB8', background: '#E5EBF1', borderRadius: 99, padding: '2px 8px' }}>
                          已調整份數
                        </span>
                      )}
                      <span style={{ flex: 1 }} />
                      <button
                        onClick={() => openFoodEditor(e)}
                        style={{ border: '1px solid #5B8DB8', color: '#5B8DB8', background: 'transparent', borderRadius: 99, fontSize: 12, padding: '3px 12px', cursor: 'pointer', fontWeight: 700, flex: 'none' }}
                      >
                        編輯份數
                      </button>
                    </div>
                    {e.desc && <div style={{ fontSize: 13, color: '#4A5A4A', lineHeight: 1.6 }}>{e.desc}</div>}
                    {e.photos.length > 0 && (
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        {e.photos.map((url) => {
                          const current = e.ratings[url];
                          return (
                            <div key={url} style={{ display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'center' }}>
                              <a href={url} target="_blank" rel="noreferrer" title="開啟原圖" style={{ position: 'relative', display: 'block' }}>
                                <div style={{ width: 72, height: 72, borderRadius: 10, border: current ? `2.5px solid ${RATING_DEFS[current].color}` : '1px solid #E4DFD2', backgroundColor: '#F0EDE3', backgroundSize: 'cover', backgroundPosition: 'center', backgroundImage: `url('${url}')` }} />
                                <PhotoRatingBadge rating={current} size={14} />
                              </a>
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
                    <CommentsThread key={`e-${e.id}`} {...commentProps(`entry:${e.id}`, e.commentCount)} />
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
              <span style={{ fontSize: 12, fontWeight: 400, color: '#8A9284', marginLeft: 8 }}>{member?.username}</span>
            </div>
            <CloseButton onClick={() => setFoodEditing(null)} />
          </div>
          <div style={{ padding: '14px 20px 20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ background: '#E5EBF1', borderRadius: 16, padding: '12px 16px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: '#5B8DB8' }}>調整後熱量</span>
              <span style={{ fontFamily: 'Outfit', fontSize: 24, fontWeight: 800, color: '#2D3B2D' }}>
                {kcalOfFood(draftFood())} <span style={{ fontSize: 13, fontWeight: 500, color: '#8A9284' }}>kcal</span>
              </span>
            </div>
            <div style={{ fontSize: 12.5, color: '#6B7565' }}>
              儲存後會員端會標示「營養師調整份數」；會員若自行再修改，標示會移除。
            </div>
            <FoodFields
              foodStr={foodStr}
              onChange={(key, raw) => setFoodStr((s) => ({ ...s, [key]: raw }))}
              onBlur={(key) => setFoodStr((s) => { const v = clampPortion(s[key] ?? ''); return { ...s, [key]: v ? String(v) : '' }; })}
            />
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setFoodEditing(null)} className="hv-sand" style={{ flex: 1, height: 46, border: '1.5px solid #DDD8CA', borderRadius: 13, background: '#fff', fontSize: 15, fontWeight: 700, color: '#4A5A4A', cursor: 'pointer' }}>取消</button>
              <button onClick={() => void saveFood()} disabled={savingFood} className="hv-green" style={{ flex: 2, height: 46, border: 'none', borderRadius: 13, background: '#4A7C59', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer', opacity: savingFood ? 0.7 : 1 }}>儲存份數</button>
            </div>
          </div>
        </ModalShell>
      )}
    </div>
  );
}
