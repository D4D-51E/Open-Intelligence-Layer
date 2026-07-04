// Client for /api/copilot — OpenAI-backed situation summary + anomaly analysis over the
// current fused situation. Best-effort: any failure returns { ok:false } so the UI degrades
// to a keyless message rather than throwing.

export type CopilotMode = 'summary' | 'anomaly';

export type CopilotResult = { ok: boolean; text?: string; reason?: string; message?: string };

export async function askCopilot(
  mode: CopilotMode,
  context: unknown,
  query?: string,
  signal?: AbortSignal,
): Promise<CopilotResult> {
  try {
    const res = await fetch('/api/copilot', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode, query, context }),
      signal,
    });
    if (!res.ok) return { ok: false, reason: 'http', message: `HTTP ${res.status}` };
    return await res.json() as CopilotResult;
  } catch (error) {
    return { ok: false, reason: 'network', message: String(error) };
  }
}
