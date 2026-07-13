import type { TrendPoint } from '../types';

const FIELD_NAMES: Record<string, string> = {
  weight: '體重 kg', fat: '體脂率 %', waist: '腰圍 cm', muscle: '肌肉重 kg', fatkg: '體脂重 kg',
};

// SVG 折線圖 — 幾何規格同原型 buildTrendChart
export function TrendChart({ points, field }: { points: TrendPoint[]; field: string }) {
  if (points.length < 2) {
    return (
      <div style={{ padding: '24px 10px', textAlign: 'center', color: '#8A9284', fontSize: 13 }}>
        至少需要兩天的「{FIELD_NAMES[field]}」紀錄才能顯示趨勢。
      </div>
    );
  }
  const W = 320, H = 140, pad = 24;
  const vs = points.map((p) => p.value);
  const min = Math.min(...vs), max = Math.max(...vs);
  const range = max - min || 1;
  const x = (i: number) => pad + (i * (W - pad * 2)) / (points.length - 1);
  const y = (v: number) => H - pad - ((v - min) / range) * (H - pad * 2);
  const path = points.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(p.value).toFixed(1)).join(' ');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }}>
      <path d={`${path} L${x(points.length - 1).toFixed(1)},${H - pad} L${pad},${H - pad} Z`} fill="rgba(74,124,89,.12)" />
      <path d={path} fill="none" stroke="#4A7C59" strokeWidth={2.5} strokeLinecap="round" />
      {points.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p.value)} r={3.2} fill="#4A7C59" />
      ))}
      <text x={pad} y={12} fontSize={10} fill="#8A9284">{max.toFixed(1)}</text>
      <text x={pad} y={H - 8} fontSize={10} fill="#8A9284">{min.toFixed(1)}</text>
      <text x={W - pad} y={H - 8} fontSize={10} fill="#8A9284" textAnchor="end">{points[points.length - 1].date.slice(5)}</text>
    </svg>
  );
}
