import { WD_NAMES, dstr } from '../../lib/domain';
import { useStore } from '../../store';
import { CloseButton, ModalShell } from './ModalShell';

export function CalendarModal() {
  const selected = useStore((s) => s.selected);
  const calMonth = useStore((s) => s.calMonth);
  const marks = useStore((s) => s.marks);
  const selectDate = useStore((s) => s.selectDate);
  const setCalMonth = useStore((s) => s.setCalMonth);
  const closeModal = useStore((s) => s.closeModal);

  const todayStr = dstr(new Date());
  const selD = selected.split('-').map(Number);
  const cm = calMonth || { y: selD[0], m: selD[1] - 1 };
  const calTitle = cm.y + ' 年 ' + (cm.m + 1) + ' 月';

  const first = new Date(cm.y, cm.m, 1);
  const lead = (first.getDay() + 6) % 7;
  const dim = new Date(cm.y, cm.m + 1, 0).getDate();

  const cells: { num: number | ''; key?: string }[] = [];
  for (let i = 0; i < lead; i++) cells.push({ num: '' });
  for (let n = 1; n <= dim; n++) cells.push({ num: n, key: dstr(new Date(cm.y, cm.m, n)) });

  const prevMonth = () => setCalMonth(cm.m === 0 ? { y: cm.y - 1, m: 11 } : { y: cm.y, m: cm.m - 1 });
  const nextMonth = () => setCalMonth(cm.m === 11 ? { y: cm.y + 1, m: 0 } : { y: cm.y, m: cm.m + 1 });

  return (
    <ModalShell maxWidth={380} cardStyle={{ padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <button onClick={prevMonth} className="hv-sand" style={{ width: 34, height: 34, border: '1.5px solid #DDD8CA', borderRadius: 10, background: '#fff', cursor: 'pointer', color: '#4A5A4A' }}>‹</button>
        <div style={{ fontFamily: 'Outfit', fontSize: 17, fontWeight: 700 }}>{calTitle}</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={nextMonth} className="hv-sand" style={{ width: 34, height: 34, border: '1.5px solid #DDD8CA', borderRadius: 10, background: '#fff', cursor: 'pointer', color: '#4A5A4A' }}>›</button>
          <CloseButton onClick={closeModal} fontSize={14} />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4, marginBottom: 6 }}>
        {WD_NAMES.map((w) => (
          <div key={w} style={{ textAlign: 'center', fontSize: 12, color: '#8A9284', fontWeight: 700 }}>{w}</div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4 }}>
        {cells.map((c, i) => {
          if (!c.key) {
            return <button key={`e${i}`} disabled style={{ height: 42, border: 'none', borderRadius: 11, background: 'transparent', color: 'transparent' }} />;
          }
          const isSel = c.key === selected;
          const isToday = c.key === todayStr;
          return (
            <button
              key={c.key}
              onClick={() => { selectDate(c.key!, true); closeModal(); }}
              style={{
                height: 42, border: 'none', borderRadius: 11, cursor: 'pointer',
                background: isSel ? '#4A7C59' : isToday ? '#EDF2E6' : '#FBFAF6',
                color: isSel ? '#fff' : isToday ? '#4A7C59' : '#4A5A4A',
                fontFamily: 'Outfit', fontSize: 14, fontWeight: 600,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
              }}
            >
              <span>{c.num}</span>
              <span style={{ width: 4, height: 4, borderRadius: '50%', background: marks[c.key] ? (isSel ? '#F4F1EA' : '#C77B4A') : 'transparent' }} />
            </button>
          );
        })}
      </div>
    </ModalShell>
  );
}
