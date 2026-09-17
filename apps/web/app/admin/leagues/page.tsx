'use client';

import { type AdminLeagueView, formatCashTr } from '@lig/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import {
  formatDateRange,
  LEAGUE_PHASE_LABELS,
  LEAGUE_STATUS_LABELS,
  LEAGUE_TYPE_LABELS,
} from '../../../lib/labels';
import { adminErrorMessage } from '../admin-errors';
import { AdminShell } from '../admin-shell';

export default function LeaguesPage() {
  return (
    <AdminShell>
      {(me) => <Leagues canEdit={me.admin.role === 'owner' || me.admin.role === 'editor'} />}
    </AdminShell>
  );
}

function statusText(l: AdminLeagueView): string {
  if (l.status !== 'active') return LEAGUE_STATUS_LABELS[l.status];
  return LEAGUE_PHASE_LABELS[l.phase];
}

function Leagues({ canEdit }: { canEdit: boolean }) {
  const [leagues, setLeagues] = useState<AdminLeagueView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ leagues: AdminLeagueView[] }>('/admin/leagues')
      .then((res) => setLeagues(res.leagues))
      .catch((e: unknown) => setError(adminErrorMessage(e)));
  }, []);

  return (
    <>
      <div className="card-row">
        <h1>Ligler</h1>
        {canEdit && (
          <Link href="/admin/leagues/new" className="button-link primary">
            Yeni lig
          </Link>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      {!leagues ? (
        <p>Yükleniyor...</p>
      ) : leagues.length === 0 ? (
        <p>Henüz lig yok.</p>
      ) : (
        <div className="table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Ad</th>
                <th>Tip</th>
                <th>Durum</th>
                <th>Tarih</th>
                <th>Bakiye</th>
                <th>Katılımcı</th>
              </tr>
            </thead>
            <tbody>
              {leagues.map((l) => (
                <tr key={l.id}>
                  <td>
                    <Link href={`/admin/leagues/${l.id}`}>{l.name}</Link>
                  </td>
                  <td>{LEAGUE_TYPE_LABELS[l.type]}</td>
                  <td>
                    <span className={`badge badge-${l.status === 'active' ? l.phase : l.status}`}>
                      {statusText(l)}
                    </span>
                  </td>
                  <td>{formatDateRange(l.startsAt, l.endsAt)}</td>
                  <td>{formatCashTr(l.startingCash)}</td>
                  <td>
                    {l.memberCount}
                    {l.maxMembers !== null && <span className="muted"> / {l.maxMembers}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
