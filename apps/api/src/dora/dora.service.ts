import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { DeliveryServiceDto, DoraSummaryDto } from '@cadence/shared';
import { PrismaService } from '../common/prisma/prisma.service';
import { AccessScopeService } from '../org/access-scope.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { toDay } from '../common/http/http';
import { parseRange } from '../metrics/metrics.service';
import { Prisma } from '../generated/prisma/client';
import { median, rate, round1, timeToRestoreHours } from './dora.calc';

/**
 * Computes DORA metrics from stored production deployments and manages which team owns each delivery
 * service. Visibility follows {@link AccessScopeService}: services are scoped by their owning engineering
 * manager.
 */
@Injectable()
export class DoraService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: AccessScopeService,
    private readonly audit: AuditService,
  ) {}

  /** Admins see every service (incl. unassigned); others only services owned by teams in their scope. */
  private async serviceWhere(actor: AuthenticatedUser, managerId?: string): Promise<Prisma.DeliveryServiceWhereInput> {
    const ids = await this.scope.managerIds(actor);
    const where: Prisma.DeliveryServiceWhereInput = ids === null ? {} : { managerId: { in: ids } };
    if (managerId) where.AND = [{ managerId }];
    return where;
  }

  /**
   * DORA metrics for the deployments that finished within the range (UTC days, `to` inclusive).
   *
   * @remarks
   * Deployment frequency and lead time use successful deployments only; change failure rate is failed / all
   * deployments; time to restore is computed by {@link timeToRestoreHours}. Ratings come from {@link rate}.
   * Also returns per-day deployment and failure counts (every day of the range, zeros included), per-service
   * figures, and the median review wait of pull requests by people in scope (see {@link DoraService.reviewWait}).
   *
   * @param fromS - first day, `YYYY-MM-DD` (default: 29 days before `toS`)
   * @param toS - last day, `YYYY-MM-DD` (default: today); see `parseRange` for clamping
   * @param managerId - optionally narrows to one team's services, intersected with the caller's scope
   */
  async summary(actor: AuthenticatedUser, fromS?: string, toS?: string, managerId?: string): Promise<DoraSummaryDto> {
    const { from, to } = parseRange(fromS, toS);
    const services = await this.prisma.deliveryService.findMany({
      where: await this.serviceWhere(actor, managerId),
      include: { connection: { select: { name: true } }, manager: { select: { name: true } } },
      orderBy: { name: 'asc' },
    });
    const deployments = await this.prisma.deployment.findMany({
      where: {
        serviceId: { in: services.map((s) => s.id) },
        finishedAt: { gte: from, lt: new Date(to.getTime() + 864e5) },
      },
      orderBy: { finishedAt: 'asc' },
    });

    const days = Math.round((to.getTime() - from.getTime()) / 864e5) + 1;
    const successes = deployments.filter((d) => d.status === 'SUCCESS');
    const failed = deployments.length - successes.length;
    const perDay = successes.length / days;
    const cfr = deployments.length ? failed / deployments.length : null;
    const leadTime = median(successes.map((d) => d.leadTimeHours).filter((v): v is number => v !== null));
    const mttr = timeToRestoreHours(deployments);
    const reviewWait = await this.reviewWait(actor, from, to, managerId);

    const daily = new Map<string, { deployments: number; failures: number }>();
    for (let d = new Date(from); d <= to; d = new Date(d.getTime() + 864e5)) {
      daily.set(toDay(d), { deployments: 0, failures: 0 });
    }
    for (const d of deployments) {
      const bucket = daily.get(toDay(d.finishedAt));
      if (!bucket) continue;
      bucket.deployments++;
      if (d.status === 'FAILED') bucket.failures++;
    }

    return {
      from: toDay(from),
      to: toDay(to),
      deployments: deployments.length,
      failedDeployments: failed,
      deploymentsPerDay: Math.round(perDay * 100) / 100,
      changeFailureRate: cfr === null ? null : Math.round(cfr * 1000) / 1000,
      leadTimeHoursMedian: round1(leadTime),
      mttrHours: round1(mttr),
      reviewWaitHoursMedian: round1(median(reviewWait)),
      reviewedPullRequests: reviewWait.length,
      ratings: {
        deploymentFrequency: rate.deploymentFrequency(perDay, successes.length),
        leadTime: rate.leadTime(leadTime),
        changeFailureRate: rate.changeFailureRate(cfr),
        mttr: rate.mttr(mttr),
      },
      daily: [...daily.entries()].map(([date, v]) => ({ date, ...v })),
      services: services.map((s) => {
        const own = deployments.filter((d) => d.serviceId === s.id);
        return {
          id: s.id,
          name: s.name,
          connectionName: s.connection.name,
          managerId: s.managerId,
          managerName: s.manager?.name ?? null,
          deployments: own.length,
          failures: own.filter((d) => d.status === 'FAILED').length,
          leadTimeHoursMedian: round1(median(own.map((d) => d.leadTimeHours).filter((v): v is number => v !== null))),
        };
      }),
    };
  }

  /**
   * Review wait (hours) of each pull request first reviewed in the range whose author is in the caller's scope,
   * narrowed to one team when `managerId` is given. Unlike deployments this follows people, not services.
   */
  private async reviewWait(actor: AuthenticatedUser, from: Date, to: Date, managerId?: string) {
    const ids = await this.scope.managerIds(actor);
    const managerFilter = [
      ...(ids === null ? [] : [{ managerId: { in: ids } }]),
      ...(managerId ? [{ managerId }] : []),
    ];
    const rows = await this.prisma.reviewedPullRequest.findMany({
      where: { date: { gte: from, lte: to }, member: { AND: managerFilter } },
      select: { waitHours: true },
    });
    return rows.map((r) => r.waitHours);
  }

  /** Services in scope, ordered by connection then name, with their total deployment count (all time). */
  async services(actor: AuthenticatedUser): Promise<DeliveryServiceDto[]> {
    const rows = await this.prisma.deliveryService.findMany({
      where: await this.serviceWhere(actor),
      include: {
        connection: { select: { name: true, provider: true } },
        manager: { select: { name: true } },
        _count: { select: { deployments: true } },
      },
      orderBy: [{ connectionId: 'asc' }, { name: 'asc' }],
    });
    return rows.map((s) => ({
      id: s.id,
      name: s.name,
      connectionId: s.connectionId,
      connectionName: s.connection.name,
      provider: s.connection.provider,
      managerId: s.managerId,
      managerName: s.manager?.name ?? null,
      deploymentCount: s._count.deployments,
    }));
  }

  /**
   * Assigns the owning team (engineering manager) of a service and audits the change.
   *
   * @remarks
   * Admins may assign any service to any engineering manager, or unassign it with null. Tribe leads may only
   * move a service that one of their engineering managers already owns to another of their engineering
   * managers; they cannot unassign it or claim an unassigned service.
   *
   * @returns the updated service as returned by {@link DoraService.services}
   * @throws NotFoundException when the service or the engineering manager does not exist
   * @throws ForbiddenException when the service or the target manager is outside a tribe lead's scope
   */
  async setOwner(actor: AuthenticatedUser, serviceId: string, managerId: string | null) {
    const service = await this.prisma.deliveryService.findUnique({ where: { id: serviceId } });
    if (!service) throw new NotFoundException('Service not found');
    const ids = await this.scope.managerIds(actor);
    if (ids !== null) {
      if (!service.managerId || !ids.includes(service.managerId))
        throw new ForbiddenException('Service outside your scope');
      if (!managerId || !ids.includes(managerId)) throw new ForbiddenException('Manager outside your scope');
    }
    if (managerId) await this.scope.assertManagerInScope(actor, managerId);
    await this.prisma.deliveryService.update({ where: { id: serviceId }, data: { managerId } });
    await this.audit.record({
      action: 'service.owner_changed',
      entityType: 'service',
      entityId: serviceId,
      metadata: { name: service.name, from: service.managerId, to: managerId },
    });
    return (await this.services(actor)).find((s) => s.id === serviceId) ?? null;
  }
}
