/**
 * Veritabanı şeması. Tasarım dosyasındaki ER diyagramının koddaki karşılığı.
 * Kolon adları otomatik olarak snake_case'e çevrilir (drizzle.config.ts: casing).
 *
 * Kurallar:
 * - Para ve miktar kolonları numeric; JavaScript number'a çevrilmeden string olarak işlenir.
 * - Her kök tablo tenant_id taşır; bir platform başka platformun verisine erişemez (NFR-03).
 */
import {
  ADMIN_ROLES,
  ASSET_CLASSES,
  LEAGUE_STATUSES,
  LEAGUE_TYPES,
  ORDER_SIDES,
  PLATFORM_EVENT_TYPES,
  QUEST_PERIODS,
  QUEST_TEMPLATES,
  XP_REASONS,
} from '@lig/shared';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

export const leagueType = pgEnum('league_type', LEAGUE_TYPES);
export const leagueStatus = pgEnum('league_status', LEAGUE_STATUSES);
export const orderSide = pgEnum('order_side', ORDER_SIDES);
export const assetClass = pgEnum('asset_class', ASSET_CLASSES);
export const adminRole = pgEnum('admin_role', ADMIN_ROLES);
export const platformEventType = pgEnum('platform_event_type', PLATFORM_EVENT_TYPES);
export const xpReason = pgEnum('xp_reason', XP_REASONS);
export const outboxEventType = pgEnum('outbox_event_type', [
  'order_placed',
  'league_joined',
  'platform_event',
]);

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));

const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();
const cash = () => numeric({ precision: 20, scale: 2 });
const quantity = () => numeric({ precision: 30, scale: 10 });

export const tenants = pgTable('tenants', {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  theme: jsonb().notNull().default({}),
  /** Platformun oyuncu token'larındaki `iss` değeri. Token'ın hangi platforma ait olduğunu bu belirler. */
  ssoIssuer: text().unique(),
  /** Platformun oyuncu token'larını imzaladığı anahtarın açık kısmı (PEM, RS256). */
  ssoPublicKey: text(),
  /**
   * Platformun fiyat uç noktası (FR-30). Yalnızca kurulumda bizim tarafımızdan girilir, yönetici panelinden
   * değiştirilemez: değiştirilebilseydi API'yi iç ağdaki adreslere istek atmaya yöneltmek (SSRF) mümkün olurdu.
   */
  priceFeedUrl: text(),
  /**
   * Platformun webhook imzalarında (FR-31, T5) kullandığı HMAC anahtarı. Doğrulama için okunabilir olması
   * gerekir, bu yüzden özet (hash) olarak tutulamaz; `SecretCipher` ile şifreli saklanır (K-015).
   */
  webhookSecretCiphertext: text(),
  /** "Gerçek hesabıma geç" (FR-08) butonunun açtığı platform adresi. Yalnızca http(s). */
  realTradeUrl: text(),
  dataResidency: text().notNull().default('any'),
  createdAt: createdAt(),
});

export const adminUsers = pgTable(
  'admin_users',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /**
     * Küçük harfle saklanır ve bütün sistemde tekildir: giriş ekranında tenant seçtirmeden yöneticinin
     * hangi platforma ait olduğu e-postadan bulunur (K-016).
     */
    email: text().notNull().unique(),
    /** argon2id, PHC biçimi (`$argon2id$v=19$m=...`). */
    passwordHash: text().notNull(),
    role: adminRole().notNull().default('viewer'),
    /** TOTP secret'ı, `SecretCipher` ile şifreli (K-015). MFA kurulana kadar boş. */
    mfaSecretCiphertext: text(),
    mfaEnabledAt: timestamp({ withTimezone: true }),
    /** Son kabul edilen TOTP zaman adımı. Aynı kod ikinci kez kullanılamaz. */
    mfaLastUsedStep: bigint({ mode: 'number' }),
    lastLoginAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    check('admin_users_email_lowercase', sql`${t.email} = lower(${t.email})`),
    check(
      'admin_users_mfa_consistent',
      sql`(${t.mfaSecretCiphertext} is null) = (${t.mfaEnabledAt} is null)`,
    ),
  ],
);

export const assets = pgTable(
  'assets',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    symbol: text().notNull(),
    name: text().notNull(),
    assetClass: assetClass().notNull(),
  },
  (t) => [unique().on(t.tenantId, t.symbol)],
);

export const leagues = pgTable(
  'leagues',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    type: leagueType().notNull(),
    status: leagueStatus().notNull().default('draft'),
    startsAt: timestamp({ withTimezone: true }).notNull(),
    endsAt: timestamp({ withTimezone: true }).notNull(),
    startingCash: cash().notNull(),
    assetIds: uuid().array().notNull(),
    /** Lig kapanışının (FR-32) yapıldığı an. Sıralama bu andan sonra değişmez. */
    closedAt: timestamp({ withTimezone: true }),
    /**
     * Kapanışta değerlemede kullanılan fiyatlar: { varlıkId: fiyat | null }. Kapanmış ligin portföy ekranı
     * bu fiyatlarla gösterilir; final sıralamasıyla birebir aynı değer çıkar ve fiyatlar oynasa da değişmez.
     */
    closingPrices: jsonb().$type<Record<string, string | null>>(),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.tenantId, t.status),
    check('leagues_ends_after_starts', sql`${t.endsAt} > ${t.startsAt}`),
    check('leagues_starting_cash_positive', sql`${t.startingCash} > 0`),
  ],
);

export const players = pgTable(
  'players',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Platformdaki kullanıcının takma kimliği. Ad, e-posta, TC kimlik tutulmaz (NFR-04). */
    externalId: text().notNull(),
    displayName: text().notNull(),
    xp: integer().notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.tenantId, t.externalId), check('players_xp_non_negative', sql`${t.xp} >= 0`)],
);

export const memberships = pgTable(
  'memberships',
  {
    id: uuid().primaryKey().defaultRandom(),
    leagueId: uuid()
      .notNull()
      .references(() => leagues.id, { onDelete: 'cascade' }),
    playerId: uuid()
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    cash: cash().notNull(),
    /** Lig kapanışında dondurulan sıra ve toplam değer (FR-32). Kapanıştan önce null. */
    finalRank: integer(),
    finalValue: cash(),
    joinedAt: createdAt(),
  },
  (t) => [unique().on(t.leagueId, t.playerId), check('memberships_cash_non_negative', sql`${t.cash} >= 0`)],
);

export const positions = pgTable(
  'positions',
  {
    membershipId: uuid()
      .notNull()
      .references(() => memberships.id, { onDelete: 'cascade' }),
    assetId: uuid()
      .notNull()
      // Pozisyonu ya da emri olan varlık silinemez. Tenant silinirken önce ligler silinmeli
      // (bkz. ARCHITECTURE.md, "Tenant silme"); PostgreSQL cascade sırası bunu kendiliğinden garanti etmez.
      .references(() => assets.id, { onDelete: 'restrict' }),
    quantity: quantity().notNull(),
    avgCost: quantity().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.membershipId, t.assetId] }),
    check('positions_quantity_positive', sql`${t.quantity} > 0`),
    check('positions_avg_cost_non_negative', sql`${t.avgCost} >= 0`),
  ],
);

/** Sanal emirler değiştirilmez ve silinmez; yalnızca eklenir (NFR-07). */
export const virtualOrders = pgTable(
  'virtual_orders',
  {
    id: uuid().primaryKey().defaultRandom(),
    membershipId: uuid()
      .notNull()
      .references(() => memberships.id, { onDelete: 'cascade' }),
    assetId: uuid()
      .notNull()
      // Pozisyonu ya da emri olan varlık silinemez. Tenant silinirken önce ligler silinmeli
      // (bkz. ARCHITECTURE.md, "Tenant silme"); PostgreSQL cascade sırası bunu kendiliğinden garanti etmez.
      .references(() => assets.id, { onDelete: 'restrict' }),
    side: orderSide().notNull(),
    amount: cash().notNull(),
    price: quantity().notNull(),
    quantity: quantity().notNull(),
    idempotencyKey: uuid().notNull(),
    /** İsteğin özeti. Aynı anahtar farklı bir emirle tekrar kullanılırsa reddedilir (FR-33). */
    requestHash: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.membershipId, t.idempotencyKey),
    index().on(t.membershipId, t.createdAt),
    check('virtual_orders_amount_positive', sql`${t.amount} > 0`),
    check('virtual_orders_price_positive', sql`${t.price} > 0`),
    check('virtual_orders_quantity_positive', sql`${t.quantity} > 0`),
  ],
);

export const quests = pgTable(
  'quests',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    template: text().notNull(),
    /** "once": bir kez; "weekly": her pazartesi (TR saati) yenilenir. */
    period: text().notNull().default('once'),
    targetCount: integer().notNull(),
    xpReward: integer().notNull(),
    active: boolean().notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.tenantId, t.active),
    check('quests_template_known', sql`${t.template} in (${inList(QUEST_TEMPLATES)})`),
    check('quests_period_known', sql`${t.period} in (${inList(QUEST_PERIODS)})`),
    check('quests_target_positive', sql`${t.targetCount} > 0`),
    check('quests_xp_positive', sql`${t.xpReward} > 0`),
  ],
);

export const questProgress = pgTable(
  'quest_progress',
  {
    playerId: uuid()
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    questId: uuid()
      .notNull()
      .references(() => quests.id, { onDelete: 'cascade' }),
    /** Dönem: "once" ya da "2026-W38". Haftalık görevin her haftası ayrı satırdır. */
    periodKey: text().notNull(),
    progress: integer().notNull().default(0),
    completedAt: timestamp({ withTimezone: true }),
    updatedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.playerId, t.questId, t.periodKey] })],
);

/**
 * Transactional outbox. Emir, katılma ve platform olayı kaydedilirken aynı transaction'da buraya da bir
 * satır yazılır; görev worker'ı bu satırları işler. Uygulama olaydan hemen sonra çökse bile olay kaybolmaz
 * (K-013).
 */
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    playerId: uuid()
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    type: outboxEventType().notNull(),
    createdAt: createdAt(),
    availableAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp({ withTimezone: true }),
    attempts: integer().notNull().default(0),
    lastError: text(),
  },
  (t) => [
    index('outbox_events_pending_idx')
      .on(t.availableAt)
      .where(sql`${t.processedAt} is null`),
  ],
);

/** Platformdan webhook ile gelen olaylar. external_event_id tekrar oynatma saldırısını engeller. */
export const platformEvents = pgTable(
  'platform_events',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    externalEventId: text().notNull(),
    /** Platformdaki takma oyuncu kimliği. Ligi hiç açmamış kullanıcıların olayları da tutulur (FR-23 karşılaştırma). */
    externalPlayerId: text().notNull(),
    playerId: uuid().references(() => players.id, { onDelete: 'set null' }),
    type: platformEventType().notNull(),
    occurredAt: timestamp({ withTimezone: true }).notNull(),
    receivedAt: createdAt(),
  },
  (t) => [unique().on(t.tenantId, t.externalEventId), index().on(t.tenantId, t.type, t.occurredAt)],
);

/**
 * Oyuncuya verilen her XP'nin değiştirilemez kaydı (NFR-07). (oyuncu, sebep, kaynak) tekildir:
 * lig kapanışı iki kez çalışsa ya da görev olayı tekrar gelse bile XP bir kez verilir.
 */
export const xpLedger = pgTable(
  'xp_ledger',
  {
    id: uuid().primaryKey().defaultRandom(),
    playerId: uuid()
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    reason: xpReason().notNull(),
    /** Ödülün kaynağı: lig kimliği ya da görev kimliği + dönem. */
    sourceId: text().notNull(),
    amount: integer().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.playerId, t.reason, t.sourceId),
    index().on(t.playerId, t.createdAt),
    check('xp_ledger_amount_positive', sql`${t.amount} > 0`),
  ],
);
