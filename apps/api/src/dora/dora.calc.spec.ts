import { median, rate, timeToRestoreHours } from './dora.calc';

const at = (h: number) => new Date(Date.UTC(2026, 10, 1) + h * 36e5);

describe('DORA calculations', () => {
  it('median', () => {
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 10])).toBe(2.5);
  });

  it('time to restore spans first failure → next success, per service', () => {
    const mttr = timeToRestoreHours([
      { serviceId: 'a', status: 'SUCCESS', finishedAt: at(0), leadTimeHours: 1 },
      { serviceId: 'a', status: 'FAILED', finishedAt: at(10), leadTimeHours: null },
      { serviceId: 'a', status: 'FAILED', finishedAt: at(11), leadTimeHours: null },
      { serviceId: 'b', status: 'SUCCESS', finishedAt: at(12), leadTimeHours: 1 }, // other service: no effect
      { serviceId: 'a', status: 'SUCCESS', finishedAt: at(14), leadTimeHours: 1 },
      { serviceId: 'b', status: 'FAILED', finishedAt: at(20), leadTimeHours: null },
      { serviceId: 'b', status: 'SUCCESS', finishedAt: at(22), leadTimeHours: 1 },
    ]);
    expect(mttr).toBe(3); // median of [4, 2]
  });

  it('rates against DORA thresholds', () => {
    expect(rate.deploymentFrequency(2, 10)).toBe('ELITE');
    expect(rate.deploymentFrequency(0.2, 3)).toBe('HIGH');
    expect(rate.deploymentFrequency(0, 0)).toBeNull();
    expect(rate.leadTime(30)).toBe('HIGH');
    expect(rate.changeFailureRate(0.12)).toBe('MEDIUM');
    expect(rate.mttr(0.5)).toBe('ELITE');
    expect(rate.mttr(200)).toBe('LOW');
  });
});
