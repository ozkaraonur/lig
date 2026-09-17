'use client';

import { type AdminMeResponse } from '@lig/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { adminErrorMessage, isExpiredStep } from '../admin-errors';

/** 6 haneli doğrulama kodu. Doğruysa oturum açılır ve panele geçilir. */
export function MfaCodeForm({ submitLabel }: { submitLabel: string }) {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch<AdminMeResponse>('/admin/auth/mfa/verify', {
        method: 'POST',
        body: JSON.stringify({ code }),
      });
      router.replace('/admin');
    } catch (e) {
      setError(adminErrorMessage(e));
      setExpired(isExpiredStep(e));
      setCode('');
      setBusy(false);
    }
  };

  return (
    <form className="card form" onSubmit={submit}>
      <label>
        Doğrulama kodu
        <input
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          required
          placeholder="123456"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      {expired ? (
        <Link href="/admin/login">Giriş ekranına dön</Link>
      ) : (
        <button type="submit" className="primary" disabled={busy || code.length !== 6}>
          {busy ? 'Doğrulanıyor...' : submitLabel}
        </button>
      )}
    </form>
  );
}
