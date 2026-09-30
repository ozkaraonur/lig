import { describe, expect, it } from 'vitest';
import {
  createFriendsLeagueRequest,
  formatInviteCode,
  INVITE_CODE_ALPHABET,
  joinByCodeRequest,
  normalizeInviteCode,
} from './friends';

describe('davet kodu', () => {
  it('alfabede karışan karakterler yok', () => {
    for (const c of ['0', 'O', '1', 'I']) expect(INVITE_CODE_ALPHABET).not.toContain(c);
    expect(INVITE_CODE_ALPHABET).toHaveLength(32);
  });

  it('büyük harfe çevirir, boşluk ve tire atar', () => {
    expect(normalizeInviteCode(' abcde-fghjk ')).toBe('ABCDEFGHJK');
    expect(formatInviteCode('ABCDEFGHJK')).toBe('ABCDE-FGHJK');
  });

  it('yalnızca 10 karakterlik geçerli alfabe kabul edilir', () => {
    expect(joinByCodeRequest.safeParse({ code: 'abcde-fghjk' }).success).toBe(true);
    expect(joinByCodeRequest.safeParse({ code: 'ABCDEFGHJ' }).success).toBe(false);
    expect(joinByCodeRequest.safeParse({ code: 'ABCDEFGHJ0' }).success).toBe(false);
    expect(joinByCodeRequest.safeParse({ code: 'ABCDEFGHJK', extra: 1 }).success).toBe(false);
  });
});

describe('arkadaş ligi kurma isteği', () => {
  it('yalnızca ad ve izinli süre', () => {
    expect(createFriendsLeagueRequest.safeParse({ name: 'Kuzenler', durationDays: 14 }).success).toBe(true);
    expect(createFriendsLeagueRequest.safeParse({ name: 'Kuzenler', durationDays: 10 }).success).toBe(false);
    expect(
      createFriendsLeagueRequest.safeParse({ name: 'Kuzenler', durationDays: 7, maxMembers: 99 }).success,
    ).toBe(false);
  });
});
