'use client';

import { FRIENDS_LEAGUE, type FriendsLeagueResponse } from '@lig/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiFetch } from '../lib/api';

/** FR-09: arkadaş ligi kur ya da davet koduyla katıl. Arkadaş ligi XP ve rozet vermez, yalnızca üyeleri görür. */
export function FriendsPanel() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [days, setDays] = useState<number>(FRIENDS_LEAGUE.durationDays[0]);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (path: string, body: object) => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<FriendsLeagueResponse>(path, { method: 'POST', body: JSON.stringify(body) });
      router.push(`/leagues/${res.leagueId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'İşlem yapılamadı.');
      setBusy(false);
    }
  };

  return (
    <>
      <h2>Arkadaş ligi</h2>
      <section className="card" aria-label="Arkadaş ligi">
        <p className="muted">
          En fazla {FRIENDS_LEAGUE.maxMembers} kişilik kapalı lig. Davet koduyla girilir, yalnızca üyeler
          görür. XP ve rozet vermez.
        </p>

        <form
          className="friends-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit('/friends/leagues', { name, durationDays: days });
          }}
        >
          <label className="field">
            <span>Lig adı</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              minLength={3}
              maxLength={80}
              required
            />
          </label>
          <label className="field">
            <span>Süre</span>
            <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {FRIENDS_LEAGUE.durationDays.map((d) => (
                <option key={d} value={d}>
                  {d} gün
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="primary" disabled={busy}>
            Arkadaş ligi kur
          </button>
        </form>

        <form
          className="friends-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit('/friends/join', { code });
          }}
        >
          <label className="field">
            <span>Davet kodu</span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoCapitalize="characters"
              autoComplete="off"
              maxLength={40}
              required
            />
          </label>
          <button type="submit" disabled={busy}>
            Koda katıl
          </button>
        </form>
        {error && <p role="alert">{error}</p>}
      </section>
    </>
  );
}
