import { randomUUID } from 'node:crypto';
import { ADMIN_SESSION_COOKIE_NAME, type AdminRole, CSV_BOM } from '@lig/shared';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AdminAuthService } from '../admin-auth/admin-auth.service';
import { configureApp } from '../app.setup';
import { verifyAuditChain } from '../audit/audit-log';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { ConfigModule } from '../config/config.module';
import { DB, DbModule, type Database } from '../db/db.module';
import { adminUsers, auditEvents, leagues, memberships, players, xpLedger } from '../db/schema';
import { RedisModule } from '../redis/redis.module';
import { SecretsModule } from '../secrets/secrets.module';
import { createTenant, deleteTenants } from '../test/integration.test-utils';
import { MetricsModule } from '../metrics/metrics.module';
import { ExportsModule } from './exports.module';
import { EXPORT_MAX_ROWS } from './exports.service';

/** CSV dışa aktarım (FR-25, K-035), HTTP üzerinden gerçek PostgreSQL ve Redis ile. */
let app: NestFastifyApplication;
let db: Database;
let auth: AdminAuthService;
const tenantIds: string[] = [];

const DAY = 24 * 60 * 60 * 1000;
const LINE = '\r\n';
const TEST_MAX_ROWS = 3;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule,
      DbModule,
      RedisModule,
      SecretsModule,
      AuditModule,
      AuthModule,
      AdminAuthModule,
      MetricsModule,
      ExportsModule,
    ],
  })
    .overrideProvider(EXPORT_MAX_ROWS)
    .useValue(TEST_MAX_ROWS)
    .compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await configureApp(app, { webOrigin: 'http://localhost:3000' });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  db = app.get(DB);
  auth = app.get(AdminAuthService);
});

afterAll(async () => {
  await deleteTenants(db, tenantIds);
  await app.close();
});

async function newPlatform() {
  const tenantId = await createTenant(db, 'export');
  tenantIds.push(tenantId);

  const adminCookie = async (role: AdminRole) => {
    const [admin] = await db
      .insert(adminUsers)
      .values({
        tenantId,
        email: `${role}-${randomUUID()}@platform.test`,
        role,
        passwordHash: 'x',
        mfaSecretCiphertext: 'lig1.test',
        mfaEnabledAt: new Date(),
      })
      .returning({ id: adminUsers.id });
    return {
      [ADMIN_SESSION_COOKIE_NAME]: await auth.issueSession({ id: admin!.id, tenantId, sessionVersion: 0 }),
    };
  };

  const newLeague = async (
    opts: { type?: 'weekly' | 'season' | 'friends'; status?: 'active' | 'finished' } = {},
  ) => {
    const friends = opts.type === 'friends';
    const [league] = await db
      .insert(leagues)
      .values({
        tenantId,
        name: 'Dışa Aktarım Ligi',
        assetIds: [],
        type: opts.type ?? 'weekly',
        status: opts.status ?? 'finished',
        startsAt: new Date(Date.now() - 10 * DAY),
        endsAt: new Date(Date.now() - 3 * DAY),
        startingCash: '100000.00',
        ...(friends ? { inviteCode: randomUUID().replace(/-/g, '').slice(0, 10), maxMembers: 5 } : {}),
      })
      .returning({ id: leagues.id });
    return league!.id;
  };

  /** Kapanışta dondurulmuş bir üye: sıra, toplam değer ve verilen XP ile. */
  const member = async (
    leagueId: string,
    externalId: string,
    rank: number | null,
    value: string | null,
    xp: number,
  ) => {
    const [player] = await db
      .insert(players)
      .values({ tenantId, externalId, displayName: `Gerçek Ad ${externalId}` })
      .returning({ id: players.id });
    await db.insert(memberships).values({
      leagueId,
      playerId: player!.id,
      cash: '100000.00',
      finalRank: rank,
      finalValue: value,
    });
    if (xp > 0) {
      await db
        .insert(xpLedger)
        .values({ playerId: player!.id, reason: 'league_rank', sourceId: leagueId, amount: xp });
    }
    return player!.id;
  };

  return { tenantId, adminCookie, newLeague, member };
}

const get = (url: string, cookies?: Record<string, string>) =>
  app.inject({ method: 'GET', url, ...(cookies ? { cookies } : {}) });

const exportEvents = (tenantId: string) =>
  db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.tenantId, tenantId), eq(auditEvents.action, 'export.created')))
    .orderBy(auditEvents.seq);

describe('lig sıralaması dışa aktarımı', () => {
  it('kapanmış ligin sıralamasını takma kimlikle, adsız verir', async () => {
    const p = await newPlatform();
    const owner = await p.adminCookie('owner');
    const leagueId = await p.newLeague();
    await p.member(leagueId, 'oyuncu-b', 2, '90000.00', 50);
    await p.member(leagueId, 'oyuncu-a', 1, '125500.00', 250);
    await p.member(leagueId, 'oyuncu-c', 3, '80000.00', 0);

    const res = await get(`/admin/export/leagues/${leagueId}/ranking`, owner);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toBe(`attachment; filename="lig-siralama-${leagueId}.csv"`);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toBe(
      CSV_BOM +
        [
          'sira,oyuncu_kimligi,toplam_deger,getiri_yuzde,verilen_xp',
          '1,oyuncu-a,125500,25.5,250',
          '2,oyuncu-b,90000,-10,50',
          '3,oyuncu-c,80000,-20,0',
        ].join(LINE) +
        LINE,
    );
    // NFR-04: ad dosyaya girmez.
    expect(res.body).not.toContain('Gerçek Ad');
  });

  it('formül gibi başlayan takma kimlik e-tabloda çalışmaz', async () => {
    const p = await newPlatform();
    const owner = await p.adminCookie('owner');
    const leagueId = await p.newLeague();
    await p.member(leagueId, '=HYPERLINK("http://x.test")', 1, '100000.00', 0);
    await p.member(leagueId, '@SUM(A1)', 2, '100000.00', 0);

    const body = (await get(`/admin/export/leagues/${leagueId}/ranking`, owner)).body;
    expect(body).toContain(`1,"'=HYPERLINK(""http://x.test"")",`);
    expect(body).toContain(`2,'@SUM(A1),`);
  });

  it('düzenleyici indirir, izleyici ve oturumsuz indiremez', async () => {
    const p = await newPlatform();
    const leagueId = await p.newLeague();
    await p.member(leagueId, 'oyuncu-a', 1, '100000.00', 0);
    const url = `/admin/export/leagues/${leagueId}/ranking`;

    expect((await get(url, await p.adminCookie('editor'))).statusCode).toBe(200);
    expect((await get(url, await p.adminCookie('viewer'))).statusCode).toBe(403);
    expect((await get(url)).statusCode).toBe(401);
    // Reddedilen denemeler denetim kaydına dosya çıktısı olarak girmez: yalnızca editörün indirmesi var.
    expect(await exportEvents(p.tenantId)).toHaveLength(1);
  });

  it('başka platformun ligi ile olmayan lig aynı 404', async () => {
    const mine = await newPlatform();
    const other = await newPlatform();
    const owner = await mine.adminCookie('owner');
    const foreign = await other.newLeague();
    await other.member(foreign, 'yabanci', 1, '100000.00', 0);

    const foreignRes = await get(`/admin/export/leagues/${foreign}/ranking`, owner);
    const missingRes = await get(`/admin/export/leagues/${randomUUID()}/ranking`, owner);
    expect(foreignRes.statusCode).toBe(404);
    expect(foreignRes.json()).toEqual(missingRes.json());
    expect(await exportEvents(mine.tenantId)).toHaveLength(0);
  });

  it('kapanmamış lig 409, arkadaş ligi 404', async () => {
    const p = await newPlatform();
    const owner = await p.adminCookie('owner');
    const running = await p.newLeague({ status: 'active' });
    const friends = await p.newLeague({ type: 'friends', status: 'finished' });
    await p.member(friends, 'arkadas', 1, '100000.00', 0);

    expect((await get(`/admin/export/leagues/${running}/ranking`, owner)).statusCode).toBe(409);
    expect((await get(`/admin/export/leagues/${friends}/ranking`, owner)).statusCode).toBe(404);
    expect(await exportEvents(p.tenantId)).toHaveLength(0);
  });

  it('sıra almamış üye dosyada yok, XP yalnızca o ligden gelir', async () => {
    const p = await newPlatform();
    const owner = await p.adminCookie('owner');
    const leagueId = await p.newLeague();
    const otherLeague = await p.newLeague();
    const playerId = await p.member(leagueId, 'oyuncu-a', 1, '100000.00', 100);
    await p.member(leagueId, 'sirasiz', null, null, 0);
    // Başka ligden ya da görevden gelen XP bu ligin satırına karışmaz.
    await db.insert(xpLedger).values([
      { playerId, reason: 'league_rank', sourceId: otherLeague, amount: 999 },
      { playerId, reason: 'quest', sourceId: `${leagueId}:x`, amount: 7 },
    ]);

    const body = (await get(`/admin/export/leagues/${leagueId}/ranking`, owner)).body;
    expect(body).toBe(
      `${CSV_BOM}sira,oyuncu_kimligi,toplam_deger,getiri_yuzde,verilen_xp${LINE}1,oyuncu-a,100000,0,100${LINE}`,
    );
  });

  it('her dışa aktarım, dosyayla birlikte denetim kaydına yazılır ve zincir sağlam kalır', async () => {
    const p = await newPlatform();
    const owner = await p.adminCookie('owner');
    const leagueId = await p.newLeague();
    await p.member(leagueId, 'oyuncu-a', 1, '100000.00', 0);

    await get(`/admin/export/leagues/${leagueId}/ranking`, owner);
    await get(`/admin/export/leagues/${leagueId}/ranking`, owner);

    const events = await exportEvents(p.tenantId);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      action: 'export.created',
      actorType: 'admin',
      targetType: 'league',
      targetId: leagueId,
      metadata: { kind: 'league-ranking', rows: 1 },
    });
    expect(await verifyAuditChain(db, p.tenantId)).toMatchObject({ ok: true });
  });

  it('sınırı aşan lig kırpılmaz, reddedilir ve kayıt yazılmaz; sınırdaki lig verilir', async () => {
    const p = await newPlatform();
    const owner = await p.adminCookie('owner');
    const exact = await p.newLeague();
    const over = await p.newLeague();
    for (let i = 1; i <= TEST_MAX_ROWS; i++) await p.member(exact, `sinir-${i}`, i, '100000.00', 0);
    for (let i = 1; i <= TEST_MAX_ROWS + 1; i++) await p.member(over, `asan-${i}`, i, '100000.00', 0);

    const ok = await get(`/admin/export/leagues/${exact}/ranking`, owner);
    expect(ok.statusCode).toBe(200);
    expect(ok.body.split(LINE)).toHaveLength(TEST_MAX_ROWS + 2);

    const refused = await get(`/admin/export/leagues/${over}/ranking`, owner);
    expect(refused.statusCode).toBe(409);
    expect(refused.body).not.toContain('asan-');
    expect(await exportEvents(p.tenantId)).toHaveLength(1);
  });
});

describe('metrik dışa aktarımı', () => {
  it('toplamları ve lig satırlarını verir, oyuncu kimliği içermez', async () => {
    const p = await newPlatform();
    const owner = await p.adminCookie('owner');
    const leagueId = await p.newLeague();
    await p.member(leagueId, 'gizli-oyuncu', 1, '100000.00', 0);

    const res = await get('/admin/export/metrics?days=30', owner);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toBe('attachment; filename="lig-metrikler-30-gun.csv"');
    expect(res.body.startsWith(`${CSV_BOM}bolum,ad,deger${LINE}`)).toBe(true);
    expect(res.body).toContain(`toplam,players,1${LINE}`);
    expect(res.body).toContain(`toplam,orders,0${LINE}`);
    expect(res.body).toContain(`gercek_islem,leaguePlayers,0${LINE}`);
    expect(res.body).toContain(`lig_uye,Dışa Aktarım Ligi,1${LINE}`);
    expect(res.body).not.toContain('gizli-oyuncu');

    const [event] = await exportEvents(p.tenantId);
    expect(event).toMatchObject({ targetType: 'metrics', metadata: { kind: 'metrics', days: 30 } });
  });

  it('izleyici indiremez, geçersiz dönem 400', async () => {
    const p = await newPlatform();
    expect((await get('/admin/export/metrics', await p.adminCookie('viewer'))).statusCode).toBe(403);
    expect((await get('/admin/export/metrics?days=5', await p.adminCookie('owner'))).statusCode).toBe(400);
    expect(await exportEvents(p.tenantId)).toHaveLength(0);
  });

  it('formül gibi başlayan lig adı korunur', async () => {
    const p = await newPlatform();
    const owner = await p.adminCookie('owner');
    const leagueId = await p.newLeague();
    await db.update(leagues).set({ name: '=1+1' }).where(eq(leagues.id, leagueId));

    const res = await get('/admin/export/metrics?days=30', owner);
    expect(res.body).toContain(`lig_uye,'=1+1,0${LINE}`);
  });
});
