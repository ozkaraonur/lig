import { type FrameId } from '@lig/shared';

/**
 * Oyuncunun baş harfi ve seçtiği profil çerçevesi (FR-10). Çerçeve yalnızca süstür: rengi CSS'te
 * (`frame-<id>`), anlamı ekranda ayrıca yazıyla verilir; renge tek başına güvenilmez.
 */
export function Avatar({ name, frame }: { name: string; frame: FrameId | null }) {
  return (
    <span className={`avatar frame-${frame ?? 'none'}`} aria-hidden="true">
      {Array.from(name.trim())[0]?.toLocaleUpperCase('tr-TR') ?? '?'}
    </span>
  );
}
