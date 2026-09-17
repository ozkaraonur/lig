'use client';

import {
  type AdminQuestView,
  type AdminMeResponse,
  type CreateQuestRequest,
  MAX_QUESTS_PER_TENANT,
  QUEST_PERIOD_LABELS,
  QUEST_PERIODS,
  QUEST_TEMPLATE_LABELS,
  QUEST_TEMPLATES,
  type QuestPeriod,
  type QuestTemplate,
} from '@lig/shared';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { adminErrorMessage } from '../admin-errors';
import { AdminShell } from '../admin-shell';
import { ConfirmButton } from '../confirm-button';

export default function QuestsPage() {
  return (
    <AdminShell>
      {(me) => <Quests canEdit={me.admin.role === 'owner' || me.admin.role === 'editor'} me={me} />}
    </AdminShell>
  );
}

function Quests({ canEdit }: { canEdit: boolean; me: AdminMeResponse }) {
  const [quests, setQuests] = useState<AdminQuestView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetch<{ quests: AdminQuestView[] }>('/admin/quests')
      .then((res) => setQuests(res.quests))
      .catch((e: unknown) => setError(adminErrorMessage(e)));
  }, []);
  useEffect(load, [load]);

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(adminErrorMessage(e));
    }
    load();
  };

  return (
    <>
      <h1>Görevler</h1>
      <p>
        Oyuncular görevleri tamamladıkça XP kazanır. Ödül yalnızca XP olabilir. Aynı şablon ve dönemden tek
        görev tanımlanır; toplam {MAX_QUESTS_PER_TENANT} görev kombinasyonu var. Görev şablonu ve dönemi
        sonradan değişmez.
      </p>
      {error && <p role="alert">{error}</p>}
      {canEdit && <QuestForm onCreated={load} />}
      {!quests ? (
        <p>Yükleniyor...</p>
      ) : quests.length === 0 ? (
        <p>Henüz görev yok.</p>
      ) : (
        <div className="table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Görev</th>
                <th>Dönem</th>
                <th>Hedef</th>
                <th>XP</th>
                <th>Tamamlayan</th>
                <th>Durum</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {quests.map((q) => (
                <tr key={q.id}>
                  <td>{q.title}</td>
                  <td>{QUEST_PERIOD_LABELS[q.period]}</td>
                  <td>
                    {canEdit ? (
                      <NumberCell
                        label={`${q.title} hedefi`}
                        value={q.targetCount}
                        onSave={(value) =>
                          run(() =>
                            apiFetch(`/admin/quests/${q.id}`, {
                              method: 'PATCH',
                              body: JSON.stringify({ targetCount: value }),
                            }),
                          )
                        }
                      />
                    ) : (
                      q.targetCount
                    )}
                  </td>
                  <td>
                    {canEdit ? (
                      <NumberCell
                        label={`${q.title} XP`}
                        value={q.xpReward}
                        onSave={(value) =>
                          run(() =>
                            apiFetch(`/admin/quests/${q.id}`, {
                              method: 'PATCH',
                              body: JSON.stringify({ xpReward: value }),
                            }),
                          )
                        }
                      />
                    ) : (
                      q.xpReward
                    )}
                  </td>
                  <td>{q.completions}</td>
                  <td>
                    {canEdit ? (
                      <label className="check">
                        <input
                          type="checkbox"
                          aria-label={`${q.title} aktif`}
                          checked={q.active}
                          onChange={(e) =>
                            void run(() =>
                              apiFetch(`/admin/quests/${q.id}`, {
                                method: 'PATCH',
                                body: JSON.stringify({ active: e.target.checked }),
                              }),
                            )
                          }
                        />
                        {q.active ? 'Aktif' : 'Pasif'}
                      </label>
                    ) : (
                      <span>{q.active ? 'Aktif' : 'Pasif'}</span>
                    )}
                  </td>
                  <td className="actions">
                    {canEdit &&
                      (q.deletable ? (
                        <ConfirmButton
                          label="Sil"
                          confirmLabel="Sil"
                          onConfirm={() => run(() => apiFetch(`/admin/quests/${q.id}`, { method: 'DELETE' }))}
                        />
                      ) : (
                        <span className="muted">XP dağıttı</span>
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** Tabloda tek alanlık düzenleme: değer değişince kaydeder. */
function NumberCell({
  label,
  value,
  onSave,
}: {
  label: string;
  value: number;
  onSave: (value: number) => void | Promise<void>;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <input
      className="cell-input"
      aria-label={label}
      inputMode="numeric"
      value={text}
      onChange={(e) => setText(e.target.value.replace(/\D/g, ''))}
      onBlur={() => {
        const next = Number(text);
        if (next > 0 && next !== value) void onSave(next);
        else setText(String(value));
      }}
    />
  );
}

function QuestForm({ onCreated }: { onCreated: () => void }) {
  const [template, setTemplate] = useState<QuestTemplate>('place_orders');
  const [period, setPeriod] = useState<QuestPeriod>('weekly');
  const [targetCount, setTargetCount] = useState('5');
  const [xpReward, setXpReward] = useState('100');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/admin/quests', {
        method: 'POST',
        body: JSON.stringify({
          template,
          period,
          targetCount: Number(targetCount),
          xpReward: Number(xpReward),
        } satisfies Omit<CreateQuestRequest, 'active'>),
      });
      onCreated();
    } catch (e) {
      setError(adminErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card form inline-form" onSubmit={submit}>
      <strong>Görev ekle</strong>
      <div className="row four">
        <label>
          Şablon
          <select
            name="template"
            value={template}
            onChange={(e) => setTemplate(e.target.value as QuestTemplate)}
          >
            {QUEST_TEMPLATES.map((t) => (
              <option key={t} value={t}>
                {QUEST_TEMPLATE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Dönem
          <select name="period" value={period} onChange={(e) => setPeriod(e.target.value as QuestPeriod)}>
            {QUEST_PERIODS.map((p) => (
              <option key={p} value={p}>
                {QUEST_PERIOD_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Hedef
          <input
            name="targetCount"
            inputMode="numeric"
            value={targetCount}
            onChange={(e) => setTargetCount(e.target.value.replace(/\D/g, ''))}
          />
        </label>
        <label>
          XP ödülü
          <input
            name="xpReward"
            inputMode="numeric"
            value={xpReward}
            onChange={(e) => setXpReward(e.target.value.replace(/\D/g, ''))}
          />
        </label>
      </div>
      {error && <p role="alert">{error}</p>}
      <button type="submit" className="primary" disabled={busy}>
        {busy ? 'Ekleniyor...' : 'Görevi ekle'}
      </button>
    </form>
  );
}
