import { Injectable, Logger } from '@nestjs/common';
import type { AuditLogDto, AuditPageDto } from '@cadence/shared';
import { PrismaService } from '../common/prisma/prisma.service';
import { currentContext } from '../common/context/request-context';
import { Prisma } from '../generated/prisma/client';

/** One event to record in the audit log. */
export interface AuditEntry {
  /** Dotted event name, e.g. `auth.login` or `member.updated`. */
  action: string;
  /** Kind of record the event is about, e.g. `user`. */
  entityType: string;
  entityId?: string | null;
  /** Extra JSON details stored with the entry. Never put secrets here. */
  metadata?: Record<string, unknown>;
  /**
   * Who performed the action. Defaults to the authenticated user of the current request; pass `null` to record
   * no actor (e.g. a failed login).
   */
  actor?: { id: string; email: string } | null;
}

/** Append-only audit trail. Recording never throws: auditing must not break the main action. */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Writes an entry, adding the client IP from the request context. Failures are logged, not thrown.
   */
  async record(entry: AuditEntry): Promise<void> {
    const ctx = currentContext();
    const actor = entry.actor === undefined ? ctx.user : entry.actor;
    try {
      await this.prisma.auditLog.create({
        data: {
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId ?? null,
          metadata: (entry.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
          actorId: actor?.id ?? null,
          actorEmail: actor?.email ?? null,
          ip: ctx.ip ?? null,
        },
      });
    } catch (e) {
      this.logger.error(`Failed to write audit entry ${entry.action}: ${(e as Error).message}`);
    }
  }

  /**
   * Returns one page of entries ordered by `createdAt` then `id`, both descending.
   *
   * @param opts - `cursor` is the id of the last entry already shown; `limit` is clamped to 1-200 (default 50);
   *   `entityType` matches exactly; `action` matches as a prefix
   * @returns the page and `nextCursor`, which is null when there are no more entries
   */
  async list(opts: { cursor?: string; limit?: number; entityType?: string; action?: string }): Promise<AuditPageDto> {
    const take = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const rows = await this.prisma.auditLog.findMany({
      where: {
        ...(opts.entityType ? { entityType: opts.entityType } : {}),
        ...(opts.action ? { action: { startsWith: opts.action } } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });
    const items: AuditLogDto[] = rows.slice(0, take).map((r) => ({
      ...r,
      metadata: (r.metadata ?? null) as Record<string, unknown> | null,
      createdAt: r.createdAt.toISOString(),
    }));
    return { items, nextCursor: rows.length > take ? items[items.length - 1].id : null };
  }
}
