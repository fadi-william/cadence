import { Controller, Get, Query } from '@nestjs/common';
import { AuditService } from './audit.service';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../generated/prisma/enums';

/** Admin-only read access to the audit log. */
@Roles(UserRole.ADMIN)
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  /**
   * Lists audit entries, newest first, one page at a time.
   *
   * @param cursor - id of the last entry of the previous page (`nextCursor`)
   * @param limit - page size, clamped to 1-200 (default 50)
   * @param entityType - exact entity type filter, e.g. `user`
   * @param action - action prefix filter, e.g. `auth.` matches every auth event
   */
  @Get()
  list(
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('entityType') entityType?: string,
    @Query('action') action?: string,
  ) {
    return this.audit.list({ cursor, limit: limit ? Number(limit) : undefined, entityType, action });
  }
}
