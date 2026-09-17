'use client';

import Link from 'next/link';
import { AdminShell } from './admin-shell';

export default function AdminHome() {
  return (
    <AdminShell>
      {(me) => (
        <>
          <h1>Yönetim paneli</h1>
          <div className="card">
            <strong>{me.tenant.name}</strong>
            <span className="muted">
              Ligleri, görevleri, marka ayarlarını ve uyum ayarlarını üstteki menüden yönetirsin. Modülün
              platforma etkisi için <Link href="/admin/metrics">Metrikler</Link> ekranına bak.
            </span>
          </div>
        </>
      )}
    </AdminShell>
  );
}
