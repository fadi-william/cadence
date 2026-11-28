import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormField, email, form, required, submit } from '@angular/forms/signals';
import { RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../../core/api.service';
import { Field, isInvalid } from '../../shared/field';
import { Icon } from '../../shared/icon';
import { AuthLayout } from './auth-layout';

/**
 * Public "forgot password" page: asks for an e-mail and requests a reset link. Once sent it shows a
 * confirmation regardless of whether the address exists (the API does not reveal it).
 */
@Component({
  selector: 'app-forgot-password-page',
  imports: [FormField, RouterLink, AuthLayout, Field, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './forgot-password.page.html',
})
export class ForgotPasswordPage {
  private readonly api = inject(ApiService);
  protected readonly invalid = isInvalid;
  protected readonly model = signal({ email: '' });
  protected readonly f = form(this.model, (p) => {
    required(p.email, { message: 'Enter your e-mail' });
    email(p.email, { message: 'Enter a valid e-mail' });
  });
  /** True once the request succeeded; swaps the form for the confirmation. */
  protected readonly sent = signal(false);
  protected readonly error = signal<string | null>(null);

  async onSubmit(event: Event) {
    event.preventDefault();
    await submit(this.f, async () => {
      try {
        await this.api.forgotPassword(this.model().email);
        this.sent.set(true);
      } catch (e) {
        this.error.set(errorMessage(e));
      }
      return undefined;
    });
  }
}
