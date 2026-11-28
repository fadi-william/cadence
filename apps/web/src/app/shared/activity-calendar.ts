import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  input,
  viewChild,
} from '@angular/core';

/** One day in the calendar. */
export interface CalendarDay {
  /** ISO day, `YYYY-MM-DD`. */
  date: string;
  /** Contribution count for the day. */
  value: number;
}

/**
 * GitHub-style contribution calendar (weeks × weekdays), tinted with the theme's primary colour, plus a
 * less/more legend.
 *
 * @remarks
 * Input `days` must be consecutive and in ascending order; cells flow down weekday rows (Monday first)
 * and then across week columns. Shades scale relative to the busiest day in the range.
 */
@Component({
  selector: 'app-activity-calendar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './activity-calendar.html',
})
export class ActivityCalendar {
  readonly days = input.required<CalendarDay[]>();
  private readonly scroller = viewChild.required<ElementRef<HTMLDivElement>>('scroller');

  constructor() {
    // Show the most recent weeks first on narrow screens (like GitHub's calendar).
    afterRenderEffect(() => {
      this.cells();
      const el = this.scroller().nativeElement;
      el.scrollLeft = el.scrollWidth;
    });
  }
  protected readonly levels = [0, 0.25, 0.5, 0.75, 1];

  protected readonly max = computed(() => Math.max(1, ...this.days().map((d) => d.value)));
  protected readonly total = computed(() => this.days().reduce((n, d) => n + d.value, 0));

  /** Leading blanks align the first day to its weekday row (Mon = row 0). */
  protected readonly cells = computed(() => {
    const days = this.days();
    if (!days.length) return [];
    const first = new Date(`${days[0].date}T00:00:00Z`).getUTCDay();
    const pad = (first + 6) % 7;
    return [...Array<CalendarDay | null>(pad).fill(null), ...days];
  });

  /** Cell background: base colour for zero, otherwise 20-100% primary mixed in proportion to the max. */
  shade(value: number) {
    if (value <= 0) return 'var(--color-base-300)';
    const pct = Math.round(20 + (value / this.max()) * 80);
    return `color-mix(in oklab, var(--color-primary) ${pct}%, var(--color-base-200))`;
  }
}
