import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  inject,
  resource,
  signal,
  viewChild,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormField, applyWhen, form, required, submit, validate } from '@angular/forms/signals';
import {
  KIND_LABELS,
  type IntegrationConnectionDto,
  type IntegrationKind,
  type ProviderDescriptorDto,
  type SyncRunDto,
  type WebhookInfoDto,
} from '@cadence/shared';
import { ApiService, errorMessage } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { CopyButton } from '../../shared/copy-button';
import { Field, isInvalid } from '../../shared/field';
import { Icon } from '../../shared/icon';
import { PageHeader } from '../../shared/page-header';
import { ProviderIcon } from '../../shared/provider-icon';

/** Sync-run statuses that are still in progress and need polling. */
const ACTIVE = new Set(['QUEUED', 'RUNNING']);

/** What each feature brings in, shown next to its checkbox in the connection dialog. */
const KIND_HINTS: Record<IntegrationKind, string> = {
  WORK_TRACKING: 'Completed items, story points, cycle time and hand-overs.',
  SOURCE_CONTROL: 'Commits, pull requests and reviews.',
  DEPLOYMENTS: 'Production deployments for the DORA metrics.',
};

/** Create/edit connection form. */
interface ConnectionForm {
  name: string;
  baseUrl: string;
  /** API token; required on create, and when editing an empty value keeps the stored one. */
  secret: string;
  /** Provider-specific settings keyed by config field; list fields are comma-separated text. */
  config: Record<string, string>;
}

/**
 * Admin-only integrations page: one card per available provider to add a connection, and the list of
 * existing connections with edit, enable/disable, test, sync, webhook setup and delete actions.
 *
 * @remarks
 * The connection dialog renders the provider's own config fields from its descriptor, and a checkbox for
 * each feature the provider supports. Unticking a feature that was on asks whether to keep its history
 * (the default) or remove its data. A manual sync pulls 14 days and is then polled until it finishes, with a
 * toast for the outcome.
 */
@Component({
  selector: 'app-integrations-page',
  imports: [FormField, DatePipe, CopyButton, Field, Icon, PageHeader, ProviderIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './integrations.page.html',
})
export class IntegrationsPage implements OnDestroy {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly webhookDialog =
    viewChild.required<ElementRef<HTMLDialogElement>>('webhookDialog');
  protected readonly kindLabels = KIND_LABELS;
  protected readonly kindHints = KIND_HINTS;
  protected readonly invalid = isInvalid;

  private readonly providerRes = resource({ loader: () => this.api.providers() });
  private readonly list = resource({ loader: () => this.api.integrations() });
  protected readonly providers = computed(() => this.providerRes.value() ?? []);
  protected readonly connections = computed(() => this.list.value() ?? []);

  /** Provider whose fields the connection dialog is showing. */
  protected readonly provider = signal<ProviderDescriptorDto | null>(null);
  /** Connection being edited, or `null` when the dialog creates one. */
  protected readonly editing = signal<IntegrationConnectionDto | null>(null);
  /** Id of the connection whose test is in flight. */
  protected readonly pending = signal<string | null>(null);
  /** Runs being polled, by connection id. */
  protected readonly liveRuns = signal<Record<string, SyncRunDto>>({});
  /** Connection whose webhook dialog is open. */
  protected readonly webhookFor = signal<IntegrationConnectionDto | null>(null);
  /** Webhook info for that connection; `null` while loading. */
  protected readonly webhook = signal<WebhookInfoDto | null>(null);
  /** Secret typed by the admin when the provider issues its own webhook secret. */
  protected readonly providerSecret = signal('');
  /** Features ticked in the connection dialog. */
  protected readonly features = signal<IntegrationKind[]>([]);
  /** Turned-off features whose data the admin chose to remove (the rest keep their history). */
  protected readonly removeData = signal<IntegrationKind[]>([]);
  /** True after a save attempt with no feature ticked, to show the error. */
  protected readonly noFeatures = signal(false);
  /** Features that were on for the edited connection and are now unticked. */
  protected readonly turnedOff = computed(() => {
    const was = this.editing()?.features ?? [];
    return was.filter((k) => !this.features().includes(k));
  });
  private pollTimer?: ReturnType<typeof setInterval>;

  protected readonly model = signal<ConnectionForm>({
    name: '',
    baseUrl: '',
    secret: '',
    config: {},
  });
  protected readonly cf = form(this.model, (p) => {
    required(p.name, { message: 'Give the connection a name' });
    required(p.baseUrl, { message: 'Enter the base URL' });
    validate(p.baseUrl, ({ value }) =>
      /^https?:\/\/\S+$/.test(value())
        ? null
        : { kind: 'url', message: 'Enter a full URL (https://…)' },
    );
    applyWhen(
      p,
      () => !this.editing(),
      (q) => required(q.secret, { message: 'A token is required' }),
    );
    validate(p.config, ({ value }) => {
      const missing = (this.provider()?.configFields ?? []).filter(
        (f) => f.required && !value()[f.key]?.trim(),
      );
      return missing.length
        ? { kind: 'config', message: `Required: ${missing.map((f) => f.label).join(', ')}` }
        : null;
    });
  });

  describe = (p: string) => this.providers().find((d) => d.provider === p);
  kinds = (p: ProviderDescriptorDto) => p.capabilities.map((c) => KIND_LABELS[c]).join(' · ');
  active = (r: SyncRunDto) => ACTIVE.has(r.status);
  /** The run being polled for a connection if any, else its last recorded sync. */
  lastRun = (c: IntegrationConnectionDto) => this.liveRuns()[c.id] ?? c.lastSync ?? null;
  isSyncing = (c: IntegrationConnectionDto) => {
    const r = this.lastRun(c);
    return !!r && this.active(r);
  };
  statusLabel = (r: SyncRunDto) =>
    ({
      QUEUED: 'Queued…',
      RUNNING: 'Syncing…',
      SUCCESS: 'Last sync succeeded',
      FAILED: 'Last sync failed',
    })[r.status];

  /** Stored config as form strings: lists joined with commas, missing values default to the first option. */
  private configToForm(p: ProviderDescriptorDto, cfg: Record<string, unknown> = {}) {
    const out: Record<string, string> = {};
    for (const f of p.configFields) {
      const v = cfg[f.key];
      out[f.key] = Array.isArray(v) ? v.join(', ') : String(v ?? f.options?.[0]?.value ?? '');
    }
    return out;
  }

  /** Inverse of `configToForm`: trims values and splits list fields on commas. */
  private formToConfig(p: ProviderDescriptorDto, config: Record<string, string>) {
    const out: Record<string, unknown> = {};
    for (const f of p.configFields) {
      const v = (config[f.key] ?? '').trim();
      out[f.key] =
        f.type === 'list'
          ? v
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : v;
    }
    return out;
  }

  private openDialog(p: ProviderDescriptorDto, c: IntegrationConnectionDto | null) {
    (document.activeElement as HTMLElement | null)?.blur();
    this.provider.set(p);
    this.editing.set(c);
    this.model.set({
      name: c?.name ?? p.label,
      baseUrl: c?.baseUrl ?? p.defaultBaseUrl ?? '',
      secret: '',
      config: this.configToForm(p, c?.config),
    });
    this.features.set(c?.features ?? [...p.capabilities]);
    this.removeData.set([]);
    this.noFeatures.set(false);
    this.cf().reset();
    this.dialog().nativeElement.showModal();
  }

  openCreate(p: ProviderDescriptorDto) {
    this.openDialog(p, null);
  }

  openEdit(c: IntegrationConnectionDto) {
    const p = this.describe(c.provider);
    if (p) this.openDialog(p, c);
  }

  /** Ticks or unticks a feature in the connection dialog. */
  setFeature(kind: IntegrationKind, on: boolean) {
    const p = this.provider()!;
    const next = new Set(this.features());
    if (on) next.add(kind);
    else next.delete(kind);
    this.features.set(p.capabilities.filter((k) => next.has(k)));
    if (on) this.removeData.update((r) => r.filter((k) => k !== kind));
    this.noFeatures.set(false);
  }

  /** Chooses between keeping the history of a turned-off feature and removing its data. */
  setRemoveData(kind: IntegrationKind, remove: boolean) {
    this.removeData.update((r) =>
      remove ? [...new Set([...r, kind])] : r.filter((k) => k !== kind),
    );
  }

  /**
   * Creates or updates the connection; when editing, the secret is only sent if a new one was typed.
   * Asks for confirmation before removing the data of turned-off features.
   */
  async save(event: Event) {
    event.preventDefault();
    const p = this.provider()!;
    if (!this.features().length) {
      this.noFeatures.set(true);
      return;
    }
    const removeDataFor = this.removeData().filter((k) => this.turnedOff().includes(k));
    if (
      removeDataFor.length &&
      !confirm(
        `Permanently delete the ${removeDataFor.map((k) => KIND_LABELS[k].toLowerCase()).join(' and ')} ` +
          'data collected by this connection? This cannot be undone.',
      )
    )
      return;
    await submit(this.cf, async () => {
      const v = this.model();
      const base = {
        name: v.name,
        baseUrl: v.baseUrl,
        config: this.formToConfig(p, v.config),
        features: this.features(),
      };
      try {
        const c = this.editing();
        if (c)
          await this.api.updateIntegration(c.id, {
            ...base,
            ...(v.secret ? { secret: v.secret } : {}),
            ...(removeDataFor.length ? { removeDataFor } : {}),
          });
        else await this.api.createIntegration({ ...base, provider: p.provider, secret: v.secret });
        this.toast.success('Integration saved');
        this.dialog().nativeElement.close();
        this.list.reload();
      } catch (e) {
        this.toast.error(errorMessage(e));
      }
      return undefined;
    });
  }

  /** Enables or disables a connection, then reloads the list. */
  async toggle(c: IntegrationConnectionDto) {
    await this.api
      .updateIntegration(c.id, { enabled: !c.enabled })
      .catch((e) => this.toast.error(errorMessage(e)));
    this.list.reload();
  }

  /** Checks the connection's credentials and reports the result as a toast. */
  async test(c: IntegrationConnectionDto) {
    this.pending.set(c.id);
    try {
      const r = await this.api.testIntegration(c.id);
      if (r.ok) this.toast.success(r.message ?? 'Connection OK');
      else this.toast.error(r.message ?? 'Connection failed');
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.pending.set(null);
    }
  }

  /** Queues a 14-day sync and starts polling its progress. */
  async sync(c: IntegrationConnectionDto) {
    try {
      const run = await this.api.syncIntegration(c.id, 14);
      this.liveRuns.update((r) => ({ ...r, [c.id]: run }));
      this.startPolling();
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }

  /**
   * Syncs run in the background (queue or in-process); poll every 1.5 s until each finishes. A single
   * interval serves all live runs; failed status lookups are retried on the next tick. When nothing is
   * active any more the interval stops and the list reloads.
   */
  private startPolling() {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(async () => {
      const live = Object.entries(this.liveRuns()).filter(([, r]) => this.active(r));
      if (!live.length) {
        clearInterval(this.pollTimer);
        this.pollTimer = undefined;
        this.list.reload();
        return;
      }
      for (const [connectionId, r] of live) {
        const next = await this.api.syncRun(connectionId, r.id).catch(() => null);
        if (!next) continue;
        this.liveRuns.update((m) => ({ ...m, [connectionId]: next }));
        if (next.status === 'SUCCESS')
          this.toast.success(`Sync finished: ${next.recordsWritten} rows`);
        if (next.status === 'FAILED') this.toast.error(next.error ?? 'Sync failed');
      }
    }, 1500);
  }

  /** Opens the webhook dialog and loads the connection's webhook URL and status. */
  async openWebhook(c: IntegrationConnectionDto) {
    this.webhookFor.set(c);
    this.webhook.set(null);
    this.providerSecret.set('');
    this.webhookDialog().nativeElement.showModal();
    try {
      this.webhook.set(await this.api.webhook(c.id));
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }

  /**
   * Enables the webhook or rotates its secret (asking for confirmation before replacing an existing
   * secret with a generated one).
   *
   * @param secret - A secret issued by the provider; when omitted the API generates one and the dialog
   * shows it once.
   */
  async setSecret(secret?: string) {
    const c = this.webhookFor();
    if (!c) return;
    if (
      this.webhook()?.configured &&
      !secret &&
      !confirm('Rotate the secret? The current one stops working immediately.')
    )
      return;
    try {
      const info = await this.api.setWebhookSecret(c.id, secret);
      // Don't echo back a secret the user typed themselves.
      this.webhook.set(secret ? { ...info, secret: undefined } : info);
      this.providerSecret.set('');
      this.toast.success('Webhook enabled');
      this.list.reload();
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }

  /** Removes the webhook secret after a confirm, so incoming events are rejected. */
  async disableWebhook() {
    const c = this.webhookFor();
    if (!c || !confirm('Disable this webhook? Incoming events will be rejected.')) return;
    this.webhook.set(await this.api.disableWebhook(c.id));
    this.list.reload();
  }

  /** Deletes a connection, with its linked identities, metrics and deployments, after a browser confirm. */
  async remove(c: IntegrationConnectionDto) {
    if (
      !confirm(
        `Delete ${c.name}? Linked identities, metrics and deployments from it will be removed.`,
      )
    )
      return;
    try {
      await this.api.deleteIntegration(c.id);
      this.list.reload();
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }

  ngOnDestroy() {
    clearInterval(this.pollTimer);
  }
}
