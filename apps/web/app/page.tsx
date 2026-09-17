'use client';

import { type MeResponse } from '@lig/shared';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch, ApiRequestError, MOCK_PLATFORM_URL } from '../lib/api';
import { LeagueList } from './league-list';
import { QuestList } from './quest-list';
import { RealAccountLink } from './real-account-link';

type State =
  | { kind: 'loading' }
  | { kind: 'anonymous' }
  | ({ kind: 'player' } & MeResponse)
  | { kind: 'error'; message: string };

export default function PlayerHome() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  const load = useCallback(async () => {
    try {
      const me = await apiFetch<MeResponse>('/auth/me');
      setState({ kind: 'player', ...me });
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 401) setState({ kind: 'anonymous' });
      else
        setState({ kind: 'error', message: e instanceof Error ? e.message : 'Beklenmeyen bir hata oluştu.' });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const logout = async () => {
    await apiFetch('/auth/logout', { method: 'POST' }).catch(() => undefined);
    setState({ kind: 'anonymous' });
  };

  return (
    <main>
      <h1>Ligler</h1>
      {state.kind === 'loading' && <p>Yükleniyor...</p>}
      {state.kind === 'error' && <p role="alert">{state.message}</p>}
      {state.kind === 'anonymous' && (
        <>
          <p>Giriş yapılmadı. Gerçekte bu ekran platformun uygulamasından açılır.</p>
          <p>
            <a href={MOCK_PLATFORM_URL}>Sahte platformdan giriş yap</a>
          </p>
        </>
      )}
      {state.kind === 'player' && (
        <>
          <div className="card-row">
            <p>
              Hoş geldin, <strong>{state.player.displayName}</strong> ·{' '}
              <strong className="xp">{state.player.xp.toLocaleString('tr-TR')} XP</strong>
            </p>
            <button type="button" className="link" onClick={logout}>
              Çıkış yap
            </button>
          </div>
          <RealAccountLink platform={state.platform} />
          <LeagueList />
          <QuestList onProgress={load} />
        </>
      )}
    </main>
  );
}
