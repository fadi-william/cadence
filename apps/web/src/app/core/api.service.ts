import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type {
  AuditPageDto,
  AuthResponseDto,
  AuthUserDto,
  ChangePasswordDto,
  CompleteSetupDto,
  CreateIntegrationDto,
  CreateMemberDto,
  CreateUserDto,
  DeliveryServiceDto,
  DoraSummaryDto,
  ExternalUserDto,
  IntegrationConnectionDto,
  LoginDto,
  MemberDto,
  MemberMetricsDto,
  MetricsSummaryDto,
  OrgTreeDto,
  ProviderDescriptorDto,
  ResetLinkDto,
  RollupDto,
  RollupGroupBy,
  SetupStatusDto,
  SyncRunDto,
  TestConnectionResultDto,
  UpdateIntegrationDto,
  UpdateMemberDto,
  UpdateUserDto,
  UpsertIdentityDto,
  UserDto,
  UserRole,
  WebhookInfoDto,
} from '@cadence/shared';

/** Query parameters; `undefined`, `null` and empty-string values are omitted from the URL. */
type Params = Record<string, string | number | undefined | null>;

/**
 * Thin, promise-based client for the Cadence API (proxied at `/api` in dev).
 *
 * @remarks
 * Every method resolves with the response body or rejects with the `HttpErrorResponse`; use
 * {@link errorMessage} to turn a rejection into display text. Authorization headers and token refresh are
 * handled by {@link authInterceptor}, not here. POSTs are sent `withCredentials` so the refresh cookie
 * travels with the auth endpoints. Date arguments (`from`/`to`) are ISO days, `YYYY-MM-DD`; omitted ones
 * fall back to the API's defaults.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api';

  private params(params?: Params) {
    let p = new HttpParams();
    for (const [k, v] of Object.entries(params ?? {}))
      if (v !== undefined && v !== null && v !== '') p = p.set(k, String(v));
    return p;
  }
  private get<T>(path: string, params?: Params) {
    return firstValueFrom(this.http.get<T>(this.base + path, { params: this.params(params) }));
  }
  private post<T>(path: string, body: unknown = {}) {
    return firstValueFrom(this.http.post<T>(this.base + path, body, { withCredentials: true }));
  }
  private put<T>(path: string, body: unknown) {
    return firstValueFrom(this.http.put<T>(this.base + path, body));
  }
  private patch<T>(path: string, body: unknown) {
    return firstValueFrom(this.http.patch<T>(this.base + path, body));
  }
  private delete<T>(path: string) {
    return firstValueFrom(this.http.delete<T>(this.base + path));
  }

  // setup & auth
  /** Whether first-launch setup is still pending (no admin password yet). */
  setupStatus = () => this.get<SetupStatusDto>('/setup/status');
  /** Creates the first admin and signs them in. */
  completeSetup = (dto: CompleteSetupDto) => this.post<AuthResponseDto>('/setup/complete', dto);
  login = (dto: LoginDto) => this.post<AuthResponseDto>('/auth/login', dto);
  /** Exchanges the httpOnly refresh cookie for a new access token (the cookie is rotated). */
  refresh = () => this.post<AuthResponseDto>('/auth/refresh');
  logout = () => this.post<void>('/auth/logout');
  me = () => this.get<AuthUserDto>('/auth/me');
  changePassword = (dto: ChangePasswordDto) =>
    this.post<AuthResponseDto>('/auth/change-password', dto);
  /** Requests a reset email; the response does not reveal whether the address exists. */
  forgotPassword = (email: string) =>
    this.post<{ ok: boolean }>('/auth/forgot-password', { email });
  /** Sets a new password using the token from a reset link. */
  resetPassword = (token: string, password: string) =>
    this.post<void>('/auth/reset-password', { token, password });

  // users
  /** Users visible to the caller, optionally filtered by role. */
  users = (role?: UserRole) => this.get<UserDto[]>('/users', { role });
  createUser = (dto: CreateUserDto) => this.post<UserDto>('/users', dto);
  updateUser = (id: string, dto: UpdateUserDto) => this.patch<UserDto>(`/users/${id}`, dto);
  deleteUser = (id: string) => this.delete<void>(`/users/${id}`);
  /** Generates a single-use password-reset link for a user (admins and tribe leads). */
  resetLink = (id: string) => this.post<ResetLinkDto>(`/users/${id}/reset-link`);
  orgTree = () => this.get<OrgTreeDto>('/org/tree');

  // members
  /** Members visible to the caller, optionally limited to one engineering manager's reports. */
  members = (managerId?: string) => this.get<MemberDto[]>('/members', { managerId });
  member = (id: string) => this.get<MemberDto>(`/members/${id}`);
  createMember = (dto: CreateMemberDto) => this.post<MemberDto>('/members', dto);
  updateMember = (id: string, dto: UpdateMemberDto) => this.patch<MemberDto>(`/members/${id}`, dto);
  deleteMember = (id: string) => this.delete<void>(`/members/${id}`);
  /** Creates or replaces the member's identity on one integration connection. */
  linkIdentity = (id: string, connectionId: string, dto: UpsertIdentityDto) =>
    this.put<MemberDto>(`/members/${id}/identities/${connectionId}`, dto);
  unlinkIdentity = (id: string, connectionId: string) =>
    this.delete<MemberDto>(`/members/${id}/identities/${connectionId}`);

  // integrations
  providers = () => this.get<ProviderDescriptorDto[]>('/integrations/providers');
  integrations = () => this.get<IntegrationConnectionDto[]>('/integrations');
  createIntegration = (dto: CreateIntegrationDto) =>
    this.post<IntegrationConnectionDto>('/integrations', dto);
  updateIntegration = (id: string, dto: UpdateIntegrationDto) =>
    this.patch<IntegrationConnectionDto>(`/integrations/${id}`, dto);
  deleteIntegration = (id: string) => this.delete<void>(`/integrations/${id}`);
  testIntegration = (id: string) => this.post<TestConnectionResultDto>(`/integrations/${id}/test`);
  /**
   * Queues a sync of the connection.
   *
   * @param days - How many days of history to pull.
   * @returns The queued run; poll {@link ApiService.syncRun} for progress.
   */
  syncIntegration = (id: string, days = 14) =>
    this.post<SyncRunDto>(`/integrations/${id}/sync`, { days });
  syncRun = (id: string, runId: string) =>
    this.get<SyncRunDto>(`/integrations/${id}/runs/${runId}`);
  syncRuns = (id: string) => this.get<SyncRunDto[]>(`/integrations/${id}/runs`);
  /** Searches the provider's user directory, used when linking a member identity. */
  searchExternalUsers = (id: string, q: string) =>
    this.get<ExternalUserDto[]>(`/integrations/${id}/users`, { q });
  webhook = (id: string) => this.get<WebhookInfoDto>(`/integrations/${id}/webhook`);
  /**
   * Enables the inbound webhook or rotates its secret.
   *
   * @param secret - Secret to use; when omitted the API generates one.
   */
  setWebhookSecret = (id: string, secret?: string) =>
    this.post<WebhookInfoDto>(`/integrations/${id}/webhook`, secret ? { secret } : {});
  disableWebhook = (id: string) => this.delete<WebhookInfoDto>(`/integrations/${id}/webhook`);

  // metrics
  /** Combined metrics for the visible members, optionally narrowed to one manager's team. */
  summary = (from?: string, to?: string, managerId?: string) =>
    this.get<MetricsSummaryDto>('/metrics/summary', { from, to, managerId });
  /** Metrics aggregated per engineering manager's team or per tribe, depending on `groupBy`. */
  rollup = (groupBy: RollupGroupBy, from?: string, to?: string) =>
    this.get<RollupDto>('/metrics/rollup', { groupBy, from, to });
  memberMetrics = (id: string, from?: string, to?: string) =>
    this.get<MemberMetricsDto>(`/metrics/members/${id}`, { from, to });

  // DORA
  dora = (from?: string, to?: string, managerId?: string) =>
    this.get<DoraSummaryDto>('/dora/summary', { from, to, managerId });
  services = () => this.get<DeliveryServiceDto[]>('/dora/services');
  /**
   * Assigns a delivery service to an engineering manager's team.
   *
   * @param managerId - The owning manager, or `null` to unassign.
   */
  setServiceOwner = (id: string, managerId: string | null) =>
    this.patch<DeliveryServiceDto>(`/dora/services/${id}`, { managerId });

  // audit
  /**
   * One page of the audit log, newest first.
   *
   * @param cursor - The `nextCursor` of the previous page; omit or `null` for the first page.
   */
  audit = (cursor?: string | null, entityType?: string, limit = 50) =>
    this.get<AuditPageDto>('/audit', { cursor, entityType, limit });
}

/**
 * Extracts a human-readable message from an `HttpErrorResponse` (or any error).
 *
 * @remarks
 * Prefers the API's `error.message` (Nest validation arrays are joined with commas), then the error's own
 * `message`, then a generic fallback.
 */
export function errorMessage(e: unknown): string {
  const err = e as { error?: { message?: string | string[] }; message?: string };
  const m = err?.error?.message ?? err?.message ?? 'Something went wrong';
  return Array.isArray(m) ? m.join(', ') : m;
}
