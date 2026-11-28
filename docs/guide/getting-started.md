# Getting started

Cadence is self-hosted: you run it on your own infrastructure, and your Jira and Azure DevOps data never
leaves it. This guide takes you from nothing to a signed-in admin in about ten minutes.

## What you need

| | Minimum | Notes |
|---|---|---|
| **Docker** | Docker Engine 24+ with Compose | The easiest way to run everything. |
| **or Node.js** | Node 22+ and PostgreSQL 16 | If you prefer to run it without containers. |
| **Redis** *(optional)* | Redis 7 | Only needed if you run more than one API instance. |
| **Access** | A Jira site and/or an Azure DevOps organization | Read-only tokens are enough. |

## Option A: run everything with Docker

```bash
git clone https://github.com/fadi-william/Cadence.git
cd Cadence

# Two secrets Cadence needs. Keep APP_ENCRYPTION_KEY safe: it encrypts your integration tokens.
export JWT_SECRET=$(openssl rand -base64 48)
export APP_ENCRYPTION_KEY=$(openssl rand -base64 32)

docker compose --profile app up -d --build
```

Open **http://localhost:8080**. The stack contains PostgreSQL, Redis, the API (which applies database
migrations on start) and the web app.

Running in production? Set these too before `docker compose up`:

```bash
export WEB_ORIGIN=https://cadence.local          # where people open Cadence
export PUBLIC_API_URL=https://cadence.local/api  # used to show webhook URLs
export COOKIE_SECURE=true                         # you are behind HTTPS
```

## Option B: run it locally with Node.js

```bash
git clone https://github.com/fadi-william/Cadence.git
cd Cadence
npm install
docker compose up -d                     # PostgreSQL + Redis only (or bring your own)

cp apps/api/.env.example apps/api/.env   # then set JWT_SECRET and APP_ENCRYPTION_KEY
npm run db:migrate
npm run dev:api                          # http://localhost:3000/api
npm run dev:web                          # http://localhost:4200
```

## First launch

The first time Cadence starts, it creates an **administrator profile without a password**. Open the web
app and you'll land on the welcome screen:

1. Enter your **name** and confirm the admin **e-mail** (defaults to `admin@cadence.local`, change it with
   `DEFAULT_ADMIN_EMAIL`).
2. Choose a **password** (at least 12 characters).
3. In production you're also asked for a **one-time setup token**. It's printed in the API log, so nobody
   else on your network can claim the installation before you do:

   ```bash
   docker compose logs api | grep "Setup token"
   ```

After setup, the welcome screen is closed for good. You're signed in and taken to **Teams & tribes**.

## Build your organization

Cadence mirrors how engineering organizations are usually shaped:

```text
Administrator
 └─ Tribe lead          (e.g. "Retail")
     └─ Engineering manager
         └─ People      (the engineers whose work Cadence summarizes)
```

| Role | Can sign in | Sees | Can manage |
|---|---|---|---|
| **Administrator** | Yes | Everything | Tribe leads, integrations, audit log |
| **Tribe lead** | Yes | Their managers and those managers' people | Managers in their tribe, service ownership |
| **Engineering manager** | Yes | Their own people | Their people and their linked accounts |
| **Person** | No | n/a | n/a |

In **Teams & tribes**, add a tribe lead, then managers under them, then people under each manager.
Each tribe lead and manager gets a password you choose. You can also send them a **one-time reset
link** (the key icon), so they pick their own.

## Next steps

- [Connect Jira](jira.md) to bring in completed issues, story points and cycle time.
- [Connect Azure DevOps](azure-devops.md) for commits, pull requests, reviews and deployments.
- On each person's card choose **Link identities** to tell Cadence which Jira and Azure DevOps accounts
  are theirs. Their activity from both is then **merged into one profile**.

## Try it with demo data

Want to look around before connecting real tools? Load a demo organization (2 tribes, 4 teams,
14 people, 60 days of activity and deployments):

```bash
npm run db:seed:demo
```

Demo accounts use the password `demo-password-123`, for example `ahmed@demo.cadence.local` (a tribe lead).

## Configuration reference

All settings are environment variables of the API (see `apps/api/.env.example`).

| Variable | Default | What it does |
|---|---|---|
| `DATABASE_URL` | n/a | PostgreSQL connection string. **Required.** |
| `JWT_SECRET` | n/a | At least 32 characters. Cadence refuses to start without it. **Required.** |
| `APP_ENCRYPTION_KEY` | n/a | 32 bytes, base64. Encrypts integration tokens. **Required. Don't change it later.** |
| `WEB_ORIGIN` | `http://localhost:4200` | Allowed browser origin(s); used in password-reset links. |
| `PUBLIC_API_URL` | `http://localhost:3000/api` | Public API address, shown as the webhook URL. |
| `SYNC_CRON` | `0 2 * * *` | When the nightly sync runs (`off` to disable). |
| `REDIS_URL` | n/a | Run syncs on a queue, coordinated across API instances. |
| `WEBHOOK_DEBOUNCE_MS` | `60000` | Quiet period before a burst of webhook events triggers one re-sync. |
| `SMTP_URL`, `MAIL_FROM` | n/a | Send password-reset e-mails. Without them, links are written to the API log. |
| `SETUP_TOKEN_REQUIRED` | `true` in production | Require the one-time setup token on first launch. |
| `COOKIE_SECURE` | `true` in production | Mark the session cookie `Secure` (HTTPS only). |
| `TRUST_PROXY` | `loopback` | Trust your load balancer so the audit log records real client IPs. |
| `ACCESS_TOKEN_TTL_SECONDS` | `900` | Lifetime of a sign-in token. |
| `REFRESH_TOKEN_TTL_DAYS` | `14` | How long people stay signed in. |
