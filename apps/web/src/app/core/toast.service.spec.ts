import { TestBed } from '@angular/core/testing';
import { ToastService } from './toast.service';

describe('ToastService', () => {
  let svc: ToastService;
  beforeEach(() => {
    vi.useFakeTimers();
    svc = TestBed.inject(ToastService);
  });
  afterEach(() => vi.useRealTimers());

  it('shows info toasts by default with increasing ids', () => {
    svc.show('a');
    svc.show('b');
    expect(svc.toasts()).toEqual([
      { id: 1, kind: 'info', text: 'a' },
      { id: 2, kind: 'info', text: 'b' },
    ]);
  });

  it('auto-dismisses after the given duration', () => {
    svc.show('x', 'info', 1000);
    vi.advanceTimersByTime(999);
    expect(svc.toasts()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(svc.toasts()).toHaveLength(0);
  });

  it('success lasts 4 s, error lasts 6 s', () => {
    svc.success('ok');
    svc.error('bad');
    expect(svc.toasts().map((t) => t.kind)).toEqual(['success', 'error']);
    vi.advanceTimersByTime(4000);
    expect(svc.toasts().map((t) => t.text)).toEqual(['bad']);
    vi.advanceTimersByTime(2000);
    expect(svc.toasts()).toEqual([]);
  });

  it('dismiss removes only the matching toast', () => {
    svc.show('a');
    svc.show('b');
    svc.dismiss(1);
    expect(svc.toasts().map((t) => t.text)).toEqual(['b']);
    svc.dismiss(42);
    expect(svc.toasts()).toHaveLength(1);
  });
});
