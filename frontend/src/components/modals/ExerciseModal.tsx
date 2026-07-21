import { useRef, useState } from 'react';
import { api } from '../../lib/api';
import { dayHasData, dstr, nowHM } from '../../lib/domain';
import { useStore } from '../../store';
import type { DayData } from '../../types';
import { PickerInput } from '../PickerInput';
import { CloseButton, ModalShell } from './ModalShell';

export function ExerciseModal() {
  const day = useStore((s) => s.day);
  const selected = useStore((s) => s.selected);
  const replaceDay = useStore((s) => s.replaceDay);
  const markDate = useStore((s) => s.markDate);
  const closeModal = useStore((s) => s.closeModal);
  const [date, setDate] = useState(selected);
  const [time, setTime] = useState(nowHM());
  const [min, setMin] = useState('');
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  // 所選日期的當天資料；改日期時重新載入該天的紀錄
  const [target, setTarget] = useState<DayData>(day);
  const dateRef = useRef(date);

  const changeDate = async (d: string) => {
    setDate(d);
    dateRef.current = d;
    if (!d) return;
    const data = d === selected ? day : await api.getDay(d);
    if (dateRef.current === d) setTarget(data);
  };

  const canAdd = (min.trim() !== '' && Number(min) > 0) || desc.trim() !== '';

  const addEx = async () => {
    if (!canAdd || !date || busy) return;
    setBusy(true);
    try {
      const updated = await api.addEx(date, { min: min.trim(), desc: desc.trim(), time });
      if (dateRef.current === date) setTarget(updated);
      setMin('');
      setDesc('');
      replaceDay(date, updated);
      markDate(date, dayHasData(updated));
    } finally {
      setBusy(false);
    }
  };

  const removeLog = async (id: number) => {
    if (!date) return;
    if (!window.confirm('確定要刪除這筆運動紀錄？留言會一併刪除。')) return;
    const updated = await api.deleteExLog(date, id);
    if (dateRef.current === date) setTarget(updated);
    replaceDay(date, updated);
    markDate(date, dayHasData(updated));
  };

  const totalMin = Math.round(target.exLogs.reduce((a, l) => a + (Number(l.min) || 0), 0) * 10) / 10;

  return (
    <ModalShell maxWidth={400} cardStyle={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 17, fontWeight: 900 }}>記錄運動</div>
        <CloseButton onClick={closeModal} />
      </div>
      <div style={{ background: '#F3E7D8', borderRadius: 16, padding: '14px 16px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 13, color: '#C77B4A', fontWeight: 700 }}>{date === dstr(new Date()) ? '今日累計' : '當日累計'}</span>
        <span style={{ fontFamily: 'Outfit', fontSize: 24, fontWeight: 800, color: '#2D3B2D' }}>
          {totalMin} <span style={{ fontSize: 13, fontWeight: 500, color: '#8A9284' }}>分鐘・{target.exLogs.length} 筆</span>
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <label style={{ fontSize: 12.5, color: '#6B7565' }}>運動時刻（改日期會記錄到該天）</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <PickerInput
            type="date"
            value={date}
            onChange={(e) => void changeDate(e.target.value)}
            style={{ flex: 1, minWidth: 0, height: 46, border: '1.5px solid #DDD8CA', borderRadius: 12, padding: '0 10px', fontSize: 15, outline: 'none', background: '#FBFAF6' }}
          />
          <PickerInput
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            style={{ flex: 1, minWidth: 0, height: 46, border: '1.5px solid #DDD8CA', borderRadius: 12, padding: '0 10px', fontSize: 15, outline: 'none', background: '#FBFAF6' }}
          />
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <label style={{ fontSize: 12.5, color: '#6B7565' }}>運動時間（分鐘）</label>
        <input
          type="number"
          min={0}
          max={1440}
          step={1}
          placeholder="例：30"
          value={min}
          onChange={(e) => setMin(e.target.value)}
          style={{ height: 46, border: '1.5px solid #DDD8CA', borderRadius: 12, padding: '0 12px', fontSize: 16, outline: 'none', background: '#FBFAF6' }}
        />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <label style={{ fontSize: 12.5, color: '#6B7565' }}>運動描述（分鐘或描述至少填一項）</label>
        <textarea
          rows={2}
          placeholder="例：慢跑 5 公里、瑜珈、重訓⋯"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          style={{ border: '1.5px solid #DDD8CA', borderRadius: 12, padding: '10px 12px', fontSize: 15, outline: 'none', background: '#FBFAF6', resize: 'none' }}
        />
      </div>
      <button
        onClick={() => void addEx()}
        disabled={!canAdd || busy}
        className="hv-green"
        style={{ height: 48, border: 'none', borderRadius: 13, background: '#4A7C59', color: '#fff', fontSize: 15, fontWeight: 700, cursor: canAdd && !busy ? 'pointer' : 'default', opacity: canAdd && !busy ? 1 : 0.55 }}
      >
        加入
      </button>
      {/* 當日逐筆紀錄：每筆是動態牆一則貼文，可單筆刪除 */}
      {target.exLogs.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <label style={{ fontSize: 12.5, color: '#6B7565' }}>當日紀錄（每筆會是一則動態）</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 170, overflowY: 'auto' }}>
            {[...target.exLogs].reverse().map((l) => (
              <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid #EEEAE0', borderRadius: 11, padding: '7px 10px', background: '#FBFAF6' }}>
                <span style={{ fontSize: 12.5, color: '#8A9284', width: 44, flex: 'none' }}>{l.time || '未填'}</span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: '#4A5A4A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {l.min && Number(l.min) > 0 && <span style={{ fontFamily: 'Outfit', fontWeight: 700, color: '#C77B4A' }}>{l.min} 分鐘</span>}
                  {l.min && Number(l.min) > 0 && l.desc ? '・' : ''}
                  {l.desc}
                </span>
                <button onClick={() => void removeLog(l.id)} title="刪除這筆" style={{ border: 'none', background: 'transparent', color: '#C0564A', fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: '2px 4px', flex: 'none' }}>刪除</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </ModalShell>
  );
}
