import { BadRequestException } from '@nestjs/common';
import { aggregate } from './aggregate';
import { emptyMetricRow, METRIC_COLUMNS, metricColumns, validateFeatures, zeroColumns } from './features';

describe('feature columns', () => {
  it('assign every metric aggregate() writes to exactly one feature', () => {
    const day = new Date('2026-11-01T00:00:00Z');
    const [row] = aggregate([{ memberId: 'm', date: '2026-11-01' }], { from: day, to: day });
    const metrics = Object.keys(row).filter((k) => k !== 'memberId' && k !== 'date');
    const assigned = Object.values(METRIC_COLUMNS).flat();
    expect([...assigned].sort()).toEqual([...metrics].sort());
    expect(new Set(assigned).size).toBe(assigned.length);
  });

  it('zeroColumns and metricColumns ignore features without metrics', () => {
    expect(metricColumns(['DEPLOYMENTS'])).toEqual([]);
    expect(zeroColumns(['SOURCE_CONTROL', 'DEPLOYMENTS'])).toEqual({
      commits: 0,
      prsRaised: 0,
      prsReviewed: 0,
      prsMerged: 0,
    });
  });

  it('emptyMetricRow matches rows with nothing in any metric', () => {
    expect(Object.keys(emptyMetricRow).sort()).toEqual([...Object.values(METRIC_COLUMNS).flat()].sort());
    expect(Object.values(emptyMetricRow).every((v) => v === 0)).toBe(true);
  });
});

describe('validateFeatures', () => {
  const supported = ['WORK_TRACKING', 'SOURCE_CONTROL', 'DEPLOYMENTS'] as const;

  it('dedupes and returns the provider order', () => {
    expect(validateFeatures(['DEPLOYMENTS', 'WORK_TRACKING', 'DEPLOYMENTS'], supported)).toEqual([
      'WORK_TRACKING',
      'DEPLOYMENTS',
    ]);
  });

  it('rejects unsupported and empty lists', () => {
    expect(() => validateFeatures(['DEPLOYMENTS'], ['WORK_TRACKING'])).toThrow(BadRequestException);
    expect(() => validateFeatures([], supported)).toThrow('at least one feature');
  });
});
