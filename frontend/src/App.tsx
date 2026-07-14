import { useEffect } from 'react';
import { useStore } from './store';
import { LoginScreen } from './screens/LoginScreen';
import { MainScreen } from './screens/MainScreen';
import { AdminScreen } from './screens/AdminScreen';
import { DietitianScreen } from './screens/DietitianScreen';
import { GuideModal } from './components/modals/GuideModal';

export default function App() {
  const token = useStore((s) => s.token);
  const view = useStore((s) => s.view);
  const role = useStore((s) => s.role);
  const guideOpen = useStore((s) => s.guideOpen);
  const loadAll = useStore((s) => s.loadAll);

  useEffect(() => {
    if (token) void loadAll();
    // 只在初次掛載時載入（登入時 loginSuccess 會自行載入）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!token) return <LoginScreen />;
  const screen =
    view === 'admin' && role === 'admin' ? <AdminScreen />
    : view === 'pro' && (role === 'dietitian' || role === 'admin') ? <DietitianScreen />
    : <MainScreen />;
  return (
    <>
      {screen}
      {/* 指南為獨立疊加層，任何畫面／彈窗上都可開啟 */}
      {guideOpen && <GuideModal />}
    </>
  );
}
