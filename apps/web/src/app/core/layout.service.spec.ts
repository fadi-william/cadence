import { TestBed } from '@angular/core/testing';
import { LayoutService } from './layout.service';

const KEY = 'cadence-nav-collapsed';

describe('LayoutService', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('defaults to expanded', () => {
    const svc = TestBed.inject(LayoutService);
    expect(svc.collapsed()).toBe(false);
    expect(svc.mobileOpen()).toBe(false);
  });

  it('restores the collapsed state from storage', () => {
    localStorage.setItem(KEY, '1');
    expect(TestBed.inject(LayoutService).collapsed()).toBe(true);
  });

  it('toggleCollapsed flips and persists the state', () => {
    const svc = TestBed.inject(LayoutService);
    svc.toggleCollapsed();
    expect(svc.collapsed()).toBe(true);
    expect(localStorage.getItem(KEY)).toBe('1');
    svc.toggleCollapsed();
    expect(svc.collapsed()).toBe(false);
    expect(localStorage.getItem(KEY)).toBe('0');
  });

  it('survives unavailable storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const svc = TestBed.inject(LayoutService);
    expect(svc.collapsed()).toBe(false);
    expect(() => svc.toggleCollapsed()).not.toThrow();
    expect(svc.collapsed()).toBe(true);
  });
});
