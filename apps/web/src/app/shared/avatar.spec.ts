import { TestBed } from '@angular/core/testing';
import { Avatar } from './avatar';

describe('Avatar', () => {
  const render = async (name: string, size?: number) => {
    const fixture = TestBed.createComponent(Avatar);
    fixture.componentRef.setInput('name', name);
    if (size !== undefined) fixture.componentRef.setInput('size', size);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    return {
      fixture,
      initials: el.querySelector('span')!.textContent!.trim(),
      circle: el.querySelector('.rounded-full') as HTMLElement,
      title: el.querySelector('.avatar')!.getAttribute('title'),
    };
  };

  it('uses the first letters of the first two words', async () => {
    expect((await render('Hoda Fathy')).initials).toBe('HF');
    expect((await render('abdel-rahman said')).initials).toBe('AR');
    expect((await render('Mohamed Ali Salah')).initials).toBe('MA');
    expect((await render('menna')).initials).toBe('M');
  });

  it('strips the domain of e-mail addresses', async () => {
    expect((await render('yasmin@cadence.local')).initials).toBe('Y');
    expect((await render('yasmin_fouad@cadence.local')).initials).toBe('YF');
    expect((await render('yasmin.fouad@cadence.local')).initials).toBe('YF');
  });

  it('keeps words after a dot in names', async () => {
    expect((await render('M. A. Zaki')).initials).toBe('MA');
    expect((await render('Dr. Magdi Yacoub')).initials).toBe('DM');
  });

  it('falls back to "?"', async () => {
    expect((await render('')).initials).toBe('?');
    expect((await render('  ')).initials).toBe('?');
  });

  it('shows the full name as a tooltip and applies the size', async () => {
    const { circle, title } = await render('Hoda Fathy', 48);
    expect(title).toBe('Hoda Fathy');
    expect(circle.style.width).toBe('48px');
    expect(circle.style.height).toBe('48px');
  });

  it('picks a deterministic gradient per name', async () => {
    const a1 = (await render('Hoda Fathy')).circle.style.background;
    const a2 = (await render('Hoda Fathy')).circle.style.background;
    expect(a1).toContain('linear-gradient');
    expect(a1).toBe(a2);
    const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    const all = new Set<string>();
    for (const n of names) all.add((await render(n)).circle.style.background);
    expect(all.size).toBeGreaterThan(1);
  });
});
