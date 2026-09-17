'use client';

import { type AdminMeResponse } from '@lig/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiFetch, ApiRequestError } from '../../lib/api';
import { ADMIN_ROLE_LABELS } from '../../lib/labels';

export default function AdminHome() {
  const router = useRouter();
  const [me, setMe] = useState<AdminMeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<AdminMeResponse>('/admin/auth/me')
      .then(setMe)
      .catch((e: unknown) => {
        if (e instanceof ApiRequestError && e.status === 401) router.replace('/admin/login');
        else setError('Panel yüklenemedi. API çalışıyor mu?');
      });
  }, [router]);

  const logout = async () => {
    await apiFetch('/admin/auth/logout', { method: 'POST' }).catch(() => undefined);
    router.replace('/admin/login');
  };

  if (error) {
    return (
      <main>
        <p role="alert">{error}</p>
      </main>
    );
  }
  if (!me) {
    return (
      <main>
        <p>Yükleniyor...</p>
      </main>
    );
  }

  return (
    <main>
      <div className="card-row">
        <h1>{me.tenant.name}</h1>
        <span className="badge">{ADMIN_ROLE_LABELS[me.admin.role]}</span>
      </div>
      <p>{me.admin.email}</p>
      <div className="card">
        <strong>Yönetim paneli</strong>
        <span className="muted">
          Lig, görev, marka ve metrik ekranları Faz 2&apos;nin sonraki adımlarında gelecek.
        </span>
      </div>
      <button type="button" onClick={logout}>
        Çıkış yap
      </button>
    </main>
  );
}
