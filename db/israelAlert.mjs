// Israeli air-raid / interception alerts. The official Pikud HaOref endpoint (oref.org.il) blocks
// non-Israeli server IPs, so we read the Tzeva Adom API — a public keyless mirror of the SAME
// official Pikud HaOref siren data. Best-effort defensive parse (the live shape is only populated
// during an active alert); any failure resolves to []. Public data, non-targeting.
const THREAT_LABEL = {
  0: '로켓·미사일', 1: '적기 침투', 2: '지진', 3: '쓰나미', 4: '적 침투(테러)',
  5: '방사능', 6: '화학물질', 7: '해일', 8: '알 수 없음',
};

export async function fetchIsraelAlerts() {
  try {
    const res = await fetch('https://api.tzevaadom.co.il/notifications', {
      signal: AbortSignal.timeout(9000),
      headers: { 'user-agent': 'Mozilla/5.0', accept: 'application/json' },
    });
    if (!res.ok) return [];
    const json = await res.json();
    const list = Array.isArray(json) ? json : Array.isArray(json?.alerts) ? json.alerts : [];
    const out = [];
    for (const n of list) {
      const cities = n?.cities ?? n?.data?.cities ?? [];
      const time = n?.time ?? n?.data?.time ?? null;
      const threat = n?.threat ?? n?.data?.threat;
      const id = n?.notificationId ?? n?.id ?? `${time}`;
      const label = typeof threat === 'number' ? (THREAT_LABEL[threat] ?? '경보') : (threat ?? '경보');
      for (const city of (Array.isArray(cities) ? cities : [])) {
        out.push({ id: `${id}:${city}`, city: String(city), threat: label, time });
      }
    }
    return out;
  } catch {
    return [];
  }
}
