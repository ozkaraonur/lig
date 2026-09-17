'use client';

import { type AdminMfaSetupResponse } from '@lig/shared';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../../../lib/api';
import { adminErrorMessage } from '../../admin-errors';
import { MfaCodeForm } from '../code-form';
import { QrCode } from './qr-code';

export default function AdminMfaSetupPage() {
  const [setup, setSetup] = useState<AdminMfaSetupResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    // Geliştirme modunda effect iki kez çalışır. Sunucu aynı secret'ı döndürse de tek istek yeterli.
    if (started.current) return;
    started.current = true;
    apiFetch<AdminMfaSetupResponse>('/admin/auth/mfa/setup', { method: 'POST' })
      .then(setSetup)
      .catch((e: unknown) => setError(adminErrorMessage(e)));
  }, []);

  if (error) {
    return (
      <main>
        <h1>İki adımlı doğrulama kurulumu</h1>
        <p role="alert">{error}</p>
        <Link href="/admin/login">Giriş ekranına dön</Link>
      </main>
    );
  }

  return (
    <main>
      <h1>İki adımlı doğrulama kurulumu</h1>
      <p>Yönetim paneline girmek için bir doğrulama uygulaması zorunlu.</p>
      <ol className="steps">
        <li>Telefonunda Google Authenticator, Microsoft Authenticator ya da Bitwarden&apos;ı aç.</li>
        <li>Aşağıdaki QR kodu okut.</li>
        <li>Uygulamanın gösterdiği 6 haneli kodu gir.</li>
      </ol>
      {setup ? (
        <>
          <div className="card qr-card">
            <QrCode value={setup.otpauthUri} />
            <details>
              <summary>QR okutamıyorum</summary>
              <p>Uygulamada &quot;anahtarı elle gir&quot; seç ve bunu yaz:</p>
              <code className="secret">{setup.secret.match(/.{1,4}/g)?.join(' ')}</code>
            </details>
          </div>
          <MfaCodeForm submitLabel="Kurulumu bitir" />
        </>
      ) : (
        <p>Hazırlanıyor...</p>
      )}
    </main>
  );
}
