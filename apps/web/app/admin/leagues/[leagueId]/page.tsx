'use client';

import { type AdminLeagueView, type AdminMeResponse, type UpdateLeagueBody } from '@lig/shared';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../../../lib/api';
import { LEAGUE_PHASE_LABELS, LEAGUE_STATUS_LABELS } from '../../../../lib/labels';
import { adminErrorMessage } from '../../admin-errors';
import { AdminShell } from '../../admin-shell';
import { ConfirmButton } from '../../confirm-button';
import { fromLocalInput, LeagueForm, type LeagueFormValues, valuesFromLeague } from '../league-form';

export default function LeaguePage() {
  return <AdminShell>{(me) => <League me={me} />}</AdminShell>;
}

/** Yalnızca değişen alanlar gönderilir; kilitli bir alana dokunulmadıysa sunucu itiraz etmez. */
function changes(before: LeagueFormValues, after: LeagueFormValues): UpdateLeagueBody {
  const body: UpdateLeagueBody = {};
  if (after.name !== before.name) body.name = after.name;
  if (after.type !== before.type) body.type = after.type;
  if (after.startsAt !== before.startsAt) body.startsAt = fromLocalInput(after.startsAt);
  if (after.endsAt !== before.endsAt) body.endsAt = fromLocalInput(after.endsAt);
  if (Number(after.startingCash) !== Number(before.startingCash)) body.startingCash = after.startingCash;
  if (after.assetIds.join() !== before.assetIds.join()) body.assetIds = after.assetIds;
  if (after.maxMembers !== before.maxMembers)
    body.maxMembers = after.maxMembers === '' ? null : Number(after.maxMembers);
  if (after.lateJoinAllowed !== before.lateJoinAllowed) body.lateJoinAllowed = after.lateJoinAllowed;
  return body;
}

function League({ me }: { me: AdminMeResponse }) {
  const router = useRouter();
  const params = useParams<{ leagueId: string }>();
  const leagueId = encodeURIComponent(params.leagueId);
  const [league, setLeague] = useState<AdminLeagueView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [version, setVersion] = useState(0);
  const canEdit = me.admin.role === 'owner' || me.admin.role === 'editor';

  const load = useCallback(() => {
    apiFetch<{ league: AdminLeagueView }>(`/admin/leagues/${leagueId}`)
      .then((res) => {
        setLeague(res.league);
        setVersion((v) => v + 1);
      })
      .catch((e: unknown) => setError(adminErrorMessage(e)));
  }, [leagueId]);
  useEffect(load, [load]);

  if (error && !league) {
    return (
      <>
        <Link href="/admin/leagues">← Ligler</Link>
        <p role="alert">{error}</p>
      </>
    );
  }
  if (!league) return <p>Yükleniyor...</p>;

  const initial = valuesFromLeague(league);
  const patch = async (body: UpdateLeagueBody) => {
    setSaved(false);
    setError(null);
    const res = await apiFetch<{ league: AdminLeagueView }>(`/admin/leagues/${leagueId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    setLeague(res.league);
    setVersion((v) => v + 1);
    setSaved(true);
  };
  const anyEditable = Object.entries(league.editable).some(([k, v]) => k !== 'delete' && v);

  return (
    <>
      <Link href="/admin/leagues">← Ligler</Link>
      <div className="card-row">
        <h1>{league.name}</h1>
        <span className={`badge badge-${league.status === 'active' ? league.phase : league.status}`}>
          {league.status === 'active'
            ? LEAGUE_PHASE_LABELS[league.phase]
            : LEAGUE_STATUS_LABELS[league.status]}
        </span>
      </div>
      <p>
        {league.memberCount} katılımcı
        {league.maxMembers !== null && ` / ${league.maxMembers} kontenjan`}
        {!anyEditable && ' · Bu lig artık değiştirilemez.'}
      </p>
      {saved && (
        <p role="status" className="ok">
          Kaydedildi.
        </p>
      )}
      {error && <p role="alert">{error}</p>}

      <LeagueForm
        key={version}
        initial={initial}
        editable={league.editable}
        readOnly={!canEdit || !anyEditable}
        submitLabel="Değişiklikleri kaydet"
        onSubmit={async (values) => {
          const body = changes(initial, values);
          if (Object.keys(body).length === 0) return;
          await patch(body);
        }}
      />

      {canEdit && (
        <div className="card">
          <strong>Yayın</strong>
          {league.status === 'draft' && (
            <>
              <span className="muted">Taslak oyunculara görünmez.</span>
              <ConfirmButton
                label="Yayına al"
                confirmLabel="Yayına al"
                onConfirm={() =>
                  patch({ status: 'active' }).catch((e: unknown) => setError(adminErrorMessage(e)))
                }
              />
            </>
          )}
          {league.status === 'active' && league.editable.status && (
            <ConfirmButton
              label="Taslağa geri al"
              confirmLabel="Taslağa al"
              onConfirm={() =>
                patch({ status: 'draft' }).catch((e: unknown) => setError(adminErrorMessage(e)))
              }
            />
          )}
          {league.status === 'active' && !league.editable.status && (
            <span className="muted">Katılımcısı olan ya da başlamış lig taslağa alınamaz.</span>
          )}
          {league.editable.delete && (
            <ConfirmButton
              label="Ligi sil"
              confirmLabel="Kalıcı olarak sil"
              onConfirm={async () => {
                try {
                  await apiFetch(`/admin/leagues/${leagueId}`, { method: 'DELETE' });
                  router.replace('/admin/leagues');
                } catch (e) {
                  setError(adminErrorMessage(e));
                }
              }}
            />
          )}
        </div>
      )}
    </>
  );
}
