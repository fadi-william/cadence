# Connect Jira

Jira tells Cadence **what got done**: issues each person completed, their story points, how long work
took from "In Progress" to "Done" (cycle time), and how long each person held a ticket before it moved
on (assignments). Cadence only reads from Jira; it never changes anything.

Both **Jira Cloud** and **Jira Server / Data Center** are supported.

## 1. Create a token

**Jira Cloud:** create an API token for the account Cadence will use (a dedicated "bot" account works
well):

1. Go to **id.atlassian.com → Security → Create and manage API tokens**.
2. Choose **Create API token**, name it `Cadence`, and copy the token.

The account must be able to **browse the projects** you want to measure.

**Server / Data Center:** create a **Personal Access Token** from **Profile → Personal Access Tokens**.

## 2. Add the connection

As an administrator, open **Integrations → Connect Jira** and fill in:

| Field | Example | Notes |
|---|---|---|
| **Name** | `Jira` | Shown on cards and in each person's profile. |
| **Base URL** | `https://your-company.atlassian.net` | Your Jira address, without a trailing path. |
| **Deployment** | Jira Cloud | Or *Server / Data Center*. |
| **Account e-mail** | `bot@cadence.local` | **Cloud only**: the e-mail of the account that owns the token. |
| **Story points field id** | `customfield_10016` | Optional. Leave empty to skip story points ([how to find it](#finding-the-story-points-field)). |
| **Project keys** | `CORE, WEB` | Optional. Empty means every project the account can see. |
| **API token** | n/a | Stored encrypted; never shown again. |

Choose **Save**, then **Test** on the new card. You should see *"Authenticated as …"*.

## 3. Link people to their Jira accounts

On **People**, open a person's **⋯ menu → Link identities**. In the Jira field, start typing a name or
e-mail: Cadence searches your Jira users. Pick the right one and choose **Save**.

What gets stored:

- **Jira Cloud**: the person's **accountId** (for example `5b10ac8d82e05b22cc7d4ef5`). You can also
  find it in the URL of their Jira profile page (`…/jira/people/<accountId>`).
- **Server / Data Center**: their **username**.

## 4. Sync

Choose **Sync 14 days** on the connection card. The card shows the progress and the result. After that,
Cadence syncs automatically **every night** (see `SYNC_CRON`).

## What Cadence reads

For each linked person, Cadence asks Jira for issues (optionally limited to the configured
**projects**) that either:

- are **assigned to** them and moved into a **Done** status category during the period, or
- were **assigned to them at any point** during the period, done or not.

It reads each issue's **history** (status and assignee changes). Search results include only about the
latest 100 history entries, so for issues with more, Cadence fetches the full history separately.

From each issue it takes:

| Metric | How it's calculated |
|---|---|
| **Issues done** | Counted on the day the issue was resolved, for **everyone who held it**. Team and tribe totals count it once. |
| **Story points** | The value of your story points field, if set. Credited with *Issues done*, to each person who held it. |
| **Cycle time** | From the first move into an *In Progress*-category status to resolution. |
| **Assignments** | Each period one person was the assignee, counted on the day it ended. |
| **Hold time** | How long each completed assignment lasted. |
| **Rework** | Assignments of a ticket to someone who had already held it. |

See [Assignments and hold time](metrics.md#assignments-and-hold-time) for the exact rules (hand-overs,
unassigned time, reopened tickets, who gets credit).

## Optional: near real-time updates with a webhook

By default data refreshes nightly or when you choose *Sync*. A webhook lets Jira tell Cadence when
something changes, so the affected days are re-synced within about a minute.

1. In Cadence, open the connection's **webhook** dialog (the hook icon) and choose **Generate secret**.
   Copy the **payload URL** and the **secret** (the secret is shown only once).
2. In Jira, go to **Settings → System → WebHooks → Create a WebHook**:
   - **URL**: the payload URL from Cadence
   - **Secret**: the secret from Cadence
   - **Events**: *Issue created* and *Issue updated*
3. Save. Jira signs each request (`X-Hub-Signature`) and Cadence rejects anything unsigned.

> Your Cadence API must be reachable from Jira for webhooks to work. If it isn't, the nightly sync
> still keeps everything up to date.

## Finding the story points field

Jira stores story points in a custom field whose id differs between sites. Two ways to find it:

- **Jira admin**: *Settings → Issues → Custom fields*, find **Story Points** (or *Story point estimate*);
  the id is in the edit link (`…customFieldId=10016` means `customfield_10016`).
- **API**: open `https://your-company.atlassian.net/rest/api/3/field` while signed in and search the
  page for `Story`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| *Test* fails with **401** | Check the e-mail (Cloud) and that the token belongs to that account. |
| *Test* works but nobody gets issues | Make sure people are linked to the right accountId, and the account can browse their projects. |
| Story points are always 0 | Set the **story points field id**. |
| Cycle time is empty | Issues were never moved through an *In Progress* status, so there is nothing to measure. |
| Someone has assignments but no *Issues done* | Expected: the tickets they held aren't done yet. They're credited on the day each one is resolved. |
| A team's *Issues done* is less than the sum of its people | Expected: a ticket several teammates held counts once for the team. |
| Assignments appear on old days after an upgrade, or team *Issues done* is 0 for older days | Run **Sync** with a longer range once: assignments and team totals are only calculated for days synced after the upgrade. |
