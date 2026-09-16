'use client';

import {
  formatCashTr,
  formatDecimalTr,
  type JoinLeagueResponse,
  type LeagueAssetPrice,
  type LeagueDetail,
} from '@lig/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch, ApiRequestError } from '../../../lib/api';
import { formatDateRange, LEAGUE_PHASE_LABELS, LEAGUE_TYPE_LABELS } from '../../../lib/labels';

/** Fiyat tablosunun yenilenme aralığı. API fiyatı saniyede bir alır. */
const PRICE_REFRESH_MS = 2_000;

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string; loginRequired: boolean }
  | { kind: 'ready'; league: LeagueDetail };

export default function LeaguePage() {
  const params = useParams<{ leagueId: string }>();
  // Adres çubuğundan gelen değer API yoluna ham eklenmez: "../auth/logout" gibi bir değer başka uca gidemez.
  const leagueId = encodeURIComponent(params.leagueId);
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [prices, setPrices] = useState<LeagueAssetPrice[]>([]);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { league } = await apiFetch<{ league: LeagueDetail }>(`/leagues/${leagueId}`);
      setState({ kind: 'ready', league });
      setPrices(league.assets);
    } catch (e) {
      const status = e instanceof ApiRequestError ? e.status : 0;
      const notFound = status === 400 || status === 404;
      setState({
        kind: 'error',
        message: notFound ? 'Lig bulunamadı.' : e instanceof Error ? e.message : 'Lig yüklenemedi.',
        loginRequired: status === 401,
      });
    }
  }, [leagueId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (state.kind !== 'ready') return;
    const timer = setInterval(() => {
      apiFetch<{ prices: LeagueAssetPrice[] }>(`/leagues/${leagueId}/prices`)
        .then((res) => setPrices(res.prices))
        .catch(() => undefined);
    }, PRICE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [leagueId, state.kind]);

  const join = async () => {
    setJoining(true);
    setJoinError(null);
    try {
      await apiFetch<JoinLeagueResponse>(`/leagues/${leagueId}/join`, { method: 'POST' });
      await load();
    } catch (e) {
      setJoinError(e instanceof Error ? e.message : 'Lige katılınamadı.');
    } finally {
      setJoining(false);
    }
  };

  if (state.kind === 'loading') {
    return (
      <main>
        <p>Yükleniyor...</p>
      </main>
    );
  }

  if (state.kind === 'error') {
    return (
      <main>
        <Link href="/">← Ligler</Link>
        <p role="alert">
          {state.loginRequired ? 'Oturumun bulunamadı. Platformdan tekrar giriş yap.' : state.message}
        </p>
      </main>
    );
  }

  const { league } = state;
  const assetNames = new Map(league.assets.map((a) => [a.assetId, a.name]));

  return (
    <main>
      <Link href="/">← Ligler</Link>
      <div className="card-row">
        <h1>{league.name}</h1>
        <span className={`badge badge-${league.phase}`}>{LEAGUE_PHASE_LABELS[league.phase]}</span>
      </div>
      <p>
        {LEAGUE_TYPE_LABELS[league.type]} · {formatDateRange(league.startsAt, league.endsAt)} ·{' '}
        {league.memberCount} oyuncu
      </p>

      {league.membership ? (
        <div className="card">
          <span className="muted">Sanal bakiyen</span>
          <strong className="big">{formatCashTr(league.membership.cash)}</strong>
        </div>
      ) : league.canJoin ? (
        <div className="card">
          <span className="muted">Katılınca {formatCashTr(league.startingCash)} sanal bakiye alırsın.</span>
          <button type="button" className="primary" onClick={join} disabled={joining}>
            {joining ? 'Katılıyor...' : 'Lige katıl'}
          </button>
          {joinError && <p role="alert">{joinError}</p>}
        </div>
      ) : (
        <p>Bu lig katılıma kapalı.</p>
      )}

      <h2>Fiyatlar</h2>
      <table className="prices">
        <thead>
          <tr>
            <th>Varlık</th>
            <th className="num">Fiyat (₺)</th>
          </tr>
        </thead>
        <tbody>
          {prices.map((p) => (
            <tr key={p.assetId}>
              <td>
                <strong>{p.symbol}</strong> <span className="muted">{assetNames.get(p.assetId)}</span>
              </td>
              <td className={`num ${p.stale ? 'stale' : ''}`}>
                {p.price ? formatDecimalTr(p.price) : '—'}
                {p.stale && <span className="muted"> (güncel değil)</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
