import { useEffect } from 'react';
import { useStore } from './store';
import { LoginScreen } from './screens/LoginScreen';
import { MainScreen } from './screens/MainScreen';
import { AdminScreen } from './screens/AdminScreen';
import { DietitianScreen } from './screens/DietitianScreen';

export default function App() {
  const token = useStore((s) => s.token);
  const view = useStore((s) => s.view);
  const role = useStore((s) => s.role);
  const loadAll = useStore((s) => s.loadAll);

  useEffect(() => {
    if (token) void loadAll();
    // 只在初次掛載時載入（登入時 loginSuccess 會自行載入）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!token) return <LoginScreen />;
  if (view === 'admin' && role === 'admin') return <AdminScreen />;
  if (view === 'pro' && (role === 'dietitian' || role === 'admin')) return <DietitianScreen />;
  return <MainScreen />;
}
