import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  resource,
  signal,
  viewChild,
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
import { RouterLink } from '@angular/router';
import type { OrgTreeManager, OrgTreeTribeLead } from '@cadence/shared';
import { ApiService, errorMessage } from '../../core/api.service';
import { AuthStore } from '../../core/auth.store';
import { ToastService } from '../../core/toast.service';
import { Avatar } from '../../shared/avatar';
import { CopyButton } from '../../shared/copy-button';
import { Field, isInvalid } from '../../shared/field';
import { Icon } from '../../shared/icon';
import { PageHeader } from '../../shared/page-header';

/** What the add-person dialog creates: a signed-in user (tribe lead or EM) or a tracked member. */
type Kind = 'TRIBE_LEAD' | 'ENGINEERING_MANAGER' | 'MEMBER';
/** Context of an open add-person dialog. */
interface Draft {
  kind: Kind;
  /** The new person's manager: the tribe lead for an EM, the EM for a member; unset for a tribe lead. */
  parentId?: string;
  parentName?: string;
}
/** Add-person form model; fields that don't apply to the current {@link Kind} are left empty. */
interface PersonForm {
  name: string;
  /** Required for users (they sign in with it); optional for members. */
  email: string;
  /** Tribe leads only: optional tribe name. */
  tribeName: string;
  /** Members only: job title. */
  title: string;
  /** Users only: initial password, at least 12 characters. */
  password: string;
}
const EMPTY: PersonForm = { name: '', email: '', tribeName: '', title: '', password: '' };

/**
 * Organization page: the tribe lead → engineering manager → member tree, with an add-person dialog and a
 * password-reset-link dialog.
 *
 * @remarks
 * Actions shown depend on role: only admins add or manage tribe leads; admins and tribe leads add,
 * reset and remove engineering managers; anyone who can see an EM can add people to their team.
 */
@Component({
  selector: 'app-org-page',
  imports: [FormField, RouterLink, Avatar, CopyButton, Field, Icon, PageHeader],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './org.page.html',
})
export class OrgPage {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  protected readonly auth = inject(AuthStore);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly linkDialog = viewChild.required<ElementRef<HTMLDialogElement>>('linkDialog');
  protected readonly invalid = isInvalid;
  /** The last generated reset link shown in the link dialog; `expiresAt` is preformatted for display. */
  protected readonly link = signal<{
    url: string;
    expiresAt: string;
    emailed: boolean;
    name: string;
  } | null>(null);

  protected readonly tree = resource({ loader: () => this.api.orgTree() });
  protected readonly tribeLeads = computed(() => this.tree.value()?.tribeLeads ?? []);

  /** The add-person dialog's context, or `null` before it has been opened. */
  protected readonly draft = signal<Draft | null>(null);
  protected readonly isMember = computed(() => this.draft()?.kind === 'MEMBER');
  protected readonly model = signal<PersonForm>({ ...EMPTY });
  protected readonly pf = form(this.model, (p) => {
    required(p.name, { message: 'Enter a name' });
    email(p.email, { message: 'Enter a valid e-mail' });
    applyWhen(
      p,
      () => !this.isMember(),
      (q) => {
        required(q.email, { message: 'E-mail is required to sign in' });
        required(q.password, { message: 'Set an initial password' });
        minLength(q.password, 12, { message: 'Use at least 12 characters' });
      },
    );
  });

  protected readonly dialogTitle = computed(
    () =>
      ({
        TRIBE_LEAD: 'New tribe lead',
        ENGINEERING_MANAGER: 'New engineering manager',
        MEMBER: 'New person',
      })[this.draft()?.kind ?? 'MEMBER'],
  );

  /** Opens the add-person dialog with a blank form for the given kind and parent. */
  open(d: Draft) {
    this.draft.set(d);
    this.model.set({ ...EMPTY });
    this.pf().reset();
    this.dialog().nativeElement.showModal();
  }

  close() {
    this.dialog().nativeElement.close();
  }

  /** Creates the member or user described by the dialog, then closes it and reloads the tree. */
  async save(event: Event) {
    event.preventDefault();
    const d = this.draft();
    if (!d) return;
    await submit(this.pf, async () => {
      const v = this.model();
      try {
        if (d.kind === 'MEMBER') {
          await this.api.createMember({
            name: v.name,
            email: v.email || undefined,
            title: v.title || undefined,
            managerId: d.parentId!,
          });
        } else {
          await this.api.createUser({
            name: v.name,
            email: v.email,
            password: v.password,
            role: d.kind,
            reportsToId: d.parentId,
            tribeName: v.tribeName || undefined,
          });
        }
        this.toast.success(`${v.name} added`);
        this.close();
        this.tree.reload();
      } catch (e) {
        this.toast.error(errorMessage(e));
      }
      return undefined;
    });
  }

  /** Generates a reset link for a tribe lead or EM and shows it in the link dialog for copying. */
  async resetLink(u: OrgTreeTribeLead | OrgTreeManager) {
    try {
      const res = await this.api.resetLink(u.id);
      this.link.set({ ...res, name: u.name, expiresAt: new Date(res.expiresAt).toLocaleString() });
      this.linkDialog().nativeElement.showModal();
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }

  /** Deletes a tribe lead or EM after a browser confirm; the API rejects it while they still have reports. */
  async removeUser(u: OrgTreeTribeLead | OrgTreeManager) {
    if (!confirm(`Remove ${u.name}? They must have no reports or people.`)) return;
    try {
      await this.api.deleteUser(u.id);
      this.toast.success(`${u.name} removed`);
      this.tree.reload();
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }
}
