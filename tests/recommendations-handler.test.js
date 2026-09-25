import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const query = vi.fn();
vi.mock('../api/_lib/db.js', () => ({ getPool: () => ({ query }) }));
vi.mock('../api/_lib/embeddings.js', () => ({ generatePreferenceEmbedding: async () => null }));

const { default: handler } = await import('../api/recommendations.js');

const mockRes = () => {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};

const rows = [
  {
    type: 'place', id: 1, title: 'Tenney Park', category: 'park',
    vibe_quiet: '0.60', vibe_inside: '0.10', vibe_active: '0.40',
    tags: ['nature'], best_times: ['evening'], walk_minutes_from_center: 20,
    hours: null, seasons: null,
  },
  {
    type: 'place', id: 2, title: 'Elver Sledding Hill', category: 'park',
    vibe_quiet: '0.30', vibe_inside: '0.00', vibe_active: '0.90',
    tags: [], best_times: [], walk_minutes_from_center: null,
    hours: null, seasons: ['winter'],
  },
];

describe('POST /api/recommendations', () => {
  beforeEach(() => {
    // A July evening in Madison
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-01T23:00:00Z'));
    query.mockReset();
    query.mockImplementation(async (sql) => {
      if (sql.includes('FROM cities')) return { rows: [{ id: 1 }] };
      if (sql.includes('INSERT INTO recommendations')) return { rows: [{ id: 42 }] };
      if (sql.includes('FROM activities a')) return { rows };
      return { rows: [] };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns ranked picks, a recommendation id, and filters by season', async () => {
    const res = mockRes();
    await handler({
      method: 'POST',
      body: { timeAvailable: 120, quietToLively: 0.3, activeToRelaxing: 0.4, location: 'outside', tags: [] },
    }, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.metadata.recommendationId).toBe(42);
    expect(body.recommendations.map(r => r.title)).toEqual(['Tenney Park']);
  });

  it('rejects missing preferences', async () => {
    const res = mockRes();
    await handler({ method: 'POST', body: { timeAvailable: 60 } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('still answers if logging fails', async () => {
    query.mockImplementation(async (sql) => {
      if (sql.includes('FROM cities')) return { rows: [{ id: 1 }] };
      if (sql.includes('INSERT INTO recommendations')) throw new Error('db down');
      if (sql.includes('FROM activities a')) return { rows };
      return { rows: [] };
    });
    const res = mockRes();
    await handler({ method: 'POST', body: { timeAvailable: 120, quietToLively: 0.5, activeToRelaxing: 0.5 } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].metadata.recommendationId).toBeNull();
  });
});
