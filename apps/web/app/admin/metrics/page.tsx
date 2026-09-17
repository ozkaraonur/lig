'use client';

import {
  DEFAULT_METRIC_RANGE,
  formatRatio,
  type MetricRangeDays,
  METRIC_RANGE_DAYS,
  type MetricsResponse,
  ratio,
} from '@lig/shared';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { formatDateTime, LEAGUE_STATUS_LABELS } from '../../../lib/labels';
import { adminErrorMessage } from '../admin-errors';
import { AdminShell } from '../admin-shell';

export default function MetricsPage() {
  return <AdminShell>{() => <Metrics />}</AdminShell>;
}

const tr = (value: number) => value.toLocaleString('tr-TR');

function Metrics() {
  const [days, setDays] = useState<MetricRangeDays>(DEFAULT_METRIC_RANGE);
  const [report, setReport] = useState<MetricsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    apiFetch<MetricsResponse>(`/admin/metrics?days=${days}`)
      .then(setReport)
      .catch((e: unknown) => setError(adminErrorMessage(e)));
  }, [days]);
  useEffect(load, [load]);

  const totals = report?.totals;
  const breakdown = report?.realTradeBreakdown;

  return (
    <>
      <h1>Metrikler</h1>
      <p>
        Lig modülünün platforma etkisi (FR-23). Sayılar her açılışta canlı hesaplanır. Oyuncular platformdaki
        takma kimlikleriyle sayılır; ad, e-posta ya da IP tutulmaz.
      </p>
      <div className="segmented range">
        {METRIC_RANGE_DAYS.map((d) => (
          <button
            key={d}
            type="button"
            className={d === days ? 'active' : undefined}
            aria-pressed={d === days}
            onClick={() => setDays(d)}
          >
            Son {d} gün
          </button>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
      {!report || !totals || !breakdown ? (
        <p>Yükleniyor...</p>
      ) : (
        <>
          <h2>Gerçek işleme dönüşüm</h2>
          <div className="stats">
            <Stat label="Butona dokunan oyuncu" value={tr(totals.realTradeClickPlayers)} />
            <Stat
              label="Toplam dokunuş"
              value={tr(totals.realTradeClicks)}
              note={`aktif oyuncunun payı: ${formatRatio(
                ratio(totals.realTradeClickPlayers, totals.activePlayers),
              )}`}
            />
            <Stat label="Gerçek işlem bildirimi" value={tr(totals.realTrades)} />
            <Stat label="Açılan gerçek hesap" value={tr(totals.accountsOpened)} />
          </div>
          <div className="card">
            <strong>Gerçek işlem yapan kullanıcılar</strong>
            <span className="muted">
              Platformun bildirdiği gerçek işlemler, kullanıcının lig modülüyle ilişkisine göre.
            </span>
            <ul className="settings">
              <li className="card-row">
                <span>Bir lige katılmış oyuncular</span>
                <strong>{tr(breakdown.leaguePlayers)}</strong>
              </li>
              <li className="card-row">
                <span>Modülü açmış, lige katılmamış</span>
                <strong>{tr(breakdown.modulePlayers)}</strong>
              </li>
              <li className="card-row">
                <span>Lig modülünü hiç açmamış</span>
                <strong>{tr(breakdown.outsiders)}</strong>
              </li>
            </ul>
          </div>

          <h2>Katılım</h2>
          <div className="stats">
            <Stat label="Toplam oyuncu" value={tr(totals.players)} note="dönemden bağımsız" />
            <Stat label="Aktif oyuncu" value={tr(totals.activePlayers)} note="katılan ya da emir veren" />
            <Stat label="Lige katılma" value={tr(totals.joins)} />
            <Stat label="Emir" value={tr(totals.orders)} />
            <Stat label="Tamamlanan görev" value={tr(totals.questsCompleted)} />
            <Stat label="Dağıtılan XP" value={tr(totals.xpGranted)} />
          </div>

          <h2>Ligler</h2>
          {report.leagues.length === 0 ? (
            <p>Bu platformda henüz lig yok.</p>
          ) : (
            <div className="table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Lig</th>
                    <th>Durum</th>
                    <th className="num">Üye</th>
                    <th className="num">Emir</th>
                    <th className="num">Emir/üye</th>
                    <th className="num">Gerçek hesap dokunuşu</th>
                  </tr>
                </thead>
                <tbody>
                  {report.leagues.map((l) => (
                    <tr key={l.id}>
                      <td>{l.name}</td>
                      <td>{LEAGUE_STATUS_LABELS[l.status]}</td>
                      <td className="num">{tr(l.members)}</td>
                      <td className="num">{tr(l.orders)}</td>
                      <td className="num">
                        {l.members === 0
                          ? '-'
                          : (l.orders / l.members).toLocaleString('tr-TR', {
                              maximumFractionDigits: 1,
                            })}
                      </td>
                      <td className="num">{tr(l.realTradeClicks)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted notice-bar">
            {formatDateTime(report.since)} tarihinden bu yana. Hesaplanma anı:{' '}
            {formatDateTime(report.generatedAt)}.
          </p>
        </>
      )}
    </>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="stat">
      <span className="muted">{label}</span>
      <strong className="big">{value}</strong>
      {note && <span className="muted">{note}</span>}
    </div>
  );
}
