'use client';

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
              Lig, görev, marka ve metrik ekranları Faz 2&apos;nin sonraki adımlarında gelecek.
            </span>
          </div>
        </>
      )}
    </AdminShell>
  );
}
