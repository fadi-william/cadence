import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AuthStore } from '../../core/auth.store';
import { LoginPage } from './login.page';

describe('LoginPage', () => {
  let auth: { login: ReturnType<typeof vi.fn> };
  let navigate: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    auth = { login: vi.fn().mockResolvedValue(undefined) };
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: AuthStore, useValue: auth }],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  });

  const render = async (inputs: Record<string, string> = {}) => {
    const fixture = TestBed.createComponent(LoginPage);
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const type = (selector: string, value: string) => {
      const input = el.querySelector(selector) as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    const submit = async () => {
      el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
      await fixture.whenStable();
    };
    const alerts = () =>
      [...el.querySelectorAll('[role="alert"]')].map((a) => a.textContent!.trim());
    return { fixture, el, type, submit, alerts };
  };

  it('shows validation errors and does not call the API for an empty form', async () => {
    const { submit, alerts } = await render();
    await submit();
    expect(auth.login).not.toHaveBeenCalled();
    expect(alerts()).toEqual(['Enter your e-mail', 'Enter your password']);
  });

  it('rejects malformed e-mail addresses', async () => {
    const { type, submit, alerts } = await render();
    type('input[type="email"]', 'not-an-email');
    type('input[type="password"]', 'pw');
    await submit();
    expect(auth.login).not.toHaveBeenCalled();
    expect(alerts()).toEqual(['Enter a valid e-mail']);
  });

  it('signs in and goes to the dashboard', async () => {
    const { type, submit } = await render();
    type('input[type="email"]', 'hoda@cadence.local');
    type('input[type="password"]', 'hunter2');
    await submit();
    expect(auth.login).toHaveBeenCalledWith('hoda@cadence.local', 'hunter2');
    expect(navigate).toHaveBeenCalledWith('/dashboard');
  });

  it('returns to the ?next url after signing in', async () => {
    const { type, submit } = await render({ next: '/members/7' });
    type('input[type="email"]', 'hoda@cadence.local');
    type('input[type="password"]', 'hunter2');
    await submit();
    expect(navigate).toHaveBeenCalledWith('/members/7');
  });

  it('shows the API error message on failure', async () => {
    auth.login.mockRejectedValue({ error: { message: 'Invalid credentials' } });
    const { type, submit, alerts } = await render({ expired: '1' });
    expect(alerts()).toEqual(['Your session expired. Please sign in again.']);
    type('input[type="email"]', 'hoda@cadence.local');
    type('input[type="password"]', 'wrong');
    await submit();
    expect(navigate).not.toHaveBeenCalled();
    // the error replaces the "session expired" notice
    expect(alerts()).toEqual(['Invalid credentials']);
  });
});
