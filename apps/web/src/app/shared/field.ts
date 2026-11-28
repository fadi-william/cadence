import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** The bits of a Signal Forms field this component reads (any `FieldTree<T>` satisfies it). */
export type FieldLike = () => {
  touched(): boolean;
  invalid(): boolean;
  errors(): readonly { message?: string }[];
};

/**
 * daisyUI 5 form field: `<fieldset class="fieldset">` with legend, the projected control and a hint
 * or the first validation error of a Signal Forms field (shown once touched).
 *
 * @remarks
 * Inputs: `label` (the legend), optional `hint`, `optional` to mark the field as optional, and `field`, the
 * Signal Forms field whose errors are shown. Without `field` only the hint is displayed.
 *
 * @example
 * ```html
 * <app-field label="E-mail" [field]="f.email">
 *   <input class="input w-full" [formField]="f.email" />
 * </app-field>
 * ```
 */
@Component({
  selector: 'app-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  templateUrl: './field.html',
})
export class Field {
  readonly label = input.required<string>();
  readonly hint = input<string>();
  readonly optional = input(false);
  readonly field = input<FieldLike>();

  protected readonly error = computed(() => {
    const f = this.field();
    if (!f) return null;
    const state = f();
    if (!state.touched() || !state.invalid()) return null;
    return state.errors()[0]?.message ?? 'Invalid value';
  });
}

/** Adds daisyUI's error colour to an input bound to a touched, invalid field. */
export const isInvalid = (f: FieldLike) => f().touched() && f().invalid();
