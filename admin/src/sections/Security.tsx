import { useEffect, useState, type FormEvent } from 'react';

import { api, ApiError, type TotpStatus } from '../api';
import { BackupCodes, cleanCode, codeReady, EnrolSteps } from '../Totp';

type Mode = 'idle' | 'relink' | 'backup';
type Setup = { token: string; secret: string; uri: string };

/**
 * M140 «أمان الحساب»: the signed-in account's authenticator — its state, a new phone (re-link with the
 * current code or a backup code), and fresh backup codes. Switching it off is not offered here: dashboard
 * accounts keep it (the owner: «لينا إحنا كأدمن إجباري»).
 */
export function Security() {
  const [status, setStatus] = useState<TotpStatus | null>(null);
  const [mode, setMode] = useState<Mode>('idle');
  const [code, setCode] = useState('');
  const [setup, setSetup] = useState<Setup | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = () => api.totpStatus().then(setStatus).catch(() => setStatus(null));
  useEffect(() => {
    void load();
  }, []);

  function start(next: Mode) {
    setMode(next);
    setCode('');
    setSetup(null);
    setCodes(null);
    setError(null);
    setNotice(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (setup) {
        const result = await api.totpConfirm(setup.token, code);
        setSetup(null);
        setCodes(result.backupCodes);
        setNotice('تم ربط تطبيق المصادقة الجديد. احفظ الأكواد الاحتياطية أدناه.');
        await load();
      } else if (mode === 'relink') {
        const result = await api.totpSetup(status?.enabled ? code : undefined);
        setSetup({ token: result.setupToken, secret: result.secret, uri: result.uri });
        setCode('');
      } else if (mode === 'backup') {
        const result = await api.totpBackup(code);
        setCodes(result.backupCodes);
        setNotice('هذه أكوادك الاحتياطية الجديدة؛ القديمة لم تعد تعمل.');
        await load();
      }
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'حدث خطأ غير متوقع');
      if (failure instanceof ApiError && (failure.code === 'totp_expired' || failure.code === 'totp_locked')) {
        setSetup(null);
        setCode('');
      }
    } finally {
      setBusy(false);
    }
  }

  const enabledAt = status?.enabledAt ? new Date(status.enabledAt).toLocaleDateString('ar-SA-u-nu-latn', { year: 'numeric', month: 'long', day: 'numeric' }) : null;

  return (
    <div className="stack">
      <div className="row">
        <h2>أمان الحساب</h2>
      </div>
      <p className="muted">تطبيق المصادقة هو الخطوة الثانية لدخول اللوحة بعد كلمة المرور: رمز يتغيّر كل 30 ثانية على جوالك، ويعمل مع أي تطبيق مصادقة (Google Authenticator، Microsoft Authenticator، Authy…).</p>

      <section className="card">
        <div className="row">
          <strong>تطبيق المصادقة</strong>
          {status === null ? <span className="pill">…</span> : status.enabled ? <span className="pill ok">مفعّل{enabledAt ? ` منذ ${enabledAt}` : ''}</span> : <span className="pill danger">غير مفعّل</span>}
        </div>
        {status?.enabled ? <p className="muted">الأكواد الاحتياطية المتبقية: {status.backupLeft} من 8.</p> : null}
        {mode === 'idle' ? (
          <div className="pills">
            <button className="primary" type="button" onClick={() => start('relink')}>
              {status?.enabled ? 'ربط جوال جديد' : 'تفعيل تطبيق المصادقة'}
            </button>
            {status?.enabled ? (
              <button className="link" type="button" onClick={() => start('backup')}>
                أكواد احتياطية جديدة
              </button>
            ) : null}
          </div>
        ) : null}
      </section>

      {mode !== 'idle' && !codes ? (
        <form className="card" onSubmit={submit}>
          <h3>{setup ? 'اربط التطبيق الجديد' : mode === 'relink' ? (status?.enabled ? 'ربط جوال جديد' : 'تفعيل تطبيق المصادقة') : 'أكواد احتياطية جديدة'}</h3>
          {setup ? (
            <EnrolSteps uri={setup.uri} secret={setup.secret} />
          ) : status?.enabled ? (
            <p className="muted">للتأكيد أدخل الرمز الحالي من تطبيق المصادقة، أو أحد أكوادك الاحتياطية.</p>
          ) : (
            <p className="muted">سنعرض لك رمز QR ومفتاحًا لربط التطبيق.</p>
          )}
          {setup || status?.enabled ? (
            <label>
              {setup ? 'الرمز من التطبيق الجديد' : 'الرمز الحالي'}
              <input inputMode={setup ? 'numeric' : 'text'} autoComplete="one-time-code" dir="ltr" maxLength={9} value={code} onChange={(e) => setCode(cleanCode(e.target.value))} autoFocus required />
            </label>
          ) : null}
          {error ? <p className="error" role="alert">{error}</p> : null}
          <div className="pills">
            <button className="primary" type="submit" disabled={busy || ((setup || status?.enabled) ? !codeReady(code) : false)}>
              {busy ? 'جارٍ التحقق…' : setup ? 'تأكيد الربط' : 'متابعة'}
            </button>
            <button className="link" type="button" onClick={() => start('idle')} disabled={busy}>
              إلغاء
            </button>
          </div>
        </form>
      ) : null}

      {codes ? (
        <div className="stack">
          {notice ? <p className="ok" role="status">{notice}</p> : null}
          <BackupCodes codes={codes} />
          <button className="link" type="button" onClick={() => start('idle')}>
            حفظتها
          </button>
        </div>
      ) : null}
    </div>
  );
}
