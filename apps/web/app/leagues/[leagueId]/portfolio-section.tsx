'use client';

import { formatCashTr, type OrderView, type PortfolioView } from '@lig/shared';
import { type ReactNode } from 'react';
import {
  formatPercent,
  formatPriceShort,
  formatQuantity,
  formatSignedCash,
  trendClass,
} from '../../../lib/labels';

const timeFormat = new Intl.DateTimeFormat('tr-TR', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/** FR-05: toplam değer, getiri, pozisyonlar ve son emirler. */
export function PortfolioSection({
  portfolio,
  orders,
  tradePanel,
}: {
  portfolio: PortfolioView;
  orders: OrderView[];
  /** Özet kartının hemen altında gösterilir. */
  tradePanel?: ReactNode;
}) {
  return (
    <>
      <div className="card">
        <span className="muted">Toplam değer</span>
        <div className="card-row">
          <strong className="big">{formatCashTr(portfolio.totalValue)}</strong>
          <span className={`badge-trend ${trendClass(portfolio.returnPercent)}`}>
            {formatPercent(portfolio.returnPercent)}
          </span>
        </div>
        <div className="card-row muted">
          <span>Nakit {formatCashTr(portfolio.cash)}</span>
          <span>Yatırım {formatCashTr(portfolio.positionsValue)}</span>
        </div>
      </div>

      {tradePanel}

      <h2>Pozisyonlar</h2>
      {portfolio.positions.length === 0 ? (
        <p>Henüz pozisyonun yok. Aşağıdan ilk emrini ver.</p>
      ) : (
        <table className="prices">
          <thead>
            <tr>
              <th>Varlık</th>
              <th className="num">Değer</th>
              <th className="num">K/Z</th>
            </tr>
          </thead>
          <tbody>
            {portfolio.positions.map((p) => (
              <tr key={p.assetId}>
                <td>
                  <strong>{p.symbol}</strong>
                  <br />
                  <span className="muted">
                    {formatQuantity(p.quantity)} · ort. {formatPriceShort(p.avgCost)}
                  </span>
                </td>
                <td className="num">{formatCashTr(p.value)}</td>
                <td className={`num ${trendClass(p.pnl)}`}>
                  {formatSignedCash(p.pnl)}
                  <br />
                  <span>{formatPercent(p.pnlPercent)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {orders.length > 0 && (
        <>
          <h2>Son emirler</h2>
          <ul className="orders">
            {orders.map((o) => (
              <li key={o.id} className="card-row">
                <span>
                  <strong className={o.side === 'buy' ? 'up' : 'down'}>
                    {o.side === 'buy' ? 'Al' : 'Sat'}
                  </strong>{' '}
                  {formatQuantity(o.quantity)} {o.symbol}
                </span>
                <span className="muted">
                  {formatCashTr(o.amount)} · {timeFormat.format(new Date(o.createdAt))}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
