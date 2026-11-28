import { TestBed } from '@angular/core/testing';
import type { DoraRating } from '@cadence/shared';
import { DoraTile, doraKpis, reviewWaitHint } from './dora-tile';

describe('DoraTile', () => {
  const render = async (rating: DoraRating | null, hint?: string) => {
    const fixture = TestBed.createComponent(DoraTile);
    fixture.componentRef.setInput('label', 'Lead time');
    fixture.componentRef.setInput('value', '3.2 h');
    fixture.componentRef.setInput('icon', 'clock');
    fixture.componentRef.setInput('rating', rating);
    if (hint) fixture.componentRef.setInput('hint', hint);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    return { el, progress: el.querySelector('[role="progressbar"]') as HTMLElement };
  };

  it.each([
    ['ELITE', '100'],
    ['HIGH', '75'],
    ['MEDIUM', '50'],
    ['LOW', '25'],
    [null, '0'],
  ] as const)('maps %s to a %s%% radial level', async (rating, pct) => {
    const { progress } = await render(rating);
    expect(progress.getAttribute('aria-valuenow')).toBe(pct);
    expect(progress.getAttribute('aria-label')).toBe('Lead time rating');
  });

  it('renders value, hint and rating badge', async () => {
    const { el } = await render('HIGH', 'Median');
    expect(el.textContent).toContain('3.2 h');
    expect(el.textContent).toContain('Median');
    expect(el.querySelector('app-rating-badge')!.textContent!.trim()).toBe('High');
  });

  it('drops the rating ring and badge for an unrated metric', async () => {
    const fixture = TestBed.createComponent(DoraTile);
    fixture.componentRef.setInput('label', 'Review wait');
    fixture.componentRef.setInput('value', '5.0 h');
    fixture.componentRef.setInput('icon', 'hourglass');
    fixture.componentRef.setInput('rated', false);
    fixture.componentRef.setInput('hint', 'Median, 42 PRs');
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[role="progressbar"]')).toBeNull();
    expect(el.querySelector('app-rating-badge')).toBeNull();
    expect(el.querySelector('app-icon svg path')!.getAttribute('d')).toBeTruthy();
    expect(el.textContent).toContain('Review wait');
    expect(el.textContent).toContain('5.0 h');
    expect(el.textContent).toContain('Median, 42 PRs');
    expect(el.textContent).not.toContain('No data');
  });
});

describe('doraKpis', () => {
  const fmt = (h: number | null) => (h === null ? '—' : `${h}h`);
  const base = {
    deploymentsPerDay: 1.5,
    deployments: 10,
    failedDeployments: 2,
    leadTimeHoursMedian: 4,
    changeFailureRate: 0.2,
    mttrHours: 1,
    reviewWaitHoursMedian: 5,
    reviewedPullRequests: 42,
    ratings: {
      deploymentFrequency: 'ELITE',
      leadTime: 'HIGH',
      changeFailureRate: 'MEDIUM',
      mttr: null,
    } as Record<
      'deploymentFrequency' | 'leadTime' | 'changeFailureRate' | 'mttr',
      DoraRating | null
    >,
  };

  it('builds the four key metrics in order, with review wait after lead time', () => {
    const k = doraKpis(base, fmt);
    expect(k.map((x) => x.label)).toEqual([
      'Deployment frequency',
      'Lead time for changes',
      'Review wait',
      'Change failure rate',
      'Time to restore',
    ]);
    expect(k.map((x) => x.rating)).toEqual(['ELITE', 'HIGH', null, 'MEDIUM', null]);
    expect(k.map((x) => x.rated)).toEqual([true, true, false, true, true]);
  });

  it('formats values and hints', () => {
    const [df, lt, rw, cfr, mttr] = doraKpis(base, fmt);
    expect(df).toMatchObject({ value: '1.5/day', hint: '8 successful deploys' });
    expect(lt.value).toBe('4h');
    expect(rw).toMatchObject({ value: '5h', hint: 'Median, 42 PRs', icon: 'hourglass' });
    expect(cfr).toMatchObject({ value: '20%', hint: '2 of 10 failed' });
    expect(mttr.value).toBe('1h');
  });

  it('marks review wait without reviewed PRs, and never rates it', () => {
    const rw = doraKpis({ ...base, reviewWaitHoursMedian: null, reviewedPullRequests: 0 }, fmt)[2];
    expect(rw).toMatchObject({ value: '—', hint: 'No reviewed PRs', rating: null, rated: false });
  });

  it('shows dashes for missing data', () => {
    const k = doraKpis(
      { ...base, leadTimeHoursMedian: null, changeFailureRate: null, mttrHours: null },
      fmt,
    );
    expect(k[1].value).toBe('—');
    expect(k[3].value).toBe('—');
    expect(k[4].value).toBe('—');
  });
});

describe('reviewWaitHint', () => {
  it('names the sample size, singular or plural, with the given prefix', () => {
    expect(reviewWaitHint(3, 1)).toBe('Median, 1 PR');
    expect(reviewWaitHint(3, 7, 'median')).toBe('median, 7 PRs');
  });

  it('says there were no reviewed PRs when the median is missing', () => {
    expect(reviewWaitHint(null, 0)).toBe('No reviewed PRs');
    expect(reviewWaitHint(null, 0, 'median')).toBe('No reviewed PRs');
  });
});
