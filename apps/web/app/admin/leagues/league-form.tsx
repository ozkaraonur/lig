'use client';

import {
  ADMIN_LEAGUE_TYPES,
  type AdminAssetView,
  type AdminLeagueType,
  type AdminLeagueView,
  type LeagueEditability,
} from '@lig/shared';
import { type FormEvent, useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { LEAGUE_TYPE_LABELS } from '../../../lib/labels';
import { adminErrorMessage } from '../admin-errors';

export interface LeagueFormValues {
  name: string;
  type: AdminLeagueType;
  startsAt: string;
  endsAt: string;
  startingCash: string;
  assetIds: string[];
  maxMembers: string;
  lateJoinAllowed: boolean;
}

/** `datetime-local` alanı saat dilimi taşımaz: tarayıcının yerel saatiyle ISO'ya çevrilir. */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(value: string): string {
  return new Date(value).toISOString();
}

export function valuesFromLeague(l: AdminLeagueView): LeagueFormValues {
  return {
    name: l.name,
    type: l.type === 'friends' || l.type === 'tier' ? 'weekly' : l.type,
    startsAt: toLocalInput(l.startsAt),
    endsAt: toLocalInput(l.endsAt),
    startingCash: String(Number(l.startingCash)),
    assetIds: l.assetIds,
    maxMembers: l.maxMembers === null ? '' : String(l.maxMembers),
    lateJoinAllowed: l.lateJoinAllowed,
  };
}

const ALL_EDITABLE: LeagueEditability = {
  name: true,
  type: true,
  startsAt: true,
  endsAt: true,
  startingCash: true,
  addAssets: true,
  removeAssets: true,
  maxMembers: true,
  lateJoinAllowed: true,
  status: true,
  delete: true,
};

/**
 * Lig formu (FR-20). Hangi alanın değişebileceğini API söyler (`editable`); burada yalnızca alanlar kapatılır,
 * asıl kontrol sunucuda.
 */
export function LeagueForm({
  initial,
  editable = ALL_EDITABLE,
  readOnly,
  submitLabel,
  extra,
  onSubmit,
}: {
  initial: LeagueFormValues;
  editable?: LeagueEditability;
  readOnly: boolean;
  submitLabel: string;
  extra?: React.ReactNode;
  onSubmit: (values: LeagueFormValues) => Promise<void>;
}) {
  const [values, setValues] = useState(initial);
  const [assets, setAssets] = useState<AdminAssetView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lockedAssets = new Set(editable.removeAssets ? [] : initial.assetIds);

  useEffect(() => {
    apiFetch<{ assets: AdminAssetView[] }>('/admin/leagues/assets')
      .then((res) => setAssets(res.assets))
      .catch((e: unknown) => setError(adminErrorMessage(e)));
  }, []);

  const set = <K extends keyof LeagueFormValues>(key: K, value: LeagueFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  const toggleAsset = (id: string) =>
    set(
      'assetIds',
      values.assetIds.includes(id) ? values.assetIds.filter((a) => a !== id) : [...values.assetIds, id],
    );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(values);
    } catch (e) {
      setError(adminErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const off = (field: keyof LeagueEditability) => readOnly || !editable[field];

  return (
    <form className="card form" onSubmit={submit}>
      <label>
        Ad
        <input
          name="name"
          required
          maxLength={80}
          value={values.name}
          disabled={off('name')}
          onChange={(e) => set('name', e.target.value)}
        />
      </label>
      <div className="row two">
        <label>
          Tip
          <select
            name="type"
            value={values.type}
            disabled={off('type')}
            onChange={(e) => set('type', e.target.value as AdminLeagueType)}
          >
            {ADMIN_LEAGUE_TYPES.map((t) => (
              <option key={t} value={t}>
                {LEAGUE_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Başlangıç bakiyesi (sanal ₺)
          <input
            name="startingCash"
            inputMode="decimal"
            required
            value={values.startingCash}
            disabled={off('startingCash')}
            onChange={(e) => set('startingCash', e.target.value.replace(',', '.'))}
          />
        </label>
      </div>
      <div className="row two">
        <label>
          Başlangıç
          <input
            type="datetime-local"
            name="startsAt"
            required
            value={values.startsAt}
            disabled={off('startsAt')}
            onChange={(e) => set('startsAt', e.target.value)}
          />
        </label>
        <label>
          Bitiş
          <input
            type="datetime-local"
            name="endsAt"
            required
            value={values.endsAt}
            disabled={off('endsAt')}
            onChange={(e) => set('endsAt', e.target.value)}
          />
        </label>
      </div>
      <fieldset className="assets" disabled={readOnly || (!editable.addAssets && !editable.removeAssets)}>
        <legend>Varlıklar</legend>
        {assets.map((a) => {
          const checked = values.assetIds.includes(a.id);
          const disabled = (checked && lockedAssets.has(a.id)) || (!checked && !editable.addAssets);
          return (
            <label key={a.id} className="check">
              <input
                type="checkbox"
                name="asset"
                value={a.symbol}
                checked={checked}
                disabled={disabled}
                onChange={() => toggleAsset(a.id)}
              />
              <strong>{a.symbol}</strong> <span className="muted">{a.name}</span>
            </label>
          );
        })}
        {!editable.removeAssets && !readOnly && (
          <span className="muted">Süren ligden varlık çıkarılamaz.</span>
        )}
      </fieldset>
      <fieldset className="assets">
        <legend>Katılım koşulu</legend>
        <label>
          Kontenjan (boş: sınırsız)
          <input
            name="maxMembers"
            inputMode="numeric"
            value={values.maxMembers}
            disabled={off('maxMembers')}
            onChange={(e) => set('maxMembers', e.target.value.replace(/\D/g, ''))}
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            name="lateJoinAllowed"
            checked={values.lateJoinAllowed}
            disabled={off('lateJoinAllowed')}
            onChange={(e) => set('lateJoinAllowed', e.target.checked)}
          />
          Lig başladıktan sonra da katılım açık
        </label>
      </fieldset>
      {extra}
      {error && <p role="alert">{error}</p>}
      {!readOnly && (
        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Kaydediliyor...' : submitLabel}
        </button>
      )}
    </form>
  );
}
