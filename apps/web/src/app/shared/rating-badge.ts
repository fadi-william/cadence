import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { DoraRating } from '@cadence/shared';

/** Coloured daisyUI badge for a DORA rating ("Elite", "High", ...); "No data" when `rating` is `null`. */
@Component({
  selector: 'app-rating-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './rating-badge.html',
})
export class RatingBadge {
  readonly rating = input<DoraRating | null>(null);
  protected readonly cls = computed(
    () =>
      ({ ELITE: 'badge-success', HIGH: 'badge-info', MEDIUM: 'badge-warning', LOW: 'badge-error' })[
        this.rating() ?? 'LOW'
      ],
  );
  protected readonly label = computed(() => {
    const r = this.rating();
    return r ? r[0] + r.slice(1).toLowerCase() : '';
  });
}
