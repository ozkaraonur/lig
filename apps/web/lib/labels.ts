import { type LeaguePhase, type LeagueType } from '@lig/shared';

export const LEAGUE_TYPE_LABELS: Record<LeagueType, string> = {
  weekly: 'Haftalık',
  season: 'Sezon',
  friends: 'Arkadaş',
};

export const LEAGUE_PHASE_LABELS: Record<LeaguePhase, string> = {
  running: 'Devam ediyor',
  upcoming: 'Yakında',
  ended: 'Bitti',
};

const dateFormat = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short' });

export function formatDateRange(startsAt: string, endsAt: string): string {
  return `${dateFormat.format(new Date(startsAt))} – ${dateFormat.format(new Date(endsAt))}`;
}
