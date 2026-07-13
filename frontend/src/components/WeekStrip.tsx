import { useStore } from '../store';
import { WD_NAMES, dparse, dstr, weekOf } from '../lib/domain';

export function WeekStrip() {
  const selected = useStore((s) => s.selected);
  const weekAnchor = useStore((s) => s.weekAnchor);
  const marks = useStore((s) => s.marks);
  const selectDate = useStore((s) => s.selectDate);
  const prevWeek = useStore((s) => s.prevWeek);
  const nextWeek = useStore((s) => s.nextWeek);
  const goToday = useStore((s) => s.goToday);

  const todayStr = dstr(new Date());
  const week = weekOf(weekAnchor);

  const selD = dparse(selected);
  const selectedLabel =
    selD.getFullYear() + ' 年 ' + (selD.getMonth() + 1) + ' 月 ' + selD.getDate() + ' 日（週' +
    WD_NAMES[(selD.getDay() + 6) % 7] + '）' + (selected === todayStr ? '・今天' : '');

  return (
    <>
      <div style={{ padding: '8px 12px 0', display: 'flex', alignItems: 'center', gap: 4 }}>
        <button onClick={prevWeek} className="hv-arrow" style={{ width: 34, height: 58, flex: 'none', border: 'none', background: 'transparent', cursor: 'pointer', color: '#8A9284', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 6 }}>
          {week.map((key, i) => {
            const isSel = key === selected;
            const isToday = key === todayStr;
            const isMarked = !!marks[key];
            return (
              <button
                key={key}
                onClick={() => selectDate(key)}
                title={isMarked ? '這天有紀錄' : undefined}
                style={{
                  cursor: 'pointer', borderRadius: 14, padding: '8px 2px',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                  // 有紀錄的日期亮燈：淡橘底＋橘框＋發光圓點
                  border: isMarked && !isSel ? '1.5px solid #E8C49A' : '1.5px solid transparent',
                  background: isSel ? '#4A7C59' : isMarked ? '#FDF3E7' : '#FFFFFF',
                  color: isSel ? '#F4F1EA' : isToday ? '#4A7C59' : '#4A5A4A',
                  boxShadow: isSel ? '0 6px 14px rgba(74,124,89,.3)' : 'none',
                }}
              >
                <span style={{ fontSize: 11, opacity: 0.75 }}>{WD_NAMES[i]}</span>
                <span style={{ fontFamily: 'Outfit', fontSize: 17, fontWeight: 700 }}>{dparse(key).getDate()}</span>
                <span
                  style={{
                    width: 7, height: 7, borderRadius: '50%',
                    background: isMarked ? (isSel ? '#F4F1EA' : '#C77B4A') : 'transparent',
                    boxShadow: isMarked ? (isSel ? '0 0 6px rgba(244,241,234,.9)' : '0 0 6px rgba(199,123,74,.85)') : 'none',
                  }}
                />
              </button>
            );
          })}
        </div>
        <button onClick={nextWeek} className="hv-arrow" style={{ width: 34, height: 58, flex: 'none', border: 'none', background: 'transparent', cursor: 'pointer', color: '#8A9284', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M9 6l6 6-6 6" /></svg>
        </button>
      </div>
      <div style={{ textAlign: 'center', padding: '8px 0 2px', fontSize: 13, color: '#6B7565', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
        <span style={{ fontWeight: 700 }}>{selectedLabel}</span>
        {selected !== todayStr && (
          <button onClick={goToday} className="hv-cream" style={{ border: '1px solid #4A7C59', color: '#4A7C59', background: 'transparent', borderRadius: 99, fontSize: 12, padding: '2px 10px', cursor: 'pointer' }}>
            回到今天
          </button>
        )}
      </div>
    </>
  );
}
