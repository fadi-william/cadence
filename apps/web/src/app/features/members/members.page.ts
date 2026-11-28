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
import { FormField, email, form, required, submit } from '@angular/forms/signals';
import { RouterLink } from '@angular/router';
import {
  PROVIDER_LABELS,
  type ExternalUserDto,
  type MemberDto,
  type MetricTotals,
} from '@cadence/shared';
import { ApiService, errorMessage } from '../../core/api.service';
import { AuthStore } from '../../core/auth.store';
import { lastNDays } from '../../core/dates';
import { ToastService } from '../../core/toast.service';
import { Avatar } from '../../shared/avatar';
import { Field, isInvalid } from '../../shared/field';
import { Icon } from '../../shared/icon';
import { PageHeader } from '../../shared/page-header';
import { ProviderIcon } from '../../shared/provider-icon';

type ViewMode = 'grid' | 'list';
/** Create/edit member form; empty `email` and `title` are sent as omitted. */
interface MemberForm {
  name: string;
  email: string;
  title: string;
  /** Engineering manager the member reports to (required). */
  managerId: string;
}

/**
 * People page: searchable grid or list of the visible members with their last-30-day quick stats, a
 * create/edit dialog and an identities dialog for linking each member to their account on every enabled
 * integration connection.
 *
 * @remarks
 * The search matches name, e-mail, title and linked usernames; the manager filter also becomes the
 * default manager for a new member (engineering managers always default to themselves).
 */
@Component({
  selector: 'app-members-page',
  imports: [FormField, RouterLink, Avatar, Field, Icon, PageHeader, ProviderIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './members.page.html',
})
export class MembersPage {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthStore);
  private readonly editDialog = viewChild.required<ElementRef<HTMLDialogElement>>('editDialog');
  private readonly idDialog = viewChild.required<ElementRef<HTMLDialogElement>>('idDialog');
  protected readonly labels = PROVIDER_LABELS;
  protected readonly invalid = isInvalid;

  protected readonly members = resource({ loader: () => this.api.members() });
  /** Fixed window for the cards' quick stats, independent of any date picker. */
  private readonly window = lastNDays(30);
  private readonly summary = resource({
    loader: () => this.api.summary(this.window.from, this.window.to),
  });
  private readonly managerRes = resource({ loader: () => this.api.users('ENGINEERING_MANAGER') });
  private readonly connectionRes = resource({ loader: () => this.api.integrations() });
  private readonly providerRes = resource({ loader: () => this.api.providers() });

  protected readonly managers = computed(() => this.managerRes.value() ?? []);
  /** Enabled connections only; these are the rows of the identities dialog. */
  protected readonly connections = computed(() =>
    (this.connectionRes.value() ?? []).filter((c) => c.enabled),
  );
  protected readonly query = signal('');
  protected readonly managerFilter = signal('');
  protected readonly mode = signal<ViewMode>('grid');

  private readonly totalsById = computed(
    () => new Map((this.summary.value()?.rows ?? []).map((r) => [r.memberId, r.totals] as const)),
  );
  /** Last-30-day totals for a member, or `undefined` when they have no activity row. */
  totals = (id: string) => this.totalsById().get(id);
  quickStats = (t: MetricTotals | undefined) => [
    { label: 'Commits', value: t?.commits ?? 0 },
    { label: 'PRs merged', value: t?.prsMerged ?? 0 },
    { label: 'Reviews', value: t?.prsReviewed ?? 0 },
    { label: 'Issues', value: t?.issuesCompleted ?? 0 },
  ];

  protected readonly filtered = computed(() => {
    const q = this.query().toLowerCase();
    const mf = this.managerFilter();
    return (this.members.value() ?? []).filter(
      (m) =>
        (!mf || m.managerId === mf) &&
        (!q ||
          [m.name, m.email, m.title, ...m.identities.map((i) => i.username)].some((v) =>
            v?.toLowerCase().includes(q),
          )),
    );
  });

  // ---- create / edit (Signal Forms) ----
  /** Member being edited, or `null` when the dialog creates a new one. */
  protected readonly editing = signal<MemberDto | null>(null);
  protected readonly memberModel = signal<MemberForm>({
    name: '',
    email: '',
    title: '',
    managerId: '',
  });
  protected readonly mf = form(this.memberModel, (p) => {
    required(p.name, { message: 'Enter a name' });
    email(p.email, { message: 'Enter a valid e-mail' });
    required(p.managerId, { message: 'Choose a manager' });
  });

  /** Opens the member dialog, prefilled from `m` when editing or blank when creating. */
  openEdit(m?: MemberDto) {
    this.editing.set(m ?? null);
    const defaultManager =
      this.auth.role() === 'ENGINEERING_MANAGER' ? this.auth.user()!.id : this.managerFilter();
    this.memberModel.set({
      name: m?.name ?? '',
      email: m?.email ?? '',
      title: m?.title ?? '',
      managerId: m?.managerId ?? defaultManager,
    });
    this.mf().reset();
    this.editDialog().nativeElement.showModal();
  }

  async saveMember(event: Event) {
    event.preventDefault();
    await submit(this.mf, async () => {
      const v = this.memberModel();
      const dto = {
        name: v.name,
        email: v.email || undefined,
        title: v.title || undefined,
        managerId: v.managerId,
      };
      try {
        const m = this.editing();
        if (m) await this.api.updateMember(m.id, dto);
        else await this.api.createMember(dto);
        this.toast.success(`${v.name} saved`);
        this.editDialog().nativeElement.close();
        this.members.reload();
      } catch (e) {
        this.toast.error(errorMessage(e));
      }
      return undefined;
    });
  }

  /** Deletes a member (with their metrics history) after a browser confirm. */
  async remove(m: MemberDto) {
    if (!confirm(`Delete ${m.name}? Their metrics history will be removed.`)) return;
    try {
      await this.api.deleteMember(m.id);
      this.toast.success(`${m.name} deleted`);
      this.members.reload();
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }

  // ---- identities ----
  /** Member whose identities dialog is open. */
  protected readonly selected = signal<MemberDto | null>(null);
  /** Username being typed per connection id, seeded from the member's linked identities. */
  protected readonly drafts = signal<Record<string, string>>({});
  /** Directory search results per connection id. */
  protected readonly suggestions = signal<Record<string, ExternalUserDto[]>>({});
  /** Connection id with a search in flight, if any. */
  protected readonly searching = signal<string | null>(null);
  private searchTimer?: ReturnType<typeof setTimeout>;

  /** Provider-specific label for the identity field (what to enter), defaulting to "Username". */
  hint(provider: string) {
    return (
      this.providerRes.value()?.find((p) => p.provider === provider)?.identityHint ?? 'Username'
    );
  }

  linked(connectionId: string) {
    return !!this.selected()?.identities.some((i) => i.connectionId === connectionId);
  }

  openIdentities(m: MemberDto) {
    (document.activeElement as HTMLElement | null)?.blur();
    this.selected.set(m);
    this.drafts.set(Object.fromEntries(m.identities.map((i) => [i.connectionId, i.username])));
    this.suggestions.set({});
    this.idDialog().nativeElement.showModal();
  }

  /**
   * Debounced (300 ms) lookup against the platform (`adapter.searchUsers`). Needs at least 2 characters;
   * search failures just clear the suggestions.
   */
  onIdentityInput(connectionId: string, value: string) {
    this.drafts.update((d) => ({ ...d, [connectionId]: value }));
    clearTimeout(this.searchTimer);
    if (value.trim().length < 2) {
      this.suggestions.update((s) => ({ ...s, [connectionId]: [] }));
      return;
    }
    this.searchTimer = setTimeout(async () => {
      this.searching.set(connectionId);
      try {
        const users = await this.api.searchExternalUsers(connectionId, value.trim());
        this.suggestions.update((s) => ({ ...s, [connectionId]: users }));
      } catch {
        this.suggestions.update((s) => ({ ...s, [connectionId]: [] }));
      } finally {
        this.searching.set(null);
      }
    }, 300);
  }

  pick(connectionId: string, username: string) {
    this.drafts.update((d) => ({ ...d, [connectionId]: username }));
    this.closeSuggestions(connectionId);
  }

  /** Hides suggestions after a short delay, so a click on a suggestion still lands before the list closes. */
  closeSuggestions(connectionId: string) {
    setTimeout(() => this.suggestions.update((s) => ({ ...s, [connectionId]: [] })), 150);
  }

  /** Swaps the updated member into the dialog and the cached list without a reload. */
  private replaceMember(updated: MemberDto) {
    this.selected.set(updated);
    this.members.update((list) => list?.map((x) => (x.id === updated.id ? updated : x)));
  }

  /** Links (or relinks) the typed username on one connection for the selected member. */
  async link(connectionId: string) {
    const m = this.selected();
    if (!m) return;
    try {
      this.replaceMember(
        await this.api.linkIdentity(m.id, connectionId, { username: this.drafts()[connectionId]! }),
      );
      this.toast.success('Identity linked');
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }

  async unlink(connectionId: string) {
    const m = this.selected();
    if (!m) return;
    try {
      this.replaceMember(await this.api.unlinkIdentity(m.id, connectionId));
      this.drafts.update(({ [connectionId]: _, ...rest }) => rest);
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }
}
