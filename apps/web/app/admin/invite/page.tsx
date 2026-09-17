'use client';

import { ADMIN_PASSWORD_MIN_LENGTH, type AdminInviteLookupResponse } from '@lig/shared';
import Link from 'next/link';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { ADMIN_ROLE_LABELS, formatDateTime } from '../../../lib/labels';
import { adminErrorMessage } from '../admin-errors';

type State =
  | { kind: 'loading' }
  | { kind: 'invalid'; message: string }
  | { kind: 'ready'; token: string; invite: AdminInviteLookupResponse }
  | { kind: 'done'; email: string };

/**
 * Davet linki `/admin/invite#token=...` biçiminde gelir. Token hemen adres çubuğundan silinir ve yalnızca
 * istek gövdesinde gönderilir.
 */
export default function InvitePage() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
    window.history.replaceState(null, '', window.location.pathname);
    if (!token) {
      setState({ kind: 'invalid', message: 'Davet linkinde token yok.' });
      return;
    }
    apiFetch<AdminInviteLookupResponse>('/admin/invites/lookup', {
      method: 'POST',
      body: JSON.stringify({ token }),
    })
      .then((invite) => setState({ kind: 'ready', token, invite }))
      .catch((e: unknown) => setState({ kind: 'invalid', message: adminErrorMessage(e) }));
  }, []);

  if (state.kind === 'loading') {
    return (
      <main>
        <p>Davet kontrol ediliyor...</p>
      </main>
    );
  }
  if (state.kind === 'invalid') {
    return (
      <main>
        <h1>Yönetici daveti</h1>
        <p role="alert">{state.message}</p>
        <p>Seni davet eden kişiden yeni bir link iste.</p>
      </main>
    );
  }
  if (state.kind === 'done') {
    return (
      <main>
        <h1>Hesabın hazır</h1>
        <p>
          {state.email} ile giriş yap. İlk girişte telefonundaki doğrulama uygulamasıyla iki adımlı
          doğrulamayı kuracaksın.
        </p>
        <Link href="/admin/login">Girişe git</Link>
      </main>
    );
  }

  const { token, invite } = state;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (password !== repeat) {
      setError('Parolalar aynı değil.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ email: string }>('/admin/invites/accept', {
        method: 'POST',
        body: JSON.stringify({ token, password }),
      });
      setState({ kind: 'done', email: res.email });
    } catch (e) {
      setError(adminErrorMessage(e));
      setBusy(false);
    }
  };

  return (
    <main>
      <h1>Yönetici daveti</h1>
      <p>
        <strong>{invite.tenantName}</strong> seni <strong>{ADMIN_ROLE_LABELS[invite.role]}</strong> olarak
        yönetim paneline davet etti. Davet {formatDateTime(invite.expiresAt)} tarihine kadar geçerli.
      </p>
      <form className="card form" onSubmit={submit}>
        <label>
          E-posta
          <input type="email" name="email" autoComplete="username" value={invite.email} readOnly />
        </label>
        <label>
          Parola (en az {ADMIN_PASSWORD_MIN_LENGTH} karakter)
          <input
            type="password"
            name="password"
            autoComplete="new-password"
            required
            minLength={ADMIN_PASSWORD_MIN_LENGTH}
            maxLength={128}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label>
          Parola (tekrar)
          <input
            type="password"
            name="repeat"
            autoComplete="new-password"
            required
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Hesap açılıyor...' : 'Hesabımı aç'}
        </button>
      </form>
    </main>
  );
}
