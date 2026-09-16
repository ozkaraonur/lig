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
} from '@lig/shared';
import { sql } from 'drizzle-orm';
import {
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
    email: text().notNull(),
    passwordHash: text().notNull(),
    role: adminRole().notNull().default('viewer'),
    mfaSecret: text(),
    lastLoginAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.tenantId, t.email)],
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
    finalRank: integer(),
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
      .references(() => assets.id, { onDelete: 'restrict' }),
    quantity: quantity().notNull(),
    avgCost: quantity().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.membershipId, t.assetId] }),
    check('positions_quantity_non_negative', sql`${t.quantity} >= 0`),
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
      .references(() => assets.id, { onDelete: 'restrict' }),
    side: orderSide().notNull(),
    amount: cash().notNull(),
    price: quantity().notNull(),
    quantity: quantity().notNull(),
    idempotencyKey: uuid().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.membershipId, t.idempotencyKey),
    index().on(t.membershipId, t.createdAt),
    check('virtual_orders_amount_positive', sql`${t.amount} > 0`),
    check('virtual_orders_price_positive', sql`${t.price} > 0`),
  ],
);

export const quests = pgTable('quests', {
  id: uuid().primaryKey().defaultRandom(),
  tenantId: uuid()
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  template: text().notNull(),
  targetCount: integer().notNull(),
  xpReward: integer().notNull(),
  active: boolean().notNull().default(true),
});

export const questProgress = pgTable(
  'quest_progress',
  {
    playerId: uuid()
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    questId: uuid()
      .notNull()
      .references(() => quests.id, { onDelete: 'cascade' }),
    progress: integer().notNull().default(0),
    completedAt: timestamp({ withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.playerId, t.questId] })],
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
    playerId: uuid().references(() => players.id, { onDelete: 'set null' }),
    type: platformEventType().notNull(),
    occurredAt: timestamp({ withTimezone: true }).notNull(),
    receivedAt: createdAt(),
  },
  (t) => [unique().on(t.tenantId, t.externalEventId), index().on(t.tenantId, t.type, t.occurredAt)],
);
