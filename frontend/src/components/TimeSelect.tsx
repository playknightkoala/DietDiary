import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { nowHM } from '../lib/domain';

// 24 小時制時間選擇器（自製彈出面板）：原生 <input type="time"> 的 12/24 小時
// 顯示跟著作業系統／瀏覽器地區設定走、網頁無法強制，所以自製「時｜分」雙欄
// 滾輪面板 —— 像 iOS 的時間滾輪：捲動時「停在中間指示帶的值」即為選中值，
// 不需再點擊；點某個數字也會平滑捲到中間順帶選中。所有裝置一律 24 小時制。
// 值格式與原生相同（"HH:mm"，空字串 = 未設定；打開滾輪即會帶入置中的時間）。
// 面板用 position:fixed + portal 到 body：modal 卡片是 overflow:hidden（absolute 會被
// 裁掉），且卡片的 popIn 動畫帶 transform、會把 fixed 的定位基準劫走，必須跳出卡片。
const pad2 = (n: number) => String(n).padStart(2, '0');
const HOURS = Array.from({ length: 24 }, (_, i) => pad2(i));
const MINUTES = Array.from({ length: 60 }, (_, i) => pad2(i));

const ROW_H = 38;
const VISIBLE_ROWS = 5; // 奇數，選中列在正中間
const LIST_H = ROW_H * VISIBLE_ROWS;
const PAD = (LIST_H - ROW_H) / 2; // 上下留白，讓第一／最後一列也能捲到中間
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

  // 有上下留白（PAD）時，第 idx 列置中的捲動位置恰為 idx * ROW_H
  const centerOn = (hh: number, mm: number) => {
    if (hourListRef.current) hourListRef.current.scrollTop = hh * ROW_H;
    if (minListRef.current) minListRef.current.scrollTop = mm * ROW_H;
  };

  // 開啟時把選中（或現在）的時／分捲到中間；捲動事件會把置中值寫回 value
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

  // 滾輪語意：捲動中即時把「置中那一列」當作選中值；按「確認」（或點外面）才關閉
  const centeredIdx = (list: HTMLDivElement, count: number) =>
    Math.min(count - 1, Math.max(0, Math.round(list.scrollTop / ROW_H)));
  const onHourScroll = () => {
    const v = HOURS[centeredIdx(hourListRef.current!, HOURS.length)];
    if (v !== h) onChange(`${v}:${m || '00'}`);
  };
  const onMinScroll = () => {
    const v = MINUTES[centeredIdx(minListRef.current!, MINUTES.length)];
    if (v !== m) onChange(`${h || pad2(new Date().getHours())}:${v}`);
  };
  // 點某列＝直接跳到該列（不用 smooth：mandatory snap 會把平滑捲動打斷彈回原位）
  const scrollToIdx = (list: HTMLDivElement | null, idx: number) => {
    if (suppressClick.current) return; // 拖曳結束時落在某列上的 click 不算點選
    if (list) list.scrollTop = idx * ROW_H;
  };

  // 桌機限定：滑鼠按住拖曳捲動（pointerType 'mouse' 才生效；觸控用原生捲動）。
  // 拖曳中暫時關掉 snap（mandatory 會跟逐像素捲動打架），放開時對齊最近一格。
  const drag = useRef<{ el: HTMLDivElement; startY: number; startTop: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const onWheelDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse') return;
    // 這裡只記狀態，等拖動超過門檻才擷取指標＋關吸附：一按下就 setPointerCapture
    // 會讓放開時的 click 被改派到容器、數字列的 onClick 永遠收不到（點選失效）
    drag.current = { el: e.currentTarget, startY: e.clientY, startTop: e.currentTarget.scrollTop, moved: false };
  };
  const onWheelMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.el !== e.currentTarget) return;
    const dy = e.clientY - d.startY;
    if (!d.moved) {
      if (Math.abs(dy) <= 3) return; // 還沒超過門檻，當作點擊、不動捲動
      d.moved = true;
      d.el.setPointerCapture(e.pointerId);
      d.el.style.scrollSnapType = 'none';
    }
    d.el.scrollTop = d.startTop - dy;
  };
  const onWheelUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d?.moved) return; // 純點擊沒動過吸附，交給數字列的 onClick
    // 明確寫回而不是設 ''：設 '' 會把 inline 屬性整個清掉，React 以為
    // listStyle 的 'y mandatory' 還在、不會重寫，之後滾輪捲動就不吸附了
    d.el.style.scrollSnapType = 'y mandatory';
    d.el.scrollTop = Math.round(d.el.scrollTop / ROW_H) * ROW_H;
    suppressClick.current = true;
    setTimeout(() => { suppressClick.current = false; }, 0); // click 在 pointerup 後同步發出
  };

  const listStyle: CSSProperties = {
    flex: 1, height: LIST_H, overflowY: 'auto',
    scrollSnapType: 'y mandatory', overscrollBehavior: 'contain',
  };
  const rowStyle = (selected: boolean): CSSProperties => ({
    height: ROW_H, lineHeight: `${ROW_H}px`, textAlign: 'center', cursor: 'pointer',
    fontSize: selected ? 16 : 15, userSelect: 'none', scrollSnapAlign: 'center',
    color: selected ? '#2D3B2D' : '#9AA394',
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
          <div style={{ position: 'relative', display: 'flex' }}>
            {/* 中間指示帶：停在這裡的值 = 選中值 */}
            <div style={{
              position: 'absolute', top: PAD, left: 8, right: 8, height: ROW_H,
              background: 'rgba(74,124,89,.10)', borderRadius: 10, pointerEvents: 'none',
            }} />
            <div
              ref={hourListRef}
              className="time-wheel"
              style={listStyle}
              onScroll={onHourScroll}
              onPointerDown={onWheelDown}
              onPointerMove={onWheelMove}
              onPointerUp={onWheelUp}
              onPointerCancel={onWheelUp}
              aria-label="時"
            >
              <div style={{ height: PAD }} />
              {HOURS.map((v, i) => (
                <div key={v} style={rowStyle(v === h)} onClick={() => scrollToIdx(hourListRef.current, i)}>{v}</div>
              ))}
              <div style={{ height: PAD }} />
            </div>
            <div
              ref={minListRef}
              className="time-wheel"
              style={listStyle}
              onScroll={onMinScroll}
              onPointerDown={onWheelDown}
              onPointerMove={onWheelMove}
              onPointerUp={onWheelUp}
              onPointerCancel={onWheelUp}
              aria-label="分"
            >
              <div style={{ height: PAD }} />
              {MINUTES.map((v, i) => (
                <div key={v} style={rowStyle(v === m)} onClick={() => scrollToIdx(minListRef.current, i)}>{v}</div>
              ))}
              <div style={{ height: PAD }} />
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
