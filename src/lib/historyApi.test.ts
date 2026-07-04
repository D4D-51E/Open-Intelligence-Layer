import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchHistoryTracks, type HistoryTrackRow } from './historyApi';

function row(overrides: Partial<HistoryTrackRow> = {}): HistoryTrackRow {
  return {
    observed_at: '2026-07-01T00:00:00.000Z',
    region_id: 'taiwan-strait',
    icao24: 'abc123',
    callsign: 'REAL01',
    lat: 24.1,
    lon: 119.1,
    altitude_m: 9100,
    velocity_ms: 230,
    heading_deg: 82,
    is_military: false,
    type_code: null,
    ...overrides,
  };
}

function mockFetchOnce(response: { ok: boolean; rows?: HistoryTrackRow[] } | null, init: { status?: number } = {}) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: (init.status ?? 200) < 400,
    json: () => Promise.resolve(response),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('fetchHistoryTracks', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns rows from a successful ok response', async () => {
    mockFetchOnce({ ok: true, rows: [row()] });

    const rows = await fetchHistoryTracks({ region: 'taiwan-strait' });

    expect(rows).toHaveLength(1);
    expect(rows[0].callsign).toBe('REAL01');
  });

  it('returns an empty array when the payload is not ok', async () => {
    mockFetchOnce({ ok: false });

    const rows = await fetchHistoryTracks({ region: 'taiwan-strait' });

    expect(rows).toEqual([]);
  });

  it('returns an empty array when the response is a non-ok HTTP status', async () => {
    mockFetchOnce(null, { status: 500 });

    const rows = await fetchHistoryTracks({ region: 'taiwan-strait' });

    expect(rows).toEqual([]);
  });

  it('returns an empty array when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const rows = await fetchHistoryTracks({ region: 'taiwan-strait' });

    expect(rows).toEqual([]);
  });

  it('builds a query string with region, kind, and military flags', async () => {
    const fetchMock = mockFetchOnce({ ok: true, rows: [] });

    await fetchHistoryTracks({ region: 'seoul-airspace', from: '2026-07-01T00:00:00Z', to: '2026-07-02T00:00:00Z', military: true, limit: 500 });

    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain('/api/history?');
    expect(calledUrl).toContain('kind=tracks');
    expect(calledUrl).toContain('region=seoul-airspace');
    expect(calledUrl).toContain('military=1');
    expect(calledUrl).toContain('limit=500');
  });

  it('prefixes the url with baseUrl when provided', async () => {
    const fetchMock = mockFetchOnce({ ok: true, rows: [] });

    await fetchHistoryTracks({ region: 'taiwan-strait', baseUrl: 'https://example.test' });

    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl.startsWith('https://example.test/api/history?')).toBe(true);
  });
});
