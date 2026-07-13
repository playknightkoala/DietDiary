import { useEffect } from 'react';
import { useStore } from './store';
import { LoginScreen } from './screens/LoginScreen';
import { MainScreen } from './screens/MainScreen';

export default function App() {
  const token = useStore((s) => s.token);
  const loadAll = useStore((s) => s.loadAll);

  useEffect(() => {
    if (token) void loadAll();
    // 只在初次掛載時載入（登入時 loginSuccess 會自行載入）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return token ? <MainScreen /> : <LoginScreen />;
}
