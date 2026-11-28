import { ItemChange, buildAssignments } from './assignments';

// 1 To Do (new) · 3 In Progress · 4 Code Review · 6 QA (indeterminate) · 5 Done (done)
const categories = new Map([
  ['1', 'new'],
  ['3', 'indeterminate'],
  ['4', 'indeterminate'],
  ['6', 'indeterminate'],
  ['5', 'done'],
]);
const at = (day: number, hour: number, minute = 0) =>
  `2026-11-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000+0000`;
const status = (from: string, to: string) => ({ field: 'status' as const, from, to });
const assignee = (from: string | null, to: string | null) => ({ field: 'assignee' as const, from, to });

const summary = (changes: ItemChange[], current: { assignee: string | null; status: string }) =>
  buildAssignments({
    created: at(2, 8),
    currentAssignee: current.assignee,
    currentStatus: current.status,
    changes,
    isDone: (s) => !!s && categories.get(s) === 'done',
  }).map((a) => ({ who: a.assignee, hours: a.hours, outcome: a.outcome, rework: a.rework }));

describe('buildAssignments', () => {
  it('splits a ticket that moves between people at each stage, counting a return as rework', () => {
    const histories: ItemChange[] = [
      { at: at(2, 9), fields: [status('1', '3'), assignee(null, 'salma')] }, // Mon: dev starts
      { at: at(3, 15), fields: [status('3', '4'), assignee('salma', 'karim')] }, // Tue: to review
      { at: at(4, 10), fields: [status('4', '3'), assignee('karim', 'salma')] }, // Wed: sent back
      { at: at(4, 16), fields: [status('3', '6'), assignee('salma', 'nadia')] }, // Wed: to QA
      { at: at(5, 12), fields: [status('6', '5')] }, // Thu: done
    ];
    expect(summary(histories, { assignee: 'nadia', status: '5' })).toEqual([
      { who: 'salma', hours: 30, outcome: 'completed', rework: false },
      { who: 'karim', hours: 19, outcome: 'completed', rework: false },
      { who: 'salma', hours: 6, outcome: 'completed', rework: true },
      { who: 'nadia', hours: 20, outcome: 'completed', rework: false },
    ]);
  });

  it('marks a reassignment without a stage change as a hand-over', () => {
    const histories: ItemChange[] = [
      { at: at(2, 9), fields: [status('1', '3'), assignee(null, 'salma')] },
      { at: at(3, 9), fields: [assignee('salma', 'sherif')] }, // Salma off sick
      { at: at(4, 9), fields: [status('3', '5')] },
    ];
    expect(summary(histories, { assignee: 'sherif', status: '5' })).toEqual([
      { who: 'salma', hours: 24, outcome: 'handedOver', rework: false },
      { who: 'sherif', hours: 24, outcome: 'completed', rework: false },
    ]);
  });

  it('charges unassigned time to nobody', () => {
    const histories: ItemChange[] = [
      { at: at(2, 9), fields: [status('1', '3'), assignee(null, 'salma')] },
      { at: at(2, 17), fields: [status('3', '6'), assignee('salma', null)] }, // waits in the QA queue
      { at: at(4, 9), fields: [assignee(null, 'nadia')] },
      { at: at(4, 12), fields: [status('6', '5')] },
    ];
    expect(summary(histories, { assignee: 'nadia', status: '5' })).toEqual([
      { who: 'salma', hours: 8, outcome: 'completed', rework: false },
      { who: 'nadia', hours: 3, outcome: 'completed', rework: false },
    ]);
  });

  it('starts with the creation-time assignee and does not report the still-open assignment', () => {
    const histories: ItemChange[] = [{ at: at(2, 20), fields: [status('1', '3'), assignee('salma', 'karim')] }];
    expect(summary(histories, { assignee: 'karim', status: '3' })).toEqual([
      { who: 'salma', hours: 12, outcome: 'completed', rework: false },
    ]);
  });

  it('ignores assignments shorter than five minutes', () => {
    const histories: ItemChange[] = [
      { at: at(2, 9), fields: [assignee(null, 'salma')] },
      { at: at(2, 9, 2), fields: [assignee('salma', 'karim')] }, // mis-click
      { at: at(2, 12), fields: [status('1', '5')] },
    ];
    expect(summary(histories, { assignee: 'karim', status: '5' })).toEqual([
      { who: 'karim', hours: 2 + 58 / 60, outcome: 'completed', rework: false },
    ]);
  });

  it('opens a new assignment when a Done ticket is reopened', () => {
    const histories: ItemChange[] = [
      { at: at(2, 9), fields: [status('1', '3'), assignee(null, 'salma')] },
      { at: at(2, 13), fields: [status('3', '5')] },
      { at: at(3, 9), fields: [assignee('salma', 'karim')] }, // reassigned while Done: no assignment
      { at: at(3, 10), fields: [status('5', '3')] }, // reopened
      { at: at(3, 14), fields: [status('3', '5')] },
    ];
    expect(summary(histories, { assignee: 'karim', status: '5' })).toEqual([
      { who: 'salma', hours: 4, outcome: 'completed', rework: false },
      { who: 'karim', hours: 4, outcome: 'completed', rework: false },
    ]);
  });
});
