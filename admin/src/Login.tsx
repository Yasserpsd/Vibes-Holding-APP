import { useEffect, useState, type FormEvent } from 'react';

import { api, ApiError, session, type AdminLoginResult, type Me } from './api';
import { BackupCodes, cleanCode, codeReady, EnrolSteps } from './Totp';

type Props = { onSignedIn: (me: Me) => void };
/** The e-mailed sign-in code: when it dies and when «إعادة الإرسال» opens, as clock times. */
type OtpState = { token: string; email: string; expiresAt: number; resendAt: number };
/** M140: the authenticator step of an enrolled account, or the enrolment of a new one. */
type TotpState = { token: string; expiresAt: number };
type SetupState = { token: string; secret: string; uri: string; expiresAt: number };
/** M140: the first sign-in after enrolment pauses on the backup codes before the session opens. */
type Enrolled = { token: string; me: Me; codes: string[] };

/** Challenge codes after which the only way on is a fresh sign-in. */
const OTP_OVER = new Set(['otp_expired', 'otp_locked', 'otp_resend_limit', 'totp_expired', 'totp_locked']);

/**
 * Hub admin sign-in. An unverified e-mail answers "pending": the page then asks for the hub's 6-digit code.
 * With the server's ADMIN_OTP on, a right password answers "otp": the page asks for the short-lived code sent to the admin's e-mail.
 * With ADMIN_TOTP on (M140), the server then answers "totp" (the authenticator code) or "totpSetup" (link an authenticator first).
 */
export function Login({ onSignedIn }: Props) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState<{ token: string; text: string } | null>(null);
  const [otp, setOtp] = useState<OtpState | null>(null);
  const [totp, setTotp] = useState<TotpState | null>(null);
  const [setup, setSetup] = useState<SetupState | null>(null);
  const [enrolled, setEnrolled] = useState<Enrolled | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!otp && !totp && !setup) return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [otp, totp, setup]);

  function startOver(message: string | null = null) {
    setPending(null);
    setOtp(null);
    setTotp(null);
    setSetup(null);
    setEnrolled(null);
    setCode('');
    setPassword('');
    setError(message);
  }

  function finish(token: string, me: Me) {
    if (!me.isAdmin && !me.isModerator) {
      setError('هذه اللوحة لإدارة النادي فقط.');
      return;
    }
    session.set(token);
    onSignedIn(me);
  }

  function accept(result: AdminLoginResult) {
    if (result.pending) {
      setPending({ token: result.pendingToken, text: result.text });
      return;
    }
    const at = Date.now();
    setNow(at);
    setCode('');
    if ('otp' in result && result.otp) {
      setOtp({ token: result.challengeToken, email: result.email, expiresAt: at + result.seconds * 1000, resendAt: at + result.resendAfter * 1000 });
      return;
    }
    if ('totp' in result && result.totp) {
      setOtp(null);
      setTotp({ token: result.stepToken, expiresAt: at + result.seconds * 1000 });
      return;
    }
    if ('totpSetup' in result && result.totpSetup) {
      setOtp(null);
      setSetup({ token: result.setupToken, secret: result.secret, uri: result.uri, expiresAt: at + result.seconds * 1000 });
      return;
    }
    if ('token' in result) finish(result.token, result.me);
  }

  function fail(failure: unknown) {
    if (failure instanceof ApiError && (otp || totp || setup) && OTP_OVER.has(failure.code)) {
      startOver(failure.message);
      return;
    }
    setError(failure instanceof ApiError ? failure.message : 'حدث خطأ غير متوقع');
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (enrolled) finish(enrolled.token, enrolled.me);
      else if (setup) {
        const result = await api.totpEnroll(setup.token, code.trim());
        if (result.pending || !('token' in result)) throw new ApiError('حدث خطأ غير متوقع', 0, 'error');
        setSetup(null);
        setCode('');
        setEnrolled({ token: result.token, me: result.me, codes: result.backupCodes });
      } else if (totp) accept(await api.totpVerify(totp.token, code.trim()));
      else if (otp) accept(await api.otpVerify(otp.token, code.trim()));
      else if (pending) {
        // The hub e-mail is confirmed now, but that session is a member sign-in: drop it and sign in through the dashboard's route, which asks for the e-mailed code when the server wants one.
        const verified = await api.verify(pending.token, code.trim());
        if (!verified.pending) await api.logout(verified.token).catch(() => undefined);
        setPending(null);
        setCode('');
        accept(await api.login(login.trim(), password));
      } else accept(await api.login(login.trim(), password));
    } catch (failure) {
      fail(failure);
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (!otp) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.otpResend(otp.token);
      const at = Date.now();
      setNow(at);
      setCode('');
      setOtp({ ...otp, expiresAt: at + result.seconds * 1000, resendAt: at + result.resendAfter * 1000 });
    } catch (failure) {
      fail(failure);
    } finally {
      setBusy(false);
    }
  }

  const secondsLeft = otp ? Math.max(0, Math.ceil((otp.expiresAt - now) / 1000)) : 0;
  const resendIn = otp ? Math.max(0, Math.ceil((otp.resendAt - now) / 1000)) : 0;
  const stepLeft = totp || setup ? Math.max(0, Math.ceil(((totp ?? setup)!.expiresAt - now) / 1000)) : 0;
  const codeStep = Boolean(otp || pending || totp || setup);
  const disabled = busy || (otp !== null && (secondsLeft === 0 || code.length !== 6)) || (totp !== null && (stepLeft === 0 || !codeReady(code))) || (setup !== null && (stepLeft === 0 || !/^\d{6}$/.test(code)));

  return (
    <main className="login">
      <form className="card" onSubmit={submit}>
        <h1>لوحة إدارة نادي المستثمرين</h1>
        <p className="muted">الدخول لحسابات إدارة النادي والموديريتور فقط.</p>
        {enrolled ? (
          <>
            <p className="ok" role="status">تم ربط تطبيق المصادقة بحسابك. من الآن يطلب الدخول رمز التطبيق بعد كلمة المرور.</p>
            <BackupCodes codes={enrolled.codes} />
          </>
        ) : setup ? (
          <>
            <p>
              <strong>خطوة إلزامية لحسابات الإدارة:</strong> اربط تطبيق مصادقة بحسابك قبل الدخول الأول.
            </p>
            <EnrolSteps uri={setup.uri} secret={setup.secret} />
            <label>
              الرمز من تطبيق المصادقة
              <input inputMode="numeric" autoComplete="one-time-code" dir="ltr" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus required />
            </label>
            <p className={stepLeft > 0 ? 'muted' : 'error'} role="status">
              {stepLeft > 0 ? `تنتهي مهلة الربط خلال ${stepLeft} ثانية` : 'انتهت المهلة. ابدأ الدخول من جديد.'}
            </p>
          </>
        ) : totp ? (
          <>
            <p>افتح تطبيق المصادقة على جوالك واكتب الرمز المعروض لحساب Investors Club، أو أحد أكوادك الاحتياطية.</p>
            <label>
              رمز تطبيق المصادقة
              <input inputMode="text" autoComplete="one-time-code" dir="ltr" maxLength={9} value={code} onChange={(e) => setCode(cleanCode(e.target.value))} autoFocus required />
            </label>
            <p className={stepLeft > 0 ? 'muted' : 'error'} role="status">
              {stepLeft > 0 ? `تنتهي مهلة الدخول خلال ${stepLeft} ثانية` : 'انتهت المهلة. ابدأ الدخول من جديد.'}
            </p>
          </>
        ) : otp ? (
          <>
            <p>
              أرسلنا رمز الدخول إلى بريدك <bdi dir="ltr">{otp.email}</bdi>. الرمز يعمل مرة واحدة.
            </p>
            <label>
              رمز الدخول
              <input inputMode="numeric" autoComplete="one-time-code" dir="ltr" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus required />
            </label>
            <p className={secondsLeft > 0 ? 'muted' : 'error'} role="status">
              {secondsLeft > 0 ? `ينتهي الرمز خلال ${secondsLeft} ثانية` : 'انتهت صلاحية الرمز. اضغط «إعادة الإرسال».'}
            </p>
          </>
        ) : pending ? (
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
        <button className="primary" type="submit" disabled={disabled}>
          {busy ? 'جارٍ التحقق…' : enrolled ? 'حفظت الأكواد — دخول' : setup ? 'تأكيد الربط' : codeStep ? 'تأكيد الرمز' : 'دخول'}
        </button>
        {otp ? (
          <button className="link" type="button" onClick={() => void resend()} disabled={busy || resendIn > 0}>
            {resendIn > 0 ? `إعادة الإرسال بعد ${resendIn} ثانية` : 'إعادة الإرسال'}
          </button>
        ) : null}
        {codeStep ? (
          <button className="link" type="button" onClick={() => startOver()}>
            رجوع
          </button>
        ) : null}
      </form>
    </main>
  );
}
