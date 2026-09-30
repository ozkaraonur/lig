'use client';

import { tierName, type TierView } from '@lig/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

/** Kademe ligi: haftalık, yaklaşık 50 kişilik grup. Üst %20 yükselir, alt %20 düşer. Kademe yalnızca görünümdür. */
export function TierPanel() {
  const router = useRouter();
  const [tier, setTier] = useState<TierView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      apiFetch<{ tier: TierView }>('/tiers/me')
        .then((res) => setTier(res.tier))
        .catch(() => undefined),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ leagueId: string }>('/tiers/join', { method: 'POST' });
      router.push(`/leagues/${res.leagueId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Katılınamadı.');
      setBusy(false);
    }
  };

  if (!tier) return null;
  const move = tier.lastMovement;

  return (
    <>
      <h2>Kademe ligi</h2>
      <section className="card" aria-label="Kademe ligi">
        <div className="card-row">
          <strong>Kademen: {tier.tierName}</strong>
          <span className="muted">
            Hafta {new Date(tier.weekEndsAt).toLocaleDateString('tr-TR')} tarihinde biter
          </span>
        </div>
        {move && (
          <p className="muted">
            Son kademe değişimin: {tierName(move.from)} kademesinden {tierName(move.to)} kademesine, grubunda{' '}
            {move.rank}. sırada bitirerek.
          </p>
        )}
        {tier.league ? (
          <p>
            Bu haftaki grubun: <Link href={`/leagues/${tier.league.id}`}>{tier.league.name}</Link>
          </p>
        ) : (
          <div className="card-row">
            <span className="muted">Bu hafta henüz bir gruba katılmadın.</span>
            <button type="button" className="primary" disabled={busy} onClick={() => void join()}>
              Bu haftaki gruba katıl
            </button>
          </div>
        )}
        <p className="muted">
          Grubun en iyi %20'si yükselir, en kötü %20'si düşer. Kademe yalnızca görünümdür, XP ya da bakiye
          vermez.
        </p>
        {error && <p role="alert">{error}</p>}
      </section>
    </>
  );
}
