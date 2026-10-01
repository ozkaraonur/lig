'use client';

import { useState } from 'react';
import { downloadFile } from '../../lib/download';
import { adminErrorMessage } from './admin-errors';

/** CSV indirir; hata olursa düğmenin yanında gösterir. */
export function CsvDownloadButton({ path, label }: { path: string; label: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await downloadFile(path);
    } catch (e) {
      setError(adminErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" disabled={busy} onClick={() => void run()}>
        {label}
      </button>
      {error && <span role="alert"> {error}</span>}
    </>
  );
}
