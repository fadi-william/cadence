/**
 * Splits a work item's history into **assignments**: continuous periods during which one person was the
 * assignee. Provider-neutral and pure: adapters translate their platform's history (Jira changelog, Azure
 * Boards updates, ...) into an {@link ItemHistory}. The rules are documented in docs/guide/metrics.md
 * ("Assignments and hold time").
 *
 * - An assignment starts when someone becomes the assignee (or at creation for the first assignee, or
 *   when a done item is reopened) and ends when the item is reassigned, unassigned or moves into a done
 *   status.
 * - It is **completed** (moved forward) if the status changed while that person held it, including the
 *   move to done. Otherwise it was **handed over** (reassigned without a stage change).
 * - It is **rework** if the same person already held this item before.
 * - Assignments shorter than {@link MIN_ASSIGNMENT_MINUTES} are ignored, and still-open assignments are
 *   not reported (they have not finished yet). Unassigned time belongs to nobody.
 */

/** Assignments shorter than this are treated as noise (e.g. a quick reassign-back) and dropped. */
export const MIN_ASSIGNMENT_MINUTES = 5;

/** One field change within an {@link ItemChange}. */
export interface ItemFieldChange {
  /** Which tracked field changed. */
  field: 'assignee' | 'status';
  /** Previous value (status id/name, or assignee id), or null when it was empty. */
  from: string | null;
  /** New value, or null when cleared (e.g. unassigned). */
  to: string | null;
}

/** The changes made together at one moment (a Jira changelog entry, an Azure Boards update). */
export interface ItemChange {
  /** ISO timestamp of the change. */
  at: string;
  /** Assignee and status changes; other fields are left out by the adapter. */
  fields: ItemFieldChange[];
}

/** A work item's current state and full history, as needed by {@link buildAssignments}. */
export interface ItemHistory {
  /** ISO timestamp of item creation. */
  created: string;
  /** Current assignee id, in the same form as the history's assignee values, or null. */
  currentAssignee: string | null;
  /** Current status, in the same form as the history's status values. */
  currentStatus: string | null;
  /** Changes in any order; they are sorted by time. */
  changes: ItemChange[];
  /**
   * Whether a status ends the item's active life (e.g. Jira's Done category). No assignment is open while
   * the item is in such a status; leaving it again counts as a reopen.
   */
  isDone: (status: string | null) => boolean;
}

/** One finished period during which `assignee` held the item. */
export interface Assignment {
  /** Assignee id as it appears in the history. */
  assignee: string;
  start: Date;
  end: Date;
  /** Calendar hours from `start` to `end`. */
  hours: number;
  /** `completed` when the status changed while held, `handedOver` when reassigned without a status change. */
  outcome: 'completed' | 'handedOver';
  /** True when the same person had already held the item earlier. */
  rework: boolean;
}

const isAssignee = (f: ItemFieldChange) => f.field === 'assignee';
const isStatus = (f: ItemFieldChange) => f.field === 'status';

/**
 * Replays an item's history into its finished assignments, following the rules at the top of this file.
 *
 * @returns Assignments in the order they ended.
 */
export function buildAssignments(input: ItemHistory): Assignment[] {
  const changes = [...input.changes].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  const isDone = input.isDone;

  // Reconstruct the state at creation from the first change of each field.
  const firstAssignee = changes.flatMap((c) => c.fields).find(isAssignee);
  const firstStatus = changes.flatMap((c) => c.fields).find(isStatus);
  let assignee = firstAssignee ? firstAssignee.from : input.currentAssignee;
  let status = firstStatus ? firstStatus.from : input.currentStatus;

  const out: Assignment[] = [];
  const held = new Set<string>();
  let open: { assignee: string; start: Date; moved: boolean } | null = null;

  const openFor = (at: Date) => {
    open = assignee && !isDone(status) ? { assignee, start: at, moved: false } : null;
  };
  const close = (at: Date) => {
    const o = open;
    open = null;
    if (!o) return;
    const hours = (at.getTime() - o.start.getTime()) / 36e5;
    if (hours * 60 < MIN_ASSIGNMENT_MINUTES) return;
    out.push({
      assignee: o.assignee,
      start: o.start,
      end: at,
      hours,
      outcome: o.moved ? 'completed' : 'handedOver',
      rework: held.has(o.assignee),
    });
    held.add(o.assignee);
  };

  openFor(new Date(input.created));
  for (const c of changes) {
    const at = new Date(c.at);
    // A transition and a reassignment in the same change: the stage move belongs to the outgoing assignee.
    for (const f of c.fields.filter(isStatus)) {
      const wasDone = isDone(status);
      status = f.to;
      if (open) (open as { moved: boolean }).moved = true;
      if (!wasDone && isDone(status)) close(at);
      else if (wasDone && !isDone(status)) openFor(at); // reopened
    }
    for (const f of c.fields.filter(isAssignee)) {
      if (f.to === assignee) continue;
      close(at);
      assignee = f.to;
      openFor(at);
    }
  }
  return out;
}
