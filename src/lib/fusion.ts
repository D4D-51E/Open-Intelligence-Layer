import type { Anomaly, Citation, FusionEvent, LiveSourceStatus, QueryIntent, QueryModule, Scenario, Severity } from './types';

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function operationalStatus(status: LiveSourceStatus | undefined) {
  return status === 'live' || status === 'cached' || status === 'standby';
}

function cite(id: string, label: string, source: string, confidence: number, observedAt?: string, url?: string): Citation {
  return { id, label, source, confidence, observedAt, url };
}

function sourceCitations(scenario: Scenario): Citation[] {
  const citations: Citation[] = [];
  if (scenario.tracks.length > 0) {
    const first = scenario.tracks[0];
    citations.push(cite('fusion-opensky', `OpenSky 항적 ${scenario.tracks.length}건`, first.source, 0.78, first.points.at(-1)?.observedAt));
  }
  if (scenario.ships.length > 0) {
    const first = scenario.ships[0];
    citations.push(cite('fusion-ais', `AIS 선박 ${scenario.ships.length}건`, first.source, 0.68, first.points.at(-1)?.observedAt));
  }
  if (scenario.weather) {
    citations.push(cite('fusion-weather', 'Open-Meteo 기상 스냅샷', scenario.weather.source, 0.72, scenario.weather.observedAt));
  }
  if (scenario.airspaceContexts.length > 0) {
    const fir = scenario.airspaceContexts[0];
    citations.push(cite('fusion-fir', `${fir.icaoCode} ${fir.firName} FIR`, fir.source, 0.86, fir.observedAt));
  }
  if (scenario.satellites.length > 0) {
    const sat = scenario.satellites[0];
    citations.push(cite('fusion-satellite', `${sat.name} 공개 궤도`, sat.source, 0.66, sat.observedAt));
  }
  for (const item of scenario.osint.slice(0, 3)) {
    citations.push(cite(`fusion-osint-${item.id}`, item.title, item.source, item.confidence, item.publishedAt, item.url));
  }
  return citations;
}

function confidenceFactors(scenario: Scenario, anomalies: Anomaly[]) {
  const status = scenario.sourceStatus ?? {};
  const operational = Object.values(status).filter(operationalStatus).length;
  const total = Math.max(1, Object.keys(status).length || 6);
  const sourceReliability = clamp01((operational / total) * 0.55 + (scenario.airspaceContexts.length ? 0.2 : 0) + (scenario.weather ? 0.1 : 0));
  const liveCount = Object.values(status).filter((value) => value === 'live').length;
  const cachedCount = Object.values(status).filter((value) => value === 'cached').length;
  const freshness = clamp01((liveCount * 0.16) + (cachedCount * 0.08) + (scenario.weather ? 0.12 : 0));
  const sourceFamilies = [scenario.tracks.length, scenario.ships.length, scenario.weather ? 1 : 0, scenario.osint.length, scenario.satellites.length, scenario.airspaceContexts.length]
    .filter((count) => count > 0).length;
  const crossSourceAgreement = clamp01(sourceFamilies / 6 + Math.min(0.18, anomalies.length * 0.04));
  const missingDataPenalty = clamp01(
    (status.notices === 'unsupported' ? 0.1 : 0)
    + (status.osintEvents === 'disabled' ? 0.06 : 0)
    + (status.ais === 'empty' ? 0.08 : 0)
    + (status.gdelt === 'rate-limited' ? 0.06 : 0),
  );
  return { sourceReliability, freshness, crossSourceAgreement, missingDataPenalty };
}

const gapStatuses = new Set<LiveSourceStatus>(['empty', 'rate-limited', 'unsupported', 'disabled', 'unavailable']);

type DataGap = {
  source: string;
  status: LiveSourceStatus;
  reason: string;
};

const sourceStatusLabels: Record<LiveSourceStatus, string> = {
  live: '라이브',
  cached: '캐시',
  standby: '대기',
  empty: '결과 없음',
  'rate-limited': '요청 제한',
  unsupported: '미지원',
  disabled: '비활성',
  unavailable: '사용 불가',
};

function confidenceForStatus(status: LiveSourceStatus) {
  if (status === 'unsupported' || status === 'disabled') return 0.9;
  if (status === 'empty') return 0.76;
  if (status === 'rate-limited') return 0.7;
  return 0.62;
}

function dataGapsForScenario(scenario: Scenario): DataGap[] {
  return Object.entries(scenario.sourceStatus ?? {})
    .filter(([, status]) => gapStatuses.has(status))
    .map(([source, status]) => ({
      source,
      status,
      reason: scenario.sourceReasons?.[source] ?? '사유 미상',
    }));
}

function sourceStatusCitations(dataGaps: DataGap[], scenario: Scenario, observedAt: string): Citation[] {
  return dataGaps.map((gap) => cite(
    `source-status-${gap.source}`,
    `${gap.source} ${sourceStatusLabels[gap.status]} · ${gap.reason}`,
    'source-status',
    confidenceForStatus(gap.status),
    scenario.sourceUpdatedAt?.[gap.source] ?? observedAt,
  ));
}

function uniqueCitations(citations: Citation[]): Citation[] {
  const seen = new Set<string>();
  return citations.filter((citation) => {
    if (seen.has(citation.id)) return false;
    seen.add(citation.id);
    return true;
  });
}

function confidenceFromFactors(factors: FusionEvent['confidenceFactors']) {
  return clamp01(
    factors.sourceReliability * 0.34
    + factors.freshness * 0.24
    + factors.crossSourceAgreement * 0.34
    - factors.missingDataPenalty * 0.28
    + 0.18,
  );
}

function severityFor(confidence: number, anomalies: Anomaly[]): Severity {
  if (anomalies.some((item) => item.severity === 'warning')) return 'warning';
  if (anomalies.some((item) => item.severity === 'watch')) return 'watch';
  void confidence;
  return 'info';
}

function modulesForScenario(scenario: Scenario): QueryModule[] {
  const modules: QueryModule[] = ['fusion'];
  if (scenario.tracks.length) modules.push('tracks');
  if (scenario.ships.length) modules.push('ships');
  if (scenario.weather) modules.push('weather');
  if (scenario.osint.length || scenario.osintEvents.length) modules.push('osint');
  if (scenario.satellites.length) modules.push('satellites');
  if (scenario.airspaceContexts.length) modules.push('airspace');
  if (scenario.notices.length) modules.push('notices');
  return modules;
}

function reorderByIntent(events: FusionEvent[], intent?: QueryIntent): FusionEvent[] {
  if (!intent) return events;
  const order = [...events];
  if (intent.focus === 'data-quality') {
    return order.sort((a, b) => Number(b.id.endsWith('data-quality')) - Number(a.id.endsWith('data-quality')));
  }
  if (intent.focus === 'anomaly') {
    return order.sort((a, b) => Number(b.id.endsWith('review-cue')) - Number(a.id.endsWith('review-cue')));
  }
  return order;
}

export function buildFusionEvents(scenario: Scenario, anomalies: Anomaly[], intent?: QueryIntent): FusionEvent[] {
  const createdAt = scenario.weather?.observedAt ?? scenario.timeline.at(-1)?.time ?? new Date().toISOString();
  const citations = sourceCitations(scenario);
  const factors = confidenceFactors(scenario, anomalies);
  const confidence = confidenceFromFactors(factors);
  const fir = scenario.airspaceContexts[0];
  const scenarioModules = modulesForScenario(scenario);
  const activeModules = intent?.modules?.length
    ? scenarioModules.filter((module) => intent.modules.includes(module))
    : scenarioModules;
  const dataGaps = dataGapsForScenario(scenario);
  const statusCitations = sourceStatusCitations(dataGaps, scenario, createdAt);

  const events: FusionEvent[] = [];

  if (citations.length > 0) {
    events.push({
      id: `fusion-${scenario.region.id}-overview`,
      regionId: scenario.region.id,
      title: `${scenario.region.shortName} 융합 상황 요약`,
      summary: `항적 ${scenario.tracks.length}건, 선박 ${scenario.ships.length}건, OSINT ${scenario.osint.length}건, FIR ${fir ? `${fir.icaoCode}/${fir.firName}` : '미확인'}, 위성 ${scenario.satellites.length}건을 같은 AOI 기준으로 결합했습니다.`,
      severity: severityFor(confidence, anomalies),
      confidence,
      confidenceFactors: factors,
      observedAt: createdAt,
      createdAt,
      modules: activeModules.length ? activeModules : ['fusion'],
      relatedIds: [
        ...scenario.tracks.slice(0, 6).map((item) => item.id),
        ...scenario.ships.slice(0, 4).map((item) => item.id),
        ...scenario.osint.slice(0, 3).map((item) => item.id),
        ...scenario.airspaceContexts.map((item) => item.id),
        ...scenario.satellites.map((item) => item.id),
      ],
      citations,
      recommendedAction: '표시된 출처 카드와 데이터 공백 사유를 확인한 뒤, 항적·OSINT·FIR 맥락이 같은 시간대에서 일치하는지 검토합니다.',
      reviewDefault: anomalies.length ? 'needs_review' : 'queued',
      safetyNote: '공개 출처 기반 분석관 검토용 큐입니다. 표적 지정이나 행동 권고로 사용하지 않습니다.',
    });
  }

  if (anomalies.length > 0) {
    const top = anomalies[0];
    const reviewCitations = uniqueCitations([...top.citations, ...citations]).slice(0, 6);
    if (reviewCitations.length > 0) {
      events.push({
        id: `fusion-${scenario.region.id}-review-cue`,
        regionId: scenario.region.id,
        title: `분석관 확인 큐 · ${top.title}`,
        summary: `이상신호 ${anomalies.length}건이 생성되었습니다. 최고 신호는 ${top.title}이며, 시스템 판단이 아니라 검토 우선순위입니다.`,
        severity: top.severity,
        confidence: clamp01((top.confidence + confidence) / 2),
        confidenceFactors: factors,
        observedAt: createdAt,
        createdAt,
        modules: [...new Set<QueryModule>(['fusion', 'tracks', 'osint', ...activeModules])],
        relatedIds: [...top.relatedTrackIds, ...top.relatedOsintIds],
        citations: reviewCitations,
        recommendedAction: '관련 항적의 최신 공개 ADS-B 상태와 OSINT 출처 최신성을 독립 확인합니다.',
        reviewDefault: 'needs_review',
        safetyNote: '신호 우선순위만 제공합니다. 사실 판단은 표시된 출처를 별도로 확인해야 합니다.',
      });
    }
  }

  if (dataGaps.length > 0) {
    events.push({
      id: `fusion-${scenario.region.id}-data-quality`,
      regionId: scenario.region.id,
      title: '데이터 품질 및 공백 확인',
      summary: dataGaps.slice(0, 3).map((gap) => `${gap.source}: ${sourceStatusLabels[gap.status]} · ${gap.reason}`).join(' · '),
      severity: 'info',
      confidence: clamp01(0.64 - factors.missingDataPenalty),
      confidenceFactors: factors,
      observedAt: createdAt,
      createdAt,
      modules: ['fusion'],
      relatedIds: [],
      citations: statusCitations,
      recommendedAction: '공백 레이어를 합성 값으로 채우지 말고, 수집 상태와 출처 한계를 브리핑 caveat로 유지합니다.',
      reviewDefault: 'queued',
      safetyNote: '데이터 공백은 사실 그대로 노출합니다. 폴백·합성 이벤트로 보정하지 않습니다.',
    });
  }

  return reorderByIntent(events, intent);
}
