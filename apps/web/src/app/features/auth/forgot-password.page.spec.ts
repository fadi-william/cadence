import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { ForgotPasswordPage } from './forgot-password.page';

describe('ForgotPasswordPage', () => {
  let api: { forgotPassword: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    api = { forgotPassword: vi.fn().mockResolvedValue({ ok: true }) };
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: ApiService, useValue: api }],
    });
  });

  const render = async () => {
    const fixture = TestBed.createComponent(ForgotPasswordPage);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    return {
      el,
      type: (value: string) => {
        const input = el.querySelector('input[type="email"]') as HTMLInputElement;
        input.value = value;
        input.dispatchEvent(new Event('input'));
      },
      submit: async () => {
        el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
        await fixture.whenStable();
      },
      alerts: () => [...el.querySelectorAll('[role="alert"]')].map((a) => a.textContent!.trim()),
    };
  };

  it('requires a valid e-mail', async () => {
    const { type, submit, alerts } = await render();
    type('nope');
    await submit();
    expect(api.forgotPassword).not.toHaveBeenCalled();
    expect(alerts()).toEqual(['Enter a valid e-mail']);
  });

  it('sends the reset link and shows a neutral confirmation', async () => {
    const { el, type, submit, alerts } = await render();
    type('hoda@cadence.local');
    await submit();
    expect(api.forgotPassword).toHaveBeenCalledWith('hoda@cadence.local');
    expect(alerts()[0]).toContain('If an account exists for hoda@cadence.local');
    expect(el.querySelector('form')).toBeNull();
  });

  it('shows the API error', async () => {
    api.forgotPassword.mockRejectedValue({ error: { message: 'Too many requests' } });
    const { el, type, submit, alerts } = await render();
    type('hoda@cadence.local');
    await submit();
    expect(alerts()).toEqual(['Too many requests']);
    expect(el.querySelector('form')).not.toBeNull();
  });
});
