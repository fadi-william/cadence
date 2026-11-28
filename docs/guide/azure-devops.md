# Connect Azure DevOps

Azure DevOps tells Cadence **how code moves**: commits, pull requests raised and merged, reviews given to
teammates, and production deployments for **DORA delivery metrics**. With **Azure Boards** it also tells
Cadence **how work flows**: completed work items, story points, cycle time and assignments, just like
Jira. Cadence only reads; it never pushes, comments, approves or edits work items.

Both **Azure DevOps Services** (`dev.azure.com`) and **Azure DevOps Server** are supported.

## 1. Create a Personal Access Token

1. In Azure DevOps, open **User settings → Personal access tokens → New Token**.
2. Name it `Cadence`, choose your **organization**, and set an expiry that suits your policy.
3. Under **Scopes**, choose *Custom defined* and tick only:

   | Scope | Why |
   |---|---|
   | **Work Items → Read** | Azure Boards work items and their history |
   | **Code → Read** | Repositories, commits, pull requests and review threads |
   | **Build → Read** | Pipeline runs, used for deployments (DORA) |
   | **Identity → Read** | Finding people when you link their accounts |
   | **Project and Team → Read** | Listing projects |

4. Create the token and copy it.

> Tip: create the token from a service account that can read every project you want to measure.

## 2. Add the connection

As an administrator, open **Integrations → Connect Azure DevOps**:

| Field | Example | Notes |
|---|---|---|
| **Name** | `Azure DevOps` | Shown on cards and in each person's profile. |
| **Base URL** | `https://dev.azure.com/your-org` | For Server: your collection URL, e.g. `https://ado.cadence.local/DefaultCollection`. |
| **Projects** | `Retail, Growth` | Optional. Empty means every project in the organization. |
| **Work item types** | `User Story, Bug` | Optional. Which Boards types count ([details](#azure-boards-work-items)). |
| **Story points field** | `Custom.StoryPoints` | Optional. Field reference name for story points ([details](#story-points)). |
| **Deployment pipelines** | `storefront-deploy, web-release` | Optional. Which pipelines deploy to production ([details](#deployments-and-dora)). |
| **Environment label** | `production` | The name shown for those deployments. |
| **Personal access token** | n/a | Stored encrypted; never shown again. |

Choose **Save**, then **Test** on the card. You should see *"Connected — N project(s) visible"*.

## 3. Link people to their Azure DevOps accounts

On **People**, open a person's **⋯ menu → Link identities**, start typing their name in the Azure DevOps
field and pick them from the suggestions.

Cadence stores the person's **uniqueName**, which is usually their sign-in e-mail (for example
`mina@cadence.local`). Commits are matched on the author e-mail, so make sure people commit with the same
address.

## 4. Sync

Choose **Sync 14 days** on the card. After that Cadence syncs **every night**. Large organizations
can take a few minutes the first time.

## What Cadence reads

| Metric | How it's calculated |
|---|---|
| **Commits** | Commits in the selected projects' repositories, by author e-mail and author date. |
| **PRs raised** | Pull requests a person created, on the day they created them. |
| **PRs merged** | Their pull requests that were completed, on the day they were merged. |
| **Reviews** | Distinct pull requests a person **voted or commented on** each day, excluding their own. |
| **Review wait** | For each pull request, the time from it being opened (or published, for drafts) to the first vote or comment by someone else. See [How metrics work](metrics.md#review-wait-time). |

Plus the Azure Boards metrics below. These numbers are merged with the person's Jira work into a single
**combined profile**.

## Azure Boards work items

Cadence measures Boards work items with **the same rules as Jira** (see
[How metrics work](metrics.md#assignments-and-hold-time)):

| Metric | How it's calculated |
|---|---|
| **Issues done** | Work items that moved into a *Completed* state in the period, credited on that day to **everyone who held them** and to the current assignee. |
| **Story points** | The item's story points, credited like *Issues done*. |
| **Cycle time** | From the first move into an *In Progress* state to completion. |
| **Assignments, hold time, rework** | Each period one person was the item's **Assigned To**, from the item's history. |

### Which work items count

By default, Cadence counts the work item types on each project's **requirement and bug backlogs**, so it
works for every process, including inherited and custom ones:

| Process | Counted types |
|---|---|
| Agile | User Story, Bug |
| Scrum | Product Backlog Item, Bug |
| CMMI | Requirement, Bug |
| Basic | Issue |

Tasks, features and epics are not counted. To choose the types yourself, list them under **Work item
types** (for example `User Story, Bug, Spike`). Types that don't exist in a project are skipped.

### States and state categories

Cadence never looks at state *names*, only at the **state category** each state belongs to, so renamed
and custom states work without setup:

| State category | Example states | In Cadence |
|---|---|---|
| **Proposed** | New, To Do, Approved | Not started. |
| **In Progress** | Active, Committed, Doing | Started. The first move here starts the **cycle time**. |
| **Resolved** | Resolved | **Not done yet.** It usually means "fixed, waiting for verification", so it's an ordinary stage move. |
| **Completed** | Closed, Done | **Done.** The item is credited on the day it moved here. |
| **Removed** | Removed | **Never credited.** The assignment that ends with the removal isn't counted either. |

If a completed item is reopened and completed again, the **last** completion counts. An item that is
currently not in a *Completed* state (for example, reopened or removed later) isn't credited.

### Story points

If **Story points field** is set, Cadence reads that field (use its reference name, for example
`Custom.StoryPoints`; find it under **Organization settings → Process → Fields**). Otherwise it uses the
first of these the item has: **Story Points** (Agile), **Effort** (Scrum), **Size** (CMMI). Items without
a value count as 0 points.

### Work item keys

Each work item is identified as `<project>-<id>`, for example `Retail-1234`.

### Limitation: long Boards backfills are slow

**What happens.** To credit hand-overs and hold time, Cadence needs each work item's full history: who
held it and when its state changed. Azure DevOps only returns that history **one work item at a time**, so
a sync makes one request (more for long histories) for **every counted work item changed since the start
of the period**, whether or not anyone you track touched it.

**Why Cadence can't narrow it down first.** Jira lets Cadence ask only for issues your people held. Azure
DevOps's query language can filter by person too (`[System.AssignedTo] EVER '…'`), but if a single linked
account is unknown to Azure DevOps (someone who left, or a typo), the **whole query fails** and nothing
syncs. Cadence therefore reads every changed item and matches people itself, which is always correct but
costs more requests.

**What it means in practice.**

| Sync | Work items read | Rough duration (estimate) |
|---|---|---|
| Nightly (2 days) | Items changed in the last 2 days | Seconds |
| Webhook update | Items changed in the last few days | Seconds |
| *Sync 14 days* | Items changed in the last 2 weeks | Up to a few minutes on a busy project |
| One-year backfill via the API | Every item changed in the last year | Can take a long time (tens of minutes for tens of thousands of items) |

Requests run 4 at a time per project, and if Azure DevOps rate-limits Cadence (HTTP 429), Cadence waits
as instructed and retries, so a long backfill is slower but still completes. Code and deployments are not
affected: they don't need per-item history.

**How to keep it fast.**

- Set **Projects** to the projects your teams actually use.
- Set **Work item types** if your backlogs contain types you don't need.
- Backfill in smaller ranges (for example a month at a time) rather than a whole year at once.
- Turn on [service hooks](#optional-near-real-time-updates-with-service-hooks) so day-to-day updates only
  re-read the few items that changed.

### Limitation: review wait and draft pull requests

**What happens.** Review wait should start when a pull request is ready for review. For a pull request that
started as a **draft**, that's when it was **published**, not when it was created. Azure DevOps doesn't
record that moment in any documented field: a pull request only has its creation date and whether it's a
draft *right now*.

**What Cadence does.** The publish event does appear in the pull request's activity history (the timeline
you see in the web UI), so Cadence reads it from there:

| Pull request | Review wait starts | Counted? |
|---|---|---|
| Never a draft | when it was opened | Yes |
| Started as a draft, publish time found | when it was published | Yes |
| Started as a draft, publish time **not** found | n/a | **No**, left out |
| Still a draft | n/a | **No** |

Leaving those pull requests out keeps draft time from inflating the number: a draft that sat for two days
never shows up as a two-day review wait. The format of the activity history isn't documented by
Microsoft, so if Azure DevOps changes it, more drafts may be left out (the review wait still counts every
pull request that was never a draft). If Azure DevOps doesn't report a draft's history at all, that pull
request is timed from when it was opened.

## Deployments and DORA

Cadence treats completed runs of your **deployment pipelines** as production deployments:

- If you list **Deployment pipelines**, exactly those pipelines count.
- Otherwise, any pipeline whose name contains `deploy`, `release`, `prod` or `cd` counts.
- A **succeeded** (or partially succeeded) run is a successful deployment, a **failed** run is a failed
  deployment, and **canceled** runs are ignored.
- **Lead time** is measured from the author time of the deployed commit to the end of the run.

Each pipeline becomes a **service** under **Delivery → Services**. Assign each service to the **team that
owns it**, so DORA metrics roll up to the right managers and tribes:

| DORA metric | Meaning in Cadence |
|---|---|
| **Deployment frequency** | Successful production deployments per day |
| **Lead time for changes** | Median time from commit to production |
| **Change failure rate** | Failed deployments ÷ all deployments |
| **Time to restore** | Median time from a failed deployment to the next successful one of the same service |

## Optional: near real-time updates with service hooks

1. In Cadence, open the connection's **webhook** dialog and choose **Generate secret**. Copy the
   **payload URL** and the **secret**.
2. In Azure DevOps, open **Project settings → Service hooks → Create subscription → Web Hooks**, and
   create one subscription for each event you care about:
   - *Work item created*, *Work item updated* (covers completion, reassignment and every state change)
   - *Code pushed*
   - *Pull request created*, *Pull request updated*, *Pull request merge attempted*
   - *Build completed* (for deployments)
3. For each subscription set:
   - **URL**: the payload URL
   - **HTTP headers**: `X-Cadence-Token: <your secret>`

Cadence re-syncs the affected days about a minute after the last event, so bursts of pushes cost a
single sync.

## Troubleshooting

| Symptom | Fix |
|---|---|
| *Test* fails with **401/203** | The token expired or lacks a scope from step 1. |
| Commits are missing for someone | Their commits use a different e-mail than their linked uniqueName. |
| No services under Delivery | No pipeline matched. Set **Deployment pipelines** explicitly. |
| Done work items are missing | The token lacks **Work Items → Read**, the type isn't on a requirement or bug backlog (set **Work item types**), or the item is *Resolved* rather than *Completed*. |
| Story points are 0 | Your process uses a custom field. Set **Story points field** to its reference name. |
| A Boards sync takes a long time | Expected on long backfills of busy projects: see [Limitation: long Boards backfills are slow](#limitation-long-boards-backfills-are-slow). |
| Lead time is empty | The pipeline builds from a repository outside Azure Repos, so the commit time can't be looked up. |
