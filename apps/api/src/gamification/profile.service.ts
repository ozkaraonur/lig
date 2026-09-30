import { Inject, Injectable } from '@nestjs/common';
import {
  type AppearanceRequest,
  BADGES,
  type BadgeView,
  FRAMES,
  type FrameView,
  frameById,
  type ProfileView,
  resolveTitle,
  TITLES,
  titleById,
  type TitleView,
} from '@lig/shared';
import { AppError } from '../common/app-error';
import { type AppearanceChange, PROFILE_REPOSITORY, type ProfileRepository } from './ports';

@Injectable()
export class ProfileService {
  constructor(@Inject(PROFILE_REPOSITORY) private readonly profiles: ProfileRepository) {}

  /** FR-10: rozetler, unvanlar ve çerçeveler; hangisi kazanıldı, hangisi seçili. */
  async get(tenantId: string, playerId: string): Promise<ProfileView> {
    const stored = await this.profiles.find(tenantId, playerId);
    if (!stored) throw new AppError('NOT_FOUND', 404, 'Oyuncu bulunamadı.');

    const earnedAt = new Map(stored.badges.map((b) => [b.badgeId, b.earnedAt]));
    const shownTitle = resolveTitle(stored.xp, stored.selectedTitle).id;

    const badges: BadgeView[] = BADGES.map((b) => ({
      id: b.id,
      name: b.name,
      description: b.description,
      earned: earnedAt.has(b.id),
      earnedAt: earnedAt.get(b.id)?.toISOString() ?? null,
    }));
    const titles: TitleView[] = TITLES.map((t) => ({
      id: t.id,
      name: t.name,
      minXp: t.minXp,
      owned: stored.xp >= t.minXp,
      selected: t.id === shownTitle,
    }));
    const frames: FrameView[] = FRAMES.map((f) => ({
      id: f.id,
      name: f.name,
      badgeId: f.badgeId,
      owned: earnedAt.has(f.badgeId),
      // Görünen çerçeve yalnızca hâlâ sahip olunansa seçili sayılır.
      selected: stored.selectedFrame === f.id && earnedAt.has(f.badgeId),
    }));
    return { xp: stored.xp, badges, titles, frames };
  }

  /** Unvan ya da çerçeve seçer. Sahip olunmayan seçim reddedilir ve hiçbir alan yazılmaz. */
  async setAppearance(tenantId: string, playerId: string, request: AppearanceRequest): Promise<ProfileView> {
    const change: AppearanceChange = {};
    if (request.title !== undefined) {
      const title = request.title === null ? null : titleById(request.title);
      if (title === undefined) throw new AppError('VALIDATION_FAILED', 400, 'Bilinmeyen unvan.');
      change.title = title && { id: title.id, minXp: title.minXp };
    }
    if (request.frame !== undefined) {
      const frame = request.frame === null ? null : frameById(request.frame);
      if (frame === undefined) throw new AppError('VALIDATION_FAILED', 400, 'Bilinmeyen çerçeve.');
      change.frame = frame && { id: frame.id, badgeId: frame.badgeId };
    }

    const applied = await this.profiles.setAppearance(tenantId, playerId, change);
    if (!applied) {
      throw new AppError('FORBIDDEN', 403, 'Bu unvanı ya da çerçeveyi henüz kazanmadın.');
    }
    return this.get(tenantId, playerId);
  }
}
