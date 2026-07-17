import { useRef, useState } from 'react';
import { api } from '../../lib/api';
import { dstr, goalsFor, nowHM } from '../../lib/domain';
import { useStore } from '../../store';
import type { DayData } from '../../types';
import { PickerInput } from '../PickerInput';
import { CloseButton, ModalShell } from './ModalShell';

export function WaterModal() {
  const day = useStore((s) => s.day);
  const selected = useStore((s) => s.selected);
  const goals = useStore((s) => s.goals);
  const refresh = useStore((s) => s.refresh);
  const closeModal = useStore((s) => s.closeModal);
  const [input, setInput] = useState('');
  const [date, setDate] = useState(selected);
  const [time, setTime] = useState(nowHM());
  // 所選日期的當天資料；改日期時重新載入該天的累計
  const [target, setTarget] = useState<DayData>(day);
  const dateRef = useRef(date);

  const { water: waterGoal } = goalsFor(date || selected, goals);

  const changeDate = async (d: string) => {
    setDate(d);
    dateRef.current = d;
    if (!d) return;
    const data = d === selected ? day : await api.getDay(d);
    if (dateRef.current === d) setTarget(data);
  };

  const addWater = async () => {
    let n = parseFloat(input);
    if (isNaN(n) || n <= 0 || !date) return;
    n = Math.min(9999, Math.round(n));
    const updated = await api.addWater(date, n, time);
    if (dateRef.current === date) setTarget(updated);
    setInput('');
    await refresh();
  };

  const removeLog = async (id: number) => {
    if (!date) return;
    if (!window.confirm('確定要刪除這筆喝水紀錄？留言會一併刪除。')) return;
    const updated = await api.deleteWaterLog(date, id);
    if (dateRef.current === date) setTarget(updated);
    await refresh();
  };

  const resetWater = async () => {
    if (!date) return;
    if (!window.confirm('確定要刪除這天所有喝水紀錄？留言會一併刪除。')) return;
    const updated = await api.resetWater(date);
    if (dateRef.current === date) setTarget(updated);
    await refresh();
  };

  return (
    <ModalShell maxWidth={400} cardStyle={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 17, fontWeight: 900 }}>記錄喝水</div>
        <CloseButton onClick={closeModal} />
      </div>
      <div style={{ background: '#F0F5FA', borderRadius: 16, padding: '14px 16px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 13, color: '#5B8DB8', fontWeight: 700 }}>{date === dstr(new Date()) ? '今日累計' : '當日累計'}</span>
        <span style={{ fontFamily: 'Outfit', fontSize: 24, fontWeight: 800, color: '#2D3B2D' }}>
          {target.water} <span style={{ fontSize: 13, fontWeight: 500, color: '#8A9284' }}>/ {waterGoal} ml</span>
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <label style={{ fontSize: 12.5, color: '#6B7565' }}>喝水時間（改日期會記錄到該天）</label>
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
        <label style={{ fontSize: 12.5, color: '#6B7565' }}>本次喝水量（ml，正數自行輸入）</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="number"
            min={1}
            max={9999}
            step={1}
            placeholder="例：350"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void addWater(); }}
            style={{ flex: 1, height: 46, border: '1.5px solid #DDD8CA', borderRadius: 12, padding: '0 12px', fontSize: 16, outline: 'none', background: '#FBFAF6', minWidth: 0 }}
          />
          <button onClick={() => void addWater()} className="hv-blue" style={{ flex: 'none', height: 46, padding: '0 20px', border: 'none', borderRadius: 12, background: '#5B8DB8', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>加入</button>
        </div>
      </div>
      {/* 當日逐筆紀錄：每筆是動態牆一則貼文，可單筆刪除 */}
      {target.waterLogs.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <label style={{ fontSize: 12.5, color: '#6B7565' }}>當日紀錄（每筆會是一則動態）</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 170, overflowY: 'auto' }}>
            {[...target.waterLogs].reverse().map((w) => (
              <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid #EEEAE0', borderRadius: 11, padding: '7px 10px', background: '#FBFAF6' }}>
                <span style={{ fontSize: 12.5, color: '#8A9284', width: 44, flex: 'none' }}>{w.time || '未填'}</span>
                <span style={{ flex: 1, fontFamily: 'Outfit', fontSize: 13.5, fontWeight: 700, color: '#5B8DB8' }}>{w.ml} ml</span>
                <button onClick={() => void removeLog(w.id)} title="刪除這筆" style={{ border: 'none', background: 'transparent', color: '#C0564A', fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: '2px 4px' }}>刪除</button>
              </div>
            ))}
          </div>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12.5, color: '#8A9284' }}>
        <span>輸入錯了？</span>
        <button onClick={() => void resetWater()} style={{ border: 'none', background: 'transparent', color: '#C0564A', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>歸零重記</button>
      </div>
    </ModalShell>
  );
}
