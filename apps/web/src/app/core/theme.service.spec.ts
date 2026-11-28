import { TestBed } from '@angular/core/testing';
import { ThemeService } from './theme.service';

describe('ThemeService', () => {
  const root = document.documentElement;
  beforeEach(() => {
    localStorage.clear();
    delete root.dataset['theme'];
    root.removeAttribute('data-theme-switching');
  });
  afterEach(() => vi.restoreAllMocks());

  it('defaults to the light theme', () => {
    const svc = TestBed.inject(ThemeService);
    expect(svc.theme()).toBe('cadence');
    expect(svc.isDark()).toBe(false);
  });

  it('picks up the theme already applied to <html>', () => {
    root.dataset['theme'] = 'cadence-dark';
    const svc = TestBed.inject(ThemeService);
    expect(svc.theme()).toBe('cadence-dark');
    expect(svc.isDark()).toBe(true);
  });

  it('toggle switches theme, updates <html> and persists it', () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      frames.push(cb);
      return frames.length;
    });
    const svc = TestBed.inject(ThemeService);

    svc.toggle();
    expect(svc.theme()).toBe('cadence-dark');
    expect(svc.isDark()).toBe(true);
    expect(root.dataset['theme']).toBe('cadence-dark');
    expect(localStorage.getItem('cadence-theme')).toBe('cadence-dark');
    // transitions are suspended until two animation frames have passed
    expect(root.hasAttribute('data-theme-switching')).toBe(true);
    frames.shift()!(0);
    expect(root.hasAttribute('data-theme-switching')).toBe(true);
    frames.shift()!(0);
    expect(root.hasAttribute('data-theme-switching')).toBe(false);

    svc.toggle();
    expect(svc.theme()).toBe('cadence');
    expect(root.dataset['theme']).toBe('cadence');
    expect(localStorage.getItem('cadence-theme')).toBe('cadence');
  });

  it('set() tolerates unavailable storage', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const svc = TestBed.inject(ThemeService);
    expect(() => svc.set('cadence-dark')).not.toThrow();
    expect(svc.theme()).toBe('cadence-dark');
  });
});
