import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormField, form, submit } from '@angular/forms/signals';
import { Router, RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { Field, isInvalid } from '../../shared/field';
import { Icon } from '../../shared/icon';
import { AuthLayout } from './auth-layout';
import { passwordRules, passwordStrength } from './password-schema';

/**
 * Public page reached from a reset link: sets a new password with the link's `token`, then sends the user
 * to the login page. Without a token it shows an invalid-link message instead of the form.
 */
@Component({
  selector: 'app-reset-password-page',
  imports: [FormField, RouterLink, AuthLayout, Field, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './reset-password.page.html',
})
export class ResetPasswordPage {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  /** Query param: the single-use reset token from the link. */
  readonly token = input<string>();
  protected readonly invalid = isInvalid;
  protected readonly model = signal({ password: '', confirm: '' });
  protected readonly f = form(this.model, (p) => passwordRules(p));
  protected readonly strength = passwordStrength(computed(() => this.model().password));
  protected readonly error = signal<string | null>(null);

  async onSubmit(event: Event) {
    event.preventDefault();
    this.error.set(null);
    await submit(this.f, async () => {
      try {
        await this.api.resetPassword(this.token()!, this.model().password);
        this.toast.success('Password updated. Please sign in.');
        await this.router.navigateByUrl('/login');
      } catch (e) {
        this.error.set(errorMessage(e));
      }
      return undefined;
    });
  }
}
