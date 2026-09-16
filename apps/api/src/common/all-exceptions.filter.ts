import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { type ApiError, type ErrorCode } from '@lig/shared';
import type { FastifyReply } from 'fastify';
import { AppError } from './app-error';

const CODE_BY_STATUS: Partial<Record<number, ErrorCode>> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  404: 'NOT_FOUND',
  429: 'RATE_LIMITED',
};

/** Bütün hataları tek biçimde döner: `{ code, message }`. Beklenmeyen hatanın ayrıntısı sadece loga yazılır. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();

    if (exception instanceof AppError) {
      void reply
        .status(exception.status)
        .headers(exception.headers)
        .send(this.body(exception.code, exception.message));
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = CODE_BY_STATUS[status] ?? 'INTERNAL';
      const message =
        status === 404 ? 'Bulunamadı.' : status < 500 ? 'İstek geçersiz.' : 'Beklenmeyen bir hata oluştu.';
      void reply.status(status).send(this.body(code, message));
      return;
    }

    this.logger.error(
      exception instanceof Error ? (exception.stack ?? exception.message) : String(exception),
    );
    void reply
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .send(this.body('INTERNAL', 'Beklenmeyen bir hata oluştu.'));
  }

  private body(code: ErrorCode, message: string): ApiError {
    return { code, message };
  }
}
