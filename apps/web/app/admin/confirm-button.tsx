'use client';

import { useState } from 'react';

/** Geri alınamayan işlemler iki tıklama ister. Tarayıcının onay penceresi kullanılmaz. */
export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  disabled,
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return (
      <button type="button" className="small" disabled={disabled} onClick={() => setArmed(true)}>
        {label}
      </button>
    );
  }
  return (
    <span className="confirm">
      <button
        type="button"
        className="small danger"
        disabled={disabled}
        onClick={async () => {
          setArmed(false);
          await onConfirm();
        }}
      >
        {confirmLabel}
      </button>
      <button type="button" className="link" onClick={() => setArmed(false)}>
        Vazgeç
      </button>
    </span>
  );
}
