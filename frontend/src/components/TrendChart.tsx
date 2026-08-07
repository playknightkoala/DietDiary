import type { BodyKey, BodyTrendRow } from '../types';
import { BODY_DEFS } from '../lib/domain';

// 一次最多呈現的量測次數（同 InBody 報告的歷程紀錄欄位數）
const MAX_COLS = 8;

const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

// 身體組成歷程紀錄 — 仿 InBody 報告樣式：每個指標一列，最近幾次量測逐點標出數值
export function TrendChart({ rows }: { rows: BodyTrendRow[] }) {
  if (!rows.length) {
    return (
      <div style={{ padding: '24px 10px', textAlign: 'center', color: '#8A9284', fontSize: 13 }}>
        還沒有身體數據紀錄，記錄後就能看到歷程變化。
      </div>
    );
  }
  const shown = rows.slice(-MAX_COLS);
  const n = shown.length;

  const LABEL_W = 64, ROW_H = 52, DATE_H = 22;
  const W = 360;
  const plotX = LABEL_W + 4, plotW = W - plotX - 6;
  const colX = (i: number) => plotX + ((i + 0.5) * plotW) / n;
  const H = BODY_DEFS.length * ROW_H + DATE_H;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: '#4A5A4A' }}>身體組成歷程紀錄</span>
        <span style={{ fontSize: 11, color: '#8A9284' }}>最近 {n} 次量測</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }}>
        {BODY_DEFS.map((b, r) => {
          const top = r * ROW_H;
          const pts = shown
            .map((row, i) => ({ i, v: row[b.k as BodyKey] }))
            .filter((p): p is { i: number; v: number } => p.v !== null);
          const vs = pts.map((p) => p.v);
          const min = Math.min(...vs), max = Math.max(...vs);
          const range = max - min || 1;
          // 上緣留給數值標籤、下緣留白
          const y = (v: number) => top + 20 + (1 - (v - min) / range) * (ROW_H - 20 - 12);
          const path = pts.map((p, j) => (j ? 'L' : 'M') + colX(p.i).toFixed(1) + ',' + y(p.v).toFixed(1)).join(' ');
          return (
            <g key={b.k}>
              {r > 0 && <line x1={0} y1={top} x2={W} y2={top} stroke="#EEEAE0" strokeWidth={1} />}
              <text x={4} y={top + 24} fontSize={12} fontWeight={700} fill="#2D3B2D">{b.name}</text>
              <text x={4} y={top + 38} fontSize={9.5} fill="#8A9284">({b.unit})</text>
              {pts.length ? (
                <>
                  {pts.length > 1 && <path d={path} fill="none" stroke="#4A7C59" strokeWidth={1.6} strokeLinecap="round" />}
                  {pts.map((p) => {
                    const cy = y(p.v);
                    const above = cy - 8 > top + 12; // 點太貼上緣時，數值改標在點下方
                    return (
                      <g key={p.i}>
                        <circle cx={colX(p.i)} cy={cy} r={2.6} fill="#4A7C59" />
                        <text
                          x={colX(p.i)}
                          y={above ? cy - 7 : cy + 14}
                          fontSize={10.5}
                          fontWeight={700}
                          fill="#2D3B2D"
                          textAnchor="middle"
                        >
                          {fmt(p.v)}
                        </text>
                      </g>
                    );
                  })}
                </>
              ) : (
                <text x={plotX + plotW / 2} y={top + ROW_H / 2 + 4} fontSize={10.5} fill="#B5B0A3" textAnchor="middle">
                  尚無紀錄
                </text>
              )}
            </g>
          );
        })}
        <line x1={LABEL_W - 4} y1={0} x2={LABEL_W - 4} y2={H - DATE_H} stroke="#EEEAE0" strokeWidth={1} />
        <line x1={0} y1={H - DATE_H} x2={W} y2={H - DATE_H} stroke="#E4DFD2" strokeWidth={1} />
        {shown.map((row, i) => (
          <text key={row.date} x={colX(i)} y={H - 7} fontSize={9.5} fill="#8A9284" textAnchor="middle">
            {row.date.slice(5).replace('-', '/')}
          </text>
        ))}
      </svg>
    </div>
  );
}
