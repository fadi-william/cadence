import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { StatCard } from './stat-card';
import { TILE_GRID, tileSpan } from './tile-grid';

describe('tileSpan', () => {
  const spans = (n: number) => Array.from({ length: n }, (_, i) => tileSpan(i, n));

  it('lays five tiles out as 2+2+1 (full width), 3+2 and then one row', () => {
    expect(spans(5)).toEqual([
      'xl:col-span-2 2xl:col-span-1',
      'xl:col-span-2 2xl:col-span-1',
      'xl:col-span-2 2xl:col-span-1',
      'xl:col-span-3 2xl:col-span-1',
      'sm:col-span-2 xl:col-span-3 2xl:col-span-1',
    ]);
  });

  it('widens a lone last tile to the full xl row', () => {
    expect(spans(4)[3]).toBe('xl:col-span-6 2xl:col-span-1');
    expect(spans(4).some((c) => c.includes('sm:col-span-2'))).toBe(false);
  });

  it('keeps full rows of three at one third each', () => {
    expect(spans(3).every((c) => c.includes('xl:col-span-2 2xl:col-span-1'))).toBe(true);
    expect(spans(6).every((c) => c.startsWith('xl:col-span-2'))).toBe(true);
  });
});

@Component({
  imports: [StatCard],
  template: `<div [class]="grid">
    @for (n of [1, 2, 3, 4, 5]; track n) {
      <app-stat-card [class]="span($index, $count)" label="K" [value]="n" icon="clock" />
    }
  </div>`,
})
class Host {
  protected readonly grid = TILE_GRID;
  protected readonly span = tileSpan;
}

describe('TILE_GRID with tileSpan', () => {
  it('adds span classes without dropping the tile host classes', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect([...el.firstElementChild!.classList].sort()).toEqual(TILE_GRID.split(' ').sort());
    const last = el.querySelectorAll('app-stat-card')[4];
    expect(last.classList).toContain('surface');
    expect(last.classList).toContain('sm:col-span-2');
    expect(last.classList).toContain('xl:col-span-3');
  });
});
