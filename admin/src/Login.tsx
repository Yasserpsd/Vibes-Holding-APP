import { useState, type FormEvent } from 'react';

import { api, ApiError, session, type LoginResult, type Me } from './api';

type Props = { onSignedIn: (me: Me) => void };

/** Hub admin sign-in. An unverified e-mail answers "pending": the page then asks for the 6-digit code. */
export function Login({ onSignedIn }: Props) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState<{ token: string; text: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function accept(result: LoginResult) {
    if (result.pending) {
      setPending({ token: result.pendingToken, text: result.text });
      return;
    }
    if (!result.me.isAdmin) {
      setError('هذه اللوحة لإدارة النادي فقط.');
      return;
    }
    session.set(result.token);
    onSignedIn(result.me);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      accept(pending ? await api.verify(pending.token, code.trim()) : await api.login(login.trim(), password));
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'حدث خطأ غير متوقع');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <form className="card" onSubmit={submit}>
        <h1>لوحة إدارة نادي المستثمرين</h1>
        <p className="muted">الدخول لحسابات إدارة النادي فقط.</p>
        {pending ? (
          <>
            <p>{pending.text}</p>
            <label>
              رمز التحقق
              <input inputMode="numeric" dir="ltr" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} autoFocus required />
            </label>
          </>
        ) : (
          <>
            <label>
              البريد الإلكتروني
              <input type="text" dir="ltr" autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} required />
            </label>
            <label>
              كلمة المرور
              <input type="password" dir="ltr" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </label>
          </>
        )}
        {error ? <p className="error" role="alert">{error}</p> : null}
        <button className="primary" type="submit" disabled={busy}>
          {busy ? 'جارٍ التحقق…' : pending ? 'تأكيد الرمز' : 'دخول'}
        </button>
        {pending ? (
          <button className="link" type="button" onClick={() => { setPending(null); setCode(''); setError(null); }}>
            رجوع
          </button>
        ) : null}
      </form>
    </main>
  );
}
