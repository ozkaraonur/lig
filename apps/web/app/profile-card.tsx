'use client';

import { type FrameId, type ProfileView } from '@lig/shared';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { Avatar } from './avatar';

/** Rozetler görev worker'ıyla birkaç saniye içinde yazılır; yeni kazanılanı görmek için ara sıra yenilenir. */
const REFRESH_MS = 10_000;

/** FR-10: rozetler, unvan ve profil çerçevesi. Kazanılanlar yalnızca görünümdür, XP ya da sıralama vermez. */
export function ProfileCard({ displayName }: { displayName: string }) {
  const [profile, setProfile] = useState<ProfileView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(
    () =>
      apiFetch<{ profile: ProfileView }>('/profile')
        .then((res) => setProfile(res.profile))
        .catch(() => undefined),
    [],
  );

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const choose = async (change: { title?: string | null; frame?: string | null }) => {
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch<{ profile: ProfileView }>('/profile/appearance', {
        method: 'PUT',
        body: JSON.stringify(change),
      });
      setProfile(res.profile);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Seçim kaydedilemedi.');
    } finally {
      setSaving(false);
    }
  };

  if (!profile) return null;

  const title = profile.titles.find((t) => t.selected);
  const frame = profile.frames.find((f) => f.selected);
  const earned = profile.badges.filter((b) => b.earned).length;

  return (
    <>
      <h2>Profilim</h2>
      <section className="card profile" aria-label="Profilim">
        <div className="profile-head">
          <Avatar name={displayName} frame={(frame?.id as FrameId | undefined) ?? null} />
          <div>
            <strong>{displayName}</strong>
            <div className="muted">
              {title?.name}
              {frame ? ` · ${frame.name} çerçevesi` : ''}
            </div>
          </div>
        </div>

        <div className="card-row">
          <strong>Rozetler</strong>
          <span className="muted">
            {earned} / {profile.badges.length}
          </span>
        </div>
        <ul className="achievements">
          {profile.badges.map((b) => (
            <li key={b.id} className={`achievement ${b.earned ? 'earned' : 'locked'}`}>
              <strong>{b.name}</strong>
              <span className="muted">{b.description}</span>
              <span className={b.earned ? 'up' : 'muted'}>
                {b.earned ? 'Kazanıldı ✓' : 'Henüz kazanılmadı'}
              </span>
            </li>
          ))}
        </ul>

        <label className="field">
          <span>Unvan</span>
          <select
            value={title?.id ?? ''}
            disabled={saving}
            onChange={(e) => void choose({ title: e.target.value })}
          >
            {profile.titles.map((t) => (
              <option key={t.id} value={t.id} disabled={!t.owned}>
                {t.owned ? t.name : `${t.name} (${t.minXp.toLocaleString('tr-TR')} XP)`}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Çerçeve</span>
          <select
            value={frame?.id ?? ''}
            disabled={saving}
            onChange={(e) => void choose({ frame: e.target.value === '' ? null : e.target.value })}
          >
            <option value="">Çerçevesiz</option>
            {profile.frames.map((f) => {
              const badge = profile.badges.find((b) => b.id === f.badgeId);
              return (
                <option key={f.id} value={f.id} disabled={!f.owned}>
                  {f.owned ? f.name : `${f.name} (${badge?.name} rozetiyle açılır)`}
                </option>
              );
            })}
          </select>
        </label>

        {error && <p role="alert">{error}</p>}
      </section>
    </>
  );
}
