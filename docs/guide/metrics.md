# How metrics work

Cadence turns activity from Jira and Azure DevOps into a few clear numbers, **per person, per team and
per tribe**. This page explains what each number means, so everyone reads them the same way.

## One combined profile per person

Every person can be linked to **one Jira account and one Azure DevOps account**. Cadence merges both.
Work tracking (issues, story points, cycle time, assignments) can come from **Jira**, from **Azure Boards**,
or from both:

- **Totals** add up activity from all linked platforms.
- **Where the work happens** shows each platform's share and its own numbers.
- **Combined timeline** puts code activity (Azure DevOps) and completed issues (Jira or Azure Boards) on one chart.
- **Activity calendar** shows the last six months at a glance.
- Every number is compared with the **previous period of the same length** (the ↗/↘ badges).

## Activity metrics

| Metric | Source | Counted on |
|---|---|---|
| **Commits** | Azure DevOps | the commit's author date |
| **PRs raised** | Azure DevOps | the day the pull request was created |
| **PRs merged** | Azure DevOps | the day it was completed |
| **Reviews** | Azure DevOps | each day someone voted or commented on someone else's pull request (once per PR per day) |
| **Review wait** | Azure DevOps | the day a pull request got its first review: how long it waited (median, [details](#review-wait-time)) |
| **Issues done** | Jira, Azure Boards | the day the issue was resolved (Boards: moved to *Completed*), for **everyone who held it** ([details](#who-gets-credit-for-a-done-ticket)) |
| **Story points** | Jira, Azure Boards | summed from resolved issues, credited like *Issues done* |
| **Cycle time** | Jira, Azure Boards | from first *In Progress* to resolution (average) |
| **Assignments** | Jira, Azure Boards | the day each assignment ended with a stage move ([details](#assignments-and-hold-time)) |
| **Hold time** | Jira, Azure Boards | how long each completed assignment lasted (average) |
| **Rework** | Jira, Azure Boards | the day an assignment ended for someone who had already held that ticket |

Days are grouped in **UTC**.

Jira and Azure Boards follow the same rules. "Done" means a status in Jira's *Done* category, or a state
in Azure Boards' *Completed* category; "In Progress" means Jira's *In Progress* category or Boards'
*In Progress* category. In Azure Boards, *Resolved* is not done and *Removed* items are never credited
(see [Azure DevOps → Azure Boards](azure-devops.md#azure-boards-work-items)).

## Assignments and hold time

Tickets often pass through several people before they are done: one person develops, another reviews,
a third tests. Cadence splits each ticket into **assignments** to show everyone's part, and credits the
finished ticket to everyone who worked on it.

An **assignment** is one continuous period during which one person was the ticket's assignee.

- It **starts** when the person becomes the assignee (or when the ticket is created already assigned
  to them, or when a Done ticket they're assigned to is reopened).
- It **ends** when the ticket is reassigned, unassigned, or moves into a *Done*-category status.
- Its **hold time** is the time between start and end.

### Example

```
Mon 09:00  assigned to Salma   · In Progress
Tue 15:00  assigned to Karim   · Code Review     Salma: 30h  ✓ completed
Wed 10:00  assigned to Salma   · In Progress     Karim: 19h  ✓ completed  (sent back)
Wed 16:00  assigned to Nadia   · QA              Salma:  6h  ✓ completed  ↺ rework
Thu 12:00  Done                                  Nadia: 20h  ✓ completed
```

Salma has **two** assignments (30h and 6h), Karim and Nadia one each. When the ticket is done, Salma, Karim
**and** Nadia each get **one** issue done (and its story points). Salma gets it once, not twice. If all
three are in the same team, the team's total is still **one** issue.

### The rules

| Rule | What it means |
|---|---|
| **Every reassignment starts a new assignment.** | If a ticket comes back to someone, that's a new assignment, not a continuation of the old one. |
| **Completed = the stage moved.** | An assignment is *completed* if the ticket's status changed while that person held it, including the move to Done. A transition and a reassignment made together count for the person handing the ticket on. |
| **Handed over = reassigned without a stage move.** | For example, when someone is off sick and a colleague takes the ticket. It's counted separately and **not** included in hold time, so it doesn't look like finished work. |
| **Rework = held it before.** | A second or later assignment of the same ticket to the same person is flagged as rework. A high rework count usually points to unclear requirements or late feedback, not to the person. |
| **One assignment can span stages.** | If one person moves a ticket through several stages without reassigning it, that's a single assignment. |
| **Unassigned time belongs to nobody.** | While a ticket has no assignee (for example, waiting in a *Ready for QA* queue), no one's hold time grows. |
| **Done is the end.** | Reassignments while a ticket is Done don't create assignments. Reopening it starts a new one for the current assignee. |
| **Very short assignments are ignored.** | Assignments under **5 minutes** (mis-clicks, quick re-routes) are dropped. |
| **Only finished assignments count.** | An assignment shows up on the day it **ends**, whether or not the ticket is done yet. The one a person still holds appears once it ends. |
| **Calendar time, not effort.** | Hold time includes nights, weekends, and time spent on other tickets in parallel. It says how long a ticket sat with someone, not how long they worked on it. |

### Who gets credit for a done ticket

| Rule | What it means |
|---|---|
| **Everyone who held it.** | Every linked person with at least one assignment on the ticket (completed *or* handed over), plus whoever is assigned when it's resolved, gets **1** issue done. |
| **Once per person.** | Holding a ticket twice (rework) still counts as one issue done for that person. |
| **Story points and cycle time go with it.** | Each contributor gets the ticket's full story points and its cycle time. Points are not split. |
| **Counted once for groups.** | Team, tribe and dashboard totals count each ticket **once**, however many of their people held it. A team's issues done can therefore be **less than** the sum of its people. |
| **Counted when it's done.** | Credit lands on the day the ticket is resolved, even for people whose assignment ended weeks earlier. |
| **Short assignments don't count.** | Someone who held the ticket for under 5 minutes isn't credited, unless they resolved it. |

Where to see them: each person's profile shows **Assignments**, **Hold** and **Rework** on the card of
each connection that tracks work (Jira, or Azure DevOps with Azure Boards). Team and tribe totals are available from the API (`/metrics/rollup`).

## Teams and tribes

The dashboard's **Breakdown** switches between **People**, **Teams** (one row per engineering manager)
and **Tribes** (one row per tribe lead). Each row adds up the people below it, except *Issues done*,
*Story points* and *Cycle time*: those count each ticket once, even if several of the row's people held it.

What each person can see depends on their role: managers see their own team, tribe leads their tribe,
admins everyone.

## Delivery performance (DORA)

DORA metrics describe how a **team's delivery system** performs, not how an individual performs. They come
from production deployments (see [Azure DevOps → Deployments](azure-devops.md)).

| Metric | Elite | High | Medium | Low |
|---|---|---|---|---|
| **Deployment frequency** | daily or more | weekly | monthly | less often |
| **Lead time for changes** | < 1 day | < 1 week | < 1 month | longer |
| **Change failure rate** | ≤ 5% | ≤ 10% | ≤ 15% | higher |
| **Time to restore** | < 1 hour | < 1 day | < 1 week | longer |

The thresholds follow the performance clusters of the DORA *State of DevOps* research.

## Review wait time

Next to lead time, the **Delivery** page and the dashboard show **Review wait**: how long pull requests
waited before anyone looked at them. Each person's profile shows the same figure for their own pull
requests, compared with the previous period.

| | |
|---|---|
| **Starts** | when the pull request is opened, or when it's **published** if it started as a draft |
| **Ends** | at its **first review**: the first vote or comment by anyone other than the author |
| **Shown as** | the **median** over pull requests whose first review fell in the period, with how many there were |
| **Scope** | pull requests **authored** by the people in view (your team, your tribe, everyone), wherever the reviewer sits |

**Example.** Mina opens PR #42 as a draft on Monday 09:00 and keeps working. She publishes it on Wednesday
09:00 and a teammate comments at 11:00. The review wait is **2 hours**: the draft days don't count, because
nobody was asked to review yet.

**Why the median.** One pull request left for a week shouldn't hide that most get picked up within an hour or
two. The median shows the typical wait; the count tells you how many pull requests it's based on.

Things to know:

- **Calendar time.** Nights and weekends count, like lead time. A pull request opened on Friday evening
  waits over the weekend.
- **Only reviewed pull requests count.** A pull request still waiting for its first review isn't included
  until it gets one, just as lead time only counts changes that were deployed.
- **Drafts that can't be timed are left out.** Azure DevOps doesn't officially record when a draft was
  published. Cadence reads it from the pull request's activity history when it can; when a pull request was
  a draft but the publish time can't be found, it's left out rather than counted from creation (see
  [Azure DevOps → Review wait and draft pull requests](azure-devops.md#limitation-review-wait-and-draft-pull-requests)).
- **It's not a DORA metric**, so it has no Elite–Low rating. Compare it with your own past periods instead.

A long review wait is a signal about the **team's flow** (review load, focus time, time zones), never about
the author.

## How fresh is the data?

- **Nightly**: every connection syncs the last two days (default 02:00, `SYNC_CRON`).
- **On demand**: *Sync 14 days* on a connection card.
- **Near real time**: with webhooks enabled, changes appear about a minute after they happen.

Re-syncing is always safe: a sync replaces the numbers for its period instead of adding to them.

## Measuring responsibly

Activity counts are **signals, not performance scores**. They are easy to game, and they leave out much
of what makes engineers valuable: design, mentoring, incident response, careful reviews, unblocking
others.

- Look at **trends and teams** first; individual views are for supportive 1:1 conversations.
- Never **rank** people by commits, story points or hold time. A long hold time often means the ticket
  was blocked or the person was helping others.
- Always ask **why** a number moved before drawing conclusions.
- Pair the numbers with what people tell you about their work.

Used this way, Cadence helps you spot bottlenecks and celebrate progress, without turning engineering into
a leaderboard.
