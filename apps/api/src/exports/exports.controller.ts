import { Controller, Get, Param, Query, Req, Res, UseGuards } from '@nestjs/common';
import { leagueIdParam, type MetricsQuery, metricsQuery } from '@lig/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  AdminRoles,
  AdminSessionGuard,
  type AuthenticatedAdmin,
  CurrentAdmin,
} from '../admin-auth/admin-session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { type CsvFile, ExportsService } from './exports.service';

function send(reply: FastifyReply, file: CsvFile): string {
  void reply.header('content-type', 'text/csv; charset=utf-8');
  void reply.header('content-disposition', `attachment; filename="${file.filename}"`);
  void reply.header('cache-control', 'no-store');
  return file.content;
}

/** FR-25. Dosya panelin dışına çıktığı için izleyici indiremez; sahip ve düzenleyici indirir. */
@Controller('admin/export')
@UseGuards(AdminSessionGuard)
@AdminRoles('owner', 'editor')
export class ExportsController {
  constructor(private readonly exports: ExportsService) {}

  @Get('leagues/:leagueId/ranking')
  async ranking(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Param('leagueId', new ZodValidationPipe(leagueIdParam)) leagueId: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    return send(reply, await this.exports.leagueRanking(admin.account, leagueId, request.ip));
  }

  @Get('metrics')
  async metrics(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Query(new ZodValidationPipe(metricsQuery)) query: MetricsQuery,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    return send(reply, await this.exports.metricsSummary(admin.account, query.days, request.ip));
  }
}
