'use client';

import { type QuestView } from '@lig/shared';
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

const REFRESH_MS = 5_000;

/** FR-07: görevler, ilerleme ve ödül. Tamamlanan görevin XP'si arka planda birkaç saniye içinde eklenir. */
export function QuestList({ onProgress }: { onProgress?: () => void }) {
  const [quests, setQuests] = useState<QuestView[] | null>(null);

  useEffect(() => {
    let completedBefore = -1;
    const load = () =>
      apiFetch<{ quests: QuestView[] }>('/quests')
        .then((res) => {
          setQuests(res.quests);
          const completed = res.quests.filter((q) => q.completed).length;
          // Yeni görev tamamlandıysa üst bileşen toplam XP'yi yeniler.
          if (completedBefore >= 0 && completed > completedBefore) onProgress?.();
          completedBefore = completed;
        })
        .catch(() => undefined);
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [onProgress]);

  if (!quests || quests.length === 0) return null;

  return (
    <>
      <h2>Görevler</h2>
      <ul className="quests">
        {quests.map((q) => (
          <li key={q.id} className={`card quest ${q.completed ? 'done' : ''}`}>
            <div className="card-row">
              <strong>{q.title}</strong>
              <span className={q.completed ? 'up' : 'muted'}>
                {q.completed ? `+${q.xpReward} XP ✓` : `${q.xpReward} XP`}
              </span>
            </div>
            <div
              className="progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={q.target}
              aria-valuenow={q.progress}
              aria-label={q.title}
            >
              <span style={{ width: `${Math.round((q.progress / q.target) * 100)}%` }} />
            </div>
            <div className="card-row muted">
              <span>
                {q.progress} / {q.target}
              </span>
              {q.resetsAt && <span>Pazartesi yenilenir</span>}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
