import { Inject, Injectable } from '@nestjs/common';
import {
  type AdminAssetView,
  type AdminLeagueView,
  type ComplianceUpdateRequest,
  type ComplianceView,
  type CreateLeagueRequest,
  LEAGUE_LIMITS,
  type LeagueEditability,
  leagueEditability,
  leaguePhase,
  LOCKED_COMPLIANCE_SETTINGS,
  type UpdateLeagueRequest,
} from '@lig/shared';
import { adminActor } from '../admin-auth/admin-auth.service';
import { type AdminAccount } from '../admin-auth/ports';
import { type AuditMetadata } from '../audit/audit-log';
import { AppError } from '../common/app-error';
import { CLOCK_MS, type MsClock } from '../common/clock';
import {
  ADMIN_LEAGUE_REPOSITORY,
  type AdminLeagueRecord,
  type AdminLeagueRepository,
  COMPLIANCE_REPOSITORY,
  type ComplianceRepository,
  type LeaguePatch,
} from './ports';

const FIELD_LABELS: Record<keyof LeagueEditability, string> = {
  name: 'ad',
  type: 'tip',
  startsAt: 'başlangıç',
  endsAt: 'bitiş',
  startingCash: 'başlangıç bakiyesi',
  addAssets: 'varlık ekleme',
  removeAssets: 'varlık çıkarma',
  maxMembers: 'kontenjan',
  lateJoinAllowed: 'geç katılım',
  status: 'yayın durumu',
  delete: 'silme',
};

const notFound = () => new AppError('NOT_FOUND', 404, 'Lig bulunamadı.');
const invalid = (message: string) => new AppError('VALIDATION_FAILED', 400, message);
const locked = (field: keyof LeagueEditability, current: AdminLeagueRecord, now: Date) => {
  const phase =
    current.status === 'draft'
      ? 'taslak'
      : { upcoming: 'başlamamış', running: 'süren', ended: 'biten' }[leaguePhase(current, now)];
  const reason = phase === 'başlamamış' ? 'ligde katılımcı var' : `${phase} ligde değiştirilemez`;
  return new AppError('LEAGUE_LOCKED', 409, `Bu işlem yapılamaz (${FIELD_LABELS[field]}): ${reason}.`);
};

export function toAdminLeagueView(league: AdminLeagueRecord, now: Date): AdminLeagueView {
  return {
    id: league.id,
    name: league.name,
    type: league.type,
    status: league.status,
    phase: leaguePhase(league, now),
    startsAt: league.startsAt.toISOString(),
    endsAt: league.endsAt.toISOString(),
    startingCash: league.startingCash,
    assetIds: league.assetIds,
    maxMembers: league.maxMembers,
    lateJoinAllowed: league.lateJoinAllowed,
    memberCount: league.memberCount,
    closed: league.status === 'finished',
    editable: editabilityOf(league, now),
  };
}

/** Arkadaş ligleri (FR-09) ve kademe grupları (K-034) sistemin; panelden değiştirilmez. */
function editabilityOf(league: AdminLeagueRecord, now: Date): LeagueEditability {
  const rules = leagueEditability(league, league.memberCount, now);
  if (league.type !== 'friends' && league.type !== 'tier') return rules;
  return Object.fromEntries(Object.keys(rules).map((k) => [k, false])) as unknown as LeagueEditability;
}

function sameAmount(a: string, b: string): boolean {
  return Number(a) === Number(b);
}

@Injectable()
export class AdminLeaguesService {
  constructor(
    @Inject(ADMIN_LEAGUE_REPOSITORY) private readonly leagues: AdminLeagueRepository,
    @Inject(COMPLIANCE_REPOSITORY) private readonly compliance: ComplianceRepository,
    @Inject(CLOCK_MS) private readonly clock: MsClock,
  ) {}

  async list(admin: AdminAccount): Promise<AdminLeagueView[]> {
    const now = new Date(this.clock());
    return (await this.leagues.list(admin.tenantId)).map((l) => toAdminLeagueView(l, now));
  }

  async get(admin: AdminAccount, leagueId: string): Promise<AdminLeagueView> {
    const league = await this.leagues.find(admin.tenantId, leagueId);
    if (!league) throw notFound();
    return toAdminLeagueView(league, new Date(this.clock()));
  }

  assets(admin: AdminAccount): Promise<AdminAssetView[]> {
    return this.leagues.listAssets(admin.tenantId);
  }

  async create(admin: AdminAccount, input: CreateLeagueRequest, ip: string): Promise<AdminLeagueView> {
    const now = new Date(this.clock());
    const symbols = await this.assetSymbols(admin.tenantId, input.assetIds);
    this.checkDates(input.startsAt, input.endsAt, now, { startChanged: true, endChanged: true });
    const created = await this.leagues.create(
      {
        tenantId: admin.tenantId,
        name: input.name,
        type: input.type,
        status: input.publish ? 'active' : 'draft',
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        startingCash: input.startingCash,
        assetIds: input.assetIds,
        maxMembers: input.maxMembers,
        lateJoinAllowed: input.lateJoinAllowed,
      },
      (league) => ({
        tenantId: admin.tenantId,
        action: 'league.created',
        actor: adminActor(admin),
        target: { type: 'league', id: league.id, label: league.name },
        ip,
        metadata: {
          type: league.type,
          status: league.status,
          startsAt: league.startsAt.toISOString(),
          endsAt: league.endsAt.toISOString(),
          startingCash: league.startingCash,
          assets: input.assetIds.map((id) => symbols.get(id)).join(','),
          maxMembers: league.maxMembers,
          lateJoinAllowed: league.lateJoinAllowed,
        },
        occurredAt: now,
      }),
    );
    return toAdminLeagueView(created, now);
  }

  async update(
    admin: AdminAccount,
    leagueId: string,
    input: UpdateLeagueRequest,
    ip: string,
  ): Promise<AdminLeagueView> {
    const now = new Date(this.clock());
    const tenantAssets = new Map(
      (await this.leagues.listAssets(admin.tenantId)).map((a) => [a.id, a.symbol]),
    );
    if (input.assetIds?.some((id) => !tenantAssets.has(id))) {
      throw invalid('Seçilen varlıklardan biri bu platforma ait değil.');
    }

    const updated = await this.leagues.update(admin.tenantId, leagueId, (current) => {
      const editable = editabilityOf(current, now);
      const patch: LeaguePatch = {};
      const meta: AuditMetadata = {};
      const change = <K extends keyof LeaguePatch>(
        field: K,
        rule: keyof LeagueEditability,
        next: LeaguePatch[K] | undefined,
        same: boolean,
        show: (v: NonNullable<LeaguePatch[K]> | null) => string | number | boolean | null,
      ) => {
        if (next === undefined || same) return;
        if (!editable[rule]) throw locked(rule, current, now);
        patch[field] = next;
        meta[`${field}From`] = show(
          (current as unknown as Record<string, NonNullable<LeaguePatch[K]>>)[field] ?? null,
        );
        meta[`${field}To`] = show(next ?? null);
      };

      change('name', 'name', input.name, input.name === current.name, (v) => (v as string) ?? null);
      change('type', 'type', input.type, input.type === current.type, (v) => (v as string) ?? null);
      const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : null);
      change(
        'startsAt',
        'startsAt',
        input.startsAt,
        input.startsAt?.getTime() === current.startsAt.getTime(),
        iso,
      );
      change('endsAt', 'endsAt', input.endsAt, input.endsAt?.getTime() === current.endsAt.getTime(), iso);
      change(
        'startingCash',
        'startingCash',
        input.startingCash,
        input.startingCash !== undefined && sameAmount(input.startingCash, current.startingCash),
        (v) => (v as string) ?? null,
      );
      change('maxMembers', 'maxMembers', input.maxMembers, input.maxMembers === current.maxMembers, (v) =>
        v === null ? null : (v as number),
      );
      change(
        'lateJoinAllowed',
        'lateJoinAllowed',
        input.lateJoinAllowed,
        input.lateJoinAllowed === current.lateJoinAllowed,
        (v) => v as boolean,
      );

      if (input.assetIds) {
        const added = input.assetIds.filter((id) => !current.assetIds.includes(id));
        const removed = current.assetIds.filter((id) => !input.assetIds!.includes(id));
        if (added.length > 0 && !editable.addAssets) throw locked('addAssets', current, now);
        if (removed.length > 0 && !editable.removeAssets) throw locked('removeAssets', current, now);
        const reordered =
          added.length === 0 && removed.length === 0 && input.assetIds.join() !== current.assetIds.join();
        if (added.length > 0 || removed.length > 0 || reordered) {
          patch.assetIds = input.assetIds;
          if (added.length > 0) meta.assetsAdded = added.map((id) => tenantAssets.get(id) ?? id).join(',');
          if (removed.length > 0)
            meta.assetsRemoved = removed.map((id) => tenantAssets.get(id) ?? id).join(',');
        }
      }

      if (input.status !== undefined && input.status !== current.status) {
        if (current.status === 'finished' || !editable.status) throw locked('status', current, now);
        patch.status = input.status;
        meta.statusFrom = current.status;
        meta.statusTo = input.status;
      }

      const startsAt = patch.startsAt ?? current.startsAt;
      const endsAt = patch.endsAt ?? current.endsAt;
      if (patch.startsAt || patch.endsAt || patch.status === 'active') {
        this.checkDates(startsAt, endsAt, now, {
          startChanged: patch.startsAt !== undefined,
          endChanged: patch.endsAt !== undefined || patch.status === 'active',
        });
      }
      const maxMembers = patch.maxMembers === undefined ? current.maxMembers : patch.maxMembers;
      if (patch.maxMembers !== undefined && maxMembers !== null && maxMembers < current.memberCount) {
        throw invalid(`Kontenjan mevcut katılımcı sayısından (${current.memberCount}) az olamaz.`);
      }

      if (Object.keys(patch).length === 0) return { patch, audit: null };
      return {
        patch,
        audit: {
          tenantId: admin.tenantId,
          action: 'league.updated',
          actor: adminActor(admin),
          target: { type: 'league', id: current.id, label: patch.name ?? current.name },
          ip,
          metadata: { ...meta, members: current.memberCount },
          occurredAt: now,
        },
      };
    });
    if (!updated) throw notFound();
    return toAdminLeagueView(updated, now);
  }

  async remove(admin: AdminAccount, leagueId: string, ip: string): Promise<void> {
    const now = new Date(this.clock());
    const deleted = await this.leagues.delete(admin.tenantId, leagueId, (current) => {
      if (!editabilityOf(current, now).delete) throw locked('delete', current, now);
      return {
        tenantId: admin.tenantId,
        action: 'league.deleted',
        actor: adminActor(admin),
        target: { type: 'league', id: current.id, label: current.name },
        ip,
        metadata: { status: current.status, startsAt: current.startsAt.toISOString() },
        occurredAt: now,
      };
    });
    if (!deleted) throw notFound();
  }

  async complianceView(admin: AdminAccount): Promise<ComplianceView> {
    const settings = await this.compliance.get(admin.tenantId);
    if (!settings) throw new AppError('NOT_FOUND', 404, 'Platform bulunamadı.');
    return { locked: LOCKED_COMPLIANCE_SETTINGS, adjustable: settings };
  }

  async updateCompliance(
    admin: AdminAccount,
    input: ComplianceUpdateRequest,
    ip: string,
  ): Promise<ComplianceView> {
    const now = new Date(this.clock());
    const after = await this.compliance.update(admin.tenantId, input, (before, next) => {
      const meta: AuditMetadata = {};
      for (const key of ['realTradeButton', 'realTradeQuest'] as const) {
        if (before[key] !== next[key]) {
          meta[`${key}From`] = before[key];
          meta[`${key}To`] = next[key];
        }
      }
      if (Object.keys(meta).length === 0) return null;
      return {
        tenantId: admin.tenantId,
        action: 'compliance.changed',
        actor: adminActor(admin),
        target: { type: 'tenant', id: admin.tenantId },
        ip,
        metadata: meta,
        occurredAt: now,
      };
    });
    if (!after) throw new AppError('NOT_FOUND', 404, 'Platform bulunamadı.');
    return { locked: LOCKED_COMPLIANCE_SETTINGS, adjustable: after };
  }

  private async assetSymbols(tenantId: string, assetIds: string[]): Promise<Map<string, string>> {
    const tenantAssets = new Map((await this.leagues.listAssets(tenantId)).map((a) => [a.id, a.symbol]));
    if (assetIds.some((id) => !tenantAssets.has(id))) {
      throw invalid('Seçilen varlıklardan biri bu platforma ait değil.');
    }
    return tenantAssets;
  }

  /** FR-20: başlangıç bitişten önce; süre makul; tarih geçmişe çekilemez; süren lig anında kapatılamaz. */
  private checkDates(
    startsAt: Date,
    endsAt: Date,
    now: Date,
    changed: { startChanged: boolean; endChanged: boolean },
  ): void {
    const duration = endsAt.getTime() - startsAt.getTime();
    if (duration <= 0) throw invalid('Başlangıç tarihi bitiş tarihinden önce olmalı.');
    if (duration < LEAGUE_LIMITS.minDurationMs) throw invalid('Lig en az 1 saat sürmeli.');
    if (duration > LEAGUE_LIMITS.maxDurationMs) throw invalid('Lig en fazla 400 gün sürebilir.');
    if (changed.startChanged && startsAt.getTime() < now.getTime() - LEAGUE_LIMITS.backdateToleranceMs) {
      throw invalid('Başlangıç tarihi geçmişte olamaz.');
    }
    if (changed.endChanged && endsAt.getTime() < now.getTime() + LEAGUE_LIMITS.minRemainingMs) {
      throw invalid('Bitiş tarihi en az 5 dakika sonrası olmalı.');
    }
  }
}
