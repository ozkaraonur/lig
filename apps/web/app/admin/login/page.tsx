'use client';

import { type AdminLoginResponse } from '@lig/shared';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { adminErrorMessage } from '../admin-errors';

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<AdminLoginResponse>('/admin/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      // Parola bellekte tutulmaz.
      setPassword('');
      router.push(res.next === 'mfa_setup' ? '/admin/mfa/setup' : '/admin/mfa');
    } catch (e) {
      setError(adminErrorMessage(e));
      setBusy(false);
    }
  };

  return (
    <main>
      <h1>Yönetim paneli</h1>
      <p>Platform yöneticisi girişi</p>
      <form className="card form" onSubmit={submit}>
        <label>
          E-posta
          <input
            type="email"
            name="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          Parola
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            required
            maxLength={128}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Kontrol ediliyor...' : 'Devam et'}
        </button>
      </form>
    </main>
  );
}
