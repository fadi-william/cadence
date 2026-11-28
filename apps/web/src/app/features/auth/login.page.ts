import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { FormField, email, form, required, submit } from '@angular/forms/signals';
import { Router, RouterLink } from '@angular/router';
import { errorMessage } from '../../core/api.service';
import { AuthStore } from '../../core/auth.store';
import { Field, isInvalid } from '../../shared/field';
import { Icon } from '../../shared/icon';
import { AuthLayout } from './auth-layout';

/**
 * Sign-in page. After a successful login it navigates to the `next` query param (set by the guards and on
 * session expiry) or the dashboard.
 */
@Component({
  selector: 'app-login-page',
  imports: [FormField, RouterLink, AuthLayout, Field, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './login.page.html',
})
export class LoginPage {
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  /** Query param: URL to return to after signing in. */
  readonly next = input<string>();
  /** Query param: present when redirected after the session expired; shows a notice. */
  readonly expired = input<string>();
  protected readonly invalid = isInvalid;

  protected readonly model = signal({ email: '', password: '' });
  protected readonly f = form(this.model, (p) => {
    required(p.email, { message: 'Enter your e-mail' });
    email(p.email, { message: 'Enter a valid e-mail' });
    required(p.password, { message: 'Enter your password' });
  });
  protected readonly error = signal<string | null>(null);

  async onSubmit(event: Event) {
    event.preventDefault();
    this.error.set(null);
    await submit(this.f, async () => {
      try {
        await this.auth.login(this.model().email, this.model().password);
        await this.router.navigateByUrl(this.next() || '/dashboard');
      } catch (e) {
        this.error.set(errorMessage(e));
      }
      return undefined;
    });
  }
}
