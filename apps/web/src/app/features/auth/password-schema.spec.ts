import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { form } from '@angular/forms/signals';
import { passwordRules, passwordStrength } from './password-schema';

describe('passwordStrength', () => {
  const strength = (p: string) => passwordStrength(signal(p))();

  it('rates anything under 12 characters as too short', () => {
    expect(strength('')).toMatchObject({ score: 0, label: 'Too short', cls: 'progress-error' });
    // mixed case + digit + symbol still caps at 1 below the minimum length
    expect(strength('Ab1!Ab1!')).toMatchObject({ score: 1, label: 'Too short' });
  });

  it('scores length and character variety', () => {
    expect(strength('aaaaaaaaaaaa')).toMatchObject({ score: 1, label: 'Weak' });
    expect(strength('aaaaaaaaaaaaaaaa')).toMatchObject({ score: 2, label: 'Fair' });
    expect(strength('Aaaaaaaaaaaa')).toMatchObject({ score: 2, label: 'Fair' });
    expect(strength('Aaaaaaaaaaa1!')).toMatchObject({
      score: 3,
      label: 'Good',
      cls: 'progress-info',
    });
    expect(strength('Aaaaaaaaaaaaaa1!')).toMatchObject({
      score: 4,
      label: 'Strong',
      cls: 'progress-success',
    });
  });

  it('needs both a digit and a symbol for the variety point', () => {
    expect(strength('aaaaaaaaaaa1').score).toBe(1);
    expect(strength('aaaaaaaaaaa!').score).toBe(1);
    expect(strength('aaaaaaaaaa1!').score).toBe(2);
  });

  it('recomputes when the password changes', () => {
    const pw = signal('');
    const s = passwordStrength(pw);
    expect(s().label).toBe('Too short');
    pw.set('Aaaaaaaaaaaaaa1!');
    expect(s().label).toBe('Strong');
  });
});

describe('passwordRules', () => {
  const make = (password = '', confirm = '') =>
    TestBed.runInInjectionContext(() => {
      const model = signal({ password, confirm });
      return { model, f: form(model, (p) => passwordRules(p)) };
    });
  const messages = (errors: readonly { message?: string }[]) => errors.map((e) => e.message);

  it('requires both fields', () => {
    const { f } = make();
    expect(messages(f.password().errors())).toContain('Choose a password');
    expect(messages(f.confirm().errors())).toEqual(['Repeat the password']);
    expect(f().valid()).toBe(false);
  });

  it('enforces the 12 character minimum', () => {
    const { f } = make('short', 'short');
    expect(messages(f.password().errors())).toEqual(['Use at least 12 characters']);
  });

  it('flags a mismatched confirmation', () => {
    const { f } = make('a-long-password', 'a-long-passwore');
    expect(f.confirm().errors()).toEqual([
      expect.objectContaining({ kind: 'mismatch', message: 'Passwords don’t match' }),
    ]);
  });

  it('is valid when both match and are long enough, and reacts to edits', () => {
    const { f, model } = make('a-long-password', 'a-long-password');
    expect(f().valid()).toBe(true);
    model.set({ password: 'a-long-password!', confirm: 'a-long-password' });
    expect(f.confirm().invalid()).toBe(true);
  });
});
