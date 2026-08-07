import { useRef, useState } from 'react';
import { api } from '../../lib/api';
import { ACTIVITY_DEFS, BODY_DEFS, dayHasData, nowHM } from '../../lib/domain';
import { compressDocumentImage } from '../../lib/photo';
import { useStore } from '../../store';
import type { ActivityKey, BodyKey, GoalMode, InbodyResult } from '../../types';
import { TimeSelect } from '../TimeSelect';
import { CloseButton, ModalShell } from './ModalShell';

// 數值變好的方向：肌肉重越多越好，其餘（體重／體脂率／腰圍／體脂重）越少越好
const GOOD_UP: Record<BodyKey, boolean> = { weight: false, fat: false, waist: false, muscle: true, fatkg: false };

export function BodyModal() {
  const day = useStore((s) => s.day);
  const selected = useStore((s) => s.selected);
  const aiEnabled = useStore((s) => s.aiEnabled);
  const trendOpen = useStore((s) => s.trendOpen);
  const loadTrend = useStore((s) => s.loadTrend);
  const profile = useStore((s) => s.profile);
  const setProfile = useStore((s) => s.setProfile);
  const replaceDay = useStore((s) => s.replaceDay);
  const markDate = useStore((s) => s.markDate);
  const closeModal = useStore((s) => s.closeModal);
  const [tab, setTab] = useState<'body' | 'tdee'>('body');
  const [body, setBody] = useState<Record<BodyKey, string>>({ ...day.body });
  const [time, setTime] = useState(day.bodyTime || nowHM());
  // 每日消耗量（BMR/TDEE）基本資料：與身體數據一起在此視窗設定，按完成時一併儲存
  const [pHeight, setPHeight] = useState(profile?.height ?? '');
  const [pBirthYear, setPBirthYear] = useState(profile?.birthYear ?? '');
  const [pGender, setPGender] = useState<'' | 'male' | 'female'>(profile?.gender ?? '');
  const [pActivity, setPActivity] = useState<'' | ActivityKey>(profile?.activity ?? '');
  // 體重目標：一般＝TDEE 不調整；減重／增重＝TDEE 減／加 pGoalKcal（可選 300、500 或自訂）
  const [pGoal, setPGoal] = useState<GoalMode>(profile?.goal ?? 'normal');
  const [pGoalKcal, setPGoalKcal] = useState(profile?.goalKcal ?? '');
  // InBody 掃描：辨識後自動填入欄位，並可對照前次量測；儲存日期改為報告的檢測日
  const [scan, setScan] = useState<'idle' | 'busy' | 'done'>('idle');
  const [result, setResult] = useState<InbodyResult | null>(null);
  const [date, setDate] = useState(selected);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const closing = useRef(false);
  // 「重置」恢復的原始時間：當天已有身體紀錄＝開窗當下的測量時間；首次記錄＝不指定（當下時間）
  const resetTime = useRef(day.bodyTime || undefined);

  const recognize = async (file: File) => {
    setScan('busy');
    setError('');
    try {
      const image = await compressDocumentImage(file);
      const r = await api.aiInbody(image);
      setResult(r);
      setDate(r.date || selected);
      if (r.time) setTime(r.time);
      // 讀到的值蓋進欄位；沒讀到的欄位保留原本輸入
      setBody((s) => {
        const next = { ...s };
        for (const b of BODY_DEFS) if (r.values[b.k] !== null) next[b.k] = String(r.values[b.k]);
        return next;
      });
      setScan('done');
      // 報告上方就有身高／年齡／性別：自動補進「還空著」的基本資料欄位（不覆蓋已填的值；
      // 年齡依報告檢測年份換算成出生年，之後逐年自動增加），按完成時一併儲存
      if (r.profile.height !== null) setPHeight((p) => (p === '' ? String(r.profile.height) : p));
      if (r.profile.age !== null) {
        const by = String(Number((r.date || selected).slice(0, 4)) - r.profile.age);
        setPBirthYear((p) => (p === '' ? by : p));
      }
      if (r.profile.gender !== null) setPGender((p) => (p === '' ? r.profile.gender! : p));
    } catch (e) {
      setError(e instanceof Error ? e.message : '辨識失敗，請稍後再試');
      setScan('idle');
    }
  };

  const finish = async () => {
    if (closing.current) return;
    closing.current = true;
    try {
      let updated;
      if (result && date !== selected) {
        // 掃描後存到報告的檢測日：與該日既有紀錄合併，留空欄位不清空
        const existing = await api.getDay(date);
        const merged = { ...existing.body };
        for (const b of BODY_DEFS) if (body[b.k] !== '') merged[b.k] = body[b.k];
        updated = await api.patchDay(date, { body: merged, bodyTime: time });
      } else {
        updated = await api.patchDay(selected, { body, bodyTime: time });
      }
      replaceDay(date, updated);
      markDate(date, dayHasData(updated));
      if (trendOpen) await loadTrend();
      // 基本資料一併儲存（回傳含最新體重，BMR/TDEE 格子立即更新）
      setProfile(await api.putProfile({ height: pHeight, birthYear: pBirthYear, gender: pGender, activity: pActivity, goal: pGoal, goalKcal: pGoalKcal }));
    } finally {
      closeModal();
    }
  };

  // 體脂重自動換算：體重×體脂率（%），四捨五入到小數第 1 位。
  // 只有體脂率沒有體脂重的使用者可點一下帶入；已填的值不主動覆蓋，由使用者自行選擇。
  const w = parseFloat(body.weight);
  const f = parseFloat(body.fat);
  const calcFatKg = isFinite(w) && w > 0 && isFinite(f) && f > 0 ? Math.round((w * f) / 10) / 10 : null;

  // 本次輸入 vs 前次量測的變化（掃描後顯示在欄位下方）
  const deltaOf = (k: BodyKey): { text: string; color: string } | null => {
    const prevStr = result?.prev?.body[k] ?? '';
    if (prevStr === '' || body[k] === '') return null;
    const d = Math.round((parseFloat(body[k]) - parseFloat(prevStr)) * 10) / 10;
    if (isNaN(d)) return null;
    if (d === 0) return { text: '—', color: '#8A9284' };
    const good = d > 0 === GOOD_UP[k];
    return { text: `${d > 0 ? '▲' : '▼'} ${Math.abs(d)}`, color: good ? '#4A7C59' : '#C0564A' };
  };

  return (
    <ModalShell maxWidth={420} cardStyle={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14, maxHeight: '90vh', overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 17, fontWeight: 900 }}>記錄身體數據</div>
        <CloseButton onClick={() => void finish()} />
      </div>

      {/* 分頁：身體數據（量測值）／每日消耗量（BMR/TDEE 基本資料）——完成時一併儲存 */}
      <div style={{ display: 'flex', background: '#F0EDE3', borderRadius: 12, padding: 4, gap: 4 }}>
        {([['body', '身體數據'], ['tdee', '每日消耗量']] as const).map(([k, name]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            style={{
              flex: 1, height: 36, border: 'none', borderRadius: 9, fontSize: 13.5, fontWeight: 700, cursor: 'pointer',
              background: tab === k ? '#FFFFFF' : 'transparent', color: tab === k ? '#2D3B2D' : '#8A9284',
              boxShadow: tab === k ? '0 1px 4px rgba(45,59,45,.12)' : 'none',
            }}
          >
            {name}
          </button>
        ))}
      </div>

      {tab === 'body' && aiEnabled && (
        <>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void recognize(f);
            }}
          />
          {scan !== 'done' ? (
            <button
              onClick={() => scan === 'idle' && fileRef.current?.click()}
              style={{ border: '1.5px dashed #A8B8A0', borderRadius: 13, background: '#F4F8F2', padding: '11px 14px', cursor: scan === 'idle' ? 'pointer' : 'default', display: 'flex', alignItems: 'center', gap: 10, color: '#4A7C59', textAlign: 'left' }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ fontSize: 13.5, fontWeight: 700 }}>{scan === 'busy' ? '辨識中…約需 10～30 秒' : '掃描 InBody 報告，自動填入數值'}</span>
                <span style={{ fontSize: 11, color: '#8A9284' }}>
                  {scan === 'busy' ? 'AI 正在讀取報告數值' : '也可以直接在下方自行輸入。照片僅用於辨識，不會被儲存'}
                </span>
              </span>
            </button>
          ) : (
            <div style={{ border: '1.5px solid #DCE7D6', borderRadius: 13, background: '#F4F8F2', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ flex: 1, fontSize: 12.5, color: '#3F6B4F', lineHeight: 1.5 }}>
                <b>已自動填入</b>
                {result?.score !== null ? `（InBody 評分 ${result?.score}）` : ''}
                ，請對照報告確認數值。
              </span>
              <button
                onClick={() => fileRef.current?.click()}
                style={{ border: '1px solid #A8B8A0', background: '#fff', color: '#4A7C59', borderRadius: 99, fontSize: 11.5, fontWeight: 700, padding: '4px 10px', cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                重新掃描
              </button>
            </div>
          )}
          {error && <div style={{ fontSize: 12, color: '#C0564A', textAlign: 'center' }}>{error}</div>}
        </>
      )}

      {tab === 'body' && result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 12, color: '#6B7565' }}>
            檢測日期{result.date ? '（依報告自動帶入）' : '（報告上讀不到，請確認）'}
          </label>
          <input
            type="date"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            style={{ height: 44, border: '1.5px solid #DDD8CA', borderRadius: 11, padding: '0 12px', fontSize: 15, outline: 'none', background: '#FBFAF6' }}
          />
        </div>
      )}

      {tab === 'body' && (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label style={{ fontSize: 12, color: '#6B7565' }}>測量時間</label>
        <TimeSelect
          value={time}
          onChange={setTime}
          resetTo={resetTime.current}
          style={{ height: 44, border: '1.5px solid #DDD8CA', borderRadius: 11, padding: '0 12px', fontSize: 15, background: '#FBFAF6' }}
        />
      </div>
      )}
      {tab === 'body' && (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10 }}>
        {BODY_DEFS.map((b) => {
          const d = deltaOf(b.k);
          const prevStr = result?.prev?.body[b.k] ?? '';
          return (
            <div key={b.k} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 12, color: '#6B7565' }}>{b.name}（{b.unit}）</label>
              <input
                type="number"
                step={0.1}
                min={0}
                value={body[b.k]}
                onChange={(e) => setBody((s) => ({ ...s, [b.k]: e.target.value }))}
                placeholder="—"
                style={{ height: 44, border: '1.5px solid #DDD8CA', borderRadius: 11, padding: '0 12px', fontSize: 15, outline: 'none', background: '#FBFAF6', width: '100%' }}
              />
              {result && prevStr !== '' && (
                <span style={{ fontSize: 11, color: '#8A9284' }}>
                  前次 {result.prev!.date.slice(5).replace('-', '/')}：{prevStr}
                  {d && <b style={{ color: d.color }}>　{d.text}</b>}
                </span>
              )}
              {b.k === 'fatkg' && calcFatKg !== null && parseFloat(body.fatkg) !== calcFatKg && (
                <button
                  onClick={() => setBody((s) => ({ ...s, fatkg: String(calcFatKg) }))}
                  style={{ border: 'none', background: 'transparent', padding: 0, textAlign: 'left', fontSize: 11, color: '#4A7C59', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}
                >
                  自動換算
                </button>
              )}
            </div>
          );
        })}
      </div>
      )}

      {/* 每日消耗量（BMR/TDEE）分頁：身高／出生年／性別／活動量，按完成與身體數據一併儲存 */}
      {tab === 'tdee' && (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 11.5, color: '#8A9284' }}>
          用於計算 BMR 與 TDEE（顯示於身體數據卡）；體重以最近一次紀錄為準。
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12, color: '#6B7565' }}>身高（cm）</label>
            <input
              type="number"
              step={0.1}
              min={0}
              value={pHeight}
              onChange={(e) => setPHeight(e.target.value)}
              placeholder="—"
              style={{ height: 44, border: '1.5px solid #DDD8CA', borderRadius: 11, padding: '0 12px', fontSize: 15, outline: 'none', background: '#FBFAF6', width: '100%' }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12, color: '#6B7565' }}>
              出生年（西元）
              {pBirthYear !== '' && !isNaN(Number(pBirthYear)) ? `・今年 ${new Date().getFullYear() - Number(pBirthYear)} 歲` : ''}
            </label>
            <input
              type="number"
              step={1}
              min={1900}
              max={new Date().getFullYear()}
              value={pBirthYear}
              onChange={(e) => setPBirthYear(e.target.value)}
              placeholder="—"
              style={{ height: 44, border: '1.5px solid #DDD8CA', borderRadius: 11, padding: '0 12px', fontSize: 15, outline: 'none', background: '#FBFAF6', width: '100%' }}
            />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12, color: '#6B7565' }}>生理性別</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {([['male', '男'], ['female', '女']] as const).map(([k, name]) => (
                <button
                  key={k}
                  onClick={() => setPGender(k)}
                  style={{
                    flex: 1, height: 44, borderRadius: 11, fontSize: 14, fontWeight: 700, cursor: 'pointer',
                    border: pGender === k ? 'none' : '1.5px solid #DDD8CA',
                    background: pGender === k ? '#4A7C59' : '#FBFAF6', color: pGender === k ? '#fff' : '#4A5A4A',
                  }}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12, color: '#6B7565' }}>活動量</label>
            <select
              value={pActivity}
              onChange={(e) => setPActivity(e.target.value as '' | ActivityKey)}
              style={{ height: 44, border: '1.5px solid #DDD8CA', borderRadius: 11, padding: '0 8px', fontSize: 14, outline: 'none', background: '#FBFAF6', width: '100%', color: pActivity === '' ? '#8A9284' : '#2D3B2D' }}
            >
              <option value="">未設定</option>
              {ACTIVITY_DEFS.map((a) => (
                <option key={a.k} value={a.k}>{a.name}（{a.desc}）×{a.factor}</option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 12, color: '#6B7565' }}>體重目標（減重／增重會直接調整 TDEE）</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {([['cut', '減重'], ['normal', '一般'], ['gain', '增重']] as const).map(([k, name]) => (
              <button
                key={k}
                onClick={() => setPGoal(k)}
                style={{
                  flex: 1, height: 44, borderRadius: 11, fontSize: 14, fontWeight: 700, cursor: 'pointer',
                  border: pGoal === k ? 'none' : '1.5px solid #DDD8CA',
                  background: pGoal === k ? '#4A7C59' : '#FBFAF6', color: pGoal === k ? '#fff' : '#4A5A4A',
                }}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
        {pGoal !== 'normal' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12, color: '#6B7565' }}>
              {pGoal === 'cut' ? '每日減少（kcal）' : '每日增加（kcal）'}
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['300', '500'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setPGoalKcal(v)}
                  style={{
                    flex: 1, height: 44, borderRadius: 11, fontSize: 14, fontWeight: 700, cursor: 'pointer',
                    border: pGoalKcal === v ? 'none' : '1.5px solid #DDD8CA',
                    background: pGoalKcal === v ? '#4A7C59' : '#FBFAF6', color: pGoalKcal === v ? '#fff' : '#4A5A4A',
                  }}
                >
                  {pGoal === 'cut' ? '−' : '＋'}{v}
                </button>
              ))}
              <input
                type="number"
                step={50}
                min={0}
                value={pGoalKcal === '300' || pGoalKcal === '500' ? '' : pGoalKcal}
                onChange={(e) => setPGoalKcal(e.target.value)}
                placeholder="自訂"
                style={{ flex: 1, height: 44, border: '1.5px solid #DDD8CA', borderRadius: 11, padding: '0 12px', fontSize: 15, outline: 'none', background: '#FBFAF6', width: '100%', minWidth: 0 }}
              />
            </div>
          </div>
        )}
      </div>
      )}

      <button onClick={() => void finish()} className="hv-green" style={{ height: 48, border: 'none', borderRadius: 13, background: '#4A7C59', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
        {result && date !== selected ? `完成（存到 ${date.slice(5).replace('-', '/')}）` : '完成'}
      </button>
    </ModalShell>
  );
}
