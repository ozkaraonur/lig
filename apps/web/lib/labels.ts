import {
  type AdminRole,
  type AuditAction,
  formatCashTr,
  formatDecimalTr,
  type LeaguePhase,
  type LeagueStatus,
  type LeagueType,
} from '@lig/shared';

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  'admin.login.succeeded': 'Giriş yaptı',
  'admin.login.failed': 'Hatalı parola',
  'admin.mfa.failed': 'Hatalı doğrulama kodu',
  'admin.mfa.enrolled': 'MFA kurdu',
  'admin.logout': 'Çıkış yaptı',
  'admin.created': 'Yönetici açıldı',
  'admin.invited': 'Davet gönderdi',
  'admin.invite.revoked': 'Daveti iptal etti',
  'admin.invite.accepted': 'Daveti kabul etti',
  'admin.role.changed': 'Rol değiştirdi',
  'admin.mfa.reset': 'MFA sıfırladı',
  'admin.removed': 'Yöneticiyi kaldırdı',
  'admin.password.changed': 'Parola değiştirdi',
  'admin.sessions.revoked': 'Diğer oturumları kapattı',
  'secrets.rotated': 'Anahtar değişimi',
  'league.created': 'Lig oluşturdu',
  'league.updated': 'Ligi düzenledi',
  'league.deleted': 'Ligi sildi',
  'compliance.changed': 'Uyum ayarını değiştirdi',
  'quest.created': 'Görev ekledi',
  'quest.updated': 'Görevi düzenledi',
  'quest.deleted': 'Görevi sildi',
  'branding.changed': 'Marka ayarını değiştirdi',
  'export.created': 'CSV dışa aktardı',
};

export const LEAGUE_STATUS_LABELS: Record<LeagueStatus, string> = {
  draft: 'Taslak',
  active: 'Yayında',
  finished: 'Kapandı',
};

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' });
}

export const ADMIN_ROLE_LABELS: Record<AdminRole, string> = {
  owner: 'Sahip',
  editor: 'Düzenleyici',
  viewer: 'İzleyici',
};

export const LEAGUE_TYPE_LABELS: Record<LeagueType, string> = {
  weekly: 'Haftalık',
  season: 'Sezon',
  friends: 'Arkadaş',
  tier: 'Kademe',
};

export const LEAGUE_PHASE_LABELS: Record<LeaguePhase, string> = {
  running: 'Devam ediyor',
  upcoming: 'Yakında',
  ended: 'Bitti',
};

const dateFormat = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short' });

export function formatDateRange(startsAt: string, endsAt: string): string {
  return `${dateFormat.format(new Date(startsAt))} – ${dateFormat.format(new Date(endsAt))}`;
}

/** "2.5000000000" → "2,5"; ekranda anlamsız sıfırlar gösterilmez. */
export function formatQuantity(value: string): string {
  const trimmed = value.includes('.') ? value.replace(/\.?0+$/, '') : value;
  return formatDecimalTr(trimmed);
}

/** "10.00" → "+10,00%", "-0.25" → "−0,25%" */
export function formatPercent(value: string): string {
  const negative = value.startsWith('-');
  const abs = negative ? value.slice(1) : value;
  const sign = negative ? '−' : /^0(\.0+)?$/.test(abs) ? '' : '+';
  return `${sign}${formatDecimalTr(abs)}%`;
}

export function formatSignedCash(value: string): string {
  const negative = value.startsWith('-');
  const abs = negative ? value.slice(1) : value;
  const sign = negative ? '−' : /^0(\.0+)?$/.test(abs) ? '' : '+';
  return `${sign}${formatCashTr(abs)}`;
}

export const trendClass = (value: string) =>
  value.startsWith('-') ? 'down' : /^0(\.0+)?$/.test(value) ? '' : 'up';

/** Ortalama maliyet gibi 10 ondalıklı fiyatlar için okunur gösterim: 1'in üstünde 2, altında 6 ondalık. */
export function formatPriceShort(value: string): string {
  const [intPart = '0', fraction = ''] = value.split('.');
  const digits = /^0*$/.test(intPart) ? 6 : 2;
  const cut = fraction.slice(0, digits).replace(/0+$/, '');
  return formatDecimalTr(cut ? `${intPart}.${cut.padEnd(Math.min(2, digits), '0')}` : intPart);
}
