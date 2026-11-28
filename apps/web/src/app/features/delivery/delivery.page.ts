import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  resource,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../../core/api.service';
import { AuthStore } from '../../core/auth.store';
import { DateRange, fmtHours, lastNDays, shortDay } from '../../core/dates';
import { ToastService } from '../../core/toast.service';
import { Chart, ChartSpec } from '../../shared/chart';
import { DateRangePicker } from '../../shared/date-range';
import { DoraTile, doraKpis } from '../../shared/dora-tile';
import { PageHeader } from '../../shared/page-header';
import { ProviderIcon } from '../../shared/provider-icon';
import { TILE_GRID, tileSpan } from '../../shared/tile-grid';

/**
 * DORA delivery page: the four key-metric tiles plus review wait, a stacked chart of successful vs failed
 * deployments per day, and the services table. Filterable by date range and, when several are visible, by team. Admins and
 * tribe leads can reassign a service's owning team inline; only admins can leave a service unassigned.
 */
@Component({
  selector: 'app-delivery-page',
  imports: [RouterLink, Chart, DateRangePicker, DoraTile, PageHeader, ProviderIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './delivery.page.html',
})
export class DeliveryPage {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  protected readonly auth = inject(AuthStore);
  protected readonly range = signal<DateRange>(lastNDays(30));
  /** Selected engineering manager id, or `''` for all visible teams. */
  protected readonly team = signal('');
  protected readonly hours = fmtHours;
  protected readonly tileGrid = TILE_GRID;
  protected readonly tileSpan = tileSpan;

  protected readonly summary = resource({
    params: () => ({ ...this.range(), team: this.team() }),
    loader: ({ params }) => this.api.dora(params.from, params.to, params.team || undefined),
  });
  private readonly managerRes = resource({ loader: () => this.api.users('ENGINEERING_MANAGER') });
  protected readonly managers = computed(() => this.managerRes.value() ?? []);
  protected readonly canAssign = computed(() => this.auth.hasRole('ADMIN', 'TRIBE_LEAD'));

  protected readonly tiles = computed(() => {
    const d = this.summary.value();
    return d ? doraKpis(d, fmtHours) : [];
  });

  protected readonly chart = computed<ChartSpec | null>(() => {
    const daily = this.summary.value()?.daily;
    if (!daily) return null;
    return {
      categories: daily.map((d) => shortDay(d.date)),
      series: [
        {
          name: 'Successful',
          type: 'bar',
          data: daily.map((d) => d.deployments - d.failures),
          color: 'success',
          stack: 'd',
        },
        {
          name: 'Failed',
          type: 'bar',
          data: daily.map((d) => d.failures),
          color: 'error',
          stack: 'd',
        },
      ],
    };
  });

  /**
   * Sets the owning team of a service and reloads the summary.
   *
   * @param managerId - Engineering manager id, or `''` to unassign.
   */
  async assign(serviceId: string, managerId: string) {
    try {
      await this.api.setServiceOwner(serviceId, managerId || null);
      this.toast.success('Owner updated');
      this.summary.reload();
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }
}
