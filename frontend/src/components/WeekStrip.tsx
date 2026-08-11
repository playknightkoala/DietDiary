import { useStore } from '../store';
import { WD_NAMES, dparse, dstr, weekOf } from '../lib/domain';
import { ngDays, overSugarDays } from '../lib/ng';

export function WeekStrip() {
  const selected = useStore((s) => s.selected);
  const weekAnchor = useStore((s) => s.weekAnchor);
  const marks = useStore((s) => s.marks);
  const selectDate = useStore((s) => s.selectDate);
  const prevWeek = useStore((s) => s.prevWeek);
  const nextWeek = useStore((s) => s.nextWeek);
  const goToday = useStore((s) => s.goToday);
  const monthStats = useStore((s) => s.monthStats);
  const openSugarNg = useStore((s) => s.openSugarNg);

  const todayStr = dstr(new Date());
  const week = weekOf(weekAnchor);

  const selD = dparse(selected);
  const selectedLabel =
    selD.getFullYear() + ' 年 ' + (selD.getMonth() + 1) + ' 月 ' + selD.getDate() + ' 日（週' +
    WD_NAMES[(selD.getDay() + 6) % 7] + '）' + (selected === todayStr ? '・今天' : '');

  // 當月飲食警示（跟著選取日期所在月份）：點文字開明細，糖與 NG 分開
  const ready = monthStats !== null && monthStats.month === selected.slice(0, 7);
  const overCount = ready ? overSugarDays(monthStats).length : 0;
  const ngCount = ready ? ngDays(monthStats).length : 0;
  // 一律顯示實際月份（8 月、7 月…），跟著選取日期所在的月份走
  const monthLabel = `${selD.getMonth() + 1} 月`;
  const statLink = (label: string, onClick: () => void) => (
    <button
      onClick={onClick}
      className="hv-cream"
      style={{
        border: '1.5px solid #E4DFD2', background: '#F7F5EF', padding: '2px 12px', borderRadius: 99, cursor: 'pointer',
        fontSize: 12.5, color: '#6B7565',
      }}
    >
      {label}
    </button>
  );

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
      {ready && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '4px 12px 0', fontSize: 12.5, color: '#6B7565' }}>
          <span style={{ marginRight: 2 }}>{monthLabel}</span>
          {statLink(`糖超標 ${overCount} 天`, () => openSugarNg('sugar'))}
          {statLink(`NG 食品 ${ngCount} 天`, () => openSugarNg('ng'))}
        </div>
      )}
    </>
  );
}
