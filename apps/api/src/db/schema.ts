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
  AUDIT_ACTOR_TYPES,
  ASSET_CLASSES,
  BADGE_IDS,
  FRAME_IDS,
  LEAGUE_STATUSES,
  LEAGUE_TYPES,
  ORDER_SIDES,
  PLATFORM_EVENT_TYPES,
  QUEST_PERIODS,
  QUEST_TEMPLATES,
  TITLE_IDS,
  XP_REASONS,
} from '@lig/shared';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
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
  uniqueIndex,
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
  /** Rozet yeniden değerlendirme sinyali: lig kapanışı ve tavan/taban günü kaydı (K-030). */
  'badge_recheck',
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
  /** Uyum ayarı (FR-24): platform butonu kapatabilir. Kapalıyken oyuncuya adres hiç gönderilmez. */
  realTradeButtonEnabled: boolean().notNull().default(true),
  /** Uyum ayarı (FR-24): "gerçek işlem yap" görevi. Kapalıyken görev listelenmez, ilerlemez, XP vermez. */
  realTradeQuestEnabled: boolean().notNull().default(true),
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
    /**
     * Oturum sürümü. Artırılınca bu yöneticinin bütün açık oturumları bir sonraki istekte düşer
     * (parola değişimi, "diğer oturumları kapat", MFA sıfırlama).
     */
    sessionVersion: integer().notNull().default(0),
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
    /** Hisse varlıklarında sektör (ör. "Bankacılık"); kripto varlıklarda boş. */
    sector: text(),
    /**
     * Tavan/taban hesabında kullanılan referans: son seans gününün kapanış fiyatı ve o günün tarihi
     * (Türkiye takvimi). Yeni varlıkta boştur, ilk seans kapanışında dolar.
     */
    referenceClose: quantity(),
    referenceCloseDate: date(),
  },
  (t) => [unique().on(t.tenantId, t.symbol)],
);

/**
 * Bir hissenin tavanda ya da tabanda kapandığı seans günleri (FR-10, "Tavan Avcısı"). Market-close servisi
 * seans kapanışını yazarken aynı transaction'da buraya da yazar. Kaynak veri budur: rozet, emrin verildiği
 * günle bu tablodaki gün eşleşince kazanılır.
 */
export const assetLimitDays = pgTable(
  'asset_limit_days',
  {
    assetId: uuid()
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Seans günü, Türkiye takvimi. */
    sessionDate: date().notNull(),
    kind: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.assetId, t.sessionDate] }),
    check('asset_limit_days_kind_known', sql`${t.kind} in ('limit_up', 'limit_down')`),
  ],
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
    /** Katılım koşulu (FR-20): kontenjan. Null ise sınırsız. */
    maxMembers: integer(),
    /** Katılım koşulu (FR-20): lig başladıktan sonra katılım. */
    lateJoinAllowed: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index().on(t.tenantId, t.status),
    check('leagues_max_members_positive', sql`${t.maxMembers} is null or ${t.maxMembers} > 0`),
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
    /** Oyuncunun seçtiği unvan (FR-10). Unvanın kendisi XP'den türetilir; burada yalnızca seçim durur. */
    selectedTitle: text(),
    /** Oyuncunun seçtiği profil çerçevesi. Yalnızca kazandığı rozetin çerçevesi seçilebilir. */
    selectedFrame: text(),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.tenantId, t.externalId),
    check('players_xp_non_negative', sql`${t.xp} >= 0`),
    check(
      'players_selected_title_known',
      sql`${t.selectedTitle} is null or ${t.selectedTitle} in (${inList(TITLE_IDS)})`,
    ),
    check(
      'players_selected_frame_known',
      sql`${t.selectedFrame} is null or ${t.selectedFrame} in (${inList(FRAME_IDS)})`,
    ),
  ],
);

/**
 * Kazanılan rozetler (FR-10). (oyuncu, rozet) tekildir: aynı rozet iki kez yazılamaz, worker eşzamanlı ya da
 * tekrar çalışsa bile. Rozet geri alınmaz. Sahiplik oyuncuya bağlıdır; tenant oyuncu satırından gelir.
 */
export const playerBadges = pgTable(
  'player_badges',
  {
    playerId: uuid()
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    badgeId: text().notNull(),
    earnedAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.playerId, t.badgeId] }),
    check('player_badges_badge_known', sql`${t.badgeId} in (${inList(BADGE_IDS)})`),
  ],
);

/**
 * Ziyaret günleri (K-032). Günlük seri, ziyaret günleri ile emir günlerinin birleşiminden hesaplanır. (oyuncu,
 * gün) tekildir: aynı gün ikinci ziyaret satır eklemez. Gün Türkiye takvimidir.
 */
export const playerActivityDays = pgTable(
  'player_activity_days',
  {
    playerId: uuid()
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    day: date({ mode: 'string' }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.playerId, t.day] })],
);

/**
 * XP jokerleri (K-032). Seri eşiğinde kazanılır (oyuncu, kaynak tekil), oyuncu etkinleştirir. Etkinken
 * tamamlanan görevlerin XP'si 2 kat olur. `activated_at` ve `expires_at` birlikte dolu ya da birlikte boştur.
 */
export const xpJokers = pgTable(
  'xp_jokers',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    playerId: uuid()
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    /** Kazanıldığı eşik: "seriBaşlangıcı:gün". */
    sourceId: text().notNull(),
    earnedAt: createdAt(),
    activatedAt: timestamp({ withTimezone: true }),
    expiresAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    unique().on(t.playerId, t.sourceId),
    check('xp_jokers_window', sql`(${t.activatedAt} is null) = (${t.expiresAt} is null)`),
  ],
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
    // Aynı şablon ve dönemden iki görev, aynı işi iki kez saydırırdı (FR-21).
    unique().on(t.tenantId, t.template, t.period),
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
 * "Gerçek hesabıma geç" tıklamaları (FR-23). Huninin ortasındaki adım: lige katılan oyuncunun platformun
 * gerçek işlem ekranına yönelmesi. Tıklayan oyuncunun kendi kimliği değil, bizdeki oyuncu satırı tutulur;
 * ad, e-posta, IP ya da tarayıcı bilgisi yazılmaz (NFR-04). Ligden geldiyse hangi lig olduğu da saklanır.
 */
export const realTradeClicks = pgTable(
  'real_trade_clicks',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    playerId: uuid()
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    leagueId: uuid().references(() => leagues.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.tenantId, t.createdAt), index().on(t.playerId, t.createdAt)],
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

/**
 * Yönetici davetleri. Token'ın kendisi değil SHA-256 özeti saklanır; link yalnızca oluşturulduğu anda
 * gösterilir. Aynı platformda aynı e-postaya bekleyen tek davet olur.
 */
export const adminInvites = pgTable(
  'admin_invites',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    email: text().notNull(),
    role: adminRole().notNull(),
    tokenHash: text().notNull().unique(),
    invitedByAdminId: uuid().references(() => adminUsers.id, { onDelete: 'set null' }),
    acceptedAdminId: uuid().references(() => adminUsers.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    acceptedAt: timestamp({ withTimezone: true }),
    revokedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    check('admin_invites_email_lowercase', sql`${t.email} = lower(${t.email})`),
    uniqueIndex('admin_invites_one_pending_per_email')
      .on(t.tenantId, t.email)
      .where(sql`${t.acceptedAt} is null and ${t.revokedAt} is null`),
  ],
);

/**
 * Değiştirilemez denetim kaydı (NFR-07, K-019). Güncelleme, silme ve TRUNCATE veritabanı tetikleyicisiyle
 * engellenir (migration 0007). Her kayıt kendi zincirindeki (platform başına bir zincir) bir önceki kaydın
 * özetini taşır; araya eklenen, değiştirilen ya da silinen kayıt `audit:verify` ile bulunur.
 * Yönetici ve tenant'a yabancı anahtar yok: yönetici ya da platform silinse de kayıt kalır.
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    seq: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    /** Tenant kimliği ya da platforma bağlı olmayan olaylar için `system`. */
    chainKey: text().notNull(),
    tenantId: uuid(),
    occurredAt: timestamp({ withTimezone: true }).notNull(),
    action: text().notNull(),
    actorType: text().notNull(),
    actorAdminId: uuid(),
    /** İşlem anındaki e-posta. Yönetici sonradan silinse de kayıt okunur kalır. */
    actorEmail: text(),
    targetType: text(),
    targetId: text(),
    targetLabel: text(),
    ip: text(),
    /** Yalnızca düz değerler; parola, token, secret asla yazılmaz. */
    metadata: jsonb().notNull().default({}),
    prevHash: text(),
    hash: text().notNull().unique(),
  },
  (t) => [
    check('audit_events_actor_type', sql`${t.actorType} in (${inList(AUDIT_ACTOR_TYPES)})`),
    index().on(t.chainKey, t.seq),
  ],
);
