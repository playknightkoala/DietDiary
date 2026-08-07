import type { ReactNode } from 'react';
import { useStore } from '../store';
import { TopBar } from '../components/TopBar';
import { VersionFooter } from '../components/VersionFooter';
import { WeekStrip } from '../components/WeekStrip';
import { KcalCard, WaterCard, FoodGroupsCard, MacroCard } from '../components/OverviewCards';
import { DayFeed } from '../components/DayFeed';
import { AddMenuSheet } from '../components/modals/AddMenuSheet';
import { LogFoodModal } from '../components/modals/LogFoodModal';
import { WaterModal } from '../components/modals/WaterModal';
import { ExerciseModal } from '../components/modals/ExerciseModal';
import { BodyModal } from '../components/modals/BodyModal';
import { CalendarModal } from '../components/modals/CalendarModal';
import { GoalsModal } from '../components/modals/GoalsModal';
import { AccountModal } from '../components/modals/AccountModal';
import { NotificationsModal } from '../components/modals/NotificationsModal';
import { LayoutModal } from '../components/modals/LayoutModal';
import { BodyOverviewModal } from '../components/modals/BodyOverviewModal';

export function MainScreen() {
  const modal = useStore((s) => s.modal);
  const setModal = useStore((s) => s.setModal);
  const layout = useStore((s) => s.layout);

  // 依「介面自定義」的順序與顯示設定組出總覽卡片；
  // 熱量卡與喝水卡相鄰時併成原本的雙格一列，其餘各自一張
  const visible = layout.order.filter((k) => !layout.hidden.includes(k));
  const cardOf: Record<string, ReactNode> = {
    kcal: <KcalCard />, water: <WaterCard />, macro: <MacroCard />, groups: <FoodGroupsCard />,
  };
  const nodes: { key: string; node: ReactNode }[] = [];
  for (let i = 0; i < visible.length; i++) {
    const k = visible[i];
    const next = visible[i + 1];
    if ((k === 'kcal' && next === 'water') || (k === 'water' && next === 'kcal')) {
      nodes.push({
        key: 'kcal-water',
        node: (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {cardOf[k]}
            {cardOf[next]}
          </div>
        ),
      });
      i++;
    } else {
      nodes.push({ key: k, node: cardOf[k] });
    }
  }
  // 前半放左欄、後半放右欄：手機（單欄）時由上而下就是自定義的順序
  const mid = Math.ceil(nodes.length / 2);
  const cols = [nodes.slice(0, mid), nodes.slice(mid)].filter((c) => c.length > 0);

  return (
    <div style={{ minHeight: '100vh', maxWidth: 1100, margin: '0 auto', padding: '0 0 110px', display: 'flex', flexDirection: 'column' }}>
      <TopBar />
      <WeekStrip />

      <div style={{ display: 'grid', gap: 16, padding: '12px 16px 0', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
        {cols.map((col, ci) => (
          <div key={ci} style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            {col.map((c) => (
              <div key={c.key} style={{ minWidth: 0 }}>{c.node}</div>
            ))}
          </div>
        ))}
      </div>
      {visible.length === 0 && (
        <div style={{ padding: '14px 20px 0', fontSize: 13, color: '#8A9284', lineHeight: 1.7 }}>
          所有總覽卡片都已隱藏。可從右上角「更多功能 → 介面自定義」重新開啟。
        </div>
      )}

      {/* 動態牆：飲食（新→舊）＋喝水＋運動，可展開留言 */}
      <DayFeed />

      {/* 版號 ＋ 版本紀錄 */}
      <VersionFooter style={{ padding: '24px 0 8px' }} />

      {/* FAB */}
      <button
        onClick={() => setModal('add')}
        className="hv-green"
        style={{ position: 'fixed', right: 22, bottom: 26, width: 60, height: 60, border: 'none', borderRadius: 20, background: '#4A7C59', color: '#fff', cursor: 'pointer', boxShadow: '0 10px 28px rgba(74,124,89,.42)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 40 }}
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
      </button>

      {modal === 'add' && <AddMenuSheet />}
      {modal === 'logFood' && <LogFoodModal />}
      {modal === 'logWater' && <WaterModal />}
      {modal === 'logEx' && <ExerciseModal />}
      {modal === 'logBody' && <BodyModal />}
      {modal === 'calendar' && <CalendarModal />}
      {modal === 'goals' && <GoalsModal />}
      {modal === 'account' && <AccountModal />}
      {modal === 'notify' && <NotificationsModal />}
      {modal === 'layout' && <LayoutModal />}
      {modal === 'bodyView' && <BodyOverviewModal />}
    </div>
  );
}
