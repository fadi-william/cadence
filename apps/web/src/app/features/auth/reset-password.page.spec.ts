import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { ResetPasswordPage } from './reset-password.page';

describe('ResetPasswordPage', () => {
  let api: { resetPassword: ReturnType<typeof vi.fn> };
  let navigate: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    api = { resetPassword: vi.fn().mockResolvedValue(undefined) };
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: ApiService, useValue: api }],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  });

  const render = async (token?: string) => {
    const fixture = TestBed.createComponent(ResetPasswordPage);
    if (token) fixture.componentRef.setInput('token', token);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const inputs = () => [...el.querySelectorAll('input[type="password"]')] as HTMLInputElement[];
    return {
      fixture,
      el,
      fill: (password: string, confirm: string) => {
        const [p, c] = inputs();
        p.value = password;
        p.dispatchEvent(new Event('input'));
        c.value = confirm;
        c.dispatchEvent(new Event('input'));
      },
      submit: async () => {
        el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
        await fixture.whenStable();
      },
      alerts: () => [...el.querySelectorAll('[role="alert"]')].map((a) => a.textContent!.trim()),
      progress: () => el.querySelector('progress') as HTMLProgressElement,
    };
  };

  it('explains a missing token instead of showing the form', async () => {
    const { el, alerts } = await render();
    expect(el.querySelector('form')).toBeNull();
    expect(alerts()[0]).toContain('missing its token');
  });

  it('validates the new password before calling the API', async () => {
    const { fill, submit, alerts } = await render('tok');
    fill('short', 'other');
    await submit();
    expect(api.resetPassword).not.toHaveBeenCalled();
    expect(alerts()).toEqual(['Use at least 12 characters', 'Passwords don’t match']);
  });

  it('updates the strength meter while typing', async () => {
    const { fixture, fill, progress } = await render('tok');
    expect(progress().value).toBe(0);
    expect(progress().classList).toContain('progress-error');
    fill('Aaaaaaaaaaaaaa1!', '');
    await fixture.whenStable();
    expect(progress().value).toBe(4);
    expect(progress().classList).toContain('progress-success');
  });

  it('resets the password, toasts and goes to /login', async () => {
    const toast = vi.spyOn(TestBed.inject(ToastService), 'success');
    const { fill, submit } = await render('tok');
    fill('a-long-password', 'a-long-password');
    await submit();
    expect(api.resetPassword).toHaveBeenCalledWith('tok', 'a-long-password');
    expect(toast).toHaveBeenCalledWith('Password updated. Please sign in.');
    expect(navigate).toHaveBeenCalledWith('/login');
  });

  it('shows the API error (e.g. expired token)', async () => {
    api.resetPassword.mockRejectedValue({ error: { message: 'Link expired' } });
    const { fill, submit, alerts } = await render('tok');
    fill('a-long-password', 'a-long-password');
    await submit();
    expect(navigate).not.toHaveBeenCalled();
    expect(alerts()).toEqual(['Link expired']);
  });
});
