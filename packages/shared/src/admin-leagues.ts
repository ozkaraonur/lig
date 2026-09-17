import { z } from 'zod';
import { type AssetClass, type LeagueStatus, type LeagueType } from './domain';
import { type LeaguePhase, leaguePhase } from './leagues';

/** Panelden kurulabilen lig tipleri. Arkadaş ligi oyuncular tarafından kurulur (FR-09, Faz 3). */
export const ADMIN_LEAGUE_TYPES = ['weekly', 'season'] as const;
export type AdminLeagueType = (typeof ADMIN_LEAGUE_TYPES)[number];

export const LEAGUE_LIMITS = {
  nameMin: 3,
  nameMax: 80,
  minDurationMs: 60 * 60 * 1000,
  maxDurationMs: 400 * 24 * 60 * 60 * 1000,
  /** Süren ligin bitişi en az bu kadar sonrası olmalı; bitişi geçmişe çekip ligi anında kapatmak engellenir. */
  minRemainingMs: 5 * 60 * 1000,
  /** Yeni lig ya da taşınan başlangıç bu kadar geçmişe tarihlenebilir (saat farkı toleransı). */
  backdateToleranceMs: 5 * 60 * 1000,
  startingCashMin: 100,
  startingCashMax: 1_000_000_000,
  assetsMax: 50,
  maxMembersMax: 1_000_000,
};

export const leagueName = z
  .string()
  .trim()
  .min(LEAGUE_LIMITS.nameMin, `Ad en az ${LEAGUE_LIMITS.nameMin} karakter olmalı`)
  .max(LEAGUE_LIMITS.nameMax, `Ad en fazla ${LEAGUE_LIMITS.nameMax} karakter olabilir`)
  .regex(/^[^\p{Cc}<>]+$/u, 'Ad geçersiz karakter içeriyor');

const isoDate = z.iso.datetime({ offset: true }).transform((v) => new Date(v));

const startingCash = z
  .string()
  .regex(/^\d{1,10}(\.\d{1,2})?$/, 'Bakiye en fazla 2 ondalık basamaklı sayı olmalı')
  .refine(
    (v) => Number(v) >= LEAGUE_LIMITS.startingCashMin && Number(v) <= LEAGUE_LIMITS.startingCashMax,
    `Bakiye ${LEAGUE_LIMITS.startingCashMin} ile ${LEAGUE_LIMITS.startingCashMax} arasında olmalı`,
  );

const assetIds = z
  .array(z.uuid())
  .min(1, 'En az bir varlık seçilmeli')
  .max(LEAGUE_LIMITS.assetsMax)
  .refine((ids) => new Set(ids).size === ids.length, 'Aynı varlık iki kez seçilemez');

const maxMembers = z.number().int().min(2).max(LEAGUE_LIMITS.maxMembersMax).nullable();

/**
 * POST /admin/leagues (FR-20). Ödül alanı yok: lig sonu ödülleri yalnızca XP ve sistemde sabit (K-011, FR-24).
 * Fazladan alan (ör. `cashReward`) 400 ile reddedilir.
 */
export const createLeagueRequest = z.strictObject({
  name: leagueName,
  type: z.enum(ADMIN_LEAGUE_TYPES),
  startsAt: isoDate,
  endsAt: isoDate,
  startingCash,
  assetIds,
  maxMembers: maxMembers.default(null),
  lateJoinAllowed: z.boolean().default(true),
  /** true: hemen yayına alınır; false: taslak. */
  publish: z.boolean().default(false),
});
export type CreateLeagueRequest = z.infer<typeof createLeagueRequest>;
/** İstemcinin gönderdiği biçim (tarihler ISO metin). */
export type CreateLeagueBody = z.input<typeof createLeagueRequest>;

/** PATCH /admin/leagues/:id. Yalnızca gönderilen alanlar değişir; hangisinin değişebileceği lig evresine bağlı. */
export const updateLeagueRequest = z
  .strictObject({
    name: leagueName,
    type: z.enum(ADMIN_LEAGUE_TYPES),
    startsAt: isoDate,
    endsAt: isoDate,
    startingCash,
    assetIds,
    maxMembers,
    lateJoinAllowed: z.boolean(),
    status: z.enum(['draft', 'active']),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'En az bir alan değişmeli');
export type UpdateLeagueRequest = z.infer<typeof updateLeagueRequest>;
export type UpdateLeagueBody = z.input<typeof updateLeagueRequest>;

export interface LeagueEditability {
  name: boolean;
  type: boolean;
  startsAt: boolean;
  endsAt: boolean;
  startingCash: boolean;
  addAssets: boolean;
  removeAssets: boolean;
  maxMembers: boolean;
  lateJoinAllowed: boolean;
  /** Taslağa geri alma ya da yayına alma. */
  status: boolean;
  delete: boolean;
}

/**
 * Lig evresine göre neyin değişebileceği (FR-20). API kararı buna göre verir, panel alanları buna göre kapatır.
 * - Taslak: her şey.
 * - Başlamamış: her şey; başlangıç bakiyesi, taslağa alma ve silme yalnızca henüz kimse katılmadıysa.
 * - Süren: ad, bitiş, varlık ekleme, kontenjan, geç katılım. Başlangıç, bakiye, tip ve varlık çıkarma kilitli.
 * - Biten: hiçbir şey.
 */
export function leagueEditability(
  league: { status: LeagueStatus; startsAt: Date; endsAt: Date },
  memberCount: number,
  now: Date,
): LeagueEditability {
  const none: LeagueEditability = {
    name: false,
    type: false,
    startsAt: false,
    endsAt: false,
    startingCash: false,
    addAssets: false,
    removeAssets: false,
    maxMembers: false,
    lateJoinAllowed: false,
    status: false,
    delete: false,
  };
  if (league.status === 'draft') {
    return Object.fromEntries(Object.keys(none).map((k) => [k, true])) as unknown as LeagueEditability;
  }
  const phase = leaguePhase(league, now);
  if (league.status === 'finished' || phase === 'ended') return none;
  const empty = memberCount === 0;
  if (phase === 'upcoming') {
    return {
      name: true,
      type: true,
      startsAt: true,
      endsAt: true,
      startingCash: empty,
      addAssets: true,
      removeAssets: true,
      maxMembers: true,
      lateJoinAllowed: true,
      status: empty,
      delete: empty,
    };
  }
  return { ...none, name: true, endsAt: true, addAssets: true, maxMembers: true, lateJoinAllowed: true };
}

export interface AdminLeagueView {
  id: string;
  name: string;
  type: LeagueType;
  status: LeagueStatus;
  phase: LeaguePhase;
  startsAt: string;
  endsAt: string;
  startingCash: string;
  assetIds: string[];
  maxMembers: number | null;
  lateJoinAllowed: boolean;
  memberCount: number;
  closed: boolean;
  editable: LeagueEditability;
}

export interface AdminAssetView {
  id: string;
  symbol: string;
  name: string;
  assetClass: AssetClass;
}

/** Uyum ayarları (FR-24, NFR-06). Kilitli olanlar kodda sabit; ne panel ne API değiştirebilir. */
export const LOCKED_COMPLIANCE_SETTINGS = [
  {
    key: 'personalized_trade_advice',
    label: 'Kişiye özel al/sat önerisi',
    enabled: false,
    reason: 'Yatırım danışmanlığı sayılır (NFR-06). AI koç da bu kurala tabi olacak.',
  },
  {
    key: 'cash_rewards',
    label: 'Nakit ya da nakde çevrilebilir ödül',
    enabled: false,
    reason: 'Ödüller yalnızca XP ve görünüm (NFR-06, K-011). Lig ve görev formlarında ödül para birimi yok.',
  },
  {
    key: 'wagering_mechanics',
    label: 'Portföyü etkileyen joker, XP ile tahmin ya da bahis',
    enabled: false,
    reason: 'Sıralamayı şansa çevirir, şans oyunu görüntüsü verir (K-017).',
  },
  {
    key: 'virtual_money_disclaimer',
    label: '"Sanal para, yatırım tavsiyesi değildir" uyarısı',
    enabled: true,
    reason: 'Oyuncu ekranında her zaman gösterilir.',
  },
] as const;

export interface ComplianceView {
  locked: ReadonlyArray<{ key: string; label: string; enabled: boolean; reason: string }>;
  /** Platform sahibinin açıp kapatabildiği ayarlar. Değişiklikler denetim kaydına girer. */
  adjustable: {
    realTradeButton: boolean;
    realTradeQuest: boolean;
  };
}

export const complianceUpdateRequest = z
  .strictObject({ realTradeButton: z.boolean(), realTradeQuest: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'En az bir ayar değişmeli');
export type ComplianceUpdateRequest = z.infer<typeof complianceUpdateRequest>;

/** Oyuncu ekranındaki kilitli uyarı metni. */
export const VIRTUAL_MONEY_DISCLAIMER =
  'Sanal parayla oynanır. Gösterilen hiçbir bilgi yatırım tavsiyesi değildir.';
