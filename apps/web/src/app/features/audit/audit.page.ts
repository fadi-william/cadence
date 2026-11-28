import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DatePipe, JsonPipe } from '@angular/common';
import type { AuditLogDto } from '@cadence/shared';
import { ApiService, errorMessage } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { Avatar } from '../../shared/avatar';
import { PageHeader } from '../../shared/page-header';

/** Entity-type filter chips; an empty value means all entity types. */
const FILTERS = [
  { value: '', label: 'Everything' },
  { value: 'user', label: 'Users' },
  { value: 'member', label: 'People' },
  { value: 'integration', label: 'Integrations' },
  { value: 'service', label: 'Services' },
];

/** Admin-only audit log: a filterable, cursor-paginated list of audit entries, newest first. */
@Component({
  selector: 'app-audit-page',
  imports: [DatePipe, JsonPipe, Avatar, PageHeader],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './audit.page.html',
})
export class AuditPage {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  protected readonly filters = FILTERS;
  protected readonly items = signal<AuditLogDto[]>([]);
  /** Cursor for the next page, or `null` when everything has been loaded. */
  protected readonly cursor = signal<string | null>(null);
  protected readonly loading = signal(false);
  protected readonly entityType = signal('');

  constructor() {
    void this.load(true);
  }

  /**
   * Badge colour for an action name: destructive or failed red, created/completed/linked green, password
   * and secret changes amber, anything else blue.
   */
  tone(action: string) {
    if (/deleted|failed|reuse|disabled/.test(action)) return 'badge-error';
    if (/created|completed|linked/.test(action)) return 'badge-success';
    if (/password|reset|secret/.test(action)) return 'badge-warning';
    return 'badge-info';
  }

  /** Switches the entity-type filter and reloads from the first page. */
  filter(type: string) {
    this.entityType.set(type);
    void this.load(true);
  }

  /**
   * Loads a page of entries.
   *
   * @param reset - Start from the first page and replace the list instead of appending the next page.
   */
  async load(reset = false) {
    this.loading.set(true);
    try {
      const page = await this.api.audit(
        reset ? null : this.cursor(),
        this.entityType() || undefined,
      );
      this.items.update((list) => (reset ? page.items : [...list, ...page.items]));
      this.cursor.set(page.nextCursor);
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }
}
