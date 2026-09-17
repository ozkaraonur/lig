'use client';

import { type AuditEventView, type AuditListResponse, type AuditVerifyResponse } from '@lig/shared';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { ADMIN_ROLE_LABELS, AUDIT_ACTION_LABELS, formatDateTime } from '../../../lib/labels';
import { adminErrorMessage } from '../admin-errors';
import { AdminShell } from '../admin-shell';

const PAGE_SIZE = 50;

export default function AuditPage() {
  return <AdminShell roles={['owner']}>{() => <Audit />}</AdminShell>;
}

function actorText(e: AuditEventView): string {
  if (e.actorType === 'admin') return e.actorEmail ?? 'Yönetici';
  if (e.actorType === 'cli') return 'Komut satırı';
  if (e.actorType === 'system') return 'Sistem';
  return 'Doğrulanmamış kişi';
}

const METADATA_KEYS: Record<string, string> = {
  role: 'rol',
  from: 'önceki',
  to: 'yeni',
  reason: 'sebep',
  stage: 'adım',
  name: 'ad',
  type: 'tip',
  status: 'durum',
  startsAt: 'başlangıç',
  endsAt: 'bitiş',
  startingCash: 'bakiye',
  maxMembers: 'kontenjan',
  lateJoinAllowed: 'geç katılım',
  assets: 'varlıklar',
  assetsAdded: 'eklenen varlık',
  assetsRemoved: 'çıkarılan varlık',
  members: 'katılımcı',
  realTradeButton: '"Gerçek hesabıma geç" butonu',
  realTradeQuest: '"Gerçek işlem yap" görevi',
};
const METADATA_VALUES: Record<string, string> = {
  ...ADMIN_ROLE_LABELS,
  password: 'parola',
  setup: 'kurulum',
  verify: 'giriş',
  draft: 'taslak',
  active: 'yayında',
  finished: 'kapandı',
  weekly: 'haftalık',
  season: 'sezon',
  true: 'açık',
  false: 'kapalı',
  null: 'yok',
};
/** Ekranda gösterilmeyen teknik alanlar (kayıtta durur). */
const HIDDEN_KEYS = new Set(['inviteId']);

function valueText(key: string, v: unknown): string {
  const text = String(v);
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return formatDateTime(text);
  if (key === 'members' || key.startsWith('maxMembers')) return text === 'null' ? 'sınırsız' : text;
  return METADATA_VALUES[text] ?? text;
}

/** `adFrom` / `adTo` çiftleri "ad: eski → yeni" olarak birleşir. */
function metadataText(metadata: AuditEventView['metadata']): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  for (const [key, value] of Object.entries(metadata)) {
    if (HIDDEN_KEYS.has(key) || seen.has(key)) continue;
    const pair = /^(.+)(From|To)$/.exec(key);
    if (pair && pair[1]) {
      const base = pair[1];
      seen.add(`${base}From`);
      seen.add(`${base}To`);
      parts.push(
        `${METADATA_KEYS[base] ?? base}: ${valueText(base, metadata[`${base}From`])} → ${valueText(base, metadata[`${base}To`])}`,
      );
      continue;
    }
    if (key === 'from' || key === 'to') {
      if (seen.has('from')) continue;
      seen.add('from');
      seen.add('to');
      parts.push(`${valueText('role', metadata.from)} → ${valueText('role', metadata.to)}`);
      continue;
    }
    parts.push(`${METADATA_KEYS[key] ?? key}: ${valueText(key, value)}`);
  }
  return parts.join(', ');
}

function Audit() {
  const [events, setEvents] = useState<AuditEventView[]>([]);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verify, setVerify] = useState<AuditVerifyResponse | null>(null);

  const loadPage = useCallback(async (before: number | null) => {
    try {
      const query = before === null ? `?limit=${PAGE_SIZE}` : `?limit=${PAGE_SIZE}&before=${before}`;
      const res = await apiFetch<AuditListResponse>(`/admin/audit${query}`);
      setEvents((prev) => (before === null ? res.events : [...prev, ...res.events]));
      setNextBefore(res.nextBefore);
    } catch (e) {
      setError(adminErrorMessage(e));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void loadPage(null);
  }, [loadPage]);

  const runVerify = async () => {
    setVerify(null);
    try {
      setVerify(await apiFetch<AuditVerifyResponse>('/admin/audit/verify'));
    } catch (e) {
      setError(adminErrorMessage(e));
    }
  };

  return (
    <>
      <h1>Denetim kaydı</h1>
      <p>
        Kayıtlar değiştirilemez ve silinemez. Her kayıt bir öncekinin özetini taşır; araya eklenen ya da
        değiştirilen kayıt doğrulamada görünür.
      </p>
      <div className="card">
        <button type="button" className="small" onClick={() => void runVerify()}>
          Zinciri doğrula
        </button>
        {verify &&
          (verify.ok ? (
            <span className="ok" role="status" data-testid="verify-result">
              Sağlam: {verify.checked} kayıt. Son özet: <code>{verify.lastHash?.slice(0, 16) ?? '—'}</code>
            </span>
          ) : (
            <span role="alert" data-testid="verify-result">
              Zincir bozuk: #{verify.brokenAtSeq} numaralı kayıtta tutarsızlık var.
            </span>
          ))}
      </div>
      {error && <p role="alert">{error}</p>}
      {!loaded ? (
        <p>Yükleniyor...</p>
      ) : events.length === 0 ? (
        <p>Henüz kayıt yok.</p>
      ) : (
        <div className="table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Zaman</th>
                <th>İşlem</th>
                <th>Yapan</th>
                <th>Hedef</th>
                <th>Ayrıntı</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.seq}>
                  <td className="muted">{e.seq}</td>
                  <td>{formatDateTime(e.occurredAt)}</td>
                  <td>{AUDIT_ACTION_LABELS[e.action] ?? e.action}</td>
                  <td>{actorText(e)}</td>
                  <td>{e.targetLabel ?? '—'}</td>
                  <td className="muted">{metadataText(e.metadata) || '—'}</td>
                  <td className="muted">{e.ip ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {nextBefore !== null && (
        <button type="button" onClick={() => void loadPage(nextBefore)}>
          Daha eski kayıtlar
        </button>
      )}
    </>
  );
}
