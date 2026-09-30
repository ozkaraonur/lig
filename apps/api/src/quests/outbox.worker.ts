import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { questWindow } from '@lig/shared';
import { sql } from 'drizzle-orm';
import { CLOCK_MS, type MsClock } from '../common/clock';
import { ENV, type Env } from '../config/env';
import { DB, type Database } from '../db/db.module';
import { awardBadges } from '../gamification/badge-store';
import { evaluatePlayerQuests } from './quest-evaluator';

export const OUTBOX_BATCH_SIZE = 100;
const MAX_BACKOFF_MS = 5 * 60 * 1000;
const PROCESSED_RETENTION_DAYS = 7;

type ClaimedEvent = {
  id: string;
  tenant_id: string;
  player_id: string;
  created_at: Date | string;
  attempts: number;
};

/**
 * Outbox'taki olayları işler (K-013). Olayların kendisi yalnızca "bu oyuncunun görevlerine tekrar bak"
 * sinyalidir; aynı oyuncunun birden fazla olayı tek değerlendirmede birleştirilir.
 *
 * Satırlar `FOR UPDATE SKIP LOCKED` ile alınır: birden çok süreç çalışsa bile aynı olayı ikisi işlemez.
 * Bir oyuncunun değerlendirmesi hata verirse yalnızca onun olayları geri bekletilir, diğerleri işlenir.
 */
@Injectable()
export class OutboxWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxWorker.name);
  private timer: NodeJS.Timeout | undefined;
  private stopped = true;
  private rounds = 0;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    @Inject(CLOCK_MS) private readonly clock: MsClock,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.env.WORKERS_ENABLED) return;
    this.stopped = false;
    this.schedule(0);
    this.logger.log(`Outbox worker started, every ${this.env.OUTBOX_POLL_INTERVAL_MS} ms`);
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  /** Bir tur: bir parti olayı işler. İşlenen olay sayısını döner. */
  async runOnce(): Promise<number> {
    const now = new Date(this.clock());
    const processed = await this.db.transaction(async (tx) => {
      const claimed = await tx.execute<ClaimedEvent>(sql`
        select id, tenant_id, player_id, created_at, attempts from outbox_events
        where processed_at is null and available_at <= ${now.toISOString()}::timestamptz
        order by available_at, created_at
        limit ${OUTBOX_BATCH_SIZE}
        for update skip locked
      `);
      if (claimed.rows.length === 0) return 0;

      const byPlayer = new Map<string, ClaimedEvent[]>();
      for (const e of claimed.rows) {
        const key = `${e.tenant_id}:${e.player_id}`;
        byPlayer.set(key, [...(byPlayer.get(key) ?? []), e]);
      }

      for (const events of byPlayer.values()) {
        const first = events[0]!;
        try {
          // Savepoint: bu oyuncunun hatası partinin geri kalanını geri almaz.
          await tx.transaction(async (sp) => {
            for (const at of evaluationTimes(events)) {
              await evaluatePlayerQuests(sp, first.tenant_id, first.player_id, at);
            }
            // Rozetler görevlerden sonra: "Görev Avcısı" az önce yazılan görev ilerlemesine bakar (K-030).
            await awardBadges(sp, first.tenant_id, first.player_id, now);
          });
          await tx.execute(sql`
            update outbox_events set processed_at = ${now.toISOString()}::timestamptz
            where id in (${sql.join(
              events.map((e) => sql`${e.id}::uuid`),
              sql`, `,
            )})
          `);
        } catch (err) {
          const attempts = Math.max(...events.map((e) => e.attempts)) + 1;
          const backoffMs = Math.min(2 ** attempts * 1000, MAX_BACKOFF_MS);
          const message = err instanceof Error ? err.message.slice(0, 500) : 'unknown';
          this.logger.warn(`Quest and badge evaluation failed for player ${first.player_id}: ${message}`);
          await tx.execute(sql`
            update outbox_events
            set attempts = ${attempts}, last_error = ${message},
                available_at = ${new Date(now.getTime() + backoffMs).toISOString()}::timestamptz
            where id in (${sql.join(
              events.map((e) => sql`${e.id}::uuid`),
              sql`, `,
            )})
          `);
        }
      }
      return claimed.rows.length;
    });

    if (++this.rounds % 600 === 0) await this.purgeProcessed(now);
    return processed;
  }

  private async purgeProcessed(now: Date): Promise<void> {
    const cutoff = new Date(now.getTime() - PROCESSED_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    await this.db.execute(sql`
      delete from outbox_events where id in (
        select id from outbox_events where processed_at < ${cutoff.toISOString()}::timestamptz limit 5000
      )
    `);
  }

  private schedule(delayMs: number): void {
    this.timer = setTimeout(() => {
      void this.runOnce()
        .catch((err: unknown) =>
          this.logger.error(`Outbox round failed: ${err instanceof Error ? err.message : 'unknown'}`),
        )
        .then((count) => {
          // Parti doluysa beklemeden devam et; birikmiş olaylar hızla erir.
          if (!this.stopped)
            this.schedule(count === OUTBOX_BATCH_SIZE ? 0 : this.env.OUTBOX_POLL_INTERVAL_MS);
        });
    }, delayMs);
  }
}

/**
 * Olayların oluştuğu haftalar ayrı ayrı değerlendirilir. Pazar 23:59'da verilen emir, pazartesi işlense de
 * geçen haftanın görevine sayılır.
 */
export function evaluationTimes(events: Array<{ created_at: Date | string }>): Date[] {
  const latestByWeek = new Map<string, Date>();
  for (const e of events) {
    const at = new Date(e.created_at);
    const key = questWindow('weekly', at).key;
    const current = latestByWeek.get(key);
    if (!current || at > current) latestByWeek.set(key, at);
  }
  return [...latestByWeek.values()].sort((a, b) => a.getTime() - b.getTime());
}
