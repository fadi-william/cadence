import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormField, form, required, submit } from '@angular/forms/signals';
import { ROLE_LABELS } from '@cadence/shared';
import { ApiService, errorMessage } from '../../core/api.service';
import { AuthStore } from '../../core/auth.store';
import { ThemeService } from '../../core/theme.service';
import { ToastService } from '../../core/toast.service';
import { Avatar } from '../../shared/avatar';
import { Field, isInvalid } from '../../shared/field';
import { Icon } from '../../shared/icon';
import { PageHeader } from '../../shared/page-header';
import { passwordRules, passwordStrength } from '../auth/password-schema';

/**
 * The signed-in user's account page: profile summary, theme preference and a change-password form. A
 * successful password change returns a fresh session, which replaces the current one.
 */
@Component({
  selector: 'app-account-page',
  imports: [FormField, Avatar, Field, Icon, PageHeader],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './account.page.html',
})
export class AccountPage {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthStore);
  private readonly toast = inject(ToastService);
  protected readonly theme = inject(ThemeService);
  protected readonly invalid = isInvalid;
  protected readonly user = this.auth.user;
  protected readonly role = computed(() =>
    this.auth.role() ? ROLE_LABELS[this.auth.role()!] : '',
  );

  protected readonly model = signal({ current: '', password: '', confirm: '' });
  protected readonly f = form(this.model, (p) => {
    required(p.current, { message: 'Enter your current password' });
    passwordRules(p);
  });
  protected readonly strength = passwordStrength(computed(() => this.model().password));

  async onSubmit(event: Event) {
    event.preventDefault();
    await submit(this.f, async () => {
      const v = this.model();
      try {
        this.auth.accept(
          await this.api.changePassword({ currentPassword: v.current, newPassword: v.password }),
        );
        this.model.set({ current: '', password: '', confirm: '' });
        this.f().reset();
        this.toast.success('Password updated');
      } catch (e) {
        this.toast.error(errorMessage(e));
      }
      return undefined;
    });
  }
}
