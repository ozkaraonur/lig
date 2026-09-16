'use client';

import { formatCashTr, type LeagueSummary } from '@lig/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { formatDateRange, LEAGUE_PHASE_LABELS, LEAGUE_TYPE_LABELS } from '../lib/labels';

/** FR-02: oyuncunun platformundaki ligler. */
export function LeagueList() {
  const [leagues, setLeagues] = useState<LeagueSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ leagues: LeagueSummary[] }>('/leagues')
      .then((res) => setLeagues(res.leagues))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Ligler yüklenemedi.'));
  }, []);

  if (error) return <p role="alert">{error}</p>;
  if (!leagues) return <p>Ligler yükleniyor...</p>;
  if (leagues.length === 0) return <p>Şu an açık bir lig yok.</p>;

  return (
    <ul className="league-list">
      {leagues.map((league) => (
        <li key={league.id}>
          <Link href={`/leagues/${league.id}`} className={`card phase-${league.phase}`}>
            <div className="card-row">
              <strong>{league.name}</strong>
              <span className={`badge badge-${league.phase}`}>{LEAGUE_PHASE_LABELS[league.phase]}</span>
            </div>
            <div className="card-row muted">
              <span>
                {LEAGUE_TYPE_LABELS[league.type]} · {formatDateRange(league.startsAt, league.endsAt)}
              </span>
              <span>{league.memberCount} oyuncu</span>
            </div>
            <div className="card-row muted">
              <span>Başlangıç: {formatCashTr(league.startingCash)}</span>
              {league.joined && <span className="badge badge-joined">Katıldın</span>}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
