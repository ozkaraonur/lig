'use client';

import { type AdminLeagueView, type CreateLeagueBody } from '@lig/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiFetch } from '../../../../lib/api';
import { AdminShell } from '../../admin-shell';
import { fromLocalInput, LeagueForm, type LeagueFormValues, toLocalInput } from '../league-form';

const DAY = 86_400_000;

function nextMonday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  return d;
}

export default function NewLeaguePage() {
  return <AdminShell roles={['owner', 'editor']}>{() => <NewLeague />}</AdminShell>;
}

function NewLeague() {
  const router = useRouter();
  const [publish, setPublish] = useState(false);
  const start = nextMonday();
  const initial: LeagueFormValues = {
    name: '',
    type: 'weekly',
    startsAt: toLocalInput(start.toISOString()),
    endsAt: toLocalInput(new Date(start.getTime() + 7 * DAY).toISOString()),
    startingCash: '100000',
    assetIds: [],
    maxMembers: '',
    lateJoinAllowed: true,
  };

  const create = async (v: LeagueFormValues) => {
    const res = await apiFetch<{ league: AdminLeagueView }>('/admin/leagues', {
      method: 'POST',
      body: JSON.stringify({
        name: v.name,
        type: v.type,
        startsAt: fromLocalInput(v.startsAt),
        endsAt: fromLocalInput(v.endsAt),
        startingCash: v.startingCash,
        assetIds: v.assetIds,
        maxMembers: v.maxMembers === '' ? null : Number(v.maxMembers),
        lateJoinAllowed: v.lateJoinAllowed,
        publish,
      } satisfies CreateLeagueBody),
    });
    router.push(`/admin/leagues/${res.league.id}`);
  };

  return (
    <>
      <h1>Yeni lig</h1>
      <p>Ödül alanı yok: lig sonu ödülleri yalnızca XP ve sistemde sabit (uyum ayarları).</p>
      <LeagueForm
        initial={initial}
        readOnly={false}
        submitLabel={publish ? 'Oluştur ve yayına al' : 'Taslak olarak kaydet'}
        extra={
          <label className="check">
            <input
              type="checkbox"
              name="publish"
              checked={publish}
              onChange={(e) => setPublish(e.target.checked)}
            />
            Hemen yayına al (oyuncular görür)
          </label>
        }
        onSubmit={create}
      />
    </>
  );
}
