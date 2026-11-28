import { TestBed } from '@angular/core/testing';
import { ToastService } from '../core/toast.service';
import { Toasts } from './toasts';

describe('Toasts', () => {
  it('renders toasts by kind and dismisses on click', async () => {
    const svc = TestBed.inject(ToastService);
    const fixture = TestBed.createComponent(Toasts);
    svc.success('Saved');
    svc.error('Failed');
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const alerts = () => [...el.querySelectorAll('[role="alert"]')] as HTMLElement[];
    expect(alerts().map((a) => a.textContent)).toEqual([
      expect.stringContaining('Saved'),
      expect.stringContaining('Failed'),
    ]);
    expect(alerts()[0].classList).toContain('alert-success');
    expect(alerts()[1].classList).toContain('alert-error');

    (alerts()[0].querySelector('button') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(alerts()).toHaveLength(1);
    expect(svc.toasts().map((t) => t.text)).toEqual(['Failed']);
  });
});
