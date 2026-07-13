import { useStore } from '../store';
import { TopBar } from '../components/TopBar';
import { WeekStrip } from '../components/WeekStrip';
import { KcalWaterRow, FoodGroupsCard, ExerciseCard } from '../components/OverviewCards';
import { BodyCard } from '../components/BodyCard';
import { AddMenuSheet } from '../components/modals/AddMenuSheet';
import { TodayMealsModal } from '../components/modals/TodayMealsModal';
import { LogFoodModal } from '../components/modals/LogFoodModal';
import { WaterModal } from '../components/modals/WaterModal';
import { ExerciseModal } from '../components/modals/ExerciseModal';
import { BodyModal } from '../components/modals/BodyModal';
import { CalendarModal } from '../components/modals/CalendarModal';
import { GoalsModal } from '../components/modals/GoalsModal';
import { GuideModal } from '../components/modals/GuideModal';
import { AccountModal } from '../components/modals/AccountModal';

export function MainScreen() {
  const modal = useStore((s) => s.modal);
  const setModal = useStore((s) => s.setModal);

  return (
    <div style={{ minHeight: '100vh', maxWidth: 1100, margin: '0 auto', padding: '0 0 110px', display: 'flex', flexDirection: 'column' }}>
      <TopBar />
      <WeekStrip />

      <div style={{ display: 'grid', gap: 16, padding: '12px 16px 0', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <KcalWaterRow />
          <FoodGroupsCard />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <ExerciseCard />
          <BodyCard />
        </div>
      </div>

      {/* FAB */}
      <button
        onClick={() => setModal('add')}
        className="hv-green"
        style={{ position: 'fixed', right: 22, bottom: 26, width: 60, height: 60, border: 'none', borderRadius: 20, background: '#4A7C59', color: '#fff', cursor: 'pointer', boxShadow: '0 10px 28px rgba(74,124,89,.42)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 40 }}
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
      </button>

      {modal === 'add' && <AddMenuSheet />}
      {modal === 'meals' && <TodayMealsModal />}
      {modal === 'logFood' && <LogFoodModal />}
      {modal === 'logWater' && <WaterModal />}
      {modal === 'logEx' && <ExerciseModal />}
      {modal === 'logBody' && <BodyModal />}
      {modal === 'calendar' && <CalendarModal />}
      {modal === 'goals' && <GoalsModal />}
      {modal === 'guide' && <GuideModal />}
      {modal === 'account' && <AccountModal />}
    </div>
  );
}
