import type { Anomaly, Briefing, Citation, Scenario } from './types';

function uniqueCitations(anomalies: Anomaly[], scenario: Scenario): Citation[] {
  const map = new Map<string, Citation>();
  for (const anomaly of anomalies) {
    for (const cite of anomaly.citations) map.set(cite.id, cite);
  }
  for (const event of scenario.fusionEvents) {
    for (const cite of event.citations) map.set(cite.id, cite);
  }
  if (scenario.tracks.length > 0) {
    const first = scenario.tracks[0];
    map.set('briefing-opensky', {
      id: 'briefing-opensky',
      label: `OpenSky 항적 ${scenario.tracks.length}건`,
      source: first.source,
      observedAt: first.points.at(-1)?.observedAt,
      confidence: 0.78,
    });
  }
  if (scenario.weather) {
    map.set('briefing-weather', {
      id: 'briefing-weather',
      label: 'Open-Meteo 기상 스냅샷',
      source: scenario.weather.source,
      observedAt: scenario.weather.observedAt,
      confidence: 0.72,
    });
  }
  if (scenario.airspaceContexts.length > 0) {
    const fir = scenario.airspaceContexts[0];
    map.set('briefing-fir', {
      id: 'briefing-fir',
      label: `${fir.icaoCode} ${fir.firName} FIR`,
      source: fir.source,
      observedAt: fir.observedAt,
      confidence: 0.86,
    });
  }
  if (scenario.satellites.length > 0) {
    const sat = scenario.satellites[0];
    map.set('briefing-satellite', {
      id: 'briefing-satellite',
      label: `${sat.name} 공개 궤도`,
      source: sat.source,
      observedAt: sat.observedAt,
      confidence: 0.66,
    });
  }
  for (const item of scenario.osint) {
    map.set(`osint-${item.id}`, {
      id: `osint-${item.id}`,
      label: item.title,
      source: item.source,
      url: item.url,
      observedAt: item.publishedAt,
      confidence: item.confidence,
    });
  }
  return [...map.values()].sort((a, b) => b.confidence - a.confidence);
}

export function generateBriefing(scenario: Scenario, anomalies: Anomaly[]): Briefing {
  const warnings = anomalies.filter((item) => item.severity === 'warning').length;
  const watches = anomalies.filter((item) => item.severity === 'watch').length;
  const nonCommercialTracks = scenario.tracks.filter((track) => track.platformType !== 'commercial').length;
  const citations = uniqueCitations(anomalies, scenario);
  const weatherText = scenario.weather ? '기상' : '기상 미수집';
  const fusionFindings = scenario.fusionEvents.slice(0, 3).map((event) => (
    `${event.title} · 신뢰도 ${Math.round(event.confidence * 100)}% · 근거 ${event.citations.length}개`
  ));
  const anomalyFindings = anomalies.slice(0, 4).map((anomaly) => {
    const relatedTracks = anomaly.relatedTrackIds.length ? ` · 관련 항적 ${anomaly.relatedTrackIds.length}` : '';
    return `${anomaly.title} · 신뢰도 ${Math.round(anomaly.confidence * 100)}%${relatedTracks}`;
  });
  const emptyDataText = scenario.tracks.length === 0 && scenario.osint.length === 0 && !scenario.weather
    ? ' 현재 선택 지역에서 수집된 실제 공개 데이터가 아직 없습니다.'
    : '';

  return {
    headline: `${scenario.region.shortName}: 경고 ${warnings}건 / 관찰 ${watches}건 · 항적 ${scenario.tracks.length}개`,
    situationSummary: `${scenario.region.name}에서 공개/캐시 항적, ${weatherText}, OSINT 신호를 기준으로 검토 신호 ${anomalies.length}건을 찾았습니다. 비민항 또는 미식별 항적은 ${nonCommercialTracks}개입니다.${emptyDataText} 이 시스템은 판단을 자동화하지 않고, 분석관의 1차 분류 시간을 줄이는 보조 도구입니다.`,
    keyFindings: [...fusionFindings, ...anomalyFindings].slice(0, 5),
    recommendedNextChecks: [
      ...scenario.fusionEvents.slice(0, 2).map((event) => event.recommendedAction),
      '표시된 항적을 다른 공개 ADS-B 수신 자료나 캐시 스냅샷과 대조합니다.',
      '판단 전에 OSINT 근거 카드의 최신성, 중복 여부, 출처 신뢰도를 확인합니다.',
      '현재 신호를 사람이 승인한 기준 항로와 운영 맥락에 맞춰 비교합니다.',
      '실제 업무에 쓰는 경우 모든 결과를 확인 대기로 넘긴 뒤 후속 조치합니다.',
    ].filter((value, index, array) => array.indexOf(value) === index),
    caveats: [
      'ADS-B/OpenSky 계열 공개 항적은 불완전하며 민감 항공기나 군용기를 누락할 수 있습니다.',
      '데이터가 없거나 API가 실패한 레이어는 합성 값으로 채우지 않고 빈 상태로 표시합니다.',
      '뉴스/OSINT 신호는 상관관계 단서일 뿐이며 독립 확인이 필요합니다.',
      '이 프로토타입은 표적 지정, 타격 권고, 자동 교전 판단을 수행하지 않습니다.',
    ],
    citations,
    generatedBy: 'deterministic-template',
  };
}
