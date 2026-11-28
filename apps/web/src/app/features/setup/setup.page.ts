import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  FormField,
  applyWhen,
  email,
  form,
  minLength,
  required,
  submit,
} from '@angular/forms/signals';
import { Router } from '@angular/router';
import { ApiService, errorMessage } from '../../core/api.service';
import { AuthStore } from '../../core/auth.store';
import { markSetupDone } from '../../core/guards';
import { ToastService } from '../../core/toast.service';
import { Field, isInvalid } from '../../shared/field';
import { Icon } from '../../shared/icon';
import { AuthLayout } from '../auth/auth-layout';
import { passwordRules, passwordStrength } from '../auth/password-schema';

/**
 * First-launch onboarding: the default admin profile sets its name and password.
 *
 * @remarks
 * The e-mail is prefilled from the setup status. When the API requires a setup token (printed in the API
 * log) an extra required field is shown. On success the admin is signed in, {@link setupGuard} is told
 * setup is done, and the app opens the organization page.
 */
@Component({
  selector: 'app-setup-page',
  imports: [FormField, AuthLayout, Field, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './setup.page.html',
})
export class SetupPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  protected readonly invalid = isInvalid;

  /** Whether the API demands the setup token; switches its field and validation on. */
  protected readonly tokenRequired = signal(false);
  protected readonly model = signal({
    name: 'Administrator',
    email: '',
    password: '',
    confirm: '',
    setupToken: '',
  });
  protected readonly f = form(this.model, (p) => {
    required(p.name, { message: 'Tell us your name' });
    minLength(p.name, 2, { message: 'At least 2 characters' });
    required(p.email, { message: 'E-mail is required' });
    email(p.email, { message: 'Enter a valid e-mail' });
    passwordRules(p);
    applyWhen(
      p,
      () => this.tokenRequired(),
      (q) => required(q.setupToken, { message: 'Paste the setup token from the API log' }),
    );
  });
  protected readonly strength = passwordStrength(computed(() => this.model().password));
  protected readonly error = signal<string | null>(null);

  async ngOnInit() {
    const status = await this.api.setupStatus();
    this.model.update((m) => ({ ...m, email: status.adminEmail ?? '' }));
    this.tokenRequired.set(status.tokenRequired);
  }

  async onSubmit(event: Event) {
    event.preventDefault();
    this.error.set(null);
    await submit(this.f, async () => {
      const m = this.model();
      try {
        const res = await this.api.completeSetup({
          name: m.name,
          email: m.email,
          password: m.password,
          setupToken: this.tokenRequired() ? m.setupToken.trim() : undefined,
        });
        this.auth.accept(res);
        markSetupDone();
        this.toast.success('Setup complete. Welcome aboard!');
        await this.router.navigateByUrl('/organization');
      } catch (e) {
        this.error.set(errorMessage(e));
      }
      return undefined;
    });
  }
}
