import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import type { AuthResponseDto, SetupStatusDto } from '@cadence/shared';
import { ApiService } from '../../core/api.service';
import { AuthStore } from '../../core/auth.store';
import { ToastService } from '../../core/toast.service';
import { SetupPage } from './setup.page';

describe('SetupPage', () => {
  let api: { setupStatus: ReturnType<typeof vi.fn>; completeSetup: ReturnType<typeof vi.fn> };
  let auth: { accept: ReturnType<typeof vi.fn> };
  let navigate: ReturnType<typeof vi.spyOn>;
  const response = { accessToken: 't', expiresIn: 900, user: {} } as AuthResponseDto;

  const status = (over: Partial<SetupStatusDto> = {}) =>
    ({
      needsSetup: true,
      adminEmail: 'admin@cadence.local',
      tokenRequired: false,
      ...over,
    }) as SetupStatusDto;

  beforeEach(() => {
    api = {
      setupStatus: vi.fn().mockResolvedValue(status()),
      completeSetup: vi.fn().mockResolvedValue(response),
    };
    auth = { accept: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: api },
        { provide: AuthStore, useValue: auth },
      ],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  });

  const render = async () => {
    const fixture = TestBed.createComponent(SetupPage);
    await fixture.whenStable();
    await new Promise((r) => setTimeout(r)); // let ngOnInit's request settle
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const input = (placeholder: string) =>
      el.querySelector(`input[placeholder="${placeholder}"]`) as HTMLInputElement | null;
    const type = (placeholder: string, value: string) => {
      const i = input(placeholder)!;
      i.value = value;
      i.dispatchEvent(new Event('input'));
    };
    return {
      fixture,
      el,
      input,
      type,
      fillPasswords: (pw: string) => {
        type('Create a password', pw);
        type('Repeat the password', pw);
      },
      submit: async () => {
        el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
        await fixture.whenStable();
      },
      alerts: () => [...el.querySelectorAll('[role="alert"]')].map((a) => a.textContent!.trim()),
    };
  };

  it('prefills the default admin profile', async () => {
    const { input } = await render();
    expect(input('Your name')!.value).toBe('Administrator');
    expect(input('admin@cadence.local')!.value).toBe('admin@cadence.local');
    expect(input('One-time setup token')).toBeNull();
  });

  it('validates every field', async () => {
    api.setupStatus.mockResolvedValue(status({ adminEmail: null }));
    const { type, submit, alerts } = await render();
    type('Your name', 'A');
    await submit();
    expect(api.completeSetup).not.toHaveBeenCalled();
    expect(alerts()).toEqual([
      'At least 2 characters',
      'E-mail is required',
      'Choose a password',
      'Repeat the password',
    ]);
  });

  it('completes setup, signs in and continues to the org page', async () => {
    const toast = vi.spyOn(TestBed.inject(ToastService), 'success');
    const { type, fillPasswords, submit } = await render();
    type('Your name', 'Hoda Fathy');
    fillPasswords('a-long-password');
    await submit();
    expect(api.completeSetup).toHaveBeenCalledWith({
      name: 'Hoda Fathy',
      email: 'admin@cadence.local',
      password: 'a-long-password',
      setupToken: undefined,
    });
    expect(auth.accept).toHaveBeenCalledWith(response);
    expect(toast).toHaveBeenCalledWith('Setup complete. Welcome aboard!');
    expect(navigate).toHaveBeenCalledWith('/organization');
  });

  it('requires and trims the setup token when the API asks for one', async () => {
    api.setupStatus.mockResolvedValue(status({ tokenRequired: true }));
    const { type, fillPasswords, submit, alerts } = await render();
    fillPasswords('a-long-password');
    await submit();
    expect(api.completeSetup).not.toHaveBeenCalled();
    expect(alerts()).toEqual(['Paste the setup token from the API log']);

    type('One-time setup token', '  abc123 \n');
    await submit();
    expect(api.completeSetup).toHaveBeenCalledWith(
      expect.objectContaining({ setupToken: 'abc123' }),
    );
  });

  it('shows the API error and stays on the page', async () => {
    api.completeSetup.mockRejectedValue({ error: { message: ['setupToken invalid'] } });
    const { fillPasswords, submit, alerts } = await render();
    fillPasswords('a-long-password');
    await submit();
    expect(auth.accept).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(alerts()).toEqual(['setupToken invalid']);
  });
});
