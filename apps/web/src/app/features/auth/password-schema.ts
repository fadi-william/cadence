import { computed, Signal } from '@angular/core';
import { SchemaPath, minLength, required, validate } from '@angular/forms/signals';

/** Model shape of a "new password + confirmation" form. */
export interface PasswordPair {
  password: string;
  confirm: string;
}

/**
 * Shared rules for "new password + confirmation" forms: password required and at least 12 characters;
 * confirmation required and must match (`mismatch` error).
 */
export function passwordRules(p: { password: SchemaPath<string>; confirm: SchemaPath<string> }) {
  required(p.password, { message: 'Choose a password' });
  minLength(p.password, 12, { message: 'Use at least 12 characters' });
  required(p.confirm, { message: 'Repeat the password' });
  validate(p.confirm, ({ value, valueOf }) =>
    value() && value() !== valueOf(p.password)
      ? { kind: 'mismatch', message: 'Passwords don’t match' }
      : null,
  );
}

/**
 * 0–4 strength score with a label and daisyUI progress colour. One point each for 12+ characters, 16+
 * characters, mixed case, and digits plus symbols; under 12 characters it reads "Too short" and the score
 * is capped at 1.
 */
export function passwordStrength(password: Signal<string>) {
  return computed(() => {
    const p = password();
    let score = 0;
    if (p.length >= 12) score++;
    if (p.length >= 16) score++;
    if (/[A-Z]/.test(p) && /[a-z]/.test(p)) score++;
    if (/\d/.test(p) && /[^A-Za-z0-9]/.test(p)) score++;
    const levels = [
      { label: 'Too short', cls: 'progress-error' },
      { label: 'Weak', cls: 'progress-error' },
      { label: 'Fair', cls: 'progress-warning' },
      { label: 'Good', cls: 'progress-info' },
      { label: 'Strong', cls: 'progress-success' },
    ];
    return {
      score: p.length < 12 ? Math.min(score, 1) : score,
      ...levels[p.length < 12 ? 0 : score],
    };
  });
}
