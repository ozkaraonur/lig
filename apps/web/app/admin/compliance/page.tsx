'use client';

import { type AdminMeResponse, type ComplianceUpdateRequest, type ComplianceView } from '@lig/shared';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { adminErrorMessage } from '../admin-errors';
import { AdminShell } from '../admin-shell';

export default function CompliancePage() {
  return <AdminShell>{(me) => <Compliance me={me} />}</AdminShell>;
}

const ADJUSTABLE: Array<{ key: keyof ComplianceView['adjustable']; label: string; description: string }> = [
  {
    key: 'realTradeButton',
    label: '"Gerçek hesabıma geç" butonu',
    description: 'Kapalıyken oyuncuya platformun işlem adresi gönderilmez, buton görünmez.',
  },
  {
    key: 'realTradeQuest',
    label: '"Gerçek işlem yap" görevi',
    description:
      'Kapalıyken görev listelenmez ve XP vermez. Hukuki değerlendirme tamamlanana kadar kapatmak isteyebilirsin.',
  },
];

function Compliance({ me }: { me: AdminMeResponse }) {
  const [view, setView] = useState<ComplianceView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isOwner = me.admin.role === 'owner';

  useEffect(() => {
    apiFetch<ComplianceView>('/admin/compliance')
      .then(setView)
      .catch((e: unknown) => setError(adminErrorMessage(e)));
  }, []);

  const change = async (body: ComplianceUpdateRequest) => {
    setError(null);
    try {
      setView(
        await apiFetch<ComplianceView>('/admin/compliance', { method: 'PATCH', body: JSON.stringify(body) }),
      );
    } catch (e) {
      setError(adminErrorMessage(e));
    }
  };

  return (
    <>
      <h1>Uyum ayarları</h1>
      <p>
        Kilitli ayarlar kodda sabittir; panelden ya da API'den değiştirilemez. Değişiklikler denetim kaydına
        girer.
      </p>
      {error && <p role="alert">{error}</p>}
      {!view ? (
        <p>Yükleniyor...</p>
      ) : (
        <>
          <h2>Kilitli</h2>
          <ul className="settings">
            {view.locked.map((s) => (
              <li key={s.key} className="card" data-testid={`locked-${s.key}`}>
                <div className="card-row">
                  <strong>{s.label}</strong>
                  <span className="badge">{s.enabled ? 'Açık · kilitli' : 'Kapalı · kilitli'}</span>
                </div>
                <span className="muted">{s.reason}</span>
              </li>
            ))}
          </ul>
          <h2>Platformun seçimi</h2>
          <ul className="settings">
            {ADJUSTABLE.map((s) => (
              <li key={s.key} className="card">
                <label className="check">
                  <input
                    type="checkbox"
                    name={s.key}
                    checked={view.adjustable[s.key]}
                    disabled={!isOwner}
                    onChange={(e) => void change({ [s.key]: e.target.checked })}
                  />
                  <strong>{s.label}</strong>
                </label>
                <span className="muted">{s.description}</span>
              </li>
            ))}
          </ul>
          {!isOwner && <p>Bu ayarları yalnızca sahip rolü değiştirebilir.</p>}
        </>
      )}
    </>
  );
}
