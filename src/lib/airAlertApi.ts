// Client for /api/airalert — Ukrainian air-raid alerts (active-alert oblasts) from @air_alert_ua.
// Best-effort: any failure resolves to an empty list rather than throwing.

export type AirAlert = {
  key: string;
  oblast: string;
  lat: number;
  lon: number;
  since: string;
};

type AirAlertResponse = { ok: boolean; active?: AirAlert[] };

export async function fetchAirAlerts(signal?: AbortSignal): Promise<AirAlert[]> {
  try {
    const res = await fetch('/api/airalert', { signal });
    if (!res.ok) return [];
    const payload = await res.json() as AirAlertResponse;
    if (!payload.ok) return [];
    return payload.active ?? [];
  } catch {
    return [];
  }
}
