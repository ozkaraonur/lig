'use client';

import { formatCashTr, type LeaderboardEntry, type LeaderboardView } from '@lig/shared';
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { formatPercent, trendClass } from '../../../lib/labels';

/** Sıralamanın yenilenme aralığı. API sıralamayı 2 sn'de bir hesaplar. */
const REFRESH_MS = 4_000;

function Row({ entry }: { entry: LeaderboardEntry }) {
  return (
    <li className={`card-row rank-row ${entry.isMe ? 'me' : ''}`}>
      <span className="rank">{entry.rank}</span>
      <span className="name">
        {entry.displayName}
        {entry.isMe && <span className="muted"> (sen)</span>}
      </span>
      <span className="num">{formatCashTr(entry.totalValue)}</span>
      <span className={`num pct ${trendClass(entry.returnPercent)}`}>
        {formatPercent(entry.returnPercent)}
      </span>
    </li>
  );
}

/** FR-06: ilk 5 oyuncu ve oyuncunun kendi satırı. Lig kapandıysa dondurulmuş sonuç ve kazanılan XP (FR-32). */
export function LeaderboardSection({
  leagueId,
  finished,
  onFinal,
}: {
  leagueId: string;
  finished: boolean;
  onFinal: () => void;
}) {
  const [board, setBoard] = useState<LeaderboardView | null>(null);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  useEffect(() => {
    const load = () =>
      apiFetch<{ leaderboard: LeaderboardView }>(`/leagues/${leagueId}/leaderboard`)
        .then((res) => {
          setBoard(res.leaderboard);
          if (res.leaderboard.final && !finished) onFinalRef.current();
        })
        .catch(() => undefined);
    void load();
    // Kapanmış ligin sıralaması değişmez; tekrar sormaya gerek yok.
    if (finished) return;
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [leagueId, finished]);

  if (!board) return null;

  const meInTop = board.top.some((e) => e.isMe);

  return (
    <>
      <div className="card-row">
        <h2>{board.final ? 'Final sıralaması' : 'Sıralama'}</h2>
        <span className="muted">{board.playerCount} oyuncu</span>
      </div>

      {board.final && board.me && (
        <p className={`card ${board.me.xpAwarded ? 'up' : ''}`} role="status">
          {board.me.xpAwarded
            ? `Lig bitti. ${board.me.rank}. oldun ve ${board.me.xpAwarded} XP kazandın.`
            : `Lig bitti. ${board.me.rank}. oldun. Ödül için ligde en az bir emir vermiş olmak gerekiyordu.`}
        </p>
      )}

      {board.top.length === 0 ? (
        <p>{board.final ? 'Bu ligin sonucu yok.' : 'Sıralama birkaç saniye içinde hesaplanacak.'}</p>
      ) : (
        <ol className="leaderboard">
          {board.top.map((e) => (
            <Row key={`${e.rank}-${e.displayName}-${e.isMe}`} entry={e} />
          ))}
          {board.me && !meInTop && (
            <>
              <li className="gap" aria-hidden="true">
                ···
              </li>
              <Row entry={board.me} />
            </>
          )}
        </ol>
      )}
    </>
  );
}
