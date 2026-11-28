import { Controller, Get, Param, Query } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { queryDate } from '../common/http/query-date';

/**
 * Activity metrics for the caller's scope. Dates are `YYYY-MM-DD` UTC days and `to` is inclusive. A missing or
 * invalid `to` means today, and a missing or invalid `from` means 29 days before `to` (30 days in all).
 */
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  /** Scope-wide totals (vs. the previous period) and one row per member; `managerId` narrows to one team. */
  @Get('summary')
  summary(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('managerId') managerId?: string,
  ) {
    return this.metrics.summary(actor, queryDate(from), queryDate(to), managerId);
  }

  /**
   * Per-team (`groupBy=manager`, the default for any other value) or per-tribe (`groupBy=tribe`) totals, plus
   * the scope-wide daily trend.
   */
  @Get('rollup')
  rollup(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('groupBy') groupBy?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.metrics.rollup(actor, groupBy === 'tribe' ? 'tribe' : 'manager', queryDate(from), queryDate(to));
  }

  /** One member's combined profile: totals, previous period, per-platform sources and daily values. */
  @Get('members/:id')
  member(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.metrics.member(actor, id, queryDate(from), queryDate(to));
  }
}
