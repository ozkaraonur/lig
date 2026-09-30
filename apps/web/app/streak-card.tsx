'use client';

import { type StreakView } from '@lig/shared';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

/** Günlük seri ve XP jokeri. Ekran açılınca bugün etkin gün yazılır; ödül yalnızca XP ve görünümdür. */
export function StreakCard({ onXpChange }: { onXpChange?: () => void }) {
  const [streak, setStreak] = useState<StreakView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const visit = useCallback(async () => {
    try {
      const res = await apiFetch<{ streak: StreakView }>('/streak/visit', { method: 'POST' });
      setStreak(res.streak);
      onXpChange?.();
    } catch {
      /* Seri kartı yüklenemezse sayfanın geri kalanı etkilenmez. */
    }
  }, [onXpChange]);

  useEffect(() => {
    void visit();
    // Yalnızca ekran açılışında: günlük ziyaret bir kez yazılır.
  }, []);

  const activate = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ streak: StreakView }>('/streak/joker/activate', { method: 'POST' });
      setStreak(res.streak);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Joker etkinleştirilemedi.');
    } finally {
      setBusy(false);
    }
  };

  if (!streak) return null;
  const jokerActive = streak.joker.activeUntil !== null;

  return (
    <>
      <h2>Günlük seri</h2>
      <section className="card" aria-label="Günlük seri">
        <div className="card-row">
          <strong>{streak.days} gün</strong>
          <span className="muted">
            {streak.daysToMilestone} gün sonra +{streak.milestoneXp} XP ve bir XP jokeri
          </span>
        </div>
        {streak.atRisk && (
          <p className="muted">Dün gelmedin, kaçırma hakkını kullandın. Bugün gelmezsen seri biter.</p>
        )}
        <div className="card-row">
          <span>
            XP jokeri: <strong>{streak.joker.available}</strong> hazır
            {jokerActive &&
              ` · etkin, ${new Date(streak.joker.activeUntil!).toLocaleString('tr-TR')} tarihine kadar görev XP'si 2 kat`}
          </span>
          <button
            type="button"
            className="small"
            disabled={busy || jokerActive || streak.joker.available === 0}
            onClick={() => void activate()}
          >
            Jokeri etkinleştir
          </button>
        </div>
        <p className="muted">
          Joker yalnızca görev XP'sini 2 katlar. Portföy değerini ve sıralamayı etkilemez.
        </p>
        {error && <p role="alert">{error}</p>}
      </section>
    </>
  );
}
