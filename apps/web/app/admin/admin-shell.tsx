'use client';

import { type AdminMeResponse, type AdminRole } from '@lig/shared';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { apiFetch, ApiRequestError } from '../../lib/api';
import { ADMIN_ROLE_LABELS } from '../../lib/labels';

const LINKS: Array<{ href: string; label: string; roles?: AdminRole[] }> = [
  { href: '/admin', label: 'Panel' },
  { href: '/admin/metrics', label: 'Metrikler' },
  { href: '/admin/leagues', label: 'Ligler' },
  { href: '/admin/quests', label: 'Görevler' },
  { href: '/admin/branding', label: 'Marka' },
  { href: '/admin/compliance', label: 'Uyum' },
  { href: '/admin/team', label: 'Ekip', roles: ['owner'] },
  { href: '/admin/audit', label: 'Denetim kaydı', roles: ['owner'] },
  { href: '/admin/account', label: 'Hesabım' },
];

/**
 * Oturum gerektiren yönetim sayfalarının çerçevesi. Oturum yoksa girişe yönlendirir; rol yetmiyorsa içerik
 * yerine uyarı gösterir. Asıl yetki kontrolü API'de: bu yalnızca arayüz.
 */
export function AdminShell({
  roles,
  children,
}: {
  roles?: AdminRole[];
  children: (me: AdminMeResponse, reload: () => void) => ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<AdminMeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetch<AdminMeResponse>('/admin/auth/me')
      .then(setMe)
      .catch((e: unknown) => {
        if (e instanceof ApiRequestError && e.status === 401) router.replace('/admin/login');
        else setError('Panel yüklenemedi. API çalışıyor mu?');
      });
  }, [router]);

  useEffect(load, [load]);

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

  const allowed = !roles || roles.includes(me.admin.role);
  return (
    <main>
      <header className="admin-header">
        <div>
          <strong>{me.tenant.name}</strong>
          <span className="muted">
            {' '}
            · {me.admin.email} · {ADMIN_ROLE_LABELS[me.admin.role]}
          </span>
        </div>
        <button type="button" className="link" onClick={logout}>
          Çıkış yap
        </button>
      </header>
      <nav className="admin-nav">
        {LINKS.filter((l) => !l.roles || l.roles.includes(me.admin.role)).map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={
              pathname === l.href || (l.href !== '/admin' && pathname.startsWith(`${l.href}/`))
                ? 'active'
                : undefined
            }
          >
            {l.label}
          </Link>
        ))}
      </nav>
      {allowed ? children(me, load) : <p role="alert">Bu sayfa için yetkin yok.</p>}
    </main>
  );
}
