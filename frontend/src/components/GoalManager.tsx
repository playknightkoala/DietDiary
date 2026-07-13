import { useState, type CSSProperties } from 'react';
import { DEFAULT_GOALS, DEFAULT_WATER, addDays, dstr } from '../lib/domain';
import type { Goal, GoalInput, GoalKey } from '../types';

export const GOAL_DEFS: { k: GoalKey; name: string }[] = [
  { k: 'meat', name: '蛋豆魚肉' },
  { k: 'veg', name: '蔬菜' },
  { k: 'grain', name: '全穀雜糧' },
  { k: 'oil', name: '油脂堅果' },
  { k: 'fruit', name: '水果' },
  { k: 'milk', name: '乳品' },
];

interface Draft {
  start: string;
  end: string;
  vals: Record<GoalKey, string>;
  water: string;
}

function draftOf(goal: Goal | null): Draft {
  const vals = {} as Record<GoalKey, string>;
  if (goal) {
    GOAL_DEFS.forEach(({ k }) => (vals[k] = String(goal.vals[k])));
    return { start: goal.start, end: goal.end, vals, water: String(goal.water) };
  }
  const today = dstr(new Date());
  GOAL_DEFS.forEach(({ k }) => (vals[k] = String(DEFAULT_GOALS[k])));
  return { start: today, end: addDays(today, 27), vals, water: String(DEFAULT_WATER) };
}

const numInputStyle: CSSProperties = {
  width: 100, height: 40, border: '1.5px solid #DDD8CA', borderRadius: 11, padding: '0 10px',
  fontSize: 15, outline: 'none', background: '#FBFAF6', textAlign: 'center',
};

const dateInputStyle: CSSProperties = {
  height: 42, border: '1.5px solid #DDD8CA', borderRadius: 11, padding: '0 10px',
  fontSize: 14, outline: 'none', background: '#FBFAF6', width: '100%',
};

export function DietitianBadge() {
  return (
    <span style={{ flex: 'none', fontSize: 11, fontWeight: 700, color: '#5B8DB8', background: '#E5EBF1', borderRadius: 99, padding: '2px 8px' }}>
      營養師設定
    </span>
  );
}

interface GoalManagerProps {
  goals: Goal[];
  // 會員本人檢視：營養師設定的目標唯讀
  memberView: boolean;
  onCreate: (input: GoalInput) => Promise<void>;
  onUpdate: (id: number, input: GoalInput) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}

// 目標清單＋單筆編輯表單，會員（GoalsModal）與營養師頁面共用
export function GoalManager({ goals, memberView, onCreate, onUpdate, onDelete }: GoalManagerProps) {
  const [editing, setEditing] = useState<'new' | number | null>(null);
  const [draft, setDraft] = useState<Draft>(() => draftOf(null));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const openEditor = (goal: Goal | null) => {
    setDraft(draftOf(goal));
    setError('');
    setEditing(goal ? goal.id : 'new');
  };

  const save = async () => {
    if (busy) return;
    if (!draft.start || !draft.end || draft.end < draft.start) {
      setError('請確認日期區間（結束不可早於開始）');
      return;
    }
    const vals = {} as Record<GoalKey, number>;
    GOAL_DEFS.forEach(({ k }) => (vals[k] = Math.min(99, Math.max(0, parseFloat(draft.vals[k]) || 0))));
    const water = Math.min(999999, Math.max(0, Math.round(parseFloat(draft.water))) || DEFAULT_WATER);
    const input: GoalInput = { start: draft.start, end: draft.end, vals, water };
    setBusy(true);
    try {
      if (editing === 'new') await onCreate(input);
      else if (typeof editing === 'number') await onUpdate(editing, input);
      setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '儲存失敗，請再試一次');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    if (busy) return;
    if (!window.confirm('確定要刪除這組目標？')) return;
    setBusy(true);
    try {
      await onDelete(id);
      if (editing === id) setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '刪除失敗，請再試一次');
    } finally {
      setBusy(false);
    }
  };

  if (editing !== null) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 900 }}>{editing === 'new' ? '新增目標' : '編輯目標'}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label style={{ fontSize: 12, color: '#6B7565' }}>開始日期</label>
            <input type="date" value={draft.start} onChange={(e) => setDraft((d) => ({ ...d, start: e.target.value }))} style={dateInputStyle} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label style={{ fontSize: 12, color: '#6B7565' }}>結束日期</label>
            <input type="date" value={draft.end} onChange={(e) => setDraft((d) => ({ ...d, end: e.target.value }))} style={dateInputStyle} />
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {GOAL_DEFS.map((g) => (
            <div key={g.k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <span style={{ fontSize: 14, fontWeight: 700 }}>{g.name} <span style={{ fontSize: 12, color: '#8A9284', fontWeight: 400 }}>份</span></span>
              <input type="number" step={0.5} min={0} value={draft.vals[g.k]} onChange={(e) => setDraft((d) => ({ ...d, vals: { ...d.vals, [g.k]: e.target.value } }))} style={numInputStyle} />
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 700 }}>喝水 <span style={{ fontSize: 12, color: '#8A9284', fontWeight: 400 }}>ml</span></span>
            <input type="number" step={50} min={0} value={draft.water} onChange={(e) => setDraft((d) => ({ ...d, water: e.target.value }))} style={numInputStyle} />
          </div>
        </div>
        {error && <div style={{ fontSize: 12.5, color: '#C0564A', fontWeight: 700 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => setEditing(null)} className="hv-sand" style={{ flex: 1, height: 46, border: '1.5px solid #DDD8CA', borderRadius: 13, background: '#fff', fontSize: 15, fontWeight: 700, color: '#4A5A4A', cursor: 'pointer' }}>取消</button>
          <button onClick={() => void save()} className="hv-green" disabled={busy} style={{ flex: 2, height: 46, border: 'none', borderRadius: 13, background: '#4A7C59', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer', opacity: busy ? 0.7 : 1 }}>儲存目標</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 12.5, color: '#6B7565' }}>
        每組目標套用於一段日期區間；未涵蓋的日期使用預設（蛋豆魚肉 7、蔬菜 3、全穀雜糧 10、油脂堅果 3、水果 2、乳品 2 份，喝水 2000ml）。
      </div>
      {goals.length === 0 && (
        <div style={{ padding: '16px 10px', textAlign: 'center', color: '#8A9284', fontSize: 13.5 }}>
          還沒有自訂目標，點下方「新增目標」開始。
        </div>
      )}
      {goals.map((g) => {
        const locked = memberView && g.setBy === 'dietitian';
        return (
          <div key={g.id} style={{ border: '1px solid #EEEAE0', background: '#FBFAF6', borderRadius: 14, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontFamily: 'Outfit', fontSize: 13.5, fontWeight: 700, color: '#2D3B2D' }}>{g.start} ～ {g.end}</span>
              {g.setBy === 'dietitian' && <DietitianBadge />}
              <span style={{ flex: 1 }} />
              {locked ? (
                <span style={{ fontSize: 11.5, color: '#8A9284' }}>僅營養師可修改</span>
              ) : (
                <>
                  <button onClick={() => openEditor(g)} style={{ border: '1px solid #4A7C59', color: '#4A7C59', background: 'transparent', borderRadius: 99, fontSize: 12, padding: '3px 12px', cursor: 'pointer', fontWeight: 700 }}>編輯</button>
                  <button onClick={() => void remove(g.id)} style={{ border: '1px solid #E0C5C0', color: '#C0564A', background: 'transparent', borderRadius: 99, fontSize: 12, padding: '3px 12px', cursor: 'pointer', fontWeight: 700 }}>刪除</button>
                </>
              )}
            </div>
            <div style={{ fontSize: 12, color: '#6B7565', lineHeight: 1.7 }}>
              {GOAL_DEFS.map((d) => `${d.name} ${g.vals[d.k]}`).join('、')} 份・喝水 {g.water} ml
            </div>
          </div>
        );
      })}
      {error && <div style={{ fontSize: 12.5, color: '#C0564A', fontWeight: 700 }}>{error}</div>}
      <button onClick={() => openEditor(null)} className="hv-green" style={{ height: 46, border: 'none', borderRadius: 13, background: '#4A7C59', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
        ＋ 新增目標
      </button>
    </div>
  );
}
