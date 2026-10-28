import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/**
 * M140: the pieces of the authenticator-app flow shared by the sign-in page and the «أمان الحساب» section —
 * the QR an authenticator scans (any app: Google Authenticator, Microsoft Authenticator, Authy, 1Password…),
 * the key for manual entry, and the one-time list of backup codes.
 */

export function QrImage({ uri }: { uri: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(uri, { margin: 1, width: 220, color: { dark: '#111111', light: '#ffffff' } })
      .then((data) => live && setSrc(data))
      .catch(() => live && setSrc(null));
    return () => {
      live = false;
    };
  }, [uri]);
  return src ? <img className="totp-qr" src={src} alt="رمز QR لتطبيق المصادقة" width={220} height={220} /> : <div className="totp-qr muted">…</div>;
}

/** The secret in groups of four, the way authenticator apps show it for typing by hand. */
export function SecretKey({ secret }: { secret: string }) {
  return (
    <p className="totp-secret" dir="ltr">
      {secret.replace(/(.{4})/g, '$1 ').trim()}
    </p>
  );
}

export function EnrolSteps({ uri, secret }: { uri: string; secret: string }) {
  return (
    <div className="totp-enrol">
      <ol className="totp-steps">
        <li>افتح تطبيق المصادقة على جوالك (Google Authenticator أو Microsoft Authenticator أو Authy أو أي تطبيق مماثل).</li>
        <li>امسح رمز QR، أو أدخل المفتاح يدويًا.</li>
        <li>اكتب الرمز المكوّن من 6 أرقام الذي يعرضه التطبيق.</li>
      </ol>
      <QrImage uri={uri} />
      <SecretKey secret={secret} />
    </div>
  );
}

export function BackupCodes({ codes }: { codes: string[] }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="confirm">
      <h3>الأكواد الاحتياطية</h3>
      <p className="muted">احفظها في مكان آمن. كل كود يعمل مرة واحدة إذا فقدت جوالك، ولن تظهر مرة أخرى.</p>
      <ul className="totp-codes" dir="ltr">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <button className="link" type="button" onClick={() => void copy()}>
        {copied ? 'تم النسخ' : 'نسخ الأكواد'}
      </button>
    </div>
  );
}

/** A 6-digit authenticator code, or a backup code («XXXX-XXXX»). */
export function cleanCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 9);
}

export function codeReady(value: string): boolean {
  return /^\d{6}$/.test(value) || /^[A-Z2-7]{4}-?[A-Z2-7]{4}$/.test(value);
}
