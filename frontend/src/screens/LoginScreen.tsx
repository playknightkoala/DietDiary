import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { api, getRememberedAccount, setRememberedAccount } from '../lib/api';
import { VersionFooter } from '../components/VersionFooter';
import { useStore } from '../store';

const inputStyle: CSSProperties = {
  height: 48, border: '1.5px solid #DDD8CA', borderRadius: 12, padding: '0 14px',
  fontSize: 15, outline: 'none', background: '#FBFAF6',
};

const labelStyle: CSSProperties = { fontSize: 13, fontWeight: 700, color: '#4A5A4A' };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LoginScreen() {
  const loginSuccess = useStore((s) => s.loginSuccess);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState(() => getRememberedAccount());
  const [rememberAccount, setRememberAccount] = useState(() => getRememberedAccount() !== '');
  const [autoLogin, setAutoLogin] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [captchaId, setCaptchaId] = useState('');
  const [captchaSvg, setCaptchaSvg] = useState('');
  const [captchaAnswer, setCaptchaAnswer] = useState('');
  const [captchaVerified, setCaptchaVerified] = useState(false);
  const [verifyingCaptcha, setVerifyingCaptcha] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [codeVerified, setCodeVerified] = useState(false);
  const [verifyingCode, setVerifyingCode] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  // 圖形驗證碼確認 / 寄送認證碼的前置條件：Email 格式正確 + 密碼 ≥6 碼 + 兩次密碼一致
  const prereqsOk =
    EMAIL_RE.test(username.trim()) && password.length >= 6 && confirmPassword === password;

  const loadCaptcha = async () => {
    setCaptchaAnswer('');
    setCaptchaVerified(false);
    try {
      const { id, svg } = await api.getCaptcha();
      setCaptchaId(id);
      setCaptchaSvg(svg);
    } catch {
      setCaptchaSvg('');
      setCaptchaId('');
    }
  };

  useEffect(() => {
    if (mode === 'register') void loadCaptcha();
  }, [mode]);

  const startCooldown = (sec: number) => {
    if (timerRef.current) clearInterval(timerRef.current);
    setCooldown(sec);
    timerRef.current = setInterval(() => {
      setCooldown((c) => {
        if (c <= 1 && timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        return Math.max(0, c - 1);
      });
    }, 1000);
  };

  const switchMode = (next: 'login' | 'register') => {
    setMode(next);
    setError('');
    setNotice('');
    setPassword('');
    setConfirmPassword('');
    setCode('');
    setCaptchaAnswer('');
    setCaptchaVerified(false);
    setCodeSent(false);
    setCodeVerified(false);
  };

  const verifyCaptcha = async () => {
    if (verifyingCaptcha || captchaVerified || !prereqsOk) return;
    setError('');
    setNotice('');
    if (captchaAnswer.trim().length !== 4) {
      setError('請輸入 4 碼圖形驗證碼');
      return;
    }
    setVerifyingCaptcha(true);
    try {
      await api.verifyCaptcha(captchaId, captchaAnswer.trim());
      setCaptchaVerified(true);
      setNotice('圖形驗證碼確認成功，請寄送 Email 認證碼');
    } catch (e) {
      setError(e instanceof Error ? e.message : '圖形驗證碼確認失敗，請再試一次');
      void loadCaptcha(); // 答錯即作廢，換一張新的
    } finally {
      setVerifyingCaptcha(false);
    }
  };

  const sendCode = async () => {
    if (sendingCode || cooldown > 0 || !prereqsOk || !captchaVerified) return;
    setError('');
    setNotice('');
    setSendingCode(true);
    try {
      await api.sendCode(username.trim(), captchaId);
      setCodeSent(true);
      setCode('');
      setCodeVerified(false);
      setNotice('認證碼已寄出，請至信箱查收（10 分鐘內有效）');
      startCooldown(60);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '認證碼寄送失敗，請再試一次';
      setError(msg);
      if (msg.includes('圖形驗證碼')) void loadCaptcha(); // 驗證碼失效需重新驗證
    } finally {
      setSendingCode(false);
    }
  };

  const verifyCode = async () => {
    if (verifyingCode || codeVerified || !codeSent) return;
    setError('');
    setNotice('');
    if (!/^\d{6}$/.test(code.trim())) {
      setError('請輸入 6 位數認證碼');
      return;
    }
    setVerifyingCode(true);
    try {
      await api.verifyCode(username.trim(), code.trim());
      setCodeVerified(true);
      setNotice('認證碼確認成功，請按下方「註冊」完成');
    } catch (e) {
      setError(e instanceof Error ? e.message : '認證碼確認失敗，請再試一次');
    } finally {
      setVerifyingCode(false);
    }
  };

  const submit = async () => {
    if (busy) return;
    setError('');
    setNotice('');
    const account = username.trim();
    if (!account || !password) {
      setError('請輸入帳號與密碼');
      return;
    }
    if (mode === 'register') {
      if (!EMAIL_RE.test(account)) {
        setError('帳號必須是有效的 Email');
        return;
      }
      if (password.length < 6) {
        setError('密碼至少 6 碼');
        return;
      }
      if (password !== confirmPassword) {
        setError('兩次輸入的密碼不一致');
        return;
      }
      if (!/^\d{6}$/.test(code.trim())) {
        setError('請輸入 6 位數認證碼');
        return;
      }
      if (!codeVerified) {
        setError('請先按「確認」驗證 Email 認證碼');
        return;
      }
    }
    setBusy(true);
    try {
      if (mode === 'login') {
        const res = await api.login(account, password, autoLogin);
        setRememberedAccount(rememberAccount ? account : null);
        loginSuccess(res.token, res.username, res.role, autoLogin);
      } else {
        const res = await api.register(account, password, confirmPassword, code.trim());
        switchMode('login');
        setNotice(res.message || '註冊成功！請等待管理員開通帳號。');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '發生錯誤，請再試一次');
    } finally {
      setBusy(false);
    }
  };

  const captchaBoxStyle: CSSProperties = {
    flex: 'none', width: 150, height: 48, border: '1.5px solid #DDD8CA', borderRadius: 12,
    background: '#fff', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
  };

  return (
    <div style={{ position: 'relative', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(160deg, #EDF2E6 0%, #F4F1EA 55%, #E8EEE0 100%)', padding: 24 }}>
      <VersionFooter style={{ position: 'absolute', bottom: 14, left: 0, right: 0 }} />
      <div style={{ width: '100%', maxWidth: 400, display: 'flex', flexDirection: 'column', gap: 28, animation: 'fadeUp .5s ease both' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 72, height: 72, borderRadius: 22, background: '#4A7C59', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 24px rgba(74,124,89,.3)' }}>
            <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="#F4F1EA" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21c4.5 0 8-3.5 8-9V5l-8-2-8 2v7c0 5.5 3.5 9 8 9z" /></svg>
          </div>
          <div style={{ fontFamily: 'Outfit', fontSize: 30, fontWeight: 800, letterSpacing: '-.5px', color: '#2D3B2D' }}>均衡日記</div>
          <div style={{ fontSize: 14, color: '#6B7565' }}>六大類飲食・運動・身體數據，一天一頁</div>
        </div>
        <form
          onSubmit={(e) => { e.preventDefault(); void submit(); }}
          style={{ background: '#FFFFFF', borderRadius: 20, padding: '28px 24px', boxShadow: '0 12px 40px rgba(45,59,45,.08)', display: 'flex', flexDirection: 'column', gap: 16 }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={labelStyle}>{mode === 'login' ? '帳號' : 'Email（帳號）'}</label>
            <input
              type={mode === 'register' ? 'email' : 'text'}
              placeholder="you@example.com"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              style={inputStyle}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={labelStyle}>密碼</label>
            <input type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} style={inputStyle} />
          </div>
          {mode === 'login' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', gap: 20 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5, color: '#4A5A4A', cursor: 'pointer', userSelect: 'none' }}>
                  <input
                    type="checkbox"
                    checked={rememberAccount}
                    onChange={(e) => setRememberAccount(e.target.checked)}
                    style={{ width: 16, height: 16, accentColor: '#4A7C59', cursor: 'pointer' }}
                  />
                  記住帳號
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5, color: '#4A5A4A', cursor: 'pointer', userSelect: 'none' }}>
                  <input
                    type="checkbox"
                    checked={autoLogin}
                    onChange={(e) => setAutoLogin(e.target.checked)}
                    style={{ width: 16, height: 16, accentColor: '#4A7C59', cursor: 'pointer' }}
                  />
                  自動登入
                </label>
              </div>
              {autoLogin && (
                <div style={{ fontSize: 12.5, color: '#B07A2A', background: '#FBF4E4', border: '1px solid #EBDCBB', borderRadius: 10, padding: '8px 12px', lineHeight: 1.6 }}>
                  此功能會紀錄登入狀態一個月，若使用公共電腦請勿使用
                </div>
              )}
            </div>
          )}
          {mode === 'register' && (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={labelStyle}>確認密碼</label>
                <input type="password" placeholder="再輸入一次密碼" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" style={inputStyle} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={labelStyle}>圖形驗證碼</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
                  {captchaSvg ? (
                    <div
                      onClick={() => { if (!captchaVerified) void loadCaptcha(); }}
                      title={captchaVerified ? '已驗證' : '看不清楚？點擊更換'}
                      style={{ ...captchaBoxStyle, cursor: captchaVerified ? 'default' : 'pointer', opacity: captchaVerified ? 0.55 : 1 }}
                      dangerouslySetInnerHTML={{ __html: captchaSvg }}
                    />
                  ) : (
                    <div
                      onClick={() => void loadCaptcha()}
                      style={{ ...captchaBoxStyle, cursor: 'pointer', fontSize: 12, color: '#6B7565' }}
                    >
                      載入中…
                    </div>
                  )}
                  <input
                    type="text"
                    maxLength={4}
                    placeholder="輸入圖中文字"
                    value={captchaAnswer}
                    onChange={(e) => setCaptchaAnswer(e.target.value)}
                    autoComplete="off"
                    disabled={!prereqsOk || captchaVerified}
                    style={{ ...inputStyle, flex: 1, minWidth: 0, opacity: !prereqsOk || captchaVerified ? 0.55 : 1 }}
                  />
                  <button
                    type="button"
                    onClick={() => void verifyCaptcha()}
                    disabled={!prereqsOk || captchaVerified || verifyingCaptcha || captchaAnswer.trim().length !== 4}
                    style={{
                      flex: 'none', height: 48, padding: '0 14px', borderRadius: 12,
                      border: `1.5px solid ${captchaVerified ? '#4A7C59' : '#4A7C59'}`,
                      background: captchaVerified ? '#4A7C59' : '#fff',
                      color: captchaVerified ? '#fff' : '#4A7C59',
                      fontSize: 13.5, fontWeight: 700,
                      cursor: !prereqsOk || captchaVerified || verifyingCaptcha || captchaAnswer.trim().length !== 4 ? 'default' : 'pointer',
                      opacity: !prereqsOk || (!captchaVerified && (verifyingCaptcha || captchaAnswer.trim().length !== 4)) ? 0.55 : 1,
                    }}
                  >
                    {captchaVerified ? '✓ 已驗證' : verifyingCaptcha ? '確認中…' : '確認'}
                  </button>
                </div>
                <div style={{ fontSize: 12, color: '#6B7565' }}>
                  {prereqsOk
                    ? captchaVerified
                      ? '圖形驗證碼已確認'
                      : '不分大小寫，點擊圖片可更換'
                    : '請先填寫 Email 與兩次相同的密碼（至少 6 碼）'}
                </div>
              </div>
              {captchaVerified && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={labelStyle}>Email 認證碼</label>
                <button
                  type="button"
                  onClick={() => void sendCode()}
                  disabled={!prereqsOk || !captchaVerified || sendingCode || cooldown > 0}
                  style={{
                    height: 48, padding: '0 14px', border: '1.5px solid #4A7C59', borderRadius: 12,
                    background: '#fff', color: '#4A7C59', fontSize: 13.5, fontWeight: 700,
                    cursor: !prereqsOk || !captchaVerified || sendingCode || cooldown > 0 ? 'default' : 'pointer',
                    opacity: !prereqsOk || !captchaVerified || sendingCode || cooldown > 0 ? 0.55 : 1,
                  }}
                >
                  {cooldown > 0
                    ? `重新寄送（${cooldown}s）`
                    : sendingCode
                      ? '寄送中…'
                      : codeSent
                        ? '重新寄送認證碼'
                        : '寄送認證碼'}
                </button>
                {codeSent && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="6 位數認證碼"
                      value={code}
                      onChange={(e) => {
                        setCode(e.target.value.replace(/\D/g, ''));
                        setCodeVerified(false);
                      }}
                      disabled={codeVerified}
                      style={{ ...inputStyle, flex: 1, minWidth: 0, opacity: codeVerified ? 0.55 : 1 }}
                    />
                    <button
                      type="button"
                      onClick={() => void verifyCode()}
                      disabled={codeVerified || verifyingCode || code.trim().length !== 6}
                      style={{
                        flex: 'none', height: 48, padding: '0 14px', borderRadius: 12,
                        border: '1.5px solid #4A7C59',
                        background: codeVerified ? '#4A7C59' : '#fff',
                        color: codeVerified ? '#fff' : '#4A7C59',
                        fontSize: 13.5, fontWeight: 700,
                        cursor: codeVerified || verifyingCode || code.trim().length !== 6 ? 'default' : 'pointer',
                        opacity: !codeVerified && (verifyingCode || code.trim().length !== 6) ? 0.55 : 1,
                      }}
                    >
                      {codeVerified ? '✓ 已驗證' : verifyingCode ? '確認中…' : '確認'}
                    </button>
                  </div>
                )}
                <div style={{ fontSize: 12, color: '#6B7565' }}>
                  {codeVerified
                    ? 'Email 認證碼已確認，可按下方「註冊」完成'
                    : codeSent
                      ? '請輸入信箱收到的 6 位數認證碼並按「確認」'
                      : '請按「寄送認證碼」，認證碼將寄到你的 Email'}
                </div>
              </div>
              )}
            </>
          )}
          {error && <div style={{ fontSize: 13, color: '#C0564A', fontWeight: 700 }}>{error}</div>}
          {notice && <div style={{ fontSize: 13, color: '#4A7C59', fontWeight: 700 }}>{notice}</div>}
          {mode === 'register' && <div style={{ fontSize: 12.5, color: '#6B7565' }}>密碼至少 6 碼。註冊後需等待管理員開通帳號，開通後才能登入。</div>}
          {(() => {
            const disabled = busy || (mode === 'register' && !codeVerified);
            return (
              <button
                type="submit"
                className="hv-green"
                disabled={disabled}
                style={{ height: 50, border: 'none', borderRadius: 14, background: '#4A7C59', color: '#fff', fontSize: 16, fontWeight: 700, cursor: disabled ? 'default' : 'pointer', marginTop: 4, boxShadow: '0 6px 16px rgba(74,124,89,.28)', opacity: disabled ? 0.55 : 1 }}
              >
                {mode === 'login' ? '登入' : '註冊'}
              </button>
            );
          })()}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
            <a href="#" onClick={(e) => { e.preventDefault(); setNotice(''); setError('請聯絡管理員重設密碼'); }} style={{ textDecoration: 'none' }}>忘記密碼？</a>
            <a
              href="#"
              onClick={(e) => { e.preventDefault(); switchMode(mode === 'login' ? 'register' : 'login'); }}
              style={{ textDecoration: 'none', fontWeight: 700 }}
            >
              {mode === 'login' ? '註冊新帳號' : '返回登入'}
            </a>
          </div>
        </form>
      </div>
    </div>
  );
}
