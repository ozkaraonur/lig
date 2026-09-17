import { Global, Module } from '@nestjs/common';
import { AUDIT_LOG } from './audit-log';
import { AUDIT_READER, DrizzleAuditLog, DrizzleAuditReader } from './drizzle-audit';

@Global()
@Module({
  providers: [
    { provide: AUDIT_LOG, useClass: DrizzleAuditLog },
    { provide: AUDIT_READER, useClass: DrizzleAuditReader },
  ],
  exports: [AUDIT_LOG, AUDIT_READER],
})
export class AuditModule {}
