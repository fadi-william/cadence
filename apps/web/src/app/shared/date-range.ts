import { ChangeDetectionStrategy, Component, computed, linkedSignal, model } from '@angular/core';
import { DateRange, RANGE_OPTIONS, isoDay, lastNDays } from '../core/dates';
import { Icon } from './icon';

/**
 * Preset ranges plus a custom from/to picker. Two-way bind with `[(range)]` (defaults to the last 30 days).
 * Pure signals, no forms module.
 */
@Component({
  selector: 'app-date-range',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'text-base-content' },
  templateUrl: './date-range.html',
})
export class DateRangePicker {
  readonly range = model<DateRange>(lastNDays(30));
  protected readonly options = RANGE_OPTIONS;
  protected readonly today = isoDay(new Date());

  /** Matching preset for the current range (0 = custom); resets whenever the range changes. */
  private readonly matched = computed(() => {
    const r = this.range();
    return (
      this.options.find((o) => {
        const p = lastNDays(o.days);
        return p.from === r.from && p.to === r.to;
      })?.days ?? 0
    );
  });
  protected readonly preset = linkedSignal(() => this.matched());

  /** Selects a preset; `0` switches to custom mode and keeps the current range until dates are set. */
  choose(days: number) {
    this.preset.set(days);
    if (days) this.range.set(lastNDays(days));
  }

  /** Applies a custom range; ignored unless both ISO days are present and `from` is not after `to`. */
  set(from: string, to: string) {
    if (from && to && from <= to) this.range.set({ from, to });
  }
}
