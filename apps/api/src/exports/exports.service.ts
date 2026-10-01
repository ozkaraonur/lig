import { Inject, Injectable } from '@nestjs/common';
import {
  CSV_METRICS_HEADER,
  CSV_RANKING_HEADER,
  type CsvCell,
  type MetricRangeDays,
  toCsv,
} from '@lig/shared';
import { and, eq, isNotNull, notInArray, sql } from 'drizzle-orm';
import { adminActor } from '../admin-auth/admin-auth.service';
import { type AdminAccount } from '../admin-auth/ports';
import { AUDIT_LOG, type AuditLog, recordAudit } from '../audit/audit-log';
import { AppError } from '../common/app-error';
import { CLOCK_MS, type MsClock } from '../common/clock';
import { DB, type Database } from '../db/db.module';
import { leagues, memberships, players } from '../db/schema';
import { MetricsService } from '../metrics/metrics.service';

/** Tek dışa aktarımdaki en fazla satır. Testte küçültülebilsin diye enjekte edilir. */
export const EXPORT_MAX_ROWS = Symbol('EXPORT_MAX_ROWS');

export interface CsvFile {
  filename: string;
  content: string;
}

/**
 * CSV dışa aktarım (FR-25, K-035). Dosya panelin dışına çıktığı için her çalıştırma denetim kaydına yazılır;
 * kayıt yazılamazsa dosya verilmez. Oyuncular yalnızca takma kimlikle yer alır (NFR-04). Her sorgu
 * oturumdaki platforma bağlıdır; başka platformun ligi "yok" gibi 404 döner (NFR-03).
 */
@Injectable()
export class ExportsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(CLOCK_MS) private readonly clock: MsClock,
    private readonly metrics: MetricsService,
    @Inject(EXPORT_MAX_ROWS) private readonly maxRows: number,
  ) {}

  /** Kapanmış ligin nihai sıralaması. Arkadaş ve kademe ligleri üyelerine özeldir, dışa aktarılmaz. */
  async leagueRanking(admin: AdminAccount, leagueId: string, ip: string): Promise<CsvFile> {
    const now = new Date(this.clock());
    return this.db.transaction(async (tx) => {
      const [league] = await tx
        .select({
          id: leagues.id,
          name: leagues.name,
          status: leagues.status,
          startingCash: leagues.startingCash,
        })
        .from(leagues)
        .where(
          and(
            eq(leagues.tenantId, admin.tenantId),
            eq(leagues.id, leagueId),
            notInArray(leagues.type, ['friends', 'tier']),
          ),
        )
        .limit(1);
      if (!league) throw new AppError('NOT_FOUND', 404, 'Lig bulunamadı.');
      if (league.status !== 'finished') {
        throw new AppError('CONFLICT', 409, 'Sıralama dışa aktarımı için lig kapanmış olmalı.');
      }

      const rows = await tx
        .select({
          rank: memberships.finalRank,
          externalId: players.externalId,
          value: memberships.finalValue,
          returnPct: sql<string>`round((${memberships.finalValue} / ${league.startingCash}::numeric - 1) * 100, 2)`,
          xp: sql<number>`coalesce((
            select sum(x.amount) from xp_ledger x
            where x.player_id = ${players.id}
              and x.source_id = ${memberships.leagueId}::text
              and x.reason in ('league_rank', 'league_participation')
          ), 0)::int`,
        })
        .from(memberships)
        .innerJoin(players, eq(players.id, memberships.playerId))
        .where(and(eq(memberships.leagueId, league.id), isNotNull(memberships.finalRank)))
        .orderBy(memberships.finalRank, players.externalId)
        .limit(this.maxRows + 1);
      if (rows.length > this.maxRows) {
        throw new AppError(
          'CONFLICT',
          409,
          `Bu lig ${this.maxRows.toLocaleString('tr-TR')} satırdan büyük, dışa aktarılamaz.`,
        );
      }

      const content = toCsv(
        CSV_RANKING_HEADER,
        rows.map((r): CsvCell[] => [r.rank, r.externalId, Number(r.value), Number(r.returnPct), r.xp]),
      );
      await recordAudit(tx, {
        tenantId: admin.tenantId,
        action: 'export.created',
        actor: adminActor(admin),
        target: { type: 'league', id: league.id, label: league.name },
        ip,
        metadata: { kind: 'league-ranking', rows: rows.length },
        occurredAt: now,
      });
      return { filename: `lig-siralama-${league.id}.csv`, content };
    });
  }

  /** Metrik panelinin sayıları: toplu veri, oyuncu satırı yok. */
  async metricsSummary(admin: AdminAccount, days: MetricRangeDays, ip: string): Promise<CsvFile> {
    const report = await this.metrics.report(admin, days);
    const rows: CsvCell[][] = [
      ...Object.entries(report.totals).map(([name, value]): CsvCell[] => ['toplam', name, value]),
      ...Object.entries(report.realTradeBreakdown).map(([name, value]): CsvCell[] => [
        'gercek_islem',
        name,
        value,
      ]),
      ...report.leagues.flatMap((l): CsvCell[][] => [
        ['lig_uye', l.name, l.members],
        ['lig_emir', l.name, l.orders],
        ['lig_gercek_hesap_dokunusu', l.name, l.realTradeClicks],
      ]),
    ];
    await this.audit.append({
      tenantId: admin.tenantId,
      action: 'export.created',
      actor: adminActor(admin),
      target: { type: 'metrics', id: String(days), label: `son ${days} gün` },
      ip,
      metadata: { kind: 'metrics', days, rows: rows.length },
      occurredAt: new Date(report.generatedAt),
    });
    return { filename: `lig-metrikler-${days}-gun.csv`, content: toCsv(CSV_METRICS_HEADER, rows) };
  }
}
