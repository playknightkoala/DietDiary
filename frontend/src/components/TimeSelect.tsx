import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties } from 'react';
import { nowHM } from '../lib/domain';

// 24 小時制時間選擇器（自製彈出面板）：原生 <input type="time"> 的 12/24 小時
// 顯示跟著作業系統／瀏覽器地區設定走、網頁無法強制，所以自製「時｜分」雙欄
// 面板 —— 點欄位一次即開，點分鐘後自動關閉，所有裝置一律顯示 24 小時制。
// 值格式與原生相同（"HH:mm"，空字串 = 未設定）。
// 面板用 position:fixed + portal 到 body：modal 卡片是 overflow:hidden（absolute 會被
// 裁掉），且卡片的 popIn 動畫帶 transform、會把 fixed 的定位基準劫走，必須跳出卡片。
const pad2 = (n: number) => String(n).padStart(2, '0');
const HOURS = Array.from({ length: 24 }, (_, i) => pad2(i));
const MINUTES = Array.from({ length: 60 }, (_, i) => pad2(i));

const ROW_H = 38;
const LIST_H = ROW_H * 5.5; // 半列露出，暗示可捲動
const FOOTER_H = 46;

export function TimeSelect({ value, onChange, style }: {
  value: string;
  onChange: (v: string) => void;
  style?: CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 168 });
  const fieldRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const hourListRef = useRef<HTMLDivElement>(null);
  const minListRef = useRef<HTMLDivElement>(null);

  const m24 = /^(\d{2}):(\d{2})/.exec(value ?? '');
  const h = m24 ? m24[1] : '';
  const m = m24 ? m24[2] : '';

  const openPanel = () => {
    const rect = fieldRef.current!.getBoundingClientRect();
    const width = Math.max(rect.width, 168);
    const panelH = LIST_H + FOOTER_H + 2;
    const openUp = window.innerHeight - rect.bottom < panelH + 12 && rect.top > panelH + 12;
    setPos({
      top: openUp ? rect.top - panelH - 6 : rect.bottom + 6,
      left: Math.min(Math.max(rect.left, 8), window.innerWidth - width - 8),
      width,
    });
    setOpen(true);
  };

  const centerOn = (hh: number, mm: number) => {
    const center = (list: HTMLDivElement | null, idx: number) => {
      if (list && idx >= 0) list.scrollTop = idx * ROW_H - (LIST_H - ROW_H) / 2;
    };
    center(hourListRef.current, hh);
    center(minListRef.current, mm);
  };

  // 開啟時把選中的時／分捲到中間
  useLayoutEffect(() => {
    if (open) centerOn(h === '' ? new Date().getHours() : Number(h), m === '' ? 0 : Number(m));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // 點外面關閉；背景捲動／視窗縮放時面板位置會失準，一律關閉（面板內捲動不算）
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!fieldRef.current?.contains(t) && !panelRef.current?.contains(t)) setOpen(false);
    };
    const onScroll = (e: Event) => {
      if (!panelRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  // 選時／分、重置都不關面板，按「確認」（或點外面）才關閉
  const pickHour = (nh: string) => onChange(`${nh}:${m || '00'}`);
  const pickMinute = (nm: string) => onChange(`${h || pad2(new Date().getHours())}:${nm}`);

  const rowStyle = (selected: boolean): CSSProperties => ({
    height: ROW_H, lineHeight: `${ROW_H}px`, textAlign: 'center', borderRadius: 9,
    margin: '0 5px', cursor: 'pointer', fontSize: 15, userSelect: 'none',
    background: selected ? '#4A7C59' : 'transparent',
    color: selected ? '#fff' : '#3A4438',
    fontWeight: selected ? 700 : 400,
  });
  const footBtn: CSSProperties = {
    flex: 1, height: 32, border: '1px solid #DDD8CA', borderRadius: 9,
    background: '#FBFAF6', color: '#4A5A4A', fontSize: 13, fontWeight: 700, cursor: 'pointer',
  };

  return (
    <>
      <button
        ref={fieldRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openPanel())}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          font: 'inherit', cursor: 'pointer', color: value ? '#2D3B2D' : '#9AA394',
          ...style,
        }}
      >
        <span>{value ? `${h}:${m}` : '--:--'}</span>
        <span style={{ opacity: 0.45, fontSize: '0.9em' }}>🕐</span>
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          style={{
            position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 1000,
            background: '#fff', border: '1px solid #DDD8CA', borderRadius: 14,
            boxShadow: '0 12px 32px rgba(45,59,45,.22)', overflow: 'hidden',
            animation: 'popIn .15s ease both',
          }}
        >
          <div style={{ display: 'flex', height: LIST_H }}>
            <div ref={hourListRef} style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }} aria-label="時">
              {HOURS.map((v) => (
                <div key={v} style={rowStyle(v === h)} onClick={() => pickHour(v)}>{v}</div>
              ))}
            </div>
            <div style={{ width: 1, background: '#EFECE2' }} />
            <div ref={minListRef} style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }} aria-label="分">
              {MINUTES.map((v) => (
                <div key={v} style={rowStyle(v === m)} onClick={() => pickMinute(v)}>{v}</div>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, padding: '7px 8px', borderTop: '1px solid #EFECE2' }}>
            <button
              type="button"
              style={footBtn}
              onClick={() => {
                const t = nowHM();
                onChange(t);
                centerOn(Number(t.slice(0, 2)), Number(t.slice(3, 5)));
              }}
            >
              重置
            </button>
            <button
              type="button"
              style={{ ...footBtn, background: '#4A7C59', border: '1px solid #4A7C59', color: '#fff' }}
              onClick={() => setOpen(false)}
            >
              確認
            </button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
