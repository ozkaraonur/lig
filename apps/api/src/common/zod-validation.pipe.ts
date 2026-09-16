import { type PipeTransform } from '@nestjs/common';
import { type ZodType } from 'zod';
import { AppError } from './app-error';

/** İstek gövdesini zod şemasıyla doğrular. Hata mesajı sadece alan adlarını içerir, gönderilen değeri tekrar etmez. */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const fields = [...new Set(result.error.issues.map((i) => i.path.join('.') || 'body'))].join(', ');
      throw new AppError('VALIDATION_FAILED', 400, `Geçersiz alanlar: ${fields}`);
    }
    return result.data;
  }
}
