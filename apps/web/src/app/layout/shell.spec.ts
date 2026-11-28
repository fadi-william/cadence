import { Component, computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import type { AuthUserDto, UserRole } from '@cadence/shared';
import { AuthStore } from '../core/auth.store';
import { Shell } from './shell';

@Component({ template: '' })
class Blank {}

describe('Shell', () => {
  let user: ReturnType<typeof signal<AuthUserDto | null>>;
  let logout: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    user = signal<AuthUserDto | null>(null);
    logout = vi.fn();
    const role = computed(() => user()?.role ?? null);
    TestBed.configureTestingModule({
      providers: [
        provideRouter(
          ['dashboard', 'delivery', 'members/:id', 'members', 'audit', 'account'].map((path) => ({
            path,
            component: Blank,
          })),
        ),
        {
          provide: AuthStore,
          useValue: { user, role, isAdmin: computed(() => role() === 'ADMIN'), logout },
        },
      ],
    });
  });

  const signIn = (role: UserRole) =>
    user.set({ id: 'u1', name: 'Hoda Fathy', email: 'hoda@cadence.local', role } as AuthUserDto);

  const render = async (url = '/dashboard') => {
    await TestBed.inject(Router).navigateByUrl(url);
    const fixture = TestBed.createComponent(Shell);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const breadcrumb = () =>
      [...el.querySelectorAll('header .lg\\:flex span')].map((s) => s.textContent!.trim());
    return { fixture, el, breadcrumb };
  };

  it('hides the administration section from non-admins', async () => {
    signIn('ENGINEERING_MANAGER');
    const { el } = await render();
    const aside = el.querySelector('aside')!.textContent!;
    expect(aside).toContain('Insights');
    expect(aside).toContain('Organization');
    expect(aside).not.toContain('Administration');
    expect(aside).not.toContain('Audit log');
  });

  it('shows the administration section to admins', async () => {
    signIn('ADMIN');
    const { el } = await render();
    const aside = el.querySelector('aside')!.textContent!;
    expect(aside).toContain('Administration');
    expect(aside).toContain('Integrations');
    expect(aside).toContain('Audit log');
  });

  it('shows the breadcrumb for the current page and follows navigation', async () => {
    signIn('ADMIN');
    const { fixture, breadcrumb } = await render('/members/42');
    expect(breadcrumb()).toEqual(['Organization', 'People']);
    await TestBed.inject(Router).navigateByUrl('/audit');
    await fixture.whenStable();
    expect(breadcrumb()).toEqual(['Administration', 'Audit log']);
    await TestBed.inject(Router).navigateByUrl('/account');
    await fixture.whenStable();
    expect(breadcrumb()).toEqual(['You', 'Account']);
  });

  it('shows the user and their role label', async () => {
    signIn('TRIBE_LEAD');
    const { el } = await render();
    expect(el.textContent).toContain('Hoda Fathy');
    expect(el.textContent).toContain('hoda@cadence.local');
    expect(el.querySelector('aside')!.textContent).toMatch(/tribe lead/i);
  });

  it('signs out from the account menu', async () => {
    signIn('ADMIN');
    const { el } = await render();
    const btn = [...el.querySelectorAll('button')].find((b) =>
      b.textContent!.includes('Sign out'),
    )!;
    btn.click();
    expect(logout).toHaveBeenCalled();
  });

  it('hides the bottom bar when scrolling down past 120px and shows it on scroll up', async () => {
    signIn('ADMIN');
    const { fixture, el } = await render();
    const nav = () => el.querySelector('nav.m3-navbar')!;
    const scrollTo = async (y: number) => {
      Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
      window.dispatchEvent(new Event('scroll'));
      await fixture.whenStable();
    };
    await scrollTo(100);
    expect(nav().classList).not.toContain('m3-hidden');
    await scrollTo(300);
    expect(nav().classList).toContain('m3-hidden');
    await scrollTo(304); // jitter below 8px is ignored
    expect(nav().classList).toContain('m3-hidden');
    await scrollTo(200);
    expect(nav().classList).not.toContain('m3-hidden');
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
  });
});
