'use client';

import {
  ADMIN_ROLES,
  type AdminInviteCreatedResponse,
  type AdminMeResponse,
  type AdminRole,
  type AdminTeamResponse,
} from '@lig/shared';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { ADMIN_ROLE_LABELS, formatDateTime } from '../../../lib/labels';
import { adminErrorMessage } from '../admin-errors';
import { AdminShell } from '../admin-shell';
import { ConfirmButton } from '../confirm-button';

export default function TeamPage() {
  return <AdminShell roles={['owner']}>{(me) => <Team me={me} />}</AdminShell>;
}

function Team({ me }: { me: AdminMeResponse }) {
  const [team, setTeam] = useState<AdminTeamResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<AdminInviteCreatedResponse | null>(null);

  const load = useCallback(() => {
    apiFetch<AdminTeamResponse>('/admin/team')
      .then(setTeam)
      .catch((e: unknown) => setError(adminErrorMessage(e)));
  }, []);
  useEffect(load, [load]);

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(adminErrorMessage(e));
    }
    load();
  };

  return (
    <>
      <h1>Ekip</h1>
      {error && <p role="alert">{error}</p>}

      <InviteForm
        onCreated={(res) => {
          setCreated(res);
          load();
        }}
      />
      {created && (
        <div className="card notice" data-testid="invite-link">
          <strong>Davet linki: yalnızca şimdi gösteriliyor</strong>
          <span className="muted">
            {created.invite.email} için. Linki kendin ilet; 72 saat geçerli, tek kullanımlık. Sayfadan çıkınca
            bir daha görüntülenemez, gerekirse yeni davet gönderirsin.
          </span>
          <code className="secret">{created.inviteUrl}</code>
          <button
            type="button"
            className="small"
            onClick={() => void navigator.clipboard?.writeText(created.inviteUrl).catch(() => undefined)}
          >
            Kopyala
          </button>
        </div>
      )}

      {!team ? (
        <p>Yükleniyor...</p>
      ) : (
        <>
          <h2>Yöneticiler</h2>
          <div className="table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>E-posta</th>
                  <th>Rol</th>
                  <th>MFA</th>
                  <th>Son giriş</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {team.admins.map((a) => {
                  const self = a.id === me.admin.id;
                  return (
                    <tr key={a.id}>
                      <td>
                        {a.email}
                        {self && <span className="muted"> (sen)</span>}
                      </td>
                      <td>
                        {self ? (
                          ADMIN_ROLE_LABELS[a.role]
                        ) : (
                          <select
                            aria-label={`${a.email} rolü`}
                            value={a.role}
                            onChange={(e) =>
                              void run(() =>
                                apiFetch(`/admin/team/${a.id}/role`, {
                                  method: 'PATCH',
                                  body: JSON.stringify({ role: e.target.value as AdminRole }),
                                }),
                              )
                            }
                          >
                            {ADMIN_ROLES.map((r) => (
                              <option key={r} value={r}>
                                {ADMIN_ROLE_LABELS[r]}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td>{a.mfaEnabled ? 'Kurulu' : 'İlk girişte'}</td>
                      <td>{a.lastLoginAt ? formatDateTime(a.lastLoginAt) : '—'}</td>
                      <td className="actions">
                        {!self && (
                          <>
                            <ConfirmButton
                              label="MFA sıfırla"
                              confirmLabel="Sıfırla"
                              onConfirm={() =>
                                run(() => apiFetch(`/admin/team/${a.id}/mfa-reset`, { method: 'POST' }))
                              }
                            />
                            <ConfirmButton
                              label="Kaldır"
                              confirmLabel="Kaldır"
                              onConfirm={() =>
                                run(() => apiFetch(`/admin/team/${a.id}`, { method: 'DELETE' }))
                              }
                            />
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <h2>Bekleyen davetler</h2>
          {team.invites.length === 0 ? (
            <p>Bekleyen davet yok.</p>
          ) : (
            <div className="table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>E-posta</th>
                    <th>Rol</th>
                    <th>Son geçerlilik</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {team.invites.map((i) => (
                    <tr key={i.id}>
                      <td>{i.email}</td>
                      <td>{ADMIN_ROLE_LABELS[i.role]}</td>
                      <td>{i.expired ? 'Süresi doldu' : formatDateTime(i.expiresAt)}</td>
                      <td className="actions">
                        <ConfirmButton
                          label="İptal et"
                          confirmLabel="İptal et"
                          onConfirm={() =>
                            run(() => apiFetch(`/admin/team/invites/${i.id}`, { method: 'DELETE' }))
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}

function InviteForm({ onCreated }: { onCreated: (res: AdminInviteCreatedResponse) => void }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AdminRole>('editor');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<AdminInviteCreatedResponse>('/admin/team/invites', {
        method: 'POST',
        body: JSON.stringify({ email, role }),
      });
      setEmail('');
      onCreated(res);
    } catch (e) {
      setError(adminErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card form inline-form" onSubmit={submit}>
      <strong>Yönetici davet et</strong>
      <div className="row">
        <label>
          E-posta
          <input
            type="email"
            name="invite-email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          Rol
          <select name="invite-role" value={role} onChange={(e) => setRole(e.target.value as AdminRole)}>
            {ADMIN_ROLES.map((r) => (
              <option key={r} value={r}>
                {ADMIN_ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <span className="muted">
        Sahip: ekip ve denetim kaydı dahil her şey. Düzenleyici: lig, görev ve marka ayarları. İzleyici:
        yalnızca görüntüleme.
      </span>
      {error && <p role="alert">{error}</p>}
      <button type="submit" className="primary" disabled={busy}>
        {busy ? 'Oluşturuluyor...' : 'Davet linki oluştur'}
      </button>
    </form>
  );
}
