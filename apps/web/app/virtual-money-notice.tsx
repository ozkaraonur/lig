import { VIRTUAL_MONEY_DISCLAIMER } from '@lig/shared';

/** Kilitli uyum ayarı (FR-24): oyuncu ekranında her zaman görünür, kapatılamaz. */
export function VirtualMoneyNotice() {
  return (
    <p className="notice-bar" role="note">
      {VIRTUAL_MONEY_DISCLAIMER}
    </p>
  );
}
