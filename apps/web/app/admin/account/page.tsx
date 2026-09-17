'use client';

import { ADMIN_PASSWORD_MIN_LENGTH } from '@lig/shared';
import { type FormEvent, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { adminErrorMessage } from '../admin-errors';
import { AdminShell } from '../admin-shell';
import { ConfirmButton } from '../confirm-button';

export default function AccountPage() {
  return <AdminShell>{() => <Account />}</AdminShell>;
}

function Account() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const changePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (next !== repeat) {
      setMessage({ ok: false, text: 'Yeni parolalar aynı değil.' });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await apiFetch('/admin/account/password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      setMessage({ ok: true, text: 'Parola değişti. Diğer cihazlardaki oturumların kapatıldı.' });
    } catch (e) {
      setMessage({ ok: false, text: adminErrorMessage(e) });
    } finally {
      setCurrent('');
      setNext('');
      setRepeat('');
      setBusy(false);
    }
  };

  const revokeOthers = async () => {
    setMessage(null);
    try {
      await apiFetch('/admin/account/sessions/revoke-others', { method: 'POST' });
      setMessage({ ok: true, text: 'Diğer bütün oturumlar kapatıldı. Bu tarayıcıda açık kaldın.' });
    } catch (e) {
      setMessage({ ok: false, text: adminErrorMessage(e) });
    }
  };

  return (
    <>
      <h1>Hesabım</h1>
      {message && (
        <p role={message.ok ? 'status' : 'alert'} className={message.ok ? 'ok' : undefined}>
          {message.text}
        </p>
      )}
      <form className="card form" onSubmit={changePassword}>
        <strong>Parola değiştir</strong>
        <label>
          Mevcut parola
          <input
            type="password"
            name="current-password"
            autoComplete="current-password"
            required
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </label>
        <label>
          Yeni parola (en az {ADMIN_PASSWORD_MIN_LENGTH} karakter)
          <input
            type="password"
            name="new-password"
            autoComplete="new-password"
            required
            minLength={ADMIN_PASSWORD_MIN_LENGTH}
            maxLength={128}
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </label>
        <label>
          Yeni parola (tekrar)
          <input
            type="password"
            name="repeat-password"
            autoComplete="new-password"
            required
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
          />
        </label>
        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Değiştiriliyor...' : 'Parolayı değiştir'}
        </button>
      </form>
      <div className="card">
        <strong>Diğer oturumlar</strong>
        <span className="muted">
          Başka bir bilgisayarda ya da tarayıcıda açık kalan bütün oturumları kapatır. Bu tarayıcıda açık
          kalırsın.
        </span>
        <ConfirmButton label="Diğer oturumları kapat" confirmLabel="Hepsini kapat" onConfirm={revokeOthers} />
      </div>
    </>
  );
}
