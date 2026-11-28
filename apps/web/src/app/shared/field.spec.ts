import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Field, FieldLike, isInvalid } from './field';

const fakeField = (touched: boolean, errors: { message?: string }[]) => {
  const t = signal(touched);
  const e = signal(errors);
  const f: FieldLike = () => ({ touched: t, invalid: () => e().length > 0, errors: e });
  return { f, t, e };
};

describe('Field', () => {
  const render = async (inputs: Record<string, unknown>) => {
    const fixture = TestBed.createComponent(Field);
    fixture.componentRef.setInput('label', 'E-mail');
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  };

  it('renders the label, optional marker and hint', async () => {
    const { el } = await render({ hint: 'We never share it', optional: true });
    expect(el.querySelector('legend')!.textContent).toContain('E-mail');
    expect(el.querySelector('legend')!.textContent).toContain('optional');
    expect(el.querySelector('p')!.textContent!.trim()).toBe('We never share it');
    expect(el.querySelector('[role="alert"]')).toBeNull();
  });

  it('hides errors until the field is touched', async () => {
    const { f, t } = fakeField(false, [{ message: 'Required' }]);
    const { el, fixture } = await render({ field: f, hint: 'hint' });
    expect(el.querySelector('[role="alert"]')).toBeNull();
    t.set(true);
    await fixture.whenStable();
    expect(el.querySelector('[role="alert"]')!.textContent!.trim()).toBe('Required');
    expect(el.textContent).not.toContain('hint');
  });

  it('shows only the first error, with a generic fallback', async () => {
    const { el } = await render({ field: fakeField(true, [{ message: 'A' }, { message: 'B' }]).f });
    expect(el.querySelector('[role="alert"]')!.textContent!.trim()).toBe('A');
    const { el: el2 } = await render({ field: fakeField(true, [{}]).f });
    expect(el2.querySelector('[role="alert"]')!.textContent!.trim()).toBe('Invalid value');
  });
});

describe('isInvalid', () => {
  it('is true only for touched, invalid fields', () => {
    expect(isInvalid(fakeField(true, [{ message: 'x' }]).f)).toBe(true);
    expect(isInvalid(fakeField(false, [{ message: 'x' }]).f)).toBe(false);
    expect(isInvalid(fakeField(true, []).f)).toBe(false);
  });
});
