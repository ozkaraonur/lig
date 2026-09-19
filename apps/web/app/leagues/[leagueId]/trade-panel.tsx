'use client';

import {
  formatCashTr,
  formatDecimalTr,
  type LeagueAsset,
  type LeagueAssetPrice,
  type OrderSide,
  type PlaceOrderResponse,
  type PortfolioPosition,
} from '@lig/shared';
import { type FormEvent, useRef, useState } from 'react';
import { apiFetch, ApiRequestError } from '../../../lib/api';
import { formatQuantity } from '../../../lib/labels';

interface Props {
  leagueId: string;
  assets: LeagueAsset[];
  prices: LeagueAssetPrice[];
  cash: string;
  positions: PortfolioPosition[];
  onFilled: () => void;
  /** Seans kapalıyken hisse ligi işlem kabul etmez (7. adım); panel kilitlenir. */
  disabled?: boolean;
}

type Feedback = { kind: 'ok' | 'error'; message: string } | null;

/** FR-04: al/sat. Fiyat ve miktarı sunucu belirler; ekrandaki fiyat yalnızca bilgi içindir. */
export function TradePanel({ leagueId, assets, prices, cash, positions, onFilled, disabled = false }: Props) {
  const [assetId, setAssetId] = useState(assets[0]?.assetId ?? '');
  const [side, setSide] = useState<OrderSide>('buy');
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  /**
   * İdempotency anahtarı (FR-33): aynı emir ağ hatası yüzünden tekrar gönderilirse aynı anahtar gider,
   * sunucu ikinci kez işlem yapmaz. Sunucudan yanıt gelince ya da form değişince yeni anahtar üretilir.
   */
  const pendingKey = useRef<{ key: string; fingerprint: string } | null>(null);

  const price = prices.find((p) => p.assetId === assetId);
  const position = positions.find((p) => p.assetId === assetId);
  const symbol = assets.find((a) => a.assetId === assetId)?.symbol ?? '';
  const tradable = !!price?.price && !price.stale && !disabled;

  const resetKey = () => {
    pendingKey.current = null;
  };

  async function submit(body: Record<string, unknown>) {
    const fingerprint = JSON.stringify({ ...body, assetId });
    if (pendingKey.current?.fingerprint !== fingerprint) {
      pendingKey.current = { key: crypto.randomUUID(), fingerprint };
    }
    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await apiFetch<PlaceOrderResponse>(`/leagues/${leagueId}/orders`, {
        method: 'POST',
        body: JSON.stringify({ ...body, assetId, idempotencyKey: pendingKey.current.key }),
      });
      resetKey();
      const verb = res.order.side === 'buy' ? 'alındı' : 'satıldı';
      setFeedback({
        kind: 'ok',
        message: `${formatQuantity(res.order.quantity)} ${res.order.symbol} ${verb} · ${formatCashTr(res.order.amount)}`,
      });
      setAmount('');
      onFilled();
    } catch (e) {
      // Ağ hatasında anahtar korunur: kullanıcı tekrar basarsa aynı emir tekrar denenir, çift işlem olmaz.
      if (!(e instanceof ApiRequestError) || e.status !== 0) resetKey();
      setFeedback({ kind: 'error', message: e instanceof Error ? e.message : 'Emir gönderilemedi.' });
    } finally {
      setSubmitting(false);
    }
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit({ side, amount });
  };

  return (
    <form className="card trade" onSubmit={onSubmit}>
      <div className="segmented" role="group" aria-label="İşlem yönü">
        {(['buy', 'sell'] as const).map((s) => (
          <button
            key={s}
            type="button"
            className={side === s ? `active ${s}` : ''}
            aria-pressed={side === s}
            onClick={() => {
              setSide(s);
              resetKey();
              setFeedback(null);
            }}
          >
            {s === 'buy' ? 'Al' : 'Sat'}
          </button>
        ))}
      </div>

      <label>
        Varlık
        <select
          value={assetId}
          onChange={(e) => {
            setAssetId(e.target.value);
            resetKey();
          }}
        >
          {assets.map((a) => (
            <option key={a.assetId} value={a.assetId}>
              {a.symbol} · {a.name}
            </option>
          ))}
        </select>
      </label>

      <div className="card-row muted">
        <span>Fiyat</span>
        <span className={price?.stale && !disabled ? 'stale' : ''}>
          {price?.price ? `${formatDecimalTr(price.price)} ₺` : '—'}
          {price?.stale && (disabled ? ' (son kapanış)' : ' (güncel değil)')}
        </span>
      </div>
      <div className="card-row muted">
        <span>{side === 'buy' ? 'Kullanılabilir' : 'Elindeki'}</span>
        <span>
          {side === 'buy'
            ? formatCashTr(cash)
            : position
              ? `${formatQuantity(position.quantity)} ${symbol}`
              : '0'}
        </span>
      </div>

      <label>
        Tutar (₺)
        <input
          inputMode="decimal"
          autoComplete="off"
          placeholder="1000"
          value={amount}
          onChange={(e) => {
            // Türkçe klavyedeki virgül noktaya çevrilir; API yalnızca nokta kabul eder.
            setAmount(e.target.value.replace(',', '.').replace(/[^\d.]/g, ''));
            resetKey();
          }}
        />
      </label>

      <button type="submit" className={`primary ${side}`} disabled={submitting || !tradable || !amount}>
        {submitting ? 'Gönderiliyor...' : side === 'buy' ? `${symbol} al` : `${symbol} sat`}
      </button>
      {side === 'sell' && position && (
        <button
          type="button"
          className="link"
          disabled={submitting || !tradable}
          onClick={() => void submit({ side: 'sell', all: true })}
        >
          Tümünü sat
        </button>
      )}
      {!tradable && !disabled && <p className="muted">Güncel fiyat gelene kadar emir verilemez.</p>}
      {feedback && (
        <p
          role={feedback.kind === 'error' ? 'alert' : 'status'}
          className={feedback.kind === 'error' ? 'down' : 'up'}
        >
          {feedback.message}
        </p>
      )}
    </form>
  );
}
