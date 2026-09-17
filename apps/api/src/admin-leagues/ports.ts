import { type AdminAssetView, type AdminLeagueType, type LeagueStatus, type LeagueType } from '@lig/shared';
import { type AuditEntry } from '../audit/audit-log';

export interface AdminLeagueRecord {
  id: string;
  tenantId: string;
  name: string;
  type: LeagueType;
  status: LeagueStatus;
  startsAt: Date;
  endsAt: Date;
  startingCash: string;
  assetIds: string[];
  maxMembers: number | null;
  lateJoinAllowed: boolean;
  memberCount: number;
}

export interface NewLeague {
  tenantId: string;
  name: string;
  type: AdminLeagueType;
  status: 'draft' | 'active';
  startsAt: Date;
  endsAt: Date;
  startingCash: string;
  assetIds: string[];
  maxMembers: number | null;
  lateJoinAllowed: boolean;
}

export type LeaguePatch = Partial<Omit<NewLeague, 'tenantId'>>;

/**
 * Değişikliği hesaplayan fonksiyon. Kilitli, güncel lig kaydıyla çağrılır; kural ihlalinde AppError fırlatır
 * (transaction geri alınır). Değişiklik yoksa boş nesne döner.
 */
export type PatchPlanner = (current: AdminLeagueRecord) => { patch: LeaguePatch; audit: AuditEntry | null };

export interface AdminLeagueRepository {
  list(tenantId: string): Promise<AdminLeagueRecord[]>;
  find(tenantId: string, leagueId: string): Promise<AdminLeagueRecord | null>;
  listAssets(tenantId: string): Promise<AdminAssetView[]>;
  create(league: NewLeague, audit: (created: AdminLeagueRecord) => AuditEntry): Promise<AdminLeagueRecord>;
  /**
   * Ligi `FOR UPDATE` ile kilitler: süren emirler (FOR SHARE) ve lig kapanışı (FOR UPDATE) bitene kadar bekler,
   * değişiklik yazılırken yeni emir ve kapanış bekler. Lig bu tenant'ın değilse null.
   */
  update(tenantId: string, leagueId: string, plan: PatchPlanner): Promise<AdminLeagueRecord | null>;
  /** `check` kilitli kayıtla çağrılır ve silmeye izin yoksa fırlatır. */
  delete(
    tenantId: string,
    leagueId: string,
    check: (current: AdminLeagueRecord) => AuditEntry,
  ): Promise<boolean>;
}

export interface ComplianceSettings {
  realTradeButton: boolean;
  realTradeQuest: boolean;
}

export interface ComplianceRepository {
  get(tenantId: string): Promise<ComplianceSettings | null>;
  update(
    tenantId: string,
    changes: Partial<ComplianceSettings>,
    audit: (before: ComplianceSettings, after: ComplianceSettings) => AuditEntry | null,
  ): Promise<ComplianceSettings | null>;
}

export const ADMIN_LEAGUE_REPOSITORY = Symbol('ADMIN_LEAGUE_REPOSITORY');
export const COMPLIANCE_REPOSITORY = Symbol('COMPLIANCE_REPOSITORY');
