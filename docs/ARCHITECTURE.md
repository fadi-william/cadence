# Cadence architecture

Cadence models an engineering organisation (Admin → Tribe Leads → Engineering Managers → Members),
links each member to their **Azure DevOps** and **Jira** identities, merges their activity into **one combined
view per person**, pulls activity into daily metrics, and computes DORA delivery metrics from production deployments.

---

## 1. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Monorepo | **npm workspaces** (`apps/*`, `packages/*`) | Zero extra tooling; easy to move to Nx/Turborepo later |
| Frontend | **Angular 22**: standalone, zoneless, signals for all state (`signal`/`computed`/`linkedSignal`/`resource`/`model`/`input`), **Signal Forms** (`@angular/forms/signals`) for every form | Modern Angular, no NgModules, no `ngModel` |
| UI | **Tailwind CSS 4 + daisyUI 5**: shared themes and components for the web app and site | Consistent UI across apps |
| Charts | **ECharts 6** (tree-shaken, lazy chunk) behind a theme-aware `<app-chart>` | Rich tooltips/legends; follows daisyUI theme |
| Backend | **NestJS 11** | Modular DI, guards, scheduling |
| ORM / DB | **Prisma 7** (`prisma-client` + `@prisma/adapter-pg`) on **PostgreSQL 16** | Type-safe schema & migrations |
| Queue | **BullMQ 6 + Redis 7** (optional; falls back to in-process) | Horizontal scale, one schedule across instances |
| Auth | Short-lived JWT access token + rotating **httpOnly refresh cookie**; bcrypt | No tokens in localStorage, theft detection |
| Tests | **Vitest** (+SWC) unit & integration (Testcontainers / `TEST_DATABASE_URL`), **Playwright** E2E | Real Nest app & real browser |
| Shared | `packages/shared` | Enums and DTO contracts shared by API and web |

```
cadence/
├─ apps/
│  ├─ api/                     NestJS + Prisma
│  │  ├─ prisma/               schema, migrations, seed-demo.ts
│  │  ├─ src/
│  │  │  ├─ auth/              login, refresh rotation, passwords, guard
│  │  │  ├─ setup/             first-launch admin bootstrap + setup token
│  │  │  ├─ audit/             append-only audit log
│  │  │  ├─ mail/              SMTP mailer (logs when unconfigured)
│  │  │  ├─ users/ org/ members/
│  │  │  ├─ integrations/      adapters/*, registry, SyncService, SyncDispatcher (BullMQ/inline)
│  │  │  ├─ webhooks/          signed inbound webhooks → debounced re-sync
│  │  │  ├─ metrics/           daily metrics, member/team/tribe roll-ups
│  │  │  └─ dora/              DORA summary + service ownership
│  │  └─ test/                 integration tests (Vitest + supertest)
│  ├─ web/                     Angular + daisyUI (+ nginx Dockerfile)
│  └─ e2e/                     Playwright suite (starts API + web on a scratch DB)
├─ apps/site/                Website (landing page + guides from docs/guide), deployed to GitHub Pages
├─ packages/shared/
├─ packages/ui-theme/        Shared daisyUI theme imported by apps/web and apps/site
├─ docker-compose.yml          Postgres + Redis; `--profile app` adds api + web
└─ .github/workflows/ci.yml    lint, build, unit, integration, E2E
```

---

## 2. Domain model

```
User (signs in)                       Member (tracked engineer, cannot sign in)
├─ role: ADMIN | TRIBE_LEAD | ENGINEERING_MANAGER   ├─ manager → User(EM)
├─ reportsTo: EM → Tribe Lead → Admin             ├─ identities[] → ExternalIdentity (one per connection)
├─ refreshTokens[], resetTokens[]                 └─ dailyMetrics[] → DailyMetric
└─ services[] (DeliveryService ownership)

IntegrationConnection (one Jira site / one Azure DevOps organization)
├─ provider, baseUrl, config (JSON), features[], encryptedSecret, encryptedWebhookSecret
├─ syncRuns[] (QUEUED → RUNNING → SUCCESS | FAILED, trigger: manual | schedule | webhook)
└─ services[] → DeliveryService (pipeline/repo, owned by a team) → deployments[] → Deployment

DailyMetric (memberId, connectionId, date) unique
  commits, prsRaised, prsReviewed, prsMerged, issuesCompleted, storyPoints, cycleTimeHoursSum/Samples,
  assignmentsCompleted, assignmentsHandedOver, assignmentsReworked, holdHoursSum/Samples

ReviewedPullRequest (connectionId, key) unique · member (author), date of first review, waitHours

WorkItem (connectionId, key) unique · date, storyPoints, cycleTimeHours
└─ contributors[] → Member (everyone who held it; team totals count each item once)

AuditLog (actor, action, entity, metadata, ip) · AppSetting (k/v, e.g. hashed setup token)
```

**Visibility** (`AccessScopeService`, applied in every query): Admin sees everything; a Tribe Lead sees
their EMs, those EMs' members and services; an EM sees only their own members and services.

---

## 3. First launch

1. On boot `SetupService` makes sure an `ADMIN` exists (`DEFAULT_ADMIN_EMAIL`) with **no password**.
2. While it has none, `GET /api/setup/status` reports `needsSetup` and the web app routes everything to `/setup`.
3. **Setup token:** when `SETUP_TOKEN_REQUIRED=true` (the default in production), a one-time token is printed to
   the API log, stored hashed, and required by `/setup/complete`. Nobody else on the network can claim the install.
4. `/setup/complete` is atomic (`updateMany … where passwordHash IS NULL`), signs the admin in, and is closed afterwards (409).

---

## 4. Integrations

### 4.1 Ports (adapter pattern)

```ts
interface IntegrationAdapter {
  provider; describe(): ProviderDescriptorDto;          // label, config form, secret help, webhook instructions
  testConnection(ctx); searchUsers?(ctx, q);            // identity autocomplete
  verifyWebhook?(req, secret); webhookDates?(body);     // signed webhooks, affected days
}
interface WorkTrackingAdapter  { fetchWorkItemActivity(ctx, identities, range): ActivityRecord[] }
interface SourceControlAdapter { fetchCodeActivity(ctx, identities, range): ActivityRecord[] }
interface DeploymentsAdapter   { fetchDeployments(ctx, range): DeploymentRecord[] }
```

Adapters are registered in `integrations.module.ts`. The UI builds the connection form from `describe()`,
so adding a platform takes no frontend work.

| Provider | Capabilities | Activity source | Deployments | Webhook verification |
|---|---|---|---|---|
| **Jira** (Cloud v3 / Server-DC v2) | Work tracking | JQL on resolved issues + changelog | n/a | `X-Hub-Signature` HMAC |
| **Azure DevOps** | Work tracking (Azure Boards), source control, deployments | Boards work items + their update history; commits per repo, PRs (created/closed/active), PR threads for reviews | Completed runs of deploy pipelines; lead time from built commit | `X-Cadence-Token` header |

Every provider also accepts the shared-secret header `X-Cadence-Token` (or `?token=`) as a fallback.

### 4.2 Features per connection

Each connection syncs only the capabilities in its `features`, a subset of what its provider supports. A team
that tracks work in Jira but keeps code in Azure DevOps turns Azure Boards off on the Azure DevOps connection, so
completed items aren't counted twice. New connections start with every capability on. Connections that existed
before Azure Boards support keep exactly what they synced before: Boards stays off until an admin turns it on.

Turning a feature off offers two modes:

- **Keep its history** (default): the data stays in dashboards but is no longer refreshed. Syncs rewrite only the
  `DailyMetric` columns of the enabled features (`features.ts` maps each feature to its columns), so the kept
  columns are never overwritten.
- **Remove its data**: in the same transaction as the change, its `DailyMetric` columns are cleared (rows left
  empty are deleted), and for work tracking its completed `WorkItem`s, for deployments its discovered services
  with their deployments and team owners, are deleted.

Turning a feature back on syncs it from the next run; use a manual sync to backfill.

### 4.3 Metric definitions
- **Commits/day**: commit author date in Azure DevOps repositories.
- **PRs raised / merged**: by creation / merge day, for PRs authored by the member.
- **PRs reviewed**: distinct PRs per day on which the member voted, approved or commented, excluding their own PRs.
- **Review wait**: per PR, from being opened (or published, for drafts) to the first vote or comment by someone
  else; stored once per PR in `ReviewedPullRequest` and reported as a median for the PR authors in scope.
- **Issues completed, story points, cycle time**: resolution/completion day; cycle time = first move to an
  "In Progress" category status → resolution (Jira status categories; Azure Boards state categories).
- **Combined per person**: every metric is summed across the person's linked identities; the profile also returns
  per-platform totals (`sources`) and the previous period (`previous`) for trend deltas.
- **DORA**: deployment frequency (successful prod deploys/day), lead time for changes (median, commit → deploy),
  change failure rate (failed / all), time to restore (median, first failure → next successful deploy of the same
  service). Ratings use the DORA performance-cluster thresholds (`dora.calc.ts`).

### 4.4 Sync engine
- `SyncService.execute(run)` is idempotent: for the connection's enabled features it replaces the range's
  `DailyMetric` data and work items, and upserts deployments by external id.
- `SyncDispatcher` decides how syncs run:
  - **With `REDIS_URL`**: a BullMQ queue and worker(s). The nightly schedule is a BullMQ *job scheduler*, so it
    fires once across all instances. A Redis lock serialises syncs per connection; jobs that can't get the lock
    are delayed and retried. `SYNC_WORKER=false` makes an instance enqueue-only.
  - **Without Redis**: in-process execution with an in-memory lock and a local cron.
- **Webhooks** (`POST /api/webhooks/:connectionId`) are verified, then trigger a **debounced** re-sync of the
  affected days (yesterday → today, plus any older day in the payload, up to 30 days back).
  `WEBHOOK_DEBOUNCE_MS` (default 60 s) coalesces bursts into one sync covering every day any event in the burst
  named. Events that arrive while that sync is running schedule a follow-up.

---

## 5. API surface

| Method | Path | Access |
|---|---|---|
| GET/POST | `/api/setup/status`, `/api/setup/complete` | public (complete once; token in prod) |
| POST | `/api/auth/login`, `/refresh`, `/logout`, `/forgot-password`, `/reset-password` | public, rate-limited |
| GET/POST | `/api/auth/me`, `/api/auth/change-password` | signed in |
| CRUD | `/api/users` (+ `POST /:id/reset-link`) | admin (TLs), admin + TL (EMs) |
| GET | `/api/org/tree` | scoped |
| CRUD | `/api/members`, `PUT/DELETE /members/:id/identities/:connectionId` | scoped |
| GET | `/api/integrations`, `/providers`, `/:id/users?q=` | signed in |
| CRUD/POST | `/api/integrations`, `/:id/test`, `/:id/sync`, `/:id/runs[/:runId]`, `/:id/webhook` | admin |
| POST | `/api/webhooks/:connectionId` | signature / token |
| GET | `/api/metrics/summary`, `/rollup?groupBy=manager\|tribe`, `/members/:id` | scoped |
| GET/PATCH | `/api/dora/summary`, `/dora/services`, `/dora/services/:id` (owner) | scoped; PATCH admin + TL |
| GET | `/api/audit?cursor&entityType` | admin |
| GET | `/api/health` | public |

---

## 6. UI

- **Shell**: responsive navigation for Dashboard, Delivery, Organization, Members, Integrations and Audit log,
  with a theme toggle and account menu.
- **Dashboard**: date-range picker (presets + custom), KPI stats, stacked activity trend chart, DORA
  summary card, and a Members / Teams / Tribes table.
- **Delivery (DORA)**: four KPI cards with Elite/High/Medium/Low badges, deployments-per-day chart,
  team filter, and a services table where admins/TLs assign the owning team.
- **Members**: identity linking with **live autocomplete** from each platform (`searchUsers`). The member
  page has daily charts.
- **Integrations**: provider picker, a form generated from each adapter's config, Test, background sync
  with live status polling, and a webhook dialog (URL, generated or provider-issued secret, setup steps).
- **Organization**: tribe → team → member tree, add people, **one-time password reset links**.
- **Account** (change password), **Forgot / Reset password**, **Audit log** (filter, load more).

---

## 7. Security

- Access token (15 min) lives **in memory only**. The refresh token is an **httpOnly, SameSite=Strict
  cookie** scoped to `/api/auth`, rotated on every use and stored hashed. Replaying a rotated token
  revokes the whole token family and is audited; a 30-second grace window covers parallel tabs.
- Changing or resetting a password revokes all refresh tokens. Reset links are single-use and hashed:
  1 h for self-service, 72 h when an admin or TL issues one. Forgot-password never reveals whether an
  account exists.
- `JWT_SECRET` must be at least 32 characters, or the API refuses to start.
- Integration and webhook secrets use AES-256-GCM (`APP_ENCRYPTION_KEY`) and are never returned by the API.
- Rate limiting (`@nestjs/throttler`): global, plus a stricter limit on credential endpoints.
- Helmet, strict CORS with credentials, DTO whitelisting, Prisma-parameterised queries.
- **Audit log** covers sign-ins (including failures), setup, user/member/identity/integration/service
  changes, sync requests, webhook secret changes and password events, with actor and client IP
  (`TRUST_PROXY` for load balancers).

---

## 8. Data limitations

- **Timezones**: activity is bucketed by UTC day. A per-org timezone setting would shift day boundaries.
- **Azure Boards backfills** read the history of every counted work item changed in the period, one item
  per request, because filtering by person in WIQL fails outright when one linked account is unknown. The
  nightly and webhook syncs touch few items; long backfills of busy projects are slow (see the Azure DevOps
  guide).
- **Draft pull requests**: Azure DevOps has no documented publish time. Review wait reads it from the PR's
  activity threads; drafts whose publish time can't be found are left out of the median.
- **Azure DevOps deployments** come from build pipelines matched by name. Classic Release pipelines and
  YAML environments' deployment records would be more precise.

---

## 9. Measuring responsibly

Activity counts are **signals, not performance scores**. They are easy to game and leave out design,
mentoring, incident and review work. Cadence defaults to **team- and trend-level** views; individual
views are for 1:1 conversations, not ranking. DORA metrics describe the delivery *system*: a team's
pipeline, not an individual.
