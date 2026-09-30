/**
 * Günlük seri ve XP jokeri (Faz 3, K-032). Seri, oyuncunun etkin olduğu günlerden hesaplanır; saklanan bir
 * sayaç yoktur. Gün, Türkiye takvimiyle `yyyy-mm-dd`. Ödül yalnızca XP ve görünümdür (NFR-06).
 */

/** Serideki iki etkin gün arasında en fazla bu kadar gün fark olabilir: bir gün kaçırma hakkı. */
export const STREAK_MAX_GAP_DAYS = 2;
/** Her 7 etkin günde bir ödül verilir. */
export const STREAK_MILESTONE_DAYS = 7;
/** Eşik başına XP. */
export const STREAK_MILESTONE_XP = 25;
/** Jokerin etkin kaldığı süre. Bu sürede tamamlanan görevlerin XP'si 2 kat olur. */
export const JOKER_DURATION_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

function dayNumber(date: string): number {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
}

export interface StreakState {
  /** Serideki etkin gün sayısı; seri koptuysa 0. */
  days: number;
  /** Serinin ilk günü; seri yoksa null. Ödül kaynak kimliğinin parçasıdır. */
  startDate: string | null;
  /** Bugün etkin gün mü. */
  activeToday: boolean;
  /** Bugün etkin olunmazsa seri yarın kopar mı (kaçırma hakkı kullanıldı). */
  atRisk: boolean;
  /** Tamamlanan eşik sayısı (7 gün = 1). */
  milestones: number;
}

/**
 * Etkin günlerden güncel seriyi hesaplar. Art arda etkin günler arasında en fazla bir boş gün olabilir
 * (fark en çok 2). `today` ile son etkin gün arasında 2'den fazla fark varsa seri kopmuştur.
 */
export function computeStreak(activeDays: readonly string[], today: string): StreakState {
  const days = [...new Set(activeDays)].filter((d) => d <= today).sort();
  const none: StreakState = { days: 0, startDate: null, activeToday: false, atRisk: false, milestones: 0 };
  const last = days[days.length - 1];
  if (!last) return none;

  const todayNo = dayNumber(today);
  if (todayNo - dayNumber(last) > STREAK_MAX_GAP_DAYS) return none;

  let count = 1;
  let start = last;
  for (let i = days.length - 2; i >= 0; i -= 1) {
    const day = days[i]!;
    if (dayNumber(start) - dayNumber(day) > STREAK_MAX_GAP_DAYS) break;
    count += 1;
    start = day;
  }
  const activeToday = last === today;
  return {
    days: count,
    startDate: start,
    activeToday,
    atRisk: !activeToday && todayNo - dayNumber(last) === STREAK_MAX_GAP_DAYS,
    milestones: Math.floor(count / STREAK_MILESTONE_DAYS),
  };
}

export interface JokerView {
  /** Kazanılmış, henüz kullanılmamış joker sayısı. */
  available: number;
  /** Şu an etkin olan jokerin bitiş anı; yoksa null. */
  activeUntil: string | null;
}

export interface StreakView {
  days: number;
  activeToday: boolean;
  atRisk: boolean;
  /** Sonraki eşiğe kalan etkin gün. */
  daysToMilestone: number;
  milestoneXp: number;
  joker: JokerView;
}

export function daysToNextMilestone(days: number): number {
  return STREAK_MILESTONE_DAYS - (days % STREAK_MILESTONE_DAYS);
}
