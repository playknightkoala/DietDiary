import { useEffect } from 'react';
import { useStore } from './store';
import { LoginScreen } from './screens/LoginScreen';
import { MainScreen } from './screens/MainScreen';
import { AdminScreen } from './screens/AdminScreen';
import { DietitianScreen } from './screens/DietitianScreen';
import { GuideModal } from './components/modals/GuideModal';
import { NicknameModal } from './components/modals/NicknameModal';
import { UpdateRequiredModal } from './components/modals/UpdateRequiredModal';

export default function App() {
  const token = useStore((s) => s.token);
  const view = useStore((s) => s.view);
  const role = useStore((s) => s.role);
  const guideOpen = useStore((s) => s.guideOpen);
  const nickname = useStore((s) => s.nickname);
  const loadAll = useStore((s) => s.loadAll);
  const loadNotifications = useStore((s) => s.loadNotifications);
  const updateRequired = useStore((s) => s.updateRequired);
  const checkVersion = useStore((s) => s.checkVersion);

  useEffect(() => {
    if (token) void loadAll();
    // 只在初次掛載時載入（登入時 loginSuccess 會自行載入）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 每 60 秒輪詢通知（登入期間）
  useEffect(() => {
    if (!token) return;
    const timer = setInterval(() => void loadNotifications(), 60_000);
    return () => clearInterval(timer);
  }, [token, loadNotifications]);

  // 版號檢查（不分登入與否）：改版後強制更新
  useEffect(() => {
    void checkVersion();
    const timer = setInterval(() => void checkVersion(), 60_000);
    return () => clearInterval(timer);
  }, [checkVersion]);

  // 需要強制更新：蓋在登入前後任何畫面之上
  if (updateRequired) return <UpdateRequiredModal />;
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
      {/* 尚未設定暱稱：強制先設定才能繼續使用（nickname === null 表示尚未載入，不觸發） */}
      {nickname === '' && <NicknameModal />}
    </>
  );
}
