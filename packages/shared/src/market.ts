/**
 * Pay piyasası seans takvimi ve fiyat limitleri (Faz 2, 7. adım).
 *
 * Kaynak: Borsa İstanbul pay piyasası sürekli işlem saatleri 10:00-13:00 ve 14:00-18:00 (arada tek fiyat
 * seansı var, biz sürekli işlemi modelliyoruz) ve Borsa İstanbul Pay Piyasası 2026 tatil tablosu.
 * Sahte veriyle çalışan bir eğitim modülü için gerçeğe yakın bir model; gerçek emir iletimi yok.
 */

/** Türkiye 2016'dan beri sabit UTC+3; yaz saati uygulaması yok. */
const TR_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

export interface SessionSpan {
  /** Türkiye saatiyle gün içi dakika (10:00 → 600). */
  fromMinutes: number;
  toMinutes: number;
}

/** Tam gün: sabah ve öğleden sonra seansı. Öğle arası (13:00-14:00) kapalı sayılır. */
export const FULL_DAY_SESSIONS: readonly SessionSpan[] = [
  { fromMinutes: 10 * 60, toMinutes: 13 * 60 },
  { fromMinutes: 14 * 60, toMinutes: 18 * 60 },
];

/** Yarım gün (bayram arifesi, cumhuriyet bayramı arifesi): yalnızca sabah seansı. */
export const HALF_DAY_SESSIONS: readonly SessionSpan[] = [{ fromMinutes: 10 * 60, toMinutes: 13 * 60 }];

/**
 * Borsanın kapalı olduğu günler (yyyy-mm-dd, Türkiye takvimi). Dini bayramlar her yıl kaydığı için liste
 * yıllık olarak Borsa İstanbul'un yayımladığı tatil tablosundan güncellenmelidir.
 */
export const MARKET_HOLIDAYS: readonly string[] = [
  // 2026 pay piyasası tatil tablosu
  '2026-01-01', // Yılbaşı
  '2026-03-20', // Ramazan Bayramı
  '2026-03-21',
  '2026-03-22',
  '2026-04-23', // Ulusal Egemenlik ve Çocuk Bayramı
  '2026-05-01', // Emek ve Dayanışma Günü
  '2026-05-19', // Atatürk'ü Anma, Gençlik ve Spor Bayramı
  '2026-05-27', // Kurban Bayramı
  '2026-05-28',
  '2026-05-29',
  '2026-07-15', // Demokrasi ve Millî Birlik Günü
  '2026-10-29', // Cumhuriyet Bayramı
];

/** Yarım gün seans yapılan günler. */
export const MARKET_HALF_DAYS: readonly string[] = ['2026-03-19', '2026-05-26', '2026-10-28'];

/** Takvimin kapsadığı yıllar. Kapsam dışındaki bir tarihte yalnızca hafta sonu kuralı uygulanır. */
export const CALENDAR_YEARS: readonly number[] = [2026];

const holidays = new Set(MARKET_HOLIDAYS);
const halfDays = new Set(MARKET_HALF_DAYS);

/** Türkiye saatiyle takvim günü, `yyyy-mm-dd`. */
export function trDate(at: Date): string {
  return new Date(at.getTime() + TR_OFFSET_MS).toISOString().slice(0, 10);
}

/** Türkiye saatiyle gün içi dakika. */
function trMinutes(at: Date): number {
  const local = new Date(at.getTime() + TR_OFFSET_MS);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
}

/** Türkiye saatindeki gün başlangıcının UTC karşılığı. */
function trDayStart(date: string): number {
  return Date.parse(`${date}T00:00:00Z`) - TR_OFFSET_MS;
}

function isWeekend(date: string): boolean {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

export function calendarKnown(date: string): boolean {
  return CALENDAR_YEARS.includes(Number(date.slice(0, 4)));
}

/** O gün geçerli seanslar; borsa kapalıysa boş dizi. */
export function sessionsOn(date: string): readonly SessionSpan[] {
  if (isWeekend(date) || holidays.has(date)) return [];
  return halfDays.has(date) ? HALF_DAY_SESSIONS : FULL_DAY_SESSIONS;
}

export type MarketPhase =
  | 'open'
  /** Öğle arası: seans günü ama iki seans arasında. */
  | 'lunch_break'
  /** Seans günü, henüz açılmadı. */
  | 'before_open'
  /** Seans günü, kapandı. */
  | 'after_close'
  | 'weekend'
  | 'holiday';

export interface MarketStatus {
  open: boolean;
  phase: MarketPhase;
  /** Kapalıyken bir sonraki açılış, açıkken null. */
  opensAt: string | null;
  /** Açıkken o seansın kapanışı, kapalıyken null. */
  closesAt: string | null;
  /** Bu tarih takvimin kapsadığı bir yılda mı; değilse yalnızca hafta sonu kuralı uygulanmıştır. */
  calendarKnown: boolean;
}

/** Bir sonraki açılış anını arar. Kapalı gün dizisi uzun olamayacağı için 14 günle sınırlı. */
function nextOpening(now: Date): Date | null {
  const nowMs = now.getTime();
  for (let offset = 0; offset < 14; offset += 1) {
    const date = trDate(new Date(nowMs + offset * DAY_MS));
    const dayStart = trDayStart(date);
    for (const span of sessionsOn(date)) {
      const open = dayStart + span.fromMinutes * MINUTE_MS;
      if (open > nowMs) return new Date(open);
    }
  }
  return null;
}

/** Hisse varlıkları için seans durumu. Kripto varlıklar 7/24 açıktır, bu fonksiyon onlara uygulanmaz. */
export function marketStatus(now: Date): MarketStatus {
  const date = trDate(now);
  const minutes = trMinutes(now);
  const sessions = sessionsOn(date);
  const known = calendarKnown(date);
  const dayStart = trDayStart(date);

  for (const span of sessions) {
    if (minutes >= span.fromMinutes && minutes < span.toMinutes) {
      return {
        open: true,
        phase: 'open',
        opensAt: null,
        closesAt: new Date(dayStart + span.toMinutes * MINUTE_MS).toISOString(),
        calendarKnown: known,
      };
    }
  }

  const first = sessions[0];
  const last = sessions[sessions.length - 1];
  let phase: MarketPhase;
  if (sessions.length === 0) phase = holidays.has(date) ? 'holiday' : 'weekend';
  else if (first && minutes < first.fromMinutes) phase = 'before_open';
  else if (last && minutes >= last.toMinutes) phase = 'after_close';
  else phase = 'lunch_break';

  const next = nextOpening(now);
  return {
    open: false,
    phase,
    opensAt: next ? next.toISOString() : null,
    closesAt: null,
    calendarKnown: known,
  };
}

/** Seans günü mü (hafta içi ve tatil değil). */
export function isTradingDay(date: string): boolean {
  return sessionsOn(date).length > 0;
}

/** Verilen andan önceki en son seans gününün kapanış anı; hiç yoksa null. */
export function lastSessionClose(now: Date): { date: string; closedAt: Date } | null {
  const nowMs = now.getTime();
  for (let offset = 0; offset < 14; offset += 1) {
    const date = trDate(new Date(nowMs - offset * DAY_MS));
    const sessions = sessionsOn(date);
    const last = sessions[sessions.length - 1];
    if (!last) continue;
    const closedAt = trDayStart(date) + last.toMinutes * MINUTE_MS;
    if (closedAt <= nowMs) return { date, closedAt: new Date(closedAt) };
  }
  return null;
}

/** Tavan ve taban: önceki kapanışa göre ±%10 (pay piyasası kuralı). */
export const PRICE_LIMIT_RATIO = 0.1;
/** Limit fiyatları bu ondalık basamakla yuvarlanır; fiyat kolonu daha hassas ama emirde bu yeterli. */
const LIMIT_DECIMALS = 4;

export interface PriceLimits {
  floor: string;
  ceiling: string;
}

export function priceLimits(referenceClose: string): PriceLimits | null {
  const base = Number(referenceClose);
  if (!Number.isFinite(base) || base <= 0) return null;
  return {
    floor: (base * (1 - PRICE_LIMIT_RATIO)).toFixed(LIMIT_DECIMALS),
    ceiling: (base * (1 + PRICE_LIMIT_RATIO)).toFixed(LIMIT_DECIMALS),
  };
}

export type ClampReason = 'floor' | 'ceiling' | null;

/**
 * Fiyatı tavan/taban aralığına çeker. Aralıktaysa fiyat string olarak aynen döner: sayıya çevrilip geri
 * yazılmadığı için hassasiyet kaybı olmaz. Referans kapanış yoksa (yeni varlık) limit uygulanmaz.
 */
export function clampToLimits(
  price: string,
  referenceClose: string | null,
): { price: string; clamped: ClampReason } {
  if (!referenceClose) return { price, clamped: null };
  const limits = priceLimits(referenceClose);
  if (!limits) return { price, clamped: null };
  const value = Number(price);
  if (!Number.isFinite(value)) return { price, clamped: null };
  if (value > Number(limits.ceiling)) return { price: limits.ceiling, clamped: 'ceiling' };
  if (value < Number(limits.floor)) return { price: limits.floor, clamped: 'floor' };
  return { price, clamped: null };
}

export type LimitState = 'limit_up' | 'limit_down';

/**
 * Bir seansın kapanışı, önceki kapanışa göre tavanda ya da tabanda mı (FR-10, "Tavan Avcısı"). Fiyat akışı
 * limit dışındaki fiyatı sınıra çektiği için tavanda kapanan hisse tam sınır fiyatıyla kapanır. Önceki
 * kapanış yoksa (yeni varlık) limit de yoktur, dolayısıyla tavan ya da taban da yoktur.
 */
export function limitStateAtClose(close: string, previousClose: string | null): LimitState | null {
  if (!previousClose) return null;
  const limits = priceLimits(previousClose);
  const value = Number(close);
  if (!limits || !Number.isFinite(value)) return null;
  if (value >= Number(limits.ceiling)) return 'limit_up';
  if (value <= Number(limits.floor)) return 'limit_down';
  return null;
}

export const MARKET_PHASE_LABELS: Record<MarketPhase, string> = {
  open: 'Seans açık',
  lunch_break: 'Öğle arası',
  before_open: 'Seans henüz açılmadı',
  after_close: 'Seans kapandı',
  weekend: 'Hafta sonu',
  holiday: 'Resmî tatil',
};
