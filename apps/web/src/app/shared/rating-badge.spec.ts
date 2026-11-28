import { TestBed } from '@angular/core/testing';
import type { DoraRating } from '@cadence/shared';
import { RatingBadge } from './rating-badge';

describe('RatingBadge', () => {
  const render = async (rating: DoraRating | null) => {
    const fixture = TestBed.createComponent(RatingBadge);
    fixture.componentRef.setInput('rating', rating);
    await fixture.whenStable();
    return fixture.nativeElement.querySelector('span') as HTMLSpanElement;
  };

  it.each([
    ['ELITE', 'Elite', 'badge-success'],
    ['HIGH', 'High', 'badge-info'],
    ['MEDIUM', 'Medium', 'badge-warning'],
    ['LOW', 'Low', 'badge-error'],
  ] as const)('renders %s as "%s" with %s', async (rating, label, cls) => {
    const el = await render(rating);
    expect(el.textContent?.trim()).toBe(label);
    expect(el.classList).toContain(cls);
  });

  it('shows "No data" without a rating', async () => {
    const el = await render(null);
    expect(el.textContent?.trim()).toBe('No data');
    expect(el.classList).toContain('badge-ghost');
  });
});
